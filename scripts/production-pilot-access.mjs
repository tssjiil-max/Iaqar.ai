#!/usr/bin/env node
/**
 * Production pilot — the platform's pilot switch (platformSettings/pilotAccess), changed only as the owner approved:
 *   record <dir>  save the current document (pilot-access-before.json) — nothing changes
 *   test   <dir>  office-link routing ON; the real offices + this run's two QA offices authorized (for the live journey)
 *   final  <dir>  office-link routing ON; the real offices authorized (the QA offices removed again)
 *   restore <dir> put back exactly what was recorded
 * Only these fields are written: enabled (kept), maxOffices, authorizedOfficeIds, featureFlagsJson.
 * Prints counts and office ids only.   env: FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON
 */
import fs from "node:fs";
import path from "node:path";
import { getProductionAccessToken, loadProductionServiceAccount, PRODUCTION_PROJECT } from "./production-credentials.mjs";

const [mode, dir] = process.argv.slice(2);
if (!["record", "test", "final", "restore"].includes(mode) || !dir) { console.error("usage: production-pilot-access.mjs record|test|final|restore <dir>"); process.exit(2); }
process.on("unhandledRejection", (error) => { console.error(String(error?.message || error)); process.exit(1); });
const QA_OFFICES = ["qa-office-os-pilot", "qa-office-os-pilot-b"];
const sa = loadProductionServiceAccount();
if (!sa.ok) { console.error(sa.reason); process.exit(1); }
const token = await getProductionAccessToken(sa.serviceAccount);
const BASE = `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)/documents`;
const DOC = `${BASE}/platformSettings/pilotAccess`;
async function call(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, signal: AbortSignal.timeout(60_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok && !(response.status === 404 && (!init.method || init.method === "GET"))) throw new Error(`${new URL(url).pathname.split("/documents/")[1] || url} HTTP ${response.status}`);
  return response.status === 404 ? null : body;
}
const file = path.join(dir, "pilot-access-before.json");
const notice = (text) => console.log(process.env.GITHUB_ACTIONS ? `::notice title=pilot access (${mode})::${text}` : text);

if (mode === "record") {
  fs.mkdirSync(dir, { recursive: true });
  const doc = await call(DOC);
  fs.writeFileSync(file, JSON.stringify({ exists: Boolean(doc), fields: doc?.fields || {} }, null, 2));
  const f = doc?.fields || {};
  notice(`recorded · enabled=${f.enabled?.booleanValue === true} · authorized=${(f.authorizedOfficeIds?.arrayValue?.values || []).length} · maxOffices=${f.maxOffices?.integerValue || "-"}`);
  process.exit(0);
}

const before = JSON.parse(fs.readFileSync(file, "utf8"));
const mask = ["enabled", "maxOffices", "authorizedOfficeIds", "featureFlagsJson"];
const qs = mask.map((m) => `updateMask.fieldPaths=${m}`).join("&");

if (mode === "restore") {
  if (!before.exists) {
    // There was no document: the pilot gate was off. Writing enabled=false gives exactly that behaviour back.
    await call(`${DOC}?${qs}`, { method: "PATCH", body: JSON.stringify({ fields: { enabled: { booleanValue: false } } }) });
  } else {
    const fields = Object.fromEntries(Object.entries(before.fields).filter(([k]) => mask.includes(k)));
    await call(`${DOC}?${qs}`, { method: "PATCH", body: JSON.stringify({ fields }) });
  }
  notice("restored exactly as recorded");
  process.exit(0);
}

// The real offices: every office document that is not a test fixture (and not the platform scope).
const offices = [];
let pageToken = "";
do {
  const body = await call(`${BASE}/offices?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ""}`);
  for (const d of body?.documents || []) {
    const id = d.name.split("/").pop();
    if (id === "platform" || d.fields?.isTestFixture?.booleanValue === true) continue;
    offices.push(id);
  }
  pageToken = body?.nextPageToken || "";
} while (pageToken);

const f = before.fields || {};
const existing = (f.authorizedOfficeIds?.arrayValue?.values || []).map((v) => String(v.stringValue || "")).filter(Boolean);
let flags = {};
try { flags = JSON.parse(f.featureFlagsJson?.stringValue || "{}") || {}; } catch { flags = {}; }
flags.publicOpportunityRouting = true;
const authorized = [...new Set([...existing, ...offices, ...(mode === "test" ? QA_OFFICES : [])])];
const recordedMax = Number(f.maxOffices?.integerValue || 5);
// Never below what was set; raised only as far as needed to keep every authorized office (cap 50).
const maxOffices = Math.min(50, Math.max(recordedMax, authorized.length));
const fields = {
  enabled: { booleanValue: before.exists ? f.enabled?.booleanValue === true : false },
  maxOffices: { integerValue: String(maxOffices) },
  authorizedOfficeIds: { arrayValue: { values: authorized.map((v) => ({ stringValue: v })) } },
  featureFlagsJson: { stringValue: JSON.stringify(flags) }
};
await call(`${DOC}?${qs}`, { method: "PATCH", body: JSON.stringify({ fields }) });
notice(`office-link routing ON · authorized ${authorized.length} (${offices.length} real${mode === "test" ? " + 2 QA" : ""}) · maxOffices ${maxOffices}`);
