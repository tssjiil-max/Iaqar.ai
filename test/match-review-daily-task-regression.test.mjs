import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMatchReviewOperation } from "../worker/src/operations-domain.js";
import { projectOperationToUiItem } from "../public/js/operations-domain.js";
import { mapOperationsItemsToDailyTasks } from "../public/js/v2/daily-tasks/domain.js";

test("MATCH_REVIEW producer persists the integrity and listing identity required by Daily Tasks", async () => {
  const operation = await buildMatchReviewOperation({
    officeId: "office-regression",
    matchId: "mat_regression",
    opportunityId: "req_regression",
    counterpartOpportunityId: "off_regression",
    clientRequestId: "req_regression",
    ownerOfferId: "off_regression",
    candidatePropertyType: "شقة",
    candidateDistrict: "قباء",
    candidateCity: "المدينة المنورة",
    candidatePurpose: "شراء",
    score: 80,
    opportunityScore: 80,
    isBestOpportunity: true
  });

  assert.equal(operation.status, "OPEN");
  assert.equal(operation.metadata.clientRequestId, "req_regression");
  assert.equal(operation.metadata.ownerOfferId, "off_regression");
  assert.equal(operation.metadata.integrityStatus, "valid");
  assert.equal(operation.metadata.matchIntegrityStatus, "valid");

  const persisted = {
    ...operation,
    metadataJson: JSON.stringify(operation.metadata),
    sourceRefsJson: "[]"
  };
  delete persisted.metadata;

  const projected = projectOperationToUiItem(persisted, { officeId: "office-regression" });
  assert.equal(projected.recordType, "operation");
  assert.equal(projected.matchId, "mat_regression");
  assert.equal(projected.clientRequestId, "req_regression");
  assert.equal(projected.ownerOfferId, "off_regression");
  assert.equal(projected.integrityStatus, "valid");

  const tasks = mapOperationsItemsToDailyTasks(
    [projected],
    new Date("2026-09-13T02:00:00.000Z"),
    { officeId: "office-regression", showTestFixtures: true }
  );
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].matchId, "mat_regression");
});

test("legacy READY MATCH_REVIEW operations are included by the live operations listener", () => {
  const source = readFileSync(new URL("../public/js/workflow-office.js", import.meta.url), "utf8");
  assert.match(source, /ACTIVE_OPERATION_STATUSES = Object\.freeze\(\["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE", "READY"\]\)/);
});
