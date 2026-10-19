#!/usr/bin/env node
/**
 * READ-ONLY, one-off administrative diagnostic for Staging.
 *
 * Purpose: verify a specific office's public slug resolves to the officeId the
 * platform owner expects, and that it is genuinely linked to the WhatsApp Cloud
 * API phone number the owner expects, before anyone considers turning the
 * WhatsApp agent on for that office (WHATSAPP_AGENT_ENABLED /
 * WHATSAPP_AGENT_OFFICE_IDS in worker/wrangler.toml — this script does not set
 * those; a human reviews this report first).
 *
 * Self-contained on purpose (no imports from scripts/staging-credentials.mjs or
 * scripts/staging-qa-identity.mjs): this file is meant to live briefly on the
 * repository's default branch only so GitHub registers the companion
 * workflow_dispatch workflow, and those two helper files currently exist only
 * on codex/unified-staging-lineage-2026-08-29 — not on main.
 *
 * This script performs Firestore **reads only** — `getDoc` / `runQuery` below
 * issue GET and :runQuery POST calls to the Firestore REST API. There is no
 * call to any Firestore write method (set/patch/commit) anywhere in this file.
 * It never prints FIREBASE_SERVICE_ACCOUNT_JSON, the derived access token, or
 * any Meta access token. It never prints a client's name, phone number or
 * message content — only the office's own identity (already supplied as the
 * input slug/phone number by the operator) and the boolean/status fields the
 * checklist needs.
 *
 * Inputs (env):
 *   FIREBASE_SERVICE_ACCOUNT_JSON  Staging service account JSON (GitHub Actions secret; never logged)
 *   OFFICE_SLUG                    publicSlug to resolve, e.g. "sultan"
 *   WHATSAPP_PHONE_NUMBER_ID       Meta phone_number_id to check, e.g. "356393440882303"
 *
 * Output: a single JSON report on stdout and written to
 *   `${DIAGNOSTIC_OUT || cwd}/whatsapp-office-link-check.json`
 */
import { createPrivateKey, createSign } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const STAGING_PROJECT_ID = "iaqar-ai-staging";
const FIREBASE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIREBASE_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

const OFFICE_SLUG = String(process.env.OFFICE_SLUG || "").trim();
const WHATSAPP_PHONE_NUMBER_ID = String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
const outDir = process.env.DIAGNOSTIC_OUT || process.cwd();

if (!OFFICE_SLUG) throw new Error("OFFICE_SLUG is required");
if (!WHATSAPP_PHONE_NUMBER_ID) throw new Error("WHATSAPP_PHONE_NUMBER_ID is required");

// ---------------------------------------------------------------- credentials

function stripOuterQuotes(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length < 2) return trimmed;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed.trim();
    } catch {
      return trimmed.slice(1, -1).trim();
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).trim();
  return trimmed;
}

function normalizePrivateKey(value) {
  return stripOuterQuotes(value).replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n?/g, "\n").trim();
}

function validateFirebaseSecrets({ clientEmail, privateKeyId, privateKey }) {
  const invalidFields = [];
  if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/i.test(String(clientEmail || ""))) invalidFields.push("client_email"); // pragma: allowlist secret
  if (!/^[a-f0-9]{40}$/i.test(String(privateKeyId || ""))) invalidFields.push("private_key_id"); // pragma: allowlist secret
  const pk = String(privateKey || "");
  const hasPemEnvelope = pk.startsWith("-----BEGIN PRIVATE KEY-----") && pk.endsWith("-----END PRIVATE KEY-----");
  if (!hasPemEnvelope) {
    invalidFields.push("private_key"); // pragma: allowlist secret
  } else {
    try {
      const key = createPrivateKey(pk);
      const signer = createSign("RSA-SHA256");
      signer.update("iaqar-staging-local-signature-check");
      signer.end();
      signer.sign(key);
    } catch {
      invalidFields.push("private_key"); // pragma: allowlist secret
    }
  }
  return [...new Set(invalidFields)];
}

