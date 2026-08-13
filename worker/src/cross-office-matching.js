import { districtsMatch, isVerifiedNearbyDistrict, normalizeDistrictKey } from "./district-proximity.js";

export const MATCH_TYPE = Object.freeze({
  EXACT_NEIGHBORHOOD: "exact_neighborhood",
  NEARBY_NEIGHBORHOOD: "nearby_neighborhood"
});

export const COOPERATION_STATUS = Object.freeze({
  PENDING: "pending",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  CLOSED: "closed"
});

export const COOPERATION_MATCH_LEVEL = Object.freeze({
  SAME_OFFICE_EXACT: 1,
  COOP_OFFICE_EXACT: 2,
  COOP_OFFICE_NEARBY: 3
});

export function isStrongSameOfficeMatch(scored, source, candidate) {
  if (!scored || !scored.eligible || Number(scored.score || 0) < 55) return false;
  return districtsMatch(source.district, candidate.district);
}

export function classifyDistrictMatch(requestedDistrict, listingDistrict) {
  if (districtsMatch(requestedDistrict, listingDistrict)) {
    return { matchType: MATCH_TYPE.EXACT_NEIGHBORHOOD, isNearbyMatch: false, level: COOPERATION_MATCH_LEVEL.COOP_OFFICE_EXACT };
  }
  if (isVerifiedNearbyDistrict(requestedDistrict, listingDistrict)) {
    return { matchType: MATCH_TYPE.NEARBY_NEIGHBORHOOD, isNearbyMatch: true, level: COOPERATION_MATCH_LEVEL.COOP_OFFICE_NEARBY };
  }
  return null;
}

export function sanitizeCooperationForClientOffice({ parsed, candidate, listingOfficeId, classification, scored }) {
  return {
    role: "client_owner",
    clientOfficeId: "",
    listingOfficeId,
    requestedNeighborhood: parsed.district || "",
    listingNeighborhood: candidate.district || "",
    isNearbyMatch: classification.isNearbyMatch,
    matchType: classification.matchType,
    matchLevel: classification.level,
    propertyType: candidate.propertyType || parsed.propertyType || "",
    transactionType: candidate.transactionType || parsed.transactionType || "",
    listingPrice: Number(candidate.price || candidate.priceMax || 0) || null,
    listingArea: Number(candidate.area || 0) || null,
    matchScore: Number(scored.score || 0),
    opportunityScore: Number(scored.opportunityScore || 0),
    reasons: (scored.reasons || []).filter(r => !/جوال|هاتف|اسم|عميل|مالك/i.test(String(r))),
    warnings: scored.warnings || [],
    status: COOPERATION_STATUS.PENDING,
    isCooperation: true
  };
}

export function sanitizeCooperationForListingOffice({ parsed, candidate, clientOfficeId, classification, scored }) {
  return {
    role: "listing_owner",
    clientOfficeId,
    listingOfficeId: "",
    requestedNeighborhood: parsed.district || "",
    listingNeighborhood: candidate.district || "",
    isNearbyMatch: classification.isNearbyMatch,
    matchType: classification.matchType,
    matchLevel: classification.level,
    propertyType: parsed.propertyType || candidate.propertyType || "",
    transactionType: parsed.transactionType || candidate.transactionType || "",
    requestedPriceMin: Number(parsed.priceMin || parsed.price || 0) || null,
    requestedPriceMax: Number(parsed.priceMax || parsed.price || 0) || null,
    requestedArea: Number(parsed.area || 0) || null,
    matchScore: Number(scored.score || 0),
    opportunityScore: Number(scored.opportunityScore || 0),
    reasons: (scored.reasons || []).filter(r => !/جوال|هاتف|اسم|عميل|مالك/i.test(String(r))),
    warnings: scored.warnings || [],
    status: COOPERATION_STATUS.PENDING,
    isCooperation: true
  };
}

export function scoreOfficeForAssignment({ officeId, officeMeta = {}, inventory = {}, parsed, proximityTier = "exact" }) {
  let score = 0;
  const district = normalizeDistrictKey(parsed.district);
  const propertyType = normalizeDistrictKey(parsed.propertyType);

  if (proximityTier === "exact" && inventory.exactDistrictListings > 0) score += 60;
  if (proximityTier === "nearby" && inventory.nearbyDistrictListings > 0) score += 40;
  if (inventory.exactDistrictListings > 0) score += 20;
  if (inventory.matchingPropertyListings > 0) score += 15;

  const officeCity = normalizeDistrictKey(officeMeta.city || "");
  const requestCity = normalizeDistrictKey(parsed.city || "المدينة المنورة");
  if (officeCity && officeCity === requestCity) score += 10;

  const specialties = Array.isArray(officeMeta.specialties) ? officeMeta.specialties : [];
  const tx = String(parsed.transactionType || "sale").toLowerCase();
  if (tx === "sale" && specialties.includes("sale")) score += 5;
  if (tx === "rent" && specialties.includes("rent")) score += 5;

  const load = Number(officeMeta.platformAssignmentCount || 0);
  score -= Math.min(load, 30);

  return {
    officeId,
    score,
    proximityTier,
    district,
    propertyType,
    inventory,
    assignmentLoad: load
  };
}

export function selectOfficeForAssignment(candidates) {
  const eligible = (Array.isArray(candidates) ? candidates : []).filter(c => Number(c.score || 0) > 0);
  if (!eligible.length) return null;
  eligible.sort((a, b) => {
    const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    const loadDiff = Number(a.assignmentLoad || 0) - Number(b.assignmentLoad || 0);
    if (loadDiff !== 0) return loadDiff;
    return String(a.officeId || "").localeCompare(String(b.officeId || ""), "ar");
  });
  return eligible[0];
}

export function cooperationTitle(view, matchType) {
  if (matchType === MATCH_TYPE.NEARBY_NEIGHBORHOOD) {
    return `فرصة تعاون — حي قريب (${Number(view.matchScore || 0)}%)`;
  }
  return `فرصة تعاون — نفس الحي (${Number(view.matchScore || 0)}%)`;
}

export function cooperationSubtitle(view) {
  const parts = [view.propertyType, view.requestedNeighborhood];
  if (view.isNearbyMatch && view.listingNeighborhood) {
    parts.push(`عرض في ${view.listingNeighborhood}`);
  }
  return parts.filter(Boolean).join(" — ");
}
