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
import {
  buildPartyReviewUrl,
  buildPartyWhatsAppMessage,
  encodePartyLinkToken,
  missingPartyPhoneMessage,
  normalizeDailyTaskPhone,
  PARTY_SEND_COPY,
  parsePartyLinkToken,
  partyTokenFromLocation,
  phoneFromTask,
  whatsappOpenedMessage,
  isOpaquePartyToken
} from "../src/v2/content/daily-tasks/party-link-domain.js";

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
    "task_interested",
    "task_needs_details",
    "task_appointment_today",
    "task_awaiting_client",
    "task_unsuitable"
  ]);
});

test("collapsed new-match card is compact Arabic summary with reveal only", () => {
  const task = dailyTasksDemoFixtures().find((item) => item.id === "task_new_match");
  const html = buildDailyTaskCardHtml(task);
  const text = visibleText(html);
  assert.match(text, /مطابقة جديدة/);
  assert.match(text, /أرض للبيع — حي عروة/);
  assert.match(text, /500,000 ر\.س/);
  assert.match(text, /تم العثور على مطابقة/);
  assert.match(html, /data-cv2-exec-reveal/);
  assert.match(html, />مراجعة المطابقات</);
  assert.equal(html.includes("إرسال للعميل"), false);
  assert.equal(html.includes("إرسال للمالك"), false);
  assert.equal(html.includes("عرض تفاصيل العرض"), false);
  assert.equal(countPrimary(html), 0);
  assert.equal(countSecondary(html), 0);
  assert.equal(html.includes("data-cv2-exec-primary="), false);
  assert.equal(html.includes("is-open"), false);
  assert.match(html, /aria-expanded="false"/);
  assert.equal(html.includes("بيانات الفرصة"), false);
  assert.equal(html.includes("cv2-data-card"), false);
  assert.equal(forbiddenBrokerChrome(html).hasNegotiate, false);
  assert.equal(ENGLISH_UI.test(text), false);
});

test("open match-found card shows send-to-client and offer details, not send-to-owner", () => {
  const task = dailyTasksDemoFixtures().find((item) => item.id === "task_new_match");
  const html = buildDailyTaskCardHtml(task, { open: true });
  const text = visibleText(html);
  assert.match(html, /class="cv2-exec-card is-open"/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, />إخفاء البيانات</);
  assert.match(html, /data-cv2-exec-primary="send_to_client"/);
  assert.match(html, />إرسال للعميل</);
  assert.equal(html.includes("إرسال للمالك"), false);
  assert.match(html, /data-cv2-exec-secondary="open_offer"/);
  assert.match(html, />عرض تفاصيل العرض</);
  assert.equal(countPrimary(html), 1);
  assert.equal(countSecondary(html), 1);
  assert.equal(task.primaryAction.party, SECURE_PARTY.CLIENT);
  assert.equal(task.secondaryActions[0].id, EXEC_ACTION.OPEN_OFFER);
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
  assert.match(collapsed, />عرض البيانات</);
  assert.equal(collapsed.includes("إعادة الإرسال"), false);
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
  assert.match(interestedText, /✓ العميل مهتم|العميل مهتم/);
  assert.equal(interestedText.includes("الخطوة التالية ستظهر هنا"), false);
  assert.equal(interested.includes("إرسال للعميل"), false);
  assert.equal(interested.includes("إتمام صفقة"), false);
  assert.equal(interested.includes(FUTURE_CLIENT_REPLY_LABELS.interested) && /<button[^>]*>مهتم</.test(interested), false);

  const needs = visibleText(buildDailyTaskCardHtml(byId.task_needs_details, { open: true }));
  assert.match(needs, /العميل يحتاج تفاصيل أكثر/);
  assert.equal(needs.includes("الخطوة التالية ستظهر هنا"), false);
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
  assert.match(closedNewMatch, />مراجعة المطابقات</);
  assert.equal(closedNewMatch.includes("إخفاء البيانات"), false);
  assert.equal(countPrimary(html), 1);
  assert.equal(countSecondary(html), 1);
  assert.match(html, />إخفاء البيانات</);
  assert.equal(buildDailyTaskListHtml(fixtures).includes("is-open"), false);
});

