/**
 * Living cooperation workflow persistence.
 * Reuses Phase 6 cooperationRequests identity. Does not rewrite matching.
 */

import { MATCH_THRESHOLD, opportunityToMatchInput, counterpartsEligible } from "./matching-engine.js";
import { buildCooperationRequestId, normalizeCooperationMode } from "./cooperation-phase6-domain.js";
import { pickCooperationCandidates, rankCooperationCandidates } from "./cooperation-ranking-layer.js";
import { upsertCooperationOperations } from "./operations-service.js";
import {
  COOPERATION_ACTION,
  COOPERATION_RECORD_STATUS,
  COOPERATION_STAGE,
  applyCooperationWorkflowTransition,
  collaborationEnabled,
  cooperationSettingsExtras,
  publicListingSlice,
  resolveCooperationRoles,
  shouldSearchCrossOffice
} from "../../public/js/cooperation-workflow-domain.js";

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function jsonField(fh, value) {
  return fh.firestoreString(JSON.stringify(value || {}));
}

async function readCooperationSettings({
  projectId,
  officeId,
  accessToken,
  getFirestoreDocument,
  firestoreFieldsToJs
}) {
  const doc = await getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "officeSettings", "cooperation"],
    accessToken,
    allowMissing: true
  });
  const data = doc ? firestoreFieldsToJs(doc.fields || {}) : {};
  const mode = normalizeCooperationMode(data.mode);
  return {
    mode,
    enabled: collaborationEnabled(mode),
    ...cooperationSettingsExtras(data)
  };
}

export function cooperationFields(fh, record) {
  const ids = Array.isArray(record.opportunityIds) ? record.opportunityIds : [];
  return {
    id: fh.firestoreString(record.id),
    cooperationTaskId: fh.firestoreString(record.cooperationTaskId || record.id),
    originatingOfficeId: fh.firestoreString(record.originatingOfficeId || ""),
    originatingOfficeName: fh.firestoreString(record.originatingOfficeName || ""),
    originatingBrokerId: fh.firestoreString(record.originatingBrokerId || ""),
    targetOfficeId: fh.firestoreString(record.targetOfficeId || ""),
    targetOfficeName: fh.firestoreString(record.targetOfficeName || ""),
    clientOfficeId: fh.firestoreString(record.clientOfficeId || ""),
    propertyOfficeId: fh.firestoreString(record.propertyOfficeId || ""),
    opportunityId: fh.firestoreString(record.opportunityId || ""),
    counterpartOpportunityId: fh.firestoreString(record.counterpartOpportunityId || ""),
    opportunityIds: { arrayValue: { values: ids.map((id) => ({ stringValue: String(id) })) } },
    opportunityKind: fh.firestoreString(record.opportunityKind || ""),
    propertyType: fh.firestoreString(record.propertyType || ""),
    purpose: fh.firestoreString(record.purpose || ""),
    city: fh.firestoreString(record.city || ""),
    district: fh.firestoreString(record.district || ""),
    status: fh.firestoreString(record.status || COOPERATION_RECORD_STATUS.SUGGESTED),
    currentStage: fh.firestoreString(record.currentStage || COOPERATION_STAGE.MATCH_FOUND),
    proximityLabel: fh.firestoreString(record.proximityLabel || ""),
    compatibilityLabel: fh.firestoreString(record.compatibilityLabel || ""),
    matchReasonsJson: fh.firestoreString(JSON.stringify(record.matchReasons || [])),
    originListingJson: jsonField(fh, record.originListing || {}),
    counterpartListingJson: jsonField(fh, record.counterpartListing || {}),
    completionConfirmationsJson: jsonField(fh, record.completionConfirmations || {}),
    clientPhone: fh.firestoreString(record.clientPhone || ""),
    ownerPhone: fh.firestoreString(record.ownerPhone || ""),
    clientName: fh.firestoreString(record.clientName || ""),
    ownerName: fh.firestoreString(record.ownerName || ""),
    clientRequestId: fh.firestoreString(record.clientRequestId || record.requestId || ""),
    ownerOfferId: fh.firestoreString(record.ownerOfferId || record.offerId || ""),
    requestId: fh.firestoreString(record.requestId || record.clientRequestId || ""),
    offerId: fh.firestoreString(record.offerId || record.ownerOfferId || ""),
    matchId: fh.firestoreString(record.matchId || ""),
    agreedSharePercent: fh.firestoreInteger(Number(record.agreedSharePercent || record.defaultSharePercent || 50)),
    appointmentAt: fh.firestoreString(record.appointmentAt || ""),
    createdAt: fh.firestoreTimestamp(new Date(record.createdAt || Date.now())),
    updatedAt: fh.firestoreTimestamp(new Date(record.updatedAt || Date.now())),
    schemaVersion: fh.firestoreInteger(2)
  };
}

