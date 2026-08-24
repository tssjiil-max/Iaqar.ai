import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ARCHIVE_POLICY,
  DAILY_TASK_STATE,
  EXEC_ACTION,
  FUTURE_CLIENT_REPLY_LABELS,
  FUTURE_DEAL_STATE_LABELS,
  FUTURE_OWNER_REPLY_LABELS,
  MATCH_UNSUITABLE_POLICY,
  SECURE_PARTY,
  buildDailyTaskView,
  buildSecureLinkIntent,
  dailyTaskDetailsHash,
  dailyTasksDemoFixtures,
  mapOperationsItemToDailyTask,
  mapOperationsItemsToDailyTasks,
  sortDailyTaskViews
} from "../src/v2/content/daily-tasks/domain.js";
import {
  buildDailyTaskCardHtml,
  buildDailyTaskEmptyHtml,
  buildDailyTaskListHtml
} from "../src/v2/content/daily-tasks/card.js";

const root = path.resolve(import.meta.dirname, "..");
const ENGLISH_UI = /\b(Match|Pending|Action|Client|Status|Task)\b/;

function visibleText(html) {
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function countPrimary(html) {
  return (String(html).match(/data-cv2-exec-primary=/g) || []).length;
}

function countSecondary(html) {
  return (String(html).match(/data-cv2-exec-secondary=/g) || []).length;
}

function forbiddenBrokerChrome(html) {
  const text = visibleText(html);
  return {
    hasAppointment: text.includes("تحديد موعد"),
    hasNegotiate: text.includes("تفاوض"),
    hasClose: text.includes("إتمام الصفقة"),
    hasArchive: text.includes("أرشفة"),
    hasStartMatch: text.includes("ابدأ المطابقة"),
    hasClientInterestedBtn: /<button[^>]*>مهتم</.test(html),
    hasNeedsDetailsBtn: html.includes("أحتاج تفاصيل أكثر"),
    hasNotSuitableBtn: /<button[^>]*>غير مناسب</.test(html)
  };
}

test("demo fixtures cover the seven visual task states in operational order", () => {
  const fixtures = dailyTasksDemoFixtures();
  assert.equal(fixtures.length, 7);
  assert.deepEqual(fixtures.map((task) => task.id), [
    "task_new_match",
    "task_overdue",
    "task_appointment_today",
    "task_interested",
    "task_needs_details",
    "task_awaiting_client",
    "task_unsuitable"
  ]);
});

test("collapsed new-match card is compact Arabic summary without action buttons", () => {
  const task = dailyTasksDemoFixtures().find((item) => item.id === "task_new_match");
  const html = buildDailyTaskCardHtml(task);
  const text = visibleText(html);
  assert.match(text, /مطابقة جديدة/);
  assert.match(text, /أرض للبيع — حي عروة/);
  assert.match(text, /500,000 ر\.س/);
  assert.match(text, /تم العثور على مطابقة/);
  assert.match(text, /الإجراء التالي: إرسال للعميل/);
  assert.equal(countPrimary(html), 0);
  assert.equal(countSecondary(html), 0);
  assert.equal(html.includes("data-cv2-exec-primary="), false);
  assert.equal(html.includes("إرسال للمالك"), false);
  assert.equal(html.includes("is-open"), false);
  assert.match(html, /aria-expanded="false"/);
  assert.equal(html.includes("بيانات الفرصة"), false);
  assert.equal(html.includes("cv2-data-card"), false);
  assert.equal(forbiddenBrokerChrome(html).hasNegotiate, false);
  assert.equal(ENGLISH_UI.test(text), false);
});

test("open match-found card shows one primary and two secondaries only", () => {
  const task = dailyTasksDemoFixtures().find((item) => item.id === "task_new_match");
  const html = buildDailyTaskCardHtml(task, { open: true });
  const text = visibleText(html);
  assert.match(html, /class="cv2-exec-card is-open"/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /data-cv2-exec-primary="send_to_client"/);
  assert.match(html, />إرسال للعميل</);
  assert.match(html, /data-cv2-exec-secondary="send_to_owner"/);
  assert.match(html, />إرسال للمالك</);
  assert.match(html, /data-cv2-exec-secondary="open_offer"/);
  assert.match(html, />عرض تفاصيل العرض</);
  assert.equal(countPrimary(html), 1);
  assert.equal(countSecondary(html), 2);
  assert.equal(task.primaryAction.party, SECURE_PARTY.CLIENT);
  assert.equal(task.secondaryActions[0].id, EXEC_ACTION.SEND_TO_OWNER);
  assert.equal(task.secondaryActions[0].party, SECURE_PARTY.OWNER);
  const chrome = forbiddenBrokerChrome(html);
  assert.equal(chrome.hasAppointment, false);
  assert.equal(chrome.hasNegotiate, false);
  assert.equal(chrome.hasClose, false);
  assert.equal(chrome.hasArchive, false);
  assert.equal(chrome.hasStartMatch, false);
  assert.equal(ENGLISH_UI.test(text), false);
});

test("awaiting client reply stays buttonless while collapsed and capped when open", () => {
  const task = dailyTasksDemoFixtures().find((item) => item.id === "task_awaiting_client");
  const collapsed = buildDailyTaskCardHtml(task);
  assert.equal(countPrimary(collapsed), 0);
  assert.equal(countSecondary(collapsed), 0);
  const html = buildDailyTaskCardHtml(task, { open: true });
  const text = visibleText(html);
  assert.match(text, /بانتظار رد العميل/);
  assert.equal(html.includes("data-cv2-exec-primary="), false);
  assert.match(html, />إعادة الإرسال</);
  assert.match(html, />عرض تفاصيل العرض</);
  assert.equal(html.includes("إرسال للعميل"), false);
  assert.equal(countPrimary(html), 0);
  assert.equal(countSecondary(html), 2);
  assert.equal(ENGLISH_UI.test(text), false);
});

test("client interested drops send-to-client as primary and keeps future replies off the broker UI", () => {
  const byId = Object.fromEntries(dailyTasksDemoFixtures().map((task) => [task.id, task]));
  assert.equal(byId.task_interested.primaryAction, null);
  const interested = buildDailyTaskCardHtml(byId.task_interested, { open: true });
  const interestedText = visibleText(interested);
  assert.match(interestedText, /✓ العميل مهتم/);
  assert.match(interestedText, /الخطوة التالية ستظهر هنا/);
  assert.equal(interested.includes("إرسال للعميل"), false);
  assert.equal(interested.includes("إتمام صفقة"), false);
  assert.equal(interested.includes(FUTURE_CLIENT_REPLY_LABELS.interested) && /<button[^>]*>مهتم</.test(interested), false);

  const needs = visibleText(buildDailyTaskCardHtml(byId.task_needs_details, { open: true }));
  assert.match(needs, /العميل يحتاج تفاصيل أكثر/);
  assert.match(needs, /السعر · الموقع · الصور · المواصفات · سؤال آخر/);
  assert.match(needs, /عرض تفاصيل الطلب/);

  const no = visibleText(buildDailyTaskCardHtml(byId.task_unsuitable, { open: true }));
  assert.match(no, /المطابقة غير مناسبة/);
  assert.equal(no.includes("إتمام صفقة"), false);
  assert.equal(no.includes("تفاوض"), false);
  assert.equal(no.includes("ابدأ المطابقة"), false);
  assert.equal(byId.task_unsuitable.endsThisMatchOnly, true);
});

test("list accordion keeps a single open task", () => {
  const fixtures = dailyTasksDemoFixtures();
  const html = buildDailyTaskListHtml(fixtures, { openTaskId: "task_overdue" });
  const openCards = html.match(/cv2-exec-card is-open/g) || [];
  assert.equal(openCards.length, 1);
  assert.match(html, /data-task-id="task_overdue"[^>]*[\s\S]*?aria-expanded="true"/);
  assert.match(html, /data-task-id="task_new_match"[^>]*[\s\S]*?aria-expanded="false"/);
  const closedNewMatch = html.split('data-task-id="task_overdue"')[0];
  assert.equal(closedNewMatch.includes("data-cv2-exec-primary="), false);
  assert.equal(countPrimary(html), 1);
  assert.equal(countSecondary(html), 2);
  assert.equal(buildDailyTaskListHtml(fixtures).includes("is-open"), false);
});

test("empty state is compact Arabic copy without a huge blank card", () => {
  const html = buildDailyTaskEmptyHtml();
  const text = visibleText(html);
  assert.match(text, /لا توجد مهام تحتاج إجراء الآن/);
  assert.match(text, /ستظهر هنا المطابقات والمتابعات التي تحتاج تدخلك/);
  assert.equal(html.includes("content-v2-surface"), false);
  assert.equal(ENGLISH_UI.test(text), false);
  assert.equal(buildDailyTaskListHtml([]), html);
});

test("live mapping uses source ids and skips incomplete opportunities", () => {
  const now = new Date("2026-08-24T10:00:00.000+03:00");
  const match = mapOperationsItemToDailyTask({
    id: "ops_1",
    operationType: "MATCH_REVIEW",
    recordType: "match",
    matchId: "match_live_1",
    ownerOfferId: "offer_live_1",
    propertyType: "أرض",
    purpose: "SALE",
    district: "عروة",
    salePrice: 500000
  }, now);
  assert.equal(match.matchId, "match_live_1");
  assert.equal(match.offerId, "offer_live_1");
  assert.equal(match.stateKey, DAILY_TASK_STATE.NEW_MATCH);
  assert.equal(dailyTaskDetailsHash(match), "#/opportunities/offer_live_1");
  assert.equal(match.exposeCounterpartyContact, false);

  assert.equal(mapOperationsItemToDailyTask({
    operationType: "MISSING_DATA",
    matchId: "match_x",
    ownerOfferId: "offer_x"
  }, now), null);
  assert.equal(mapOperationsItemToDailyTask({
    matchingReadiness: "NEEDS_COMPLETION",
    recordType: "match",
    matchId: "match_y"
  }, now), null);
});

test("sort is operational priority not created-at", () => {
  const sorted = sortDailyTaskViews([
    buildDailyTaskView({ id: "c", stateKey: DAILY_TASK_STATE.AWAITING_CLIENT, badgeKey: "today" }),
    buildDailyTaskView({ id: "a", stateKey: DAILY_TASK_STATE.NEW_MATCH, badgeKey: "now" }),
    buildDailyTaskView({ id: "b", stateKey: DAILY_TASK_STATE.NEW_MATCH, badgeKey: "overdue" }),
    buildDailyTaskView({ id: "d", stateKey: DAILY_TASK_STATE.CLIENT_INTERESTED, badgeKey: "today" })
  ]).map((task) => task.id);
  assert.deepEqual(sorted, ["a", "b", "d", "c"]);
});

test("appointment today maps from viewing date without copying listing fields", () => {
  const now = new Date("2026-08-24T10:00:00.000+03:00");
  const task = mapOperationsItemToDailyTask({
    operationType: "MATCH_REVIEW",
    matchId: "match_visit",
    ownerOfferId: "offer_visit",
    propertyType: "شقة",
    purpose: "SALE",
    district: "الجرف",
    salePrice: 900000,
    viewingAt: "2026-08-24T15:00:00.000+03:00"
  }, now);
  assert.equal(task.stateKey, DAILY_TASK_STATE.APPOINTMENT_TODAY);
  assert.equal(task.badgeLabel, "اليوم");
  const html = buildDailyTaskCardHtml(task);
  assert.equal(html.includes("بيانات الفرصة"), false);
  assert.equal(html.includes("cv2-data-extra"), false);
});

test("offers and requests inbox still uses the approved data card", () => {
  const inbox = readFileSync(path.join(root, "public", "js", "bank-inbox-card-ui.js"), "utf8");
  assert.match(inbox, /buildOpportunityDataCardV2/);
  assert.match(inbox, /buildCompleteMissingButtonV2/);
});

test("daily-task controller does not send a client message in this round", () => {
  const controller = readFileSync(path.join(root, "src", "v2", "content", "daily-tasks", "controller.js"), "utf8");
  assert.match(controller, /Reserved for a later CLIENT_MATCH_REVIEW session/);
  assert.match(controller, /openTaskId/);
  assert.equal(controller.includes("تم إرسال الرسالة"), false);
  assert.equal(controller.includes("token"), false);
  assert.equal(controller.includes("OTP"), false);
});

test("mapOperationsItemsToDailyTasks de-duplicates by match id", () => {
  const now = new Date("2026-08-24T10:00:00.000+03:00");
  const views = mapOperationsItemsToDailyTasks([
    { operationType: "MATCH_REVIEW", matchId: "m1", ownerOfferId: "o1", propertyType: "أرض", purpose: "SALE", district: "عروة", salePrice: 1 },
    { recordType: "match", matchId: "m1", ownerOfferId: "o1", propertyType: "أرض", purpose: "SALE", district: "عروة", salePrice: 1 }
  ], now);
  assert.equal(views.length, 1);
});

test("secure link intent binds parties through matchId without counterparty contact", () => {
  const intent = buildSecureLinkIntent({
    actionId: EXEC_ACTION.SEND_TO_CLIENT,
    matchId: "match_new_1",
    party: SECURE_PARTY.CLIENT,
    contactRef: "0511111111"
  });
  assert.equal(intent.matchId, "match_new_1");
  assert.equal(intent.party, "client");
  assert.equal(intent.exposeCounterpartyContact, false);
  assert.equal(intent.sessionKind, "CLIENT_MATCH_REVIEW");
  const owner = buildSecureLinkIntent({
    actionId: EXEC_ACTION.SEND_TO_OWNER,
    matchId: "match_new_1",
    party: SECURE_PARTY.OWNER
  });
  assert.equal(owner.sessionKind, "OWNER_MATCH_REVIEW");
  assert.equal(buildSecureLinkIntent({ matchId: "" }), null);
});

test("future client owner and deal states stay model-only", () => {
  const fixturesHtml = buildDailyTaskListHtml(dailyTasksDemoFixtures(), { openTaskId: "task_new_match" });
  assert.equal(fixturesHtml.includes(FUTURE_CLIENT_REPLY_LABELS.needs_details), false);
  assert.equal(fixturesHtml.includes(FUTURE_OWNER_REPLY_LABELS.counter_offer), false);
  assert.equal(fixturesHtml.includes(FUTURE_DEAL_STATE_LABELS.deal_completed), false);
  assert.equal(fixturesHtml.includes("ابدأ المطابقة"), false);
  assert.equal(MATCH_UNSUITABLE_POLICY.endsThisMatchOnly, true);
  assert.equal(MATCH_UNSUITABLE_POLICY.keepOffer, true);
  assert.equal(MATCH_UNSUITABLE_POLICY.keepRequest, true);
  assert.equal(MATCH_UNSUITABLE_POLICY.showStartMatchingButton, false);
  assert.equal(ARCHIVE_POLICY.hardDeleteEnabled, false);
  assert.equal(ARCHIVE_POLICY.deleteTransactionRecords, false);
  assert.equal(ARCHIVE_POLICY.archivedAtField, "archivedAt");
  assert.equal(ARCHIVE_POLICY.retentionDaysField, "archiveRetentionDays");
});

test("office smart hide has no chevron or hide button and collapses on scroll down", async () => {
  const { JSDOM } = await import("jsdom");
  const { setupOfficeSmartHide, teardownOfficeSmartHide } = await import("../src/v2/content/daily-tasks/office-smart-hide.js");
  const dom = new JSDOM(`<!doctype html><html><body>
    <div class="app">
      <header class="card header"><h1>مكاتب عقارية ذكية</h1></header>
      <section class="card license"><div class="office-body"><h3>مكتب عروة</h3></div></section>
    </div>
  </body></html>`, { pretendToBeVisual: true, url: "http://localhost/" });
  const { window } = dom;
  window.requestAnimationFrame = (fn) => { fn(); return 1; };
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
  let scrollY = 0;
  Object.defineProperty(window, "scrollY", { get: () => scrollY, configurable: true });

  setupOfficeSmartHide(window.document, window);
  const html = window.document.documentElement;
  const card = window.document.querySelector("section.card.license");
  assert.equal(html.classList.contains("cv2-tasks-office-smart"), true);
  assert.equal(card.querySelector(".cv2-office-toggle"), null);
  assert.equal(card.querySelector(".cv2-office-chevron"), null);
  assert.equal(html.classList.contains("cv2-office-hidden"), false);

  scrollY = 80;
  window.dispatchEvent(new window.Event("scroll"));
  assert.equal(html.classList.contains("cv2-office-hidden"), true);
  assert.equal(card.style.maxHeight, "0px");

  scrollY = 20;
  window.dispatchEvent(new window.Event("scroll"));
  assert.equal(html.classList.contains("cv2-office-hidden"), false);

  teardownOfficeSmartHide(window.document, window);
  assert.equal(html.classList.contains("cv2-tasks-office-smart"), false);
  assert.equal(html.classList.contains("cv2-office-hidden"), false);
  assert.equal(card.style.maxHeight, "");
});

test("tasks mount uses office smart hide instead of the details chevron", () => {
  const mount = readFileSync(path.join(root, "src", "v2", "content", "mount.js"), "utf8");
  assert.match(mount, /setupOfficeSmartHide/);
  assert.match(mount, /teardownOfficeSmartHide/);
  const tasksBlocks = [...mount.matchAll(/if \(view\.name === "tasks"\) \{([\s\S]*?)\n  \}/g)].map((match) => match[1]);
  assert.equal(tasksBlocks.length >= 1, true);
  assert.equal(tasksBlocks.every((block) => block.includes("setupOfficeSmartHide")), true);
  assert.equal(tasksBlocks.every((block) => block.includes("setupOfficeCardCollapse") === false), true);
});
