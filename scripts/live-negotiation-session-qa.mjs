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

async function waitReady(page) {
  await page.waitForFunction(() => {
    const candidates = [
      document.querySelector("[data-party-decision-package]"),
      document.querySelector("[data-party-error]"),
      document.querySelector("[data-testid='party-bundle-recorded']"),
      document.querySelector(".party-recorded")
    ].filter(Boolean);
    return candidates.some((node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    });
  }, null, { timeout: 60000 });

  const error = page.locator("[data-party-error]").first();
  if (await visible(error)) {
    throw new Error(`party UI error: ${(await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 800)}`);
  }
  const loginForm = page.locator("#loginForm");
  const loginText = page.getByText("تسجيل دخول مكتب");
  if (await visible(loginForm) || await visible(loginText)) throw new Error("party page exposed broker login chrome");
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
    if (await row.isVisible().catch(() => false)) {
      await row.check();
      return true;
    }
  }
  return false;
}

async function chooseAllOwnerDetails(page) {
  const groups = page.locator('[data-owner-detail]');
  for (let index = 0; index < await groups.count(); index += 1) {
    const group = groups.nth(index);
    if (!(await group.isVisible().catch(() => false))) continue;
    const confirm = group.locator('input[data-package-field^="detailStatus_"][value="confirm"]');
    const needsUpdate = group.locator('input[data-package-field^="detailStatus_"][value="needs_update"]');
    if (await visible(confirm)) await confirm.check();
    else if (await visible(needsUpdate)) await needsUpdate.check();
  }
}

async function captureFailure(page, label, error) {
  const safe = String(label || "party").replace(/[^a-z0-9_-]+/gi, "-");
  const state = await currentUiState(page).catch(() => ({ terminal: false, hasForm: false, workflowStep: "unknown" }));
  const bodyExcerpt = await page.locator("body").innerText().catch(() => "");
  await page.screenshot({ path: path.join(OUT, `${safe}-failure.png`), fullPage: true }).catch(() => {});
  writeFileSync(path.join(OUT, `${safe}-failure.json`), JSON.stringify({
    generatedAt: new Date().toISOString(),
    label,
    url: page.url(),
    ...state,
    message: error?.message || String(error),
    stack: error?.stack || "",
    bodyExcerpt: bodyExcerpt.replace(/\s+/g, " ").slice(0, 1600)
  }, null, 2));
}

async function submitBundle(page, label) {
  const before = await currentUiState(page);
  const button = page.locator("[data-party-bundle-submit]").first();
  if (!(await visible(button))) throw new Error(`${label}: submit button missing step=${before.workflowStep || "initial"}`);

  const waiter = page.waitForResponse(
    (res) => /\/party\/sessions\/.+\/bundle$/.test(res.url()) && res.request().method() === "POST",
    { timeout: 45000 }
  );
  await button.click();
  const response = await waiter;
  const body = await response.json().catch(() => ({}));
  if (!response.ok() || !body.ok) throw new Error(`${label}: bundle submit failed ${response.status()} ${JSON.stringify(body)}`);

  // Reload the same opaque party URL after every reply so assertions use
  // persisted Staging state instead of a transient client-side DOM.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  const after = await waitReady(page);
  await assertButtonsOnly(page);
  return { status: response.status(), before, after };
}

