/**
 * Opportunity workspace bundle — matches, suggestions, cooperation, room.
 */

import {
  evaluateMatchingReadiness,
  missingFieldLabelsArabic
} from "../../public/js/opportunity-readiness-domain.js";
import {
  buildCooperationNearbySuggestions,
  resolveNearbyEmptyReason
} from "./cooperation-nearby-service.js";
import { activeFollowUpFromRecord } from "../../public/js/opportunity-followup-domain.js";

function safeText(value = "", max = 500) {
  return String(value || "").trim().slice(0, max);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeCity(value = "") {
  return String(value || "").trim().toLowerCase();
}

function sameCity(officeCity = "", opportunityCity = "") {
  const a = normalizeCity(officeCity);
  const b = normalizeCity(opportunityCity);
  if (!a || !b) return true;
  return a === b;
}

function neighborhoodSpecialistLabel(district = "", tier = 3) {
  const name = safeText(district, 80);
  if (tier === 1 && name) return `متخصص في حي ${name}`;
  if (tier === 2 && name) return `حي مجاور لـ ${name}`;
  return name ? `داخل ${name}` : "داخل نطاق المدينة";
}

export async function loadOpportunityWorkspaceBundle({
  projectId,
  officeId,
  opportunityId,
  accessToken,
  getFirestoreDocument,
  listCollectionDocuments,
  firestoreFieldsToJs
}) {
  const oppDoc = await getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "opportunities", opportunityId],
    accessToken,
    allowMissing: true
  });
  if (!oppDoc) {
    return { ok: false, error: "opportunity_not_found" };
  }
  const opportunity = {
    id: opportunityId,
    officeId,
    ...firestoreFieldsToJs(oppDoc.fields || {})
  };

  const matchDocs = await listCollectionDocuments({
    projectId,
    segments: ["offices", officeId, "matches"],
    accessToken,
    pageSize: 120
  });
  const matches = [];
  for (const doc of matchDocs) {
    const matchId = decodeURIComponent(String(doc.name || "").split("/").pop() || "");
    const match = { matchId, ...firestoreFieldsToJs(doc.fields || {}) };
    const relates = match.opportunityId === opportunityId
      || match.counterpartOpportunityId === opportunityId;
    if (!relates || match.isCurrent === false || match.status === "superseded") continue;
    const score = Number(match.score || match.opportunityScore || 0);
    if (score <= 0) continue;
    matches.push({
      matchId,
      score: Math.round(score),
      reasons: parseJsonArray(match.reasonsJson),
      warnings: parseJsonArray(match.warningsJson),
      breakdown: parseJsonArray(match.breakdownJson),
      opportunityId: match.opportunityId || "",
      counterpartOpportunityId: match.counterpartOpportunityId || "",
      propertyType: match.propertyType || "",
      district: match.district || "",
      city: match.city || "",
      status: match.status || "active",
      isCurrent: true,
      rank: Number(match.rank || 0),
      isInternal: !match.cooperationMatch
    });
  }
  matches.sort((a, b) => b.score - a.score || a.rank - b.rank);

  const publicDocs = await listCollectionDocuments({
    projectId,
    segments: ["publicOffices"],
    accessToken,
    pageSize: 120
  });
  const publicOffices = publicDocs.map((doc) => ({
    officeId: decodeURIComponent(String(doc.name || "").split("/").pop() || ""),
    ...firestoreFieldsToJs(doc.fields || {})
  }));

  const officeOpportunities = [];
  for (const office of publicOffices) {
    const targetId = String(office.officeId || "").trim().toLowerCase();
    if (!targetId || targetId === officeId) continue;
    if (String(office.accountStatus || "").toLowerCase() === "paused") continue;
    if (!sameCity(office.city, opportunity.city)) continue;
    const docs = await listCollectionDocuments({
      projectId,
      segments: ["offices", targetId, "opportunities"],
      accessToken,
      pageSize: 40
    });
    for (const doc of docs) {
      const id = decodeURIComponent(String(doc.name || "").split("/").pop() || "");
      officeOpportunities.push({
        id,
        officeId: targetId,
        ...firestoreFieldsToJs(doc.fields || {})
      });
    }
  }

  let suggestions = await buildCooperationNearbySuggestions({
    sourceOpportunity: opportunity,
    ownOfficeId: officeId,
    publicOffices: publicOffices.filter((row) => sameCity(row.city, opportunity.city)),
    officeOpportunities
  });
  suggestions = suggestions.map((row) => ({
    ...row,
    neighborhoodLabel: neighborhoodSpecialistLabel(opportunity.district, row.tier),
    reason: neighborhoodSpecialistLabel(opportunity.district, row.tier),
    hasOppositeOpportunity: Boolean(row.opportunityId),
    cooperationState: row.cooperationMode || "APPROVAL_REQUIRED"
  })).slice(0, 5);

  const coopDocs = await listCollectionDocuments({
    projectId,
    segments: ["cooperationRequests"],
    accessToken,
    pageSize: 80
  });
  const cooperationRequests = [];
  let cooperationRoom = null;
  for (const doc of coopDocs) {
    const requestId = decodeURIComponent(String(doc.name || "").split("/").pop() || "");
    const row = { id: requestId, ...firestoreFieldsToJs(doc.fields || {}) };
    const origin = String(row.originatingOfficeId || "");
    const target = String(row.targetOfficeId || "");
    if (officeId !== origin && officeId !== target) continue;
    const ids = Array.isArray(row.opportunityIds) ? row.opportunityIds
      : (row.opportunityId ? [row.opportunityId] : []);
    if (!ids.some((id) => String(id) === opportunityId)) continue;
    cooperationRequests.push({
      id: requestId,
      status: row.status || "PENDING",
      originatingOfficeId: origin,
      targetOfficeId: target,
      targetOfficeName: row.targetOfficeName || target,
      originatingOfficeName: row.originatingOfficeName || origin,
      message: row.message || "",
      createdAt: row.createdAt || "",
      updatedAt: row.updatedAt || ""
    });
    if (String(row.status || "").toUpperCase() === "ACCEPTED") {
      const roomDoc = await getFirestoreDocument({
        projectId,
        segments: ["cooperationRooms", requestId],
        accessToken,
        allowMissing: true
      });
      if (roomDoc) {
        cooperationRoom = {
          id: requestId,
          ...firestoreFieldsToJs(roomDoc.fields || {})
        };
      }
    }
  }

  const readiness = evaluateMatchingReadiness(opportunity);
  const followUp = activeFollowUpFromRecord(opportunity);
  const emptyReason = suggestions.length
    ? null
    : resolveNearbyEmptyReason(opportunity, suggestions);

  return {
    ok: true,
    opportunity,
    matches,
    suggestions,
    suggestionsEmptyReason: emptyReason,
    cooperationRequests,
    cooperationRoom,
    followUp,
    readiness: {
      isReadyForMatching: readiness.isReadyForMatching,
      matchingReadinessMissing: readiness.matchingReadinessMissing || [],
      missingLabels: missingFieldLabelsArabic(readiness.matchingReadinessMissing || [])
    }
  };
}

