/**
 * Cooperation ranking layer — uses existing scoreMatch results only.
 * Proximity is a ranking factor, never a reason to create a match.
 */

import { scoreMatch, MATCH_THRESHOLD } from "./matching-engine.js";
import {
  collaborationEnabled,
  compatibilityLabel,
  proximityAllowedForScope,
  rankCooperationScore,
  resolveProximity,
  selectBestCooperationOffices,
  shouldSearchCrossOffice
} from "../../public/js/cooperation-workflow-domain.js";
import {
  adjacentNeighborhoodIds,
  resolveDistrictIdFromLabel
} from "../../public/js/neighborhood-adjacency-domain.js";

export { shouldSearchCrossOffice, collaborationEnabled };

export function rankCooperationCandidates({
  source = {},
  candidates = [],
  threshold = MATCH_THRESHOLD,
  proximityScope = "SAME_DISTRICT",
  scoreMatchFn = scoreMatch,
  resolveDistrictId = resolveDistrictIdFromLabel
} = {}) {
  const ranked = [];
  for (const row of candidates) {
    const listing = row.listing || row.candidate || row;
    const scored = scoreMatchFn(source, listing);
    if (!scored?.eligible || Number(scored.score || 0) < Number(threshold || MATCH_THRESHOLD)) {
      continue;
    }
    const geoSource = row.sourceGeo || source;
    const geoCandidate = { ...listing, ...(row.raw || {}) };
    const sourceDistrictId = resolveDistrictId(source.district, source.city) || source.districtId || "";
    const adjacent = sourceDistrictId ? adjacentNeighborhoodIds(sourceDistrictId) : [];
    const proximity = resolveProximity({
      source: geoSource,
      candidate: geoCandidate,
      adjacentDistrictIds: adjacent,
      resolveDistrictId
    });
    if (!proximityAllowedForScope(proximity, proximityScope)) continue;
    ranked.push({
      ...row,
      listing,
      officeId: row.officeId || listing.officeId || "",
      officeName: row.officeName || "",
      scored,
      proximity,
      proximityLabel: proximity.label,
      compatibilityLabel: compatibilityLabel(scored),
      rankScore: rankCooperationScore(scored, proximity),
      matchReasons: Array.isArray(scored.reasons) ? scored.reasons.slice(0, 4) : []
    });
  }
  ranked.sort((a, b) => b.rankScore - a.rankScore || b.scored.score - a.scored.score);
  return ranked;
}

export function pickCooperationCandidates(ranked, { maxConcurrent = 1 } = {}) {
  return selectBestCooperationOffices(ranked, { maxConcurrent });
}
