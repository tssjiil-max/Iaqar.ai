/**
 * رحلة العقار الموحدة — one deal, one current phase, one action.
 *
 *   MATCHED → PRICE_DECISION (fixed price) | PRICE_NEGOTIATION (negotiable)
 *           → VIEWING_SCHEDULING → VIEWING → VIEWING_RESULT → FINAL_AGREEMENT → CLOSED
 *
 * The phase is derived from the journey document only, so a deal can never be in two
 * phases at once, and phases that are not needed are skipped automatically (a fixed
 * price accepted by the client goes straight to scheduling the viewing).
 * Pure: shared by the Worker (validation) and the pages (display).
 */

import { formatDateTime, formatPrice, toDate, toNumber } from "./format-domain.js";

export const PHASE = Object.freeze({
  MATCHED: "MATCHED",
  PRICE_DECISION: "PRICE_DECISION",
  PRICE_NEGOTIATION: "PRICE_NEGOTIATION",
  VIEWING_SCHEDULING: "VIEWING_SCHEDULING",
  VIEWING: "VIEWING",
  VIEWING_RESULT: "VIEWING_RESULT",
  FINAL_AGREEMENT: "FINAL_AGREEMENT",
  CLOSED: "CLOSED"
});

/**
 * Display per phase. `stage` / `step` are the approved path labels
 * (تطابق → تواصل → تفاوض → معاينة → مستندات → إغلاق); `action` is the one button.
 */
export const PHASE_INFO = Object.freeze({
  MATCHED: { stage: "تطابق", step: 0, action: "مراجعة المطابقة", route: "review" },
  PRICE_DECISION: { stage: "تفاوض", step: 2, action: "فتح التفاوض", route: "session" },
  PRICE_NEGOTIATION: { stage: "تفاوض", step: 2, action: "فتح التفاوض", route: "session" },
  VIEWING_SCHEDULING: { stage: "معاينة", step: 3, action: "تحديد موعد", route: "journey" },
  VIEWING: { stage: "معاينة", step: 3, action: "تفاصيل المعاينة", route: "journey" },
  VIEWING_RESULT: { stage: "معاينة", step: 3, action: "تسجيل النتيجة", route: "journey" },
  FINAL_AGREEMENT: { stage: "مستندات", step: 4, action: "إنهاء الصفقة", route: "journey" },
  CLOSED: { stage: "إغلاق", step: 5, action: "", route: "journey" }
});

export const PRICE_STATUS = Object.freeze({ FIXED: "FIXED", NEGOTIABLE: "NEGOTIABLE" });
export const PRICE_STATUS_LABEL = Object.freeze({ FIXED: "السعر ثابت", NEGOTIABLE: "قابل للتفاوض" });

/** Viewing length used for the broker's calendar (minutes). */
export const VIEWING_MINUTES = 60;
/** Bookable hours (Riyadh wall clock) and how many days ahead are offered. */
export const SLOT_HOURS = Object.freeze([10, 11, 12, 13, 16, 17, 18, 19, 20, 21]);
export const SLOT_DAYS = 7;
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;
/** Only a booked (confirmed) viewing holds the broker's time; proposals and pending acceptances do not. */
const BOOKED_STATES = new Set(["CONFIRMED"]);

export function normalizePriceStatus(value) {
  return String(value || "").toUpperCase() === PRICE_STATUS.FIXED ? PRICE_STATUS.FIXED : PRICE_STATUS.NEGOTIABLE;
}

function isOpen(journey = {}) {
  const status = String(journey.status || "").toUpperCase();
  return status === "ACTIVE" || status === "PAUSED";
}

/** The owner's decision from the offer: fixed unless the price was reopened after a viewing. */
export function priceStatusOf(journey = {}) {
  if (journey.session?.priceReopened) return PRICE_STATUS.NEGOTIABLE;
  return normalizePriceStatus(journey.offerSummary?.priceStatus);
}

export function agreedPriceOf(journey = {}) {
  return toNumber(journey.session?.agreedPrice) || 0;
}

