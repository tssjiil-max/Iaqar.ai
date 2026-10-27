// Firestore rules → Staging only (scripts/staging-firestore-rules.mjs + .github/workflows/staging-firestore-rules.yml).
// The tool reads the rules released on iaqar-ai-staging, keeps a copy, shows the difference, and publishes or rolls
// back only on an explicit request whose confirmation, file hash and current release match what was reviewed.
// Against a fake Firebase Rules API: nothing here reaches Google.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIRM_PHRASE, STAGING_PROJECT, decide, runRulesTool, sha256 } from "../scripts/staging-firestore-rules.mjs";

const RULES_V1 = "rules_version = '2';\nservice cloud.firestore { match /databases/{d}/documents { match /x/{y} { allow read: if false; } } }\n";
const RULES_V2 = RULES_V1.replace("if false", "if request.auth != null");
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const serviceAccount = (projectId = STAGING_PROJECT) => JSON.stringify({
  type: "service_account", project_id: projectId, client_email: `deployer@${projectId}.iam.gserviceaccount.com`,
  private_key_id: "0123456789abcdef0123456789abcdef01234567", private_key: privateKey.export({ type: "pkcs8", format: "pem" })
});

/** A fake Firebase Rules API for one project: one release, rulesets by name. */
function fakeRulesApi({ released = RULES_V1, failWrites = false } = {}) {
  const rulesets = new Map([[`projects/${STAGING_PROJECT}/rulesets/old-1`, released]]);
  let release = `projects/${STAGING_PROJECT}/rulesets/old-1`;
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = String(init.method || "GET").toUpperCase();
    calls.push(`${method} ${u.hostname}${u.pathname}`);
    if (u.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "test-token", expires_in: 3600 });
    if (u.hostname !== "firebaserules.googleapis.com") return new Response("unexpected host", { status: 500 });
    if (!u.pathname.startsWith(`/v1/projects/${STAGING_PROJECT}/`)) return Response.json({ error: { status: "PERMISSION_DENIED" } }, { status: 403 });
    if (method === "GET" && u.pathname.endsWith("/releases/cloud.firestore")) return Response.json({ name: `projects/${STAGING_PROJECT}/releases/cloud.firestore`, rulesetName: release, updateTime: "2026-10-24T00:00:00Z" });
    if (method === "GET" && u.pathname.includes("/rulesets/")) {
      const name = u.pathname.slice("/v1/".length);
      return rulesets.has(name) ? Response.json({ name, source: { files: [{ name: "firestore.rules", content: rulesets.get(name) }] }, createTime: "2026-10-01T00:00:00Z" }) : new Response("{}", { status: 404 });
    }
    if (failWrites) return Response.json({ error: { status: "PERMISSION_DENIED" } }, { status: 403 });
    if (method === "POST" && u.pathname.endsWith("/rulesets")) {
      const body = JSON.parse(init.body);
      const name = `projects/${STAGING_PROJECT}/rulesets/new-${rulesets.size}`;
      rulesets.set(name, body.source.files[0].content);
      return Response.json({ name });
    }
    if (method === "PATCH" && u.pathname.endsWith("/releases/cloud.firestore")) {
      release = JSON.parse(init.body).release.rulesetName;
      return Response.json({ name: `projects/${STAGING_PROJECT}/releases/cloud.firestore`, rulesetName: release });
    }
    return new Response("unsupported", { status: 500 });
  };
  return { fetchImpl, calls, current: () => release, source: (name) => rulesets.get(name) };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "rules-tool-"));
function rulesFile(content) { const dir = tmp(); const p = path.join(dir, "firestore.rules"); fs.writeFileSync(p, content); return p; }

// ---- the decision, before anything is read or written

test("decide: only the Staging project, never Production", () => {
  assert.equal(decide({ mode: "plan", projectId: STAGING_PROJECT }).ok, true);
  assert.equal(decide({ mode: "plan", projectId: "aqar-b5d76" }).ok, false);
  assert.match(decide({ mode: "plan", projectId: "aqar-b5d76" }).reason, /staging/i);
  assert.equal(decide({ mode: "plan", projectId: "another-project" }).ok, false);
});

