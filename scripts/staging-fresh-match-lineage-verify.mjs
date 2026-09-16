#!/usr/bin/env node
/**
 * Unified deployed-STAGING proof for one fresh Match lineage:
 * REQUEST + OFFER -> MATCH -> MATCH_REVIEW -> Bank both sides -> exact Match CTA
 * -> client/owner party replies -> coordinationSessions/{matchId} -> NEGOTIATION
 * -> reload/persistence, all with the same matchId.
 */
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
const RUN_ID = `fresh_lineage_${Date.now().toString(36)}`;
const REQUEST_ID = `opp_${RUN_ID}_req`;
const OFFER_ID = `opp_${RUN_ID}_offer`;

mkdirSync(OUT, { recursive: true });
const parsedSa = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsedSa.serviceAccount) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON missing");
const app = admin.initializeApp({ credential: admin.cert(parsedSa.serviceAccount), projectId: PROJECT_ID });
const db = getFirestore(app);
const office = db.collection("offices").doc(OFFICE_ID);
let activeMatchId = "";
let currentStage = "startup";

function markStage(stage) {
  currentStage = stage;
  console.log(`FRESH_MATCH_LINEAGE_STAGE ${stage}`);
}

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
    createdBy: "FRESH_MATCH_LINEAGE_E2E",
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

async function persistPair() {
  await Promise.all([
    office.collection("opportunities").doc(REQUEST_ID).set({
      ...stamp(), opportunityKind: "REQUEST", kind: "client_request", purpose: "LEASE_REQUEST",
      advertiserRole: "CLIENT", contactType: "buyer", budget: 55000, priceOrBudget: 55000,
      priceMax: 55000, contactPhone: "0501111842", advertiserPhoneNormalized: "+966501111842",
      contactName: `عميل QA ${RUN_ID}`
    }),
    office.collection("opportunities").doc(OFFER_ID).set({
      ...stamp(), opportunityKind: "OFFER", kind: "owner_offer", purpose: "RENT",
      advertiserRole: "OWNER", contactType: "owner", salePrice: 50000, annualRent: 50000,
      priceOrBudget: 50000, contactPhone: "0502221842", advertiserPhoneNormalized: "+966502221842",
      contactName: `مالك QA ${RUN_ID}`
    })
  ]);
  const [request, offer] = await Promise.all([
    office.collection("opportunities").doc(REQUEST_ID).get(),
    office.collection("opportunities").doc(OFFER_ID).get()
  ]);
  if (!request.exists || !offer.exists) throw new Error("fresh canonical pair was not persisted");
}

async function authTokens(uid) {
  const initRes = await fetch(`${STAGING_URL}/__/firebase/init.json`, { cache: "no-store" });
  const initBody = await initRes.json().catch(() => ({}));
  if (!initRes.ok || !initBody.apiKey) throw new Error(`firebase init failed ${initRes.status}`);
  const customToken = await getAuth(app).createCustomToken(uid);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${initBody.apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.idToken) throw new Error(`custom-token sign-in failed ${response.status}`);
  return { idToken: body.idToken, customToken };
}

