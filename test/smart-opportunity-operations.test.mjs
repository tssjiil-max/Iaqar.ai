import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMatchReviewOperation } from "../worker/src/operations-domain.js";
import { projectOperationToUiItem } from "../public/js/operations-domain.js";
import {
  OPPORTUNITY_ACTION_FILTER,
  buildOpportunityActionIndex,
  compareOpportunityPriority,
  opportunityMatchesActionFilter,
  projectOpportunityAction
} from "../public/js/opportunity-action-projection-domain.js";
import {
  VIEWING_REMINDER_KIND,
  dueViewingReminders,
  viewingReminderId,
  viewingReminderSchedule
} from "../worker/src/viewing-reminder-domain.js";

const NOW = new Date("2026-09-13T12:00:00.000Z");

function operation(overrides = {}) {
  return {
    id: "op_1",
    officeId: "office-a",
    operationType: "MATCH_REVIEW",
    type: "MATCH_REVIEW",
    status: "OPEN",
    matchId: "match-1",
    opportunityId: "request-1",
    livingStage: "MATCH_FOUND",
    createdAt: "2026-09-13T11:00:00.000Z",
    updatedAt: "2026-09-13T11:00:00.000Z",
    ...overrides
  };
}

test("TEST 1: persisted Match creates one MATCH_REVIEW and raises its primary card", async () => {
  const built = await buildMatchReviewOperation({
    officeId: "office-a", matchId: "match-1", opportunityId: "request-1",
    clientRequestId: "request-1", ownerOfferId: "offer-1", score: 82
  });
  const projected = projectOperationToUiItem({ ...built, metadataJson: JSON.stringify(built.metadata) });
  const index = buildOpportunityActionIndex([projected], { officeId: "office-a", now: NOW });
  assert.equal(index.size, 1);
  assert.equal(index.get("request-1").badge, "تطابق جديد");
  assert.equal(index.get("request-1").rank, 5);
});

test("TEST 2: officeId isolates operations between offices", () => {
  const index = buildOpportunityActionIndex([operation()], { officeId: "office-b", now: NOW });
  assert.equal(index.size, 0);
});

test("TEST 3: display-name changes do not affect ownership", () => {
  const first = operation({ displayName: "Thamer" });
  const renamed = operation({ displayName: "Mohammed" });
  assert.equal(buildOpportunityActionIndex([first], { officeId: "office-a", now: NOW }).size, 1);
  assert.equal(buildOpportunityActionIndex([renamed], { officeId: "office-a", now: NOW }).size, 1);
});

test("TEST 4: processed match no longer carries new-match state", () => {
  const action = projectOpportunityAction(operation({ livingStage: "NEGOTIATION" }), NOW);
  assert.equal(action.badge, "تفاوض جارٍ");
  assert.notEqual(action.badge, "تطابق جديد");
});

test("TEST 5: confirmed viewing becomes an appointment with correct priority", () => {
  const action = projectOpportunityAction(operation({
    status: "IN_PROGRESS", livingStage: "APPOINTMENT_CONFIRMED",
    appointmentStatus: "CONFIRMED_BY_BROKER", appointmentAt: "2026-09-13T14:00:00.000Z"
  }), NOW);
  assert.equal(action.badge, "موعد معاينة");
  assert.equal(action.rank, 2);
  assert.equal(action.primaryAction, "عرض الموعد");
});

test("TEST 6: two-hour viewing reminder is scheduled and becomes due", () => {
  const appointmentAt = "2026-09-13T14:00:00.000Z";
  const schedule = viewingReminderSchedule(appointmentAt);
  assert.equal(schedule.find((item) => item.kind === VIEWING_REMINDER_KIND.TWO_HOURS).at, NOW.toISOString());
  const due = dueViewingReminders({ appointmentAt, appointmentStatus: "CONFIRMED_BY_BROKER" }, NOW, 5);
  assert.deepEqual(due.map((item) => item.kind), [VIEWING_REMINDER_KIND.TWO_HOURS]);
});

test("TEST 6B: thirty-minute viewing reminder is scheduled and becomes due", () => {
  const appointmentAt = "2026-09-13T12:30:00.000Z";
  const schedule = viewingReminderSchedule(appointmentAt);
  assert.equal(schedule.find((item) => item.kind === VIEWING_REMINDER_KIND.THIRTY_MINUTES).at, NOW.toISOString());
  const due = dueViewingReminders({ appointmentAt, appointmentStatus: "CONFIRMED_BY_BROKER" }, NOW, 5);
  assert.deepEqual(due.map((item) => item.kind), [VIEWING_REMINDER_KIND.THIRTY_MINUTES]);
});

