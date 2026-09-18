import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workerSource = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

test("an existing current match reconciles MATCH_REVIEW before returning duplicate", () => {
  const start = workerSource.indexOf("if (existingMatch) {");
  const end = workerSource.indexOf("await supersedeMatchesForPairKey", start);
  assert.ok(start >= 0 && end > start, "persistScoredMatch duplicate branch must be present");

  const duplicateBranch = workerSource.slice(start, end);
  const reconcileIndex = duplicateBranch.indexOf("createMatchReviewBundle(");
  const persistedReturnIndex = duplicateBranch.indexOf("return persisted;", reconcileIndex);

  assert.ok(reconcileIndex >= 0, "existing current matches must reconcile MATCH_REVIEW");
  assert.ok(
    persistedReturnIndex > reconcileIndex,
    "MATCH_REVIEW reconciliation must happen before the duplicate result returns"
  );
  assert.match(duplicateBranch, /operationId/);
  assert.match(duplicateBranch, /operationCreated/);
});
