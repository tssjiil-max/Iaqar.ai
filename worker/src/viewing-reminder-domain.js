/** Server-side viewing reminder schedule. Match remains authoritative. */

export const VIEWING_REMINDER_KIND = Object.freeze({
  CONFIRMED: "confirmed",
  TWO_HOURS: "2h",
  THIRTY_MINUTES: "30m",
  OVERDUE: "overdue"
});

const MINUTE_MS = 60 * 1000;

function ms(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function viewingReminderSchedule(appointmentAt) {
  const at = ms(appointmentAt);
  if (!at) return [];
  return [
    { kind: VIEWING_REMINDER_KIND.TWO_HOURS, at: new Date(at - 120 * MINUTE_MS).toISOString() },
    { kind: VIEWING_REMINDER_KIND.THIRTY_MINUTES, at: new Date(at - 30 * MINUTE_MS).toISOString() },
    { kind: VIEWING_REMINDER_KIND.OVERDUE, at: new Date(at).toISOString() }
  ];
}

export function viewingReminderId({ matchId, appointmentAt, kind }) {
  const occurrence = String(appointmentAt || "").replace(/[^0-9]/g, "").slice(0, 14);
  return `viewing_${String(matchId || "")}_${occurrence}_${String(kind || "")}`;
}

export function dueViewingReminders(match = {}, now = new Date(), windowMinutes = 10) {
  const appointmentAt = String(match.appointmentAt || "").trim();
  const status = String(match.appointmentStatus || "").toUpperCase();
  const confirmed = status === "CONFIRMED_BY_BROKER" || String(match.livingStage || "").toUpperCase() === "APPOINTMENT_CONFIRMED";
  if (!confirmed || !appointmentAt || match.viewingCompletedAt || match.viewingOutcome) return [];
  const nowMs = ms(now);
  const floor = nowMs - Math.max(1, Number(windowMinutes || 10)) * MINUTE_MS;
  return viewingReminderSchedule(appointmentAt).filter((entry) => {
    const entryMs = ms(entry.at);
    return entryMs <= nowMs && entryMs > floor;
  });
}

export function viewingReminderCopy(kind) {
  if (kind === VIEWING_REMINDER_KIND.TWO_HOURS) return { title: "معاينة بعد ساعتين", body: "لديك موعد معاينة بعد ساعتين" };
  if (kind === VIEWING_REMINDER_KIND.THIRTY_MINUTES) return { title: "معاينة بعد 30 دقيقة", body: "لديك موعد معاينة بعد 30 دقيقة" };
  if (kind === VIEWING_REMINDER_KIND.OVERDUE) return { title: "انتهى موعد المعاينة — سجّل النتيجة", body: "انتهى موعد المعاينة — سجّل النتيجة" };
  return { title: "تم تأكيد موعد المعاينة", body: "تم تأكيد موعد المعاينة" };
}

