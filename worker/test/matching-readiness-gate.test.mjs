import test from "node:test";
import assert from "node:assert/strict";

import { counterpartsEligible } from "../src/matching-engine.js";

const request = {
  opportunityKind: "REQUEST",
  purpose: "PURCHASE",
  propertyType: "شقة",
  city: "المدينة المنورة",
  district: "العريض",
  priceOrBudget: 650000,
  advertiserRole: "CLIENT",
  contactPhone: "+966500000001",
  lifecycleStatus: "ACTIVE",
  matchingReadiness: "READY_FOR_MATCHING"
};

const offer = {
  opportunityKind: "OFFER",
  purpose: "SALE",
  propertyType: "شقة",
  city: "المدينة المنورة",
  district: "العريض",
  priceOrBudget: 640000,
  advertiserRole: "OWNER",
  contactPhone: "+966500000002",
  lifecycleStatus: "ACTIVE",
  matchingReadiness: "READY_FOR_MATCHING"
};

test("canonical matching admits only complete opposite-side opportunities", () => {
  assert.equal(counterpartsEligible(request, offer), true);
});

test("canonical matching rejects an incomplete source before scoring", () => {
  assert.equal(counterpartsEligible({ ...request, district: "" }, offer), false);
});

test("canonical matching rejects an incomplete candidate before scoring", () => {
  assert.equal(counterpartsEligible(request, { ...offer, contactPhone: "" }), false);
});

test("canonical matching rejects same-side pairs even when both are complete", () => {
  assert.equal(counterpartsEligible(request, { ...request, contactPhone: "+966500000003" }), false);
});

test("legacy client/owner eligibility remains isolated during migration", () => {
  const legacyRequest = {
    sourceCollection: "clients",
    status: "active",
    transactionType: "sale"
  };
  const legacyOffer = {
    sourceCollection: "owners",
    status: "active",
    transactionType: "sale"
  };
  assert.equal(counterpartsEligible(legacyRequest, legacyOffer), true);
});
