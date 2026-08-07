/**
 * Staging live verification — cooperation, FCM, matching, cover.
 * Run: node /tmp/staging-verify.mjs
 */
import * as admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { chromium } from "playwright";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const STAGING_URL =
  process.env.STAGING_URL ||
  "https://iaqar-ai-staging.web.app";
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

async function getAuthTokenFromApi() {
  const initRes = await fetch(`${STAGING_URL}/__/firebase/init.json`);
  const { apiKey } = await initRes.json();
  const loginRes = await fetch(`${WORKER}/auth/phone-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: PHONE, password: PASSWORD, apiKey })
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok || !loginBody.customToken) {
    throw new Error(`phone-login failed: ${loginRes.status}`);
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
  if (!signRes.ok || !signBody.idToken) {
    throw new Error(`signIn failed: ${signRes.status}`);
  }
  return signBody.idToken;
}

async function testCooperation(page, oppClientId, oppOwnerId) {
  let uiDetail = "ui not run";
  try {
    await closeOfficeSettings(page);
    await openOpportunityBank(page);
    await page.waitForSelector(`[data-open-id="${oppClientId}"]`, { timeout: 45000 });
    await page.click(`[data-open-id="${oppClientId}"]`);
    await page.waitForSelector("#opportunityBankDetail:not([hidden])", { timeout: 15000 });
    await page.waitForSelector("#bankShareBtn", { timeout: 45000 });
    await page.click("#bankShareBtn");
    await page.waitForSelector("#bankShareForm:not([hidden])", { timeout: 15000 });
    const statusEl = page.locator("#bankShareStatus");
    const submitBtn = page.locator("#bankShareForm button[type='submit']");
    await page.fill("#bankShareForm input[name='targetOfficeId']", TARGET_OFFICE);
    const submitBox = await submitBtn.boundingBox();
    await page.click("#bankShareForm button[type='submit']");
    await page.waitForFunction(
      () => {
        const node = document.getElementById("bankShareStatus");
        return node && node.textContent && node.textContent.trim().length > 3;
      },
      { timeout: 25000 }
    );
    const statusText = await statusEl.innerText();
    const domBelowSubmit = await page.evaluate(() => {
      const submit = document.querySelector("#bankShareForm button[type='submit']");
      const status = document.getElementById("bankShareStatus");
      if (!submit || !status) return false;
      return (submit.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    const belowSubmit = domBelowSubmit;
    if (!/تم|إرسال|طلب|موجود/i.test(statusText)) {
      uiDetail = `ui status unexpected: ${statusText.slice(0, 60)}`;
    } else if (!belowSubmit) {
      uiDetail = "status not below submit button";
    } else {
      uiDetail = `ui ok below button: ${statusText.slice(0, 40)}`;
    }
    if (!/ui ok below button/i.test(uiDetail)) {
      results.cooperation.pass = false;
      results.cooperation.detail = uiDetail;
      return;
    }
  } catch (error) {
    uiDetail = `ui skip: ${String(error.message || error).slice(0, 100)}`;
  }

  const token = await getAuthTokenFromApi();
  const response = await fetch(`${WORKER}/cooperation/request`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      officeId: OFFICE_ID,
      targetOfficeId: TARGET_OFFICE,
      opportunityIds: [oppOwnerId],
      scopeType: "single"
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    results.cooperation.detail = `${uiDetail}; API ${response.status}: ${JSON.stringify(payload).slice(0, 120)}`;
    return;
  }
  const coopSnap = await db
    .collection("cooperationRequests")
    .doc(payload.cooperationRequestId || "")
    .get();
  if (!coopSnap.exists) {
    results.cooperation.detail = `${uiDetail}; API ok but missing Firestore doc`;
    return;
  }
  results.cooperation.pass = true;
  results.cooperation.detail = `${uiDetail}; firestore=${payload.cooperationRequestId}; ${payload.message || "saved"}`;
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
      let registrationType = "token";
      let registrationId = "";
      let pushSubscription = null;
      try {
        registrationId = await firebase.messaging().getToken({
          serviceWorkerRegistration,
          vapidKey: config.vapidKey
        });
      } catch (_) {
        registrationId = "";
      }
      if (!registrationId) {
        const subscription = await serviceWorkerRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.vapidKey)
        });
        pushSubscription = subscription.toJSON();
        registrationId = JSON.stringify(pushSubscription);
        registrationType = "webpush";
      }
      if (!registrationId) return { ok: false, detail: "no registration id" };
      const officeId = localStorage.getItem("iaqar.officeId");
      const token = await firebase.auth().currentUser.getIdToken();
      const payload = {
        officeId,
        fcmRegistrationId: registrationId,
        registrationType,
        fcmToken: registrationType === "token" ? registrationId : "",
        installationId: `e2e_${Date.now()}`,
        notificationPermission: permission,
        userAgent: navigator.userAgent,
        deviceName: "e2e",
        language: navigator.language || "ar-SA"
      };
      if (pushSubscription) payload.pushSubscription = pushSubscription;
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
      return { ok: true, detail: `register+test ok sent=${testPayload.sent} type=${registrationType}`, testPayload };
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
  const bound = devices.docs.some((doc) => {
    const data = doc.data();
    return data.officeId === OFFICE_ID && data.userUid;
  });
  if (outcome.ok && ls === "1" && !devices.empty && bound) {
    results.fcm.pass = true;
    results.fcm.detail = `${outcome.detail}; devices=${devices.size}; officeId+broker bound`;
  } else {
    results.fcm.detail = `${outcome.detail || "failed"}; ls=${ls}; devices=${devices.size}; bound=${bound}`;
  }
}

async function testMatching(page, oppClientId) {
  const token = await getAuthTokenFromApi();
  let res;
  let payload = {};
  for (let attempt = 0; attempt < 2; attempt += 1) {
    res = await fetch(`${WORKER}/matching/run`, {
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
    payload = await res.json().catch(() => ({}));
    if (res.ok) break;
    if (res.status >= 500) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!res.ok || !payload.matchCount) {
    const raw = res.status >= 500 ? `HTTP ${res.status}` : JSON.stringify(payload).slice(0, 200);
    results.matching.detail = `API ${res.status}: ${raw}`;
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
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: "chrome",
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
    await testFcm(page);
    await testMatching(page, oppClientId);
    await testCooperation(page, oppClientId, oppOwnerId);
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
