import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateMatchingReadiness,
  isEligibleForMatchingRun,
  MATCHING_READINESS
} from "../public/js/opportunity-readiness-domain.js";

test("READY_FOR_MATCHING when all gate fields present including transactionIntent", () => {
  const result = evaluateMatchingReadiness({
    transactionIntent: "SELL",
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "الرياض",
    district: "النرجس",
    salePrice: 900000,
    priceOrBudget: 900000,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966512345678"
  });
  assert.equal(result.matchingReadiness, MATCHING_READINESS.READY_FOR_MATCHING);
  assert.equal(result.isReadyForMatching, true);
  assert.equal(result.matchingReadinessMissing.length, 0);
});

test("NEEDS_COMPLETION when district missing", () => {
  const result = evaluateMatchingReadiness({
    transactionIntent: "BUY",
    opportunityKind: "REQUEST",
    purpose: "PURCHASE",
    propertyType: "أرض",
    city: "جدة",
    budget: 500000,
    advertiserRole: "CLIENT",
    contactPhone: "+966598765432"
  });
  assert.equal(result.matchingReadiness, MATCHING_READINESS.NEEDS_COMPLETION);
  assert.ok(result.matchingReadinessMissing.includes("district"));
  assert.equal(isEligibleForMatchingRun(result), false);
});
