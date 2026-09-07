import { canCreateDeal, validateDealTransition } from "./post-match-chain-domain.js";

export const DEAL_STAGE_ORDER = Object.freeze([
  "contact",
  "viewing",
  "negotiation",
  "agreement",
  "closing",
  "closed"
]);

export const BROKERAGE_CONTRACT_STATUS = Object.freeze({
  NOT_STARTED: "not_started",
  DRAFT: "draft",
  PENDING_SIGNATURE: "pending_signature",
  SIGNED: "signed",
  CANCELLED: "cancelled"
});

const CONTRACT_STATUS_VALUES = new Set(Object.values(BROKERAGE_CONTRACT_STATUS));

function text(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

export function nextDealStage(current = "contact") {
  const safe = DEAL_STAGE_ORDER.includes(lower(current)) ? lower(current) : "contact";
  return DEAL_STAGE_ORDER[Math.min(DEAL_STAGE_ORDER.indexOf(safe) + 1, DEAL_STAGE_ORDER.length - 1)];
}

export function normalizedBrokerageContractStatus(deal = {}) {
  const value = lower(deal.brokerageContractStatus || deal.contractStatus);
  return CONTRACT_STATUS_VALUES.has(value) ? value : BROKERAGE_CONTRACT_STATUS.NOT_STARTED;
}

export function brokerageContractIsSigned(deal = {}) {
  return normalizedBrokerageContractStatus(deal) === BROKERAGE_CONTRACT_STATUS.SIGNED;
}

export function evaluateDealCreation({ match = {}, coordination = {} } = {}) {
  const result = canCreateDeal({ match, coordination });
  return {
    allowed: Boolean(result.allowed),
    reason: result.reason || (result.allowed ? "eligible" : "not_serious_yet")
  };
}

export function planDealStageTransition({ deal = {}, requestedStage = "" } = {}) {
  const current = lower(deal.workflowStage || deal.stage || "contact") || "contact";
  const requested = lower(requestedStage);
  const transition = validateDealTransition(current, requested);
  if (!transition.ok) {
    return { ok: false, reason: transition.reason, current, requested };
  }
  if (requested === "closing" && !brokerageContractIsSigned(deal)) {
    return { ok: false, reason: "brokerage_contract_required", current, requested };
  }
  return { ok: true, current, requested, transition };
}

export function planDealClosure({ deal = {} } = {}) {
  const stage = lower(deal.workflowStage || deal.stage);
  const status = lower(deal.status);
  if (status === "closed" || stage === "closed") {
    return { ok: true, idempotent: true, stage: "closed" };
  }
  if (status === "lost" || stage === "lost") {
    return { ok: false, reason: "deal_not_open" };
  }
  if (stage !== "closing") {
    return { ok: false, reason: "deal_not_ready_to_close", stage };
  }
  if (!brokerageContractIsSigned(deal)) {
    return { ok: false, reason: "brokerage_contract_required", stage };
  }
  return { ok: true, idempotent: false, stage };
}

export function planBrokerageContractUpdate({ deal = {}, requestedStatus = "", reference = "", now = new Date() } = {}) {
  const current = normalizedBrokerageContractStatus(deal);
  const requested = lower(requestedStatus);
  if (!CONTRACT_STATUS_VALUES.has(requested)) {
    return { ok: false, reason: "contract_status_invalid", current, requested };
  }
  if (current === BROKERAGE_CONTRACT_STATUS.SIGNED) {
    if (requested === current) return { ok: true, idempotent: true, current, requested, patch: {} };
    return { ok: false, reason: "signed_contract_terminal", current, requested };
  }
  if (current === BROKERAGE_CONTRACT_STATUS.CANCELLED && requested !== BROKERAGE_CONTRACT_STATUS.DRAFT) {
    return { ok: false, reason: "cancelled_contract_requires_new_draft", current, requested };
  }

  const allowed = new Set([
    `${BROKERAGE_CONTRACT_STATUS.NOT_STARTED}:${BROKERAGE_CONTRACT_STATUS.DRAFT}`,
    `${BROKERAGE_CONTRACT_STATUS.NOT_STARTED}:${BROKERAGE_CONTRACT_STATUS.PENDING_SIGNATURE}`,
    `${BROKERAGE_CONTRACT_STATUS.DRAFT}:${BROKERAGE_CONTRACT_STATUS.PENDING_SIGNATURE}`,
    `${BROKERAGE_CONTRACT_STATUS.DRAFT}:${BROKERAGE_CONTRACT_STATUS.SIGNED}`,
    `${BROKERAGE_CONTRACT_STATUS.DRAFT}:${BROKERAGE_CONTRACT_STATUS.CANCELLED}`,
    `${BROKERAGE_CONTRACT_STATUS.PENDING_SIGNATURE}:${BROKERAGE_CONTRACT_STATUS.SIGNED}`,
    `${BROKERAGE_CONTRACT_STATUS.PENDING_SIGNATURE}:${BROKERAGE_CONTRACT_STATUS.CANCELLED}`,
    `${BROKERAGE_CONTRACT_STATUS.CANCELLED}:${BROKERAGE_CONTRACT_STATUS.DRAFT}`
  ]);
  if (requested !== current && !allowed.has(`${current}:${requested}`)) {
    return { ok: false, reason: "contract_transition_invalid", current, requested };
  }

  const at = now instanceof Date ? now : new Date(now);
  const iso = Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString();
  const patch = {
    brokerageContractRequired: true,
    brokerageContractStatus: requested,
    brokerageContractReference: text(reference || deal.brokerageContractReference),
    brokerageContractUpdatedAt: iso
  };
  if (requested === BROKERAGE_CONTRACT_STATUS.SIGNED) {
    patch.brokerageContractSignedAt = iso;
  }
  if (requested === BROKERAGE_CONTRACT_STATUS.CANCELLED) {
    patch.brokerageContractCancelledAt = iso;
  }
  return { ok: true, idempotent: requested === current, current, requested, patch };
}

export function dealContractBoundaryGuarantees() {
  return {
    dealSourceOfTruth: "deals",
    matchOwnsDealStage: false,
    operationOwnsDealStage: false,
    dealRequiresSeriousIntentBeforeCreation: true,
    brokerageContractRequiredBeforeClosing: true,
    dealStageSkippingAllowed: false,
    dealBackwardTransitionAllowed: false,
    signedContractMutable: false
  };
}
