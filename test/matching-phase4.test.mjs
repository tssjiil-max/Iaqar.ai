/**
 * Phase 4 — Matching Engine automated tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  MATCHING_RULE_VERSION,
  MATCH_THRESHOLD,
  MATCHING_CONFIG,
  buildMatchId,
  canonicalPairKey,
  counterpartsEligible,
  opportunityToMatchInput,
  phase4BoundaryGuarantees,
  rankMatchCandidates,
  relevantDataVersion,
  scoreMatch,
  isActiveLifecycle
} from "../worker/src/matching-engine.js";
import {
  MATCHING_RUN_PATH,
  phase4BoundaryGuarantees as clientBoundaries,
  rematchRequestBody,
  requestOpportunityRematch,
  shouldRematchAfterOpportunityWrite
} from "../public/js/matching-domain.js";
import { readRepositoryFile } from "./helpers/shell.mjs";

const offer = {
  id: "opp_offer",
  opportunityKind: "OFFER",
  purpose: "SALE",
  city: "الرياض",
  district: "النرجس",
  propertyType: "شقة",
  priceOrBudget: 1200000,
  area: 180,
  rooms: 4,
  dataCompleteness: 100,
  lifecycleStatus: "ACTIVE",
  version: 1
};

const request = {
  id: "opp_request",
  opportunityKind: "REQUEST",
  purpose: "PURCHASE",
  city: "الرياض",
  district: "النرجس",
  propertyType: "شقة",
  priceOrBudget: 1250000,
  area: 175,
  rooms: 4,
  dataCompleteness: 100,
  lifecycleStatus: "ACTIVE",
  version: 1
};

test("thresholds and rule version live in one matching config module", () => {
  assert.equal(MATCHING_RULE_VERSION, "4.0.0");
  assert.equal(MATCH_THRESHOLD, 55);
  assert.equal(MATCHING_CONFIG.threshold, MATCH_THRESHOLD);
  assert.equal(MATCHING_CONFIG.maxResults, 3);
});

test("compatible offer/request scores above threshold with Arabic reasons", () => {
  const source = opportunityToMatchInput(offer, { id: offer.id });
  const candidate = opportunityToMatchInput(request, { id: request.id });
  assert.equal(counterpartsEligible(offer, request), true);
  const scored = scoreMatch(source, candidate);
  assert.equal(scored.eligible, true);
  assert.ok(scored.score >= MATCH_THRESHOLD);
  assert.ok(scored.reasons.includes("نفس الحي"));
});

test("sale-rent conflict is rejected", () => {
  const scored = scoreMatch(
    opportunityToMatchInput({ ...offer, purpose: "SALE" }),
    opportunityToMatchInput({ ...request, purpose: "RENT" })
  );
  assert.equal(scored.eligible, false);
});

test("rent request matches rent offer without secondary details", () => {
  const rentOffer = opportunityToMatchInput({
    id: "rent_offer",
    opportunityKind: "OFFER",
    purpose: "RENT",
    city: "المدينة المنورة",
    district: "السلام",
    propertyType: "شقة",
    priceOrBudget: 32000,
    lifecycleStatus: "ACTIVE"
  });
  const rentRequest = opportunityToMatchInput({
    id: "rent_request",
    opportunityKind: "REQUEST",
    purpose: "LEASE_REQUEST",
    city: "المدينة المنورة",
    district: "السلام",
    propertyType: "شقة",
    priceOrBudget: 35000,
    lifecycleStatus: "ACTIVE"
  });
  const scored = scoreMatch(rentRequest, rentOffer);
  assert.equal(scored.eligible, true);
  assert.ok(scored.score >= MATCH_THRESHOLD);
});

test("archived or deleted opportunities are not active counterparts", () => {
  assert.equal(isActiveLifecycle({ lifecycleStatus: "ARCHIVED", archivedAt: "x" }), false);
  assert.equal(isActiveLifecycle({ lifecycleStatus: "DELETED", deletedAt: "x" }), false);
  assert.equal(counterpartsEligible(offer, { ...request, lifecycleStatus: "ARCHIVED" }), false);
});

test("match id is idempotent for the same pair + rule + data version", async () => {
  const pairKey = canonicalPairKey(`opportunities:${offer.id}`, `opportunities:${request.id}`);
  const dataVersion = await relevantDataVersion(
    opportunityToMatchInput(offer),
    opportunityToMatchInput(request)
  );
  const a = await buildMatchId({
    officeId: "office-a",
    pairKey,
    matchingRuleVersion: MATCHING_RULE_VERSION,
    dataVersion
  });
  const b = await buildMatchId({
    officeId: "office-a",
    pairKey,
    matchingRuleVersion: MATCHING_RULE_VERSION,
    dataVersion
  });
  assert.equal(a, b);
  assert.ok(a.startsWith("mat_"));
});

test("changing relevant opportunity data produces a new data version and match id", async () => {
  const pairKey = canonicalPairKey(`opportunities:${offer.id}`, `opportunities:${request.id}`);
  const v1 = await relevantDataVersion(
    opportunityToMatchInput(offer),
    opportunityToMatchInput(request)
  );
  const edited = opportunityToMatchInput({ ...offer, priceOrBudget: 1400000, version: 2 });
  const v2 = await relevantDataVersion(edited, opportunityToMatchInput(request));
  assert.notEqual(v1, v2);
  const id1 = await buildMatchId({
    officeId: "office-a", pairKey, matchingRuleVersion: MATCHING_RULE_VERSION, dataVersion: v1
  });
  const id2 = await buildMatchId({
    officeId: "office-a", pairKey, matchingRuleVersion: MATCHING_RULE_VERSION, dataVersion: v2
  });
  assert.notEqual(id1, id2);
});

test("rankMatchCandidates returns at most three current matches", () => {
  const source = {
    city: "الرياض", district: "النرجس", propertyType: "شقة", transactionType: "sale",
    price: 1200000, area: 180, rooms: 4, completeness: 90
  };
  const candidates = Array.from({ length: 5 }, (_, index) => ({
    city: "الرياض", district: "النرجس", propertyType: "شقة", transactionType: "sale",
    price: 1200000 + index * 10000, area: 180, rooms: 4, completeness: 90
  }));
  const ranked = rankMatchCandidates(source, candidates);
  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[0].isBestOpportunity, true);
});

test("Phase 4 boundaries never create Operations or send messages", () => {
  const g = phase4BoundaryGuarantees();
  assert.equal(g.createsOperation, false);
  assert.equal(g.sendsWhatsApp, false);
  assert.equal(g.sendsTelegram, false);
  assert.equal(g.runsAutomaticCooperation, false);
  assert.deepEqual(clientBoundaries().createsOperation, false);
});

test("client rematch helper posts to /matching/run and never claims Operations", async () => {
  assert.equal(MATCHING_RUN_PATH, "/matching/run");
  assert.deepEqual(rematchRequestBody({ officeId: "office-a", opportunityId: "opp_1" }), {
    officeId: "office-a",
    opportunityId: "opp_1",
    notify: false
  });
  assert.equal(shouldRematchAfterOpportunityWrite({ duplicate: true }), false);
  assert.equal(shouldRematchAfterOpportunityWrite({ duplicate: false }), true);

  const calls = [];
  const result = await requestOpportunityRematch({
    workerBase: "https://example.test",
    idToken: "token",
    officeId: "office-a",
    opportunityId: "opp_1",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        ok: true,
        matchCount: 1,
        matches: [{ matchId: "mat_x" }],
        matchingRuleVersion: MATCHING_RULE_VERSION,
        createsOperation: false,
        boundaries: phase4BoundaryGuarantees()
      }), { status: 200 });
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.matchCount, 1);
  assert.equal(result.createsOperation, false);
  assert.ok(String(calls[0].url).endsWith("/matching/run"));
  assert.equal(calls[0].init.headers.Authorization, "Bearer token");
});

test("shell and worker wire Phase 4 rematch without Deals page or bottom nav", () => {
  const intake = readRepositoryFile("public", "js", "add-opportunity.js");
  const bank = readRepositoryFile("public", "js", "opportunity-bank.js");
  const worker = readRepositoryFile("worker", "src", "index.js");
  const shell = readRepositoryFile("public", "index.html");
  assert.ok(intake.includes("requestOpportunityRematch"));
  assert.ok(bank.includes("rematchOpportunity"));
  assert.ok(worker.includes("/matching/run"));
  assert.ok(worker.includes("MATCHING_RULE_VERSION"));
  assert.ok(worker.includes("runCanonicalMatchingAfterOpportunityPersist"));
  assert.ok(worker.includes("REJECTED_ACTIVE_MATCH"));
  assert.ok(worker.includes("resolveCanonicalPairFromDocs"));
  assert.equal(/data-main=\"deals\"/.test(shell), false);
  assert.ok(shell.includes("id=\"mainTabs\""));
  assert.equal(/bottom-nav/i.test(shell), false);
});
