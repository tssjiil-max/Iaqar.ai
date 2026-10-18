/**
 * «حد المالك» — the lowest price the owner (or whoever holds the owner's mandate) authorised for one offer.
 *
 *   offices/{office}/mandates/{recordId}   Worker-only (closed to every browser by the rules)
 *
 * Kept apart from the record on purpose: a record is copied to search results, other offices, the WhatsApp agent's
 * cards and party pages; the floor never is. Only the office manager sets or clears it, with the stated source of the
 * owner's approval, and the audit says that it changed — never the amount.
 *
 * What the floor does: a client's offer at or above it is labelled «ضمن تفويض المالك» for the office. Nothing is ever
 * accepted automatically: the owner's answer is still recorded by a person (owner confirmation + its source).
 */
import { priceOf } from "../../../public/os/domain/records-domain.js";
import { writeAudit } from "./audit-log.js";

const clean = (v, n = 200) => String(v ?? "").trim().slice(0, n);
export const mandatePath = (officeId, recordId) => ["offices", officeId, "mandates", recordId];
const recordIdOf = (ctx, v) => { const id = clean(v, 128); if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw ctx.deps.appError("record_invalid", 400, "السجل غير صالح"); return id; };

/** The floor the agent may use for this listing, or null (then the owner must answer every offer). */
export async function mandateFloor(ctx, officeId, recordId) {
  const doc = await ctx.store.get(mandatePath(officeId, recordId)).catch(() => null);
  const floor = Number(doc?.floor);
  return doc && doc.officeId === officeId && doc.recordId === recordId && floor > 0 ? floor : null;
}

async function offerOrFail(ctx, officeId, recordId) {
  const row = await ctx.store.get(["offices", officeId, "opportunities", recordId]);
  if (!row || (row.officeId && row.officeId !== officeId) || row.lifecycleStatus === "DELETED") throw ctx.deps.appError("record_not_found", 404, "السجل غير موجود");
  if (String(row.opportunityKind || row.kind || "").toUpperCase() !== "OFFER") throw ctx.deps.appError("offer_required", 400, "حد المالك يخص العروض فقط");
  return row;
}

export async function getRecordMandate(ctx, { officeId, actor, recordId }) {
  if (!actor?.isManager) throw ctx.deps.appError("forbidden", 403, "حد المالك يراه مدير المكتب فقط");
  const id = recordIdOf(ctx, recordId);
  await offerOrFail(ctx, officeId, id);
  const doc = await ctx.store.get(mandatePath(officeId, id));
  return { ok: true, mandate: doc && Number(doc.floor) > 0 ? { floor: Number(doc.floor), source: clean(doc.source), setBy: clean(doc.setBy, 128), setAt: doc.setAt || null } : null };
}

/** Set (floor > 0, with its source) or clear (floor 0) the owner's floor for one offer. Manager only. */
export async function setRecordMandate(ctx, { officeId, actor, recordId, floor, source }) {
  if (!actor?.isManager) throw ctx.deps.appError("forbidden", 403, "حد المالك يحدده مدير المكتب فقط");
  const id = recordIdOf(ctx, recordId);
  const row = await offerOrFail(ctx, officeId, id);
  const value = Math.round(Number(floor) || 0);
  if (value < 0) throw ctx.deps.appError("floor_invalid", 400, "اكتب حدًا صحيحًا");
  if (value === 0) {
    await ctx.store.set(mandatePath(officeId, id), { officeId, recordId: id, floor: null, source: "", setBy: actor.uid, setAt: ctx.now() });
    await writeAudit(ctx, { officeId, action: "RECORD_MANDATE_CLEARED", actorUid: actor.uid, entityType: "record", entityId: id, key: ctx.now().toISOString() });
    return { ok: true, mandate: null };
  }
  const price = Number(priceOf(row)) || 0;
  if (value < 1000) throw ctx.deps.appError("floor_invalid", 400, "اكتب حد المالك بالريال");
  if (price > 0 && value > price) throw ctx.deps.appError("floor_above_price", 400, "حد المالك لا يزيد عن السعر المعلن");
  const why = clean(source);
  if (why.length < 3) throw ctx.deps.appError("mandate_source_required", 400, "اكتب مصدر موافقة المالك (مثلًا: اتصال مع المالك اليوم، تفويض مكتوب)");
  await ctx.store.set(mandatePath(officeId, id), { officeId, recordId: id, floor: value, source: why, setBy: actor.uid, setAt: ctx.now() });
  // The audit log is read by every office member: it records the change and its source, not the amount.
  await writeAudit(ctx, { officeId, action: "RECORD_MANDATE_SET", actorUid: actor.uid, entityType: "record", entityId: id, key: ctx.now().toISOString(), details: { source: why } });
  return { ok: true, mandate: { floor: value, source: why, setBy: actor.uid } };
}
