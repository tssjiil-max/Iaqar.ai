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
