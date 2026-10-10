// Office OS — live journey on the pre-merge preview (Staging project, isolated QA office).
// Runs in the office-os-preview workflow after deploy-office-os-preview.sh.
//   env: PREVIEW_URL, PREVIEW_WORKER_URL, FIREBASE_SERVICE_ACCOUNT_JSON, OUT_DIR
// Guards: Staging service account + preview channel host only. Touches only
// offices/qa-office-os-preview*, their replyLinks, and this run's users/login entries.
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { parseFirebaseServiceAccountJson } from "../../staging-credentials.mjs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

for (const event of ["uncaughtException", "unhandledRejection"]) {
  process.on(event, (error) => { console.log(`::error title=live script crashed::${String(error?.stack || error).split("\n").slice(0, 3).join(" | ").replace(/%/g, "%25")}`); process.exit(1); });
}
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();

const PREVIEW_URL = String(process.env.PREVIEW_URL || "").replace(/\/+$/, "");
const WORKER_URL = String(process.env.PREVIEW_WORKER_URL || "").replace(/\/+$/, "");
const OUT = process.env.OUT_DIR || "qa-live";
fs.mkdirSync(OUT, { recursive: true });
// LIVE_TARGET=production: the same journey on iaqar.ai (production pilot) with its own isolated QA offices,
// which are removed completely at the end. Only with the production service account and the production hosts.
const ON_PRODUCTION = String(process.env.LIVE_TARGET || "") === "production";
const PROJECT = ON_PRODUCTION ? "aqar-b5d76" : "iaqar-ai-staging";
const OFFICE = ON_PRODUCTION ? "qa-office-os-pilot" : "qa-office-os-preview";
const OFFICE_B = ON_PRODUCTION ? "qa-office-os-pilot-b" : "qa-office-os-preview-b";
const RUN = String(process.env.GITHUB_RUN_ID || Date.now()).replace(/[^0-9A-Za-z]/g, "");

const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}`); };
const report = { at: new Date().toISOString(), previewUrl: PREVIEW_URL, workerUrl: WORKER_URL, run: RUN, checks, fcm: null, gemini: null };

// Allowed targets: the office-os-preview channel + preview Worker, or the shared Staging
// channel + Staging Worker (post-merge). Anything else (incl. Production) is refused.
const HOST = new URL(PREVIEW_URL).hostname;
const onPreview = HOST.startsWith(`${PROJECT}--office-os-preview`) && /^https:\/\/iaqar-intake-os-preview\./.test(WORKER_URL);
const onStaging = HOST === `${PROJECT}--staging-9c4b0k7h.web.app` && /^https:\/\/iaqar-intake-staging\./.test(WORKER_URL);
const onProduction = ON_PRODUCTION && HOST === "iaqar.ai" && WORKER_URL === "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
if (ON_PRODUCTION ? !onProduction : (!onPreview && !onStaging)) throw new Error(`refusing: ${PREVIEW_URL} + ${WORKER_URL} is not the allowed target`);
const { serviceAccount } = parseFirebaseServiceAccountJson(ON_PRODUCTION ? process.env.FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON : process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT);
if (serviceAccount?.project_id !== PROJECT) throw new Error(`refusing: service account is not ${PROJECT}`);
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();

const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
const phoneFor = () => `05999${String(crypto.randomInt(0, 99999)).padStart(5, "0")}`;
const intl = (p) => `+966${p.slice(1)}`;
const QA_PATH = ON_PRODUCTION ? /^offices\/qa-office-os-pilot(-b)?(\/|$)/ : /^offices\/qa-office-os-preview(-b)?(\/|$)/;
const assertQa = (ref) => { if (!QA_PATH.test(ref.path) && !ref.path.startsWith("replyLinks/")) throw new Error(`refusing path ${ref.path}`); return ref; };

async function resetOffice(officeId, ownerUid, name, slug) {
  const office = assertQa(db.collection("offices").doc(officeId));
  const snap = await office.get();
  if (snap.exists && snap.data().isTestFixture !== true) throw new Error(`refusing: ${officeId} exists and is not a test fixture`);
  for (const sub of ["opportunities", "matches", "operations", "journeys", "proposals", "notifications", "publicIntake", "matchCurrentPointers", "osFailures", "contacts", "clients", "owners", "members", "officeSettings", "notificationDispatches", "devices"]) {
    await db.recursiveDelete(assertQa(office.collection(sub)));
  }
  const links = await db.collection("replyLinks").where("officeId", "==", officeId).get();
  for (const d of links.docs) await assertQa(d.ref).delete();
  const profile = {
    officeId, officeName: name, officeNameKey: `qa${officeId.replace(/[^a-z]/g, "")}`, brokerName: "وسيط الاختبار", licenseNumber: "1200000000",
    city: "الرياض", phone: "0500000000", ownerUid, active: true, isTestFixture: true, createdBy: "E2E", publicSlug: slug, specialties: ["sale"],
    platformOpportunityOnboardingAckAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  };
  await office.set(profile);
  await db.collection("publicOffices").doc(officeId).set({ ...profile, isTestFixture: true });
  await office.collection("members").doc(ownerUid).set({ uid: ownerUid, role: "owner", active: true, isTestFixture: true, testRunId: RUN });
}

async function makeUser(role, officeId) {
  const uid = `qa-os-${role}-${RUN}`.slice(0, 128);
  const phone = phoneFor();
  const email = `${uid}@qa-preview.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const dirRef = db.collection("loginDirectory").doc(sha(intl(phone)));
  if ((await dirRef.get()).exists) throw new Error("refusing: login directory collision");
  await auth.createUser({ uid, email, password, displayName: `QA ${role}` });
  await dirRef.set({ uid, officeId, email, phone: intl(phone), active: true, isTestFixture: true, testRunId: RUN });
  return { uid, phone, email, password, dirRef };
}

