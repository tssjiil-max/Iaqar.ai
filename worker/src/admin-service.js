/**
 * Platform admin service — privileged Worker endpoints.
 */

import {
  ACTIVITY_LEVELS,
  applicationMatchesTab,
  backfillOfficeRecord,
  buildActivitySummary,
  buildOverviewCounts,
  officeMatchesTab,
  officeSearchMatch,
  sortOffices
} from "./admin-domain.js";
import { recordOfficeActivityEvent } from "./office-activity-service.js";

function docId(doc) {
  return String(doc?.name || "").split("/").pop();
}

function docToRow(doc, helpers) {
  const data = helpers.firestoreFieldsToJs(doc.fields || {});
  return { id: docId(doc), ...data };
}

async function listAllCollectionDocuments({ projectId, segments, accessToken, pageSize = 200, helpers }) {
  const out = [];
  let pageToken = "";
  do {
    const url = new URL(helpers.firestoreDocumentUrl(projectId, segments));
    url.searchParams.set("pageSize", String(pageSize));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (response.status === 404) break;
    if (!response.ok) throw helpers.appError("firestore_read_failed", 502, "تعذر قراءة بيانات الإدارة");
    const payload = await response.json();
    out.push(...(Array.isArray(payload.documents) ? payload.documents : []));
    pageToken = payload.nextPageToken || "";
  } while (pageToken);
  return out;
}

async function writeAdminAudit(helpers, {
  projectId,
  accessToken,
  officeId,
  action,
  performedBy,
  reason = "",
  before = null,
  after = null
}) {
  const auditId = `aud_${Date.now()}_${crypto.randomUUID().slice(0, 10)}`;
  const now = new Date();
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["adminAuditLogs", auditId],
    accessToken,
    fields: {
      officeId: helpers.firestoreString(officeId || ""),
      action: helpers.firestoreString(action),
      performedBy: helpers.firestoreString(performedBy),
      performedAt: helpers.firestoreTimestamp(now),
      reason: helpers.firestoreString(reason),
      beforeJson: helpers.firestoreString(JSON.stringify(before || {})),
      afterJson: helpers.firestoreString(JSON.stringify(after || {}))
    }
  });
  return auditId;
}


export function approvedOfficeDefaults(application, adminUid, now = new Date()) {
  return {
    approvalStatus: "approved",
    accountStatus: "active",
    subscriptionStatus: "trial",
    licenseStatus: "unknown",
    registeredAt: now.toISOString(),
    approvedAt: now.toISOString(),
    approvedByUid: adminUid,
    updatedAt: now.toISOString()
  };
}

export async function handleAdminSession(request, env, requestId, helpers) {
  helpers.assertFirebaseSecrets(env);
  const claims = await helpers.requirePlatformIdentity(request, env, true);
  return helpers.jsonResponse({
    ok: true,
    admin: {
      uid: String(claims.sub || claims.user_id || ""),
      email: String(claims.email || ""),
      platformAdmin: true
    },
    requestId
  });
}

export async function handleAdminOverview(request, env, requestId, helpers) {
  helpers.assertFirebaseSecrets(env);
  await helpers.requirePlatformIdentity(request, env, true);
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const [officeDocs, applicationDocs] = await Promise.all([
    listAllCollectionDocuments({ projectId, segments: ["offices"], accessToken, helpers }),
    listAllCollectionDocuments({ projectId, segments: ["brokerApplications"], accessToken, helpers })
  ]);
  const offices = officeDocs.map((doc) => backfillOfficeRecord(docToRow(doc, helpers)));
  const applications = applicationDocs.map((doc) => docToRow(doc, helpers));
  return helpers.jsonResponse({
    ok: true,
    overview: buildOverviewCounts(offices, applications),
    activityLevels: ACTIVITY_LEVELS,
    requestId
  });
}

