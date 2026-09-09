import test from "node:test";
import assert from "node:assert/strict";

import {
  MATCHING_ADMISSION_STATUS,
  evaluateMatchingAdmission
} from "../worker/src/matching-admission-domain.js";
import {
  MATCHING_RULE_VERSION,
  buildMatchId,
  canonicalPairKey,
  counterpartsEligible,
  phase4BoundaryGuarantees,
  relevantDataVersion
} from "../worker/src/matching-engine.js";
import {
  evaluateActiveMatchContract,
  isTemporaryLinkageId,
  resolveCanonicalPairFromDocs
} from "../worker/src/match-integrity-domain.js";
import {
  buildMatchReviewOperation,
  shouldCreateMatchReview
} from "../worker/src/operations-domain.js";
import { readRepositoryFile } from "./helpers/shell.mjs";

function canonicalOffer(overrides = {}) {
  return {
    id: "opp_offer_gate",
    officeId: "office-a",
    originatingOfficeId: "office-a",
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العزيزية",
    priceOrBudget: 500000,
    advertiserRole: "OWNER",
    contactPhone: "0551234567",
    lifecycleStatus: "ACTIVE",
    version: 1,
    ...overrides
  };
}

function canonicalRequest(overrides = {}) {
  return {
    id: "opp_request_gate",
    officeId: "office-a",
    originatingOfficeId: "office-a",
    opportunityKind: "REQUEST",
    purpose: "PURCHASE",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "العزيزية",
    priceOrBudget: 520000,
    advertiserRole: "CLIENT",
    contactPhone: "0551234568",
    lifecycleStatus: "ACTIVE",
    version: 1,
    ...overrides
  };
}

test("release gate admits only complete canonical opportunities", () => {
  const complete = evaluateMatchingAdmission(canonicalRequest());
  assert.equal(complete.status, MATCHING_ADMISSION_STATUS.ADMITTED);
  assert.equal(complete.isReadyForMatching, true);

  for (const patch of [
    { district: "" },
    { priceOrBudget: 0 },
    { advertiserRole: "UNKNOWN" },
    { contactPhone: "" }
  ]) {
    const result = evaluateMatchingAdmission(canonicalRequest(patch));
    assert.equal(result.status, MATCHING_ADMISSION_STATUS.NEEDS_COMPLETION);
    assert.equal(result.isReadyForMatching, false);
    assert.equal(counterpartsEligible(canonicalRequest(patch), canonicalOffer()), false);
  }
});

test("release gate allows only REQUEST to OFFER counterparts", () => {
  assert.equal(counterpartsEligible(canonicalRequest(), canonicalOffer()), true);
  assert.equal(counterpartsEligible(canonicalOffer(), canonicalRequest()), true);
  assert.equal(counterpartsEligible(canonicalRequest(), canonicalRequest({ id: "opp_request_2" })), false);
  assert.equal(counterpartsEligible(canonicalOffer(), canonicalOffer({ id: "opp_offer_2" })), false);
});

