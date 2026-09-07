import test from "node:test";
import assert from "node:assert/strict";

import {
  MATCHING_ADMISSION_STATUS,
  canonicalOpportunityMissingFields,
  evaluateMatchingAdmission,
  normalizeCanonicalContactPhone
} from "../worker/src/matching-admission-domain.js";
import { counterpartsEligible } from "../worker/src/matching-engine.js";
import { listMissingOpportunityFields } from "../worker/src/operations-service.js";

function offer(overrides = {}) {
  return {
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العزيزية",
    priceOrBudget: 500000,
    advertiserRole: "OWNER",
    contactPhone: "0551234567",
    lifecycleStatus: "ACTIVE",
    originatingOfficeId: "office-a",
    ...overrides
  };
}

function request(overrides = {}) {
  return {
    opportunityKind: "REQUEST",
    purpose: "PURCHASE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العزيزية",
    priceOrBudget: 520000,
    advertiserRole: "CLIENT",
    contactPhone: "+966551234568",
    lifecycleStatus: "ACTIVE",
    originatingOfficeId: "office-a",
    ...overrides
  };
}

test("complete canonical opportunities are admitted and may reach matching", () => {
  const source = request();
  const candidate = offer();
  const admission = evaluateMatchingAdmission(source);
  assert.equal(admission.status, MATCHING_ADMISSION_STATUS.ADMITTED);
  assert.equal(admission.isReadyForMatching, true);
  assert.deepEqual(admission.missingFields, []);
  assert.equal(counterpartsEligible(source, candidate), true);
});

test("missing advertiser phone blocks matching and is authoritative MISSING_DATA", () => {
  const source = request({ contactPhone: "", advertiserPhoneNormalized: "" });
  assert.deepEqual(canonicalOpportunityMissingFields(source), ["contactPhone"]);
  assert.equal(evaluateMatchingAdmission(source).isReadyForMatching, false);
  assert.equal(counterpartsEligible(source, offer()), false);
  assert.deepEqual(listMissingOpportunityFields(source), ["contactPhone"]);
});

test("missing advertiser role blocks matching and aligns Operations missing-data gate", () => {
  const source = request({ advertiserRole: "UNKNOWN" });
  assert.equal(evaluateMatchingAdmission(source).isReadyForMatching, false);
  assert.equal(counterpartsEligible(source, offer()), false);
  assert.deepEqual(listMissingOpportunityFields(source), ["advertiserRole"]);
});

test("invalid purpose or structural kind cannot enter matching", () => {
  const source = request({ opportunityKind: "", purpose: "" });
  const missing = canonicalOpportunityMissingFields(source);
  assert.ok(missing.includes("opportunityKind"));
  assert.ok(missing.includes("purpose"));
  assert.equal(counterpartsEligible(source, offer()), false);
});

test("Saudi mobile aliases normalize consistently", () => {
  assert.equal(normalizeCanonicalContactPhone("0551234567"), "+966551234567");
  assert.equal(normalizeCanonicalContactPhone("551234567"), "+966551234567");
  assert.equal(normalizeCanonicalContactPhone("966551234567"), "+966551234567");
  assert.equal(normalizeCanonicalContactPhone("00966551234567"), "+966551234567");
  assert.equal(normalizeCanonicalContactPhone("123"), "");
});

test("legacy non-canonical records keep legacy matching behavior during migration", () => {
  const legacyRequest = {
    sourceCollection: "clients",
    transactionType: "sale",
    city: "المدينة المنورة",
    district: "العزيزية",
    propertyType: "شقة",
    price: 500000,
    status: "active"
  };
  const legacyOffer = {
    sourceCollection: "owners",
    transactionType: "sale",
    city: "المدينة المنورة",
    district: "العزيزية",
    propertyType: "شقة",
    price: 510000,
    status: "active"
  };
  assert.equal(evaluateMatchingAdmission(legacyRequest).status, MATCHING_ADMISSION_STATUS.LEGACY_UNGATED);
  assert.equal(counterpartsEligible(legacyRequest, legacyOffer), true);
});
