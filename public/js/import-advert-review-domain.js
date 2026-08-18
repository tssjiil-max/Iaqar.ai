/**
 * Import advert review — simplified form layout, save rules, and extra-field mapping.
 * Plain-text location fields only; no catalog dropdowns in the import review UI.
 */

import {
  reviewTransactionMode
} from "./reference-catalog.js";
import {
  buildImportReviewDefaults,
  importReviewValuesToBrokerFields,
  normalizeImportLocationFields
} from "./import-field-normalization-domain.js";
import { evaluateMatchingReadiness, missingFieldLabelsArabic } from "./opportunity-readiness-domain.js";

export const IMPORT_RECORD_LABEL = "فرصة";

export const IMPORT_OPPORTUNITY_KINDS = Object.freeze([
  { id: "OFFER", label: "عرض مالك" },
  { id: "REQUEST", label: "طلب عميل" }
]);

export const IMPORT_EXTRA_FIELD_DEFS = Object.freeze([
  { name: "bathrooms", label: "دورات المياه", type: "number" },
  { name: "livingRoom", label: "عدد الصالات", type: "number" },
  { name: "direction", label: "الواجهة", type: "text" },
  { name: "streetWidth", label: "عرض الشارع (م)", type: "number" },
  { name: "condition", label: "عمر العقار", type: "text" },
  { name: "usageType", label: "الغرض السكني أو التجاري", type: "text" },
  { name: "waterAndSewagePaidBy", label: "توفر الماء", type: "text" },
  { name: "electricityMeter", label: "توفر الكهرباء", type: "text" },
  { name: "description", label: "الوصف", type: "textarea" },
  { name: "floorNumber", label: "الدور أو الطابق", type: "text" },
  { name: "floorPosition", label: "موقع الدور", type: "text" },
  { name: "paymentInstallments", label: "عدد الدفعات", type: "number" },
  { name: "ownerConditions", label: "معلومات إضافية", type: "textarea" }
]);

export const IMPORT_SAVE_MINIMUM_KEYS = Object.freeze({
  opportunityKind: "نوع الفرصة",
  propertyType: "نوع العقار",
  location: "الحي أو المدينة",
  priceOrPrimary: "السعر/الميزانية أو المعلومة العقارية الأساسية"
});

function safeTrim(value) {
  return String(value == null ? "" : value).trim();
}

function numericFilled(value) {
  if (value === "" || value == null) return false;
  const num = Number(value);
  return Number.isFinite(num) && num > 0;
}

export function classifyImportPropertyType(raw = "") {
  const text = safeTrim(raw);
  if (/أرض|ارض/u.test(text)) return "land";
  if (/عمارة|عماره/u.test(text)) return "building";
  if (/فيلا|شقة|شقه|دور/u.test(text)) return "residential";
  return "generic";
}

export function resolveImportOperationTypeId({ opportunityKind = "", purpose = "" } = {}) {
  const kind = String(opportunityKind || "").toUpperCase();
  const p = String(purpose || "").toUpperCase();
  if (kind === "REQUEST") {
    return p === "LEASE_REQUEST" ? "rent" : "purchase";
  }
  if (p === "RENT") return "rent";
  if (p === "INVESTMENT") return "investment";
  return "sale";
}

export function resolveImportPriceFieldLabel(operationTypeId = "", opportunityKind = "") {
  const mode = reviewTransactionMode(operationTypeId, { opportunityKind });
  if (mode === "budget") return "الميزانية (ريال)";
  if (mode === "rent") return "الإيجار السنوي (ريال)";
  if (mode === "investment") return "القيمة الاستثمارية (ريال)";
  return "السعر (ريال)";
}

