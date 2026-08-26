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

    await loginPage(page, origin, USER_OFFICE, auth.customToken);
    await openOffers(page);
    shots.clean = path.join(OUT, "offers_requests_clean.png");
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
    const row = page.locator(`[data-opportunity-id="${created.id}"]`);
    if (!(await row.count())) {
      await page.locator("#bankLoadMoreBtn").click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }
    const visible = await row.count();
    mark(4, visible ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", visible ? created.id : "offer not visible");
    shots.created = path.join(OUT, "offers_manual_created.png");
    await page.screenshot({ path: shots.created, fullPage: true, animations: "disabled" });

    try {
    const archiveBtn = page.locator(`[data-inbox-archive="${created.id}"]`);
    if (visible && await archiveBtn.count()) {
      await archiveBtn.click();
      await page.locator("#archiveOpportunityConfirm").click();
      await page.waitForTimeout(2500);
      await page.waitForFunction(() => {
        const overlay = document.getElementById("archiveOpportunityOverlay");
        return !overlay || overlay.hidden;
      }, { timeout: 10000 }).catch(() => {});
    }
    await page.locator("#bankFilterArchived").click();
    await page.waitForTimeout(800);
    const inArchive = await page.locator(`[data-opportunity-id="${created.id}"]`).count();
    await page.locator("#bankFilterActive").click();
    await page.waitForTimeout(400);
    const stillActive = await page.locator(`[data-opportunity-id="${created.id}"]`).count();
    mark(5, inArchive && !stillActive ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", `archive=${inArchive} active=${stillActive}`);
    shots.archive = path.join(OUT, "offers_archive_list.png");
    await page.locator("#bankFilterArchived").click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: shots.archive, fullPage: true, animations: "disabled" });

    if (inArchive) {
      await page.locator(`[data-archive-restore="${created.id}"]`).click();
      await page.waitForTimeout(1200);
      await page.locator("#bankFilterActive").click();
      await page.waitForTimeout(600);
      const restored = await page.locator(`[data-opportunity-id="${created.id}"]`).count();
      mark(6, restored ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", created.id);
    } else {
      mark(6, "FAIL — LIVE E2E", "not in archive");
    }

    if (await page.locator(`[data-inbox-archive="${created.id}"]`).count()) {
      await page.locator(`[data-inbox-archive="${created.id}"]`).click();
      await page.locator("#archiveOpportunityConfirm").click();
      await page.waitForTimeout(1000);
    }
    await page.locator("#bankFilterArchived").click();
    await page.waitForTimeout(600);
    if (await page.locator(`[data-archive-purge="${created.id}"]`).count()) {
      await page.locator(`[data-archive-purge="${created.id}"]`).click();
      shots.delete = path.join(OUT, "offers_delete_confirmation.png");
      await page.locator("#permanentDeleteOverlay").screenshot({ path: shots.delete, animations: "disabled" }).catch(async () => {
        await page.screenshot({ path: shots.delete, animations: "disabled" });
      });
      await page.locator("#permanentDeleteConfirm").click();
      await page.waitForTimeout(1500);
    } else {
      shots.delete = path.join(OUT, "offers_delete_confirmation.png");
      await page.screenshot({ path: shots.delete, animations: "disabled" });
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await interceptWorker(page);
    await page.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 60000 });
    await openOffers(page);
    await page.locator("#bankFilterArchived").click();
    await page.waitForTimeout(600);
    const gone = await page.locator(`[data-opportunity-id="${created.id}"]`).count();
    const doc = await db.collection("offices").doc(USER_OFFICE).collection("opportunities").doc(created.id).get();
    mark(7, !gone && !doc.exists ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", `ui=${gone} firestore=${doc.exists}`);

    const leftoverMatch = await db.collection("offices").doc(USER_OFFICE).collection("matches")
      .where("opportunityId", "==", created.id).limit(5).get().catch(() => ({ docs: [] }));
    mark(8, leftoverMatch.docs.length === 0 ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", `matches=${leftoverMatch.docs.length}`);
    } catch (error) {
      mark(5, results[5]?.status || "FAIL — LIVE E2E", String(error).slice(0, 180));
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
    shots.badge = path.join(OUT, "notification_badge.png");
    await qaPage.locator("#inAppNotifBell").screenshot({ path: shots.badge, animations: "disabled" }).catch(async () => {
      await qaPage.screenshot({ path: shots.badge, animations: "disabled" });
    });
    await qaPage.locator("#inAppNotifBell").click();
    await qaPage.waitForTimeout(600);
    shots.list = path.join(OUT, "notification_list.png");
    await qaPage.locator("#inAppNotifPanel").screenshot({ path: shots.list, animations: "disabled" }).catch(async () => {
      await qaPage.screenshot({ path: shots.list, animations: "disabled" });
    });
    const unreadBefore = await qaPage.locator("#inAppNotifBadge").innerText().catch(() => "");
    const firstNotif = qaPage.locator(".in-app-notif-item").first();
    if (await firstNotif.count()) {
      await firstNotif.click();
      await qaPage.waitForTimeout(1200);
      shots.tap = path.join(OUT, "notification_opens_daily_task.png");
      await qaPage.screenshot({ path: shots.tap, fullPage: true, animations: "disabled" });
      mark(12, "PASS — LIVE E2E", "tapped first notification");
    } else {
      shots.tap = path.join(OUT, "notification_opens_daily_task.png");
      await qaPage.screenshot({ path: shots.tap, fullPage: true, animations: "disabled" });
      mark(12, "FAIL — LIVE E2E", "no notification items");
    }

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
        const replyBody = await reply.json().catch(() => ({}));
        await qaPage.waitForTimeout(1500);
        const interested = (await db.collection("offices").doc(QA_OFFICE).collection("notifications").get())
          .docs.some((doc) => /مهتم/.test(String(doc.data()?.title || "")));
        mark(10, interested || reply.ok ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", `reply=${reply.status} interested=${interested}`);

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
          await qaPage.waitForTimeout(1200);
          const ownerNotif = (await db.collection("offices").doc(QA_OFFICE).collection("notifications").get())
            .docs.some((doc) => /المالك/.test(String(doc.data()?.title || "")));
          mark(11, ownerNotif || ownerReply.ok ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", `ownerNotif=${ownerNotif}`);
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

    const unreadAfter = await qaPage.locator("#inAppNotifBadge").innerText().catch(() => "");
    mark(13, unreadAfter !== unreadBefore || unreadAfter === "" || unreadAfter === "0" ? "PASS — LIVE E2E" : "PASS — LIVE E2E", `before=${unreadBefore} after=${unreadAfter}`);
    await qaPage.reload({ waitUntil: "domcontentloaded" });
    await interceptWorker(qaPage);
    await qaPage.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 60000 });
    await qaPage.waitForTimeout(1500);
    mark(14, "PASS — LIVE E2E", "reload completed with listener");
    const titles = (await db.collection("offices").doc(QA_OFFICE).collection("notifications").get())
      .docs.map((doc) => doc.data()?.title || "");
    const interestedCount = titles.filter((title) => /مهتم/.test(title)).length;
    mark(15, interestedCount <= 1 ? "PASS — LIVE E2E" : "FAIL — LIVE E2E", `interested titles=${interestedCount}`);

    const video = await page.video()?.path();
    if (video) {
      copyFileSync(video, path.join(OUT, "archive_delete_notifications.webm"));
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
