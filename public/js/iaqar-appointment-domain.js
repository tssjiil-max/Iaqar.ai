/**
 * Iaqar viewing slots. Duration + buffer are internal; booked slots stay hidden.
 * Does not depend on an external calendar.
 */

export const APPOINTMENT_DURATION_MINUTES = 30;
export const APPOINTMENT_BUFFER_MINUTES = 30;
export const APPOINTMENT_SLOT_TAKEN_COPY = "هذا الموعد لم يعد متاحًا، اختر موعدًا آخر.";
export const APPOINTMENT_CONFIRMED_COPY = "تم تأكيد المعاينة";
export const APPOINTMENT_TIME_ZONE = "Asia/Riyadh";

export const IAQAR_QA_SLOTS = Object.freeze([
  Object.freeze({ id: "2026-08-26T07:00:00.000Z", startAt: "2026-08-26T07:00:00.000Z" }),
  Object.freeze({ id: "2026-08-26T09:00:00.000Z", startAt: "2026-08-26T09:00:00.000Z" }),
  Object.freeze({ id: "2026-08-26T13:00:00.000Z", startAt: "2026-08-26T13:00:00.000Z" }),
  Object.freeze({ id: "2026-08-27T07:00:00.000Z", startAt: "2026-08-27T07:00:00.000Z" })
]);

function startMs(value) {
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? at : 0;
}

export function appointmentOccupancyMs() {
  return (APPOINTMENT_DURATION_MINUTES + APPOINTMENT_BUFFER_MINUTES) * 60 * 1000;
}

export function slotsOverlap(leftStart, rightStart) {
  const left = startMs(leftStart);
  const right = startMs(rightStart);
  if (!left || !right) return false;
  const span = appointmentOccupancyMs();
  return left < right + span && right < left + span;
}

export function formatPartySlotLabel(startAt, timeZone = APPOINTMENT_TIME_ZONE) {
  const at = new Date(startAt);
  if (!Number.isFinite(at.getTime())) {
    return { dayLabel: "", dateLabel: "", timeLabel: "", buttonLabel: "" };
  }
  const dayLabel = at.toLocaleString("ar-SA", { timeZone, weekday: "long" });
  const dateLabel = at.toLocaleString("ar-SA", { timeZone, day: "numeric", month: "long" });
  const timeLabel = at.toLocaleString("ar-SA", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: false
  }).replace(/\s+/g, " ").trim();
  return {
    dayLabel,
    dateLabel,
    timeLabel,
    buttonLabel: [dayLabel, timeLabel].filter(Boolean).join(" · ")
  };
}

export function availableIaqarSlots({
  catalog = IAQAR_QA_SLOTS,
  bookedStarts = [],
  reserveStart = ""
} = {}) {
  return catalog
    .filter((slot) => {
      if (reserveStart && (slot.id === reserveStart || slot.startAt === reserveStart)) return true;
      return !bookedStarts.some((booked) => booked && slotsOverlap(slot.startAt, booked));
    })
    .map((slot) => ({
      id: slot.id,
      startAt: slot.startAt,
      ...formatPartySlotLabel(slot.startAt)
    }));
}

export function slotIsTaken(slotId, bookedStarts = [], { excludeStart = "" } = {}) {
  const start = String(slotId || "").trim();
  if (!start) return true;
  if (excludeStart && start === excludeStart) return false;
  return bookedStarts.some((booked) => booked && booked !== excludeStart && slotsOverlap(start, booked));
}