function parseFirebaseServiceAccountJson(value, expectedProjectId) {
  const invalid = (fields) => ({ serviceAccount: null, invalidFields: fields.map((f) => `FIREBASE_SERVICE_ACCOUNT_JSON${f ? `.${f}` : ""}`) });
  const raw = String(value ?? "").trim();
  if (!raw) return invalid([]);
  let parsed;
  try {
    parsed = JSON.parse(raw);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
  } catch {
    return invalid([]);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalid([]);
  const credentials = {
    clientEmail: stripOuterQuotes(parsed.client_email), // pragma: allowlist secret
    privateKeyId: stripOuterQuotes(parsed.private_key_id), // pragma: allowlist secret
    privateKey: normalizePrivateKey(parsed.private_key) // pragma: allowlist secret
  };
  const invalidFields = [];
  if (parsed.type !== "service_account") invalidFields.push("type");
  if (stripOuterQuotes(parsed.project_id) !== expectedProjectId) invalidFields.push("project_id");
  invalidFields.push(...validateFirebaseSecrets(credentials));
  if (invalidFields.length) return invalid([...new Set(invalidFields)]);
  return {
    serviceAccount: {
      type: "service_account",
      project_id: expectedProjectId,
      private_key_id: credentials.privateKeyId, // pragma: allowlist secret
      private_key: `${credentials.privateKey}\n`, // pragma: allowlist secret
      client_email: credentials.clientEmail, // pragma: allowlist secret
      token_uri: FIREBASE_TOKEN_URL
    },
    invalidFields: []
  };
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function createServiceAccountJwt(serviceAccount, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = { alg: "RS256", typ: "JWT", kid: serviceAccount.private_key_id }; // pragma: allowlist secret
  const claims = { iss: serviceAccount.client_email, scope: FIREBASE_SCOPE, aud: FIREBASE_TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 }; // pragma: allowlist secret
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claims))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(serviceAccount.private_key).toString("base64url")}`; // pragma: allowlist secret
}

function assertStagingServiceAccount(serviceAccount) {
  const projectId = String(serviceAccount?.project_id || "");
  if (projectId !== STAGING_PROJECT_ID) throw new Error(`QA_GUARD_REFUSED: service account project ${projectId || "(none)"} is not ${STAGING_PROJECT_ID}`);
  return true;
}

async function accessToken(serviceAccount) {
  const assertion = createServiceAccountJwt(serviceAccount);
  const response = await fetch(FIREBASE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(`Google access token failed (${response.status})`);
  return body.access_token;
}

// ---------------------------------------------------------------- Firestore REST (reads only)

/** GET a single document. Returns null (not an error) when it does not exist. READ ONLY. */
async function getDoc(token, segments) {
  const name = segments.join("/");
  const url = `https://firestore.googleapis.com/v1/projects/${STAGING_PROJECT_ID}/databases/(default)/documents/${name}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 404) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GET ${name} failed (${response.status}): ${body?.error?.message || ""}`);
  return fieldsToJs(body.fields || {});
}

