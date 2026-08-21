/**
 * مجتمع الوسطاء — مطابقة عابرة للمكاتب عبر العامل، بدون كشف بيانات العملاء.
 */

import {
  BROKER_COMMUNITY_MAX_MATCHES,
  applyAgreementAccept,
  applyAgreementCreate,
  applyAgreementRevise,
  applyCommunityOutcome,
  buildCommunityAgreementId,
  buildCommunityPairKey,
  buildCommunityRequestId,
  canListingEnterBrokerCommunity,
  communityNotificationCopy,
  communityPairFromListings,
  isBrokerCommunityEnabled,
  rankBrokerCommunityMatches,
  resolveCommunityEmptyReason,
  sanitizePeerListing
} from "../../public/js/broker-community-domain.js";
import { evaluateMatchingReadiness } from "../../public/js/opportunity-readiness-domain.js";
import { normalizeCooperationMode } from "./cooperation-phase6-domain.js";
import { MATCH_THRESHOLD } from "./matching-engine.js";

function asOffice(row = {}) {
  return {
    officeId: String(row.officeId || row.id || "").trim().toLowerCase(),
    officeName: row.officeName || "",
    brokerName: row.brokerName || "",
    phone: row.phone || "",
    whatsapp: row.whatsapp || row.phone || "",
    city: row.city || "",
    accountStatus: String(row.accountStatus || "active").trim().toLowerCase(),
    cooperationMode: normalizeCooperationMode(row.cooperationMode || "APPROVAL_REQUIRED"),
    brokerCommunityEnabled: row.brokerCommunityEnabled !== false,
    serviceNeighborhoodIds: Array.isArray(row.serviceNeighborhoodIds) ? row.serviceNeighborhoodIds : []
  };
}

export function buildCommunityMatches({
  sourceOpportunity = {},
  ownOfficeId = "",
  ownOffice = {},
  publicOffices = [],
  officeOpportunities = []
} = {}) {
  const own = asOffice({ ...ownOffice, officeId: ownOfficeId });
  const matches = rankBrokerCommunityMatches({
    sourceOpportunity,
    ownOfficeId: own.officeId,
    ownOffice: own,
    publicOffices: (publicOffices || []).map(asOffice),
    candidateOpportunities: officeOpportunities || [],
    requireReadiness: true
  });
  return matches.slice(0, BROKER_COMMUNITY_MAX_MATCHES);
}

export function resolveCommunityEmptyReasonForSource(sourceOpportunity = {}, ownOffice = {}, matches = []) {
  return resolveCommunityEmptyReason({ sourceOpportunity, ownOffice, matches });
}

export function communityMatchEligible(sourceOpportunity = {}, ownOffice = {}) {
  return canListingEnterBrokerCommunity(sourceOpportunity, asOffice(ownOffice));
}

export async function loadPublicOfficesAndForeignOpportunities({
  projectId,
  ownOfficeId,
  accessToken,
  listCollectionDocuments,
  firestoreFieldsToJs
}) {
  const ownId = String(ownOfficeId || "").trim().toLowerCase();
  const publicDocs = await listCollectionDocuments({
    projectId,
    segments: ["publicOffices"],
    accessToken,
    pageSize: 120
  });
  const publicOffices = publicDocs.map((doc) => {
    const officeId = decodeURIComponent(String(doc.name || "").split("/").pop() || "");
    return asOffice({ officeId, ...firestoreFieldsToJs(doc.fields || {}) });
  });
  const officeOpportunities = [];
  for (const office of publicOffices) {
    const targetId = office.officeId;
    if (!targetId || targetId === ownId) continue;
    if (String(office.accountStatus || "").toLowerCase() === "paused") continue;
    if (!isBrokerCommunityEnabled(office)) continue;
    const docs = await listCollectionDocuments({
      projectId,
      segments: ["offices", targetId, "opportunities"],
      accessToken,
      pageSize: 40
    });
    for (const doc of docs) {
      const id = decodeURIComponent(String(doc.name || "").split("/").pop() || "");
      const fields = firestoreFieldsToJs(doc.fields || {});
      const record = { id, officeId: targetId, ...fields };
      if (!evaluateMatchingReadiness(record).isReadyForMatching) continue;
      officeOpportunities.push(record);
    }
  }
  return { publicOffices, officeOpportunities };
}

