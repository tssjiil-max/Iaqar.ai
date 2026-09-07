import {
  listMissingOpportunityFields,
  upsertOpportunityReviewOperation,
  upsertOpportunityFollowUpOperation,
  upsertDealActionOperation
} from "./operations-service.js";

export const COVERAGE_INTENT = Object.freeze({
  MISSING_DATA: "MISSING_DATA",
  OPPORTUNITY_REVIEW: "OPPORTUNITY_REVIEW",
  OPPORTUNITY_FOLLOW_UP: "OPPORTUNITY_FOLLOW_UP",
  DEAL_ACTION: "DEAL_ACTION",
  NONE: "NONE"
});

const TERMINAL_OPPORTUNITY = new Set(["ARCHIVED", "CLOSED", "COMPLETED", "LOST"]);
const ACTIVE_FOLLOW_UP = new Set(["scheduled", "reminder_due", "reminder_sent", "SCHEDULED", "REMINDER_DUE", "REMINDER_SENT"]);

function validIso(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function opportunityCoverageIntent(opportunity = {}) {
  const lifecycle = String(opportunity.lifecycleStatus || opportunity.internalStatus || "").toUpperCase();
  if (TERMINAL_OPPORTUNITY.has(lifecycle)) {
    return { intent: COVERAGE_INTENT.NONE, reason: "terminal_opportunity", dueAt: "" };
  }

  const missingFields = listMissingOpportunityFields(opportunity);
  if (missingFields.length) {
    return { intent: COVERAGE_INTENT.MISSING_DATA, reason: "missing_data_authoritative", missingFields, dueAt: "" };
  }

  const followUp = opportunity.followUp && typeof opportunity.followUp === "object" ? opportunity.followUp : {};
  const followStatus = String(followUp.status || "");
  const dueAt = validIso(followUp.at || opportunity.nextFollowUpAt || opportunity.followUpAt || opportunity.nextActionAt || "");
  if (dueAt && (!followStatus || ACTIVE_FOLLOW_UP.has(followStatus))) {
    return { intent: COVERAGE_INTENT.OPPORTUNITY_FOLLOW_UP, reason: "scheduled_follow_up", dueAt };
  }

  return { intent: COVERAGE_INTENT.OPPORTUNITY_REVIEW, reason: "reviewable_opportunity", dueAt: "" };
}

export async function syncOpportunityCoverage({
  projectId,
  officeId,
  opportunity,
  opportunityId,
  accessToken,
  deps,
  notifyPush = false
}) {
  const decision = opportunityCoverageIntent(opportunity);
  if (decision.intent === COVERAGE_INTENT.NONE || decision.intent === COVERAGE_INTENT.MISSING_DATA) {
    return { ...decision, skipped: true };
  }

  if (decision.intent === COVERAGE_INTENT.OPPORTUNITY_FOLLOW_UP) {
    const result = await upsertOpportunityFollowUpOperation({
      projectId,
      officeId,
      opportunity,
      opportunityId,
      dueAt: decision.dueAt,
      note: opportunity.nextActionNote || opportunity.followUp?.note || "",
      recipientMode: opportunity.followUp?.recipientMode || "",
      accessToken,
      deps,
      notifyPush
    });
    return { ...decision, skipped: false, result };
  }

  const result = await upsertOpportunityReviewOperation({
    projectId,
    officeId,
    opportunity,
    opportunityId,
    accessToken,
    deps,
    notifyPush
  });
  return { ...decision, skipped: false, result };
}

export async function syncDealCoverage({
  projectId,
  officeId,
  deal,
  dealId,
  accessToken,
  deps,
  notifyPush = false
}) {
  const result = await upsertDealActionOperation({
    projectId,
    officeId,
    deal,
    dealId,
    accessToken,
    deps,
    notifyPush
  });
  return {
    intent: result?.reason === "terminal_deal" ? COVERAGE_INTENT.NONE : COVERAGE_INTENT.DEAL_ACTION,
    skipped: result?.reason === "terminal_deal",
    result
  };
}

/**
 * Mirrors viewing fields onto an already-linked Match Operation.
 * The Match remains the source of truth; this is only an Operations projection.
 */
export async function syncMatchViewingCoverage({
  projectId,
  officeId,
  match,
  accessToken,
  deps
}) {
  const operationId = String(match?.operationId || "").trim();
  if (!operationId) return { updated: false, reason: "missing_operation_id" };

  const appointmentAt = validIso(match.appointmentAt || match.viewingCandidateAt || "");
  const viewingAt = validIso(match.viewingAt || match.appointmentAt || match.viewingCandidateAt || "");
  const appointmentStatus = String(match.appointmentStatus || "").trim();
  if (!appointmentAt && !viewingAt && !appointmentStatus) {
    return { updated: false, reason: "no_viewing_fields" };
  }

  const now = new Date();
  const fields = {
    updatedAt: deps.firestoreHelpers.firestoreTimestamp(now)
  };
  if (appointmentAt) fields.appointmentAt = deps.firestoreHelpers.firestoreString(appointmentAt);
  if (viewingAt) fields.viewingAt = deps.firestoreHelpers.firestoreString(viewingAt);
  if (appointmentStatus) fields.appointmentStatus = deps.firestoreHelpers.firestoreString(appointmentStatus);

  await deps.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "operations", operationId],
    accessToken,
    fields
  });

  return {
    updated: true,
    operationId,
    appointmentAt,
    viewingAt,
    appointmentStatus
  };
}