export function resolveImportPrimaryInfoFields(propertyTypeRaw = "", values = {}) {
  const kind = classifyImportPropertyType(propertyTypeRaw);
  if (kind === "land") {
    return [{ name: "area", label: "المساحة (م²)", required: true, optional: false }];
  }
  if (kind === "residential") {
    return [
      { name: "rooms", label: "عدد الغرف", required: true, optional: false },
      { name: "area", label: "المساحة (م²)", required: false, optional: true }
    ];
  }
  if (kind === "building") {
    const fields = [];
    if (numericFilled(values.area)) {
      fields.push({ name: "area", label: "المساحة (م²)", required: true, optional: false });
    }
    if (numericFilled(values.units) || numericFilled(values.floorsCount)) {
      fields.push({
        name: numericFilled(values.units) ? "units" : "floorsCount",
        label: "عدد الوحدات",
        required: true,
        optional: false
      });
    }
    if (!fields.length) {
      fields.push(
        { name: "area", label: "المساحة (م²)", required: false, optional: true },
        { name: "units", label: "عدد الوحدات", required: false, optional: true }
      );
    }
    return fields;
  }
  return [
    { name: "area", label: "المساحة (م²)", required: false, optional: true },
    { name: "rooms", label: "عدد الغرف", required: false, optional: true }
  ];
}

export function hasImportPrimaryPropertyInfo(review = {}) {
  const propertyType = safeTrim(review.rawPropertyTypeText);
  const kind = classifyImportPropertyType(propertyType);
  if (kind === "land") return numericFilled(review.area);
  if (kind === "residential") return numericFilled(review.rooms);
  if (kind === "building") {
    return numericFilled(review.area) || numericFilled(review.units) || numericFilled(review.floorsCount);
  }
  return numericFilled(review.area) || numericFilled(review.rooms);
}

export function hasImportPriceOrBudget(review = {}) {
  const mode = reviewTransactionMode(review.operationTypeId || "", {
    purpose: review.purpose || review.extractedSnapshot?.purpose || "",
    opportunityKind: review.opportunityKind || review.extractedSnapshot?.opportunityKind || ""
  });
  if (mode === "sale") return numericFilled(review.salePrice);
  if (mode === "rent") return numericFilled(review.annualRent);
  if (mode === "budget") return numericFilled(review.budget);
  if (mode === "investment") return numericFilled(review.investmentValue);
  return numericFilled(review.salePrice) || numericFilled(review.budget) || numericFilled(review.annualRent);
}

export function evaluateImportReviewSaveMinimum(review = {}) {
  const missing = [];
  if (!safeTrim(review.opportunityKind)) missing.push("opportunityKind");
  if (!safeTrim(review.rawPropertyTypeText)) missing.push("propertyType");
  if (!safeTrim(review.rawNeighborhoodText) && !safeTrim(review.rawCityText)) missing.push("location");
  if (!hasImportPriceOrBudget(review) && !hasImportPrimaryPropertyInfo(review)) {
    missing.push("priceOrPrimary");
  }
  return {
    ok: missing.length === 0,
    missing,
    missingLabelsArabic: missing.map((key) => IMPORT_SAVE_MINIMUM_KEYS[key] || key)
  };
}

export function collectImportExtraFieldValues(extractionFields = {}, extended = {}) {
  const merged = { ...extended, ...extractionFields };
  const values = {};
  for (const field of IMPORT_EXTRA_FIELD_DEFS) {
    const raw = merged[field.name];
    if (raw === "" || raw == null) continue;
    values[field.name] = raw;
  }
  if (!values.description && safeTrim(extractionFields.sourceText || extractionFields.description)) {
    values.description = safeTrim(extractionFields.sourceText || extractionFields.description);
  }
  return values;
}

export function buildImportSimplifiedReviewDefaults(
  extractionFields = {},
  sourceText = "",
  meta = {},
  officeContext = {}
) {
  const defaults = buildImportReviewDefaults(extractionFields, sourceText, meta);
  const officeCity = safeTrim(officeContext.city) || "المدينة المنورة";
  const opportunityKind = safeTrim(
    extractionFields.opportunityKind || defaults.extractedSnapshot?.opportunityKind || "OFFER"
  ).toUpperCase();
  const purpose = safeTrim(extractionFields.purpose || defaults.extractedSnapshot?.purpose || "");
  const operationTypeId = resolveImportOperationTypeId({ opportunityKind, purpose });
  const extra = collectImportExtraFieldValues(extractionFields, meta.extended || extractionFields.extended || {});
  return {
    ...defaults,
    importSimplifiedReview: true,
    importPlainLocationFields: true,
    opportunityKind: opportunityKind === "REQUEST" ? "REQUEST" : "OFFER",
    purpose,
    operationTypeId,
    rawCityText: defaults.rawCityText || officeCity,
    importExtraFields: extra,
    units: extra.units ?? extractionFields.units ?? "",
    floorsCount: extra.floorsCount ?? extractionFields.floorsCount ?? ""
  };
}