test("collapsed match tasks use مراجعة المطابقات and never send actions", () => {
  const html = buildDailyTaskListHtml(dailyTasksDemoFixtures());
  assert.equal((html.match(/>مراجعة المطابقات</g) || []).length, 2);
  assert.equal((html.match(/>عرض البيانات</g) || []).length, 5);
  assert.equal(html.includes("إخفاء البيانات"), false);
  assert.equal(html.includes("إرسال للعميل"), false);
  assert.equal(html.includes("إرسال للمالك"), false);
  assert.equal(countPrimary(html), 0);
  assert.equal(countSecondary(html), 0);
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
  assert.equal(match.clientPhone, "");
  assert.equal(match.ownerPhone, "");

  const withPhones = mapOperationsItemToDailyTask({
    operationType: "MATCH_REVIEW",
    matchId: "match_live_2",
    ownerOfferId: "offer_live_2",
    clientRequestId: "request_live_2",
    clientPhone: "0512345678",
    ownerPhone: "0598765432",
    propertyType: "أرض",
    purpose: "SALE",
    district: "عروة",
    salePrice: 1
  }, now);
  assert.equal(withPhones.clientPhone, "0512345678");
  assert.equal(withPhones.ownerPhone, "0598765432");

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

test("daily-task controller wires send and open without claiming delivery", () => {
  const controller = readFileSync(path.join(root, "src", "v2", "content", "daily-tasks", "controller.js"), "utf8");
  assert.match(controller, /runDailyTaskPartySend/);
  assert.match(controller, /openExistingOfferDetails/);
  assert.match(controller, /send_to_client/);
  assert.match(controller, /send_to_owner/);
  assert.match(controller, /open_offer/);
  assert.match(controller, /openTaskId/);
  assert.match(controller, /data-cv2-exec-reveal/);
  assert.match(controller, /whatsappOpenedMessage/);
  const partyDomain = readFileSync(path.join(root, "src", "v2", "content", "daily-tasks", "party-link-domain.js"), "utf8");
  assert.match(partyDomain, /تم فتح واتساب للعميل/);
  assert.equal(controller.includes("تم إرسال الرسالة"), false);
  assert.equal(partyDomain.includes("تم إرسال الرسالة"), true);
  assert.equal(controller.includes("OTP"), false);
  assert.equal(controller.includes("Reserved for a later CLIENT_MATCH_REVIEW session"), false);
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

test("party phones normalize and missing-number copy stays Arabic", () => {
  assert.equal(normalizeDailyTaskPhone("0511111111"), "966511111111");
  assert.equal(normalizeDailyTaskPhone("+966522222222"), "966522222222");
  assert.equal(normalizeDailyTaskPhone("123"), "");
  assert.equal(missingPartyPhoneMessage("client"), "رقم تواصل العميل غير متوفر.");
  assert.equal(missingPartyPhoneMessage("owner"), "رقم تواصل المالك غير متوفر.");
  assert.equal(whatsappOpenedMessage("client"), "تم فتح واتساب للعميل");
  assert.equal(whatsappOpenedMessage("owner"), "تم فتح واتساب للمالك");
  assert.equal(PARTY_SEND_COPY.sentClaimForbidden, "تم إرسال الرسالة");
});

test("client and owner review URLs require opaque tokens and stay distinct", () => {
  const clientToken = "a".repeat(64);
  const ownerToken = "b".repeat(64);
  assert.equal(isOpaquePartyToken(clientToken), true);
  assert.equal(isOpaquePartyToken(encodePartyLinkToken({ matchId: "match_new_1", party: "client" })), false);
  const clientUrl = buildPartyReviewUrl({ origin: "https://example.test", pathname: "/", token: clientToken });
  const ownerUrl = buildPartyReviewUrl({ origin: "https://example.test", pathname: "/", token: ownerToken });
  assert.notEqual(clientUrl, ownerUrl);
  assert.match(clientUrl, /cv2Party=/);
  assert.equal(buildPartyReviewUrl({ origin: "https://example.test", pathname: "/", token: "eyJub3QiOiJhdXRoIn0" }), "");
  assert.equal(partyTokenFromLocation({ search: `?cv2Party=${clientToken}` }), clientToken);
  const clientMessage = buildPartyWhatsAppMessage({
    party: "client",
    propertyLine: "أرض للبيع — حي عروة",
    reviewUrl: clientUrl
  });
  const ownerMessage = buildPartyWhatsAppMessage({
    party: "owner",
    propertyLine: "أرض للبيع — حي عروة",
    reviewUrl: ownerUrl
  });
  assert.match(clientMessage, /وجدنا عرضًا مناسبًا لطلبك/);
  assert.match(ownerMessage, /يوجد عميل مهتم بعقار مطابق/);
  assert.equal(clientMessage.includes(clientUrl), true);
  assert.equal(ownerMessage.includes(ownerUrl), true);
  assert.equal(parsePartyLinkToken(""), null);
});

test("demo new-match has phones for send while overdue stays phoneless", () => {
  const byId = Object.fromEntries(dailyTasksDemoFixtures().map((task) => [task.id, task]));
  assert.equal(phoneFromTask(byId.task_new_match, "client"), "966511111111");
  assert.equal(phoneFromTask(byId.task_new_match, "owner"), "966522222222");
  assert.equal(phoneFromTask(byId.task_overdue, "client"), "");
  assert.equal(phoneFromTask(byId.task_overdue, "owner"), "");
  const html = buildDailyTaskCardHtml(byId.task_new_match, { open: true });
  assert.equal(html.includes("0511111111"), false);
  assert.equal(html.includes("0522222222"), false);
});

test("embedded cv2Party JSON is not a review URL", () => {
  const embedded = encodePartyLinkToken({
    matchId: "match_new_1",
    party: "client",
    sid: "land-1"
  });
  assert.equal(isOpaquePartyToken(embedded), false);
  assert.equal(buildPartyReviewUrl({ origin: "https://example.test", pathname: "/", token: embedded }), "");
});

test("send buttons open WhatsApp with role-specific links and block missing phones", async () => {
  const { JSDOM } = await import("jsdom");
  const { mountDailyTasksContentV2, unmountDailyTasksContentV2 } = await import("../src/v2/content/daily-tasks/controller.js");
  const opened = [];
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="toast" hidden></div>
    <div id="contentV2"></div>
  </body></html>`, { url: "https://example.test/?cv2Tasks=1", pretendToBeVisual: true });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  const minted = { client: "c".repeat(64), owner: "d".repeat(64) };
  window.IAQAR = {
    office: { officeId: "office-test", workerBase: "https://worker.test" },
    workerBase: "https://worker.test",
    resolveWorkerBase: () => "https://worker.test",
    whatsappHandoff: {
      openWhatsApp({ phone, text }) {
        const result = { ok: true, phone, text, url: `https://wa.me/${phone}?text=${encodeURIComponent(text)}` };
        opened.push(result);
        return result;
      }
    }
  };
  window.firebase = {
    auth() {
      return { currentUser: { getIdToken: async () => "id-token" } };
    }
  };
  window.fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body || "{}");
    const token = body.party === "owner" ? minted.owner : minted.client;
    return {
      ok: true,
      json: async () => ({ ok: true, token, reused: false })
    };
  };
  global.fetch = window.fetch;

  mountDailyTasksContentV2(window.document.getElementById("contentV2"));
  const newMatchReveal = window.document.querySelector('[data-task-id="task_new_match"] [data-cv2-exec-reveal]');
  newMatchReveal.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  window.document.querySelector('[data-cv2-exec-primary="send_to_client"]')
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(opened.length, 1);
  assert.equal(opened[0].phone, "966511111111");
  assert.match(opened[0].text, /رابط المراجعة/);
  assert.match(opened[0].text, /cv2Party=/);
  const clientUrl = opened[0].text.match(/https:\/\/example\.test\/\?cv2Party=[^\s]+/)[0];
  assert.match(clientUrl, /cv2Party=/);
  assert.equal(window.document.getElementById("toast").textContent, "تم فتح واتساب للعميل");
  assert.equal(opened[0].text.includes("العقار") && /وجدنا عرضًا مناسبًا لطلبك: العقار/.test(opened[0].text), false);

  window.document.querySelector('[data-task-id="task_overdue"] [data-cv2-exec-reveal]')
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  window.document.querySelector('[data-task-id="task_overdue"] [data-cv2-exec-primary="send_to_client"]')
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(opened.length, 1);
  assert.equal(window.document.getElementById("toast").textContent, "رقم تواصل العميل غير متوفر.");

  let switched = "";
  window.IAQAR.homeTabs = { switchTo(name) { switched = name; } };
  window.IAQAR.contentV2 = { render() {} };
  window.document.querySelector('[data-task-id="task_new_match"] [data-cv2-exec-reveal]')
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  window.document.querySelector('[data-cv2-exec-secondary="open_offer"]')
    .dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(switched, "opportunities");
  assert.match(window.location.hash, /#\/opportunities\/offer_urwah_1/);

  unmountDailyTasksContentV2();
  delete global.window;
  delete global.document;
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
