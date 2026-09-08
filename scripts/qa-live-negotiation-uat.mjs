#!/usr/bin/env node
/**
 * QA-only live Staging UAT for the current negotiation decision-package UI.
 * It does not deploy or modify product code. It seeds uniquely tagged fixtures,
 * exercises real Hosting + Worker + Firestore, writes evidence, then cleans up.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as admin from "firebase-admin";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { chromium } from "playwright";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const STAGING_URL = (process.env.STAGING_HOSTING_URL || "https://iaqar-ai-staging--staging-9c4b0k7h.web.app").replace(/\/+$/, "");
const OFFICE_ID = process.env.QA_E2E_OFFICE_ID || "qa-e2e-dedicated";
const PHONE = process.env.STAGING_PHONE || "0511123456";
const PASSWORD = process.env.STAGING_PASSWORD || "StagingLogo9";
const PROJECT_ID = process.env.FIREBASE_STAGING_PROJECT_ID || "iaqar-ai-staging";
const OUT = process.env.LIVE_E2E_OUT || "artifacts";
const CHROME_PATH = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";
const RUN_ID = `qa_neg_${Date.now().toString(36)}`;
const CITY = "المدينة المنورة";

mkdirSync(OUT, { recursive: true });

const { serviceAccount } = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!serviceAccount) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing or invalid");

const app = admin.initializeApp({ credential: admin.cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore(app);
const officeRef = db.collection("offices").doc(OFFICE_ID);

const ids = {
  incomplete: `opp_${RUN_ID}_incomplete`,
  request: `opp_${RUN_ID}_request`,
  offer: `opp_${RUN_ID}_offer`,
  match: `match_${RUN_ID}`,
  operation: `op_${RUN_ID}_match`
};

const results = [];
const artifacts = [];
function addResult(name, pass, detail = {}) {
  const row = { name, pass: Boolean(pass), ...detail };
  results.push(row);
  console.log(`[${row.pass ? "PASS" : "FAIL"}] ${name}${row.note ? ` | ${row.note}` : ""}`);
  return row.pass;
}

function stamp() {
  const now = Timestamp.fromMillis(Date.now());
  return {
    createdAt: now,
    updatedAt: now,
    isTestFixture: true,
    createdBy: "E2E",
    qaLiveE2e: true,
    qaLiveRunId: RUN_ID,
    testRunId: RUN_ID,
    sourceType: "live_e2e"
  };
}

function offerFields(extra = {}) {
  return {
    officeId: OFFICE_ID,
    opportunityKind: "OFFER",
    kind: "OFFER",
    purpose: "RENT",
    propertyType: "شقة",
    city: CITY,
    district: "العزيزية",
    annualRent: 50000,
    price: 50000,
    priceOrBudget: 50000,
    area: 125,
    rooms: 3,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966502221842",
    contactPhone: "0502221842",
    advertiserDisplayName: `QA_OWNER_${RUN_ID}`,
    matchingReadiness: "READY_FOR_MATCHING",
    matchingReadinessMissing: [],
    lifecycleStatus: "ACTIVE",
    status: "active",
    ...stamp(),
    ...extra
  };
}

function requestFields(extra = {}) {
  return {
    officeId: OFFICE_ID,
    opportunityKind: "REQUEST",
    kind: "REQUEST",
    purpose: "LEASE_REQUEST",
    propertyType: "شقة",
    city: CITY,
    district: "العزيزية",
    budget: 55000,
    priceOrBudget: 55000,
    area: 120,
    advertiserRole: "CLIENT",
    advertiserPhoneNormalized: "+966501111842",
    contactPhone: "0501111842",
    advertiserDisplayName: `QA_CLIENT_${RUN_ID}`,
    matchingReadiness: "READY_FOR_MATCHING",
    matchingReadinessMissing: [],
    lifecycleStatus: "ACTIVE",
    status: "active",
    ...stamp(),
    ...extra
  };
}

async function seed() {
  const futureIso = new Date(Date.now() + 180_000).toISOString();
  await officeRef.collection("opportunities").doc(ids.incomplete).set(offerFields({
    district: "",
    matchingReadiness: "NEEDS_COMPLETION",
    matchingReadinessMissing: ["district"],
    advertiserDisplayName: `QA_INCOMPLETE_${RUN_ID}`
  }));
  await officeRef.collection("opportunities").doc(ids.request).set(requestFields());
  await officeRef.collection("opportunities").doc(ids.offer).set(offerFields());

  await officeRef.collection("matches").doc(ids.match).set({
    officeId: OFFICE_ID,
    clientRequestId: ids.request,
    ownerOfferId: ids.offer,
    requestId: ids.request,
    offerId: ids.offer,
    opportunityId: ids.request,
    matchGroupId: ids.request,
    operationId: ids.operation,
    livingStage: "MATCH_FOUND",
    livingTimeline: [],
    livingTimelineJson: "[]",
    hasNewResponse: false,
    nextActor: "BROKER",
    ownerContactNeeded: false,
    propertyType: "شقة",
    purpose: "RENT",
    district: "العزيزية",
    city: CITY,
    score: 92,
    status: "active",
    ...stamp()
  });

  await officeRef.collection("operations").doc(ids.operation).set({
    id: ids.operation,
    officeId: OFFICE_ID,
    type: "MATCH_REVIEW",
    operationType: "MATCH_REVIEW",
    status: "OPEN",
    priority: "HIGH",
    titleText: "مطابقة جديدة",
    summaryText: `شقة · العزيزية · ${RUN_ID}`,
    recommendedActionText: "إرسال للعميل",
    matchId: ids.match,
    opportunityId: ids.request,
    clientRequestId: ids.request,
    ownerOfferId: ids.offer,
    propertyType: "شقة",
    purpose: "RENT",
    district: "العزيزية",
    city: CITY,
    livingStage: "MATCH_FOUND",
    livingTimeline: [],
    livingTimelineJson: "[]",
    createdAt: futureIso,
    updatedAt: futureIso,
    ...stamp(),
    metadata: {
      clientRequestId: ids.request,
      ownerOfferId: ids.offer,
      matchGroupId: ids.request,
      livingStage: "MATCH_FOUND",
      candidatePropertyType: "شقة",
      candidatePurpose: "RENT",
      candidateDistrict: "العزيزية",
      candidateCity: CITY,
      candidateSalePrice: 50000,
      candidateArea: 125,
      opportunityScore: 92,
      reasonPreview: "نفس الحي، ضمن الميزانية"
    }
  });
}

async function deleteQuery(query) {
  const snap = await query.get();
  await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
}

async function cleanup() {
  const direct = [
    officeRef.collection("opportunities").doc(ids.incomplete),
    officeRef.collection("opportunities").doc(ids.request),
    officeRef.collection("opportunities").doc(ids.offer),
    officeRef.collection("matches").doc(ids.match),
    officeRef.collection("operations").doc(ids.operation)
  ];
  await Promise.all(direct.map((ref) => ref.delete().catch(() => null)));
  for (const name of ["partySessions", "partySessionKeys", "coordinationSessions", "notifications"]) {
    try { await deleteQuery(officeRef.collection(name).where("matchId", "==", ids.match)); } catch { /* optional collection/index */ }
  }
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: true });
  artifacts.push(file);
}

