/**
 * Regression tests for mixed-case production office IDs.
 * Real Firestore document: office_NlkMiaEugGVzDCc8d8jKNcrAFbI2
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  firestoreOfficeId,
  officeAuthorizationKey,
  officeIdsEquivalent
} from "../public/js/office-id-domain.js";
import {
  evaluatePilotOfficeAccess,
  normalizePilotAccessConfig,
  PILOT_ACCESS_DENIED
} from "../public/js/pilot-access-domain.js";
import {
  counterpartsEligible,
  opportunityToMatchInput,
  scoreMatch
} from "../worker/src/matching-engine.js";
import {
  mapOperationsItemsToDailyTasks
} from "../src/v2/content/daily-tasks/domain.js";

const PRODUCTION_OFFICE = "office_NlkMiaEugGVzDCc8d8jKNcrAFbI2";
const UNAUTHORIZED_OFFICE = "office_vWk9ToQENLRHOwJ0CejtuU3ut2K3";

test("A: mixed-case office ID preserves exact Firestore document ID", () => {
  const input = `  ${PRODUCTION_OFFICE}  `;
  assert.equal(firestoreOfficeId(input), PRODUCTION_OFFICE);
  assert.notEqual(firestoreOfficeId(input), PRODUCTION_OFFICE.toLowerCase());
});

test("B: pilot allowlist authorizes via normalized key without mutating Firestore lookup ID", () => {
  const cfg = normalizePilotAccessConfig({
    enabled: true,
    maxOffices: 5,
    authorizedOfficeIds: [PRODUCTION_OFFICE]
  });
  const decision = evaluatePilotOfficeAccess(cfg, PRODUCTION_OFFICE);
  assert.equal(decision.allowed, true);
  assert.equal(decision.code, "PILOT_AUTHORIZED");
  assert.equal(decision.officeId, PRODUCTION_OFFICE);
  assert.equal(decision.officeAuthorizationKey, officeAuthorizationKey(PRODUCTION_OFFICE));
  assert.equal(cfg.authorizedOfficeIds[0], officeAuthorizationKey(PRODUCTION_OFFICE));
});

test("C: unauthorized office remains denied", () => {
  const cfg = normalizePilotAccessConfig({
    enabled: true,
    maxOffices: 5,
    authorizedOfficeIds: [PRODUCTION_OFFICE]
  });
  const decision = evaluatePilotOfficeAccess(cfg, UNAUTHORIZED_OFFICE);
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, PILOT_ACCESS_DENIED);
});

test("D: SALE offer never matches RENT request", () => {
  const offer = {
    id: "opp_sale",
    opportunityKind: "OFFER",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "العزيزية",
    propertyType: "شقة",
    salePrice: 500000,
    lifecycleStatus: "ACTIVE",
    dataCompleteness: 100,
    version: 1
  };
  const request = {
    id: "opp_rent",
    opportunityKind: "REQUEST",
    purpose: "LEASE_REQUEST",
    city: "المدينة المنورة",
    district: "العزيزية",
    propertyType: "شقة",
    budget: 50000,
    lifecycleStatus: "ACTIVE",
    dataCompleteness: 100,
    version: 1
  };
  assert.equal(counterpartsEligible(offer, request), false);
  const scored = scoreMatch(
    opportunityToMatchInput(offer, { id: offer.id }),
    opportunityToMatchInput(request, { id: request.id })
  );
  assert.equal(scored.eligible, false);
});

test("E: valid RENT offer/request creates exactly one canonical match task source", () => {
  const requestId = "opp_case_req";
  const offerId = "opp_case_offer";
  const matchId = "mat_case_1";
  const matchItem = {
    recordType: "match",
    id: matchId,
    matchId,
    requestId,
    offerId,
    integrityStatus: "VALID",
    propertyType: "شقة",
    purpose: "RENT",
    district: "العزيزية",
    city: "المدينة المنورة",
    budget: 55000,
    candidatePropertyType: "شقة",
    candidatePurpose: "RENT",
    candidateDistrict: "العزيزية",
    candidateCity: "المدينة المنورة",
    candidateSalePrice: 50000
  };
  const items = [
    {
      recordType: "opportunity",
      id: `opp-${requestId}`,
      opportunityId: requestId,
      propertyType: "شقة",
      purpose: "LEASE_REQUEST",
      district: "العزيزية",
      city: "المدينة المنورة",
      budget: 55000
    },
    {
      recordType: "opportunity",
      id: `opp-${offerId}`,
      opportunityId: offerId,
      propertyType: "شقة",
      purpose: "RENT",
      district: "العزيزية",
      city: "المدينة المنورة",
      salePrice: 50000
    },
    matchItem
  ];
  const tasks = mapOperationsItemsToDailyTasks(items, new Date(), {
    officeId: PRODUCTION_OFFICE,
    showTestFixtures: true
  });
  const matchTasks = tasks.filter((row) => row.matchId === matchId);
  assert.equal(matchTasks.length, 1);
  assert.equal(matchTasks[0].requestId, requestId);
  assert.equal(matchTasks[0].offerId, offerId);
});

test("F/G: valid match creates one living task and reload preserves matchId and taskId", () => {
  const requestId = "opp_live_task_req";
  const matchId = "mat_live_task";
  const matchItem = {
    recordType: "match",
    id: matchId,
    matchId,
    requestId,
    offerId: "opp_live_task_offer",
    integrityStatus: "VALID",
    propertyType: "شقة",
    purpose: "RENT",
    district: "العزيزية",
    city: "المدينة المنورة",
    budget: 55000,
    candidatePropertyType: "شقة",
    candidatePurpose: "RENT",
    candidateDistrict: "العزيزية",
    candidateCity: "المدينة المنورة",
    candidateSalePrice: 50000
  };
  const first = mapOperationsItemsToDailyTasks([matchItem], new Date(), { officeId: PRODUCTION_OFFICE, showTestFixtures: true });
  const second = mapOperationsItemsToDailyTasks([matchItem], new Date(), { officeId: PRODUCTION_OFFICE, showTestFixtures: true });
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.ok(first[0].id);
  assert.equal(first[0].matchId, matchId);
  assert.equal(first[0].id, second[0].id);
  assert.equal(first[0].matchId, second[0].matchId);
});

test("H: no cross-office access via pilot authorization", () => {
  const cfg = normalizePilotAccessConfig({
    enabled: true,
    maxOffices: 5,
    authorizedOfficeIds: [PRODUCTION_OFFICE]
  });
  const authorized = evaluatePilotOfficeAccess(cfg, PRODUCTION_OFFICE);
  const denied = evaluatePilotOfficeAccess(cfg, UNAUTHORIZED_OFFICE);
  assert.equal(authorized.allowed, true);
  assert.equal(denied.allowed, false);
  assert.equal(officeIdsEquivalent(authorized.officeId, PRODUCTION_OFFICE), true);
  assert.equal(officeIdsEquivalent(denied.officeId, UNAUTHORIZED_OFFICE), true);
  assert.equal(officeIdsEquivalent(authorized.officeId, denied.officeId), false);
});

test("firestoreOfficeId and officeAuthorizationKey are explicitly separated", () => {
  assert.equal(firestoreOfficeId(PRODUCTION_OFFICE), PRODUCTION_OFFICE);
  assert.equal(officeAuthorizationKey(PRODUCTION_OFFICE), PRODUCTION_OFFICE.toLowerCase());
  assert.notEqual(firestoreOfficeId(PRODUCTION_OFFICE), officeAuthorizationKey(PRODUCTION_OFFICE));
});
