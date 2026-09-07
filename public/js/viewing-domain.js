/**
 * Canonical viewing lifecycle for one Match.
 *
 * Source of truth: the Match document.
 * Canonical write fields:
 *   - viewingCandidateAt: proposed candidate selected by both parties
 *   - appointmentAt: broker-confirmed appointment
 *   - appointmentStatus: lifecycle status
 *
 * `viewingAt` and `proposedSlot` remain read-only compatibility aliases for
 * older records. New business decisions must not derive authority from them
 * unless the persisted status proves the record is an older candidate.
 */

import { VIEWING_APPOINTMENT_STATUS } from "./broker-viewing-schedule-domain.js";

export const VIEWING_STATE = Object.freeze({
  NOT_STARTED: "NOT_STARTED",
  CANDIDATE: "CANDIDATE",
  TRAVEL_CONFIRM_REQUIRED: "TRAVEL_CONFIRM_REQUIRED",
  CONFIRMED: "CONFIRMED",
  CONFLICT: "CONFLICT"
});

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function sameInstant(left, right) {
  const a = new Date(left).getTime();
  const b = new Date(right).getTime();
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

export function canonicalViewingCandidateAt(match = {}) {
  const direct = text(match.viewingCandidateAt);
  if (direct) return direct;

  const status = upper(match.appointmentStatus || match.viewingAppointmentStatus);
  const candidateStatus = status === VIEWING_APPOINTMENT_STATUS.CANDIDATE
    || status === VIEWING_APPOINTMENT_STATUS.BROKER_CONFIRM_REQUIRED_FOR_TRAVEL;
  if (!candidateStatus) return "";

  // Legacy compatibility only. These aliases are never used when status does
  // not prove the record represents an active candidate.
  return text(match.proposedSlot || match.appointmentAt || match.viewingAt);
}

export function canonicalConfirmedAppointmentAt(match = {}) {
  const status = upper(match.appointmentStatus || match.viewingAppointmentStatus);
  const livingStage = upper(match.livingStage);
  const confirmed = status === VIEWING_APPOINTMENT_STATUS.CONFIRMED_BY_BROKER
    || livingStage === "APPOINTMENT_CONFIRMED";
  if (!confirmed) return "";
  return text(match.appointmentAt || match.viewingAt);
}

export function resolveViewingState(match = {}) {
  const status = upper(match.appointmentStatus || match.viewingAppointmentStatus);
  const confirmedAt = canonicalConfirmedAppointmentAt(match);
  if (confirmedAt) {
    return {
      state: VIEWING_STATE.CONFIRMED,
      candidateAt: canonicalViewingCandidateAt(match) || confirmedAt,
      appointmentAt: confirmedAt,
      terminal: false
    };
  }
  if (status === VIEWING_APPOINTMENT_STATUS.CONFLICT) {
    return { state: VIEWING_STATE.CONFLICT, candidateAt: canonicalViewingCandidateAt(match), appointmentAt: "", terminal: false };
  }
  if (status === VIEWING_APPOINTMENT_STATUS.BROKER_CONFIRM_REQUIRED_FOR_TRAVEL) {
    return { state: VIEWING_STATE.TRAVEL_CONFIRM_REQUIRED, candidateAt: canonicalViewingCandidateAt(match), appointmentAt: "", terminal: false };
  }
  const candidateAt = canonicalViewingCandidateAt(match);
  if (candidateAt) {
    return { state: VIEWING_STATE.CANDIDATE, candidateAt, appointmentAt: "", terminal: false };
  }
  return { state: VIEWING_STATE.NOT_STARTED, candidateAt: "", appointmentAt: "", terminal: false };
}

/**
 * Validate a broker confirmation after schedule evaluation.
 * This function never schedules, sends messages, creates Deals, or mutates an
 * Operation. It only returns the canonical Match patch to persist.
 */
export function planViewingConfirmation({ match = {}, evaluation = null } = {}) {
  const current = resolveViewingState(match);
  const candidateAt = current.candidateAt;

  if (current.state === VIEWING_STATE.CONFIRMED) {
    if (!candidateAt || sameInstant(candidateAt, current.appointmentAt)) {
      return {
        ok: true,
        idempotent: true,
        appointmentAt: current.appointmentAt,
        appointmentStatus: VIEWING_APPOINTMENT_STATUS.CONFIRMED_BY_BROKER,
        patch: null
      };
    }
    return { ok: false, error: "viewing_already_confirmed", state: current.state };
  }

  if (!candidateAt) {
    return { ok: false, error: "viewing_candidate_missing", state: current.state };
  }
  if (!evaluation || evaluation.eligible !== true) {
    return { ok: false, error: "viewing_schedule_conflict", state: current.state };
  }

  return {
    ok: true,
    idempotent: false,
    appointmentAt: candidateAt,
    appointmentStatus: VIEWING_APPOINTMENT_STATUS.CONFIRMED_BY_BROKER,
    travelConfirmationRequired: evaluation.status === VIEWING_APPOINTMENT_STATUS.BROKER_CONFIRM_REQUIRED_FOR_TRAVEL,
    patch: {
      viewingCandidateAt: candidateAt,
      appointmentAt: candidateAt,
      appointmentStatus: VIEWING_APPOINTMENT_STATUS.CONFIRMED_BY_BROKER,
      // Compatibility mirror for old readers. Not an authority field.
      viewingAt: candidateAt
    }
  };
}

export function viewingBoundaryGuarantees() {
  return {
    sourceOfTruth: "matches",
    candidateField: "viewingCandidateAt",
    confirmedField: "appointmentAt",
    statusField: "appointmentStatus",
    legacyAliasesReadOnly: ["viewingAt", "proposedSlot"],
    ownsNegotiation: false,
    ownsDealLifecycle: false,
    ownsOperations: false,
    autoSendsMessage: false,
    exposesExactLocation: false
  };
}
