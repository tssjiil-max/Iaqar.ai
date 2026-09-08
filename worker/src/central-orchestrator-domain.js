/**
 * Central orchestrator contract.
 *
 * The orchestrator routes deterministic domain events. AI/GPT may extract or
 * classify input, but never owns business state or silently advances a deal.
 */

export const ORCHESTRATOR_EVENT = Object.freeze({
  INTAKE_PERSISTED: "INTAKE_PERSISTED",
  OPPORTUNITY_COMPLETED: "OPPORTUNITY_COMPLETED",
  MATCH_CREATED: "MATCH_CREATED",
  COORDINATION_UPDATED: "COORDINATION_UPDATED",
  VIEWING_CONFIRMED: "VIEWING_CONFIRMED",
  VIEWING_COMPLETED: "VIEWING_COMPLETED",
  DEAL_CREATED: "DEAL_CREATED",
  DEAL_STAGE_CHANGED: "DEAL_STAGE_CHANGED",
  COOPERATION_UPDATED: "COOPERATION_UPDATED",
  NOTIFICATION_REQUESTED: "NOTIFICATION_REQUESTED"
});

export const ORCHESTRATOR_OWNER = Object.freeze({
  INTAKE: "canonical-intake-service",
  COMPLETION: "data-completion-service",
  MATCHING: "matching-engine",
  NEGOTIATION: "coordination-session-service",
  VIEWING: "matches",
  DEAL: "deals",
  COOPERATION: "cooperation-phase6-service",
  TASKS: "operations-service",
  NOTIFICATIONS: "notifications",
  AI: "extraction-only"
});

export function orchestratorRoute(event) {
  switch (String(event || "").toUpperCase()) {
    case ORCHESTRATOR_EVENT.INTAKE_PERSISTED:
      return { owner: ORCHESTRATOR_OWNER.INTAKE, next: [ORCHESTRATOR_OWNER.COMPLETION] };
    case ORCHESTRATOR_EVENT.OPPORTUNITY_COMPLETED:
      return { owner: ORCHESTRATOR_OWNER.COMPLETION, next: [ORCHESTRATOR_OWNER.MATCHING] };
    case ORCHESTRATOR_EVENT.MATCH_CREATED:
      return { owner: ORCHESTRATOR_OWNER.MATCHING, next: [ORCHESTRATOR_OWNER.TASKS, ORCHESTRATOR_OWNER.NEGOTIATION] };
    case ORCHESTRATOR_EVENT.COORDINATION_UPDATED:
      return { owner: ORCHESTRATOR_OWNER.NEGOTIATION, next: [ORCHESTRATOR_OWNER.VIEWING, ORCHESTRATOR_OWNER.TASKS] };
    case ORCHESTRATOR_EVENT.VIEWING_CONFIRMED:
    case ORCHESTRATOR_EVENT.VIEWING_COMPLETED:
      return { owner: ORCHESTRATOR_OWNER.VIEWING, next: [ORCHESTRATOR_OWNER.TASKS] };
    case ORCHESTRATOR_EVENT.DEAL_CREATED:
    case ORCHESTRATOR_EVENT.DEAL_STAGE_CHANGED:
      return { owner: ORCHESTRATOR_OWNER.DEAL, next: [ORCHESTRATOR_OWNER.TASKS] };
    case ORCHESTRATOR_EVENT.COOPERATION_UPDATED:
      return { owner: ORCHESTRATOR_OWNER.COOPERATION, next: [ORCHESTRATOR_OWNER.TASKS] };
    case ORCHESTRATOR_EVENT.NOTIFICATION_REQUESTED:
      return { owner: ORCHESTRATOR_OWNER.NOTIFICATIONS, next: [] };
    default:
      return { owner: "", next: [], error: "unknown_event" };
  }
}

export function aiMayPerform(action = "") {
  const allowed = new Set([
    "extract_text",
    "transcribe_audio",
    "classify_intent",
    "extract_listing_fields",
    "summarize"
  ]);
  return allowed.has(String(action || "").toLowerCase());
}

export function orchestratorBoundaryGuarantees() {
  return {
    gptOwnsBusinessState: false,
    gptRunsMatchingDecision: false,
    gptAdvancesDeal: false,
    gptTransfersOwnership: false,
    deterministicDomainServicesOwnState: true,
    notificationsAreSideEffects: true,
    operationsAreWorkProjection: true
  };
}
