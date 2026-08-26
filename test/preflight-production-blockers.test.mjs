import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function read(...parts) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

test("production preflight uses live channel API and avoids unsupported orderBy", () => {
  const source = read("scripts", "preflight-production-blockers.mjs");
  assert.ok(source.includes("/channels/live"));
  assert.ok(source.includes("resolveHostingSiteName"));
  assert.equal(source.includes("orderBy"), false);
});

test("production preflight verifies deploy-generated version marker without requiring public/version.json", () => {
  const source = read("scripts", "preflight-production-blockers.mjs");
  assert.ok(source.includes("verifyVersionMarkerMechanism"));
  assert.ok(source.includes("write-staging-version.mjs"));
  assert.ok(source.includes("deploy-generated"));
  assert.ok(read(".gitignore").includes("public/version.json"));
  assert.ok(read("scripts", "deploy-production-pilot.sh").includes("--channel=production"));
});

test("production preflight does not require blaze-only scheduled backups on spark", () => {
  const source = read("scripts", "preflight-production-blockers.mjs");
  assert.ok(source.includes("inferFirebasePlan"));
  assert.ok(source.includes("SPARK_PLAN"));
  assert.ok(source.includes("spark_hosting_rollback+git_rules_redeploy+firestore_readable"));
  assert.ok(source.includes("scheduled_backups_and_pitr_are_blaze_only_and_not_required_on_spark"));
  assert.equal(source.includes("enable managed backup schedule / PITR before controlled deploy"), false);
});

test("production preflight reports spark plan, pilot access, and registration lock", () => {
  const source = read("scripts", "preflight-production-blockers.mjs");
  assert.ok(source.includes("FIREBASE PLAN"));
  assert.ok(source.includes("evaluatePilotRegistration"));
  assert.ok(source.includes("REAL ACTIVE PRODUCTION OFFICES"));
  assert.ok(source.includes("PILOT ACCESS"));
  assert.ok(source.includes("do not seed fake offices"));
});
