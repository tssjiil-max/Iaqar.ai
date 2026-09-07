import test from "node:test";
import assert from "node:assert/strict";

import {
  COMPLETION_SESSION_STATUS,
  buildCompletionSessionProjection,
  completionRequiredFields,
  evaluateCompletionSubmission,
  isCompletionSessionTerminal,
  sanitizeCompletionPatch
} from "../public/js/data-completion-domain.js";
import { evaluateOpportunityCoreReadiness } from "../public/js/opportunity-readiness-domain.js";

const base = {
  opportunityKind: "REQUEST",
  purpose: "PURCHASE",
  propertyType: "شقة",
  city: "المدينة المنورة",
  district: "العريض",
  priceOrBudget: 650000
};

test("core readiness does not call a record complete when advertiser identity is missing", () => {
  const readiness = evaluateOpportunityCoreReadiness(base);
  assert.equal(readiness.isComplete, false);
  assert.deepEqual(readiness.completionMissingFields, ["advertiserRole", "contactPhone"]);
  assert.equal(readiness.dataCompleteness, 75);
});

test("completion projection exposes only safe summary and missing fields", () => {
  const view = buildCompletionSessionProjection(base);
  assert.equal(view.propertyType, "شقة");
  assert.equal(view.district, "العريض");
  assert.deepEqual(view.missingFields, ["advertiserRole", "contactPhone"]);
  assert.equal("officeId" in view, false);
  assert.equal("matchId" in view, false);
});

test("completion patch cannot alter protected or non-requested fields", () => {
  const patch = sanitizeCompletionPatch({
    officeId: "other-office",
    opportunityId: "other-opportunity",
    lifecycleStatus: "CLOSED",
    district: "قباء",
    advertiserRole: "CLIENT",
    contactPhone: "+966500000001"
  }, ["advertiserRole", "contactPhone"]);

  assert.deepEqual(patch, {
    advertiserRole: "CLIENT",
    contactPhone: "+966500000001"
  });
});

test("completion submission becomes matching-ready only after all requested core fields are valid", () => {
  const result = evaluateCompletionSubmission(base, {
    advertiserRole: "CLIENT",
    contactPhone: "+966500000001"
  }, completionRequiredFields(base));

  assert.equal(result.isComplete, true);
  assert.equal(result.isReadyForMatching, true);
  assert.deepEqual(result.missingFields, []);
});

test("completion session terminal states are explicit", () => {
  assert.equal(isCompletionSessionTerminal(COMPLETION_SESSION_STATUS.OPEN), false);
  assert.equal(isCompletionSessionTerminal(COMPLETION_SESSION_STATUS.COMPLETED), true);
  assert.equal(isCompletionSessionTerminal(COMPLETION_SESSION_STATUS.EXPIRED), true);
  assert.equal(isCompletionSessionTerminal(COMPLETION_SESSION_STATUS.REVOKED), true);
});
