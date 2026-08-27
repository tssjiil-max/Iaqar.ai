/**
 * Coordination session envelope — one session per matchId.
 */

import {
  COORDINATION_OUTCOME,
  coordinationOutcomeLabel,
  clientBundleSummary,
  ownerBundleSummary,
  normalizeClientBundle,
  normalizeOwnerBundle,
  QUESTION_SET_VERSIONS,
  resolveCoordinationOutcome
} from "./coordination-bundle-domain.js";

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function coordinationSessionId(matchId = "") {
  return text(matchId);
}

export function emptyCoordinationSession(matchId = "", officeId = "") {
  const id = coordinationSessionId(matchId);
  return {
    id,
    matchId: id,
    officeId: text(officeId),
    clientQuestionSet: QUESTION_SET_VERSIONS.CLIENT_V1,
    ownerQuestionSet: QUESTION_SET_VERSIONS.OWNER_V1,
    clientBundle: null,
    ownerBundle: null,
    outcome: COORDINATION_OUTCOME.AWAITING_BOTH_PARTIES,
    brokerLine: "بانتظار رد العميل والمالك",
    conflictField: "",
    eventLog: [],
    createdAt: "",
    updatedAt: ""
  };
}

export function parseCoordinationSession(raw = {}) {
  if (!raw || typeof raw !== "object") return emptyCoordinationSession();
  const matchId = text(raw.matchId || raw.id);
  const clientBundle = raw.clientBundle
    ? normalizeClientBundle(raw.clientBundle)
    : null;
  const ownerBundle = raw.ownerBundle
    ? normalizeOwnerBundle(raw.ownerBundle)
    : null;
  const resolved = resolveCoordinationOutcome({ clientBundle, ownerBundle });
  return {
    id: coordinationSessionId(matchId),
    matchId,
    officeId: text(raw.officeId),
    clientQuestionSet: text(raw.clientQuestionSet) || QUESTION_SET_VERSIONS.CLIENT_V1,
    ownerQuestionSet: text(raw.ownerQuestionSet) || QUESTION_SET_VERSIONS.OWNER_V1,
    clientBundle,
    ownerBundle,
    outcome: text(raw.outcome) || resolved.outcome,
    brokerLine: text(raw.brokerLine) || resolved.brokerLine,
    conflictField: text(raw.conflictField) || resolved.conflictField,
    eventLog: Array.isArray(raw.eventLog) ? raw.eventLog.map(normalizeCoordinationEvent).filter(Boolean) : [],
    createdAt: text(raw.createdAt),
    updatedAt: text(raw.updatedAt)
  };
}

function normalizeCoordinationEvent(event = {}) {
  const type = text(event.type || event.eventType);
  const label = text(event.label || event.note);
  if (!type && !label) return null;
  return {
    type: type || "event",
    actor: text(event.actor || "SYSTEM"),
    label,
    createdAt: text(event.createdAt || event.at)
  };
}

export function appendCoordinationEvent(log = [], event = {}, { now = new Date() } = {}) {
  const next = normalizeCoordinationEvent({
    ...event,
    createdAt: text(event?.createdAt) || now.toISOString()
  });
  if (!next) return [...log];
  const key = `${next.createdAt}|${next.type}|${next.label}`;
  const seen = new Set(log.map((row) => `${row.createdAt}|${row.type}|${row.label}`));
  if (seen.has(key)) return [...log];
  return [...log, next].slice(-60);
}

export function brokerCoordinationSummary(session = {}) {
  const parsed = parseCoordinationSession(session);
  const lines = [];
  if (parsed.clientBundle) lines.push(`العميل: ${clientBundleSummary(parsed.clientBundle)}`);
  if (parsed.ownerBundle) lines.push(`المالك: ${ownerBundleSummary(parsed.ownerBundle)}`);
  const outcomeLine = coordinationOutcomeLabel(parsed.outcome) || parsed.brokerLine;
  if (outcomeLine) lines.push(outcomeLine);
  return lines.join(" · ");
}

export function coordinationAwaitingParties(session = {}) {
  const parsed = parseCoordinationSession(session);
  return parsed.outcome === COORDINATION_OUTCOME.AWAITING_BOTH_PARTIES
    || parsed.outcome === COORDINATION_OUTCOME.AWAITING_OTHER_PARTY;
}