async function runMatching(idToken) {
  const response = await fetch(`${STAGING_WORKER}/matching/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ officeId: OFFICE_ID, opportunityId: REQUEST_ID, notify: false })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`matching failed ${response.status} ${JSON.stringify(body)}`);
  const rows = Array.isArray(body.matches) ? body.matches : [];
  const row = rows.find((item) => String(item.requestId || "") === REQUEST_ID && String(item.offerId || "") === OFFER_ID);
  const matchId = String(row?.matchId || "");
  if (!matchId) throw new Error(`matching did not return exact fresh pair ${JSON.stringify(body)}`);
  activeMatchId = matchId;
  await office.collection("matches").doc(matchId).set({
    isTestFixture: true, testRunId: RUN_ID, createdBy: "FRESH_MATCH_LINEAGE_E2E", officeId: OFFICE_ID
  }, { merge: true });
  return { matchId, status: response.status };
}

function canonicalIds(data = {}) {
  return {
    requestId: String(data.requestId || data.clientRequestId || ""),
    offerId: String(data.offerId || data.ownerOfferId || "")
  };
}

async function waitForMatchReview(matchId) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const [matchSnap, opsSnap] = await Promise.all([
      office.collection("matches").doc(matchId).get(),
      office.collection("operations").where("matchId", "==", matchId).limit(10).get()
    ]);
    const match = matchSnap.data() || {};
    const ids = canonicalIds(match);
    const operationDoc = opsSnap.docs.find((doc) => {
      const data = doc.data() || {};
      return String(data.operationType || data.type || "").toUpperCase() === "MATCH_REVIEW";
    });
    if (matchSnap.exists && operationDoc && ids.requestId === REQUEST_ID && ids.offerId === OFFER_ID) {
      const operation = operationDoc.data() || {};
      if (String(operation.matchId || "") !== matchId) throw new Error("MATCH_REVIEW changed matchId");
      return {
        matchId, requestId: ids.requestId, offerId: ids.offerId,
        operationId: operationDoc.id,
        operationStatus: String(operation.status || ""),
        operationLivingStage: String(operation.livingStage || "")
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`MATCH_REVIEW not linked to exact fresh pair matchId=${matchId}`);
}

async function openBankTab(page) {
  const bankTab = page.locator("#mainTabOpportunities:visible, button:visible:has-text('العروض والطلبات')").first();
  if (await bankTab.count()) await bankTab.click();
  else await page.evaluate(() => window.IAQAR?.homeTabs?.switchTo?.("opportunities"));
  await page.waitForTimeout(600);
  const bankSub = page.locator("#oppTabBank:visible, button:visible:has-text('القائمة')").first();
  if (await bankSub.count()) await bankSub.click();
  await page.waitForTimeout(1200);
}

async function installEventBridge(page) {
  await page.evaluate(() => {
    window.__qaFreshLineageBridge = { openRequests: [], workflowActions: [] };
    window.addEventListener("iaqar:open-operation", (event) => {
      window.__qaFreshLineageBridge.openRequests.push({ ...(event.detail || {}) });
    });
    window.addEventListener("iaqar:workflow-action", (event) => {
      window.__qaFreshLineageBridge.workflowActions.push({ ...(event.detail || {}) });
    });
  });
}

async function selectMatchesFilter(page) {
  const filter = page.locator('[data-bank-action-filter="matches"]').first();
  await filter.waitFor({ state: "visible", timeout: 30000 });
  if (await filter.getAttribute("aria-pressed") !== "true") await filter.click();
  await page.waitForFunction(() => document.querySelector('[data-bank-action-filter="matches"]')?.getAttribute("aria-pressed") === "true", null, { timeout: 10000 });
}

async function inspectFreshCard(page, side, opportunityId, matchId, operationId) {
  const card = page.locator(`[data-cv2-inbox-item][data-opportunity-id="${opportunityId}"]:visible`).first();
  await card.waitFor({ state: "visible", timeout: 30000 });
  const action = card.locator(`[data-opportunity-primary-action="review_match"][data-match-id="${matchId}"]`).first();
  await action.waitFor({ state: "visible", timeout: 30000 });
  const actual = await action.evaluate((button) => ({
    matchId: button.getAttribute("data-match-id") || "",
    operationId: button.getAttribute("data-operation-id") || "",
    action: button.getAttribute("data-opportunity-primary-action") || ""
  }));
  if (actual.matchId !== matchId || actual.operationId !== operationId || actual.action !== "review_match") {
    throw new Error(`${side} Bank card linkage mismatch ${JSON.stringify({ opportunityId, expected: { matchId, operationId }, actual })}`);
  }
  return { side, opportunityId, ...actual };
}

async function clickFreshMatch(page, target) {
  const card = page.locator(`[data-cv2-inbox-item][data-opportunity-id="${target.opportunityId}"]:visible`).first();
  const action = card.locator(`[data-opportunity-primary-action="review_match"][data-match-id="${target.matchId}"]`).first();
  await action.click();
  await page.waitForFunction(() => window.__qaFreshLineageBridge?.openRequests?.length > 0, null, { timeout: 7000 });
  await page.waitForFunction(() => window.__qaFreshLineageBridge?.workflowActions?.length > 0, null, { timeout: 15000 });
  const overlay = page.locator("#iaqarWorkflowOverlay:not([hidden])");
  await overlay.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(() => {
    const body = document.getElementById("iaqarWorkflowBody");
    return body && !body.textContent.includes("جارٍ تحميل بيانات العميل والمالك");
  }, null, { timeout: 15000 });
  const events = await page.evaluate(() => ({
    openRequest: window.__qaFreshLineageBridge?.openRequests?.at(-1) || {},
    workflowAction: window.__qaFreshLineageBridge?.workflowActions?.at(-1) || {},
    opportunityDetailsVisible: Boolean(document.querySelector('#contentV2[data-content-view="opportunity"]:not([hidden])')),
    workflowVisible: Boolean(document.querySelector("#iaqarWorkflowOverlay:not([hidden])"))
  }));
  const ok = String(events.openRequest.opportunityId || "") === target.opportunityId
    && String(events.openRequest.matchId || "") === target.matchId
    && String(events.openRequest.operationId || "") === target.operationId
    && String(events.workflowAction.recordType || "") === "match"
    && String(events.workflowAction.recordId || "") === target.matchId
    && String(events.workflowAction.matchId || "") === target.matchId
    && events.workflowVisible && !events.opportunityDetailsVisible;
  if (!ok) throw new Error(`${target.side} CTA opened wrong record ${JSON.stringify({ target, events })}`);
  await page.goBack();
  await overlay.waitFor({ state: "hidden", timeout: 10000 });
  await selectMatchesFilter(page);
  return { side: target.side, exactMatchOpened: true };
}

async function verifyFreshBank(browser, customToken, matchId, operationId) {
  const context = await browser.newContext({ locale: "ar-SA", viewport: { width: 390, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`${STAGING_URL}/?env=staging&officeId=${encodeURIComponent(OFFICE_ID)}&contentV2=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForFunction(() => window.firebase?.apps?.length > 0, { timeout: 30000 });
    await page.evaluate(async ({ token, officeId }) => {
      await window.firebase.auth().signInWithCustomToken(token);
      localStorage.setItem("iaqar.officeId", officeId);
      localStorage.setItem("iaqar_active_office_id", officeId);
    }, { token: customToken, officeId: OFFICE_ID });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await openBankTab(page);
    await selectMatchesFilter(page);
    await installEventBridge(page);

    const requestBefore = await inspectFreshCard(page, "request", REQUEST_ID, matchId, operationId);
    const offerBefore = await inspectFreshCard(page, "offer", OFFER_ID, matchId, operationId);
    const requestOpen = await clickFreshMatch(page, requestBefore);
    await installEventBridge(page);
    const offerOpen = await clickFreshMatch(page, offerBefore);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await openBankTab(page);
    await selectMatchesFilter(page);
    const requestAfter = await inspectFreshCard(page, "request", REQUEST_ID, matchId, operationId);
    const offerAfter = await inspectFreshCard(page, "offer", OFFER_ID, matchId, operationId);
    await page.screenshot({ path: path.join(OUT, "fresh-lineage-bank-after-refresh.png"), fullPage: true });
    return { requestBefore, offerBefore, requestOpen, offerOpen, requestAfter, offerAfter, refreshPreserved: true };
  } finally {
    await context.close().catch(() => {});
  }
}

