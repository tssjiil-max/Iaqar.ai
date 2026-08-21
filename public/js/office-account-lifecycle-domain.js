/**
 * Office account pause / delete-reason helpers.
 * Uses the existing offices.accountStatus field (active | paused | suspended).
 * Does not introduce a new collection or status architecture.
 */

export const OFFICE_ACCOUNT_ACTIVE = "active";
export const OFFICE_ACCOUNT_PAUSED = "paused";

export const OFFICE_PAUSE_REASONS = Object.freeze([
  { code: "vacation", label: "إجازة" },
  { code: "temporary_break", label: "توقف مؤقت عن العمل" },
  { code: "busy", label: "انشغال" },
  { code: "personal_reason", label: "ظرف شخصي" },
  { code: "office_reorganization", label: "إعادة تنظيم المكتب" },
  { code: "team_unavailable", label: "عدم توفر الفريق" },
  { code: "not_accepting_now", label: "لا أريد استقبال فرص حاليًا" },
  { code: "other", label: "سبب آخر" }
]);

export const OFFICE_DELETE_REASONS = Object.freeze([
  { code: "too_difficult", label: "صعوبة استخدام المنصة" },
  { code: "too_many_steps", label: "الخطوات كثيرة أو معقدة" },
  { code: "slow", label: "الموقع بطيء" },
  { code: "technical_issues", label: "أخطاء أو مشاكل تقنية" },
  { code: "poor_matching", label: "المطابقة غير مفيدة" },
  { code: "workflow_not_fit", label: "إدارة الفرص لا تناسب طريقة عملي" },
  { code: "cooperation_not_useful", label: "التعاون مع المكاتب غير مفيد" },
  { code: "whatsapp_issues", label: "مشاكل في واتساب أو التواصل" },
  { code: "low_network_value", label: "لا توجد فرص أو مكاتب كافية" },
  { code: "low_usage", label: "لا أستخدم المنصة بشكل كافٍ", suggestPause: true },
  { code: "moved_to_competitor", label: "انتقلت إلى منصة أخرى" },
  { code: "pricing", label: "السعر أو الاشتراك غير مناسب" },
  { code: "privacy_concern", label: "مخاوف تتعلق بالخصوصية" },
  { code: "left_real_estate", label: "توقفت نهائيًا عن العمل العقاري" },
  { code: "trial_only", label: "أنشأت المكتب للتجربة فقط" },
  { code: "duplicate_office", label: "لدي مكتب آخر" },
  { code: "other", label: "سبب آخر" }
]);

export const OFFICE_DELETE_CONFIRM_PHRASE = "حذف المكتب";
export const OFFICE_FULL_DELETE_UNAVAILABLE_MESSAGE =
  "الحذف الكامل يحتاج آلية Backend آمنة ولم يتم تنفيذ حذف ناقص.";

const PAUSE_NOTE_MAX = 200;
const DELETE_NOTE_MAX = 300;

export function isOfficePaused(office = {}) {
  return String(office.accountStatus || "").trim().toLowerCase() === OFFICE_ACCOUNT_PAUSED;
}

export function isOfficeAcceptingNewWork(office = {}) {
  return !isOfficePaused(office);
}

export function pauseReasonByCode(code = "") {
  const key = String(code || "").trim();
  return OFFICE_PAUSE_REASONS.find((row) => row.code === key) || null;
}

export function deleteReasonByCode(code = "") {
  const key = String(code || "").trim();
  return OFFICE_DELETE_REASONS.find((row) => row.code === key) || null;
}

export function sanitizeReasonNote(value, max = DELETE_NOTE_MAX) {
  return String(value == null ? "" : value)
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "")
    .trim()
    .slice(0, Math.max(0, Number(max) || DELETE_NOTE_MAX));
}

export function validatePauseReason({ reasonCode = "", otherNote = "" } = {}) {
  const reason = pauseReasonByCode(reasonCode);
  if (!reason) return { ok: false, message: "اختر سبب الإيقاف." };
  let note = "";
  if (reason.code === "other") {
    note = sanitizeReasonNote(otherNote, PAUSE_NOTE_MAX);
    if (!note) return { ok: false, message: "اكتب السبب." };
  }
  return { ok: true, reasonCode: reason.code, note };
}

export function parseOptionalReturnDate(value, { unspecified = false } = {}) {
  if (unspecified) return { ok: true, iso: "" };
  const raw = String(value || "").trim();
  if (!raw) return { ok: true, iso: "" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { ok: false, message: "تاريخ العودة غير صالح." };
  }
  const ms = Date.parse(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return { ok: false, message: "تاريخ العودة غير صالح." };
  return { ok: true, iso: raw };
}

export function buildOfficePausePatch({
  reasonCode = "",
  otherNote = "",
  expectedReturnAt = "",
  unspecifiedReturn = false,
  nowIso = new Date().toISOString(),
  actorUid = ""
} = {}) {
  const reason = validatePauseReason({ reasonCode, otherNote });
  if (!reason.ok) return reason;
  const date = parseOptionalReturnDate(expectedReturnAt, { unspecified: unspecifiedReturn });
  if (!date.ok) return date;
  return {
    ok: true,
    patch: {
      accountStatus: OFFICE_ACCOUNT_PAUSED,
      pauseReasonCode: reason.reasonCode,
      pauseReasonNote: reason.note || "",
      pausedAt: nowIso,
      pauseExpectedReturnAt: date.iso || "",
      pausedBy: String(actorUid || "").slice(0, 120)
    }
  };
}

export function buildOfficeResumePatch() {
  return {
    accountStatus: OFFICE_ACCOUNT_ACTIVE,
    pauseReasonCode: "",
    pauseReasonNote: "",
    pausedAt: "",
    pauseExpectedReturnAt: "",
    pausedBy: ""
  };
}

export function shouldSuggestPauseInsteadOfDelete(reasonCode = "", otherNote = "") {
  const reason = deleteReasonByCode(reasonCode);
  if (reason?.suggestPause) return true;
  const blob = `${reason?.label || ""} ${sanitizeReasonNote(otherNote, DELETE_NOTE_MAX)}`;
  return /إجازة|انشغال|ظرف|توقف مؤقت|لا أستخدم/.test(blob);
}

export function validateOfficeDeleteReason({ reasonCode = "", otherNote = "" } = {}) {
  const reason = deleteReasonByCode(reasonCode);
  if (!reason) return { ok: false, message: "اختر سبب الحذف." };
  let note = "";
  if (reason.code === "other") {
    note = sanitizeReasonNote(otherNote, DELETE_NOTE_MAX);
    if (!note) return { ok: false, message: "اكتب السبب." };
  }
  return {
    ok: true,
    reasonCode: reason.code,
    note,
    suggestPause: shouldSuggestPauseInsteadOfDelete(reason.code, note)
  };
}

export function isOfficeDeleteConfirmPhrase(value = "") {
  return String(value || "").trim() === OFFICE_DELETE_CONFIRM_PHRASE;
}

export function officeDeleteIsFullySupported() {
  return false;
}