function firestoreHelpers(h) {
  return h;
}

async function readOfficeCooperationSettings({
  projectId,
  officeId,
  accessToken,
  getFirestoreDocument,
  firestoreFieldsToJs
}) {
  const [settingsDoc, publicDoc] = await Promise.all([
    getFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "officeSettings", "cooperation"],
      accessToken,
      allowMissing: true
    }),
    getFirestoreDocument({
      projectId,
      segments: ["publicOffices", officeId],
      accessToken,
      allowMissing: true
    })
  ]);
  const settings = settingsDoc ? firestoreFieldsToJs(settingsDoc.fields || {}) : {};
  const pub = publicDoc ? firestoreFieldsToJs(publicDoc.fields || {}) : {};
  return asOffice({
    officeId,
    ...pub,
    cooperationMode: settings.mode || pub.cooperationMode,
    brokerCommunityEnabled: settings.brokerCommunityEnabled ?? pub.brokerCommunityEnabled
  });
}

function opportunityFromDoc(id, officeId, fields = {}) {
  return { id, officeId, ...fields };
}

export async function buildCommunityMatchesForOpportunity({
  projectId,
  officeId,
  opportunityId,
  accessToken,
  getFirestoreDocument,
  listCollectionDocuments,
  firestoreFieldsToJs
}) {
  const ownOffice = await readOfficeCooperationSettings({
    projectId,
    officeId,
    accessToken,
    getFirestoreDocument,
    firestoreFieldsToJs
  });
  const oppDoc = await getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "opportunities", opportunityId],
    accessToken,
    allowMissing: true
  });
  if (!oppDoc) return { ok: false, error: "opportunity_not_found", status: 404 };
  const sourceOpportunity = opportunityFromDoc(
    opportunityId,
    officeId,
    firestoreFieldsToJs(oppDoc.fields || {})
  );
  if (!communityMatchEligible(sourceOpportunity, ownOffice)) {
    return {
      ok: true,
      officeId,
      opportunityId,
      suggestions: [],
      emptyReason: resolveCommunityEmptyReasonForSource(sourceOpportunity, ownOffice, [])
    };
  }
  const { publicOffices, officeOpportunities } = await loadPublicOfficesAndForeignOpportunities({
    projectId,
    ownOfficeId: officeId,
    accessToken,
    listCollectionDocuments,
    firestoreFieldsToJs
  });
  const suggestions = buildCommunityMatches({
    sourceOpportunity,
    ownOfficeId: officeId,
    ownOffice,
    publicOffices,
    officeOpportunities
  });
  return {
    ok: true,
    officeId,
    opportunityId,
    suggestions,
    emptyReason: suggestions.length
      ? null
      : resolveCommunityEmptyReasonForSource(sourceOpportunity, ownOffice, suggestions)
  };
}

export async function buildCommunityMatchesForMany({
  projectId,
  officeId,
  opportunityIds = [],
  accessToken,
  getFirestoreDocument,
  listCollectionDocuments,
  firestoreFieldsToJs
}) {
  const ids = [...new Set((opportunityIds || []).map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 20);
  const ownOffice = await readOfficeCooperationSettings({
    projectId,
    officeId,
    accessToken,
    getFirestoreDocument,
    firestoreFieldsToJs
  });
  if (!isBrokerCommunityEnabled(ownOffice)) {
    const byId = {};
    for (const id of ids) byId[id] = [];
    return { ok: true, officeId, matchesByOpportunityId: byId };
  }
  const { publicOffices, officeOpportunities } = await loadPublicOfficesAndForeignOpportunities({
    projectId,
    ownOfficeId: officeId,
    accessToken,
    listCollectionDocuments,
    firestoreFieldsToJs
  });
  const matchesByOpportunityId = {};
  for (const opportunityId of ids) {
    const oppDoc = await getFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "opportunities", opportunityId],
      accessToken,
      allowMissing: true
    });
    if (!oppDoc) {
      matchesByOpportunityId[opportunityId] = [];
      continue;
    }
    const sourceOpportunity = opportunityFromDoc(
      opportunityId,
      officeId,
      firestoreFieldsToJs(oppDoc.fields || {})
    );
    matchesByOpportunityId[opportunityId] = buildCommunityMatches({
      sourceOpportunity,
      ownOfficeId: officeId,
      ownOffice,
      publicOffices,
      officeOpportunities
    });
  }
  return { ok: true, officeId, matchesByOpportunityId };
}

