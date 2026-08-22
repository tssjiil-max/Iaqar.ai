import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCurrentResultText,
  buildDailyReportRows,
  buildNextAppointmentHtml,
  formatAppointmentHeadline,
  joinArabicList,
  missingDisplayLabels,
  projectActivityToDailyReportRow,
  resolveNextAppointment
} from "../public/js/opportunity-details-report-ui.js";
import { evaluateMatchingReadiness } from "../public/js/opportunity-readiness-domain.js";

test("missing display labels match details table wording", () => {
  const record = { opportunityKind: "OFFER" };
  const labels = missingDisplayLabels(record, {
    matchingReadinessMissing: ["priceOrBudget", "contactPhone"]
  });
  assert.deepEqual(labels, ["السعر", "رقم التواصل"]);
});

test("current result summarizes missing fields in Arabic", () => {
  const record = { opportunityKind: "OFFER" };
  const text = buildCurrentResultText(record, {
    matchingReadiness: "NEEDS_COMPLETION",
    matchingReadinessMissing: ["priceOrBudget", "contactPhone"],
    isReadyForMatching: false
  });
  assert.equal(text, "بانتظار استكمال السعر ورقم التواصل");
});

test("current result names missing contact phone as a matching gate", () => {
  const text = buildCurrentResultText({ opportunityKind: "OFFER" }, {
    matchingReadiness: "NEEDS_COMPLETION",
    matchingReadinessMissing: ["contactPhone"],
    isReadyForMatching: false
  });
  assert.equal(text, "البيانات ناقصة — يلزم رقم التواصل");
});

test("current result points to contact after a real match", () => {
  const text = buildCurrentResultText({
    opportunityKind: "OFFER",
    matchCount: 1
  }, {
    matchingReadiness: "READY_FOR_MATCHING",
    matchingReadinessMissing: [],
    isReadyForMatching: true
  });
  assert.equal(text, "تم العثور على مطابقة — التواصل هو الخطوة التالية");
});

test("daily report maps today's existing activity only", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const record = {
    opportunityKind: "OFFER",
    createdAt: "2026-08-21T07:40:00.000Z",
    lastContactAt: "2026-08-20T07:45:00.000Z"
  };
  const rows = buildDailyReportRows(record, [], now, evaluateMatchingReadiness(record));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "مراجعة البيانات");
  assert.ok(rows[0].result.includes("تم اكتشاف النواقص"));
});

test("cooperation activity becomes send-opportunity report row", () => {
  const row = projectActivityToDailyReportRow({
    at: "2026-08-21T07:58:00.000Z",
    text: "تعاون مع مكتب الجماوات: بانتظار الموافقة"
  }, { opportunityKind: "OFFER" });
  assert.equal(row.action, "إرسال الفرصة");
  assert.equal(row.result, "✓ أرسلت إلى مكتب الجماوات");
});

test("next appointment hides when none is scheduled", () => {
  const html = buildNextAppointmentHtml({ opportunityKind: "OFFER" }, {
    now: new Date("2026-08-21T12:00:00.000Z")
  });
  assert.equal(html, "");
});

test("next appointment prefers upcoming viewing and weekday headline", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const record = {
    opportunityKind: "OFFER",
    viewingAt: "2026-08-26T05:00:00.000Z"
  };
  const appointment = resolveNextAppointment(record, now);
  assert.equal(appointment.kindLabel, "معاينة العقار");
  const headline = formatAppointmentHeadline(appointment.at, now);
  assert.match(headline, /الأربعاء/);
  assert.match(headline, /٢٦/);
  assert.match(headline, /أغسطس/);
  assert.equal(headline.includes("غدًا"), false);
  const html = buildNextAppointmentHtml(record, { now });
  assert.ok(html.includes("معاينة العقار"));
  assert.ok(html.includes("المالك"));
  assert.ok(html.includes("بانتظار التأكيد"));
});

test("join Arabic list uses و between items", () => {
  assert.equal(joinArabicList(["السعر"]), "السعر");
  assert.equal(joinArabicList(["السعر", "رقم التواصل"]), "السعر ورقم التواصل");
});
