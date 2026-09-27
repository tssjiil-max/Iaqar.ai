#!/usr/bin/env node
/**
 * Staging E2E: Bank operational actions stay inside the opportunity workspace.
 * The retired legacy "إدارة الفرصة" overlay must never open.
 *
 * Self-contained: every record this verifier reads is created by this run inside
 * the dedicated QA office, tagged with its testRunId, and removed in `finally`.
 * It never signs in as a real account, never touches loginDirectory, and never
 * reads or writes any office other than QA_OFFICE_ID.
 */
import { chromium } from "playwright";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import * as admin from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";
import {
  QA_OFFICE_ID as SHARED_QA_OFFICE_ID,
  assertStagingServiceAccount,
  ensureQaOfficeMember,
  qaRunUid,
  removeQaIdentity,
  signInQaUser
} from "./staging-qa-identity.mjs";

const PROJECT_ID = "iaqar-ai-staging";
const QA_OFFICE_ID = SHARED_QA_OFFICE_ID;
const QA_OFFICE_PATH = `offices/${QA_OFFICE_ID}`;
const STAGING = process.env.STAGING_HOSTING_URL
  || "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const STAGING_WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const OUT = process.env.SCREENSHOT_DIR || "/opt/cursor/artifacts";
const KEEP_FIXTURES = process.argv.includes("--keep") || process.env.KEEP_FIXTURES === "1";
const COMMIT_SHA = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const RUN_ID = `bankqa_${Date.now().toString(36)}`;
const REQUEST_ID = `opp_${RUN_ID}_req`;
const OFFER_A_ID = `opp_${RUN_ID}_offer_a`;
const OFFER_B_ID = `opp_${RUN_ID}_offer_b`;
const RUN_OPPORTUNITY_IDS = [REQUEST_ID, OFFER_A_ID, OFFER_B_ID];
const QA_UID = qaRunUid("bank", RUN_ID);
let currentStage = "startup";

// ---------------------------------------------------------------------------
// Guards: Staging project + dedicated QA office only.
// ---------------------------------------------------------------------------
function refuse(reason) {
  throw new Error(`BANK_QA_GUARD_REFUSED: ${reason}`);
}

if (!new URL(STAGING).hostname.startsWith(`${PROJECT_ID}--`)) {
  refuse(`hosting URL is not an ${PROJECT_ID} channel: ${STAGING}`);
}
const parsedSa = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsedSa.serviceAccount) refuse("FIREBASE_SERVICE_ACCOUNT_JSON missing or invalid");
assertStagingServiceAccount(parsedSa.serviceAccount);
const app = admin.initializeApp({ credential: admin.cert(parsedSa.serviceAccount), projectId: PROJECT_ID });
const db = getFirestore(app);
const auth = getAuth(app);
const office = db.collection("offices").doc(QA_OFFICE_ID);

function assertQaPath(ref) {
  const refPath = String(ref?.path || "");
  if (!refPath.startsWith(`${QA_OFFICE_PATH}/`)) refuse(`path outside ${QA_OFFICE_PATH}: ${refPath}`);
}

async function tagRunDoc(ref) {
  assertQaPath(ref);
  await ref.set({ testRunId: RUN_ID, isTestFixture: true, createdBy: "E2E" }, { merge: true });
}

async function deleteRunDoc(ref) {
  assertQaPath(ref);
  const snap = await ref.get();
  if (!snap.exists) return false;
  if ((snap.data() || {}).testRunId !== RUN_ID) {
    refuse(`document does not belong to ${RUN_ID}: ${ref.path}`);
  }
  await db.recursiveDelete(ref);
  return true;
}

