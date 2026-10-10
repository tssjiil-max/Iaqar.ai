#!/usr/bin/env node
/**
 * Production pilot — BEFORE anything is deployed (read-only on the data):
 *   1. a full snapshot of the production Firestore (every document, every sub-collection) + the live
 *      Firestore rules source, written gzipped and uploaded to the production project's OWN Storage bucket
 *      (customer data never goes to GitHub);
 *   2. a compatibility scan of that snapshot for the new office app (who can still open each office).
 * Prints counts only — never a document's content, a phone, a name or a secret.
 * Exit 1 = do not deploy (snapshot not stored, or an office would lose access).
 *   env: FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON, OUT_DIR
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { getProductionAccessToken, loadProductionServiceAccount, PRODUCTION_PROJECT } from "./production-credentials.mjs";

const OUT = process.env.OUT_DIR || "production-pilot";
fs.mkdirSync(OUT, { recursive: true });
const BASE = `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)/documents`;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const notice = (title, text) => console.log(process.env.GITHUB_ACTIONS ? `::notice title=${title}::${String(text).replace(/\n/g, "%0A")}` : `${title}: ${text}`);
const fail = (title, text) => { console.log(process.env.GITHUB_ACTIONS ? `::error title=${title}::${text}` : `ERROR ${title}: ${text}`); process.exitCode = 1; };

const sa = loadProductionServiceAccount();
if (!sa.ok) { fail("production credentials", `${sa.reason}`); process.exit(1); }
const token = await getProductionAccessToken(sa.serviceAccount);
const auth = { Authorization: `Bearer ${token}` };

async function json(url, init = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, { ...init, headers: { ...auth, ...(init.headers || {}) }, signal: AbortSignal.timeout(60_000) });
    if (response.status === 429 || response.status >= 500) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${new URL(url).pathname.split("/documents")[1] || url.split("?")[0]} HTTP ${response.status}`);
    return body;
  }
  throw new Error("Firestore kept answering 429/5xx");
}

async function collectionIds(docPath) {
  const ids = [];
  let pageToken = "";
  do {
    const body = await json(`${BASE}${docPath ? `/${docPath}` : ""}:listCollectionIds`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pageSize: 300, pageToken }) });
    ids.push(...(body.collectionIds || []));
    pageToken = body.nextPageToken || "";
  } while (pageToken);
  return ids;
}

const docs = [];
async function dumpCollection(collPath) {
  let pageToken = "";
  do {
    const url = new URL(`${BASE}/${collPath}`);
    url.searchParams.set("pageSize", "300");
    url.searchParams.set("showMissing", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const body = await json(url.toString());
    for (const doc of body.documents || []) {
      const rel = doc.name.split("/documents/")[1];
      if (doc.fields || doc.createTime) docs.push({ path: rel, fields: doc.fields || {}, updateTime: doc.updateTime || "" });
      for (const sub of await collectionIds(rel)) await dumpCollection(`${rel}/${sub}`);
    }
    pageToken = body.nextPageToken || "";
  } while (pageToken);
}

// ------------------------------------------------------------------ 1. snapshot
const roots = (await collectionIds("")).filter((id) => id !== "pilotBackups");
for (const root of roots) await dumpCollection(root);
let rulesSource = "";
try {
  const release = await json(`https://firebaserules.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/releases/cloud.firestore`);
  const ruleset = await json(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
  rulesSource = (ruleset.source?.files || []).map((f) => f.content).join("\n");
} catch (error) {
  fail("live rules not read", error.message);
}
const snapshot = JSON.stringify({ project: PRODUCTION_PROJECT, takenAt: new Date().toISOString(), roots, documents: docs, firestoreRules: rulesSource });
const gz = zlib.gzipSync(Buffer.from(snapshot));
const sha256 = crypto.createHash("sha256").update(gz).digest("hex");
fs.writeFileSync(path.join(OUT, "live-firestore.rules"), rulesSource || "// not read");

let stored = "";
const tried = [];
for (const bucket of [`${PRODUCTION_PROJECT}.firebasestorage.app`, `${PRODUCTION_PROJECT}.appspot.com`]) {
  const object = `pilot-backups/firestore-${stamp}.json.gz`;
  const response = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(object)}`, {
    method: "POST", headers: { ...auth, "content-type": "application/gzip" }, body: gz, signal: AbortSignal.timeout(120_000)
  }).catch((error) => ({ ok: false, status: String(error?.message || error) }));
  if (response.ok) { stored = `gs://${bucket}/${object}`; break; }
  tried.push(`${bucket}: HTTP ${response.status}`);
}
if (!stored) {
  // No Storage bucket on this plan/project: the snapshot is kept INSIDE the production database, in a
  // collection no client and no Worker code reads or writes (rules deny everything not listed). Chunks of
  // ≤ 700 KB (Firestore's 1 MiB document limit), restorable with scripts/production-pilot-restore.mjs.
  notice("Storage bucket not available", tried.join(" · "));
  const b64 = gz.toString("base64");
  const size = 700_000;
  const parts = Math.ceil(b64.length / size);
  const root = `pilotBackups/${stamp}`;
  const write = async (docPath, fields) => {
    const response = await fetch(`${BASE}/${docPath}`, { method: "PATCH", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ fields }), signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`${docPath.split("/").slice(0, 2).join("/")} HTTP ${response.status}`);
  };
  try {
    for (let i = 0; i < parts; i += 1) await write(`${root}/chunks/${String(i).padStart(4, "0")}`, { index: { integerValue: String(i) }, data: { stringValue: b64.slice(i * size, (i + 1) * size) } });
    await write(root, { takenAt: { timestampValue: new Date().toISOString() }, sha256: { stringValue: sha256 }, parts: { integerValue: String(parts) }, documents: { integerValue: String(docs.length) }, complete: { booleanValue: true } });
    stored = `firestore://${root} (${parts} part${parts === 1 ? "" : "s"})`;
  } catch (error) {
    notice("snapshot inside Firestore failed", error.message);
  }
}
const counts = {};
for (const d of docs) { const top = d.path.split("/")[0]; counts[top] = (counts[top] || 0) + 1; }
fs.writeFileSync(path.join(OUT, "backup-manifest.json"), JSON.stringify({ takenAt: new Date().toISOString(), stored, sha256, bytes: gz.length, documents: docs.length, byRootCollection: counts, rulesRead: Boolean(rulesSource) }, null, 2));
if (!stored) fail("snapshot not stored", "neither the production Storage bucket nor the database accepted it — nothing is deployed without a backup");
else notice("production snapshot stored", `${stored}\n${docs.length} documents · ${(gz.length / 1024).toFixed(0)} KB · sha256 ${sha256.slice(0, 16)}…`);

// ------------------------------------------------------------------ 2. compatibility for the new office app
const str = (fields, key) => String(fields?.[key]?.stringValue || "");
const bool = (fields, key) => fields?.[key]?.booleanValue;
const offices = docs.filter((d) => /^offices\/[^/]+$/.test(d.path));
const membersOf = (id) => docs.filter((d) => d.path.startsWith(`offices/${id}/members/`));
const rows = offices.map((o) => {
  const id = o.path.split("/")[1];
  const members = membersOf(id);
  const activeMembers = members.filter((m) => bool(m.fields, "active") !== false).length;
  const owner = str(o.fields, "ownerUid");
  const fixture = bool(o.fields, "isTestFixture") === true;
  const status = (str(o.fields, "accountStatus") || str(o.fields, "approvalStatus") || (bool(o.fields, "active") === false ? "inactive" : "active")).toLowerCase();
  const records = docs.filter((d) => d.path.startsWith(`offices/${id}/opportunities/`) && d.path.split("/").length === 4).length;
  return { id, fixture, status, hasOwner: Boolean(owner), activeMembers, records, canOpen: Boolean(owner) || activeMembers > 0 };
});
const real = rows.filter((r) => !r.fixture && id(r) !== "platform");
function id(r) { return r.id; }
const locked = real.filter((r) => ["active", "approved"].includes(r.status) && !r.canOpen);
fs.writeFileSync(path.join(OUT, "compat-report.json"), JSON.stringify({ offices: real.length, activeOrApproved: real.filter((r) => ["active", "approved"].includes(r.status)).length, lockedOut: locked.map((r) => ({ id: r.id, records: r.records })), perOffice: real.map(({ id: officeId, status, hasOwner, activeMembers, records }) => ({ officeId, status, hasOwner, activeMembers, records })) }, null, 2));
notice("compatibility", `${real.length} real offices · ${locked.length} would be locked out of the new app`);
if (locked.length) fail("offices would lose access", `${locked.length} active office(s) have no ownerUid and no active member — see compat-report.json`);
