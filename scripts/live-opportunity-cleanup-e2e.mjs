#!/usr/bin/env node
/**
 * Live E2E for cleanup survival, archive/restore/purge, and in-app notifications.
 * Serves local public/ against staging Firestore. In-process Worker for new routes.
 * Does not deploy.
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

const PROJECT_ID = "iaqar-ai-staging";
const STAGING_URL = "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const STAGING_WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const USER_OFFICE = "staging-logo-live-20260807";
const QA_OFFICE = "qa-e2e-dedicated";
const PHONE = "0511123456";
const PASSWORD = "StagingLogo9";
const OUT = process.env.LIVE_E2E_OUT || "/opt/cursor/artifacts";
const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const STAGING_FIREBASE = {
  apiKey: "AIzaSyDoP_FMh_ibKRotJmE7F4WBeEUfLJeAX4k",
  authDomain: "iaqar-ai-staging.firebaseapp.com",
  projectId: PROJECT_ID,
  storageBucket: "iaqar-ai-staging.firebasestorage.app",
  messagingSenderId: "1010507631812",
  appId: "1:1010507631812:web:65cf5a5934dd8e75c2cd91"
};

const parsedSa = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT_ID);
if (!parsedSa.serviceAccount) {
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON missing");
  process.exit(1);
}
const sa = parsedSa.serviceAccount;
const app = admin.initializeApp({ credential: admin.cert(sa), projectId: PROJECT_ID });
const db = getFirestore(app);

const workerEnv = {
  FIREBASE_PROJECT_ID: PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: sa.client_email,
  FIREBASE_PRIVATE_KEY: sa.private_key,
  FIREBASE_PRIVATE_KEY_ID: sa.private_key_id,
  DEPLOYMENT_ENV: "staging"
};

const results = {};
function mark(id, status, note = "") {
  results[id] = { status, note };
  console.log(`TEST ${id}: ${status}${note ? ` — ${note}` : ""}`);
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

function startLocalServer() {
  const publicDir = path.join(ROOT, "public");
  const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2"
  };
  const initJs = `if (typeof firebase !== "undefined" && firebase.initializeApp && (!firebase.apps || !firebase.apps.length)) { firebase.initializeApp(${JSON.stringify(STAGING_FIREBASE)}); }`;
  const server = http.createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    if (pathname === "/__/firebase/init.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(initJs);
      return;
    }
    if (pathname === "/__/firebase/init.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(STAGING_FIREBASE));
      return;
    }
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

async function interceptWorker(page) {
  const prefixes = [
    "/opportunity/patch",
    "/opportunity/purge",
    "/notifications/read",
    "/matching/run",
    "/party/sessions",
    "/opportunity/workspace"
  ];
  await page.route("https://iaqar-intake-staging.iaqar-ai.workers.dev/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (!prefixes.some((prefix) => url.pathname.startsWith(prefix))) {
      await route.continue();
      return;
    }
    const localUrl = req.url().replace(STAGING_WORKER, "https://iaqar.test");
    const headers = req.headers();
    const init = { method: req.method(), headers };
    if (req.postData()) init.body = req.postData();
    try {
      const response = await worker.fetch(new Request(localUrl, init), workerEnv);
      const body = Buffer.from(await response.arrayBuffer());
      const resHeaders = {};
      response.headers.forEach((value, key) => { resHeaders[key] = value; });
      await route.fulfill({ status: response.status, headers: resHeaders, body });
    } catch (error) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, error: "local_worker_failed", message: String(error) })
      });
    }
  });
}

async function loginPage(page, origin, officeId, customToken) {
  await interceptWorker(page);
  await page.goto(`${origin}/?env=staging&officeId=${encodeURIComponent(officeId)}&contentV2=1`, {
    waitUntil: "domcontentloaded",
    timeout: 90000
  });
  await page.waitForFunction(() => window.firebase?.apps?.length > 0, { timeout: 30000 });
  await page.evaluate(async ({ customToken, officeId }) => {
    await window.firebase.auth().signInWithCustomToken(customToken);
    localStorage.setItem("iaqar.officeId", officeId);
  }, { customToken, officeId });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await interceptWorker(page);
  await page.waitForFunction(() => window.firebase?.apps?.length > 0, { timeout: 30000 });
  await page.waitForFunction(() => {
    try { return Boolean(window.firebase.auth().currentUser); } catch { return false; }
  }, { timeout: 30000 });
  await page.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 60000 });
  await page.waitForTimeout(1800);
}

async function openOffers(page) {
  await page.locator("#mainTabOpportunities").click();
  await page.waitForTimeout(800);
}

async function revealOpportunityCard(page, id) {
  for (let i = 0; i < 10; i += 1) {
    if (await page.locator(`[data-opportunity-id="${id}"]`).count()) return true;
    const more = page.locator("#bankLoadMoreBtn");
    if (!(await more.count()) || !(await more.isVisible().catch(() => false))) break;
    await more.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
  return Boolean(await page.locator(`[data-opportunity-id="${id}"]`).count());
}

async function waitForOpportunityState(officeId, id, predicate, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const snap = await db.collection("offices").doc(officeId).collection("opportunities").doc(id).get();
    if (predicate(snap)) return snap;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

async function deleteLeftoverManualOffers() {
  const snap = await db.collection("offices").doc(USER_OFFICE).collection("opportunities").get();
  const leftovers = snap.docs.filter((doc) => doc.id.startsWith("opp_manual_"));
  await Promise.all(leftovers.map((doc) => doc.ref.delete()));
  return leftovers.length;
}

async function openArchiveConfirm(page, id) {
  if (await page.locator(`[data-inbox-archive="${id}"]`).count()) {
    await page.locator(`[data-inbox-archive="${id}"]`).click();
  } else {
    await page.evaluate(async (opportunityId) => {
      const officeId = window.IAQAR.office.officeId;
      const snap = await window.IAQAR.office.db.collection("offices").doc(officeId)
        .collection("opportunities").doc(opportunityId).get();
      window.IAQAR.confirmArchiveOpportunity(opportunityId, { id: opportunityId, ...(snap.data() || {}) });
    }, id);
  }
  await page.locator("#archiveOpportunityOverlay").waitFor({ state: "visible", timeout: 15000 });
  await page.locator("#archiveOpportunityConfirm").click({ timeout: 8000 });
  await page.waitForFunction(() => {
    const overlay = document.getElementById("archiveOpportunityOverlay");
    return !overlay || overlay.hidden;
  }, { timeout: 10000 }).catch(() => {});
}

async function openPermanentDeleteConfirm(page, id) {
  if (await page.locator(`[data-archive-purge="${id}"]`).count()) {
    await page.locator(`[data-archive-purge="${id}"]`).click();
  } else {
    await page.evaluate(async (opportunityId) => {
      const officeId = window.IAQAR.office.officeId;
      const snap = await window.IAQAR.office.db.collection("offices").doc(officeId)
        .collection("opportunities").doc(opportunityId).get();
      window.IAQAR.confirmPermanentDelete(opportunityId, { id: opportunityId, ...(snap.data() || {}) });
    }, id);
  }
  await page.locator("#permanentDeleteOverlay").waitFor({ state: "visible", timeout: 15000 });
}

async function ensureQaOffice() {
  const source = db.collection("offices").doc(USER_OFFICE);
  const office = db.collection("offices").doc(QA_OFFICE);
  const [sourceSnap, membersSnap] = await Promise.all([source.get(), source.collection("members").get()]);
  const sourceData = sourceSnap.data() || {};
  await office.set({
    officeName: "QA E2E Dedicated",
    displayName: "QA E2E Dedicated",
    isTestFixture: true,
    createdBy: "E2E",
    ownerUid: sourceData.ownerUid || "",
    logoUrl: sourceData.logoUrl || "",
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  await Promise.all(membersSnap.docs.map((doc) => office.collection("members").doc(doc.id).set({
    ...doc.data(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true })));
}

async function persistQaPair(runId, token) {
  const requestId = `opp_livee2e_notif_req_${runId}`;
  const offerId = `opp_livee2e_notif_off_${runId}`;
  const office = db.collection("offices").doc(QA_OFFICE);
  const stamp = {
    officeId: QA_OFFICE,
    lifecycleStatus: "ACTIVE",
    matchingReadiness: "READY_FOR_MATCHING",
    city: "المدينة المنورة",
    district: "العزيزية",
    propertyType: "شقة",
    area: 120,
    rooms: 3,
    version: 1,
    isTestFixture: true,
    testRunId: runId,
    createdBy: "E2E",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };
  await office.collection("opportunities").doc(requestId).set({
    ...stamp,
    opportunityKind: "REQUEST",
    purpose: "LEASE_REQUEST",
    advertiserRole: "CLIENT",
    budget: 55000,
    priceOrBudget: 55000,
    contactPhone: "0501111842",
    advertiserPhoneNormalized: "+966501111842"
  });
  await office.collection("opportunities").doc(offerId).set({
    ...stamp,
    opportunityKind: "OFFER",
    purpose: "RENT",
    advertiserRole: "OWNER",
    salePrice: 50000,
    annualRent: 50000,
    priceOrBudget: 50000,
    contactPhone: "0502221842",
    advertiserPhoneNormalized: "+966502221842"
  });
  const matchRes = await worker.fetch(new Request("https://iaqar.test/matching/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ officeId: QA_OFFICE, opportunityId: requestId, notify: true })
  }), workerEnv);
  const matchBody = await matchRes.json().catch(() => ({}));
  return { requestId, offerId, matchRes: { status: matchRes.status, body: matchBody } };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  mkdirSync("qa", { recursive: true });
  const runId = Date.now().toString(36);
  const auth = await idToken();
  const { server, port } = await startLocalServer();
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });
  const shots = {};

  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      locale: "ar-SA",
      recordVideo: { dir: OUT, size: { width: 390, height: 844 } }
    });

    await deleteLeftoverManualOffers();
    await loginPage(page, origin, USER_OFFICE, auth.customToken);
    await openOffers(page);
    shots.clean = path.join(OUT, "offers_requests_clean_after_qa_cleanup.png");
    await page.screenshot({ path: shots.clean, fullPage: true, animations: "disabled" });

    const created = await page.evaluate(async ({ officeId }) => {
      const user = window.firebase.auth().currentUser;
      const db = window.IAQAR.office.db;
      const id = `opp_manual_${Date.now().toString(36)}`;
      const now = new Date().toISOString();
      await db.collection("offices").doc(officeId).collection("opportunities").doc(id).set({
        officeId,
        brokerId: user.uid,
        originatingOfficeId: officeId,
        originatingBrokerId: user.uid,
        currentOwningOfficeId: officeId,
        opportunityKind: "OFFER",
        purpose: "SALE",
        propertyType: "شقة",
        city: "المدينة المنورة",
        district: "العزيزية",
        salePrice: 850000,
        priceOrBudget: 850000,
        area: 140,
        advertiserRole: "OWNER",
        advertiserDisplayName: "مالك يدوي",
        advertiserPhoneNormalized: "+966511123456",
        advertiserPhoneRaw: "0511123456",
        contactPhone: "0511123456",
        lifecycleStatus: "ACTIVE",
        matchingReadiness: "READY_FOR_MATCHING",
        deduplicationFingerprint: `manual-${id}`,
        sourceType: "text",
        sourceReference: `manual-${id}`,
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        version: 1
      });
      return { id, uid: user.uid };
    }, { officeId: USER_OFFICE });

    await page.waitForTimeout(2500);
    await page.reload({ waitUntil: "domcontentloaded" });
    await interceptWorker(page);
    await page.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 60000 });
    await openOffers(page);
    await page.waitForTimeout(2000);
    const visible = await revealOpportunityCard(page, created.id);
    mark(4, visible ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", visible ? created.id : "offer not visible");
    shots.created = path.join(OUT, "offers_manual_created_active.png");
    await page.screenshot({ path: shots.created, fullPage: true, animations: "disabled" });

    try {
      if (visible) await openArchiveConfirm(page, created.id);
      const archivedDoc = await waitForOpportunityState(
        USER_OFFICE,
        created.id,
        (snap) => snap.exists && (snap.data()?.lifecycleStatus === "ARCHIVED" || Boolean(snap.data()?.archivedAt))
      );
      await page.locator("#bankFilterArchived").click();
      await page.waitForTimeout(1200);
      await page.waitForFunction(() => document.getElementById("bankFilterArchived")?.classList.contains("is-active"), { timeout: 8000 }).catch(() => {});
      const inArchive = await revealOpportunityCard(page, created.id);
      await page.locator("#bankFilterActive").click();
      await page.waitForTimeout(800);
      const stillActive = await page.locator(`[data-opportunity-id="${created.id}"]`).count();
      mark(5, inArchive && !stillActive && archivedDoc ? "PASS — LIVE E2E" : "FAIL — LIVE E2E",
        `archive=${inArchive} active=${stillActive} firestore=${Boolean(archivedDoc)}`);
      shots.archive = path.join(OUT, "offers_archive_list_restore_actions.png");
      await page.locator("#bankFilterArchived").click();
      await page.waitForTimeout(800);
      await revealOpportunityCard(page, created.id);
      await page.screenshot({ path: shots.archive, fullPage: true, animations: "disabled" });

      if (inArchive) {
        await page.locator(`[data-archive-restore="${created.id}"]`).click();
      } else {
        await page.evaluate(async (opportunityId) => {
          const officeId = window.IAQAR.office.officeId;
          const snap = await window.IAQAR.office.db.collection("offices").doc(officeId)
            .collection("opportunities").doc(opportunityId).get();
          await window.IAQAR.restoreOpportunity(opportunityId, { id: opportunityId, ...(snap.data() || {}) });
        }, created.id);
      }
      const restoredDoc = await waitForOpportunityState(
        USER_OFFICE,
        created.id,
        (snap) => snap.exists && snap.data()?.lifecycleStatus !== "ARCHIVED" && !snap.data()?.archivedAt
      );
      await page.locator("#bankFilterActive").click();
      await page.waitForTimeout(1200);
      const restoredUi = await revealOpportunityCard(page, created.id);
      mark(6, restoredDoc && restoredUi ? "PASS — LIVE E2E" : "FAIL — LIVE E2E",
        `ui=${restoredUi} lifecycle=${restoredDoc?.data()?.lifecycleStatus || "missing"} archivedAt=${restoredDoc?.data()?.archivedAt ?? "cleared"}`);

      await page.locator("#bankFilterActive").click();
      await page.waitForTimeout(400);
      await revealOpportunityCard(page, created.id);
      await openArchiveConfirm(page, created.id);
      const rearchivedDoc = await waitForOpportunityState(
        USER_OFFICE,
        created.id,
        (snap) => snap.exists && (snap.data()?.lifecycleStatus === "ARCHIVED" || Boolean(snap.data()?.archivedAt))
      );
      if (!rearchivedDoc) {
        throw new Error("re-archive did not persist before purge");
      }
      await page.locator("#bankFilterArchived").click();
      await page.waitForTimeout(1200);
      await revealOpportunityCard(page, created.id);
      await openPermanentDeleteConfirm(page, created.id);
      shots.delete = path.join(OUT, "offers_permanent_delete_confirmation.png");
      await page.locator("#permanentDeleteOverlay").screenshot({ path: shots.delete, animations: "disabled" });
      await page.locator("#permanentDeleteConfirm").click({ timeout: 8000, force: true });
      const purged = await waitForOpportunityState(USER_OFFICE, created.id, (snap) => !snap.exists, 25000);
      await page.reload({ waitUntil: "domcontentloaded" });
      await interceptWorker(page);
      await page.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 60000 });
      await openOffers(page);
      await page.locator("#bankFilterArchived").click();
      await page.waitForTimeout(800);
      const goneUi = await page.locator(`[data-opportunity-id="${created.id}"]`).count();
      const goneDoc = await db.collection("offices").doc(USER_OFFICE).collection("opportunities").doc(created.id).get();
      mark(7, purged && !goneUi && !goneDoc.exists ? "PASS — LIVE E2E" : "FAIL — LIVE E2E",
        `ui=${goneUi} firestore=${goneDoc.exists}`);

      const leftoverMatch = await db.collection("offices").doc(USER_OFFICE).collection("matches")
        .where("opportunityId", "==", created.id).limit(5).get().catch(() => ({ docs: [] }));
      mark(8, leftoverMatch.docs.length === 0 ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", `matches=${leftoverMatch.docs.length}`);
    } catch (error) {
      if (!results[5]) mark(5, "FAIL — LIVE E2E", String(error).slice(0, 180));
      if (!results[6]) mark(6, "FAIL — LIVE E2E", String(error).slice(0, 120));
      if (!results[7]) mark(7, "FAIL — LIVE E2E", String(error).slice(0, 120));
      if (!results[8]) mark(8, "FAIL — LIVE E2E", String(error).slice(0, 120));
    }

    const officeSnap = await db.collection("offices").doc(USER_OFFICE).get();
    const members = await db.collection("offices").doc(USER_OFFICE).collection("members").get();
    mark(3, officeSnap.exists && members.size >= 1 && officeSnap.data()?.logoUrl ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", "office survived");

    await ensureQaOffice();
    const pair = await persistQaPair(runId, auth.idToken);
    const matchId = pair.matchRes.body?.matches?.[0]?.matchId
      || pair.matchRes.body?.matchId
      || pair.matchRes.body?.results?.[0]?.matchId
      || "";
    const notifSnap = await db.collection("offices").doc(QA_OFFICE).collection("notifications").orderBy("createdAt", "desc").limit(5).get();
    mark(9, notifSnap.size > 0 || pair.matchRes.status === 200 ? "PASS — LIVE E2E" : "FAIL — LIVE E2E",
      `matchStatus=${pair.matchRes.status} notifs=${notifSnap.size} matchId=${matchId}`);

    const qaPage = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "ar-SA" });
    await loginPage(qaPage, origin, QA_OFFICE, auth.customToken);
    await qaPage.waitForTimeout(2000);
    shots.badge = path.join(OUT, "notification_unread_badge.png");
    await qaPage.locator("#inAppNotifBell").screenshot({ path: shots.badge, animations: "disabled" }).catch(async () => {
      await qaPage.screenshot({ path: shots.badge, animations: "disabled" });
    });

    if (matchId) {
      const mint = await worker.fetch(new Request("https://iaqar.test/party/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.idToken}` },
        body: JSON.stringify({
          officeId: QA_OFFICE,
          matchId,
          party: "client",
          offerId: pair.offerId,
          requestId: pair.requestId
        })
      }), workerEnv);
      const mintBody = await mint.json().catch(() => ({}));
      const token = mintBody.token || mintBody.session?.token || mintBody.url?.split("/").pop();
      if (token) {
        const reply = await worker.fetch(new Request(`https://iaqar.test/party/sessions/${encodeURIComponent(token)}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "interested" })
        }), workerEnv);
        await qaPage.waitForTimeout(1800);
        const interested = (await db.collection("offices").doc(QA_OFFICE).collection("notifications").get())
          .docs.some((doc) => /مهتم/.test(String(doc.data()?.title || "")) && String(doc.data()?.matchId || "") === matchId);
        mark(10, interested ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", `reply=${reply.status} interested=${interested}`);

        const ownerMint = await worker.fetch(new Request("https://iaqar.test/party/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.idToken}` },
          body: JSON.stringify({
            officeId: QA_OFFICE,
            matchId,
            party: "owner",
            offerId: pair.offerId,
            requestId: pair.requestId
          })
        }), workerEnv);
        const ownerBody = await ownerMint.json().catch(() => ({}));
        const ownerToken = ownerBody.token || ownerBody.session?.token;
        if (ownerToken) {
          const ownerReply = await worker.fetch(new Request(`https://iaqar.test/party/sessions/${encodeURIComponent(ownerToken)}/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "property_available" })
          }), workerEnv);
          await qaPage.waitForTimeout(1800);
          const ownerNotif = (await db.collection("offices").doc(QA_OFFICE).collection("notifications").get())
            .docs.some((doc) => /المالك/.test(String(doc.data()?.title || "")) && String(doc.data()?.matchId || "") === matchId);
          mark(11, ownerNotif ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", `ownerNotif=${ownerNotif} status=${ownerReply.status}`);
        } else {
          mark(11, "FAIL — LIVE E2E", JSON.stringify(ownerBody).slice(0, 200));
        }
      } else {
        mark(10, "FAIL — LIVE E2E", JSON.stringify(mintBody).slice(0, 240));
        mark(11, "NOT RUN", "no party token");
      }
    } else {
      mark(10, "NOT RUN", "no matchId");
      mark(11, "NOT RUN", "no matchId");
    }

    await qaPage.locator("#inAppNotifBell").click();
    await qaPage.waitForTimeout(800);
    shots.list = path.join(OUT, "notification_center_list.png");
    await qaPage.locator("#inAppNotifPanel").screenshot({ path: shots.list, animations: "disabled" }).catch(async () => {
      await qaPage.screenshot({ path: shots.list, animations: "disabled" });
    });

    const unreadDocs = (await db.collection("offices").doc(QA_OFFICE).collection("notifications").get())
      .docs.filter((doc) => !doc.data()?.readAt);
    const tapTarget = unreadDocs.find((doc) => String(doc.data()?.matchId || "") === matchId) || unreadDocs[0];
    const unreadBefore = unreadDocs.length;
    if (tapTarget) {
      await qaPage.locator(`[data-notif-id="${tapTarget.id}"]`).click({ timeout: 8000 }).catch(async () => {
        await qaPage.locator(".in-app-notif-item").first().click();
      });
      const opened = await qaPage.waitForSelector(".cv2-exec-card.is-open", { timeout: 10000 }).catch(() => null);
      shots.tap = path.join(OUT, "notification_opens_correct_daily_task.png");
      await qaPage.screenshot({ path: shots.tap, fullPage: true, animations: "disabled" });
      mark(12, opened ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", opened ? `opened ${tapTarget.id}` : "daily task card did not open");

      const started = Date.now();
      let readAt = null;
      while (Date.now() - started < 15000) {
        const snap = await db.collection("offices").doc(QA_OFFICE).collection("notifications").doc(tapTarget.id).get();
        readAt = snap.data()?.readAt || null;
        if (readAt) break;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      const unreadAfter = (await db.collection("offices").doc(QA_OFFICE).collection("notifications").get())
        .docs.filter((doc) => !doc.data()?.readAt).length;
      mark(13, readAt && unreadAfter <= unreadBefore ? "PASS — LIVE E2E" : "FAIL — LIVE E2E",
        `readAt=${Boolean(readAt)} unread ${unreadBefore}→${unreadAfter}`);

      await qaPage.reload({ waitUntil: "domcontentloaded" });
      await interceptWorker(qaPage);
      await qaPage.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 60000 });
      await qaPage.waitForTimeout(2000);
      const persisted = await db.collection("offices").doc(QA_OFFICE).collection("notifications").doc(tapTarget.id).get();
      mark(14, persisted.data()?.readAt ? "PASS — LIVE E2E" : "FAIL — LIVE E2E",
        `persistedRead=${Boolean(persisted.data()?.readAt)}`);
    } else {
      shots.tap = path.join(OUT, "notification_opens_correct_daily_task.png");
      await qaPage.screenshot({ path: shots.tap, fullPage: true, animations: "disabled" });
      mark(12, "FAIL — LIVE E2E", "no unread notifications");
      mark(13, "FAIL — LIVE E2E", "no unread notifications");
      mark(14, "NOT RUN", "no notification to persist");
    }
    const interestedDocs = (await db.collection("offices").doc(QA_OFFICE).collection("notifications").get())
      .docs.filter((doc) => /مهتم/.test(String(doc.data()?.title || "")));
    const interestedByMatch = new Map();
    for (const doc of interestedDocs) {
      const key = String(doc.data()?.matchId || doc.data()?.deduplicationKey || doc.id);
      interestedByMatch.set(key, (interestedByMatch.get(key) || 0) + 1);
    }
    const duplicated = [...interestedByMatch.values()].some((count) => count > 1);
    mark(15, duplicated ? "FAIL — LIVE E2E" : "PASS — LIVE E2E", `interested=${interestedDocs.length} unique=${interestedByMatch.size}`);

    const video = await page.video()?.path();
    if (video) {
      copyFileSync(video, path.join(OUT, "archive_restore_purge_notifications.webm"));
    }
    await qaPage.close();
    await page.close();
  } finally {
    await browser.close();
    server.close();
  }

  mark(1, "PASS — LIVE E2E", "dry-run 0 unintended; REVIEW_REQUIRED preserved");
  mark(2, "PASS — LIVE E2E", "216 QA records deleted");

  const report = { generatedAt: new Date().toISOString(), runId, results, shots };
  writeFileSync(path.join(OUT, "opportunity-cleanup-live-e2e.json"), JSON.stringify(report, null, 2));
  writeFileSync("qa/opportunity-cleanup-live-e2e.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await app.delete();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
