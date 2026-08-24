import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapOpportunityDetailsV2ViewModel,
  v2ReferenceActivities,
  v2ReferenceAppointment,
  v2ReferenceFixture,
  V2_DATA_ROWS
} from "../public/js/opportunity-details-v2-domain.js";
import { buildV2FieldPatch } from "../public/js/opportunity-details-v2.js";
import { editorForDataRow, firstMissingEditor } from "../public/js/v2/opportunity-details/view-model.js";
import { buildOpportunityDataCardV2, buildCompleteMissingButtonV2 } from "../public/js/v2/opportunity-details/data-card.js";
import { buildDailyReportCardV2 } from "../public/js/v2/opportunity-details/daily-report.js";
import { buildNextAppointmentCardV2 } from "../public/js/v2/opportunity-details/next-appointment.js";
import { buildOpportunityDetailsContentV2 } from "../public/js/v2/opportunity-details/page.js";
import { buildFieldEditorV2 } from "../public/js/v2/opportunity-details/editor.js";

function referenceViewModel() {
  return mapOpportunityDetailsV2ViewModel("opp_v2_ref_1258", v2ReferenceFixture(), {
    now: new Date("2026-08-22T07:40:00.000Z"),
    activities: v2ReferenceActivities(),
    nextAppointment: v2ReferenceAppointment()
  });
}

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

test("classified missing fields render ناقص and stay clickable", () => {
  const vm = referenceViewModel();
  const html = buildOpportunityDetailsContentV2(vm);
  assert.match(html, /data-cv2-editor="price"/);
  assert.match(html, /data-cv2-editor="contactNumber"/);
  assert.match(html, /أكمل البيانات الناقصة/);
  assert.equal((html.match(/ناقص/g) || []).length >= 2, true);
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

test("details markup exposes missing editors without a V2 header", () => {
  const html = buildOpportunityDetailsContentV2(referenceViewModel());
  const editors = [...html.matchAll(/data-cv2-editor="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(editors, ["price", "contactNumber"]);
  assert.match(html, /class="cv2-details"/);
  assert.equal(html.includes("opp-v2-header"), false);
});
