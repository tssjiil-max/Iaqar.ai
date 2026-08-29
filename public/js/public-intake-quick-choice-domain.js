/**
 * Public intake quick-choice labels → existing canonical form values.
 * UI-only mapping; no new stored enums.
 */

export const OWNER_PURPOSE_OPTIONS = Object.freeze([
  { id: "sale", label: "بيع", transactionType: "sale", purpose: "SALE" },
  { id: "rent", label: "تأجير", transactionType: "rent", purpose: "RENT" }
]);

export const CLIENT_PURPOSE_OPTIONS = Object.freeze([
  { id: "purchase", label: "شراء", requestKind: "purchase" },
  { id: "rent", label: "استئجار", requestKind: "rent" }
]);

export const PROPERTY_TYPE_OPTIONS = Object.freeze([
  { id: "apartment", label: "شقة", value: "شقة" },
  { id: "villa", label: "فيلا", value: "فيلا" },
  { id: "land", label: "أرض", value: "أرض" },
  { id: "building", label: "عمارة", value: "عمارة" },
  { id: "other", label: "أخرى", value: "" }
]);

export function ownerPurposeFromChip(chipId = "") {
  return OWNER_PURPOSE_OPTIONS.find((row) => row.id === chipId) || null;
}

export function clientPurposeFromChip(chipId = "") {
  return CLIENT_PURPOSE_OPTIONS.find((row) => row.id === chipId) || null;
}

export function propertyTypeFromChip(chipId = "", freeText = "") {
  const row = PROPERTY_TYPE_OPTIONS.find((item) => item.id === chipId);
  if (!row) return "";
  if (row.id === "other") return String(freeText || "").trim();
  return row.value;
}

export function buildOwnerPricingFields(purposeOption, priceOrBudget) {
  const amount = Number(priceOrBudget || 0);
  const purpose = purposeOption?.purpose || "SALE";
  const isRent = purpose === "RENT";
  return {
    transactionType: purposeOption?.transactionType || "sale",
    purpose,
    salePrice: isRent ? 0 : amount,
    annualRent: isRent ? amount : 0,
    amount,
    priceOrBudget: amount
  };
}

export function inferOwnerPurposeChip(transactionType = "", purpose = "") {
  const tx = String(transactionType || "").toLowerCase();
  const p = String(purpose || "").toUpperCase();
  if (tx === "rent" || p === "RENT") return "rent";
  return "sale";
}

export function inferClientPurposeChip(requestKind = "", transactionType = "") {
  const kind = String(requestKind || "").toLowerCase();
  const tx = String(transactionType || "").toLowerCase();
  if (kind === "rent" || tx === "rent") return "rent";
  return "purchase";
}

export function inferPropertyTypeChip(propertyType = "") {
  const text = String(propertyType || "").trim();
  if (!text) return "";
  const hit = PROPERTY_TYPE_OPTIONS.find((row) => row.value && row.value === text);
  return hit ? hit.id : "other";
}

if (typeof window !== "undefined") {
  window.IAQARPublicIntakeQuickChoice = {
    OWNER_PURPOSE_OPTIONS,
    CLIENT_PURPOSE_OPTIONS,
    PROPERTY_TYPE_OPTIONS,
    ownerPurposeFromChip,
    clientPurposeFromChip,
    propertyTypeFromChip,
    buildOwnerPricingFields,
    inferOwnerPurposeChip,
    inferClientPurposeChip,
    inferPropertyTypeChip
  };
}
