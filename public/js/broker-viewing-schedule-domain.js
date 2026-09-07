/**
 * Broker viewing schedule — overlap prevention without external routing APIs.
 */

import { slotsOverlap, appointmentOccupancyMs, APPOINTMENT_TIME_ZONE } from "./iaqar-appointment-domain.js";
import { readExactGeo } from "./approximate-location-domain.js";

export const VIEWING_APPOINTMENT_STATUS = Object.freeze({
  CANDIDATE: "CANDIDATE",
  CONFIRMED_BY_BROKER: "CONFIRMED_BY_BROKER",
  CONFLICT: "CONFLICT",
  BROKER_CONFIRM_REQUIRED_FOR_TRAVEL: "BROKER_CONFIRM_REQUIRED_FOR_TRAVEL"
});

export const TRAVEL_FALLBACK_FLAG = "BROKER_CONFIRM_REQUIRED_FOR_TRAVEL";

const TRAVEL_SENSITIVE_GAP_MS = appointmentOccupancyMs();

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function startMs(value) {
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? at : 0;
}

function geoDistanceRoughKm(a, b) {
  if (!a || !b) return 0;
  const dLat = (b.lat - a.lat) * 111;
  const dLng = (b.lng - a.lng) * 111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export function brokerScheduleHasConflict(candidateStart, bookedStarts = [], { excludeStart = "" } = {}) {
  const start = text(candidateStart);
  if (!start) return true;
  return bookedStarts.some((booked) => {
    if (!booked || booked === excludeStart) return false;
    return slotsOverlap(start, booked);
  });
}

/**
 * Collect time slots that actually reserve the broker.
 *
 * Confirmed appointments always remain authoritative. Candidate slots reserve
 * time only while they are still in the future; a stale candidate must not
 * block a broker forever. `viewingAt`/`proposedSlot` are compatibility reads
 * only and are considered only when the persisted status proves the record is
 * a candidate/confirmed viewing.
 */
export function collectBrokerBookedStarts(matches = [], {
  brokerId = "",
  excludeMatchId = "",
  now = new Date()
} = {}) {
  const starts = [];
  const nowMs = startMs(now) || Date.now();
  for (const match of matches) {
    if (!match || typeof match !== "object") continue;
    if (excludeMatchId && text(match.id || match.matchId) === excludeMatchId) continue;
    if (brokerId && text(match.assignedBrokerId || match.brokerId) !== brokerId) continue;

    const status = text(match.appointmentStatus || match.viewingAppointmentStatus).toUpperCase();
    const livingStage = text(match.livingStage).toUpperCase();
    const confirmed = status === VIEWING_APPOINTMENT_STATUS.CONFIRMED_BY_BROKER
      || livingStage === "APPOINTMENT_CONFIRMED";
    const candidate = status === VIEWING_APPOINTMENT_STATUS.CANDIDATE
      || status === VIEWING_APPOINTMENT_STATUS.BROKER_CONFIRM_REQUIRED_FOR_TRAVEL;

    if (confirmed) {
      const at = text(match.appointmentAt || match.viewingAt);
      if (at) starts.push(at);
      continue;
    }

    if (candidate) {
      const at = text(match.viewingCandidateAt || match.proposedSlot || match.appointmentAt || match.viewingAt);
      if (at && startMs(at) > nowMs) starts.push(at);
    }
  }
  return [...new Set(starts)];
}

export function evaluateViewingCandidate({
  candidateStart = "",
  bookedStarts = [],
  previousAppointment = null,
  candidateRecord = {},
  previousRecord = {}
} = {}) {
  const start = text(candidateStart);
  if (!start) {
    return { eligible: false, status: VIEWING_APPOINTMENT_STATUS.CONFLICT, reason: "missing_start" };
  }
  if (brokerScheduleHasConflict(start, bookedStarts)) {
    return { eligible: false, status: VIEWING_APPOINTMENT_STATUS.CONFLICT, reason: "overlap" };
  }
  const prevEnd = previousAppointment?.endAt || previousAppointment?.appointmentAt;
  const prevGeo = readExactGeo(previousRecord);
  const candidateGeo = readExactGeo(candidateRecord);
  if (prevEnd && prevGeo && candidateGeo) {
    const gap = startMs(start) - startMs(prevEnd);
    const distanceKm = geoDistanceRoughKm(prevGeo, candidateGeo);
    if (gap >= 0 && gap < TRAVEL_SENSITIVE_GAP_MS && distanceKm > 0.5) {
      return {
        eligible: true,
        status: VIEWING_APPOINTMENT_STATUS.BROKER_CONFIRM_REQUIRED_FOR_TRAVEL,
        reason: TRAVEL_FALLBACK_FLAG,
        travelEstimate: null
      };
    }
  }
  return { eligible: true, status: VIEWING_APPOINTMENT_STATUS.CANDIDATE, reason: "" };
}

export function appointmentEndAt(startAt) {
  const ms = startMs(startAt);
  if (!ms) return "";
  return new Date(ms + appointmentOccupancyMs()).toISOString();
}

export function brokerViewingReadyLabel() {
  return "معاينة جاهزة للتأكيد";
}

if (typeof window !== "undefined") {
  window.IAQARBrokerViewingSchedule = {
    VIEWING_APPOINTMENT_STATUS,
    brokerScheduleHasConflict,
    evaluateViewingCandidate,
    collectBrokerBookedStarts,
    appointmentEndAt,
    TRAVEL_FALLBACK_FLAG
  };
}
