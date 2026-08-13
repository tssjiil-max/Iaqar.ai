import test from "node:test";
import assert from "node:assert/strict";
import { districtsMatch, isVerifiedNearbyDistrict, VERIFIED_DISTRICT_ADJACENCY } from "../src/district-proximity.js";
import {
  MATCH_TYPE, classifyDistrictMatch, scoreOfficeForAssignment, selectOfficeForAssignment
} from "../src/cross-office-matching.js";

test("districtsMatch normalizes Arabic district names", () => {
  assert.equal(districtsMatch("العقيق", "العقيق"), true);
  assert.equal(districtsMatch("حي العقيق", "العقيق"), false);
});

test("nearby matching is disabled without verified adjacency data", () => {
  assert.equal(Object.keys(VERIFIED_DISTRICT_ADJACENCY).length, 0);
  assert.equal(isVerifiedNearbyDistrict("عروة", "قباء"), false);
  assert.equal(classifyDistrictMatch("عروة", "قباء"), null);
});

test("exact neighborhood cooperation classification works", () => {
  const result = classifyDistrictMatch("العقيق", "العقيق");
  assert.equal(result.matchType, MATCH_TYPE.EXACT_NEIGHBORHOOD);
  assert.equal(result.isNearbyMatch, false);
});

test("platform assignment uses deterministic fair ordering on tied scores", () => {
  const parsed = { district: "العقيق", propertyType: "فيلا", transactionType: "sale", city: "المدينة المنورة" };
  const inventory = { exactDistrictListings: 2, nearbyDistrictListings: 0, matchingPropertyListings: 2 };
  const officeMeta = { city: "المدينة المنورة", specialties: ["sale"], platformAssignmentCount: 0 };
  const candidates = [
    scoreOfficeForAssignment({ officeId: "office-b", officeMeta, inventory, parsed, proximityTier: "exact" }),
    scoreOfficeForAssignment({ officeId: "office-a", officeMeta, inventory, parsed, proximityTier: "exact" })
  ];
  assert.equal(candidates[0].score, candidates[1].score);
  const selected = selectOfficeForAssignment(candidates);
  assert.equal(selected.officeId, "office-a");
});

test("platform assignment prefers higher inventory score", () => {
  const parsed = { district: "العقيق", propertyType: "فيلا", transactionType: "sale" };
  const selected = selectOfficeForAssignment([
    scoreOfficeForAssignment({
      officeId: "office-low", officeMeta: { platformAssignmentCount: 0 },
      inventory: { exactDistrictListings: 0, nearbyDistrictListings: 0, matchingPropertyListings: 0 },
      parsed, proximityTier: "exact"
    }),
    scoreOfficeForAssignment({
      officeId: "office-high", officeMeta: { platformAssignmentCount: 0 },
      inventory: { exactDistrictListings: 3, nearbyDistrictListings: 0, matchingPropertyListings: 3 },
      parsed, proximityTier: "exact"
    })
  ]);
  assert.equal(selected.officeId, "office-high");
});
