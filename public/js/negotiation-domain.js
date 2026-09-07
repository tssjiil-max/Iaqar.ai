/**
 * Canonical negotiation state machine.
 *
 * This module owns only price/condition negotiation between the client and
 * owner. It deliberately does not own property-details completion, viewing
 * scheduling, Deal lifecycle, messaging, or Operations projections.
 *
 * Persistence remains in coordinationSessions for backward compatibility.
 */

export const NEGOTIATION_STATE = Object.freeze({
  NOT_APPLICABLE: "NOT_APPLICABLE",
  WAITING_OWNER_BUNDLE: "WAITING_OWNER_BUNDLE",
  PENDING_OWNER_DECISION: "PENDING_OWNER_DECISION",
  COUNTER_PENDING_CLIENT: "COUNTER_PENDING_CLIENT",
  ACCEPTED: "ACCEPTED",
  BROKER_CONFIRMATION_REQUIRED: "BROKER_CONFIRMATION_REQUIRED",
  REJECTED: "REJECTED",
  CLIENT_REJECTED_COUNTER: "CLIENT_REJECTED_COUNTER",
  DEFERRED_TO_VIEWING: "DEFERRED_TO_VIEWING",
  PROPERTY_UNAVAILABLE: "PROPERTY_UNAVAILABLE"
});

export const NEGOTIATION_ACTOR = Object.freeze({
  OWNER: "OWNER",
  CLIENT: "CLIENT",
  BROKER: "BROKER",
  NONE: "NONE"
});

const TERMINAL_STATES = new Set([
  NEGOTIATION_STATE.ACCEPTED,
  NEGOTIATION_STATE.REJECTED,
  NEGOTIATION_STATE.CLIENT_REJECTED_COUNTER,
  NEGOTIATION_STATE.PROPERTY_UNAVAILABLE
]);

