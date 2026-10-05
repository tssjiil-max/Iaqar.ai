/**
 * Office audit trail — offices/{o}/auditLogs (member read, Worker-only writes by rules; the
 * same collection the cooperation audit already uses). One entry per important action:
 * who did what to which record or deal, and when. Writing it never blocks or undoes the
 * action itself.
 */

export const AUDIT_ACTIONS = Object.freeze({
  RECORD_CREATED: "RECORD_CREATED",
  RECORD_UPDATED: "RECORD_UPDATED",
  RECORD_PAUSED: "RECORD_PAUSED",
  RECORD_ARCHIVED: "RECORD_ARCHIVED",
  RECORD_RESTORED: "RECORD_RESTORED",
  RECORD_DELETED: "RECORD_DELETED",
  RECORD_MEDIA_UPDATED: "RECORD_MEDIA_UPDATED",
  DEAL_DOCUMENT_UPDATED: "DEAL_DOCUMENT_UPDATED",
  DEAL_CLOSED: "DEAL_CLOSED",
  CHANNEL_LINK_STARTED: "CHANNEL_LINK_STARTED",
  CHANNEL_UNLINKED: "CHANNEL_UNLINKED"
});

export async function writeAudit(ctx, { officeId, action, actorUid = "", entityType = "", entityId = "", details = {}, key = "" }) {
  if (!officeId || !action) return { ok: false };
  try {
    const now = ctx.now();
    const hex = await ctx.deps.sha256Hex(["audit", officeId, action, entityType, entityId, key || now.toISOString()].join("|"));
    const id = `au_${hex.slice(0, 40)}`;
    await ctx.store.create(["offices", officeId, "auditLogs", id], {
      schemaVersion: 1,
      id,
      officeId,
      action: String(action),
      actorUid: String(actorUid || ""),
      entityType: String(entityType || ""),
      entityId: String(entityId || ""),
      opportunityIdsJson: JSON.stringify(entityType === "record" && entityId ? [entityId] : []),
      detailsJson: JSON.stringify(details || {}).slice(0, 2000),
      source: "office-os",
      createdAt: now,
      createdBySystem: false
    });
    return { ok: true, id };
  } catch (error) {
    console.warn("[office-os] audit write failed", action, error?.message);
    return { ok: false };
  }
}
