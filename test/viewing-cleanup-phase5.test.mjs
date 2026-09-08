import test from "node:test";
import assert from "node:assert/strict";
import {
  VIEWING_STATE,
  canonicalConfirmedAppointmentAt,
  canonicalViewingCandidateAt,
  planViewingConfirmation,
  planViewingCompletion,
  resolveViewingState,
  viewingBoundaryGuarantees
} from "../public/js/viewing-domain.js";
import {
  VIEWING_APPOINTMENT_STATUS,
  collectBrokerBookedStarts,
  evaluateViewingCandidate
} from "../public/js/broker-viewing-schedule-domain.js";

const future = "2030-01-15T10:00:00.000Z";
const other = "2030-01-15T12:00:00.000Z";

test("viewing owns only Match appointment state", () => {
  assert.deepEqual(viewingBoundaryGuarantees(), {
    sourceOfTruth: "matches",
    candidateField: "viewingCandidateAt",
    confirmedField: "appointmentAt",
    completedField: "viewingCompletedAt",
    statusField: "appointmentStatus",
    legacyAliasesReadOnly: ["viewingAt", "proposedSlot"],
    ownsNegotiation: false,
    ownsDealLifecycle: false,
    ownsOperations: false,
    autoSendsMessage: false,
    exposesExactLocation: false
  });
});

test("canonical candidate prefers viewingCandidateAt", () => {
  assert.equal(canonicalViewingCandidateAt({
    appointmentStatus: VIEWING_APPOINTMENT_STATUS.CANDIDATE,
    viewingCandidateAt: future,
    proposedSlot: other
  }), future);
});

test("legacy proposedSlot is read only when persisted status proves a candidate", () => {
  assert.equal(canonicalViewingCandidateAt({ proposedSlot: future }), "");
  assert.equal(canonicalViewingCandidateAt({
    appointmentStatus: VIEWING_APPOINTMENT_STATUS.CANDIDATE,
    proposedSlot: future
  }), future);
});

test("confirmed appointment is authoritative only when status/living stage confirms it", () => {
  assert.equal(canonicalConfirmedAppointmentAt({ appointmentAt: future }), "");
  assert.equal(canonicalConfirmedAppointmentAt({
    appointmentStatus: VIEWING_APPOINTMENT_STATUS.CONFIRMED_BY_BROKER,
    appointmentAt: future
  }), future);
  assert.equal(resolveViewingState({
    livingStage: "APPOINTMENT_CONFIRMED",
    appointmentAt: future
  }).state, VIEWING_STATE.CONFIRMED);
});

