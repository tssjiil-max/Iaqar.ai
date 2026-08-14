import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_CONFIG,
  APPLICATION_STATUSES,
  applicationMatchesTab,
  backfillOfficeRecord,
  buildActivitySummary,
  buildOverviewCounts,
  classifyActivityLevel,
  isOfficeInactive,
  isOfficeRecentlyActive,
  officeMatchesTab,
  resolveLicenseStatus,
  resolveSubscriptionStatus,
  sortOffices
} from "../worker/src/admin-domain.js";

const NOW = Date.parse("2026-08-14T00:00:00.000Z");

test("backfillOfficeRecord defaults legacy offices to approved active", () => {
  const row = backfillOfficeRecord({ officeId: "office-a", officeName: "مكتب أ" });
  assert.equal(row.approvalStatus, "approved");
  assert.equal(row.accountStatus, "active");
  assert.equal(row.subscriptionStatus, "none");
});

test("APPLICATION_STATUSES includes under_review lifecycle state", () => {
  assert.deepEqual(APPLICATION_STATUSES, ["pending", "under_review", "approved", "rejected"]);
});

test("applicationMatchesTab filters pending, under_review, rejected, approved", () => {
  assert.equal(applicationMatchesTab({ status: "pending" }, "pending"), true);
  assert.equal(applicationMatchesTab({ status: "under_review" }, "under_review"), true);
  assert.equal(applicationMatchesTab({ status: "rejected" }, "rejected"), true);
  assert.equal(applicationMatchesTab({ status: "approved" }, "approved"), true);
  assert.equal(applicationMatchesTab({ status: "pending" }, "under_review"), false);
});

test("resolveLicenseStatus handles expiry windows via ACTIVITY_CONFIG", () => {
  assert.equal(resolveLicenseStatus("2026-07-01T00:00:00.000Z", NOW), "expired");
  assert.equal(resolveLicenseStatus("2026-09-01T00:00:00.000Z", NOW), "expiring");
  assert.equal(resolveLicenseStatus("2027-01-01T00:00:00.000Z", NOW), "valid");
  assert.equal(resolveLicenseStatus("", NOW), "unknown");
});

test("resolveSubscriptionStatus marks active subscriptions near expiry", () => {
  assert.equal(resolveSubscriptionStatus("active", "2026-09-01T00:00:00.000Z", NOW), "expiring");
  assert.equal(resolveSubscriptionStatus("none", "", NOW), "none");
});

test("officeMatchesTab separates approved, suspended, active, inactive, and expiry tabs", () => {
  const approved = {
    officeId: "a",
    approvalStatus: "approved",
    accountStatus: "active",
    subscriptionStatus: "active",
    licenseStatus: "valid",
    lastActivityAt: "2026-08-13T00:00:00.000Z"
  };
  const suspended = { officeId: "b", approvalStatus: "approved", accountStatus: "suspended" };
  const licenseExpiring = { officeId: "c", approvalStatus: "approved", accountStatus: "active", licenseExpiresAt: "2026-09-01T00:00:00.000Z" };
  const inactive = { officeId: "d", approvalStatus: "approved", accountStatus: "active", lastActivityAt: "2026-01-01T00:00:00.000Z" };
  assert.equal(officeMatchesTab(approved, "approved"), true);
  assert.equal(officeMatchesTab(suspended, "approved"), false);
  assert.equal(officeMatchesTab(suspended, "suspended"), true);
  assert.equal(officeMatchesTab(approved, "active"), true);
  assert.equal(officeMatchesTab(inactive, "inactive"), true);
  assert.equal(officeMatchesTab(licenseExpiring, "license_expiring"), true);
});

test("isOfficeRecentlyActive and isOfficeInactive use centralized thresholds", () => {
  const active = { lastActivityAt: "2026-08-13T00:00:00.000Z" };
  const inactive = { lastActivityAt: "2026-01-01T00:00:00.000Z" };
  assert.equal(isOfficeRecentlyActive(active, NOW), true);
  assert.equal(isOfficeInactive(inactive, NOW), true);
  assert.equal(ACTIVITY_CONFIG.ACTIVE_ACTIVITY_DAYS, 7);
  assert.equal(ACTIVITY_CONFIG.INACTIVE_ACTIVITY_DAYS, 30);
});

test("buildOverviewCounts uses real office and application rows with full metrics", () => {
  const overview = buildOverviewCounts(
    [
      {
        officeId: "a",
        approvalStatus: "approved",
        accountStatus: "active",
        lastActivityAt: "2026-08-13T00:00:00.000Z",
        licenseExpiresAt: "2026-09-01T00:00:00.000Z",
        subscriptionExpiresAt: "2026-09-01T00:00:00.000Z",
        subscriptionStatus: "active"
      },
      {
        officeId: "b",
        approvalStatus: "approved",
        accountStatus: "active",
        lastActivityAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    [
      { status: "pending" },
      { status: "under_review" },
      { status: "rejected" }
    ],
    NOW
  );
  assert.equal(overview.totalOffices, 2);
  assert.equal(overview.pendingApprovals, 2);
  assert.equal(overview.rejectedApplications, 1);
  assert.equal(overview.approvedOffices, 2);
  assert.equal(overview.activeOffices, 1);
  assert.equal(overview.inactiveOffices, 1);
  assert.equal(overview.licensesExpiringSoon, 1);
  assert.equal(overview.subscriptionsExpiringSoon, 1);
});

test("buildActivitySummary does not fabricate historical values", () => {
  const summary = buildActivitySummary({ office: { officeId: "a" }, now: NOW });
  assert.equal(summary.historicalDataAvailable, false);
  assert.equal(summary.opportunities7d, 0);
});

test("classifyActivityLevel prioritizes product activity over login volume", () => {
  const level = classifyActivityLevel({
    opportunities7d: 3,
    operationsCompleted7d: 1,
    lastActivityAt: "2026-08-13T00:00:00.000Z",
    loginCount7d: 20
  }, NOW);
  assert.equal(level, "very_active");
});

test("sortOffices supports registration and activity ordering", () => {
  const rows = sortOffices([
    { officeId: "a", registeredAt: "2026-01-01T00:00:00.000Z", lastActivityAt: "2026-08-01T00:00:00.000Z" },
    { officeId: "b", registeredAt: "2026-06-01T00:00:00.000Z", lastActivityAt: "2026-08-10T00:00:00.000Z" }
  ], "activity_desc");
  assert.equal(rows[0].officeId, "b");
});

test("approval preserves application history conceptually via separate statuses", () => {
  const approvedOffice = backfillOfficeRecord({
    officeId: "office-x",
    approvalStatus: "approved",
    approvedAt: "2026-08-01T00:00:00.000Z",
    registeredAt: "2026-07-01T00:00:00.000Z"
  });
  assert.equal(approvedOffice.approvalStatus, "approved");
  assert.ok(approvedOffice.approvedAt);
  assert.ok(approvedOffice.registeredAt);
});

test("suspension preserves office record fields", () => {
  const suspended = backfillOfficeRecord({
    officeId: "office-y",
    approvalStatus: "approved",
    accountStatus: "suspended",
    officeName: "مكتب محفوظ"
  });
  assert.equal(suspended.accountStatus, "suspended");
  assert.equal(suspended.officeName, "مكتب محفوظ");
  assert.equal(suspended.approvalStatus, "approved");
});
