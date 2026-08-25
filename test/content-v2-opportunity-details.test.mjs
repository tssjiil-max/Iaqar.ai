import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  mapOpportunityDetailsV2ViewModel,
  v2ReferenceActivities,
  v2ReferenceAppointment,
  v2ReferenceFixture,
  V2_DATA_ROWS
} from "../public/js/opportunity-details-v2-domain.js";
import { buildV2FieldPatch } from "../public/js/opportunity-details-v2.js";
import { editorForDataRow, firstMissingEditor, completenessLine, nextActionLine } from "../public/js/v2/opportunity-details/view-model.js";
import { buildOpportunityDataCardV2, buildCompleteMissingButtonV2 } from "../public/js/v2/opportunity-details/data-card.js";
import { buildDailyReportCardV2 } from "../public/js/v2/opportunity-details/daily-report.js";
import { buildNextAppointmentCardV2 } from "../public/js/v2/opportunity-details/next-appointment.js";
import { buildOpportunityDetailsContentV2 } from "../public/js/v2/opportunity-details/page.js";
import { buildFieldEditorV2, wireFieldEditorSheet } from "../public/js/v2/opportunity-details/editor.js";

function referenceViewModel() {
  return mapOpportunityDetailsV2ViewModel("opp_v2_ref_1258", v2ReferenceFixture(), {
    now: new Date("2026-08-22T07:40:00.000Z"),
    activities: v2ReferenceActivities(),
    nextAppointment: v2ReferenceAppointment()
  });
}

