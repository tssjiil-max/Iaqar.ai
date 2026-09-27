import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  QA_OFFICE_ID,
  QA_UID_PREFIX,
  STAGING_PROJECT_ID,
  assertQaPath,
  assertStagingServiceAccount,
  ensureQaOfficeMember,
  qaRunUid,
  removeQaIdentity,
  stagingHostingConfig
} from "../scripts/staging-qa-identity.mjs";

// Guards the deployed-Staging QA scripts against the failure class seen after the
// 2026-09-24 staging reset: tests that borrowed identities/data from offices or
// accounts that a reset deletes, and a runner that text-patched its verifier.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGING_WORKFLOWS = [
  ".github/workflows/deploy-unified-staging.yml",
  ".github/workflows/retire-legacy-opportunity-manager.yml"
];
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

function workflowScripts() {
  const found = new Set();
  for (const workflow of STAGING_WORKFLOWS) {
    if (!existsSync(path.join(ROOT, workflow))) continue;
    for (const match of read(workflow).matchAll(/node\s+(scripts\/[\w.-]+\.mjs)/g)) found.add(match[1]);
  }
  return found;
}

/** Workflow scripts plus the local scripts they import or launch. */
function stagingQaScripts() {
  const queue = [...workflowScripts()];
  const seen = new Set();
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel) || !existsSync(path.join(ROOT, rel))) continue;
    seen.add(rel);
    const source = read(rel);
    for (const match of source.matchAll(/from\s+"\.\/([\w.-]+\.mjs)"/g)) queue.push(`scripts/${match[1]}`);
    // Any other script named by a string literal (e.g. a spawned verifier).
    for (const match of source.matchAll(/"([\w.-]+\.mjs)"/g)) {
      if (existsSync(path.join(ROOT, "scripts", match[1]))) queue.push(`scripts/${match[1]}`);
    }
  }
  return [...seen];
}

