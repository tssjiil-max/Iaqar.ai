/**
 * Gemini voice intake — pure domain mapping (no DOM, no network).
 */

import {
  isLandProperty,
  mergeBrokerProvidedFields,
  normalizeDigits,
  safeText
} from "./opportunity-intake-domain.js";
import { applyMonetaryNormalization, normalizeArabicMagnitudeNumber } from "./arabic-magnitude.js";
import { buildReviewDefaults } from "./reference-catalog.js";

export const VOICE_MAX_DURATION_MS = 120_000;
export const VOICE_MAX_BYTES = 5 * 1024 * 1024;
export const VOICE_ALLOWED_MIMES = Object.freeze([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/flac"
]);

const MANUAL_PRIORITY_KEYS = Object.freeze([
  "name", "phone", "advertiserName", "advertiserPhone",
  "city", "district", "propertyType", "requestKind"
]);

export function validateVoiceBlob({ blob, durationMs = 0 } = {}) {
  if (!blob || !(blob instanceof Blob)) return { ok: false, error: "audio_empty" };
  if (blob.size <= 0) return { ok: false, error: "audio_empty" };
  if (blob.size > VOICE_MAX_BYTES) return { ok: false, error: "audio_too_large" };
  const mime = String(blob.type || "").split(";")[0].trim().toLowerCase();
  if (!mime || !VOICE_ALLOWED_MIMES.includes(mime)) return { ok: false, error: "audio_mime_invalid" };
  if (durationMs > VOICE_MAX_DURATION_MS) return { ok: false, error: "audio_too_long" };
  return { ok: true, mimeType: mime, byteSize: blob.size };
}

export function normalizeGeminiVoicePayload(raw = {}) {
  const out = {};
  const keys = [
    "transactionType", "propertyType", "city", "district",
    "salePrice", "annualRent", "budget", "area", "rooms", "bathrooms", "floorNumber",
    "streetWidth", "direction", "planNumber", "plotNumber",
    "advertiserName", "advertiserPhone", "advertiserRole", "description"
  ];
  for (const key of keys) {
    const value = raw[key];
    if (value === null || value === undefined || value === "") {
      out[key] = null;
      continue;
    }
    if (["salePrice", "annualRent", "budget", "area", "rooms", "bathrooms", "floorNumber", "streetWidth"].includes(key)) {
      if (typeof value === "string" && /مليون|مليار|ألف|الف|خمس|عشر/i.test(value)) {
        const parsed = normalizeArabicMagnitudeNumber(value, { fieldKind: key === "area" || key === "streetWidth" || key === "plotNumber" ? "plain" : "money" });
        out[key] = parsed;
        continue;
      }
      const num = Number(normalizeDigits(value).replace(/,/g, ""));
      out[key] = Number.isFinite(num) ? num : null;
      continue;
    }
    out[key] = safeText(value, 200) || null;
  }
  out.needsReview = raw.needsReview && typeof raw.needsReview === "object" ? raw.needsReview : {};
  return out;
}

function inferPurposeAndKind(transactionType = "", context = "office") {
  const tx = safeText(transactionType, 40).toLowerCase();
  if (/purchase|شراء|مطلوب/.test(tx)) return { purpose: "PURCHASE", opportunityKind: "REQUEST" };
  if (/lease_request|استئجار|طلب.*إيجار/.test(tx)) return { purpose: "LEASE_REQUEST", opportunityKind: "REQUEST" };
  if (/rent|إيجار|ايجار/.test(tx)) {
    return context === "client"
      ? { purpose: "LEASE_REQUEST", opportunityKind: "REQUEST" }
      : { purpose: "RENT", opportunityKind: "OFFER" };
  }
  if (/invest|استثمار/.test(tx)) return { purpose: "INVESTMENT", opportunityKind: "OFFER" };
  return { purpose: "SALE", opportunityKind: context === "client" ? "REQUEST" : "OFFER" };
}

