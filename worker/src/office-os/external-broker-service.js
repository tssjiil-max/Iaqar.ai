import { cooperationEligible, externalBrokerClaim, isExternalBroker } from "../../../public/os/domain/external-broker-domain.js";
import { kindOf } from "../../../public/os/domain/records-domain.js";
import { assertCanActOn } from "./permissions.js";
import { writeAudit } from "./audit-log.js";

export async function reviewExternalCooperation(ctx, { actor, officeId, recordId, input = {} }) {
  const path = ["offices", officeId, "opportunities", recordId];
  const record = await ctx.store.get(path);
  if (!record || record.officeId !== officeId || !isExternalBroker(record)) throw ctx.deps.appError("record_not_found", 404, "مشاركة التعاون غير موجودة");
  assertCanActOn(ctx.deps, actor, record);
  if (!actor.isManager) throw ctx.deps.appError("cooperation_review_forbidden", 403, "مراجعة التمثيل واتفاق التعاون متاحة لإدارة المكتب");
  const text = (value, max = 240) => String(value ?? "").trim().slice(0, max);
  const representationStatus = text(input.representationStatus || record.representationStatus);
  const cooperationStatus = text(input.cooperationStatus || record.cooperationStatus);
  const representationClaim = text(input.representationClaim || record.representationClaim);
  const claimCheck = externalBrokerClaim({ ...record, kind: kindOf(record) === "OFFER" ? "owner" : "client", representationClaim });
  if (!claimCheck.ok) throw ctx.deps.appError("representation_claim_invalid", 400, Object.values(claimCheck.errors)[0]);
  const evidenceReference = text(input.evidenceReference || record.representationEvidenceReference);
  if (!["PENDING", "VERIFIED", "REJECTED"].includes(representationStatus) || !["REQUESTED", "ACCEPTED", "CLOSED"].includes(cooperationStatus)) throw ctx.deps.appError("cooperation_invalid", 400, "حالة التعاون غير صالحة");
  if (representationStatus === "VERIFIED" && (representationClaim === "NOT_AUTHORIZED" || !evidenceReference)) throw ctx.deps.appError("representation_evidence_required", 400, "أدخل مرجع إثبات التمثيل بعد مراجعة هوية الوسيط ورخصته والتفويض فعليًا");
  if (cooperationStatus === "ACCEPTED" && representationStatus !== "VERIFIED") throw ctx.deps.appError("representation_not_verified", 400, "راجع صفة التمثيل قبل قبول التعاون");
  const now = ctx.now();
  const patch = { representationClaim, representationStatus, cooperationStatus, representationEvidenceReference: evidenceReference,
    representationVerifiedBy: representationStatus === "VERIFIED" ? actor.uid : "",
    representationVerifiedAt: representationStatus === "VERIFIED" ? now.toISOString() : "",
    cooperationReviewedBy: actor.uid, cooperationReviewedAt: now.toISOString(), updatedAt: now,
    advertiserRole: "BROKER", contactType: "broker" };
  if (input.commissionStatus !== undefined) {
    if (!["NONE", "AGREED"].includes(input.commissionStatus)) throw ctx.deps.appError("commission_invalid", 400, "حالة العمولة غير صالحة");
    patch.commissionStatus = input.commissionStatus;
    patch.commissionAgreementReference = text(input.commissionAgreementReference);
    patch.commissionType = text(input.commissionType);
    patch.commissionValue = input.commissionStatus === "AGREED" ? Number(input.commissionValue) : 0;
    if (input.commissionStatus === "AGREED" && (!patch.commissionAgreementReference || !["PERCENT", "AMOUNT"].includes(patch.commissionType) || !Number.isFinite(patch.commissionValue) || patch.commissionValue <= 0 || (patch.commissionType === "PERCENT" && patch.commissionValue > 100) || cooperationStatus !== "ACCEPTED")) throw ctx.deps.appError("commission_agreement_required", 400, "أدخل اتفاق عمولة موثقًا وقيمة صحيحة بعد قبول التعاون");
  }
  patch.matchingReadiness = cooperationEligible({ ...record, ...patch }) ? "READY_FOR_MATCHING" : "NEEDS_COMPLETION";
  await ctx.store.set(path, patch);
  await writeAudit(ctx, { officeId, action: "EXTERNAL_COOPERATION_REVIEWED", actorUid: actor.uid, entityType: "record", entityId: recordId,
    details: { representationStatus, cooperationStatus, evidenceReference, commissionStatus: patch.commissionStatus || record.commissionStatus }, key: now.toISOString() });
  let matchingPending = false;
  if (cooperationEligible({ ...record, ...patch }) && typeof ctx.deps.runMatching === "function") {
    try { await ctx.deps.runMatching({ officeId, opportunityId: recordId, notify: true }); } catch { matchingPending = true; }
  }
  return { ok: true, recordId, matchingPending };
}

/** External participants keep their own identity; all negotiation stays through the office. */
export async function assertOfficeMediatedJourney(ctx, officeId, journey) {
  const records = await Promise.all([journey.offerId, journey.requestId].filter(Boolean).map(id => ctx.store.get(["offices", officeId, "opportunities", id])));
  if (records.some(isExternalBroker)) throw ctx.deps.appError("external_broker_office_mediated", 409, "هذا التعاون يُدار عبر المكتب؛ لا تُصدر روابط الأطراف للوسيط الخارجي");
}
