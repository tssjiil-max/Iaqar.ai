#!/usr/bin/env node
/**
 * Phase 9A — write a temporary Google service-account JSON for firebase-tools.
 * Reads FIREBASE_SERVICE_ACCOUNT_JSON.
 * Never prints secret values. Caller must delete the file after use.
 *
 * Usage: node scripts/staging-gac.mjs /absolute/path/to/temp.json [/tmp/normalized-secret-dir]
 */
import { closeSync, openSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const outPath = process.argv[2];
const secretDir = process.argv[3] || "";
if (!outPath || outPath.includes("..") || !(outPath.startsWith("/tmp/") || outPath.startsWith("/var/tmp/"))) {
  console.error("staging-gac: refuse to write outside /tmp or /var/tmp");
  process.exit(2);
}
if (secretDir && (
  secretDir.includes("..")
  || !(secretDir.startsWith("/tmp/") || secretDir.startsWith("/var/tmp/"))
)) {
  console.error("staging-gac: refuse to write normalized secrets outside /tmp or /var/tmp");
  process.exit(2);
}

const projectId = process.env.FIREBASE_STAGING_PROJECT_ID || "iaqar-ai-staging";
const { serviceAccount: payload, invalidFields } = parseFirebaseServiceAccountJson(
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  projectId
);

if (invalidFields.length) {
  console.error(`staging-gac: invalid field(s): ${invalidFields.join(", ")}`);
  process.exit(1);
}

function writePrivateFile(filePath, contents) {
  const fd = openSync(filePath, "w", 0o600);
  try {
    writeFileSync(fd, contents, { encoding: "utf8" });
  } finally {
    closeSync(fd);
  }
}

writePrivateFile(outPath, `${JSON.stringify(payload)}\n`);
if (secretDir) {
  writePrivateFile(path.join(secretDir, "FIREBASE_CLIENT_EMAIL"), payload.client_email); // pragma: allowlist secret
  writePrivateFile(path.join(secretDir, "FIREBASE_PRIVATE_KEY"), payload.private_key); // pragma: allowlist secret
  writePrivateFile(path.join(secretDir, "FIREBASE_PRIVATE_KEY_ID"), payload.private_key_id); // pragma: allowlist secret
}

// Presence-only confirmation — never print secret material.
console.log(`staging-gac: normalized fields and verified local RSA signing for project ${projectId}`);