export async function handleAdminOffices(request, url, env, requestId, helpers) {
  helpers.assertFirebaseSecrets(env);
  await helpers.requirePlatformIdentity(request, env, true);
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const tab = helpers.cleanText(url.searchParams.get("tab") || "all", 40) || "all";
  const search = helpers.cleanText(url.searchParams.get("search") || "", 120);
  const city = helpers.cleanText(url.searchParams.get("city") || "", 80);
  const sortKey = helpers.cleanText(url.searchParams.get("sort") || "registered_desc", 40);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));

  const [officeDocs, applicationDocs] = await Promise.all([
    listAllCollectionDocuments({ projectId, segments: ["offices"], accessToken, helpers }),
    listAllCollectionDocuments({ projectId, segments: ["brokerApplications"], accessToken, helpers })
  ]);

  let rows = [];
  if (tab === "pending" || tab === "rejected") {
    rows = applicationDocs
      .map((doc) => docToRow(doc, helpers))
      .filter((row) => applicationMatchesTab(row, tab))
      .map((row) => ({
        recordType: "application",
        applicationId: row.id,
        officeId: row.officeId || "",
        officeName: row.officeName,
        brokerName: row.brokerName,
        phone: row.phone,
        email: row.email,
        licenseNumber: row.falLicense,
        city: "المدينة المنورة",
        approvalStatus: tab,
        accountStatus: "active",
        registeredAt: row.createdAt,
        status: row.status
      }));
  } else {
    rows = officeDocs
      .map((doc) => backfillOfficeRecord(docToRow(doc, helpers)))
      .filter((row) => row.officeId !== "platform")
      .filter((row) => officeMatchesTab(row, tab))
      .map((row) => ({ recordType: "office", ...row }));
  }

  if (search) rows = rows.filter((row) => officeSearchMatch(row, search));
  if (city) rows = rows.filter((row) => helpers.safeText(row.city) === city);
  rows = sortOffices(rows, sortKey);
  const total = rows.length;
  const start = (page - 1) * limit;
  const items = rows.slice(start, start + limit);

  return helpers.jsonResponse({
    ok: true,
    tab,
    page,
    limit,
    total,
    items,
    requestId
  });
}

