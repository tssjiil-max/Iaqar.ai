#!/usr/bin/env node
/**
 * Production pilot — remember what is live, and put it back.
 *   record <dir>    saves the live Hosting version and the live Firestore rules (rollback-point.json + rules file)
 *   restore <dir>   puts that Hosting version back live and re-releases those rules
 * The Worker's previous version is recorded/restored by the workflow with wrangler (deployments list / rollback).
 * Never touches documents. Never prints a secret.   env: FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON
 */
import fs from "node:fs";
import path from "node:path";
import { getProductionAccessToken, loadProductionServiceAccount, PRODUCTION_PROJECT } from "./production-credentials.mjs";

const [mode, dir] = process.argv.slice(2);
process.on("unhandledRejection", (error) => { console.error(String(error?.message || error)); process.exit(1); });
if (!["record", "restore"].includes(mode) || !dir) { console.error("usage: production-pilot-rollback.mjs record|restore <dir>"); process.exit(2); }
fs.mkdirSync(dir, { recursive: true });
const sa = loadProductionServiceAccount();
if (!sa.ok) { console.error(`production credentials: ${sa.reason}`); process.exit(1); }
const token = await getProductionAccessToken(sa.serviceAccount);
async function call(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(60_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${new URL(url).pathname} HTTP ${response.status}: ${body?.error?.message || ""}`.slice(0, 300));
  return body;
}
const HOSTING = "https://firebasehosting.googleapis.com/v1beta1";
const RULES = "https://firebaserules.googleapis.com/v1";
const sites = await call(`${HOSTING}/projects/${PRODUCTION_PROJECT}/sites`);
const site = (sites.sites || []).find((s) => s.type === "DEFAULT_SITE")?.name || sites.sites?.[0]?.name || `projects/${PRODUCTION_PROJECT}/sites/${PRODUCTION_PROJECT}`;
const file = path.join(dir, "rollback-point.json");

if (mode === "record") {
  const live = await call(`${HOSTING}/${site}/channels/live`);
  const versionName = live.release?.version?.name || "";
  if (!versionName) throw new Error("no live Hosting version to come back to");
  const release = await call(`${RULES}/projects/${PRODUCTION_PROJECT}/releases/cloud.firestore`);
  const ruleset = await call(`${RULES}/${release.rulesetName}`);
  const rulesFiles = ruleset.source?.files || [];
  fs.writeFileSync(file, JSON.stringify({ recordedAt: new Date().toISOString(), site, hostingVersion: versionName, rulesetName: release.rulesetName, rulesFiles }, null, 2));
  console.log(`rollback point: Hosting ${versionName.split("/").pop()} · rules ${release.rulesetName.split("/").pop()}`);
} else {
  const point = JSON.parse(fs.readFileSync(file, "utf8"));
  // Hosting: the recorded version becomes the live release again.
  const siteId = point.site.split("/").pop();
  const recordedVersion = point.hostingVersion.replace(/^projects\/[^/]+\//, "");
  const liveNow = String((await call(`${HOSTING}/${point.site}/channels/live`)).release?.version?.name || "").replace(/^projects\/[^/]+\//, "");
  if (liveNow === recordedVersion) console.log("Hosting: the recorded version is still live — nothing to restore.");
  else await call(`${HOSTING}/sites/${siteId}/releases?versionName=${encodeURIComponent(recordedVersion)}`, { method: "POST", body: JSON.stringify({ message: "pilot rollback" }) });
  // Rules: the recorded ruleset is released again (it still exists; a new copy if it was deleted).
  const rulesNow = (await call(`${RULES}/projects/${PRODUCTION_PROJECT}/releases/cloud.firestore`)).rulesetName;
  if (rulesNow === point.rulesetName) { console.log("Rules: the recorded ruleset is still released — nothing to restore."); process.exit(0); }
  let rulesetName = point.rulesetName;
  try { await call(`${RULES}/${rulesetName}`); } catch {
    rulesetName = (await call(`${RULES}/projects/${PRODUCTION_PROJECT}/rulesets`, { method: "POST", body: JSON.stringify({ source: { files: point.rulesFiles } }) })).name;
  }
  await call(`${RULES}/projects/${PRODUCTION_PROJECT}/releases/cloud.firestore`, { method: "PATCH", body: JSON.stringify({ release: { name: `projects/${PRODUCTION_PROJECT}/releases/cloud.firestore`, rulesetName } }) });
  console.log(`restored: Hosting ${point.hostingVersion.split("/").pop()} · rules ${rulesetName.split("/").pop()}`);
}
