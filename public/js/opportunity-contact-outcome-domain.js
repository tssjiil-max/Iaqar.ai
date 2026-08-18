/**
 * Contact outcome selection and save validation — workspace UI (pure, no DOM).
 */

import {
  buildQuickFollowUpDateTimeInput,
  formatFollowUpAppointmentLine,
  parseFollowUpForSave,
  validateTodayRequiresFutureTime
} from "./opportunity-followup-domain.js";

export const CONTACT_OUTCOME_LABELS = Object.freeze({
  NO_RESPONSE: "لم يرد",
  INTERESTED: "مهتم",
  REFUSED: "غير مهتم",
  FOLLOW_UP: "طلب متابعة",
  AGREED: "تم الاتفاق"
});

export const CONTACT_OUTCOME_ORDER = Object.freeze([
  "NO_RESPONSE",
  "INTERESTED",
  "REFUSED",
  "FOLLOW_UP",
  "AGREED"
]);

export const REFUSAL_REASON_OPTIONS = Object.freeze([
  { key: "price", label: "السعر" },
  { key: "location", label: "الموقع" },
  { key: "specs", label: "المواصفات" },
  { key: "found_alternative", label: "وجد بديلًا" },
  { key: "other", label: "سبب آخر" }
]);

export function refusalReasonLabel(key = "") {
  const row = REFUSAL_REASON_OPTIONS.find((item) => item.key === key);
  return row?.label || "";
}

export function defaultContactRetryInput(now = new Date()) {
  return buildQuickFollowUpDateTimeInput(1, now);
}

export function defaultContactFollowUpInput(now = new Date()) {
  return buildQuickFollowUpDateTimeInput(1, now);
}

export function parseContactOutcomeFollowUp(value) {
  const parsed = parseFollowUpForSave(value);
  if (!parsed) return { ok: false, message: "موعد المتابعة غير صحيح" };
  const todayCheck = validateTodayRequiresFutureTime(parsed);
  if (!todayCheck.ok) return { ok: false, message: todayCheck.message };
  return { ok: true, at: parsed, iso: parsed.toISOString() };
}

/**
 * @returns {{ ok: boolean, message?: string, followUpAt?: string, note?: string, refusalReason?: string }}
 */
export function validateContactOutcomeSave(outcome = "", data = {}, now = new Date()) {
  const key = String(outcome || "").toUpperCase();
  if (!CONTACT_OUTCOME_ORDER.includes(key)) {
    return { ok: false, message: "نتيجة التواصل غير صحيحة" };
  }
  const note = String(data.note || "").trim().slice(0, 200);

  if (key === "NO_RESPONSE" || key === "FOLLOW_UP") {
    const follow = parseContactOutcomeFollowUp(data.followUpAt || "");
    if (!follow.ok) return follow;
    return { ok: true, followUpAt: follow.iso, note };
  }

  if (key === "INTERESTED") {
    if (data.followUpAt) {
      const follow = parseContactOutcomeFollowUp(data.followUpAt);
      if (!follow.ok) return follow;
      return { ok: true, followUpAt: follow.iso, note };
    }
    return { ok: true, note };
  }

  if (key === "REFUSED") {
    const reason = String(data.refusalReason || "").trim();
    if (!reason) return { ok: false, message: "اختر سبب عدم الاهتمام" };
    const reasonLabel = refusalReasonLabel(reason);
    const composedNote = note || reasonLabel;
    return { ok: true, refusalReason: reason, note: composedNote };
  }

  if (key === "AGREED") {
    return { ok: true, note };
  }

  return { ok: false, message: "نتيجة التواصل غير صحيحة" };
}

export function contactOutcomeActivityText(outcome = "", details = {}) {
  const label = CONTACT_OUTCOME_LABELS[String(outcome || "").toUpperCase()] || "";
  if (!label) return "تم تسجيل نتيجة التواصل";
  let text = `نتيجة التواصل: ${label}`;
  if (details.followUpLabel) {
    text += ` — ${details.followUpLabel}`;
  }
  if (details.refusalReasonLabel) {
    text += ` — ${details.refusalReasonLabel}`;
  }
  if (details.note) {
    text += ` — ${details.note}`;
  }
  return text;
}

export function shouldShowContactOutcomePanel(record = {}) {
  const contactAttempted = Boolean(
    record.lastWhatsAppOpenedAt || record.lastCallOpenedAt || record.lastContactAt
  );
  const raw = String(record.lastContactOutcome || record.advertiserContactStatus || "").toUpperCase();
  const recorded = new Set([
    "NO_RESPONSE",
    "INTERESTED",
    "REFUSED",
    "FOLLOW_UP",
    "AGREED",
    "CALL_LATER",
    "RESPONDED"
  ]);
  return contactAttempted && !recorded.has(raw);
}

export function buildContactOutcomeActionKind(outcome = "") {
  const key = String(outcome || "").toUpperCase();
  switch (key) {
    case "NO_RESPONSE":
      return "retry_schedule";
    case "INTERESTED":
      return "interested_actions";
    case "REFUSED":
      return "refusal_reasons";
    case "FOLLOW_UP":
      return "followup_schedule";
    case "AGREED":
      return "agreement_deal";
    default:
      return "";
  }
}

export function followUpLabelFromIso(iso = "") {
  if (!iso) return "";
  return formatFollowUpAppointmentLine(iso);
}