export function mapGeminiToOpportunityFields(structured = {}, { context = "office", sourceText = "" } = {}) {
  const payload = normalizeGeminiVoicePayload(structured);
  const monetary = applyMonetaryNormalization(payload, sourceText || buildVoiceSummaryText(structured));
  const normalizedPayload = { ...payload, ...monetary };
  const { purpose, opportunityKind } = inferPurposeAndKind(normalizedPayload.transactionType, context);
  const propertyType = normalizedPayload.propertyType || "";
  const land = isLandProperty(propertyType);
  const priceOrBudget = normalizedPayload.salePrice ?? normalizedPayload.annualRent ?? normalizedPayload.budget ?? null;

  const fields = {
    opportunityKind,
    purpose,
    propertyType,
    city: normalizedPayload.city || "",
    district: normalizedPayload.district || "",
    salePrice: normalizedPayload.salePrice,
    annualRent: normalizedPayload.annualRent,
    budget: normalizedPayload.budget,
    priceOrBudget,
    area: normalizedPayload.area,
    rooms: land ? null : normalizedPayload.rooms,
    bathrooms: land ? null : normalizedPayload.bathrooms,
    floorNumber: land ? null : normalizedPayload.floorNumber,
    streetWidth: normalizedPayload.streetWidth,
    direction: normalizedPayload.direction,
    planNumber: normalizedPayload.planNumber,
    plotNumber: normalizedPayload.plotNumber,
    advertiserPhoneRaw: normalizedPayload.advertiserPhone || "",
    advertiserPhoneNormalized: normalizedPayload.advertiserPhone || "",
    advertiserRole: normalizedPayload.advertiserRole || (context === "owner" ? "OWNER" : context === "client" ? "CLIENT" : "UNKNOWN"),
    contactNotes: normalizedPayload.description || ""
  };
  return mergeBrokerProvidedFields({}, fields);
}

export function buildVoiceSummaryText(structured = {}) {
  const p = normalizeGeminiVoicePayload(structured);
  return [
    p.transactionType,
    p.propertyType,
    p.city,
    p.district,
    p.salePrice != null ? `sale ${p.salePrice}` : "",
    p.annualRent != null ? `rent ${p.annualRent}` : "",
    p.budget != null ? `budget ${p.budget}` : "",
    p.area != null ? `area ${p.area}` : "",
    p.description
  ].filter(Boolean).join(" | ").slice(0, 500);
}

export function createVoiceExtractionAdapter(structured = {}, { context = "office", sourceText = "" } = {}) {
  const summary = sourceText || buildVoiceSummaryText(structured);
  const fields = mapGeminiToOpportunityFields(structured, { context, sourceText: summary });
  const payload = normalizeGeminiVoicePayload(structured);
  const monetary = applyMonetaryNormalization(payload, summary);
  return {
    extract: async () => ({
      fields,
      extended: {
        transactionType: payload.transactionType,
        propertyType: payload.propertyType,
        district: payload.district,
        salePrice: monetary.salePrice ?? payload.salePrice,
        annualRent: monetary.annualRent ?? payload.annualRent,
        budget: monetary.budget ?? payload.budget,
        area: payload.area,
        rooms: fields.rooms,
        bathrooms: fields.bathrooms,
        floorNumber: fields.floorNumber,
        streetWidth: payload.streetWidth,
        direction: payload.direction,
        planNumber: payload.planNumber,
        plotNumber: payload.plotNumber
      },
      extractionMode: "gemini_voice_adapter",
      extractionProvider: "google.gemini_voice",
      extractionConfidence: 0.9,
      needsReview: payload.needsReview || {},
      productionAi: true
    })
  };
}

export function buildReviewDefaultsFromGemini(structured = {}, sourceText = "") {
  const fields = mapGeminiToOpportunityFields(structured, { context: "office" });
  return buildReviewDefaults(fields, sourceText || buildVoiceSummaryText(structured), {
    extended: fields,
    needsReview: structured.needsReview || {}
  });
}

function mapPropertyTypeToPublicOption(propertyType = "") {
  const label = safeText(propertyType, 80);
  if (!label) return "";
  if (/أرض/.test(label)) return label.includes("تجاري") ? "أرض تجارية" : "أرض سكنية";
  return label;
}

