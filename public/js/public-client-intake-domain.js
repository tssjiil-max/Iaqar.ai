/**
 * Public client request intake — dynamic field schema reusing canonical opportunity names.
 * Loaded as ES module; exposed on window.IAQARPublicClientIntake for access-gate.js (IIFE).
 */

import { isLandProperty, normalizeDigits, safeText } from "./opportunity-intake-domain.js";
import {
  purposeFromTransactionIntent,
  transactionIntentFromClientChoice,
  TRANSACTION_INTENT
} from "./transaction-intent-domain.js";

export const REQUEST_KINDS = Object.freeze([
  { id: "purchase", label: "شراء", transactionIntent: TRANSACTION_INTENT.BUY },
  { id: "rent", label: "استئجار", transactionIntent: TRANSACTION_INTENT.RENT_IN }
]);

/** Map client choice to canonical request kind id for dynamic fields. */
export function normalizeRequestKind(value = "") {
  const intent = transactionIntentFromClientChoice(value);
  if (intent === TRANSACTION_INTENT.RENT_IN) return "rent";
  if (intent === TRANSACTION_INTENT.BUY) return "purchase";
  const text = safeText(value, 40).toLowerCase();
  if (text === "rent" || text === "purchase") return text;
  return safeText(value, 20);
}

export const INTAKE_PROPERTY_TYPES = Object.freeze([
  "شقة",
  "فيلا",
  "منزل",
  "أرض سكنية",
  "أرض تجارية",
  "دور",
  "عمارة",
  "محل تجاري",
  "مكتب",
  "استراحة",
  "مزرعة"
]);

const LAST_CITY_KEY = "iaqar.lastCity";

export function propertyCategory(propertyType) {
  const text = safeText(propertyType, 80);
  if (isLandProperty(text)) return "land";
  if (/شقة|شقه/.test(text)) return "apartment";
  if (/فيلا|منزل|بيت|فيلة|دوبلكس/.test(text)) return "villa_house";
  return "other";
}

export function dynamicFieldDefs(requestKind, propertyType) {
  const kind = safeText(requestKind, 20);
  const category = propertyCategory(propertyType);
  const isPurchase = kind === "purchase";
  const isRent = kind === "rent";
  const fields = [];

  if (isPurchase && category === "land") {
    fields.push(
      { name: "budget", label: "الميزانية", type: "number", required: false, inputMode: "numeric" },
      { name: "area", label: "المساحة المطلوبة (م²)", type: "number", required: false, inputMode: "decimal" },
      { name: "streetWidth", label: "عرض الشارع (م)", type: "number", required: false, inputMode: "decimal" },
      { name: "facing", label: "الواجهة", type: "text", required: false, maxLength: 40 }
    );
  } else if (isPurchase && category === "apartment") {
    fields.push(
      { name: "budget", label: "الميزانية", type: "number", required: false, inputMode: "numeric" },
      { name: "rooms", label: "عدد الغرف", type: "number", required: false, inputMode: "numeric" },
      { name: "bathrooms", label: "دورات المياه", type: "number", required: false, inputMode: "numeric" },
      { name: "area", label: "المساحة (م²)", type: "number", required: false, inputMode: "decimal" },
      { name: "condition", label: "عمر / حالة العقار", type: "text", required: false, maxLength: 80 }
    );
  } else if (isPurchase && category === "villa_house") {
    fields.push(
      { name: "budget", label: "الميزانية", type: "number", required: false, inputMode: "numeric" },
      { name: "rooms", label: "عدد الغرف", type: "number", required: false, inputMode: "numeric" },
      { name: "bathrooms", label: "دورات المياه", type: "number", required: false, inputMode: "numeric" },
      { name: "area", label: "المساحة (م²)", type: "number", required: false, inputMode: "decimal" }
    );
  } else if (isRent && category === "apartment") {
    fields.push(
      { name: "annualRent", label: "الميزانية السنوية", type: "number", required: false, inputMode: "numeric" },
      { name: "rooms", label: "عدد الغرف", type: "number", required: false, inputMode: "numeric" },
      { name: "bathrooms", label: "دورات المياه", type: "number", required: false, inputMode: "numeric" },
      { name: "area", label: "المساحة (م²)", type: "number", required: false, inputMode: "decimal" },
      { name: "furnished", label: "مفروشة / غير مفروشة", type: "text", required: false, maxLength: 40,
        placeholder: "مثال: مفروشة أو غير مفروشة" },
      { name: "paymentInstallments", label: "عدد الدفعات", type: "number", required: false, inputMode: "numeric" }
    );
  } else if (isRent && category === "villa_house") {
    fields.push(
      { name: "annualRent", label: "الميزانية السنوية", type: "number", required: false, inputMode: "numeric" },
      { name: "rooms", label: "عدد الغرف", type: "number", required: false, inputMode: "numeric" },
      { name: "bathrooms", label: "دورات المياه", type: "number", required: false, inputMode: "numeric" },
      { name: "area", label: "المساحة (م²)", type: "number", required: false, inputMode: "decimal" }
    );
  } else if (isPurchase) {
    fields.push({ name: "budget", label: "الميزانية", type: "number", required: false, inputMode: "numeric" });
  } else if (isRent) {
    fields.push({ name: "annualRent", label: "الميزانية السنوية", type: "number", required: false, inputMode: "numeric" });
  }

  return fields;
}

function nullableNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(normalizeDigits(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

export function buildClientIntakeDocument(formValues = {}, meta = {}) {
  const transactionIntent = transactionIntentFromClientChoice(formValues.transactionIntent || formValues.requestKind);
  const requestKind = normalizeRequestKind(transactionIntent || formValues.requestKind);
  const transactionType = requestKind === "rent" ? "rent" : "purchase";
  const purpose = transactionIntent ? purposeFromTransactionIntent(transactionIntent) : "";
  const propertyType = safeText(formValues.propertyType, 80);
  const city = safeText(formValues.city, 80);
  const district = safeText(formValues.district, 80);
  const budget = nullableNumber(formValues.budget);
  const annualRent = nullableNumber(formValues.annualRent);
  const amount = transactionType === "rent" ? (annualRent ?? 0) : (budget ?? 0);
  const furnishedRaw = safeText(formValues.furnished, 40).toLowerCase();
  const furnished = /مفروش/.test(furnishedRaw) && !/غير\s*مفروش|غيرمفروش/.test(furnishedRaw);
  const detailsParts = [
    safeText(formValues.details, 1000),
    safeText(formValues.facing, 40) ? `الواجهة: ${safeText(formValues.facing, 40)}` : "",
    safeText(formValues.condition, 80) ? `حالة العقار: ${safeText(formValues.condition, 80)}` : "",
    furnishedRaw === "furnished" ? "مفروشة" : furnishedRaw === "unfurnished" ? "غير مفروشة" : safeText(formValues.furnished, 40)
  ].filter(Boolean);

  return {
    kind: "client",
    opportunityKind: "REQUEST",
    transactionIntent: transactionIntent || null,
    name: safeText(formValues.name, 80),
    phone: safeText(formValues.phone, 20),
    city,
    district,
    propertyType,
    transactionType,
    requestKind,
    purpose,
    budget,
    annualRent,
    amount,
    area: nullableNumber(formValues.area),
    rooms: nullableNumber(formValues.rooms),
    bathrooms: nullableNumber(formValues.bathrooms),
    streetWidth: nullableNumber(formValues.streetWidth),
    facing: safeText(formValues.facing, 40),
    condition: safeText(formValues.condition, 80),
    furnished,
    paymentInstallments: nullableNumber(formValues.paymentInstallments),
    details: detailsParts.join(" — ").slice(0, 1000),
    officeId: safeText(meta.targetOffice, 80),
    source: meta.source || "platform_public",
    status: "new",
    completeness: computeCompleteness({
      name: formValues.name,
      phone: formValues.phone,
      propertyType,
      city,
      district,
      transactionType,
      amount
    })
  };
}

function computeCompleteness(fields) {
  const checks = [
    fields.name,
    fields.phone,
    fields.propertyType,
    fields.city,
    fields.district,
    fields.transactionIntent || fields.transactionType,
    fields.amount
  ];
  const filled = checks.filter((v) => v !== null && v !== undefined && String(v).trim() !== "" && Number(v) !== 0).length;
  return Math.min(100, Math.round((filled / checks.length) * 100));
}

export function rememberLastCity(city) {
  const value = safeText(city, 80);
  if (!value) return;
  try {
    localStorage.setItem(LAST_CITY_KEY, value);
  } catch (_) { /* ignore */ }
}

export function readRememberedCity() {
  try {
    return safeText(localStorage.getItem(LAST_CITY_KEY), 80);
  } catch (_) {
    return "";
  }
}

if (typeof window !== "undefined") {
  window.IAQARPublicClientIntake = {
    REQUEST_KINDS,
    INTAKE_PROPERTY_TYPES,
    propertyCategory,
    normalizeRequestKind,
    dynamicFieldDefs,
    buildClientIntakeDocument,
    rememberLastCity,
    readRememberedCity
  };
}
