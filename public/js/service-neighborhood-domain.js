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
  duplicate: "تم اختيار هذا الحي مسبقًا",
  metadata: "اسم الحي لا يجوز أن يحتوي سعرًا أو مساحة أو وصفًا"
});

const NEIGHBORHOOD_METADATA_PATTERNS = [
  /\d+\s*(مليون|الف|ألف|ريال|م²|متر)/i,
  /مساحة/i,
  /سعر/i,
  /وصف/i,
  /ميزانية/i
];

function districtByOfficialName(name, cityLabel = "") {
  const needle = String(name || "").replace(/\s+/g, " ").trim().replace(/^حي\s+/u, "").trim();
  if (!needle) return null;
  const city = CITIES.find((row) =>
    row.label === cityLabel || (row.aliases || []).includes(cityLabel)
  );
  if (!city) return DISTRICTS.find((row) => row.officialName === needle) || null;
  return DISTRICTS.find((row) => row.officialName === needle && row.cityId === city.id) || null;
}

export function districtLabelById(id = "") {
  return DISTRICTS.find((row) => row.id === id)?.officialName || "";
}

export function containsNeighborhoodMetadata(value = "") {
  const text = String(value || "").trim();
  if (!text) return false;
  return NEIGHBORHOOD_METADATA_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Canonical neighborhood label — trim, dedupe list helper, block price/area/description noise.
 * Unifies only catalog-equivalent spellings; does not rename unknown valid Arabic labels.
 */
export function normalizeNeighborhoodName(value = "", cityLabel = "") {
  let text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (containsNeighborhoodMetadata(text)) return "";
  text = text.replace(/^حي\s+/u, "").trim();
  const district = districtByOfficialName(text, cityLabel);
  if (district) return district.officialName;
  return text;
}

export function normalizeNeighborhoodNames(values = [], cityLabel = "") {
  const out = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const name = normalizeNeighborhoodName(raw, cityLabel);
    if (!name || out.includes(name)) continue;
    out.push(name);
  }
  return out;
}

export function districtIdFromOfficialName(label = "", cityLabel = "") {
  const needle = String(label || "").replace(/\s+/g, " ").trim().replace(/^حي\s+/u, "").trim();
  if (!needle || containsNeighborhoodMetadata(needle)) return "";
  return districtByOfficialName(needle, cityLabel)?.id || "";
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
