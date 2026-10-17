/**
 * Staging economic test mode in the deploy path: ECONOMIC_TEST_MODE=enabled on the Staging Worker only, no Gemini key
 * passed to the Staging deploy, and the deploy proves (by secret names only) that no Gemini key is left on the Worker,
 * stopping with a clear failure when it cannot.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { secretNames } from "../scripts/staging-secret-names.mjs";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");
const section = (toml, name) => toml.split(/^\[/m).find((part) => part.startsWith(`${name}]`)) || "";

test("ECONOMIC_TEST_MODE is enabled on the Staging Worker only", () => {
  const toml = read("worker/wrangler.toml");
  assert.match(section(toml, "env.staging.vars"), /^ECONOMIC_TEST_MODE = "enabled"$/m);
  assert.doesNotMatch(section(toml, "vars"), /ECONOMIC_TEST_MODE/, "production vars are untouched");
  assert.doesNotMatch(toml, /WHATSAPP_AGENT_SEND\s*=\s*"enabled"/, "no Worker env turns real WhatsApp sending on");
});

test("no Staging deploy workflow passes GEMINI_API_KEY", () => {
  for (const file of [".github/workflows/deploy-unified-staging.yml", ".github/workflows/retire-legacy-opportunity-manager.yml"]) {
    const source = read(file);
    assert.ok(source.includes("npm run deploy:staging:safe"), `${file} deploys Staging`);
    assert.doesNotMatch(source, /GEMINI_API_KEY\s*:/, `${file} must not pass a Gemini key`);
  }
});

test("the Staging deploy never sets a Gemini key and checks names, not values", () => {
  const script = read("scripts/deploy-staging.sh");
  assert.doesNotMatch(script, /secret put GEMINI_API_KEY/);
  assert.ok(script.includes("wrangler secret list --env staging --format json"));
  assert.ok(script.includes("wrangler secret delete GEMINI_API_KEY --env staging"));
  assert.ok(script.indexOf("Economic mode: prove GEMINI_API_KEY is absent") < script.indexOf("smoke-staging.mjs"), "checked before Staging smoke tests");
});

test("secret names are read from Wrangler JSON output, and unreadable output is never treated as absent", () => {
  assert.deepEqual(secretNames('▲ [WARNING] proxy\n[{"name":"A","type":"secret_text"},{"name":"GEMINI_API_KEY","type":"secret_text"}]'), ["A", "GEMINI_API_KEY"]);
  assert.deepEqual(secretNames("[]"), []);
  assert.equal(secretNames(""), null);
  assert.equal(secretNames("Authentication error"), null);
  assert.equal(secretNames('[{"value":"x"}]'), null);
  const run = (input) => spawnSync(process.execPath, [path.join(ROOT, "scripts/staging-secret-names.mjs"), "GEMINI_API_KEY"], { input }).status;
  assert.equal(run('[{"name":"GEMINI_API_KEY","type":"secret_text"}]'), 0);
  assert.equal(run('[{"name":"OTHER","type":"secret_text"}]'), 1);
  assert.equal(run("not json"), 2);
});

/** Runs the deploy script's economic-mode block against a fake `npx wrangler`. */
function runGate({ listed, listFails = false, deleteWorks = true }) {
  const dir = mkdtempSync(path.join(tmpdir(), "iaqar-econ-gate-"));
  mkdirSync(path.join(dir, "worker")); mkdirSync(path.join(dir, "scripts")); mkdirSync(path.join(dir, "bin"));
  copyFileSync(path.join(ROOT, "scripts/staging-secret-names.mjs"), path.join(dir, "scripts/staging-secret-names.mjs"));
  writeFileSync(path.join(dir, "state"), listed ? "present" : "absent");
  writeFileSync(path.join(dir, "bin/npx"), `#!/usr/bin/env bash
echo "$*" >> "${dir}/calls"
if [[ "$*" == "wrangler secret list --env staging --format json" ]]; then
  ${listFails ? 'echo "Authentication error" >&2; exit 1' : `if [[ "$(cat "${dir}/state")" == present ]]; then echo '[{"name":"GEMINI_API_KEY","type":"secret_text"}]'; else echo '[{"name":"FIREBASE_PRIVATE_KEY","type":"secret_text"}]'; fi`}
elif [[ "$*" == "wrangler secret delete GEMINI_API_KEY --env staging" ]]; then
  ${deleteWorks ? `echo absent > "${dir}/state"` : "exit 1"}
else exit 9; fi
`);
  chmodSync(path.join(dir, "bin/npx"), 0o755);
  const script = read("scripts/deploy-staging.sh");
  const start = script.indexOf('echo "--- Economic mode');
  const end = script.indexOf("\n)\n", start) + 3;
  assert.ok(start > 0 && end > start, "economic-mode block found");
  writeFileSync(path.join(dir, "gate.sh"), `set -Eeuo pipefail\ncd "${dir}"\nCURRENT_STAGE=""\ndie() { echo "ERROR: $1" >&2; exit 1; }\n${script.slice(start, end)}`);
  const result = spawnSync("bash", [path.join(dir, "gate.sh")], { encoding: "utf8", env: { ...process.env, PATH: `${path.join(dir, "bin")}:${process.env.PATH}` } });
  let calls = "";
  try { calls = readFileSync(path.join(dir, "calls"), "utf8"); } catch {}
  return { status: result.status, out: result.stdout + result.stderr, calls };
}

test("deploy gate: an old Gemini key is deleted, then its absence is re-checked", () => {
  const r = runGate({ listed: true });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /GEMINI_API_KEY absent on the staging Worker/);
  assert.deepEqual(r.calls.trim().split("\n"), ["wrangler secret list --env staging --format json", "wrangler secret delete GEMINI_API_KEY --env staging", "wrangler secret list --env staging --format json"]);
});

test("deploy gate: no key → nothing deleted, deploy continues", () => {
  const r = runGate({ listed: false });
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.calls, /delete/);
});

test("deploy gate: secret names unreadable → the deploy stops with a clear failure", () => {
  const r = runGate({ listed: false, listFails: true });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /could not read the staging Worker secret names to prove GEMINI_API_KEY is absent/);
});

test("deploy gate: deletion fails → the deploy stops with a clear failure", () => {
  const r = runGate({ listed: true, deleteWorks: false });
  assert.notEqual(r.status, 0);
  assert.match(r.out, /could not delete GEMINI_API_KEY from the staging Worker/);
});

test("deploy scripts parse", () => {
  for (const file of ["scripts/deploy-staging.sh", "scripts/deploy-staging-safe.sh"]) execFileSync("bash", ["-n", path.join(ROOT, file)]);
});
