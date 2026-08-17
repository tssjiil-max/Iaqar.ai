/**
 * Suitable offices for opportunity sharing — tier classification without foreign inventory.
 */

import { CITIES } from "./reference-catalog.js";
import {
  adjacentNeighborhoodIds,
  resolveDistrictIdFromLabel
} from "./neighborhood-adjacency-domain.js";
import {
  districtLabelById,
  normalizeNeighborhoodName,
  normalizeNeighborhoodNames
} from "./service-neighborhood-domain.js";
import {
  mergePrimaryIntoServiceNeighborhoods,
  primaryNeighborhoodLabelFromRecord,
  resolveLegacyOfficeScope
} from "./office-scope-domain.js";
import { normalizeCooperationMode } from "./cooperation-phase6-domain.js";

export const SUITABLE_OFFICE_TIER = Object.freeze({
  SAME: 1,
  ADJACENT: 2,
  CITY: 3
});

export const SUITABLE_OFFICE_TIER_LABELS = Object.freeze({
  [SUITABLE_OFFICE_TIER.SAME]: "في الحي نفسه",
  [SUITABLE_OFFICE_TIER.ADJACENT]: "في الأحياء المجاورة",
  [SUITABLE_OFFICE_TIER.CITY]: "في بقية المدينة"
});

export const SUITABLE_OFFICE_REASON = Object.freeze({
  SERVES_TARGET: "يخدم حي الفرصة",
  PRIMARY_SAME: "مكتبه في الحي نفسه",
  SERVES_ADJACENT: "يخدم حيًا مجاورًا",
  CITY_AVAILABLE: "مكتب متاح داخل المدينة",
  SERVES_REQUESTED: "يخدم حيًا مطلوبًا"
});

function safeOfficeId(value) {
  return String(value || "").trim().toLowerCase();
}

function cityMatches(officeCity = "", opportunityCity = "") {
  const office = String(officeCity || "").trim();
  const opp = String(opportunityCity || "").trim();
  if (!office || !opp) return false;
  if (office === opp) return true;
  const officeCityRow = CITIES.find((row) =>
    row.label === office || (row.aliases || []).includes(office)
  );
  const oppCityRow = CITIES.find((row) =>
    row.label === opp || (row.aliases || []).includes(opp)
  );
  return officeCityRow && oppCityRow && officeCityRow.id === oppCityRow.id;
}

export function opportunityTargetDistrictLabels(record = {}, cityLabel = "") {
  const city = String(record.city || cityLabel || "").trim();
  if (Array.isArray(record.targetDistricts) && record.targetDistricts.length) {
    return normalizeNeighborhoodNames(record.targetDistricts, city);
  }
  const district = String(record.district || "").trim();
  if (!district) return [];
  const parts = district.split(/[,،]|(?:\s+و\s+)/u).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) return normalizeNeighborhoodNames(parts, city);
  const normalized = normalizeNeighborhoodName(district, city);
  return normalized ? [normalized] : [];
}

export function opportunityTargetDistrictIds(record = {}, cityLabel = "") {
  const city = String(record.city || cityLabel || "").trim();
  return opportunityTargetDistrictLabels(record, city)
    .map((label) => resolveDistrictIdFromLabel(label, city))
    .filter(Boolean);
}

export function requiresOpportunityLocationCompletion(record = {}) {
  const city = String(record.city || "").trim();
  const districts = opportunityTargetDistrictLabels(record, city);
  return !city || districts.length === 0;
}

export function officeEligibilityFlags(office = {}) {
  const mode = normalizeCooperationMode(office.cooperationMode || "APPROVAL_REQUIRED");
  const approval = String(office.approvalStatus || "approved").toLowerCase();
  const account = String(office.accountStatus || "active").toLowerCase();
  const scope = resolveLegacyOfficeScope(office);
  return {
    cooperationEnabled: mode !== "DISABLED",
    receiveExternal: scope.receiveExternalOpportunities === true,
    availableNow: scope.cooperationAvailableNow === true,
    approved: approval === "approved" || (!office.approvalStatus && Boolean(office.licenseNumber)),
    active: account === "active" || !office.accountStatus
  };
}

