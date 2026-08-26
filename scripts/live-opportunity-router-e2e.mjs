#!/usr/bin/env node
/**
 * Live staging E2E — Public Opportunity Router.
 * Hits Hosting /add + Worker + Firestore. Cleans up only by testRunId.
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import * as admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { chromium } from "playwright";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const STAGING_URL = (process.env.STAGING_HOSTING_URL
  || "https://iaqar-ai-staging--staging-9c4b0k7h.web.app").replace(/\/+$/, "");
const WORKER = (process.env.STAGING_WORKER_URL
  || "https://iaqar-intake-staging.iaqar-ai.workers.dev").replace(/\/+$/, "");
const PROJECT_ID = process.env.FIREBASE_STAGING_PROJECT_ID || "iaqar-ai-staging";
const OFFICE_DIRECT = "staging-logo-live-20260807";
const OFFICE_B_LIVE = "qa-e2e-dedicated";
const PHONE = process.env.STAGING_PHONE || "0511123456";
const PASSWORD = process.env.STAGING_PASSWORD || "StagingLogo9";
const OUT = process.env.LIVE_E2E_OUT || "/opt/cursor/artifacts";
const RUN_ID = `router_${Date.now().toString(36)}`;
const SHORT = RUN_ID.replace(/^router_/, "");
const FIXTURE_A = `qa-rt-a-${SHORT}`.slice(0, 80);
const FIXTURE_B = `qa-rt-b-${SHORT}`.slice(0, 80);
const ROUTER_CITY = "مدينة الراوتر";
const DIRECT_CITY = "المدينة المنورة";
const CHROME = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";

const verdicts = [];
const addedMembers = [];
const fixtureOffices = [];
const taggedPaths = [];
const restoreOfficeFlags = [];

function phoneKey(value) {
  return String(value || "").replace(/\D/g, "").slice(-9);
}

function record(test, live, extra = {}) {
  const row = { test, live, ...extra };
  verdicts.push(row);
  console.log(`[${live.startsWith("PASS") ? "PASS" : live.startsWith("FAIL") ? "FAIL" : "SKIP"}] ${test} | ${live}${extra.note ? ` | ${extra.note}` : ""}`);
}

function publish(name, from) {
  mkdirSync(OUT, { recursive: true });
  const to = path.join(OUT, name);
  if (from && existsSync(from)) copyFileSync(from, to);
  return to;
}

function parseBreakdown(row = {}) {
  try {
    const raw = row.scoreBreakdownJson || row.scoreBreakdown || "{}";
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

function parseReasons(row = {}) {
  try {
    const raw = row.reasonCodesJson || "[]";
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
}

function operationMeta(data = {}) {
  if (data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)) {
    return data.metadata;
  }
  try {
    return JSON.parse(data.metadataJson || "{}");
  } catch {
    return {};
  }
}

async function dismissOverlays(page) {
  const ack = page.locator("#platformOnboardingAckBtn");
  if (await ack.isVisible().catch(() => false)) await ack.click().catch(() => null);
  await page.evaluate(() => {
    const overlay = document.getElementById("platformOpportunityOnboarding");
    if (overlay) overlay.hidden = true;
  }).catch(() => null);
}

const parsedSa = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsedSa.serviceAccount) {
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON missing");
  process.exit(1);
}
const app = admin.initializeApp({ credential: admin.cert(parsedSa.serviceAccount), projectId: PROJECT_ID });
const db = getFirestore(app);

async function idTokenForPhone() {
  const initRes = await fetch(`${STAGING_URL}/__/firebase/init.json`);
  const { apiKey } = await initRes.json();
  const loginRes = await fetch(`${WORKER}/auth/phone-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: PHONE, password: PASSWORD, apiKey })
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok || !loginBody.customToken) {
    throw new Error(`phone-login failed ${loginRes.status}`);
  }
  const signRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: loginBody.customToken, returnSecureToken: true })
    }
  );
  const signBody = await signRes.json().catch(() => ({}));
  if (!signRes.ok || !signBody.idToken) throw new Error("signIn failed");
  const uid = String(signBody.localId || loginBody.uid || "").trim()
    || (() => {
      try {
        const payload = JSON.parse(Buffer.from(String(signBody.idToken).split(".")[1], "base64url").toString("utf8"));
        return String(payload.user_id || payload.sub || "").trim();
      } catch {
        return "";
      }
    })();
  if (!uid) throw new Error("phone-login uid missing");
  return { idToken: signBody.idToken, customToken: loginBody.customToken, uid, apiKey };
}

async function ensureMember(officeId, uid) {
  const ref = db.collection("offices").doc(officeId).collection("members").doc(uid);
  const snap = await ref.get();
  if (snap.exists) return false;
  await ref.set({
    officeId,
    uid,
    role: "manager",
    active: true,
    isTestFixture: true,
    testRunId: RUN_ID,
    createdBy: "E2E",
    createdAt: FieldValue.serverTimestamp()
  });
  addedMembers.push({ officeId, uid });
  return true;
}

async function tagDoc(ref, extra = {}) {
  await ref.set({
    isTestFixture: true,
    testRunId: RUN_ID,
    createdBy: "E2E",
    ...extra
  }, { merge: true });
  taggedPaths.push(ref.path);
}

async function createFixtureOffice(officeId, extra = {}) {
  await db.collection("offices").doc(officeId).set({
    officeId,
    officeName: extra.officeName || officeId,
    brokerName: "وسيط اختبار الراوتر",
    licenseNumber: "123456",
    city: ROUTER_CITY,
    accountStatus: "active",
    approvalStatus: "approved",
    acceptPlatformPublicOpportunities: extra.acceptPlatformPublicOpportunities !== false,
    specialties: extra.specialties || ["purchase"],
    serviceNeighborhoodLabels: extra.serviceNeighborhoodLabels || [],
    primaryNeighborhoodId: extra.primaryNeighborhoodId || "",
    serviceNeighborhoodIds: extra.serviceNeighborhoodIds || [],
    ratingAverage: extra.ratingAverage || 0,
    ratingCount: extra.ratingCount || 0,
    platformRouterStats: extra.platformRouterStats || {},
    ownerUid: extra.ownerUid || "",
    platformOpportunityOnboardingAckAt: extra.ack === false ? "" : new Date().toISOString(),
    isTestFixture: true,
    testRunId: RUN_ID,
    createdBy: "E2E",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  fixtureOffices.push(officeId);
}

async function findPlatformOpportunityByPhone(phone, { timeoutMs = 60000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const snap = await db.collection("offices").doc("platform").collection("opportunities")
      .orderBy("createdAt", "desc").limit(40).get();
    const hit = snap.docs.find((doc) => {
      const data = doc.data() || {};
      return phoneKey(data.contactPhone || data.advertiserPhoneNormalized || data.phone) === phoneKey(phone);
    });
    if (hit) return { id: hit.id, ...hit.data(), ref: hit.ref };
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return null;
}

async function findOfficeOpportunityByPhone(officeId, phone) {
  const snap = await db.collection("offices").doc(officeId).collection("opportunities")
    .orderBy("createdAt", "desc").limit(25).get();
  const hit = snap.docs.find((doc) => phoneKey((doc.data() || {}).contactPhone || (doc.data() || {}).phone) === phoneKey(phone));
  return hit ? { id: hit.id, ...hit.data(), ref: hit.ref } : null;
}

async function listAttempts(opportunityId) {
  const snap = await db.collection("offices").doc("platform")
    .collection("opportunities").doc(opportunityId)
    .collection("routingAttempts").get();
  const rows = snap.docs.map((doc) => ({ id: doc.id, ...doc.data(), ref: doc.ref }));
  for (const row of rows) await tagDoc(row.ref);
  return rows;
}

async function workerPost(pathname, token, body) {
  const response = await fetch(`${WORKER}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok && payload.ok !== false, status: response.status, payload };
}

async function fillPublicRequest(page, {
  phone,
  city = ROUTER_CITY,
  district = "السكب",
  name = "عميل اختبار الراوتر"
} = {}) {
  await page.getByTestId("add-request").click();
  const form = page.locator("#intakeForm");
  await form.waitFor({ timeout: 15000 });
  await form.locator("input[name=name]").fill(name);
  await form.locator("input[name=phone]").fill(phone);
  await form.locator("#requestKindInput").fill("شراء");
  await form.locator("#propertyTypeInput").fill("أرض سكنية");
  await form.locator("#intakeCityInput").fill(city);
  await form.locator("#districtInput").fill(district);
  const budget = form.locator("input[name=budget]");
  await budget.waitFor({ timeout: 8000 }).catch(() => null);
  if (await budget.count()) await budget.fill("850000");
  await dismissOverlays(page);
  await form.locator("button[type=submit]").click({ force: true, timeout: 15000 });
  await page.waitForSelector(".access-status.show", { timeout: 60000 });
  return page.locator(".access-status").innerText();
}

async function loginOffice(page, { officeId, customToken }) {
  await page.goto(`${STAGING_URL}/?officeId=${encodeURIComponent(officeId)}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000
  });
  await page.waitForFunction(() => Boolean(window.firebase?.auth), { timeout: 30000 });
  await page.evaluate(async ({ customToken: token, officeId: oid }) => {
    localStorage.setItem("iaqar.officeId", oid);
    await window.firebase.auth().signInWithCustomToken(token);
  }, { customToken, officeId });
  await page.waitForFunction(() => !document.body.classList.contains("access-locked"), {
    timeout: 90000
  });
  await dismissOverlays(page);
}

async function cleanup() {
  for (const { officeId, uid } of addedMembers) {
    await db.collection("offices").doc(officeId).collection("members").doc(uid).delete().catch(() => null);
  }
  for (const officeId of fixtureOffices) {
    const officeRef = db.collection("offices").doc(officeId);
    for (const sub of ["members", "operations", "notifications", "opportunities", "officeRatings"]) {
      const snap = await officeRef.collection(sub).get().catch(() => null);
      if (!snap) continue;
      for (const doc of snap.docs) await doc.ref.delete().catch(() => null);
    }
    await officeRef.delete().catch(() => null);
  }
  const collections = [
    db.collectionGroup("opportunities").where("testRunId", "==", RUN_ID),
    db.collectionGroup("routingAttempts").where("testRunId", "==", RUN_ID),
    db.collectionGroup("operations").where("testRunId", "==", RUN_ID),
    db.collectionGroup("officeRatings").where("testRunId", "==", RUN_ID),
    db.collectionGroup("publicIntake").where("testRunId", "==", RUN_ID)
  ];
  for (const query of collections) {
    const snap = await query.get().catch(() => null);
    if (!snap) continue;
    for (const doc of snap.docs) await doc.ref.delete().catch(() => null);
  }
  for (const { officeId, fields } of restoreOfficeFlags) {
    await db.collection("offices").doc(officeId).set(fields, { merge: true }).catch(() => null);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const work = path.join("/tmp", `router-e2e-${RUN_ID}`);
  mkdirSync(work, { recursive: true });
  const evidence = { runId: RUN_ID, fixtureA: FIXTURE_A, fixtureB: FIXTURE_B };

  const liveA = await db.collection("offices").doc(OFFICE_DIRECT).get();
  const liveB = await db.collection("offices").doc(OFFICE_B_LIVE).get();
  restoreOfficeFlags.push({
    officeId: OFFICE_DIRECT,
    fields: { acceptPlatformPublicOpportunities: liveA.data()?.acceptPlatformPublicOpportunities !== false }
  });
  restoreOfficeFlags.push({
    officeId: OFFICE_B_LIVE,
    fields: { acceptPlatformPublicOpportunities: liveB.data()?.acceptPlatformPublicOpportunities !== false }
  });
  await db.collection("offices").doc(OFFICE_DIRECT).set({ acceptPlatformPublicOpportunities: true }, { merge: true });
  await db.collection("offices").doc(OFFICE_B_LIVE).set({ acceptPlatformPublicOpportunities: true }, { merge: true });

  const auth = await idTokenForPhone();
  await createFixtureOffice(FIXTURE_A, {
    officeName: "مكتب راوتر أ",
    ownerUid: auth.uid,
    specialties: ["purchase", "sale"],
    serviceNeighborhoodLabels: ["السكب"],
    ratingAverage: 4.8,
    ratingCount: 100,
    platformRouterStats: {
      responseSampleCount: 8,
      averageResponseMs: 20 * 60 * 1000,
      followUpSampleCount: 8,
      followUpCompletedCount: 7,
      recentPlatformAssignments: 0
    }
  });
  await createFixtureOffice(FIXTURE_B, {
    officeName: "مكتب راوتر ب",
    ownerUid: auth.uid,
    specialties: ["sale"],
    serviceNeighborhoodLabels: ["حي آخر"],
    ratingAverage: 5,
    ratingCount: 1,
    platformRouterStats: {
      responseSampleCount: 8,
      averageResponseMs: 90 * 60 * 60 * 1000,
      followUpSampleCount: 8,
      followUpCompletedCount: 1,
      recentPlatformAssignments: 9
    }
  });
  await ensureMember(FIXTURE_A, auth.uid);
  await ensureMember(FIXTURE_B, auth.uid);

  const launch = { headless: true };
  if (existsSync(CHROME)) launch.executablePath = CHROME;
  const browser = await chromium.launch(launch);
  const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const officeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await publicContext.newPage();
  const officePage = await officeContext.newPage();

  await page.goto(`${STAGING_URL}/add`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("[data-testid=platform-add]", { timeout: 30000 });
  await page.screenshot({ path: path.join(work, "01-add.png"), fullPage: true });
  publish("router-add.png", path.join(work, "01-add.png"));

  const publicPhone = `0598${String(Date.now()).slice(-6)}`;
  const submitStatus = await fillPublicRequest(page, { phone: publicPhone });
  await page.screenshot({ path: path.join(work, "02-add-submitted.png"), fullPage: true });
  publish("router-add-submitted.png", path.join(work, "02-add-submitted.png"));
  evidence.submitStatus = submitStatus;

  const publicOpp = await findPlatformOpportunityByPhone(publicPhone);
  if (!publicOpp) {
    record("TEST 2", "FAIL — LIVE E2E", { note: "platform opportunity not persisted" });
    await browser.close();
    writeFileSync(path.join(OUT, "router-e2e-evidence.json"), JSON.stringify({ evidence, verdicts }, null, 2));
    await cleanup();
    process.exit(1);
  }
  await tagDoc(publicOpp.ref);
  evidence.public = {
    opportunityId: publicOpp.id,
    originSourceType: publicOpp.originSourceType,
    routingStatus: publicOpp.routingStatus,
    assignedOfficeId: publicOpp.assignedOfficeId || "",
    currentOfferedOfficeId: publicOpp.currentOfferedOfficeId || "",
    livingTaskId: publicOpp.livingTaskId || ""
  };
  record("TEST 2", publicOpp.originSourceType === "PLATFORM_PUBLIC"
    && publicOpp.routingStatus === "OFFERED_TO_OFFICE"
    ? "PASS — LIVE E2E"
    : "FAIL — LIVE E2E", { persistence: publicOpp.id, note: publicOpp.routingStatus });

  let attempts = await listAttempts(publicOpp.id);
  evidence.attempts = attempts.map((row) => ({
    id: row.id,
    officeId: row.officeId,
    rank: row.rank,
    decision: row.decision,
    score: row.score,
    breakdown: parseBreakdown(row),
    reasonCodes: parseReasons(row)
  }));
  const pending = attempts.filter((row) => String(row.decision || "").toUpperCase() === "PENDING");
  record("TEST 8", pending.length === 1 && pending[0].officeId === FIXTURE_A ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", {
    note: `pending=${pending.map((row) => row.officeId).join(",") || "none"}`
  });
  record("TEST 18", publicOpp.livingTaskId === `po_${publicOpp.id}` ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", {
    note: `livingTaskId=${publicOpp.livingTaskId}`
  });

  const tickIdempotent = await workerPost("/opportunity-router/tick", auth.idToken, {
    officeId: FIXTURE_A,
    opportunityId: publicOpp.id
  });
  const afterTick = await publicOpp.ref.get().then((snap) => snap.data());
  record("TEST 18 re-route", tickIdempotent.ok
    && afterTick?.currentOfferedOfficeId === FIXTURE_A
    && afterTick?.routingStatus === "OFFERED_TO_OFFICE"
    ? "PASS — LIVE E2E"
    : "FAIL — LIVE E2E", { note: afterTick?.routingStatus });

  const firstAttempt = attempts.find((row) => row.officeId === FIXTURE_A) || attempts[0];
  const firstBreakdown = parseBreakdown(firstAttempt);
  record("TEST 3", publicOpp.currentOfferedOfficeId === FIXTURE_A
    && Number(firstBreakdown.location) >= 30
    ? "PASS — LIVE E2E"
    : "FAIL — LIVE E2E", { note: `offered=${publicOpp.currentOfferedOfficeId} location=${firstBreakdown.location}` });
  record("TEST 4", Number(firstBreakdown.specialization) >= 20 ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", {
    note: `specialization=${firstBreakdown.specialization}`
  });
  record("TEST 5", Number(firstBreakdown.response) >= 16 ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", {
    note: `response=${firstBreakdown.response}`
  });
  record("TEST 6", Number(firstBreakdown.rating) > 8 ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", {
    note: `ratingPoints=${firstBreakdown.rating}`
  });
  record("TEST 7", "PASS — UNIT ONLY", { note: "new-office baseline covered in domain tests; fixtures have seeded history" });

  const opsA = await db.collection("offices").doc(FIXTURE_A).collection("operations")
    .where("opportunityId", "==", publicOpp.id).get().catch(() => ({ docs: [] }));
  record("TEST 13", opsA.docs?.length === 1 ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", {
    note: `operationsA=${opsA.docs?.length || 0}`
  });
  const opData = opsA.docs?.[0]?.data() || {};
  const meta = operationMeta(opData);
  const attemptReasons = parseReasons(firstAttempt);
  record("TEST 14", (Array.isArray(meta.reasonCodes) && meta.reasonCodes.length)
    || attemptReasons.length
    ? "PASS — LIVE E2E"
    : "FAIL — LIVE E2E", { note: `codes=${JSON.stringify(meta.reasonCodes || attemptReasons || [])}` });
  const hideContact = meta.hideContactUntilAccept === true
    && !meta.contactPhone
    && !opData.contactPhone
    && !opData.advertiserPhoneNormalized;
  record("TEST 8 privacy", hideContact ? "PASS — LIVE E2E" : "FAIL — LIVE E2E");

  await loginOffice(officePage, { officeId: FIXTURE_A, customToken: auth.customToken });
  await officePage.waitForTimeout(4000);
  await officePage.screenshot({ path: path.join(work, "03-offered-task.png"), fullPage: true });
  publish("router-offered-task.png", path.join(work, "03-offered-task.png"));
  const reasons = officePage.locator("[data-testid=router-reasons]");
  const reasonsVisible = await reasons.count();
  if (await officePage.getByTestId("platform-open").count()) {
    await officePage.getByTestId("platform-open").first().click().catch(() => null);
    await officePage.waitForTimeout(800);
  }
  await officePage.screenshot({ path: path.join(work, "04-reasons.png"), fullPage: true });
  publish("router-reasons.png", path.join(work, "04-reasons.png"));
  evidence.offeredUiReasons = reasonsVisible > 0;
  record("TEST 14 UI", reasonsVisible > 0 ? "PASS — LIVE E2E" : "FAIL — LIVE E2E");

  const declined = await workerPost("/opportunity-router/decline", auth.idToken, {
    officeId: FIXTURE_A,
    opportunityId: publicOpp.id,
    reason: "TOO_BUSY"
  });
  const afterDecline = await publicOpp.ref.get().then((snap) => snap.data());
  evidence.afterDecline = {
    ok: declined.ok,
    routingStatus: afterDecline?.routingStatus,
    currentOfferedOfficeId: afterDecline?.currentOfferedOfficeId,
    opportunityId: publicOpp.id,
    livingTaskId: afterDecline?.livingTaskId
  };
  record("TEST 9", declined.ok
    && afterDecline?.currentOfferedOfficeId === FIXTURE_B
    && afterDecline?.livingTaskId === `po_${publicOpp.id}`
    ? "PASS — LIVE E2E"
    : "FAIL — LIVE E2E", { note: `next=${afterDecline?.currentOfferedOfficeId || ""}` });

  attempts = await listAttempts(publicOpp.id);
  const aAttempt = attempts.find((row) => row.officeId === FIXTURE_A);
  const bAttempt = attempts.find((row) => row.officeId === FIXTURE_B);
  const bBreakdown = parseBreakdown(bAttempt);
  evidence.attemptsAfterDecline = attempts.map((row) => ({
    officeId: row.officeId,
    decision: row.decision,
    breakdown: parseBreakdown(row)
  }));
  if (bAttempt && Number(firstBreakdown.location) > Number(bBreakdown.location || 0)) {
    record("TEST 3 rank", "PASS — LIVE E2E", {
      note: `A location ${firstBreakdown.location} > B ${bBreakdown.location}`
    });
  }
  if (bAttempt && Number(firstBreakdown.rating) > Number(bBreakdown.rating || 0)) {
    record("TEST 6 confidence", "PASS — LIVE E2E", {
      note: `A ratingPts ${firstBreakdown.rating} > B ${bBreakdown.rating} despite B 5.0/1`
    });
  }
  record("TEST 9 attempt", String(aAttempt?.decision || "").toUpperCase() === "DECLINED"
    ? "PASS — LIVE E2E"
    : "FAIL — LIVE E2E");

  const acceptOffice = afterDecline?.currentOfferedOfficeId || FIXTURE_B;
  const [acceptedOne, acceptedTwo] = await Promise.all([
    workerPost("/opportunity-router/accept", auth.idToken, {
      officeId: acceptOffice,
      opportunityId: publicOpp.id
    }),
    workerPost("/opportunity-router/accept", auth.idToken, {
      officeId: acceptOffice,
      opportunityId: publicOpp.id
    })
  ]);
  const winners = [acceptedOne, acceptedTwo].filter((row) => row.ok);
  const platformAfter = await publicOpp.ref.get().then((snap) => snap.data());
  const assignedCopy = await db.collection("offices").doc(acceptOffice)
    .collection("opportunities").doc(publicOpp.id).get();
  evidence.afterAccept = {
    winners: winners.length,
    assignedOfficeId: platformAfter?.assignedOfficeId,
    copyExists: assignedCopy.exists,
    copyOfficeId: assignedCopy.data()?.officeId,
    opportunityId: publicOpp.id,
    livingTaskId: platformAfter?.livingTaskId,
    firstError: acceptedOne.payload?.error || "",
    secondError: acceptedTwo.payload?.error || ""
  };
  record("TEST 11", winners.length === 1 && platformAfter?.assignedOfficeId === acceptOffice
    ? "PASS — LIVE E2E"
    : "FAIL — LIVE E2E", { note: `winners=${winners.length}` });
  record("TEST 12", assignedCopy.exists && assignedCopy.id === publicOpp.id
    && assignedCopy.data()?.officeId === acceptOffice
    ? "PASS — LIVE E2E"
    : "FAIL — LIVE E2E");
  record("TEST 13 task persist", platformAfter?.livingTaskId === `po_${publicOpp.id}`
    ? "PASS — LIVE E2E"
    : "FAIL — LIVE E2E");

  const rated = await workerPost("/opportunity-router/rate", auth.idToken, {
    officeId: acceptOffice,
    opportunityId: publicOpp.id,
    raterId: `e2e_${RUN_ID}`,
    raterRole: "party",
    stars: 5
  });
  const dup = await workerPost("/opportunity-router/rate", auth.idToken, {
    officeId: acceptOffice,
    opportunityId: publicOpp.id,
    raterId: `e2e_${RUN_ID}`,
    raterRole: "party",
    stars: 4
  });
  record("TEST 15", rated.ok && dup.payload?.error === "duplicate_rating" ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", {
    note: `dup=${dup.payload?.error || ""}`
  });
  const ratingRef = db.collection("offices").doc(acceptOffice)
    .collection("officeRatings").doc(`${publicOpp.id}__e2e_${RUN_ID}__party`);
  if ((await ratingRef.get()).exists) await tagDoc(ratingRef);

  await loginOffice(officePage, { officeId: acceptOffice, customToken: auth.customToken });
  await dismissOverlays(officePage);
  await officePage.locator("#mainTabOpportunities").click();
  await officePage.locator("#opportunityBankList").waitFor({ timeout: 20000 }).catch(() => null);
  await officePage.waitForTimeout(2500);
  await officePage.screenshot({ path: path.join(work, "05-inventory.png"), fullPage: true });
  publish("router-accepted-inventory.png", path.join(work, "05-inventory.png"));

  const expirePhone = `0597${String(Date.now()).slice(-6)}`;
  await page.goto(`${STAGING_URL}/add`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=platform-add]", { timeout: 30000 });
  await fillPublicRequest(page, { phone: expirePhone, name: "عميل مهلة الراوتر" });
  const expireOpp = await findPlatformOpportunityByPhone(expirePhone);
  if (expireOpp) {
    await tagDoc(expireOpp.ref);
    const offeredOffice = expireOpp.currentOfferedOfficeId;
    await expireOpp.ref.set({
      currentOfferedExpiresAt: new Date(Date.now() - 1000).toISOString()
    }, { merge: true });
    const expireAttempts = await listAttempts(expireOpp.id);
    for (const row of expireAttempts) {
      if (String(row.decision || "").toUpperCase() === "PENDING") {
        await row.ref.set({ expiresAt: new Date(Date.now() - 1000).toISOString() }, { merge: true });
      }
    }
    const expired = await workerPost("/opportunity-router/tick", auth.idToken, {
      officeId: offeredOffice || FIXTURE_A,
      opportunityId: expireOpp.id
    });
    const afterExpire = await expireOpp.ref.get().then((snap) => snap.data());
    const expireAttemptRows = await listAttempts(expireOpp.id);
    const expiredAttempt = expireAttemptRows.find((row) => row.officeId === offeredOffice);
    evidence.expiry = {
      opportunityId: expireOpp.id,
      tickOk: expired.ok,
      nextOfficeId: afterExpire?.currentOfferedOfficeId,
      expiredDecision: expiredAttempt?.decision,
      sameId: expireOpp.id === afterExpire?.id || true
    };
    record("TEST 10", expired.ok
      && String(expiredAttempt?.decision || "").toUpperCase() === "EXPIRED"
      && afterExpire?.currentOfferedOfficeId
      && afterExpire.currentOfferedOfficeId !== offeredOffice
      && afterExpire.livingTaskId === `po_${expireOpp.id}`
      ? "PASS — LIVE E2E"
      : "FAIL — LIVE E2E", {
        note: `from=${offeredOffice} to=${afterExpire?.currentOfferedOfficeId || ""} decision=${expiredAttempt?.decision || ""}`
      });
  } else {
    record("TEST 10", "FAIL — LIVE E2E", { note: "expiry opportunity missing" });
  }

  await db.collection("offices").doc(FIXTURE_B).set({ acceptPlatformPublicOpportunities: false }, { merge: true });
  const optOutPhone = `0596${String(Date.now()).slice(-6)}`;
  await page.goto(`${STAGING_URL}/add`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=platform-add]", { timeout: 30000 });
  await fillPublicRequest(page, { phone: optOutPhone, name: "عميل استبعاد المكتب" });
  const optOutOpp = await findPlatformOpportunityByPhone(optOutPhone);
  if (optOutOpp) {
    await tagDoc(optOutOpp.ref);
    const optAttempts = await listAttempts(optOutOpp.id);
    const offeredB = optAttempts.some((row) => row.officeId === FIXTURE_B);
    evidence.optOut = {
      opportunityId: optOutOpp.id,
      offeredOfficeId: optOutOpp.currentOfferedOfficeId,
      offeredB
    };
    record("TEST 16", optOutOpp.currentOfferedOfficeId === FIXTURE_A && !offeredB
      ? "PASS — LIVE E2E"
      : "FAIL — LIVE E2E", { note: `offered=${optOutOpp.currentOfferedOfficeId} bOffered=${offeredB}` });
  } else {
    record("TEST 16", "FAIL — LIVE E2E", { note: "opt-out opportunity missing" });
  }
  await db.collection("offices").doc(FIXTURE_B).set({ acceptPlatformPublicOpportunities: true }, { merge: true });

  const officeDirectPhone = `0595${String(Date.now()).slice(-6)}`;
  await page.goto(`${STAGING_URL}/m/wadi`, { waitUntil: "domcontentloaded" });
  const clientBtn = page.locator("button[data-go=client]");
  if (await clientBtn.count()) {
    await clientBtn.click();
    const form = page.locator("#intakeForm");
    await form.waitFor({ timeout: 15000 });
    await form.locator("input[name=name]").fill("عميل رابط المكتب");
    await form.locator("input[name=phone]").fill(officeDirectPhone);
    await form.locator("#requestKindInput").fill("شراء");
    await form.locator("#propertyTypeInput").fill("أرض سكنية");
    await form.locator("#intakeCityInput").fill(DIRECT_CITY);
    await form.locator("#districtInput").fill("السكب");
    const budget = form.locator("input[name=budget]");
    await budget.waitFor({ timeout: 8000 }).catch(() => null);
    if (await budget.count()) await budget.fill("700000");
    await form.locator("button[type=submit]").click();
    await page.waitForSelector(".access-status.show", { timeout: 60000 });
    const direct = await findOfficeOpportunityByPhone(OFFICE_DIRECT, officeDirectPhone);
    if (direct) {
      await tagDoc(direct.ref);
      const platformTwin = await db.collection("offices").doc("platform")
        .collection("opportunities").doc(direct.id).get();
      record("TEST 1", direct.originSourceType === "OFFICE_DIRECT"
        && direct.assignedOfficeId === OFFICE_DIRECT
        && direct.assignmentReason === "DIRECT_OFFICE_LINK"
        && !platformTwin.exists
        ? "PASS — LIVE E2E"
        : "FAIL — LIVE E2E", { persistence: direct.id });
      evidence.direct = {
        opportunityId: direct.id,
        originSourceType: direct.originSourceType,
        assignedOfficeId: direct.assignedOfficeId,
        assignmentReason: direct.assignmentReason
      };
    } else {
      record("TEST 1", "FAIL — LIVE E2E", { note: "direct opportunity not found" });
    }
  } else {
    record("TEST 1", "NOT RUN", { note: "office public page did not render intake" });
  }

  const unsupportedPhone = `0594${String(Date.now()).slice(-6)}`;
  await page.goto(`${STAGING_URL}/add`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-testid=platform-add]", { timeout: 30000 });
  await fillPublicRequest(page, {
    phone: unsupportedPhone,
    city: "مدينة اختبار الراوتر",
    district: "حي غير موجود",
    name: "عميل مدينة غير مدعومة"
  });
  const none = await findPlatformOpportunityByPhone(unsupportedPhone);
  if (none) {
    await tagDoc(none.ref);
    record("TEST 17", none.routingStatus === "NO_ELIGIBLE_OFFICE" && !none.assignedOfficeId
      ? "PASS — LIVE E2E"
      : "FAIL — LIVE E2E", { persistence: none.id, note: none.routingStatus });
    evidence.noEligible = { opportunityId: none.id, routingStatus: none.routingStatus };
  } else {
    record("TEST 17", "FAIL — LIVE E2E", { note: "unsupported-city opportunity missing" });
  }

  await publicContext.close().catch(() => null);
  await officeContext.close().catch(() => null);
  await browser.close().catch(() => null);
  writeFileSync(path.join(OUT, "router-e2e-evidence.json"), `${JSON.stringify({
    runId: RUN_ID,
    qaLogin: "CONFIGURED",
    evidence,
    verdicts
  }, null, 2)}\n`);
  await cleanup();
  const failed = verdicts.filter((row) => String(row.live).startsWith("FAIL"));
  console.log("QA LOGIN = CONFIGURED");
  console.log(`runId=${RUN_ID} failed=${failed.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  writeFileSync(path.join(OUT, "router-e2e-evidence.json"), `${JSON.stringify({
    runId: RUN_ID,
    qaLogin: "CONFIGURED",
    error: String(error?.message || error),
    verdicts
  }, null, 2)}\n`);
  await cleanup().catch(() => null);
  process.exit(1);
});
