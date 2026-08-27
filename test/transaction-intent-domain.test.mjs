import test from "node:test";
import assert from "node:assert/strict";
import {
  TRANSACTION_INTENT,
  extractTransactionIntentFromText,
  resolveTransactionIntentFromRecord,
  areTransactionIntentsCompatible,
  opportunityKindFromTransactionIntent,
  purposeFromTransactionIntent
} from "../public/js/transaction-intent-domain.js";
import { evaluateMatchingReadiness, isEligibleForMatchingRun } from "../public/js/opportunity-readiness-domain.js";
import { counterpartsEligible } from "../worker/src/matching-engine.js";

const baseReady = {
  propertyType: "شقة",
  city: "المدينة المنورة",
  district: "الرانوناء",
  advertiserRole: "OWNER",
  advertiserPhoneNormalized: "+966512345678",
  contactPhone: "+966512345678"
};

test("owner + land + sell => OFFER + SELL", () => {
  const record = {
    ...baseReady,
    opportunityKind: "OFFER",
    transactionIntent: TRANSACTION_INTENT.SELL,
    propertyType: "أرض سكنية",
    salePrice: 500000,
    priceOrBudget: 500000,
    advertiserRole: "OWNER"
  };
  assert.equal(opportunityKindFromTransactionIntent(record.transactionIntent), "OFFER");
  assert.equal(purposeFromTransactionIntent(record.transactionIntent), "SALE");
  const readiness = evaluateMatchingReadiness(record);
  assert.equal(readiness.isReadyForMatching, true);
});

test("owner + apartment + rent => OFFER + RENT_OUT", () => {
  const record = {
    ...baseReady,
    opportunityKind: "OFFER",
    transactionIntent: TRANSACTION_INTENT.RENT_OUT,
    propertyType: "شقة",
    annualRent: 45000,
    priceOrBudget: 45000,
    advertiserRole: "OWNER"
  };
  assert.equal(opportunityKindFromTransactionIntent(record.transactionIntent), "OFFER");
  assert.equal(purposeFromTransactionIntent(record.transactionIntent), "RENT");
  assert.equal(evaluateMatchingReadiness(record).isReadyForMatching, true);
});

test("client + land + buy => REQUEST + BUY", () => {
  const record = {
    ...baseReady,
    opportunityKind: "REQUEST",
    transactionIntent: TRANSACTION_INTENT.BUY,
    propertyType: "أرض سكنية",
    budget: 580000,
    priceOrBudget: 580000,
    advertiserRole: "CLIENT"
  };
  assert.equal(opportunityKindFromTransactionIntent(record.transactionIntent), "REQUEST");
  assert.equal(purposeFromTransactionIntent(record.transactionIntent), "PURCHASE");
  assert.equal(evaluateMatchingReadiness(record).isReadyForMatching, true);
});

test("client + apartment + rent-in => REQUEST + RENT_IN", () => {
  const record = {
    ...baseReady,
    opportunityKind: "REQUEST",
    transactionIntent: TRANSACTION_INTENT.RENT_IN,
    propertyType: "شقة",
    budget: 40000,
    priceOrBudget: 40000,
    advertiserRole: "CLIENT"
  };
  assert.equal(opportunityKindFromTransactionIntent(record.transactionIntent), "REQUEST");
  assert.equal(purposeFromTransactionIntent(record.transactionIntent), "LEASE_REQUEST");
  assert.equal(evaluateMatchingReadiness(record).isReadyForMatching, true);
});

test("without transaction intent => incomplete and no matching", () => {
  const record = {
    ...baseReady,
    opportunityKind: "OFFER",
    propertyType: "شقة",
    salePrice: 900000,
    priceOrBudget: 900000
  };
  const readiness = evaluateMatchingReadiness(record);
  assert.ok(readiness.matchingReadinessMissing.includes("transactionIntent"));
  assert.equal(isEligibleForMatchingRun(record), false);

  const offer = { ...record, id: "o1", opportunityKind: "OFFER", lifecycleStatus: "ACTIVE" };
  const request = {
    ...baseReady,
    id: "r1",
    opportunityKind: "REQUEST",
    transactionIntent: TRANSACTION_INTENT.BUY,
    budget: 900000,
    priceOrBudget: 900000,
    advertiserRole: "CLIENT",
    lifecycleStatus: "ACTIVE"
  };
  assert.equal(counterpartsEligible(offer, request), false);
});

test("matching pairs SELL with BUY and RENT_OUT with RENT_IN only", () => {
  const sellOffer = {
    opportunityKind: "OFFER",
    transactionIntent: TRANSACTION_INTENT.SELL,
    lifecycleStatus: "ACTIVE"
  };
  const buyRequest = {
    opportunityKind: "REQUEST",
    transactionIntent: TRANSACTION_INTENT.BUY,
    lifecycleStatus: "ACTIVE"
  };
  const rentOut = {
    opportunityKind: "OFFER",
    transactionIntent: TRANSACTION_INTENT.RENT_OUT,
    lifecycleStatus: "ACTIVE"
  };
  const rentIn = {
    opportunityKind: "REQUEST",
    transactionIntent: TRANSACTION_INTENT.RENT_IN,
    lifecycleStatus: "ACTIVE"
  };
  assert.equal(areTransactionIntentsCompatible(TRANSACTION_INTENT.SELL, TRANSACTION_INTENT.BUY), true);
  assert.equal(areTransactionIntentsCompatible(TRANSACTION_INTENT.RENT_OUT, TRANSACTION_INTENT.RENT_IN), true);
  assert.equal(areTransactionIntentsCompatible(TRANSACTION_INTENT.SELL, TRANSACTION_INTENT.RENT_IN), false);
  assert.equal(counterpartsEligible(sellOffer, buyRequest), true);
  assert.equal(counterpartsEligible(rentOut, rentIn), true);
  assert.equal(counterpartsEligible(sellOffer, rentIn), false);
});

test("extractTransactionIntentFromText only on explicit phrases", () => {
  assert.equal(extractTransactionIntentFromText("عقار للبيع في حي النخيل"), TRANSACTION_INTENT.SELL);
  assert.equal(extractTransactionIntentFromText("أبحث عن شراء شقة"), TRANSACTION_INTENT.BUY);
  assert.equal(extractTransactionIntentFromText("شقة ٣ غرف حي السلام"), null);
});

test("legacy explicit OFFER+SALE resolves to SELL without guessing", () => {
  assert.equal(resolveTransactionIntentFromRecord({ opportunityKind: "OFFER", purpose: "SALE" }), TRANSACTION_INTENT.SELL);
  assert.equal(resolveTransactionIntentFromRecord({ opportunityKind: "OFFER", contactType: "owner" }), null);
});
