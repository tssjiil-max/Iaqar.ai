#!/usr/bin/env node
/**
 * Phase 9A — write a temporary Google service-account JSON for firebase-tools.
 * Reads FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY / FIREBASE_PRIVATE_KEY_ID.
 * Never prints secret values. Caller must delete the file after use.
 *
 * Usage: node scripts/staging-gac.mjs /absolute/path/to/temp.json [/tmp/normalized-secret-dir]
 */
import { closeSync, openSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  createServiceAccountPayload,
  normalizeFirebaseSecrets,
  validateFirebaseSecrets
} from "./staging-credentials.mjs";

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
const credentials = normalizeFirebaseSecrets();
const invalidFields = validateFirebaseSecrets(credentials);

if (invalidFields.length) {
  console.error(`staging-gac: invalid field(s): ${invalidFields.join(", ")}`);
  process.exit(1);
}

const payload = createServiceAccountPayload(credentials, projectId);

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
  writePrivateFile(path.join(secretDir, "FIREBASE_CLIENT_EMAIL"), credentials.clientEmail); // pragma: allowlist secret
  writePrivateFile(path.join(secretDir, "FIREBASE_PRIVATE_KEY"), `${credentials.privateKey}\n`); // pragma: allowlist secret
  writePrivateFile(path.join(secretDir, "FIREBASE_PRIVATE_KEY_ID"), credentials.privateKeyId); // pragma: allowlist secret
}

// Presence-only confirmation — never print secret material.
console.log(`staging-gac: normalized fields and verified local RSA signing for project ${projectId}`);
