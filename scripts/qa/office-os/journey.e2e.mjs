// Office OS — full UI journey in a real browser against the local harness.
//   node scripts/qa/office-os/journey.e2e.mjs   (uses a globally installed Playwright)
// Office link → offer + request → match → review task → approve → WhatsApp proposal →
// reply via link → task update → viewing → result → deal completed.
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require("playwright"); } catch (_) { /* fall back to global */ }
  return require(path.join(execSync("npm root -g").toString().trim(), "playwright"));
}
const { chromium } = loadPlaywright();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/office-os");
fs.mkdirSync(OUT, { recursive: true });
const { startOfficeOsHarness, OFFICE_A } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));

const h = await startOfficeOsHarness();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true };
const checks = [];
const errors = [];
let step = "start";
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`); };

function watch(page, label) {
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${label}: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`${label} pageerror: ${e.message}`));
}
async function shot(page, name) {
  if (name === "09-workspace-start") await page.locator(".os-toast").waitFor({ state: "hidden" });
  await page.waitForTimeout(700);
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  check(`no horizontal scroll: ${name}`, overflow <= 1, `overflow=${overflow}px`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  if (["07-daily-tasks-review", "09-workspace-start", "17-workspace-viewing-result"].includes(name)) {
    await page.screenshot({ path: path.join(OUT, `${name}-mobile.png`) });
  }
}
const until = async (fn, { timeout = 8000, label = "condition" } = {}) => {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); }
  throw new Error(`timeout: ${label}`);
};

try {
  // 1 — visitor submits an offer through the office link (no account)
  step = "1: visitor submits an offer through the office link (no account)";
  const visitorCtx = await browser.newContext(mobile);
  const visitor = await visitorCtx.newPage(); watch(visitor, "visitor");
  await visitor.goto(`${h.origin}/o/sultan`);
  await visitor.getByText("مكتب سلطان العقاري").first().waitFor();
  await shot(visitor, "01-public-office");
  await visitor.getByRole("button", { name: /لدي عقار/ }).click();
  await visitor.getByRole("button", { name: "بيع" }).click();
  await visitor.fill('input[name="propertyType"]', "شقة");
  await visitor.fill('input[name="district"]', "الملقا");
  await visitor.fill('input[name="price"]', "1250000");
  await visitor.fill('input[name="area"]', "120");
  await visitor.fill('textarea[name="notes"]', "شقة حديثة بإطلالة مميزة");
  await visitor.fill('input[name="contactName"]', "عبدالله السبيعي");
  await visitor.fill('input[name="contactPhone"]', "0557654321");
  await shot(visitor, "02-public-offer-form");
  await visitor.getByRole("button", { name: "إرسال" }).click();
  await visitor.getByText("تم استلام بياناتك").waitFor();
  await shot(visitor, "03-public-submitted");
  const offer = await until(() => h.store.list(`offices/${OFFICE_A}/opportunities`).find((o) => o.opportunityKind === "OFFER"), { label: "offer persisted" });
  check("office link submission stored in the right office with assigned broker", offer.brokerId === "uid-owner-a" && offer.officeId === OFFICE_A);

  // 2 — owner logs in and adds a request (area left empty)
  step = "2: owner logs in and adds a request (area left empty)";
  const ownerCtx = await browser.newContext(mobile);
  await ownerCtx.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "whatsapp" }));
  ownerCtx.on("page", (p) => { p.waitForLoadState().then(() => { if (p.url().startsWith("https://wa.me")) setTimeout(() => p.close().catch(() => {}), 300); }).catch(() => {}); });
  const owner = await ownerCtx.newPage(); watch(owner, "owner");
  owner.setDefaultTimeout(10000);
  await owner.goto(`${h.origin}/`);
  await owner.getByRole("heading", { name: "دخول المكتب" }).waitFor();
  await shot(owner, "04-office-login");
  await owner.fill('input[name="phone"]', "0501111111");
  await owner.fill('input[name="password"]', "pass-a");
  await owner.getByRole("button", { name: "دخول المكتب" }).click();
  await owner.getByText("شغلك اليوم").waitFor();
  await owner.getByRole("tab", { name: /العروض والطلبات/ }).click();
  await owner.getByRole("button", { name: "إضافة طلب" }).click();
  await owner.getByRole("button", { name: "شراء" }).click();
  await owner.fill('input[name="propertyType"]', "شقة");
  await owner.fill('input[name="district"]', "الملقا");
  await owner.fill('input[name="price"]', "1300000");
  await owner.fill('input[name="contactName"]', "أحمد المطيري");
  await owner.fill('input[name="contactPhone"]', "0551234567");
  await shot(owner, "05-add-request-form");
  await owner.getByRole("button", { name: "حفظ وفحص المطابقات" }).click();
  await owner.getByText("تفاصيل السجل").waitFor();
  await owner.getByText("مطابقة بانتظار مراجعتك").waitFor({ timeout: 8000 });
  await shot(owner, "06-request-saved-detail");
  const request = h.store.list(`offices/${OFFICE_A}/opportunities`).find((o) => o.opportunityKind === "REQUEST");
  check("request saved without area", request && request.area == null);

  // 3 — Daily tasks show the review with an action-named button
  step = "3: Daily tasks show the review with an action-named button";
  await owner.goto(`${h.origin}/#/tasks`);
  const reviewCard = owner.locator('[data-type="MATCH_REVIEW"]');
  await reviewCard.waitFor();
  check("review card shows opportunity summary", /طلب شراء ↔ شقة في حي الملقا/.test(await reviewCard.innerText()));
  check("one review task", await reviewCard.count() === 1);
  await shot(owner, "07-daily-tasks-review");
  await reviewCard.getByRole("button", { name: "مراجعة المطابقة" }).click();
  await owner.getByText("أسباب التوافق").waitFor();
  await shot(owner, "08-match-review");
  await owner.getByRole("button", { name: "اعتماد وبدء التفاوض" }).click();
  await owner.getByText("متابعة الفرصة").waitFor();
  await owner.getByText("المطلوب الآن: إرسال مقترح").waitFor();
  await shot(owner, "09-workspace-start");
  const journey = h.store.list(`offices/${OFFICE_A}/journeys`)[0];
  check("one journey for the approved match", h.store.list(`offices/${OFFICE_A}/journeys`).length === 1);

  // 4 — price proposal to both parties via WhatsApp
  step = "4: price proposal to both parties via WhatsApp";
  await owner.locator("#now").getByRole("button", { name: "اقتراح سعر" }).click();
  const sheet = owner.locator(".os-sheet");
  await sheet.locator('input[name="price"]').fill("1,200,000");
  await shot(owner, "10-composer");
  await sheet.getByRole("button", { name: "تجهيز المقترح والرابط" }).click();
  await sheet.getByText("تم تجهيز المقترح").waitFor();
  await shot(owner, "11-composer-prepared");
  const popupPromise = ownerCtx.waitForEvent("page").catch(() => null);
  await sheet.getByRole("link", { name: /إرسال عبر واتساب إلى العميل/ }).click();
  const popup = await popupPromise;
  await popup?.waitForLoadState().catch(() => {});
  check("WhatsApp opened with the client's number and message", Boolean(popup && /wa\.me\/966551234567\?text=/.test(popup.url())), popup?.url().slice(0, 60));
  await popup?.close().catch(() => {});
  await sheet.getByText("تم فتح واتساب").first().waitFor();
  const clientProposal = await until(() => h.store.list(`offices/${OFFICE_A}/proposals`).find((p) => p.recipientRole === "client" && p.sendState === "OPENED_EXTERNAL"), { label: "handoff recorded" });
  check("handoff recorded as opened only (no sent/delivered)", !clientProposal.sentAt && !clientProposal.deliveredAt);
  const ownerProposal = h.store.list(`offices/${OFFICE_A}/proposals`).find((p) => p.recipientRole === "owner" && p.status === "ACTIVE");
  await owner.evaluate(() => { Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: async (data) => { window.sharedProposalText = data.text; } }); });
  await sheet.locator(`[data-proposal="${ownerProposal.id}"]`).getByRole("button", { name: "مشاركة المقترح إلى المالك عبر تطبيق آخر", exact: true }).click();
  await until(() => h.store.list(`offices/${OFFICE_A}/operations`).some((op) => op.type === "AWAITING_REPLY" && JSON.parse(op.metadataJson || "{}").proposalId === ownerProposal.id && op.status === "WAITING_EXTERNAL_RESPONSE"));
  check("other-app share includes the same reply link", (await owner.evaluate(() => window.sharedProposalText)).includes(ownerProposal.replyUrl));
  check("other-app share updates waiting task automatically", h.store.list(`offices/${OFFICE_A}/operations`).some((op) => op.type === "AWAITING_REPLY" && JSON.parse(op.metadataJson || "{}").proposalId === ownerProposal.id && op.status === "WAITING_EXTERNAL_RESPONSE"));
  const shareCount = h.store.get(`offices/${OFFICE_A}/proposals/${ownerProposal.id}`).handoffCount;
  await owner.evaluate(() => { navigator.share = async () => { throw new DOMException("Cancelled", "AbortError"); }; });
  await sheet.locator(`[data-proposal="${ownerProposal.id}"]`).getByRole("button", { name: "مشاركة المقترح إلى المالك عبر تطبيق آخر", exact: true }).click();
  await owner.waitForTimeout(100);
  check("cancelled share does not change the task or handoff count", h.store.get(`offices/${OFFICE_A}/proposals/${ownerProposal.id}`).handoffCount === shareCount);
  await owner.locator(".os-sheet .os-icon-btn").click();

  // 5 — client replies from the lightweight page
  step = "5: client replies from the lightweight page";
  const clientCtx = await browser.newContext(mobile);
  const client = await clientCtx.newPage(); watch(client, "client");
  await client.goto(clientProposal.replyUrl.replace(/^https?:\/\/[^/]+/, h.origin));
  await client.getByText("اختر ردك").waitFor();
  check("reply page shows no owner data", !(await client.content()).includes("0557654321") && !(await client.content()).includes("السبيعي"));
  await shot(client, "12-reply-page");
  await client.locator('[data-option="accept_initial"]').click();
  const send = client.getByRole("button", { name: "إرسال الرد" });
  await send.dblclick(); // two presses in a row must still save one reply
  await client.getByText("تم حفظ ردك").waitFor();
  await shot(client, "13-reply-saved");
  await client.reload();
  await client.getByText("عدّل ردك").waitFor();
  const replyEvents = h.store.list(`offices/${OFFICE_A}/journeys/${journey.id}/events`).filter((e) => e.type === "PARTY_REPLY");
  check("double press + reload → one saved reply", replyEvents.length === 1, `events=${replyEvents.length}`);

  // 6 — the reply reaches Daily Tasks; broker proposes a viewing
  step = "6: the reply reaches Daily Tasks; broker proposes a viewing";
  await owner.goto(`${h.origin}/#/tasks`);
  const replyCard = owner.locator('[data-type="PROPOSAL_REPLY"]');
  await replyCard.waitFor({ timeout: 8000 });
  await shot(owner, "14-daily-tasks-reply");
  await replyCard.getByRole("button", { name: "مراجعة الرد" }).click();
  await owner.getByText("المطلوب الآن: مراجعة الرد").waitFor();
  await shot(owner, "15-workspace-reply");
  await owner.locator("#now").getByRole("button", { name: "إرسال مقترح جديد" }).click();
  await sheet.getByRole("button", { name: "تحديد أو تعديل معاينة" }).click();
  await sheet.getByRole("button", { name: "العميل" }).click();
  await sheet.getByRole("button", { name: "تجهيز المقترح والرابط" }).click();
  await sheet.getByText("تم تجهيز المقترح").waitFor();
  await sheet.getByRole("link", { name: /إرسال عبر واتساب إلى العميل/ }).click();
  await sheet.getByText("تم فتح واتساب").first().waitFor();
  await owner.locator(".os-sheet .os-icon-btn").click();
  const viewingProposal = await until(() => h.store.list(`offices/${OFFICE_A}/proposals`).find((p) => p.kind === "VIEWING"), { label: "viewing proposal" });
  await client.goto(viewingProposal.replyUrl.replace(/^https?:\/\/[^/]+/, h.origin));
  await client.locator('[data-option="accept"]').click();
  await client.getByRole("button", { name: "إرسال الرد" }).click();
  await client.getByText("تم حفظ ردك").waitFor();

  // 7 — accepted → confirm from the card → record the result in the workspace
  step = "7: accepted → confirm from the card → record the result in the workspace";
  await owner.goto(`${h.origin}/#/tasks`);
  const confirmCard = owner.locator('[data-type="VIEWING_CONFIRM"]');
  await confirmCard.waitFor({ timeout: 8000 });
  await shot(owner, "16-daily-tasks-confirm-viewing");
  let j = h.store.get(`offices/${OFFICE_A}/journeys/${journey.id}`);
  check("accepted viewing is not confirmed or done", j.viewing.state === "ACCEPTED");
  await confirmCard.getByRole("button", { name: "تأكيد الموعد" }).click();
  await until(() => h.store.get(`offices/${OFFICE_A}/journeys/${journey.id}`).viewing.state === "CONFIRMED", { label: "viewing confirmed" });
  await owner.goto(`${h.origin}/#/journey/${journey.id}`);
  await owner.getByText("المطلوب الآن: نتيجة المعاينة").waitFor();
  const pressed = await owner.locator('#now .os-option[aria-pressed="true"]').count();
  check("viewing results start with no preselection", pressed === 0);
  await owner.locator('#now [data-result="interested"]').click();
  await shot(owner, "17-workspace-viewing-result");
  await owner.getByRole("button", { name: "حفظ النتيجة ومتابعة الصفقة" }).click();
  await owner.getByText("المطلوب الآن: متابعة إجراءات الاتفاق").waitFor({ timeout: 8000 });
  j = h.store.get(`offices/${OFFICE_A}/journeys/${journey.id}`);
  check("interest after viewing moves to agreement, deal not completed", j.stage === "AGREEMENT" && j.status === "ACTIVE");
  await shot(owner, "18-workspace-agreement");

  // 8 — explicit completion
  step = "8: explicit completion";
  await owner.locator("#now").getByRole("button", { name: "إتمام الصفقة" }).click();
  await owner.locator(".os-sheet input").fill("1210000");
  await owner.getByRole("button", { name: "تأكيد إتمام الصفقة" }).click();
  await owner.getByRole("alertdialog").getByRole("button", { name: "إتمام" }).click();
  await owner.getByText("تمت الصفقة").first().waitFor({ timeout: 8000 });
  await shot(owner, "19-workspace-closed");
  j = h.store.get(`offices/${OFFICE_A}/journeys/${journey.id}`);
  check("deal completed explicitly and archived", j.status === "CLOSED_WON" && Boolean(j.archivedAt));
  await client.goto(clientProposal.replyUrl.replace(/^https?:\/\/[^/]+/, h.origin));
  await client.getByText("أُغلق هذا المقترح").waitFor();
  check("closed opportunity links stop accepting replies", true);

  // 9 — repository + desktop views
  step = "9: repository + desktop views";
  await owner.goto(`${h.origin}/#/repo`);
  await owner.locator("[data-record]").first().waitFor();
  await shot(owner, "20-repository");
  const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ar-SA" });
  const desk = await desktopCtx.newPage(); watch(desk, "desktop");
  await desk.goto(`${h.origin}/`);
  await desk.fill('input[name="phone"]', "0501111111");
  await desk.fill('input[name="password"]', "pass-a");
  await desk.getByRole("button", { name: "دخول المكتب" }).click();
  await desk.getByText("شغلك اليوم").waitFor();
  await desk.goto(`${h.origin}/#/journey/${journey.id}`);
  await desk.getByText("سجل الإجراءات").waitFor();
  await shot(desk, "21-desktop-workspace");

  // 10 — other office sees nothing of office A
  step = "10: other office sees nothing of office A";
  const otherCtx = await browser.newContext(mobile);
  const other = await otherCtx.newPage(); watch(other, "other-office");
  await other.goto(`${h.origin}/`);
  await other.fill('input[name="phone"]', "0503333333");
  await other.fill('input[name="password"]', "pass-b");
  await other.getByRole("button", { name: "دخول المكتب" }).click();
  await other.getByText("مكتب الأفق للعقار").first().waitFor();
  await other.getByRole("tab", { name: /العروض والطلبات/ }).click();
  await other.locator("[data-record]").first().waitFor();
  const otherText = await other.content();
  check("office B repository contains only its own records", !otherText.includes("المطيري") && !otherText.includes("السبيعي") && otherText.includes("مالك مكتب آخر"));
} catch (error) {
  let i = 0;
  for (const p of browser.contexts().flatMap((c) => c.pages())) {
    await p.screenshot({ path: path.join(OUT, `zz-failure-${i += 1}.png`), fullPage: true }).catch(() => {});
  }
  check("journey completed without exceptions", false, `[${step}] ${String(error?.message || error).split("\n")[0]}`);
} finally {
  const ignorable = (e) => /favicon|Failed to load resource: the server responded with a status of 404/.test(e);
  const real = errors.filter((e) => !ignorable(e));
  check("no browser console errors", real.length === 0, real.slice(0, 5).join(" | "));
  fs.writeFileSync(path.join(OUT, "journey-report.json"), JSON.stringify({ at: new Date().toISOString(), checks, consoleErrors: real, workerCalls: h.server.workerCalls.map((c) => `${c.path} ${c.status}`) }, null, 2));
  await browser.close();
  h.server.close();
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}
