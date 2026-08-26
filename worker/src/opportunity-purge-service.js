/**
 * Permanent delete of an archived opportunity and exclusive dependents.
 * Fail closed: shared matches / tasks / sessions stay.
 * Never deletes office, members, settings, branding, or unrelated opportunities.
 */

import { LIFECYCLE } from "../../public/js/opportunity-bank-domain.js";
import { buildOpportunityDeletePlan } from "../../public/js/opportunity-delete-plan-domain.js";

export const PERMANENT_DELETE_CONFIRM = "PERMANENT_DELETE";

function text(value) {
  return String(value == null ? "" : value).trim();
}

function docId(doc) {
  return decodeURIComponent(String(doc?.name || "").split("/").pop() || "");
}

function asRecord(doc, firestoreFieldsToJs) {
  return { id: docId(doc), ...(firestoreFieldsToJs(doc.fields || {}) || {}) };
}

export function validatePurgeRequest({ existing, officeId, confirm }) {
  if (!existing) return { ok: false, error: "opportunity_not_found", status: 404, message: "الفرصة غير موجودة" };
  if (text(existing.officeId) !== text(officeId)) {
    return { ok: false, error: "office_mismatch", status: 403, message: "الفرصة لا تتبع هذا المكتب" };
  }
  if (text(confirm) !== PERMANENT_DELETE_CONFIRM) {
    return { ok: false, error: "confirm_required", status: 400, message: "يلزم تأكيد الحذف النهائي" };
  }
  const archived = text(existing.lifecycleStatus).toUpperCase() === LIFECYCLE.ARCHIVED
    || Boolean(existing.archivedAt);
  if (!archived) {
    return { ok: false, error: "archive_required", status: 409, message: "انقل الفرصة إلى الأرشيف قبل الحذف النهائي" };
  }
  return { ok: true };
}

export async function collectOfficeWorkflowRows({
  projectId,
  officeId,
  accessToken,
  listCollectionDocuments,
  firestoreFieldsToJs
}) {
  const list = async (name, pageSize = 200) => {
    const docs = await listCollectionDocuments({
      projectId,
      segments: ["offices", officeId, name],
      accessToken,
      pageSize
    });
    return (docs || []).map((doc) => asRecord(doc, firestoreFieldsToJs));
  };
  const [matches, operations, partySessions, notifications, deals] = await Promise.all([
    list("matches"),
    list("operations"),
    list("partySessions"),
    list("notifications"),
    list("deals")
  ]);
  return { matches, operations, partySessions, notifications, deals };
}

export function planOpportunityPurge({
  opportunityId,
  matches = [],
  operations = [],
  partySessions = [],
  notifications = [],
  deals = [],
  cooperations = []
}) {
  return buildOpportunityDeletePlan({
    opportunityIds: [opportunityId],
    matches,
    operations,
    partySessions,
    cooperations,
    appointments: deals,
    notifications
  });
}

export async function applyOpportunityPurge({
  projectId,
  officeId,
  opportunityId,
  plan,
  accessToken,
  deleteFirestoreDocument,
  listCollectionDocuments
}) {
  const deleted = [];
  const skipped = [...(plan.skip || [])];
  const byType = (type) => (plan.delete || []).filter((row) => row.type === type);

  for (const row of byType("match")) {
    const timelineDocs = await listCollectionDocuments({
      projectId,
      segments: ["offices", officeId, "matches", row.id, "timeline"],
      accessToken,
      pageSize: 100
    }).catch(() => []);
    for (const doc of timelineDocs || []) {
      const eventId = docId(doc);
      if (!eventId) continue;
      await deleteFirestoreDocument({
        projectId,
        segments: ["offices", officeId, "matches", row.id, "timeline", eventId],
        accessToken
      });
      deleted.push({ type: "timeline", id: eventId, matchId: row.id });
    }
    await deleteFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "matches", row.id],
      accessToken
    });
    deleted.push(row);
  }

  const collectionFor = {
    operation: "operations",
    partySession: "partySessions",
    notification: "notifications",
    appointment: "deals",
    deal: "deals"
  };
  for (const type of ["operation", "partySession", "notification", "appointment", "deal"]) {
    for (const row of byType(type)) {
      const collection = collectionFor[type];
      if (!collection) continue;
      await deleteFirestoreDocument({
        projectId,
        segments: ["offices", officeId, collection, row.id],
        accessToken
      });
      deleted.push(row);
    }
  }

  for (const row of byType("cooperation")) {
    await deleteFirestoreDocument({
      projectId,
      segments: ["cooperationRequests", row.id],
      accessToken
    });
    deleted.push(row);
  }

  await deleteFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "opportunities", opportunityId],
    accessToken
  });
  deleted.push({ type: "opportunity", id: opportunityId, action: "delete", reason: "requested" });

  return { deleted, skipped };
}
