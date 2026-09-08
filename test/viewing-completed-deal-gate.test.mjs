import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LIVING_TASK_STAGE, livingCopy } from "../public/js/match-group-domain.js";
import { buildDailyTaskView, EXEC_ACTION, DAILY_TASK_STATE } from "../public/js/v2/daily-tasks/domain.js";

test("appointment confirmed exposes completion instead of direct deal completion", () => {
  const task = buildDailyTaskView({
    id: "mg_1", matchId: "m1", offerId: "o1", requestId: "r1",
    livingStage: LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED,
    stateKey: DAILY_TASK_STATE.APPOINTMENT_TODAY,
    canOpenOffer: false
  });
  assert.equal(task.primaryAction.id, EXEC_ACTION.CONFIRM_VIEWING_COMPLETED);
  assert.equal(task.primaryAction.label, "تمت المعاينة");
  assert.equal(livingCopy(LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED).waiting, false);
});

test("completed viewing requires explicit seriousness before create Deal action", () => {
  const base = {
    id: "mg_1", matchId: "m1", offerId: "o1", requestId: "r1",
    livingStage: LIVING_TASK_STAGE.VIEWING_COMPLETED,
    stateKey: DAILY_TASK_STATE.NEW_MATCH, canOpenOffer: false
  };
  const pending = buildDailyTaskView(base);
  assert.equal(pending.primaryAction.id, EXEC_ACTION.MARK_VIEWING_SERIOUS);
  assert.deepEqual(pending.secondaryActions.map((action) => action.id), [
    EXEC_ACTION.MARK_VIEWING_FOLLOW_UP, EXEC_ACTION.MARK_VIEWING_NOT_SERIOUS
  ]);
  const serious = buildDailyTaskView({ ...base, viewingOutcome: "SERIOUS", seriousIntentConfirmed: true });
  assert.equal(serious.primaryAction.id, EXEC_ACTION.CREATE_DEAL);
  const notSerious = buildDailyTaskView({ ...base, viewingOutcome: "NOT_SERIOUS" });
  assert.equal(notSerious.primaryAction, null);
});

test("worker wiring bans legacy direct completion and exposes safe viewing lifecycle actions", () => {
  const party = readFileSync(new URL("../worker/src/party-session-service.js", import.meta.url), "utf8");
  const controller = readFileSync(new URL("../public/js/v2/daily-tasks/controller.js", import.meta.url), "utf8");
  assert.match(party, /CONFIRM_VIEWING_COMPLETED/);
  assert.match(party, /SET_VIEWING_OUTCOME/);
  assert.match(party, /legacy_match_completion_removed/);
  assert.doesNotMatch(party, /type: "deal_completed"/);
  assert.match(controller, /action: "CONFIRM_VIEWING_COMPLETED"/);
  assert.match(controller, /action: "SET_VIEWING_OUTCOME"/);
  assert.match(controller, /action: "create_deal"/);
});
