import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  notificationBoundaryGuarantees,
  notificationToFirestoreFields,
  upsertNotificationDocument
} from "../worker/src/notification-service.js";
import {
  NOTIFICATION_STATUS,
  buildInAppNotification,
  notificationDocumentId
} from "../worker/src/notification-domain.js";
import {
  NOTIFICATION_STATUS as COMPAT_NOTIFICATION_STATUS,
  notificationDocumentId as compatNotificationDocumentId
} from "../worker/src/operations-domain.js";
import {
  mapNotificationView,
  notificationTapTarget
} from "../public/js/in-app-notification-domain.js";

const firestoreHelpers = {
  firestoreString: (value) => ({ stringValue: String(value ?? "") }),
  firestoreBoolean: (value) => ({ booleanValue: Boolean(value) }),
  firestoreInteger: (value) => ({ integerValue: String(Number(value || 0)) }),
  firestoreTimestamp: (value) => ({ timestampValue: new Date(value).toISOString() }),
  firestoreFieldsToJs: (fields = {}) => fields.__js || {}
};

function readRepo(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Notifications are side effects only and never own workflow state", () => {
  const guarantees = notificationBoundaryGuarantees();
  assert.equal(guarantees.ownsBusinessState, false);
  assert.equal(guarantees.createsOperations, false);
  assert.equal(guarantees.advancesWorkflow, false);
  assert.equal(guarantees.inAppIsAuthoritativeAlert, true);
  assert.equal(guarantees.pushIsOptionalSideEffect, true);
  assert.equal(guarantees.deterministicDeduplication, true);
});

test("notification persistence preserves every deterministic navigation identifier", () => {
  const fields = notificationToFirestoreFields({
    id: "nt_1",
    officeId: "office-a",
    type: "COOPERATION_RESPONSE",
    title: "رد تعاون",
    dealId: "deal_1",
    matchId: "mat_1",
    operationId: "op_1",
    opportunityId: "opp_1",
    cooperationId: "coop_1",
    entityType: "cooperation",
    entityId: "coop_1",
    targetPath: "/?openCooperation=coop_1",
    createdAt: "2026-09-07T10:00:00.000Z"
  }, firestoreHelpers);

  assert.equal(fields.dealId.stringValue, "deal_1");
  assert.equal(fields.matchId.stringValue, "mat_1");
  assert.equal(fields.operationId.stringValue, "op_1");
  assert.equal(fields.opportunityId.stringValue, "opp_1");
  assert.equal(fields.cooperationId.stringValue, "coop_1");
  assert.equal(fields.entityType.stringValue, "cooperation");
  assert.equal(fields.entityId.stringValue, "coop_1");
  assert.equal(fields.targetPath.stringValue, "/?openCooperation=coop_1");
});

test("notification persistence fails closed on cross-office identity mismatch", async () => {
  await assert.rejects(
    upsertNotificationDocument({
      projectId: "p",
      officeId: "office-a",
      notification: { id: "nt_1", officeId: "office-b" },
      accessToken: "token",
      getFirestoreDocument: async () => null,
      setFirestoreDocument: async () => {},
      firestoreHelpers
    }),
    /notification_office_mismatch/
  );
});

