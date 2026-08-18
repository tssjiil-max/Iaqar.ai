/**
 * Staging smoke for follow-up scheduling UI + worker endpoints.
 * Usage: node scripts/staging-followup-e2e.mjs
 */
import { readFileSync } from "node:fs";

const STAGING_HOST = process.env.STAGING_HOSTING_URL || "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const WORKER = process.env.STAGING_WORKER_URL || "https://iaqar-intake-staging.iaqar-ai.workers.dev";

const report = { host: STAGING_HOST, worker: WORKER, checks: [] };

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow" });
  return { ok: response.ok, status: response.status, text: await response.text() };
}

const index = await fetchText(`${STAGING_HOST}/`);
report.checks.push({ name: "hosting_index", ok: index.ok, status: index.status });

const sw = await fetchText(`${STAGING_HOST}/firebase-messaging-sw.js`);
const swCache = (sw.text.match(/IAQAR_CACHE\s*=\s*"([^"]+)"/) || [])[1] || "";
report.checks.push({ name: "sw_cache", ok: swCache === "iaqar-shell-followup-v1", value: swCache });

const workflow = sw.text.includes("iaqar-shell-followup-v1")
  ? readFileSync(new URL("../public/js/workflow-office.js", import.meta.url), "utf8")
  : "";
if (workflow) {
  report.checks.push({ name: "appointment_card", ok: workflow.includes("الموعد القادم") });
  report.checks.push({ name: "recipient_select", ok: workflow.includes("التأكيد مع") });
  report.checks.push({ name: "ops_grid", ok: readFileSync(new URL("../public/index.html", import.meta.url), "utf8").includes("grid-template-columns:72px minmax(0, 1fr) 68px") });
}

const health = await fetchText(`${WORKER}/health`);
const healthJson = JSON.parse(health.text || "{}");
report.checks.push({ name: "worker_health", ok: healthJson.ok === true && healthJson.backendReady === true });
report.checks.push({ name: "worker_staging", ok: healthJson.deploymentEnvironment === "staging" });

const commitSha = process.env.GIT_COMMIT || "";
if (commitSha) {
  report.commitSha = commitSha;
}

report.pass = report.checks.every((check) => check.ok);
console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);
