import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DAILY_TASK_STATE,
  buildDailyTaskView,
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

test("new match card is compact Arabic execution UI with one primary action", () => {
  const task = dailyTasksDemoFixtures().find((item) => item.id === "task_new_match");
  const html = buildDailyTaskCardHtml(task);
  const text = visibleText(html);
  assert.match(text, /مطابقة جديدة/);
  assert.match(text, /أرض للبيع — حي عروة/);
  assert.match(text, /500,000 ر\.س/);
  assert.match(text, /تم العثور على مطابقة/);
  assert.match(text, /الإجراء التالي: إرسال للعميل/);
  assert.match(html, /data-cv2-exec-primary="send_to_client"/);
  assert.match(html, />إرسال للعميل</);
  assert.match(html, /data-cv2-exec-secondary="open_offer"/);
  assert.match(html, />عرض تفاصيل العرض</);
  assert.equal(countPrimary(html), 1);
  assert.equal(countSecondary(html), 1);
  assert.equal(html.includes("بيانات الفرصة"), false);
  assert.equal(html.includes("cv2-data-card"), false);
  assert.equal(html.includes("موعد"), false);
  assert.equal(html.includes("تفاوض"), false);
  assert.equal(html.includes("أرشفة"), false);
  assert.equal(html.includes("اتصال بالمالك"), false);
  assert.equal(ENGLISH_UI.test(text), false);
});

test("awaiting client reply drops send-to-client as primary and keeps two secondaries max", () => {
  const task = dailyTasksDemoFixtures().find((item) => item.id === "task_awaiting_client");
  const html = buildDailyTaskCardHtml(task);
  const text = visibleText(html);
  assert.match(text, /بانتظار رد العميل/);
  assert.equal(html.includes("data-cv2-exec-primary="), false);
  assert.match(html, />إعادة الإرسال</);
  assert.match(html, />عرض تفاصيل العرض</);
  assert.equal(countPrimary(html), 0);
  assert.equal(countSecondary(html), 2);
  assert.equal(ENGLISH_UI.test(text), false);
});

test("client interested and needs-details and unsuitable stay UI-only", () => {
  const byId = Object.fromEntries(dailyTasksDemoFixtures().map((task) => [task.id, task]));
  const interested = visibleText(buildDailyTaskCardHtml(byId.task_interested));
  assert.match(interested, /✓ العميل مهتم/);
  assert.match(interested, /الخطوة التالية ستظهر هنا/);
  assert.equal(interested.includes("إتمام صفقة"), false);

  const needs = visibleText(buildDailyTaskCardHtml(byId.task_needs_details));
  assert.match(needs, /العميل يحتاج تفاصيل أكثر/);
  assert.match(needs, /السعر · الموقع · الصور · المواصفات · سؤال آخر/);
  assert.match(needs, /عرض تفاصيل الطلب/);

  const no = visibleText(buildDailyTaskCardHtml(byId.task_unsuitable));
  assert.match(no, /المطابقة غير مناسبة/);
  assert.equal(no.includes("إتمام صفقة"), false);
  assert.equal(no.includes("تفاوض"), false);
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
