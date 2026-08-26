import test from "node:test";
import assert from "node:assert/strict";
import {
  CLEANUP_DECISION,
  classifyCleanupRecord,
  isStagingOfficeId,
  isTaggedTestRecord
} from "../public/js/opportunity-cleanup-domain.js";
import {
  archiveActionLabel,
  archiveConfirmCopy,
  buildOpportunityDeletePlan,
  opportunityIdsFromMatch,
  permanentDeleteCopy,
  planMatchDelete
} from "../public/js/opportunity-delete-plan-domain.js";
import {
  isNotificationUnread,
  livingEventNotificationTitle,
  mapNotificationView,
  notificationTypeFromPartyAction,
  unreadNotificationCount
} from "../public/js/in-app-notification-domain.js";
import { validatePurgeRequest } from "../worker/src/opportunity-purge-service.js";

test("staging office ids are detected without guessing production", () => {
  assert.equal(isStagingOfficeId("staging-logo-live-20260807"), true);
  assert.equal(isStagingOfficeId("qa-e2e-dedicated"), true);
  assert.equal(isStagingOfficeId("platform"), false);
});

test("tagged fixtures delete; untagged real rows stay review-required", () => {
  assert.equal(isTaggedTestRecord({ isTestFixture: true, id: "opp_x" }), true);
  assert.equal(isTaggedTestRecord({ createdBy: "E2E", id: "opp_x" }), true);
  assert.equal(isTaggedTestRecord({ testRunId: "abc", id: "opp_x" }), true);
  assert.equal(isTaggedTestRecord({ id: "opp_livee2e_matchint_req" }), true);
  const real = classifyCleanupRecord({
    id: "opp_manual_owner_1",
    officeId: "staging-logo-live-20260807",
    district: "العزيزية",
    salePrice: 50000
  });
  assert.equal(real.decision, CLEANUP_DECISION.REVIEW_REQUIRED);
});

test("integrity legacy and explicit allowlist are the only untagged deletes", () => {
  const legacy = classifyCleanupRecord(
    { id: "mat_invalid_1" },
    { integrityLegacyIds: ["mat_invalid_1"] }
  );
  assert.equal(legacy.decision, CLEANUP_DECISION.ALLOWLIST);
  const allowed = classifyCleanupRecord(
    { id: "opp_e2e_client_x" },
    { allowlistIds: ["opp_e2e_client_x"] }
  );
  assert.equal(allowed.decision, CLEANUP_DECISION.ALLOWLIST);
  const suspect = classifyCleanupRecord({ id: "opp_e2e_client_x" });
  assert.equal(suspect.decision, CLEANUP_DECISION.CANDIDATE);
});

test("shared matches are not deleted when a counterpart survives", () => {
  const match = {
    id: "mat_1",
    requestId: "opp_keep",
    offerId: "opp_delete"
  };
  assert.deepEqual(opportunityIdsFromMatch(match).sort(), ["opp_delete", "opp_keep"]);
  const shared = planMatchDelete(match, ["opp_delete"]);
  assert.equal(shared.action, "skip");
  assert.equal(shared.reason, "shared_with_surviving_opportunity");
  const exclusive = planMatchDelete(match, ["opp_delete", "opp_keep"]);
  assert.equal(exclusive.action, "delete");
});

test("delete plan counts exclusive dependents only", () => {
  const plan = buildOpportunityDeletePlan({
    opportunityIds: ["opp_a"],
    matches: [
      { id: "mat_ex", requestId: "opp_a", offerId: "opp_a" },
      { id: "mat_share", requestId: "opp_a", offerId: "opp_b" }
    ],
    operations: [{ id: "op_1", matchId: "mat_ex", opportunityId: "opp_a" }],
    partySessions: [{ id: "ps_1", matchId: "mat_share", opportunityId: "opp_a" }]
  });
  assert.equal(plan.counts.opportunity, 1);
  assert.equal(plan.counts.match, 1);
  assert.ok(plan.skip.some((row) => row.id === "mat_share"));
});

test("notifications exclusive to a deleted operation are included", () => {
  const plan = buildOpportunityDeletePlan({
    opportunityIds: ["opp_a"],
    matches: [{ id: "mat_ex", requestId: "opp_a", offerId: "opp_a" }],
    operations: [{ id: "op_1", matchId: "mat_ex", opportunityId: "opp_a" }],
    notifications: [{ id: "nt_1", operationId: "op_1", matchId: "mat_ex" }]
  });
  assert.equal(plan.counts.notification, 1);
});

test("closed deals use archive-deal copy", () => {
  assert.equal(archiveActionLabel({ lifecycleStatus: "CLOSED_WON" }), "أرشفة الصفقة");
  assert.equal(archiveActionLabel({ opportunityKind: "OFFER" }), "نقل إلى الأرشيف");
  assert.match(archiveConfirmCopy({ opportunityKind: "OFFER" }), /الأرشيف/);
  assert.match(permanentDeleteCopy(), /نهائيًا/);
});

test("purge requires archived staging-safe confirmation", () => {
  const active = validatePurgeRequest({
    existing: { officeId: "staging-logo-live-20260807", lifecycleStatus: "ACTIVE" },
    officeId: "staging-logo-live-20260807",
    confirm: "PERMANENT_DELETE"
  });
  assert.equal(active.ok, false);
  const archived = validatePurgeRequest({
    existing: { officeId: "staging-logo-live-20260807", lifecycleStatus: "ARCHIVED", archivedAt: "x" },
    officeId: "staging-logo-live-20260807",
    confirm: "PERMANENT_DELETE"
  });
  assert.equal(archived.ok, true);
});

test("notification titles and unread counting", () => {
  assert.equal(
    livingEventNotificationTitle({ party: "client", action: "interested", referenceCode: "A-1842" }),
    "العميل مهتم بالعقار — #A-1842"
  );
  assert.equal(notificationTypeFromPartyAction("owner", "property_available"), "OWNER_AVAILABLE");
  assert.equal(isNotificationUnread({ status: "CREATED" }), true);
  assert.equal(isNotificationUnread({ status: "CREATED", readAt: "2026-08-25T10:00:00.000Z" }), false);
  assert.equal(unreadNotificationCount([
    { id: "1", status: "CREATED" },
    { id: "2", status: "READ", readAt: "x" }
  ]), 1);
  const view = mapNotificationView({
    id: "n1",
    title: "العميل مهتم بالعقار — #A-1842",
    createdAt: "2026-08-24T17:43:00.000Z"
  }, new Date("2026-08-25T18:00:00.000Z"));
  assert.equal(view.clockLabel.includes("الآن"), false);
  assert.match(view.clockLabel, /أمس/);
});
