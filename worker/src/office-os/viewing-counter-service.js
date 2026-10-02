import { brokerHasConflict, FLOW_STAGE } from "../../../public/os/domain/flow-domain.js";
import { EVENT_SOURCE, VIEWING_STATE, isJourneyOpen } from "../../../public/os/domain/journey-domain.js";
import { formatDateTime, parseRiyadhLocal, toDate } from "../../../public/os/domain/format-domain.js";
import { isReplyTokenShape } from "./proposal-service.js";
import { applyJourneyChange, journeySegments } from "./journey-service.js";
import { sessionHashOf, submitSessionAction } from "./session-service.js";

function endAt(start, value = null) {
  return toDate(value) || new Date(start.getTime() + 60 * 60 * 1000);
}

async function resolveTarget(ctx, token) {
  if (!isReplyTokenShape(token)) throw ctx.deps.appError("session_invalid", 404, "هذا الرابط غير صالح");
  const hash = await sessionHashOf(ctx.deps, token);
  const link = await ctx.store.get(["sessionLinks", hash]);
  if (!link?.officeId || !link?.journeyId || !["owner", "client"].includes(link.role)) throw ctx.deps.appError("session_invalid", 404, "هذا الرابط غير صالح");
  if (["REPLACED", "REVOKED", "CLOSED"].includes(String(link.status || "").toUpperCase())) throw ctx.deps.appError("session_closed", 409, "هذا الرابط لم يعد نشطًا");
  const journey = await ctx.store.get(journeySegments(link.officeId, link.journeyId));
  if (!journey || !isJourneyOpen(journey)) throw ctx.deps.appError("journey_closed", 409, "انتهت هذه الرحلة");
  return { link, role: link.role, officeId: link.officeId, journeyId: link.journeyId, journey };
}

async function confirmedViewings(ctx, officeId, brokerId, excludeJourneyId) {
  if (!brokerId) return [];
  const rows = await ctx.store.list(["offices", officeId, "journeys"], 300);
  return rows.flatMap((journey) => {
    if (String(journey.id || journey.journeyId || "") === String(excludeJourneyId || "")) return [];
    if (String(journey.assignedBrokerId || "") !== String(brokerId)) return [];
    const viewing = journey.viewing || {};
    if (String(viewing.state || "") !== VIEWING_STATE.CONFIRMED || !viewing.at) return [];
    const start = toDate(viewing.at);
    if (!start) return [];
    return [{ brokerId, start: start.toISOString(), end: endAt(start, viewing.end || viewing.endAt).toISOString(), state: "CONFIRMED" }];
  });
}

export async function submitViewingCounterToOtherParty(ctx, args = {}) {
  const target = await resolveTarget(ctx, args.token);
  const at = parseRiyadhLocal(args.viewingAt) || toDate(args.viewingAt);
  if (!at || at.getTime() < ctx.now().getTime() + 30 * 60 * 1000) throw ctx.deps.appError("viewing_invalid", 400, "اختر موعدًا قادمًا للمعاينة");
  const end = new Date(at.getTime() + 60 * 60 * 1000);
  const brokerId = String(target.journey.assignedBrokerId || "");
  const existing = await confirmedViewings(ctx, target.officeId, brokerId, target.journeyId);
  if (brokerId && brokerHasConflict(existing, { brokerId, start: at.toISOString(), end: end.toISOString() })) {
    throw ctx.deps.appError("viewing_slot_conflict", 409, "هذا الموعد مشغول بمعاينة أخرى — اختر موعدًا آخر");
  }

  // Keep legacy validation/idempotency/event behavior for the move itself.
  const saved = await submitSessionAction(ctx, { ...args, action: "viewing_other" });
  if (!saved?.ok) return saved;

  const now = ctx.now();
  await applyJourneyChange(ctx, {
    officeId: target.officeId,
    journeyId: target.journeyId,
    actor: null,
    mutate: (journey) => ({
      flowStage: FLOW_STAGE.VIEWING_SCHEDULING,
      viewing: {
        ...(journey.viewing || {}),
        state: VIEWING_STATE.PROPOSED,
        at: at.toISOString(),
        end: end.toISOString(),
        acceptedBy: { [target.role]: true },
        counterBy: null,
        counterAt: at.toISOString(),
        proposedBy: target.role,
        proposedAt: now.toISOString()
      }
    }),
    event: {
      type: "SESSION_STAGE",
      key: ["party-viewing-counter-active", target.role, at.toISOString()],
      source: EVENT_SOURCE.REPLY_LINK,
      actorRole: target.role,
      text: `أصبح الموعد الذي اختاره ${target.role === "owner" ? "المالك" : "العميل"} هو المقترح الحالي: ${formatDateTime(at, now)}`,
      payload: { role: target.role, viewingAt: at.toISOString(), audience: "all" }
    }
  });

  return saved;
}