async function dismissOverlays(page) {
  const ack = page.locator("#platformOnboardingAckBtn");
  if (await ack.isVisible().catch(() => false)) await ack.click().catch(() => null);
  await page.evaluate(() => {
    const overlay = document.getElementById("platformOpportunityOnboarding");
    if (overlay) overlay.hidden = true;
  }).catch(() => null);
}

async function login(page) {
  await page.goto(`${STAGING_URL}/?office=${encodeURIComponent(OFFICE_ID)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#loginForm", { timeout: 120000 });
  await page.locator("#loginForm input[name='phone']").fill(PHONE);
  await page.locator("#loginForm input[name='password']").fill(PASSWORD);
  await page.locator("#loginForm button[type='submit']").click();
  await page.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 120000 });
  const active = await page.evaluate(() => localStorage.getItem("iaqar.officeId") || "");
  if (active !== OFFICE_ID) {
    await page.goto(`${STAGING_URL}/?office=${encodeURIComponent(OFFICE_ID)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction((officeId) => (localStorage.getItem("iaqar.officeId") || "") === officeId && !document.body.classList.contains("access-locked"), OFFICE_ID, { timeout: 120000 });
  }
  await dismissOverlays(page);
}

async function openBank(page) {
  await dismissOverlays(page);
  await page.locator("#mainTabOpportunities, button:has-text('العروض والطلبات')").first().click();
  await page.waitForTimeout(800);
  const bankTab = page.locator("#oppTabBank, button:has-text('القائمة')").first();
  if (await bankTab.count()) await bankTab.click();
  await page.waitForSelector("#bankFilterSearch", { timeout: 60000 });
}

async function openTasks(page) {
  await dismissOverlays(page);
  await page.locator("#mainTabOperations, button:has-text('المهام اليومية')").first().click();
  await page.waitForTimeout(1800);
  await page.waitForSelector("[data-cv2-exec-task], [data-cv2-exec-empty], #contentV2", { timeout: 60000 });
}

function matchCard(page, taskId = "") {
  const byMatch = page.locator(`[data-cv2-exec-task][data-match-id="${ids.match}"]`).first();
  if (!taskId) return byMatch;
  return page.locator(`[data-cv2-exec-task][data-match-id="${ids.match}"], [data-cv2-exec-task][data-task-id="${taskId}"]`).first();
}

async function waitPartyReady(page) {
  await page.waitForSelector("[data-party-decision-package], [data-party-action], [data-party-error], .party-recorded", { timeout: 60000 });
  if (await page.locator("[data-party-error]").count()) {
    throw new Error(`party page error: ${(await page.locator("[data-party-error]").innerText()).trim()}`);
  }
}

async function chooseFirstVisible(page, selector) {
  const inputs = page.locator(selector);
  const count = await inputs.count();
  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    if (await input.isVisible().catch(() => false)) {
      await input.check({ force: true });
      return true;
    }
  }
  return false;
}

