/**
 * صلاحية العروض والطلبات والتأكد من التوفر — pure rules shared by the app, the Worker and the
 * matching engine. Three separate things, stored separately:
 *   • urgency          (validityUrgent)     — only the follow-up priority;
 *   • how long it runs (validityDuration…)  — what the person chose, ending at the END of the Riyadh day;
 *   • availability     (availabilityStatus, availabilityConfirmedAt …) — is it still for sale/rent, is the client still looking.
 * A future expiry date is never proof that a property is still available.
 *
 * Records saved before this existed carry none of these fields: they are LEGACY — not stopped,
 * not given invented dates; they stay in matching exactly as before until someone sets a duration
 * or confirms them. Nothing here deletes anything.
 */

export const DURATION = Object.freeze({ WEEK: "WEEK", MONTH: "MONTH", QUARTER: "QUARTER", CUSTOM: "CUSTOM", UNTIL_CANCELLED: "UNTIL_CANCELLED" });
export const DURATION_DAYS = Object.freeze({ WEEK: 7, MONTH: 30, QUARTER: 90 });
export const DURATION_OPTIONS = Object.freeze([
  { id: DURATION.WEEK, label: "أسبوع" },
  { id: DURATION.MONTH, label: "شهر" },
  { id: DURATION.QUARTER, label: "ثلاثة أشهر" },
  { id: DURATION.CUSTOM, label: "أحدد تاريخ الانتهاء" },
  { id: DURATION.UNTIL_CANCELLED, label: "حتى ألغيه (مع تأكيد دوري)" }
]);
export const DEFAULT_DURATION = DURATION.MONTH;
/** «حتى ألغيه»: availability is confirmed again every 30 days. */
export const PERIODIC_CHECK_DAYS = 30;
/** An offer's availability older than this is asked again before the bot tells a client about it. */
export const AVAILABILITY_FRESH_DAYS = 14;
export const REMIND_BEFORE_DAYS = 3;
export const VALIDITY_HINT = "بنذكرك قبل انتهاء المدة، وتقدر تجدد عرضك أو طلبك بسهولة.";

export const AVAILABILITY = Object.freeze({ AVAILABLE: "AVAILABLE", SOLD: "SOLD", RENTED: "RENTED", FOUND: "FOUND", UNAVAILABLE: "UNAVAILABLE" });
export const UNAVAILABLE_SET = new Set(["SOLD", "RENTED", "FOUND", "UNAVAILABLE"]);

export const STATE = Object.freeze({
  ACTIVE: "ACTIVE", NEEDS_CONFIRMATION: "NEEDS_CONFIRMATION", PAUSED: "PAUSED", EXPIRED: "EXPIRED",
  UNAVAILABLE: "UNAVAILABLE", ARCHIVED: "ARCHIVED", LEGACY: "LEGACY"
});
export const STATE_LABEL = Object.freeze({
  ACTIVE: "نشط ومؤكد", NEEDS_CONFIRMATION: "يحتاج تأكيدًا", PAUSED: "موقوف مؤقتًا", EXPIRED: "منتهي الصلاحية",
  UNAVAILABLE: "غير متاح", ARCHIVED: "مؤرشف", LEGACY: "بدون مدة محددة"
});
export const AVAILABILITY_LABEL = Object.freeze({ AVAILABLE: "متاح", SOLD: "تم البيع", RENTED: "تم التأجير", FOUND: "وجد العقار المناسب", UNAVAILABLE: "غير متاح" });

const DAY = 86400000;
const toDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value?.toDate ? value.toDate() : value);
  return Number.isFinite(d.getTime()) ? d : null;
};

/** End of a Riyadh calendar day (23:59:59.999 UTC+3) for the day `date` falls on in Riyadh. */
export function riyadhDayEnd(date) {
  const riyadh = new Date(date.getTime() + 3 * 3600000);
  return new Date(Date.UTC(riyadh.getUTCFullYear(), riyadh.getUTCMonth(), riyadh.getUTCDate(), 23, 59, 59, 999) - 3 * 3600000);
}

