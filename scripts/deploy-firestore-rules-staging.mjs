#!/usr/bin/env node
/**
 * Deploys Firestore rules through the official Firebase Rules API.
 * This avoids firebase-tools' unrelated Service Usage read requirement while keeping
 * the target hard-coded to the isolated staging project.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  createServiceAccountJwt,
  FIREBASE_TOKEN_URL
} from "./staging-credentials.mjs";

const STAGING_PROJECT = "iaqar-ai-staging";
const RULES_API = "https://firebaserules.googleapis.com/v1";
const RELEASE_NAME = `projects/${STAGING_PROJECT}/releases/cloud.firestore`;

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function apiFailure(label, response, body) {
  const status = String(body?.error?.status || "unknown").replace(/[^A-Za-z0-9_-]/g, "_");
  return new Error(`${label} failed: HTTP ${response.status} / ${status}`);
}

async function requireOk(label, response) {
  const body = await readJson(response);
  if (!response.ok) throw apiFailure(label, response, body);
  return body;
}

export async function deployStagingFirestoreRules({
  gacPath,
  rulesPath,
  fetchImpl = fetch
}) {
  const serviceAccount = JSON.parse(readFileSync(gacPath, "utf8"));
  if (serviceAccount?.type !== "service_account" || serviceAccount?.project_id !== STAGING_PROJECT) {
    throw new Error("Firebase credential must be a service account for iaqar-ai-staging");
  }

  const assertion = createServiceAccountJwt(serviceAccount);
  const tokenBody = await requireOk(
    "Firebase OAuth",
    await fetchImpl(FIREBASE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
      }),
      signal: AbortSignal.timeout(30_000)
    })
  );
  if (!tokenBody.access_token) throw new Error("Firebase OAuth response did not include an access token");

  const headers = {
    Authorization: `Bearer ${tokenBody.access_token}`,
    "Content-Type": "application/json"
  };
  const rulesContent = readFileSync(rulesPath, "utf8");
  const ruleset = await requireOk(
    "Firestore ruleset create",
    await fetchImpl(`${RULES_API}/projects/${STAGING_PROJECT}/rulesets`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: {
          files: [{ name: "firestore.rules", content: rulesContent }]
        }
      }),
      signal: AbortSignal.timeout(30_000)
    })
  );
  if (!String(ruleset.name || "").startsWith(`projects/${STAGING_PROJECT}/rulesets/`)) {
    throw new Error("Firestore ruleset create returned an invalid staging ruleset");
  }

  await requireOk(
    "Firestore rules release update",
    await fetchImpl(`${RULES_API}/${RELEASE_NAME}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        name: RELEASE_NAME,
        rulesetName: ruleset.name
      }),
      signal: AbortSignal.timeout(30_000)
    })
  );

  const release = await requireOk(
    "Firestore rules release verify",
    await fetchImpl(`${RULES_API}/${RELEASE_NAME}`, {
      headers: { Authorization: headers.Authorization },
      signal: AbortSignal.timeout(30_000)
    })
  );
  if (release.rulesetName !== ruleset.name) {
    throw new Error("Firestore staging release does not reference the new ruleset");
  }
  return { projectId: STAGING_PROJECT, releaseName: RELEASE_NAME, rulesetName: ruleset.name };
}

async function main() {
  const gacPath = process.argv[2];
  const rulesPath = process.argv[3];
  if (!gacPath || !rulesPath) throw new Error("temporary credential and Firestore rules paths are required");
  await deployStagingFirestoreRules({ gacPath, rulesPath });
  console.log("Firestore staging rules deploy + release verification: PASS");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`staging-firestore-rules: ${error?.message || "unknown failure"}`);
    process.exit(1);
  });
}
