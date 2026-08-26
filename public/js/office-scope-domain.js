/**
 * Office scope — primary neighborhood, service coverage, cooperation availability toggles.
 */

import {
  districtIdFromOfficialName,
  districtLabelById,
  normalizeNeighborhoodName,
  normalizeServiceNeighborhoodIds,
  validateServiceNeighborhoodIds,
  containsNeighborhoodMetadata
} from "./service-neighborhood-domain.js";

export const OFFICE_SCOPE_MESSAGES = Object.freeze({
  primaryRequired: "اختر الحي الرئيسي للمكتب",
  primaryMetadata: "اسم الحي الرئيسي لا يجوز أن يحتوي سعرًا أو مساحة أو وصفًا",
  primaryCity: "الحي الرئيسي خارج مدينة المكتب"
});

export function defaultOfficeScopeFlags(existing = {}) {
  return {
    receiveExternalOpportunities: existing.receiveExternalOpportunities !== false,
    cooperationAvailableNow: existing.cooperationAvailableNow !== false,
    acceptPlatformPublicOpportunities: existing.acceptPlatformPublicOpportunities !== false
  };
}

export function mergePrimaryIntoServiceNeighborhoods(
  primaryNeighborhoodId = "",
  serviceNeighborhoodIds = [],
  cityLabel = ""
) {
  const primary = String(primaryNeighborhoodId || "").trim();
  const merged = primary
    ? [primary, ...normalizeServiceNeighborhoodIds(serviceNeighborhoodIds, cityLabel)]
    : normalizeServiceNeighborhoodIds(serviceNeighborhoodIds, cityLabel);
  return normalizeServiceNeighborhoodIds(merged, cityLabel);
}

export function validatePrimaryNeighborhoodId(id = "", cityLabel = "") {
  const primary = String(id || "").trim();
  if (!primary) {
    return { ok: false, code: "primaryRequired", message: OFFICE_SCOPE_MESSAGES.primaryRequired, id: "" };
  }
  const label = districtLabelById(primary);
  if (containsNeighborhoodMetadata(label)) {
    return { ok: false, code: "metadata", message: OFFICE_SCOPE_MESSAGES.primaryMetadata, id: "" };
  }
  const allowed = districtIdFromOfficialName(label, cityLabel);
  if (!allowed || allowed !== primary) {
    return { ok: false, code: "city", message: OFFICE_SCOPE_MESSAGES.primaryCity, id: "" };
  }
  return { ok: true, code: "", message: "", id: primary };
}

export function buildOfficeScopePayload({
  city = "",
  primaryNeighborhoodId = "",
  serviceNeighborhoodIds = [],
  receiveExternalOpportunities = false,
  cooperationAvailableNow = false,
  acceptPlatformPublicOpportunities = true
} = {}) {
  const cityLabel = String(city || "").trim();
  const primaryCheck = validatePrimaryNeighborhoodId(primaryNeighborhoodId, cityLabel);
  const serviceIds = mergePrimaryIntoServiceNeighborhoods(
    primaryCheck.ok ? primaryCheck.id : "",
    serviceNeighborhoodIds,
    cityLabel
  );
  const neighborhoodCheck = validateServiceNeighborhoodIds(serviceIds, cityLabel, { requireMin: true });
  return {
    ok: primaryCheck.ok && neighborhoodCheck.ok,
    primaryNeighborhoodId: primaryCheck.ok ? primaryCheck.id : "",
    serviceNeighborhoodIds: neighborhoodCheck.ids,
    receiveExternalOpportunities: receiveExternalOpportunities === true,
    cooperationAvailableNow: cooperationAvailableNow === true,
    acceptPlatformPublicOpportunities: acceptPlatformPublicOpportunities !== false,
    errors: [
      ...(primaryCheck.ok ? [] : [primaryCheck.message]),
      ...(neighborhoodCheck.ok ? [] : [neighborhoodCheck.message])
    ]
  };
}

export function resolveLegacyOfficeScope(record = {}) {
  const city = String(record.city || "").trim();
  const serviceIds = normalizeServiceNeighborhoodIds(record.serviceNeighborhoodIds || [], city);
  let primary = String(record.primaryNeighborhoodId || "").trim();
  if (!primary && serviceIds.length) primary = serviceIds[0];
  if (!primary && record.district) {
    const fromDistrict = districtIdFromOfficialName(record.district, city);
    if (fromDistrict) primary = fromDistrict;
  }
  const flags = defaultOfficeScopeFlags(record);
  return {
    city,
    primaryNeighborhoodId: primary,
    serviceNeighborhoodIds: mergePrimaryIntoServiceNeighborhoods(primary, serviceIds, city),
    receiveExternalOpportunities: flags.receiveExternalOpportunities,
    cooperationAvailableNow: flags.cooperationAvailableNow,
    acceptPlatformPublicOpportunities: flags.acceptPlatformPublicOpportunities
  };
}

export function primaryNeighborhoodLabelFromRecord(record = {}) {
  const scope = resolveLegacyOfficeScope(record);
  return districtLabelById(scope.primaryNeighborhoodId) || "";
}

export function serviceNeighborhoodLabelsFromRecord(record = {}, limit = 3) {
  const scope = resolveLegacyOfficeScope(record);
  const labels = scope.serviceNeighborhoodIds.map((id) => districtLabelById(id)).filter(Boolean);
  if (labels.length <= limit) return labels.join("، ");
  return `${labels.slice(0, limit).join("، ")} +${labels.length - limit}`;
}
