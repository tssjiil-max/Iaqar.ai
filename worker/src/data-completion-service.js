import {
  COMPLETION_SESSION_STATUS,
  buildCompletionSessionProjection,
  completionRequiredFields,
  evaluateCompletionSubmission,
  isCompletionSessionTerminal
} from "../../public/js/data-completion-domain.js";

const TOKEN_BYTES = 32;
const DEFAULT_TTL_MINUTES = 60 * 24 * 7;

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashCompletionToken(token) {
  const data = new TextEncoder().encode(String(token || ""));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

export function generateCompletionToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function mintCompletionSession({
  officeId,
  opportunityId,
  opportunity,
  createdBy = "system",
  ttlMinutes = DEFAULT_TTL_MINUTES,
  now = new Date()
}) {
  const missingFields = completionRequiredFields(opportunity);
  if (!missingFields.length) {
    return { ok: false, error: "opportunity_already_complete" };
  }

  const token = generateCompletionToken();
  const tokenHash = await hashCompletionToken(token);
  const randomId = generateCompletionToken().slice(0, 22);
  const sessionId = `cmp_${randomId}`;
  const expiresAt = new Date(now.getTime() + Math.max(15, Number(ttlMinutes) || DEFAULT_TTL_MINUTES) * 60000);

  return {
    ok: true,
    sessionId,
    token,
    record: {
      schemaVersion: 1,
      sessionId,
      officeId: String(officeId || ""),
      opportunityId: String(opportunityId || ""),
      tokenHash,
      status: COMPLETION_SESSION_STATUS.OPEN,
      allowedFields: missingFields,
      createdBy: String(createdBy || "system"),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      completedAt: null,
      revokedAt: null
    }
  };
}

export async function verifyCompletionSessionToken(session = {}, token = "", now = new Date()) {
  if (!session || isCompletionSessionTerminal(session.status)) {
    return { ok: false, error: "session_not_active" };
  }
  const expiresAt = new Date(session.expiresAt || 0);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
    return { ok: false, error: "session_expired" };
  }
  const actualHash = await hashCompletionToken(token);
  const expectedHash = String(session.tokenHash || "");
  if (!expectedHash || actualHash.length !== expectedHash.length) {
    return { ok: false, error: "invalid_token" };
  }
  let diff = 0;
  for (let index = 0; index < actualHash.length; index += 1) {
    diff |= actualHash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  }
  return diff === 0 ? { ok: true } : { ok: false, error: "invalid_token" };
}

export function buildCompletionPublicView({ session, opportunity, office = {} }) {
  const projection = buildCompletionSessionProjection(opportunity);
  return {
    office: {
      name: String(office.name || office.officeName || "المكتب العقاري"),
      brokerName: String(office.brokerName || ""),
      licenseNumber: String(office.licenseNumber || office.falLicenseNumber || "")
    },
    opportunity: projection,
    session: {
      status: String(session.status || COMPLETION_SESSION_STATUS.OPEN),
      expiresAt: String(session.expiresAt || ""),
      allowedFields: Array.isArray(session.allowedFields) ? session.allowedFields : []
    }
  };
}

export function applyCompletionSessionSubmission({ session, opportunity, patch, now = new Date() }) {
  if (!session || isCompletionSessionTerminal(session.status)) {
    return { ok: false, error: "session_not_active" };
  }
  const result = evaluateCompletionSubmission(
    opportunity,
    patch,
    Array.isArray(session.allowedFields) ? session.allowedFields : []
  );
  const nextSession = {
    ...session,
    status: result.isComplete ? COMPLETION_SESSION_STATUS.COMPLETED : COMPLETION_SESSION_STATUS.OPEN,
    allowedFields: result.missingFields,
    updatedAt: now.toISOString(),
    completedAt: result.isComplete ? now.toISOString() : null
  };
  return {
    ok: true,
    patch: result.patch,
    opportunity: result.opportunity,
    completionStatus: result.completionStatus,
    missingFields: result.missingFields,
    isComplete: result.isComplete,
    isReadyForMatching: result.isReadyForMatching,
    session: nextSession
  };
}
