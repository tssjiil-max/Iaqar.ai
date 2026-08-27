import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  backfillOfficeRecord,
  buildActivitySummary,
  buildOverviewCounts,
  classifyActivityLevel,
  officeMatchesTab,
  resolveLicenseStatus,
  resolveSubscriptionStatus,
  sortOffices
} from "../worker/src/admin-domain.js";
import { isPlatformAdminClaims, mapAdminLoginError, MAIN_VIEWS } from "../public/js/admin-api.js";
import { buildAdminDailyTasks } from "../public/js/admin-daily-domain.js";

test("backfillOfficeRecord defaults legacy offices to approved active", () => {
  const row = backfillOfficeRecord({ officeId: "office-a", officeName: "مكتب أ" });
  assert.equal(row.approvalStatus, "approved");
  assert.equal(row.accountStatus, "active");
  assert.equal(row.subscriptionStatus, "none");
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

test("isPlatformAdminClaims accepts boolean and string admin flags", () => {
  assert.equal(isPlatformAdminClaims({ platformAdmin: true }), true);
  assert.equal(isPlatformAdminClaims({ admin: true }), true);
  assert.equal(isPlatformAdminClaims({ platformAdmin: "true" }), true);
  assert.equal(isPlatformAdminClaims({ email: "broker@example.com" }), false);
});

test("mapAdminLoginError distinguishes wrong password from unauthorized", () => {
  assert.equal(
    mapAdminLoginError({ code: "auth/invalid-credential" }),
    "البريد أو كلمة المرور غير صحيحة."
  );
  assert.equal(
    mapAdminLoginError({ code: "admin_required" }),
    "هذا الحساب ليس من إدارة المنصة."
  );
});

test("buildAdminDailyTasks uses real pending applications and never invents matches", () => {
  const tasks = buildAdminDailyTasks({
    applications: [
      { id: "broker_1", status: "pending", officeName: "مكتب النور", brokerName: "أحمد", phone: "0500000000", falLicense: "123" },
      { id: "broker_2", status: "rejected", officeName: "مرفوض" }
    ],
    offices: [
      { officeId: "office-a", officeName: "مكتب أ", accountStatus: "suspended" },
      { officeId: "office-b", officeName: "مكتب ب", accountStatus: "active", subscriptionStatus: "expired" }
    ]
  });
  assert.equal(tasks.some((row) => row.kind === "application" && row.applicationId === "broker_1"), true);
  assert.equal(tasks.some((row) => row.kind === "application" && row.applicationId === "broker_2"), false);
  assert.equal(tasks.some((row) => row.kind === "suspended" && row.officeId === "office-a"), true);
  assert.equal(tasks.some((row) => row.kind === "expired" && row.officeId === "office-b"), true);
  assert.equal(tasks.some((row) => /مطابقة|إرسال للعميل/.test(row.title + row.body)), false);
});

test("platform admin main views are the two control tabs from the owner mockup", () => {
  assert.deepEqual(
    MAIN_VIEWS.map((row) => row.id),
    ["daily", "requests"]
  );
  assert.equal(MAIN_VIEWS[0].label, "المهام اليومية");
  assert.equal(MAIN_VIEWS[1].label, "العروض والطلبات");
});

test("sortOffices supports registration and activity ordering", () => {
  const rows = sortOffices([
    { officeId: "a", registeredAt: "2026-01-01T00:00:00.000Z", lastActivityAt: "2026-08-01T00:00:00.000Z" },
    { officeId: "b", registeredAt: "2026-06-01T00:00:00.000Z", lastActivityAt: "2026-08-10T00:00:00.000Z" }
  ], "activity_desc");
  assert.equal(rows[0].officeId, "b");
});

test("platform admin header uses the owner banner image and إدارة المنصة in Naskh", () => {
  const html = readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8");
  assert.match(html, /src="\/images\/admin-header-banner\.png"/);
  assert.match(html, /<h1>\s*إدارة المنصة\s*<\/h1>/);
  assert.match(html, /Noto Naskh Arabic/);
  assert.doesNotMatch(html, /لوحة إدارة المنصة \(Admin\)/);
});
