#!/usr/bin/env node
/**
 * Deploy firestore.rules to iaqar-ai-staging via Firebase Rules API.
 * Bypasses firebase-tools serviceusage check when SA lacks serviceusage permission.
 * Never prints secret values.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createServiceAccountJwt,
  FIREBASE_TOKEN_URL,
  parseFirebaseServiceAccountJson
} from "./staging-credentials.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = "iaqar-ai-staging";
const RULES_PATH = path.join(ROOT, "firestore.rules");

async function readJson(response) {
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: { raw: text.slice(0, 500) } };
  }
}

async function getAccessToken(serviceAccount) {
  const assertion = createServiceAccountJwt(serviceAccount);
  const response = await fetch(FIREBASE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const { status, body } = await readJson(response);
  if (status !== 200 || !body.access_token) {
    console.error("OAuth failed:", status, body.error || body);
    process.exit(1);
  }
  return body.access_token;
}

async function main() {
  const { serviceAccount, invalidFields } = parseFirebaseServiceAccountJson(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    PROJECT
  );
  if (invalidFields.length || !serviceAccount) {
    console.error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON:", invalidFields.join(", "));
    process.exit(1);
  }

  const rulesContent = readFileSync(RULES_PATH, "utf8");
  const accessToken = await getAccessToken(serviceAccount);

  const createResponse = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      source: {
        files: [{ name: "firestore.rules", content: rulesContent }]
      }
    })
  });
  const created = await readJson(createResponse);
  if (createResponse.status !== 200) {
    console.error("Create ruleset failed:", created.status, created.body);
    process.exit(1);
  }
  const rulesetName = created.body.name;
  if (!rulesetName) {
    console.error("No ruleset name returned");
    process.exit(1);
  }

  const releaseResponse = await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases/cloud.firestore`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ release: { name: `projects/${PROJECT}/releases/cloud.firestore`, rulesetName } })
    }
  );
  const released = await readJson(releaseResponse);
  if (releaseResponse.status !== 200) {
    console.error("Release ruleset failed:", released.status, released.body);
    process.exit(1);
  }

  console.log("RULES_STAGING_DEPLOYED: YES");
  console.log("ruleset:", rulesetName.split("/").pop());
  console.log("release:", released.body.name || "cloud.firestore");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
