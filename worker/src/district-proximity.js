/**
 * Verified neighborhood adjacency for Madinah districts.
 * Nearby matching uses ONLY pairs listed here — no invented distances.
 * Add pairs only from trusted geographic sources.
 */
export const VERIFIED_DISTRICT_ADJACENCY = Object.freeze({});

function normalizeDistrictKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[,،]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isVerifiedNearbyDistrict(requestedDistrict, listingDistrict) {
  const requested = normalizeDistrictKey(requestedDistrict);
  const listing = normalizeDistrictKey(listingDistrict);
  if (!requested || !listing || requested === listing) return false;
  const neighbors = VERIFIED_DISTRICT_ADJACENCY[requestedDistrict] || VERIFIED_DISTRICT_ADJACENCY[requested] || [];
  return neighbors.some(neighbor => normalizeDistrictKey(neighbor) === listing);
}

export function getVerifiedNearbyDistricts(district) {
  const key = normalizeDistrictKey(district);
  if (!key) return [];
  const direct = VERIFIED_DISTRICT_ADJACENCY[district] || VERIFIED_DISTRICT_ADJACENCY[key] || [];
  return direct.slice();
}

export function districtsMatch(a, b) {
  return normalizeDistrictKey(a) === normalizeDistrictKey(b) && Boolean(normalizeDistrictKey(a));
}

export { normalizeDistrictKey };
