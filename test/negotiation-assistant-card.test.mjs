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
  assert.match(html, /data-broker-panel/);
});

test("match workspace keeps the broker section available throughout negotiation", () => {
  const html = buildDailyTaskCardHtml(matchTask({ livingStage: "WAITING_CLIENT" }), { open: true });
  assert.match(html, /data-negotiation-assistant/);
  assert.match(html, /لا يحتاج تدخلًا الآن/);
  assert.match(html, /data-broker-panel/);
  assert.match(html, /data-match-section="property"/);
  assert.match(html, /data-match-section="agreement"/);
  assert.match(html, /data-match-section="parties"/);
  assert.match(html, /data-match-section="broker"/);
  assert.ok(html.indexOf('data-party-side="owner"') < html.indexOf('data-party-side="client"'));
  assert.equal((html.match(/<textarea/g) || []).length, 1);
});

test("negotiation topics follow the property type", () => {
  const land = buildDailyTaskCardHtml(matchTask({
    propertyType: "أرض",
    proposedListing: { propertyType: "أرض" }
  }), { open: true });
  assert.match(land, /شروط الصفقة/);
  assert.doesNotMatch(land, /التجهيزات/);
});

test("owner WhatsApp becomes available after the client's interested response", () => {
  const pending = buildDailyTaskCardHtml(matchTask(), { open: true });
  assert.match(pending, /data-party="owner" disabled[^>]*>بانتظار موافقة العميل/);
  const interested = buildDailyTaskCardHtml(matchTask({ livingStage: "CLIENT_INTERESTED" }), { open: true });
  assert.match(interested, /data-party="owner">إرسال للمالك/);
});

test("collapsed match does not expose negotiation details", () => {
  const html = buildDailyTaskCardHtml(matchTask({ livingStage: "PROPERTY_AVAILABLE" }), { open: false });
  assert.doesNotMatch(html, /data-negotiation-assistant/);
});

test("collapsed match shows the latest negotiation activity without opening details", () => {
  const html = buildDailyTaskCardHtml(matchTask({
    negotiationStatus: "WAITING_OWNER",
    lastNegotiationEvent: "العميل قدم عرضًا جديدًا",
    lastNegotiationActivityAt: "2026-09-22T10:00:00.000Z"
  }), { open: false });
  assert.match(html, /التفاوض: بانتظار المالك/);
  assert.match(html, /آخر نشاط:<\/strong> العميل قدم عرضًا جديدًا/);
});
