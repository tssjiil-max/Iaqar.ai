import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const navigationSource = readFileSync(new URL("../public/js/notification-navigation.js", import.meta.url), "utf8");
const serviceWorkerSource = readFileSync(new URL("../public/firebase-messaging-sw.js", import.meta.url), "utf8");
const workflowSource = readFileSync(new URL("../public/js/workflow-office.js", import.meta.url), "utf8");

function navigationApi() {
  const window = { IAQAR: {} };
  runInNewContext(navigationSource, { window, URLSearchParams });
  return window.IAQAR;
}

test("daily-task notification URL preserves exact fallback record identifiers", () => {
  const api = navigationApi();
  const url = api.buildNotificationRelativeUrl({
    officeId: "office-1",
    taskId: "mg_match-1",
    matchId: "match-1",
    opportunityId: "offer-1",
    operationId: "op-1"
  });
  const params = new URL(url, "https://example.test").searchParams;
  assert.equal(params.get("openDailyTask"), "mg_match-1");
  assert.equal(params.get("openMatch"), "match-1");
  assert.equal(params.get("openOpportunity"), "offer-1");
  assert.equal(params.get("openOperation"), "op-1");
  const target = api.parseNotificationSearchParams(params);
  assert.equal(target.kind, "daily-task");
  assert.equal(target.matchId, "match-1");
  assert.equal(target.opportunityId, "offer-1");
});

test("notification destination survives Android notification data and login", () => {
  assert.match(serviceWorkerSource, /workflowId: data\.workflowId/);
  assert.match(serviceWorkerSource, /entityType: data\.entityType/);
  assert.match(serviceWorkerSource, /operationId: data\.operationId/);
  assert.match(workflowSource, /iaqar\.pendingNotificationTarget/);
  assert.match(workflowSource, /iaqar:access-granted["'], replayPendingNotificationTarget/);
  assert.match(workflowSource, /iaqar:operations-refresh["'], replayPendingNotificationTarget/);
});

test("legacy match notification task ids are repaired to the live mg_ task", () => {
  const api = navigationApi();
  const fromData = api.buildNotificationTargetFromData({
    type: "match",
    taskId: "opp_request_1",
    matchId: "mat_1",
    operationId: "op_1"
  });
  assert.equal(fromData.kind, "daily-task");
  assert.equal(fromData.id, "mg_opp_request_1");

  const fromUrl = api.parseNotificationSearchParams(new URLSearchParams({
    openDailyTask: "opp_request_1",
    openMatch: "mat_1",
    openOperation: "op_1"
  }));
  assert.equal(fromUrl.id, "mg_opp_request_1");

  const missingData = api.parseNotificationSearchParams(new URLSearchParams({
    openDailyTask: "op_missing_1",
    openOperation: "op_missing_1",
    openOpportunity: "opp_incomplete_1"
  }));
  assert.equal(missingData.id, "op_missing_1");
});
