export const FOLLOWUP_TIMEZONE = "Asia/Riyadh";
export const FOLLOWUP_REMINDER_MINUTES = 60;
export const FOLLOWUP_DAY_BEFORE_MINUTES = 24 * 60;
export const FOLLOWUP_CLOCK_TOLERANCE_MS = 120000;

export const FOLLOWUP_STATUSES = Object.freeze({
  scheduled: "scheduled",
  reminder_due: "reminder_due",
  reminder_sent: "reminder_sent",
  completed: "completed",
  cancelled: "cancelled",
  overdue: "overdue"
});

export const RECIPIENT_MODES = Object.freeze({
  owner: "owner",
  client: "client",
  both: "both",
  current_party: "current_party"
});

export const RECIPIENT_MODE_LABELS = Object.freeze({
  owner: "المالك",
  client: "العميل",
  both: "المالك والعميل",
  current_party: "الطرف الحالي"
});

const ACTIVE_REMINDER_STATUSES = new Set([
  FOLLOWUP_STATUSES.scheduled,
  FOLLOWUP_STATUSES.reminder_due
]);

export function parseFollowUpInstant(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? date : null;
}

export function computeReminderAt(followUpAt, minutesBefore = FOLLOWUP_REMINDER_MINUTES) {
  const at = parseFollowUpInstant(followUpAt);
  if (!at) return null;
  return new Date(at.getTime() - minutesBefore * 60 * 1000);
}

export function computeFollowUpReminderSchedule(followUpAt, now = new Date()) {
  const at = parseFollowUpInstant(followUpAt);
  if (!at) {
    return {
      reminderAt24h: null,
      reminderAt1h: null,
      nextReminderAt: null,
      nextReminderKind: null
    };
  }
  const reminderAt24h = computeReminderAt(at, FOLLOWUP_DAY_BEFORE_MINUTES);
  const reminderAt1h = computeReminderAt(at, FOLLOWUP_REMINDER_MINUTES);
  const pending = [
    { kind: "24h", at: reminderAt24h },
    { kind: "1h", at: reminderAt1h }
  ].filter((row) => row.at && row.at.getTime() > now.getTime());
  pending.sort((a, b) => a.at.getTime() - b.at.getTime());
  const next = pending[0] || null;
  return {
    reminderAt24h: reminderAt24h ? reminderAt24h.toISOString() : null,
    reminderAt1h: reminderAt1h ? reminderAt1h.toISOString() : null,
    nextReminderAt: next ? next.at.toISOString() : null,
    nextReminderKind: next ? next.kind : null
  };
}

export function followUpReminderTitle(kind = "", followUp = {}) {
  const appointmentKind = String(followUp.appointmentKind || followUp.kind || followUp.nextActionType || "").toLowerCase();
  const isDayBefore = String(kind || "") === "24h";
  if (appointmentKind === "viewing" || appointmentKind.includes("معاينة")) {
    return isDayBefore ? "معاينة غدًا" : "معاينة بعد ساعة";
  }
  if (appointmentKind === "call" || appointmentKind.includes("اتصال")) {
    return isDayBefore ? "موعد اتصال غدًا" : "موعد اتصال بعد ساعة";
  }
  if (appointmentKind === "meeting" || appointmentKind.includes("اجتماع")) {
    return isDayBefore ? "اجتماع غدًا" : "اجتماع بعد ساعة";
  }
  return isDayBefore ? "موعد متابعة غدًا" : "موعد متابعة بعد ساعة";
}

export function getDueFollowUpReminder(followUp = {}, now = new Date()) {
  const status = String(followUp.status || "").trim();
  if (status === FOLLOWUP_STATUSES.completed || status === FOLLOWUP_STATUSES.cancelled) return null;
  const at = parseFollowUpInstant(followUp.at);
  if (!at || at.getTime() <= now.getTime()) return null;
  const sent = new Set(Array.isArray(followUp.remindersSent) ? followUp.remindersSent : []);
  const schedule = computeFollowUpReminderSchedule(followUp.at, now);
  const candidates = [
    { kind: "24h", at: parseFollowUpInstant(followUp.reminderAt24h || schedule.reminderAt24h) },
    { kind: "1h", at: parseFollowUpInstant(followUp.reminderAt1h || schedule.reminderAt1h) }
  ];
  for (const row of candidates) {
    if (!row.at || sent.has(row.kind)) continue;
    if (row.at.getTime() <= now.getTime()) return row;
  }
  return null;
}

