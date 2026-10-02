/**
 * التعاون بين الوسطاء — third broker («وسيط مشارك») and the commission agreement.
 * Writes go through the Worker only (Firestore rules forbid client edits of cooperation records),
 * and every limit is enforced here with the shared domain, not just in the UI.
 */

import {
  BROKER_ROLE,
  COMMISSION_KEYS,
  canAddParticipatingBroker,
  cooperationBrokerCount,
  defaultCommission,
  isCooperationActive,
  isCooperationParty,
  readCommission,
  validateCommission
} from "../../public/js/cooperation-brokers-domain.js";

export const COOPERATION_BROKER_ACTION = Object.freeze({
  ADD_PARTICIPATING_BROKER: "ADD_PARTICIPATING_BROKER",
  SET_COMMISSION: "SET_COMMISSION"
});

const text = (value) => String(value ?? "").trim();

function fail(error, status, message) {
  return { ok: false, error, status, message };
}

function commissionFields(fh, shares, { actorUid, now }) {
  const fields = {};
  for (const key of COMMISSION_KEYS) fields[key] = fh.firestoreInteger(shares[key]);
  fields.commissionAgreementUpdatedAt = fh.firestoreTimestamp(now);
  fields.commissionAgreementUpdatedBy = fh.firestoreString(text(actorUid));
  return fields;
}

async function readMember({ projectId, officeId, uid, accessToken, deps }) {
  const [officeDoc, memberDoc] = await Promise.all([
    deps.getFirestoreDocument({ projectId, segments: ["offices", officeId], accessToken, allowMissing: true }),
    deps.getFirestoreDocument({ projectId, segments: ["offices", officeId, "members", uid], accessToken, allowMissing: true })
  ]);
  const office = officeDoc ? deps.firestoreFieldsToJs(officeDoc.fields || {}) : {};
  const member = memberDoc ? deps.firestoreFieldsToJs(memberDoc.fields || {}) : null;
  if (office.ownerUid && office.ownerUid === uid) {
    return { ok: true, name: text(office.brokerName || (member && (member.displayName || member.name)) || "") };
  }
  if (member && member.active !== false) return { ok: true, name: text(member.displayName || member.name || member.brokerName || "") };
  return { ok: false };
}

export async function runCooperationBrokerAction({
  projectId, actorOfficeId, actorUid, cooperationId, action, brokerId = "", shares = null, accessToken, deps, now = new Date()
}) {
  const doc = await deps.getFirestoreDocument({ projectId, segments: ["cooperationRequests", cooperationId], accessToken, allowMissing: true });
  if (!doc) return fail("cooperation_not_found", 404, "سجل التعاون غير موجود.");
  const record = { id: cooperationId, ...deps.firestoreFieldsToJs(doc.fields || {}) };
  // A third office learns nothing: not a party → forbidden before anything else is checked.
  if (!isCooperationParty(record, actorOfficeId)) return fail("cooperation_forbidden", 403, "هذا المكتب ليس طرفًا في التعاون.");
  const fh = deps.firestoreHelpers;
  const act = text(action).toUpperCase();

  if (act === COOPERATION_BROKER_ACTION.ADD_PARTICIPATING_BROKER) {
    const decision = canAddParticipatingBroker(record, { officeId: actorOfficeId, brokerId });
    if (!decision.ok) return fail(decision.error, decision.status, decision.message);
    if (decision.duplicate) return { ok: true, duplicate: true, cooperationId, message: "الوسيط المشارك مضاف مسبقًا." };
    const member = await readMember({ projectId, officeId: actorOfficeId, uid: text(brokerId), accessToken, deps });
    if (!member.ok) return fail("broker_not_in_office", 403, "الوسيط المشارك يجب أن يكون من وسطاء مكتبك.");
    const wanted = shares || defaultCommission(3);
    const checked = validateCommission(wanted, 3);
    if (!checked.ok) return fail(checked.error, 400, checked.message);
    await deps.setFirestoreDocument({
      projectId, segments: ["cooperationRequests", cooperationId], accessToken,
      fields: {
        participatingBrokerId: fh.firestoreString(text(brokerId)),
        participatingBrokerOfficeId: fh.firestoreString(text(actorOfficeId)),
        participatingBrokerName: fh.firestoreString(member.name),
        optionalThirdBrokerRole: fh.firestoreString(BROKER_ROLE.PARTICIPATING_BROKER),
        participatingBrokerAddedBy: fh.firestoreString(text(actorUid)),
        participatingBrokerAddedAt: fh.firestoreTimestamp(now),
        ...commissionFields(fh, checked.shares, { actorUid, now }),
        updatedAt: fh.firestoreTimestamp(now)
      }
    });
    return { ok: true, duplicate: false, cooperationId, brokerCount: 3, commission: checked.shares, message: "تمت إضافة الوسيط المشارك." };
  }

  if (act === COOPERATION_BROKER_ACTION.SET_COMMISSION) {
    if (!isCooperationActive(record)) return fail("cooperation_not_active", 409, "اتفاق التعاون يُعدَّل داخل التعاون النشط فقط.");
    const count = cooperationBrokerCount(record);
    const checked = validateCommission(shares || {}, count);
    if (!checked.ok) return fail(checked.error, 400, checked.message);
    const current = readCommission(record);
    const same = current.agreed && COMMISSION_KEYS.every((key) => Number(current[key]) === checked.shares[key]);
    if (same) return { ok: true, duplicate: true, cooperationId, brokerCount: count, commission: checked.shares, message: "الاتفاق كما هو." };
    await deps.setFirestoreDocument({
      projectId, segments: ["cooperationRequests", cooperationId], accessToken,
      fields: { ...commissionFields(fh, checked.shares, { actorUid, now }), updatedAt: fh.firestoreTimestamp(now) }
    });
    return { ok: true, duplicate: false, cooperationId, brokerCount: count, commission: checked.shares, message: "تم حفظ اتفاق التعاون." };
  }

  return fail("unknown_action", 400, "إجراء غير معروف.");
}