const FORBIDDEN = [
  { pattern: /staging-logo-live-20260807/, why: "office deleted by the staging reset" },
  { pattern: /NORMAL_OFFICE_ID/, why: "borrowing identity from a real office" },
  { pattern: /0511123456/, why: "fixed phone account (loginDirectory) removed by the reset" },
  { pattern: /StagingLogo9/, why: "fixed account password" },
  { pattern: /\/auth\/phone-login/, why: "phone login depends on loginDirectory" },
  { pattern: /\.collection\("members"\)\.get\(/, why: "copying members from another office" },
  { pattern: /opp_intake_[A-Za-z0-9]{8,}/, why: "fixed opportunity id that a reset deletes" }
];

test("staging workflows' QA scripts are discovered", () => {
  const scripts = stagingQaScripts();
  for (const expected of [
    "scripts/staging-bank-card-click-verify.mjs",
    "scripts/live-match-integrity-qa.mjs",
    "scripts/live-negotiation-session-qa.mjs",
    "scripts/run-staging-fresh-match-lineage-verify.mjs",
    "scripts/staging-fresh-match-lineage-verify.mjs",
    "scripts/staging-qa-identity.mjs"
  ]) {
    assert.ok(scripts.includes(expected), `${expected} must be reachable from the staging workflows`);
  }
});

test("no staging QA script depends on reset-deleted offices, accounts or fixed records", () => {
  const offenders = [];
  for (const rel of stagingQaScripts()) {
    const source = read(rel);
    for (const { pattern, why } of FORBIDDEN) {
      if (pattern.test(source)) offenders.push(`${rel}: ${pattern} (${why})`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("every staging QA script that writes Firestore uses a per-run QA identity", () => {
  const writers = stagingQaScripts().filter((rel) => {
    const source = read(rel);
    return /firebase-admin\/firestore/.test(source) && /FieldValue|createCustomToken/.test(source);
  });
  assert.ok(writers.length >= 4, `expected the four live E2E writers, found ${writers.join(", ")}`);
  for (const rel of writers) {
    const source = read(rel);
    assert.match(source, /from "\.\/staging-qa-identity\.mjs"/, `${rel} must use staging-qa-identity.mjs`);
    assert.match(source, /qaRunUid\(/, `${rel} must derive its QA uid from the run`);
    assert.match(source, /ensureQaOfficeMember\(/, `${rel} must create its own membership`);
    assert.match(source, /removeQaIdentity\(/, `${rel} must remove only its own identity`);
    assert.match(source, /assertStagingServiceAccount\(/, `${rel} must verify the Staging project before writing`);
    assert.doesNotMatch(source, /QA_UID\s*=\s*"/, `${rel} must not share a fixed QA uid across runs`);
    assert.doesNotMatch(source, /getAuth\(app\)\.createCustomToken\(/, `${rel} must sign in through signInQaUser`);
  }
});

test("fresh-lineage runner launches the verifier unchanged (no runtime text patching)", () => {
  const runner = read("scripts/run-staging-fresh-match-lineage-verify.mjs");
  const target = runner.match(/VERIFIER_FILE\s*=\s*"([\w.-]+\.mjs)"/)?.[1];
  assert.equal(target, "staging-fresh-match-lineage-verify.mjs");
  assert.ok(existsSync(path.join(ROOT, "scripts", target)));
  assert.doesNotMatch(runner, /readFileSync|writeFileSync|\.replace\(/, "runner must not rewrite the verifier source");
  assert.match(runner, /spawnSync\(process\.execPath,\s*\[path\.join\(scriptsDir, VERIFIER_FILE\)/);
  for (const rel of ["scripts/run-staging-fresh-match-lineage-verify.mjs", `scripts/${target}`]) {
    const check = spawnSync(process.execPath, ["--check", path.join(ROOT, rel)], { encoding: "utf8" });
    assert.equal(check.status, 0, `${rel} must parse: ${check.stderr}`);
  }
});

// ---------------------------------------------------------------------------
// Behaviour of the shared identity helper (in-memory Firestore double)
// ---------------------------------------------------------------------------

function memoryDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const ref = (p) => ({
    path: p,
    collection: (name) => ({ doc: (id) => ref(`${p}/${name}/${id}`) }),
    async get() { return { exists: docs.has(p), data: () => docs.get(p) }; },
    async set(data, options = {}) { docs.set(p, options.merge ? { ...(docs.get(p) || {}), ...data } : { ...data }); },
    async delete() { docs.delete(p); }
  });
  return { docs, collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }) };
}
const FieldValue = { serverTimestamp: () => "ts" };
const officePath = `offices/${QA_OFFICE_ID}`;

test("per-run QA uids are unique, Firebase-safe and tied to the run", () => {
  const a = qaRunUid("bank", "bankqa_abc");
  const b = qaRunUid("bank", "bankqa_def");
  assert.notEqual(a, b);
  assert.ok(a.startsWith(QA_UID_PREFIX) && a.endsWith("bankqa_abc"));
  assert.match(qaRunUid("x y", "r/1"), /^[A-Za-z0-9_-]+$/);
});

test("concurrent runs keep their own membership; cleanup removes only its own", async () => {
  const db = memoryDb();
  const deleted = [];
  const auth = { async deleteUser(uid) { deleted.push(uid); } };
  const runA = "run_a"; const runB = "run_b";
  const uidA = qaRunUid("fresh", runA); const uidB = qaRunUid("fresh", runB);
  await ensureQaOfficeMember({ db, FieldValue, runId: runA, uid: uidA });
  await ensureQaOfficeMember({ db, FieldValue, runId: runB, uid: uidB });

  await removeQaIdentity({ db, auth, runId: runA, uid: uidA });
  assert.equal(db.docs.has(`${officePath}/members/${uidA}`), false);
  assert.equal(db.docs.get(`${officePath}/members/${uidB}`)?.testRunId, runB, "run B membership survives run A cleanup");
  assert.deepEqual(deleted, [uidA]);

  // A foreign uid or a membership stamped by another run is never removed.
  const foreign = await removeQaIdentity({ db, auth, runId: runA, uid: uidB });
  assert.deepEqual(foreign, { member: false, authUser: false });
  assert.equal(db.docs.has(`${officePath}/members/${uidB}`), true);
});

test("QA office guard refuses a non-fixture office and non-run uids", async () => {
  const db = memoryDb({ [officePath]: { officeName: "Real", isTestFixture: false } });
  await assert.rejects(
    ensureQaOfficeMember({ db, FieldValue, runId: "r1", uid: qaRunUid("bank", "r1") }),
    /not marked isTestFixture/
  );
  await assert.rejects(
    ensureQaOfficeMember({ db: memoryDb(), FieldValue, runId: "r1", uid: "qa-e2e-bank-verifier" }),
    /not a per-run QA uid/
  );
  assert.throws(() => assertQaPath({ path: "offices/platform/members/x" }), /outside/);
});

test("Staging project is verified before any write", async () => {
  assert.equal(assertStagingServiceAccount({ project_id: STAGING_PROJECT_ID }), true);
  assert.throws(() => assertStagingServiceAccount({ project_id: "aqar-b5d76" }), /QA_GUARD_REFUSED/);
  await assert.rejects(stagingHostingConfig("https://aqar-b5d76.web.app", async () => { throw new Error("no fetch"); }), /not an iaqar-ai-staging channel/);
  const prodConfig = async () => ({ ok: true, status: 200, json: async () => ({ apiKey: "k", projectId: "aqar-b5d76" }) });
  await assert.rejects(stagingHostingConfig("https://iaqar-ai-staging--staging-x.web.app", prodConfig), /hosting project is aqar-b5d76/);
});
