// Staging only. Never prints API response bodies, keys, signing secrets, messages or contacts.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { parseFirebaseServiceAccountJson } from './staging-credentials.mjs';

const WORKER = 'https://iaqar-intake-staging.iaqar-ai.workers.dev';
const ENDPOINT = `${WORKER}/integrations/kapso/webhook`;
const OFFICE = 'qa-office-kapso';
const PHONE = '597907523413541';
const SENDER = '966552019909';
const SECRET = String(process.env.KAPSO_WEBHOOK_SECRET || '').replace(/[\r\n]/g, '').trim();
const KEY = String(process.env.KAPSO_API_KEY || '').replace(/[\r\n]/g, '').trim();
const report = { source: 'signed synthetic deliveries to live Staging, not real inbound WhatsApp', productionTouched: false };
const { serviceAccount } = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, 'iaqar-ai-staging');
assert.equal(serviceAccount.project_id, 'iaqar-ai-staging');
initializeApp({ credential: cert(serviceAccount), projectId: 'iaqar-ai-staging' });
const db = getFirestore();
const office = db.collection('offices').doc(OFFICE);
assert.equal((await office.get()).data()?.isTestFixture, true);
assert.ok(SECRET && KEY);

const api = async (path, method = 'GET', body) => {
  const r = await fetch(`https://api.kapso.ai/platform/v1${path}`, {
    method, headers: { 'X-API-Key': KEY, accept: 'application/json', 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000)
  });
  return { status: r.status, ok: r.ok, data: await r.json().catch(() => ({})) };
};
const allPages = async path => {
  const rows = [];
  for (let page = 1; page <= 100; page++) {
    const r = await api(`${path}?page=${page}&per_page=100`);
    if (!r.ok) return { ...r, rows: [] };
    assert.ok(Array.isArray(r.data.data), 'unexpected Kapso list envelope');
    rows.push(...r.data.data);
    if (page >= Number(r.data.meta?.total_pages || 1)) return { ok: true, status: r.status, rows };
  }
  throw new Error('pagination_limit');
};
const deliver = async (body, { secret = SECRET, event = 'whatsapp.message.received', unsigned = false } = {}) => {
  const raw = JSON.stringify(body);
  const headers = { 'content-type': 'application/json', 'x-webhook-event': event, 'x-webhook-payload-version': 'v2' };
  if (!unsigned) headers['x-webhook-signature'] = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const r = await fetch(ENDPOINT, { method: 'POST', headers, body: raw, signal: AbortSignal.timeout(60000) });
  return { status: r.status, body: await r.json() };
};
const payload = (body, phoneId = PHONE) => ({ message: { id: `wamid.qa.${crypto.randomUUID()}`, type: 'text', from: SENDER, text: { body }, kapso: { direction: 'inbound' } }, conversation: { phone_number_id: phoneId }, phone_number_id: phoneId });
const say = async text => {
  const r = await deliver(payload(text));
  assert.equal(r.status, 200);
  const result = r.body.results?.[0];
  assert.ok(result && !['failed', 'invalid'].includes(result.status), 'live intake failed');
  return result;
};

