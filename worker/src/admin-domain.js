/**
 * Platform admin domain — pure logic, no I/O.
 */

export const APPROVAL_STATUSES = Object.freeze(["pending", "approved", "rejected"]);
export const APPLICATION_STATUSES = Object.freeze(["pending", "under_review", "approved", "rejected"]);
export const ACCOUNT_STATUSES = Object.freeze(["active", "suspended"]);
export const LICENSE_STATUSES = Object.freeze(["valid", "expiring", "expired", "unknown"]);
export const SUBSCRIPTION_STATUSES = Object.freeze(["trial", "active", "expiring", "expired", "none"]);
export const ACTIVITY_LEVELS = Object.freeze({
  very_active: "نشط جدًا",
  active: "نشط",
  low: "نشاط منخفض",
  inactive: "غير نشط"
});

/** Centralized activity / expiry thresholds — do not scatter magic numbers elsewhere. */
export const ACTIVITY_CONFIG = Object.freeze({
  LICENSE_EXPIRY_WARNING_DAYS: 30,
  SUBSCRIPTION_EXPIRY_WARNING_DAYS: 30,
  ACTIVE_ACTIVITY_DAYS: 7,
  INACTIVE_ACTIVITY_DAYS: 30,
  VERY_ACTIVE_PRODUCT_SCORE: 8,
  ACTIVE_PRODUCT_SCORE: 3,
  LOW_PRODUCT_SCORE: 1
});

const MS_DAY = 86400000;

export function safeText(value, fallback = "") {
  return String(value == null ? fallback : value).trim();
}

