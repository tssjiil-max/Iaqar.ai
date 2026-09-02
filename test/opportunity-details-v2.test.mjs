import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  isOpportunityDetailsV2Enabled,
  mapOpportunityDetailsV2ViewModel,
  parseOpportunityV2IdFromHash,
  v2ReferenceFixture,
  v2ReferenceActivities,
  v2ReferenceAppointment,
  V2_DATA_ROWS
} from "../public/js/opportunity-details-v2-domain.js";
import {
  buildOpportunityDetailsV2PageHtml,
  buildOpportunityDataCardV2,
  buildFieldEditorV2
} from "../public/js/opportunity-details-v2-ui.js";
import { buildV2FieldPatch } from "../public/js/opportunity-details-v2.js";

test("feature flag reads query, hash, and storage", () => {
  assert.equal(isOpportunityDetailsV2Enabled({ search: "?env=staging", hash: "" }, { getItem: () => null }), false);
  assert.equal(isOpportunityDetailsV2Enabled({ search: "?oppV2=1", hash: "" }, { getItem: () => null }), true);
  assert.equal(isOpportunityDetailsV2Enabled({ search: "", hash: "#/opportunities-v2/abc" }, { getItem: () => null }), true);
  assert.equal(isOpportunityDetailsV2Enabled({ search: "", hash: "" }, { getItem: (key) => key === "iaqar.opportunityDetailsV2" ? "1" : null }), true);
  assert.equal(parseOpportunityV2IdFromHash("#/opportunities-v2/opp_1"), "opp_1");
});

test("V2 mapper uses display number and missing field editors", () => {
  const vm = mapOpportunityDetailsV2ViewModel("opp_v2_ref_1258", v2ReferenceFixture(), {
    now: new Date("2026-08-22T07:40:00.000Z"),
    activities: v2ReferenceActivities(),
    nextAppointment: v2ReferenceAppointment()
  });
  assert.equal(vm.displayNumber, "1258");
  assert.equal(vm.type, "عرض مالك");
  assert.equal(vm.status, "ناقصة");
  assert.equal(vm.propertyPurpose, "عرض أرض للبيع");
  assert.match(vm.location, /المدينة/);
  assert.equal(vm.price, "");
  assert.equal(vm.area, "1,000 م²");
  assert.equal(vm.advertiserRole, "مالك");
  assert.equal(vm.contactNumber, "");
  assert.deepEqual(vm.missingFields.map((row) => row.editor), ["price", "contactNumber"]);
});

test("V2 page keeps six data rows and has no progress ring", () => {
  const vm = mapOpportunityDetailsV2ViewModel("opp_v2_ref_1258", v2ReferenceFixture(), {
    activities: v2ReferenceActivities(),
    nextAppointment: v2ReferenceAppointment()
  });
  const html = buildOpportunityDetailsV2PageHtml(vm);
  assert.equal(html.includes("opp-details-progress-ring"), false);
  assert.equal(html.includes("نسبة اكتمال"), false);
  assert.equal(V2_DATA_ROWS.length, 6);
  const data = buildOpportunityDataCardV2(vm);
  assert.equal((data.match(/data-v2-row=/g) || []).length, 6);
  assert.match(html, /data-v2-editor="price"/);
  assert.match(html, /data-v2-editor="contactNumber"/);
  assert.match(html, /استكمال البيانات/);
  assert.match(html, /تقرير اليوم/);
  assert.match(html, /الوقت/);
  assert.match(html, /الإجراء/);
  assert.match(html, /النتيجة/);
  assert.match(html, /الموعد القادم/);
  assert.match(html, /غداً 9:15 ص/);
});

test("empty values still render the six rows", () => {
  const vm = mapOpportunityDetailsV2ViewModel("x", {});
  const html = buildOpportunityDataCardV2(vm);
  assert.equal((html.match(/data-v2-row=/g) || []).length, 6);
  assert.match(html, /ناقص/);
  assert.match(html, /غير محدد/);
});

test("missing field editor opens a single-field sheet", () => {
  const html = buildFieldEditorV2("advertiserRole", { advertiserRole: "" });
  assert.match(html, /صفة المعلن/);
  assert.match(html, /placeholder="اختر أو اكتب صفة المعلن"/);
  assert.equal(html.includes('value="غير محدد"'), false);
  assert.equal(html.includes("bankUnifiedForm"), false);
  assert.equal(html.includes("priceOrBudget"), false);
});

test("Arabic role editor patch normalizes وسيط to BROKER", () => {
  const result = buildV2FieldPatch({ advertiserRole: "UNKNOWN" }, "advertiserRole", { advertiserRole: "وسيط" });
  assert.equal(result.ok, true);
  assert.equal(result.patch.advertiserRole, "BROKER");
});

test("Arabic role editor patch normalizes to OWNER", () => {
  const result = buildV2FieldPatch({ advertiserRole: "UNKNOWN" }, "advertiserRole", { advertiserRole: "مالك" });
  assert.equal(result.ok, true);
  assert.equal(result.patch.advertiserRole, "OWNER");
});

test("V2 page DOM chips open editor attributes", () => {
  const vm = mapOpportunityDetailsV2ViewModel("opp_v2_ref_1258", v2ReferenceFixture());
  const dom = new JSDOM(buildOpportunityDetailsV2PageHtml(vm));
  const chips = [...dom.window.document.querySelectorAll("[data-v2-editor]")];
  assert.ok(chips.length >= 2);
  assert.deepEqual(chips.map((node) => node.getAttribute("data-v2-editor")), ["price", "contactNumber"]);
});