test("release gate rejects temporary linkage ids and requires canonical REQUEST/OFFER docs", () => {
  assert.equal(isTemporaryLinkageId("cli_intake_cycle_req"), true);
  assert.equal(isTemporaryLinkageId("own_intake_cycle_offer"), true);

  const invalid = evaluateActiveMatchContract({
    requestId: "cli_intake_cycle_req",
    offerId: "own_intake_cycle_offer",
    officeId: "office-a"
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.reasons.includes("temporary_request_id"));
  assert.ok(invalid.reasons.includes("temporary_offer_id"));

  const request = canonicalRequest();
  const offer = canonicalOffer();
  const resolved = resolveCanonicalPairFromDocs({
    officeId: "office-a",
    opportunityId: request.id,
    counterpartOpportunityId: offer.id
  }, {
    [request.id]: request,
    [offer.id]: offer
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.requestId, request.id);
  assert.equal(resolved.offerId, offer.id);
  assert.equal(resolved.integrityStatus, "VALID");
});

test("release gate keeps match and MATCH_REVIEW identities deterministic", async () => {
  const request = canonicalRequest();
  const offer = canonicalOffer();
  const pairKey = canonicalPairKey(`opportunities:${request.id}`, `opportunities:${offer.id}`);
  const dataVersion = await relevantDataVersion(request, offer);
  const firstMatchId = await buildMatchId({
    officeId: "office-a",
    pairKey,
    matchingRuleVersion: MATCHING_RULE_VERSION,
    dataVersion
  });
  const secondMatchId = await buildMatchId({
    officeId: "office-a",
    pairKey,
    matchingRuleVersion: MATCHING_RULE_VERSION,
    dataVersion
  });
  assert.equal(firstMatchId, secondMatchId);

  assert.equal(shouldCreateMatchReview({ score: 80, threshold: 55, isCurrent: true, status: "active" }), true);
  const opA = await buildMatchReviewOperation({
    officeId: "office-a",
    matchId: firstMatchId,
    opportunityId: request.id,
    dataVersion,
    score: 80
  });
  const opB = await buildMatchReviewOperation({
    officeId: "office-a",
    matchId: firstMatchId,
    opportunityId: request.id,
    dataVersion,
    score: 80
  });
  assert.equal(opA.id, opB.id);
  assert.equal(opA.deduplicationKey, opB.deduplicationKey);
});

test("release gate proves Matching Engine has no messaging, operation, cooperation, viewing or deal side effects", () => {
  const boundaries = phase4BoundaryGuarantees();
  assert.deepEqual(boundaries, {
    createsOperation: false,
    sendsWhatsApp: false,
    sendsTelegram: false,
    runsAutomaticCooperation: false,
    matchingRuleVersion: MATCHING_RULE_VERSION
  });

  const engineSource = readRepositoryFile("worker", "src", "matching-engine.js");
  assert.doesNotMatch(engineSource, /createMatchReviewBundle\s*\(/);
  assert.doesNotMatch(engineSource, /sendOfficePush\s*\(/);
  assert.doesNotMatch(engineSource, /createDeal|setViewing|coordinationSessions/);
});

test("release gate keeps invalid active matches on the diagnostic path before review operation creation", () => {
  const workerSource = readRepositoryFile("worker", "src", "index.js");
  assert.match(workerSource, /if \(!linkage\.ok\) \{/);
  assert.match(workerSource, /REJECTED_ACTIVE_MATCH/);
  assert.match(workerSource, /resolveCanonicalPairFromDocs/);
  assert.match(workerSource, /createMatchReviewBundle/);

  const invalidBlockStart = workerSource.indexOf("if (!linkage.ok) {");
  assert.ok(invalidBlockStart >= 0);
  const invalidBlock = workerSource.slice(invalidBlockStart, invalidBlockStart + 2200);
  assert.match(invalidBlock, /writeRejectedMatchDiagnostic/);
  assert.match(invalidBlock, /return/);
  assert.doesNotMatch(invalidBlock, /createMatchReviewBundle\s*\(/);
});

test("an existing Match is repaired with MATCH_REVIEW before duplicate return", () => {
  const workerSource = readRepositoryFile("worker", "src", "index.js");
  const duplicateStart = workerSource.indexOf("if (existingMatch) {");
  const duplicateEnd = workerSource.indexOf("await supersedeMatchesForPairKey", duplicateStart);
  const duplicateBlock = workerSource.slice(duplicateStart, duplicateEnd);
  assert.match(duplicateBlock, /ensurePersistedMatchReviewOperation/);
  assert.match(duplicateBlock, /persisted\.operationId = ensured\.operationId/);
  assert.ok(
    duplicateBlock.indexOf("ensurePersistedMatchReviewOperation") < duplicateBlock.lastIndexOf("return persisted"),
    "duplicate Match must not return before ensuring MATCH_REVIEW"
  );

  const ensureStart = workerSource.indexOf("async function ensurePersistedMatchReviewOperation");
  const ensureEnd = workerSource.indexOf("async function persistScoredMatch", ensureStart);
  const ensureBlock = workerSource.slice(ensureStart, ensureEnd);
  assert.match(ensureBlock, /createMatchReviewBundle/);
  assert.match(ensureBlock, /match_review_operation_missing/);
  assert.doesNotMatch(ensureBlock, /catch\s*\(/);
});
