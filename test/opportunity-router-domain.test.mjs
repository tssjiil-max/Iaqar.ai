import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSIGNMENT_REASON,
  ATTEMPT_DECISION,
  DECLINE_REASON,
  NEW_OFFICE_FOLLOWUP_BASELINE,
  NEW_OFFICE_RESPONSE_BASELINE,
  ORIGIN_SOURCE_TYPE,
  PLATFORM_OPPORTUNITY_ACCEPT_WINDOW_MINUTES,
  ROUTING_STATUS,
  applyRatingAggregate,
  bayesianRating,
  canAcceptAttempt,
  fairnessFitScore,
  isOfficeEligibleForPlatformRouter,
  livingTaskIdForOpportunity,
  nextPendingCandidate,
  originSourceFromIntake,
  publicOfferPreview,
  rankRouterCandidates,
  ratingFitScore,
  ratingUniquenessKey,
  routerCompleteness,
  scoreOfficeForOpportunity
} from "../public/js/opportunity-router-domain.js";

const CITY = "المدينة المنورة";
const opportunity = {
  opportunityKind: "REQUEST",
  purpose: "PURCHASE",
  propertyType: "أرض",
  city: CITY,
  district: "السكب",
  districtId: "alsakb",
  budget: 850000
};

function office(id, extra = {}) {
  return {
    officeId: id,
    city: CITY,
    accountStatus: "active",
    approvalStatus: "approved",
    acceptPlatformPublicOpportunities: true,
    specialties: ["purchase", "sale"],
    primaryNeighborhoodId: "other",
    serviceNeighborhoodIds: ["other"],
    ...extra
  };
}

test("TEST 1 domain: office-direct intake never looks like platform public", () => {
  const source = originSourceFromIntake({ officeId: "office-a", source: "office_public_link" });
  assert.equal(source.type, ORIGIN_SOURCE_TYPE.OFFICE_DIRECT);
  assert.equal(source.officeId, "office-a");
  assert.equal(ASSIGNMENT_REASON.DIRECT_OFFICE_LINK, "DIRECT_OFFICE_LINK");
});

test("TEST 2 domain: /add platform intake is PLATFORM_PUBLIC", () => {
  const source = originSourceFromIntake({ officeId: "platform", source: "platform_public" });
  assert.equal(source.type, ORIGIN_SOURCE_TYPE.PLATFORM_PUBLIC);
  assert.equal(source.officeId, "");
});

test("incomplete public opportunities stay NEEDS_COMPLETION", () => {
  const incomplete = routerCompleteness({ opportunityKind: "REQUEST", city: CITY });
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.status, ROUTING_STATUS.NEEDS_COMPLETION);
  assert.ok(incomplete.missing.includes("propertyType"));
});

test("TEST 3: same-district office ranks above same-city different district", () => {
  const a = scoreOfficeForOpportunity({
    office: office("office-a", { primaryNeighborhoodId: "alsakb", serviceNeighborhoodIds: ["alsakb"] }),
    opportunity
  });
  const b = scoreOfficeForOpportunity({
    office: office("office-b", { primaryNeighborhoodId: "alhamra", serviceNeighborhoodIds: ["alhamra"] }),
    opportunity
  });
  const ranked = rankRouterCandidates([a, b]);
  assert.equal(ranked[0].officeId, "office-a");
  assert.ok(a.breakdown.location > b.breakdown.location);
});

test("TEST 4: specialization exact fit ranks above unspecialized", () => {
  const a = scoreOfficeForOpportunity({
    office: office("office-a", { specialties: ["purchase"] }),
    opportunity
  });
  const b = scoreOfficeForOpportunity({
    office: office("office-b", { specialties: ["sale"] }),
    opportunity
  });
  assert.ok(a.breakdown.specialization > b.breakdown.specialization);
  assert.equal(rankRouterCandidates([a, b])[0].officeId, "office-a");
});

test("TEST 5: faster response history scores higher on the response component", () => {
  const a = scoreOfficeForOpportunity({
    office: office("office-a"),
    opportunity,
    stats: { responseSampleCount: 8, averageResponseMs: 20 * 60 * 1000 }
  });
  const b = scoreOfficeForOpportunity({
    office: office("office-b"),
    opportunity,
    stats: { responseSampleCount: 8, averageResponseMs: 80 * 60 * 60 * 1000 }
  });
  assert.ok(a.breakdown.response > b.breakdown.response);
});

test("TEST 6: a single 5.0 rating does not outrank a confident 4.8", () => {
  const many = ratingFitScore({ office: { ratingAverage: 4.8, ratingCount: 100 } });
  const one = ratingFitScore({ office: { ratingAverage: 5, ratingCount: 1 } });
  assert.ok(many.points > one.points);
  assert.ok(bayesianRating(5, 1) < bayesianRating(4.8, 100));
});

test("TEST 7: new eligible office gets a neutral baseline, not zero", () => {
  const scored = scoreOfficeForOpportunity({ office: office("office-new"), opportunity });
  assert.equal(scored.eligible, true);
  assert.equal(scored.breakdown.response, NEW_OFFICE_RESPONSE_BASELINE);
  assert.equal(scored.breakdown.followUp, NEW_OFFICE_FOLLOWUP_BASELINE);
  assert.ok(scored.totalScore > 30);
});