export function advanceFollowUpAfterReminder(followUp = {}, kind = "", now = new Date()) {
  const sent = new Set(Array.isArray(followUp.remindersSent) ? followUp.remindersSent : []);
  if (kind) sent.add(kind);
  const schedule = computeFollowUpReminderSchedule(followUp.at, now);
  const pendingKinds = ["24h", "1h"].filter((entry) => !sent.has(entry));
  let nextReminderAt = null;
  let nextReminderKind = null;
  for (const entry of pendingKinds) {
    const at = parseFollowUpInstant(
      entry === "24h"
        ? (followUp.reminderAt24h || schedule.reminderAt24h)
        : (followUp.reminderAt1h || schedule.reminderAt1h)
    );
    if (at && at.getTime() > now.getTime()) {
      nextReminderAt = at.toISOString();
      nextReminderKind = entry;
      break;
    }
  }
  const allSent = pendingKinds.length === 0 || !nextReminderAt;
  return {
    ...followUp,
    remindersSent: [...sent],
    reminderAt: nextReminderAt || followUp.reminderAt || schedule.reminderAt1h || schedule.reminderAt24h,
    nextReminderKind: nextReminderKind,
    status: allSent ? FOLLOWUP_STATUSES.reminder_sent : FOLLOWUP_STATUSES.scheduled,
    updatedAt: now.toISOString()
  };
}

export function validateFutureFollowUpAt(followUpAt, now = new Date(), toleranceMs = FOLLOWUP_CLOCK_TOLERANCE_MS) {
  const at = parseFollowUpInstant(followUpAt);
  if (!at) return { ok: false, code: "followup_invalid", message: "موعد المتابعة غير صحيح" };
  const minAllowed = now.getTime() + toleranceMs;
  if (at.getTime() <= minAllowed) {
    return { ok: false, code: "followup_past", message: "اختر وقتًا قادمًا للمتابعة" };
  }
  return { ok: true, at };
}

export function isOwnerOpportunity(opportunity = {}) {
  const contactType = String(opportunity.contactType || "").toLowerCase();
  const recordType = String(opportunity.recordType || "").toLowerCase();
  const kind = String(opportunity.kind || "").toLowerCase();
  const opportunityKind = String(opportunity.opportunityKind || "").toUpperCase();
  const advertiserRole = String(opportunity.advertiserRole || "").toUpperCase();

  if (contactType === "owner" || recordType === "owner_offer" || kind === "owner" || kind === "owner_offer") {
    return true;
  }
  if (opportunityKind === "OFFER" || recordType === "owner") return true;
  if (advertiserRole === "OWNER") return true;
  return false;
}

export function defaultRecipientMode(opportunity = {}) {
  return isOwnerOpportunity(opportunity) ? RECIPIENT_MODES.owner : RECIPIENT_MODES.client;
}

export function resolveRecipientContext(opportunity = {}, match = null) {
  const isOwner = isOwnerOpportunity(opportunity);
  const sourceCollection = String(opportunity.sourceCollection || "").trim();
  const sourceRecordId = String(opportunity.sourceRecordId || "").trim();
  let ownerContactId = "";
  let clientContactId = "";

  if (isOwner) {
    ownerContactId = sourceCollection === "owners" && sourceRecordId ? sourceRecordId : "";
  } else {
    clientContactId = sourceCollection === "clients" && sourceRecordId ? sourceRecordId : "";
  }

  const matchOwnerId = String(match?.ownerOfferId || "").trim();
  const matchClientId = String(match?.clientRequestId || "").trim();
  if (matchOwnerId && matchClientId) {
    ownerContactId = matchOwnerId;
    clientContactId = matchClientId;
  }

  const modes = [];
  if (ownerContactId) modes.push(RECIPIENT_MODES.owner);
  if (clientContactId) modes.push(RECIPIENT_MODES.client);
  if (ownerContactId && clientContactId) modes.push(RECIPIENT_MODES.both);

  const defaultMode = defaultRecipientMode(opportunity);
  if (!modes.length) modes.push(defaultMode);

  return {
    ownerContactId,
    clientContactId,
    availableModes: modes,
    defaultMode,
    hasBothParties: Boolean(ownerContactId && clientContactId)
  };
}