test("decide: publishing needs the phrase, the reviewed file hash and the reviewed current release", () => {
  const base = { mode: "deploy", projectId: STAGING_PROJECT, fileSha: "abc", currentRuleset: "projects/iaqar-ai-staging/rulesets/old-1" };
  const ok = { ...base, confirm: CONFIRM_PHRASE, expectedSha: "abc", expectedCurrent: base.currentRuleset };
  assert.equal(decide(ok).ok, true);
  assert.equal(decide({ ...ok, confirm: "yes" }).ok, false, "wrong phrase");
  assert.equal(decide({ ...ok, expectedSha: "abd" }).ok, false, "the file changed since it was reviewed");
  assert.equal(decide({ ...ok, expectedCurrent: "projects/iaqar-ai-staging/rulesets/other" }).ok, false, "the release changed since the plan");
  assert.equal(decide({ ...ok, expectedSha: "" }).ok, false, "no hash given");
});

test("decide: a rollback names a Staging ruleset and the reviewed current release", () => {
  const ok = { mode: "rollback", projectId: STAGING_PROJECT, confirm: CONFIRM_PHRASE, rollbackRuleset: "projects/iaqar-ai-staging/rulesets/old-1", currentRuleset: "projects/iaqar-ai-staging/rulesets/new-2", expectedCurrent: "projects/iaqar-ai-staging/rulesets/new-2" };
  assert.equal(decide(ok).ok, true);
  assert.equal(decide({ ...ok, rollbackRuleset: "projects/aqar-b5d76/rulesets/x" }).ok, false, "a ruleset of another project");
  assert.equal(decide({ ...ok, confirm: "" }).ok, false);
  assert.equal(decide({ ...ok, mode: "anything" }).ok, false, "unknown mode");
});

// ---- the tool, end to end against the fake API

test("plan: keeps a copy of the released rules, shows the difference and the hashes, writes nothing", async () => {
  const api = fakeRulesApi();
  const out = tmp();
  const result = await runRulesTool({ mode: "plan", env: { FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccount() }, fetchImpl: api.fetchImpl, rulesPath: rulesFile(RULES_V2), outDir: out });
  assert.equal(result.ok, true);
  assert.equal(result.currentRuleset, `projects/${STAGING_PROJECT}/rulesets/old-1`);
  assert.equal(result.fileSha, sha256(RULES_V2));
  assert.equal(result.currentSha, sha256(RULES_V1));
  assert.equal(fs.readFileSync(path.join(out, "released.rules"), "utf8"), RULES_V1, "a copy of what is released");
  assert.match(fs.readFileSync(path.join(out, "rules.diff"), "utf8"), /if request\.auth != null/);
  assert.ok(!api.calls.some((c) => c.startsWith("POST firebaserules") || c.startsWith("PATCH")), `no write: ${api.calls}`);
});

test("deploy: publishes the reviewed file and verifies the release now serves it", async () => {
  const api = fakeRulesApi();
  const file = rulesFile(RULES_V2);
  const result = await runRulesTool({ mode: "deploy", env: { FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccount() }, fetchImpl: api.fetchImpl, rulesPath: file, outDir: tmp(),
    inputs: { confirm: CONFIRM_PHRASE, expectedSha: sha256(RULES_V2), expectedCurrent: `projects/${STAGING_PROJECT}/rulesets/old-1` } });
  assert.equal(result.ok, true, result.reason);
  assert.notEqual(api.current(), `projects/${STAGING_PROJECT}/rulesets/old-1`);
  assert.equal(api.source(api.current()), RULES_V2, "the release serves the reviewed file");
  assert.equal(result.previousRuleset, `projects/${STAGING_PROJECT}/rulesets/old-1`, "the answer names what to roll back to");
  assert.equal(result.verified, true);
});

