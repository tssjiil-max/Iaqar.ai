#!/usr/bin/env node
/**
 * Phase 9A credential and permission preflight.
 * Performs disposable create/delete probes for Workers Scripts and R2 Storage.
 * It never prints secret values and refuses non-staging Firebase projects.
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { cert } from "firebase-admin/app";
import {
  createServiceAccountJwt,
  FIREBASE_TOKEN_URL,
  stripOuterQuotes
} from "./staging-credentials.mjs";

const STAGING_PROJECT = "iaqar-ai-staging";
const REQUIRED_R2_BUCKET = "iaqar-media";
const gacPath = process.argv[2];

function fail(message) {
  console.error(`staging-preflight: ${message}`);
  process.exit(1);
}

function errorCodes(body) {
  if (!Array.isArray(body?.errors)) return [];
  return body.errors
    .map((error) => String(error?.code ?? "unknown").replace(/[^A-Za-z0-9_-]/g, "_"))
    .slice(0, 5);
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function cloudflareRequest(accountId, token, apiPath, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${apiPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(30_000)
  });
  const body = await readJson(response);
  return { response, body };
}

async function requireCloudflareOk(label, result) {
  if (result.response.ok && result.body?.success !== false) return result.body;
  const codes = errorCodes(result.body);
  throw new Error(`${label} failed: HTTP ${result.response.status}${codes.length ? ` / ${codes.join(",")}` : ""}`);
}

async function checkFirebase(serviceAccount) {
  if (serviceAccount?.type !== "service_account" || serviceAccount?.project_id !== STAGING_PROJECT) {
    throw new Error("Firebase credential must be a service account for iaqar-ai-staging");
  }

  try {
    const adminCredential = cert(serviceAccount);
    if (!adminCredential || typeof adminCredential.getAccessToken !== "function") {
      throw new Error("credential factory returned an invalid object");
    }
  } catch {
    throw new Error("Firebase Admin credential construction failed");
  }
  console.log("Firebase Admin credential construction: PASS");

  let assertion;
  try {
    assertion = createServiceAccountJwt(serviceAccount);
  } catch {
    throw new Error("Firebase local RSA-SHA256 JWT signing failed");
  }
  console.log("Firebase credential object + local RSA-SHA256 JWT signing: PASS");

  const tokenResponse = await fetch(FIREBASE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }),
    signal: AbortSignal.timeout(30_000)
  });
  const tokenBody = await readJson(tokenResponse);
  if (!tokenResponse.ok || !tokenBody?.access_token) {
    const code = String(tokenBody?.error || "unknown").replace(/[^A-Za-z0-9_-]/g, "_");
    throw new Error(`Firebase OAuth rejected credential: HTTP ${tokenResponse.status} / ${code}`);
  }
  console.log("Firebase OAuth signed assertion exchange: PASS");

  const sitesResponse = await fetch(
    `https://firebasehosting.googleapis.com/v1beta1/projects/${STAGING_PROJECT}/sites?pageSize=1`,
    {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
      signal: AbortSignal.timeout(30_000)
    }
  );
  const sitesBody = await readJson(sitesResponse);
  if (!sitesResponse.ok) {
    const status = String(sitesBody?.error?.status || "unknown").replace(/[^A-Za-z0-9_-]/g, "_");
    throw new Error(`Firebase Hosting project access failed: HTTP ${sitesResponse.status} / ${status}`);
  }
  console.log(`Firebase Hosting project access (${STAGING_PROJECT}): PASS`);
}

async function checkCloudflare(accountId, token) {
  await requireCloudflareOk(
    "Cloudflare account access",
    await cloudflareRequest(accountId, token, "")
  );
  console.log("Cloudflare account-scoped API access: PASS");

  const listed = await requireCloudflareOk(
    "Cloudflare R2 bucket list",
    await cloudflareRequest(accountId, token, "/r2/buckets")
  );
  const buckets = Array.isArray(listed?.result?.buckets) ? listed.result.buckets : [];
  if (!buckets.some((bucket) => bucket?.name === REQUIRED_R2_BUCKET)) {
    throw new Error(`Cloudflare R2 bucket ${REQUIRED_R2_BUCKET} is not visible`);
  }
  console.log(`Cloudflare R2 bucket visibility (${REQUIRED_R2_BUCKET}): PASS`);

  const suffix = randomBytes(6).toString("hex");
  const workerProbe = `iaqar-staging-permission-${suffix}`;
  const r2Probe = `iaqar-staging-permission-${suffix}`;
  let workerCreated = false;
  let r2Created = false;

  try {
    const workerForm = new FormData();
    workerForm.append(
      "metadata",
      new Blob([JSON.stringify({
        main_module: "index.js",
        compatibility_date: "2026-07-29"
      })], { type: "application/json" })
    );
    workerForm.append(
      "index.js",
      new Blob([
        'export default { fetch() { return new Response("staging permission probe"); } };'
      ], { type: "application/javascript+module" }),
      "index.js"
    );
    await requireCloudflareOk(
      "Workers Scripts create probe",
      await cloudflareRequest(accountId, token, `/workers/scripts/${workerProbe}`, {
        method: "PUT",
        body: workerForm
      })
    );
    workerCreated = true;

    await requireCloudflareOk(
      "Workers Scripts delete probe",
      await cloudflareRequest(accountId, token, `/workers/scripts/${workerProbe}`, {
        method: "DELETE"
      })
    );
    workerCreated = false;
    console.log("Cloudflare Workers Scripts edit permission (create/delete probe): PASS");

    await requireCloudflareOk(
      "Workers R2 Storage create probe",
      await cloudflareRequest(accountId, token, "/r2/buckets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: r2Probe })
      })
    );
    r2Created = true;

    await requireCloudflareOk(
      "Workers R2 Storage delete probe",
      await cloudflareRequest(accountId, token, `/r2/buckets/${r2Probe}`, {
        method: "DELETE"
      })
    );
    r2Created = false;
    console.log("Cloudflare Workers R2 Storage edit permission (create/delete probe): PASS");
  } finally {
    if (workerCreated) {
      await cloudflareRequest(accountId, token, `/workers/scripts/${workerProbe}`, {
        method: "DELETE"
      }).catch(() => {});
    }
    if (r2Created) {
      await cloudflareRequest(accountId, token, `/r2/buckets/${r2Probe}`, {
        method: "DELETE"
      }).catch(() => {});
    }
  }
}

if (!gacPath) fail("temporary Google credential path is required");

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(gacPath, "utf8"));
} catch {
  fail("temporary Google credential could not be read");
}

const accountId = stripOuterQuotes(process.env.CLOUDFLARE_ACCOUNT_ID);
const token = stripOuterQuotes(process.env.CLOUDFLARE_API_TOKEN);
if (!/^[a-f0-9]{32}$/i.test(accountId)) fail("CLOUDFLARE_ACCOUNT_ID is invalid");
if (!token) fail("CLOUDFLARE_API_TOKEN is invalid");

try {
  await checkFirebase(serviceAccount);
  await checkCloudflare(accountId, token);
  console.log("Phase 9A staging credential and permission preflight: PASS");
} catch (error) {
  fail(error?.message || "unknown preflight failure");
}
