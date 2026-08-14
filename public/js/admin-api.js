export function resolveWorkerBase() {
  if (window.IAQAR && typeof window.IAQAR.resolveWorkerBase === "function") {
    return window.IAQAR.resolveWorkerBase();
  }
  try {
    const host = String(window.location.hostname || "").toLowerCase();
    if (host.includes("iaqar-ai-staging") || host.includes("--staging") || host.startsWith("staging.")) {
      return "https://iaqar-intake-staging.iaqar-ai.workers.dev";
    }
  } catch (_) { /* ignore */ }
  return "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
}

export class AdminApi {
  constructor(getToken) {
    this.getToken = getToken;
  }

  async request(path, options = {}) {
    const token = await this.getToken();
    const response = await fetch(`${resolveWorkerBase()}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || "تعذر تنفيذ الطلب");
      error.code = payload.error || "request_failed";
      throw error;
    }
    return payload;
  }

  overview() { return this.request("/admin/overview"); }
  applications(params = {}) {
    const query = new URLSearchParams(params);
    return this.request(`/admin/applications?${query.toString()}`);
  }
  offices(params = {}) {
    const query = new URLSearchParams(params);
    return this.request(`/admin/offices?${query.toString()}`);
  }
  officeDetail(officeId) {
    return this.request(`/admin/office?officeId=${encodeURIComponent(officeId)}`);
  }
  officeActivity(officeId) {
    return this.request(`/admin/office/activity?officeId=${encodeURIComponent(officeId)}`);
  }
  auditLog(params = {}) {
    const query = new URLSearchParams(params);
    return this.request(`/admin/audit-log?${query.toString()}`);
  }
  approveApplication(applicationId, officeId) {
    return this.request("/admin/broker-applications/action", {
      method: "POST",
      body: JSON.stringify({ applicationId, action: "approve", officeId })
    });
  }
  rejectApplication(applicationId, reason = "") {
    return this.request("/admin/broker-applications/action", {
      method: "POST",
      body: JSON.stringify({ applicationId, action: "reject", reason })
    });
  }
  reviewApplication(applicationId, reason = "") {
    return this.request("/admin/broker-applications/action", {
      method: "POST",
      body: JSON.stringify({ applicationId, action: "under_review", reason })
    });
  }
  suspendOffice(officeId, reason) {
    return this.request("/admin/office/suspend", {
      method: "POST",
      body: JSON.stringify({ officeId, reason })
    });
  }
  reactivateOffice(officeId, reason = "") {
    return this.request("/admin/office/reactivate", {
      method: "POST",
      body: JSON.stringify({ officeId, reason })
    });
  }
  updateSubscription(officeId, subscriptionStatus, subscriptionExpiresAt) {
    return this.request("/admin/office/subscription", {
      method: "POST",
      body: JSON.stringify({ officeId, subscriptionStatus, subscriptionExpiresAt })
    });
  }
  updateLicense(officeId, licenseExpiresAt) {
    return this.request("/admin/office/license", {
      method: "POST",
      body: JSON.stringify({ officeId, licenseExpiresAt })
    });
  }
  addNote(officeId, note) {
    return this.request("/admin/office/note", {
      method: "POST",
      body: JSON.stringify({ officeId, note })
    });
  }
}

export const APPLICATION_TABS = [
  { id: "pending", label: "بانتظار المراجعة" },
  { id: "under_review", label: "قيد المراجعة" },
  { id: "approved", label: "المعتمدة" },
  { id: "rejected", label: "المرفوضة" }
];

export const OFFICE_TABS = [
  { id: "all", label: "كل المكاتب" },
  { id: "approved", label: "المعتمدة" },
  { id: "pending", label: "معلّقة" },
  { id: "suspended", label: "الموقوفة" },
  { id: "rejected", label: "المرفوضة" },
  { id: "active", label: "النشطة" },
  { id: "inactive", label: "غير النشطة" },
  { id: "license_expiring", label: "ترخيص ينتهي قريبًا" },
  { id: "license_expired", label: "ترخيص منتهي" },
  { id: "subscription_expiring", label: "اشتراك ينتهي قريبًا" },
  { id: "subscription_expired", label: "اشتراك منتهي" },
  { id: "expired", label: "منتهية" }
];

export const MAIN_VIEWS = [
  { id: "overview", label: "نظرة عامة" },
  { id: "applications", label: "طلبات التسجيل" },
  { id: "offices", label: "المكاتب" },
  { id: "activity", label: "النشاط" },
  { id: "billing", label: "التراخيص والاشتراكات" },
  { id: "audit", label: "سجل الإدارة" }
];

export function formatDate(value) {
  if (!value) return "—";
  const ms = typeof value === "object" && value.seconds ? value.seconds * 1000 : Date.parse(value);
  if (!Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
}

export function suggestOfficeId(officeName, applicationId = "") {
  const base = String(officeName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (base.length >= 4) return base;
  return String(applicationId || "").replace(/^broker_/, "office-").slice(0, 40);
}