test("deploy is refused (nothing written) when the release moved or the file changed after the review", async () => {
  for (const inputs of [
    { confirm: CONFIRM_PHRASE, expectedSha: sha256(RULES_V2), expectedCurrent: `projects/${STAGING_PROJECT}/rulesets/someone-else` },
    { confirm: CONFIRM_PHRASE, expectedSha: sha256(RULES_V1), expectedCurrent: `projects/${STAGING_PROJECT}/rulesets/old-1` },
    { confirm: "deploy", expectedSha: sha256(RULES_V2), expectedCurrent: `projects/${STAGING_PROJECT}/rulesets/old-1` }
  ]) {
    const api = fakeRulesApi();
    const result = await runRulesTool({ mode: "deploy", env: { FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccount() }, fetchImpl: api.fetchImpl, rulesPath: rulesFile(RULES_V2), outDir: tmp(), inputs });
    assert.equal(result.ok, false);
    assert.ok(!api.calls.some((c) => c.startsWith("POST firebaserules") || c.startsWith("PATCH")), `nothing written: ${api.calls}`);
  }
});

test("rollback: points the release back at the kept ruleset and verifies it", async () => {
  const api = fakeRulesApi();
  const deployed = await runRulesTool({ mode: "deploy", env: { FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccount() }, fetchImpl: api.fetchImpl, rulesPath: rulesFile(RULES_V2), outDir: tmp(),
    inputs: { confirm: CONFIRM_PHRASE, expectedSha: sha256(RULES_V2), expectedCurrent: `projects/${STAGING_PROJECT}/rulesets/old-1` } });
  const result = await runRulesTool({ mode: "rollback", env: { FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccount() }, fetchImpl: api.fetchImpl, rulesPath: rulesFile(RULES_V2), outDir: tmp(),
    inputs: { confirm: CONFIRM_PHRASE, rollbackRuleset: deployed.previousRuleset, expectedCurrent: api.current() } });
  assert.equal(result.ok, true, result.reason);
  assert.equal(api.current(), `projects/${STAGING_PROJECT}/rulesets/old-1`);
  assert.equal(api.source(api.current()), RULES_V1);
});

test("a Production service account is refused before any request", async () => {
  const api = fakeRulesApi();
  const result = await runRulesTool({ mode: "plan", env: { FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccount("aqar-b5d76") }, fetchImpl: api.fetchImpl, rulesPath: rulesFile(RULES_V2), outDir: tmp() });
  assert.equal(result.ok, false);
  assert.deepEqual(api.calls, [], "nothing was contacted");
});

test("a failed publish is reported, and the release is left as it was", async () => {
  const api = fakeRulesApi({ failWrites: true });
  const result = await runRulesTool({ mode: "deploy", env: { FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccount() }, fetchImpl: api.fetchImpl, rulesPath: rulesFile(RULES_V2), outDir: tmp(),
    inputs: { confirm: CONFIRM_PHRASE, expectedSha: sha256(RULES_V2), expectedCurrent: `projects/${STAGING_PROJECT}/rulesets/old-1` } });
  assert.equal(result.ok, false);
  assert.match(result.reason, /403|PERMISSION/);
  assert.equal(api.current(), `projects/${STAGING_PROJECT}/rulesets/old-1`);
});

// ---- the workflow

test("the workflow: manual or pull request only, Staging environment, integration branch only, emulator tests before any write", () => {
  const yml = fs.readFileSync(new URL("../.github/workflows/staging-firestore-rules.yml", import.meta.url), "utf8");
  const script = fs.readFileSync(new URL("../scripts/staging-firestore-rules.mjs", import.meta.url), "utf8");
  const triggers = yml.slice(yml.indexOf("\non:"), yml.indexOf("\npermissions:"));
  assert.match(triggers, /workflow_dispatch:/);
  assert.doesNotMatch(triggers, /\n  push:|schedule:|workflow_run:/, "never on a push or a schedule");
  assert.doesNotMatch(yml + script.replace(/["'`]aqar-b5d76["'`]/g, ""), /aqar-b5d76/, "Production appears only as the refused project id");
  assert.match(yml, /environment: staging/);
  assert.match(yml, /if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/codex\/unified-staging-lineage-2026-08-29'/);
  const job = yml.slice(yml.indexOf("  staging-rules:"));
  assert.ok(job.indexOf("npm run test:rules") > -1 && job.indexOf("npm run test:rules") < job.indexOf("scripts/staging-firestore-rules.mjs"), "the emulator suites run before the tool");
});
