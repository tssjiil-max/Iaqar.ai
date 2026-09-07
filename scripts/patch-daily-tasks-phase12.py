from pathlib import Path
import re

p = Path("public/js/workflow-office.js")
s = p.read_text()

state_anchor = '  const ACTIVE_OPERATION_STATUSES = Object.freeze(["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE"]);\n'
state_block = '''  const ACTIVE_OPERATION_STATUSES = Object.freeze(["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE"]);
  const DAILY_TASK_SOURCE_MODE = Object.freeze({ MIXED_SHADOW: "MIXED_SHADOW", OPERATIONS_ONLY: "OPERATIONS_ONLY" });
  const DAILY_TASK_REQUIRED_OPERATION_TYPES = Object.freeze([
    "MATCH_REVIEW", "MISSING_DATA", "OPPORTUNITY_REVIEW", "OPPORTUNITY_FOLLOW_UP", "DEAL_ACTION",
    "COOPERATION_REQUEST", "COOPERATION_RESPONSE", "COOPERATION_MATCH", "EXTERNAL_RESPONSE",
    "SYSTEM_ACTION", "PLATFORM_OPPORTUNITY_OFFER"
  ]);
  let dailyTaskShadowCycles = 0;
  let dailyTaskShadowFailures = 0;
  let dailyTaskShadowSourcesReady = { operations: false, intake: false, opportunities: false, matches: false, deals: false };
'''
if 'DAILY_TASK_REQUIRED_OPERATION_TYPES' not in s:
    if state_anchor not in s:
        raise SystemExit('daily task state anchor missing')
    s = s.replace(state_anchor, state_block, 1)

replacements = {
    '      matchItems = snapshot.docs.map(matchOperation);\n      loadAnalytics();':
        '      matchItems = snapshot.docs.map(matchOperation);\n      dailyTaskShadowSourcesReady.matches = true;\n      loadAnalytics();',
    '      dealItems = snapshot.docs.map(dealOperation);\n      loadAnalytics();':
        '      dealItems = snapshot.docs.map(dealOperation);\n      dailyTaskShadowSourcesReady.deals = true;\n      loadAnalytics();',
    '        intakeItems = snapshot.docs.map(intakeOperation);\n        processNewPublicIntakes(snapshot);':
        '        intakeItems = snapshot.docs.map(intakeOperation);\n        dailyTaskShadowSourcesReady.intake = true;\n        processNewPublicIntakes(snapshot);',
    '        operationItems = snapshot.docs.map(projectPersistedOperation);\n        pruneSavedOpportunityWorkspaceItems();':
        '        operationItems = snapshot.docs.map(projectPersistedOperation);\n        dailyTaskShadowSourcesReady.operations = true;\n        pruneSavedOpportunityWorkspaceItems();',
    '            operationItems = snapshot.docs.map(projectPersistedOperation)\n              .sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2));\n            pruneSavedOpportunityWorkspaceItems();':
        '            operationItems = snapshot.docs.map(projectPersistedOperation)\n              .sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2));\n            dailyTaskShadowSourcesReady.operations = true;\n            pruneSavedOpportunityWorkspaceItems();',
    '        opportunityItems = snapshot.docs.map(opportunityOperation);\n        emitOperations();':
        '        opportunityItems = snapshot.docs.map(opportunityOperation);\n        dailyTaskShadowSourcesReady.opportunities = true;\n        emitOperations();'
}
for old, new in replacements.items():
    if new in s:
        continue
    if old not in s:
        raise SystemExit(f'snapshot anchor missing: {old[:55]}')
    s = s.replace(old, new, 1)

old_reset = '''          matchItems = [];
          dealItems = [];
          intakeItems = [];
          operationItems = [];
          opportunityItems = [];
          analyticsItem = null;'''
new_reset = '''          matchItems = [];
          dealItems = [];
          intakeItems = [];
          operationItems = [];
          opportunityItems = [];
          dailyTaskShadowSourcesReady = { operations: false, intake: false, opportunities: false, matches: false, deals: false };
          dailyTaskShadowCycles = 0;
          dailyTaskShadowFailures = 0;
          analyticsItem = null;'''
if new_reset not in s:
    if old_reset not in s:
        raise SystemExit('reset anchor missing')
    s = s.replace(old_reset, new_reset, 1)

