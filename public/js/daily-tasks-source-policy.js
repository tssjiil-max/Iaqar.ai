/**
 * Daily Tasks source policy.
 *
 * Mixed mode is retained for shadow comparison only. Operations-only may be
 * activated only after measured coverage proves there are no critical gaps or
 * duplicate active tasks.
 */

export const DAILY_TASK_SOURCE_MODE = Object.freeze({
  MIXED_SHADOW: "MIXED_SHADOW",
  OPERATIONS_ONLY: "OPERATIONS_ONLY"
});

export const DAILY_TASK_OPERATIONS_ACTIVATION = Object.freeze({
  requiredCoveragePercent: 100,
  maxDuplicateActiveTasks: 0,
  maxUncoveredCriticalTypes: 0,
  minimumShadowCycles: 1,
  topHomeTasks: 5
});

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function evaluateOperationsOnlyActivation({
  coveragePercent = 0,
  duplicateActiveTasks = 0,
  uncoveredCriticalTypes = [],
  shadowCycles = 0
} = {}) {
  const uncovered = Array.isArray(uncoveredCriticalTypes)
    ? uncoveredCriticalTypes.filter(Boolean)
    : [];
  const reasons = [];
  if (number(coveragePercent) < DAILY_TASK_OPERATIONS_ACTIVATION.requiredCoveragePercent) {
    reasons.push("coverage_below_100");
  }
  if (number(duplicateActiveTasks) > DAILY_TASK_OPERATIONS_ACTIVATION.maxDuplicateActiveTasks) {
    reasons.push("duplicate_active_tasks");
  }
  if (uncovered.length > DAILY_TASK_OPERATIONS_ACTIVATION.maxUncoveredCriticalTypes) {
    reasons.push("uncovered_critical_types");
  }
  if (number(shadowCycles) < DAILY_TASK_OPERATIONS_ACTIVATION.minimumShadowCycles) {
    reasons.push("shadow_cycle_required");
  }
  return {
    allowed: reasons.length === 0,
    reasons,
    mode: reasons.length === 0
      ? DAILY_TASK_SOURCE_MODE.OPERATIONS_ONLY
      : DAILY_TASK_SOURCE_MODE.MIXED_SHADOW
  };
}

function activeId(item = {}) {
  return String(item.id || item.operationId || item.recordId || "").trim();
}

export function selectDailyTaskSource({
  operations = [],
  intake = [],
  opportunities = [],
  matches = [],
  deals = [],
  workspace = []
} = {}, { mode = DAILY_TASK_SOURCE_MODE.MIXED_SHADOW } = {}) {
  if (mode === DAILY_TASK_SOURCE_MODE.OPERATIONS_ONLY) {
    return [...operations];
  }
  const out = [];
  const seen = new Set();
  for (const item of [
    ...operations,
    ...intake,
    ...opportunities,
    ...matches,
    ...deals,
    ...workspace
  ]) {
    const id = activeId(item);
    const key = id ? `${String(item.recordType || item.operationType || "record")}:${id}` : "";
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
    homeTopTaskCount: DAILY_TASK_OPERATIONS_ACTIVATION.topHomeTasks,
    businessEntitiesRemainSourceOfTruth: true
  };
}
