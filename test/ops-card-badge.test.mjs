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

test("buildMatchingReadinessBadge shows ready state", () => {
  const badge = buildMatchingReadinessBadge({
    matchingReadiness: "READY_FOR_MATCHING",
    matchingReadinessMissing: []
  });
  assert.equal(badge.label, "جاهزة للمطابقة");
  assert.equal(badge.cssClass, "is-ready");
  assert.equal(badge.detailLine, "جاهزة للمطابقة");
});

test("buildMatchingReadinessBadge lists missing fields", () => {
  const badge = buildMatchingReadinessBadge({
    matchingReadiness: "NEEDS_COMPLETION",
    matchingReadinessMissing: ["city", "district"]
  });
  assert.equal(badge.label, "تحتاج استكمال");
  assert.equal(badge.cssClass, "is-incomplete");
  assert.ok(badge.detailLine.includes("المدينة"));
  assert.ok(badge.detailLine.includes("الحي"));
});

test("buildClosingReadinessBadge uses score fallback", () => {
  const badge = buildClosingReadinessBadge({ closingReadinessScore: 90 });
  assert.equal(badge.label, "عالية جدًا");
  assert.equal(badge.cssClass, "is-very-high");
  assert.equal(badge.mark, "🟢");
});

test("buildOpsCardBadge picks matching vs closing badge by record type", () => {
  assert.equal(buildOpsCardBadge({ recordType: "opportunity", matchingReadiness: "READY_FOR_MATCHING" }).kind, "matching");
  assert.equal(buildOpsCardBadge({ recordType: "match", closingReadinessScore: 72 }).kind, "closing");
  assert.equal(buildOpsCardBadge({ recordType: "deal" }), null);
});
