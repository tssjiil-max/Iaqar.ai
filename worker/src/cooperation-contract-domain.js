export const COOPERATION_SUBCONTRACT_STATUS = Object.freeze({
  NOT_STARTED: "not_started",
  DRAFT: "draft",
  PENDING_SIGNATURE: "pending_signature",
  SIGNED: "signed",
  CANCELLED: "cancelled"
});

export const COOPERATION_TRANSACTION_OWNER = Object.freeze({
  COOPERATION: "cooperationRequests",
  NEGOTIATION: "coordinationSessions",
  VIEWING: "matches",
  DEAL: "deals"
});

const STATUS_VALUES = new Set(Object.values(COOPERATION_SUBCONTRACT_STATUS));

const DELEGATED_ACTION_OWNER = Object.freeze({
  FOLLOW_CUSTOMER: COOPERATION_TRANSACTION_OWNER.NEGOTIATION,
  FOLLOW_OWNER: COOPERATION_TRANSACTION_OWNER.NEGOTIATION,
  CUSTOMER_INTERESTED: COOPERATION_TRANSACTION_OWNER.NEGOTIATION,
  CUSTOMER_NOT_SUITABLE: COOPERATION_TRANSACTION_OWNER.NEGOTIATION,
  PROPERTY_AVAILABLE: COOPERATION_TRANSACTION_OWNER.NEGOTIATION,
  PROPERTY_UNAVAILABLE: COOPERATION_TRANSACTION_OWNER.NEGOTIATION,
  CONFIRM_APPOINTMENT: COOPERATION_TRANSACTION_OWNER.VIEWING,
  PRELIMINARY_AGREEMENT: COOPERATION_TRANSACTION_OWNER.DEAL,
  CONFIRM_COMPLETION: COOPERATION_TRANSACTION_OWNER.DEAL
});