replacement = r'''  function dailyTaskOperationBusinessKey(item = {}) {
    const type = String(item.operationType || item.type || "").trim().toUpperCase();
    const id = (value) => String(value || "").trim();
    if (["MISSING_DATA", "OPPORTUNITY_REVIEW", "OPPORTUNITY_FOLLOW_UP"].includes(type)) {
      const value = id(item.opportunityId || item.sourceEntityId);
      return value ? `opportunity:${value}` : "";
    }
    if (type === "MATCH_REVIEW") {
      const value = id(item.matchId || item.sourceEntityId);
      return value ? `match:${value}` : "";
    }
    if (type === "DEAL_ACTION") {
      const value = id(item.dealId || item.sourceEntityId);
      return value ? `deal:${value}` : "";
    }
    if (["COOPERATION_REQUEST", "COOPERATION_RESPONSE", "COOPERATION_MATCH"].includes(type)) {
      const value = id(item.cooperationId || item.sourceEntityId);
      return value ? `cooperation:${value}` : "";
    }
    return "";
  }

  function dailyTaskLegacyBusinessKey(item = {}) {
    const type = String(item.recordType || "").trim().toLowerCase();
    const id = (value) => String(value || "").trim();
    if (type === "opportunity") {
      const value = id(item.opportunityId || item.recordId || item.id);
      return value ? `opportunity:${value}` : "";
    }
    if (type === "match") {
      const value = id(item.matchId || item.recordId || item.id);
      return value ? `match:${value}` : "";
    }
    if (type === "deal") {
      const value = id(item.dealId || item.recordId || item.id);
      return value ? `deal:${value}` : "";
    }
    if (type === "cooperation") {
      const value = id(item.cooperationId || item.recordId || item.id);
      return value ? `cooperation:${value}` : "";
    }
    if (type === "intake") {
      const opportunityId = id(item.opportunityId);
      if (opportunityId) return `opportunity:${opportunityId}`;
      const value = id(item.recordId || item.id);
      return value ? `intake:${value}` : "";
    }
    return "";
  }

  function dailyTaskCoverageAudit(legacyItems = []) {
    dailyTaskShadowCycles += 1;
    try {
      const operationKeys = new Set();
      const semanticCounts = new Map();
      for (const item of operationItems) {
        const businessKey = dailyTaskOperationBusinessKey(item);
        if (businessKey) operationKeys.add(businessKey);
        const type = String(item.operationType || item.type || "").trim().toUpperCase();
        if (businessKey && type) {
          const semanticKey = `${type}:${businessKey}`;
          semanticCounts.set(semanticKey, (semanticCounts.get(semanticKey) || 0) + 1);
        }
      }
      const legacyKeys = [...new Set(legacyItems.map(dailyTaskLegacyBusinessKey).filter(Boolean))];
      const uncoveredBusinessEntities = legacyKeys.filter((key) => !operationKeys.has(key));
      const covered = legacyKeys.length - uncoveredBusinessEntities.length;
      const coveragePercent = legacyKeys.length ? Math.round((covered / legacyKeys.length) * 100) : 100;
      const duplicateActiveTasks = [...semanticCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
      const allSourcesReady = Object.values(dailyTaskShadowSourcesReady).every(Boolean);
      const domainTypes = Object.values(opsDomain()?.OPERATION_TYPES || {});
      const supportedTypes = new Set(domainTypes.length ? domainTypes : DAILY_TASK_REQUIRED_OPERATION_TYPES);
      const missingRequiredOperationTypes = DAILY_TASK_REQUIRED_OPERATION_TYPES.filter((type) => !supportedTypes.has(type));
      const reasons = [];
      if (!allSourcesReady) reasons.push("shadow_sources_not_ready");
      if (coveragePercent < 100) reasons.push("coverage_below_100");
      if (duplicateActiveTasks > 0) reasons.push("duplicate_active_tasks");
      if (uncoveredBusinessEntities.length) reasons.push("uncovered_business_entities");
      if (dailyTaskShadowFailures > 0) reasons.push("shadow_failures");
      if (missingRequiredOperationTypes.length) reasons.push("missing_required_operation_types");
      if (dailyTaskShadowCycles < 1) reasons.push("shadow_cycle_required");
      return {
        allowed: reasons.length === 0,
        mode: reasons.length === 0 ? DAILY_TASK_SOURCE_MODE.OPERATIONS_ONLY : DAILY_TASK_SOURCE_MODE.MIXED_SHADOW,
        reasons,
        coveragePercent,
        coveredBusinessEntities: covered,
        observedBusinessEntities: legacyKeys.length,
        duplicateActiveTasks,
        uncoveredBusinessEntities,
        shadowCycles: dailyTaskShadowCycles,
        shadowFailures: dailyTaskShadowFailures,
        shadowSourcesReady: { ...dailyTaskShadowSourcesReady },
        allSourcesReady,
        missingRequiredOperationTypes
      };
    } catch (error) {
      dailyTaskShadowFailures += 1;
      return {
        allowed: false,
        mode: DAILY_TASK_SOURCE_MODE.MIXED_SHADOW,
        reasons: ["shadow_audit_failed"],
        coveragePercent: 0,
        duplicateActiveTasks: 0,
        uncoveredBusinessEntities: [],
        shadowCycles: dailyTaskShadowCycles,
        shadowFailures: dailyTaskShadowFailures,
        shadowSourcesReady: { ...dailyTaskShadowSourcesReady },
        allSourcesReady: false,
        missingRequiredOperationTypes: [],
        error: String(error?.message || error || "audit_failed")
      };
    }
  }

  function emitOperations() {
    pruneSavedOpportunityWorkspaceItems();
    const workspaceItems = savedOpportunityWorkspaceItems.filter(
      (item) => !isSavedOpportunityPresentationItem(item)
    );
    const legacyShadowItems = [
      ...intakeItems,
      ...opportunityItems,
      ...activeMatchOperations(),
      ...activeDealOperations()
    ];
    const audit = dailyTaskCoverageAudit(legacyShadowItems);
    const mixedShadowItems = dedupeFeedItems([
      ...operationItems,
      ...legacyShadowItems,
      ...workspaceItems
    ].sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2)));
    const baseItems = audit.mode === DAILY_TASK_SOURCE_MODE.OPERATIONS_ONLY
      ? dedupeFeedItems([...operationItems].sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2)))
      : mixedShadowItems;
    // Operations already carry priority. Legacy broker-alert cards remain only
    // in shadow fallback so the final Operations-only list cannot duplicate work.
    const alerts = audit.mode === DAILY_TASK_SOURCE_MODE.OPERATIONS_ONLY
      ? []
      : (BAL()?.scanBrokerAlerts ? BAL().scanBrokerAlerts(baseItems) : []);
    const items = filterOpportunityView([...alerts, ...baseItems].sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2)));
    window.IAQAR = window.IAQAR || {};
    window.IAQAR.dailyTaskSourceAudit = audit;
    window.dispatchEvent(new CustomEvent("iaqar:daily-task-source-audit", { detail: audit }));
    window.dispatchEvent(new CustomEvent("iaqar:operations-data", {
      detail: { items, authoritative: true, opportunityView, sourceMode: audit.mode, sourceAudit: audit }
    }));
  }
'''
pattern = re.compile(r'  function emitOperations\(\) \{.*?\n  \}\n\n  async function opportunityLifecycleAction', re.S)
match = pattern.search(s)
if not match:
    if 'iaqar:daily-task-source-audit' not in s:
        raise SystemExit('emitOperations block not found')