/** «YYYY-MM-DD» typed by the person → the end of that Riyadh day, or null when invalid or not in the future. */
export function customExpiry(dayText, now = new Date()) {
  const m = String(dayText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // A real calendar day only (no «month 13» rolling over).
  if (day.getUTCFullYear() !== Number(m[1]) || day.getUTCMonth() !== Number(m[2]) - 1 || day.getUTCDate() !== Number(m[3])) return null;
  const end = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999) - 3 * 3600000);
  if (!Number.isFinite(end.getTime()) || end.getTime() <= now.getTime()) return null;
  if (end.getTime() - now.getTime() > 400 * DAY) return null;
  return end;
}

/**
 * The person's choice → stored fields. `chosen` = the person picked it (false = the announced default).
 * Returns { ok, error, fields }.
 */
export function validityFields({ duration = DEFAULT_DURATION, customDate = "", urgent = false, chosen = true, now = new Date(), confirmedBy = "" } = {}) {
  const id = Object.values(DURATION).includes(String(duration)) ? String(duration) : DEFAULT_DURATION;
  let expiresAt = null;
  let nextCheckAt = null;
  if (id === DURATION.CUSTOM) {
    expiresAt = customExpiry(customDate, now);
    if (!expiresAt) return { ok: false, error: "اختر تاريخًا صالحًا في المستقبل (خلال سنة)." };
  } else if (id === DURATION.UNTIL_CANCELLED) {
    nextCheckAt = riyadhDayEnd(new Date(now.getTime() + PERIODIC_CHECK_DAYS * DAY));
  } else {
    expiresAt = riyadhDayEnd(new Date(now.getTime() + DURATION_DAYS[id] * DAY));
  }
  return {
    ok: true,
    fields: {
      validityDuration: id,
      validityDurationChosen: chosen === true,
      validityUrgent: urgent === true,
      validityStartedAt: now.toISOString(),
      validityExpiresAt: expiresAt ? expiresAt.toISOString() : null,
      validityNextCheckAt: nextCheckAt ? nextCheckAt.toISOString() : null,
      availabilityStatus: AVAILABILITY.AVAILABLE,
      availabilityConfirmedAt: now.toISOString(),
      availabilityConfirmedBy: String(confirmedBy || "").slice(0, 160),
      validityReason: ""
    }
  };
}

/** Renewing keeps the same record and the same choice (or a newly chosen one). */
export function renewFields(record = {}, { duration = "", customDate = "", now = new Date(), confirmedBy = "" } = {}) {
  return validityFields({
    duration: duration || record.validityDuration || DEFAULT_DURATION,
    customDate, urgent: record.validityUrgent === true, chosen: true, now, confirmedBy
  });
}

export function hasValidity(record = {}) {
  return Boolean(record.validityDuration);
}

/** Where a record stands now. */
export function validityState(record = {}, now = new Date()) {
  const life = String(record.lifecycleStatus || "ACTIVE").toUpperCase();
  if (life === "ARCHIVED") return String(record.archiveKind || "").toUpperCase() === "PAUSED" ? STATE.PAUSED : STATE.ARCHIVED;
  if (UNAVAILABLE_SET.has(String(record.availabilityStatus || "").toUpperCase())) return STATE.UNAVAILABLE;
  if (!hasValidity(record)) return STATE.LEGACY;
  const expires = toDate(record.validityExpiresAt);
  if (expires && now.getTime() > expires.getTime()) return STATE.EXPIRED;
  const check = toDate(record.validityNextCheckAt);
  if (check && now.getTime() > check.getTime()) return STATE.NEEDS_CONFIRMATION;
  return STATE.ACTIVE;
}

/** The server-side rule the matching engine applies before any NEW match: only ACTIVE or LEGACY records take part. */
export function isOpenForMatching(record = {}, now = new Date()) {
  const state = validityState(record, now);
  return state === STATE.ACTIVE || state === STATE.LEGACY;
}

