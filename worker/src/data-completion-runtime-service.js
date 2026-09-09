import {
  applyCompletionSessionSubmission,
  buildCompletionPublicView,
  mintCompletionSession,
  verifyCompletionSessionToken
} from "./data-completion-service.js";
import { evaluateOpportunityCoreReadiness } from "../../public/js/opportunity-readiness-domain.js";

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || "")).filter(Boolean);
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map((v) => String(v || "")).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function sessionFromFirestore(data = {}) {
  return {
    ...data,
    allowedFields: parseJsonArray(data.allowedFieldsJson || data.allowedFields)
  };
}

function sessionToFirestoreFields(record, h) {
  return {
    schemaVersion: h.firestoreInteger(Number(record.schemaVersion || 1)),
    sessionId: h.firestoreString(record.sessionId || ""),
    officeId: h.firestoreString(record.officeId || ""),
    opportunityId: h.firestoreString(record.opportunityId || ""),
    tokenHash: h.firestoreString(record.tokenHash || ""),
    status: h.firestoreString(record.status || "OPEN"),
    allowedFieldsJson: h.firestoreString(JSON.stringify(record.allowedFields || [])),
    createdBy: h.firestoreString(record.createdBy || "system"),
    createdAt: h.firestoreTimestamp(new Date(record.createdAt)),
    updatedAt: h.firestoreTimestamp(new Date(record.updatedAt)),
    expiresAt: h.firestoreTimestamp(new Date(record.expiresAt)),
    completedAt: record.completedAt ? h.firestoreTimestamp(new Date(record.completedAt)) : null,
    revokedAt: record.revokedAt ? h.firestoreTimestamp(new Date(record.revokedAt)) : null
  };
}

function opportunityCompletionFields(result, h, now = new Date()) {
  const fields = {};
  for (const [key, value] of Object.entries(result.patch || {})) {
    fields[key] = key === "priceOrBudget"
      ? h.firestoreInteger(Math.round(Number(value || 0)))
      : h.firestoreString(value);
  }
  const readiness = evaluateOpportunityCoreReadiness(result.opportunity || {});
  fields.completionStatus = h.firestoreString(readiness.completionStatus);
  fields.dataCompleteness = h.firestoreInteger(readiness.dataCompleteness);
  fields.completionMissingFieldsJson = h.firestoreString(JSON.stringify(readiness.completionMissingFields || []));
  fields.matchingReadiness = h.firestoreString(readiness.matchingReadiness);
  fields.matchingReadinessMissingJson = h.firestoreString(JSON.stringify(readiness.matchingReadinessMissing || []));
  fields.updatedAt = h.firestoreTimestamp(now);
  return { fields, readiness };
}

function ensureSameOffice(record = {}, officeId = "", officeIdsEquivalent = null) {
  const recordOffice = text(record.officeId, 160);
  if (!recordOffice) return true;
  if (typeof officeIdsEquivalent === "function") return officeIdsEquivalent(recordOffice, officeId);
  return recordOffice === officeId;
}

export function completionRuntimeBoundaryGuarantees() {
  return Object.freeze({
    sessionCollection: "offices/{officeId}/completionSessions/{sessionId}",
    rawTokenPersisted: false,
    browserWritesFirestore: false,
    editableFieldsWhitelisted: true,
    officeOwnershipPreserved: true,
    terminalSessionReplayAllowed: false,
    completedOpportunityMayAdvanceToMatching: true
  });
}

export async function createPersistentCompletionSession({
  projectId,
  officeId,
  opportunityId,
  createdBy = "system",
  ttlMinutes,
  accessToken,
  appOrigin = "",
  deps
}) {
  const opportunityDoc = await deps.getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "opportunities", opportunityId],
    accessToken,
    allowMissing: true
  });
  if (!opportunityDoc) return { ok: false, error: "opportunity_not_found" };
  const opportunity = deps.firestoreHelpers.firestoreFieldsToJs(opportunityDoc.fields || {});
  if (!ensureSameOffice(opportunity, officeId, deps.officeIdsEquivalent)) {
    return { ok: false, error: "office_mismatch" };
  }

  const minted = await mintCompletionSession({
    officeId,
    opportunityId,
    opportunity,
    createdBy,
    ttlMinutes
  });
  if (!minted.ok) return minted;

  await deps.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "completionSessions", minted.sessionId],
    accessToken,
    fields: sessionToFirestoreFields(minted.record, deps.firestoreHelpers)
  });

  if (typeof deps.projectMissingData === "function") {
    await deps.projectMissingData({ officeId, opportunityId, opportunity, accessToken });
  }

  const origin = text(appOrigin, 500).replace(/\/$/, "");
  const completionUrl = `${origin}/complete.html?office=${encodeURIComponent(officeId)}&session=${encodeURIComponent(minted.sessionId)}#token=${encodeURIComponent(minted.token)}`;
  return {
    ok: true,
    sessionId: minted.sessionId,
    expiresAt: minted.record.expiresAt,
    allowedFields: minted.record.allowedFields,
    completionUrl,
    recipientPhone: text(opportunity.contactPhone || opportunity.advertiserPhoneNormalized, 60),
    token: minted.token
  };
}

