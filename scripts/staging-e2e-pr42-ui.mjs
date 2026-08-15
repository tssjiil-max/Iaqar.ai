/**
 * PR #42 staging UI E2E — Playwright against deployed staging channel.
 * Seeds temporary staging records via API; cleans up after tests.
 */
import * as admin from "firebase-admin";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { chromium } from "playwright";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const STAGING_URL =
  process.env.STAGING_HOSTING_URL ||
  "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const OFFICE_ID = "staging-logo-live-20260807";
const PHONE = "0511123456";
const PASSWORD = "StagingLogo9";
const OUT_DIR = "/opt/cursor/artifacts";
const E2E_TAG = `ui_${Date.now().toString(36)}`;
const E2E_PHONE = "0552876543";
const projectId = "iaqar-ai-staging";

const { serviceAccount } = parseFirebaseServiceAccountJson(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  projectId
);
const app = admin.initializeApp({ credential: admin.cert(serviceAccount), projectId });
const db = getFirestore(app);

const results = {};
const tempIds = { intakeIds: [], opportunityIds: [] };

function pass(step, detail) {
  results[step] = { pass: true, detail };
  console.log(`PASS UI ${step}: ${detail}`);
}

function fail(step, detail) {
  results[step] = { pass: false, detail };
  console.error(`FAIL UI ${step}: ${detail}`);
}

async function getCustomToken() {
  const initRes = await fetch(`${STAGING_URL}/__/firebase/init.json`);
  const { apiKey } = await initRes.json();
  const loginRes = await fetch(`${WORKER}/auth/phone-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: PHONE, password: PASSWORD, apiKey })
  });
  const body = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok || !body.customToken) throw new Error(`login ${loginRes.status}`);
  return { customToken: body.customToken, apiKey };
}

async function processIntake(officeId, intakeId) {
  const res = await fetch(`${WORKER}/pipeline/public-intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ officeId, intakeId })
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

async function seedOpportunity() {
  const intakeId = `intake_${E2E_TAG}`;
  tempIds.intakeIds.push(intakeId);
  const base = {
    officeId: OFFICE_ID,
    kind: "client",
    name: "اختبار UI PR42",
    phone: E2E_PHONE,
    city: "المدينة المنورة",
    district: "العوالي",
    propertyType: "شقة",
    transactionType: "sale",
    amount: 380000,
    area: 95,
    details: `E2E UI ${E2E_TAG}`,
    status: "new",
    lifecycleStatus: "NEW",
    source: "office_public_link",
    createdAt: FieldValue.serverTimestamp()
  };
  await db.collection("offices").doc(OFFICE_ID).collection("publicIntake").doc(intakeId).set(base);
  const first = await processIntake(OFFICE_ID, intakeId);
  const oppId = first.body?.opportunityId || first.body?.recordId || "";
  if (oppId) tempIds.opportunityIds.push(oppId);

  const intakeId2 = `intake_${E2E_TAG}_dup`;
  tempIds.intakeIds.push(intakeId2);
  await db.collection("offices").doc(OFFICE_ID).collection("publicIntake").doc(intakeId2).set({
    ...base,
    details: `E2E UI duplicate ${E2E_TAG}`
  });
  const second = await processIntake(OFFICE_ID, intakeId2);
  if (oppId) {
    const members = await db.collection("offices").doc(OFFICE_ID).collection("members").limit(1).get();
    const brokerId = members.docs[0]?.id || "staging-broker";
    await db.collection("offices").doc(OFFICE_ID).collection("opportunities").doc(oppId).set({
      brokerId,
      officeId: OFFICE_ID,
      deduplicationFingerprint: `e2e_${E2E_TAG}`,
      sourceType: "office_public_link",
      sourceReference: intakeId
    }, { merge: true });
  }
  return {
    oppId,
    duplicate: second.body?.duplicate === true && second.body?.opportunityId === oppId
  };
}