function mapTransactionToRequestKind(transactionType = "", context = "client") {
  const tx = safeText(transactionType, 40).toLowerCase();
  if (context !== "client") return "";
  if (/rent|إيجار|ايجار|lease/.test(tx)) return "rent";
  return "purchase";
}

export function mapGeminiToPublicFormValues(structured = {}, {
  context = "client",
  manualValues = {}
} = {}) {
  const payload = normalizeGeminiVoicePayload(structured);
  const extracted = {
    name: payload.advertiserName || "",
    phone: payload.advertiserPhone || "",
    city: payload.city || "",
    district: payload.district || "",
    propertyType: mapPropertyTypeToPublicOption(payload.propertyType),
    requestKind: mapTransactionToRequestKind(payload.transactionType, context),
    budget: payload.budget ?? payload.salePrice ?? "",
    annualRent: payload.annualRent ?? "",
    area: payload.area ?? "",
    rooms: isLandProperty(payload.propertyType) ? "" : (payload.rooms ?? ""),
    bathrooms: isLandProperty(payload.propertyType) ? "" : (payload.bathrooms ?? ""),
    streetWidth: payload.streetWidth ?? "",
    facing: payload.direction ?? "",
    details: payload.description || ""
  };
  return mergePrefillRespectingManual(manualValues, extracted);
}

export function mergePrefillRespectingManual(manualValues = {}, extracted = {}) {
  const out = { ...extracted };
  for (const key of MANUAL_PRIORITY_KEYS) {
    const manual = manualValues[key];
    if (manual != null && String(manual).trim() !== "") out[key] = manual;
  }
  if (manualValues.phone && !out.phone) out.phone = manualValues.phone;
  if (manualValues.name && !out.name) out.name = manualValues.name;
  return out;
}

export function voiceErrorMessageAr(code = "") {
  const map = {
    MIC_PERMISSION_DENIED: "تم منع الوصول إلى الميكروفون. فعّل إذن الميكروفون من إعدادات المتصفح ثم حاول مرة أخرى.",
    AUDIO_UPLOAD_FAILED: "تعذر إرسال التسجيل. حاول مرة أخرى.",
    GEMINI_QUOTA_EXCEEDED: "تعذر تحليل التسجيل حاليًا. يمكنك إعادة المحاولة أو إكمال البيانات يدويًا.",
    GEMINI_API_FAILED: "تعذر تحليل التسجيل حاليًا. يمكنك إعادة المحاولة أو إكمال البيانات يدويًا.",
    GEMINI_NOT_CONFIGURED: "تعذر تحليل التسجيل حاليًا. يمكنك إكمال البيانات يدويًا.",
    TRANSCRIPTION_EXTRACTION_FAILED: "تعذر تحليل التسجيل. يمكنك إعادة المحاولة أو إكمال البيانات يدويًا.",
    audio_empty: "التسجيل فارغ.",
    audio_too_large: "التسجيل كبير جدًا.",
    audio_mime_invalid: "نوع التسجيل غير مدعوم.",
    audio_too_long: "التسجيل أطول من الحد المسموح."
  };
  return map[code] || "تعذر تحليل التسجيل. يمكنك إكمال البيانات يدويًا.";
}

export function classifyMicError(error) {
  const name = String(error?.name || "");
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "MIC_PERMISSION_DENIED";
  if (name === "NotFoundError") return "MIC_PERMISSION_DENIED";
  return "AUDIO_UPLOAD_FAILED";
}

if (typeof window !== "undefined") {
  window.IAQARGeminiVoiceIntake = {
    VOICE_MAX_DURATION_MS,
    VOICE_MAX_BYTES,
    validateVoiceBlob,
    normalizeGeminiVoicePayload,
    mapGeminiToOpportunityFields,
    mapGeminiToPublicFormValues,
    mergePrefillRespectingManual,
    buildReviewDefaultsFromGemini,
    createVoiceExtractionAdapter,
    buildVoiceSummaryText,
    voiceErrorMessageAr,
    classifyMicError
  };
}
