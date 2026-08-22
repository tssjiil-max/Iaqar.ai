/**
 * Display-only daily report, current result, and next appointment for opportunity details.
 * Reads existing activity / follow-up / readiness — does not write or change domain rules.
 */

import {
  buildWorkspaceActivity,
  activeWorkspaceCooperationRequests
} from "./opportunity-workspace-domain.js";
import {
  evaluateMatchingReadiness,
  missingFieldLabelsArabic
} from "./opportunity-readiness-domain.js";
import {
  FOLLOWUP_TIMEZONE,
  RECIPIENT_MODE_LABELS,
  activeFollowUpFromRecord,
  defaultRecipientMode,
  parseFollowUpInstant
} from "./opportunity-followup-domain.js";
import { CONTACT_OUTCOME_LABELS } from "./opportunity-contact-outcome-domain.js";

const REPORT_TZ = FOLLOWUP_TIMEZONE;
const PENDING_COOP = new Set(["PENDING", "PENDING_APPROVAL"]);

function esc(text = "") {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function isOwnerRecord(record = {}) {
  const kind = String(record.opportunityKind || record.kind || record.recordType || "").toUpperCase();
  return record.contactType === "owner"
    || kind === "OWNER"
    || kind === "OWNER_OFFER"
    || kind === "OFFER";
}

export function riyadhDateKey(value) {
  const date = parseFollowUpInstant(value);
  if (!date) return "";
  return date.toLocaleDateString("en-CA", { timeZone: REPORT_TZ });
}

export function isSameRiyadhDay(value, now = new Date()) {
  const key = riyadhDateKey(value);
  return Boolean(key) && key === riyadhDateKey(now);
}

export function formatReportTime(value) {
  const date = parseFollowUpInstant(value);
  if (!date) return "";
  return date.toLocaleTimeString("ar-SA", {
    timeZone: REPORT_TZ,
    hour: "numeric",
    minute: "2-digit"
  });
}

export function formatAppointmentHeadline(value, _now = new Date()) {
  const date = parseFollowUpInstant(value);
  if (!date) return "";
  const weekday = date.toLocaleDateString("ar-SA", {
    timeZone: REPORT_TZ,
    weekday: "long"
  });
  const day = date.toLocaleDateString("ar-SA", {
    timeZone: REPORT_TZ,
    day: "numeric"
  });
  const month = date.toLocaleDateString("ar-SA", {
    timeZone: REPORT_TZ,
    month: "long"
  });
  const timePart = date.toLocaleTimeString("ar-SA", {
    timeZone: REPORT_TZ,
    hour: "numeric",
    minute: "2-digit"
  });
  return `${weekday}، ${day} ${month}، ${timePart}`;
}

export function joinArabicList(labels = []) {
  const items = (labels || []).map((row) => String(row || "").trim()).filter(Boolean);
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} و${items[1]}`;
  return `${items.slice(0, -1).join("، ")} و${items[items.length - 1]}`;
}

export function missingDisplayLabels(record = {}, readiness = {}) {
  const keys = readiness.matchingReadinessMissing || [];
  const owner = isOwnerRecord(record);
  return keys.map((key) => {
    if (key === "priceOrBudget") return owner ? "السعر" : "الميزانية";
    if (key === "contactPhone") return "رقم التواصل";
    return missingFieldLabelsArabic([key])[0] || key;
  }).filter(Boolean);
}

function partyFollowLabel(record = {}) {
  return isOwnerRecord(record) ? "متابعة المالك" : "متابعة العميل";
}

export function projectActivityToDailyReportRow(item = {}, record = {}, readiness = {}) {
  const text = String(item.text || "").trim();
  const time = formatReportTime(item.at);
  const missing = (readiness.matchingReadinessMissing || []).length > 0;

  if (text === "تمت إضافة الفرصة" || (record.importActivityText && text === record.importActivityText)) {
    return {
      time,
      action: "مراجعة البيانات",
      result: missing ? "✓ تم اكتشاف النواقص" : "✓ تم تسجيل الفرصة"
    };
  }
  if (text === "تم التواصل مع الجهة") {
    return { time, action: partyFollowLabel(record), result: "✓ تم التواصل" };
  }
  if (text.startsWith("نتيجة التواصل:")) {
    const raw = text.replace("نتيجة التواصل:", "").trim();
    const label = CONTACT_OUTCOME_LABELS[String(raw || "").toUpperCase()] || raw;
    return { time, action: partyFollowLabel(record), result: `✓ ${label}` };
  }
  if (text.startsWith("تم تحديد موعد متابعة")) {
    const rest = text.replace(/^تم تحديد موعد متابعة:?\s*/, "").trim();
    return { time, action: "تحديد موعد", result: rest ? `✓ ${rest}` : "✓ تم تحديد الموعد" };
  }
  if (text.startsWith("تعاون مع")) {
    const match = text.match(/^تعاون مع (.+):/);
    const office = (match?.[1] || "مكتب").trim();
    return { time, action: "إرسال الفرصة", result: `✓ أرسلت إلى ${office}` };
  }
  if (text === "تم إنهاء الفرصة") {
    return { time, action: "إنهاء الفرصة", result: "✓ تم إنهاء الفرصة" };
  }
  return { time, action: "إجراء", result: text ? `✓ ${text}` : "—" };
}

export function buildDailyReportRows(record = {}, cooperationRequests = [], now = new Date(), readiness = {}) {
  const resolved = readiness.matchingReadiness ? readiness : evaluateMatchingReadiness(record);
  return buildWorkspaceActivity(record, cooperationRequests)
    .filter((item) => isSameRiyadhDay(item.at, now))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .map((item) => projectActivityToDailyReportRow(item, record, resolved));
}

export function buildCurrentResultText(record = {}, readinessInput = {}, cooperationRequests = []) {
  const readiness = readinessInput.matchingReadiness
    ? readinessInput
    : evaluateMatchingReadiness(record);
  const missing = missingDisplayLabels(record, readiness);
  if (missing.length) {
    return `بانتظار استكمال ${joinArabicList(missing)}`;
  }

  const pendingCoop = activeWorkspaceCooperationRequests(cooperationRequests)
    .filter((row) => PENDING_COOP.has(String(row.status || "").toUpperCase()));
  if (pendingCoop.length === 1) return "أرسلت لمكتب وبانتظار الرد";
  if (pendingCoop.length > 1) return `أرسلت لـ${pendingCoop.length} مكاتب وبانتظار الرد`;

  const follow = activeFollowUpFromRecord(record);
  if (follow?.at && follow.confirmed !== true) {
    const party = RECIPIENT_MODE_LABELS[follow.recipientMode] || (isOwnerRecord(record) ? "المالك" : "العميل");
    return `بانتظار تأكيد ${party}`;
  }

  const outcome = String(record.lastContactOutcome || "").toUpperCase();
  if (outcome === "NO_RESPONSE") return "بانتظار رد الجهة";
  if (outcome === "INTERESTED") return "الجهة مهتمة وبانتظار المتابعة";
  if (outcome === "AGREED") return "تم الاتفاق وبانتظار إتمام الصفقة";

  if (String(record.lifecycleStatus || "").toUpperCase() === "MATCHED") return "تمت المطابقة";
  if (readiness.isReadyForMatching) return "جاهزة للمطابقة";
  return "جاري متابعة الفرصة";
}

export function resolveNextAppointment(record = {}, now = new Date()) {
  const nowMs = now.getTime();
  const candidates = [];
  const follow = activeFollowUpFromRecord(record);
  const followAt = parseFollowUpInstant(follow?.at);
  if (followAt && followAt.getTime() >= nowMs - 60000) {
    candidates.push({
      at: followAt,
      kind: "followup",
      kindLabel: "متابعة",
      recipientMode: follow.recipientMode || defaultRecipientMode(record),
      confirmed: follow.confirmed === true
    });
  }
  const viewingAt = parseFollowUpInstant(record.viewingAt || record.appointmentAt);
  if (viewingAt && viewingAt.getTime() >= nowMs - 60000) {
    const sameFollow = followAt && Math.abs(viewingAt.getTime() - followAt.getTime()) < 60000;
    if (sameFollow) {
      const existing = candidates.find((row) => row.kind === "followup");
      if (existing) {
        existing.kind = "viewing";
        existing.kindLabel = "معاينة العقار";
      }
    } else {
      candidates.push({
        at: viewingAt,
        kind: "viewing",
        kindLabel: "معاينة العقار",
        recipientMode: defaultRecipientMode(record),
        confirmed: false
      });
    }
  }
  candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
  return candidates[0] || null;
}

function confirmationLine(appointment, record = {}) {
  const party = RECIPIENT_MODE_LABELS[appointment.recipientMode]
    || (isOwnerRecord(record) ? "المالك" : "العميل");
  return appointment.confirmed ? `${party}: تم التأكيد` : `${party}: بانتظار التأكيد`;
}

export function buildDailyReportHtml(record = {}, options = {}) {
  const now = options.now || new Date();
  const cooperationRequests = options.cooperationRequests || [];
  const readiness = options.readiness || evaluateMatchingReadiness(record);
  const rows = buildDailyReportRows(record, cooperationRequests, now, readiness);
  const result = buildCurrentResultText(record, readiness, cooperationRequests);
  const body = rows.length
    ? `<div class="opp-details-report-table" role="table" aria-label="إجراءات اليوم">
        <div class="opp-details-report-head" role="row">
          <span role="columnheader">الوقت</span>
          <span role="columnheader">الإجراء</span>
          <span role="columnheader">النتيجة</span>
        </div>
        ${rows.map((row) => `
          <div class="opp-details-report-row" role="row">
            <span class="opp-details-report-time" role="cell">${esc(row.time)}</span>
            <span class="opp-details-report-action" role="cell">${esc(row.action)}</span>
            <span class="opp-details-report-result" role="cell">${esc(row.result)}</span>
          </div>`).join("")}
      </div>`
    : `<p class="opp-details-report-empty">لا توجد إجراءات مسجلة اليوم</p>`;

  return `
    <section class="opp-details-card opp-details-report-card" aria-label="تقرير اليوم">
      <header class="opp-details-data-title">
        <svg class="icon opp-details-data-title-icon" aria-hidden="true"><use href="#i-clipboard-list"/></svg>
        <span class="opp-details-data-title-text">تقرير اليوم</span>
      </header>
      ${body}
      <p class="opp-details-current-result">
        <strong>النتيجة الحالية:</strong>
        <span>${esc(result)}</span>
      </p>
    </section>`;
}

export function buildNextAppointmentHtml(record = {}, options = {}) {
  const now = options.now || new Date();
  const appointment = resolveNextAppointment(record, now);
  if (!appointment) return "";
  const when = formatAppointmentHeadline(appointment.at, now);
  return `
    <section class="opp-details-card opp-details-appointment-card" aria-label="الموعد القادم">
      <header class="opp-details-data-title">
        <svg class="icon opp-details-data-title-icon" aria-hidden="true"><use href="#i-user-clock"/></svg>
        <span class="opp-details-data-title-text">الموعد القادم</span>
      </header>
      <div class="opp-details-appointment-body">
        <p class="opp-details-appointment-when">${esc(when)}</p>
        <div class="opp-details-appointment-meta">
          <span class="opp-details-appointment-kind">${esc(appointment.kindLabel)}</span>
          <span class="opp-details-appointment-confirm">${esc(confirmationLine(appointment, record))}</span>
        </div>
      </div>
    </section>`;
}
