import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAdvertiserDataPatch } from "../public/js/advertiser-phone-domain.js";
import { mergeIncompleteFormPreview } from "../public/js/opportunity-workspace-domain.js";
import { evaluateMatchingReadiness } from "../public/js/opportunity-readiness-domain.js";
import { buildListingFieldChecks } from "../public/js/opportunity-listing-card-ui.js";

function simulateIncompleteSavePatch(existing, formData) {
  const advResult = buildAdvertiserDataPatch(existing, formData);
  assert.equal(advResult.ok, true);
  const mergedPreview = mergeIncompleteFormPreview(existing, formData);
  const readinessCheck = evaluateMatchingReadiness(mergedPreview);
  return {
    patch: {
      ...advResult.patch,
      matchingReadiness: readinessCheck.matchingReadiness,
      matchingReadinessMissing: readinessCheck.matchingReadinessMissing || []
    },
    mergedPreview,
    readinessCheck
  };
}

function simulateServerMerge(existing, patch) {
  const merged = { ...existing, ...patch };
  const readiness = evaluateMatchingReadiness(merged);
  return {
    ...merged,
    matchingReadiness: readiness.matchingReadiness,
    matchingReadinessMissing: readiness.matchingReadinessMissing || []
  };
}

test("Arabic advertiser role save path reaches READY_FOR_MATCHING on server merge", () => {
  const existing = {
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "الرياض",
    district: "الوبرة",
    price: 1500000,
    advertiserPhoneNormalized: "+966512345678",
    advertiserRole: "UNKNOWN"
  };
  const before = evaluateMatchingReadiness(existing);
  assert.ok(before.matchingReadinessMissing.includes("advertiserRole"));

  const { patch, readinessCheck } = simulateIncompleteSavePatch(existing, { advertiserRole: "مالك" });
  assert.equal(patch.advertiserRole, "OWNER");
  assert.equal(readinessCheck.isReadyForMatching, true);

  const persisted = simulateServerMerge(existing, patch);
  const after = evaluateMatchingReadiness(persisted);
  assert.equal(after.isReadyForMatching, true);
  assert.deepEqual(after.matchingReadinessMissing, []);

  const checks = buildListingFieldChecks(persisted);
  assert.equal(checks.filter((row) => row.complete).length, 7);
});

test("invalid advertiser role text does not clear missing field", () => {
  const existing = {
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "الرياض",
    district: "الوبرة",
    price: 1500000,
    advertiserPhoneNormalized: "+966512345678",
    advertiserRole: "UNKNOWN"
  };
  const { patch } = simulateIncompleteSavePatch(existing, { advertiserRole: "شخص عادي" });
  assert.equal(patch.advertiserRole, "UNKNOWN");
  const persisted = simulateServerMerge(existing, patch);
  const after = evaluateMatchingReadiness(persisted);
  assert.ok(after.matchingReadinessMissing.includes("advertiserRole"));
});
