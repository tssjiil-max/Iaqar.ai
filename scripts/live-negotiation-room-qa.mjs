// Deployed room QA. Fresh per-run offices only; never resets a shared QA office.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { chromium } from '@playwright/test';
import { parseFirebaseServiceAccountJson } from './staging-credentials.mjs';
import { signInQaUser, STAGING_PROJECT_ID } from './staging-qa-identity.mjs';
import { roomSchema } from '../public/os/domain/negotiation-room-domain.js';

const HOST = 'https://iaqar-ai-staging--staging-9c4b0k7h.web.app';
const WORKER = 'https://iaqar-intake-staging.iaqar-ai.workers.dev';
const OUT = process.env.LIVE_E2E_OUT || '/tmp/negotiation-room-qa';
mkdirSync(OUT, { recursive: true });
const run = randomUUID();
const report = { run, target: HOST, status: 'BLOCKED', checks: [] };
const check = async (name, fn) => {
  try { await fn(); report.checks.push({ name, status: 'PASS' }); }
  catch (error) { report.checks.push({ name, status: 'FAIL' }); throw error; }
};
let app, db, auth, browser;
const ownedOffices = [], ownedUsers = [];
let brokerToken;
let lastRequestAt = 0;
async function call(route, body, authorized = false) {
  // Respect the existing public 60/minute guard; do not disable it for QA.
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 1200 - (Date.now() - lastRequestAt))));
  lastRequestAt = Date.now();
  const response = await fetch(`${WORKER}${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { authorization: `Bearer ${brokerToken}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(45000)
  });
  return { status: response.status, body: await response.json() };
}
const ok = (result) => { assert.equal(result.status, 200); return result.body; };
const view = async (token) => ok(await call('/os/session/view', { token })).session;
const act = async (token, action, extra = {}) => call('/os/session/act', { token, action, submissionId: randomUUID(), ...extra });
const tokenOf = (url) => new URL(url).hash.slice(1);
const officeId = `qa-neg-room-${run}`;

async function createOffice(id, uid) {
  const ref = db.collection('offices').doc(id);
  await ref.create({ officeId: id, officeName: 'QA Negotiation Room', ownerUid: uid, active: true, isTestFixture: true, testRunId: run, platformOpportunityOnboardingAckAt: new Date() });
  ownedOffices.push(id);
  await ref.collection('members').doc(uid).create({ uid, role: 'owner', active: true, testRunId: run, isTestFixture: true });
}
async function deal(type, rent, index) {
  const record = { propertyType: type, city: 'الرياض', district: `حي اختبار ${run}-${index}`, area: 600, rooms: 4, price: rent ? 60000 : 1200000 };
  const offer = ok(await call('/os/records/save', { officeId, requestKey: `offer-${run}-${index}`, record: { ...record, kind: 'OFFER', purpose: rent ? 'RENT' : 'SALE', contactName: 'مالك سري QA', contactPhone: '0551230002' } }, true));
  const request = ok(await call('/os/records/save', { officeId, requestKey: `request-${run}-${index}`, record: { ...record, kind: 'REQUEST', purpose: rent ? 'LEASE_REQUEST' : 'PURCHASE', contactName: 'عميل سري QA', contactPhone: '0551230001' } }, true));
  const matches = await db.collection('offices').doc(officeId).collection('matches').get();
  const match = matches.docs.find(d => d.data().offerId === offer.recordId && d.data().requestId === request.recordId);
  assert.ok(match, 'QA records must match');
  const approved = ok(await call('/os/review/decide', { officeId, matchId: match.id, decision: 'approve' }, true));
  const links = ok(await call('/os/session/links', { officeId, journeyId: approved.journeyId }, true)).links;
  return { journeyId: approved.journeyId, owner: tokenOf(links.owner.url), client: tokenOf(links.client.url), record, rent };
}
async function mobile(d, index) {
  for (const role of ['owner', 'client']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-SA', isMobile: true, hasTouch: true });
    try {
      const page = await context.newPage();
      await page.goto(`${HOST}/s#${d[role]}`, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-room-part="agreed"]').waitFor();
      const before = await page.locator('[data-room-part="agreed"]').innerText();
      await page.reload();
      await page.locator('[data-room-part="agreed"]').waitFor();
      assert.equal(await page.locator('[data-room-part="agreed"]').innerText(), before);
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1), false);
      assert.ok(!/055123000[12]|مالك سري|عميل سري/.test(await page.locator('body').innerText()));
      await page.screenshot({ path: `${OUT}/${index}-${role}.png`, fullPage: true });
    } finally { await context.close(); }
  }
}