test("notification upsert is deterministic and idempotent by notification id", async () => {
  const writes = [];
  const notification = {
    id: "nt_fixed",
    officeId: "office-a",
    type: "NEW_MATCH",
    title: "مطابقة",
    createdAt: "2026-09-07T10:00:00.000Z"
  };

  const created = await upsertNotificationDocument({
    projectId: "p",
    officeId: "office-a",
    notification,
    accessToken: "token",
    getFirestoreDocument: async () => null,
    setFirestoreDocument: async (write) => writes.push(write),
    firestoreHelpers
  });
  assert.equal(created.created, true);
  assert.deepEqual(writes[0].segments, ["offices", "office-a", "notifications", "nt_fixed"]);

  let duplicateWrites = 0;
  const duplicate = await upsertNotificationDocument({
    projectId: "p",
    officeId: "office-a",
    notification,
    accessToken: "token",
    getFirestoreDocument: async () => ({ fields: { __js: { officeId: "office-a", status: "CREATED" } } }),
    setFirestoreDocument: async () => { duplicateWrites += 1; },
    firestoreHelpers
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.notification.id, "nt_fixed");
  assert.equal(duplicateWrites, 0);
});

test("notification domain keeps deterministic ids and legacy facade compatibility", async () => {
  assert.deepEqual(COMPAT_NOTIFICATION_STATUS, NOTIFICATION_STATUS);
  const direct = await notificationDocumentId("NOTIF|office-a|event-1");
  const compat = await compatNotificationDocumentId("NOTIF|office-a|event-1");
  assert.equal(direct, compat);
  assert.ok(direct.startsWith("nt_"));
});

test("Operation-to-alert projection carries exact business identifiers without advancing workflow", async () => {
  const notification = await buildInAppNotification({
    officeId: "office-a",
    referenceCode: "A-123",
    operation: {
      id: "op_1",
      officeId: "office-a",
      type: "COOPERATION_RESPONSE",
      sourceEntityType: "cooperationRequest",
      sourceEntityId: "coop_1",
      opportunityId: "opp_1",
      matchId: "mat_1",
      dealId: "deal_1",
      cooperationId: "coop_1",
      deduplicationKey: "COOPERATION_RESPONSE|office-a|coop_1|ACCEPTED"
    },
    now: new Date("2026-09-07T10:00:00.000Z")
  });
  assert.equal(notification.status, NOTIFICATION_STATUS.CREATED);
  assert.equal(notification.operationId, "op_1");
  assert.equal(notification.matchId, "mat_1");
  assert.equal(notification.dealId, "deal_1");
  assert.equal(notification.opportunityId, "opp_1");
  assert.equal(notification.cooperationId, "coop_1");
  assert.equal(notification.entityType, "cooperationRequest");
  assert.equal(notification.entityId, "coop_1");
});

test("in-app view keeps opportunity/cooperation/deal identifiers instead of collapsing to Daily Tasks", () => {
  const row = mapNotificationView({
    id: "nt_nav",
    officeId: "office-a",
    type: "COOPERATION_REQUEST",
    title: "طلب تعاون",
    opportunityId: "opp_7",
    cooperationId: "coop_7",
    dealId: "deal_7",
    entityType: "cooperation",
    entityId: "coop_7",
    targetPath: "/?openCooperation=coop_7",
    createdAt: "2026-09-07T10:00:00.000Z"
  }, new Date("2026-09-07T10:01:00.000Z"));

  assert.equal(row.opportunityId, "opp_7");
  assert.equal(row.cooperationId, "coop_7");
  assert.equal(row.dealId, "deal_7");
  assert.equal(row.entityType, "cooperation");
  assert.equal(row.entityId, "coop_7");
  assert.equal(row.targetPath, "/?openCooperation=coop_7");

  const target = notificationTapTarget(row);
  assert.equal(target.cooperationId, "coop_7");
  assert.equal(target.opportunityId, "opp_7");
  assert.equal(target.dealId, "deal_7");
});

test("match notifications still repair legacy task ids without losing exact match/operation ids", () => {
  const target = notificationTapTarget({
    taskId: "opp_request_1",
    matchId: "mat_1",
    operationId: "op_1"
  });
  assert.equal(target.taskId, "mg_opp_request_1");
  assert.equal(target.matchId, "mat_1");
  assert.equal(target.operationId, "op_1");
});

test("Operations delegates notification persistence and no longer implements it", () => {
  const source = readRepo("worker/src/operations-service.js");
  assert.match(source, /from "\.\/notification-service\.js"/);
  assert.match(source, /buildInAppNotification \} from "\.\/notification-domain\.js"/);
  assert.doesNotMatch(source, /export function notificationToFirestoreFields\s*\(/);
  assert.doesNotMatch(source, /export async function upsertNotificationDocument\s*\(/);
  assert.doesNotMatch(source, /export async function recordNotificationPushResult\s*\(/);
});

test("notification domain/service/writer do not depend on Operations domain", () => {
  for (const path of [
    "worker/src/notification-domain.js",
    "worker/src/notification-service.js",
    "worker/src/in-app-notification-write.js"
  ]) {
    assert.doesNotMatch(readRepo(path), /\.\/operations-domain\.js/, path);
  }
  const operationsDomain = readRepo("worker/src/operations-domain.js");
  assert.match(operationsDomain, /from "\.\/notification-domain\.js"/);
  assert.doesNotMatch(operationsDomain, /export const NOTIFICATION_STATUS = Object\.freeze/);
  assert.doesNotMatch(operationsDomain, /export async function buildInAppNotification\s*\(/);
});

test("notification center opens the canonical deep link and never defaults every alert to Daily Tasks", () => {
  const source = readRepo("public/js/in-app-notifications.js");
  assert.match(source, /buildNotificationRelativeUrl/);
  assert.match(source, /window\.location\.assign\(relativeUrl\)/);
  assert.match(source, /function openNotificationTarget\(/);
  assert.doesNotMatch(source, /function openDailyTaskFromNotification\(/);
  assert.match(source, /Never silently open a generic business screen/);
});