export async function createCommunityCooperationRequest({
  projectId,
  originatingOfficeId,
  originatingBrokerId,
  targetOfficeId,
  ownOpportunityId,
  peerOpportunityId,
  message = "",
  accessToken,
  deps
}) {
  const origin = String(originatingOfficeId || "").trim().toLowerCase();
  const target = String(targetOfficeId || "").trim().toLowerCase();
  const ownId = String(ownOpportunityId || "").trim();
  const peerId = String(peerOpportunityId || "").trim();
  if (!origin || !target || origin === target) {
    return { ok: false, error: "office_ids_required", status: 400 };
  }
  if (!ownId || !peerId) {
    return { ok: false, error: "pair_required", status: 400, message: "يلزم تحديد العرض والطلب معًا." };
  }
  const ownOffice = await readOfficeCooperationSettings({
    projectId,
    officeId: origin,
    accessToken,
    getFirestoreDocument: deps.getFirestoreDocument,
    firestoreFieldsToJs: deps.firestoreFieldsToJs
  });
  const targetOffice = await readOfficeCooperationSettings({
    projectId,
    officeId: target,
    accessToken,
    getFirestoreDocument: deps.getFirestoreDocument,
    firestoreFieldsToJs: deps.firestoreFieldsToJs
  });
  if (!isBrokerCommunityEnabled(ownOffice) || !isBrokerCommunityEnabled(targetOffice)) {
    return {
      ok: false,
      error: "community_disabled",
      status: 403,
      message: "المكتب غير مشارك في مجتمع الوسطاء."
    };
  }

  const ownDoc = await deps.getFirestoreDocument({
    projectId,
    segments: ["offices", origin, "opportunities", ownId],
    accessToken,
    allowMissing: true
  });
  const peerDoc = await deps.getFirestoreDocument({
    projectId,
    segments: ["offices", target, "opportunities", peerId],
    accessToken,
    allowMissing: true
  });
  if (!ownDoc || !peerDoc) {
    return { ok: false, error: "opportunity_not_found", status: 404, message: "الفرصة غير موجودة." };
  }
  const ownRecord = opportunityFromDoc(ownId, origin, deps.firestoreFieldsToJs(ownDoc.fields || {}));
  const peerRecord = opportunityFromDoc(peerId, target, deps.firestoreFieldsToJs(peerDoc.fields || {}));
  if (String(ownRecord.officeId || origin).toLowerCase() !== origin) {
    return { ok: false, error: "opportunity_forbidden", status: 403 };
  }
  if (String(peerRecord.officeId || target).toLowerCase() !== target) {
    return { ok: false, error: "peer_forbidden", status: 403 };
  }
  if (!evaluateMatchingReadiness(ownRecord).isReadyForMatching
    || !evaluateMatchingReadiness(peerRecord).isReadyForMatching) {
    return {
      ok: false,
      error: "incomplete_data",
      status: 400,
      message: "لا يُفتح مجتمع الوسطاء إلا بعد اكتمال العرض والطلب."
    };
  }
  const pair = communityPairFromListings(ownRecord, peerRecord);
  if (!pair) {
    return { ok: false, error: "not_counterparts", status: 400, message: "يلزم عرض وطلب متقابلان." };
  }
  const pairKey = buildCommunityPairKey(pair);
  const requestId = await buildCommunityRequestId(pair);
  const existingDoc = await deps.getFirestoreDocument({
    projectId,
    segments: ["cooperationRequests", requestId],
    accessToken,
    allowMissing: true
  });
  if (existingDoc) {
    const existing = deps.firestoreFieldsToJs(existingDoc.fields || {});
    const status = String(existing.status || "").toUpperCase();
    if (["PENDING", "ACCEPTED"].includes(status) && !existing.outcome) {
      return {
        ok: true,
        duplicate: true,
        requestId,
        pairKey,
        message: "يوجد طلب تعاون لهذه الزوج مسبقًا."
      };
    }
  }

  const now = new Date();
  const fh = firestoreHelpers(deps.firestoreHelpers);
  const ownSafe = sanitizePeerListing(ownRecord, ownOffice);
  const peerSafe = sanitizePeerListing(peerRecord, targetOffice);
  await deps.setFirestoreDocument({
    projectId,
    segments: ["cooperationRequests", requestId],
    accessToken,
    fields: {
      id: fh.firestoreString(requestId),
      community: fh.firestoreBoolean(true),
      pairKey: fh.firestoreString(pairKey),
      offerId: fh.firestoreString(pair.offerId),
      requestIdPair: fh.firestoreString(pair.requestId),
      originatingOfficeId: fh.firestoreString(origin),
      originatingOfficeName: fh.firestoreString(ownOffice.officeName || origin),
      originatingBrokerId: fh.firestoreString(originatingBrokerId || ""),
      targetOfficeId: fh.firestoreString(target),
      targetOfficeName: fh.firestoreString(targetOffice.officeName || target),
      opportunityId: fh.firestoreString(ownId),
      peerOpportunityId: fh.firestoreString(peerId),
      opportunityIds: {
        arrayValue: { values: [ownId, peerId].map((id) => ({ stringValue: id })) }
      },
      scopeType: fh.firestoreString("community_pair"),
      opportunityKind: fh.firestoreString(ownSafe.opportunityKind),
      propertyType: fh.firestoreString(ownSafe.propertyType),
      purpose: fh.firestoreString(ownSafe.purpose),
      city: fh.firestoreString(ownSafe.city),
      district: fh.firestoreString(ownSafe.district),
      sharedSummaryJson: fh.firestoreString(JSON.stringify({ own: ownSafe, peer: peerSafe })),
      shareMessage: fh.firestoreString(String(message || "").slice(0, 500)),
      status: fh.firestoreString("PENDING"),
      outcome: fh.firestoreString(""),
      permissions: {
        mapValue: {
          fields: {
            readOnly: { booleanValue: true },
            minimumData: { booleanValue: true },
            contactVisible: { booleanValue: false },
            ownershipModifiable: { booleanValue: false },
            canDelete: { booleanValue: false },
            canArchive: { booleanValue: false },
            unrestrictedAttachmentDownload: { booleanValue: false },
            canReshare: { booleanValue: false }
          }
        }
      },
      createdBy: fh.firestoreString(originatingBrokerId || ""),
      requestedAt: fh.firestoreString(now.toISOString()),
      createdAt: fh.firestoreTimestamp(now),
      updatedAt: fh.firestoreTimestamp(now),
      schemaVersion: fh.firestoreInteger(2)
    }
  });
  return {
    ok: true,
    duplicate: false,
    requestId,
    pairKey,
    offerId: pair.offerId,
    requestListingId: pair.requestId,
    message: "تم إرسال طلب التعاون",
    notify: communityNotificationCopy("community_request")
  };
}

