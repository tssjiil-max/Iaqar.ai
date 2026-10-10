#!/usr/bin/env node
/**
 * Read a production pilot snapshot back (from gs:// or from pilotBackups/<stamp> inside Firestore) and write
 * it to a LOCAL file for inspection. It does not write anything to the database: restoring documents is a
 * deliberate owner decision, done document by document from this file.
 *   node scripts/production-pilot-restore.mjs <stamp> <out.json>
 *   env: FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON
 */
import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { getProductionAccessToken, loadProductionServiceAccount, PRODUCTION_PROJECT } from "./production-credentials.mjs";

const [stamp, out] = process.argv.slice(2);
if (!stamp || !out) { console.error("usage: production-pilot-restore.mjs <stamp> <out.json>"); process.exit(2); }
const sa = loadProductionServiceAccount();
if (!sa.ok) { console.error(sa.reason); process.exit(1); }
const token = await getProductionAccessToken(sa.serviceAccount);
const BASE = `https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)/documents/pilotBackups/${stamp}`;
const get = async (url) => { const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const head = await get(BASE);
const parts = Number(head.fields.parts.integerValue);
let b64 = "";
for (let i = 0; i < parts; i += 1) b64 += (await get(`${BASE}/chunks/${String(i).padStart(4, "0")}`)).fields.data.stringValue;
const gz = Buffer.from(b64, "base64");
if (crypto.createHash("sha256").update(gz).digest("hex") !== head.fields.sha256.stringValue) throw new Error("checksum mismatch");
fs.writeFileSync(out, zlib.gunzipSync(gz));
console.log(`snapshot ${stamp}: ${head.fields.documents.integerValue} documents → ${out}`);
