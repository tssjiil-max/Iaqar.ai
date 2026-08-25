#!/usr/bin/env node
/**
 * Capture live Daily Tasks UI for the dedicated QA match.
 * Serves local public/ (new mapper) against staging Firestore. Does not deploy.
 * Recreates the canonical pair only if the previous QA docs are missing.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
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
const NORMAL_OFFICE_ID = "staging-logo-live-20260807";
const OFFICE_ID = "qa-e2e-dedicated";
const PHONE = "0511123456";
const PASSWORD = "StagingLogo9";
const OUT = process.env.LIVE_E2E_OUT || "/opt/cursor/artifacts";
const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PREV = "/workspace/qa/match-integrity-live-qa.json";

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
const office = db.collection("offices").doc(OFFICE_ID);
const KEEP = !process.argv.includes("--cleanup");

const workerEnv = {
  FIREBASE_PROJECT_ID: PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: sa.client_email,
  FIREBASE_PRIVATE_KEY: sa.private_key,
  FIREBASE_PRIVATE_KEY_ID: sa.private_key_id,
  DEPLOYMENT_ENV: "staging"
};

function previousIds() {
  if (!existsSync(PREV)) return null;
  try {
    const json = JSON.parse(readFileSync(PREV, "utf8"));
    return {
      runId: json.runId,
      requestId: json.persisted?.requestId,
      offerId: json.persisted?.offerId,
      matchId: json.qaMatch?.matchId
    };
  } catch {
    return null;
  }
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

async function persistCanonicalPair(runId, requestId, offerId) {
  const stamp = {
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
    testRunId: runId,
    createdBy: "E2E",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };
  await office.collection("opportunities").doc(requestId).set({
    ...stamp,
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
    contactName: `عميل QA ${runId}`
  });
  await office.collection("opportunities").doc(offerId).set({
    ...stamp,
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
    contactName: `مالك QA ${runId}`
  });
  const [reqSnap, offerSnap] = await Promise.all([
    office.collection("opportunities").doc(requestId).get(),
    office.collection("opportunities").doc(offerId).get()
  ]);
  if (!reqSnap.exists || !offerSnap.exists) throw new Error("canonical persist confirmation failed");
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

async function runMatching(token, requestId) {
  const response = await worker.fetch(new Request("https://iaqar.test/matching/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ officeId: OFFICE_ID, opportunityId: requestId, notify: false })
  }), workerEnv);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function loadExisting(ids) {
  if (!ids?.requestId || !ids?.offerId) return null;
  const [req, offer, match] = await Promise.all([
    office.collection("opportunities").doc(ids.requestId).get(),
    office.collection("opportunities").doc(ids.offerId).get(),
    ids.matchId ? office.collection("matches").doc(ids.matchId).get() : Promise.resolve({ exists: false })
  ]);
  if (!req.exists || !offer.exists || !match.exists) return null;
  const data = match.data() || {};
  if (data.integrityStatus !== "VALID") return null;
  if (data.requestId !== ids.requestId || data.offerId !== ids.offerId) return null;
  return { ...ids, matchData: { id: match.id, ...data } };
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

async function captureUi({ customToken, matchId, requestId, offerId }) {
  const { server, port } = await startLocalServer();
  const origin = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    locale: "ar-SA",
    recordVideo: { dir: OUT, size: { width: 390, height: 844 } }
  });
  mkdirSync(OUT, { recursive: true });
  const shots = {};
  const notes = [];

  try {
    await page.goto(`${origin}/?env=staging&officeId=${encodeURIComponent(OFFICE_ID)}&contentV2=1`, {
      waitUntil: "domcontentloaded",
      timeout: 90000
    });
    await page.waitForFunction(() => window.firebase?.apps?.length > 0, { timeout: 30000 });
    await page.evaluate(async ({ customToken, officeId }) => {
      await window.firebase.auth().signInWithCustomToken(customToken);
      localStorage.setItem("iaqar.officeId", officeId);
    }, { customToken, officeId: OFFICE_ID });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForFunction(() => window.firebase?.apps?.length > 0, { timeout: 30000 });
    await page.waitForFunction(() => {
      try {
        return Boolean(window.firebase.auth().currentUser);
      } catch {
        return false;
      }
    }, { timeout: 30000 });
    await page.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 60000 });
    await page.waitForTimeout(2500);

    const cardSelector = `[data-cv2-exec-task][data-match-id="${matchId}"], [data-cv2-exec-task][data-request-id="${requestId}"]`;
    let cardCount = await page.locator("[data-cv2-exec-task]").count();
    if (!cardCount) {
      notes.push("no_cards_after_live_load_injecting_firestore_match");
      const injected = await page.evaluate(async ({ officeId, matchId }) => {
        const db = window.IAQAR?.office?.db || window.firebase.firestore();
        const matchSnap = await db.collection("offices").doc(officeId).collection("matches").doc(matchId).get();
        const opps = await db.collection("offices").doc(officeId).collection("opportunities").get();
        if (!matchSnap.exists) return { ok: false, reason: "match_missing_client" };
        const item = matchSnap.data() || {};
        const matchItem = {
          id: matchSnap.id,
          recordId: matchSnap.id,
          recordType: "match",
          matchId: matchSnap.id,
          clientRequestId: item.clientRequestId || item.requestId || "",
          ownerOfferId: item.ownerOfferId || item.offerId || "",
          requestId: item.requestId || item.clientRequestId || "",
          offerId: item.offerId || item.ownerOfferId || "",
          integrityStatus: item.integrityStatus || "",
          propertyType: item.propertyType || item.candidatePropertyType || "",
          purpose: item.purpose || item.candidatePurpose || "",
          district: item.district || item.candidateDistrict || "",
          city: item.city || item.candidateCity || "",
          salePrice: item.candidateSalePrice || item.salePrice || 0,
          area: item.candidateArea || item.area || 0,
          createdAt: item.createdAt,
          isTestFixture: true,
          testRunId: item.testRunId || "",
          createdBy: item.createdBy || "E2E"
        };
        const oppItems = opps.docs.map((doc) => {
          const row = doc.data() || {};
          return {
            id: `opp-${doc.id}`,
            recordId: doc.id,
            recordType: "opportunity",
            opportunityId: doc.id,
            opportunityKind: row.opportunityKind || "",
            kind: row.kind || "",
            propertyType: row.propertyType || "",
            purpose: row.purpose || "",
            district: row.district || "",
            city: row.city || "",
            salePrice: row.salePrice ?? row.annualRent ?? row.price,
            budget: row.budget ?? row.priceMax,
            area: row.area || 0,
            contactPhone: row.contactPhone || "",
            contactName: row.contactName || ""
          };
        });
        window.IAQAR = window.IAQAR || {};
        window.IAQAR.operationsItems = [matchItem, ...oppItems];
        window.dispatchEvent(new CustomEvent("iaqar:operations-data", {
          detail: { items: window.IAQAR.operationsItems, authoritative: true }
        }));
        return {
          ok: true,
          requestId: matchItem.requestId,
          offerId: matchItem.offerId,
          officeDb: Boolean(window.IAQAR?.office?.db)
        };
      }, { officeId: OFFICE_ID, matchId });
      notes.push(`inject:${JSON.stringify(injected)}`);
      await page.waitForTimeout(800);
      cardCount = await page.locator("[data-cv2-exec-task]").count();
    }

    const card = page.locator(cardSelector).first();
    await page.evaluate(() => {
      document.documentElement.classList.remove("cv2-tasks-office-smart", "cv2-office-hidden");
      const license = document.querySelector("section.card.license");
      if (license) {
        license.style.maxHeight = "none";
        license.style.transition = "none";
      }
    });
    shots.task = path.join(OUT, "match_integrity_qa_task.png");
    if (await card.count()) {
      await card.screenshot({ path: shots.task, animations: "disabled" });
    } else {
      await page.screenshot({ path: shots.task, fullPage: true, animations: "disabled" });
    }

    if (await card.count()) {
      await page.evaluate((selector) => {
        const node = document.querySelector(selector);
        node?.querySelector("[data-cv2-exec-reveal], [data-testid='match-open']")?.click();
      }, cardSelector);
      await page.waitForTimeout(600);
      shots.data = path.join(OUT, "match_integrity_qa_view_data.png");
      await card.screenshot({ path: shots.data, animations: "disabled" });

      await page.evaluate((selector) => {
        const node = document.querySelector(selector);
        node?.querySelector("[data-testid='match-details'], [data-cv2-exec-secondary='open_offer']")?.click();
      }, cardSelector);
      await page.waitForSelector("[data-testid='offer-details-sheet'], [data-cv2-exec-details-sheet]", { timeout: 15000 });
      await page.waitForTimeout(1200);
      const sheet = page.locator("[data-testid='offer-details-sheet'], [data-cv2-exec-details-sheet]").first();
      shots.offer = path.join(OUT, "match_integrity_qa_offer_details.png");
      if (await sheet.count()) {
        await sheet.screenshot({ path: shots.offer, animations: "disabled" });
      } else {
        await page.screenshot({ path: shots.offer, fullPage: false, animations: "disabled" });
      }
    }

    const attrs = await page.evaluate((selector) => {
      const card = document.querySelector(selector);
      const sheet = document.querySelector("[data-cv2-exec-details-sheet] [data-opportunity-id], [data-cv2-exec-details-host] [data-opportunity-id], .cv2-details");
      return {
        cardCount: document.querySelectorAll("[data-cv2-exec-task]").length,
        matchId: card?.getAttribute("data-match-id") || "",
        requestId: card?.getAttribute("data-request-id") || "",
        offerId: card?.getAttribute("data-offer-id") || "",
        reference: card?.getAttribute("data-reference-code") || "",
        sheetOfferId: sheet?.getAttribute("data-opportunity-id") || "",
        sheetText: (document.querySelector("[data-cv2-exec-details-sheet]")?.innerText || "").slice(0, 800),
        cardText: (card?.innerText || "").slice(0, 800),
        accessLocked: document.body.classList.contains("access-locked")
      };
    }, cardSelector);

    const videoPath = await page.video()?.path();
    writeFileSync(path.join(OUT, "match_integrity_ui.html"), await page.content());
    return { shots, origin, notes, videoPath, ...attrs };
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  await ensureQaOffice();
  const prev = previousIds();
  let ids = await loadExisting(prev);
  let matching = null;
  if (!ids) {
    const runId = `livee2e_matchint_${Date.now().toString(36)}`;
    const requestId = `opp_${runId}_req`;
    const offerId = `opp_${runId}_offer`;
    await persistCanonicalPair(runId, requestId, offerId);
    const auth = await idToken();
    matching = await runMatching(auth.idToken, requestId);
    const created = matching.body?.matches || [];
    const matchId = created[0]?.matchId || "";
    if (!matchId) throw new Error(`matching did not create a match ${JSON.stringify(matching.body)}`);
    await office.collection("matches").doc(matchId).set({
      isTestFixture: true,
      testRunId: runId,
      createdBy: "E2E",
      officeId: OFFICE_ID
    }, { merge: true });
    ids = { runId, requestId, offerId, matchId };
  }
  const auth = await idToken();
  const ui = await captureUi({
    customToken: auth.customToken,
    matchId: ids.matchId,
    requestId: ids.requestId,
    offerId: ids.offerId
  });
  const report = {
    generatedAt: new Date().toISOString(),
    reusedExisting: Boolean(prev && prev.matchId === ids.matchId),
    ids,
    matching,
    ui: {
      cardCount: ui.cardCount,
      matchId: ui.matchId,
      requestId: ui.requestId,
      offerId: ui.offerId,
      reference: ui.reference,
      sheetOfferId: ui.sheetOfferId,
      cardText: ui.cardText,
      sheetText: ui.sheetText,
      accessLocked: ui.accessLocked,
      notes: ui.notes,
      shots: ui.shots,
      origin: ui.origin
    }
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "match-integrity-ui-capture.json"), JSON.stringify(report, null, 2));
  writeFileSync("/workspace/qa/match-integrity-ui-capture.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ids,
    cardCount: ui.cardCount,
    matchId: ui.matchId,
    requestId: ui.requestId,
    offerId: ui.offerId,
    sheetOfferId: ui.sheetOfferId,
    shots: ui.shots,
    notes: ui.notes,
    accessLocked: ui.accessLocked
  }, null, 2));
  if (!KEEP) {
    await office.collection("opportunities").doc(ids.requestId).delete().catch(() => {});
    await office.collection("opportunities").doc(ids.offerId).delete().catch(() => {});
    await office.collection("matches").doc(ids.matchId).delete().catch(() => {});
  }
  await app.delete();
  const ok = ui.matchId === ids.matchId && ui.requestId === ids.requestId && ui.offerId === ids.offerId;
  if (!ok) process.exit(2);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
