// Firestore rules → Staging only. Run by .github/workflows/staging-firestore-rules.yml (never on a push).
//
//   plan      read the rules released on iaqar-ai-staging, keep a copy, show the difference with firestore.rules and
//             both hashes. Writes nothing.
//   deploy    publish firestore.rules — only with the confirmation phrase, the file hash shown by the plan, and the
//             release the plan saw (so what is published is what was reviewed, onto what was reviewed). Then verify
//             that the release serves the published file.
//   rollback  point the release back at a ruleset kept by an earlier plan or deploy (same confirmations).
//
//   env: FIREBASE_SERVICE_ACCOUNT_JSON (the Staging service account), RULES_MODE, RULES_CONFIRM, RULES_EXPECTED_SHA256,
//        RULES_EXPECTED_CURRENT, RULES_ROLLBACK_TO, OUT_DIR
// Uses the Firebase Rules REST API with a token signed from the Staging service account. The project is fixed:
// a service account of any other project is refused before any request.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

export const STAGING_PROJECT = "iaqar-ai-staging";
const PRODUCTION_PROJECT = "aqar-b5d76";
export const CONFIRM_PHRASE = "publish-staging-firestore-rules";
const API = "https://firebaserules.googleapis.com/v1";
const RELEASE = `projects/${STAGING_PROJECT}/releases/cloud.firestore`;

export const sha256 = (text) => crypto.createHash("sha256").update(String(text)).digest("hex");

/** Whether a run may go ahead, decided from its inputs and what it has read — before any write. */
export function decide({ mode, projectId, confirm = "", fileSha = "", expectedSha = "", currentRuleset = "", expectedCurrent = "", rollbackRuleset = "" }) {
  if (projectId !== STAGING_PROJECT || projectId === PRODUCTION_PROJECT) return { ok: false, reason: `refusing: the project must be ${STAGING_PROJECT} (staging only), not ${projectId || "unknown"}` };
  if (mode === "plan") return { ok: true };
  if (mode !== "deploy" && mode !== "rollback") return { ok: false, reason: `unknown mode ${mode}` };
  if (confirm !== CONFIRM_PHRASE) return { ok: false, reason: `the confirmation must be exactly «${CONFIRM_PHRASE}»` };
  if (!expectedCurrent || expectedCurrent !== currentRuleset) return { ok: false, reason: `the release is ${currentRuleset || "unknown"}, not the reviewed ${expectedCurrent || "(none given)"}: run a new plan` };
  if (mode === "deploy" && (!expectedSha || expectedSha !== fileSha)) return { ok: false, reason: `firestore.rules is ${fileSha}, not the reviewed ${expectedSha || "(none given)"}` };
  if (mode === "rollback" && !String(rollbackRuleset).startsWith(`projects/${STAGING_PROJECT}/rulesets/`)) return { ok: false, reason: "the rollback must name a ruleset of the Staging project" };
  return { ok: true };
}

