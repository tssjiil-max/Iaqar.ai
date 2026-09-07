/**
 * Daily Tasks source policy.
 *
 * Business entities remain the source of truth. Operations are the work-queue
 * projection. Legacy entity-derived cards may be observed only as shadow
 * evidence; they must never be silently dropped until the activation audit
 * proves full Operations coverage.
 */

export const DAILY_TASK_SOURCE_MODE = Object.freeze({
  MIXED_SHADOW: "MIXED_SHADOW",
  OPERATIONS_ONLY: "OPERATIONS_ONLY"
});

export const DAILY_TASK_REQUIRED_OPERATION_TYPES = Object.freeze([
  "MATCH_REVIEW",
  "MISSING_DATA",
  "OPPORTUNITY_REVIEW",
  "OPPORTUNITY_FOLLOW_UP",
  "DEAL_ACTION",
  "COOPERATION_REQUEST",
  "COOPERATION_RESPONSE",
  "COOPERATION_MATCH",
  "EXTERNAL_RESPONSE",
  "SYSTEM_ACTION",
  "PLATFORM_OPPORTUNITY_OFFER"
]);

export const DAILY_TASK_OPERATIONS_ACTIVATION = Object.freeze({
  requiredCoveragePercent: 100,
  maxDuplicateActiveTasks: 0,
  maxUncoveredBusinessEntities: 0,
  maxShadowFailures: 0,
  maxMissingRequiredOperationTypes: 0,
  minimumShadowCycles: 1,
  topHomeTasks: 5
});

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value) {
  return String(value ?? "").trim();
}

function operationType(item = {}) {
  return text(item.operationType || item.type).toUpperCase();
}

export function operationBusinessKey(item = {}) {
  const type = operationType(item);
  if (["MISSING_DATA", "OPPORTUNITY_REVIEW", "OPPORTUNITY_FOLLOW_UP"].includes(type)) {
    const id = text(item.opportunityId || item.sourceEntityId);
    return id ? `opportunity:${id}` : "";
  }
  if (type === "MATCH_REVIEW") {
    const id = text(item.matchId || item.sourceEntityId);
    return id ? `match:${id}` : "";
  }
  if (type === "DEAL_ACTION") {
    const id = text(item.dealId || item.sourceEntityId);
    return id ? `deal:${id}` : "";
  }
  if (["COOPERATION_REQUEST", "COOPERATION_RESPONSE", "COOPERATION_MATCH"].includes(type)) {
    const id = text(item.cooperationId || item.sourceEntityId);
    return id ? `cooperation:${id}` : "";
  }
  const sourceType = text(item.sourceEntityType).toLowerCase();
  const sourceId = text(item.sourceEntityId || item.opportunityId || item.matchId || item.dealId || item.cooperationId);
  return sourceType && sourceId ? `${sourceType}:${sourceId}` : "";
}

export function legacyBusinessKey(item = {}) {
  const recordType = text(item.recordType || item.sourceEntityType).toLowerCase();
  if (recordType === "operation") return operationBusinessKey(item);
  if (recordType === "opportunity") {
    const id = text(item.opportunityId || item.recordId || item.id);
    return id ? `opportunity:${id}` : "";
  }
  if (recordType === "match") {
    const id = text(item.matchId || item.recordId || item.id);
    return id ? `match:${id}` : "";
  }
  if (recordType === "deal") {
    const id = text(item.dealId || item.recordId || item.id);
    return id ? `deal:${id}` : "";
  }
  if (recordType === "cooperation") {
    const id = text(item.cooperationId || item.recordId || item.id);
    return id ? `cooperation:${id}` : "";
  }
  // Raw intake/workspace cards are upstream/transient UI artefacts, not a
  // business work-queue source. If intake already resolved to an Opportunity,
  // compare it through that canonical Opportunity id.
  if (recordType === "intake" && text(item.opportunityId)) {
    return `opportunity:${text(item.opportunityId)}`;
  }
  return "";
}

export function auditDailyTaskCoverage({
  operations = [],
  legacyItems = [],
  supportedOperationTypes = DAILY_TASK_REQUIRED_OPERATION_TYPES,
  shadowCycles = 1,
  shadowFailures = 0
} = {}) {
  const operationKeys = new Set();
  const semanticOperationKeys = new Map();
  for (const item of operations || []) {
    const businessKey = operationBusinessKey(item);
    if (businessKey) operationKeys.add(businessKey);
    const semanticKey = businessKey ? `${operationType(item)}:${businessKey}` : "";
    if (semanticKey) semanticOperationKeys.set(semanticKey, (semanticOperationKeys.get(semanticKey) || 0) + 1);
  }

  const legacyKeys = [...new Set((legacyItems || []).map(legacyBusinessKey).filter(Boolean))];
  const uncoveredBusinessEntities = legacyKeys.filter((key) => !operationKeys.has(key));
  const covered = legacyKeys.length - uncoveredBusinessEntities.length;
  const coveragePercent = legacyKeys.length ? Math.round((covered / legacyKeys.length) * 100) : 100;
  const duplicateActiveTasks = [...semanticOperationKeys.values()].reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0
  );
  const supported = new Set((supportedOperationTypes || []).map((value) => text(value).toUpperCase()).filter(Boolean));
  const missingRequiredOperationTypes = DAILY_TASK_REQUIRED_OPERATION_TYPES.filter((type) => !supported.has(type));

  return {
    coveragePercent,
    coveredBusinessEntities: covered,
    observedBusinessEntities: legacyKeys.length,
    duplicateActiveTasks,
    uncoveredBusinessEntities,
    shadowCycles: Math.max(0, Math.floor(number(shadowCycles))),
    shadowFailures: Math.max(0, Math.floor(number(shadowFailures))),
    missingRequiredOperationTypes
  };
}

