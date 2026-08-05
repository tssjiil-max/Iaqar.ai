#!/usr/bin/env node
/**
 * Phase 9A — write a temporary Google service-account JSON for firebase-tools.
 * Reads FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY / FIREBASE_PRIVATE_KEY_ID.
 * Never prints secret values. Caller must delete the file after use.
 *
 * Usage: node scripts/staging-gac.mjs /absolute/path/to/temp.json
 */
import { closeSync, openSync, writeFileSync } from "node:fs";

const outPath = process.argv[2];
if (!outPath || outPath.includes("..") || !(outPath.startsWith("/tmp/") || outPath.startsWith("/var/tmp/"))) {
  console.error("staging-gac: refuse to write outside /tmp or /var/tmp");
  process.exit(2);
}

const email = process.env.FIREBASE_CLIENT_EMAIL;
const keyRaw = process.env.FIREBASE_PRIVATE_KEY;
const keyId = process.env.FIREBASE_PRIVATE_KEY_ID;
const projectId = process.env.FIREBASE_STAGING_PROJECT_ID || "iaqar-ai-staging";

if (!email || !String(email).trim()) {
  console.error("staging-gac: FIREBASE_CLIENT_EMAIL is required");
  process.exit(1);
}
if (!keyRaw || !String(keyRaw).trim()) {
  console.error("staging-gac: FIREBASE_PRIVATE_KEY is required");
  process.exit(1);
}
if (!keyId || !String(keyId).trim()) {
  console.error("staging-gac: FIREBASE_PRIVATE_KEY_ID is required");
  process.exit(1);
}

const privateKey = String(keyRaw).includes("\\n")
  ? String(keyRaw).replace(/\\n/g, "\n")
  : String(keyRaw);

const payload = {
  type: "service_account",
  project_id: projectId,
  private_key_id: String(keyId).trim(),
  private_key: privateKey,
  client_email: String(email).trim(),
  token_uri: "https://oauth2.googleapis.com/token",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs"
};

const fd = openSync(outPath, "w", 0o600);
try {
  writeFileSync(fd, `${JSON.stringify(payload)}\n`, { encoding: "utf8" });
} finally {
  closeSync(fd);
}

// Presence-only confirmation — never print secret material.
console.log(`staging-gac: wrote credentials file for project ${projectId}`);