export function normalizeRecipientMode(mode, context = {}) {
  const value = String(mode || "").trim();
  const available = Array.isArray(context.availableModes) ? context.availableModes : [];
  if (value === RECIPIENT_MODES.both && context.hasBothParties) return RECIPIENT_MODES.both;
  if (value === RECIPIENT_MODES.owner && available.includes(RECIPIENT_MODES.owner)) return RECIPIENT_MODES.owner;
  if (value === RECIPIENT_MODES.client && available.includes(RECIPIENT_MODES.client)) return RECIPIENT_MODES.client;
  if (available.includes(context.defaultMode)) return context.defaultMode;
  return available[0] || context.defaultMode || RECIPIENT_MODES.current_party;
}

export function deriveFollowUpStatus(followUp = {}, now = new Date()) {
  const status = String(followUp.status || "").trim();
  if (status === FOLLOWUP_STATUSES.completed || status === FOLLOWUP_STATUSES.cancelled) return status;
  const at = parseFollowUpInstant(followUp.at);
  if (!at) return FOLLOWUP_STATUSES.scheduled;
  if (at.getTime() <= now.getTime()) return FOLLOWUP_STATUSES.overdue;
  const reminderAt = parseFollowUpInstant(followUp.reminderAt);
  if (status === FOLLOWUP_STATUSES.reminder_sent) return FOLLOWUP_STATUSES.reminder_sent;
  if (reminderAt && reminderAt.getTime() <= now.getTime()) return FOLLOWUP_STATUSES.reminder_due;
  return FOLLOWUP_STATUSES.scheduled;
}

export function shouldSendFollowUpReminder(followUp = {}, now = new Date()) {
  return Boolean(getDueFollowUpReminder(followUp, now));
}

export function buildCanonicalFollowUp({
  at,
  recipientMode,
  ownerContactId = "",
  clientContactId = "",
  createdBy = "",
  existing = null,
  now = new Date()
}) {
  const instant = parseFollowUpInstant(at);
  if (!instant) throw new Error("followup_invalid");
  const schedule = computeFollowUpReminderSchedule(instant, now);
  const createdAt = existing?.createdAt || now.toISOString();
  const createdByValue = existing?.createdBy || createdBy || "";
  return {
    at: instant.toISOString(),
    timezone: FOLLOWUP_TIMEZONE,
    recipientMode,
    ownerContactId: ownerContactId || "",
    clientContactId: clientContactId || "",
    reminderAt: schedule.nextReminderAt || schedule.reminderAt1h || schedule.reminderAt24h,
    reminderAt24h: schedule.reminderAt24h,
    reminderAt1h: schedule.reminderAt1h,
    nextReminderKind: schedule.nextReminderKind,
    remindersSent: Array.isArray(existing?.remindersSent) ? existing.remindersSent : [],
    reminderMinutesBefore: FOLLOWUP_REMINDER_MINUTES,
    status: FOLLOWUP_STATUSES.scheduled,
    createdBy: createdByValue,
    createdAt,
    updatedBy: createdBy || createdByValue,
    updatedAt: now.toISOString()
  };
}

export function followUpReminderDedupKey(opportunityId, followUpAt, kind = "1h") {
  const at = parseFollowUpInstant(followUpAt);
  const bucket = at ? at.toISOString().replace(/[:.]/g, "") : "unknown";
  return `opp_followup_reminder_${opportunityId}_${bucket}_${kind}`;
}

export function followUpScheduleIdempotencyKey(opportunityId, at, recipientMode) {
  const instant = parseFollowUpInstant(at);
  return `${opportunityId}|${instant ? instant.toISOString() : ""}|${recipientMode || ""}`;
}

