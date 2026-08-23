import test from "node:test";
import assert from "node:assert/strict";
import { buildNeedsCompletionDetailHtml } from "../public/js/opportunity-bank-workspace-ui.js";
import { buildOpportunityDetailSummaryHtml } from "../public/js/opportunity-detail-panel-ui.js";

test("detail panel uses structured summary and save label", () => {
  const html = buildNeedsCompletionDetailHtml("opp_test_1", {
    propertyType: "أرض",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "عروة",
    area: 1000
  }, {
    matchingReadiness: "NEEDS_COMPLETION",
    matchingReadinessMissing: ["priceOrBudget", "contactPhone"]
  });
  assert.ok(html.includes("تفاصيل الفرصة"));
  assert.ok(html.includes("opp-details-page"));
  assert.ok(html.includes("opp-details"));
  assert.ok(html.includes("opp-details-data-table"));
  assert.ok(html.includes("oppDetailsRevealFormBtn"));
  assert.ok(html.indexOf("بيانات الفرصة") < html.indexOf("نسبة اكتمال البيانات"));
  assert.ok(html.indexOf("نسبة اكتمال البيانات") < html.indexOf("oppDetailsRevealFormBtn"));
  assert.ok(html.includes('id="bankIncompleteEditSection"'));
  assert.ok(html.includes("bankIncompleteEditSection") && html.includes("hidden"));
  assert.ok(html.includes("حفظ الفرصة"));
  assert.ok(!html.includes("استكمال الفرصة"));
  assert.ok(!html.includes("bank-row-header"));
  assert.ok(!html.includes("bank-detail-head"));
});

test("detail summary shows progress and missing chips without checklist marks", () => {
  const html = buildOpportunityDetailSummaryHtml("opp_abc", {
    opportunityKind: "OFFER",
    propertyType: "أرض",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "عروة",
    area: 1000
  }, {
    matchingReadinessMissing: ["priceOrBudget", "contactPhone"]
  });
  assert.ok(html.includes("opp-details-progress"));
  assert.ok(html.includes("opp-details-missing-chip"));
  assert.ok(html.includes("البيانات الناقصة"));
  assert.ok(!html.includes("✗"));
  assert.ok(!html.includes("listing-field-mark"));
});
