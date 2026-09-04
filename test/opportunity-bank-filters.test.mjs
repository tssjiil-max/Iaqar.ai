import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyBankFilters,
  hasActiveBankQuery,
  matchesBankQueryFilters
} from "../public/js/opportunity-bank-filters-domain.js";
import { MATCHING_READINESS } from "../public/js/opportunity-readiness-domain.js";

test("emptyBankFilters defaults to all active items", () => {
  assert.equal(emptyBankFilters().summaryKey, "total");
  assert.equal(hasActiveBankQuery(emptyBankFilters()), false);
});

test("matchesBankQueryFilters keeps incomplete rows out of the completed bank", () => {
  const filters = emptyBankFilters();
  const incomplete = { propertyType: "شقة", lifecycleStatus: "ACTIVE" };
  const ready = {
    propertyType: "شقة",
    purpose: "PURCHASE",
    city: "المدينة المنورة",
    district: "الرانوناء",
    budget: 500000,
    advertiserRole: "OWNER",
    contactPhone: "+966512345678",
    lifecycleStatus: "ACTIVE"
  };
  assert.equal(matchesBankQueryFilters(incomplete, filters), false);
  assert.equal(matchesBankQueryFilters(ready, filters), true);
});

test("search keeps incomplete rows in Daily Tasks instead of the bank", () => {
  const filters = { ...emptyBankFilters(), search: "الرانوناء" };
  const incomplete = {
    propertyType: "شقة",
    district: "الرانوناء",
    lifecycleStatus: "ACTIVE"
  };
  assert.equal(hasActiveBankQuery(filters), true);
  assert.equal(matchesBankQueryFilters(incomplete, filters), false);
});

test("archived summary key is treated as an active bank query", () => {
  const filters = { ...emptyBankFilters(), summaryKey: "archived" };
  assert.equal(hasActiveBankQuery(filters), true);
  const archived = { lifecycleStatus: "ARCHIVED", archivedAt: "2026-01-01" };
  assert.equal(matchesBankQueryFilters(archived, filters), true);
});