async function mint(idToken, party, matchId) {
  const response = await fetch(`${STAGING_WORKER}/party/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ officeId: OFFICE_ID, party, matchId, requestId: REQUEST_ID, offerId: OFFER_ID })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok || !body.token) throw new Error(`${party} mint failed ${response.status} ${JSON.stringify(body)}`);
  return { status: response.status, ...body };
}

async function readPublic(token) {
  const response = await fetch(`${STAGING_WORKER}/party/sessions/${encodeURIComponent(token)}`, { headers: { Accept: "application/json" }, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok || !body.view) throw new Error(`party read failed ${response.status}`);
  return body.view;
}

async function visible(locator) {
  return (await locator.count()) > 0 && await locator.first().isVisible().catch(() => false);
}

async function currentUiState(page) {
  const recorded = page.locator("[data-testid='party-bundle-recorded'], .party-recorded");
  const form = page.locator("[data-party-decision-package]").first();
  const terminal = await visible(recorded);
  const hasForm = await visible(form);
  const workflowStep = hasForm ? String(await form.getAttribute("data-workflow-step") || "") : "";
  return { terminal, hasForm, workflowStep };
}

async function waitPartyReady(page) {
  await page.waitForFunction(() => {
    const candidates = [document.querySelector("[data-party-decision-package]"), document.querySelector("[data-party-error]"), document.querySelector("[data-testid='party-bundle-recorded']"), document.querySelector(".party-recorded")].filter(Boolean);
    return candidates.some((node) => {
      const style = window.getComputedStyle(node); const rect = node.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    });
  }, null, { timeout: 60000 });
  const error = page.locator("[data-party-error]").first();
  if (await visible(error)) throw new Error(`party UI error: ${(await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 800)}`);
  return currentUiState(page);
}

async function assertButtonsOnly(page) {
  const manual = await page.locator("[data-party-decision-package] input[type='text'], [data-party-decision-package] input[type='number'], [data-party-decision-package] textarea").count();
  if (manual) throw new Error(`manual text/number inputs exposed: ${manual}`);
}

async function chooseFirstVisible(page, selector) {
  const rows = page.locator(selector);
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    if (await row.isVisible().catch(() => false)) { await row.check(); return true; }
  }
  return false;
}

async function chooseAllOwnerDetails(page) {
  const groups = page.locator("[data-owner-detail]");
  for (let index = 0; index < await groups.count(); index += 1) {
    const group = groups.nth(index);
    if (!(await group.isVisible().catch(() => false))) continue;
    const confirm = group.locator('input[data-package-field^="detailStatus_"][value="confirm"]');
    const needsUpdate = group.locator('input[data-package-field^="detailStatus_"][value="needs_update"]');
    if (await visible(confirm)) await confirm.check(); else if (await visible(needsUpdate)) await needsUpdate.check();
  }
}

async function submitBundle(page, label) {
  const before = await currentUiState(page);
  const button = page.locator("[data-party-bundle-submit]").first();
  if (!(await visible(button))) throw new Error(`${label}: submit button missing step=${before.workflowStep || "initial"}`);
  const waiter = page.waitForResponse((res) => /\/party\/sessions\/.+\/bundle$/.test(res.url()) && res.request().method() === "POST", { timeout: 45000 });
  await button.click();
  const response = await waiter;
  const body = await response.json().catch(() => ({}));
  if (!response.ok() || !body.ok) throw new Error(`${label}: bundle submit failed ${response.status()} ${JSON.stringify(body)}`);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  const after = await waitPartyReady(page); await assertButtonsOnly(page);
  return { status: response.status(), before, after };
}

async function clientJourney(browser, token) {
  const context = await browser.newContext({ locale: "ar-SA", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const transitions = [];
  try {
    await page.goto(`${STAGING_URL}/?cv2Party=${encodeURIComponent(token)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    let state = await waitPartyReady(page); await assertButtonsOnly(page);
    for (let attempt = 0; attempt < 3 && !state.terminal; attempt += 1) {
      if (!state.hasForm) throw new Error(`client form missing step=${state.workflowStep || "initial"}`);
      if (state.workflowStep === "client_viewing") {
        if (!(await chooseFirstVisible(page, 'input[data-package-field="viewingDays"]'))) throw new Error("client viewing day missing");
        if (!(await chooseFirstVisible(page, 'input[data-package-field="viewingPeriods"]'))) throw new Error("client viewing period missing");
      } else if (state.workflowStep === "client_price_response") {
        const viewing = page.locator('input[data-package-field="negotiationResponse"][value="viewing"]');
        if (!(await visible(viewing))) throw new Error("client price-response viewing choice missing");
        await viewing.check(); await page.waitForTimeout(100);
        await chooseFirstVisible(page, 'input[data-package-field="viewingDays"]');
        await chooseFirstVisible(page, 'input[data-package-field="viewingPeriods"]');
      } else {
        const viewing = page.locator('input[data-package-field="clientDecision"][value="viewing"]');
        if (!(await visible(viewing))) throw new Error(`client viewing decision missing step=${state.workflowStep || "initial"}`);
        await viewing.check(); await page.waitForTimeout(100);
        if (!(await chooseFirstVisible(page, 'input[data-package-field="viewingDays"]'))) throw new Error("client viewing day missing");
        if (!(await chooseFirstVisible(page, 'input[data-package-field="viewingPeriods"]'))) throw new Error("client viewing period missing");
      }
      const result = await submitBundle(page, `client-${attempt + 1}`); transitions.push(result); state = result.after;
    }
    if (!state.terminal) throw new Error(`client journey did not reach recorded state; step=${state.workflowStep || "unknown"}`);
    const tokenStayed = new URL(page.url()).searchParams.get("cv2Party") === token;
    await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 }); await waitPartyReady(page);
    return { submitStatus: transitions.at(-1)?.status || 0, persisted: true, tokenStayed, reloaded: true, workflowSteps: transitions.map((row) => row.before.workflowStep || "initial") };
  } finally { await context.close().catch(() => {}); }
}