function agreementToFields(agreement, extra, fh) {
  const approvals = agreement.approvals || {};
  return {
    id: fh.firestoreString(extra.id),
    officeId: fh.firestoreString(extra.officeId || agreement.originatingOfficeId),
    cooperationRequestId: fh.firestoreString(extra.cooperationRequestId),
    originatingOfficeId: fh.firestoreString(agreement.originatingOfficeId),
    targetOfficeId: fh.firestoreString(agreement.targetOfficeId),
    offerId: fh.firestoreString(extra.offerId || ""),
    requestListingId: fh.firestoreString(extra.requestListingId || extra.requestId || ""),
    officeAPercent: fh.firestoreInteger(agreement.officeAPercent),
    officeBPercent: fh.firestoreInteger(agreement.officeBPercent),
    status: fh.firestoreString(agreement.status),
    version: fh.firestoreInteger(agreement.version || 1),
    createdByOfficeId: fh.firestoreString(agreement.createdByOfficeId || ""),
    createdByUid: fh.firestoreString(agreement.createdByUid || ""),
    acceptedByOfficeId: fh.firestoreString(agreement.acceptedByOfficeId || ""),
    acceptedByUid: fh.firestoreString(agreement.acceptedByUid || ""),
    approvalsJson: fh.firestoreString(JSON.stringify(approvals)),
    createdAt: fh.firestoreString(agreement.createdAt || ""),
    updatedAt: fh.firestoreString(agreement.updatedAt || ""),
    activatedAt: fh.firestoreString(agreement.activatedAt || ""),
    financialCommitmentCreated: fh.firestoreBoolean(false),
    schemaVersion: fh.firestoreInteger(1)
  };
}

