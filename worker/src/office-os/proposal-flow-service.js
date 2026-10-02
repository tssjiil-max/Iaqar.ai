import { brokerHasConflict } from "../../../public/os/domain/flow-domain.js";
import { toDate } from "../../../public/os/domain/format-domain.js";
import { journeySegments } from "./journey-service.js";
import { createProposals } from "./proposal-service.js";

function viewingEnd(viewing = {}) {
  const start = toDate(viewing.at);
  if (!start) return null;
  return toDate(viewing.end || viewing.endAt) || new Date(start.getTime() + 60 * 60 * 1000);
}

async function confirmedBrokerViewings(ctx, officeId, brokerId, excludeJourneyId) {
  if (!brokerId) return [];
  const rows = await ctx.store.list(["offices", officeId, "journeys"], 300);
  return rows.flatMap((journey) => {
    if (String(journey.id || journey.journeyId || "") === String(excludeJourneyId || "")) return [];
    if (String(journey.assignedBrokerId || "") !== String(brokerId)) return [];
    const viewing = journey.viewing || {};
    if (String(viewing.state || "") !== "CONFIRMED" || !viewing.at) return [];
    const start = toDate(viewing.at);
    const end = viewingEnd(viewing);
    if (!start || !end) return [];
    return [{ brokerId, start: start.toISOString(), end: end.toISOString(), state: "CONFIRMED" }];
  });
}

export async function createProposalsSafe(ctx, args) {
  if (String(args.kind || "").toUpperCase() !== "VIEWING") return createProposals(ctx, args);
  const journey = await ctx.store.get(journeySegments(args.officeId, args.journeyId));
  if (!journey) throw ctx.deps.appError("journey_not_found", 404, "الفرصة غير موجودة");
  const at = toDate(args.fields?.viewingAt);
  if (!at) throw ctx.deps.appError("viewing_invalid", 400, "اختر موعدًا صحيحًا للمعاينة");
  const brokerId = String(journey.assignedBrokerId || args.actor?.uid || "");
  const end = toDate(args.fields?.viewingEnd) || new Date(at.getTime() + 60 * 60 * 1000);
  const existing = await confirmedBrokerViewings(ctx, args.officeId, brokerId, args.journeyId);
  if (brokerHasConflict(existing, { brokerId, start: at.toISOString(), end: end.toISOString() })) {
    throw ctx.deps.appError("viewing_slot_conflict", 409, "هذا الموعد مشغول بمعاينة أخرى — اختر موعدًا آخر");
  }
  return createProposals(ctx, args);
}