async function ownerJourney(browser, token) {
  const context = await browser.newContext({ locale: "ar-SA", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const transitions = [];
  try {
    await page.goto(`${STAGING_URL}/?cv2Party=${encodeURIComponent(token)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    let state = await waitPartyReady(page); await assertButtonsOnly(page);
    for (let attempt = 0; attempt < 5 && !state.terminal; attempt += 1) {
      if (!state.hasForm) throw new Error(`owner form missing step=${state.workflowStep || "initial"}`);
      const step = state.workflowStep || "owner_initial";
      if (step === "owner_details") await chooseAllOwnerDetails(page);
      else if (step === "owner_price") {
        const picked = await chooseFirstVisible(page, 'input[data-package-field="ownerPriceDecision"][value="accept_discount"]') || await chooseFirstVisible(page, 'input[data-package-field="ownerPriceDecision"][value="fixed"]') || await chooseFirstVisible(page, 'input[data-package-field="ownerPriceDecision"]');
        if (!picked) throw new Error("owner price decision missing");
      } else if (step === "owner_viewing") {
        const viewing = page.locator('input[data-package-field="viewingAllowed"][value="yes"]');
        if (!(await visible(viewing))) throw new Error("owner viewing decision missing");
        await viewing.check(); await page.waitForTimeout(100);
        if (!(await chooseFirstVisible(page, 'input[data-package-field="viewingDays"]'))) throw new Error("owner viewing day missing");
        if (!(await chooseFirstVisible(page, 'input[data-package-field="viewingPeriods"]'))) throw new Error("owner viewing period missing");
      } else {
        await chooseAllOwnerDetails(page);
        const hasPrice = await chooseFirstVisible(page, 'input[data-package-field="ownerPriceDecision"][value="confirmed"]') || await chooseFirstVisible(page, 'input[data-package-field="ownerPriceDecision"][value="fixed"]');
        if (!hasPrice) {
          const viewing = page.locator('input[data-package-field="viewingAllowed"][value="yes"]');
          if (await visible(viewing)) { await viewing.check(); await page.waitForTimeout(100); await chooseFirstVisible(page, 'input[data-package-field="viewingDays"]'); await chooseFirstVisible(page, 'input[data-package-field="viewingPeriods"]'); }
        }
      }
      const result = await submitBundle(page, `owner-${attempt + 1}-${step}`); transitions.push(result); state = result.after;
    }
    if (!state.terminal) throw new Error(`owner journey did not reach recorded state; step=${state.workflowStep || "unknown"}`);
    const tokenStayed = new URL(page.url()).searchParams.get("cv2Party") === token;
    await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 }); await waitPartyReady(page);
    return { submitStatus: transitions.at(-1)?.status || 0, persisted: true, tokenStayed, reloaded: true, workflowSteps: transitions.map((row) => row.before.workflowStep || "owner_initial") };
  } finally { await context.close().catch(() => {}); }
}

async function waitOwnerNeeded(matchId) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const data = (await office.collection("matches").doc(matchId).get()).data() || {};
    const needed = data.ownerContactNeeded === true || String(data.ownerContactNeeded || "").toLowerCase() === "true";
    if (needed) return { ownerContactNeeded: true, livingStage: String(data.livingStage || "") };
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  const data = (await office.collection("matches").doc(matchId).get()).data() || {};
  return { ownerContactNeeded: false, livingStage: String(data.livingStage || "") };
}

async function persistedSessions(matchId) {
  const snap = await office.collection("partySessions").where("matchId", "==", matchId).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

async function lineageState(matchId) {
  const [matchSnap, operationSnap, coordinationSnap] = await Promise.all([
    office.collection("matches").doc(matchId).get(),
    office.collection("operations").where("matchId", "==", matchId).limit(10).get(),
    office.collection("coordinationSessions").doc(matchId).get()
  ]);
  const match = matchSnap.data() || {};
  const operationDoc = operationSnap.docs.find((doc) => String(doc.data()?.operationType || doc.data()?.type || "").toUpperCase() === "MATCH_REVIEW");
  const operation = operationDoc?.data() || {};
  const coordinationDoc = coordinationSnap.data() || {};
  let coordination = coordinationDoc;
  if (coordinationDoc.coordinationJson) { try { coordination = JSON.parse(String(coordinationDoc.coordinationJson)); } catch { coordination = coordinationDoc; } }
  const ids = canonicalIds(match);
  return {
    matchId: String(match.matchId || matchSnap.id || ""), requestId: ids.requestId, offerId: ids.offerId,
    livingStage: String(match.livingStage || ""), operationId: operationDoc?.id || "",
    operationStatus: String(operation.status || ""), operationLivingStage: String(operation.livingStage || ""),
    coordinationExists: coordinationSnap.exists, coordinationSessionId: coordinationSnap.exists ? coordinationSnap.id : "",
    coordinationMatchId: String(coordination.matchId || ""), clientSessionId: String(coordination.clientSessionId || ""), ownerSessionId: String(coordination.ownerSessionId || "")
  };
}

async function cleanup() {
  if (activeMatchId) {
    for (const name of ["partySessions", "partySessionKeys", "operations", "notifications"]) {
      const snap = await office.collection(name).where("matchId", "==", activeMatchId).limit(100).get().catch(() => ({ docs: [] }));
      await Promise.all(snap.docs.map((doc) => doc.ref.delete().catch(() => {})));
    }
    await office.collection("coordinationSessions").doc(activeMatchId).delete().catch(() => {});
    await office.collection("matches").doc(activeMatchId).delete().catch(() => {});
  }
  await office.collection("opportunities").doc(REQUEST_ID).delete().catch(() => {});
  await office.collection("opportunities").doc(OFFER_ID).delete().catch(() => {});
}

async function main() {
  let browser;
  try {
    markStage("seed-fresh-pair");
    const uid = await ensureQaOffice();
    await persistPair();
    const auth = await authTokens(uid);

    markStage("run-live-matching");
    const matching = await runMatching(auth.idToken);
    const initial = await waitForMatchReview(matching.matchId);
    if (initial.requestId !== REQUEST_ID || initial.offerId !== OFFER_ID || !initial.operationId) throw new Error(`canonical Match/MATCH_REVIEW linkage failed ${JSON.stringify(initial)}`);

    browser = await chromium.launch({ headless: true });
    markStage("verify-bank-both-sides-and-cta");
    const bank = await verifyFreshBank(browser, auth.customToken, matching.matchId, initial.operationId);

    markStage("client-session-and-response");
    const client1 = await mint(auth.idToken, "client", matching.matchId);
    const client2 = await mint(auth.idToken, "client", matching.matchId);
    if (client1.token !== client2.token || client2.reused !== true) throw new Error("client token not idempotent");
    const afterClientSend = await lineageState(matching.matchId);
    if (afterClientSend.matchId !== matching.matchId || afterClientSend.requestId !== REQUEST_ID || afterClientSend.offerId !== OFFER_ID) throw new Error(`identity drift before client response ${JSON.stringify(afterClientSend)}`);
    const clientUi = await clientJourney(browser, client1.token);
    const clientView = await readPublic(client1.token);
    const afterClient = await waitOwnerNeeded(matching.matchId);
    if (!afterClient.ownerContactNeeded) throw new Error(`owner contact not requested after client response stage=${afterClient.livingStage}`);

    markStage("owner-session-and-negotiation");
    const owner1 = await mint(auth.idToken, "owner", matching.matchId);
    const owner2 = await mint(auth.idToken, "owner", matching.matchId);
    if (owner1.token !== owner2.token || owner2.reused !== true) throw new Error("owner token not idempotent");
    const negotiation = await lineageState(matching.matchId);
    if (negotiation.matchId !== matching.matchId
      || negotiation.requestId !== REQUEST_ID || negotiation.offerId !== OFFER_ID
      || negotiation.operationId !== initial.operationId
      || negotiation.livingStage !== "NEGOTIATION" || negotiation.operationLivingStage !== "NEGOTIATION"
      || !negotiation.coordinationExists || negotiation.coordinationSessionId !== matching.matchId
      || negotiation.coordinationMatchId !== matching.matchId
      || !negotiation.clientSessionId || !negotiation.ownerSessionId) {
      throw new Error(`same-match negotiation handoff failed ${JSON.stringify(negotiation)}`);
    }

    markStage("owner-response-and-reload");
    const ownerUi = await ownerJourney(browser, owner1.token);
    const ownerView = await readPublic(owner1.token);
    const finalState = await lineageState(matching.matchId);
    const sessions = await persistedSessions(matching.matchId);
    const clientSubmitted = Boolean(clientView?.decisionPackage?.submitted || clientView?.replied);
    const ownerSubmitted = Boolean(ownerView?.decisionPackage?.submitted || ownerView?.replied);
    const parties = new Set(sessions.map((row) => String(row.party || "")).filter(Boolean));
    const tokens = new Set(sessions.map((row) => String(row.token || "")).filter(Boolean));

    const verified = Boolean(
      bank.refreshPreserved
      && clientUi.submitStatus >= 200 && clientUi.submitStatus < 300 && clientUi.persisted && clientUi.tokenStayed && clientUi.reloaded && clientSubmitted
      && ownerUi.submitStatus >= 200 && ownerUi.submitStatus < 300 && ownerUi.persisted && ownerUi.tokenStayed && ownerUi.reloaded && ownerSubmitted
      && sessions.length === 2 && tokens.size === 2 && parties.has("client") && parties.has("owner")
      && finalState.matchId === matching.matchId && finalState.requestId === REQUEST_ID && finalState.offerId === OFFER_ID
      && finalState.operationId === initial.operationId
      && finalState.coordinationExists && finalState.coordinationSessionId === matching.matchId && finalState.coordinationMatchId === matching.matchId
    );

    const report = {
      generatedAt: new Date().toISOString(), runId: RUN_ID, officeId: OFFICE_ID,
      requestId: REQUEST_ID, offerId: OFFER_ID, matchId: matching.matchId, operationId: initial.operationId,
      coordinationSessionId: finalState.coordinationSessionId,
      matchingStatus: matching.status, initial, bank, afterClientSend, afterClient, negotiation,
      client: { ...clientUi, publicSubmitted: clientSubmitted }, owner: { ...ownerUi, publicSubmitted: ownerSubmitted },
      finalState, sessionCount: sessions.length, partyCount: parties.size, stableTokenCount: tokens.size, verified
    };
    writeFileSync(path.join(OUT, "staging-fresh-match-lineage-report.json"), JSON.stringify(report, null, 2));
    console.log("STAGING_FRESH_MATCH_LINEAGE_REPORT", JSON.stringify(report, null, 2));
    if (!verified) throw new Error("STAGING FRESH MATCH LINEAGE NOT VERIFIED");
    markStage("verified");
    console.log("STAGING FRESH MATCH LINEAGE VERIFIED — ONE MATCHID END TO END");
  } catch (error) {
    writeFileSync(path.join(OUT, "staging-fresh-match-lineage-failure.json"), JSON.stringify({
      generatedAt: new Date().toISOString(), stage: currentStage, runId: RUN_ID, officeId: OFFICE_ID,
      requestId: REQUEST_ID, offerId: OFFER_ID, matchId: activeMatchId, message: error?.message || String(error), stack: error?.stack || ""
    }, null, 2));
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await cleanup().catch((error) => console.warn("fresh lineage cleanup failed", error.message));
    await app.delete().catch(() => {});
  }
}

main().catch((error) => {
  console.error("STAGING_FRESH_MATCH_LINEAGE_FAILED", error);
  process.exit(1);
});
