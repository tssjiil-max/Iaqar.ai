/**
 * Documented neighborhood adjacency for Madinah — no GPS, no name-similarity guessing.
 * Each district id matches reference-catalog DISTRICTS ids (madinah-NNN).
 */

import { DISTRICTS, CITIES } from "./reference-catalog.js";

const ADJACENCY_BY_ID = Object.freeze({
  "madinah-016": ["madinah-015", "madinah-017", "madinah-018", "madinah-019"],
  "madinah-015": ["madinah-016", "madinah-014", "madinah-017"],
  "madinah-017": ["madinah-016", "madinah-015", "madinah-018"],
  "madinah-018": ["madinah-016", "madinah-017", "madinah-019"],
  "madinah-019": ["madinah-016", "madinah-018", "madinah-020"],
  "madinah-003": ["madinah-004", "madinah-005", "madinah-006"],
  "madinah-004": ["madinah-003", "madinah-005"],
  "madinah-005": ["madinah-003", "madinah-004", "madinah-006"]
});

function districtByOfficialName(name) {
  const needle = String(name || "").trim();
  if (!needle) return null;
  return DISTRICTS.find((row) => row.officialName === needle) || null;
}

function districtById(id) {
  return DISTRICTS.find((row) => row.id === id) || null;
}

export function resolveDistrictIdFromLabel(label = "", cityLabel = "") {
  const district = districtByOfficialName(label);
  if (district) return district.id;
  const city = CITIES.find((row) =>
    row.label === cityLabel || (row.aliases || []).includes(cityLabel)
  );
  if (!city || city.id !== "madinah") return "";
  return "";
}

export function neighborhoodIdsForCity(cityLabel = "") {
  const city = CITIES.find((row) =>
    row.label === cityLabel || (row.aliases || []).includes(cityLabel)
  );
  if (!city) return [];
  return DISTRICTS.filter((row) => row.cityId === city.id).map((row) => row.id);
}

export function adjacentNeighborhoodIds(neighborhoodId = "") {
  const id = String(neighborhoodId || "").trim();
  if (!id) return [];
  return [...(ADJACENCY_BY_ID[id] || [])];
}

export function neighborhoodTier({
  opportunityDistrictId = "",
  officeServiceIds = []
} = {}) {
  const service = new Set(
    Array.isArray(officeServiceIds) ? officeServiceIds.map((v) => String(v)) : []
  );
  if (!opportunityDistrictId) {
    return service.size ? 3 : 4;
  }
  if (service.has(opportunityDistrictId)) return 1;
  const neighbors = adjacentNeighborhoodIds(opportunityDistrictId);
  if (neighbors.some((id) => service.has(id))) return 2;
  return 3;
}

export function neighborhoodRelationLabel({
  opportunityDistrictId = "",
  officeServiceIds = []
} = {}) {
  const tier = neighborhoodTier({ opportunityDistrictId, officeServiceIds });
  const opp = districtById(opportunityDistrictId);
  if (tier === 1) return "نفس الحي";
  if (tier === 2) {
    const neighbor = adjacentNeighborhoodIds(opportunityDistrictId)
      .map((id) => districtById(id))
      .find((row) => (officeServiceIds || []).includes(row?.id));
    return neighbor ? `حي مجاور — ${neighbor.officialName}` : "حي مجاور";
  }
  if (tier === 3 && opp) return `داخل نطاق المدينة — ${opp.officialName}`;
  return "داخل نطاق المدينة";
}

export function buildDefaultServiceNeighborhoodIds(cityLabel = "") {
  return neighborhoodIdsForCity(cityLabel);
}
