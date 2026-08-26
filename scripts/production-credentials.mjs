import { parseFirebaseServiceAccountJson, createServiceAccountJwt, FIREBASE_TOKEN_URL } from "./staging-credentials.mjs";

export const PRODUCTION_PROJECT = "aqar-b5d76";
export const PRODUCTION_HOST = "https://iaqar.ai";
export const PRODUCTION_WORKER = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";

export function loadProductionServiceAccount() {
  const rawJson = process.env.FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON || "";
  if (!rawJson) {
    return { ok: false, reason: "missing_env", message: "FIREBASE_PRODUCTION_SERVICE_ACCOUNT_JSON" };
  }
  const parsed = parseFirebaseServiceAccountJson(rawJson, PRODUCTION_PROJECT);
  if (!parsed.serviceAccount) {
    return { ok: false, reason: "invalid_env", invalidFields: parsed.invalidFields };
  }
  return { ok: true, serviceAccount: parsed.serviceAccount };
}

export async function getProductionAccessToken(serviceAccount) {
  const assertion = createServiceAccountJwt(serviceAccount);
  const response = await fetch(FIREBASE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }),
    signal: AbortSignal.timeout(30_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error(`production token exchange failed: HTTP ${response.status}`);
  }
  return body.access_token;
}

export async function firestoreListDocuments(accessToken, collectionId, pageSize = 300) {
  const url = new URL(`https://firestore.googleapis.com/v1/projects/${PRODUCTION_PROJECT}/databases/(default)/documents/${collectionId}`);
  url.searchParams.set("pageSize", String(pageSize));
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(60_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`firestore list ${collectionId} failed: HTTP ${response.status}`);
  }
  return body.documents || [];
}

export function firestoreFieldString(fields, key) {
  return String(fields?.[key]?.stringValue || "").trim();
}

export function normalizeOfficeRecord(doc) {
  const fields = doc.fields || {};
  const officeId = firestoreFieldString(fields, "officeId")
    || String(doc.name || "").split("/").pop()
    || "";
  const status = firestoreFieldString(fields, "accountStatus")
    || firestoreFieldString(fields, "approvalStatus");
  return { officeId, status: status.toLowerCase() };
}

export function isActiveOffice(record) {
  return record.officeId
    && record.officeId !== "platform"
    && (record.status === "active" || record.status === "approved");
}