/** The single current phase of a deal. */
export function journeyPhase(journey = {}, now = new Date()) {
  if (!journey || !isOpen(journey)) return PHASE.CLOSED;
  const viewing = journey.viewing || {};
  const state = String(viewing.state || "NONE").toUpperCase();
  if (String(journey.stage || "") === "AGREEMENT") return PHASE.FINAL_AGREEMENT;
  const agreed = agreedPriceOf(journey);
  if (state === "DONE") {
    if (viewing.result === "interested") return PHASE.FINAL_AGREEMENT;
    // After «يحتاج تفاوض» only the price is open again; once agreed, the deal moves to the final step.
    if (agreed) return PHASE.FINAL_AGREEMENT;
    return priceStatusOf(journey) === PRICE_STATUS.FIXED ? PHASE.PRICE_DECISION : PHASE.PRICE_NEGOTIATION;
  }
  if (state === "CONFIRMED" && viewing.at) {
    const end = (toDate(viewing.at)?.getTime() || 0) + VIEWING_MINUTES * 60 * 1000;
    return now.getTime() >= end ? PHASE.VIEWING_RESULT : PHASE.VIEWING;
  }
  if (state === "PROPOSED" || state === "ACCEPTED") return PHASE.VIEWING_SCHEDULING;
  // «معاينة أخرى» / «لم يحضر»: a new time is needed, whatever the price state.
  if (viewing.rescheduleRequested === true) return PHASE.VIEWING_SCHEDULING;
  if (agreed) return PHASE.VIEWING_SCHEDULING;
  return priceStatusOf(journey) === PRICE_STATUS.FIXED ? PHASE.PRICE_DECISION : PHASE.PRICE_NEGOTIATION;
}

export function phaseInfo(phase) {
  return PHASE_INFO[phase] || PHASE_INFO.PRICE_NEGOTIATION;
}

/** «تم الاتفاق عليه»: only items actually agreed — never empty rows. */
export function agreedItems(journey = {}, now = new Date()) {
  const items = [];
  const agreed = agreedPriceOf(journey);
  if (agreed) items.push({ id: "price", label: "السعر المتفق عليه", value: formatPrice(agreed) });
  const viewing = journey.viewing || {};
  const state = String(viewing.state || "").toUpperCase();
  if ((state === "CONFIRMED" || state === "DONE") && viewing.at) {
    items.push({ id: "viewing", label: state === "DONE" ? "المعاينة (تمت)" : "موعد المعاينة", value: formatDateTime(viewing.at, now) });
  }
  return items;
}

// ------------------------------------------------------------ broker calendar

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/** Busy intervals of one broker from the office's journeys (booked viewings only). */
export function brokerBusy(journeys = [], brokerId = "", { exceptJourneyId = "" } = {}) {
  const busy = [];
  for (const j of journeys) {
    const id = String(j.journeyId || j.id || "");
    if (!j || id === exceptJourneyId || !isOpen(j)) continue;
    if (String(j.assignedBrokerId || "") !== String(brokerId || "")) continue;
    const state = String(j.viewing?.state || "").toUpperCase();
    const at = toDate(j.viewing?.at);
    if (!BOOKED_STATES.has(state) || !at) continue;
    busy.push({ start: at.getTime(), end: at.getTime() + VIEWING_MINUTES * 60 * 1000, journeyId: id });
  }
  return busy;
}

/**
 * checkBrokerAvailability(busy, start, end): { ok, conflict } — a slot is free only if
 * it overlaps none of the broker's booked viewings.
 */
export function checkBrokerAvailability(busy = [], proposedStart, proposedEnd) {
  const start = toDate(proposedStart)?.getTime();
  const end = toDate(proposedEnd)?.getTime() ?? (start + VIEWING_MINUTES * 60 * 1000);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { ok: false, conflict: null };
  const conflict = busy.find((b) => overlaps(start, end, b.start, b.end)) || null;
  return { ok: !conflict, conflict };
}

/** Riyadh wall-clock slot → Date. */
export function riyadhSlot(year, monthIndex, day, hour, minute = 0) {
  return new Date(Date.UTC(year, monthIndex, day, hour, minute) - RIYADH_OFFSET_MS);
}

/**
 * Free viewing slots for the next days: only times at least 2 hours ahead and not
 * overlapping the broker's calendar. Returns [{ day: "YYYY-MM-DD", slots: [iso…] }].
 */
export function availableSlots(busy = [], now = new Date(), { days = SLOT_DAYS, hours = SLOT_HOURS } = {}) {
  const out = [];
  const local = new Date(now.getTime() + RIYADH_OFFSET_MS);
  const earliest = now.getTime() + 2 * 60 * 60 * 1000;
  for (let d = 0; d < days; d += 1) {
    const y = local.getUTCFullYear(); const m = local.getUTCMonth(); const dd = local.getUTCDate() + d;
    const slots = [];
    for (const hour of hours) {
      const start = riyadhSlot(y, m, dd, hour);
      if (start.getTime() < earliest) continue;
      if (!checkBrokerAvailability(busy, start, new Date(start.getTime() + VIEWING_MINUTES * 60 * 1000)).ok) continue;
      slots.push(start.toISOString());
    }
    if (slots.length) out.push({ day: new Date(Date.UTC(y, m, dd)).toISOString().slice(0, 10), slots });
  }
  return out;
}

/** True when `iso` is one of the offered free slots (server-side validation). */
export function isOfferedSlot(slots = [], iso = "") {
  const t = toDate(iso)?.getTime();
  return Number.isFinite(t) && slots.some((day) => day.slots.some((s) => toDate(s)?.getTime() === t));
}
