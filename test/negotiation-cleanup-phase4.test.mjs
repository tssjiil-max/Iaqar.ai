import test from "node:test";
import assert from "node:assert/strict";
import {
  NEGOTIATION_ACTOR,
  NEGOTIATION_STATE,
  isNegotiationRequested,
  negotiationBoundaryGuarantees,
  resolveNegotiationState,
  validateNegotiationSubmission
} from "../public/js/negotiation-domain.js";

const offer = { price: 700000 };
const clientRequest = (extra = {}) => ({
  interestStatus: "not_suitable",
  rejectionDisposition: "negotiable",
  rejectionReason: "price",
  negotiationPreference: "discount_5",
  proposedPrice: 665000,
  ...extra
});
const owner = (extra = {}) => ({
  propertyAvailability: "available",
  ...extra
});

test("negotiation domain owns only the negotiation slice", () => {
  assert.deepEqual(negotiationBoundaryGuarantees(), {
    sourceOfTruth: "coordinationSessions",
    ownsViewing: false,
    ownsDealLifecycle: false,
    ownsOperations: false,
    acceptsFreeText: false,
    acceptsManualPrice: false,
    autoSendsMessage: false,
    exposesCounterpartyContact: false,
    legacyRepliesAreAuthoritative: false
  });
});

test("ordinary interested client is not forced through negotiation", () => {
  assert.equal(isNegotiationRequested({ interestStatus: "interested" }), false);
  const state = resolveNegotiationState({
    clientBundle: { interestStatus: "interested" },
    ownerBundle: owner()
  });
  assert.equal(state.applies, false);
  assert.equal(state.handled, false);
  assert.equal(state.state, NEGOTIATION_STATE.NOT_APPLICABLE);
});

test("negotiable client request waits for owner using existing coordination outcome", () => {
  const state = resolveNegotiationState({ clientBundle: clientRequest() });
  assert.equal(state.state, NEGOTIATION_STATE.WAITING_OWNER_BUNDLE);
  assert.equal(state.nextActor, NEGOTIATION_ACTOR.OWNER);
  assert.equal(state.coordination.outcome, "AWAITING_OTHER_PARTY");
});

test("property unavailable wins over negotiation pending state", () => {
  const state = resolveNegotiationState({
    clientBundle: clientRequest(),
    ownerBundle: { propertyAvailability: "not_available" }
  });
  assert.equal(state.state, NEGOTIATION_STATE.PROPERTY_UNAVAILABLE);
  assert.equal(state.coordination.outcome, "PROPERTY_NOT_AVAILABLE");
  assert.equal(state.terminal, true);
});

test("owner can explicitly accept the client proposal", () => {
  const state = resolveNegotiationState({
    clientBundle: clientRequest(),
    ownerBundle: owner({ negotiationDecision: "accept" }),
    canonicalOffer: offer
  });
  assert.equal(state.state, NEGOTIATION_STATE.ACCEPTED);
  assert.equal(state.coordination.outcome, "NEGOTIATION_ACCEPTED");
  assert.equal(state.agreedPrice, 665000);
  assert.equal(state.nextActor, NEGOTIATION_ACTOR.BROKER);
});

test("counter offer requires an explicit client response", () => {
  const waiting = resolveNegotiationState({
    clientBundle: clientRequest(),
    ownerBundle: owner({ negotiationDecision: "counter", counterPreference: "slight", counterPrice: 682500 })
  });
  assert.equal(waiting.state, NEGOTIATION_STATE.COUNTER_PENDING_CLIENT);
  assert.equal(waiting.coordination.outcome, "NEGOTIATION_COUNTERED");
  assert.equal(waiting.nextActor, NEGOTIATION_ACTOR.CLIENT);

  const accepted = resolveNegotiationState({
    clientBundle: clientRequest({ negotiationResponse: "accept" }),
    ownerBundle: owner({ negotiationDecision: "counter", counterPreference: "slight", counterPrice: 682500 })
  });
  assert.equal(accepted.state, NEGOTIATION_STATE.BROKER_CONFIRMATION_REQUIRED);
  assert.equal(accepted.coordination.outcome, "NEEDS_BROKER");
  assert.equal(accepted.agreedPrice, 682500);
});

test("client rejecting the counter terminates this match negotiation only", () => {
  const state = resolveNegotiationState({
    clientBundle: clientRequest({ negotiationResponse: "reject" }),
    ownerBundle: owner({ negotiationDecision: "counter", counterPreference: "fixed", counterPrice: 700000 })
  });
  assert.equal(state.state, NEGOTIATION_STATE.CLIENT_REJECTED_COUNTER);
  assert.equal(state.coordination.outcome, "CLIENT_NOT_INTERESTED");
  assert.equal(state.terminal, true);
});

test("discuss at viewing leaves negotiation without inventing price agreement", () => {
  const state = resolveNegotiationState({
    clientBundle: clientRequest({ negotiationPreference: "discuss_at_viewing", proposedPrice: null }),
    ownerBundle: owner()
  });
  assert.equal(state.state, NEGOTIATION_STATE.DEFERRED_TO_VIEWING);
  assert.equal(state.handled, false);
  assert.equal(state.agreedPrice, null);
});

test("server guard rejects client negotiation response before owner counter", () => {
  const result = validateNegotiationSubmission({
    party: "client",
    session: { clientBundle: clientRequest(), ownerBundle: owner() },
    bundle: clientRequest({ negotiationResponse: "accept" })
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "client_response_without_owner_counter");
});

test("server guard rejects owner negotiation decision without a client negotiation request", () => {
  const result = validateNegotiationSubmission({
    party: "owner",
    session: { clientBundle: { interestStatus: "interested" } },
    bundle: owner({ negotiationDecision: "accept" })
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "owner_decision_without_client_request");
});

test("server guard prevents reopening terminal negotiation", () => {
  const result = validateNegotiationSubmission({
    party: "owner",
    session: {
      clientBundle: clientRequest(),
      ownerBundle: owner({ negotiationDecision: "accept" })
    },
    bundle: owner({ negotiationDecision: "counter", counterPreference: "fixed" })
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "negotiation_terminal");
});