export function isSameScheduledFollowUp(existing = {}, at, recipientMode) {
  if (!existing || !existing.at) return false;
  const left = parseFollowUpInstant(existing.at);
  const right = parseFollowUpInstant(at);
  if (!left || !right) return false;
  return left.getTime() === right.getTime()
    && String(existing.recipientMode || "") === String(recipientMode || "")
    && ACTIVE_REMINDER_STATUSES.has(String(existing.status || ""));
}

export function formatFollowUpReminderBody(opportunity = {}, followUp = {}) {
  const district = String(opportunity.district || "").trim();
  const recipient = RECIPIENT_MODE_LABELS[followUp.recipientMode] || RECIPIENT_MODE_LABELS.owner;
  const at = parseFollowUpInstant(followUp.at);
  const timePart = at
    ? at.toLocaleTimeString("ar-SA", { timeZone: FOLLOWUP_TIMEZONE, hour: "numeric", minute: "2-digit" })
    : "";
  const parts = [
    district ? (district.startsWith("حي") ? district : `حي ${district}`) : "",
    timePart,
    recipient ? `مع ${recipient}` : ""
  ].filter(Boolean);
  return parts.join(" · ") || formatFollowUpTimeLabel(followUp.at);
}

export function formatFollowUpTimeLabel(value, now = new Date()) {
  const date = parseFollowUpInstant(value);
  if (!date) return "";
  const riyadhNow = new Date(now.toLocaleString("en-US", { timeZone: FOLLOWUP_TIMEZONE }));
  const riyadhDate = new Date(date.toLocaleString("en-US", { timeZone: FOLLOWUP_TIMEZONE }));
  const sameDay = riyadhNow.toDateString() === riyadhDate.toDateString();
  const tomorrow = new Date(riyadhNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = tomorrow.toDateString() === riyadhDate.toDateString();
  const timePart = date.toLocaleString("ar-SA", {
    timeZone: FOLLOWUP_TIMEZONE,
    hour: "numeric",
    minute: "2-digit"
  });
  if (sameDay) return timePart;
  if (isTomorrow) {
    const dayPart = date.toLocaleString("ar-SA", {
      timeZone: FOLLOWUP_TIMEZONE,
      weekday: "long",
      month: "long",
      day: "numeric"
    });
    return `غدًا — ${dayPart}، ${timePart}`;
  }
  const dayPart = date.toLocaleString("ar-SA", {
    timeZone: FOLLOWUP_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric"
  });
  return `${dayPart}، ${timePart}`;
}

export function formatFollowUpDayPrefix(value, now = new Date()) {
  const date = parseFollowUpInstant(value);
  if (!date) return "";
  const riyadhNow = new Date(now.toLocaleString("en-US", { timeZone: FOLLOWUP_TIMEZONE }));
  const riyadhDate = new Date(date.toLocaleString("en-US", { timeZone: FOLLOWUP_TIMEZONE }));
  if (riyadhNow.toDateString() === riyadhDate.toDateString()) return "اليوم";
  const tomorrow = new Date(riyadhNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (tomorrow.toDateString() === riyadhDate.toDateString()) return "غدًا";
  return "";
}

export function parseRiyadhDateTimeInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.includes("T")) {
    const iso = `${raw}:00+03:00`;
    const date = new Date(iso);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return parseFollowUpInstant(raw);
}

export function riyadhDateTimeInputValue(value) {
  const date = parseFollowUpInstant(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: FOLLOWUP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}`;
}

export function validateTodayRequiresFutureTime(followUpAt, now = new Date()) {
  const at = parseFollowUpInstant(followUpAt);
  if (!at) return { ok: false, message: "موعد المتابعة غير صحيح" };
  const riyadhNow = new Date(now.toLocaleString("en-US", { timeZone: FOLLOWUP_TIMEZONE }));
  const riyadhAt = new Date(at.toLocaleString("en-US", { timeZone: FOLLOWUP_TIMEZONE }));
  if (riyadhNow.toDateString() !== riyadhAt.toDateString()) return { ok: true };
  if (at.getTime() <= now.getTime() + FOLLOWUP_CLOCK_TOLERANCE_MS) {
    return { ok: false, message: "اختر وقتًا قادمًا اليوم" };
  }
  return { ok: true };
}
