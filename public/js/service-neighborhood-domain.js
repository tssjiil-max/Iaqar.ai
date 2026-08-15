/**
 * Office service neighborhood specialization — canonical IDs, 1–5 per city.
 * Not a sales restriction; used for display and cooperation ranking only.
 */

import { DISTRICTS, CITIES } from "./reference-catalog.js";
import { neighborhoodIdsForCity } from "./neighborhood-adjacency-domain.js";

export const SERVICE_NEIGHBORHOOD_MIN = 1;
export const SERVICE_NEIGHBORHOOD_MAX = 5;

export const SERVICE_NEIGHBORHOOD_MESSAGES = Object.freeze({
  min: "اختر حيًا واحدًا على الأقل",
  max: "يمكن اختيار 5 أحياء كحد أقصى",
  city: "الحي خارج مدينة المكتب",
  duplicate: "تم اختيار هذا الحي مسبقًا"
});

function districtById(id) {
  return DISTRICTS.find((row) => row.id === id) || null;
}

export function districtLabelById(id = "") {
  return districtById(id)?.officialName || "";
}

export function districtIdFromOfficialName(label = "", cityLabel = "") {
  const needle = String(label || "").trim();
  if (!needle) return "";
  const allowed = new Set(neighborhoodIdsForCity(cityLabel));
  const match = DISTRICTS.find((row) => row.officialName === needle && allowed.has(row.id));
  return match?.id || "";
}

export function districtOptionsForCity(cityLabel = "") {
  const allowed = neighborhoodIdsForCity(cityLabel);
  return DISTRICTS
    .filter((row) => allowed.includes(row.id))
    .map((row) => row.officialName)
    .sort((a, b) => a.localeCompare(b, "ar"));
}

export function normalizeServiceNeighborhoodIds(ids = [], cityLabel = "") {
  const allowed = new Set(neighborhoodIdsForCity(cityLabel));
  const out = [];
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = String(raw || "").trim();
    if (!id || !allowed.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= SERVICE_NEIGHBORHOOD_MAX) break;
  }
  return out;
}

export function validateServiceNeighborhoodIds(ids = [], cityLabel = "", options = {}) {
  const requireMin = options.requireMin !== false;
  const rawList = Array.isArray(ids) ? ids : [];
  const trimmed = rawList.map((v) => String(v || "").trim()).filter(Boolean);
  const unique = [...new Set(trimmed)];
  if (trimmed.length !== unique.length) {
    return {
      ok: false,
      code: "duplicate",
      message: SERVICE_NEIGHBORHOOD_MESSAGES.duplicate,
      ids: normalizeServiceNeighborhoodIds(unique, cityLabel)
    };
  }
  const allowed = new Set(neighborhoodIdsForCity(cityLabel));
  const invalidCity = unique.filter((id) => !allowed.has(id));
  if (invalidCity.length) {
    return {
      ok: false,
      code: "city",
      message: SERVICE_NEIGHBORHOOD_MESSAGES.city,
      ids: normalizeServiceNeighborhoodIds(trimmed, cityLabel)
    };
  }
  if (trimmed.length > SERVICE_NEIGHBORHOOD_MAX) {
    return {
      ok: false,
      code: "max",
      message: SERVICE_NEIGHBORHOOD_MESSAGES.max,
      ids: normalizeServiceNeighborhoodIds(unique, cityLabel)
    };
  }
  const normalized = normalizeServiceNeighborhoodIds(unique, cityLabel);
  if (requireMin && normalized.length < SERVICE_NEIGHBORHOOD_MIN) {
    return {
      ok: false,
      code: "min",
      message: SERVICE_NEIGHBORHOOD_MESSAGES.min,
      ids: normalized
    };
  }
  if (trimmed.length !== normalized.length) {
    return {
      ok: false,
      code: "duplicate",
      message: SERVICE_NEIGHBORHOOD_MESSAGES.duplicate,
      ids: normalized
    };
  }
  return { ok: true, code: "", message: "", ids: normalized };
}
