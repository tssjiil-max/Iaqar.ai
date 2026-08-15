/**
 * Cross-office cooperation suggestions — neighborhood tiers, no GPS.
 */

import { scoreMatch, MATCH_THRESHOLD } from "./matching-engine.js";
import { normalizeCooperationMode } from "./cooperation-phase6-domain.js";
import {
  evaluateMatchingReadiness,
  missingFieldLabelsArabic
} from "../../public/js/opportunity-readiness-domain.js";

const MADINAH_DISTRICT_IDS = Object.freeze({
  "الوبرة": "madinah-016",
  "الرانوناء": "madinah-015",
  "العوالي": "madinah-003"
});

const ADJACENCY = Object.freeze({
  "madinah-016": ["madinah-015", "madinah-017"],
  "madinah-015": ["madinah-016", "madinah-014"],
  "madinah-003": ["madinah-004", "madinah-005"]
});

function resolveDistrictId(label = "") {
  const name = String(label || "").trim();
  return MADINAH_DISTRICT_IDS[name] || "";
}

function neighborhoodTier(opportunityDistrictId, serviceIds = []) {
  const service = new Set((serviceIds || []).map(String));
  if (!opportunityDistrictId) return service.size ? 3 : 4;
  if (service.has(opportunityDistrictId)) return 1;
  const neighbors = ADJACENCY[opportunityDistrictId] || [];
  if (neighbors.some((id) => service.has(id))) return 2;
  return 3;
}

function opportunityToMatchInput(record = {}, id = "") {
  return {
    propertyType: record.propertyType || "",
    city: record.city || "",
    district: record.district || "",
    purpose: record.purpose || "",
    opportunityKind: record.opportunityKind || "",
    priceOrBudget: Number(record.priceOrBudget || record.price || record.budget || 0),
    area: Number(record.area || 0),
    rooms: Number(record.rooms || 0)
  };
}

function counterpartsEligible(source, candidate) {
  const a = String(source.opportunityKind || "").toUpperCase();
  const b = String(candidate.opportunityKind || "").toUpperCase();
  if (!a || !b) return true;
  if (a === "REQUEST") return b === "OFFER";
  if (a === "OFFER") return b === "REQUEST";
  return a !== b;
}

export async function buildCooperationNearbySuggestions({
  sourceOpportunity = {},
  ownOfficeId = "",
  publicOffices = [],
  officeOpportunities = []
} = {}) {
  const ownId = String(ownOfficeId || "").trim().toLowerCase();
  const opportunityDistrictId = resolveDistrictId(sourceOpportunity.district);
  const source = opportunityToMatchInput(sourceOpportunity, sourceOpportunity.id);

  const byOffice = new Map();
  for (const row of officeOpportunities) {
    const officeId = String(row.officeId || "").trim().toLowerCase();
    if (!officeId || officeId === ownId) continue;
    if (!byOffice.has(officeId)) byOffice.set(officeId, []);
    byOffice.get(officeId).push(row);
  }

  const suggestions = [];
  for (const office of publicOffices) {
    const officeId = String(office.officeId || office.id || "").trim().toLowerCase();
    if (!officeId || officeId === ownId) continue;
    const mode = normalizeCooperationMode(office.cooperationMode || "APPROVAL_REQUIRED");
    if (mode === "DISABLED") continue;

    const serviceIds = Array.isArray(office.serviceNeighborhoodIds) ? office.serviceNeighborhoodIds : [];
    const tier = neighborhoodTier(opportunityDistrictId, serviceIds);
    const candidates = (byOffice.get(officeId) || []).filter((candidate) =>
      counterpartsEligible(sourceOpportunity, candidate)
    );
    if (!candidates.length) continue;

    let best = null;
    for (const candidate of candidates) {
      const scored = scoreMatch(source, opportunityToMatchInput(candidate, candidate.id));
      if (!scored.eligible || scored.score < MATCH_THRESHOLD) continue;
      if (!best || scored.score > best.score) {
        best = { candidate, scored };
      }
    }
    if (!best) continue;

    suggestions.push({
      officeId,
      officeName: office.officeName || officeId,
      city: office.city || "",
      tier,
      matchScore: Math.round(Number(best.scored.score || 0)),
      matchReason: Array.isArray(best.scored.reasons) ? best.scored.reasons[0] : "مطابقة حقيقية",
      neighborhoodLabel: tier === 1 ? "نفس الحي" : tier === 2 ? "حي مجاور" : "داخل نطاق المدينة",
      opportunityId: best.candidate.id || "",
      cooperationMode: mode
    });
  }

  suggestions.sort((a, b) => a.tier - b.tier || b.matchScore - a.matchScore);
  return suggestions.slice(0, 4);
}

export function resolveNearbyEmptyReason(sourceOpportunity = {}, suggestions = []) {
  if (Array.isArray(suggestions) && suggestions.length) return null;
  const readiness = evaluateMatchingReadiness(sourceOpportunity);
  if (!readiness.isReadyForMatching) {
    return {
      code: "incomplete_data",
      missing: readiness.matchingReadinessMissing || [],
      missingLabels: missingFieldLabelsArabic(readiness.matchingReadinessMissing || [])
    };
  }
  if (String(sourceOpportunity.cooperationListing || "").toUpperCase() !== "OPEN") {
    return { code: "not_enabled" };
  }
  const districtId = resolveDistrictId(sourceOpportunity.district);
  if (!districtId) {
    return { code: "no_same_neighborhood" };
  }
  return { code: "no_adjacent" };
}
