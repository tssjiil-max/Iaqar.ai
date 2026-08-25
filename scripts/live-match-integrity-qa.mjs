#!/usr/bin/env node
/**
 * Dedicated QA office: persist canonical request+offer, run NEW Worker matching
 * in-process against staging Firestore (no hosting/Worker deploy).
 */
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { chromium } from "playwright";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";
import worker from "../worker/src/index.js";
import {
  consumeDailyTaskDiagnostics,
  mapOperationsItemsToDailyTasks
} from "../src/v2/content/daily-tasks/domain.js";

const PROJECT_ID = "iaqar-ai-staging";
const STAGING_URL = "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const STAGING_WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const NORMAL_OFFICE_ID = "staging-logo-live-20260807";
const OFFICE_ID = "qa-e2e-dedicated";
const PHONE = "0511123456";
const PASSWORD = "StagingLogo9";
const OUT = process.env.LIVE_E2E_OUT || "/opt/cursor/artifacts";
const RUN_ID = `livee2e_matchint_${Date.now().toString(36)}`;
const REQUEST_ID = `opp_${RUN_ID}_req`;
const OFFER_ID = `opp_${RUN_ID}_offer`;
const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const parsedSa = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsedSa.serviceAccount) {
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON missing");
  process.exit(1);
}
const sa = parsedSa.serviceAccount;
const app = admin.initializeApp({ credential: admin.cert(sa), projectId: PROJECT_ID });
const db = getFirestore(app);
const office = db.collection("offices").doc(OFFICE_ID);

const workerEnv = {
  FIREBASE_PROJECT_ID: PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: sa.client_email,
  FIREBASE_PRIVATE_KEY: sa.private_key,
  FIREBASE_PRIVATE_KEY_ID: sa.private_key_id,
  DEPLOYMENT_ENV: "staging"
};

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
    area: 120,
    rooms: 3,
    version: 1,
    isTestFixture: true,
    testRunId: RUN_ID,
    createdBy: "E2E",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };
}

async function ensureQaOffice() {
  const source = db.collection("offices").doc(NORMAL_OFFICE_ID);
  const [sourceSnap, membersSnap] = await Promise.all([source.get(), source.collection("members").get()]);
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
    ...doc.data(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true })));
}

async function persistCanonicalPair() {
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
    contactPhone: "0501111842",
    advertiserPhoneNormalized: "+966501111842",
    contactName: `عميل QA ${RUN_ID}`
  });
  await office.collection("opportunities").doc(OFFER_ID).set({
    ...stamp(),
    opportunityKind: "OFFER",
    kind: "owner_offer",
    purpose: "RENT",
    advertiserRole: "OWNER",
    contactType: "owner",
    salePrice: 50000,
    annualRent: 50000,
    priceOrBudget: 50000,
    area: 125,
    contactPhone: "0502221842",
    advertiserPhoneNormalized: "+966502221842",
    contactName: `مالك QA ${RUN_ID}`
  });
  const [reqSnap, offerSnap] = await Promise.all([
    office.collection("opportunities").doc(REQUEST_ID).get(),
    office.collection("opportunities").doc(OFFER_ID).get()
  ]);
  if (!reqSnap.exists || !offerSnap.exists) throw new Error("canonical persist confirmation failed");
  return { request: reqSnap.data(), offer: offerSnap.data() };
}