/** Before the office manager tells a client about an offer: is its availability confirmed recently? */
export function availabilityFresh(record = {}, now = new Date()) {
  const at = toDate(record.availabilityConfirmedAt);
  return Boolean(at) && now.getTime() - at.getTime() <= AVAILABILITY_FRESH_DAYS * DAY;
}

/** What the sweep should do for one record now (one step at a time; idempotent with `validityAskedFor`). */
export function nextValidityStep(record = {}, now = new Date()) {
  const state = validityState(record, now);
  if (![STATE.ACTIVE, STATE.EXPIRED, STATE.NEEDS_CONFIRMATION].includes(state) || !hasValidity(record)) return null;
  const expires = toDate(record.validityExpiresAt);
  const asked = String(record.validityAskedFor || "");
  if (state === STATE.ACTIVE && expires) {
    const days = (expires.getTime() - now.getTime()) / DAY;
    const totalDays = (expires.getTime() - (toDate(record.validityStartedAt)?.getTime() || now.getTime())) / DAY;
    // A reminder 3 days before, when the duration is long enough for it to make sense.
    if (days <= REMIND_BEFORE_DAYS && totalDays > REMIND_BEFORE_DAYS + 1) {
      const key = `pre:${expires.toISOString()}`;
      return asked === key ? null : { kind: "REMIND", key };
    }
    return null;
  }
  if (state === STATE.EXPIRED) {
    const key = `exp:${expires.toISOString()}`;
    return asked === key ? null : { kind: "CONFIRM_EXPIRED", key };
  }
  if (state === STATE.NEEDS_CONFIRMATION) {
    const key = `chk:${String(record.validityNextCheckAt || "")}`;
    return asked === key ? null : { kind: "CONFIRM_PERIODIC", key };
  }
  return null;
}

/** Short facts for the record page — from the record's own fields only. */
export function validityView(record = {}, now = new Date()) {
  const state = validityState(record, now);
  const confirmed = toDate(record.availabilityConfirmedAt);
  const expires = toDate(record.validityExpiresAt);
  const check = toDate(record.validityNextCheckAt);
  const daysAgo = confirmed ? Math.floor((now.getTime() - confirmed.getTime()) / DAY) : null;
  // Whole days after today (the record runs to the end of its last Riyadh day).
  const daysLeft = expires ? Math.ceil((expires.getTime() - now.getTime()) / DAY) - 1 : null;
  const ago = daysAgo === null ? "" : daysAgo <= 0 ? "اليوم" : daysAgo === 1 ? "أمس" : daysAgo === 2 ? "قبل يومين" : daysAgo <= 10 ? `قبل ${daysAgo} أيام` : `قبل ${daysAgo} يومًا`;
  const left = daysLeft === null ? "" : daysLeft < 0 ? "انتهت" : daysLeft === 0 ? "اليوم آخر يوم" : daysLeft === 1 ? "يوم واحد" : daysLeft === 2 ? "يومان" : daysLeft <= 10 ? `${daysLeft} أيام` : `${daysLeft} يومًا`;
  const durationLabel = DURATION_OPTIONS.find((o) => o.id === record.validityDuration)?.label || "";
  return {
    state, label: STATE_LABEL[state],
    lastConfirmed: ago ? `آخر تأكيد: ${ago}` : "",
    remaining: state === STATE.ACTIVE && left ? `الصلاحية المتبقية: ${left}` : "",
    periodic: record.validityDuration === DURATION.UNTIL_CANCELLED && check ? `التأكيد القادم: ${check.toISOString().slice(0, 10)}` : "",
    duration: durationLabel ? `${durationLabel}${record.validityDurationChosen === false ? " (افتراضي)" : ""}` : "",
    urgent: record.validityUrgent === true,
    availability: AVAILABILITY_LABEL[String(record.availabilityStatus || "").toUpperCase()] || "",
    reason: String(record.validityReason || "")
  };
}

// ------------------------------------------------------------------ what a side says

export const ANSWER = Object.freeze({ AVAILABLE: "AVAILABLE", SOLD: "SOLD", RENTED: "RENTED", FOUND: "FOUND", PAUSE: "PAUSE", STILL_LOOKING: "STILL_LOOKING", EDIT: "EDIT" });