export async function runCommunityAgreementAction({
  projectId,
  actorOfficeId,
  actorUid,
  cooperationId,
  action,
  officeAPercent,
  officeBPercent,
  accessToken,
  deps
}) {
  const fh = firestoreHelpers(deps.firestoreHelpers);
  const coopDoc = await deps.getFirestoreDocument({
    projectId,
    segments: ["cooperationRequests", cooperationId],
    accessToken,
    allowMissing: true
  });
  if (!coopDoc) return { ok: false, error: "cooperation_not_found", status: 404 };
  const request = { id: cooperationId, ...deps.firestoreFieldsToJs(coopDoc.fields || {}) };
  const origin = String(request.originatingOfficeId || "");
  const target = String(request.targetOfficeId || "");
  if (actorOfficeId !== origin && actorOfficeId !== target) {
    return { ok: false, error: "cooperation_forbidden", status: 403 };
  }
  if (String(request.status || "").toUpperCase() !== "ACCEPTED") {
    return {
      ok: false,
      error: "not_accepted",
      status: 400,
      message: "الاتفاقية تتاح بعد قبول الطرفين للتعاون."
    };
  }

  const existingId = String(request.agreementId || "").trim();
  let existing = null;
  if (existingId) {
    const agrDoc = await deps.getFirestoreDocument({
      projectId,
      segments: ["cooperationAgreements", existingId],
      accessToken,
      allowMissing: true
    });
    if (agrDoc) {
      existing = { id: existingId, ...deps.firestoreFieldsToJs(agrDoc.fields || {}) };
      if (existing.approvalsJson && !existing.approvals) {
        try { existing.approvals = JSON.parse(existing.approvalsJson); } catch (_) {
          existing.approvals = {};
        }
      }
    }
  }

  const verb = String(action || "").toUpperCase();
  let result;
  if (verb === "CREATE") {
    result = applyAgreementCreate({
      originatingOfficeId: origin,
      targetOfficeId: target,
      createdByOfficeId: actorOfficeId,
      createdByUid: actorUid,
      officeAPercent: officeAPercent ?? 50,
      officeBPercent: officeBPercent ?? 50
    });
  } else if (verb === "ACCEPT") {
    if (!existing) return { ok: false, error: "agreement_missing", status: 404 };
    result = applyAgreementAccept({
      agreement: existing,
      actorOfficeId,
      actorUid
    });
  } else if (verb === "REVISE") {
    if (!existing) return { ok: false, error: "agreement_missing", status: 404 };
    result = applyAgreementRevise({
      agreement: existing,
      actorOfficeId,
      actorUid,
      officeAPercent,
      officeBPercent
    });
  } else {
    return { ok: false, error: "unknown_action", status: 400 };
  }
  if (!result.ok) return { ...result, status: 400 };

  const version = Number(result.agreement.version || 1);
  const agreementId = existingId || await buildCommunityAgreementId({
    cooperationRequestId: cooperationId,
    version
  });
  await deps.setFirestoreDocument({
    projectId,
    segments: ["cooperationAgreements", agreementId],
    accessToken,
    fields: agreementToFields(result.agreement, {
      id: agreementId,
      officeId: origin,
      cooperationRequestId: cooperationId,
      offerId: request.offerId,
      requestListingId: request.requestIdPair || request.peerOpportunityId
    }, fh)
  });
  await deps.setFirestoreDocument({
    projectId,
    segments: ["cooperationRequests", cooperationId],
    accessToken,
    fields: {
      originatingOfficeId: fh.firestoreString(origin),
      targetOfficeId: fh.firestoreString(target),
      agreementId: fh.firestoreString(agreementId),
      agreementStatus: fh.firestoreString(result.agreement.status),
      updatedAt: fh.firestoreTimestamp(new Date())
    }
  });
  return {
    ok: true,
    agreementId,
    agreement: result.agreement,
    notify: result.agreement.status === "ACTIVE"
      ? communityNotificationCopy("community_agreement")
      : null
  };
}