/** POST a structured query against a collection. READ ONLY (runQuery never mutates). */
async function runQuery(token, { collectionId, where, limit = 5 }) {
  const url = `https://firestore.googleapis.com/v1/projects/${STAGING_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], where, limit } })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`runQuery ${collectionId} failed (${response.status}): ${body?.error?.message || ""}`);
  const rows = Array.isArray(body) ? body.filter((row) => row?.document) : [];
  return rows.map((row) => ({ id: String(row.document.name).split("/").pop(), fields: fieldsToJs(row.document.fields || {}) }));
}

function fieldsToJs(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) out[key] = fieldValueToJs(value);
  return out;
}
function fieldValueToJs(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("mapValue" in value) return fieldsToJs(value.mapValue?.fields || {});
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(fieldValueToJs);
  return null;
}

// ---------------------------------------------------------------- main

const blockers = [];
const report = {
  runAt: new Date().toISOString(),
  projectId: STAGING_PROJECT_ID,
  input: { officeSlug: OFFICE_SLUG, whatsappPhoneNumberId: WHATSAPP_PHONE_NUMBER_ID },
  officeId: null,
  officeVerified: false,
  officeName: null,
  slugMatches: false,
  conflictingOffice: false,
  whatsappAccountFound: false,
  mappingMatches: false,
  metaStatus: null,
  metaPhoneStatus: null,
  platformType: null,
  onboardingMode: null,
  isOnBizApp: null,
  autoReplyEnabled: false,
  agentReady: false,
  blockers
};

async function main() {
  const parsed = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, STAGING_PROJECT_ID);
  if (parsed.invalidFields.length) throw new Error(`Invalid Staging credential fields: ${parsed.invalidFields.join(", ")}`);
  assertStagingServiceAccount(parsed.serviceAccount);
  const token = await accessToken(parsed.serviceAccount);

  // 1) officeSlugClaims/{slug} -> officeId
  const claim = await getDoc(token, ["officeSlugClaims", OFFICE_SLUG]);
  if (!claim || !claim.officeId) {
    blockers.push(`officeSlugClaims/${OFFICE_SLUG} missing or has no officeId`);
  } else {
    report.officeId = String(claim.officeId);
  }

  if (report.officeId) {
    const office = await getDoc(token, ["offices", report.officeId]);
    if (!office) {
      blockers.push(`offices/${report.officeId} does not exist`);
    } else {
      report.officeVerified = true;
      report.officeName = String(office.businessName || office.officeName || office.name || "") || null;
      report.slugMatches = String(office.publicSlug || "") === OFFICE_SLUG;
      if (!report.slugMatches) blockers.push(`offices/${report.officeId}.publicSlug ("${office.publicSlug || ""}") does not match claimed slug "${OFFICE_SLUG}"`);
    }

    const publicOffice = await getDoc(token, ["publicOffices", report.officeId]);
    if (!publicOffice) blockers.push(`publicOffices/${report.officeId} does not exist`);
    else if (String(publicOffice.publicSlug || "") !== OFFICE_SLUG) blockers.push(`publicOffices/${report.officeId}.publicSlug does not match "${OFFICE_SLUG}"`);

    const conflicting = await runQuery(token, {
      collectionId: "publicOffices",
      where: { fieldFilter: { field: { fieldPath: "publicSlug" }, op: "EQUAL", value: { stringValue: OFFICE_SLUG } } },
      limit: 5
    });
    const otherOwners = conflicting.filter((row) => row.id !== report.officeId);
    if (otherOwners.length) {
      report.conflictingOffice = true;
      blockers.push(`publicSlug "${OFFICE_SLUG}" is also claimed by: ${otherOwners.map((r) => r.id).join(", ")}`);
    }

    const integration = await getDoc(token, ["offices", report.officeId, "integrations", "whatsapp"]);
    report.autoReplyEnabled = integration?.autoReplyEnabled === true;
    const linkedPhoneNumberId = String(integration?.phoneNumberId || "");
    if (!linkedPhoneNumberId) blockers.push(`offices/${report.officeId}/integrations/whatsapp has no phoneNumberId`);
    else if (linkedPhoneNumberId !== WHATSAPP_PHONE_NUMBER_ID) blockers.push(`office's linked phoneNumberId ("${linkedPhoneNumberId}") does not match expected "${WHATSAPP_PHONE_NUMBER_ID}"`);
  }

  const account = await getDoc(token, ["whatsapp_accounts", WHATSAPP_PHONE_NUMBER_ID]);
  if (!account) {
    blockers.push(`whatsapp_accounts/${WHATSAPP_PHONE_NUMBER_ID} does not exist`);
  } else {
    report.whatsappAccountFound = true;
    report.metaStatus = String(account.status || "") || null;
    report.platformType = String(account.platformType || "") || null;
    report.onboardingMode = String(account.onboardingMode || "") || null;
    report.isOnBizApp = account.isOnBizApp === true;
    const metaPhoneStatus = String(account.metaPhoneStatus || "") || null;
    report.metaPhoneStatus = metaPhoneStatus;
    report.mappingMatches = report.officeId ? String(account.officeId || "") === report.officeId : false;
    if (!report.mappingMatches) blockers.push(`whatsapp_accounts/${WHATSAPP_PHONE_NUMBER_ID}.officeId ("${account.officeId || ""}") does not match resolved officeId ("${report.officeId || ""}")`);
    if (report.metaStatus !== "connected") blockers.push(`whatsapp_accounts/${WHATSAPP_PHONE_NUMBER_ID}.status is "${report.metaStatus}", not "connected"`);
    if (metaPhoneStatus && metaPhoneStatus !== "CONNECTED") blockers.push(`metaPhoneStatus is "${metaPhoneStatus}", not "CONNECTED"`);
  }

  if (!report.autoReplyEnabled) blockers.push(`offices/${report.officeId || "?"}/integrations/whatsapp.autoReplyEnabled is not true (the office itself has not opted in)`);

  report.agentReady = Boolean(
    report.officeId && report.officeVerified && report.slugMatches && !report.conflictingOffice &&
    report.whatsappAccountFound && report.mappingMatches && report.metaStatus === "connected" &&
    (!report.metaPhoneStatus || report.metaPhoneStatus === "CONNECTED") && report.autoReplyEnabled
  );

  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "whatsapp-office-link-check.json");
  await writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWritten to ${outPath}`);
}

main().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exitCode = 1;
});
