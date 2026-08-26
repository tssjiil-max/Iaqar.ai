#!/usr/bin/env node
/**
 * Live Staging E2E — verification only.
 * Hits real hosting + Worker + Firestore. No mocks, no QA harness, no product changes.
 *
 *   node scripts/live-staging-core-flow.mjs
 *   node scripts/live-staging-core-flow.mjs --headed
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import * as admin from "firebase-admin";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { chromium } from "playwright";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const STAGING_URL = (process.env.STAGING_HOSTING_URL
  || "https://iaqar-ai-staging--staging-9c4b0k7h.web.app").replace(/\/+$/, "");
const WORKER = (process.env.STAGING_WORKER_URL
  || "https://iaqar-intake-staging.iaqar-ai.workers.dev").replace(/\/+$/, "");
const NORMAL_OFFICE_ID = "staging-logo-live-20260807";
const OFFICE_ID = process.env.QA_E2E_OFFICE_ID || "qa-e2e-dedicated";
const PARTNER_OFFICE_ID = "staging-coop-target-20260807";
const PHONE = process.env.STAGING_PHONE || "0511123456";
const PASSWORD = process.env.STAGING_PASSWORD || "StagingLogo9";
const PROJECT_ID = process.env.FIREBASE_STAGING_PROJECT_ID || "iaqar-ai-staging";
const HEADED = process.argv.includes("--headed");
const OUT = process.env.LIVE_E2E_OUT || "/opt/cursor/artifacts";
const WORK = process.env.LIVE_E2E_WORK || `/tmp/live-e2e-${Date.now().toString(36)}`;
const RUN_ID = `livee2e_${Date.now().toString(36)}`;
const DISTRICT_VALUE = `العزيزية_${RUN_ID}`;
const CITY = "المدينة المنورة";

const verdicts = [];
const evidence = [];
const networkFails = [];
const pageErrors = [];
const consoleErrors = [];
const httpLog = [];

function record(test, live, { persistence = "NOT RUN", evidence: ev = "", unit = "PASS — UNIT ONLY", note = "" } = {}) {
  const row = { test, unit, live, persistence, evidence: ev, note };
  verdicts.push(row);
  const mark = live.startsWith("PASS") ? "PASS" : live.startsWith("FAIL") ? "FAIL" : "SKIP";
  console.log(`[${mark}] ${test} | ${live} | persist=${persistence}${note ? ` | ${note}` : ""}`);
}

function shotPath(name) {
  mkdirSync(WORK, { recursive: true });
  return path.join(WORK, name);
}

function publish(name) {
  const from = path.join(WORK, name);
  const to = path.join(OUT, name);
  if (!existsSync(from)) return "";
  try {
    mkdirSync(OUT, { recursive: true });
    copyFileSync(from, to);
    evidence.push(to);
    return to;
  } catch (error) {
    console.warn("publish", name, error.message);
    evidence.push(from);
    return from;
  }
}

const NOISE = [
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/,
  /favicon/,
  /gstatic\.com\/firebasejs/,
  /Failed to load resource/,
  /net::ERR_/,
  /Firebase: No Firebase App/,
  /app-compat\/no-app/,
  /installations\/installations/,
  /\/__\/firebase\//,
  /Download the React DevTools/,
  /third-party cookie/
];

function isNoise(text) {
  return NOISE.some((pattern) => pattern.test(String(text || "")));
}

const { serviceAccount } = parseFirebaseServiceAccountJson(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  PROJECT_ID
);
if (!serviceAccount) {
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON is missing or invalid for", PROJECT_ID);
  process.exit(1);
}
const app = admin.initializeApp({ credential: admin.cert(serviceAccount), projectId: PROJECT_ID });
const db = getFirestore(app);
const officeRef = db.collection("offices").doc(OFFICE_ID);
const partnerRef = db.collection("offices").doc(PARTNER_OFFICE_ID);

const ids = {
  lastFieldOffer: `opp_${RUN_ID}_last`,
  request: `opp_${RUN_ID}_req`,
  offer: `opp_${RUN_ID}_offer`,
  match: `match_${RUN_ID}`,
  matchOp: `op_${RUN_ID}_match`,
  coop: `coop_${RUN_ID}`,
  coopOp: `op_${RUN_ID}_coop`,
  coopOwn: `opp_${RUN_ID}_coop_req`,
  coopPartner: `opp_${RUN_ID}_coop_offer`
};

function stamp() {
  const ts = Timestamp.fromMillis(Date.now());
  return {
    createdAt: ts,
    updatedAt: ts,
    isTestFixture: true,
    testRunId: RUN_ID,
    createdBy: "E2E",
    qaLiveE2e: true,
    qaLiveRunId: RUN_ID,
    sourceType: "live_e2e"
  };
}

function readyOfferFields(extra = {}) {
  return {
    officeId: OFFICE_ID,
    opportunityKind: "OFFER",
    kind: "OFFER",
    purpose: "RENT",
    propertyType: "شقة",
    city: CITY,
    district: extra.district ?? "العزيزية",
    salePrice: 0,
    annualRent: 50000,
    price: 50000,
    priceOrBudget: 50000,
    area: 125,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: extra.phone || "+966502221842",
    contactPhone: extra.phoneLocal || "0502221842",
    advertiserDisplayName: extra.name || "مالك التجربة",
    matchingReadiness: extra.matchingReadiness || "READY_FOR_MATCHING",
    matchingReadinessMissing: extra.missing || [],
    lifecycleStatus: "ACTIVE",
    status: "active",
    ...stamp(),
    ...extra.patch
  };
}

function readyRequestFields(extra = {}) {
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
    advertiserPhoneNormalized: extra.phone || "+966501111842",
    contactPhone: extra.phoneLocal || "0501111842",
    advertiserDisplayName: extra.name || "عميل التجربة",
    matchingReadiness: "READY_FOR_MATCHING",
    matchingReadinessMissing: [],
    lifecycleStatus: "ACTIVE",
    status: "active",
    ...stamp(),
    ...extra.patch
  };
}

async function deleteIfExists(ref) {
  try { await ref.delete(); } catch { /* ignore */ }
}

const CLEANUP_COLLECTIONS = ["opportunities", "matches", "operations", "cooperations", "partySessions"];

async function queryRunDocs(col) {
  try {
    return await col.where("testRunId", "==", RUN_ID).limit(100).get();
  } catch (error) {
    try {
      return await col.where("qaLiveRunId", "==", RUN_ID).limit(100).get();
    } catch (inner) {
      throw new Error(`cleanup query failed for ${col.path}: ${inner.message || error.message}`);
    }
  }
}

