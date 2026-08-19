/**
 * Suitable offices listing for explicit cooperation — city-scoped, tier-ranked.
 */

import {
  rankSuitableOffices,
  requiresOpportunityLocationCompletion,
  SUITABLE_OFFICE_TIER_LABELS,
  isOfficeEligibleForCooperationListing
} from "../../public/js/suitable-offices-domain.js";
import { minimumSharedFields } from "./cooperation-phase6-domain.js";
import { resolveLegacyOfficeScope } from "../../public/js/office-scope-domain.js";

function safeOfficeId(value) {
  return String(value || "").trim().toLowerCase();
}

function publicOfficeFromFields(officeId, data = {}) {
  const scope = resolveLegacyOfficeScope(data);
  return {
    officeId: safeOfficeId(data.officeId || officeId),
    id: safeOfficeId(officeId),
    officeName: String(data.officeName || ""),
    brokerName: String(data.brokerName || ""),
    city: String(data.city || ""),
    logoUrl: String(data.logoUrl || ""),
    displayImageUrl: String(data.displayImageUrl || ""),
    coverUrl: String(data.coverUrl || ""),
    licenseNumber: String(data.licenseNumber || ""),
    specialties: Array.isArray(data.specialties) ? data.specialties : [],
    cooperationMode: String(data.cooperationMode || "APPROVAL_REQUIRED"),
    approvalStatus: String(data.approvalStatus || ""),
    accountStatus: String(data.accountStatus || ""),
    primaryNeighborhoodId: scope.primaryNeighborhoodId,
    serviceNeighborhoodIds: scope.serviceNeighborhoodIds,
    receiveExternalOpportunities: scope.receiveExternalOpportunities,
    cooperationAvailableNow: scope.cooperationAvailableNow
  };
}

export async function buildSuitableOfficesResult({
  projectId,
  actorOfficeId,
  opportunityId,
  searchQuery = "",
  accessToken,
  deps
}) {
  const origin = safeOfficeId(actorOfficeId);
  const oppId = String(opportunityId || "").trim();
  if (!origin || !oppId) {
    return { ok: false, error: "ids_required", status: 400 };
  }

  const oppDoc = await deps.getFirestoreDocument({
    projectId,
    segments: ["offices", origin, "opportunities", oppId],
    accessToken,
    allowMissing: true
  });
  if (!oppDoc) return { ok: false, error: "opportunity_not_found", status: 404 };
  const opportunity = deps.firestoreFieldsToJs(oppDoc.fields || {});
  if (safeOfficeId(opportunity.officeId) !== origin) {
    return { ok: false, error: "opportunity_forbidden", status: 403 };
  }

  if (requiresOpportunityLocationCompletion(opportunity)) {
    return {
      ok: true,
      requiresCompletion: true,
      message: "يلزم استكمال المدينة والحي لعرض المكاتب المناسبة",
      buckets: {},
      total: 0,
      tierLabels: SUITABLE_OFFICE_TIER_LABELS,
      sharedPreview: null
    };
  }

  const city = String(opportunity.city || "").trim();
  const publicDocs = await deps.listCollectionDocuments({
    projectId,
    segments: ["publicOffices"],
    accessToken,
    pageSize: 200
  }).catch(() => []);

  const offices = [];
  for (const doc of publicDocs) {
    const id = decodeURIComponent(String(doc.name || "").split("/").pop() || "");
    const publicData = deps.firestoreFieldsToJs(doc.fields || {});
    let merged = publicData;
    try {
      const officeDoc = await deps.getFirestoreDocument({
        projectId,
        segments: ["offices", id],
        accessToken,
        allowMissing: true
      });
      if (officeDoc?.fields) {
        const officeData = deps.firestoreFieldsToJs(officeDoc.fields || {});
        merged = { ...officeData, ...publicData };
      }
    } catch (_) {
      /* keep public snapshot only */
    }
    if (!cityMatchesCityField(merged.city || publicData.city, city)) continue;
    offices.push(publicOfficeFromFields(id, merged));
  }

  const ranked = rankSuitableOffices({
    opportunity,
    offices,
    ownOfficeId: origin,
    searchQuery
  });

  const min = minimumSharedFields(opportunity);
  const sharedPreview = {
    opportunityKind: min.opportunityKind,
    propertyType: min.propertyType,
    purpose: min.purpose,
    city: min.city,
    district: min.district,
    priceOrBudget: min.priceOrBudget,
    area: min.area,
    rooms: min.rooms,
    description: sanitizeShareDescription(opportunity)
  };

  return {
    ok: true,
    requiresCompletion: false,
    opportunityId: oppId,
    opportunityCity: ranked.opportunityCity,
    opportunityDistrictLabels: ranked.opportunityDistrictLabels,
    buckets: ranked.buckets,
    total: ranked.total,
    tierLabels: SUITABLE_OFFICE_TIER_LABELS,
    sharedPreview
  };
}

function cityMatchesCityField(officeCity = "", opportunityCity = "") {
  const office = String(officeCity || "").trim();
  const opp = String(opportunityCity || "").trim();
  if (!office || !opp) return false;
  return office === opp || office.includes(opp) || opp.includes(office);
}

function sanitizeShareDescription(opportunity = {}) {
  const blocked = ["contactPhone", "phone", "contactName", "advertiserPhoneRaw", "rawText"];
  let text = String(opportunity.publicDescription || opportunity.description || opportunity.details || "").trim();
  if (!text) return "";
  text = text.replace(/(\+?966|0)?5\d{8}/g, "").replace(/\b\d{10,15}\b/g, "");
  for (const key of blocked) {
    if (opportunity[key]) text = text.replace(String(opportunity[key]), "");
  }
  return text.slice(0, 500);
}

export async function readTargetOfficeEligibility({
  projectId,
  targetOfficeId,
  accessToken,
  deps
}) {
  const target = safeOfficeId(targetOfficeId);
  if (!target) return { ok: false, eligible: false };
  const publicDoc = await deps.getFirestoreDocument({
    projectId,
    segments: ["publicOffices", target],
    accessToken,
    allowMissing: true
  });
  const officeDoc = await deps.getFirestoreDocument({
    projectId,
    segments: ["offices", target],
    accessToken,
    allowMissing: true
  });
  const publicData = publicDoc ? deps.firestoreFieldsToJs(publicDoc.fields || {}) : {};
  const officeData = officeDoc ? deps.firestoreFieldsToJs(officeDoc.fields || {}) : {};
  const merged = publicOfficeFromFields(target, {
    ...officeData,
    ...publicData,
    approvalStatus: publicData.approvalStatus || officeData.approvalStatus,
    accountStatus: publicData.accountStatus || officeData.accountStatus
  });
  return {
    ok: true,
    eligible: isOfficeEligibleForCooperationListing(merged),
    office: merged
  };
}