export function isOfficeEligibleForCooperationListing(office = {}) {
  const flags = officeEligibilityFlags(office);
  return flags.cooperationEnabled
    && flags.receiveExternal
    && flags.availableNow
    && flags.approved
    && flags.active;
}

function officeCoverageIds(office = {}) {
  const scope = resolveLegacyOfficeScope(office);
  return mergePrimaryIntoServiceNeighborhoods(
    scope.primaryNeighborhoodId,
    scope.serviceNeighborhoodIds,
    scope.city
  );
}

function tierForDistrictPair({
  opportunityDistrictId = "",
  officePrimaryId = "",
  officeServiceIds = []
} = {}) {
  const service = new Set(officeServiceIds);
  if (!opportunityDistrictId) return SUITABLE_OFFICE_TIER.CITY;
  if (officePrimaryId === opportunityDistrictId || service.has(opportunityDistrictId)) {
    return SUITABLE_OFFICE_TIER.SAME;
  }
  const neighbors = adjacentNeighborhoodIds(opportunityDistrictId);
  if (officePrimaryId && neighbors.includes(officePrimaryId)) return SUITABLE_OFFICE_TIER.ADJACENT;
  if (neighbors.some((id) => service.has(id))) return SUITABLE_OFFICE_TIER.ADJACENT;
  return SUITABLE_OFFICE_TIER.CITY;
}

export function classifyOfficeForOpportunity({
  office = {},
  opportunityCity = "",
  opportunityDistrictIds = [],
  opportunityDistrictLabels = []
} = {}) {
  const scope = resolveLegacyOfficeScope(office);
  const coverage = officeCoverageIds(office);
  const districtIds = opportunityDistrictIds.length
    ? opportunityDistrictIds
    : opportunityDistrictLabels.map((label) => resolveDistrictIdFromLabel(label, opportunityCity));
  let bestTier = SUITABLE_OFFICE_TIER.CITY;
  let reason = SUITABLE_OFFICE_REASON.CITY_AVAILABLE;
  let matchedDistrictLabel = "";

  for (let i = 0; i < districtIds.length; i += 1) {
    const districtId = districtIds[i];
    const label = opportunityDistrictLabels[i]
      || districtLabelById(districtId)
      || "";
    const tier = tierForDistrictPair({
      opportunityDistrictId: districtId,
      officePrimaryId: scope.primaryNeighborhoodId,
      officeServiceIds: coverage
    });
    if (tier < bestTier) {
      bestTier = tier;
      if (tier === SUITABLE_OFFICE_TIER.SAME) {
        if (coverage.includes(districtId) && scope.primaryNeighborhoodId !== districtId) {
          reason = label ? `${SUITABLE_OFFICE_REASON.SERVES_REQUESTED} — ${label}` : SUITABLE_OFFICE_REASON.SERVES_TARGET;
        } else if (scope.primaryNeighborhoodId === districtId) {
          reason = SUITABLE_OFFICE_REASON.PRIMARY_SAME;
        } else {
          reason = SUITABLE_OFFICE_REASON.SERVES_TARGET;
        }
        matchedDistrictLabel = label;
      } else if (tier === SUITABLE_OFFICE_TIER.ADJACENT) {
        reason = SUITABLE_OFFICE_REASON.SERVES_ADJACENT;
        matchedDistrictLabel = label;
      } else {
        reason = SUITABLE_OFFICE_REASON.CITY_AVAILABLE;
      }
    }
  }

  return {
    tier: bestTier,
    tierLabel: SUITABLE_OFFICE_TIER_LABELS[bestTier],
    reason,
    matchedDistrictLabel,
    primaryNeighborhoodLabel: primaryNeighborhoodLabelFromRecord(office),
    serviceNeighborhoodLabels: coverage.map((id) => districtLabelById(id)).filter(Boolean)
  };
}

