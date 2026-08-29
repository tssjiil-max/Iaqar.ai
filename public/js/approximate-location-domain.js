/**
 * Stable coarse location for party clients — never expose exact coordinates before broker confirmation.
 */

const COARSE_DECIMALS = 3;
const DEFAULT_RADIUS_METERS = 400;

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function finiteCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function readExactGeo(record = {}) {
  const lat = finiteCoord(record.lat ?? record.latitude ?? record.geoLat ?? record.locationLat);
  const lng = finiteCoord(record.lng ?? record.longitude ?? record.geoLng ?? record.locationLng);
  if (lat == null || lng == null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

export function stableCoarseGeoPoint(lat, lng, { decimals = COARSE_DECIMALS, radiusMeters = DEFAULT_RADIUS_METERS } = {}) {
  const factor = 10 ** decimals;
  return {
    lat: Math.round(lat * factor) / factor,
    lng: Math.round(lng * factor) / factor,
    radiusMeters
  };
}

export function districtLocationLabel(record = {}) {
  const city = text(record.city);
  const district = text(record.district).replace(/^حي\s+/, "");
  const districtLabel = district ? `حي ${district}` : "";
  return [city, districtLabel].filter(Boolean).join(" - ");
}

/**
 * Client-safe location payload. Exact lat/lng only when exactAllowed (broker confirmed viewing).
 */
export function buildPartyLocationView(record = {}, { exactAllowed = false } = {}) {
  const label = districtLocationLabel(record);
  const exact = readExactGeo(record);
  if (!exact) {
    return {
      mode: label ? "district" : "none",
      title: label ? "الموقع" : "",
      areaLabel: label,
      map: null,
      exactAllowed: false
    };
  }
  if (exactAllowed) {
    const locationUrl = text(record.locationUrl || record.mapUrl);
    return {
      mode: "exact",
      title: "الموقع",
      areaLabel: label,
      exactAllowed: true,
      map: {
        lat: exact.lat,
        lng: exact.lng,
        locationUrl: /^https:\/\//i.test(locationUrl) ? locationUrl : ""
      }
    };
  }
  const coarse = stableCoarseGeoPoint(exact.lat, exact.lng);
  return {
    mode: "approximate",
    title: "الموقع التقريبي",
    areaLabel: label,
    exactAllowed: false,
    map: {
      lat: coarse.lat,
      lng: coarse.lng,
      radiusMeters: coarse.radiusMeters
    }
  };
}

export function stripExactGeoFromRecord(record = {}) {
  const copy = { ...record };
  delete copy.lat;
  delete copy.lng;
  delete copy.latitude;
  delete copy.longitude;
  delete copy.geoLat;
  delete copy.geoLng;
  delete copy.locationLat;
  delete copy.locationLng;
  if (!copy.exactLocationAllowed) {
    delete copy.locationUrl;
    delete copy.mapUrl;
  }
  return copy;
}

if (typeof window !== "undefined") {
  window.IAQARApproximateLocation = {
    buildPartyLocationView,
    stableCoarseGeoPoint,
    readExactGeo,
    stripExactGeoFromRecord
  };
}
