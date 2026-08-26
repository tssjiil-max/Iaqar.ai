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

test("production preflight reports registration lock and real office count", () => {
  const source = read("scripts", "preflight-production-blockers.mjs");
  assert.ok(source.includes("evaluatePilotRegistration"));
  assert.ok(source.includes("REAL ACTIVE PRODUCTION OFFICES"));
  assert.ok(source.includes("PILOT MAX 5 ARCHITECTURE"));
  assert.ok(source.includes("do not seed fake offices"));
});

test("production preflight classifies kill switches as unit-only evidence", () => {
  const source = read("scripts", "preflight-production-blockers.mjs");
  assert.ok(source.includes("pilot-access-domain.test.mjs"));
  assert.ok(source.includes("pilot-access-service.test.mjs"));
  assert.ok(source.includes("PASS — UNIT ONLY"));
});
