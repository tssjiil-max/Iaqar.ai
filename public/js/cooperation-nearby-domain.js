/**
 * Cross-office cooperation suggestions — neighborhood tiers, no GPS.
 * Delegates ranking to مجتمع الوسطاء so listing-to-listing adjacency is used.
 */

import { rankBrokerCommunityMatches } from "./broker-community-domain.js";

const MAX_SUGGESTIONS = 4;

export function rankCooperationNearbySuggestions({
  sourceOpportunity = {},
  ownOfficeId = "",
  publicOffices = [],
  candidateOpportunities = [],
  officeCooperationModes = {},
  requireReadiness = false
} = {}) {
  const offices = (publicOffices || []).map((office) => {
    const officeId = String(office.officeId || office.id || "").trim().toLowerCase();
    return {
      ...office,
      officeId,
      cooperationMode: office.cooperationMode || officeCooperationModes[officeId] || "APPROVAL_REQUIRED"
    };
  });
  const matches = rankBrokerCommunityMatches({
    sourceOpportunity,
    ownOfficeId,
    ownOffice: { cooperationMode: "APPROVAL_REQUIRED" },
    publicOffices: offices,
    candidateOpportunities,
    requireReadiness
  });
  return matches.slice(0, MAX_SUGGESTIONS).map((row) => ({
    officeId: row.officeId,
    officeName: row.officeName,
    city: row.city,
    tier: row.listingTier,
    matchScore: row.matchScore,
    matchReason: row.matchReason,
    neighborhoodLabel: row.neighborhoodLabel,
    opportunityId: row.opportunityId,
    matchId: row.matchId || "",
    cooperationMode: row.cooperationMode,
    offerId: row.offerId,
    requestId: row.requestId,
    pairKey: row.pairKey,
    propertyType: row.propertyType,
    opportunityKind: row.opportunityKind,
    district: row.district,
    matchStrength: row.matchStrength,
    officeWhatsapp: row.officeWhatsapp,
    brokerName: row.brokerName
  }));
}

export function usesDeviceGpsForCooperation() {
  return false;
}