export function evaluateOperationsOnlyActivation({
  coveragePercent = 0,
  duplicateActiveTasks = 0,
  uncoveredBusinessEntities = [],
  uncoveredCriticalTypes = [],
  shadowFailures = 0,
  missingRequiredOperationTypes = [],
  shadowSourcesReady = true,
  shadowCycles = 0
} = {}) {
  const uncovered = Array.isArray(uncoveredBusinessEntities)
    ? uncoveredBusinessEntities.filter(Boolean)
    : [];
  // Compatibility with the earlier gate shape while callers migrate.
  const uncoveredTypes = Array.isArray(uncoveredCriticalTypes)
    ? uncoveredCriticalTypes.filter(Boolean)
    : [];
  const missingTypes = Array.isArray(missingRequiredOperationTypes)
    ? missingRequiredOperationTypes.filter(Boolean)
    : [];
  const reasons = [];
  if (shadowSourcesReady !== true) reasons.push("shadow_sources_not_ready");
  if (number(coveragePercent) < DAILY_TASK_OPERATIONS_ACTIVATION.requiredCoveragePercent) reasons.push("coverage_below_100");
  if (number(duplicateActiveTasks) > DAILY_TASK_OPERATIONS_ACTIVATION.maxDuplicateActiveTasks) reasons.push("duplicate_active_tasks");
  if (uncovered.length > DAILY_TASK_OPERATIONS_ACTIVATION.maxUncoveredBusinessEntities) reasons.push("uncovered_business_entities");
  if (uncoveredTypes.length) reasons.push("uncovered_critical_types");
  if (number(shadowFailures) > DAILY_TASK_OPERATIONS_ACTIVATION.maxShadowFailures) reasons.push("shadow_failures");
  if (missingTypes.length > DAILY_TASK_OPERATIONS_ACTIVATION.maxMissingRequiredOperationTypes) reasons.push("missing_required_operation_types");
  if (number(shadowCycles) < DAILY_TASK_OPERATIONS_ACTIVATION.minimumShadowCycles) reasons.push("shadow_cycle_required");
  return {
    allowed: reasons.length === 0,
    reasons,
    mode: reasons.length === 0 ? DAILY_TASK_SOURCE_MODE.OPERATIONS_ONLY : DAILY_TASK_SOURCE_MODE.MIXED_SHADOW
  };
}

function activeId(item = {}) {
  return text(item.id || item.operationId || item.recordId);
}

export function selectDailyTaskSource({
  operations = [],
  intake = [],
  opportunities = [],
  matches = [],
  deals = [],
  workspace = []
} = {}, { mode = DAILY_TASK_SOURCE_MODE.MIXED_SHADOW } = {}) {
  if (mode === DAILY_TASK_SOURCE_MODE.OPERATIONS_ONLY) return [...operations];
  const out = [];
  const seen = new Set();
  for (const item of [...operations, ...intake, ...opportunities, ...matches, ...deals, ...workspace]) {
    const id = activeId(item);
    const key = id ? `${text(item.recordType || item.operationType || "record")}:${id}` : "";
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(item);
  }
  return out;
}

export function topHomeDailyTasks(items = [], max = DAILY_TASK_OPERATIONS_ACTIVATION.topHomeTasks) {
  const limit = Math.max(0, Math.floor(number(max, DAILY_TASK_OPERATIONS_ACTIVATION.topHomeTasks)));
  return [...items].slice(0, limit);
}

export function dailyTaskSourceBoundaryGuarantees() {
  return {
    operationsOnlyIsTarget: true,
    mixedModeIsShadowOnly: true,
    requiresFullCoverage: true,
    requiresZeroActiveDuplicates: true,
    requiresZeroUncoveredBusinessEntities: true,
    requiresZeroShadowFailures: true,
    requiresAllOperationTypesSupported: true,
    requiresAllShadowSourcesReady: true,
    rawIntakeIsNotTaskTruth: true,
    homeTopTaskCount: DAILY_TASK_OPERATIONS_ACTIVATION.topHomeTasks,
    businessEntitiesRemainSourceOfTruth: true,
    operationsAreWorkQueueProjection: true
  };
}
