import test from "node:test";
import assert from "node:assert/strict";
import { buildDailyTaskCardHtml } from "../public/js/v2/daily-tasks/card.js";

function matchTask(extra = {}) {
  return {
    id: "match-live-1",
    taskKind: "match_group",
    matchId: "mat_1",
    offerId: "off_1",
    requestId: "req_1",
    sourceListing: { propertyType: "فيلا", purpose: "PURCHASE", kindLabel: "طلب العميل" },
    proposedListing: { propertyType: "فيلا", purpose: "SALE", kindLabel: "عرض المالك" },
    ...extra
  };
}

test("open match card renders the broker negotiation assistant", () => {
  const html = buildDailyTaskCardHtml(matchTask({
    livingStage: "PROPERTY_AVAILABLE",
    coordinationClientSummary: "أقل 5%",
    coordinationOwnerSummary: "2%"
  }), { open: true });
  assert.match(html, /data-negotiation-assistant/);
  assert.match(html, /التوفر/);
  assert.match(html, /المعلومات/);
  assert.match(html, /السعر/);
  assert.match(html, /المعاينة/);
  assert.match(html, /الاتفاق/);
  assert.match(html, /فجوة السعر:<\/strong> 3%/);
  assert.match(html, /الفجوة المتبقية 3%/);
  assert.match(html, /data-broker-panel open/);
});

test("routine match keeps assistant visible but hides broker intervention panel", () => {
  const html = buildDailyTaskCardHtml(matchTask({ livingStage: "WAITING_CLIENT" }), { open: true });
  assert.match(html, /data-negotiation-assistant/);
  assert.match(html, /لا يحتاج تدخلًا الآن/);
  assert.doesNotMatch(html, /data-broker-panel/);
});

test("collapsed match does not expose negotiation details", () => {
  const html = buildDailyTaskCardHtml(matchTask({ livingStage: "PROPERTY_AVAILABLE" }), { open: false });
  assert.doesNotMatch(html, /data-negotiation-assistant/);
});