else:
    s = s[:match.start()] + replacement + '\n  async function opportunityLifecycleAction' + s[match.end():]

p.write_text(s)

# Keep the pure policy gate aligned with the runtime readiness prerequisite.
p = Path("public/js/daily-tasks-source-policy.js")
s = p.read_text()
if 'shadowSourcesReady = true' not in s:
    s = s.replace(
        '  missingRequiredOperationTypes = [],\n  shadowCycles = 0\n} = {}) {',
        '  missingRequiredOperationTypes = [],\n  shadowSourcesReady = true,\n  shadowCycles = 0\n} = {}) {',
        1
    )
    s = s.replace(
        '  const reasons = [];\n  if (number(coveragePercent)',
        '  const reasons = [];\n  if (shadowSourcesReady !== true) reasons.push("shadow_sources_not_ready");\n  if (number(coveragePercent)',
        1
    )
    s = s.replace(
        '    requiresAllOperationTypesSupported: true,\n',
        '    requiresAllOperationTypesSupported: true,\n    requiresAllShadowSourcesReady: true,\n',
        1
    )
p.write_text(s)

# Strengthen the test with the readiness false-positive guard.
p = Path("test/daily-tasks-operations-only-phase12.test.mjs")
s = p.read_text()
if 'sources are loaded' not in s:
    marker = 'test("Operations-only source contains no legacy source cards", () => {'
    extra = '''test("empty arrays cannot produce a false 100% before all shadow sources are loaded", () => {
  const activation = evaluateOperationsOnlyActivation({
    coveragePercent: 100,
    duplicateActiveTasks: 0,
    uncoveredBusinessEntities: [],
    shadowFailures: 0,
    missingRequiredOperationTypes: [],
    shadowSourcesReady: false,
    shadowCycles: 1
  });
  assert.equal(activation.allowed, false);
  assert.ok(activation.reasons.includes("shadow_sources_not_ready"));
});

'''
    if marker not in s:
        raise SystemExit('test insertion marker missing')
    s = s.replace(marker, extra + marker, 1)
p.write_text(s)