function text(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function upper(value) {
  return text(value).toUpperCase();
}

export function normalizeCooperationSubcontractStatus(record = {}) {
  const value = lower(record.subcontractStatus || record.cooperationSubcontractStatus);
  return STATUS_VALUES.has(value) ? value : COOPERATION_SUBCONTRACT_STATUS.NOT_STARTED;
}

export function cooperationSubcontractIsSigned(record = {}) {
  return normalizeCooperationSubcontractStatus(record) === COOPERATION_SUBCONTRACT_STATUS.SIGNED;
}

export function canonicalOwnerForCooperationWorkflowAction(action = "") {
  const key = upper(action);
  return DELEGATED_ACTION_OWNER[key] || COOPERATION_TRANSACTION_OWNER.COOPERATION;
}

export function cooperationWorkflowActionIsDelegated(action = "") {
  return canonicalOwnerForCooperationWorkflowAction(action) !== COOPERATION_TRANSACTION_OWNER.COOPERATION;
}

export function planAcceptedCooperationSubcontract({ cooperation = {}, now = new Date() } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const iso = Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString();
  return {
    subcontractRequired: true,
    subcontractStatus: COOPERATION_SUBCONTRACT_STATUS.NOT_STARTED,
    subcontractReference: text(cooperation.subcontractReference),
    primaryBrokerageContractId: text(cooperation.primaryBrokerageContractId),
    subcontractUpdatedAt: iso
  };
}

export function planCooperationSubcontractUpdate({
  cooperation = {},
  requestedStatus = "",
  subcontractReference = "",
  primaryBrokerageContractId = "",
  now = new Date()
} = {}) {
  const cooperationStatus = upper(cooperation.status);
  if (cooperationStatus !== "ACCEPTED") {
    return { ok: false, reason: "cooperation_not_accepted" };
  }

  const current = normalizeCooperationSubcontractStatus(cooperation);
  const requested = lower(requestedStatus);
  if (!STATUS_VALUES.has(requested)) {
    return { ok: false, reason: "subcontract_status_invalid", current, requested };
  }
  if (current === COOPERATION_SUBCONTRACT_STATUS.SIGNED) {
    if (requested === current) return { ok: true, idempotent: true, current, requested, patch: {} };
    return { ok: false, reason: "signed_subcontract_terminal", current, requested };
  }
  if (current === COOPERATION_SUBCONTRACT_STATUS.CANCELLED && requested !== COOPERATION_SUBCONTRACT_STATUS.DRAFT) {
    return { ok: false, reason: "cancelled_subcontract_requires_new_draft", current, requested };
  }

  const allowed = new Set([
    `${COOPERATION_SUBCONTRACT_STATUS.NOT_STARTED}:${COOPERATION_SUBCONTRACT_STATUS.DRAFT}`,
    `${COOPERATION_SUBCONTRACT_STATUS.NOT_STARTED}:${COOPERATION_SUBCONTRACT_STATUS.PENDING_SIGNATURE}`,
    `${COOPERATION_SUBCONTRACT_STATUS.DRAFT}:${COOPERATION_SUBCONTRACT_STATUS.PENDING_SIGNATURE}`,
    `${COOPERATION_SUBCONTRACT_STATUS.DRAFT}:${COOPERATION_SUBCONTRACT_STATUS.SIGNED}`,
    `${COOPERATION_SUBCONTRACT_STATUS.DRAFT}:${COOPERATION_SUBCONTRACT_STATUS.CANCELLED}`,
    `${COOPERATION_SUBCONTRACT_STATUS.PENDING_SIGNATURE}:${COOPERATION_SUBCONTRACT_STATUS.SIGNED}`,
    `${COOPERATION_SUBCONTRACT_STATUS.PENDING_SIGNATURE}:${COOPERATION_SUBCONTRACT_STATUS.CANCELLED}`,
    `${COOPERATION_SUBCONTRACT_STATUS.CANCELLED}:${COOPERATION_SUBCONTRACT_STATUS.DRAFT}`
  ]);
  if (requested !== current && !allowed.has(`${current}:${requested}`)) {
    return { ok: false, reason: "subcontract_transition_invalid", current, requested };
  }

  const primaryId = text(primaryBrokerageContractId || cooperation.primaryBrokerageContractId);
  const reference = text(subcontractReference || cooperation.subcontractReference);
  if (requested === COOPERATION_SUBCONTRACT_STATUS.SIGNED && !primaryId) {
    return { ok: false, reason: "primary_brokerage_contract_required", current, requested };
  }
  if (requested === COOPERATION_SUBCONTRACT_STATUS.SIGNED && !reference) {
    return { ok: false, reason: "subcontract_reference_required", current, requested };
  }

  const at = now instanceof Date ? now : new Date(now);
  const iso = Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString();
  const patch = {
    subcontractRequired: true,
    subcontractStatus: requested,
    subcontractReference: reference,
    primaryBrokerageContractId: primaryId,
    subcontractUpdatedAt: iso
  };
  if (requested === COOPERATION_SUBCONTRACT_STATUS.SIGNED) patch.subcontractSignedAt = iso;
  if (requested === COOPERATION_SUBCONTRACT_STATUS.CANCELLED) patch.subcontractCancelledAt = iso;

  return { ok: true, idempotent: requested === current, current, requested, patch };
}

export function cooperationCleanupBoundaryGuarantees() {
  return {
    cooperationSourceOfTruth: COOPERATION_TRANSACTION_OWNER.COOPERATION,
    negotiationSourceOfTruth: COOPERATION_TRANSACTION_OWNER.NEGOTIATION,
    viewingSourceOfTruth: COOPERATION_TRANSACTION_OWNER.VIEWING,
    dealSourceOfTruth: COOPERATION_TRANSACTION_OWNER.DEAL,
    cooperationOwnsTransactionStage: false,
    acceptanceAutoSignsSubcontract: false,
    primaryBrokerageContractRequiredForSignedSubcontract: true,
    opportunityOwnershipTransferAllowed: false,
    propertyOfficeChangesOnAcceptance: false,
    clientOfficeChangesOnAcceptance: false,
    contactVisibleBeforePermission: false
  };
}