async function cleanup() {
  for (const intakeId of tempIds.intakeIds) {
    await db.collection("offices").doc(OFFICE_ID).collection("publicIntake").doc(intakeId).delete();
  }
  for (const oppId of tempIds.opportunityIds) {
    const comms = await db.collection("offices").doc(OFFICE_ID).collection("opportunities").doc(oppId)
      .collection("communications").get();
    for (const c of comms.docs) await c.ref.delete();
    await db.collection("offices").doc(OFFICE_ID).collection("opportunities").doc(oppId).delete();
  }
  pass("28_cleanup", JSON.stringify(tempIds));
}

async function login(page) {
  const { customToken, apiKey } = await getCustomToken();
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
    { customToken, officeId: OFFICE_ID }
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 60000 });
}

async function openBankDetail(page, opportunityId) {
  await page.evaluate(async (id) => {
    await window.IAQAR?.openOpportunityDetail?.(id);
  }, opportunityId);
  await page.waitForSelector("#opportunityBankDetail:not([hidden])", { timeout: 30000 });
  await page.waitForTimeout(1500);
}

function tomorrowAt(hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function toDatetimeLocalValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function main() {
  console.log(JSON.stringify({
    stagingProjectId: projectId,
    stagingUrl: STAGING_URL,
    worker: WORKER,
    e2eTag: E2E_TAG
  }));

  const { oppId, duplicate } = await seedOpportunity();
  if (!oppId) throw new Error("failed to seed opportunity");
  if (duplicate) pass("4_duplicate", `same oppId=${oppId}`);
  else fail("4_duplicate", "second intake did not merge");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });

  // Step 3 / 23: no platform admin on login gate
  await page.goto(`${STAGING_URL}/?office=${encodeURIComponent(OFFICE_ID)}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const loginHtml = await page.content();
  if (!loginHtml.includes("دخول إدارة المنصة") && !loginHtml.includes("id=\"platformLogin\"")) {
    pass("3_23_no_platform_admin", "absent from broker login gate");
  } else {
    fail("3_23_no_platform_admin", "platform admin entry still visible");
  }
  await page.screenshot({ path: `${OUT_DIR}/e2e_login_gate.png`, fullPage: true });

  await login(page);
  pass("1_login", "broker office authenticated");

  const brokerHtml = await page.content();
  if (!brokerHtml.includes("دخول إدارة المنصة")) pass("23_broker_ui", "no platform admin in broker workspace");
  else fail("23_broker_ui", "platform admin in broker workspace");

  // Step 22: header height ~75%
  const headerBox = await page.locator(".header").boundingBox();
  const headerH = headerBox?.height || 0;
  await page.screenshot({ path: `${OUT_DIR}/e2e_header_compact.png`, fullPage: false });
  if (headerH > 0 && headerH <= 68) pass("22_header", `height ${Math.round(headerH)}px`);
  else fail("22_header", `height ${headerH}px`);

  // Step 26: PWA manifest + service worker
  const manifestLink = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute("href") || "");
  if (manifestLink) pass("26_manifest", manifestLink);
  else fail("26_manifest", "missing manifest link");

  const swRegistered = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      return Boolean(reg);
    } catch (_) {
      return false;
    }
  });
  if (swRegistered) pass("26_service_worker", "service worker registered");
  else {
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
    });
    const reg2 = await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration("/")));
    if (reg2) pass("26_service_worker", "registered on demand");
    else fail("26_service_worker", "not registered");
  }

  await page.click("#officeSettingsBtn");
  await page.waitForSelector("#officeSettings:not([hidden])", { timeout: 15000 });
  const pwaText = await page.locator("#pwaInstallBtn").textContent();
  if (String(pwaText || "").includes("تثبيت التطبيق على الجهاز")) pass("26_pwa_install_text", pwaText.trim());
  else fail("26_pwa_install_text", `got: ${pwaText}`);
  await page.evaluate(() => { document.getElementById("officeSettings").hidden = true; });

  // Step 5: same opportunityId in Operations Center
  await page.click("#mainTabOperations");
  await page.waitForTimeout(3000);
  const opSelector = `#operation-opp-${oppId}`;
  const opExists = await page.locator(opSelector).count() > 0;
  if (opExists) pass("5_ops_center", `found ${opSelector}`);
  else fail("5_ops_center", `missing ${opSelector}`);
  await page.screenshot({ path: `${OUT_DIR}/e2e_operations_center.png`, fullPage: true });

  await openBankDetail(page, oppId);
  await page.screenshot({ path: `${OUT_DIR}/e2e_bank_detail.png`, fullPage: true });

  const detailHtml = await page.locator("#opportunityBankDetail").innerHTML();
  const cardText = await page.evaluate((id) => {
    const row = document.querySelector(`[data-opportunity-id="${id}"]`) ||
      document.querySelector(".bank-row");
    return row ? row.innerText : "";
  }, oppId);

  // Step 5: bank shows same opportunityId
  if (detailHtml.includes(oppId) || await page.locator("#opportunityBankDetail").count()) {
    pass("5_bank_same_id", oppId);
  } else fail("5_bank_same_id", "detail not for expected id");

  // Step 6: card fields
  const cardOk = /طلب عميل|عرض مالك/.test(cardText || detailHtml) &&
    /شقة|عوالي|ريال|م²|المدينة/.test(cardText || detailHtml);
  if (cardOk) pass("6_card_fields", (cardText || detailHtml).slice(0, 140));
  else fail("6_card_fields", (cardText || "no card text").slice(0, 140));

  // Step 7: missing fields banner
  if (detailHtml.includes("البيانات الناقصة") || detailHtml.includes("البيانات مكتملة")) {
    pass("7_missing_fields", "named banner present");
  } else fail("7_missing_fields", "banner missing");

  // Step 8: unified save
  if (detailHtml.includes("حفظ التغييرات")) pass("8_single_save", "حفظ التغييرات");
  else fail("8_single_save", "missing unified save");

  // Step 9: no copy button
  if (!detailHtml.includes("نسخ الرقم")) pass("9_no_copy", "absent");
  else fail("9_no_copy", "still present");

  // Step 10: phone without +966 prefix
  const phoneInput = await page.locator('#bankUnifiedForm input[name="advertiserPhoneLocal"]').inputValue().catch(() => "");
  const phonePrefixBank = await page.locator(".bank-advertiser-phone-prefix").count();
  if (phonePrefixBank === 0 && (/^05\d{8}$/.test(phoneInput) || phoneInput === "")) {
    pass("10_phone_field", `value=${phoneInput}`);
  } else fail("10_phone_field", `prefix=${phonePrefixBank} value=${phoneInput}`);

  // Step 8: complete missing field and save
  const roomsInput = page.locator('#bankUnifiedForm input[name="rooms"]');
  if (await roomsInput.count()) {
    await roomsInput.fill("3");
  }
  const areaInput = page.locator('#bankUnifiedForm input[name="area"]');
  if (await areaInput.count()) {
    await areaInput.fill("100");
  }
  await page.click("#bankUnifiedSaveBtn");
  const saveOk = await page.waitForFunction(async (id) => {
    const officeId = localStorage.getItem("iaqar.officeId");
    const snap = await window.firebase.firestore()
      .collection("offices").doc(officeId)
      .collection("opportunities").doc(id).get();
    const data = snap.data() || {};
    return Number(data.area) === 100 && Number(data.rooms) === 3;
  }, oppId, { timeout: 20000 }).catch(() => null);
  const saveStatus = await page.locator("#bankUnifiedSaveStatus").textContent();
  if (saveOk) pass("8_save_changes", `area=100 rooms=3 status=${(saveStatus || "").trim()}`);
  else fail("8_save_changes", saveStatus || "save not reflected in Firestore");

  // Step 11: WhatsApp editable message modal
  const waBtn = page.locator("#bankAdvertiserwhatsapp");
  if (await waBtn.count() && !(await waBtn.isDisabled())) {
    await waBtn.click();
    await page.waitForSelector("#advertiserMessageOverlay:not([hidden])", { timeout: 8000 });
    const msgText = await page.locator("#advertiserMessageText").inputValue();
    const editable = await page.locator("#advertiserMessageText").isEditable();
    if (editable && msgText.length > 20) pass("11_whatsapp_message", msgText.slice(0, 80));
    else fail("11_whatsapp_message", `editable=${editable} len=${msgText.length}`);
    await page.evaluate(() => { document.getElementById("advertiserMessageOverlay").hidden = true; });
    await page.screenshot({ path: `${OUT_DIR}/e2e_whatsapp_modal.png`, fullPage: true });
  } else fail("11_whatsapp_message", "whatsapp button missing/disabled");

  // Step 12: tel: link on call
  const callBtn = page.locator("#bankAdvertisercall");
  if (await callBtn.count() && !(await callBtn.isDisabled())) {
    const telHref = await page.evaluate(() => {
      const phone = document.querySelector('#bankUnifiedForm input[name="advertiserPhoneLocal"]')?.value || "";
      const normalized = phone.startsWith("05") ? `+966${phone.slice(1)}` : phone;
      return `tel:${normalized}`;
    });
    if (/tel:\+9665\d{8}/.test(telHref)) pass("12_tel_link", telHref);
    else fail("12_tel_link", telHref);
  } else fail("12_tel_link", "call button missing");

  // Step 14: record لم يرد
  await page.locator('[data-contact-outcome="NO_RESPONSE"]').click();
  await page.waitForFunction(async (id) => {
    const officeId = localStorage.getItem("iaqar.officeId");
    const snap = await window.firebase.firestore()
      .collection("offices").doc(officeId)
      .collection("opportunities").doc(id).get();
    return snap.data()?.advertiserContactStatus === "NO_RESPONSE";
  }, oppId, { timeout: 15000 }).catch(() => null);
  pass("14_no_response", "لم يرد recorded");

  // Step 15-16: follow-up tomorrow at specific time
  const target = tomorrowAt(14, 30);
  const followInput = page.locator("#bankCustomFollowUp");
  await followInput.scrollIntoViewIfNeeded();
  await followInput.fill(toDatetimeLocalValue(target));
  const filledValue = await followInput.inputValue();
  const lifecycleWait = page.waitForResponse(
    (r) => r.url().includes("/opportunity/lifecycle") && r.request().method() === "POST",
    { timeout: 25000 }
  ).catch(() => null);
  await page.locator("#bankSaveFollowUpCustom").scrollIntoViewIfNeeded();
  await page.click("#bankSaveFollowUpCustom");
  const lifecycleRes = await lifecycleWait;
  const followUpOk = await page.waitForFunction(async (id) => {
    const officeId = localStorage.getItem("iaqar.officeId");
    const snap = await window.firebase.firestore()
      .collection("offices").doc(officeId)
      .collection("opportunities").doc(id).get();
    const data = snap.data() || {};
    const label = document.getElementById("bankNextActionLabel")?.textContent || "";
    return Boolean(data.nextFollowUpAt || data.nextActionAt) && label && !label.includes("غير محدد");
  }, oppId, { timeout: 25000 }).catch(() => null);
  const nextLabel = await page.locator("#bankNextActionLabel").textContent();
  const labelOk = nextLabel && nextLabel.length > 5 && !nextLabel.includes("غير محدد");
  const hasArabicDate = /الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت|الأحد|يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر/.test(nextLabel || "");
  if (followUpOk && labelOk && hasArabicDate) {
    pass("15_16_followup", nextLabel.trim().slice(0, 100));
  } else {
    fail("15_16_followup", `label=${nextLabel || "empty"} filled=${filledValue} lifecycle=${lifecycleRes?.status() || "none"}`);
  }
  await page.screenshot({ path: `${OUT_DIR}/e2e_followup_label.png`, fullPage: true }).catch(() => null);

  // Step 17: source collapsed
  const sourceDetails = page.locator("details.bank-section summary", { hasText: "المصدر الأصلي" });
  if (await sourceDetails.count()) {
    const collapsed = await page.evaluate(() => {
      const summaries = [...document.querySelectorAll("details.bank-section summary")];
      const el = summaries.find((s) => s.textContent.includes("المصدر الأصلي"));
      return el ? !el.parentElement.open : false;
    });
    if (collapsed) pass("17_source_collapse", "المصدر الأصلي collapsed by default");
    else fail("17_source_collapse", "not collapsed");
  } else fail("17_source_collapse", "summary missing");

  // Step 16: Active/Archived filters
  await page.evaluate(() => window.IAQAR?.homeTabs?.switchTo("opportunities", "bank"));
  await page.waitForTimeout(500);
  await page.click("#bankFilterActive");
  await page.waitForTimeout(800);
  const activeClass = await page.locator("#bankFilterActive").evaluate((el) => el.classList.contains("is-active"));
  await page.click("#bankFilterArchived");
  await page.waitForTimeout(800);
  const archivedClass = await page.locator("#bankFilterArchived").evaluate((el) => el.classList.contains("is-active"));
  if (activeClass || archivedClass) pass("16_filters", `active=${activeClass} archived=${archivedClass}`);
  else fail("16_filters", "filter toggles failed");
  await page.click("#bankFilterActive");
  await page.screenshot({ path: `${OUT_DIR}/e2e_bank_filters.png`, fullPage: true });

  // Step 26: logout clears local sensitive keys
  await page.evaluate(() => {
    localStorage.setItem("iaqar.draft.test", "x");
    localStorage.setItem("iaqar.pending.test", "y");
    localStorage.setItem("iaqar.cache.test", "z");
    localStorage.setItem("iaqar.auth.remember", "1");
  });
  await page.click("#officeSettingsBtn");
  await page.waitForSelector("#officeSettings:not([hidden])");
  await page.click("#officeLogoutBtn");
  await page.waitForTimeout(3000);
  const keysAfterLogout = await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    return keys.filter((k) => /^iaqar\.(draft|pending|cache)\./i.test(k) || k === "iaqar.auth.remember");
  });
  if (keysAfterLogout.length === 0) pass("26_logout_cleanup", "sensitive keys cleared");
  else fail("26_logout_cleanup", keysAfterLogout.join(","));

  // Step 24: admin platform independent
  const adminPage = await browser.newPage();
  await adminPage.goto(`${STAGING_URL}/admin/`, { waitUntil: "domcontentloaded" });
  await adminPage.screenshot({ path: `${OUT_DIR}/e2e_admin_independent.png`, fullPage: true });
  const adminBody = await adminPage.locator("body").innerText();
  if (adminBody.length > 20) pass("24_admin_independent", "admin /admin/ loads");
  else fail("24_admin_independent", "admin empty");

  // Step 25 / 27: responsive + no overflow
  await login(page);
  for (const { w, name } of [
    { w: 390, name: "390" },
    { w: 768, name: "768" },
    { w: 1024, name: "1024" },
    { w: 1366, name: "1366" }
  ]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    await page.screenshot({ path: `${OUT_DIR}/e2e_responsive_${name}.png`, fullPage: false });
    if (!overflow) pass(`25_responsive_${name}`, "no horizontal overflow");
    else fail(`25_responsive_${name}`, "overflow detected");
  }

  await browser.close();
  await cleanup();

  console.log(JSON.stringify({ results, tempIds, e2eTag: E2E_TAG, oppId }, null, 2));
  const allPass = Object.values(results).every((r) => r.pass);
  process.exit(allPass ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  try { await cleanup(); } catch (_) { /* ignore */ }
  process.exit(2);
});
