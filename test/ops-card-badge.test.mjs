import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClosingReadinessBadge,
  buildMatchingReadinessBadge,
  buildOpsCardBadge,
  isClientOwnerCard
} from "../public/js/ops-card-badge-domain.js";

test("isClientOwnerCard detects opportunity and intake rows", () => {
  assert.equal(isClientOwnerCard({ recordType: "opportunity" }), true);
  assert.equal(isClientOwnerCard({ recordType: "intake" }), true);
  assert.equal(isClientOwnerCard({ recordType: "match" }), false);
});

test("buildMatchingReadinessBadge uses broker four-level badge", () => {
  const badge = buildMatchingReadinessBadge({
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "الرانوناء"
  });
  assert.equal(badge.kind, "broker_readiness");
  assert.ok(badge.mark);
  assert.ok(badge.detailLine.includes("%"));
});

test("buildClosingReadinessBadge uses score fallback", () => {
  const badge = buildClosingReadinessBadge({ closingReadinessScore: 90 });
  assert.equal(badge.label, "عالية جدًا");
  assert.equal(badge.cssClass, "is-very-high");
  assert.equal(badge.mark, "🟢");
});

test("buildOpsCardBadge picks broker readiness vs closing badge by record type", () => {
  assert.equal(buildOpsCardBadge({ recordType: "opportunity", matchingReadiness: "READY_FOR_MATCHING" }).kind, "broker_readiness");
  assert.equal(buildOpsCardBadge({ recordType: "match", closingReadinessScore: 72 }).kind, "closing");
  assert.equal(buildOpsCardBadge({ recordType: "deal" }), null);
});