function pickOpportunityPhone(opp = {}) {
  if (!opp || typeof opp !== "object") return "";
  return text(
    opp.contactPhone
    || opp.phone
    || opp.advertiserPhoneNormalized
    || opp.buyerPhone
    || opp.clientPhone
    || opp.ownerPhone
  );
}

function opportunityKind(value = "") {
  return upper(value);
}

export async function enrichCooperationContacts({
  projectId,
  cooperation = {},
  accessToken,
  deps
}) {
  const origin = text(cooperation.originatingOfficeId).toLowerCase();
  const target = text(cooperation.targetOfficeId).toLowerCase();
  const roles = resolveCooperationRoles({
    originatingKind: cooperation.opportunityKind,
    counterpartKind: cooperation.counterpartOpportunityKind,
    originatingOfficeId: origin,
    targetOfficeId: target
  });
  const clientOfficeId = text(roles.clientOfficeId).toLowerCase();
  const propertyOfficeId = text(roles.propertyOfficeId).toLowerCase();

  async function readOpportunity(officeId, opportunityId) {
    const oppId = text(opportunityId);
    const office = text(officeId).toLowerCase();
    if (!office || !oppId) return null;
    const doc = await deps.getFirestoreDocument({
      projectId,
      segments: ["offices", office, "opportunities", oppId],
      accessToken,
      allowMissing: true
    });
    return doc ? { id: oppId, officeId: office, ...deps.firestoreFieldsToJs(doc.fields || {}) } : null;
  }

  const originOppId = text(cooperation.opportunityId || (cooperation.opportunityIds || [])[0]);
  const counterpartOppId = text(cooperation.counterpartOpportunityId);
  const originOpp = await readOpportunity(origin, originOppId);
  const counterpartOffice = clientOfficeId === origin ? propertyOfficeId : origin;
  const counterpartOpp = counterpartOppId
    ? await readOpportunity(counterpartOffice, counterpartOppId)
    : null;

  let clientOpp = null;
  let ownerOpp = null;
  if (originOpp) {
    const kind = opportunityKind(originOpp.opportunityKind);
    if (kind === "REQUEST" || kind === "CLIENT") clientOpp = originOpp;
    else ownerOpp = originOpp;
  }
  if (counterpartOpp) {
    const kind = opportunityKind(counterpartOpp.opportunityKind);
    if (kind === "REQUEST" || kind === "CLIENT") clientOpp = counterpartOpp;
    else ownerOpp = counterpartOpp;
  }

  const originListing = publicListingSlice(originOpp || cooperation.originListing || cooperation.ownListing || {});
  const counterpartListing = publicListingSlice(
    counterpartOpp || cooperation.counterpartListing || cooperation.partnerListing || {}
  );

  return {
    ...cooperation,
    clientOfficeId: roles.clientOfficeId,
    propertyOfficeId: roles.propertyOfficeId,
    clientPhone: pickOpportunityPhone(clientOpp) || text(cooperation.clientPhone),
    ownerPhone: pickOpportunityPhone(ownerOpp) || text(cooperation.ownerPhone),
    clientName: text(clientOpp?.contactName || clientOpp?.clientName || cooperation.clientName),
    ownerName: text(ownerOpp?.contactName || ownerOpp?.ownerName || cooperation.ownerName),
    originListing,
    counterpartListing,
    ownListing: originListing,
    partnerListing: counterpartListing,
    requestId: text(clientOpp?.id || cooperation.requestId || cooperation.clientRequestId),
    offerId: text(ownerOpp?.id || cooperation.offerId || cooperation.ownerOfferId),
    clientRequestId: text(clientOpp?.id || cooperation.clientRequestId || cooperation.requestId),
    ownerOfferId: text(ownerOpp?.id || cooperation.ownerOfferId || cooperation.offerId),
    counterpartOpportunityId: text(counterpartOpp?.id || cooperation.counterpartOpportunityId),
    counterpartOpportunityKind: text(counterpartOpp?.opportunityKind || cooperation.counterpartOpportunityKind),
    propertyType: text(cooperation.propertyType || originListing.propertyType || counterpartListing.propertyType),
    purpose: text(cooperation.purpose || originListing.purpose || counterpartListing.purpose),
    city: text(cooperation.city || originListing.city || counterpartListing.city),
    district: text(cooperation.district || originListing.district || counterpartListing.district)
  };
}