export async function handleAdminOfficeDetail(request, url, env, requestId, helpers) {
  helpers.assertFirebaseSecrets(env);
  await helpers.requirePlatformIdentity(request, env, true);
  const officeId = helpers.firestoreOfficeId(url.searchParams.get("officeId"));
  if (!officeId || officeId === "platform") throw helpers.appError("office_id_invalid", 400, "رمز المكتب غير صالح");
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const officeDoc = await helpers.getFirestoreDocument({
    projectId,
    segments: ["offices", officeId],
    accessToken,
    allowMissing: true
  });
  if (!officeDoc) throw helpers.appError("office_not_found", 404, "المكتب غير موجود");
  const office = backfillOfficeRecord(docToRow(officeDoc, helpers));
  const [notesDocs, auditDocs] = await Promise.all([
    listAllCollectionDocuments({ projectId, segments: ["offices", officeId, "adminNotes"], accessToken, pageSize: 50, helpers }),
    listAllCollectionDocuments({ projectId, segments: ["adminAuditLogs"], accessToken, pageSize: 200, helpers })
  ]);
  const notes = notesDocs.map((doc) => docToRow(doc, helpers)).sort((a, b) =>
    Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  const audit = auditDocs
    .map((doc) => docToRow(doc, helpers))
    .filter((row) => row.officeId === officeId)
    .sort((a, b) => Date.parse(b.performedAt || 0) - Date.parse(a.performedAt || 0))
    .slice(0, 50);

  return helpers.jsonResponse({ ok: true, office, notes, audit, requestId });
}

export async function handleAdminOfficeActivity(request, url, env, requestId, helpers) {
  helpers.assertFirebaseSecrets(env);
  await helpers.requirePlatformIdentity(request, env, true);
  const officeId = helpers.firestoreOfficeId(url.searchParams.get("officeId"));
  if (!officeId || officeId === "platform") throw helpers.appError("office_id_invalid", 400, "رمز المكتب غير صالح");
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const officeDoc = await helpers.getFirestoreDocument({
    projectId,
    segments: ["offices", officeId],
    accessToken,
    allowMissing: true
  });
  if (!officeDoc) throw helpers.appError("office_not_found", 404, "المكتب غير موجود");
  const office = backfillOfficeRecord(docToRow(officeDoc, helpers));

  const [opportunities, operations, matches, publicIntake, activityEvents] = await Promise.all([
    listAllCollectionDocuments({ projectId, segments: ["offices", officeId, "opportunities"], accessToken, pageSize: 200, helpers }),
    listAllCollectionDocuments({ projectId, segments: ["offices", officeId, "operations"], accessToken, pageSize: 200, helpers }),
    listAllCollectionDocuments({ projectId, segments: ["offices", officeId, "matches"], accessToken, pageSize: 200, helpers }),
    listAllCollectionDocuments({ projectId, segments: ["offices", officeId, "publicIntake"], accessToken, pageSize: 200, helpers }),
    listAllCollectionDocuments({ projectId, segments: ["offices", officeId, "activityEvents"], accessToken, pageSize: 100, helpers })
  ]);

  const summary = buildActivitySummary({
    office,
    opportunities: opportunities.map((doc) => docToRow(doc, helpers)),
    operations: operations.map((doc) => docToRow(doc, helpers)),
    matches: matches.map((doc) => docToRow(doc, helpers)),
    publicIntake: publicIntake.map((doc) => docToRow(doc, helpers)),
    activityEvents: activityEvents.map((doc) => ({
      ...docToRow(doc, helpers),
      eventType: docToRow(doc, helpers).eventType
    }))
  });

  return helpers.jsonResponse({
    ok: true,
    officeId,
    activity: summary,
    activityLevels: ACTIVITY_LEVELS,
    requestId
  });
}

export async function handleAdminSuspend(request, env, requestId, helpers) {
  helpers.assertFirebaseSecrets(env);
  const admin = await helpers.requirePlatformIdentity(request, env, true);
  const body = await request.json().catch(() => ({}));
  const officeId = helpers.firestoreOfficeId(body.officeId);
  const reason = helpers.cleanText(body.reason, 500);
  if (!officeId || officeId === "platform") throw helpers.appError("office_id_invalid", 400, "رمز المكتب غير صالح");
  if (reason.length < 4) throw helpers.appError("reason_required", 400, "يلزم ذكر سبب الإيقاف");
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const officeDoc = await helpers.getFirestoreDocument({ projectId, segments: ["offices", officeId], accessToken });
  const before = backfillOfficeRecord(helpers.firestoreFieldsToJs(officeDoc.fields || {}));
  const now = new Date();
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId],
    accessToken,
    fields: {
      officeId: helpers.firestoreString(officeId),
      accountStatus: helpers.firestoreString("suspended"),
      suspendedAt: helpers.firestoreTimestamp(now),
      suspendedBy: helpers.firestoreString(admin.sub),
      suspensionReason: helpers.firestoreString(reason),
      updatedAt: helpers.firestoreTimestamp(now)
    }
  });
  const after = { ...before, accountStatus: "suspended", suspensionReason: reason };
  const auditId = await writeAdminAudit(helpers, {
    projectId,
    accessToken,
    officeId,
    action: "office_suspended",
    performedBy: admin.sub,
    reason,
    before,
    after
  });
  await recordOfficeActivityEvent(helpers, { projectId, accessToken, officeId, eventType: "office_suspended", metadata: { reason } });
  return helpers.jsonResponse({ ok: true, officeId, auditId, requestId });
}