function compareArabicName(a = "", b = "") {
  return String(a).localeCompare(String(b), "ar");
}

export function rankSuitableOffices({
  opportunity = {},
  offices = [],
  ownOfficeId = "",
  searchQuery = ""
} = {}) {
  const ownId = safeOfficeId(ownOfficeId);
  const opportunityCity = String(opportunity.city || "").trim();
  const districtLabels = opportunityTargetDistrictLabels(opportunity, opportunityCity);
  const districtIds = opportunityTargetDistrictIds(opportunity, opportunityCity);
  const query = String(searchQuery || "").trim().toLowerCase();

  const buckets = {
    [SUITABLE_OFFICE_TIER.SAME]: [],
    [SUITABLE_OFFICE_TIER.ADJACENT]: [],
    [SUITABLE_OFFICE_TIER.CITY]: []
  };

  for (const office of offices) {
    const officeId = safeOfficeId(office.officeId || office.id);
    if (!officeId || officeId === ownId) continue;
    if (!cityMatches(office.city, opportunityCity)) continue;
    if (!isOfficeEligibleForCooperationListing(office)) continue;

    const name = String(office.officeName || officeId).trim();
    const primaryLabel = primaryNeighborhoodLabelFromRecord(office);
    const haystack = `${name} ${primaryLabel} ${office.city || ""}`.toLowerCase();
    if (query && !haystack.includes(query)) continue;

    const classified = classifyOfficeForOpportunity({
      office,
      opportunityCity,
      opportunityDistrictIds: districtIds,
      opportunityDistrictLabels: districtLabels
    });

    const servesTarget = districtIds.some((id) => officeCoverageIds(office).includes(id));
    const flags = officeEligibilityFlags(office);

    buckets[classified.tier].push({
      officeId,
      officeName: name,
      city: office.city || "",
      logoUrl: office.logoUrl || office.displayImageUrl || "",
      primaryNeighborhoodLabel: classified.primaryNeighborhoodLabel,
      serviceNeighborhoodLabels: classified.serviceNeighborhoodLabels,
      serviceNeighborhoodSummary: classified.serviceNeighborhoodLabels.slice(0, 3).join("، "),
      verified: flags.approved,
      cooperationAvailableNow: flags.availableNow,
      tier: classified.tier,
      tierLabel: classified.tierLabel,
      reason: classified.reason,
      specialties: Array.isArray(office.specialties) ? office.specialties : [],
      servesTarget
    });
  }

  const sortBucket = (rows) => rows.sort((a, b) => {
    if (a.servesTarget !== b.servesTarget) return a.servesTarget ? -1 : 1;
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    if (a.cooperationAvailableNow !== b.cooperationAvailableNow) return a.cooperationAvailableNow ? -1 : 1;
    return compareArabicName(a.officeName, b.officeName);
  });

  for (const tier of Object.keys(buckets)) {
    buckets[tier] = sortBucket(buckets[tier]);
  }

  const total = buckets[1].length + buckets[2].length + buckets[3].length;
  return {
    buckets,
    total,
    requiresCompletion: requiresOpportunityLocationCompletion(opportunity),
    opportunityCity,
    opportunityDistrictLabels: districtLabels
  };
}

export function flattenRankedOffices(rankResult = {}, limitPerTier = 0) {
  const out = [];
  for (const tier of [SUITABLE_OFFICE_TIER.SAME, SUITABLE_OFFICE_TIER.ADJACENT, SUITABLE_OFFICE_TIER.CITY]) {
    const rows = rankResult.buckets?.[tier] || [];
    out.push(...(limitPerTier > 0 ? rows.slice(0, limitPerTier) : rows));
  }
  return out;
}
