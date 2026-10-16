/**
 * Official reservation of an offer — a person's decision, never the AI's.
 *
 * The decision runs INSIDE store.update(): a compare-and-set on the document's updateTime. If two
 * managers reserve the same offer for different deals at the same moment, the second write fails its
 * precondition, re-reads the now-reserved offer, and is refused. A reserved offer leaves all new
 * public matches immediately (see listingStatus / isMatchable).
 */
import { kindOf } from "../../../public/os/domain/records-domain.js";
import { reservationDecision, releaseDecision, RESERVATION_ERRORS } from "../../../public/os/domain/direct-match-domain.js";

const STATUS = { human_approval_required: 403, not_authorized: 403, not_available: 409, already_reserved: 409, not_reserved: 409 };
const text = (v, n = 160) => String(v ?? "").trim().slice(0, n);

async function apply(ctx, { officeId, recordId, decide }) {
  const id = text(recordId);
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw ctx.deps.appError("record_invalid", 400, "السجل غير صالح");
  const path = ["offices", officeId, "opportunities", id];
  let outcome = null;
  const written = await ctx.store.update(path, (current) => {
    if (kindOf(current) !== "OFFER") { outcome = { ok: false, code: "not_available" }; return null; }
    outcome = decide(current);
    return outcome.ok && outcome.patch ? outcome.patch : null;
  });
  if (!written) throw ctx.deps.appError("record_not_found", 404, "السجل غير موجود");
  if (!outcome?.ok) throw ctx.deps.appError(outcome.code, STATUS[outcome.code] || 409, RESERVATION_ERRORS[outcome.code] || "تعذر تنفيذ الإجراء");
  return { path, written, outcome };
}

export async function reserveRecord(ctx, { actor, officeId, recordId, journeyId = "", note = "" }) {
  const deal = text(journeyId, 120);
  if (deal) {
    // A reservation names a real deal of THIS office on THIS offer.
    const journey = await ctx.store.get(["offices", officeId, "journeys", deal]);
    if (!journey || String(journey.offerId || "") !== text(recordId)) throw ctx.deps.appError("journey_mismatch", 400, "الصفقة لا تخص هذا العرض");
  }
  const { outcome } = await apply(ctx, { officeId, recordId, decide: (current) => reservationDecision(current, { actor, journeyId: deal, note: text(note, 300), now: ctx.now() }) });
  return { reserved: true, unchanged: outcome.unchanged === true };
}

export async function releaseReservation(ctx, { actor, officeId, recordId }) {
  await apply(ctx, { officeId, recordId, decide: (current) => releaseDecision(current, { actor, now: ctx.now() }) });
  return { released: true };
}
