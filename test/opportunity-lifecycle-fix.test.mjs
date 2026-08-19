/**
 * Opportunity lifecycle — incomplete bank card → review → same ID update.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEditPatch,
  buildReviewCompletionPatch,
  recordToReviewFields,
  readinessMissingToNeedsReview
} from "../public/js/opportunity-bank-domain.js";
import {
  evaluateMatchingReadiness,
  MATCHING_READINESS
} from "../public/js/opportunity-readiness-domain.js";
import {
  buildReviewDefaults,
  reviewTransactionMode,
  reviewValuesToBrokerFields
} from "../public/js/reference-catalog.js";

const leaseRequestIncomplete = {
  id: "opp_lease_1",
  officeId: "office-a",
  originatingOfficeId: "office-a",
  opportunityKind: "REQUEST",
  purpose: "LEASE_REQUEST",
  propertyType: "شقة",
  city: "المدينة المنورة",
  district: "عروة",
  area: 120,
  rooms: 3,
  version: 1,
  createdAt: "2026-08-01T10:00:00.000Z"
};

test("LEASE_REQUEST review mode uses budget not annualRent", () => {
  const mode = reviewTransactionMode("rent", {
    purpose: "LEASE_REQUEST",
    opportunityKind: "REQUEST"
  });
  assert.equal(mode, "budget");
});

test("recordToReviewFields preserves existing lease-request location data", () => {
  const fields = recordToReviewFields(leaseRequestIncomplete);
  assert.equal(fields.city, "المدينة المنورة");
  assert.equal(fields.district, "عروة");
  assert.equal(fields.propertyType, "شقة");
  assert.equal(fields.purpose, "LEASE_REQUEST");
  assert.equal(fields.opportunityKind, "REQUEST");
});

test("readinessMissingToNeedsReview maps budget gap for LEASE_REQUEST", () => {
  const readiness = evaluateMatchingReadiness(leaseRequestIncomplete);
  assert.equal(readiness.matchingReadiness, MATCHING_READINESS.NEEDS_COMPLETION);
  assert.ok(readiness.matchingReadinessMissing.includes("priceOrBudget"));
  const needs = readinessMissingToNeedsReview(readiness.matchingReadinessMissing, leaseRequestIncomplete);
  assert.equal(needs.budget, true);
  assert.notEqual(needs.annualRent, true);
});

test("buildReviewDefaults shows budget field context for incomplete lease request", () => {
  const fields = recordToReviewFields(leaseRequestIncomplete);
  const needs = readinessMissingToNeedsReview(
    evaluateMatchingReadiness(leaseRequestIncomplete).matchingReadinessMissing,
    leaseRequestIncomplete
  );
  const defaults = buildReviewDefaults(fields, "", { extended: fields.extended, needsReview: needs });
  const mode = reviewTransactionMode(defaults.operationTypeId, {
    purpose: "LEASE_REQUEST",
    opportunityKind: "REQUEST"
  });
  assert.equal(mode, "budget");
  assert.equal(defaults.cityId, "madinah");
});

test("buildEditPatch maps priceOrBudget to budget for LEASE_REQUEST", () => {
  const result = buildEditPatch(
    leaseRequestIncomplete,
    { priceOrBudget: 45000 },
    { actorUid: "broker-a" }
  );
  assert.equal(result.ok, true);
  assert.equal(result.patch.budget, 45000);
  assert.equal(result.patch.priceOrBudget, 45000);
});

test("buildReviewCompletionPatch updates same opportunity without ownership mutation", () => {
  const brokerExtras = {
    opportunityKind: "REQUEST",
    purpose: "LEASE_REQUEST",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "عروة",
    budget: 45000,
    priceOrBudget: 45000,
    area: 120,
    rooms: 3,
    bathrooms: 2,
    salePrice: null,
    annualRent: null,
    floorNumber: null
  };
  const result = buildReviewCompletionPatch(leaseRequestIncomplete, brokerExtras, { actorUid: "broker-a" });
  assert.equal(result.ok, true);
  assert.equal(result.patch.budget, 45000);
  assert.equal(result.patch.city, "المدينة المنورة");
  assert.equal(result.patch.district, "عروة");
  assert.notEqual(result.patch.id, "new-id");
  assert.equal(result.patch.officeId, undefined);
});

test("reviewValuesToBrokerFields writes budget for LEASE_REQUEST not annualRent", () => {
  const review = {
    operationTypeId: "rent",
    propertyTypeId: "apartment",
    cityId: "madinah",
    districtId: "madinah-009",
    budget: "45000",
    salePrice: "",
    annualRent: "",
    area: "120",
    rooms: "3",
    extractedSnapshot: {
      opportunityKind: "REQUEST",
      purpose: "LEASE_REQUEST"
    }
  };
  const broker = reviewValuesToBrokerFields(review);
  assert.equal(broker.purpose, "LEASE_REQUEST");
  assert.equal(broker.budget, 45000);
  assert.equal(broker.annualRent, null);
  assert.equal(broker.priceOrBudget, 45000);
});

test("LAND does not require rooms in review broker fields", () => {
  const review = {
    operationTypeId: "sale",
    propertyTypeId: "land",
    cityId: "madinah",
    districtId: "madinah-009",
    salePrice: "800000",
    area: "500",
    rooms: "",
    bathrooms: "",
    floorNumber: "",
    extractedSnapshot: { opportunityKind: "OFFER", purpose: "SALE" }
  };
  const broker = reviewValuesToBrokerFields(review);
  assert.equal(broker.rooms, null);
  assert.equal(broker.bathrooms, null);
  assert.equal(broker.floorNumber, null);
});

test("readiness recalculates to READY after budget and advertiser filled", () => {
  const patch = buildReviewCompletionPatch(
    leaseRequestIncomplete,
    {
      opportunityKind: "REQUEST",
      purpose: "LEASE_REQUEST",
      propertyType: "شقة",
      city: "المدينة المنورة",
      district: "عروة",
      budget: 45000,
      priceOrBudget: 45000,
      area: 120,
      rooms: 3
    },
    { actorUid: "broker-a" }
  ).patch;
  const after = evaluateMatchingReadiness({
    ...leaseRequestIncomplete,
    ...patch,
    advertiserRole: "CLIENT",
    advertiserPhoneNormalized: "+966512345678"
  });
  assert.equal(after.matchingReadiness, MATCHING_READINESS.READY_FOR_MATCHING);
  assert.equal(after.isReadyForMatching, true);
});