async function idToken() {
  const initRes = await fetch(`${STAGING_URL}/__/firebase/init.json`);
  const { apiKey } = await initRes.json();
  const loginRes = await fetch(`${STAGING_WORKER}/auth/phone-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: PHONE, password: PASSWORD, apiKey })
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok || !loginBody.customToken) {
    throw new Error(`phone-login failed ${loginRes.status} ${JSON.stringify(loginBody)}`);
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
  if (!signRes.ok || !signBody.idToken) throw new Error(`signIn failed ${signRes.status}`);
  return { idToken: signBody.idToken, customToken: loginBody.customToken, apiKey };
}

async function runMatching(token) {
  const response = await worker.fetch(new Request("https://iaqar.test/matching/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ officeId: OFFICE_ID, opportunityId: REQUEST_ID, notify: false })
  }), workerEnv);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

function matchItem(doc) {
  const item = doc.data() || {};
  return {
    id: doc.id,
    recordId: doc.id,
    recordType: "match",
    matchId: doc.id,
    clientRequestId: item.clientRequestId || item.requestId || "",
    ownerOfferId: item.ownerOfferId || item.offerId || "",
    requestId: item.requestId || item.clientRequestId || "",
    offerId: item.offerId || item.ownerOfferId || "",
    integrityStatus: item.integrityStatus || "",
    integrityReason: item.integrityReason || "",
    propertyType: item.propertyType || "",
    purpose: item.purpose || "",
    district: item.district || "",
    city: item.city || "",
    createdAt: item.createdAt,
    isTestFixture: true,
    testRunId: RUN_ID,
    createdBy: "E2E"
  };
}

async function mapperCheck() {
  const [matches, opps] = await Promise.all([
    office.collection("matches").limit(50).get(),
    office.collection("opportunities").limit(50).get()
  ]);
  const items = [
    ...matches.docs.map(matchItem),
    ...opps.docs.map((doc) => {
      const item = doc.data() || {};
      return {
        id: `opp-${doc.id}`,
        recordId: doc.id,
        recordType: "opportunity",
        opportunityId: doc.id,
        propertyType: item.propertyType || "",
        purpose: item.purpose || "",
        district: item.district || "",
        city: item.city || "",
        salePrice: item.salePrice ?? item.annualRent ?? item.price,
        budget: item.budget ?? item.priceMax,
        area: item.area || 0,
        contactPhone: item.contactPhone || "",
        contactName: item.contactName || "",
        isTestFixture: item.isTestFixture === true,
        testRunId: item.testRunId || "",
        createdBy: item.createdBy || ""
      };
    })
  ];
  consumeDailyTaskDiagnostics();
  const mapped = mapOperationsItemsToDailyTasks(items, new Date(), { officeId: OFFICE_ID });
  const hidden = consumeDailyTaskDiagnostics();
  return { mapped, hidden, matchDocs: matches.docs.map((doc) => ({ id: doc.id, ...doc.data() })) };
}

async function cleanup() {
  for (const name of ["opportunities", "matches", "operations", "matchDiagnostics"]) {
    const snap = await office.collection(name).where("testRunId", "==", RUN_ID).limit(50).get();
    await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  }
  await office.collection("opportunities").doc(REQUEST_ID).delete().catch(() => {});
  await office.collection("opportunities").doc(OFFER_ID).delete().catch(() => {});
}

function startLocalServer() {
  const publicDir = path.join(ROOT, "public");
  const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2"
  };
  const server = http.createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    if (pathname === "/") pathname = "/index.html";
    const filePath = path.normalize(path.join(publicDir, pathname));
    if (!filePath.startsWith(publicDir)) {
      res.writeHead(403); res.end(); return;
    }
    import("node:fs").then((fs) => {
      fs.readFile(filePath, (error, data) => {
        if (error) {
          res.writeHead(404); res.end("not found"); return;
        }
        res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
        res.end(data);
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function captureUi({ customToken, matchId }) {
  const { server, port } = await startLocalServer();
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("**/__/firebase/**", async (route) => {
    const incoming = new URL(route.request().url());
    const dest = `${STAGING_URL}${incoming.pathname}${incoming.search}`;
    const response = await route.fetch(dest);
    await route.fulfill({ response });
  });
  await page.goto(`${origin}/?env=staging&officeId=${encodeURIComponent(OFFICE_ID)}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000
  });
  await page.waitForFunction(() => window.firebase && window.firebase.auth, { timeout: 30000 });
  await page.evaluate(async ({ customToken, officeId }) => {
    await window.firebase.auth().signInWithCustomToken(customToken);
    localStorage.setItem("iaqar.officeId", officeId);
  }, { customToken, officeId: OFFICE_ID });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(4000);
  const card = page.locator(`[data-cv2-exec-task][data-match-id="${matchId}"]`).first();
  const cardCount = await page.locator("[data-cv2-exec-task]").count();
  mkdirSync(OUT, { recursive: true });
  const shots = {};
  shots.task = path.join(OUT, "match_integrity_new_task.png");
  await page.screenshot({ path: shots.task, fullPage: true });
  if (await card.count()) {
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shots.task, fullPage: false });
    const reveal = card.locator("[data-cv2-exec-reveal], [data-testid='match-open']").first();
    if (await reveal.count()) await reveal.click();
    await page.waitForTimeout(800);
    shots.data = path.join(OUT, "match_integrity_view_data.png");
    await page.screenshot({ path: shots.data, fullPage: false });
    const details = card.locator("[data-testid='match-details'], [data-cv2-exec-secondary='open_offer']").first();
    if (await details.count()) {
      await details.click();
      await page.waitForTimeout(1200);
    }
    shots.offer = path.join(OUT, "match_integrity_offer_details.png");
    await page.screenshot({ path: shots.offer, fullPage: false });
  }
  const html = await page.content();
  writeFileSync(path.join(OUT, "match_integrity_ui.html"), html);
  await browser.close();
  server.close();
  return { shots, cardCount, origin };
}