function text(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function positiveNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function isNegotiationRequested(clientBundle = {}) {
  return lower(clientBundle?.interestStatus) === "not_suitable"
    && lower(clientBundle?.rejectionDisposition) === "negotiable";
}

export function isNegotiationTerminal(state = "") {
  return TERMINAL_STATES.has(text(state).toUpperCase());
}

/**
 * Resolve the negotiation slice only.
 *
 * `handled:false` means another post-match domain (normally viewing or
 * information completion) must continue resolution. This is how
 * DISCUSS_AT_VIEWING leaves negotiation without pretending that price was
 * agreed.
 */
export function resolveNegotiationState({
  clientBundle = null,
  ownerBundle = null,
  canonicalOffer = {}
} = {}) {
  if (!clientBundle || !isNegotiationRequested(clientBundle)) {
    return {
      applies: false,
      handled: false,
      state: NEGOTIATION_STATE.NOT_APPLICABLE,
      nextActor: NEGOTIATION_ACTOR.NONE,
      terminal: false,
      agreedPrice: null,
      coordination: null
    };
  }

  if (!ownerBundle) {
    return {
      applies: true,
      handled: true,
      state: NEGOTIATION_STATE.WAITING_OWNER_BUNDLE,
      nextActor: NEGOTIATION_ACTOR.OWNER,
      terminal: false,
      agreedPrice: null,
      coordination: {
        outcome: "AWAITING_OTHER_PARTY",
        brokerLine: "جلسة تفاوض — بانتظار رد المالك",
        conflictField: ""
      }
    };
  }

  // Availability always wins. A non-existent property must never remain in a
  // fake "pending negotiation" state.
  if (lower(ownerBundle.propertyAvailability) === "not_available") {
    return {
      applies: true,
      handled: true,
      state: NEGOTIATION_STATE.PROPERTY_UNAVAILABLE,
      nextActor: NEGOTIATION_ACTOR.NONE,
      terminal: true,
      agreedPrice: null,
      coordination: {
        outcome: "PROPERTY_NOT_AVAILABLE",
        brokerLine: "العقار غير متاح",
        conflictField: ""
      }
    };
  }

  const ownerDecision = lower(ownerBundle.negotiationDecision);
  const clientResponse = lower(clientBundle.negotiationResponse);
  const clientPreference = lower(clientBundle.negotiationPreference);
  const ownerPreference = lower(ownerBundle.counterPreference);
  const deferredToViewing = clientPreference === "discuss_at_viewing"
    || ownerPreference === "discuss_at_viewing"
    || clientResponse === "viewing";

  if (!ownerDecision) {
    if (deferredToViewing) {
      return {
        applies: true,
        handled: false,
        state: NEGOTIATION_STATE.DEFERRED_TO_VIEWING,
        nextActor: NEGOTIATION_ACTOR.NONE,
        terminal: false,
        agreedPrice: null,
        coordination: null
      };
    }
    return {
      applies: true,
      handled: true,
      state: NEGOTIATION_STATE.PENDING_OWNER_DECISION,
      nextActor: NEGOTIATION_ACTOR.OWNER,
      terminal: false,
      agreedPrice: null,
      coordination: {
        outcome: "NEGOTIATION_PENDING_OWNER",
        brokerLine: "جلسة تفاوض — بانتظار رد المالك على شرط العميل",
        conflictField: "negotiationDecision"
      }
    };
  }

  if (ownerDecision === "accept") {
    const agreedPrice = positiveNumber(clientBundle.proposedPrice)
      || positiveNumber(canonicalOffer.salePrice || canonicalOffer.price || canonicalOffer.priceOrBudget);
    return {
      applies: true,
      handled: true,
      state: NEGOTIATION_STATE.ACCEPTED,
      nextActor: NEGOTIATION_ACTOR.BROKER,
      terminal: true,
      agreedPrice,
      coordination: {
        outcome: "NEGOTIATION_ACCEPTED",
        brokerLine: "جلسة تفاوض — وافق المالك صراحة على عرض العميل",
        conflictField: ""
      }
    };
  }

  if (ownerDecision === "reject") {
    return {
      applies: true,
      handled: true,
      state: NEGOTIATION_STATE.REJECTED,
      nextActor: NEGOTIATION_ACTOR.NONE,
      terminal: true,
      agreedPrice: null,
      coordination: {
        outcome: "NEGOTIATION_REJECTED",
        brokerLine: "جلسة تفاوض — المالك رفض شرط التفاوض",
        conflictField: ""
      }
    };
  }

  if (ownerDecision === "counter") {
    if (clientResponse === "accept") {
      return {
        applies: true,
        handled: true,
        state: NEGOTIATION_STATE.BROKER_CONFIRMATION_REQUIRED,
        nextActor: NEGOTIATION_ACTOR.BROKER,
        terminal: false,
        agreedPrice: positiveNumber(ownerBundle.counterPrice),
        coordination: {
          outcome: "NEEDS_BROKER",
          brokerLine: "اكتمل الاتفاق المبدئي — يتدخل الوسيط لتثبيت السعر والمعاينة",
          conflictField: ""
        }
      };
    }
    if (clientResponse === "reject") {
      return {
        applies: true,
        handled: true,
        state: NEGOTIATION_STATE.CLIENT_REJECTED_COUNTER,
        nextActor: NEGOTIATION_ACTOR.NONE,
        terminal: true,
        agreedPrice: null,
        coordination: {
          outcome: "CLIENT_NOT_INTERESTED",
          brokerLine: "العميل لم يقبل اقتراح المالك",
          conflictField: ""
        }
      };
    }
    if (deferredToViewing) {
      return {
        applies: true,
        handled: false,
        state: NEGOTIATION_STATE.DEFERRED_TO_VIEWING,
        nextActor: NEGOTIATION_ACTOR.NONE,
        terminal: false,
        agreedPrice: null,
        coordination: null
      };
    }
    return {
      applies: true,
      handled: true,
      state: NEGOTIATION_STATE.COUNTER_PENDING_CLIENT,
      nextActor: NEGOTIATION_ACTOR.CLIENT,
      terminal: false,
      agreedPrice: null,
      coordination: {
        outcome: "NEGOTIATION_COUNTERED",
        brokerLine: "جلسة تفاوض — المالك قدم اقتراحًا بديلًا ويلزم رد العميل",
        conflictField: ""
      }
    };
  }

  return {
    applies: true,
    handled: true,
    state: NEGOTIATION_STATE.PENDING_OWNER_DECISION,
    nextActor: NEGOTIATION_ACTOR.OWNER,
    terminal: false,
    agreedPrice: null,
    coordination: {
      outcome: "NEGOTIATION_PENDING_OWNER",
      brokerLine: "جلسة تفاوض — بانتظار قرار المالك",
      conflictField: "negotiationDecision"
    }
  };
}

/**
 * Server-side submission guard. UI validation alone is not authoritative.
 * Idempotent resubmissions should be detected by the caller before invoking
 * this guard.
 */
export function validateNegotiationSubmission({
  party = "client",
  session = {},
  bundle = {}
} = {}) {
  const side = lower(party) === "owner" ? "owner" : "client";
  const current = resolveNegotiationState({
    clientBundle: session.clientBundle || null,
    ownerBundle: session.ownerBundle || null
  });

  if (current.applies && isNegotiationTerminal(current.state)) {
    return { ok: false, reason: "negotiation_terminal", state: current.state };
  }

  if (side === "owner" && text(bundle.negotiationDecision)) {
    if (!isNegotiationRequested(session.clientBundle || {})) {
      return { ok: false, reason: "owner_decision_without_client_request", state: current.state };
    }
  }

  if (side === "client" && text(bundle.negotiationResponse)) {
    const ownerDecision = lower(session.ownerBundle?.negotiationDecision);
    if (ownerDecision !== "counter") {
      return { ok: false, reason: "client_response_without_owner_counter", state: current.state };
    }
  }

  return { ok: true, reason: "", state: current.state };
}

export function negotiationBoundaryGuarantees() {
  return {
    sourceOfTruth: "coordinationSessions",
    ownsViewing: false,
    ownsDealLifecycle: false,
    ownsOperations: false,
    acceptsFreeText: false,
    acceptsManualPrice: false,
    autoSendsMessage: false,
    exposesCounterpartyContact: false,
    legacyRepliesAreAuthoritative: false
  };
}
