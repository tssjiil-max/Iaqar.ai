import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DAILY_TASK_SOURCE_MODE,
  DAILY_TASK_REQUIRED_OPERATION_TYPES,
  auditDailyTaskCoverage,
  evaluateOperationsOnlyActivation,
  selectDailyTaskSource,
  topHomeDailyTasks,
  dailyTaskSourceBoundaryGuarantees
} from "../public/js/daily-tasks-source-policy.js";

const allTypes = [...DAILY_TASK_REQUIRED_OPERATION_TYPES];

function operation(type, ids = {}) {
  return {
    id: `op_${type}_${Object.values(ids)[0] || "x"}`,
    recordType: "operation",
    operationType: type,
    ...ids
  };
}

test("Operations-only activation requires measurable perfect evidence", () => {
  const legacyItems = [
    { recordType: "opportunity", id: "opp_1" },
    { recordType: "match", id: "match_1" },
    { recordType: "deal", id: "deal_1" },
    { recordType: "cooperation", id: "coop_1" }
  ];
  const operations = [
    operation("OPPORTUNITY_REVIEW", { opportunityId: "opp_1" }),
    operation("MATCH_REVIEW", { matchId: "match_1" }),
    operation("DEAL_ACTION", { dealId: "deal_1" }),
    operation("COOPERATION_REQUEST", { cooperationId: "coop_1" })
  ];
  const audit = auditDailyTaskCoverage({
    operations,
    legacyItems,
    supportedOperationTypes: allTypes,
    shadowCycles: 3,
    shadowFailures: 0
  });
  assert.equal(audit.coveragePercent, 100);
  assert.equal(audit.duplicateActiveTasks, 0);
  assert.deepEqual(audit.uncoveredBusinessEntities, []);
  assert.deepEqual(audit.missingRequiredOperationTypes, []);

  const activation = evaluateOperationsOnlyActivation(audit);
  assert.equal(activation.allowed, true);
  assert.equal(activation.mode, DAILY_TASK_SOURCE_MODE.OPERATIONS_ONLY);
});

test("one uncovered business entity blocks cutover", () => {
  const audit = auditDailyTaskCoverage({
    operations: [operation("OPPORTUNITY_REVIEW", { opportunityId: "opp_1" })],
    legacyItems: [
      { recordType: "opportunity", id: "opp_1" },
      { recordType: "match", id: "match_missing" }
    ],
    supportedOperationTypes: allTypes,
    shadowCycles: 1
  });
  assert.equal(audit.coveragePercent, 50);
  const activation = evaluateOperationsOnlyActivation(audit);
  assert.equal(activation.allowed, false);
  assert.ok(activation.reasons.includes("coverage_below_100"));
  assert.ok(activation.reasons.includes("uncovered_business_entities"));
});

test("duplicate active semantic Operations block cutover", () => {
  const audit = auditDailyTaskCoverage({
    operations: [
      operation("MATCH_REVIEW", { id: "op_a", matchId: "match_1" }),
      operation("MATCH_REVIEW", { id: "op_b", matchId: "match_1" })
    ],
    legacyItems: [{ recordType: "match", id: "match_1" }],
    supportedOperationTypes: allTypes,
    shadowCycles: 1
  });
  assert.equal(audit.duplicateActiveTasks, 1);
  const activation = evaluateOperationsOnlyActivation(audit);
  assert.equal(activation.allowed, false);
  assert.ok(activation.reasons.includes("duplicate_active_tasks"));
});

test("shadow failure or unsupported Operation type blocks cutover", () => {
  const audit = auditDailyTaskCoverage({
    operations: [],
    legacyItems: [],
    supportedOperationTypes: allTypes.filter((type) => type !== "DEAL_ACTION"),
    shadowCycles: 2,
    shadowFailures: 1
  });
  const activation = evaluateOperationsOnlyActivation(audit);
  assert.equal(activation.allowed, false);
  assert.ok(activation.reasons.includes("shadow_failures"));
  assert.ok(activation.reasons.includes("missing_required_operation_types"));
});

test("empty arrays cannot produce a false 100% before all shadow sources are loaded", () => {
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

test("Operations-only source contains no legacy source cards", () => {
  const ops = [operation("MATCH_REVIEW", { matchId: "m1" })];
  const selected = selectDailyTaskSource({
    operations: ops,
    intake: [{ recordType: "intake", id: "i1" }],
    opportunities: [{ recordType: "opportunity", id: "o1" }],
    matches: [{ recordType: "match", id: "m1" }],
    deals: [{ recordType: "deal", id: "d1" }],
    workspace: [{ recordType: "workspace", id: "w1" }]
  }, { mode: DAILY_TASK_SOURCE_MODE.OPERATIONS_ONLY });
  assert.deepEqual(selected, ops);
  assert.ok(selected.every((item) => item.recordType === "operation"));
});

test("home projection is capped at exactly five tasks", () => {
  assert.equal(topHomeDailyTasks(Array.from({ length: 9 }, (_, index) => ({ id: index }))).length, 5);
  assert.equal(dailyTaskSourceBoundaryGuarantees().homeTopTaskCount, 5);
});

test("workflow runtime uses a measured cutover instead of unconditional mixed concatenation", async () => {
  const source = await readFile(new URL("../public/js/workflow-office.js", import.meta.url), "utf8");
  assert.match(source, /dailyTaskCoverageAudit/);
  assert.match(source, /OPERATIONS_ONLY/);
  assert.match(source, /iaqar:daily-task-source-audit/);
  assert.doesNotMatch(source, /const baseItems = dedupeFeedItems\(\[\s*\.\.\.operationItems,\s*\.\.\.intakeItems,\s*\.\.\.opportunityItems,\s*\.\.\.activeMatchOperations\(\),\s*\.\.\.activeDealOperations\(\),\s*\.\.\.workspaceItems/s);
});

test("operations fallback cannot hide a new match behind an unordered Firestore limit", async () => {
  const source = await readFile(new URL("../public/js/workflow-office.js", import.meta.url), "utf8");
  const fallback = source.match(/Fallback without orderBy[\s\S]*?\.catch\(\(fallbackError\)/)?.[0] || "";
  assert.ok(fallback, "operations fallback block must exist");
  assert.doesNotMatch(fallback, /\.limit\(/, "unordered fallback must read all active operations");
  assert.match(fallback, /updatedAt \|\| b\.createdAt/, "equal-priority work must be newest first");
});