async function main() {
  await ensureQaOffice();
  const persisted = await persistCanonicalPair();
  const auth = await idToken();
  const matching = await runMatching(auth.idToken);
  const created = matching.body?.matches || [];
  const matchId = created[0]?.matchId || "";
  if (matchId) {
    await office.collection("matches").doc(matchId).set({
      isTestFixture: true,
      testRunId: RUN_ID,
      createdBy: "E2E",
      officeId: OFFICE_ID
    }, { merge: true });
  }
  const first = await mapperCheck();
  const reload = await mapperCheck();
  const qaMatch = (first.matchDocs || []).find((row) => row.requestId === REQUEST_ID && row.offerId === OFFER_ID)
    || (first.matchDocs || []).find((row) => row.matchId === matchId || row.id === matchId);
  const task = first.mapped.find((row) => row.matchId === (qaMatch?.id || matchId)
    || (row.candidates || []).some((item) => item.matchId === (qaMatch?.id || matchId)));
  const reloadTask = reload.mapped.find((row) => row.matchId === (qaMatch?.id || matchId)
    || (row.candidates || []).some((item) => item.matchId === (qaMatch?.id || matchId)));

  let ui = { shots: {}, cardCount: 0, error: "" };
  try {
    ui = await captureUi({ customToken: auth.customToken, matchId: qaMatch?.id || matchId });
  } catch (error) {
    ui.error = error.message;
    console.warn("UI capture failed", error);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    officeId: OFFICE_ID,
    persisted: {
      requestId: REQUEST_ID,
      offerId: OFFER_ID,
      requestExists: Boolean(persisted.request),
      offerExists: Boolean(persisted.offer)
    },
    matching,
    qaMatch: qaMatch ? {
      matchId: qaMatch.id || qaMatch.matchId,
      requestId: qaMatch.requestId || qaMatch.clientRequestId,
      offerId: qaMatch.offerId || qaMatch.ownerOfferId,
      integrityStatus: qaMatch.integrityStatus,
      integrityReason: qaMatch.integrityReason
    } : null,
    mapper: {
      visible: first.mapped.length,
      hidden: first.hidden.length,
      taskId: task?.id || "",
      requestId: task?.requestId || "",
      offerId: task?.offerId || "",
      typePurpose: task?.typePurposeLine || task?.propertyLine || "",
      place: task?.placeLine || "",
      money: task?.moneyLine || "",
      reference: task?.referenceCode || ""
    },
    reload: {
      sameTaskId: Boolean(task && reloadTask && task.id === reloadTask.id),
      sameMatchId: Boolean(task && reloadTask && task.matchId === reloadTask.matchId),
      sameRequestId: Boolean(task && reloadTask && task.requestId === reloadTask.requestId),
      sameOfferId: Boolean(task && reloadTask && task.offerId === reloadTask.offerId)
    },
    ui
  };
  mkdirSync(OUT, { recursive: true });
  mkdirSync("/workspace/qa", { recursive: true });
  writeFileSync(`${OUT}/match-integrity-live-qa.json`, JSON.stringify(report, null, 2));
  writeFileSync("/workspace/qa/match-integrity-live-qa.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    matchingStatus: matching.status,
    matchCount: matching.body?.matchCount,
    qaMatch: report.qaMatch,
    mapper: report.mapper,
    reload: report.reload,
    uiError: ui.error || "",
    cardCount: ui.cardCount
  }, null, 2));

  const verified = Boolean(
    report.qaMatch?.requestId === REQUEST_ID
    && report.qaMatch?.offerId === OFFER_ID
    && report.qaMatch?.integrityStatus === "VALID"
    && task?.requestId === REQUEST_ID
    && task?.offerId === OFFER_ID
    && report.reload.sameMatchId
    && report.reload.sameRequestId
    && report.reload.sameOfferId
  );
  if (!verified) {
    console.error("MATCH INTEGRITY NOT VERIFIED");
    await app.delete();
    process.exit(2);
  }
  console.log("MATCH INTEGRITY VERIFIED — READY FOR STAGING DEPLOY REVIEW");
  await cleanup();
  await app.delete();
}

main().catch(async (error) => {
  console.error(error);
  try { await cleanup(); } catch {}
  process.exit(1);
});
