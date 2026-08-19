/**
 * Import advert review — plain-text location fields with catalog normalization.
 * Does not mutate DISTRICTS / PROPERTY_TYPES / CITIES catalogs.
 */

import {
  OPERATION_TYPES,
  buildReviewDefaults,
  conservativeMatchDistrict,
  conservativeMatchPropertyType,
  mapOperationToBrokerFields,
  matchCity,
  reviewTransactionMode
} from "./reference-catalog.js";
import { containsNeighborhoodMetadata } from "./service-neighborhood-domain.js";

export const NORMALIZATION_STATUS = Object.freeze({
  CONFIRMED: "confirmed",
  NEEDS_REVIEW: "needs_review",
  PENDING: "pending"
});

const PROPERTY_TYPE_TYPO_RE = [
  [/فله/gu, "فيلا"],
  [/فيله/gu, "فيلا"],
  [/فلهة/gu, "فيلا"]
];

function safeTrim(value) {
  return String(value == null ? "" : value).trim();
}

export function sanitizeImportFieldText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function applyPropertyTypeTypoFixes(value = "") {
  let text = sanitizeImportFieldText(value);
  for (const [pattern, replacement] of PROPERTY_TYPE_TYPO_RE) {
    text = text.replace(pattern, replacement);
  }
  return sanitizeImportFieldText(text);
}

export function stripLeadingHayPrefix(value = "") {
  return sanitizeImportFieldText(value).replace(/^حي\s+/u, "").trim();
}

export function normalizeImportLocationFields({
  city = "",
  district = "",
  propertyType = ""
} = {}) {
  const rawCity = sanitizeImportFieldText(city);
  const rawNeighborhood = stripLeadingHayPrefix(district);
  const rawPropertyType = applyPropertyTypeTypoFixes(propertyType);

  const cityMatch = rawCity ? matchCity(rawCity) : null;
  const cityConfirmed = Boolean(cityMatch);
  const canonicalCity = cityConfirmed ? cityMatch.label : "";

  const propertyResult = rawPropertyType
    ? conservativeMatchPropertyType(rawPropertyType)
    : { match: null, confirmed: false, display: "" };
  const propertyConfirmed = Boolean(propertyResult.confirmed && propertyResult.match);
  const canonicalPropertyType = propertyConfirmed ? propertyResult.match.label : "";

  const cityIdForDistrict = cityMatch?.id || "madinah";
  const neighborhoodPolluted = rawNeighborhood && containsNeighborhoodMetadata(rawNeighborhood);
  const districtResult = rawNeighborhood && !neighborhoodPolluted
    ? conservativeMatchDistrict(rawNeighborhood, cityIdForDistrict)
    : { match: null, confirmed: false, display: rawNeighborhood, warning: "" };
  const neighborhoodConfirmed = Boolean(districtResult.confirmed && districtResult.match);
  const canonicalNeighborhood = neighborhoodConfirmed ? districtResult.match.officialName : "";

  const needsReview = Boolean(
    (rawCity && !cityConfirmed)
    || (rawPropertyType && !propertyConfirmed)
    || (rawNeighborhood && (!neighborhoodConfirmed || neighborhoodPolluted))
  );

  const normalizationStatus = !rawCity && !rawNeighborhood && !rawPropertyType
    ? NORMALIZATION_STATUS.PENDING
    : needsReview
      ? NORMALIZATION_STATUS.NEEDS_REVIEW
      : NORMALIZATION_STATUS.CONFIRMED;

  return {
    rawCity,
    canonicalCity,
    rawNeighborhood,
    canonicalNeighborhood,
    rawPropertyType,
    canonicalPropertyType,
    normalizationStatus,
    catalogCityId: cityMatch?.id || "",
    catalogDistrictId: districtResult.match?.id || "",
    catalogPropertyTypeId: propertyResult.match?.id || "",
    districtWarning: neighborhoodPolluted
      ? "اسم الحي يحتوي بيانات غير مناسبة (سعر أو مساحة أو وصف) — راجعه قبل الحفظ."
      : (districtResult.warning || ""),
    matchingCity: canonicalCity || rawCity,
    matchingNeighborhood: canonicalNeighborhood || rawNeighborhood,
    matchingPropertyType: canonicalPropertyType || rawPropertyType
  };
}

