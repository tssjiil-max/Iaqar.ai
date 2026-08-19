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
  assert.ok(html.includes("opp-detail-summary"));
  assert.ok(html.includes("opp-detail-data-table"));
  assert.ok(html.includes("bank-row-header"));
  assert.ok(html.includes("حفظ الفرصة"));
  assert.ok(!html.includes("استكمال الفرصة"));
});

test("detail summary shows progress and missing chips", () => {
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
  assert.ok(html.includes("opp-detail-progress-block"));
  assert.ok(html.includes("opp-detail-missing-chip"));
  assert.ok(html.includes("✗"));
});
