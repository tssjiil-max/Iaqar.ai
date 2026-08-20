/**
 * Cross-office cooperation suggestions — neighborhood tiers, no GPS.
 */

import { rankMatchCandidates, MATCH_THRESHOLD } from "../../worker/src/matching-engine.js";
import {
  adjacentNeighborhoodIds,
  neighborhoodRelationLabel,
  neighborhoodTier,
  resolveDistrictIdFromLabel
} from "./neighborhood-adjacency-domain.js";
import { normalizeCooperationMode } from "./cooperation-phase6-domain.js";

const MAX_SUGGESTIONS = 4;

function safeOfficeId(value) {
  return String(value || "").trim().toLowerCase();
}

export function rankCooperationNearbySuggestions({
  sourceOpportunity = {},
  ownOfficeId = "",
  publicOffices = [],
  candidateOpportunities = [],
  officeCooperationModes = {}
} = {}) {
  const ownId = safeOfficeId(ownOfficeId);
  const opportunityDistrictId = resolveDistrictIdFromLabel(
    sourceOpportunity.district,
    sourceOpportunity.city
  );
  const sourceKind = String(sourceOpportunity.opportunityKind || "").toUpperCase();
  const wantKind = sourceKind === "REQUEST" ? "OFFER" : sourceKind === "OFFER" ? "REQUEST" : "";

  const byOffice = new Map();
  for (const row of candidateOpportunities) {
    const officeId = safeOfficeId(row.officeId);
    if (!officeId || officeId === ownId) continue;
    if (!byOffice.has(officeId)) byOffice.set(officeId, []);
    byOffice.get(officeId).push(row);
  }

  const suggestions = [];

  for (const office of publicOffices) {
    const officeId = safeOfficeId(office.officeId || office.id);
    if (!officeId || officeId === ownId) continue;
    const mode = normalizeCooperationMode(
      office.cooperationMode || officeCooperationModes[officeId] || "APPROVAL_REQUIRED"
    );
    if (mode === "DISABLED") continue;

    const serviceIds = Array.isArray(office.serviceNeighborhoodIds)
      ? office.serviceNeighborhoodIds
      : [];
    const tier = neighborhoodTier({
      opportunityDistrictId,
      officeServiceIds: serviceIds
    });
    const officeCandidates = (byOffice.get(officeId) || []).filter((row) => {
      if (!wantKind) return true;
      return String(row.opportunityKind || "").toUpperCase() === wantKind;
    });
    if (!officeCandidates.length) continue;

    const ranked = rankMatchCandidates(sourceOpportunity, officeCandidates);
    const best = ranked[0];
    if (!best || Number(best.score || 0) < MATCH_THRESHOLD) continue;
    const candidate = best.candidate || {};

    suggestions.push({
      officeId,
      officeName: office.officeName || officeId,
      city: office.city || "",
      tier,
      matchScore: Math.round(Number(best.score || 0)),
      matchReason: String(
        (Array.isArray(best.reasons) && best.reasons[0]) || "مطابقة حقيقية وفق قواعد المنصة"
      ),
      neighborhoodLabel: neighborhoodRelationLabel({
        opportunityDistrictId,
        officeServiceIds: serviceIds
      }),
      opportunityId: candidate.id || candidate.opportunityId || "",
      matchId: best.matchId || "",
      cooperationMode: mode
    });
  }

  suggestions.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return b.matchScore - a.matchScore;
  });

  return suggestions.slice(0, MAX_SUGGESTIONS);
}

export function usesDeviceGpsForCooperation() {
  return false;
}
