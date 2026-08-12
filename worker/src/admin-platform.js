/**
 * IAQAR.AI Platform Admin Console — server-side handlers.
 * All routes require platformAdmin/admin JWT claims (enforced via injected requirePlatformIdentity).
 */

const ACTIVITY_TYPES = Object.freeze([
  "login", "opportunity_created", "opportunity_updated", "match_reviewed",
  "operation_completed", "public_owner_submission", "public_client_submission"
]);

const ROLLUP_FIELDS = Object.freeze([
  "logins", "opportunitiesCreated", "matchesReviewed", "operationsCompleted",
  "publicOwnerSubmissions", "publicClientSubmissions"
]);

function dayIdFromDate(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function parseTs(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function daysUntil(ts) {
  if (!ts) return null;
  const ms = parseTs(ts);
  if (!ms) return null;
  return Math.ceil((ms - Date.now()) / 86400000);
}

function deriveLicenseStatus(expiresAt) {
  const days = daysUntil(expiresAt);
  if (!expiresAt) return "unknown";
  if (days < 0) return "expired";
  if (days <= 30) return "expiring";
  return "valid";
}

function deriveSubscriptionStatus(data) {
  const explicit = String(data.subscriptionStatus || "").trim();
  if (["trial", "active", "expiring", "expired", "none"].includes(explicit)) return explicit;
  const expiresAt = data.subscriptionExpiresAt;
  if (!expiresAt) return "none";
  const days = daysUntil(expiresAt);
  if (days < 0) return "expired";
  if (days <= 30) return "expiring";
  return "active";
}

function normalizeApprovalStatus(data) {
  const s = String(data.approvalStatus || "").trim();
  if (["pending", "approved", "rejected"].includes(s)) return s;
  if (data.ownerUid && data.approvedAt) return "approved";
  if (data.ownerUid) return "approved";
  return "pending";
}

function normalizeAccountStatus(data) {
  const s = String(data.accountStatus || "").trim();
  if (["active", "suspended"].includes(s)) return s;
  return "active";
}

function productActivityScore(office) {
  const o = office.activitySummary || office;
  const created30 = Number(o.opportunitiesCreated30d || 0);
  const reviewed30 = Number(o.matchesReviewed30d || 0);
  const completed30 = Number(o.completedOperations30d || 0);
  const created7 = Number(o.opportunitiesCreated7d || 0);
  const reviewed7 = Number(o.matchesReviewed7d || 0);
  const completed7 = Number(o.completedOperations7d || 0);
  const product7 = created7 + reviewed7 + completed7;
  const product30 = created30 + reviewed30 + completed30;
  const lastActivity = parseTs(o.lastActivityAt || office.lastActivityAt);
  const daysSinceActivity = lastActivity ? (Date.now() - lastActivity) / 86400000 : 999;
  return { product7, product30, daysSinceActivity, lastActivity };
}

function computeActivityLevel(office) {
  const { product7, product30, daysSinceActivity, lastActivity } = productActivityScore(office);
  if (product7 >= 2) return "very_active";
  if (product30 >= 1) return "active";
  if (lastActivity && daysSinceActivity <= 14 && product30 === 0) return "low";
  if (!lastActivity || daysSinceActivity > 30) return "inactive";
  if (product30 >= 1) return "active";
  return "low";
}

function activityLevelLabel(level) {
  return {
    very_active: "نشط جدًا",
    active: "نشط",
    low: "نشاط منخفض",
    inactive: "غير نشط"
  }[level] || "غير نشط";
}

function officeDocIdFromName(doc) {
  return String(doc.name || "").split("/").pop() || "";
}

function normalizeOfficeRecord(raw, officeId) {
  const data = raw || {};
  const licenseExpiresAt = data.falLicenseExpiresAt || null;
  const subscriptionExpiresAt = data.subscriptionExpiresAt || null;
  const approvalStatus = normalizeApprovalStatus(data);
  const accountStatus = normalizeAccountStatus(data);
  const licenseStatus = String(data.licenseStatus || "").trim() || deriveLicenseStatus(licenseExpiresAt);
  const subscriptionStatus = deriveSubscriptionStatus(data);
  const summary = {
    lastActivityAt: data.lastActivityAt || null,
    lastLoginAt: data.lastLoginAt || null,
    loginCount7d: Number(data.loginCount7d || 0),
    loginCount30d: Number(data.loginCount30d || 0),
    opportunitiesCreated7d: Number(data.opportunitiesCreated7d || 0),
    opportunitiesCreated30d: Number(data.opportunitiesCreated30d || 0),
    activeOpportunitiesCount: Number(data.activeOpportunitiesCount || 0),
    matchesReviewed30d: Number(data.matchesReviewed30d || 0),
    completedOperations30d: Number(data.completedOperations30d || 0),
    publicOwnerSubmissions30d: Number(data.publicOwnerSubmissions30d || 0),
    publicClientSubmissions30d: Number(data.publicClientSubmissions30d || 0)
  };
  const activityLevel = computeActivityLevel({ ...data, activitySummary: summary });
  return {
    officeId,
    officeName: data.officeName || null,
    licenseeName: data.licenseeName || data.brokerName || null,
    phone: data.phone || null,
    email: data.email || null,
    city: data.city || null,
    falLicenseNumber: data.falLicenseNumber || data.licenseNumber || null,
    falLicenseIssuedAt: data.falLicenseIssuedAt || null,
    falLicenseExpiresAt: licenseExpiresAt,
    createdAt: data.createdAt || null,
    registrationSubmittedAt: data.registrationSubmittedAt || data.createdAt || null,
    approvedAt: data.approvedAt || null,
    approvedBy: data.approvedBy || data.approvedByUid || null,
    rejectedAt: data.rejectedAt || null,
    rejectedBy: data.rejectedBy || data.rejectedByUid || null,
    rejectionReason: data.rejectionReason || null,
    approvalStatus,
    accountStatus,
    licenseStatus,
    subscriptionStatus,
    subscriptionStartedAt: data.subscriptionStartedAt || null,
    subscriptionExpiresAt: subscriptionExpiresAt,
    lastLoginAt: summary.lastLoginAt,
    lastActivityAt: summary.lastActivityAt,
    suspendedAt: data.suspendedAt || null,
    suspendedBy: data.suspendedBy || data.suspendedByUid || null,
    suspensionReason: data.suspensionReason || null,
    reactivatedAt: data.reactivatedAt || null,
    updatedAt: data.updatedAt || null,
    ownerUid: data.ownerUid || null,
    activityLevel,
    activityLevelLabel: activityLevelLabel(activityLevel),
    activitySummary: summary,
    subscriptionDaysRemaining: daysUntil(subscriptionExpiresAt),
    licenseDaysRemaining: daysUntil(licenseExpiresAt)
  };
}

export function createAdminHandlers(deps) {
  const {
    assertFirebaseSecrets,
    requirePlatformIdentity,
    getGoogleAccessToken,
    getFirestoreDocument,
    setFirestoreDocument,
    listCollectionDocuments,
    firestoreDocumentUrl,
    firestoreFieldsToJs,
    firestoreString,
    firestoreOptionalString,
    firestoreBoolean,
    firestoreInteger,
    firestoreTimestamp,
    compactFields,
    normalizeOfficeId,
    cleanText,
    appError,
    jsonResponse,
    sha256Hex,
    normalizeLoginPhone
  } = deps;

  async function listAllCollectionDocuments({ projectId, segments, accessToken, pageSize = 100 }) {
    const docs = [];
    let pageToken = "";
    do {
      const url = new URL(firestoreDocumentUrl(projectId, segments));
      url.searchParams.set("pageSize", String(pageSize));
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (response.status === 404) break;
      if (!response.ok) throw appError("firestore_read_failed", 502, "تعذر قراءة البيانات");
      const payload = await response.json();
      if (Array.isArray(payload.documents)) docs.push(...payload.documents);
      pageToken = payload.nextPageToken || "";
    } while (pageToken);
    return docs;
  }

  async function writeAdminAudit({ projectId, accessToken, entry }) {
    const id = `audit_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date();
    await setFirestoreDocument({
      projectId,
      segments: ["adminAuditLog", id],
      accessToken,
      fields: compactFields({
        officeId: firestoreOptionalString(entry.officeId || ""),
        action: firestoreString(entry.action),
        performedBy: firestoreString(entry.performedBy),
        performedAt: firestoreTimestamp(now),
        reason: firestoreOptionalString(entry.reason || ""),
        beforeJson: firestoreOptionalString(entry.before ? JSON.stringify(entry.before) : ""),
        afterJson: firestoreOptionalString(entry.after ? JSON.stringify(entry.after) : "")
      })
    });
    return id;
  }

  async function incrementRollup({ projectId, officeId, accessToken, field, now = new Date() }) {
    const dayId = dayIdFromDate(now);
    const segments = ["offices", officeId, "activityRollup", dayId];
    const existing = await getFirestoreDocument({ projectId, segments, accessToken, allowMissing: true });
    const current = existing ? firestoreFieldsToJs(existing.fields || {}) : {};
    const next = Number(current[field] || 0) + 1;
    await setFirestoreDocument({
      projectId,
      segments,
      accessToken,
      fields: compactFields({
        dayId: firestoreString(dayId),
        officeId: firestoreString(officeId),
        [field]: firestoreInteger(next),
        updatedAt: firestoreTimestamp(now)
      })
    });
  }

  async function sumRollups({ projectId, officeId, accessToken, days }) {
    const totals = Object.fromEntries(ROLLUP_FIELDS.map(f => [f, 0]));
    const now = new Date();
    for (let i = 0; i < days; i += 1) {
      const d = new Date(now.getTime() - i * 86400000);
      const dayId = dayIdFromDate(d);
      const doc = await getFirestoreDocument({
        projectId,
        segments: ["offices", officeId, "activityRollup", dayId],
        accessToken,
        allowMissing: true
      });
      if (!doc) continue;
      const data = firestoreFieldsToJs(doc.fields || {});
      for (const field of ROLLUP_FIELDS) totals[field] += Number(data[field] || 0);
    }
    return totals;
  }

  async function countActiveOpportunities({ projectId, officeId, accessToken }) {
    const docs = await listCollectionDocuments({
      projectId,
      segments: ["offices", officeId, "opportunities"],
      accessToken,
      pageSize: 200
    });
    return docs.filter(doc => {
      const data = firestoreFieldsToJs(doc.fields || {});
      const stage = String(data.workflowStage || data.status || "new");
      return !["closed", "archived", "fulfilled"].includes(stage);
    }).length;
  }

  async function refreshOfficeActivitySummary({ projectId, officeId, accessToken }) {
    const rollup7 = await sumRollups({ projectId, officeId, accessToken, days: 7 });
    const rollup30 = await sumRollups({ projectId, officeId, accessToken, days: 30 });
    const activeOpportunitiesCount = await countActiveOpportunities({ projectId, officeId, accessToken });
    const now = new Date();
    const officeDoc = await getFirestoreDocument({ projectId, segments: ["offices", officeId], accessToken, allowMissing: true });
    const office = officeDoc ? firestoreFieldsToJs(officeDoc.fields || {}) : {};
    await setFirestoreDocument({
      projectId,
      segments: ["offices", officeId],
      accessToken,
      fields: compactFields({
        loginCount7d: firestoreInteger(rollup7.logins || 0),
        loginCount30d: firestoreInteger(rollup30.logins || 0),
        opportunitiesCreated7d: firestoreInteger(rollup7.opportunitiesCreated || 0),
        opportunitiesCreated30d: firestoreInteger(rollup30.opportunitiesCreated || 0),
        matchesReviewed7d: firestoreInteger(rollup7.matchesReviewed || 0),
        matchesReviewed30d: firestoreInteger(rollup30.matchesReviewed || 0),
        completedOperations7d: firestoreInteger(rollup7.operationsCompleted || 0),
        completedOperations30d: firestoreInteger(rollup30.operationsCompleted || 0),
        publicOwnerSubmissions30d: firestoreInteger(rollup30.publicOwnerSubmissions || 0),
        publicClientSubmissions30d: firestoreInteger(rollup30.publicClientSubmissions || 0),
        activeOpportunitiesCount: firestoreInteger(activeOpportunitiesCount),
        lastLoginAt: office.lastLoginAt ? firestoreTimestamp(new Date(office.lastLoginAt)) : null,
        lastActivityAt: office.lastActivityAt ? firestoreTimestamp(new Date(office.lastActivityAt)) : null,
        updatedAt: firestoreTimestamp(now)
      })
    });
  }

  async function recordOfficeActivity({
    projectId, officeId, accessToken, type, actorUid = "", source = "worker", metadata = {}, now = new Date()
  }) {
    if (!officeId || officeId === "platform" || !ACTIVITY_TYPES.includes(type)) return;
    const eventId = `evt_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const rollupField = {
      login: "logins",
      opportunity_created: "opportunitiesCreated",
      opportunity_updated: "opportunitiesCreated",
      match_reviewed: "matchesReviewed",
      operation_completed: "operationsCompleted",
      public_owner_submission: "publicOwnerSubmissions",
      public_client_submission: "publicClientSubmissions"
    }[type];
    await setFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "activityEvents", eventId],
      accessToken,
      fields: compactFields({
        officeId: firestoreString(officeId),
        type: firestoreString(type),
        createdAt: firestoreTimestamp(now),
        actorUid: firestoreOptionalString(actorUid),
        source: firestoreString(source),
        metadataJson: firestoreOptionalString(Object.keys(metadata).length ? JSON.stringify(metadata) : "")
      })
    });
    const officePatch = {
      lastActivityAt: firestoreTimestamp(now),
      updatedAt: firestoreTimestamp(now)
    };
    if (type === "login") officePatch.lastLoginAt = firestoreTimestamp(now);
    await setFirestoreDocument({
      projectId,
      segments: ["offices", officeId],
      accessToken,
      fields: officePatch
    });
    if (rollupField) await incrementRollup({ projectId, officeId, accessToken, field: rollupField, now });
    await refreshOfficeActivitySummary({ projectId, officeId, accessToken });
  }

  async function loadAllOffices(projectId, accessToken) {
    const docs = await listAllCollectionDocuments({ projectId, segments: ["offices"], accessToken });
    return docs
      .map(doc => normalizeOfficeRecord(firestoreFieldsToJs(doc.fields || {}), officeDocIdFromName(doc)))
      .filter(o => o.officeId && o.officeId !== "platform");
  }

  function filterOffices(offices, params) {
    let list = [...offices];
    const tab = cleanText(params.tab, 40);
    if (tab === "pending") list = list.filter(o => o.approvalStatus === "pending");
    else if (tab === "approved") list = list.filter(o => o.approvalStatus === "approved");
    else if (tab === "suspended") list = list.filter(o => o.accountStatus === "suspended");
    else if (tab === "expired") list = list.filter(o => o.subscriptionStatus === "expired" || o.licenseStatus === "expired");
    else if (tab === "rejected") list = list.filter(o => o.approvalStatus === "rejected");

    const q = cleanText(params.q, 120).toLowerCase();
    if (q) {
      list = list.filter(o => [
        o.officeName, o.licenseeName, o.phone, o.falLicenseNumber, o.officeId
      ].some(v => String(v || "").toLowerCase().includes(q)));
    }
    const city = cleanText(params.city, 80);
    if (city) list = list.filter(o => String(o.city || "") === city);
    if (params.approvalStatus) list = list.filter(o => o.approvalStatus === params.approvalStatus);
    if (params.accountStatus) list = list.filter(o => o.accountStatus === params.accountStatus);
    if (params.subscriptionStatus) list = list.filter(o => o.subscriptionStatus === params.subscriptionStatus);
    if (params.licenseStatus) list = list.filter(o => o.licenseStatus === params.licenseStatus);
    if (params.activityLevel) list = list.filter(o => o.activityLevel === params.activityLevel);

    const sort = cleanText(params.sort, 40) || "newest";
    const ts = v => parseTs(v) || 0;
    list.sort((a, b) => {
      switch (sort) {
        case "oldest": return ts(a.registrationSubmittedAt || a.createdAt) - ts(b.registrationSubmittedAt || b.createdAt);
        case "last_login": return ts(b.lastLoginAt) - ts(a.lastLoginAt);
        case "last_activity": return ts(b.lastActivityAt) - ts(a.lastActivityAt);
        case "most_active": return productActivityScore(b).product30 - productActivityScore(a).product30;
        case "least_active": return productActivityScore(a).product30 - productActivityScore(b).product30;
        case "subscription_expiry": return ts(a.subscriptionExpiresAt) - ts(b.subscriptionExpiresAt);
        case "license_expiry": return ts(a.falLicenseExpiresAt) - ts(b.falLicenseExpiresAt);
        default: return ts(b.registrationSubmittedAt || b.createdAt) - ts(a.registrationSubmittedAt || a.createdAt);
      }
    });
    return list;
  }

  async function handleAdminOverview(request, env, requestId) {
    assertFirebaseSecrets(env);
    await requirePlatformIdentity(request, env, true);
    const projectId = env.FIREBASE_PROJECT_ID || deps.DEFAULT_PROJECT_ID;
    const accessToken = await getGoogleAccessToken(env);
    const offices = await loadAllOffices(projectId, accessToken);
    const now = Date.now();
    const weekAgo = now - 7 * 86400000;
    const monthAgo = now - 30 * 86400000;
    const counters = {
      totalOffices: offices.length,
      pendingApproval: offices.filter(o => o.approvalStatus === "pending").length,
      approved: offices.filter(o => o.approvalStatus === "approved").length,
      activeAccounts: offices.filter(o => o.approvalStatus === "approved" && o.accountStatus === "active").length,
      suspended: offices.filter(o => o.accountStatus === "suspended").length,
      expiredSubscriptions: offices.filter(o => o.subscriptionStatus === "expired").length,
      expiredLicenses: offices.filter(o => o.licenseStatus === "expired").length,
      activeLast7Days: offices.filter(o => parseTs(o.lastActivityAt) >= weekAgo).length,
      inactiveLast30Days: offices.filter(o => !o.lastActivityAt || parseTs(o.lastActivityAt) < monthAgo).length
    };
    return jsonResponse({ ok: true, counters, requestId });
  }

  async function handleAdminOffices(request, url, env, requestId) {
    assertFirebaseSecrets(env);
    await requirePlatformIdentity(request, env, true);
    const projectId = env.FIREBASE_PROJECT_ID || deps.DEFAULT_PROJECT_ID;
    const accessToken = await getGoogleAccessToken(env);
    const offices = await loadAllOffices(projectId, accessToken);
    const params = {
      tab: url.searchParams.get("tab") || "",
      q: url.searchParams.get("q") || "",
      city: url.searchParams.get("city") || "",
      approvalStatus: url.searchParams.get("approvalStatus") || "",
      accountStatus: url.searchParams.get("accountStatus") || "",
      subscriptionStatus: url.searchParams.get("subscriptionStatus") || "",
      licenseStatus: url.searchParams.get("licenseStatus") || "",
      activityLevel: url.searchParams.get("activityLevel") || "",
      sort: url.searchParams.get("sort") || ""
    };
    const filtered = filterOffices(offices, params);
    const cities = [...new Set(offices.map(o => o.city).filter(Boolean))].sort();
    return jsonResponse({ ok: true, offices: filtered, cities, total: filtered.length, requestId });
  }

  async function handleAdminOfficeDetail(request, url, env, requestId) {
    assertFirebaseSecrets(env);
    await requirePlatformIdentity(request, env, true);
    const officeId = normalizeOfficeId(url.searchParams.get("officeId"));
    if (!officeId || officeId === "platform") throw appError("office_id_invalid", 400, "رمز المكتب غير صالح");
    const projectId = env.FIREBASE_PROJECT_ID || deps.DEFAULT_PROJECT_ID;
    const accessToken = await getGoogleAccessToken(env);
    const doc = await getFirestoreDocument({ projectId, segments: ["offices", officeId], accessToken, allowMissing: true });
    if (!doc) throw appError("office_not_found", 404, "المكتب غير موجود");
    const office = normalizeOfficeRecord(firestoreFieldsToJs(doc.fields || {}), officeId);
    const notesDocs = await listCollectionDocuments({
      projectId, segments: ["offices", officeId, "adminNotes"], accessToken, pageSize: 50
    });
    const notes = notesDocs.map(d => ({
      id: officeDocIdFromName(d),
      ...firestoreFieldsToJs(d.fields || {})
    })).sort((a, b) => parseTs(b.createdAt) - parseTs(a.createdAt));
    const eventsDocs = await listCollectionDocuments({
      projectId, segments: ["offices", officeId, "activityEvents"], accessToken, pageSize: 30
    });
    const events = eventsDocs.map(d => ({
      id: officeDocIdFromName(d),
      ...firestoreFieldsToJs(d.fields || {})
    })).sort((a, b) => parseTs(b.createdAt) - parseTs(a.createdAt));
    const auditDocs = await listAllCollectionDocuments({ projectId, segments: ["adminAuditLog"], accessToken });
    const audit = auditDocs
      .map(d => ({ id: officeDocIdFromName(d), ...firestoreFieldsToJs(d.fields || {}) }))
      .filter(e => e.officeId === officeId)
      .sort((a, b) => parseTs(b.performedAt) - parseTs(a.performedAt))
      .slice(0, 30);
    return jsonResponse({ ok: true, office, notes, events, audit, requestId });
  }

  async function setLoginDirectoryActive({ projectId, officeId, accessToken, active }) {
    const officeDoc = await getFirestoreDocument({ projectId, segments: ["offices", officeId], accessToken });
    const office = firestoreFieldsToJs(officeDoc.fields || {});
    const phone = normalizeLoginPhone(office.phone);
    if (!phone) return;
    const phoneHash = await sha256Hex(phone);
    const directory = await getFirestoreDocument({
      projectId, segments: ["loginDirectory", phoneHash], accessToken, allowMissing: true
    });
    if (!directory) return;
    const data = firestoreFieldsToJs(directory.fields || {});
    if (data.officeId !== officeId) return;
    await setFirestoreDocument({
      projectId,
      segments: ["loginDirectory", phoneHash],
      accessToken,
      fields: {
        active: firestoreBoolean(active),
        updatedAt: firestoreTimestamp(new Date())
      }
    });
  }

  async function handleAdminOfficeAction(request, env, requestId) {
    assertFirebaseSecrets(env);
    const admin = await requirePlatformIdentity(request, env, true);
    const body = await request.json().catch(() => ({}));
    const action = cleanText(body.action, 40);
    const officeId = normalizeOfficeId(body.officeId);
    if (!officeId || officeId === "platform") throw appError("office_id_invalid", 400, "رمز المكتب غير صالح");
    const projectId = env.FIREBASE_PROJECT_ID || deps.DEFAULT_PROJECT_ID;
    const accessToken = await getGoogleAccessToken(env);
    const doc = await getFirestoreDocument({ projectId, segments: ["offices", officeId], accessToken, allowMissing: true });
    if (!doc) throw appError("office_not_found", 404, "المكتب غير موجود");
    const before = normalizeOfficeRecord(firestoreFieldsToJs(doc.fields || {}), officeId);
    const now = new Date();
    const fields = { updatedAt: firestoreTimestamp(now) };
    let auditAction = action;
    const reason = cleanText(body.reason, 500);

    if (action === "suspend") {
      if (!reason) throw appError("reason_required", 400, "سبب الإيقاف مطلوب");
      auditAction = "office_suspended";
      fields.accountStatus = firestoreString("suspended");
      fields.suspendedAt = firestoreTimestamp(now);
      fields.suspendedBy = firestoreString(admin.sub);
      fields.suspensionReason = firestoreString(reason);
      await setLoginDirectoryActive({ projectId, officeId, accessToken, active: false });
    } else if (action === "reactivate") {
      auditAction = "office_reactivated";
      fields.accountStatus = firestoreString("active");
      fields.reactivatedAt = firestoreTimestamp(now);
      fields.suspensionReason = firestoreOptionalString("");
      await setLoginDirectoryActive({ projectId, officeId, accessToken, active: true });
    } else if (action === "update_subscription") {
      auditAction = "subscription_updated";
      if (body.subscriptionStatus) fields.subscriptionStatus = firestoreString(cleanText(body.subscriptionStatus, 20));
      if (body.subscriptionStartedAt) fields.subscriptionStartedAt = firestoreTimestamp(new Date(body.subscriptionStartedAt));
      if (body.subscriptionExpiresAt) fields.subscriptionExpiresAt = firestoreTimestamp(new Date(body.subscriptionExpiresAt));
    } else if (action === "update_license") {
      auditAction = "license_updated";
      if (body.falLicenseNumber) fields.falLicenseNumber = firestoreString(cleanText(body.falLicenseNumber, 30));
      if (body.licenseNumber) fields.licenseNumber = firestoreString(cleanText(body.falLicenseNumber || body.licenseNumber, 30));
      if (body.falLicenseIssuedAt) fields.falLicenseIssuedAt = firestoreTimestamp(new Date(body.falLicenseIssuedAt));
      if (body.falLicenseExpiresAt) fields.falLicenseExpiresAt = firestoreTimestamp(new Date(body.falLicenseExpiresAt));
      const expires = body.falLicenseExpiresAt || before.falLicenseExpiresAt;
      fields.licenseStatus = firestoreString(deriveLicenseStatus(expires));
    } else if (action === "add_note") {
      auditAction = "admin_note_added";
      const noteText = cleanText(body.note, 2000);
      if (noteText.length < 2) throw appError("note_required", 400, "الملاحظة مطلوبة");
      const noteId = `note_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      await setFirestoreDocument({
        projectId,
        segments: ["offices", officeId, "adminNotes", noteId],
        accessToken,
        fields: compactFields({
          officeId: firestoreString(officeId),
          note: firestoreString(noteText),
          createdBy: firestoreString(admin.sub),
          createdAt: firestoreTimestamp(now)
        })
      });
    } else if (action === "reject") {
      if (!reason) throw appError("reason_required", 400, "سبب الرفض مطلوب");
      fields.approvalStatus = firestoreString("rejected");
      fields.rejectedAt = firestoreTimestamp(now);
      fields.rejectedBy = firestoreString(admin.sub);
      fields.rejectionReason = firestoreString(reason);
    } else {
      throw appError("action_invalid", 400, "إجراء غير معروف");
    }

    if (Object.keys(fields).length > 1) {
      await setFirestoreDocument({ projectId, segments: ["offices", officeId], accessToken, fields });
    }
    const afterDoc = await getFirestoreDocument({ projectId, segments: ["offices", officeId], accessToken });
    const after = normalizeOfficeRecord(firestoreFieldsToJs(afterDoc.fields || {}), officeId);
    await writeAdminAudit({
      projectId,
      accessToken,
      entry: {
        officeId,
        action: auditAction,
        performedBy: admin.sub,
        reason,
        before,
        after
      }
    });
    return jsonResponse({ ok: true, office: after, requestId });
  }

  async function handleAdminAuditLog(request, url, env, requestId) {
    assertFirebaseSecrets(env);
    await requirePlatformIdentity(request, env, true);
    const projectId = env.FIREBASE_PROJECT_ID || deps.DEFAULT_PROJECT_ID;
    const accessToken = await getGoogleAccessToken(env);
    const limit = Math.min(200, Number(url.searchParams.get("limit") || 100));
    const docs = await listAllCollectionDocuments({ projectId, segments: ["adminAuditLog"], accessToken });
    const entries = docs
      .map(d => ({ id: officeDocIdFromName(d), ...firestoreFieldsToJs(d.fields || {}) }))
      .sort((a, b) => parseTs(b.performedAt) - parseTs(a.performedAt))
      .slice(0, limit);
    return jsonResponse({ ok: true, entries, requestId });
  }

  async function handleAdminBackfill(request, env, requestId) {
    assertFirebaseSecrets(env);
    await requirePlatformIdentity(request, env, true);
    const projectId = env.FIREBASE_PROJECT_ID || deps.DEFAULT_PROJECT_ID;
    const accessToken = await getGoogleAccessToken(env);
    const docs = await listAllCollectionDocuments({ projectId, segments: ["offices"], accessToken });
    const now = new Date();
    let updated = 0;
    for (const doc of docs) {
      const officeId = officeDocIdFromName(doc);
      if (!officeId || officeId === "platform") continue;
      const data = firestoreFieldsToJs(doc.fields || {});
      const patch = { updatedAt: firestoreTimestamp(now) };
      if (!data.approvalStatus && data.ownerUid) patch.approvalStatus = firestoreString("approved");
      if (!data.accountStatus) patch.accountStatus = firestoreString("active");
      if (!data.licenseStatus) patch.licenseStatus = firestoreString(deriveLicenseStatus(data.falLicenseExpiresAt));
      if (!data.subscriptionStatus) patch.subscriptionStatus = firestoreString(deriveSubscriptionStatus(data));
      if (!data.licenseeName && data.brokerName) patch.licenseeName = firestoreString(data.brokerName);
      if (!data.falLicenseNumber && data.licenseNumber) patch.falLicenseNumber = firestoreString(data.licenseNumber);
      if (!data.email) {
        const ownerUid = data.ownerUid;
        if (ownerUid) {
          const member = await getFirestoreDocument({
            projectId, segments: ["offices", officeId, "members", ownerUid], accessToken, allowMissing: true
          });
        }
      }
      if (Object.keys(patch).length > 1) {
        await setFirestoreDocument({ projectId, segments: ["offices", officeId], accessToken, fields: patch });
        updated += 1;
        await refreshOfficeActivitySummary({ projectId, officeId, accessToken });
      }
    }
    return jsonResponse({ ok: true, updated, requestId });
  }

  return {
    recordOfficeActivity,
    refreshOfficeActivitySummary,
    writeAdminAudit,
    normalizeOfficeRecord,
    handleAdminOverview,
    handleAdminOffices,
    handleAdminOfficeDetail,
    handleAdminOfficeAction,
    handleAdminAuditLog,
    handleAdminBackfill,
    deriveLicenseStatus,
    deriveSubscriptionStatus
  };
}

export { computeActivityLevel, activityLevelLabel, normalizeOfficeRecord };