export async function handleAdminReactivate(request, env, requestId, helpers) {
  helpers.assertFirebaseSecrets(env);
  const admin = await helpers.requirePlatformIdentity(request, env, true);
  const body = await request.json().catch(() => ({}));
  const officeId = helpers.firestoreOfficeId(body.officeId);
  const reason = helpers.cleanText(body.reason, 500);
  if (!officeId || officeId === "platform") throw helpers.appError("office_id_invalid", 400, "رمز المكتب غير صالح");
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const officeDoc = await helpers.getFirestoreDocument({ projectId, segments: ["offices", officeId], accessToken });
  const before = backfillOfficeRecord(helpers.firestoreFieldsToJs(officeDoc.fields || {}));
  const now = new Date();
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId],
    accessToken,
    fields: {
      officeId: helpers.firestoreString(officeId),
      accountStatus: helpers.firestoreString("active"),
      reactivatedAt: helpers.firestoreTimestamp(now),
      reactivatedBy: helpers.firestoreString(admin.sub),
      suspensionReason: helpers.firestoreString(""),
      updatedAt: helpers.firestoreTimestamp(now)
    }
  });
  const after = { ...before, accountStatus: "active" };
  const auditId = await writeAdminAudit(helpers, {
    projectId,
    accessToken,
    officeId,
    action: "office_reactivated",
    performedBy: admin.sub,
    reason,
    before,
    after
  });
  await recordOfficeActivityEvent(helpers, { projectId, accessToken, officeId, eventType: "office_reactivated", metadata: { reason } });
  return helpers.jsonResponse({ ok: true, officeId, auditId, requestId });
}

export async function handleAdminSubscriptionUpdate(request, env, requestId, helpers) {
  helpers.assertFirebaseSecrets(env);
  const admin = await helpers.requirePlatformIdentity(request, env, true);
  const body = await request.json().catch(() => ({}));
  const officeId = helpers.firestoreOfficeId(body.officeId);
  const subscriptionStatus = helpers.cleanText(body.subscriptionStatus, 40);
  const subscriptionExpiresAt = body.subscriptionExpiresAt ? new Date(body.subscriptionExpiresAt) : null;
  if (!officeId || officeId === "platform") throw helpers.appError("office_id_invalid", 400, "رمز المكتب غير صالح");
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const officeDoc = await helpers.getFirestoreDocument({ projectId, segments: ["offices", officeId], accessToken });
  const before = backfillOfficeRecord(helpers.firestoreFieldsToJs(officeDoc.fields || {}));
  const now = new Date();
  const fields = {
    officeId: helpers.firestoreString(officeId),
    subscriptionStatus: helpers.firestoreString(subscriptionStatus || before.subscriptionStatus),
    updatedAt: helpers.firestoreTimestamp(now)
  };
  if (subscriptionExpiresAt && !Number.isNaN(subscriptionExpiresAt.getTime())) {
    fields.subscriptionExpiresAt = helpers.firestoreTimestamp(subscriptionExpiresAt);
  }
  await helpers.setFirestoreDocument({ projectId, segments: ["offices", officeId], accessToken, fields });
  const auditId = await writeAdminAudit(helpers, {
    projectId,
    accessToken,
    officeId,
    action: "subscription_updated",
    performedBy: admin.sub,
    before,
    after: { ...before, subscriptionStatus, subscriptionExpiresAt }
  });
  return helpers.jsonResponse({ ok: true, officeId, auditId, requestId });
}

const PREVIOUS_OWNER_ROLES = Object.freeze(["manager", "broker", "inactive"]);

/**
 * Ownership transfer (D-020): platform admin only. The new owner must already be an active member of
 * the office. offices/{o}.ownerUid and both member docs change in one atomic commit guarded by each
 * document's updateTime, and the change is written to adminAuditLogs with before/after.
 */