test("missing candidate cannot be confirmed", () => {
  const plan = planViewingConfirmation({
    match: {},
    evaluation: { eligible: true, status: VIEWING_APPOINTMENT_STATUS.CANDIDATE }
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.error, "viewing_candidate_missing");
});

test("schedule conflict cannot be confirmed", () => {
  const match = {
    appointmentStatus: VIEWING_APPOINTMENT_STATUS.CANDIDATE,
    viewingCandidateAt: future
  };
  const evaluation = evaluateViewingCandidate({ candidateStart: future, bookedStarts: [future] });
  const plan = planViewingConfirmation({ match, evaluation });
  assert.equal(evaluation.eligible, false);
  assert.equal(plan.ok, false);
  assert.equal(plan.error, "viewing_schedule_conflict");
});

test("successful confirmation writes canonical Match fields and only mirrors viewingAt for compatibility", () => {
  const match = {
    appointmentStatus: VIEWING_APPOINTMENT_STATUS.CANDIDATE,
    viewingCandidateAt: future
  };
  const plan = planViewingConfirmation({
    match,
    evaluation: { eligible: true, status: VIEWING_APPOINTMENT_STATUS.CANDIDATE, reason: "" }
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.idempotent, false);
  assert.deepEqual(plan.patch, {
    viewingCandidateAt: future,
    appointmentAt: future,
    appointmentStatus: VIEWING_APPOINTMENT_STATUS.CONFIRMED_BY_BROKER,
    viewingAt: future
  });
});

test("same confirmed appointment is idempotent", () => {
  const plan = planViewingConfirmation({
    match: {
      appointmentStatus: VIEWING_APPOINTMENT_STATUS.CONFIRMED_BY_BROKER,
      appointmentAt: future,
      viewingCandidateAt: future
    },
    evaluation: { eligible: true, status: VIEWING_APPOINTMENT_STATUS.CANDIDATE }
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.idempotent, true);
  assert.equal(plan.patch, null);
});

test("confirmed appointment cannot be silently overwritten by another candidate", () => {
  const plan = planViewingConfirmation({
    match: {
      appointmentStatus: VIEWING_APPOINTMENT_STATUS.CONFIRMED_BY_BROKER,
      appointmentAt: future,
      viewingCandidateAt: other
    },
    evaluation: { eligible: true, status: VIEWING_APPOINTMENT_STATUS.CANDIDATE }
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.error, "viewing_already_confirmed");
});

test("viewing completion requires a confirmed appointment that has started", () => {
  assert.equal(planViewingCompletion({ match: {} }).error, "viewing_not_confirmed");
  const early = planViewingCompletion({
    match: {
      appointmentStatus: VIEWING_APPOINTMENT_STATUS.CONFIRMED_BY_BROKER,
      appointmentAt: future
    },
    now: new Date("2030-01-15T09:00:00.000Z")
  });
  assert.equal(early.ok, false);
  assert.equal(early.error, "viewing_not_started_yet");
});

test("completed viewing is Match-owned, idempotent, and distinct from appointment confirmation", () => {
  const match = {
    appointmentStatus: VIEWING_APPOINTMENT_STATUS.CONFIRMED_BY_BROKER,
    appointmentAt: future
  };
  const first = planViewingCompletion({ match, now: new Date("2030-01-15T11:00:00.000Z") });
  assert.equal(first.ok, true);
  assert.equal(first.idempotent, false);
  assert.equal(first.patch.viewingCompletedAt, "2030-01-15T11:00:00.000Z");
  assert.equal(first.patch.seriousIntentConfirmed, false);
  const completed = { ...match, ...first.patch };
  assert.equal(resolveViewingState(completed).state, VIEWING_STATE.COMPLETED);
  const second = planViewingCompletion({ match: completed, now: new Date("2030-01-15T12:00:00.000Z") });
  assert.equal(second.ok, true);
  assert.equal(second.idempotent, true);
  assert.equal(second.patch, null);
});

test("stale candidate no longer reserves broker schedule", () => {
  const booked = collectBrokerBookedStarts([
    {
      id: "stale",
      appointmentStatus: VIEWING_APPOINTMENT_STATUS.CANDIDATE,
      viewingCandidateAt: "2029-12-01T10:00:00.000Z"
    },
    {
      id: "future",
      appointmentStatus: VIEWING_APPOINTMENT_STATUS.CANDIDATE,
      viewingCandidateAt: future
    }
  ], { now: new Date("2030-01-01T00:00:00.000Z") });
  assert.deepEqual(booked, [future]);
});

test("confirmed appointment remains a booking and candidate aliases are deduped", () => {
  const booked = collectBrokerBookedStarts([
    {
      id: "confirmed",
      appointmentStatus: VIEWING_APPOINTMENT_STATUS.CONFIRMED_BY_BROKER,
      appointmentAt: future,
      viewingAt: future
    },
    {
      id: "candidate",
      appointmentStatus: VIEWING_APPOINTMENT_STATUS.CANDIDATE,
      proposedSlot: other
    },
    {
      id: "candidate-duplicate",
      appointmentStatus: VIEWING_APPOINTMENT_STATUS.CANDIDATE,
      viewingCandidateAt: other
    }
  ], { now: new Date("2030-01-01T00:00:00.000Z") });
  assert.deepEqual(booked.sort(), [future, other].sort());
});
