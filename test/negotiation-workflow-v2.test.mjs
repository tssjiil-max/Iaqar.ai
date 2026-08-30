import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_NEGOTIATION_RESPONSE,
  COORDINATION_OUTCOME,
  NEGOTIATION_DECISION,
  OWNER_AVAILABILITY,
  PRICE_FLEXIBILITY,
  buildDecisionPackageView,
  normalizeClientBundle,
  normalizeOwnerBundle,
  resolveCoordinationOutcome
} from "../public/js/coordination-bundle-domain.js";
import { buildPartyShellHtml } from "../public/js/party-shell-ui.js";

const offer = { propertyType: "شقة", price: 700000, area: 75, rooms: 4, parking: true };

function clientPrice(preference = PRICE_FLEXIBILITY.DISCOUNT_5, extra = {}) {
  return normalizeClientBundle({
    interestStatus: "not_suitable",
    rejectionReason: "price",
    rejectionDisposition: "negotiable",
    negotiationPreference: preference,
    canonicalPrice: offer.price,
    ...extra
  });
}

function ownerBase(extra = {}) {
  return normalizeOwnerBundle({
    propertyAvailability: OWNER_AVAILABILITY.AVAILABLE,
    canonicalPrice: offer.price,
    ...extra
  });
}

test("deterministic client proposals and midpoint use canonical price without mutating it", () => {
  const before = structuredClone(offer);
  assert.equal(clientPrice(PRICE_FLEXIBILITY.DISCOUNT_2).proposedPrice, 686000);
  const client = clientPrice();
  assert.equal(client.proposedPrice, 665000);
  const owner = ownerBase({
    negotiationDecision: NEGOTIATION_DECISION.COUNTER,
    counterPreference: PRICE_FLEXIBILITY.SLIGHT,
    clientProposedPrice: client.proposedPrice
  });
  assert.equal(owner.counterPrice, 682500);
  assert.deepEqual(offer, before);
});

test("midpoint remains pending until the client explicitly accepts", () => {
  const client = clientPrice();
  const owner = ownerBase({ negotiationDecision: "counter", counterPreference: "slight", clientProposedPrice: 665000 });
  assert.equal(resolveCoordinationOutcome({ clientBundle: client, ownerBundle: owner, canonicalOffer: offer }).outcome,
    COORDINATION_OUTCOME.NEGOTIATION_COUNTERED);
  const accepted = clientPrice(PRICE_FLEXIBILITY.DISCOUNT_5, { negotiationResponse: CLIENT_NEGOTIATION_RESPONSE.ACCEPT });
  assert.equal(resolveCoordinationOutcome({ clientBundle: accepted, ownerBundle: owner, canonicalOffer: offer }).outcome,
    COORDINATION_OUTCOME.NEEDS_BROKER);
});

test("owner explicitly accepting the exact client proposal resolves price", () => {
  const result = resolveCoordinationOutcome({
    clientBundle: clientPrice(),
    ownerBundle: ownerBase({ negotiationDecision: NEGOTIATION_DECISION.ACCEPT }),
    canonicalOffer: offer
  });
  assert.equal(result.outcome, COORDINATION_OUTCOME.NEGOTIATION_ACCEPTED);
});

test("fixed price and midpoint route to the client response step with exact value", () => {
  const client = clientPrice();
  for (const [preference, expected] of [["fixed", 700000], ["slight", 682500]]) {
    const owner = ownerBase({ negotiationDecision: "counter", counterPreference: preference, clientProposedPrice: 665000 });
    const pkg = buildDecisionPackageView("client", { canonicalOffer: offer, clientBundle: client, ownerBundle: owner });
    assert.equal(pkg.workflowStep, "client_price_response");
    assert.equal(pkg.negotiationResponseRequest.counterPrice, expected);
  }
});

test("discuss at viewing is deferred and never marked as price agreement", () => {
  const client = clientPrice();
  const owner = ownerBase({ negotiationDecision: "counter", counterPreference: "discuss_at_viewing" });
  const pkg = buildDecisionPackageView("client", { canonicalOffer: offer, clientBundle: client, ownerBundle: owner });
  assert.equal(pkg.workflowStep, "client_viewing");
  assert.notEqual(resolveCoordinationOutcome({ clientBundle: client, ownerBundle: owner, canonicalOffer: offer }).outcome,
    COORDINATION_OUTCOME.NEGOTIATION_ACCEPTED);
});

test("owner sees only requested unresolved information dimensions", () => {
  const client = normalizeClientBundle({
    propertyType: "شقة", interestStatus: "interested", interestAction: "details",
    requestedDetailKeys: ["area", "rooms", "parking"]
  });
  const owner = ownerBase({ detailConfirmations: ["area"] });
  const pkg = buildDecisionPackageView("owner", { propertyType: "شقة", canonicalOffer: offer, clientBundle: client, ownerBundle: owner });
  assert.equal(pkg.workflowStep, "owner_details");
  assert.deepEqual(pkg.ownerDetailFields.map((field) => field.key), ["rooms", "parking"]);
});

test("confirmed detail resolves while needs-update becomes broker-required", () => {
  const client = normalizeClientBundle({
    propertyType: "شقة", interestStatus: "interested", interestAction: "details", requestedDetailKeys: ["area"]
  });
  const confirmed = ownerBase({ detailConfirmations: ["area"] });
  assert.notEqual(resolveCoordinationOutcome({ clientBundle: client, ownerBundle: confirmed, canonicalOffer: offer }).outcome,
    COORDINATION_OUTCOME.CLIENT_NEEDS_INFO);
  const needsUpdate = ownerBase({ detailNeedsUpdate: ["area"] });
  assert.equal(resolveCoordinationOutcome({ clientBundle: client, ownerBundle: needsUpdate, canonicalOffer: offer }).outcome,
    COORDINATION_OUTCOME.NEEDS_BROKER);
});

test("every phase-two turn remains button-only and contains no manual text or number input", () => {
  const client = clientPrice();
  const cases = [
    buildDecisionPackageView("client", { canonicalOffer: offer }),
    buildDecisionPackageView("owner", { canonicalOffer: offer, clientBundle: client }),
    buildDecisionPackageView("client", {
      canonicalOffer: offer,
      clientBundle: client,
      ownerBundle: ownerBase({ negotiationDecision: "counter", counterPreference: "fixed" })
    })
  ];
  for (const decisionPackage of cases) {
    const html = buildPartyShellHtml({ party: decisionPackage.party, property: {}, decisionPackage });
    assert.doesNotMatch(html, /<textarea\b|<input[^>]+type=["'](?:text|number)["']/i);
  }
});

test("owner availability remains valid without a viewing choice", () => {
  assert.ok(ownerBase({ priceConfirmation: "confirmed" }));
  assert.equal(ownerBase({ priceConfirmation: "confirmed" }).viewingAllowed, "");
});

test("decision workflow reuses the existing package mode and structured viewing options", () => {
  const pkg = buildDecisionPackageView("client", { canonicalOffer: offer, clientBundle: clientPrice(PRICE_FLEXIBILITY.DISCUSS_AT_VIEWING) });
  assert.equal(pkg.mode, "decision_package_v1");
  assert.equal(pkg.workflowStep, "client_viewing");
  assert.deepEqual(pkg.dayOptions.map((option) => option.value), ["today", "tomorrow", "weekend"]);
  assert.deepEqual(pkg.periodOptions.map((option) => option.value), ["morning", "afternoon", "evening"]);
});