export async function handleAdminOwnerTransfer(request, env, requestId, helpers) {
  helpers.assertFirebaseSecrets(env);
  const admin = await helpers.requirePlatformIdentity(request, env, true);
  const body = await request.json().catch(() => ({}));
  const officeId = helpers.firestoreOfficeId(body.officeId);
  const newOwnerUid = helpers.cleanText(body.newOwnerUid, 128);
  const reason = helpers.cleanText(body.reason, 500);
  const previousOwnerRole = helpers.cleanText(body.previousOwnerRole || "manager", 20);
  if (!officeId || officeId === "platform") throw helpers.appError("office_id_invalid", 400, "رمز المكتب غير صالح");
  if (!newOwnerUid) throw helpers.appError("new_owner_required", 400, "حدّد المالك الجديد");
  if (reason.length < 4) throw helpers.appError("reason_required", 400, "يلزم ذكر سبب نقل الملكية");
  if (!PREVIOUS_OWNER_ROLES.includes(previousOwnerRole)) throw helpers.appError("previous_owner_role_invalid", 400, "دور المالك السابق غير صالح");

  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const officeDoc = await helpers.getFirestoreDocument({ projectId, segments: ["offices", officeId], accessToken, allowMissing: true });
  if (!officeDoc) throw helpers.appError("office_not_found", 404, "المكتب غير موجود");
  const office = helpers.firestoreFieldsToJs(officeDoc.fields || {});
  const previousOwnerUid = String(office.ownerUid || "");
  if (newOwnerUid === previousOwnerUid) throw helpers.appError("already_owner", 409, "هذا الحساب هو المالك الحالي");

  const newMemberDoc = await helpers.getFirestoreDocument({ projectId, segments: ["offices", officeId, "members", newOwnerUid], accessToken, allowMissing: true });
  const newMember = newMemberDoc ? helpers.firestoreFieldsToJs(newMemberDoc.fields || {}) : null;
  if (!newMember || newMember.active === false) {
    throw helpers.appError("new_owner_not_member", 409, "المالك الجديد يجب أن يكون عضوًا فعّالًا في المكتب");
  }
  const previousMemberDoc = previousOwnerUid
    ? await helpers.getFirestoreDocument({ projectId, segments: ["offices", officeId, "members", previousOwnerUid], accessToken, allowMissing: true })
    : null;

  const now = new Date();
  const stamp = helpers.firestoreTimestamp(now);
  const writes = [
    helpers.buildFirestoreUpdateWrite({
      projectId, segments: ["offices", officeId], precondition: { updateTime: officeDoc.updateTime },
      fields: { ownerUid: helpers.firestoreString(newOwnerUid), updatedAt: stamp }
    }),
    helpers.buildFirestoreUpdateWrite({
      projectId, segments: ["offices", officeId, "members", newOwnerUid], precondition: { updateTime: newMemberDoc.updateTime },
      fields: { role: helpers.firestoreString("owner"), active: helpers.firestoreBoolean(true), updatedAt: stamp, updatedBy: helpers.firestoreString(admin.sub) }
    })
  ];
  if (previousMemberDoc) {
    const previousFields = previousOwnerRole === "inactive"
      ? { active: helpers.firestoreBoolean(false) }
      : { role: helpers.firestoreString(previousOwnerRole) };
    writes.push(helpers.buildFirestoreUpdateWrite({
      projectId, segments: ["offices", officeId, "members", previousOwnerUid], precondition: { updateTime: previousMemberDoc.updateTime },
      fields: { ...previousFields, updatedAt: stamp, updatedBy: helpers.firestoreString(admin.sub) }
    }));
  }
  await helpers.commitFirestoreWrites({ projectId, accessToken, writes });

  const auditId = await writeAdminAudit(helpers, {
    projectId,
    accessToken,
    officeId,
    action: "office_owner_transferred",
    performedBy: admin.sub,
    reason,
    before: { ownerUid: previousOwnerUid },
    after: { ownerUid: newOwnerUid, previousOwnerRole }
  });
  await recordOfficeActivityEvent(helpers, { projectId, accessToken, officeId, eventType: "office_owner_transferred", metadata: { reason } });
  return helpers.jsonResponse({ ok: true, officeId, ownerUid: newOwnerUid, auditId, requestId });
}