test("TEST 7: rescheduling invalidates old reminder identity and uses only current Match time", () => {
  const oldAt = "2026-09-13T14:00:00.000Z";
  const newAt = "2026-09-13T16:00:00.000Z";
  assert.notEqual(
    viewingReminderId({ matchId: "match-1", appointmentAt: oldAt, kind: "2h" }),
    viewingReminderId({ matchId: "match-1", appointmentAt: newAt, kind: "2h" })
  );
  assert.equal(dueViewingReminders({ appointmentAt: newAt, appointmentStatus: "CONFIRMED_BY_BROKER" }, NOW, 5).length, 0);
});

test("TEST 8: elapsed appointment without result rises as overdue", () => {
  const action = projectOpportunityAction(operation({
    status: "IN_PROGRESS", livingStage: "APPOINTMENT_CONFIRMED",
    appointmentStatus: "CONFIRMED_BY_BROKER", appointmentAt: "2026-09-13T11:55:00.000Z"
  }), NOW);
  assert.equal(action.rank, 1);
  assert.equal(action.badge, "يحتاج إجراء");
  assert.equal(action.primaryAction, "سجّل نتيجة المعاينة");
});

test("TEST 9: viewing result closes the previous action and duplicate operations collapse", () => {
  const completed = operation({
    status: "IN_PROGRESS", livingStage: "VIEWING_COMPLETED",
    appointmentAt: "2026-09-13T11:00:00.000Z", viewingCompletedAt: "2026-09-13T11:30:00.000Z",
    viewingOutcome: "NOT_SERIOUS"
  });
  assert.equal(projectOpportunityAction(completed, NOW), null);
  const duplicate = { ...operation(), id: "op_2", updatedAt: "2026-09-13T11:30:00.000Z" };
  assert.equal(buildOpportunityActionIndex([operation(), duplicate], { officeId: "office-a", now: NOW }).size, 1);
});

test("TEST 10: opportunity without action remains in priority sorting", () => {
  const records = [{ id: "quiet", updatedAt: "2026-09-13T10:00:00Z" }, { id: "active", updatedAt: "2026-09-13T09:00:00Z" }];
  const index = buildOpportunityActionIndex([operation({ opportunityId: "active" })], { officeId: "office-a", now: NOW });
  const sorted = records.sort((a, b) => compareOpportunityPriority(a, b, (row) => index.get(row.id)));
  assert.deepEqual(sorted.map((row) => row.id), ["active", "quiet"]);
  assert.equal(opportunityMatchesActionFilter(null, OPPORTUNITY_ACTION_FILTER.ALL), true);
});

test("TEST 11: completed and archived Operations never project active actions", () => {
  const index = buildOpportunityActionIndex([
    operation({ status: "COMPLETED" }), operation({ id: "op_2", status: "EXPIRED" })
  ], { officeId: "office-a", now: NOW });
  assert.equal(index.size, 0);
});

test("TEST 12: viewing Push deep link carries office, opportunity, match task, and operation identity", () => {
  const worker = readFileSync(new URL("../worker/src/index.js", import.meta.url), "utf8");
  assert.match(worker, /type: "viewing"/);
  assert.match(worker, /recordId: matchId/);
  assert.match(worker, /taskId: livingTaskId\(match\.matchGroupId \|\| opportunityId \|\| matchId\)/);
  assert.match(worker, /opportunityId,/);
  assert.match(worker, /params\.set\("openDailyTask",safeTaskId\)/);
  assert.match(worker, /params\.set\("openOperation",safeOperationId\)/);
  assert.match(worker, /params\.set\("openOpportunity",safeOpportunityId\)/);
  assert.match(worker, /params\.set\("openAppointment",safeAppointmentId\)/);
});

test("REGRESSION: persisted READY MATCH_REVIEW survives projection and ownership filter", () => {
  const projected = projectOperationToUiItem({
    ...operation({ status: "READY" }), metadataJson: JSON.stringify({ clientRequestId: "request-1", ownerOfferId: "offer-1" })
  });
  assert.equal(projected.officeId, "office-a");
  const index = buildOpportunityActionIndex([projected], { officeId: "office-a", now: NOW });
  assert.equal(index.get("request-1").badge, "تطابق جديد");
});

test("REGRESSION: live active-operation projection has no arbitrary Firestore limit", () => {
  const workflow = readFileSync(new URL("../public/js/workflow-office.js", import.meta.url), "utf8");
  const listener = workflow.slice(workflow.indexOf("const opsUnsub"), workflow.indexOf("const opportunityUnsub"));
  assert.doesNotMatch(listener, /\.limit\(/);
});

test("UI contract keeps one primary card and local action accents", () => {
  const ui = readFileSync(new URL("../public/js/bank-inbox-card-ui.js", import.meta.url), "utf8");
  const bank = readFileSync(new URL("../public/js/opportunity-bank.js", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(ui, /data-cv2-inbox-item/);
  assert.doesNotMatch(ui, /data-daily-task-card/);
  assert.match(bank, /buildOpportunityActionIndex/);
  assert.match(shell, /data-bank-action-filter="needs_action"/);
  assert.match(shell, /bank-card-action--overdue/);
});
