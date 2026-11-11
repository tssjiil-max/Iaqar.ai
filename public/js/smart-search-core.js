/* iAqar public search ranking foundation.
 * Pure functions: no database access, no invented inventory or coordinates.
 * Callers must supply only listings authorized for public search.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.IAQARSmartSearch = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const MAX_RESULTS = 10;
  const text = value => String(value == null ? "" : value).trim();
  const norm = value => text(value).normalize("NFKC").replace(/[\u064B-\u065F\u0670]/g, "").replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").toLowerCase();
  const num = value => { const n = Number(value); return Number.isFinite(n) ? n : null; };
  const coordinates = item => {
    const lat = num(item?.latitude ?? item?.lat ?? item?.location?.lat);
    const lng = num(item?.longitude ?? item?.lng ?? item?.location?.lng);
    return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? {lat, lng} : null;
  };
  const distanceKm = (a, b) => {
    if (!a || !b) return null;
    const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return Math.round(6371.0088 * 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 10) / 10;
  };
  function search(listings, request, options = {}) {
    const q = request || {};
    const officeId = text(options.officeId);
    const allOffices = options.scope === "all";
    if (!allOffices && !officeId) throw new Error("OFFICE_SCOPE_REQUIRED");
    const target = coordinates(options.targetCoordinates);
    const limit = Math.min(MAX_RESULTS, Math.max(1, Number.isFinite(Number(options.limit)) ? Math.floor(Number(options.limit)) : MAX_RESULTS));
    const seen = new Set();
    const output = [];
    for (const item of Array.isArray(listings) ? listings : []) {
      if (!item || typeof item !== "object" || item.publicVisible !== true || item.available !== true) continue;
      const itemOffice = text(item.officeId);
      if (!itemOffice || (!allOffices && itemOffice !== officeId)) continue;
      const id = text(item.propertyId || item.id);
      if (!id) continue;
      const dedupe = text(item.canonicalPropertyId) || itemOffice + ":" + id;
      if (seen.has(dedupe)) continue;
      const type = norm(item.propertyType), purpose = norm(item.purpose);
      if (q.propertyType && type !== norm(q.propertyType)) continue;
      if (q.purpose && purpose !== norm(q.purpose)) continue;
      const price = num(item.price), max = num(q.maxPrice), min = num(q.minPrice);
      if (max !== null && price !== null && price > max) continue;
      if (min !== null && price !== null && price < min) continue;
      const rooms = num(item.rooms), minRooms = num(q.minRooms);
      if (minRooms !== null && rooms !== null && rooms < minRooms) continue;
      const districtMatch = Boolean(q.district && norm(item.district) === norm(q.district));
      const km = distanceKm(target, coordinates(item));
      const priceFit = max !== null && price !== null ? Math.max(0, 1 - Math.abs(max - price) / Math.max(max, 1)) : 0;
      const score = (districtMatch ? 60 : 0) + (q.propertyType ? 15 : 0) + (q.purpose ? 10 : 0) + Math.round(priceFit * 10) + (km !== null ? Math.max(0, 5 - km) : 0);
      const reasons = [];
      if (districtMatch) reasons.push("في الحي المطلوب");
      else if (q.district && km !== null) reasons.push("اقتراح قريب من الحي المطلوب");
      if (max !== null && price !== null) reasons.push("ضمن الميزانية");
      output.push({listing:item, propertyId:id, officeId:itemOffice, score:Math.round(score * 10) / 10, exactDistrict:districtMatch, distanceKm:km, distanceType:km === null ? null : "straight_line", reasons});
      seen.add(dedupe);
    }
    return output.sort((a, b) => Number(b.exactDistrict) - Number(a.exactDistrict) || b.score - a.score || (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.propertyId.localeCompare(b.propertyId)).slice(0, limit);
  }
  return Object.freeze({search, distanceKm, normalizeArabic:norm, MAX_RESULTS});
});
