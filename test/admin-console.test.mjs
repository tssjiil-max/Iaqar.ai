import test from "node:test";
import assert from "node:assert/strict";
import {
  activityLevelFromSummary,
  backfillOfficeRecord,
  buildActivityListRow,
  buildActivitySummary,
  buildMigrationPatch,
  buildOverviewCounts,
  bumpActivitySummaryCounters,
  classifyActivityLevel,
  matchesActivityLevelFilter,
  officeMatchesTab,
  resolveLicenseStatus,
  resolveSubscriptionStatus,
  sortOffices
} from "../worker/src/admin-domain.js";

test("backfillOfficeRecord defaults legacy offices to approved active", () => {
  const row = backfillOfficeRecord({ officeId: "office-a", officeName: "مكتب أ" });
  assert.equal(row.approvalStatus, "approved");
  assert.equal(row.accountStatus, "active");
  assert.equal(row.subscriptionStatus, "none");
});

test("buildMigrationPatch is idempotent and never fabricates dates", () => {
  const office = {
    officeId: "office-a",
    approvalStatus: "approved",
    accountStatus: "active",
    subscriptionStatus: "trial",
    licenseStatus: "valid",
    createdAt: "2026-01-01T00:00:00.000Z"
  };
  assert.equal(buildMigrationPatch(office), null);
  const legacy = { officeId: "office-b", createdAt: "2026-01-01T00:00:00.000Z" };
  const patch = buildMigrationPatch(legacy);
  assert.equal(patch.approvalStatus, "approved");
  assert.equal(patch.accountStatus, "active");
  assert.equal(patch.registeredAt, "2026-01-01T00:00:00.000Z");
  assert.equal(buildMigrationPatch({ ...legacy, ...patch }), null);
});

test("resolveLicenseStatus handles expiry windows", () => {
  const now = Date.parse("2026-08-14T00:00:00.000Z");
  assert.equal(resolveLicenseStatus("2026-07-01T00:00:00.000Z", now), "expired");
  assert.equal(resolveLicenseStatus("2026-09-01T00:00:00.000Z", now), "expiring");
  assert.equal(resolveLicenseStatus("2027-01-01T00:00:00.000Z", now), "valid");
  assert.equal(resolveLicenseStatus("", now), "unknown");
});

test("resolveSubscriptionStatus marks active subscriptions near expiry", () => {
  const now = Date.parse("2026-08-14T00:00:00.000Z");
  assert.equal(resolveSubscriptionStatus("active", "2026-09-01T00:00:00.000Z", now), "expiring");
  assert.equal(resolveSubscriptionStatus("none", "", now), "none");
});

test("officeMatchesTab separates approved and suspended offices", () => {
  const approved = { officeId: "a", approvalStatus: "approved", accountStatus: "active", subscriptionStatus: "active", licenseStatus: "valid" };
  const suspended = { officeId: "b", approvalStatus: "approved", accountStatus: "suspended" };
  assert.equal(officeMatchesTab(approved, "approved"), true);
  assert.equal(officeMatchesTab(suspended, "approved"), false);
  assert.equal(officeMatchesTab(suspended, "suspended"), true);
});

test("buildOverviewCounts uses real office and application rows", () => {
  const overview = buildOverviewCounts(
    [{ officeId: "a", approvalStatus: "approved", accountStatus: "active", lastActivityAt: "2026-08-13T00:00:00.000Z" }],
    [{ status: "pending" }],
    Date.parse("2026-08-14T00:00:00.000Z")
  );
  assert.equal(overview.totalOffices, 1);
  assert.equal(overview.pendingApprovals, 1);
  assert.equal(overview.approvedOffices, 1);
});

test("buildActivitySummary does not fabricate historical values", () => {
  const summary = buildActivitySummary({ office: { officeId: "a" }, now: Date.parse("2026-08-14T00:00:00.000Z") });
  assert.equal(summary.historicalDataAvailable, false);
  assert.equal(summary.opportunities7d, 0);
});

test("classifyActivityLevel prioritizes product activity over login volume", () => {
  const level = classifyActivityLevel({
    opportunities7d: 3,
    operationsCompleted7d: 1,
    lastActivityAt: "2026-08-13T00:00:00.000Z",
    loginCount7d: 20
  }, Date.parse("2026-08-14T00:00:00.000Z"));
  assert.equal(level, "very_active");
});

test("bumpActivitySummaryCounters increments login and opportunity counters", () => {
  const afterLogin = bumpActivitySummaryCounters({}, "login");
  assert.equal(afterLogin.loginCount7d, 1);
  assert.equal(afterLogin.loginCount30d, 1);
  const afterOpp = bumpActivitySummaryCounters(afterLogin, "opportunity_created");
  assert.equal(afterOpp.opportunitiesCreated7d, 1);
  assert.equal(afterOpp.opportunitiesCreated30d, 1);
});

test("activityLevelFromSummary uses product metrics", () => {
  const level = activityLevelFromSummary({
    opportunitiesCreated7d: 3,
    completedOperations30d: 1,
    lastActivityAt: "2026-08-13T00:00:00.000Z"
  }, Date.parse("2026-08-14T00:00:00.000Z"));
  assert.equal(level, "active");
});

test("buildActivityListRow attributes metrics to officeId", () => {
  const row = buildActivityListRow({
    officeId: "office-a",
    officeName: "مكتب أ",
    city: "المدينة المنورة",
    activitySummaryJson: JSON.stringify({ opportunitiesCreated30d: 4, completedOperations30d: 2 })
  });
  assert.equal(row.officeId, "office-a");
  assert.equal(row.opportunities30d, 4);
  assert.equal(row.completedOperations30d, 2);
});

test("matchesActivityLevelFilter filters activity levels", () => {
  assert.equal(matchesActivityLevelFilter("active", "active"), true);
  assert.equal(matchesActivityLevelFilter("inactive", "active"), false);
});

test("sortOffices supports registration and activity ordering", () => {
  const rows = sortOffices([
    { officeId: "a", registeredAt: "2026-01-01T00:00:00.000Z", lastActivityAt: "2026-08-01T00:00:00.000Z" },
    { officeId: "b", registeredAt: "2026-06-01T00:00:00.000Z", lastActivityAt: "2026-08-10T00:00:00.000Z" }
  ], "activity_desc");
  assert.equal(rows[0].officeId, "b");
});

test("approval preserves officeId without duplicate semantics in migration patch", () => {
  const patch = buildMigrationPatch({ officeId: "same-id", approvalStatus: "approved" });
  assert.equal(patch, null);
  const pendingPatch = buildMigrationPatch({ officeId: "same-id" });
  assert.equal(pendingPatch.officeId, "same-id");
  assert.equal(pendingPatch.approvalStatus, "approved");
});