async function submitClientViewing(page) {
  await waitPartyReady(page);
  const packageRoot = page.locator("[data-party-decision-package]").first();
  if (!(await packageRoot.count())) throw new Error("current decision package not found");
  const viewing = packageRoot.locator('[data-package-field="clientDecision"][value="viewing"]');
  await viewing.check({ force: true });
  await page.waitForTimeout(250);
  await chooseFirstVisible(page, '[data-package-field="viewingDays"]');
  await chooseFirstVisible(page, '[data-package-field="viewingPeriods"]');
  const responseWaiter = page.waitForResponse((res) => /\/party\/sessions\/.+\/bundle$/.test(res.url()) && res.request().method() === "POST", { timeout: 45000 });
  await packageRoot.locator("[data-party-bundle-submit]").click();
  const response = await responseWaiter;
  const body = await response.json().catch(() => ({}));
  await page.waitForSelector(".party-recorded, [data-testid='party-bundle-recorded'], [data-party-decision-package]", { timeout: 30000 });
  return { status: response.status(), body };
}

async function submitOwnerCurrentPackage(page) {
  await waitPartyReady(page);
  const packageRoot = page.locator("[data-party-decision-package]").first();
  if (!(await packageRoot.count())) throw new Error("owner decision package not found");
  const workflowStep = String(await packageRoot.getAttribute("data-workflow-step") || "");

  const confirmedPrice = packageRoot.locator('[data-package-field="ownerPriceDecision"][value="confirmed"]');
  if (await confirmedPrice.count()) await confirmedPrice.check({ force: true });

  const viewingYes = packageRoot.locator('[data-package-field="viewingAllowed"][value="yes"]');
  if (await viewingYes.count()) {
    await viewingYes.check({ force: true });
    await page.waitForTimeout(250);
    await chooseFirstVisible(page, '[data-package-field="viewingDays"]');
    await chooseFirstVisible(page, '[data-package-field="viewingPeriods"]');
  }

  const detailFields = packageRoot.locator('[data-package-field^="detailStatus_"]');
  const detailCount = await detailFields.count();
  const handled = new Set();
  for (let i = 0; i < detailCount; i += 1) {
    const input = detailFields.nth(i);
    const name = await input.getAttribute("data-package-field");
    if (!name || handled.has(name)) continue;
    handled.add(name);
    const confirm = packageRoot.locator(`[data-package-field="${name}"][value="confirm"]`);
    if (await confirm.count()) await confirm.check({ force: true });
  }

  const responseWaiter = page.waitForResponse((res) => /\/party\/sessions\/.+\/bundle$/.test(res.url()) && res.request().method() === "POST", { timeout: 45000 });
  await packageRoot.locator("[data-party-bundle-submit]").click();
  const response = await responseWaiter;
  const body = await response.json().catch(() => ({}));
  await page.waitForSelector(".party-recorded, [data-testid='party-bundle-recorded'], [data-party-decision-package]", { timeout: 30000 });
  return { status: response.status(), body, workflowStep };
}