function hydrateCooperation(id, data = {}) {
  const parse = (raw, fallback) => {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : fallback;
      } catch {
        return fallback;
      }
    }
    return fallback;
  };
  const matchReasons = Array.isArray(data.matchReasons)
    ? data.matchReasons
    : parse(data.matchReasonsJson, []);
  return {
    id,
    ...data,
    cooperationTaskId: data.cooperationTaskId || id,
    matchReasons: Array.isArray(matchReasons) ? matchReasons : [],
    originListing: parse(data.originListingJson, data.originListing || {}),
    counterpartListing: parse(data.counterpartListingJson, data.counterpartListing || {}),
    completionConfirmations: parse(data.completionConfirmationsJson, data.completionConfirmations || {}),
    ownListing: parse(data.originListingJson, data.originListing || {}),
    partnerListing: parse(data.counterpartListingJson, data.counterpartListing || {})
  };
}

async function readPublicOfficeName({
  projectId, officeId, accessToken, getFirestoreDocument, firestoreFieldsToJs
}) {
  const doc = await getFirestoreDocument({
    projectId,
    segments: ["publicOffices", officeId],
    accessToken,
    allowMissing: true
  });
  if (!doc) return officeId;
  const data = firestoreFieldsToJs(doc.fields || {});
  return text(data.officeName || data.brokerName || officeId) || officeId;
}

async function countActiveOutbound({
  projectId, officeId, accessToken, listCollectionDocuments, firestoreFieldsToJs
}) {
  const docs = await listCollectionDocuments({
    projectId,
    segments: ["cooperationRequests"],
    accessToken,
    pageSize: 80
  }).catch(() => []);
  let count = 0;
  for (const doc of docs || []) {
    const data = firestoreFieldsToJs(doc.fields || {});
    if (text(data.originatingOfficeId).toLowerCase() !== text(officeId).toLowerCase()) continue;
    const status = text(data.status).toUpperCase();
    if (status === "PENDING" || status === "SUGGESTED" || status === "ACCEPTED") count += 1;
  }
  return count;
}

