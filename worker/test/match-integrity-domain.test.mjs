import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyHistoricalMatch,
  collectCandidateOpportunityIds,
  evaluateActiveMatchContract,
  isTemporaryLinkageId,
  proposedCanonicalIdsFromAlias,
  resolveCanonicalPairFromDocs
} from "../src/match-integrity-domain.js";

const requestDoc = {
  officeId: "office-1",
  opportunityKind: "REQUEST",
  propertyType: "شقة",
  district: "النرجس"
};
const offerDoc = {
  officeId: "office-1",
  opportunityKind: "OFFER",
  kind: "owner_offer",
  propertyType: "شقة",
  district: "النرجس"
};

test("temporary intake IDs are never canonical", () => {
  assert.equal(isTemporaryLinkageId("cli_intake_intake_cycle_mt3oco8s_req"), true);
  assert.equal(isTemporaryLinkageId("own_intake_intake_cycle_mt3of5pg_offer"), true);
  assert.equal(isTemporaryLinkageId("intake_cycle_mt3oco8s"), true);
  assert.equal(isTemporaryLinkageId("opp_intake_intake_cycle_mt3oco8s"), false);
  assert.equal(isTemporaryLinkageId("opp_e2e_client_msjk5q5p"), false);
});

test("intake aliases map to opp_intake ids without storing the alias", () => {
  assert.deepEqual(
    proposedCanonicalIdsFromAlias("cli_intake_intake_cycle_mt3oco8s_req").sort(),
    ["opp_intake_intake_cycle_mt3oco8s", "opp_intake_intake_cycle_mt3oco8s_req"].sort()
  );
});

test("active match contract fails closed without both canonical docs", () => {
  const missing = evaluateActiveMatchContract({
    requestId: "",
    offerId: "",
    officeId: "office-1"
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.integrityStatus, "INVALID");
  assert.ok(missing.reasons.includes("missing_requestId"));
  assert.ok(missing.reasons.includes("missing_offerId"));

  const intake = evaluateActiveMatchContract({
    requestId: "cli_intake_x_req",
    offerId: "own_intake_x_offer",
    officeId: "office-1"
  });
  assert.equal(intake.ok, false);
  assert.ok(intake.reasons.includes("temporary_request_id"));
  assert.ok(intake.reasons.includes("temporary_offer_id"));
});

test("active match contract accepts REQUEST+OFFER opportunity pair", () => {
  const ok = evaluateActiveMatchContract({
    requestId: "opp_req",
    offerId: "opp_off",
    requestDoc,
    offerDoc,
    officeId: "office-1"
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.integrityStatus, "VALID");
});

test("opportunity-vs-opportunity matches repair from stored opportunity ids", () => {
  const match = {
    officeId: "office-1",
    opportunityId: "opp_req",
    counterpartOpportunityId: "opp_off",
    sourceCollection: "opportunities",
    sourceRecordId: "opp_req",
    counterpartCollection: "opportunities",
    counterpartRecordId: "opp_off",
    clientRequestId: "",
    ownerOfferId: ""
  };
  const resolved = resolveCanonicalPairFromDocs(match, {
    opp_req: requestDoc,
    opp_off: offerDoc
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.requestId, "opp_req");
  assert.equal(resolved.offerId, "opp_off");
  const classified = classifyHistoricalMatch(match, {
    opp_req: requestDoc,
    opp_off: offerDoc
  });
  assert.equal(classified.class, "REPAIRABLE");
  assert.equal(classified.method, "opportunityId_counterpartOpportunityId");
});

test("intake-only matches without opportunity docs are unrepairable", () => {
  const match = {
    officeId: "office-1",
    clientRequestId: "cli_intake_cycle_req",
    ownerOfferId: "own_intake_cycle_offer",
    opportunityId: "opp_intake_cycle_offer",
    sourceCollection: "owners",
    sourceRecordId: "own_intake_cycle_offer",
    counterpartCollection: "clients",
    counterpartRecordId: "cli_intake_cycle_req"
  };
  const classified = classifyHistoricalMatch(match, {});
  assert.equal(classified.class, "UNREPAIRABLE");
  assert.equal(classified.ok, false);
});

test("candidate ids include opportunity pair and skip storing intake aliases as canonical", () => {
  const ids = collectCandidateOpportunityIds({
    opportunityId: "opp_a",
    counterpartOpportunityId: "opp_b",
    clientRequestId: "cli_intake_x_req",
    ownerOfferId: "own_intake_x_offer"
  });
  assert.ok(ids.includes("opp_a"));
  assert.ok(ids.includes("opp_b"));
  assert.equal(ids.includes("cli_intake_x_req"), false);
  assert.ok(ids.includes("opp_intake_x"));
});
