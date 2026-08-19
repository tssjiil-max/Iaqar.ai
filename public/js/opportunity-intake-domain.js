/**
 * Phase 2 — Unified Opportunity Intake domain.
 *
 * Deterministic phrase/context Arabic extraction, simulated fixtures for binary attachments,
 * missing-field tracking, and deduplication. No production AI is claimed here.
 */

import { extractArabicOpportunityText } from "./opportunity-text-extraction.js";
import { evaluateMatchingReadiness } from "./opportunity-readiness-domain.js";

export const INTAKE_STATES = Object.freeze([
  "idle",
  "uploading",
  "analyzing",
  "missing_information",
  "saved",
  "failed"
]);

export const INTAKE_STATE_LABELS = Object.freeze({
  idle: "",
  uploading: "جارٍ الرفع…",
  analyzing: "جارٍ التحليل…",
  missing_information: "يلزم استكمال بيانات ناقصة",
  saved: "تم الحفظ في العروض والطلبات",
  failed: "تعذّر الحفظ — يمكنك إعادة المحاولة"
});

export const SOURCE_TYPES = Object.freeze([
  "url",
  "text",
  "image",
  "screenshot",
  "pdf",
  "word",
  "excel",
  "audio"
]);

export const OPPORTUNITY_KINDS = Object.freeze(["OFFER", "REQUEST"]);

export const PURPOSES = Object.freeze([
  "SALE",
  "PURCHASE",
  "RENT",
  "LEASE_REQUEST",
  "INVESTMENT"
]);

export const REQUIRED_OPPORTUNITY_FIELDS = Object.freeze([
  "opportunityKind",
  "purpose",
  "propertyType",
  "city",
  "district",
  "priceOrBudget",
  "area",
  "rooms"
]);

export const EXTENDED_OPPORTUNITY_FIELDS = Object.freeze([
  "salePrice",
  "budget",
  "bathrooms",
  "floorNumber",
  "floorPosition",
  "floorsCount",
  "annualRent",
  "monthlyRent",
  "paymentInstallments",
  "optionalMonthlyRentAfterSixMonths",
  "livingRoom",
  "kitchen",
  "condition",
  "electricityMeter",
  "waterAndSewagePaidBy",
  "electricityPaidBy",
  "ownerConditions",
  "transactionType",
  "advertiserRole",
  "advertiserPhoneRaw",
  "advertiserPhoneNormalized",
  "contactPhone"
]);

/** MIME / extension maps for the paperclip chooser. */
export const ATTACHMENT_ACCEPT = [
  "image/*",
  "application/pdf",
  ".pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc",
  ".docx",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls",
  ".xlsx",
  "audio/*",
  ".m4a",
  ".mp3",
  ".wav",
  ".ogg"
].join(",");

const URL_RE = /^(https?:\/\/|www\.)\S+/i;
const BARE_HOST_PATH_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63}(?::\d{2,5})?(?:[/?#][^\s]*)?$/i;
const MAX_TEXT = 12000;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export function safeText(value, max = MAX_TEXT) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, max);
}

/** Normalize Eastern Arabic / Persian digits to ASCII for deterministic parsing. */
export function normalizeDigits(value) {
  return String(value == null ? "" : value).replace(/[٠-٩]/g, (digit) =>
    String(digit.charCodeAt(0) - 1632)
  ).replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776));
}

const PURPOSE_BY_TRANSACTION = Object.freeze({
  SALE: "SALE",
  PURCHASE: "PURCHASE",
  RENT: "RENT",
  LEASE_REQUEST: "LEASE_REQUEST",
  INVESTMENT: "INVESTMENT",
  "بيع": "SALE",
  "شراء": "PURCHASE",
  "إيجار": "RENT",
  "ايجار": "RENT",
  "طلب إيجار": "LEASE_REQUEST",
  "طلب ايجار": "LEASE_REQUEST",
  "استئجار": "LEASE_REQUEST",
  "تأجير": "RENT",
  "استثمار": "INVESTMENT"
});

const TRANSACTION_BY_PURPOSE = Object.freeze({
  SALE: "بيع",
  PURCHASE: "شراء",
  RENT: "إيجار",
  LEASE_REQUEST: "طلب إيجار",
  INVESTMENT: "استثمار"
});

