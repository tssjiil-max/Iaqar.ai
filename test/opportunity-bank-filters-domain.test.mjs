import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesBankQueryFilters,
  collectBankFilterOptions,
  emptyBankFilters
} from "../public/js/opportunity-bank-filters-domain.js";
import { MATCHING_READINESS } from "../public/js/opportunity-readiness-domain.js";

const sample = {
  propertyType: "شقة",
  city: "الرياض",
  district: "النرجس",
  purpose: "SALE",
  matchingReadiness: MATCHING_READINESS.READY_FOR_MATCHING
};

test("search filter matches property type text", () => {
  assert.equal(matchesBankQueryFilters(sample, { search: "شقة" }), true);
  assert.equal(matchesBankQueryFilters(sample, { search: "فيلا" }), false);
});

test("combined filters require all criteria", () => {
  assert.equal(matchesBankQueryFilters(sample, {
    city: "الرياض",
    purpose: "SALE",
    matchingReadiness: MATCHING_READINESS.READY_FOR_MATCHING
  }), true);
  assert.equal(matchesBankQueryFilters(sample, { city: "جدة" }), false);
});

test("collectBankFilterOptions returns sorted unique values", () => {
  const options = collectBankFilterOptions([
    sample,
    { city: "جدة", district: "الروضة", propertyType: "فيلا" }
  ]);
  assert.deepEqual(options.cities, ["الرياض", "جدة"]);
  assert.ok(options.propertyTypes.includes("شقة"));
  assert.deepEqual(emptyBankFilters().search, "");
});
