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
const PROJECT = "iaqar-ai-staging";
const OFFICE = "qa-office-os-preview";
const OFFICE_B = "qa-office-os-preview-b";
const RUN = String(process.env.GITHUB_RUN_ID || Date.now()).replace(/[^0-9A-Za-z]/g, "");

const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}`); };
const report = { at: new Date().toISOString(), previewUrl: PREVIEW_URL, workerUrl: WORKER_URL, run: RUN, checks, fcm: null, gemini: null };

// Allowed targets: the office-os-preview channel + preview Worker, or the shared Staging
// channel + Staging Worker (post-merge). Anything else (incl. Production) is refused.
const HOST = new URL(PREVIEW_URL).hostname;
const onPreview = HOST.startsWith(`${PROJECT}--office-os-preview`) && /^https:\/\/iaqar-intake-os-preview\./.test(WORKER_URL);
const onStaging = HOST === `${PROJECT}--staging-9c4b0k7h.web.app` && /^https:\/\/iaqar-intake-staging\./.test(WORKER_URL);
if (!onPreview && !onStaging) throw new Error(`refusing: ${PREVIEW_URL} + ${WORKER_URL} is not preview or Staging`);
const { serviceAccount } = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT);
if (serviceAccount?.project_id !== PROJECT) throw new Error("refusing: service account is not Staging");
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();

const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
const phoneFor = () => `05999${String(crypto.randomInt(0, 99999)).padStart(5, "0")}`;
const intl = (p) => `+966${p.slice(1)}`;
const assertQa = (ref) => { if (!/^offices\/qa-office-os-preview(-b)?(\/|$)/.test(ref.path) && !ref.path.startsWith("replyLinks/")) throw new Error(`refusing path ${ref.path}`); return ref; };

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
  await resetOffice(OFFICE, owner.uid, "مكتب اختبار المعاينة", "qa-os-preview");
  await resetOffice(OFFICE_B, ownerB.uid, "مكتب اختبار العزل", "qa-os-preview-b");
  const office = db.collection("offices").doc(OFFICE);

  const health = await (await fetch(`${WORKER_URL}/health`)).json();
  check("preview Worker healthy on Staging project", health.backendReady === true && health.deploymentEnvironment === "staging", JSON.stringify({ projectId: health.projectId, env: health.deploymentEnvironment }));

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
  await page.getByText("شغلك اليوم").waitFor();
  check("live: real «دخول المكتب» login (phone → Worker resolve → Firebase Auth → membership)", true);
  await page.getByRole("tab", { name: /العروض والطلبات/ }).click();
  await page.getByRole("button", { name: "إضافة طلب" }).click();
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
  await page.locator("#now").getByRole("button", { name: "تجهيز المقترح" }).click();
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
  await page.getByRole("button", { name: "مقترح جديد عبر واتساب" }).click();
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

  // 10 isolation against the live Staging rules: office B cannot read office A
  const bCtx = await browser.newContext(mobile);
  const bPage = await bCtx.newPage();
  bPage.setDefaultTimeout(30000);
  await bPage.goto(`${PREVIEW_URL}/`);
  await bPage.fill('input[name="phone"]', ownerB.phone);
  await bPage.fill('input[name="password"]', ownerB.password);
  await bPage.getByRole("button", { name: "دخول المكتب" }).click();
  await bPage.getByText("شغلك اليوم").waitFor();
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