export async function maybeCreateCrossOfficeCooperation({
  projectId,
  officeId,
  opportunity,
  opportunityId,
  internalMatchCount,
  accessToken,
  deps
}) {
  const settings = await readCooperationSettings({
    projectId,
    officeId,
    accessToken,
    getFirestoreDocument: deps.getFirestoreDocument,
    firestoreFieldsToJs: deps.firestoreFieldsToJs
  });
  if (!shouldSearchCrossOffice({ internalMatchCount, mode: settings.mode })) {
    return { created: 0, skipped: settings.enabled ? "internal_match_exists" : "collaboration_off" };
  }

  const publicDocs = await deps.listCollectionDocuments({
    projectId,
    segments: ["publicOffices"],
    accessToken,
    pageSize: 120
  });
  const publicOffices = publicDocs.map((doc) => ({
    officeId: decodeURIComponent(String(doc.name || "").split("/").pop() || ""),
    ...deps.firestoreFieldsToJs(doc.fields || {})
  }));

  const source = opportunityToMatchInput(opportunity, { id: opportunityId });
  const candidates = [];
  for (const office of publicOffices) {
    const targetId = text(office.officeId || office.id).toLowerCase();
    if (!targetId || targetId === text(officeId).toLowerCase()) continue;
    const mode = normalizeCooperationMode(office.cooperationMode || "APPROVAL_REQUIRED");
    if (!collaborationEnabled(mode)) continue;
    const docs = await deps.listCollectionDocuments({
      projectId,
      segments: ["offices", targetId, "opportunities"],
      accessToken,
      pageSize: 40
    });
    for (const doc of docs) {
      const candidateId = decodeURIComponent(String(doc.name || "").split("/").pop() || "");
      const raw = { id: candidateId, ...deps.firestoreFieldsToJs(doc.fields || {}) };
      if (!counterpartsEligible(opportunity, raw)) continue;
      candidates.push({
        officeId: targetId,
        officeName: office.officeName || targetId,
        listing: opportunityToMatchInput(raw, { id: candidateId }),
        raw
      });
    }
  }

  const ranked = rankCooperationCandidates({
    source,
    candidates,
    threshold: MATCH_THRESHOLD,
    proximityScope: settings.proximityScope
  });
  const activeCount = await countActiveOutbound({
    projectId,
    officeId,
    accessToken,
    listCollectionDocuments: deps.listCollectionDocuments,
    firestoreFieldsToJs: deps.firestoreFieldsToJs
  });
  const remaining = Math.max(0, settings.maxConcurrentRequests - activeCount);
  if (!remaining) return { created: 0, skipped: "concurrent_cap", ranked: ranked.length };

  const picked = pickCooperationCandidates(ranked, { maxConcurrent: remaining });
  const created = [];
  for (const row of picked) {
    const saved = await persistSuggestedCooperation({
      projectId,
      originatingOfficeId: officeId,
      targetOfficeId: row.officeId,
      opportunity,
      opportunityId,
      counterpart: row.raw,
      counterpartOpportunityId: row.raw.id,
      rankedRow: row,
      settings,
      accessToken,
      deps
    });
    if (saved?.ok && !saved.duplicate) created.push(saved);
  }
  return { created: created.length, results: created, ranked: ranked.length };
}

export async function persistSuggestedCooperation({
  projectId,
  originatingOfficeId,
  targetOfficeId,
  opportunity,
  opportunityId,
  counterpart,
  counterpartOpportunityId,
  rankedRow,
  settings,
  accessToken,
  deps
}) {
  const origin = text(originatingOfficeId).toLowerCase();
  const target = text(targetOfficeId).toLowerCase();
  const requestId = await buildCooperationRequestId({
    originatingOfficeId: origin,
    targetOfficeId: target,
    opportunityId,
    scopeType: "single"
  });
  const existingDoc = await deps.getFirestoreDocument({
    projectId,
    segments: ["cooperationRequests", requestId],
    accessToken,
    allowMissing: true
  });
  if (existingDoc) {
    return { ok: true, duplicate: true, requestId };
  }

  const now = new Date();
  const roles = resolveCooperationRoles({
    originatingKind: opportunity.opportunityKind,
    counterpartKind: counterpart.opportunityKind,
    originatingOfficeId: origin,
    targetOfficeId: target
  });
  const [originName, targetName] = await Promise.all([
    readPublicOfficeName({
      projectId, officeId: origin, accessToken,
      getFirestoreDocument: deps.getFirestoreDocument,
      firestoreFieldsToJs: deps.firestoreFieldsToJs
    }),
    readPublicOfficeName({
      projectId, officeId: target, accessToken,
      getFirestoreDocument: deps.getFirestoreDocument,
      firestoreFieldsToJs: deps.firestoreFieldsToJs
    })
  ]);
  const originListing = publicListingSlice(opportunity);
  const counterpartListing = publicListingSlice(counterpart);
  const record = {
    id: requestId,
    cooperationTaskId: requestId,
    originatingOfficeId: origin,
    originatingOfficeName: originName,
    targetOfficeId: target,
    targetOfficeName: targetName,
    ...roles,
    opportunityId,
    counterpartOpportunityId,
    opportunityIds: [opportunityId],
    opportunityKind: opportunity.opportunityKind || "",
    propertyType: opportunity.propertyType || counterpart.propertyType || "",
    purpose: opportunity.purpose || counterpart.purpose || "",
    city: opportunity.city || "",
    district: opportunity.district || "",
    status: COOPERATION_RECORD_STATUS.SUGGESTED,
    currentStage: COOPERATION_STAGE.MATCH_FOUND,
    proximityLabel: rankedRow?.proximityLabel || "",
    compatibilityLabel: rankedRow?.compatibilityLabel || "",
    matchReasons: rankedRow?.matchReasons || [],
    originListing,
    counterpartListing,
    defaultSharePercent: settings?.defaultSharePercent,
    agreedSharePercent: settings?.defaultSharePercent,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };

  await deps.setFirestoreDocument({
    projectId,
    segments: ["cooperationRequests", requestId],
    accessToken,
    fields: cooperationFields(deps.firestoreHelpers, record)
  });

  await upsertCooperationOperations({
    projectId,
    cooperation: hydrateCooperation(requestId, record),
    accessToken,
    deps
  });

  return { ok: true, duplicate: false, requestId, record };
}

