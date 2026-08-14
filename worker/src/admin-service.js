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

async function recordActivityEvent(helpers, {
  projectId,
  accessToken,
  officeId,
  eventType,
  metadata = {}
}) {
  if (!officeId || officeId === "platform") return;
  const eventId = `evt_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "activityEvents", eventId],
    accessToken,
    fields: {
      officeId: helpers.firestoreString(officeId),
      eventType: helpers.firestoreString(eventType),
      occurredAt: helpers.firestoreTimestamp(now),
      metadataJson: helpers.firestoreString(JSON.stringify(metadata || {}))
    }
  });
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId],
    accessToken,
    fields: {
      officeId: helpers.firestoreString(officeId),
      lastActivityAt: helpers.firestoreTimestamp(now),
      ...(eventType === "login" ? { lastLoginAt: helpers.firestoreTimestamp(now) } : {})
    }
  });
}

export async function recordAdminActivityEvent(helpers, args) {
  return recordActivityEvent(helpers, args);
}

export async function recordOfficeLoginActivity(helpers, { projectId, accessToken, officeId, uid }) {
  await recordActivityEvent(helpers, {
    projectId,
    accessToken,
    officeId,
    eventType: "login",
    metadata: { uid: uid || "" }
  });
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

export async function handleAdminApplications(request, url, env, requestId, helpers) {
  helpers.assertFirebaseSecrets(env);
  await helpers.requirePlatformIdentity(request, env, true);
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const tab = helpers.cleanText(url.searchParams.get("tab") || "pending", 40) || "pending";
  const search = helpers.cleanText(url.searchParams.get("search") || "", 120);
  const sortKey = helpers.cleanText(url.searchParams.get("sort") || "registered_desc", 40);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));

  const applicationDocs = await listAllCollectionDocuments({
    projectId, segments: ["brokerApplications"], accessToken, helpers
  });

  let rows = applicationDocs
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
      city: row.city || "المدينة المنورة",
      status: row.status,
      registeredAt: row.createdAt,
      decidedAt: row.decidedAt || null,
      decidedByUid: row.decidedByUid || null,
      reviewStartedAt: row.reviewStartedAt || null
    }));

  if (search) rows = rows.filter((row) => officeSearchMatch(row, search));
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

  const [officeDocs] = await Promise.all([
    listAllCollectionDocuments({ projectId, segments: ["offices"], accessToken, helpers })
  ]);

  const rows = officeDocs
    .map((doc) => backfillOfficeRecord(docToRow(doc, helpers)))
    .filter((row) => row.officeId !== "platform")
    .filter((row) => officeMatchesTab(row, tab))
    .map((row) => ({ recordType: "office", ...row }));

  let filtered = rows;
  if (search) filtered = filtered.filter((row) => officeSearchMatch(row, search));
  if (city) filtered = filtered.filter((row) => helpers.safeText(row.city) === city);
  filtered = sortOffices(filtered, sortKey);
  const total = filtered.length;
  const start = (page - 1) * limit;
  const items = filtered.slice(start, start + limit);

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
  const officeId = helpers.normalizeOfficeId(url.searchParams.get("officeId"));
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
  const officeId = helpers.normalizeOfficeId(url.searchParams.get("officeId"));
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
  const officeId = helpers.normalizeOfficeId(body.officeId);
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
  await recordActivityEvent(helpers, { projectId, accessToken, officeId, eventType: "office_suspended", metadata: { reason } });
  return helpers.jsonResponse({ ok: true, officeId, auditId, requestId });
}

export async function handleAdminReactivate(request, env, requestId, helpers) {
  helpers.assertFirebaseSecrets(env);
  const admin = await helpers.requirePlatformIdentity(request, env, true);
  const body = await request.json().catch(() => ({}));
  const officeId = helpers.normalizeOfficeId(body.officeId);
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
  await recordActivityEvent(helpers, { projectId, accessToken, officeId, eventType: "office_reactivated", metadata: { reason } });
  return helpers.jsonResponse({ ok: true, officeId, auditId, requestId });
}

export async function handleAdminSubscriptionUpdate(request, env, requestId, helpers) {
  helpers.assertFirebaseSecrets(env);
  const admin = await helpers.requirePlatformIdentity(request, env, true);
  const body = await request.json().catch(() => ({}));
  const officeId = helpers.normalizeOfficeId(body.officeId);
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

export async function handleAdminLicenseUpdate(request, env, requestId, helpers) {
  helpers.assertFirebaseSecrets(env);
  const admin = await helpers.requirePlatformIdentity(request, env, true);
  const body = await request.json().catch(() => ({}));
  const officeId = helpers.normalizeOfficeId(body.officeId);
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
  const officeId = helpers.normalizeOfficeId(body.officeId);
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
  const officeId = helpers.normalizeOfficeId(url.searchParams.get("officeId") || "");
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