async function clientJourney(browser, token) {
  const context = await browser.newContext({ locale: "ar-SA", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const url = `${STAGING_URL}/?cv2Party=${encodeURIComponent(token)}`;
  const transitions = [];
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    let state = await waitReady(page);
    await assertButtonsOnly(page);
    await page.screenshot({ path: path.join(OUT, "client-initial.png"), fullPage: true });

    for (let attempt = 0; attempt < 3 && !state.terminal; attempt += 1) {
      if (!state.hasForm) throw new Error(`client form missing step=${state.workflowStep || "initial"}`);
      if (state.workflowStep === "client_viewing") {
        if (!(await chooseFirstVisible(page, 'input[data-package-field="viewingDays"]'))) throw new Error("client viewing day missing");
        if (!(await chooseFirstVisible(page, 'input[data-package-field="viewingPeriods"]'))) throw new Error("client viewing period missing");
      } else if (state.workflowStep === "client_price_response") {
        const viewingResponse = page.locator('input[data-package-field="negotiationResponse"][value="viewing"]');
        if (!(await visible(viewingResponse))) throw new Error("client price-response viewing choice missing");
        await viewingResponse.check();
        await page.waitForTimeout(100);
        await chooseFirstVisible(page, 'input[data-package-field="viewingDays"]');
        await chooseFirstVisible(page, 'input[data-package-field="viewingPeriods"]');
      } else {
        const viewing = page.locator('input[data-package-field="clientDecision"][value="viewing"]');
        if (!(await visible(viewing))) throw new Error(`client viewing decision missing step=${state.workflowStep || "initial"}`);
        await viewing.check();
        await page.waitForTimeout(100);
        if (!(await chooseFirstVisible(page, 'input[data-package-field="viewingDays"]'))) throw new Error("client viewing day missing");
        if (!(await chooseFirstVisible(page, 'input[data-package-field="viewingPeriods"]'))) throw new Error("client viewing period missing");
      }
      const result = await submitBundle(page, `client-${attempt + 1}`);
      transitions.push(result);
      state = result.after;
      await page.screenshot({ path: path.join(OUT, `client-step-${attempt + 1}.png`), fullPage: true });
    }

    const persisted = state.terminal;
    if (!persisted) throw new Error(`client journey did not reach recorded state; step=${state.workflowStep || "unknown"}`);
    const tokenStayed = new URL(page.url()).searchParams.get("cv2Party") === token;
    await page.screenshot({ path: path.join(OUT, "client-reload.png"), fullPage: true });
    return {
      submitStatus: transitions.at(-1)?.status || 0,
      submitStatuses: transitions.map((row) => row.status),
      workflowSteps: transitions.map((row) => row.before.workflowStep || "initial"),
      persisted,
      tokenStayed
    };
  } catch (error) {
    await captureFailure(page, "client", error);
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
}

async function ownerJourney(browser, token) {
  const context = await browser.newContext({ locale: "ar-SA", viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const url = `${STAGING_URL}/?cv2Party=${encodeURIComponent(token)}`;
  const transitions = [];
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    let state = await waitReady(page);
    await assertButtonsOnly(page);
    const initialWorkflowStep = state.workflowStep;
    await page.screenshot({ path: path.join(OUT, "owner-initial.png"), fullPage: true });

    for (let attempt = 0; attempt < 5 && !state.terminal; attempt += 1) {
      if (!state.hasForm) throw new Error(`owner form missing step=${state.workflowStep || "initial"}`);
      const step = state.workflowStep || "owner_initial";

      if (step === "owner_details") {
        await chooseAllOwnerDetails(page);
      } else if (step === "owner_price") {
        const picked = await chooseFirstVisible(page, 'input[data-package-field="ownerPriceDecision"][value="accept_discount"]')
          || await chooseFirstVisible(page, 'input[data-package-field="ownerPriceDecision"][value="fixed"]')
          || await chooseFirstVisible(page, 'input[data-package-field="ownerPriceDecision"]');
        if (!picked) throw new Error("owner price decision missing");
      } else if (step === "owner_viewing") {
        const viewing = page.locator('input[data-package-field="viewingAllowed"][value="yes"]');
        if (!(await visible(viewing))) throw new Error("owner viewing decision missing");
        await viewing.check();
        await page.waitForTimeout(100);
        if (!(await chooseFirstVisible(page, 'input[data-package-field="viewingDays"]'))) throw new Error("owner viewing day missing");
        if (!(await chooseFirstVisible(page, 'input[data-package-field="viewingPeriods"]'))) throw new Error("owner viewing period missing");
      } else {
        // Compatibility with the older combined owner form: answer the current
        // facts first. Viewing remains a later workflow stage when required.
        await chooseAllOwnerDetails(page);
        const hasPrice = await chooseFirstVisible(page, 'input[data-package-field="ownerPriceDecision"][value="confirmed"]')
          || await chooseFirstVisible(page, 'input[data-package-field="ownerPriceDecision"][value="fixed"]');
        if (!hasPrice) {
          const viewing = page.locator('input[data-package-field="viewingAllowed"][value="yes"]');
          if (await visible(viewing)) {
            await viewing.check();
            await page.waitForTimeout(100);
            await chooseFirstVisible(page, 'input[data-package-field="viewingDays"]');
            await chooseFirstVisible(page, 'input[data-package-field="viewingPeriods"]');
          }
        }
      }

      const result = await submitBundle(page, `owner-${attempt + 1}-${step}`);
      transitions.push(result);
      state = result.after;
      await page.screenshot({ path: path.join(OUT, `owner-step-${attempt + 1}-${step}.png`), fullPage: true });
    }

    const persisted = state.terminal;
    if (!persisted) throw new Error(`owner journey did not reach recorded state; step=${state.workflowStep || "unknown"}`);
    const tokenStayed = new URL(page.url()).searchParams.get("cv2Party") === token;
    await page.screenshot({ path: path.join(OUT, "owner-reload.png"), fullPage: true });
    return {
      workflowStep: initialWorkflowStep,
      workflowSteps: transitions.map((row) => row.before.workflowStep || "owner_initial"),
      submitStatus: transitions.at(-1)?.status || 0,
      submitStatuses: transitions.map((row) => row.status),
      persisted,
      tokenStayed
    };
  } catch (error) {
    await captureFailure(page, "owner", error);
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
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
  writeFileSync(path.join(OUT, "live-negotiation-session-failure.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    officeId: OFFICE_ID,
    matchId: activeMatchId,
    message: error?.message || String(error),
    stack: error?.stack || ""
  }, null, 2));
  console.error(error);
  process.exit(1);
});