async function run() {
  await seed();
  const browser = await chromium.launch({ headless: true, executablePath: CHROME_PATH, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  const brokerContext = await browser.newContext({ locale: "ar-SA", viewport: { width: 390, height: 844 } });
  const broker = await brokerContext.newPage();
  try {
    const version = await (await fetch(`${STAGING_URL}/version.json`, { cache: "no-store" })).json();
    console.log("staging version", version);
    await login(broker);
    await shot(broker, "qa-neg-00-login.png");
    addResult("Broker login + QA office", true, { officeId: OFFICE_ID });

    await openBank(broker);
    await broker.locator("#bankFilterSearch").fill(ids.incomplete);
    await broker.waitForTimeout(1800);
    const incompleteVisible = await broker.locator(`[data-cv2-inbox-item][data-opportunity-id="${ids.incomplete}"]`).count();
    const incompleteDoc = (await officeRef.collection("opportunities").doc(ids.incomplete).get()).data() || {};
    addResult("Incomplete opportunity routed out of Bank", incompleteVisible === 0 && incompleteDoc.matchingReadiness === "NEEDS_COMPLETION", {
      note: `visible=${incompleteVisible} readiness=${incompleteDoc.matchingReadiness || ""}`
    });
    await shot(broker, "qa-neg-01-incomplete-bank-policy.png");

    await openTasks(broker);
    let card = matchCard(broker);
    await card.waitFor({ state: "visible", timeout: 60000 });
    const taskIdBefore = await card.getAttribute("data-task-id");
    await card.locator("[data-cv2-exec-reveal]").click();
    await broker.waitForTimeout(400);
    await shot(broker, "qa-neg-02-match-task.png");
    addResult("Seeded match visible in Daily Tasks", Boolean(taskIdBefore), { taskIdBefore });

    const clientMintWaiter = broker.waitForResponse((res) => res.url().includes("/party/sessions") && res.request().method() === "POST" && !/\/reply$|\/bundle$/.test(res.url()), { timeout: 45000 });
    const sendClient = card.locator('[data-cv2-exec-primary="send_to_client"], [data-cv2-exec-secondary="send_to_client"], [data-cv2-exec-secondary="resend_to_client"]').first();
    await sendClient.click();
    const clientMint = await clientMintWaiter;
    const clientMintBody = await clientMint.json().catch(() => ({}));
    const clientToken = String(clientMintBody.token || "");
    addResult("Client party token minted", clientMint.status() >= 200 && clientMint.status() < 300 && clientToken.length > 20, { status: clientMint.status() });

    const clientContext = await browser.newContext({ locale: "ar-SA", viewport: { width: 390, height: 844 } });
    const client = await clientContext.newPage();
    await client.goto(`${STAGING_URL}/?cv2Party=${encodeURIComponent(clientToken)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitPartyReady(client);
    await shot(client, "qa-neg-03-client-package.png");
    const clientSubmit = await submitClientViewing(client);
    await client.waitForTimeout(1200);
    await shot(client, "qa-neg-04-client-submitted.png");
    const matchAfterClient = (await officeRef.collection("matches").doc(ids.match).get()).data() || {};
    const ownerNeeded = matchAfterClient.ownerContactNeeded === true || String(matchAfterClient.ownerContactNeeded).toLowerCase() === "true" || String(matchAfterClient.nextActor || "").toUpperCase().includes("OWNER");
    addResult("Client viewing decision persisted", clientSubmit.status >= 200 && clientSubmit.status < 300 && ownerNeeded, {
      status: clientSubmit.status,
      note: `livingStage=${matchAfterClient.livingStage || ""} nextActor=${matchAfterClient.nextActor || ""} ownerContactNeeded=${matchAfterClient.ownerContactNeeded}`
    });
    await client.reload({ waitUntil: "domcontentloaded" });
    await waitPartyReady(client);
    const clientReloadRecorded = await client.locator(".party-recorded, [data-testid='party-bundle-recorded']").count();
    addResult("Client reply survives reload", clientReloadRecorded > 0, { recorded: clientReloadRecorded });
    await clientContext.close();

    await broker.reload({ waitUntil: "domcontentloaded" });
    await broker.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 120000 });
    await openTasks(broker);
    card = matchCard(broker, taskIdBefore);
    await card.waitFor({ state: "visible", timeout: 60000 });
    const taskIdAfterClient = await card.getAttribute("data-task-id");
    await card.locator("[data-cv2-exec-reveal]").click();
    await broker.waitForTimeout(400);
    await shot(broker, "qa-neg-05-broker-after-client.png");
    const sendOwner = card.locator('[data-cv2-exec-primary="send_to_owner"], [data-cv2-exec-secondary="send_to_owner"]').first();
    addResult("Same taskId after client", taskIdAfterClient === taskIdBefore, { taskIdBefore, taskIdAfterClient });
    addResult("Owner action appears after client viewing", (await sendOwner.count()) > 0, { count: await sendOwner.count() });

    if (!(await sendOwner.count())) throw new Error("send_to_owner action did not appear after client viewing");
    const ownerMintWaiter = broker.waitForResponse((res) => res.url().includes("/party/sessions") && res.request().method() === "POST" && !/\/reply$|\/bundle$/.test(res.url()), { timeout: 45000 });
    await sendOwner.click();
    const ownerMint = await ownerMintWaiter;
    const ownerMintBody = await ownerMint.json().catch(() => ({}));
    const ownerToken = String(ownerMintBody.token || "");
    addResult("Owner party token minted", ownerMint.status() >= 200 && ownerMint.status() < 300 && ownerToken.length > 20, { status: ownerMint.status() });

    const ownerContext = await browser.newContext({ locale: "ar-SA", viewport: { width: 390, height: 844 } });
    const owner = await ownerContext.newPage();
    await owner.goto(`${STAGING_URL}/?cv2Party=${encodeURIComponent(ownerToken)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitPartyReady(owner);
    await shot(owner, "qa-neg-06-owner-package.png");
    const ownerSubmit = await submitOwnerCurrentPackage(owner);
    await owner.waitForTimeout(1200);
    await shot(owner, "qa-neg-07-owner-submitted.png");
    const matchAfterOwner = (await officeRef.collection("matches").doc(ids.match).get()).data() || {};
    addResult("Owner current package persisted", ownerSubmit.status >= 200 && ownerSubmit.status < 300, {
      status: ownerSubmit.status,
      workflowStep: ownerSubmit.workflowStep,
      note: `livingStage=${matchAfterOwner.livingStage || ""} nextActor=${matchAfterOwner.nextActor || ""}`
    });
    await owner.reload({ waitUntil: "domcontentloaded" });
    await waitPartyReady(owner);
    const ownerReloadRecorded = await owner.locator(".party-recorded, [data-testid='party-bundle-recorded']").count();
    addResult("Owner reply survives reload", ownerReloadRecorded > 0, { recorded: ownerReloadRecorded });
    await ownerContext.close();

    await broker.reload({ waitUntil: "domcontentloaded" });
    await broker.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 120000 });
    await openTasks(broker);
    card = matchCard(broker, taskIdBefore);
    await card.waitFor({ state: "visible", timeout: 60000 });
    const taskIdAfterOwner = await card.getAttribute("data-task-id");
    await card.locator("[data-cv2-exec-reveal]").click();
    await broker.waitForTimeout(400);
    await shot(broker, "qa-neg-08-broker-after-owner.png");
    addResult("Same taskId after owner", taskIdAfterOwner === taskIdBefore, { taskIdBefore, taskIdAfterOwner });

    const failed = results.filter((row) => !row.pass);
    const report = {
      generatedAt: new Date().toISOString(),
      runId: RUN_ID,
      officeId: OFFICE_ID,
      stagingVersion: version,
      ids,
      results,
      passed: failed.length === 0,
      artifactFiles: artifacts.map((file) => path.basename(file))
    };
    writeFileSync(path.join(OUT, "qa-live-negotiation-uat.json"), JSON.stringify(report, null, 2));
    writeFileSync(path.join(OUT, "qa-live-negotiation-uat.md"), [
      "# QA Live Negotiation UAT",
      "",
      `Staging: ${STAGING_URL}`,
      `Version: ${version.shortSha || "?"} / ${version.branch || ""}`,
      `Run: ${RUN_ID}`,
      "",
      `**${report.passed ? "PASS" : "FAIL"}**`,
      "",
      "| Check | Result | Note |",
      "|---|---|---|",
      ...results.map((row) => `| ${row.name} | ${row.pass ? "PASS" : "FAIL"} | ${String(row.note || row.status || "").replace(/\|/g, "\\|")} |`)
    ].join("\n"));
    if (failed.length) process.exitCode = 2;
  } finally {
    await brokerContext.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}

let runError = null;
try {
  console.log(`Seeding ${RUN_ID} on ${PROJECT_ID}/${OFFICE_ID}`);
  await run();
} catch (error) {
  runError = error;
  console.error(error?.stack || error);
  results.push({ name: "Unexpected UAT error", pass: false, note: String(error?.message || error) });
  writeFileSync(path.join(OUT, "qa-live-negotiation-uat-error.json"), JSON.stringify({ runId: RUN_ID, ids, results, error: String(error?.stack || error) }, null, 2));
  process.exitCode = 2;
} finally {
  try {
    await cleanup();
    console.log(`[PASS] cleanup | ${RUN_ID}`);
  } catch (cleanupError) {
    console.error("cleanup failed", cleanupError);
    process.exitCode = 1;
  }
  await app.delete().catch(() => null);
}

if (runError) process.exitCode = process.exitCode || 2;
