import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildDailyTaskView,
  buildMatchGroupDailyTask,
  buildTaskHeaderViewModel,
  mapOperationsItemsToDailyTasks
} from "../src/v2/content/daily-tasks/domain.js";
import {
  buildDailyTaskCardHtml
} from "../src/v2/content/daily-tasks/card.js";
import {
  groupMatchItems,
  livingStageAfterPartyAction,
  partyReplyTimelineLabel
} from "../public/js/match-group-domain.js";
import {
  COOPERATION_STAGE,
  buildCooperationDailyTaskView,
  partnerOfficeNameFor,
  waitingPartnerLabel
} from "../public/js/cooperation-workflow-domain.js";
import { formatCooperationReference, formatOpportunityReference } from "../public/js/reference-code-domain.js";
import { buildV2FieldPatch } from "../public/js/opportunity-details-v2.js";
import { mapOpportunityDetailsV2ViewModel } from "../public/js/opportunity-details-v2-domain.js";
import { buildFieldEditorV2 } from "../public/js/v2/opportunity-details/editor.js";
import { sortBankInboxRecords } from "../public/js/bank-inbox-card-domain.js";

const root = path.resolve(import.meta.dirname, "..");

function visible(html) {
  return String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

const matchItem = {
  operationType: "MATCH_REVIEW",
  matchId: "match_aziz_1842",
  clientRequestId: "req_1842",
  ownerOfferId: "offer_1842",
  opportunityId: "req_1842",
  propertyType: "شقة",
  purpose: "RENT",
  district: "العزيزية",
  city: "المدينة المنورة",
  budget: 55000,
  area: 120,
  candidatePropertyType: "شقة",
  candidatePurpose: "RENT",
  candidateDistrict: "العزيزية",
  candidateCity: "المدينة المنورة",
  candidateSalePrice: 50000,
  candidateArea: 125,
  matchReasons: ["نفس الحي", "ضمن الميزانية", "المساحة متقاربة"]
};

const coopRecord = {
  id: "coop_431",
  cooperationTaskId: "coop_431",
  originatingOfficeId: "office-client",
  targetOfficeId: "office-wadi",
  originatingOfficeName: "مكتب النور العقاري",
  targetOfficeName: "مكتب الوادي العقاري",
  currentStage: COOPERATION_STAGE.MATCH_FOUND,
  status: "SUGGESTED",
  originListing: {
    opportunityKind: "REQUEST",
    propertyType: "أرض",
    purpose: "SALE",
    district: "السكب",
    city: "المدينة المنورة",
    priceOrBudget: 850000,
    area: 1175
  },
  counterpartListing: {
    opportunityKind: "OFFER",
    propertyType: "أرض",
    purpose: "SALE",
    district: "السكب",
    city: "المدينة المنورة",
    priceOrBudget: 830000,
    area: 1180
  },
  proximityLabel: "نفس الحي",
  compatibilityLabel: "مطابقة مرتفعة"
};

test("TEST 1 collapsed match shows type purpose district city price and reference", () => {
  const [task] = mapOperationsItemsToDailyTasks([matchItem], new Date());
  const html = buildDailyTaskCardHtml(task);
  const text = visible(html);
  assert.match(text, /شقة للإيجار/);
  assert.match(text, /العزيزية/);
  assert.match(text, /المدينة المنورة/);
  assert.match(text, /50,000 ر\.س/);
  assert.equal(task.referenceCode, formatOpportunityReference("req_1842"));
  assert.match(text, /#A-1842/);
  assert.match(html, />عرض البيانات</);
  assert.equal(html.includes("051"), false);
});

test("TEST 2 opening a match stays inside Daily Tasks", () => {
  const [task] = mapOperationsItemsToDailyTasks([matchItem], new Date());
  const html = buildDailyTaskCardHtml(task, { open: true });
  const text = visible(html);
  assert.match(text, /طلب العميل/);
  assert.match(text, /العرض المطابق/);
  assert.match(text, /سبب المطابقة/);
  assert.match(html, />إرسال للعميل</);
  assert.match(html, />عرض التفاصيل الكاملة</);
  const controller = readFileSync(path.join(root, "src", "v2", "content", "daily-tasks", "controller.js"), "utf8");
  assert.equal(controller.includes('switchTo?.("opportunities")'), false);
  assert.match(controller, /toggleTaskDetails/);
});

test("TEST 3 closing details keeps the same open task", () => {
  const [task] = mapOperationsItemsToDailyTasks([matchItem], new Date());
  const open = buildDailyTaskCardHtml(task, { open: true, detailsOpen: true });
  assert.match(open, /data-cv2-exec-full-details/);
  assert.match(open, /التفاصيل الكاملة/);
  const closed = buildDailyTaskCardHtml(task, { open: true, detailsOpen: false });
  assert.equal(closed.includes("data-cv2-exec-full-details"), false);
  assert.match(closed, /is-open/);
  const controller = readFileSync(path.join(root, "src", "v2", "content", "daily-tasks", "controller.js"), "utf8");
  assert.match(controller, /restoreScroll/);
  assert.match(controller, /openTaskId/);
});

test("TEST 4 send copy is WhatsApp opened not sent", () => {
  const controller = readFileSync(path.join(root, "src", "v2", "content", "daily-tasks", "controller.js"), "utf8");
  const party = readFileSync(path.join(root, "src", "v2", "content", "daily-tasks", "party-link-domain.js"), "utf8");
  assert.match(party, /تم فتح واتساب/);
  assert.equal(controller.includes("تم إرسال الرسالة"), false);
});

test("TEST 5 client interested updates the same task timeline and sort", () => {
  const living = livingStageAfterPartyAction({ party: "client", action: "interested" });
  const grouped = groupMatchItems([{
    ...matchItem,
    livingStage: living.stage,
    ownerContactNeeded: living.ownerContactNeeded,
    hasNewResponse: true,
    livingUpdatedAt: "2026-08-25T09:27:00.000Z",
    livingTimeline: [
      { type: "reply", actor: "CLIENT", label: partyReplyTimelineLabel("client", "interested"), createdAt: "2026-08-25T09:27:00.000Z" }
    ]
  }]);
  const task = buildMatchGroupDailyTask(grouped[0], new Date("2026-08-25T09:30:00.000Z"));
  assert.equal(task.id, grouped[0].taskId);
  assert.equal(task.livingStage, "CLIENT_INTERESTED");
  assert.match(task.timeline[0].label, /العميل مهتم/);
  const html = buildDailyTaskCardHtml(task, { open: true });
  assert.match(visible(html), /العميل مهتم بالعقار/);
  assert.equal(visible(html).includes("الجهة"), false);
  const waiting = buildDailyTaskView({
    id: "waiting",
    stateKey: "awaiting_client",
    livingUpdatedAt: "2026-08-25T08:00:00.000Z"
  });
  const ordered = mapOperationsItemsToDailyTasks([
    { ...matchItem, livingStage: "WAITING_CLIENT", livingUpdatedAt: "2026-08-25T08:00:00.000Z" },
    { ...matchItem, matchId: "match_hot", clientRequestId: "req_1842", livingStage: living.stage, ownerContactNeeded: true, hasNewResponse: true, livingUpdatedAt: "2026-08-25T09:27:00.000Z" }
  ], new Date("2026-08-25T09:30:00.000Z"));
  assert.equal(ordered[0].livingStage, "CLIENT_INTERESTED");
  assert.equal(waiting.id, "waiting");
});

test("TEST 6 owner available updates the same task", () => {
  const living = livingStageAfterPartyAction({ party: "owner", action: "property_available" });
  const grouped = groupMatchItems([{
    ...matchItem,
    livingStage: living.stage,
    livingTimeline: [
      { type: "reply", actor: "OWNER", label: partyReplyTimelineLabel("owner", "property_available"), createdAt: "2026-08-25T09:35:00.000Z" }
    ]
  }]);
  const task = buildMatchGroupDailyTask(grouped[0], new Date());
  assert.equal(task.id, grouped[0].taskId);
  assert.equal(task.livingStage, "PROPERTY_AVAILABLE");
  assert.match(visible(buildDailyTaskCardHtml(task, { open: true })), /المالك أكد أن العقار متاح/);
});

test("TEST 7 timeline labels name the real actor", () => {
  assert.equal(partyReplyTimelineLabel("client", "interested"), "العميل مهتم بالعقار");
  assert.equal(partyReplyTimelineLabel("owner", "property_available"), "المالك أكد أن العقار متاح");
  assert.equal(waitingPartnerLabel("مكتب الوادي العقاري"), "بانتظار رد مكتب الوادي العقاري");
  const html = buildDailyTaskCardHtml(buildCooperationDailyTaskView(coopRecord, { officeId: "office-client" }), { open: true });
  assert.equal(visible(html).includes("الجهة"), false);
  assert.equal(visible(html).includes("المكتب الآخر"), false);
});

test("TEST 8 opportunity not completed does not show ended copy", () => {
  const [task] = mapOperationsItemsToDailyTasks([matchItem], new Date());
  const html = visible(buildDailyTaskCardHtml(task, { open: true }));
  assert.equal(html.includes("تم إنهاء الفرصة"), false);
  assert.equal(task.livingStage === "COMPLETED", false);
});

test("TEST 9 cooperation collapsed shows the office name", () => {
  const view = buildCooperationDailyTaskView(coopRecord, { officeId: "office-client" });
  const html = visible(buildDailyTaskCardHtml(view));
  assert.match(html, /مكتب الوادي العقاري/);
  assert.match(html, /#C-0431|#C-431/);
  assert.equal(view.referenceCode, formatCooperationReference("coop_431"));
  assert.match(html, /المكتب المقترح/);
  assert.match(html, /فتح التعاون/);
});

test("TEST 10 cooperation expanded shows own request and partner offer", () => {
  const view = buildCooperationDailyTaskView(coopRecord, { officeId: "office-client" });
  const html = visible(buildDailyTaskCardHtml(view, { open: true }));
  assert.match(html, /مكتبك/);
  assert.match(html, /مكتب الوادي العقاري/);
  assert.match(html, /850,000/);
  assert.match(html, /830,000/);
  assert.match(html, /السكب/);
  assert.match(html, /سبب التعاون/);
  assert.match(html, /راجع التعاون/);
});

test("TEST 11 waiting cooperation names the office", () => {
  const view = buildCooperationDailyTaskView({
    ...coopRecord,
    currentStage: COOPERATION_STAGE.WAITING_PARTNER,
    status: "PENDING",
    requestedAt: "2026-08-25T09:00:00.000Z"
  }, { officeId: "office-client" });
  assert.equal(partnerOfficeNameFor(view, "office-client") || view.partnerOfficeName, "مكتب الوادي العقاري");
  assert.match(view.statusLabel, /بانتظار رد مكتب الوادي العقاري/);
  assert.equal(view.statusLabel.includes("بانتظار المكتب الآخر"), false);
  const html = visible(buildDailyTaskCardHtml(view, { open: true }));
  assert.match(html, /بانتظار رد مكتب الوادي العقاري/);
});

test("TEST 12 same referenceCode on task details and timeline", () => {
  const [task] = mapOperationsItemsToDailyTasks([{
    ...matchItem,
    livingTimeline: [{ type: "found", actor: "BROKER", label: "تم العثور على مطابقة", createdAt: "2026-08-25T09:20:00.000Z" }]
  }], new Date());
  const header = buildTaskHeaderViewModel(task);
  assert.equal(header.referenceCode, task.referenceCode);
  const html = buildDailyTaskCardHtml(task, { open: true, detailsOpen: true });
  assert.equal((html.match(/#A-1842/g) || []).length >= 2, true);
});

test("TEST 13 location editor prefills city and district and skips empty wipe", () => {
  const vm = mapOpportunityDetailsV2ViewModel("opp_1", {
    opportunityKind: "OFFER",
    city: "المدينة المنورة",
    district: "العزيزية",
    propertyType: "شقة",
    purpose: "RENT"
  });
  const editor = buildFieldEditorV2("location", vm);
  assert.match(editor, /value="المدينة المنورة"/);
  assert.match(editor, /value="العزيزية"/);
  const patch = buildV2FieldPatch({ city: "المدينة المنورة", district: "" }, "location", {
    city: "",
    district: "العزيزية"
  });
  assert.equal(patch.ok, true);
  assert.equal(patch.patch.city, undefined);
  assert.equal(patch.patch.district, "العزيزية");
});

test("TEST 14 failed save keeps the sheet and does not claim success", () => {
  const empty = buildV2FieldPatch({ city: "المدينة المنورة" }, "location", { city: "", district: "" });
  assert.equal(empty.ok, false);
  const source = readFileSync(path.join(root, "public", "js", "opportunity-details-v2.js"), "utf8");
  const submit = source.slice(source.indexOf("async function submitEditor"), source.indexOf("root.querySelector(\"#oppV2BackBtn\")"));
  assert.match(source, /تعذر حفظ الحقل، حاول مرة أخرى/);
  assert.match(submit, /if \(!result\?\.ok\)/);
  assert.match(submit, /showEditorError\(root, result\?\.error \|\| SAVE_FAILED\)/);
  assert.match(submit, /return;/);
  assert.ok(submit.indexOf("if (!result?.ok)") < submit.indexOf("closeEditor(root"));
  assert.ok(!submit.includes("toast.textContent = \"تم الحفظ\"") || submit.indexOf("if (!result?.ok)") < submit.indexOf("تم الحفظ"));
  const inbox = readFileSync(path.join(root, "public", "js", "opportunity-bank.js"), "utf8");
  const inboxSubmit = inbox.slice(inbox.indexOf("async function submitInboxEditor"), inbox.indexOf("function openInboxEditor"));
  assert.match(inboxSubmit, /if \(!result\?\.ok\)/);
  assert.match(inboxSubmit, /showInboxEditorError/);
  assert.ok(inboxSubmit.indexOf("if (!result?.ok)") < inboxSubmit.indexOf("closeInboxEditor"));
});

test("TEST 15 completing the last missing field moves the item under قيد المطابقة", () => {
  const bank = readFileSync(path.join(root, "public", "js", "opportunity-bank.js"), "utf8");
  assert.match(bank, /يحتاج استكمال/);
  assert.match(bank, /قيد المطابقة/);
  assert.match(bank, /تم استكمال البيانات وانتقل العرض إلى قيد المطابقة/);
  const sorted = sortBankInboxRecords([
    { id: "ready", matchingReadiness: "READY", updatedAt: "2026-08-25T10:00:00.000Z", opportunityKind: "OFFER", propertyType: "أرض", city: "المدينة المنورة", district: "السكب", purpose: "SALE", priceOrBudget: 1, advertiserRole: "OWNER", contactPhone: "0511123456" },
    { id: "need", matchingReadiness: "NEEDS_COMPLETION", updatedAt: "2026-08-25T11:00:00.000Z", opportunityKind: "OFFER", district: "" }
  ]);
  assert.equal(sorted[0].id, "need");
  assert.equal(sorted[1].id, "ready");
});

test("TEST 16 reload keeps stage timeline and saved fields", () => {
  const grouped = groupMatchItems([{
    ...matchItem,
    livingStage: "WAITING_CLIENT",
    livingTimeline: [
      { type: "opened", actor: "BROKER", label: "تم فتح واتساب للعميل", createdAt: "2026-08-25T09:20:00.000Z" }
    ]
  }]);
  const first = buildMatchGroupDailyTask(grouped[0], new Date());
  const again = buildMatchGroupDailyTask(grouped[0], new Date());
  assert.equal(first.id, again.id);
  assert.equal(first.livingStage, "WAITING_CLIENT");
  assert.equal(again.timeline[0].label, "تم فتح واتساب للعميل");
  const vm = mapOpportunityDetailsV2ViewModel("opp_aziz", {
    city: "المدينة المنورة",
    district: "العزيزية",
    propertyType: "شقة"
  });
  assert.equal(vm.cityValue, "المدينة المنورة");
  assert.equal(vm.districtValue, "العزيزية");
});

test("TEST 17 mobile 360/390/430 cards do not clip actions", () => {
  const css = readFileSync(path.join(root, "src", "v2", "content", "daily-tasks", "styles.css"), "utf8");
  assert.match(css, /max-width: 430px/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /width: 100%/);
  const [task] = mapOperationsItemsToDailyTasks([matchItem], new Date());
  const html = buildDailyTaskCardHtml(task, { open: true, detailsOpen: true });
  assert.equal(html.includes("overflow: hidden") && html.includes("cv2-exec-actions"), false);
});