export async function closeCommunityCooperation({
  projectId,
  actorOfficeId,
  actorUid,
  cooperationId,
  outcome,
  accessToken,
  deps
}) {
  const fh = firestoreHelpers(deps.firestoreHelpers);
  const coopDoc = await deps.getFirestoreDocument({
    projectId,
    segments: ["cooperationRequests", cooperationId],
    accessToken,
    allowMissing: true
  });
  if (!coopDoc) return { ok: false, error: "cooperation_not_found", status: 404 };
  const request = { id: cooperationId, ...deps.firestoreFieldsToJs(coopDoc.fields || {}) };
  const applied = applyCommunityOutcome({ request, outcome, actorOfficeId });
  if (!applied.ok) return { ...applied, status: 400 };

  const origin = String(request.originatingOfficeId || "");
  const target = String(request.targetOfficeId || "");
  let agreementSnapshot = {};
  if (request.agreementId) {
    const agrDoc = await deps.getFirestoreDocument({
      projectId,
      segments: ["cooperationAgreements", request.agreementId],
      accessToken,
      allowMissing: true
    });
    if (agrDoc) agreementSnapshot = deps.firestoreFieldsToJs(agrDoc.fields || {});
  }

  const now = new Date();
  await deps.setFirestoreDocument({
    projectId,
    segments: ["cooperationRequests", cooperationId],
    accessToken,
    fields: {
      originatingOfficeId: fh.firestoreString(origin),
      targetOfficeId: fh.firestoreString(target),
      status: fh.firestoreString("ENDED"),
      outcome: fh.firestoreString(applied.request.outcome),
      closedAt: fh.firestoreTimestamp(now),
      endedAt: fh.firestoreTimestamp(now),
      closedByOfficeId: fh.firestoreString(actorOfficeId),
      closedByUid: fh.firestoreString(actorUid || ""),
      updatedAt: fh.firestoreTimestamp(now),
      open: fh.firestoreBoolean(false)
    }
  });

  const historyId = String(request.pairKey || cooperationId);
  const historyFields = {
    officeId: fh.firestoreString(""),
    cooperationRequestId: fh.firestoreString(cooperationId),
    pairKey: fh.firestoreString(request.pairKey || ""),
    offerId: fh.firestoreString(request.offerId || ""),
    requestListingId: fh.firestoreString(request.requestIdPair || request.peerOpportunityId || ""),
    originatingOfficeId: fh.firestoreString(origin),
    targetOfficeId: fh.firestoreString(target),
    outcome: fh.firestoreString(applied.request.outcome),
    agreementId: fh.firestoreString(request.agreementId || ""),
    officeAPercent: fh.firestoreInteger(Number(agreementSnapshot.officeAPercent || 0)),
    officeBPercent: fh.firestoreInteger(Number(agreementSnapshot.officeBPercent || 0)),
    closedAt: fh.firestoreTimestamp(now),
    schemaVersion: fh.firestoreInteger(1)
  };
  for (const officeId of [origin, target]) {
    await deps.setFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "cooperationHistory", historyId],
      accessToken,
      fields: { ...historyFields, officeId: fh.firestoreString(officeId) }
    });
  }
  return {
    ok: true,
    cooperationId,
    outcome: applied.request.outcome,
    notify: applied.request.outcome === "DEAL_COMPLETED"
      ? communityNotificationCopy("community_deal")
      : null
  };
}

export function communityMatchNotifyThreshold() {
  return Math.max(MATCH_THRESHOLD, 70);
}

export { sanitizePeerListing, isBrokerCommunityEnabled };