function markStage(stage) {
  currentStage = stage;
  console.log(`BANK_CARD_CLICK_VERIFY_STAGE ${stage}`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function fixtureStamp() {
  // `area` is deliberately absent: it is OPTIONAL for completeness and matching.
  return {
    officeId: QA_OFFICE_ID,
    lifecycleStatus: "ACTIVE",
    status: "active",
    matchingReadiness: "READY_FOR_MATCHING",
    dataCompleteness: 100,
    completeness: 100,
    city: "المدينة المنورة",
    district: "العزيزية",
    propertyType: "شقة",
    version: 1,
    isTestFixture: true,
    testRunId: RUN_ID,
    createdBy: "E2E",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };
}

async function ensureQaOfficeAndMembership() {
  await ensureQaOfficeMember({ db, FieldValue, runId: RUN_ID, uid: QA_UID });
}

async function persistFixtures() {
  const opportunities = office.collection("opportunities");
  const request = opportunities.doc(REQUEST_ID);
  const offerA = opportunities.doc(OFFER_A_ID);
  const offerB = opportunities.doc(OFFER_B_ID);
  [request, offerA, offerB].forEach(assertQaPath);
  await request.set({
    ...fixtureStamp(),
    opportunityKind: "REQUEST",
    kind: "client_request",
    purpose: "PURCHASE",
    advertiserRole: "CLIENT",
    budget: 900000,
    priceOrBudget: 900000,
    priceMax: 900000,
    contactPhone: "0501119301",
    advertiserPhoneNormalized: "+966501119301",
    contactName: `عميل QA ${RUN_ID}`
  });
  await offerA.set({
    ...fixtureStamp(),
    opportunityKind: "OFFER",
    kind: "owner_offer",
    purpose: "SALE",
    advertiserRole: "OWNER",
    salePrice: 895000,
    priceOrBudget: 895000,
    contactPhone: "0501119302",
    advertiserPhoneNormalized: "+966501119302",
    contactName: `مالك QA أ ${RUN_ID}`
  });
  // A second, weaker offer gives the request a genuinely different Match to open.
  await offerB.set({
    ...fixtureStamp(),
    opportunityKind: "OFFER",
    kind: "owner_offer",
    purpose: "SALE",
    advertiserRole: "OWNER",
    salePrice: 840000,
    priceOrBudget: 840000,
    contactPhone: "0501119303",
    advertiserPhoneNormalized: "+966501119303",
    contactName: `مالك QA ب ${RUN_ID}`
  });
  const snaps = await Promise.all([request.get(), offerA.get(), offerB.get()]);
  if (!snaps.every((snap) => snap.exists)) throw new Error("fixture persist confirmation failed");
  if (snaps.some((snap) => "area" in (snap.data() || {}))) throw new Error("fixtures must not carry area");
}

async function createQaSession() {
  const { customToken, idToken } = await signInQaUser({ auth, stagingUrl: STAGING, uid: QA_UID });
  return { customToken, idToken };
}

async function runMatching(idToken) {
  const response = await fetch(`${STAGING_WORKER}/matching/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ officeId: QA_OFFICE_ID, opportunityId: REQUEST_ID, notify: false })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (String(body.error || "").includes("pilot")) {
      throw new Error(`matching blocked by pilot access for ${QA_OFFICE_ID} (${body.error}); platform pilot config is not changed by this verifier`);
    }
    throw new Error(`matching failed ${response.status} ${JSON.stringify(body)}`);
  }
  const rows = (Array.isArray(body.matches) ? body.matches : [])
    .filter((row) => (row.requestId || row.clientRequestId) === REQUEST_ID
      && [OFFER_A_ID, OFFER_B_ID].includes(row.offerId || row.ownerOfferId));
  const matches = rows.map((row) => ({
    matchId: String(row.matchId || ""),
    operationId: String(row.operationId || ""),
    offerId: String(row.offerId || row.ownerOfferId || "")
  }));
  if (matches.length !== 2 || matches.some((m) => !m.matchId || !m.operationId)) {
    throw new Error(`expected two QA matches with MATCH_REVIEW operations: ${JSON.stringify(body)}`);
  }
  for (const match of matches) {
    await tagRunDoc(office.collection("matches").doc(match.matchId));
    await tagRunDoc(office.collection("operations").doc(match.operationId));
    const op = (await office.collection("operations").doc(match.operationId).get()).data() || {};
    if (op.type !== "MATCH_REVIEW" || op.matchId !== match.matchId || op.status !== "OPEN") {
      throw new Error(`MATCH_REVIEW not persisted for ${match.matchId}: ${JSON.stringify({ type: op.type, status: op.status })}`);
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Cleanup: only documents of this run, only inside the QA office.
// ---------------------------------------------------------------------------
async function cleanup(matches = []) {
  const deleted = {};
  const matchIds = matches.map((m) => m.matchId).filter(Boolean);
  const operationIds = matches.map((m) => m.operationId).filter(Boolean);
  const count = (name, done) => { if (done) deleted[name] = (deleted[name] || 0) + 1; };

  // Worker-created documents linked to this run's opportunities/matches get this
  // run's testRunId first, so every delete below is a testRunId-scoped delete.
  const linked = [
    ["matches", "requestId", RUN_OPPORTUNITY_IDS],
    ["matches", "offerId", RUN_OPPORTUNITY_IDS],
    ["operations", "opportunityId", RUN_OPPORTUNITY_IDS],
    ["operations", "matchId", matchIds],
    ["notifications", "matchId", matchIds],
    ["notifications", "operationId", operationIds],
    ["matchCurrentPointers", "currentMatchId", matchIds]
  ];
  for (const [name, field, values] of linked) {
    if (!values.length) continue;
    const snap = await office.collection(name).where(field, "in", values).get();
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      if (data.testRunId && data.testRunId !== RUN_ID) continue;
      await tagRunDoc(doc.ref);
    }
  }
  for (const name of ["matches", "operations", "notifications", "matchCurrentPointers", "opportunities"]) {
    const snap = await office.collection(name).where("testRunId", "==", RUN_ID).get();
    for (const doc of snap.docs) count(name, await deleteRunDoc(doc.ref));
  }
  const identity = await removeQaIdentity({ db, auth, runId: RUN_ID, uid: QA_UID });
  count("members", identity.member);
  count("authUsers", identity.authUser);
  console.log("BANK_QA_CLEANUP", JSON.stringify({ runId: RUN_ID, office: QA_OFFICE_PATH, deleted }));
  return deleted;
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
async function signInBrowser(page, customToken) {
  await page.goto(`${STAGING}/?env=staging&officeId=${encodeURIComponent(QA_OFFICE_ID)}&contentV2=1`, {
    waitUntil: "domcontentloaded",
    timeout: 90000
  });
  await page.waitForFunction(() => window.firebase?.apps?.length > 0, { timeout: 30000 });
  await page.evaluate(async ({ token, officeId }) => {
    await window.firebase.auth().signInWithCustomToken(token);
    localStorage.setItem("iaqar.officeId", officeId);
  }, { token: customToken, officeId: QA_OFFICE_ID });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(5000);
}

async function openBankTab(page) {
  const bankTab = page.locator("#mainTabOpportunities:visible, button:visible:has-text('العروض والطلبات')").first();
  if (await bankTab.count()) {
    await bankTab.click();
  } else {
    await page.evaluate(() => {
      if (/^#\/opportunities(?:-v2)?\//.test(String(location.hash || ""))) {
        history.replaceState(history.state, "", `${location.pathname}${location.search}`);
      }
      window.IAQAR?.homeTabs?.switchTo?.("opportunities");
      window.IAQAR?.openOpportunityBank?.();
    });
  }
  await page.waitForTimeout(500);
  // A new office sees the platform onboarding modal, which covers the tabs.
  // Dismiss it through its own button, exactly as a broker would.
  const onboarding = page.locator("#platformOpportunityOnboarding");
  if (await onboarding.isVisible()) {
    await page.locator("#platformOnboardingAckBtn").click();
    await onboarding.waitFor({ state: "hidden", timeout: 10000 });
  }
  const bankSub = page.locator("#oppTabBank");
  await bankSub.waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => {
    const tab = document.getElementById("oppTabBank");
    return Boolean(tab) && !tab.disabled;
  }, null, { timeout: 30000 });
  await bankSub.click();
  await page.waitForFunction(() => {
    const tab = document.getElementById("oppTabBank");
    const panel = document.getElementById("oppPanelBank");
    return tab?.getAttribute("aria-selected") === "true"
      && Boolean(panel) && !panel.hidden && panel.getClientRects().length > 0;
  }, null, { timeout: 30000 });
}

async function installEventBridge(page) {
  await page.evaluate(() => {
    window.__qaBankOperationalBridge = { openRequests: [], workflowActions: [] };
    window.addEventListener("iaqar:open-operation", (event) => {
      window.__qaBankOperationalBridge.openRequests.push({ ...(event.detail || {}) });
    });
    window.addEventListener("iaqar:workflow-action", (event) => {
      window.__qaBankOperationalBridge.workflowActions.push({ ...(event.detail || {}) });
    });
  });
}

async function readCardMatchId(page, opportunityId) {
  const action = page.locator(
    `[data-cv2-inbox-item][data-opportunity-id="${opportunityId}"]:visible [data-opportunity-primary-action="review_match"][data-match-id]`
  ).first();
  await action.waitFor({ state: "visible", timeout: 45000 });
  return String(await action.getAttribute("data-match-id") || "");
}

async function inspectTargetCard(page, target) {
  const allCards = page.locator(`[data-cv2-inbox-item][data-opportunity-id="${target.opportunityId}"]`);
  await allCards.first().waitFor({ state: "attached", timeout: 45000 });
  const card = page.locator(`[data-cv2-inbox-item][data-opportunity-id="${target.opportunityId}"]:visible`).first();
  if (!await card.count()) {
    const hiddenTrace = await allCards.first().evaluate((node) => {
      const trace = [];
      for (let current = node; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        trace.push({ tag: current.tagName, id: current.id, className: current.className, hidden: current.hidden, display: style.display, visibility: style.visibility });
      }
      return trace;
    });
    throw new Error(`Target Bank card is hidden for ${target.reference}: ${JSON.stringify(hiddenTrace)}`);
  }
  const action = card.locator(`[data-opportunity-primary-action="review_match"][data-match-id="${target.matchId}"]`).first();
  await action.waitFor({ state: "visible", timeout: 30000 });
  return action.evaluate((button, expected) => {
    const article = button.closest("[data-cv2-inbox-item][data-opportunity-id]");
    return {
      ...expected,
      statusLine: article?.querySelector(".cv2-card-meta")?.textContent?.trim()
        || article?.textContent?.trim() || "",
      actionCode: button.getAttribute("data-opportunity-primary-action") || "",
      operationId: button.getAttribute("data-operation-id") || "",
      matchId: button.getAttribute("data-match-id") || ""
    };
  }, target);
}

async function clickAndVerify(page, target) {
  const card = page.locator(`[data-cv2-inbox-item][data-opportunity-id="${target.opportunityId}"]:visible`).first();
  const action = card.locator(`[data-opportunity-primary-action="review_match"][data-match-id="${target.matchId}"]`).first();
  await action.click();
  await page.waitForFunction((opportunityId) => {
    const detailsVisible = Boolean(document.querySelector('#contentV2[data-content-view="opportunity"]:not([hidden])'));
    return detailsVisible && String(location.hash || "").includes(opportunityId);
  }, target.opportunityId, { timeout: 15000 });
  await page.waitForTimeout(300);

  const events = await page.evaluate(() => ({
    openRequests: window.__qaBankOperationalBridge?.openRequests || [],
    workflowActions: window.__qaBankOperationalBridge?.workflowActions || [],
    opportunityDetailsVisible: Boolean(document.querySelector('#contentV2[data-content-view="opportunity"]:not([hidden])')),
    workflowVisible: Boolean(document.querySelector("#iaqarWorkflowOverlay:not([hidden])")),
    workflowTitle: document.getElementById("iaqarWorkflowTitle")?.textContent?.trim() || "",
    hash: String(location.hash || "")
  }));
  const ok = events.opportunityDetailsVisible
    && events.hash.includes(target.opportunityId)
    && !events.workflowVisible
    && events.workflowTitle !== "إدارة الفرصة"
    && events.openRequests.length === 0
    && events.workflowActions.length === 0;
  if (!ok) throw new Error(`Legacy opportunity manager opened from ${target.reference}: ${JSON.stringify({ target, events })}`);

  await openBankTab(page);
  await page.locator(`[data-cv2-inbox-item][data-opportunity-id="${target.opportunityId}"]:visible`).first().waitFor({ state: "visible", timeout: 10000 });
  return { ...events, returnedToBank: true };
}

function assertReflected(target, targetMatch, label) {
  if (target.matchId !== targetMatch.matchId
    || target.operationId !== targetMatch.operationId
    || target.statusLine.includes("قيد المطابقة")) {
    throw new Error(`${label} on ${target.reference}: ${JSON.stringify({ target, expected: targetMatch })}`);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  let matches = [];
  let browser = null;
  let failure = null;
  try {
    markStage("seed-fixtures");
    await ensureQaOfficeAndMembership();
    await persistFixtures();
    markStage("qa-session");
    const session = await createQaSession();
    markStage("run-matching");
    matches = await runMatching(session.idToken);

    markStage("launch-browser");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: "ar-SA" });
    const page = await context.newPage();
    markStage("login");
    await signInBrowser(page, session.customToken);
    markStage("open-bank-tab");
    await openBankTab(page);

    // The request card shows one of this run's matches; that match and its offer
    // are the targets. The other run match is the "different" match.
    markStage("resolve-run-targets");
    const shownMatchId = await readCardMatchId(page, REQUEST_ID);
    const targetMatch = matches.find((m) => m.matchId === shownMatchId);
    if (!targetMatch) throw new Error(`Request card shows a match outside this run: ${shownMatchId}`);
    const otherMatch = matches.find((m) => m.matchId !== targetMatch.matchId);
    const targets = [
      { side: "offer", reference: targetMatch.offerId, opportunityId: targetMatch.offerId, matchId: targetMatch.matchId },
      { side: "request", reference: REQUEST_ID, opportunityId: REQUEST_ID, matchId: targetMatch.matchId }
    ];

    markStage("inspect-both-cards");
    await installEventBridge(page);
    const beforeRefresh = [];
    const openResults = [];
    for (const expected of targets) {
      const target = await inspectTargetCard(page, expected);
      assertReflected(target, targetMatch, "Match not reflected");
      beforeRefresh.push(target);
      markStage(`open-${expected.side}-opportunity`);
      openResults.push({ side: expected.side, ...(await clickAndVerify(page, target)) });
      await installEventBridge(page);
    }

    markStage("open-different-match");
    const differentTarget = await inspectTargetCard(page, {
      side: "different",
      reference: otherMatch.offerId,
      opportunityId: otherMatch.offerId,
      matchId: otherMatch.matchId
    });
    assertReflected(differentTarget, otherMatch, "Different match not reflected");
    await page.waitForTimeout(1500);
    const differentMatch = await clickAndVerify(page, differentTarget);

    markStage("refresh");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);
    await openBankTab(page);
    await page.locator('[data-bank-action-filter="matches"]').click();
    const afterRefresh = [];
    for (const expected of targets) {
      const target = await inspectTargetCard(page, expected);
      assertReflected(target, targetMatch, "Match lost after refresh");
      afterRefresh.push(target);
    }
    await installEventBridge(page);
    const refreshOpen = await clickAndVerify(page, afterRefresh[0]);

    await page.screenshot({ path: path.join(OUT, "bank_match_both_cards_after_refresh.png"), fullPage: true });
    const report = {
      commitSha: COMMIT_SHA,
      runId: RUN_ID,
      officeId: QA_OFFICE_ID,
      viewport: { width: 390, height: 900 },
      targetMatchId: targetMatch.matchId,
      runMatches: matches,
      beforeRefresh,
      openResults,
      differentTarget,
      differentMatch,
      afterRefresh,
      refreshOpen
    };
    writeFileSync(path.join(OUT, "bank_card_click_staging_report.json"), JSON.stringify(report, null, 2));
    console.log("BANK_OPERATIONAL_ACTION_REPORT", JSON.stringify(report, null, 2));

    markStage("verified");
    console.log("BANK LEGACY OPPORTUNITY MANAGER RETIREMENT VERIFIED");
  } catch (err) {
    failure = err;
    const report = {
      ok: false,
      commitSha: COMMIT_SHA,
      runId: RUN_ID,
      officeId: QA_OFFICE_ID,
      stage: currentStage,
      runMatches: matches,
      error: String(err?.message || err),
      stack: err?.stack || null
    };
    writeFileSync(path.join(OUT, "bank_card_click_staging_report.json"), JSON.stringify(report, null, 2));
    console.error("BANK_CARD_CLICK_VERIFY_FAILED", JSON.stringify(report, null, 2));
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (KEEP_FIXTURES) {
      console.log("BANK_QA_CLEANUP skipped (--keep)", JSON.stringify({ runId: RUN_ID, office: QA_OFFICE_PATH }));
    } else {
      try {
        await cleanup(matches);
      } catch (cleanupError) {
        console.error("BANK_QA_CLEANUP_FAILED", cleanupError?.message || cleanupError);
        failure = failure || cleanupError;
      }
    }
    await app.delete().catch(() => {});
  }
  if (failure) throw failure;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