try {
  const numbers = await allPages('/whatsapp/phone_numbers');
  report.api = { status: numbers.status, accepted: numbers.ok, authHeader: 'X-API-Key', endpoint: '/platform/v1/whatsapp/phone_numbers' };
  if (numbers.status === 401) report.api.reason = 'Kapso rejected the supplied project API key on its documented read-only endpoint; invalid/revoked/expired cannot be distinguished by HTTP 401 alone';
  if (numbers.status === 403) report.api.reason = 'permission_denied';
  if (numbers.ok) {
    const webhooks = await allPages('/webhooks');
    assert.equal(webhooks.ok, true, 'cannot enumerate existing webhooks safely');
    const matching = webhooks.rows.filter(w => w.url === ENDPOINT);
    assert.ok(matching.length <= 1, 'existing duplicate webhooks: refusing to create another');
    const existing = matching[0];
    assert.ok(!existing || String(existing.phone_number_id) === PHONE, 'existing endpoint belongs to a different number');
    const path = `/whatsapp/phone_numbers/${PHONE}/webhooks${existing ? `/${existing.id}` : ''}`;
    const config = { url: ENDPOINT, secret_key: SECRET, events: ['whatsapp.message.received'], payload_version: 'v2', active: true, buffer_enabled: false };
    const changed = await api(path, existing ? 'PATCH' : 'POST', { whatsapp_webhook: config });
    report.webhook = { status: changed.status, configured: changed.ok, operation: existing ? 'updated' : 'created' };
    if (changed.ok) {
      const checked = await api(`/whatsapp/phone_numbers/${PHONE}/webhooks/${changed.data.data.id}`);
      const w = checked.data.data;
      assert.equal(w.url, ENDPOINT);
      assert.deepEqual(w.events, ['whatsapp.message.received']);
      assert.equal(w.payload_version, 'v2');
      assert.equal(w.active, true);
      assert.equal(w.buffer_enabled, false);
      assert.equal(w.secret_key, SECRET);
      report.webhook.verified = true;
    }
  } else report.webhook = { configured: false, reason: 'api_auth_blocked' };

  assert.equal((await deliver({}, { unsigned: true })).status, 401);
  assert.equal((await deliver({}, { secret: 'wrong-test-secret' })).status, 401);
  assert.equal((await deliver({}, { event: 'whatsapp.message.sent' })).body.ignored, 'event');
  assert.equal((await deliver(payload('فحص', '100000000000000'))).body.results[0].status, 'other_number');
  report.signature = { unsignedRejected: true, wrongSecretRejected: true, currentSecretAccepted: true, otherEventIgnored: true, otherNumberIgnored: true };

  // Only the dedicated QA conversation is reset; no real office is read or modified.
  const chatId = `wa_${crypto.createHash('sha256').update(SENDER).digest('hex').slice(0, 40)}`;
  const chatRef = office.collection('kapsoChats').doc(chatId);
  const beforeChat = await chatRef.get();
  if (beforeChat.exists) assert.equal(beforeChat.data().isTestFixture, true);
  await chatRef.set({ stage: 'SAVED', isTestFixture: true, updatedAt: new Date().toISOString() }, { merge: true });

  // Request first, then the exact owner example; both use the existing confirmation and save path.
  let request = await say('مطلوب عمارة للشراء في الهجرة في المدينة المنورة الميزانية مليونين ومساحتها 600 متر');
  assert.equal(request.status, 'confirm');
  request = await say('نعم');
  assert.ok(['saved', 'duplicate_record'].includes(request.status));
  const testMessage = payload('عندي عمارة للبيع في الهجرة، مساحتها 600 متر، السعر مليون و900 ألف');
  const first = await deliver(testMessage);
  assert.equal(first.body.results[0].missing, 'city');
  assert.equal((await say('نعم')).status, 'confirm');
  const saved = await say('نعم');
  assert.ok(['saved', 'duplicate_record'].includes(saved.status));
  assert.equal(saved.matchingPending, false);
  assert.equal((await deliver(testMessage)).body.results[0].status, 'duplicate');
  const record = (await office.collection('opportunities').doc(saved.recordId).get()).data();
  assert.deepEqual([record.opportunityKind, record.purpose, record.propertyType, record.district, Number(record.area), Number(record.priceOrBudget || record.price)], ['OFFER', 'SALE', 'عمارة', 'الهجرة', 600, 1900000]);
  assert.equal(record.intakeOrigin.channel, 'WHATSAPP');
  const records = await office.collection('opportunities').get();
  assert.equal(records.docs.filter(d => d.id === saved.recordId).length, 1);
  const matches = await office.collection('matches').get();
  const match = matches.docs.find(d => [d.data().offerId, d.data().requestId].includes(saved.recordId) && [d.data().offerId, d.data().requestId].includes(request.recordId));
  const operations = await office.collection('operations').get();
  const review = match && operations.docs.find(d => d.data().type === 'MATCH_REVIEW' && JSON.stringify(d.data()).includes(match.id));
  report.intake = { officeResolved: true, analyzed: true, saved: true, persistedOnce: true, replayIgnored: true };
  report.matching = { pipelineCompleted: saved.matchingPending === false, matchFound: Boolean(match), reviewTaskFound: Boolean(review), negotiation: 'awaits office review through the existing journey; local E2E verifies room creation' };
  const deliveryLog = await office.collection('kapsoDeliveryLog').orderBy('at', 'desc').limit(10).get();
  report.reply = { outcomes: deliveryLog.docs.map(d => ({ status: d.data().status, reply: d.data().reply })), sent: deliveryLog.docs.some(d => d.data().reply === 'sent') };
  assert.ok(match && review, 'matching evidence missing');
} catch (error) {
  // Static messages only: never expose exception messages that could contain credentials or API bodies.
  report.testFailure = { code: error.code || 'verification_failed', name: error.name };
  process.exitCode = 1;
} finally {
  const output = JSON.stringify(report, null, 2);
  fs.writeFileSync(process.env.KAPSO_REPORT_PATH || '/tmp/kapso-result.json', output);
  console.log(output);
}
