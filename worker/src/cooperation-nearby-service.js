/**
 * Cross-office cooperation suggestions — listing adjacency, matching engine, no GPS.
 */

import { missingFieldLabelsArabic } from "../../public/js/opportunity-readiness-domain.js";
import {
  buildCommunityMatches,
  resolveCommunityEmptyReasonForSource
} from "./broker-community-service.js";
import { normalizeCooperationMode } from "./cooperation-phase6-domain.js";

export async function buildCooperationNearbySuggestions({
  sourceOpportunity = {},
  ownOfficeId = "",
  publicOffices = [],
  officeOpportunities = [],
  ownOffice = {}
} = {}) {
  const office = {
    officeId: ownOfficeId,
    cooperationMode: normalizeCooperationMode(
      ownOffice.cooperationMode || "APPROVAL_REQUIRED"
    ),
    brokerCommunityEnabled: ownOffice.brokerCommunityEnabled
  };
  return buildCommunityMatches({
    sourceOpportunity,
    ownOfficeId,
    ownOffice: office,
    publicOffices,
    officeOpportunities
  });
}

export function resolveNearbyEmptyReason(sourceOpportunity = {}, suggestions = [], ownOffice = {}) {
  if (Array.isArray(suggestions) && suggestions.length) return null;
  const reason = resolveCommunityEmptyReasonForSource(sourceOpportunity, ownOffice, suggestions);
  if (!reason) return null;
  if (reason.code === "community_disabled") return { code: "not_enabled" };
  if (reason.code === "incomplete_data") {
    return {
      code: "incomplete_data",
      missing: reason.missing || [],
      missingLabels: missingFieldLabelsArabic(reason.missing || [])
    };
  }
  if (reason.code === "no_match") return { code: "no_adjacent" };
  return reason;
}
