#!/usr/bin/env node
/** Focused deployed-Staging E2E for client/owner negotiation party sessions. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { chromium } from "playwright";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const PROJECT_ID = "iaqar-ai-staging";
const STAGING_URL = "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const STAGING_WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const NORMAL_OFFICE_ID = "staging-logo-live-20260807";
const OFFICE_ID = "qa-e2e-dedicated";
const OUT = process.env.LIVE_E2E_OUT || "/opt/cursor/artifacts";
const RUN_ID = `livee2e_neg_${Date.now().toString(36)}`;
const REQUEST_ID = `opp_${RUN_ID}_req`;
const OFFER_ID = `opp_${RUN_ID}_offer`;

mkdirSync(OUT, { recursive: true });
const parsedSa = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsedSa.serviceAccount) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON missing");
const app = admin.initializeApp({ credential: admin.cert(parsedSa.serviceAccount), projectId: PROJECT_ID });
const db = getFirestore(app);
const office = db.collection("offices").doc(OFFICE_ID);
let activeMatchId = "";

function stamp() {
  return {
    officeId: OFFICE_ID,
    lifecycleStatus: "ACTIVE",
    status: "active",
    matchingReadiness: "READY_FOR_MATCHING",
    dataCompleteness: 100,
    completeness: 100,
    city: "المدينة المنورة",
    district: "العزيزية",
    propertyType: "شقة",
    area: 125,
    rooms: 3,
    version: 1,
    isTestFixture: true,
    testRunId: RUN_ID,
    createdBy: "E2E_NEGOTIATION",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };
}

async function ensureQaOffice() {
  const source = db.collection("offices").doc(NORMAL_OFFICE_ID);
  const [sourceSnap, membersSnap] = await Promise.all([source.get(), source.collection("members").get()]);
  if (membersSnap.empty) throw new Error("QA source office has no member to authenticate");
  const sourceData = sourceSnap.data() || {};
  await office.set({
    officeName: "QA E2E Dedicated",
    displayName: "QA E2E Dedicated",
    isTestFixture: true,
    createdBy: "E2E",
    ownerUid: sourceData.ownerUid || "",
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  await Promise.all(membersSnap.docs.map((doc) => office.collection("members").doc(doc.id).set({
    ...doc.data(), updatedAt: FieldValue.serverTimestamp()
  }, { merge: true })));
  return membersSnap.docs[0].id;
}

async function cleanupStaleQaFixtures() {
  for (const name of ["matches", "opportunities", "operations"]) {
    const snap = await office.collection(name).where("isTestFixture", "==", true).limit(200).get();
    await Promise.all(snap.docs.map((doc) => doc.ref.delete().catch(() => {})));
  }
}

async function persistPair() {
  await office.collection("opportunities").doc(REQUEST_ID).set({
    ...stamp(),
    opportunityKind: "REQUEST",
    kind: "client_request",
    purpose: "LEASE_REQUEST",
    advertiserRole: "CLIENT",
    contactType: "buyer",
    budget: 55000,
    priceOrBudget: 55000,
    priceMax: 55000,
    contactName: `عميل QA ${RUN_ID}`
  });
  await office.collection("opportunities").doc(OFFER_ID).set({
    ...stamp(),
    opportunityKind: "OFFER",
    kind: "owner_offer",
    purpose: "RENT",
    advertiserRole: "OWNER",
    contactType: "owner",
    annualRent: 50000,
    priceOrBudget: 50000,
    contactName: `مالك QA ${RUN_ID}`
  });
}

async function idToken(uid) {
  const initRes = await fetch(`${STAGING_URL}/__/firebase/init.json`, { cache: "no-store" });
  const initBody = await initRes.json().catch(() => ({}));
  if (!initRes.ok || !initBody.apiKey) throw new Error(`firebase init failed ${initRes.status}`);
  const customToken = await getAuth(app).createCustomToken(uid);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${initBody.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.idToken) throw new Error(`custom-token sign-in failed ${response.status}`);
  return body.idToken;
}

async function runMatching(token) {
  const response = await fetch(`${STAGING_WORKER}/matching/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ officeId: OFFICE_ID, opportunityId: REQUEST_ID, notify: false })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`matching failed ${response.status} ${JSON.stringify(body)}`);
  const rows = Array.isArray(body.matches) ? body.matches : [];
  const row = rows.find((item) => item.requestId === REQUEST_ID && item.offerId === OFFER_ID) || rows[0];
  const matchId = String(row?.matchId || "");
  if (!matchId) throw new Error(`matching created no QA match ${JSON.stringify(body)}`);
  activeMatchId = matchId;
  await office.collection("matches").doc(matchId).set({
    isTestFixture: true,
    testRunId: RUN_ID,
    createdBy: "E2E_NEGOTIATION",
    officeId: OFFICE_ID
  }, { merge: true });
  return { matchId, status: response.status };
}

async function mint(token, party, matchId) {
  const response = await fetch(`${STAGING_WORKER}/party/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ officeId: OFFICE_ID, party, matchId, requestId: REQUEST_ID, offerId: OFFER_ID })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok || !body.token) {
    throw new Error(`${party} mint failed ${response.status} ${JSON.stringify(body)}`);
  }
  return { status: response.status, ...body };
}

async function readPublic(token) {
  const response = await fetch(`${STAGING_WORKER}/party/sessions/${encodeURIComponent(token)}`, {
    headers: { Accept: "application/json" }, cache: "no-store"
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok || !body.view) throw new Error(`party read failed ${response.status}`);
  return body.view;
}

async function waitReady(page) {
  await page.waitForSelector("[data-party-decision-package], [data-party-error], [data-testid='party-bundle-recorded'], .party-recorded", { timeout: 60000 });
  if (await page.locator("[data-party-error]").count()) {
    throw new Error(`party UI error: ${(await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 500)}`);
  }
  const loginChrome = (await page.locator("#loginForm").count()) + (await page.getByText("تسجيل دخول مكتب").count());
  if (loginChrome) throw new Error("party page exposed broker login chrome");
}

async function assertButtonsOnly(page) {
  const manual = await page.locator("[data-party-decision-package] input[type='text'], [data-party-decision-package] input[type='number'], [data-party-decision-package] textarea").count();
  if (manual) throw new Error(`manual text/number inputs exposed: ${manual}`);
}

async function chooseFirstVisible(page, selector) {
  const rows = page.locator(selector);
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    if (await row.isVisible().catch(() => false)) {
      await row.check();
      return true;
    }
  }
  return false;
}

async function submitBundle(page) {
  const waiter = page.waitForResponse(
    (res) => /\/party\/sessions\/.+\/bundle$/.test(res.url()) && res.request().method() === "POST",
    { timeout: 45000 }
  );
  await page.locator("[data-party-bundle-submit]").click();
  const response = await waiter;
  const body = await response.json().catch(() => ({}));
  if (!response.ok() || !body.ok) throw new Error(`bundle submit failed ${response.status()} ${JSON.stringify(body)}`);
  await page.locator("[data-testid='party-bundle-recorded'], .party-recorded").first().waitFor({ state: "visible", timeout: 45000 });
  return response.status();
}

async function clientJourney(browser, token) {
  const context = await browser.newContext({ locale: "ar-SA", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const url = `${STAGING_URL}/?cv2Party=${encodeURIComponent(token)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitReady(page);
  await assertButtonsOnly(page);
  await page.screenshot({ path: path.join(OUT, "client-initial.png"), fullPage: true });

  const viewing = page.locator('input[data-package-field="clientDecision"][value="viewing"]');
  if (!(await viewing.count())) throw new Error("client viewing decision missing");
  await viewing.check();
  await page.waitForTimeout(150);
  if (!(await chooseFirstVisible(page, 'input[data-package-field="viewingDays"]'))) throw new Error("client viewing day missing");
  if (!(await chooseFirstVisible(page, 'input[data-package-field="viewingPeriods"]'))) throw new Error("client viewing period missing");
  const submitStatus = await submitBundle(page);
  await page.screenshot({ path: path.join(OUT, "client-submitted.png"), fullPage: true });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  await waitReady(page);
  const persisted = (await page.locator("[data-testid='party-bundle-recorded'], .party-recorded").count()) > 0;
  const tokenStayed = new URL(page.url()).searchParams.get("cv2Party") === token;
  await page.screenshot({ path: path.join(OUT, "client-reload.png"), fullPage: true });
  await context.close();
  return { submitStatus, persisted, tokenStayed };
}

async function ownerJourney(browser, token) {
  const context = await browser.newContext({ locale: "ar-SA", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const url = `${STAGING_URL}/?cv2Party=${encodeURIComponent(token)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await waitReady(page);
  await assertButtonsOnly(page);
  const root = page.locator("[data-party-decision-package]").first();
  const workflowStep = String(await root.getAttribute("data-workflow-step") || "");
  await page.screenshot({ path: path.join(OUT, "owner-initial.png"), fullPage: true });

  await chooseFirstVisible(page, 'input[data-package-field="propertyAvailability"][value="available"]');
  await chooseFirstVisible(page, 'input[data-package-field="ownerPriceDecision"][value="confirmed"]');
  const confirms = page.locator('input[data-package-field^="detailStatus_"][value="confirm"]');
  for (let index = 0; index < await confirms.count(); index += 1) {
    const item = confirms.nth(index);
    if (await item.isVisible().catch(() => false)) await item.check();
  }
  const viewing = page.locator('input[data-package-field="viewingAllowed"][value="yes"]');
  if (await viewing.count()) {
    await viewing.check();
    await page.waitForTimeout(150);
    await chooseFirstVisible(page, 'input[data-package-field="viewingDays"]');
    await chooseFirstVisible(page, 'input[data-package-field="viewingPeriods"]');
  }
  if (!(await page.locator("[data-party-bundle-submit]").count())) throw new Error(`owner submit missing step=${workflowStep}`);
  const submitStatus = await submitBundle(page);
  await page.screenshot({ path: path.join(OUT, "owner-submitted.png"), fullPage: true });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  await waitReady(page);
  const persisted = (await page.locator("[data-testid='party-bundle-recorded'], .party-recorded").count()) > 0;
  const tokenStayed = new URL(page.url()).searchParams.get("cv2Party") === token;
  await page.screenshot({ path: path.join(OUT, "owner-reload.png"), fullPage: true });
  await context.close();
  return { workflowStep, submitStatus, persisted, tokenStayed };
}

async function waitOwnerNeeded(matchId) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const data = (await office.collection("matches").doc(matchId).get()).data() || {};
    const needed = data.ownerContactNeeded === true || String(data.ownerContactNeeded || "").toLowerCase() === "true";
    if (needed) return { ownerContactNeeded: true, livingStage: data.livingStage || "" };
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  const data = (await office.collection("matches").doc(matchId).get()).data() || {};
  return { ownerContactNeeded: false, livingStage: data.livingStage || "" };
}

async function persistedSessions(matchId) {
  const snap = await office.collection("partySessions").where("matchId", "==", matchId).get();
  return snap.docs.map((doc) => {
    const data = doc.data() || {};
    return { id: doc.id, party: data.party || "", token: data.token || "", status: data.status || "" };
  });
}

async function cleanup() {
  if (activeMatchId) {
    for (const name of ["partySessions", "partySessionKeys", "coordinationSessions", "operations", "notifications"]) {
      const snap = await office.collection(name).where("matchId", "==", activeMatchId).limit(100).get().catch(() => ({ docs: [] }));
      await Promise.all(snap.docs.map((doc) => doc.ref.delete().catch(() => {})));
    }
    await office.collection("matches").doc(activeMatchId).delete().catch(() => {});
  }
  await office.collection("opportunities").doc(REQUEST_ID).delete().catch(() => {});
  await office.collection("opportunities").doc(OFFER_ID).delete().catch(() => {});
}

async function main() {
  let browser;
  try {
    const uid = await ensureQaOffice();
    await cleanupStaleQaFixtures();
    await persistPair();
    const token = await idToken(uid);
    const matching = await runMatching(token);

    const client1 = await mint(token, "client", matching.matchId);
    const client2 = await mint(token, "client", matching.matchId);
    if (client1.token !== client2.token || client2.reused !== true) throw new Error("client token not stable before reply");

    browser = await chromium.launch({ headless: true });
    const clientUi = await clientJourney(browser, client1.token);
    const clientView = await readPublic(client1.token);
    const afterClient = await waitOwnerNeeded(matching.matchId);
    if (!afterClient.ownerContactNeeded) throw new Error(`owner contact not requested after client viewing; stage=${afterClient.livingStage}`);
    const client3 = await mint(token, "client", matching.matchId);
    if (client3.token !== client1.token || client3.reused !== true) throw new Error("client token rotated after reply");

    const owner1 = await mint(token, "owner", matching.matchId);
    const owner2 = await mint(token, "owner", matching.matchId);
    if (owner1.token !== owner2.token || owner2.reused !== true) throw new Error("owner token not stable before reply");
    const ownerUi = await ownerJourney(browser, owner1.token);
    const ownerView = await readPublic(owner1.token);
    const owner3 = await mint(token, "owner", matching.matchId);
    if (owner3.token !== owner1.token || owner3.reused !== true) throw new Error("owner token rotated after reply");

    const sessions = await persistedSessions(matching.matchId);
    const uniqueTokens = new Set(sessions.map((row) => row.token).filter(Boolean));
    const parties = new Set(sessions.map((row) => row.party).filter(Boolean));
    const clientSubmitted = Boolean(clientView?.decisionPackage?.submitted || clientView?.replied);
    const ownerSubmitted = Boolean(ownerView?.decisionPackage?.submitted || ownerView?.replied);
    const verified = Boolean(
      clientUi.submitStatus >= 200 && clientUi.submitStatus < 300
      && ownerUi.submitStatus >= 200 && ownerUi.submitStatus < 300
      && clientUi.persisted && clientUi.tokenStayed && clientSubmitted
      && ownerUi.persisted && ownerUi.tokenStayed && ownerSubmitted
      && sessions.length === 2 && uniqueTokens.size === 2
      && parties.has("client") && parties.has("owner")
      && client1.token === client2.token && client1.token === client3.token
      && owner1.token === owner2.token && owner1.token === owner3.token
    );

    const report = {
      generatedAt: new Date().toISOString(),
      runId: RUN_ID,
      officeId: OFFICE_ID,
      matchId: matching.matchId,
      matchingStatus: matching.status,
      client: { reusedBeforeReply: client2.reused === true, reusedAfterReply: client3.reused === true, publicSubmitted: clientSubmitted, ...clientUi },
      owner: { reusedBeforeReply: owner2.reused === true, reusedAfterReply: owner3.reused === true, publicSubmitted: ownerSubmitted, ...ownerUi },
      afterClient,
      sessionCount: sessions.length,
      stableTokenCount: uniqueTokens.size,
      parties: [...parties],
      verified
    };
    writeFileSync(path.join(OUT, "live-negotiation-session-qa.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (!verified) throw new Error("LIVE NEGOTIATION SESSION NOT VERIFIED");
    console.log("LIVE NEGOTIATION SESSION VERIFIED — CLIENT + OWNER TOKENS STABLE");
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanup().catch((error) => console.warn("cleanup failed", error.message));
    await app.delete().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
