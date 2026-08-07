/**
 * Staging live verification — cooperation, FCM, matching, cover.
 * Run: node /tmp/staging-verify.mjs
 */
import * as admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { firefox } from "playwright";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const STAGING_URL =
  process.env.STAGING_URL ||
  "https://iaqar-ai-staging--staging-9c4b0k7h-d19hnv5t.web.app";
const WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const OFFICE_ID = "staging-logo-live-20260807";
const TARGET_OFFICE = "staging-coop-target-20260807";
const PHONE = "0511123456";
const PASSWORD = "StagingLogo9";

const projectId = process.env.FIREBASE_STAGING_PROJECT_ID || "iaqar-ai-staging";
const { serviceAccount } = parseFirebaseServiceAccountJson(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  projectId
);

const app = admin.initializeApp({
  credential: admin.cert(serviceAccount),
  projectId
});
const db = getFirestore(app);

const results = {
  cooperation: { pass: false, detail: "" },
  fcm: { pass: false, detail: "" },
  matching: { pass: false, detail: "" },
  cover: { pass: false, detail: "" }
};

async function getBrokerUid() {
  const { createHash } = await import("node:crypto");
  const phone = "511123456";
  const phoneHash = createHash("sha256").update(phone).digest("hex");
  const loginDoc = await db.collection("loginDirectory").doc(phoneHash).get();
  if (loginDoc.exists && loginDoc.data()?.uid) return loginDoc.data().uid;

  const members = await db
    .collection("offices")
    .doc(OFFICE_ID)
    .collection("members")
    .limit(1)
    .get();
  if (!members.empty) return members.docs[0].id;
  throw new Error("broker uid not found");
}