export function buildImportReviewDefaults(extractionFields = {}, sourceText = "", meta = {}) {
  const base = buildReviewDefaults(extractionFields, sourceText, meta);
  const normalized = normalizeImportLocationFields({
    city: extractionFields.city || base.extractedSnapshot?.city,
    district: extractionFields.district || base.extractedSnapshot?.district,
    propertyType: extractionFields.propertyType || base.extractedSnapshot?.propertyType
  });
  return {
    ...base,
    importPlainLocationFields: true,
    rawCityText: normalized.rawCity,
    rawNeighborhoodText: normalized.rawNeighborhood,
    rawPropertyTypeText: normalized.rawPropertyType,
    normalizationStatus: normalized.normalizationStatus,
    normalizationHint: normalized.districtWarning
      || (normalized.normalizationStatus === NORMALIZATION_STATUS.NEEDS_REVIEW
        ? "بعض الحقول لم تُوحَّد تلقائيًا مع القائمة الرسمية — يمكنك تعديلها والمتابعة."
        : "")
  };
}

function numericOrEmpty(value) {
  if (value === "" || value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function importReviewValuesToBrokerFields(review = {}) {
  const normalized = normalizeImportLocationFields({
    city: review.rawCityText,
    district: review.rawNeighborhoodText,
    propertyType: review.rawPropertyTypeText
  });
  const snapshot = review.extractedSnapshot || {};
  const broker = mapOperationToBrokerFields(
    review.operationTypeId,
    snapshot.opportunityKind
  );
  const mode = reviewTransactionMode(review.operationTypeId, {
    purpose: snapshot.purpose || broker.purpose || "",
    opportunityKind: snapshot.opportunityKind || broker.opportunityKind || ""
  });
  const isLand = normalized.catalogPropertyTypeId === "land"
    || /أرض|ارض/.test(normalized.matchingPropertyType);

  const salePrice = mode === "sale" ? numericOrEmpty(review.salePrice) : null;
  const annualRent = mode === "rent" ? numericOrEmpty(review.annualRent) : null;
  const monthlyRent = mode === "rent" ? numericOrEmpty(review.monthlyRent) : null;
  const optionalMonthlyRentAfterSixMonths = mode === "rent"
    ? numericOrEmpty(review.optionalMonthlyRentAfterSixMonths)
    : null;
  const budget = mode === "budget" ? numericOrEmpty(review.budget) : null;
  const investmentValue = mode === "investment" ? numericOrEmpty(review.investmentValue) : null;
  const priceOrBudget = mode === "sale"
    ? salePrice
    : mode === "rent"
      ? annualRent
      : mode === "budget"
        ? budget
        : mode === "investment"
          ? investmentValue
          : null;

  return {
    ...broker,
    propertyType: normalized.matchingPropertyType,
    city: normalized.matchingCity,
    district: normalized.matchingNeighborhood,
    salePrice,
    annualRent,
    monthlyRent,
    optionalMonthlyRentAfterSixMonths,
    budget,
    priceOrBudget,
    area: numericOrEmpty(review.area),
    rooms: isLand ? null : numericOrEmpty(review.rooms),
    bathrooms: isLand ? null : numericOrEmpty(review.bathrooms),
    floorNumber: isLand ? null : numericOrEmpty(review.floorNumber),
    paymentInstallments: mode !== "rent" ? null : numericOrEmpty(review.paymentInstallments),
    rawCity: normalized.rawCity,
    canonicalCity: normalized.canonicalCity,
    rawNeighborhood: normalized.rawNeighborhood,
    canonicalNeighborhood: normalized.canonicalNeighborhood,
    rawPropertyType: normalized.rawPropertyType,
    canonicalPropertyType: normalized.canonicalPropertyType,
    normalizationStatus: normalized.normalizationStatus,
    reviewOperationTypeId: review.operationTypeId || "",
    reviewPropertyTypeId: normalized.catalogPropertyTypeId,
    reviewCityId: normalized.catalogCityId,
    reviewDistrictId: normalized.catalogDistrictId,
    extractedSnapshot: review.extractedSnapshot || null
  };
}

export const __test = {
  sanitizeImportFieldText,
  applyPropertyTypeTypoFixes,
  stripLeadingHayPrefix,
  normalizeImportLocationFields
};