export async function runCooperationWorkflow({
  projectId,
  actorOfficeId,
  actorUid,
  cooperationId,
  action,
  reason = "",
  appointmentAt = "",
  accessToken,
  deps
}) {
  const coopDoc = await deps.getFirestoreDocument({
    projectId,
    segments: ["cooperationRequests", cooperationId],
    accessToken,
    allowMissing: true
  });
  if (!coopDoc) return { ok: false, error: "cooperation_not_found", status: 404, message: "سجل التعاون غير موجود." };

  const request = hydrateCooperation(cooperationId, deps.firestoreFieldsToJs(coopDoc.fields || {}));
  const applied = applyCooperationWorkflowTransition(request, action, { actorOfficeId });
  if (!applied.ok) {
    return {
      ok: false,
      error: applied.error,
      status: applied.error === "cooperation_forbidden" ? 403 : 400,
      message: applied.message
    };
  }
  if (applied.duplicate) {
    return {
      ok: true,
      duplicate: true,
      cooperationId,
      status: request.status,
      currentStage: request.currentStage,
      message: "تم تسجيل هذا الإجراء مسبقًا."
    };
  }

  const now = new Date();
  const patch = { ...applied.patch };
  if (text(appointmentAt) && upperAction(action) === COOPERATION_ACTION.CONFIRM_APPOINTMENT) {
    patch.appointmentAt = appointmentAt;
  }
  const next = hydrateCooperation(cooperationId, { ...request, ...patch, updatedAt: now.toISOString() });
  const fh = deps.firestoreHelpers;
  const fields = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value == null) continue;
    if (key === "completionConfirmations") {
      fields.completionConfirmationsJson = jsonField(fh, value);
      continue;
    }
    if (String(key).endsWith("At") || key === "updatedAt") {
      fields[key] = fh.firestoreTimestamp(new Date(value));
      continue;
    }
    if (typeof value === "object") {
      fields[`${key}Json`] = jsonField(fh, value);
      continue;
    }
    fields[key] = fh.firestoreString(String(value));
  }
  fields.originatingOfficeId = fh.firestoreString(request.originatingOfficeId);
  fields.targetOfficeId = fh.firestoreString(request.targetOfficeId);
  fields.cooperationTaskId = fh.firestoreString(request.cooperationTaskId || cooperationId);

  await deps.setFirestoreDocument({
    projectId,
    segments: ["cooperationRequests", cooperationId],
    accessToken,
    fields
  });

  const otherOfficeId = text(actorOfficeId).toLowerCase() === text(request.originatingOfficeId).toLowerCase()
    ? request.targetOfficeId
    : request.originatingOfficeId;
  next.newResponseByOffice = {
    ...(request.newResponseByOffice || {}),
    [otherOfficeId]: true,
    [actorOfficeId]: false
  };

  await upsertCooperationOperations({
    projectId,
    cooperation: await enrichCooperationContacts({
      projectId,
      cooperation: next,
      accessToken,
      deps
    }),
    accessToken,
    deps
  });

  return {
    ok: true,
    duplicate: false,
    cooperationId,
    status: next.status,
    currentStage: next.currentStage,
    message: "تم حفظ حالة التعاون."
  };
}

function upperAction(value) {
  return String(value || "").trim().toUpperCase();
}