try {
  const parsed = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, STAGING_PROJECT_ID);
  if (!parsed.serviceAccount) throw new Error('BLOCKED: valid FIREBASE_SERVICE_ACCOUNT_JSON for iaqar-ai-staging required');
  const version = await (await fetch(`${HOST}/version.json`, { cache: 'no-store' })).json();
  report.deployedSha = version.fullSha;
  if (!process.env.EXPECTED_STAGING_SHA || version.fullSha !== process.env.EXPECTED_STAGING_SHA) throw new Error('BLOCKED: deployed SHA differs from EXPECTED_STAGING_SHA');
  const health = await (await fetch(`${WORKER}/health`)).json();
  assert.equal(health.projectId, STAGING_PROJECT_ID);
  assert.equal(health.deploymentEnvironment, 'staging');
  assert.equal(health.backendReady, true);
  app = initializeApp({ credential: cert(parsed.serviceAccount), projectId: STAGING_PROJECT_ID });
  db = getFirestore(app); auth = getAuth(app);
  const uid = `qa-e2e-room-${run}`;
  await auth.createUser({ uid }); ownedUsers.push(uid);
  await createOffice(officeId, uid);
  await createOffice(`${officeId}-foreign`, uid);
  brokerToken = (await signInQaUser({ auth, stagingUrl: HOST, uid })).idToken;
  browser = await chromium.launch();
  let index = 0, main;
  for (const type of ['شقة', 'أرض', 'فيلا', 'عمارة']) for (const rent of [false, true]) {
    const d = await deal(type, rent, ++index);
    main ||= d;
    await check(`${type}/${rent ? 'rent' : 'sale'}: terms, prices, privacy, reload`, async () => {
      const initial = await view(d.owner);
      const schema = roomSchema({ offerSummary: { ...d.record, purpose: rent ? 'RENT' : 'SALE' } });
      assert.deepEqual(initial.room.terms.map(t => t.id), schema.terms.map(t => t.id));
      const term = schema.terms[0], first = term.options[0].id, second = term.options[1].id;
      ok(await act(d.owner, 'term_propose', { termId: term.id, optionId: first }));
      assert.ok(!(await view(d.client)).room.agreed.some(t => t.id === `term:${term.id}`));
      assert.equal((await act(d.owner, 'term_accept', { termId: term.id, optionId: first })).status, 409);
      ok(await act(d.client, 'term_reject', { termId: term.id, optionId: first }));
      ok(await act(d.owner, 'term_propose', { termId: term.id, optionId: first }));
      ok(await act(d.client, 'term_propose', { termId: term.id, optionId: second }));
      ok(await act(d.owner, 'term_accept', { termId: term.id, optionId: second }));
      ok(await act(d.owner, 'manual', { price: String(d.record.price - 1000) }));
      ok(await act(d.client, 'manual', { price: String(d.record.price - 2000) }));
      ok(await act(d.owner, 'accept'));
      assert.ok((await view(d.client)).room.agreed.some(t => t.id === 'price'));
      await mobile(d, index);
    });
  }
  await check('broker forward/rephrase/reply; private requests; audited decisions', async () => {
    const ref = db.collection('offices').doc(officeId).collection('journeys').doc(main.journeyId);
    for (const decision of ['forward', 'rephrase', 'reply']) {
      const text = `مهلة للتمويل ${decision}`;
      ok(await act(main.owner, 'intervention', { message: `${text} 0551234567` }));
      assert.ok(!JSON.stringify(await view(main.client)).includes(text));
      const request = (await ref.get()).data().session.requests.at(-1);
      const tasks = await db.collection('offices').doc(officeId).collection('operations').where('journeyId', '==', main.journeyId).get();
      assert.ok(tasks.docs.some(t => t.data().type === 'SESSION_INTERVENTION'));
      ok(await call('/os/session/request', { officeId, journeyId: main.journeyId, requestId: request.id, decision, text: `رد الوسيط ${decision}` }, true));
      const saved = (await ref.get()).data().session.requests.find(r => r.id === request.id);
      assert.equal(saved.handledBy, uid); assert.ok(saved.handledAt);
      const client = JSON.stringify(await view(main.client));
      const owner = JSON.stringify(await view(main.owner));
      if (decision === 'reply') { assert.ok(owner.includes('رد الوسيط reply')); assert.ok(!client.includes('رد الوسيط reply')); }
      else { assert.ok(client.includes(decision === 'forward' ? text : 'رد الوسيط rephrase')); assert.ok(!client.includes('0551234567')); }
    }
    assert.equal((await ref.collection('events').where('type', '==', 'SESSION_REQUEST_HANDLED').get()).size, 3);
  });
  await check('unauthorized/foreign access, replaced/closed links, price rejection', async () => {
    assert.equal((await call('/os/session/links', { officeId, journeyId: main.journeyId })).status, 401);
    assert.equal((await call('/os/session/links', { officeId: `${officeId}-foreign`, journeyId: main.journeyId }, true)).status, 404);
    assert.equal((await call('/os/session/view', { token: 'x'.repeat(43) })).body.state, 'INVALID');
    const replaced = ok(await call('/os/session/links', { officeId, journeyId: main.journeyId, replace: 'client' }, true));
    assert.equal((await call('/os/session/view', { token: main.client })).body.state, 'REPLACED');
    assert.equal((await act(main.client, 'intervention')).body.state, 'REPLACED');
    const rejected = await deal('شقة', false, ++index);
    ok(await act(rejected.owner, 'manual', { price: '1180000' }));
    ok(await act(rejected.client, 'reject'));
    ok(await call('/os/journeys/close', { officeId, journeyId: main.journeyId, outcome: 'LOST', reason: 'سبب آخر' }, true));
    const newToken = tokenOf(replaced.links.client.url);
    assert.equal((await call('/os/session/view', { token: newToken })).body.state, 'CLOSED');
    assert.equal((await act(newToken, 'intervention')).body.state, 'CLOSED');
  });
  report.status = 'PASS';
} catch (error) {
  report.status = String(error.message).startsWith('BLOCKED:') ? 'BLOCKED' : 'FAIL';
  // No raw responses, credentials, URLs with tokens, or exception stacks in artifacts.
  report.reason = report.status === 'BLOCKED' ? error.message : 'Operational check failed; see failed check name';
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => { process.exitCode = 1; });
  try {
    for (const id of ownedOffices) {
      const ref = db.collection('offices').doc(id);
      assert.equal((await ref.get()).data()?.testRunId, run);
      for (const name of ['sessionLinks', 'sessionLinkSecrets', 'replyLinks']) {
        const links = await db.collection(name).where('officeId', '==', id).get();
        for (const link of links.docs) await db.recursiveDelete(link.ref);
      }
      await db.recursiveDelete(ref);
    }
    for (const uid of ownedUsers) await auth.deleteUser(uid);
    report.cleanup = 'PASS';
  } catch { report.cleanup = 'FAIL'; report.status = 'FAIL'; process.exitCode = 1; }
  if (app) await app.delete();
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