export async function ensureCooperationRoom({
  projectId,
  cooperationId,
  originatingOfficeId,
  targetOfficeId,
  opportunityId,
  accessToken,
  getFirestoreDocument,
  setFirestoreDocument,
  firestoreFieldsToJs,
  firestoreHelpers
}) {
  const existing = await getFirestoreDocument({
    projectId,
    segments: ["cooperationRooms", cooperationId],
    accessToken,
    allowMissing: true
  });
  if (existing) return { created: false, id: cooperationId };

  const oppDoc = await getFirestoreDocument({
    projectId,
    segments: ["offices", originatingOfficeId, "opportunities", opportunityId],
    accessToken,
    allowMissing: true
  });
  const opp = oppDoc ? firestoreFieldsToJs(oppDoc.fields || {}) : {};
  const now = new Date();
  await setFirestoreDocument({
    projectId,
    segments: ["cooperationRooms", cooperationId],
    accessToken,
    fields: {
      schemaVersion: firestoreHelpers.firestoreInteger(1),
      cooperationId: firestoreHelpers.firestoreString(cooperationId),
      originatingOfficeId: firestoreHelpers.firestoreString(originatingOfficeId),
      targetOfficeId: firestoreHelpers.firestoreString(targetOfficeId),
      opportunityId: firestoreHelpers.firestoreString(opportunityId),
      status: firestoreHelpers.firestoreString("ACTIVE"),
      summaryPropertyType: firestoreHelpers.firestoreString(opp.propertyType || ""),
      summaryCity: firestoreHelpers.firestoreString(opp.city || ""),
      summaryDistrict: firestoreHelpers.firestoreString(opp.district || ""),
      createdAt: firestoreHelpers.firestoreTimestamp(now),
      updatedAt: firestoreHelpers.firestoreTimestamp(now)
    }
  });
  return { created: true, id: cooperationId };
}