const b64url = (value) => Buffer.from(value).toString("base64url");
async function accessToken(serviceAccount, fetchImpl) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: serviceAccount.client_email, scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 600 };
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: serviceAccount.private_key_id }))}.${b64url(JSON.stringify(claims))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(serviceAccount.private_key, "base64url");
  const response = await fetchImpl("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }).toString() });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(`token refused (${response.status})`);
  return body.access_token;
}

function api(fetchImpl, token) {
  return async (method, resource, body) => {
    const response = await fetchImpl(`${API}/${resource}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${resource} → ${response.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  };
}
const sourceOf = (ruleset) => (ruleset.source?.files || []).find((f) => f.name === "firestore.rules")?.content ?? (ruleset.source?.files || [])[0]?.content ?? "";

function writeDiff(outDir, released, file) {
  const a = path.join(outDir, "released.rules");
  const b = path.join(outDir, "firestore.rules");
  fs.writeFileSync(b, file);
  const run = spawnSync("diff", ["-u", "--label", "released on iaqar-ai-staging", "--label", "firestore.rules (this commit)", a, b], { encoding: "utf8" });
  const diff = run.error ? "(diff unavailable: compare released.rules with firestore.rules)\n" : run.stdout || "(no difference)\n";
  fs.writeFileSync(path.join(outDir, "rules.diff"), diff);
  return diff;
}

/** One run of the tool. Returns { ok, reason?, … } and never throws for an expected refusal. */
export async function runRulesTool({ mode, env = process.env, fetchImpl = fetch, rulesPath, outDir, inputs = {} }) {
  fs.mkdirSync(outDir, { recursive: true });
  const { serviceAccount } = parseFirebaseServiceAccountJson(env.FIREBASE_SERVICE_ACCOUNT_JSON, STAGING_PROJECT);
  let projectId = "";
  try { projectId = String(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}").project_id || ""); } catch (_) { /* reported below */ }
  const first = decide({ mode: "plan", projectId: serviceAccount ? projectId : "" });
  if (!serviceAccount || !first.ok) return { ok: false, reason: first.reason || "refusing: FIREBASE_SERVICE_ACCOUNT_JSON is not a valid Staging service account" };
  const file = fs.readFileSync(rulesPath, "utf8");
  const fileSha = sha256(file);
  try {
    // parseFirebaseServiceAccountJson returns null for any project other than Staging: checked above.
    const call = api(fetchImpl, await accessToken(serviceAccount, fetchImpl));
    const release = await call("GET", RELEASE);
    const currentRuleset = String(release.rulesetName || "");
    const released = sourceOf(await call("GET", currentRuleset));
    const state = { project: STAGING_PROJECT, release: RELEASE, currentRuleset, releaseUpdateTime: release.updateTime || "", currentSha: sha256(released), fileSha };
    fs.writeFileSync(path.join(outDir, "released.rules"), released);
    fs.writeFileSync(path.join(outDir, "released.json"), JSON.stringify(state, null, 2));
    const diff = writeDiff(outDir, released, file);
    const verdict = decide({ mode, projectId, confirm: inputs.confirm, fileSha, expectedSha: inputs.expectedSha, currentRuleset, expectedCurrent: inputs.expectedCurrent, rollbackRuleset: inputs.rollbackRuleset });
    if (!verdict.ok) return { ok: false, reason: verdict.reason, ...state, same: state.currentSha === fileSha, diff };
    if (mode === "plan") return { ok: true, mode, ...state, same: state.currentSha === fileSha, diff };

    const target = mode === "deploy"
      ? (await call("POST", `projects/${STAGING_PROJECT}/rulesets`, { source: { files: [{ name: "firestore.rules", content: file }] } })).name
      : inputs.rollbackRuleset;
    const expectedSource = mode === "deploy" ? file : sourceOf(await call("GET", target));
    await call("PATCH", RELEASE, { release: { name: RELEASE, rulesetName: target } });
    const after = await call("GET", RELEASE);
    const served = sourceOf(await call("GET", String(after.rulesetName || "")));
    const verified = after.rulesetName === target && sha256(served) === sha256(expectedSource);
    const result = { ok: verified, mode, ...state, previousRuleset: currentRuleset, newRuleset: target, servedSha: sha256(served), verified, ...(verified ? {} : { reason: "the release does not serve the expected ruleset after the update" }) };
    fs.writeFileSync(path.join(outDir, `${mode}.json`), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    return { ok: false, reason: String(error?.message || error), fileSha };
  }
}

// ---- CLI (the workflow)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outDir = process.env.OUT_DIR || path.join(root, "staging-rules-out");
  const result = await runRulesTool({
    mode: String(process.env.RULES_MODE || "plan"), rulesPath: path.join(root, "firestore.rules"), outDir,
    inputs: { confirm: process.env.RULES_CONFIRM || "", expectedSha: process.env.RULES_EXPECTED_SHA256 || "", expectedCurrent: process.env.RULES_EXPECTED_CURRENT || "", rollbackRuleset: process.env.RULES_ROLLBACK_TO || "" }
  });
  const { diff, ...summary } = result;
  console.log(JSON.stringify(summary, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      `### Firestore rules → ${STAGING_PROJECT} — ${summary.mode || process.env.RULES_MODE} ${result.ok ? "✅" : "❌"}`, "",
      ...(summary.reason ? [`**${summary.reason}**`, ""] : []),
      `- released ruleset: \`${summary.currentRuleset || "?"}\` (sha256 \`${summary.currentSha || "?"}\`)`,
      `- firestore.rules in this commit: sha256 \`${summary.fileSha || "?"}\``,
      ...(summary.newRuleset ? [`- now released: \`${summary.newRuleset}\` (verified: ${summary.verified})`, `- roll back with: \`${summary.previousRuleset}\``] : []),
      "", "<details><summary>difference</summary>", "", "```diff", String(diff || "").slice(0, 60000), "```", "", "</details>", ""
    ].join("\n"));
  }
  process.exitCode = result.ok ? 0 : 1;
}
