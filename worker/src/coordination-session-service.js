/**
 * Coordination session persistence — worker only.
 */

import {
  clientBundleSummary,
  livingStageForCoordinationOutcome,
  normalizeClientBundle,
  normalizeOwnerBundle,
  ownerBundleSummary,
  QUESTION_SET_VERSIONS,
  resolveCoordinationOutcome
} from "../../public/js/coordination-bundle-domain.js";
import {
  appendCoordinationEvent,
  emptyCoordinationSession,
  parseCoordinationSession
} from "../../public/js/coordination-session-domain.js";
import { nextActorForLivingStage } from "../../public/js/match-group-domain.js";

function js(doc, helpers) {
  return helpers.firestoreFieldsToJs(doc?.fields ? doc.fields : {});
}

async function readOfficeDoc(helpers, { projectId, officeId, collection, id, accessToken }) {
  if (!id) return null;
  const doc = await helpers.getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, collection, id],
    accessToken,
    allowMissing: true
  });
  return doc ? js(doc, helpers) : null;
}

export async function loadCoordinationSession(helpers, {
  projectId,
  officeId,
  matchId,
  accessToken
}) {
  const id = String(matchId || "").trim();
  if (!id) return emptyCoordinationSession();
  const doc = await readOfficeDoc(helpers, {
    projectId,
    officeId,
    collection: "coordinationSessions",
    id,
    accessToken
  });
  if (!doc) return emptyCoordinationSession(id, officeId);
  try {
    const raw = doc.coordinationJson
      ? JSON.parse(String(doc.coordinationJson || "{}"))
      : doc;
    return parseCoordinationSession({ ...raw, matchId: id, officeId });
  } catch {
    return emptyCoordinationSession(id, officeId);
  }
}

export async function saveCoordinationSession(helpers, {
  projectId,
  officeId,
  matchId,
  accessToken,
  session
}) {
  const id = String(matchId || session?.matchId || "").trim();
  if (!id) return null;
  const now = new Date().toISOString();
  const payload = {
    ...session,
    matchId: id,
    officeId,
    updatedAt: now,
    createdAt: text(session.createdAt) || now
  };
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "coordinationSessions", id],
    accessToken,
    fields: {
      matchId: helpers.firestoreString(id),
      officeId: helpers.firestoreString(officeId),
      coordinationJson: helpers.firestoreString(JSON.stringify(payload)),
      outcome: helpers.firestoreString(payload.outcome || ""),
      brokerLine: helpers.firestoreString(payload.brokerLine || ""),
      updatedAt: helpers.firestoreString(now)
    }
  });
  return payload;
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export async function ensureCoordinationSession(helpers, {
  projectId,
  officeId,
  matchId,
  accessToken,
  clientSessionId = "",
  ownerSessionId = ""
}) {
  const existing = await loadCoordinationSession(helpers, {
    projectId,
    officeId,
    matchId,
    accessToken
  });
  if (existing.createdAt) {
    const updates = { ...existing };
    if (clientSessionId && !updates.clientSessionId) updates.clientSessionId = clientSessionId;
    if (ownerSessionId && !updates.ownerSessionId) updates.ownerSessionId = ownerSessionId;
    if (updates.clientSessionId !== existing.clientSessionId
      || updates.ownerSessionId !== existing.ownerSessionId) {
      return saveCoordinationSession(helpers, {
        projectId,
        officeId,
        matchId,
        accessToken,
        session: updates
      });
    }
    return existing;
  }
  const now = new Date().toISOString();
  const session = {
    ...emptyCoordinationSession(matchId, officeId),
    clientSessionId: text(clientSessionId),
    ownerSessionId: text(ownerSessionId),
    createdAt: now,
    updatedAt: now,
    eventLog: appendCoordinationEvent([], {
      type: "coordination_session_created",
      actor: "SYSTEM",
      label: "تم إنشاء جلسة التنسيق"
    }, { now: new Date(now) })
  };
  return saveCoordinationSession(helpers, {
    projectId,
    officeId,
    matchId,
    accessToken,
    session
  });
}

export async function submitCoordinationBundle(helpers, {
  projectId,
  officeId,
  matchId,
  party,
  bundleRaw = {},
  accessToken
}) {
  const side = party === "owner" ? "owner" : "client";
  const normalized = side === "owner"
    ? normalizeOwnerBundle(bundleRaw)
    : normalizeClientBundle(bundleRaw);
  if (!normalized) {
    throw helpers.appError("invalid_coordination_bundle", 400, "تعذر قبول الرد. أكمل جميع الحقول المطلوبة.");
  }
  normalized.submittedAt = new Date().toISOString();
  const session = await loadCoordinationSession(helpers, {
    projectId,
    officeId,
    matchId,
    accessToken
  });
  const next = { ...session };
  if (side === "owner") next.ownerBundle = normalized;
  else next.clientBundle = normalized;
  const resolved = resolveCoordinationOutcome({
    clientBundle: next.clientBundle,
    ownerBundle: next.ownerBundle
  });
  next.outcome = resolved.outcome;
  next.brokerLine = resolved.brokerLine;
  next.conflictField = resolved.conflictField;
  const summary = side === "owner" ? ownerBundleSummary(normalized) : clientBundleSummary(normalized);
  next.eventLog = appendCoordinationEvent(next.eventLog || [], {
    type: side === "owner" ? "owner_bundle_submitted" : "client_bundle_submitted",
    actor: side === "owner" ? "OWNER" : "CLIENT",
    label: summary || "تم تسجيل الرد"
  });
  return saveCoordinationSession(helpers, {
    projectId,
    officeId,
    matchId,
    accessToken,
    session: next
  });
}

export async function applyCoordinationToMatch(helpers, {
  projectId,
  officeId,
  matchId,
  accessToken,
  coordinationSession,
  stampMatchLiving
}) {
  const session = parseCoordinationSession(coordinationSession);
  const living = livingStageForCoordinationOutcome(session.outcome);
  await stampMatchLiving(helpers, {
    projectId,
    officeId,
    matchId,
    accessToken,
    patch: {
      livingStage: living.stage,
      ownerContactNeeded: Boolean(living.ownerContactNeeded),
      activeMatchId: matchId,
      hasNewResponse: true,
      coordinationOutcome: session.outcome,
      coordinationBrokerLine: session.brokerLine,
      nextActor: nextActorForLivingStage(living.stage, {
        ownerContactNeeded: Boolean(living.ownerContactNeeded)
      }),
      timelineEvent: {
        type: `coordination_${String(session.outcome || "").toLowerCase()}`,
        actor: "SYSTEM",
        label: session.brokerLine || session.outcome
      }
    }
  });
  return living;
}

export function coordinationSessionForBrokerView(session = {}) {
  const parsed = parseCoordinationSession(session);
  return {
    outcome: parsed.outcome,
    brokerLine: parsed.brokerLine,
    conflictField: parsed.conflictField,
    clientSubmitted: Boolean(parsed.clientBundle),
    ownerSubmitted: Boolean(parsed.ownerBundle),
    clientSummary: parsed.clientBundle ? clientBundleSummary(parsed.clientBundle) : "",
    ownerSummary: parsed.ownerBundle ? ownerBundleSummary(parsed.ownerBundle) : "",
    eventLog: parsed.eventLog.slice(-8)
  };
}
