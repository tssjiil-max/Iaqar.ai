/**
 * Post-match lifecycle contract.
 *
 * Source-of-truth boundaries:
 * - coordinationSessions owns negotiation / party decision state.
 * - matches owns viewing candidate + confirmed appointment projection.
 * - deals owns commercial lifecycle after a Deal exists.
 * - operations is a work projection only and never owns business state.
 */

export const POST_MATCH_SOURCE_OF_TRUTH = Object.freeze({
  NEGOTIATION: "coordinationSessions",
  VIEWING: "matches",
  DEAL: "deals",
  TASKS: "operations"
});

export const POST_MATCH_STAGE = Object.freeze({
  MATCH_REVIEW: "MATCH_REVIEW",
  NEGOTIATION: "NEGOTIATION",
  VIEWING_CANDIDATE: "VIEWING_CANDIDATE",
  VIEWING_CONFIRMED: "VIEWING_CONFIRMED",
  VIEWING_COMPLETED: "VIEWING_COMPLETED",
  DEAL_CONTACT: "DEAL_CONTACT",
  DEAL_VIEWING: "DEAL_VIEWING",
  DEAL_NEGOTIATION: "DEAL_NEGOTIATION",
  DEAL_AGREEMENT: "DEAL_AGREEMENT",
  DEAL_CLOSING: "DEAL_CLOSING",
  CLOSED: "CLOSED",
  LOST: "LOST"
});

export const DEAL_STAGE_ORDER = Object.freeze([
  "contact",
  "viewing",
  "negotiation",
  "agreement",
  "closing",
  "closed"
]);

export const TERMINAL_DEAL_STAGES = Object.freeze(["closed", "lost"]);