/** Buttons for a confirmation question (offer or request). */
export function answerOptions(kind, purpose = "") {
  if (String(kind).toUpperCase() === "REQUEST") {
    return [{ id: ANSWER.STILL_LOOKING, label: "ما زلت أبحث" }, { id: ANSWER.FOUND, label: "حصلت العقار المناسب" }, { id: ANSWER.PAUSE, label: "أوقف الطلب مؤقتًا" }, { id: ANSWER.EDIT, label: "تعديل مواصفات الطلب" }];
  }
  const rent = /RENT/.test(String(purpose).toUpperCase());
  return [{ id: ANSWER.AVAILABLE, label: "نعم، متاح" }, { id: rent ? ANSWER.RENTED : ANSWER.SOLD, label: rent ? "تم التأجير" : "تم البيع" }, { id: ANSWER.PAUSE, label: "أوقف العرض مؤقتًا" }, { id: ANSWER.EDIT, label: "تعديل بيانات العرض" }];
}

const norm = (value) => String(value || "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ً-ْ]/g, "");

/**
 * What a side's own words mean for availability (Arabic dialects + English). Returns an ANSWER or "".
 * Understanding is not enough to change a record: the Worker still asks the side to confirm with a button.
 */
export function availabilityIntent(text = "") {
  const t = norm(text);
  if (!t) return "";
  const short = t.length <= 30;
  const word = (w) => new RegExp(`(^|\\s)${w}(\\s|$|[.!،,؟?])`).test(t);
  if (/(انباع|بعناه|بعتها|بعته|تم البيع|\bsold\b)/.test(t)) return ANSWER.SOLD;
  if (/(اجرناه|اجرنا|انأجر|انوجر|تم التاجير|اجرتها|اجرته|\brented\b|\bleased\b)/.test(t) || word("تاجرت") || word("تاجر")) return ANSWER.RENTED;
  if (/((حصلت|لقيت|وجدت) (شقه|بيت|فيلا|ارض|عقار|اللي|الي|المناسب|طلبي)|ما عاد ابي|ما ابي خلاص|خلاص ما احتاج|\bi found\b|no longer (looking|need))/.test(t)) return ANSWER.FOUND;
  if (word("وقف") || word("اوقف") || word("ايقاف") || /(\bpause\b|\bstop (it|the)\b)/.test(t)) return ANSWER.PAUSE;
  // «غير متاح / مو متاح» without saying sold or rented: unclear — the side is asked which.
  if (/(غير متاح|مو متاح|ما عاد متاح|not available)/.test(t)) return "";
  if (/(ما زلت ادور|مازلت ادور|لسه ادور|لسا ادور|باقي ادور|ما زلت ابحث|still looking)/.test(t)) return ANSWER.STILL_LOOKING;
  if (/(لسه موجود|لسا موجود|مازال متاح|ما زال متاح|ما زالت متاح|مازالت متاح|لسه متاح|\bstill available\b)/.test(t)) return ANSWER.AVAILABLE;
  if (short && (word("متاح") || word("متاحه") || word("موجود") || word("موجوده") || /^available\b/.test(t))) return ANSWER.AVAILABLE;
  return "";
}

/** The record changes one confirmed answer makes (no deletion, nothing financial or legal). */
export function applyAnswer(record = {}, answer, { now = new Date(), by = "" } = {}) {
  if (answer === ANSWER.AVAILABLE || answer === ANSWER.STILL_LOOKING) {
    const renewed = renewFields(record, { now, confirmedBy: by });
    return renewed.ok ? { ...renewed.fields, validityAskedFor: "" } : null;
  }
  if ([ANSWER.SOLD, ANSWER.RENTED, ANSWER.FOUND].includes(answer)) {
    return { availabilityStatus: answer, availabilityConfirmedAt: now.toISOString(), availabilityConfirmedBy: String(by || "").slice(0, 160), validityReason: AVAILABILITY_LABEL[answer] };
  }
  return null; // PAUSE goes through the existing «إيقاف»; EDIT goes to the broker.
}