async function loadSessionAndOpportunity({ projectId, officeId, sessionId, token, accessToken, deps, now = new Date() }) {
  const sessionDoc = await deps.getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "completionSessions", sessionId],
    accessToken,
    allowMissing: true
  });
  if (!sessionDoc) return { ok: false, error: "session_not_found" };
  const session = sessionFromFirestore(deps.firestoreHelpers.firestoreFieldsToJs(sessionDoc.fields || {}));
  if (!ensureSameOffice(session, officeId, deps.officeIdsEquivalent)) return { ok: false, error: "office_mismatch" };
  const verified = await verifyCompletionSessionToken(session, token, now);
  if (!verified.ok) return verified;

  const opportunityDoc = await deps.getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "opportunities", session.opportunityId],
    accessToken,
    allowMissing: true
  });
  if (!opportunityDoc) return { ok: false, error: "opportunity_not_found" };
  const opportunity = deps.firestoreHelpers.firestoreFieldsToJs(opportunityDoc.fields || {});
  if (!ensureSameOffice(opportunity, officeId, deps.officeIdsEquivalent)) return { ok: false, error: "office_mismatch" };
  return { ok: true, session, opportunity };
}

export async function readPersistentCompletionSession({
  projectId,
  officeId,
  sessionId,
  token,
  accessToken,
  deps,
  now = new Date()
}) {
  const loaded = await loadSessionAndOpportunity({ projectId, officeId, sessionId, token, accessToken, deps, now });
  if (!loaded.ok) return loaded;
  const officeDoc = await deps.getFirestoreDocument({
    projectId,
    segments: ["offices", officeId],
    accessToken,
    allowMissing: true
  });
  const office = officeDoc ? deps.firestoreHelpers.firestoreFieldsToJs(officeDoc.fields || {}) : {};
  return {
    ok: true,
    view: buildCompletionPublicView({ session: loaded.session, opportunity: loaded.opportunity, office })
  };
}

export async function submitPersistentCompletionSession({
  projectId,
  officeId,
  sessionId,
  token,
  patch,
  accessToken,
  deps,
  now = new Date()
}) {
  const loaded = await loadSessionAndOpportunity({ projectId, officeId, sessionId, token, accessToken, deps, now });
  if (!loaded.ok) return loaded;

  const result = applyCompletionSessionSubmission({
    session: loaded.session,
    opportunity: loaded.opportunity,
    patch,
    now
  });
  if (!result.ok) return result;

  const opportunityFields = opportunityCompletionFields(result, deps.firestoreHelpers, now);
  await deps.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "opportunities", loaded.session.opportunityId],
    accessToken,
    fields: opportunityFields.fields
  });
  await deps.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "completionSessions", sessionId],
    accessToken,
    fields: sessionToFirestoreFields(result.session, deps.firestoreHelpers)
  });

  if (result.isReadyForMatching && typeof deps.onOpportunityReady === "function") {
    await deps.onOpportunityReady({
      officeId,
      opportunityId: loaded.session.opportunityId,
      opportunity: result.opportunity,
      accessToken,
      completionSessionId: sessionId
    });
  } else if (!result.isReadyForMatching && typeof deps.projectMissingData === "function") {
    await deps.projectMissingData({
      officeId,
      opportunityId: loaded.session.opportunityId,
      opportunity: result.opportunity,
      accessToken
    });
  }

  return {
    ok: true,
    completionStatus: result.completionStatus,
    missingFields: result.missingFields,
    isComplete: result.isComplete,
    isReadyForMatching: result.isReadyForMatching,
    sessionStatus: result.session.status
  };
}