export function parseTimestamp(value) {
  if (!value) return null;
  if (typeof value === "string" || typeof value === "number") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "object" && typeof value.seconds === "number") {
    return value.seconds * 1000;
  }
  if (typeof value === "object" && typeof value.toMillis === "function") {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

export function daysUntil(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return null;
  return Math.ceil((ms - now) / MS_DAY);
}

export function resolveLicenseStatus(licenseExpiresAt, now = Date.now()) {
  const ms = parseTimestamp(licenseExpiresAt);
  if (!ms) return "unknown";
  const days = daysUntil(ms, now);
  if (days < 0) return "expired";
  if (days <= ACTIVITY_CONFIG.LICENSE_EXPIRY_WARNING_DAYS) return "expiring";
  return "valid";
}

export function resolveSubscriptionStatus(subscriptionStatus, subscriptionExpiresAt, now = Date.now()) {
  const raw = safeText(subscriptionStatus).toLowerCase();
  const warningDays = ACTIVITY_CONFIG.SUBSCRIPTION_EXPIRY_WARNING_DAYS;
  if (SUBSCRIPTION_STATUSES.includes(raw) && raw !== "expiring") {
    if (raw === "active" || raw === "trial") {
      const ms = parseTimestamp(subscriptionExpiresAt);
      if (ms && daysUntil(ms, now) <= warningDays && daysUntil(ms, now) >= 0) return "expiring";
    }
    return raw;
  }
  const ms = parseTimestamp(subscriptionExpiresAt);
  if (!ms) return "none";
  const days = daysUntil(ms, now);
  if (days < 0) return "expired";
  if (days <= warningDays) return "expiring";
  return raw === "trial" ? "trial" : "active";
}

export function backfillOfficeRecord(office = {}, now = Date.now()) {
  const officeId = safeText(office.officeId || office.id);
  const approvalStatus = safeText(office.approvalStatus).toLowerCase();
  const accountStatus = safeText(office.accountStatus).toLowerCase();
  return {
    ...office,
    officeId,
    approvalStatus: APPROVAL_STATUSES.includes(approvalStatus)
      ? approvalStatus
      : (officeId && officeId !== "platform" ? "approved" : "pending"),
    accountStatus: ACCOUNT_STATUSES.includes(accountStatus) ? accountStatus : "active",
    licenseStatus: resolveLicenseStatus(office.licenseExpiresAt, now),
    subscriptionStatus: resolveSubscriptionStatus(office.subscriptionStatus, office.subscriptionExpiresAt, now),
    registeredAt: office.registeredAt || office.createdAt || null,
    approvedAt: office.approvedAt || null,
    lastLoginAt: office.lastLoginAt || null,
    lastActivityAt: office.lastActivityAt || null
  };
}

export function classifyActivityLevel(metrics = {}, now = Date.now()) {
  const productScore =
    Number(metrics.opportunities7d || 0) * 3 +
    Number(metrics.operationsCompleted7d || 0) * 4 +
    Number(metrics.matchReviews7d || 0) * 2 +
    Number(metrics.publicOwnerSubmissions7d || 0) +
    Number(metrics.publicClientSubmissions7d || 0);
  const lastActivityMs = parseTimestamp(metrics.lastActivityAt);
  const daysSinceActivity = lastActivityMs ? Math.floor((now - lastActivityMs) / MS_DAY) : null;

  if (productScore >= ACTIVITY_CONFIG.VERY_ACTIVE_PRODUCT_SCORE) return "very_active";
  if (productScore >= ACTIVITY_CONFIG.ACTIVE_PRODUCT_SCORE ||
    (daysSinceActivity != null && daysSinceActivity <= ACTIVITY_CONFIG.ACTIVE_ACTIVITY_DAYS)) return "active";
  if (productScore >= ACTIVITY_CONFIG.LOW_PRODUCT_SCORE ||
    (daysSinceActivity != null && daysSinceActivity <= ACTIVITY_CONFIG.INACTIVE_ACTIVITY_DAYS)) return "low";
  return "inactive";
}

export function isOfficeRecentlyActive(office = {}, now = Date.now()) {
  const ms = parseTimestamp(office.lastActivityAt);
  return Boolean(ms && now - ms <= ACTIVITY_CONFIG.ACTIVE_ACTIVITY_DAYS * MS_DAY);
}

export function isOfficeInactive(office = {}, now = Date.now()) {
  const ms = parseTimestamp(office.lastActivityAt);
  return !ms || now - ms > ACTIVITY_CONFIG.INACTIVE_ACTIVITY_DAYS * MS_DAY;
}

export function officeMatchesTab(office, tab) {
  const row = backfillOfficeRecord(office);
  switch (tab) {
    case "pending":
      return row.approvalStatus === "pending";
    case "approved":
      return row.approvalStatus === "approved" && row.accountStatus === "active" &&
        !["expired"].includes(row.subscriptionStatus) && row.licenseStatus !== "expired";
    case "suspended":
      return row.accountStatus === "suspended";
    case "expired":
      return row.subscriptionStatus === "expired" || row.licenseStatus === "expired";
    case "rejected":
      return row.approvalStatus === "rejected";
    case "active":
      return row.approvalStatus === "approved" && row.accountStatus === "active" && isOfficeRecentlyActive(row);
    case "inactive":
      return row.approvalStatus === "approved" && row.accountStatus === "active" && isOfficeInactive(row);
    case "license_expiring":
      return row.licenseStatus === "expiring";
    case "license_expired":
      return row.licenseStatus === "expired";
    case "subscription_expiring":
      return row.subscriptionStatus === "expiring";
    case "subscription_expired":
      return row.subscriptionStatus === "expired";
    case "all":
      return row.officeId !== "platform";
    default:
      return false;
  }
}

export function applicationMatchesTab(application, tab) {
  const status = safeText(application.status).toLowerCase();
  if (tab === "pending") return status === "pending";
  if (tab === "under_review") return status === "under_review";
  if (tab === "rejected") return status === "rejected";
  if (tab === "approved") return status === "approved";
  return false;
}

export function officeSearchMatch(office, search = "") {
  const q = safeText(search).toLowerCase();
  if (!q) return true;
  const hay = [
    office.officeName,
    office.brokerName,
    office.phone,
    office.licenseNumber,
    office.officeId
  ].map((v) => safeText(v).toLowerCase()).join(" ");
  return hay.includes(q);
}

export function sortOffices(rows, sortKey = "registered_desc") {
  const list = [...rows];
  const byMs = (value) => parseTimestamp(value) || 0;
  list.sort((a, b) => {
    switch (sortKey) {
      case "registered_asc":
        return byMs(a.registeredAt) - byMs(b.registeredAt);
      case "activity_desc":
        return byMs(b.lastActivityAt) - byMs(a.lastActivityAt);
      case "activity_asc":
        return byMs(a.lastActivityAt) - byMs(b.lastActivityAt);
      case "login_desc":
        return byMs(b.lastLoginAt) - byMs(a.lastLoginAt);
      case "subscription_expiry_asc":
        return byMs(a.subscriptionExpiresAt) - byMs(b.subscriptionExpiresAt);
      case "license_expiry_asc":
        return byMs(a.licenseExpiresAt) - byMs(b.licenseExpiresAt);
      case "registered_desc":
      default:
        return byMs(b.registeredAt) - byMs(a.registeredAt);
    }
  });
  return list;
}

export function buildOverviewCounts(offices = [], applications = [], now = Date.now()) {
  const officeRows = offices
    .map((row) => backfillOfficeRecord(row, now))
    .filter((row) => row.officeId && row.officeId !== "platform");
  const pendingApps = applications.filter((row) => {
    const status = safeText(row.status).toLowerCase();
    return status === "pending" || status === "under_review";
  });
  const rejectedApps = applications.filter((row) => safeText(row.status).toLowerCase() === "rejected");
  const active7d = officeRows.filter((row) => isOfficeRecentlyActive(row, now)).length;
  const inactive30d = officeRows.filter((row) => isOfficeInactive(row, now)).length;

  return {
    totalOffices: officeRows.length,
    pendingApprovals: pendingApps.length,
    approvedOffices: officeRows.filter((row) => row.approvalStatus === "approved").length,
    activeAccounts: officeRows.filter((row) => row.accountStatus === "active").length,
    suspendedOffices: officeRows.filter((row) => row.accountStatus === "suspended").length,
    rejectedApplications: rejectedApps.length,
    activeOffices: officeRows.filter((row) =>
      row.approvalStatus === "approved" && row.accountStatus === "active" && isOfficeRecentlyActive(row, now)).length,
    inactiveOffices: officeRows.filter((row) =>
      row.approvalStatus === "approved" && row.accountStatus === "active" && isOfficeInactive(row, now)).length,
    licensesExpiringSoon: officeRows.filter((row) => row.licenseStatus === "expiring").length,
    expiredLicenses: officeRows.filter((row) => row.licenseStatus === "expired").length,
    subscriptionsExpiringSoon: officeRows.filter((row) => row.subscriptionStatus === "expiring").length,
    expiredSubscriptions: officeRows.filter((row) => row.subscriptionStatus === "expired").length,
    activeLast7Days: active7d,
    inactiveLast30Days: inactive30d
  };
}

export function countRecentByCreatedAt(items, days, now = Date.now()) {
  const windowMs = days * MS_DAY;
  return items.filter((item) => {
    const ms = parseTimestamp(item.createdAt || item.updatedAt);
    return ms && now - ms <= windowMs;
  }).length;
}

export function buildActivitySummary({
  office = {},
  opportunities = [],
  operations = [],
  matches = [],
  publicIntake = [],
  activityEvents = [],
  now = Date.now()
} = {}) {
  const ownerSubs = publicIntake.filter((row) => safeText(row.kind).toLowerCase() === "owner");
  const clientSubs = publicIntake.filter((row) => safeText(row.kind).toLowerCase() === "client");
  const completedOps = operations.filter((row) => safeText(row.status).toLowerCase() === "completed");
  const activeOpportunities = opportunities.filter((row) => safeText(row.lifecycleStatus).toLowerCase() !== "deleted");
  const reviewedMatches = matches.filter((row) => safeText(row.status).toLowerCase() !== "active" || row.reviewedAt);

  const loginEvents = activityEvents.filter((row) => row.eventType === "login");
  const lastLoginEvent = loginEvents.sort((a, b) => parseTimestamp(b.occurredAt) - parseTimestamp(a.occurredAt))[0];

  const metrics = {
    opportunities7d: countRecentByCreatedAt(opportunities, 7, now),
    opportunities30d: countRecentByCreatedAt(opportunities, 30, now),
    operationsCompleted7d: countRecentByCreatedAt(completedOps, 7, now),
    operationsCompleted30d: countRecentByCreatedAt(completedOps, 30, now),
    matchReviews7d: countRecentByCreatedAt(reviewedMatches, 7, now),
    publicOwnerSubmissions7d: countRecentByCreatedAt(ownerSubs, 7, now),
    publicClientSubmissions7d: countRecentByCreatedAt(clientSubs, 7, now),
    lastActivityAt: office.lastActivityAt || lastLoginEvent?.occurredAt || null,
    lastLoginAt: office.lastLoginAt || lastLoginEvent?.occurredAt || null,
    loginCount7d: countRecentByCreatedAt(loginEvents, 7, now),
    loginCount30d: countRecentByCreatedAt(loginEvents, 30, now)
  };

  const hasHistorical =
  metrics.lastLoginAt ||
  metrics.lastActivityAt ||
  metrics.opportunities30d > 0 ||
  metrics.operationsCompleted30d > 0 ||
  metrics.publicOwnerSubmissions7d > 0 ||
  metrics.publicClientSubmissions7d > 0;

  return {
    ...metrics,
    activeOpportunities: activeOpportunities.length,
    matchReviewsPending: matches.filter((row) => safeText(row.status).toLowerCase() === "active").length,
    operationsCompletedTotal: completedOps.length,
    publicOwnerSubmissions30d: countRecentByCreatedAt(ownerSubs, 30, now),
    publicClientSubmissions30d: countRecentByCreatedAt(clientSubs, 30, now),
    activityLevel: classifyActivityLevel(metrics, now),
    historicalDataAvailable: Boolean(hasHistorical)
  };
}
