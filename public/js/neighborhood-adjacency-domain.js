/**
 * Documented neighborhood adjacency for Madinah — no GPS, no name-similarity guessing.
 * District ids match reference-catalog DISTRICTS ids (madinah-NNN).
 */

import { DISTRICTS, CITIES } from "./reference-catalog.js";
import { MADINAH_ADJACENCY_BY_NAME } from "./neighborhood-adjacency-data.js";

function districtByOfficialName(name, cityLabel = "") {
  const needle = String(name || "").replace(/\s+/g, " ").trim().replace(/^حي\s+/u, "").trim();
  if (!needle) return null;
  const city = CITIES.find((row) =>
    row.label === cityLabel || (row.aliases || []).includes(cityLabel)
  );
  if (!city) return DISTRICTS.find((row) => row.officialName === needle) || null;
  return DISTRICTS.find((row) => row.officialName === needle && row.cityId === city.id) || null;
}

function districtIdFromName(name, cityLabel = "") {
  return districtByOfficialName(name, cityLabel)?.id || "";
}

function buildAdjacencyById() {
  const map = new Map();
  const cityLabel = "المدينة المنورة";
  for (const [name, neighbors] of Object.entries(MADINAH_ADJACENCY_BY_NAME)) {
    const id = districtIdFromName(name, cityLabel);
    if (!id) continue;
    if (!map.has(id)) map.set(id, new Set());
    for (const neighborName of neighbors) {
      const neighborId = districtIdFromName(neighborName, cityLabel);
      if (!neighborId || neighborId === id) continue;
      map.get(id).add(neighborId);
      if (!map.has(neighborId)) map.set(neighborId, new Set());
      map.get(neighborId).add(id);
    }
  }
  const frozen = {};
  for (const [id, set] of map.entries()) {
    frozen[id] = [...set].sort();
  }
  return Object.freeze(frozen);
}

const ADJACENCY_BY_ID = buildAdjacencyById();

function districtById(id) {
  return DISTRICTS.find((row) => row.id === id) || null;
}

export function resolveDistrictIdFromLabel(label = "", cityLabel = "") {
  const normalized = String(label || "").replace(/\s+/g, " ").trim().replace(/^حي\s+/u, "").trim();
  if (!normalized) return "";
  const id = districtIdFromName(normalized, cityLabel);
  if (id) return id;
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
  officePrimaryId = "",
  officeServiceIds = []
} = {}) {
  const service = new Set(
    Array.isArray(officeServiceIds) ? officeServiceIds.map((v) => String(v)) : []
  );
  const primary = String(officePrimaryId || "").trim();
  if (!opportunityDistrictId) {
    return service.size || primary ? 3 : 4;
  }
  if (primary === opportunityDistrictId || service.has(opportunityDistrictId)) return 1;
  const neighbors = adjacentNeighborhoodIds(opportunityDistrictId);
  if (primary && neighbors.includes(primary)) return 2;
  if (neighbors.some((id) => service.has(id))) return 2;
  return 3;
}

export function neighborhoodRelationLabel({
  opportunityDistrictId = "",
  officePrimaryId = "",
  officeServiceIds = []
} = {}) {
  const tier = neighborhoodTier({
    opportunityDistrictId,
    officePrimaryId,
    officeServiceIds
  });
  const opp = districtById(opportunityDistrictId);
  if (tier === 1) return "نفس الحي";
  if (tier === 2) {
    const neighbor = adjacentNeighborhoodIds(opportunityDistrictId)
      .map((id) => districtById(id))
      .find((row) => {
        const primary = String(officePrimaryId || "");
        const service = Array.isArray(officeServiceIds) ? officeServiceIds : [];
        return primary === row?.id || service.includes(row?.id);
      });
    return neighbor ? `حي مجاور — ${neighbor.officialName}` : "حي مجاور";
  }
  if (tier === 3 && opp) return `داخل نطاق المدينة — ${opp.officialName}`;
  return "داخل نطاق المدينة";
}

export function buildDefaultServiceNeighborhoodIds(cityLabel = "") {
  return neighborhoodIdsForCity(cityLabel);
}

export function adjacencyDataForTests() {
  return ADJACENCY_BY_ID;
}

export function districtLabelFromId(id = "") {
  return districtById(id)?.officialName || "";
}
