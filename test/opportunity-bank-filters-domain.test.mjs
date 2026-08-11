import test from "node:test";
import assert from "node:assert/strict";
import {
  matchesBankQueryFilters,
  collectBankFilterOptions,
  emptyBankFilters,
  hasActiveBankQuery,
  summarizeBankCounts,
  emptyBankSummary
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

test("hasActiveBankQuery is false for empty filters", () => {
  assert.equal(hasActiveBankQuery(emptyBankFilters()), false);
  assert.equal(hasActiveBankQuery({ search: "نرجس" }), true);
  assert.equal(hasActiveBankQuery({ city: "الرياض" }), true);
});

test("summarizeBankCounts uses readiness and archived lifecycle", () => {
  const summary = summarizeBankCounts([
    sample,
    { matchingReadiness: MATCHING_READINESS.NEEDS_COMPLETION },
    { lifecycleStatus: "ARCHIVED" },
    { deletedAt: "2026-01-01", matchingReadiness: MATCHING_READINESS.READY_FOR_MATCHING }
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.readyForMatching, 1);
  assert.equal(summary.needsCompletion, 1);
  assert.equal(summary.archived, 1);
  assert.deepEqual(emptyBankSummary().total, 0);
});
