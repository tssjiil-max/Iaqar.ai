import { brokerHasConflict, FLOW_STAGE } from "../../../public/os/domain/flow-domain.js";
import { EVENT_SOURCE, STAGE, VIEWING_STATE, isJourneyOpen } from "../../../public/os/domain/journey-domain.js";
import { formatDateTime, toDate } from "../../../public/os/domain/format-domain.js";
import { applyJourneyChange, loadJourney } from "./journey-service.js";
import { assertCanActOn } from "./permissions.js";

function viewingEnd(viewing = {}) {
  const start = toDate(viewing.at);
  if (!start) return null;
  return toDate(viewing.end || viewing.endAt) || new Date(start.getTime() + 60 * 60 * 1000);
}

async function confirmedBrokerViewings(ctx, officeId, brokerId, excludeJourneyId = "") {
  if (!brokerId) return [];
  const rows = await ctx.store.list(["offices", officeId, "journeys"], 300);
  return rows.flatMap((journey) => {
    if (String(journey.id || journey.journeyId || "") === String(excludeJourneyId || "")) return [];
    if (String(journey.assignedBrokerId || "") !== String(brokerId)) return [];
    const viewing = journey.viewing || {};
    if (String(viewing.state || "") !== VIEWING_STATE.CONFIRMED || !viewing.at) return [];
    const start = toDate(viewing.at);
    const end = viewingEnd(viewing);
    if (!start || !end) return [];
    return [{ brokerId, start: start.toISOString(), end: end.toISOString(), state: "CONFIRMED", journeyId: journey.id || journey.journeyId }];
  });
}

export async function proposeViewingTime(ctx, { actor, officeId, journeyId, viewingAt, viewingEndAt = null }) {
  const journey = await loadJourney(ctx, officeId, journeyId);
  assertCanActOn(ctx.deps, actor, journey);
  if (!isJourneyOpen(journey)) throw ctx.deps.appError("journey_closed", 409, "الصفقة مغلقة");

  const start = toDate(viewingAt);
  if (!start || start.getTime() < ctx.now().getTime() + 30 * 60 * 1000) {
    throw ctx.deps.appError("viewing_invalid", 400, "اختر موعدًا قادمًا للمعاينة");
  }
  const end = toDate(viewingEndAt) || new Date(start.getTime() + 60 * 60 * 1000);
  if (end.getTime() <= start.getTime()) throw ctx.deps.appError("viewing_invalid", 400, "وقت نهاية المعاينة غير صالح");

  const brokerId = String(journey.assignedBrokerId || actor.uid || "");
  const existing = await confirmedBrokerViewings(ctx, officeId, brokerId, journeyId);
  if (brokerHasConflict(existing, { brokerId, start: start.toISOString(), end: end.toISOString() })) {
    throw ctx.deps.appError("viewing_slot_conflict", 409, "هذا الموعد مشغول بمعاينة أخرى — اختر موعدًا آخر");
  }

  const now = ctx.now();
  const result = await applyJourneyChange(ctx, {
    officeId,
    journeyId,
    actor,
    finish: (task) => task.type === "VIEWING_CONFIRM",
    mutate: (j) => ({
      stage: STAGE.VIEWING,
      flowStage: FLOW_STAGE.VIEWING_SCHEDULING,
      viewing: {
        ...(j.viewing || {}),
        state: VIEWING_STATE.PROPOSED,
        at: start.toISOString(),
        end: end.toISOString(),
        acceptedBy: {},
        counterBy: null,
        proposedAt: now.toISOString(),
        proposedBy: actor.uid
      }
    }),
    event: {
      type: "SESSION_STAGE",
      key: ["viewing-proposed", start.toISOString()],
      source: EVENT_SOURCE.BROKER,
      text: `اقترح الوسيط موعد المعاينة ${formatDateTime(start, now)}`,
      payload: { audience: "all", viewingAt: start.toISOString() }
    },
    notify: {
      key: `viewing|${journeyId}|proposed|${start.toISOString()}`,
      title: "موعد معاينة مقترح",
      body: formatDateTime(start, now),
      pushType: "appointment",
      openSession: true
    }
  });

  return { ok: true, changed: result.changed, viewingAt: start.toISOString(), viewingEndAt: end.toISOString() };
}
