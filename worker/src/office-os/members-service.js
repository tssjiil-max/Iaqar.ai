/**
 * Staff access — the office OWNER changes an existing member's role or active flag (D-020).
 *
 *   offices/{office}/members/{uid}   Worker-only by the rules (no browser writes, owner included)
 *
 * Authority is the stored office: `offices/{office}.ownerUid` must be the signed-in uid. A member doc
 * saying role "owner" is not enough, and nothing in the request body counts. The owner can only set
 * "broker" or "manager"; owner/admin are never handed out here, the owner's own membership is out of
 * reach (ownership moves only through /admin/office/owner-transfer), and new people are not added.
 */
import { AUDIT_ACTIONS, writeAudit } from "./audit-log.js";

export const STAFF_ROLES = Object.freeze(["broker", "manager"]);

export async function setMemberAccess(ctx, { officeId, actor, memberUid, role, active }) {
  const { appError } = ctx.deps;
  const office = await ctx.store.get(["offices", officeId]);
  if (!office || !actor?.uid || String(office.ownerUid || "") !== actor.uid) {
    throw appError("owner_required", 403, "تغيير أدوار الموظفين لمالك المكتب فقط");
  }
  const uid = String(memberUid || "").trim();
  if (!uid) throw appError("member_required", 400, "حدّد الموظف");
  if (uid === String(office.ownerUid)) {
    throw appError("owner_membership_locked", 403, "عضوية مالك المكتب لا تُعدّل من هنا");
  }
  const wantsRole = role !== undefined;
  const wantsActive = active !== undefined;
  if (!wantsRole && !wantsActive) throw appError("nothing_to_change", 400, "لا يوجد تغيير");
  if (wantsRole && !STAFF_ROLES.includes(String(role))) throw appError("role_not_allowed", 400, "الدور المسموح: وسيط أو مدير");
  if (wantsActive && typeof active !== "boolean") throw appError("active_invalid", 400, "حالة التفعيل غير صالحة");

  const target = await ctx.store.get(["offices", officeId, "members", uid]);
  if (!target) throw appError("member_not_found", 404, "الموظف غير موجود في هذا المكتب");

  const before = { role: String(target.role || ""), active: target.active !== false };
  const after = { role: wantsRole ? String(role) : before.role, active: wantsActive ? active : before.active };
  await ctx.store.set(["offices", officeId, "members", uid], {
    role: after.role, active: after.active, updatedAt: ctx.now(), updatedBy: actor.uid
  });
  await writeAudit(ctx, {
    officeId, action: AUDIT_ACTIONS.MEMBER_ACCESS_CHANGED, actorUid: actor.uid,
    entityType: "member", entityId: uid, details: { before, after }
  });
  return { ok: true, memberUid: uid, ...after };
}