test("mobile data card starts collapsed and keeps all six rows in the DOM", () => {
  const html = buildOpportunityDataCardV2(referenceViewModel());
  assert.match(html, /class="cv2-card is-collapsed"/);
  assert.match(html, /عرض التفاصيل/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="cv2DataExtra"/);
  assert.match(html, /id="cv2DataExtra"/);
  assert.equal(html.includes("cv2-next-action"), false);
  assert.equal(html.includes("cv2-task-card"), false);
  const rows = [...html.matchAll(/data-cv2-row="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(rows, ["propertyPurpose", "location", "price", "specs", "advertiser", "contact"]);
  const extraStart = html.indexOf("id=\"cv2DataExtra\"");
  const extra = html.slice(extraStart, html.indexOf("data-cv2-row=\"contact\""));
  assert.match(extra, /data-cv2-row="specs"/);
  assert.match(extra, /data-cv2-row="advertiser"/);
  assert.equal(extra.includes("data-cv2-row=\"contact\""), false);
  const expanded = buildOpportunityDataCardV2(referenceViewModel(), { dataCardExpanded: true });
  assert.match(expanded, /class="cv2-card is-expanded"/);
  assert.match(expanded, /إخفاء التفاصيل/);
  assert.match(expanded, /aria-expanded="true"/);
});

test("data card extra id can be scoped for lists without changing the default", () => {
  const scoped = buildOpportunityDataCardV2(referenceViewModel(), { extraId: "cv2DataExtra-opp1" });
  assert.match(scoped, /id="cv2DataExtra-opp1"/);
  assert.match(scoped, /aria-controls="cv2DataExtra-opp1"/);
  assert.equal(scoped.includes('id="cv2DataExtra"'), false);
  const status = buildOpportunityDataCardV2(referenceViewModel(), { statusLine: "يحتاج استكمال" });
  assert.match(status, /يحتاج استكمال/);
});

test("Content V2 details keep six fixed rows in source order", () => {
  assert.deepEqual(V2_DATA_ROWS.map((row) => row.key), [
    "propertyPurpose",
    "location",
    "price",
    "specs",
    "advertiser",
    "contact"
  ]);
  const html = buildOpportunityDataCardV2(referenceViewModel());
  const rows = [...html.matchAll(/data-cv2-row="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(rows, V2_DATA_ROWS.map((row) => row.key));
});

test("classified missing fields render غير محدد inline and stay clickable", () => {
  const vm = referenceViewModel();
  const html = buildOpportunityDetailsContentV2(vm);
  assert.match(html, /data-cv2-editor="price"/);
  assert.match(html, /data-cv2-editor="contactNumber"/);
  assert.match(html, /أكمل البيانات الناقصة/);
  assert.equal((html.match(/غير محدد/g) || []).length, 2);
  assert.match(html, /cv2-missing-dot/);
  assert.equal(html.includes("cv2-missing-badge"), false);
  assert.match(html, /ينقص السعر ورقم التواصل/);
  assert.equal(completenessLine(vm), "ينقص السعر ورقم التواصل");
  assert.equal(nextActionLine(vm), "الإجراء التالي: أكمل السعر ورقم التواصل");
  assert.equal(editorForDataRow("price", vm.missingFields), "price");
  assert.equal(editorForDataRow("contact", vm.missingFields), "contactNumber");
  assert.equal(firstMissingEditor(vm), "price");
});

test("uncategorized empty values keep the row and leave the value blank", () => {
  const vm = mapOpportunityDetailsV2ViewModel("empty", {
    purpose: "SALE",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "عروة",
    advertiserRole: "OWNER",
    salePrice: 1000,
    area: 1000,
    contactPhone: "0511123456"
  });
  const html = buildOpportunityDataCardV2(vm);
  assert.equal((html.match(/data-cv2-row=/g) || []).length, 6);
  assert.match(html, /data-cv2-row="specs"/);
});

test("page contains only the approved PHASE 2 sections", () => {
  const html = buildOpportunityDetailsContentV2(referenceViewModel());
  assert.match(html, /بيانات الفرصة/);
  assert.match(html, /أكمل البيانات الناقصة/);
  assert.match(html, /تقرير اليوم/);
  assert.match(html, /الإجراء/);
  assert.match(html, /النتيجة/);
  assert.match(html, /النتيجة الحالية/);
  assert.match(html, /الموعد القادم/);
  assert.match(html, /غداً 9:15 ص/);
  assert.match(html, /10:40 ص/);
  assert.equal(html.includes("opp-details-progress-ring"), false);
  assert.equal(html.includes("نسبة اكتمال"), false);
  assert.equal(html.includes("86%"), false);
  assert.equal(html.includes("ابدأ المطابقة"), false);
  assert.equal(html.includes("إدارة الفرصة"), false);
  assert.equal(html.includes("Community"), false);
  assert.equal(html.includes("opp-v2-page"), false);
  assert.equal(html.includes("تعريف الفرصة"), false);
});

test("daily report shows action and result, with time under the result", () => {
  const html = buildDailyReportCardV2(referenceViewModel());
  assert.match(html, /class="cv2-report-action"/);
  assert.match(html, /class="cv2-report-outcome"/);
  assert.match(html, /class="cv2-report-time"/);
  assert.equal(html.includes(">الوقت<"), false);
  const actionAt = html.indexOf("مراجعة البيانات");
  const resultAt = html.indexOf("تم اكتشاف النواقص");
  const timeAt = html.indexOf("10:40 ص");
  assert.ok(actionAt > -1 && resultAt > actionAt && timeAt > resultAt);
});

test("empty appointment and report still keep their cards", () => {
  const vm = mapOpportunityDetailsV2ViewModel("x", {});
  const report = buildDailyReportCardV2(vm);
  const appointment = buildNextAppointmentCardV2(vm);
  assert.match(report, /تقرير اليوم/);
  assert.match(report, /النتيجة الحالية/);
  assert.match(appointment, /الموعد القادم/);
  assert.match(appointment, /-</);
  assert.equal(buildCompleteMissingButtonV2({ missingFields: [] }), "");
});

test("single-field editor does not open the full opportunity form", () => {
  const html = buildFieldEditorV2("contactNumber", { contactNumber: "" });
  assert.match(html, /رقم التواصل/);
  assert.equal(html.includes("bankUnifiedForm"), false);
  assert.equal(html.includes("priceOrBudget"), false);
  assert.equal(html.includes("advertiserRole"), false);
});

test("Arabic role editor patch still normalizes to OWNER", () => {
  const result = buildV2FieldPatch({ advertiserRole: "UNKNOWN" }, "advertiserRole", { advertiserRole: "مالك" });
  assert.equal(result.ok, true);
  assert.equal(result.patch.advertiserRole, "OWNER");
});

test("advertiser role editor stays empty and maps وسيط before save", () => {
  const html = buildFieldEditorV2("advertiserRole", { advertiserRole: "غير محدد" });
  assert.match(html, /placeholder="اختر أو اكتب صفة المعلن"/);
  assert.match(html, /name="advertiserRole"[^>]*value=""/);
  assert.equal(html.includes('value="غير محدد"'), false);
  assert.equal(html.includes('value="وسيط غير محدد"'), false);
  assert.match(html, /data-cv2-role="مالك"/);
  assert.match(html, /data-cv2-role="وسيط عقاري"/);
  const broker = buildV2FieldPatch({ advertiserRole: "UNKNOWN" }, "advertiserRole", { advertiserRole: "وسيط" });
  assert.equal(broker.ok, true);
  assert.equal(broker.patch.advertiserRole, "BROKER");
  const empty = buildV2FieldPatch({ advertiserRole: "UNKNOWN" }, "advertiserRole", { advertiserRole: "" });
  assert.equal(empty.ok, false);
  assert.equal(empty.error, "اختر: مالك، عميل، مفوض، أو وسيط عقاري.");
  const fake = buildV2FieldPatch({ advertiserRole: "UNKNOWN" }, "advertiserRole", { advertiserRole: "غير محدد" });
  assert.equal(fake.ok, false);
});

test("saving وسيط updates completeness and removes صفة المعلن from missing", () => {
  const existing = {
    purpose: "SALE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "عروة",
    salePrice: 850000,
    advertiserRole: "UNKNOWN",
    advertiserPhoneNormalized: "+966511123456"
  };
  const before = completenessLine(mapOpportunityDetailsV2ViewModel("opp_role", existing));
  assert.match(before, /المعلن/);
  const built = buildV2FieldPatch(existing, "advertiserRole", { advertiserRole: "وسيط" });
  assert.equal(built.patch.advertiserRole, "BROKER");
  const afterVm = mapOpportunityDetailsV2ViewModel("opp_role", { ...existing, ...built.patch });
  assert.equal(afterVm.advertiserRole, "وسيط عقاري");
  assert.equal(completenessLine(afterVm).includes("المعلن"), false);
  assert.equal(completenessLine(afterVm), "6 من 6 بيانات مكتملة");
});

test("field editor backdrop click dismisses without saving", () => {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`, { url: "https://example.test/" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.history = dom.window.history;
  globalThis.location = dom.window.location;
  globalThis.Event = dom.window.Event;
  const host = dom.window.document.body;
  host.innerHTML = buildFieldEditorV2("price", { priceLabel: "السعر" });
  const overlay = host.querySelector("[data-cv2-editor-root]");
  const sheet = overlay.querySelector(".cv2-editor-sheet");
  wireFieldEditorSheet(overlay);
  sheet.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(Boolean(host.querySelector("[data-cv2-editor-root]")), true);
  overlay.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(host.querySelector("[data-cv2-editor-root]"), null);
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.history;
  delete globalThis.location;
  delete globalThis.Event;
});

test("details markup exposes missing editors without a V2 header", () => {
  const html = buildOpportunityDetailsContentV2(referenceViewModel());
  const editors = [...html.matchAll(/data-cv2-editor="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(editors, ["price", "contactNumber"]);
  assert.match(html, /class="cv2-details"/);
  assert.equal(html.includes("opp-v2-header"), false);
  assert.ok(html.indexOf("data-cv2-complete") > html.indexOf("data-cv2-toggle-details"));
});

test("completeness line uses actual missing fields, not static copy", () => {
  assert.equal(completenessLine(referenceViewModel()), "ينقص السعر ورقم التواصل");
  const complete = mapOpportunityDetailsV2ViewModel("ready", {
    purpose: "SALE",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "عروة",
    advertiserRole: "OWNER",
    salePrice: 1000,
    area: 1000,
    contactPhone: "0511123456"
  });
  assert.equal(completenessLine(complete), "6 من 6 بيانات مكتملة");
  assert.equal(nextActionLine(complete), "الإجراء التالي: متابعة الفرصة");
  assert.equal(buildCompleteMissingButtonV2(complete), "");
});

test("compact task list keeps one expanded card at a time", async () => {
  const { JSDOM } = await import("jsdom");
  const { buildCompactTaskList, bindCompactTaskAccordion } = await import("../public/js/v2/task-summary.js");
  const tasks = [
    { id: "t1", kind: "opportunity", kindLabel: "فرصة", title: "أرض للبيع", summaryFields: [{ label: "السعر", primary: "غير محدد", missing: true }], nextAction: "الإجراء التالي: أكمل السعر" },
    { id: "t2", kind: "followup", kindLabel: "متابعة", title: "متابعة المالك", summaryFields: [{ label: "الوقت", primary: "11:05 ص" }], extraFields: [{ label: "الفرصة", primary: "1258" }], nextAction: "الإجراء التالي: تواصل مع المالك" }
  ];
  const dom = new JSDOM(`<!doctype html>${buildCompactTaskList(tasks)}`);
  bindCompactTaskAccordion(dom.window.document);
  const cards = [...dom.window.document.querySelectorAll("[data-cv2-task-card]")];
  assert.equal(cards.length, 2);
  assert.equal(cards.every((card) => card.classList.contains("is-collapsed")), true);
  cards[1].querySelector("[data-cv2-task-toggle]").click();
  assert.equal(cards[1].classList.contains("is-expanded"), true);
  assert.equal(cards[0].classList.contains("is-collapsed"), true);
  cards[0].querySelector("[data-cv2-task-toggle]").click();
  assert.equal(cards[0].classList.contains("is-expanded"), true);
  assert.equal(cards[1].classList.contains("is-collapsed"), true);
});

test("office card stays in place and collapses in memory only", async () => {
  const { JSDOM } = await import("jsdom");
  const { setupOfficeCardCollapse, teardownOfficeCardCollapse } = await import("../public/js/v2/office-collapse.js");
  const dom = new JSDOM(`<!doctype html><div class="app">
    <section class="card license"><div class="office-body"><h3>مكتب عروة</h3><button id="officeSettingsBtn" type="button">شعار</button></div></section>
  </div>`);
  setupOfficeCardCollapse(dom.window.document);
  const card = dom.window.document.querySelector("section.card.license");
  const toggle = card.querySelector(".cv2-office-toggle");
  assert.equal(card.classList.contains("is-office-collapsed"), true);
  assert.equal(toggle.textContent.includes("بيانات المكتب"), true);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.ok(card.querySelector("#officeSettingsBtn"));
  toggle.click();
  assert.equal(card.classList.contains("is-office-collapsed"), false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  setupOfficeCardCollapse(dom.window.document);
  assert.equal(card.classList.contains("is-office-collapsed"), false);
  assert.equal(card.querySelectorAll(".cv2-office-toggle").length, 1);
  teardownOfficeCardCollapse(dom.window.document);
  assert.equal(card.querySelector(".cv2-office-toggle"), null);
  assert.equal(card.classList.contains("is-office-collapsed"), false);
  assert.ok(card.querySelector("#officeSettingsBtn"));
});