function text(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function upper(value) {
  return text(value).toUpperCase();
}

function dealStageToPostMatch(stage = "") {
  switch (lower(stage)) {
    case "contact": return POST_MATCH_STAGE.DEAL_CONTACT;
    case "viewing": return POST_MATCH_STAGE.DEAL_VIEWING;
    case "negotiation": return POST_MATCH_STAGE.DEAL_NEGOTIATION;
    case "agreement": return POST_MATCH_STAGE.DEAL_AGREEMENT;
    case "closing": return POST_MATCH_STAGE.DEAL_CLOSING;
    case "closed": return POST_MATCH_STAGE.CLOSED;
    case "lost": return POST_MATCH_STAGE.LOST;
    default: return "";
  }
}

export function isTerminalDeal(deal = {}) {
  const stage = lower(deal.workflowStage || deal.stage);
  const status = lower(deal.status);
  return TERMINAL_DEAL_STAGES.includes(stage) || TERMINAL_DEAL_STAGES.includes(status);
}

export function resolvePostMatchStage({ match = {}, coordination = {}, deal = null } = {}) {
  if (deal && Object.keys(deal).length) {
    const stage = dealStageToPostMatch(deal.workflowStage || deal.stage || deal.status);
    if (stage) return stage;
  }

  const livingStage = upper(match.livingStage);
  if (text(match.viewingCompletedAt) || livingStage === POST_MATCH_STAGE.VIEWING_COMPLETED) {
    return POST_MATCH_STAGE.VIEWING_COMPLETED;
  }
  const appointmentStatus = upper(match.appointmentStatus);
  if (appointmentStatus === "CONFIRMED" || text(match.viewingAt) || text(match.appointmentAt)) {
    return POST_MATCH_STAGE.VIEWING_CONFIRMED;
  }
  if (appointmentStatus === "CANDIDATE" || text(match.viewingCandidateAt)) {
    return POST_MATCH_STAGE.VIEWING_CANDIDATE;
  }

  const outcome = upper(coordination.outcome || match.coordinationOutcome);
  if (outcome === "VIEWING_READY") return POST_MATCH_STAGE.VIEWING_CANDIDATE;
  if (outcome && outcome !== "AWAITING_OTHER_PARTY") return POST_MATCH_STAGE.NEGOTIATION;

  if (livingStage.includes("NEGOTIATION") || livingStage.includes("COORDINATION")) {
    return POST_MATCH_STAGE.NEGOTIATION;
  }
  return POST_MATCH_STAGE.MATCH_REVIEW;
}

export function nextDealStage(current = "contact") {
  const safe = lower(current);
  if (safe === "lost" || safe === "closed") return safe;
  const index = DEAL_STAGE_ORDER.indexOf(safe);
  if (index < 0) return "contact";
  return DEAL_STAGE_ORDER[Math.min(index + 1, DEAL_STAGE_ORDER.length - 1)];
}

export function validateDealTransition(current = "contact", requested = "") {
  const from = lower(current) || "contact";
  const to = lower(requested);
  if (from === "closed" || from === "lost") {
    return { ok: false, reason: "terminal_deal" };
  }
  if (to === "lost") return { ok: true, from, to };
  const fromIndex = DEAL_STAGE_ORDER.indexOf(from);
  const toIndex = DEAL_STAGE_ORDER.indexOf(to);
  if (fromIndex < 0 || toIndex < 0) return { ok: false, reason: "invalid_stage" };
  if (toIndex < fromIndex) return { ok: false, reason: "backward_transition" };
  if (toIndex > fromIndex + 1) return { ok: false, reason: "skipped_stage" };
  return { ok: true, from, to };
}

export function canCreateDeal({ match = {}, coordination = {} } = {}) {
  const outcome = upper(coordination.outcome || match.coordinationOutcome);
  const stage = resolvePostMatchStage({ match, coordination });
  const seriousCoordination = [
    "NEGOTIATION_READY",
    "AGREEMENT_READY",
    "BOTH_INTERESTED",
    "PRICE_ALIGNED"
  ].includes(outcome);
  const seriousIntent = match.seriousIntentConfirmed === true || upper(match.seriousIntentConfirmed) === "TRUE";
  const completedViewingSerious = stage === POST_MATCH_STAGE.VIEWING_COMPLETED && seriousIntent;
  return {
    allowed: seriousCoordination || completedViewingSerious,
    reason: completedViewingSerious
      ? "viewing_completed_serious"
      : seriousCoordination
        ? "serious_coordination"
        : "not_serious_yet"
  };
}

export const POST_MATCH_EVENT = Object.freeze({
  COORDINATION_UPDATED: "COORDINATION_UPDATED",
  VIEWING_CONFIRMED: "VIEWING_CONFIRMED",
  VIEWING_COMPLETED: "VIEWING_COMPLETED",
  DEAL_CREATED: "DEAL_CREATED",
  DEAL_STAGE_CHANGED: "DEAL_STAGE_CHANGED",
  DEAL_LOST: "DEAL_LOST",
  DEAL_CLOSED: "DEAL_CLOSED"
});

/**
 * Pure transition planner. It does not write Firestore or send messages.
 * The Worker service layer may apply the returned patches to the named owners.
 */
export function planPostMatchTransition({ event, match = {}, coordination = {}, deal = null, payload = {} } = {}) {
  const type = upper(event);
  if (!Object.values(POST_MATCH_EVENT).includes(type)) {
    return { ok: false, reason: "unknown_event", writes: [] };
  }

  if (type === POST_MATCH_EVENT.COORDINATION_UPDATED) {
    return {
      ok: true,
      writes: [
        { target: POST_MATCH_SOURCE_OF_TRUTH.NEGOTIATION, mode: "authoritative" },
        { target: "matches", mode: "projection" },
        { target: POST_MATCH_SOURCE_OF_TRUTH.TASKS, mode: "projection" }
      ],
      createsDeal: false,
      sendsMessage: false
    };
  }

  if (type === POST_MATCH_EVENT.VIEWING_CONFIRMED) {
    if (!text(payload.appointmentAt || match.viewingCandidateAt || match.appointmentAt)) {
      return { ok: false, reason: "viewing_time_required", writes: [] };
    }
    return {
      ok: true,
      writes: [
        { target: POST_MATCH_SOURCE_OF_TRUTH.VIEWING, mode: "authoritative" },
        { target: POST_MATCH_SOURCE_OF_TRUTH.TASKS, mode: "projection" }
      ],
      createsDeal: false,
      sendsMessage: false
    };
  }

  if (type === POST_MATCH_EVENT.VIEWING_COMPLETED) {
    if (!text(payload.completedAt || match.viewingCompletedAt)) {
      return { ok: false, reason: "viewing_completion_required", writes: [] };
    }
    return {
      ok: true,
      writes: [
        { target: POST_MATCH_SOURCE_OF_TRUTH.VIEWING, mode: "authoritative" },
        { target: POST_MATCH_SOURCE_OF_TRUTH.TASKS, mode: "projection" }
      ],
      createsDeal: false,
      sendsMessage: false
    };
  }

  if (type === POST_MATCH_EVENT.DEAL_CREATED) {
    const eligibility = canCreateDeal({ match, coordination });
    if (!eligibility.allowed) return { ok: false, reason: eligibility.reason, writes: [] };
    return {
      ok: true,
      writes: [
        { target: POST_MATCH_SOURCE_OF_TRUTH.DEAL, mode: "authoritative" },
        { target: "matches", mode: "projection" },
        { target: POST_MATCH_SOURCE_OF_TRUTH.TASKS, mode: "projection" }
      ],
      createsDeal: true,
      sendsMessage: false
    };
  }

  if (type === POST_MATCH_EVENT.DEAL_STAGE_CHANGED) {
    if (!deal) return { ok: false, reason: "deal_required", writes: [] };
    const transition = validateDealTransition(deal.workflowStage || deal.stage || "contact", payload.stage);
    if (!transition.ok) return { ok: false, reason: transition.reason, writes: [] };
    return {
      ok: true,
      writes: [
        { target: POST_MATCH_SOURCE_OF_TRUTH.DEAL, mode: "authoritative" },
        { target: POST_MATCH_SOURCE_OF_TRUTH.TASKS, mode: "projection" }
      ],
      transition,
      sendsMessage: false
    };
  }

  if (type === POST_MATCH_EVENT.DEAL_LOST || type === POST_MATCH_EVENT.DEAL_CLOSED) {
    if (!deal) return { ok: false, reason: "deal_required", writes: [] };
    return {
      ok: true,
      writes: [
        { target: POST_MATCH_SOURCE_OF_TRUTH.DEAL, mode: "authoritative" },
        { target: "matches", mode: "projection" },
        { target: POST_MATCH_SOURCE_OF_TRUTH.TASKS, mode: "projection_close" }
      ],
      terminal: type === POST_MATCH_EVENT.DEAL_CLOSED ? "closed" : "lost",
      sendsMessage: false
    };
  }

  return { ok: false, reason: "unhandled_event", writes: [] };
}

export function postMatchBoundaryGuarantees() {
  return {
    negotiationSource: POST_MATCH_SOURCE_OF_TRUTH.NEGOTIATION,
    viewingSource: POST_MATCH_SOURCE_OF_TRUTH.VIEWING,
    dealSource: POST_MATCH_SOURCE_OF_TRUTH.DEAL,
    dailyTasksSource: POST_MATCH_SOURCE_OF_TRUTH.TASKS,
    operationOwnsBusinessState: false,
    partyReplyAutoCreatesDeal: false,
    viewingConfirmationAutoCreatesDeal: false,
    viewingCompletionAutoCreatesDeal: false,
    autoSendsWhatsApp: false,
    autoSendsTelegram: false,
    exposesCounterpartyContact: false,
    transfersOpportunityOwnership: false
  };
}