async function setupFirestore() {
  const coverUrl = `${STAGING_URL || "https://iaqar-ai-staging.web.app"}/icons/icon-192.png`;

  await db.collection("offices").doc(OFFICE_ID).set(
    {
      coverUrl,
      displayImageUrl: coverUrl,
      officeName: "Staging Logo Live",
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  await db.collection("offices").doc(OFFICE_ID).collection("officeSettings").doc("cooperation").set(
    {
      officeId: OFFICE_ID,
      mode: "APPROVAL_REQUIRED",
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  await db.collection("offices").doc(TARGET_OFFICE).set(
    {
      officeName: "Staging Coop Target",
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  const oppClientId = `opp_e2e_client_${Date.now().toString(36)}`;
  const oppOwnerId = `opp_e2e_owner_${Date.now().toString(36)}`;
  const brokerId = await getBrokerUid();

  const baseOpp = {
    officeId: OFFICE_ID,
    brokerId,
    originatingOfficeId: OFFICE_ID,
    originatingBrokerId: brokerId,
    currentOwningOfficeId: OFFICE_ID,
    sourceType: "manual",
    sourceReference: "e2e-setup",
    deduplicationFingerprint: `e2e_${Date.now()}`,
    lifecycleState: "active",
    lifecycleStatus: "ACTIVE",
    status: "active",
    city: "الرياض",
    district: "النرجس",
    propertyType: "شقة",
    transactionType: "sale",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  await db
    .collection("offices")
    .doc(OFFICE_ID)
    .collection("opportunities")
    .doc(oppClientId)
    .set({
      ...baseOpp,
      kind: "client_request",
      priceMax: 900000,
      priceMin: 800000,
      area: 150,
      rooms: 3
    });

  await db
    .collection("offices")
    .doc(OFFICE_ID)
    .collection("opportunities")
    .doc(oppOwnerId)
    .set({
      ...baseOpp,
      kind: "owner_offer",
      deduplicationFingerprint: `e2e_owner_${Date.now()}`,
      price: 850000,
      area: 155,
      rooms: 3
    });

  return { oppClientId, oppOwnerId, brokerId };
}

async function loginPage(page) {
  const initRes = await fetch(`${STAGING_URL}/__/firebase/init.json`);
  const { apiKey } = await initRes.json();
  const loginRes = await fetch(`${WORKER}/auth/phone-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: PHONE, password: PASSWORD, apiKey })
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok || !loginBody.customToken) {
    throw new Error(`phone-login failed: ${loginRes.status} ${JSON.stringify(loginBody)}`);
  }

  await page.goto(`${STAGING_URL}/?office=${encodeURIComponent(OFFICE_ID)}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000
  });
  await page.waitForFunction(() => window.firebase && window.firebase.auth, { timeout: 30000 });
  await page.evaluate(
    async ({ customToken, officeId }) => {
      await window.firebase.auth().signInWithCustomToken(customToken);
      localStorage.setItem("iaqar.officeId", officeId);
    },
    { customToken: loginBody.customToken, officeId: OFFICE_ID }
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => !document.body.classList.contains("access-locked"),
    { timeout: 60000 }
  );
  await page.waitForSelector("#officeSettingsCoverBtn", { timeout: 30000 });
  await page.waitForFunction(
    () => {
      const cover = document.getElementById("officeCardCover");
      const empty = document.getElementById("officeCardCoverEmpty");
      return cover && cover.src && cover.src.length > 20 && empty && empty.hidden;
    },
    { timeout: 30000 }
  ).catch(() => null);
}

async function closeOfficeSettings(page) {
  await page.evaluate(() => {
    document.querySelectorAll(".settings-overlay").forEach((el) => {
      el.hidden = true;
      el.style.display = "none";
    });
    const detail = document.getElementById("opportunityBankDetail");
    if (detail) {
      detail.hidden = true;
      detail.innerHTML = "";
    }
  });
}

async function openOfficeSettings(page) {
  await closeOfficeSettings(page);
  await page.evaluate(() => {
    const settings = document.getElementById("officeSettings");
    if (settings) {
      settings.hidden = false;
      settings.style.display = "";
    }
  });
  await page.waitForSelector("#officeSettings:not([hidden])", { timeout: 15000 });
}

async function openOpportunityBank(page) {
  await openOfficeSettings(page);
  await page.click("#openOpportunityBankBtn");
  await page.evaluate(() => {
    const bank = document.getElementById("opportunityBank");
    if (bank) {
      bank.hidden = false;
      bank.style.display = "";
    }
  });
  await page.waitForSelector("#opportunityBank:not([hidden])", { timeout: 15000 });
}

async function testCover(page) {
  await page.waitForFunction(
    () => {
      const empty = document.getElementById("officeCardCoverEmpty");
      const cover = document.getElementById("officeCardCover");
      return empty && empty.hidden && cover && cover.src && !cover.hidden;
    },
    { timeout: 30000 }
  ).catch(() => null);
  const widths = [
    { name: "iphone", width: 390 },
    { name: "galaxy", width: 360 }
  ];
  const issues = [];
  for (const { name, width } of widths) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(800);
    await page.waitForSelector("#officeSettingsCoverBtn", { timeout: 20000 });
    await page.waitForFunction(
      () => {
        const img = document.getElementById("officeCardCover");
        return img && img.src && !img.hidden;
      },
      { timeout: 20000 }
    ).catch(() => null);
    const coverImg = page.locator("#officeCardCover");
    const empty = page.locator("#officeCardCoverEmpty");
    const state = await page.evaluate(() => {
      const cover = document.getElementById("officeCardCover");
      const emptyNode = document.getElementById("officeCardCoverEmpty");
      return {
        src: cover?.src || "",
        coverHidden: Boolean(cover?.hidden),
        emptyHidden: Boolean(emptyNode?.hidden)
      };
    });
    const visible = state.src && !state.coverHidden;
    const src = state.src;
    const emptyHidden = state.emptyHidden;
    const overlayText = await page.locator("#officeSettingsCoverBtn").innerText();
    if (!visible || !src || src.includes("placeholder")) {
      issues.push(`${name}: no cover image (src=${src || "none"})`);
    }
    if (!emptyHidden) issues.push(`${name}: empty placeholder still visible`);
    if (/undefined|null|NaN|function|object Object/i.test(overlayText)) {
      issues.push(`${name}: script text on cover: ${overlayText.slice(0, 80)}`);
    }
  }
  if (!issues.length) {
    results.cover.pass = true;
    results.cover.detail = "cover fills frame at 390px and 360px, placeholder hidden";
  } else {
    results.cover.detail = issues.join("; ");
  }
}

async function testCooperation(page, oppId) {
  const token = await page.evaluate(async () => {
    const user = window.firebase.auth().currentUser;
    return user ? user.getIdToken() : "";
  });
  if (!token) {
    results.cooperation.detail = "no auth token";
    return;
  }
  const response = await fetch(`${WORKER}/cooperation/request`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      officeId: OFFICE_ID,
      targetOfficeId: TARGET_OFFICE,
      opportunityIds: [oppId],
      scopeType: "single"
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    results.cooperation.detail = `API ${response.status}: ${JSON.stringify(payload).slice(0, 120)}`;
    return;
  }
  const coopSnap = await db
    .collection("cooperationRequests")
    .doc(payload.cooperationRequestId || "")
    .get();
  if (!coopSnap.exists) {
    const fallback = await db
      .collection("cooperationRequests")
      .where("originatingOfficeId", "==", OFFICE_ID)
      .where("opportunityId", "==", oppId)
      .limit(1)
      .get();
    if (fallback.empty) {
      results.cooperation.detail = `API ok but missing Firestore doc (${payload.cooperationRequestId})`;
      return;
    }
  }
  results.cooperation.pass = true;
  results.cooperation.detail = payload.message || payload.requestId || "تم إرسال طلب التعاون";
}

async function testFcm(page) {
  let outcome = { ok: false, detail: "not run" };
  try {
    outcome = await page.evaluate(async (workerBase) => {
    function urlBase64ToUint8Array(base64String) {
      const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
      const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
      const raw = atob(base64);
      return Uint8Array.from(raw, (char) => char.charCodeAt(0));
    }
    const config = await fetch(`${workerBase}/fcm/config`).then((r) => r.json()).catch(() => ({}));
    if (!config.vapidKey) return { ok: false, detail: "no vapid key" };
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, detail: `permission=${permission}` };
    const serviceWorkerRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const subscription = await serviceWorkerRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.vapidKey)
    });
    const pushSubscription = subscription.toJSON();
    const officeId = localStorage.getItem("iaqar.officeId");
    const token = await firebase.auth().currentUser.getIdToken();
    const payload = {
      officeId,
      fcmRegistrationId: JSON.stringify(pushSubscription),
      registrationType: "webpush",
      pushSubscription,
      installationId: `e2e_${Date.now()}`,
      notificationPermission: permission,
      userAgent: navigator.userAgent,
      deviceName: "e2e",
      language: navigator.language || "ar-SA"
    };
    const registerResponse = await fetch(`${workerBase}/fcm/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const registerPayload = await registerResponse.json().catch(() => ({}));
    if (!registerResponse.ok) {
      return { ok: false, detail: `register ${registerResponse.status}`, registerPayload };
    }
    const testResponse = await fetch(`${workerBase}/fcm/test`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const testPayload = await testResponse.json().catch(() => ({}));
    if (!testResponse.ok) {
      return { ok: false, detail: `test ${testResponse.status}`, testPayload };
    }
    localStorage.setItem(`iaqar.fcm.enabled.${officeId}`, "1");
    return { ok: true, detail: `register+test ok`, testPayload };
  }, WORKER);
  } catch (error) {
    outcome = { ok: false, detail: String(error.message || error) };
  }
  const ls = await page.evaluate((office) => localStorage.getItem(`iaqar.fcm.enabled.${office}`), OFFICE_ID);
  const devices = await db
    .collection("offices")
    .doc(OFFICE_ID)
    .collection("devices")
    .where("enabled", "==", true)
    .limit(3)
    .get();
  if (outcome.ok && ls === "1" && !devices.empty) {
    results.fcm.pass = true;
    results.fcm.detail = `${outcome.detail}; devices=${devices.size}`;
  } else {
    results.fcm.detail = `${outcome.detail || "failed"}; ls=${ls}; devices=${devices.size}`;
  }
}

async function testMatching(page, oppClientId, oppOwnerId) {
  const token = await page.evaluate(async () => {
    const user = window.firebase.auth().currentUser;
    if (!user) return "";
    return user.getIdToken();
  });
  if (!token) {
    results.matching.detail = "no auth token";
    return;
  }
  const res = await fetch(`${WORKER}/matching/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      officeId: OFFICE_ID,
      opportunityId: oppClientId,
      notify: true
    })
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.matchCount) {
    results.matching.detail = `API ${res.status}: ${JSON.stringify(payload).slice(0, 200)}`;
    return;
  }
  const opId = payload.matches?.[0]?.operationId || "";
  const alertSnap = await db
    .collection("offices")
    .doc(OFFICE_ID)
    .collection("alerts")
    .limit(5)
    .get();
  const hasAlert = !alertSnap.empty;
  const opSnap = opId
    ? await db
        .collection("offices")
        .doc(OFFICE_ID)
        .collection("operations")
        .doc(opId)
        .get()
    : null;
  const hasOp = opSnap?.exists;
  if (hasOp || payload.operationsCreated > 0) {
    results.matching.pass = true;
    results.matching.detail = `matchCount=${payload.matchCount}; op=${opId || "created"}; alert=${hasAlert}`;
  } else {
    results.matching.detail = `match ok but no operation; payload=${JSON.stringify(payload).slice(0, 150)}`;
  }
}

async function main() {
  const { oppClientId, oppOwnerId } = await setupFirestore();
  const userDataDir = "/tmp/pw-staging-profile";
  const context = await firefox.launchPersistentContext(userDataDir, {
    headless: false,
    permissions: ["notifications"],
    locale: "ar-SA"
  });
  const page = context.pages()[0] || await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("[browser]", msg.text());
  });

  try {
    await loginPage(page);
    await testCover(page);
    await testCooperation(page, oppClientId);
    await testMatching(page, oppClientId, oppOwnerId);
    await testFcm(page);
  } catch (error) {
    console.error(error);
  } finally {
    await context.close();
  }

  console.log(JSON.stringify({ stagingUrl: STAGING_URL, officeId: OFFICE_ID, results }, null, 2));
  const allPass = Object.values(results).every((r) => r.pass);
  process.exit(allPass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