test("TEST 8: only rank 1 is the next pending candidate", () => {
  const ranked = rankRouterCandidates([
    scoreOfficeForOpportunity({ office: office("office-a", { primaryNeighborhoodId: "alsakb", serviceNeighborhoodIds: ["alsakb"] }), opportunity }),
    scoreOfficeForOpportunity({ office: office("office-b"), opportunity })
  ]);
  const first = nextPendingCandidate(ranked, []);
  assert.equal(first.rank, 1);
  const second = nextPendingCandidate(ranked, [first.officeId]);
  assert.equal(second.rank, 2);
  const preview = publicOfferPreview({ ...opportunity, id: "opp_1", contactPhone: "0511123456", contactName: "secret" });
  assert.equal(preview.contactPhone, undefined);
  assert.equal(preview.contactName, undefined);
});

test("TEST 9/10: decline and expiry leave the next office pending", () => {
  const ranked = rankRouterCandidates([
    { ...scoreOfficeForOpportunity({ office: office("office-a"), opportunity }), officeId: "office-a" },
    { ...scoreOfficeForOpportunity({ office: office("office-b"), opportunity }), officeId: "office-b" }
  ]);
  assert.equal(nextPendingCandidate(ranked, ["office-a"]).officeId, "office-b");
  assert.equal(ATTEMPT_DECISION.DECLINED, "DECLINED");
  assert.equal(ATTEMPT_DECISION.EXPIRED, "EXPIRED");
  assert.ok(PLATFORM_OPPORTUNITY_ACCEPT_WINDOW_MINUTES >= 1);
});

test("TEST 11: accept is rejected when already assigned or expired", () => {
  const attempt = {
    id: "att_1",
    officeId: "office-a",
    decision: ATTEMPT_DECISION.PENDING,
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  };
  assert.equal(canAcceptAttempt({
    attempt,
    opportunity: { routingStatus: ROUTING_STATUS.OFFERED_TO_OFFICE, currentAttemptId: "att_1" },
    officeId: "office-a"
  }).ok, true);
  assert.equal(canAcceptAttempt({
    attempt,
    opportunity: { routingStatus: ROUTING_STATUS.ASSIGNED, assignedOfficeId: "office-a", currentAttemptId: "att_1" },
    officeId: "office-a"
  }).error, "already_assigned");
  assert.equal(canAcceptAttempt({
    attempt: { ...attempt, officeId: "office-b" },
    opportunity: { routingStatus: ROUTING_STATUS.OFFERED_TO_OFFICE, currentAttemptId: "att_1" },
    officeId: "office-a"
  }).error, "wrong_office");
});

test("TEST 13: living task id is stable per opportunity", () => {
  assert.equal(livingTaskIdForOpportunity("opp_intake_abc"), "po_opp_intake_abc");
  assert.equal(livingTaskIdForOpportunity("opp_intake_abc"), livingTaskIdForOpportunity("opp_intake_abc"));
});

test("TEST 15: ratings are 1-5, aggregated, and unique per rater/opportunity", () => {
  const first = applyRatingAggregate({ ratingAverage: 0, ratingCount: 0, stars: 5 });
  const second = applyRatingAggregate({ ...first, stars: 4 });
  assert.equal(first.ratingCount, 1);
  assert.equal(second.ratingCount, 2);
  assert.equal(second.ratingAverage, 4.5);
  assert.equal(ratingUniquenessKey({ opportunityId: "opp_1", raterId: "party_1", raterRole: "CLIENT" }), "opp_1__party_1__client");
  assert.ok(DECLINE_REASON.TOO_BUSY);
});

test("TEST 16: opt-out excludes PLATFORM_PUBLIC but eligibility helper reports opt_out", () => {
  const result = isOfficeEligibleForPlatformRouter(
    office("office-a", { acceptPlatformPublicOpportunities: false }),
    opportunity
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "opt_out");
});

test("TEST 17: no eligible office when city does not match", () => {
  const scored = scoreOfficeForOpportunity({
    office: office("office-a", { city: "الرياض" }),
    opportunity
  });
  assert.equal(scored.eligible, false);
  assert.deepEqual(rankRouterCandidates([scored]), []);
});

test("TEST 18: ranking is deterministic for the same inputs", () => {
  const a = scoreOfficeForOpportunity({ office: office("office-a"), opportunity });
  const b = scoreOfficeForOpportunity({ office: office("office-b"), opportunity });
  const one = rankRouterCandidates([a, b]).map((row) => row.officeId);
  const two = rankRouterCandidates([b, a]).map((row) => row.officeId);
  assert.deepEqual(one, two);
});

test("fairness reduces a monopolizing office without making an unfit office eligible", () => {
  const busy = fairnessFitScore({ office: { recentPlatformAssignments: 9 }, eligibleLoad: [9, 1, 1] });
  const rest = fairnessFitScore({ office: { recentPlatformAssignments: 1 }, eligibleLoad: [9, 1, 1] });
  assert.ok(busy.points < rest.points);
  const unfit = scoreOfficeForOpportunity({
    office: office("office-x", { city: "جدة" }),
    opportunity,
    eligibleLoad: [0]
  });
  assert.equal(unfit.eligible, false);
});
