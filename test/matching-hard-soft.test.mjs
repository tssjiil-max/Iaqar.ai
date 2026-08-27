/**
 * Hard vs soft matching gate — mandatory scenarios.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateHardMatch,
  opportunityToMatchInput,
  scoreMatch
} from "../worker/src/matching-engine.js";

const CITY = "المدينة المنورة";
const DISTRICT = "عروة";

const rentOfferBase = {
  opportunityKind: "OFFER",
  transactionIntent: "RENT_OUT",
  purpose: "RENT",
  city: CITY,
  district: DISTRICT,
  propertyType: "شقة",
  annualRent: 15000,
  priceOrBudget: 15000,
  area: 75,
  directOwner: true,
  lifecycleStatus: "ACTIVE",
  dataCompleteness: 100
};

const rentRequestBase = {
  opportunityKind: "REQUEST",
  transactionIntent: "RENT_IN",
  purpose: "LEASE_REQUEST",
  city: CITY,
  district: DISTRICT,
  propertyType: "شقة",
  budget: 15000,
  priceOrBudget: 15000,
  area: 352,
  rooms: 5,
  lifecycleStatus: "ACTIVE",
  dataCompleteness: 100
};

function pair(offerExtra = {}, requestExtra = {}) {
  const offer = { ...rentOfferBase, ...offerExtra };
  const request = { ...rentRequestBase, ...requestExtra };
  return {
    offer,
    request,
    offerInput: opportunityToMatchInput(offer, { id: "offer_1" }),
    requestInput: opportunityToMatchInput(request, { id: "request_1" })
  };
}

test("TEST 1 rent offer vs rent request with large area gap => MATCH", () => {
  const { offerInput, requestInput } = pair();
  const hard = evaluateHardMatch(offerInput, requestInput);
  assert.equal(hard.hardMatch, true);
  const scored = scoreMatch(offerInput, requestInput);
  assert.equal(scored.hardMatch, true);
  assert.equal(scored.eligible, true);
});

test("TEST 2 three rooms vs five rooms => MATCH with lower score than exact rooms", () => {
  const exact = pair({ rooms: 5 }, { rooms: 5 });
  const diff = pair({ rooms: 3 }, { rooms: 5 });
  const exactScore = scoreMatch(exact.offerInput, exact.requestInput);
  const diffScore = scoreMatch(diff.offerInput, diff.requestInput);
  assert.equal(diffScore.hardMatch, true);
  assert.equal(diffScore.eligible, true);
  assert.ok(diffScore.score < exactScore.score);
});

test("TEST 3 rent offer vs buy request => NO MATCH (transactionIntent)", () => {
  const { offerInput, requestInput } = pair(
    {},
    { transactionIntent: "BUY", purpose: "PURCHASE", budget: 15000 }
  );
  const hard = evaluateHardMatch(offerInput, requestInput);
  assert.equal(hard.hardMatch, false);
  const scored = scoreMatch(offerInput, requestInput);
  assert.equal(scored.eligible, false);
});

test("TEST 4 apartment rent vs villa rent => NO MATCH (propertyType)", () => {
  const { offerInput, requestInput } = pair(
    { propertyType: "شقة" },
    { propertyType: "فيلا" }
  );
  assert.equal(evaluateHardMatch(offerInput, requestInput).hardMatch, false);
});

test("TEST 5 same city different district => NO MATCH", () => {
  const { offerInput, requestInput } = pair(
    { district: DISTRICT },
    { district: "العزيزية" }
  );
  assert.equal(evaluateHardMatch(offerInput, requestInput).hardMatch, false);
});

test("TEST 6 offer 20,000 vs budget 15,000 => NO MATCH", () => {
  const { offerInput, requestInput } = pair(
    { annualRent: 20000, priceOrBudget: 20000 },
    { budget: 15000, priceOrBudget: 15000 }
  );
  assert.equal(evaluateHardMatch(offerInput, requestInput).hardMatch, false);
});

test("TEST 7 all hard pass with soft differences => MATCH", () => {
  const { offerInput, requestInput } = pair({
    area: 75,
    rooms: 2,
    streetWidth: 12,
    frontage: "شمال"
  }, {
    area: 352,
    rooms: 5,
    streetWidth: 20,
    frontage: "جنوب"
  });
  const scored = scoreMatch(offerInput, requestInput);
  assert.equal(scored.hardMatch, true);
  assert.equal(scored.eligible, true);
  assert.ok(scored.metrics.areaDifferencePercent > 50);
});

test("A-0910 scenario vs A-NQix scenario => MATCH with area penalty only", () => {
  const offer = {
    ...rentOfferBase,
    id: "opp_a0910",
    referenceCode: "A-0910",
    annualRent: 15000,
    area: 75,
    directOwner: true
  };
  const request = {
    ...rentRequestBase,
    id: "opp_anqix",
    referenceCode: "A-NQix",
    budget: 15000,
    area: 352,
    rooms: 5
  };
  const offerInput = opportunityToMatchInput(offer, { id: offer.id });
  const requestInput = opportunityToMatchInput(request, { id: request.id });
  const hard = evaluateHardMatch(offerInput, requestInput);
  assert.equal(hard.hardMatch, true);
  const scored = scoreMatch(offerInput, requestInput);
  assert.equal(scored.eligible, true);
  assert.ok(scored.score >= 55);
  assert.ok(scored.metrics.areaDifferencePercent > 50);
});