const NUMERIC_FIELDS = new Set([
  "salePrice",
  "annualRent",
  "monthlyRent",
  "optionalMonthlyRentAfterSixMonths",
  "paymentInstallments",
  "budget",
  "priceOrBudget",
  "area",
  "rooms",
  "bathrooms",
  "floorNumber",
  "floorsCount"
]);

function nullableNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(normalizeDigits(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

export function normalizePurpose(value) {
  const text = safeText(value, 30);
  return PURPOSE_BY_TRANSACTION[text.toUpperCase()]
    || PURPOSE_BY_TRANSACTION[text]
    || text;
}

export function isLandProperty(value) {
  return /أرض|ارض/.test(safeText(value, 40));
}

export function normalizeOpportunityFinancials(fields = {}) {
  const purpose = normalizePurpose(fields.purpose || fields.transactionType || fields.transactionTypeLabel);
  const legacy = nullableNumber(fields.priceOrBudget ?? fields.price);
  const salePrice = purpose === "SALE" ? (nullableNumber(fields.salePrice) ?? legacy) : null;
  const annualRent = purpose === "RENT" ? (nullableNumber(fields.annualRent) ?? legacy) : null;
  const monthlyRent = purpose === "RENT" ? nullableNumber(fields.monthlyRent) : null;
  const optionalMonthlyRentAfterSixMonths = purpose === "RENT"
    ? nullableNumber(fields.optionalMonthlyRentAfterSixMonths)
    : null;
  const paymentInstallments = purpose === "RENT" ? nullableNumber(fields.paymentInstallments) : null;
  const budget = purpose === "PURCHASE" || purpose === "LEASE_REQUEST"
    ? (nullableNumber(fields.budget) ?? legacy)
    : null;
  const priceOrBudget = purpose === "SALE"
    ? salePrice
    : purpose === "RENT"
      ? annualRent
      : purpose === "PURCHASE" || purpose === "LEASE_REQUEST"
        ? budget
        : purpose === "INVESTMENT"
          ? legacy
          : legacy;
  return {
    ...fields,
    purpose,
    transactionType: TRANSACTION_BY_PURPOSE[purpose] || "",
    salePrice,
    annualRent,
    monthlyRent,
    optionalMonthlyRentAfterSixMonths,
    paymentInstallments,
    budget,
    priceOrBudget
  };
}

export function requiredOpportunityFieldsFor(fields = {}) {
  const normalized = normalizeOpportunityFinancials(fields);
  const required = ["opportunityKind", "purpose", "propertyType", "city", "district"];
  if (normalized.purpose === "SALE") required.push("salePrice");
  else if (normalized.purpose === "RENT") required.push("annualRent");
  else if (normalized.purpose === "PURCHASE" || normalized.purpose === "LEASE_REQUEST") required.push("budget");
  else if (normalized.purpose === "INVESTMENT") required.push("priceOrBudget");
  required.push("area");
  if (!isLandProperty(normalized.propertyType)) required.push("rooms");
  return required;
}

export function isHttpUrl(value) {
  const text = safeText(value, 2000);
  if (!URL_RE.test(text) && !BARE_HOST_PATH_RE.test(text)) return false;
  try {
    const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const url = new URL(withProtocol);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeUrl(value) {
  const text = safeText(value, 2000);
  if (!isHttpUrl(text)) return "";
  const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  const url = new URL(withProtocol);
  url.hash = "";
  // Stable fingerprint: host lowercased, strip trailing slash, drop default ports.
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
}

export function detectSourceTypeFromText(value) {
  const text = safeText(value);
  if (!text) return "";
  if (isHttpUrl(text)) return "url";
  return "text";
}

export function detectSourceTypeFromFile(file) {
  if (!file) return "";
  const name = safeText(file.name || "", 240).toLowerCase();
  const type = safeText(file.type || "", 120).toLowerCase();

  if (type.startsWith("audio/") || /\.(m4a|mp3|wav|ogg|aac|amr)$/.test(name)) return "audio";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    type.includes("spreadsheet") ||
    type.includes("excel") ||
    /\.(xlsx|xls|csv)$/.test(name)
  ) return "excel";
  if (
    type.includes("word") ||
    type.includes("msword") ||
    /\.(docx|doc|rtf)$/.test(name)
  ) return "word";
  if (type.startsWith("image/")) {
    // Screenshots commonly keep "screenshot" in the filename.
    if (/screenshot|لقطة|شاشة/.test(name)) return "screenshot";
    return "image";
  }
  return "";
}

export function mapSourceTypeToCanonicalContentType(sourceType = "") {
  const type = safeText(sourceType, 20).toLowerCase();
  if (type === "url") return "sourceUrl";
  if (type === "text") return "text";
  if (type === "audio") return "audio";
  if (type === "image" || type === "screenshot") return "image";
  if (type === "pdf" || type === "word" || type === "excel") return "document";
  return "";
}

export function validateAttachment(file) {
  if (!file) return { ok: false, error: "لم يتم اختيار ملف" };
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: "حجم الملف يتجاوز 15 ميجابايت" };
  }
  const sourceType = detectSourceTypeFromFile(file);
  if (!SOURCE_TYPES.includes(sourceType) || sourceType === "url" || sourceType === "text") {
    return { ok: false, error: "نوع الملف غير مدعوم" };
  }
  return { ok: true, sourceType };
}

/**
 * Extraction adapter boundary.
 * - deterministic_text_parser: regex heuristics over text/URL (not AI).
 * - simulated_fixture: labeled fixtures for binary attachments until a real provider exists.
 */
export function createExtractionAdapter(options = {}) {
  const mode = options.mode === "simulated_fixture" ? "simulated_fixture" : "auto";

  return {
    labelFor(sourceType) {
      if (sourceType === "text" || sourceType === "url") return "deterministic_text_parser";
      return "simulated_fixture";
    },

    async extract(input) {
      const sourceType = input.sourceType;
      const label = this.labelFor(sourceType);
      if (label === "deterministic_text_parser") {
        return extractFromText(input.text || input.url || "", { sourceType, label });
      }
      // Simulated fixtures — never claim production OCR/ASR/document AI.
      return extractFromSimulatedAttachment(input, { label });
    },

    get mode() {
      return mode;
    }
  };
}

function extractFromText(raw, meta) {
  const parsed = extractArabicOpportunityText(raw);
  const fields = { ...parsed.legacyFields };

  return {
    extractionMode: meta.label,
    extractionProvider: "iaqar.deterministic_text_parser",
    productionAi: false,
    extractionConfidence: parsed.extractionConfidence,
    fields,
    extended: parsed.extended,
    publicShape: parsed.publicShape,
    needsReview: parsed.needsReview,
    fieldEvidence: parsed.fieldEvidence,
    structured: parsed.structured,
    rawHints: {
      sourceType: meta.sourceType,
      textLength: parsed.normalizedText.length,
      pipeline: "normalize→extract→validate→resolve"
    }
  };
}

function extractFromSimulatedAttachment(input, meta) {
  const fixtures = {
    image: { propertyType: "شقة", city: "", district: "", opportunityKind: "", purpose: "" },
    screenshot: { propertyType: "", city: "", district: "", opportunityKind: "", purpose: "" },
    pdf: { propertyType: "فيلا", city: "", district: "", opportunityKind: "OFFER", purpose: "" },
    word: { propertyType: "", city: "", district: "", opportunityKind: "REQUEST", purpose: "PURCHASE" },
    excel: { propertyType: "أرض", city: "", district: "", opportunityKind: "OFFER", purpose: "SALE" },
    audio: { propertyType: "", city: "", district: "", opportunityKind: "", purpose: "RENT" }
  };
  const hint = safeText([input.fileName, input.text].filter(Boolean).join(" "));
  const fromHint = hint
    ? extractFromText(hint, { sourceType: input.sourceType, label: meta.label }).fields
    : null;
  const base = fixtures[input.sourceType] || {};
  const fields = {
    opportunityKind: fromHint?.opportunityKind || base.opportunityKind || "",
    purpose: fromHint?.purpose || base.purpose || "",
    propertyType: fromHint?.propertyType || base.propertyType || "",
    city: fromHint?.city || base.city || "",
    district: fromHint?.district || base.district || "",
    priceOrBudget: fromHint?.priceOrBudget ?? null,
    area: fromHint?.area ?? null,
    rooms: fromHint?.rooms ?? null
  };
  const filled = countFilled(fields);
  return {
    extractionMode: meta.label,
    extractionProvider: "iaqar.simulated_fixture",
    productionAi: false,
    extractionConfidence: Math.round((filled / REQUIRED_OPPORTUNITY_FIELDS.length) * 40),
    fields,
    rawHints: {
      sourceType: input.sourceType,
      fileName: safeText(input.fileName, 240),
      simulated: true
    }
  };
}

function countFilled(fields) {
  return REQUIRED_OPPORTUNITY_FIELDS.filter((key) => {
    const value = fields[key];
    return value !== null && value !== undefined && String(value).trim() !== "";
  }).length;
}

export function listMissingFields(fields) {
  const normalized = normalizeOpportunityFinancials(fields);
  return requiredOpportunityFieldsFor(normalized).filter((key) => {
    const value = normalized[key];
    return value === null || value === undefined || String(value).trim() === "";
  });
}

export function computeDataCompleteness(fields) {
  const normalized = normalizeOpportunityFinancials(fields);
  const required = requiredOpportunityFieldsFor(normalized);
  const missing = listMissingFields(normalized);
  const filled = required.length - missing.length;
  return {
    missingFields: missing,
    dataCompleteness: Math.round((filled / required.length) * 100),
    isComplete: missing.length === 0
  };
}

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildDeduplicationFingerprint({
  officeId,
  sourceType,
  text = "",
  url = "",
  fileChecksum = "",
  fileName = ""
}) {
  const normalizedOffice = safeText(officeId, 80).toLowerCase();
  let core = "";
  if (sourceType === "url") core = `url:${normalizeUrl(url || text)}`;
  else if (fileChecksum) core = `file:${fileChecksum}`;
  else if (sourceType === "text") {
    core = `text:${safeText(text).replace(/\s+/g, " ").toLowerCase()}`;
  } else {
    core = `meta:${sourceType}|${safeText(fileName, 240).toLowerCase()}|${safeText(text, 500).toLowerCase()}`;
  }
  const hex = await sha256Hex(`${normalizedOffice}|${sourceType}|${core}`);
  return hex;
}

export function opportunityDocumentId(fingerprint) {
  return `opp_${String(fingerprint || "").slice(0, 40)}`;
}

export function sourceDocumentId(fingerprint) {
  return `src_${String(fingerprint || "").slice(0, 40)}`;
}

/**
 * Build one unified Opportunity record (directive §11 / Phase 2 required fields).
 * Does not create Operations Center items and does not run matching.
 */
export function buildOpportunityRecord({
  officeId,
  brokerId,
  sourceType,
  sourceReference,
  fields,
  extraction,
  deduplicationFingerprint,
  now = new Date(),
  existingId = ""
}) {
  const normalizedFields = normalizeOpportunityFinancials(fields);
  const completeness = computeDataCompleteness(normalizedFields);
  const readiness = evaluateMatchingReadiness({ ...normalizedFields, ...fields });
  const internalStatus = readiness.isReadyForMatching ? "READY" : "NEEDS_DATA";
  const id = existingId || opportunityDocumentId(deduplicationFingerprint);
  const timestamp = now.toISOString();

  return {
    id,
    officeId: safeText(officeId, 80),
    brokerId: safeText(brokerId, 120),
    originatingOfficeId: safeText(officeId, 80),
    originatingBrokerId: safeText(brokerId, 120),
    currentOwningOfficeId: safeText(officeId, 80),
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceType,
    sourceReference: safeText(sourceReference, 500),
    opportunityKind: safeText(normalizedFields.opportunityKind, 20),
    purpose: normalizedFields.purpose,
    propertyType: safeText(normalizedFields.propertyType, 40),
    city: safeText(normalizedFields.city, 80),
    district: safeText(normalizedFields.district, 80),
    salePrice: normalizedFields.salePrice,
    annualRent: normalizedFields.annualRent,
    monthlyRent: normalizedFields.monthlyRent,
    optionalMonthlyRentAfterSixMonths: normalizedFields.optionalMonthlyRentAfterSixMonths,
    paymentInstallments: normalizedFields.paymentInstallments,
    budget: normalizedFields.budget,
    priceOrBudget: normalizedFields.priceOrBudget,
    price: normalizedFields.priceOrBudget,
    area: normalizedFields.area == null || normalizedFields.area === "" ? null : Number(normalizedFields.area),
    rooms: isLandProperty(normalizedFields.propertyType)
      ? null
      : (normalizedFields.rooms == null || normalizedFields.rooms === "" ? null : Number(normalizedFields.rooms)),
    extractionConfidence: Number(extraction?.extractionConfidence || 0),
    dataCompleteness: completeness.dataCompleteness,
    internalStatus,
    matchingReadiness: readiness.matchingReadiness,
    matchingReadinessMissing: readiness.matchingReadinessMissing,
    lifecycleStatus: completeness.isComplete ? "ACTIVE" : "ACTIVE",
    deduplicationFingerprint,
    missingFields: completeness.missingFields,
    extractionMode: extraction?.extractionMode || "simulated_fixture",
    extractionProvider: extraction?.extractionProvider || "iaqar.simulated_fixture",
    productionAi: false,
    cooperationState: "NOT_SHARED",
    cooperationStatus: "NOT_SHARED",
    version: 1,
    // Extended structured extraction (backward-compatible optional fields).
    bathrooms: isLandProperty(normalizedFields.propertyType) ? null : (normalizedFields.bathrooms ?? null),
    floorNumber: isLandProperty(normalizedFields.propertyType) ? null : (normalizedFields.floorNumber ?? null),
    floorPosition: normalizedFields.floorPosition ?? null,
    floorsCount: normalizedFields.floorsCount ?? null,
    livingRoom: normalizedFields.livingRoom ?? null,
    kitchen: normalizedFields.kitchen ?? null,
    condition: normalizedFields.condition ?? null,
    electricityMeter: normalizedFields.electricityMeter ?? null,
    waterAndSewagePaidBy: normalizedFields.waterAndSewagePaidBy ?? null,
    electricityPaidBy: normalizedFields.electricityPaidBy ?? null,
    ownerConditions: normalizedFields.ownerConditions ?? null,
    transactionTypeLabel: normalizedFields.transactionType || null,
    extractionFieldEvidence: extraction?.fieldEvidence || null,
    extractionNeedsReview: extraction?.needsReview || null,
    advertiserPhoneRaw: safeText(fields.advertiserPhoneRaw, 40),
    advertiserPhoneNormalized: safeText(fields.advertiserPhoneNormalized, 20),
    advertiserPhoneSource: safeText(fields.advertiserPhoneSource, 40),
    advertiserPhoneEvidence: safeText(fields.advertiserPhoneEvidence, 200),
    advertiserRole: safeText(fields.advertiserRole || "UNKNOWN", 20),
    advertiserContactStatus: safeText(fields.advertiserContactStatus || "NOT_CONTACTED", 30),
    marketingConsentStatus: safeText(fields.marketingConsentStatus || "NOT_STARTED", 30),
    lastContactAt: fields.lastContactAt || null,
    contactNotes: safeText(fields.contactNotes, 500),
    // Legacy projection helpers used by the Opportunity Bank list.
    recordType: normalizedFields.opportunityKind === "OFFER" ? "owner" : "client",
    status: "active",
    schemaVersion: 4
  };
}

export function buildSourceRecord({
  officeId,
  brokerId,
  sourceType,
  fingerprint,
  text = "",
  url = "",
  mediaPath = "",
  fileName = "",
  contentType = "",
  byteSize = 0,
  now = new Date()
}) {
  return {
    id: sourceDocumentId(fingerprint),
    officeId: safeText(officeId, 80),
    brokerId: safeText(brokerId, 120),
    sourceType,
    deduplicationFingerprint: fingerprint,
    text: safeText(text),
    url: sourceType === "url" ? normalizeUrl(url || text) : safeText(url, 2000),
    mediaPath: safeText(mediaPath, 500),
    fileName: safeText(fileName, 240),
    contentType: safeText(contentType, 120),
    byteSize: Number(byteSize) || 0,
    createdAt: now.toISOString(),
    schemaVersion: 1
  };
}

export function mergeBrokerProvidedFields(baseFields, provided = {}) {
  const normalizedBase = normalizeOpportunityFinancials(baseFields);
  const nextPurpose = Object.prototype.hasOwnProperty.call(provided, "purpose")
    ? normalizePurpose(provided.purpose)
    : normalizedBase.purpose;
  const purposeChanged = Boolean(normalizedBase.purpose && nextPurpose && normalizedBase.purpose !== nextPurpose);
  const next = { ...normalizedBase };
  if (purposeChanged) {
    for (const key of [
      "salePrice", "annualRent", "monthlyRent", "optionalMonthlyRentAfterSixMonths",
      "paymentInstallments", "budget", "priceOrBudget"
    ]) next[key] = null;
  }
  for (const key of [...REQUIRED_OPPORTUNITY_FIELDS, ...EXTENDED_OPPORTUNITY_FIELDS]) {
    if (!Object.prototype.hasOwnProperty.call(provided, key)) continue;
    const value = provided[key];
    if (value === undefined) continue;
    if (value === null || String(value).trim() === "") {
      next[key] = NUMERIC_FIELDS.has(key) ? null : "";
      continue;
    }
    if (Array.isArray(value) && value.length) {
      next[key] = value;
      continue;
    }
    if (typeof value === "boolean") {
      next[key] = value;
      continue;
    }
    next[key] = NUMERIC_FIELDS.has(key) ? nullableNumber(value) : safeText(value, 120);
  }
  return normalizeOpportunityFinancials(next);
}

/**
 * Pure pipeline step used by UI and tests. No network I/O.
 * Returns either needsBrokerInput or a ready opportunity+source pair.
 */
export async function prepareOpportunityIntake(input, adapter = createExtractionAdapter()) {
  const officeId = safeText(input.officeId, 80);
  const brokerId = safeText(input.brokerId, 120);
  if (!officeId) throw new Error("office_id_required");
  if (!brokerId) throw new Error("broker_id_required");

  let sourceType = input.sourceType || "";
  let text = safeText(input.text);
  let url = "";
  let fileChecksum = safeText(input.fileChecksum, 128);
  let fileName = safeText(input.fileName, 240);
  let contentType = safeText(input.contentType, 120);
  let byteSize = Number(input.byteSize) || 0;
  let mediaPath = safeText(input.mediaPath, 500);

  if (input.file) {
    const validated = validateAttachment(input.file);
    if (!validated.ok) {
      return { ok: false, state: "failed", error: validated.error, retryable: true };
    }
    sourceType = validated.sourceType;
    fileName = input.file.name || fileName;
    contentType = input.file.type || contentType;
    byteSize = input.file.size || byteSize;
  } else if (!sourceType) {
    const explicitUrl = normalizeUrl(input.url || "");
    if (explicitUrl) {
      sourceType = "url";
    } else {
      sourceType = detectSourceTypeFromText(text);
    }
  }

  if (!SOURCE_TYPES.includes(sourceType)) {
    return { ok: false, state: "failed", error: "لم يتم التعرف على مصدر الفرصة", retryable: true };
  }

  if (sourceType === "url") {
    url = normalizeUrl(input.url || (isHttpUrl(text) ? text : ""));
    if (!url) {
      return { ok: false, state: "failed", error: "الرابط غير صالح", retryable: true };
    }
    const listingText = safeText(input.listingText || (text && text !== url ? text : ""));
    if (!listingText && !input.allowUrlWithoutListing) {
      return {
        ok: false,
        state: "failed",
        error: "تعذر استخراج بيانات الإعلان من الرابط",
        retryable: true
      };
    }
    if (!listingText) text = url;
    else text = listingText;
  }

  if ((sourceType === "text" || sourceType === "url") && !text) {
    return { ok: false, state: "failed", error: "أدخل رابطًا أو نصًا", retryable: true };
  }

  const fingerprint = await buildDeduplicationFingerprint({
    officeId,
    sourceType,
    text,
    url,
    fileChecksum,
    fileName
  });

  const extraction = await adapter.extract({
    sourceType,
    text,
    url,
    fileName,
    contentType
  });

  let fields = { ...extraction.fields };
  if (extraction.extended) {
    fields = { ...fields, ...extraction.extended };
  }
  if (input.brokerFields) fields = mergeBrokerProvidedFields(fields, input.brokerFields);
  else fields = normalizeOpportunityFinancials(fields);

  const completeness = computeDataCompleteness(fields);
  const source = buildSourceRecord({
    officeId,
    brokerId,
    sourceType,
    fingerprint,
    text,
    url,
    mediaPath,
    fileName,
    contentType,
    byteSize
  });

  if (!completeness.isComplete && !input.allowIncomplete) {
    return {
      ok: true,
      state: "missing_information",
      missingFields: completeness.missingFields,
      fields,
      extraction,
      source,
      deduplicationFingerprint: fingerprint,
      productionAi: false
    };
  }

  const opportunity = buildOpportunityRecord({
    officeId,
    brokerId,
    sourceType,
    sourceReference: source.id,
    fields,
    extraction,
    deduplicationFingerprint: fingerprint
  });

  return {
    ok: true,
    state: "saved",
    opportunity,
    source,
    fields,
    extraction,
    missingFields: completeness.missingFields,
    deduplicationFingerprint: fingerprint,
    createsOperation: false,
    runsMatching: false,
    productionAi: false
  };
}