export function importSimplifiedReviewValuesToBrokerFields(review = {}) {
  const opportunityKind = safeTrim(review.opportunityKind).toUpperCase() || "OFFER";
  const purpose = safeTrim(review.purpose || review.extractedSnapshot?.purpose || "");
  const operationTypeId = review.operationTypeId
    || resolveImportOperationTypeId({ opportunityKind, purpose });
  const broker = importReviewValuesToBrokerFields({
    ...review,
    operationTypeId,
    extractedSnapshot: {
      ...(review.extractedSnapshot || {}),
      opportunityKind,
      purpose: purpose || review.extractedSnapshot?.purpose || ""
    }
  });
  const extra = review.importExtraFields || {};
  const readiness = evaluateMatchingReadiness({
    ...broker,
    advertiserPhoneNormalized: review.advertiserPhoneNormalized || "",
    advertiserRole: review.advertiserRole || "UNKNOWN"
  });
  const saveMinimum = evaluateImportReviewSaveMinimum({
    ...review,
    operationTypeId
  });
  return {
    ...broker,
    opportunityKind,
    purpose: broker.purpose || purpose,
    bathrooms: review.bathrooms ?? extra.bathrooms ?? broker.bathrooms,
    livingRoom: review.livingRoom ?? extra.livingRoom ?? null,
    direction: review.direction ?? extra.direction ?? null,
    streetWidth: review.streetWidth ?? extra.streetWidth ?? null,
    condition: review.condition ?? extra.condition ?? null,
    usageType: review.usageType ?? extra.usageType ?? null,
    waterAndSewagePaidBy: review.waterAndSewagePaidBy ?? extra.waterAndSewagePaidBy ?? null,
    electricityMeter: review.electricityMeter ?? extra.electricityMeter ?? null,
    description: review.description ?? extra.description ?? null,
    floorNumber: review.floorNumber ?? extra.floorNumber ?? broker.floorNumber,
    floorPosition: review.floorPosition ?? extra.floorPosition ?? null,
    paymentInstallments: review.paymentInstallments ?? extra.paymentInstallments ?? broker.paymentInstallments,
    ownerConditions: review.ownerConditions ?? extra.ownerConditions ?? null,
    units: review.units ?? extra.units ?? null,
    floorsCount: review.floorsCount ?? extra.floorsCount ?? null,
    importReviewMissingLabels: saveMinimum.missingLabelsArabic,
    importReviewSaveMinimumMet: saveMinimum.ok,
    matchingReadiness: readiness.matchingReadiness,
    matchingReadinessMissing: readiness.matchingReadinessMissing,
    matchingReadinessLabel: readiness.isReadyForMatching ? "جاهزة للمطابقة" : "تحتاج استكمال",
    missingFieldLabels: missingFieldLabelsArabic(readiness.matchingReadinessMissing)
  };
}

export function prefillImportReviewFromGeminiFields(geminiFields = {}) {
  const normalized = normalizeImportLocationFields({
    city: geminiFields.city,
    district: geminiFields.district,
    propertyType: geminiFields.propertyType
  });
  return {
    rawCityText: normalized.rawCity,
    rawNeighborhoodText: normalized.rawNeighborhood,
    rawPropertyTypeText: normalized.rawPropertyType,
    opportunityKind: geminiFields.opportunityKind || "OFFER",
    salePrice: geminiFields.salePrice ?? "",
    budget: geminiFields.budget ?? "",
    annualRent: geminiFields.annualRent ?? "",
    area: geminiFields.area ?? "",
    rooms: geminiFields.rooms ?? ""
  };
}

export const __test = {
  classifyImportPropertyType,
  resolveImportOperationTypeId,
  evaluateImportReviewSaveMinimum,
  hasImportPrimaryPropertyInfo,
  prefillImportReviewFromGeminiFields
};