export async function handleAdminLicenseUpdate(request, env, requestId, helpers) {
  helpers.assertFirebaseSecrets(env);
  const admin = await helpers.requirePlatformIdentity(request, env, true);
  const body = await request.json().catch(() => ({}));
  const officeId = helpers.firestoreOfficeId(body.officeId);
  const licenseExpiresAt = body.licenseExpiresAt ? new Date(body.licenseExpiresAt) : null;
  if (!officeId || officeId === "platform") throw helpers.appError("office_id_invalid", 400, "رمز المكتب غير صالح");
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const officeDoc = await helpers.getFirestoreDocument({ projectId, segments: ["offices", officeId], accessToken });
  const before = backfillOfficeRecord(helpers.firestoreFieldsToJs(officeDoc.fields || {}));
  const now = new Date();
  const fields = {
    officeId: helpers.firestoreString(officeId),
    updatedAt: helpers.firestoreTimestamp(now)
  };
  if (licenseExpiresAt && !Number.isNaN(licenseExpiresAt.getTime())) {
    fields.licenseExpiresAt = helpers.firestoreTimestamp(licenseExpiresAt);
  }
  await helpers.setFirestoreDocument({ projectId, segments: ["offices", officeId], accessToken, fields });
  const auditId = await writeAdminAudit(helpers, {
    projectId,
    accessToken,
    officeId,
    action: "license_updated",
    performedBy: admin.sub,
    before,
    after: { ...before, licenseExpiresAt }
  });
  return helpers.jsonResponse({ ok: true, officeId, auditId, requestId });
}

export async function handleAdminNoteAdd(request, env, requestId, helpers) {
  helpers.assertFirebaseSecrets(env);
  const admin = await helpers.requirePlatformIdentity(request, env, true);
  const body = await request.json().catch(() => ({}));
  const officeId = helpers.firestoreOfficeId(body.officeId);
  const note = helpers.cleanText(body.note, 2000);
  if (!officeId || officeId === "platform") throw helpers.appError("office_id_invalid", 400, "رمز المكتب غير صالح");
  if (note.length < 2) throw helpers.appError("note_required", 400, "الملاحظة مطلوبة");
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const noteId = `note_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "adminNotes", noteId],
    accessToken,
    fields: {
      officeId: helpers.firestoreString(officeId),
      note: helpers.firestoreString(note),
      createdBy: helpers.firestoreString(admin.sub),
      createdAt: helpers.firestoreTimestamp(now)
    }
  });
  const auditId = await writeAdminAudit(helpers, {
    projectId,
    accessToken,
    officeId,
    action: "admin_note_added",
    performedBy: admin.sub,
    after: { noteId, note }
  });
  return helpers.jsonResponse({ ok: true, officeId, noteId, auditId, requestId });
}

export async function handleAdminAuditLog(request, url, env, requestId, helpers) {
  helpers.assertFirebaseSecrets(env);
  await helpers.requirePlatformIdentity(request, env, true);
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 100)));
  const officeId = helpers.firestoreOfficeId(url.searchParams.get("officeId") || "");
  const docs = await listAllCollectionDocuments({ projectId, segments: ["adminAuditLogs"], accessToken, helpers });
  let items = docs.map((doc) => docToRow(doc, helpers));
  if (officeId) items = items.filter((row) => row.officeId === officeId);
  items.sort((a, b) => Date.parse(b.performedAt || 0) - Date.parse(a.performedAt || 0));
  return helpers.jsonResponse({ ok: true, items: items.slice(0, limit), requestId });
}

export function createAdminHelpers(bundle) {
  return {
    ...bundle,
    safeText: (value, fallback = "") => String(value == null ? fallback : value).trim()
  };
}