async function until(fn, label, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 1000)); }
  throw new Error(`timeout: ${label}`);
}

const users = [];
const browser = await chromium.launch();
async function shot(page, name) {
  await page.waitForTimeout(1200);
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  check(`live: no horizontal scroll ${name}`, overflow <= 1, `${overflow}px`);
  await page.screenshot({ path: path.join(OUT, `live-${name}.png`), fullPage: true });
}
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true };

try {
  const owner = await makeUser("owner", OFFICE); users.push(owner);
  const ownerB = await makeUser("ownerb", OFFICE_B); users.push(ownerB);
  await resetOffice(OFFICE, owner.uid, "مكتب اختبار المعاينة", ON_PRODUCTION ? "qa-os-pilot" : "qa-os-preview");
  await resetOffice(OFFICE_B, ownerB.uid, "مكتب اختبار العزل", ON_PRODUCTION ? "qa-os-pilot-b" : "qa-os-preview-b");
  const office = db.collection("offices").doc(OFFICE);

  const health = await (await fetch(`${WORKER_URL}/health`)).json();
  check(`Worker healthy on ${PROJECT}`, health.backendReady === true && health.deploymentEnvironment === (ON_PRODUCTION ? "production" : "staging") && health.projectId === PROJECT, JSON.stringify({ projectId: health.projectId, env: health.deploymentEnvironment }));

  // 1 visitor → office link (no account)
  const visitorCtx = await browser.newContext(mobile);
  const visitor = await visitorCtx.newPage();
  visitor.setDefaultTimeout(30000);
  await visitor.goto(`${PREVIEW_URL}/?office=${OFFICE}&view=public`);
  await visitor.getByText("مكتب اختبار المعاينة").first().waitFor();
  await shot(visitor, "01-public-office");
  await visitor.getByRole("button", { name: /لدي عقار/ }).click();
  await visitor.getByRole("button", { name: "بيع" }).click();
  await visitor.fill('input[name="propertyType"]', "شقة");
  await visitor.fill('input[name="city"]', "الرياض");
  await visitor.fill('input[name="district"]', "الملقا");
  await visitor.fill('input[name="price"]', "1250000");
  await visitor.fill('input[name="contactName"]', "مالك اختباري");
  await visitor.fill('input[name="contactPhone"]', "0599911111");
  await visitor.getByRole("button", { name: "إرسال" }).click();
  await visitor.getByText("تم استلام بياناتك").waitFor();
  await shot(visitor, "02-public-submitted");
  const offer = await until(async () => (await office.collection("opportunities").where("opportunityKind", "==", "OFFER").get()).docs[0], "office-link offer");
  check("live: office link offer stored in the QA office, assigned to its owner, area optional", offer.data().brokerId === owner.uid && !offer.data().area, offer.id);

  // 2 owner logs in through «دخول المكتب» and adds a request
  const ownerCtx = await browser.newContext(mobile);
  await ownerCtx.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "whatsapp" }));
  ownerCtx.on("page", (p) => { p.waitForLoadState().then(() => { if (p.url().startsWith("https://wa.me")) setTimeout(() => p.close().catch(() => {}), 300); }).catch(() => {}); });
  const page = await ownerCtx.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(`${PREVIEW_URL}/`);
  await page.fill('input[name="phone"]', owner.phone);
  await page.fill('input[name="password"]', owner.password);
  await page.getByRole("button", { name: "دخول المكتب" }).click();
  await page.locator(".ref-office-tools").waitFor();
  check("live: real «دخول المكتب» login (phone → Worker resolve → Firebase Auth → membership)", true);
  await page.locator(".ref-bottom").getByRole("button", { name: "العروض والطلبات", exact: true }).click();
  await page.getByRole("button", { name: "إضافة سجل جديد" }).click();
  await page.getByRole("button", { name: "إضافة طلب", exact: true }).click();
  await page.getByRole("button", { name: "شراء" }).click();
  await page.fill('input[name="propertyType"]', "شقة");
  await page.fill('input[name="district"]', "الملقا");
  await page.fill('input[name="price"]', "1300000");
  await page.fill('input[name="contactName"]', "عميل اختباري");
  await page.fill('input[name="contactPhone"]', "0599922222");
  await page.getByRole("button", { name: "حفظ وفحص المطابقات" }).click();
  await page.getByText("تفاصيل السجل").waitFor();
  await page.getByText("مطابقة بانتظار مراجعتك").waitFor({ timeout: 45000 });
  await shot(page, "03-record-with-review");

  // 3 daily tasks → review → approve
  await page.goto(`${PREVIEW_URL}/#/tasks`);
  const card = page.locator('[data-type="MATCH_REVIEW"]');
  await card.first().waitFor();
  check("live: exactly one review task for the new match", await card.count() === 1);
  const review = (await office.collection("operations").where("type", "==", "MATCH_REVIEW").get()).docs.map((d) => d.data());
  check("live: MATCH_REVIEW carries office/match/offer/request/assigned broker", review.length === 1 && review[0].offerId && review[0].requestId && review[0].matchId && review[0].assignedBrokerId === owner.uid && review[0].officeId === OFFICE);
  await shot(page, "04-daily-tasks-review");
  await card.getByRole("button", { name: "مراجعة المطابقة" }).click();
  await page.getByText("أسباب التوافق").waitFor();
  await shot(page, "05-match-review");
  await page.getByRole("button", { name: "اعتماد وبدء التفاوض" }).click();
  await page.getByText("المطلوب الآن: إرسال مقترح").waitFor();
  await shot(page, "06-workspace-negotiation");
  const journeyDoc = await until(async () => (await office.collection("journeys").get()).docs[0], "journey");

  // 4 proposal → WhatsApp handoff
  await page.locator("#now").getByRole("button", { name: "اقتراح سعر" }).click();
  const sheet = page.locator(".os-sheet");
  await sheet.locator('input[name="price"]').fill("1,200,000");
  await sheet.getByRole("button", { name: "تجهيز المقترح والرابط" }).click();
  await sheet.getByText("تم تجهيز المقترح").waitFor();
  await shot(page, "07-composer-prepared");
  const popup = ownerCtx.waitForEvent("page").catch(() => null);
  await sheet.getByRole("link", { name: /إرسال عبر واتساب إلى العميل/ }).click();
  const wa = await popup;
  check("live: WhatsApp opens with the client number and the prepared text", Boolean(wa && /wa\.me\/966599922222\?text=/.test(wa.url())));
  await sheet.getByText("تم فتح واتساب").first().waitFor();
  await page.locator(".os-sheet .os-icon-btn").click();
  const clientProposal = await until(async () => (await office.collection("proposals").where("recipientRole", "==", "client").get()).docs.map((d) => d.data()).find((p) => p.sendState === "OPENED_EXTERNAL"), "handoff");
  check("live: handoff stored as OPENED_EXTERNAL only", !clientProposal.sentAt && !clientProposal.deliveredAt && clientProposal.replyUrl.startsWith(`${PREVIEW_URL}/r#`), clientProposal.replyUrl.replace(/#.*/, "#…"));

  // FCM probe: a deliberately invalid device for the QA broker, so the reply notification
  // exercises the real FCM HTTP v1 call and records the provider's answer.
  await office.collection("devices").doc(`qa-invalid-${RUN}`).set({ fcmRegistrationId: `qa-invalid-fid-${RUN}`, registrationType: "fid", userUid: owner.uid, enabled: true, isTestFixture: true });

  // 5 client replies on the light page (no account), double press + reload
  const clientCtx = await browser.newContext(mobile);
  const client = await clientCtx.newPage();
  client.setDefaultTimeout(30000);
  await client.goto(clientProposal.replyUrl);
  await client.getByText("اختر ردك").waitFor();
  check("live: reply page hides the other party", !(await client.content()).includes("0599911111"));
  await shot(client, "08-reply-page");
  await client.locator('[data-option="accept_initial"]').click();
  await client.getByRole("button", { name: "إرسال الرد" }).dblclick();
  await client.getByText("تم حفظ ردك").waitFor();
  await shot(client, "09-reply-saved");
  await client.reload();
  await client.getByText("عدّل ردك").waitFor();
  const replies = (await journeyDoc.ref.collection("events").where("type", "==", "PARTY_REPLY").get()).size;
  check("live: double press + reload → one reply event", replies === 1, `events=${replies}`);
  const notif = await until(async () => (await office.collection("notifications").where("type", "==", "JOURNEY_UPDATE").get()).docs.map((d) => d.data())[0], "broker notification");
  check("live: broker in-app notification created for the reply", notif.brokerId === owner.uid);
  const providerState = JSON.parse(notif.providerStateJson || "{}");
  report.fcm = { providerState, note: "Invalid test device registered on purpose: proves the Worker calls FCM HTTP v1 and records the provider answer. Real delivery to a phone is not verifiable here." };
  check("live: reply notification reached FCM and the provider answer was recorded", ["PROVIDER_REJECTED", "ACCEPTED_BY_PROVIDER"].includes(providerState.push), JSON.stringify(providerState));

  // 6 replaced proposal retires the old link
  await page.goto(`${PREVIEW_URL}/#/tasks`);
  await page.locator('[data-type="PROPOSAL_REPLY"]').first().waitFor({ timeout: 45000 });
  await shot(page, "10-daily-tasks-reply");
  await page.locator('[data-type="PROPOSAL_REPLY"]').getByRole("button", { name: "مراجعة الرد" }).click();
  await page.getByText("المطلوب الآن: مراجعة الرد").waitFor();
  await page.locator("#now").getByRole("button", { name: "إرسال مقترح جديد" }).click();
  await sheet.getByRole("button", { name: "العميل" }).click();
  await sheet.locator('input[name="price"]').fill("1,190,000");
  await sheet.getByRole("button", { name: "تجهيز المقترح والرابط" }).click();
  await sheet.getByText("تم تجهيز المقترح").waitFor();
  await page.locator(".os-sheet .os-icon-btn").click();
  await client.goto("about:blank");
  await client.goto(clientProposal.replyUrl);
  await client.getByText("تم تحديث هذا المقترح").waitFor();
  await shot(client, "11-reply-old-link-updated");
  check("live: old link after replacement says it was updated", true);

  // 7 viewing: propose → accept → confirm → result
  await page.goto(`${PREVIEW_URL}/#/journey/${journeyDoc.id}`);
  await page.locator('[data-panel="communication"] > summary').click();
  await page.locator('[data-panel="communication"]').getByRole("button", { name: "إرسال مقترح", exact: true }).click();
  await sheet.getByRole("button", { name: "تحديد أو تعديل معاينة" }).click();
  await sheet.getByRole("button", { name: "العميل" }).click();
  await sheet.getByRole("button", { name: "تجهيز المقترح والرابط" }).click();
  await sheet.getByText("تم تجهيز المقترح").waitFor();
  await sheet.getByRole("link", { name: /إرسال عبر واتساب إلى العميل/ }).click();
  await sheet.getByText("تم فتح واتساب").first().waitFor();
  await page.locator(".os-sheet .os-icon-btn").click();
  const viewingProposal = await until(async () => (await office.collection("proposals").where("kind", "==", "VIEWING").get()).docs[0]?.data(), "viewing proposal");
  await client.goto("about:blank");
  await client.goto(viewingProposal.replyUrl);
  await client.locator('[data-option="accept"]').click();
  await client.getByRole("button", { name: "إرسال الرد" }).click();
  await client.getByText("تم حفظ ردك").waitFor();
  await page.goto(`${PREVIEW_URL}/#/tasks`);
  const confirmCard = page.locator('[data-type="VIEWING_CONFIRM"]');
  await confirmCard.first().waitFor({ timeout: 45000 });
  check("live: accepted viewing is not confirmed", (await journeyDoc.ref.get()).data().viewing.state === "ACCEPTED");
  await shot(page, "12-daily-tasks-confirm");
  await confirmCard.getByRole("button", { name: "تأكيد الموعد" }).click();
  await until(async () => (await journeyDoc.ref.get()).data().viewing.state === "CONFIRMED", "viewing confirmed");
  await page.goto(`${PREVIEW_URL}/#/journey/${journeyDoc.id}`);
  await page.getByText("المطلوب الآن: نتيجة المعاينة").waitFor();
  await shot(page, "13-workspace-viewing");
  await page.locator('#now [data-result="interested"]').click();
  await page.getByRole("button", { name: "حفظ النتيجة ومتابعة الصفقة" }).click();
  await page.getByText("المطلوب الآن: متابعة إجراءات الاتفاق").waitFor();
  await shot(page, "14-workspace-agreement");

  // 8 Gemini assist through the preview Worker
  await page.locator('[data-panel="assistant"] > summary').click();
  await page.getByRole("button", { name: "اقتراح المساعد" }).click();
  await page.getByRole("button", { name: "اقتراح المساعد" }).waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
  const assistText = await page.locator(".os-ai").innerText();
  const assistApi = await page.evaluate(async ([w, o, j]) => {
    const token = await firebase.auth().currentUser.getIdToken();
    const r = await fetch(`${w}/os/assist/suggest`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ officeId: o, journeyId: j }) });
    return r.json();
  }, [WORKER_URL, OFFICE, journeyDoc.id]);
  report.gemini = { uiSource: assistText.includes("المساعد الذكي") ? "ai" : "rules", apiSource: assistApi.source, fallbackReason: assistApi.fallbackReason || "", text: String(assistApi.suggestion || assistText).slice(0, 300) };
  check("live: assist returns a suggestion (AI or rule-based fallback, labelled)", assistText.length > 20, `${report.gemini.apiSource}${report.gemini.fallbackReason ? ` / ${report.gemini.fallbackReason}` : ""}`);

  // 9 explicit completion
  await page.locator("#now").getByRole("button", { name: "إتمام الصفقة" }).click();
  await page.locator(".os-sheet input").fill("1210000");
  await page.getByRole("button", { name: "تأكيد إتمام الصفقة" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "إتمام" }).click();
  await page.getByText("تمت الصفقة").first().waitFor();
  await shot(page, "15-workspace-closed");
  const closed = (await journeyDoc.ref.get()).data();
  check("live: deal completed explicitly and archived; one journey", closed.status === "CLOSED_WON" && Boolean(closed.archivedAt) && (await office.collection("journeys").get()).size === 1);
  const openTasks = (await office.collection("operations").where("journeyId", "==", journeyDoc.id).get()).docs.filter((d) => ["OPEN", "WAITING_EXTERNAL_RESPONSE"].includes(d.data().status)).length;
  check("live: no open tasks remain for the closed opportunity", openTasks === 0);
  await page.goto(`${PREVIEW_URL}/#/repo`);
  await page.locator("[data-record]").first().waitFor();
  await shot(page, "16-repository");

  // 9b — new journey features, live: signup entry, «قريبًا» tools, fixed price → free slot → booking,
  // match.appointmentAt for the scheduled reminders, one card per deal, «بلا مطابقة» tab.
  try {
    const anon = await (await browser.newContext(mobile)).newPage();
    anon.setDefaultTimeout(30000);
    await anon.goto(`${PREVIEW_URL}/`);
    await anon.locator("[data-broker-signup]").waitFor();
    await anon.locator("[data-broker-signup]").click();
    await anon.locator("[data-broker-form]").waitFor();
    check("live: «تسجيل وسيط جديد» opens the application form inside Office OS", (await anon.locator("[data-broker-form] input").count()) === 6 && !anon.url().includes("legacy"));
    await anon.goto(`${PREVIEW_URL}/#/register`);
    await anon.reload(); // a hash-only change does not restart the app; the deep link is read at start
    await anon.locator("[data-broker-form]").waitFor();
    check("live: #/register opens the application form directly (nothing is submitted)", true);
    await anon.goto(`${PREVIEW_URL}/#/forgot`);
    await anon.reload();
    await anon.locator("[data-forgot-form]").waitFor();
    check("live: #/forgot opens the password reset form directly (nothing is submitted)", true);

    await page.goto(`${PREVIEW_URL}/#/office`);
    await page.locator(".ref-office-tools").waitFor();
    check("live: the 6 office tools are working buttons (no «قريبًا» placeholders)", (await page.locator("button.ref-office-tool").count()) === 6 && (await page.locator(".ref-office-soon").count()) === 0);

    const api = (route, body) => page.evaluate(async ([w, r, b]) => {
      const token = await firebase.auth().currentUser.getIdToken();
      const res = await fetch(`${w}${r}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(b) });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    }, [WORKER_URL, route, body]);
    const district = "الربيع";
    const request2 = await api("/os/records/save", { officeId: OFFICE, requestKey: `live-r-${RUN}`, record: { kind: "REQUEST", purpose: "PURCHASE", propertyType: "فيلا", city: "الرياض", district, price: 2500000, contactName: "عميل اختباري ٢", contactPhone: "0599933333" } });
    const offer2 = await api("/os/records/save", { officeId: OFFICE, requestKey: `live-o-${RUN}`, record: { kind: "OFFER", purpose: "SALE", propertyType: "فيلا", city: "الرياض", district, price: 2400000, priceStatus: "FIXED", contactName: "مالك اختباري ٢", contactPhone: "0599944444" } });
    check("live: records saved (fixed-price offer + request)", request2.status === 200 && offer2.status === 200, `${request2.status}/${offer2.status}`);
    const match2 = await until(async () => (await office.collection("matches").get()).docs.find((d) => d.data().offerId === offer2.body.recordId && d.data().requestId === request2.body.recordId), "second match", 60000);
    const approved = await api("/os/review/decide", { officeId: OFFICE, matchId: match2.id, decision: "approve" });
    check("live: second match approved → journey opened", approved.status === 200 && Boolean(approved.body.journeyId), String(approved.status));
    const jid = approved.body.journeyId;
    const links = (await api("/os/session/links", { officeId: OFFICE, journeyId: jid })).body.links;
    const partyPage = async (url) => { const c = await browser.newContext(mobile); const p = await c.newPage(); p.setDefaultTimeout(30000); await p.goto(`${PREVIEW_URL}/s#${String(url).split("#")[1]}`); return p; };
    const ownerParty = await partyPage(links.owner.url);
    const clientParty = await partyPage(links.client.url);
    await clientParty.locator('[data-session-action="accept_fixed"]').waitFor();
    check("live: fixed price → the client sees only «موافق / غير موافق» (no price moves)", (await clientParty.locator('[data-session-action="minus5"], [data-session-action="manual"]').count()) === 0);
    // The room of this deal: three parts in order, the terms of a villa sale, a proposal that needs the other side.
    const parts = await clientParty.locator("[data-room-part]").evaluateAll((els) => els.map((el) => el.getAttribute("data-room-part")).join(","));
    const liveTerms = await clientParty.locator("[data-term]").evaluateAll((els) => els.map((el) => el.getAttribute("data-term")));
    check("live: the negotiation room has its three parts and the terms of this property", parts === "property,agreed,versus" && liveTerms.includes("payment_method") && !liveTerms.includes("rent_payments"), `${parts} | ${liveTerms.join(",")}`);
    await ownerParty.locator('[data-term="payment_method"] [data-term-action="propose"]').click();
    await ownerParty.locator('[data-term="payment_method"] [data-term-option="cash"]').click();
    await clientParty.locator('[data-term="payment_method"] [data-term-action="accept"]').waitFor({ timeout: 40000 });
    check("live: a proposed term is not shown as agreed until the other side accepts", (await clientParty.locator('[data-agreed="term:payment_method"]').count()) === 0);
    await clientParty.locator('[data-term="payment_method"] [data-term-action="accept"]').click();
    await clientParty.locator('[data-agreed="term:payment_method"]').waitFor({ timeout: 40000 });
    check("live: an accepted term moves to «ما تم الاتفاق عليه» with who accepted", (await clientParty.locator('[data-agreed="term:payment_method"]').innerText()).includes("وافق العميل"));
    await shot(clientParty, "17-fixed-price-client");
    await clientParty.locator('[data-session-action="accept_fixed"]').click();
    await clientParty.locator('[data-session-action="viewing_pick"]').waitFor();
    await clientParty.locator('[data-session-action="viewing_pick"]').click();
    await clientParty.locator(".os-slot-picker").waitFor();
    check("live: viewing time is picked from free slots (no free typing)", (await clientParty.locator('input[type="datetime-local"]').count()) === 0 && (await clientParty.locator("[data-slot]").count()) > 0);
    await shot(clientParty, "18-slot-picker");
    const slotIso = await clientParty.locator("[data-slot]").first().getAttribute("data-slot");
    await clientParty.locator("[data-slot]").first().click();
    await ownerParty.locator('[data-session-action="viewing_ok"]').waitFor({ timeout: 40000 });
    await shot(ownerParty, "19-owner-confirms-slot");
    await ownerParty.locator('[data-session-action="viewing_ok"]').click();
    const booked = await until(async () => { const j = (await office.collection("journeys").doc(jid).get()).data(); return j.viewing?.state === "CONFIRMED" ? j : null; }, "viewing booked");
    check("live: both sides agreed on a free slot → viewing CONFIRMED on that slot", new Date(booked.viewing.at).toISOString() === new Date(slotIso).toISOString(), booked.viewing.at);
    const matchAfter = await until(async () => { const m = (await office.collection("matches").doc(match2.id).get()).data(); return m.appointmentAt ? m : null; }, "match.appointmentAt");
    const apptMs = matchAfter.appointmentAt.toDate ? matchAfter.appointmentAt.toDate().getTime() : new Date(matchAfter.appointmentAt).getTime();
    check("live: confirmed viewing mirrored as match.appointmentAt (used by the scheduled reminders)", apptMs === new Date(slotIso).getTime());
    const cards = (await office.collection("operations").where("journeyId", "==", jid).get()).docs.map((d) => d.data()).filter((o) => o.type === "DEAL_JOURNEY" && ["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE"].includes(o.status));
    check("live: exactly one Daily Tasks card for the open deal", cards.length === 1, String(cards.length));

    const lone = await api("/os/records/save", { officeId: OFFICE, requestKey: `live-lone-${RUN}`, record: { kind: "OFFER", purpose: "SALE", propertyType: "أرض", city: "جدة", district: "الشاطئ", price: 900000, contactName: "مالك منفرد", contactPhone: "0599955555" } });
    await page.goto(`${PREVIEW_URL}/#/repo`);
    await page.locator("[data-record]").first().waitFor();
    await page.locator("[data-repo-filters] > summary").click();
    await page.locator('[data-tab="UNMATCHED"]').click();
    await page.locator(`[data-record="${lone.body.recordId}"]`).waitFor();
    check("live: «بلا مطابقة» lists a record outside any deal", true);
    check("live: «بلا مطابقة» hides records inside the open deal", (await page.locator(`[data-record="${offer2.body.recordId}"], [data-record="${request2.body.recordId}"]`).count()) === 0);
    await shot(page, "20-repository-unmatched");
  } catch (error) {
    check("live: new journey features", false, String(error?.message || error).split("\n")[0]);
    for (const ctx of browser.contexts()) for (const p of ctx.pages()) await p.screenshot({ path: path.join(OUT, `live-zz-newfeat-${Math.random().toString(36).slice(2, 6)}.png`), fullPage: true }).catch(() => {});
  }

  // 10 isolation against the live Staging rules: office B cannot read office A
  const bCtx = await browser.newContext(mobile);
  const bPage = await bCtx.newPage();
  bPage.setDefaultTimeout(30000);
  await bPage.goto(`${PREVIEW_URL}/`);
  await bPage.fill('input[name="phone"]', ownerB.phone);
  await bPage.fill('input[name="password"]', ownerB.password);
  await bPage.getByRole("button", { name: "دخول المكتب" }).click();
  await bPage.locator(".ref-office-tools").waitFor();
  const denied = await bPage.evaluate(async ([a, j]) => {
    const out = {};
    for (const [key, ref] of [["journey", firebase.firestore().doc(`offices/${a}/journeys/${j}`)], ["proposals", firebase.firestore().collection(`offices/${a}/proposals`)], ["opportunities", firebase.firestore().collection(`offices/${a}/opportunities`)]]) {
      try { await ref.get(); out[key] = "READ"; } catch (e) { out[key] = e.code; }
    }
    return out;
  }, [OFFICE, journeyDoc.id]);
  check("live: office B is denied office A journeys/proposals/opportunities by Staging rules", Object.values(denied).every((v) => v === "permission-denied"), JSON.stringify(denied));
  const apiDenied = await bPage.evaluate(async ([w, a, j]) => {
    const token = await firebase.auth().currentUser.getIdToken();
    const r = await fetch(`${w}/os/journeys/note`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ officeId: a, journeyId: j, text: "x" }) });
    return r.status;
  }, [WORKER_URL, OFFICE, journeyDoc.id]);
  check("live: preview Worker refuses office B acting on office A", apiDenied === 403, String(apiDenied));
} catch (error) {
  check("live journey completed without exceptions", false, String(error?.message || error).split("\n")[0]);
  for (const ctx of browser.contexts()) for (const p of ctx.pages()) await p.screenshot({ path: path.join(OUT, `live-zz-failure-${Math.random().toString(36).slice(2, 6)}.png`), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  for (const u of users) {
    await u.dirRef.delete().catch(() => {});
    await auth.deleteUser(u.uid).catch(() => {});
    await db.collection("offices").doc(u === users[0] ? OFFICE : OFFICE_B).collection("members").doc(u.uid).delete().catch(() => {});
  }
  await db.collection("offices").doc(OFFICE).collection("devices").doc(`qa-invalid-${RUN}`).delete().catch(() => {});
  if (ON_PRODUCTION) {
    // Production: the QA offices leave no trace (no public profile, no records, no links).
    for (const id of [OFFICE, OFFICE_B]) {
      const ref = assertQa(db.collection("offices").doc(id));
      if ((await ref.get().catch(() => null))?.data()?.isTestFixture === true) await db.recursiveDelete(ref).catch((e) => check(`cleanup ${id}`, false, e.message));
      const pub = db.collection("publicOffices").doc(id);
      if ((await pub.get().catch(() => null))?.data()?.isTestFixture === true) await pub.delete().catch(() => {});
      const links = await db.collection("replyLinks").where("officeId", "==", id).get().catch(() => ({ docs: [] }));
      for (const d of links.docs) await d.ref.delete().catch(() => {});
    }
    check("production: QA offices removed after the run", !(await db.collection("offices").doc(OFFICE).get()).exists && !(await db.collection("publicOffices").doc(OFFICE).get()).exists);
  }
  fs.writeFileSync(path.join(OUT, "live-report.json"), JSON.stringify(report, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} live checks passed`);
  if (process.env.GITHUB_ACTIONS) {
    const esc = (t) => String(t).replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
    for (const c of failed.slice(0, 9)) console.log(`::error title=live check failed::${esc(`${c.name} — ${c.detail}`)}`);
    const lines = [`preview: ${PREVIEW_URL}`, `passed ${checks.length - failed.length}/${checks.length}`, ...checks.map((c) => `${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` (${c.detail})` : ""}`), `FCM: ${JSON.stringify(report.fcm)}`, `Gemini: ${JSON.stringify(report.gemini)}`];
    console.log(`::notice title=live preview results::${esc(lines.join("\n")).slice(0, 7000)}`);
  }
  console.log(`FCM: ${JSON.stringify(report.fcm)}`);
  console.log(`Gemini: ${JSON.stringify(report.gemini)}`);
  process.exitCode = failed.length ? 1 : 0;
}
