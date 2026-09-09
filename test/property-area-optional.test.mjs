import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOpportunityRecord,
  computeDataCompleteness,
  listMissingFields
} from "../public/js/opportunity-intake-domain.js";
import { evaluateOpportunityCoreReadiness } from "../public/js/opportunity-readiness-domain.js";
import { resolveImportPrimaryInfoFields } from "../public/js/import-advert-review-domain.js";
import {
  MATCH_THRESHOLD,
  counterpartsEligible,
  opportunityToMatchInput,
  scoreMatch
} from "../worker/src/matching-engine.js";

const base = {
  propertyType: "شقة",
  city: "المدينة المنورة",
  district: "عروة",
  advertiserRole: "CLIENT",
  contactPhone: "0552019909"
};

const completeWithoutArea = (opportunityKind) => ({
  ...base,
  opportunityKind,
  purpose: opportunityKind === "OFFER" ? "SALE" : "PURCHASE",
  advertiserRole: opportunityKind === "OFFER" ? "OWNER" : "CLIENT",
  contactPhone: opportunityKind === "OFFER" ? "0558882961" : "0552019909",
  priceOrBudget: 500000,
  [opportunityKind === "OFFER" ? "salePrice" : "budget"]: 500000
});

test("CASE 1: complete owner offer without area stays complete", () => {
  const offer = completeWithoutArea("OFFER");
  assert.equal(computeDataCompleteness(offer).isComplete, true);
  assert.equal(evaluateOpportunityCoreReadiness(offer).isComplete, true);
  assert.equal(listMissingFields(offer).includes("area"), false);
});

test("CASE 2: complete client request without area stays complete", () => {
  const request = completeWithoutArea("REQUEST");
  assert.equal(computeDataCompleteness(request).isComplete, true);
  assert.equal(evaluateOpportunityCoreReadiness(request).isComplete, true);
  assert.equal(listMissingFields(request).includes("area"), false);
});

test("CASE 3: supplied area remains stored and readable", () => {
  const fields = { ...completeWithoutArea("OFFER"), area: 275 };
  const record = buildOpportunityRecord({
    officeId: "office-test", brokerId: "broker-test", sourceType: "text",
    sourceReference: "case-3", fields, extraction: {}, deduplicationFingerprint: "area-case-3"
  });
  assert.equal(record.area, 275);
  assert.equal(opportunityToMatchInput(record).area, 275);
});

test("CASE 4: compatible offer and request match when area is absent", () => {
  const offer = { ...completeWithoutArea("OFFER"), id: "offer-no-area", lifecycleStatus: "ACTIVE", dataCompleteness: 100 };
  const request = { ...completeWithoutArea("REQUEST"), id: "request-no-area", lifecycleStatus: "ACTIVE", dataCompleteness: 100 };
  assert.equal(counterpartsEligible(offer, request), true);
  const result = scoreMatch(opportunityToMatchInput(offer), opportunityToMatchInput(request));
  assert.equal(result.eligible, true);
  assert.ok(result.score >= MATCH_THRESHOLD);
});

test("area remains available but optional in imported land review", () => {
  const area = resolveImportPrimaryInfoFields("أرض")[0];
  assert.equal(area.name, "area");
  assert.equal(area.required, false);
  assert.equal(area.optional, true);
});