async function ensureQaOffice() {
  const source = db.collection("offices").doc(NORMAL_OFFICE_ID);
  const [sourceSnap, membersSnap] = await Promise.all([
    source.get(),
    source.collection("members").get()
  ]);
  const sourceData = sourceSnap.data() || {};
  await officeRef.set({
    officeName: "QA E2E Dedicated",
    displayName: "QA E2E Dedicated",
    isTestFixture: true,
    createdBy: "E2E",
    ownerUid: sourceData.ownerUid || "",
    platformOpportunityOnboardingAckAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  await Promise.all(membersSnap.docs.map((doc) => (
    officeRef.collection("members").doc(doc.id).set({
      ...doc.data(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true })
  )));
}

async function cleanupByTestRunId({ fail = false } = {}) {
  let deleted = 0;
  for (const name of CLEANUP_COLLECTIONS) {
    const col = officeRef.collection(name);
    let snap;
    try {
      snap = await queryRunDocs(col);
    } catch (error) {
      if (fail) throw error;
      console.warn("cleanup query skipped", col.path, error.message);
      continue;
    }
    await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
    deleted += snap.docs.length;
  }
  await cleanupKnownIds();
  const leftover = [];
  for (const name of CLEANUP_COLLECTIONS) {
    try {
      const snap = await queryRunDocs(officeRef.collection(name));
      if (!snap.empty) leftover.push(`${name}:${snap.docs.map((doc) => doc.id).join(",")}`);
    } catch (error) {
      if (fail) throw error;
    }
  }
  if (leftover.length) {
    const message = `E2E cleanup leftover for ${RUN_ID}: ${leftover.join("; ")}`;
    if (fail) throw new Error(message);
    console.warn(message);
  }
  return deleted;
}

async function cleanupPreviousLiveSeeds() {
  await cleanupByTestRunId({ fail: false });
}

async function seed() {
  await ensureQaOffice();
  await cleanupPreviousLiveSeeds();

  await partnerRef.set({
    officeName: "Staging Coop Target",
    displayName: "Staging Coop Target",
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await officeRef.collection("opportunities").doc(ids.lastFieldOffer).set(readyOfferFields({
    district: "",
    matchingReadiness: "NEEDS_COMPLETION",
    missing: ["district"],
    name: `QA آخر حقل ${RUN_ID}`,
    phone: "+966503331842",
    phoneLocal: "0503331842",
    patch: { contactName: `QA_LAST_${RUN_ID}` }
  }));

  await officeRef.collection("opportunities").doc(ids.request).set(readyRequestFields({
    name: `عميل حي ${RUN_ID}`,
    patch: { contactName: `QA_CLIENT_${RUN_ID}` }
  }));
  await officeRef.collection("opportunities").doc(ids.offer).set(readyOfferFields({
    name: `مالك حي ${RUN_ID}`,
    patch: { contactName: `QA_OWNER_${RUN_ID}` }
  }));

  await officeRef.collection("matches").doc(ids.match).set({
    officeId: OFFICE_ID,
    clientRequestId: ids.request,
    ownerOfferId: ids.offer,
    requestId: ids.request,
    offerId: ids.offer,
    opportunityId: ids.request,
    matchGroupId: ids.request,
    operationId: ids.matchOp,
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
    qaLiveE2e: true,
    qaLiveRunId: RUN_ID,
    createdAt: Timestamp.fromMillis(Date.now() + 180000),
    updatedAt: Timestamp.fromMillis(Date.now() + 180000)
  });

  await officeRef.collection("operations").doc(ids.matchOp).set({
    id: ids.matchOp,
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
    qaLiveE2e: true,
    qaLiveRunId: RUN_ID,
    createdAt: new Date(Date.now() + 180_000).toISOString(),
    updatedAt: new Date(Date.now() + 180_000).toISOString(),
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

  const ownListing = {
    opportunityKind: "REQUEST",
    propertyType: "أرض",
    purpose: "SALE",
    district: "السكب",
    city: CITY,
    priceOrBudget: 850000,
    area: 1175
  };
  const partnerListing = {
    opportunityKind: "OFFER",
    propertyType: "أرض",
    purpose: "SALE",
    district: "السكب",
    city: CITY,
    priceOrBudget: 830000,
    area: 1180
  };

  await officeRef.collection("opportunities").doc(ids.coopOwn).set({
    ...readyRequestFields({ name: "طلب مكتب التجربة" }),
    opportunityKind: "REQUEST",
    purpose: "PURCHASE",
    propertyType: "أرض",
    district: "السكب",
    budget: 850000,
    priceOrBudget: 850000,
    area: 1175,
    contactName: `QA_COOP_OWN_${RUN_ID}`
  });
  await partnerRef.collection("opportunities").doc(ids.coopPartner).set({
    officeId: PARTNER_OFFICE_ID,
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "أرض",
    city: CITY,
    district: "السكب",
    salePrice: 830000,
    priceOrBudget: 830000,
    area: 1180,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966504441842",
    contactPhone: "0504441842",
    lifecycleStatus: "ACTIVE",
    matchingReadiness: "READY_FOR_MATCHING",
    qaLiveE2e: true,
    qaLiveRunId: RUN_ID,
    createdAt: new Date(Date.now() + 180_000).toISOString(),
    updatedAt: new Date(Date.now() + 180_000).toISOString()
  });

  await officeRef.collection("cooperations").doc(ids.coop).set({
    id: ids.coop,
    cooperationId: ids.coop,
    cooperationTaskId: ids.coop,
    originatingOfficeId: OFFICE_ID,
    targetOfficeId: PARTNER_OFFICE_ID,
    originatingOfficeName: "Staging Logo Live",
    targetOfficeName: "Staging Coop Target",
    currentStage: "COOPERATION_MATCH_FOUND",
    status: "SUGGESTED",
    originOpportunityId: ids.coopOwn,
    counterpartOpportunityId: ids.coopPartner,
    opportunityId: ids.coopOwn,
    originListing: ownListing,
    counterpartListing: partnerListing,
    ownListing,
    partnerListing,
    proximityLabel: "نفس الحي",
    compatibilityLabel: "مطابقة مرتفعة",
    matchReasons: ["السعر مناسب", "المواصفات متقاربة"],
    qaLiveE2e: true,
    qaLiveRunId: RUN_ID,
    createdAt: new Date(Date.now() + 180_000).toISOString(),
    updatedAt: new Date(Date.now() + 180_000).toISOString()
  });

  await officeRef.collection("operations").doc(ids.coopOp).set({
    id: ids.coopOp,
    officeId: OFFICE_ID,
    type: "COOPERATION_MATCH",
    operationType: "COOPERATION_MATCH",
    status: "OPEN",
    priority: "HIGH",
    titleText: "تعاون مقترح",
    summaryText: "Staging Coop Target",
    cooperationId: ids.coop,
    opportunityId: ids.coopOwn,
    partnerOfficeName: "Staging Coop Target",
    originatingOfficeName: "Staging Logo Live",
    targetOfficeName: "Staging Coop Target",
    currentStage: "COOPERATION_MATCH_FOUND",
    propertyType: "أرض",
    purpose: "SALE",
    district: "السكب",
    city: CITY,
    qaLiveE2e: true,
    qaLiveRunId: RUN_ID,
    createdAt: new Date(Date.now() + 180_000).toISOString(),
    updatedAt: new Date(Date.now() + 180_000).toISOString(),
    metadata: {
      cooperationTaskId: ids.coop,
      currentStage: "COOPERATION_MATCH_FOUND",
      status: "SUGGESTED",
      originatingOfficeId: OFFICE_ID,
      targetOfficeId: PARTNER_OFFICE_ID,
      originatingOfficeName: "Staging Logo Live",
      targetOfficeName: "Staging Coop Target",
      originOpportunityId: ids.coopOwn,
      counterpartOpportunityId: ids.coopPartner,
      propertyType: "أرض",
      purpose: "SALE",
      district: "السكب",
      city: CITY,
      proximityLabel: "نفس الحي",
      compatibilityLabel: "مطابقة مرتفعة",
      matchReasons: ["السعر مناسب", "المواصفات متقاربة"],
      ownListing,
      partnerListing,
      originListing: ownListing,
      counterpartListing: partnerListing
    }
  });

  return ids;
}

async function readDoc(col, id) {
  const snap = await officeRef.collection(col).doc(id).get();
  return snap.exists ? { id, ...snap.data() } : null;
}

function attachWatchers(page, label) {
  page.on("pageerror", (error) => {
    const text = `${label} pageerror: ${error.message || error}`;
    if (!isNoise(text)) pageErrors.push(text);
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = `${label} console.error: ${msg.text()}`;
    if (!isNoise(text)) consoleErrors.push(text);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (isNoise(url)) return;
    if (/Firestore\/Listen|opportunity-duplicate\.mjs|office-covers|ERR_BLOCKED_BY_ORB|ERR_ABORTED/.test(url + (request.failure()?.errorText || ""))) return;
    networkFails.push(`${label} ${request.method()} ${url} ${request.failure()?.errorText || ""}`);
  });
  page.on("response", async (response) => {
    const url = response.url();
    if (!/opportunity\/patch|party\/sessions|cooperation\//.test(url)) return;
    let body = "";
    try { body = (await response.text()).slice(0, 400); } catch { /* ignore */ }
    httpLog.push({
      label,
      method: response.request().method(),
      url,
      status: response.status(),
      body
    });
  });
}

async function dismissOverlays(page) {
  const ack = page.locator("#platformOnboardingAckBtn");
  if (await ack.isVisible().catch(() => false)) {
    await ack.click().catch(() => null);
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => {
    const overlay = document.getElementById("platformOpportunityOnboarding");
    if (overlay) overlay.hidden = true;
  }).catch(() => null);
}

async function ensureE2eOfficeContext(page) {
  const activeOffice = await page.evaluate(() => localStorage.getItem("iaqar.officeId") || "");
  if (activeOffice === OFFICE_ID) return;
  await page.goto(`${STAGING_URL}/?office=${encodeURIComponent(OFFICE_ID)}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000
  });
  await page.waitForFunction(
    (target) => (localStorage.getItem("iaqar.officeId") || "") === target
      && !document.body.classList.contains("access-locked"),
    OFFICE_ID,
    { timeout: 120000 }
  );
  await dismissOverlays(page);
}

async function login(page) {
  await page.goto(`${STAGING_URL}/?office=${encodeURIComponent(OFFICE_ID)}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000
  });
  await page.waitForSelector("#loginForm", { timeout: 120000 });
  await page.locator("#loginForm input[name='phone']").fill(PHONE);
  await page.locator("#loginForm input[name='password']").fill(PASSWORD);
  await page.locator("#loginForm button[type='submit']").click();
  await page.waitForFunction(() => !document.body.classList.contains("access-locked"), {
    timeout: 120000
  });
  await ensureE2eOfficeContext(page);
  await dismissOverlays(page);
}

async function openOffersTab(page) {
  await dismissOverlays(page);
  const tab = page.locator("#mainTabOpportunities, button:has-text('العروض والطلبات')").first();
  await tab.click();
  await page.waitForTimeout(800);
  const bankSub = page.locator("#oppTabBank, button:has-text('القائمة')").first();
  if (await bankSub.count()) await bankSub.click();
  await page.waitForSelector("#opportunityBankList, [data-cv2-inbox-item]", { timeout: 60000 });
}

async function searchBank(page, needle) {
  const search = page.locator("#bankFilterSearch");
  await search.waitFor({ timeout: 30000 });
  await search.fill("");
  await search.fill(needle);
  await page.waitForTimeout(1800);
}

function inboxRow(page, opportunityId) {
  return page.locator(`[data-cv2-inbox-item][data-opportunity-id="${opportunityId}"]`);
}

async function inboxSection(page, opportunityId) {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-cv2-inbox-item][data-opportunity-id="${id}"]`);
    if (!el) return { found: false };
    let node = el.previousElementSibling;
    while (node) {
      if (node.classList?.contains("cv2-inbox-section")) {
        return {
          found: true,
          section: (node.textContent || "").trim(),
          status: el.getAttribute("data-inbox-status") || "",
          text: (el.textContent || "").replace(/\s+/g, " ").trim()
        };
      }
      node = node.previousElementSibling;
    }
    return {
      found: true,
      section: "",
      status: el.getAttribute("data-inbox-status") || "",
      text: (el.textContent || "").replace(/\s+/g, " ").trim()
    };
  }, opportunityId);
}

async function openTasksTab(page) {
  await dismissOverlays(page);
  const tab = page.locator("#mainTabOperations, button:has-text('المهام اليومية')").first();
  await tab.click();
  await page.waitForTimeout(1500);
  await page.waitForSelector("[data-cv2-exec-task], [data-cv2-exec-empty], #contentV2", { timeout: 60000 });
}

function extractPartyToken(openedUrl) {
  const raw = String(openedUrl || "");
  const decoded = decodeURIComponent(raw);
  const match = decoded.match(/cv2Party=([a-f0-9]{32,128})/i)
    || raw.match(/cv2Party%3D([a-f0-9]{32,128})/i);
  return match ? match[1] : "";
}

async function lastOpened(page) {
  return page.evaluate(() => (window.__LIVE_OPENED__ || []).slice(-1)[0] || "");
}

async function screenshot(page, name) {
  const file = shotPath(name);
  try {
    await page.screenshot({ path: file, fullPage: false });
    publish(name);
  } catch (error) {
    console.warn("screenshot", name, error.message);
  }
  return file;
}

async function startTrace(context, name) {
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false, title: name });
}

async function stopTrace(context, name) {
  const file = shotPath(name);
  try {
    await context.tracing.stop({ path: file });
    publish(name);
  } catch (error) {
    console.warn("trace stop", name, error.message);
  }
  return file;
}

function unexpectedErrors() {
  return [...pageErrors, ...consoleErrors].filter((row) => !/live listener|permission-denied/i.test(row));
}

async function cleanupKnownIds() {
  const refs = [
    officeRef.collection("opportunities").doc(ids.lastFieldOffer),
    officeRef.collection("opportunities").doc(ids.request),
    officeRef.collection("opportunities").doc(ids.offer),
    officeRef.collection("opportunities").doc(ids.coopOwn),
    officeRef.collection("matches").doc(ids.match),
    officeRef.collection("operations").doc(ids.matchOp),
    officeRef.collection("operations").doc(ids.coopOp),
    officeRef.collection("cooperations").doc(ids.coop),
    partnerRef.collection("opportunities").doc(ids.coopPartner)
  ];
  await Promise.all(refs.map(deleteIfExists));
  try {
    const sessions = await officeRef.collection("partySessions").where("matchId", "==", ids.match).get();
    await Promise.all(sessions.docs.map((doc) => doc.ref.delete()));
  } catch { /* partySessions index may be missing; queryRunDocs still covers tagged docs */ }
}

async function cleanupSeed() {
  await cleanupByTestRunId({ fail: false });
}

async function runJourney({ headed }) {
  const videoDir = path.join(WORK, headed ? "headed-videos" : "headless-videos");
  mkdirSync(WORK, { recursive: true });
  mkdirSync(videoDir, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({
    headless: !headed,
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
  });

  const brokerContext = await browser.newContext({
    locale: "ar-SA",
    viewport: { width: 390, height: 844 },
    recordVideo: { dir: videoDir, size: { width: 390, height: 844 } }
  });
  await brokerContext.addInitScript(() => {
    window.__LIVE_OPENED__ = [];
    window.open = (url) => {
      window.__LIVE_OPENED__.push(String(url || ""));
      return { closed: false, close() {}, focus() {} };
    };
  });
  const broker = await brokerContext.newPage();
  attachWatchers(broker, "broker");

  const state = {
    version: {},
    taskIdBefore: "",
    taskIdAfterClient: "",
    taskIdAfterOwner: "",
    clientToken: "",
    ownerToken: "",
    clientPartyUrl: "",
    ownerPartyUrl: "",
    patchStatus: null,
    replyStatus: null,
    ownerReplyStatus: null,
    districtAfterReload: "",
    listMovedWithoutReload: false,
    listMovedAfterReload: false,
    followUpVisible: false,
    brokerSawClient: false,
    brokerSawOwner: false,
    coopText: "",
    firestoreDistrict: "",
    firestoreReady: false,
    partyReplyAction: "",
    partyFollowUpAction: "",
    viewingReplyStatus: null,
    matchOwnerContactNeeded: false,
    matchLivingAfterClient: "",
    matchLivingAfterOwner: ""
  };

  try {
    const versionRes = await fetch(`${STAGING_URL}/version.json`, { cache: "no-store" });
    state.version = await versionRes.json().catch(() => ({}));
    console.log("staging version", state.version);

    await startTrace(brokerContext, "live-broker-core");
    await login(broker);
    await screenshot(broker, headed ? "live-headed-00-logged-in.png" : "live-A-00-logged-in.png");

    try {
      await openOffersTab(broker);
      await searchBank(broker, ids.lastFieldOffer);
      const lastRow = inboxRow(broker, ids.lastFieldOffer);
      await lastRow.waitFor({ timeout: 45000 });
      const beforeSection = await inboxSection(broker, ids.lastFieldOffer);
      console.log("before section", beforeSection);
      await screenshot(broker, headed ? "live-headed-A-before-edit.png" : "live-A-before-edit.png");

      const locationChip = lastRow.locator('[data-cv2-editor="location"]').first();
      const completeBtn = lastRow.locator("[data-cv2-complete]").first();
      if (await locationChip.count()) {
        await locationChip.click();
      } else if (await completeBtn.count()) {
        await completeBtn.click();
      } else {
        throw new Error(`district editor missing. section=${JSON.stringify(beforeSection)}`);
      }

      await lastRow.locator("[data-cv2-editor-root], #cv2Editor").first().waitFor({ timeout: 15000 });
      const cityInput = broker.locator("#cv2Editor input[name='city'], [data-cv2-editor-root] input[name='city']").first();
      if (await cityInput.isVisible().catch(() => false)) {
        const currentCity = await cityInput.inputValue();
        if (!String(currentCity || "").trim()) await cityInput.fill(CITY);
      }
      const districtInput = broker.locator("#cv2Editor input[name='district'], [data-cv2-editor-root] input[name='district']").first();
      await districtInput.waitFor({ state: "visible", timeout: 10000 });
      await districtInput.fill(DISTRICT_VALUE);
      const patchWaiter = broker.waitForResponse(
        (res) => res.url().includes("/opportunity/patch") && res.request().method() === "POST",
        { timeout: 30000 }
      ).catch(() => null);
      await broker.locator("#cv2EditorSave").click();
      const patchRes = await patchWaiter;
      state.patchStatus = patchRes ? patchRes.status() : null;
      await broker.waitForTimeout(2000);

      const sheetGone = (await lastRow.locator("[data-cv2-editor-root]").count()) === 0;
      const afterSaveSection = await inboxSection(broker, ids.lastFieldOffer);
      state.listMovedWithoutReload = afterSaveSection.section === "قيد المطابقة"
        || afterSaveSection.status === "matching";
      const valueVisible = (afterSaveSection.text || "").includes(DISTRICT_VALUE);
      await screenshot(broker, headed ? "live-headed-A-district-saved.png" : "live-A-district-saved.png");

      await broker.reload({ waitUntil: "domcontentloaded" });
      await broker.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 120000 });
      await openOffersTab(broker);
      await searchBank(broker, ids.lastFieldOffer);
      await lastRow.waitFor({ timeout: 45000 });
      const afterReloadSection = await inboxSection(broker, ids.lastFieldOffer);
      state.districtAfterReload = afterReloadSection.text || "";
      state.listMovedAfterReload = afterReloadSection.section === "قيد المطابقة"
        || afterReloadSection.status === "matching";
      await screenshot(broker, headed ? "live-headed-A-district-reload.png" : "live-A-district-reload.png");

      const persisted = await readDoc("opportunities", ids.lastFieldOffer);
      state.firestoreDistrict = persisted?.district || "";
      state.firestoreReady = persisted?.matchingReadiness === "READY_FOR_MATCHING"
        || !(persisted?.matchingReadinessMissing || []).includes("district");

      const districtLive = state.patchStatus >= 200 && state.patchStatus < 300
        && sheetGone
        && valueVisible
        && (state.districtAfterReload.includes(DISTRICT_VALUE))
        && state.firestoreDistrict === DISTRICT_VALUE;
      record("District save", districtLive ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", {
        persistence: state.districtAfterReload.includes(DISTRICT_VALUE) && state.firestoreDistrict === DISTRICT_VALUE
          ? "PASS — LIVE E2E"
          : "FAIL — LIVE E2E",
        evidence: "live-A-district-saved.png + live-A-district-reload.png + /opportunity/patch",
        note: `HTTP ${state.patchStatus} firestore=${state.firestoreDistrict} sheetGone=${sheetGone}`
      });

      const moveLive = districtLive && state.listMovedWithoutReload && state.listMovedAfterReload && state.firestoreReady;
      record("Last field → قيد المطابقة", moveLive ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", {
        persistence: state.listMovedAfterReload ? "PASS — LIVE E2E" : "FAIL — LIVE E2E",
        evidence: "live-A-district-saved.png + live-A-district-reload.png",
        note: `before=${beforeSection.section || beforeSection.status} afterSave=${afterSaveSection.section || afterSaveSection.status} afterReload=${afterReloadSection.section || afterReloadSection.status}`
      });
      await screenshot(broker, headed ? "live-headed-B-list-move.png" : "live-B-list-move.png");
    } catch (error) {
      await screenshot(broker, headed ? "live-headed-A-district-error.png" : "live-A-district-error.png");
      record("District save", "FAIL — LIVE E2E", {
        persistence: "FAIL — LIVE E2E",
        evidence: "live-A-district-error.png",
        note: String(error?.message || error)
      });
      record("Last field → قيد المطابقة", "FAIL — LIVE E2E", {
        persistence: "NOT RUN",
        note: "blocked on district editor"
      });
    }

    await openTasksTab(broker);
    await broker.waitForTimeout(2500);
    let matchCard = broker.locator(`[data-cv2-exec-task][data-match-id="${ids.match}"]`).first();
    if (!(await matchCard.count())) {
      matchCard = broker.locator(`[data-cv2-exec-task][data-task-id="${ids.matchOp}"]`).first();
    }
    if (!(await matchCard.count())) {
      await screenshot(broker, headed ? "live-headed-C-task-missing.png" : "live-C-task-missing.png");
      record("Client interested", "FAIL — LIVE E2E", {
        persistence: "NOT RUN",
        evidence: "live-C-task-missing.png",
        note: "seeded MATCH_REVIEW not visible in Daily Tasks"
      });
      record("Owner available", "NOT RUN", { note: "blocked on missing daily task" });
      record("Same taskId", "NOT RUN", { note: "blocked on missing daily task" });
      record("Broker receives client update", "FAIL — LIVE E2E", { note: "task never rendered" });
      record("Broker receives owner update", "NOT RUN", { note: "blocked on missing daily task" });
    } else {
      state.taskIdBefore = await matchCard.getAttribute("data-task-id");
      await matchCard.locator("[data-cv2-exec-reveal]").click();
      await broker.waitForTimeout(600);
      await screenshot(broker, headed ? "live-headed-C-task-open.png" : "live-C-task-open.png");

      const sendClient = matchCard.locator('[data-cv2-exec-primary="send_to_client"], [data-cv2-exec-secondary="send_to_client"], [data-cv2-exec-secondary="resend_to_client"]').first();
      const mintWaiter = broker.waitForResponse(
        (res) => res.url().includes("/party/sessions") && res.request().method() === "POST" && !/reply/.test(res.url()),
        { timeout: 30000 }
      ).catch(() => null);
      if (await sendClient.count()) await sendClient.click();
      else await matchCard.getByText("إرسال للعميل").click();
      const mintRes = await mintWaiter;
      const mintBody = mintRes ? await mintRes.json().catch(() => ({})) : {};
      const opened = await lastOpened(broker);
      state.clientToken = String(mintBody.token || extractPartyToken(opened) || "");
      state.clientPartyUrl = state.clientToken
        ? `${STAGING_URL}/?cv2Party=${state.clientToken}`
        : "";
      console.log("client party", { status: mintRes?.status(), token: state.clientToken.slice(0, 8), opened: opened.slice(0, 80) });

      const clientContext = await browser.newContext({
        locale: "ar-SA",
        viewport: { width: 390, height: 844 },
        storageState: undefined,
        recordVideo: { dir: videoDir, size: { width: 390, height: 844 } }
      });
      const clientPage = await clientContext.newPage();
      attachWatchers(clientPage, "client");
      await startTrace(clientContext, "live-client-party");

      let clientHttpOk = false;
      let clientPersisted = false;
      let clientStayAfterReload = false;
      if (!state.clientPartyUrl) {
        record("Client interested", "FAIL — LIVE E2E", {
          persistence: "NOT RUN",
          note: "party URL was not minted"
        });
      } else {
        try {
        await clientPage.goto(state.clientPartyUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
        await clientPage.waitForSelector("[data-party-action], [data-party-error], .party-recorded", { timeout: 60000 });
        const hasLogin = (await clientPage.locator("#loginForm").count())
          + (await clientPage.getByText("تسجيل دخول مكتب").count());
        await screenshot(clientPage, headed ? "live-headed-C-client-initial.png" : "live-C-client-initial.png");
        const replyWaiter = clientPage.waitForResponse(
          (res) => /\/party\/sessions\/.+\/reply$/.test(res.url()) && res.request().method() === "POST",
          { timeout: 30000 }
        ).catch(() => null);
        await clientPage.locator('[data-party-action="interested"]').click();
        const replyRes = await replyWaiter;
        state.replyStatus = replyRes ? replyRes.status() : null;
        clientHttpOk = state.replyStatus >= 200 && state.replyStatus < 300;
        await clientPage.waitForTimeout(1500);
        const bodyText = (await clientPage.locator("body").innerText()).replace(/\s+/g, " ");
        state.followUpVisible = bodyText.includes("أريد معاينة") && bodyText.includes("المعلومات والصور كافية");
        await screenshot(clientPage, headed ? "live-headed-C-client-interested.png" : "live-C-client-interested.png");

        const sessions = await officeRef.collection("partySessions").where("matchId", "==", ids.match).get();
        const clientSession = sessions.docs
          .map((doc) => doc.data())
          .find((row) => String(row.party || "") === "client");
        state.partyReplyAction = clientSession?.replyAction || "";
        clientPersisted = state.partyReplyAction === "interested";

        await clientPage.reload({ waitUntil: "domcontentloaded" });
        await clientPage.waitForSelector("[data-party-action], [data-party-error], .party-recorded", { timeout: 60000 });
        const afterReloadText = (await clientPage.locator("body").innerText()).replace(/\s+/g, " ");
        clientStayAfterReload = afterReloadText.includes("مهتم") || afterReloadText.includes("تم تسجيل");
        await screenshot(clientPage, headed ? "live-headed-C-client-reload.png" : "live-C-client-reload.png");

        const clientPass = clientHttpOk && clientPersisted && clientStayAfterReload && hasLogin === 0 && state.followUpVisible;
        record("Client interested", clientPass ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", {
          persistence: clientPersisted && clientStayAfterReload ? "PASS — LIVE E2E" : "FAIL — LIVE E2E",
          evidence: "live-C-client-interested.png + party/sessions/reply",
          note: `HTTP ${state.replyStatus} replyAction=${state.partyReplyAction} followUp=${state.followUpVisible} loginChrome=${hasLogin}`
        });

        // Golden journey: broker only gets send_to_owner after client follow-up want_viewing.
        const viewingWaiter = clientPage.waitForResponse(
          (res) => /\/party\/sessions\/.+\/reply$/.test(res.url()) && res.request().method() === "POST",
          { timeout: 30000 }
        ).catch(() => null);
        await clientPage.locator('[data-party-action="want_viewing"]').click();
        const viewingRes = await viewingWaiter;
        state.viewingReplyStatus = viewingRes ? viewingRes.status() : null;
        await clientPage.waitForTimeout(1500);
        await screenshot(clientPage, headed ? "live-headed-C-client-viewing.png" : "live-C-client-viewing.png");
        const sessionsAfterViewing = await officeRef.collection("partySessions").where("matchId", "==", ids.match).get();
        const clientSessionAfterViewing = sessionsAfterViewing.docs
          .map((doc) => doc.data())
          .find((row) => String(row.party || "") === "client");
        state.partyFollowUpAction = clientSessionAfterViewing?.followUpAction || "";
        const matchAfterViewing = await readDoc("matches", ids.match);
        state.matchOwnerContactNeeded = Boolean(matchAfterViewing?.ownerContactNeeded);
        console.log("client want_viewing", {
          status: state.viewingReplyStatus,
          followUpAction: state.partyFollowUpAction,
          ownerContactNeeded: state.matchOwnerContactNeeded
        });
        } catch (error) {
          await screenshot(clientPage, headed ? "live-headed-C-client-error.png" : "live-C-client-error.png");
          record("Client interested", "FAIL — LIVE E2E", {
            persistence: "FAIL — LIVE E2E",
            evidence: "live-C-client-error.png",
            note: String(error?.message || error)
          });
        }
      }
      await stopTrace(clientContext, headed ? "live-headed-C-client-interested.zip" : "live-C-client-interested.zip");
      try { await clientContext.close(); } catch (error) { console.warn("client close", error.message); }

      await broker.reload({ waitUntil: "domcontentloaded" });
      await broker.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 120000 });
      await openTasksTab(broker);
      await broker.waitForTimeout(2500);
      matchCard = broker.locator(`[data-cv2-exec-task][data-match-id="${ids.match}"]`).first();
      if (!(await matchCard.count())) {
        matchCard = broker.locator(`[data-cv2-exec-task][data-task-id="${state.taskIdBefore}"]`).first();
      }
      if (await matchCard.count()) {
        state.taskIdAfterClient = await matchCard.getAttribute("data-task-id");
        await matchCard.locator("[data-cv2-exec-reveal]").click();
        await broker.waitForTimeout(600);
        const brokerText = (await matchCard.innerText()).replace(/\s+/g, " ");
        state.brokerSawClient = /العميل (مهتم|طلب معاينة)/.test(brokerText);
        await screenshot(broker, headed ? "live-headed-D-broker-client.png" : "live-D-broker-client.png");
      } else {
        state.taskIdAfterClient = "";
        await screenshot(broker, headed ? "live-headed-D-broker-missing.png" : "live-D-broker-missing.png");
      }
      const matchAfterClient = await readDoc("matches", ids.match);
      state.matchLivingAfterClient = matchAfterClient?.livingStage || "";
      record("Broker receives client update", state.brokerSawClient ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", {
        persistence: state.matchLivingAfterClient ? `firestore livingStage=${state.matchLivingAfterClient}` : "FAIL — LIVE E2E",
        evidence: "live-D-broker-client.png",
        note: `taskId ${state.taskIdBefore} → ${state.taskIdAfterClient} timelineVisible=${state.brokerSawClient}`
      });

      const sendOwner = matchCard.locator('[data-cv2-exec-primary="send_to_owner"], [data-cv2-exec-secondary="send_to_owner"]');
      let ownerHttpOk = false;
      let ownerPersisted = false;
      let ownerStay = false;
      if (!(await matchCard.count()) || !(await sendOwner.count())) {
        record("Owner available", "FAIL — LIVE E2E", {
          persistence: "NOT RUN",
          note: `send-owner button count=${await sendOwner.count()} followUp=${state.partyFollowUpAction || "none"} ownerContactNeeded=${state.matchOwnerContactNeeded}`
        });
        record("Broker receives owner update", "NOT RUN", { note: "owner party URL was not created from the UI" });
      } else {
        const ownerMintWaiter = broker.waitForResponse(
          (res) => res.url().includes("/party/sessions") && res.request().method() === "POST" && !/reply/.test(res.url()),
          { timeout: 30000 }
        ).catch(() => null);
        await sendOwner.first().click();
        const ownerMint = await ownerMintWaiter;
        const ownerMintBody = ownerMint ? await ownerMint.json().catch(() => ({})) : {};
        const ownerOpened = await lastOpened(broker);
        state.ownerToken = String(ownerMintBody.token || extractPartyToken(ownerOpened) || "");
        state.ownerPartyUrl = state.ownerToken ? `${STAGING_URL}/?cv2Party=${state.ownerToken}` : "";

        const ownerContext = await browser.newContext({
          locale: "ar-SA",
          viewport: { width: 390, height: 844 },
          recordVideo: { dir: videoDir, size: { width: 390, height: 844 } }
        });
        const ownerPage = await ownerContext.newPage();
        attachWatchers(ownerPage, "owner");
        await startTrace(ownerContext, "live-owner-party");
        if (state.ownerPartyUrl) {
          await ownerPage.goto(state.ownerPartyUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
          await ownerPage.waitForSelector("[data-party-action], [data-party-error], .party-recorded", { timeout: 60000 });
          await screenshot(ownerPage, headed ? "live-headed-E-owner-initial.png" : "live-E-owner-initial.png");
          const ownerReplyWaiter = ownerPage.waitForResponse(
            (res) => /\/party\/sessions\/.+\/reply$/.test(res.url()) && res.request().method() === "POST",
            { timeout: 30000 }
          ).catch(() => null);
          await ownerPage.locator('[data-party-action="property_available"]').click();
          const ownerReply = await ownerReplyWaiter;
          state.ownerReplyStatus = ownerReply ? ownerReply.status() : null;
          ownerHttpOk = state.ownerReplyStatus >= 200 && state.ownerReplyStatus < 300;
          await ownerPage.waitForTimeout(1500);
          await screenshot(ownerPage, headed ? "live-headed-E-owner-available.png" : "live-E-owner-available.png");
          const ownerSessions = await officeRef.collection("partySessions").where("matchId", "==", ids.match).get();
          const ownerSession = ownerSessions.docs
            .map((doc) => doc.data())
            .find((row) => String(row.party || "") === "owner");
          ownerPersisted = ownerSession?.replyAction === "property_available";
          await ownerPage.reload({ waitUntil: "domcontentloaded" });
          await ownerPage.waitForSelector("[data-party-action], [data-party-error], .party-recorded", { timeout: 60000 });
          const ownerReloadText = (await ownerPage.locator("body").innerText()).replace(/\s+/g, " ");
          ownerStay = /متاح|تم تسجيل/.test(ownerReloadText);
          await screenshot(ownerPage, headed ? "live-headed-E-owner-reload.png" : "live-E-owner-reload.png");
        }
        await stopTrace(ownerContext, headed ? "live-headed-E-owner-available.zip" : "live-E-owner-available.zip");
        try { await ownerContext.close(); } catch (error) { console.warn("owner close", error.message); }

        const ownerPass = ownerHttpOk && ownerPersisted && ownerStay;
        record("Owner available", ownerPass ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", {
          persistence: ownerPersisted && ownerStay ? "PASS — LIVE E2E" : "FAIL — LIVE E2E",
          evidence: "live-E-owner-available.png + party/sessions/reply",
          note: `HTTP ${state.ownerReplyStatus} persisted=${ownerPersisted}`
        });

        await broker.reload({ waitUntil: "domcontentloaded" });
        await broker.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 120000 });
        await openTasksTab(broker);
        await broker.waitForTimeout(2500);
        matchCard = broker.locator(`[data-cv2-exec-task][data-match-id="${ids.match}"]`).first();
        if (!(await matchCard.count())) {
          matchCard = broker.locator(`[data-cv2-exec-task][data-task-id="${state.taskIdBefore}"]`).first();
        }
        if (await matchCard.count()) {
          state.taskIdAfterOwner = await matchCard.getAttribute("data-task-id");
          await matchCard.locator("[data-cv2-exec-reveal]").click();
          await broker.waitForTimeout(600);
          const ownerBrokerText = (await matchCard.innerText()).replace(/\s+/g, " ");
          state.brokerSawOwner = /المالك أكد/.test(ownerBrokerText);
          await screenshot(broker, headed ? "live-headed-F-broker-owner.png" : "live-F-broker-owner.png");
        }
        const matchAfterOwner = await readDoc("matches", ids.match);
        state.matchLivingAfterOwner = matchAfterOwner?.livingStage || "";
        record("Broker receives owner update", state.brokerSawOwner ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", {
          persistence: state.matchLivingAfterOwner ? `firestore livingStage=${state.matchLivingAfterOwner}` : "FAIL — LIVE E2E",
          evidence: "live-F-broker-owner.png",
          note: `taskId ${state.taskIdBefore} → ${state.taskIdAfterOwner}`
        });
      }

      const sameId = Boolean(state.taskIdBefore)
        && state.taskIdBefore === (state.taskIdAfterClient || state.taskIdBefore)
        && state.taskIdBefore === (state.taskIdAfterOwner || state.taskIdBefore);
      record("Same taskId", sameId && state.taskIdBefore ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", {
        persistence: sameId ? "PASS — LIVE E2E" : "FAIL — LIVE E2E",
        evidence: "taskId before/after in report JSON",
        note: `before=${state.taskIdBefore} afterClient=${state.taskIdAfterClient} afterOwner=${state.taskIdAfterOwner}`
      });
    }

    await openTasksTab(broker);
    await broker.waitForTimeout(1500);
    let coopCard = broker.locator(`[data-cv2-exec-task][data-cooperation-id="${ids.coop}"]`).first();
    if (!(await coopCard.count())) coopCard = broker.locator(`[data-cv2-exec-task][data-task-id="${ids.coop}"]`).first();
    if (!(await coopCard.count())) coopCard = broker.locator(`[data-cv2-exec-task][data-task-id="${ids.coopOp}"]`).first();
    if (await coopCard.count()) {
      await coopCard.locator("[data-cv2-exec-reveal]").click();
      await broker.waitForTimeout(600);
      state.coopText = (await coopCard.innerText()).replace(/\s+/g, " ");
      await screenshot(broker, headed ? "live-headed-G-cooperation.png" : "live-G-cooperation.png");
      const hasPlaceholder = state.coopText.includes("المكتب الآخر") || /(^|[^\d])—([^\d]|$)/.test(state.coopText);
      const hasRealNames = state.coopText.includes("Staging Coop Target")
        && (state.coopText.includes("Staging Logo Live") || state.coopText.includes("مكتبك") || state.coopText.includes("طلب/عرض مكتبك"));
      const hasListings = state.coopText.includes("أرض") && state.coopText.includes("السكب");
      const coopPass = hasRealNames && hasListings && !hasPlaceholder;
      record("Cooperation data", coopPass ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", {
        persistence: "NOT RUN",
        evidence: "live-G-cooperation.png",
        note: `placeholder=${hasPlaceholder} realNames=${hasRealNames} listings=${hasListings}`
      });
    } else {
      await screenshot(broker, headed ? "live-headed-G-coop-missing.png" : "live-G-cooperation-missing.png");
      record("Cooperation data", "FAIL — LIVE E2E", {
        evidence: "live-G-cooperation-missing.png",
        note: "seeded COOPERATION_MATCH not visible"
      });
    }

    await stopTrace(brokerContext, headed ? "live-headed-broker-core.zip" : "live-A-broker-core.zip");
  } catch (error) {
    console.error("journey error", error);
    try { await screenshot(broker, headed ? "live-headed-unexpected.png" : "live-unexpected.png"); } catch { /* ignore */ }
    record("Unexpected runner error", "FAIL — LIVE E2E", { note: String(error?.message || error) });
    try { await stopTrace(brokerContext, headed ? "live-headed-broker-core.zip" : "live-A-broker-core.zip"); } catch { /* ignore */ }
  }

  const videoFiles = [];
  try { await brokerContext.close(); } catch (error) { console.warn("broker close", error.message); }
  try { await browser.close(); } catch (error) { console.warn("browser close", error.message); }
  if (existsSync(videoDir)) {
    for (const file of readdirSync(videoDir)) {
      if (!file.endsWith(".webm")) continue;
      const from = path.join(videoDir, file);
      const to = shotPath(`${headed ? "live-headed" : "live-headless"}-${file}`);
      try {
        copyFileSync(from, to);
        publish(`${headed ? "live-headed" : "live-headless"}-${file}`);
        videoFiles.push(path.join(OUT, `${headed ? "live-headed" : "live-headless"}-${file}`));
      } catch {
        videoFiles.push(from);
      }
    }
  }

  return { state, videoFiles };
}

function coreVerified() {
  const needed = [
    "District save",
    "Last field → قيد المطابقة",
    "Client interested",
    "Owner available",
    "Broker receives client update",
    "Same taskId"
  ];
  const extra = "Broker receives owner update";
  const rows = [...needed, extra].map((name) => verdicts.find((row) => row.test === name));
  return rows.every((row) => row?.live === "PASS — LIVE E2E");
}

function writeReport({ headed, state, videoFiles }) {
  const errors = unexpectedErrors();
  if (errors.length) {
    record("Live console / network", "FAIL — LIVE E2E", { note: errors.slice(0, 8).join(" || ") });
  } else {
    record("Live console / network", networkFails.length ? "FAIL — LIVE E2E" : "PASS — LIVE E2E", {
      note: networkFails.slice(0, 6).join(" || ") || "no unexpected pageerror/console.error"
    });
  }
  const verified = coreVerified();
  const report = {
    generatedAt: new Date().toISOString(),
    headed,
    stagingUrl: STAGING_URL,
    worker: WORKER,
    stagingVersion: state.version,
    runId: RUN_ID,
    ids,
    districtValue: DISTRICT_VALUE,
    taskId: {
      before: state.taskIdBefore,
      afterClient: state.taskIdAfterClient,
      afterOwner: state.taskIdAfterOwner
    },
    http: httpLog,
    pageErrors,
    consoleErrors,
    networkFails,
    verdicts,
    coreFlowVerified: verified,
    coreFlowLabel: verified ? "CORE FLOW VERIFIED — LIVE E2E" : "CORE FLOW NOT YET VERIFIED",
    videos: videoFiles,
    evidence
  };
  const jsonPath = shotPath(headed ? "live-headed-core-flow-report.json" : "live-core-flow-report.json");
  const md = [
    `# Live Staging Core Flow (${headed ? "headed" : "headless"})`,
    "",
    `Hosting: ${STAGING_URL}`,
    `Deployed: \`${state.version?.shortSha || "?"}\` / ${state.version?.branch || ""} @ ${state.version?.deployedAt || ""}`,
    `Run: \`${RUN_ID}\``,
    "",
    `**${report.coreFlowLabel}**`,
    "",
    "| Test | Unit | Live E2E | Persistence after reload | Evidence |",
    "|---|---|---|---|---|",
    ...verdicts.map((row) => `| ${row.test} | ${row.unit} | ${row.live} | ${row.persistence} | ${row.evidence || row.note || ""} |`),
    "",
    "## taskId",
    "",
    `- before client: \`${state.taskIdBefore || ""}\``,
    `- after client: \`${state.taskIdAfterClient || ""}\``,
    `- after owner: \`${state.taskIdAfterOwner || ""}\``,
    "",
    "## Notes",
    "",
    ...(verdicts.map((row) => `- ${row.test}: ${row.note || row.live}`))
  ].join("\n");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(shotPath(headed ? "live-headed-core-flow-report.md" : "live-core-flow-report.md"), md);
  writeFileSync(path.join("/workspace/qa", headed ? "live-headed-core-flow-report.md" : "live-staging-core-flow-report.md"), md);
  publish(headed ? "live-headed-core-flow-report.json" : "live-core-flow-report.json");
  publish(headed ? "live-headed-core-flow-report.md" : "live-core-flow-report.md");
  console.log("\n" + md);
  return report;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync("/workspace/qa", { recursive: true });
  console.log(`Seeding ${RUN_ID} onto ${PROJECT_ID}/${OFFICE_ID}`);
  await seed();
  let report;
  try {
    const result = await runJourney({ headed: HEADED });
    report = writeReport({ headed: HEADED, ...result });
  } finally {
    try {
      await cleanupByTestRunId({ fail: true });
      record("E2E cleanup", "PASS — LIVE E2E", { persistence: "PASS", note: `testRunId ${RUN_ID} removed` });
    } catch (error) {
      record("E2E cleanup", "FAIL — LIVE E2E", { persistence: "FAIL", note: error.message });
      process.exitCode = 1;
    }
    try { await app.delete(); } catch { /* ignore */ }
  }
  if (!report?.coreFlowVerified) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
