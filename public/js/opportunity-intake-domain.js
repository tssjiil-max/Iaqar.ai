/**
 * Phase 2 — Unified Opportunity Intake domain.
 *
 * Deterministic detection/normalization, extraction adapter contracts,
 * missing-field tracking, and deduplication.
 */

export const INTAKE_STATES = Object.freeze([
  "idle",
  "uploading",
  "analyzing",
  "review",
  "missing_information",
  "saved",
  "failed"
]);

export const INTAKE_STATE_LABELS = Object.freeze({
  idle: "",
  uploading: "جارٍ الرفع…",
  analyzing: "جارٍ التحليل…",
  review: "راجع بيانات الفرصة قبل الحفظ",
  missing_information: "يلزم استكمال بيانات ناقصة",
  saved: "تم الحفظ في بنك الفرص",
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
  "LEASE_REQUEST"
]);

export const ALL_OPPORTUNITY_FIELDS = Object.freeze([
  "opportunityKind",
  "purpose",
  "transactionType",
  "propertyType",
  "city",
  "district",
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
  "advertiserPhoneNormalized"
]);

export const REQUIRED_OPPORTUNITY_FIELDS = Object.freeze([
  "opportunityKind",
  "purpose",
  "propertyType",
  "city",
  "district",
  "salePrice",
  "annualRent",
  "budget",
  "area",
  "rooms"
]);

export function requiredOpportunityFieldsFor(fields = {}) {
  const normalized = normalizeOpportunityFields(fields);
  const required = ["opportunityKind", "purpose", "propertyType", "city", "district"];
  if (normalized.purpose === "SALE") required.push("salePrice");
  else if (normalized.purpose === "RENT") required.push("annualRent");
  else if (normalized.purpose === "PURCHASE" || normalized.purpose === "LEASE_REQUEST") required.push("budget");
  required.push("area");
  if (!isLandProperty(normalized.propertyType)) required.push("rooms");
  return required;
}

/** MIME / extension maps for the paperclip chooser. */
export const ATTACHMENT_ACCEPT = [
  "image/*",
  "application/pdf",
  ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
const MAX_TEXT = 12000;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export function safeText(value, max = MAX_TEXT) {
  return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, max);
}

const PURPOSE_BY_TRANSACTION_TYPE = Object.freeze({
  SALE: "SALE",
  PURCHASE: "PURCHASE",
  RENT: "RENT",
  LEASE_REQUEST: "LEASE_REQUEST",
  "بيع": "SALE",
  "شراء": "PURCHASE",
  "إيجار": "RENT",
  "ايجار": "RENT",
  "طلب إيجار": "LEASE_REQUEST",
  "طلب ايجار": "LEASE_REQUEST"
});

const TRANSACTION_TYPE_BY_PURPOSE = Object.freeze({
  SALE: "بيع",
  PURCHASE: "شراء",
  RENT: "إيجار",
  LEASE_REQUEST: "طلب إيجار"
});

const NUMERIC_OPPORTUNITY_FIELDS = new Set([
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
  "floorNumber"
]);

function nullableNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(normalizeDigits(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

export function normalizePurpose(value) {
  return PURPOSE_BY_TRANSACTION_TYPE[safeText(value, 30).toUpperCase()]
    || PURPOSE_BY_TRANSACTION_TYPE[safeText(value, 30)]
    || "";
}

export function transactionTypeForPurpose(value) {
  return TRANSACTION_TYPE_BY_PURPOSE[normalizePurpose(value)] || "";
}

export function isLandProperty(value) {
  return /أرض|ارض/.test(safeText(value, 40));
}

/**
 * Keeps financial meanings separate while retaining priceOrBudget as a legacy
 * compatibility projection. A legacy value is mapped only after purpose is known.
 */
export function normalizeOpportunityFields(fields = {}) {
  const purpose = normalizePurpose(fields.purpose || fields.transactionType);
  const legacyValue = nullableNumber(fields.priceOrBudget ?? fields.price);
  const explicitSalePrice = nullableNumber(fields.salePrice);
  const explicitAnnualRent = nullableNumber(fields.annualRent);
  const explicitMonthlyRent = nullableNumber(fields.monthlyRent);
  const explicitOptionalMonthlyRent = nullableNumber(fields.optionalMonthlyRentAfterSixMonths);
  const explicitBudget = nullableNumber(fields.budget);

  const salePrice = purpose === "SALE" ? (explicitSalePrice ?? legacyValue) : null;
  const annualRent = purpose === "RENT" ? (explicitAnnualRent ?? legacyValue) : null;
  const monthlyRent = purpose === "RENT" ? explicitMonthlyRent : null;
  const optionalMonthlyRentAfterSixMonths = purpose === "RENT" ? explicitOptionalMonthlyRent : null;
  const budget = purpose === "PURCHASE" || purpose === "LEASE_REQUEST"
    ? (explicitBudget ?? legacyValue)
    : null;
  const priceOrBudget = purpose === "SALE"
    ? salePrice
    : purpose === "RENT"
      ? annualRent
      : purpose === "PURCHASE" || purpose === "LEASE_REQUEST"
        ? budget
        : legacyValue;

  return {
    opportunityKind: safeText(fields.opportunityKind, 20),
    purpose,
    transactionType: transactionTypeForPurpose(purpose),
    propertyType: safeText(fields.propertyType, 40),
    city: safeText(fields.city, 80),
    district: safeText(fields.district, 80),
    salePrice,
    annualRent,
    monthlyRent,
    optionalMonthlyRentAfterSixMonths,
    paymentInstallments: purpose === "RENT" ? nullableNumber(fields.paymentInstallments) : null,
    budget,
    priceOrBudget,
    area: nullableNumber(fields.area),
    rooms: nullableNumber(fields.rooms),
    bathrooms: nullableNumber(fields.bathrooms),
    floorNumber: nullableNumber(fields.floorNumber),
    advertiserPhoneNormalized: safeText(
      fields.advertiserPhoneNormalized || fields.advertiserPhone || fields.phone,
      30
    )
  };
}

/** Normalize Eastern Arabic / Persian digits to ASCII for deterministic parsing. */
export function normalizeDigits(value) {
  return String(value == null ? "" : value).replace(/[٠-٩]/g, (digit) =>
    String(digit.charCodeAt(0) - 1632)
  ).replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776));
}

export function isHttpUrl(value) {
  const text = safeText(value, 2000);
  if (!URL_RE.test(text)) return false;
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
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) return "word";
  if (type.startsWith("image/")) {
    // Screenshots commonly keep "screenshot" in the filename.
    if (/screenshot|لقطة|شاشة/.test(name)) return "screenshot";
    return "image";
  }
  return "";
}

export function validateAttachment(file) {
  if (!file) return { ok: false, error: "لم يتم اختيار ملف" };
  if (!Number(file.size)) {
    return { ok: false, error: "الملف فارغ ولا يحتوي على بيانات قابلة للتحليل" };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: "حجم الملف يتجاوز 15 ميجابايت" };
  }
  const sourceType = detectSourceTypeFromFile(file);
  if (!SOURCE_TYPES.includes(sourceType) || sourceType === "url" || sourceType === "text") {
    return { ok: false, error: "نوع الملف غير مدعوم؛ استخدم صورة أو PDF أو DOCX أو Excel أو ملفًا صوتيًا" };
  }
  return { ok: true, sourceType };
}

/**
 * Extraction adapter boundary. The browser controller supplies the authenticated Worker
 * adapter in production. This local fallback parses direct text only and never fabricates
 * attachment fields.
 */
export function createExtractionAdapter(options = {}) {
  const remoteExtract = typeof options.extract === "function" ? options.extract : null;

  return {
    labelFor(sourceType) {
      if (remoteExtract) return "authenticated_worker_extraction";
      if (sourceType === "text") return "deterministic_text_parser";
      return "unavailable";
    },

    async extract(input) {
      if (remoteExtract) return remoteExtract(input);
      const sourceType = input.sourceType;
      const label = this.labelFor(sourceType);
      if (label === "deterministic_text_parser") {
        return extractFromText(input.text || "", { sourceType, label });
      }
      return {
        extractionMode: "unavailable",
        extractionProvider: "none",
        productionAi: false,
        productionExtraction: false,
        extractionConfidence: 0,
        fields: Object.fromEntries(ALL_OPPORTUNITY_FIELDS.map((field) => [
          field,
          NUMERIC_OPPORTUNITY_FIELDS.has(field) ? null : ""
        ])),
        rawHints: { sourceType, unavailable: true }
      };
    },

    get mode() {
      return remoteExtract ? "authenticated_worker_extraction" : "local_text_only";
    }
  };
}

function extractFromText(raw, meta) {
  const text = normalizeDigits(safeText(raw));
  const lower = text.toLowerCase();

  let opportunityKind = "";
  if (/عرض|للبيع|للإيجار|ايجار|إيجار|مؤجر|أملك|املك|عقاري للبيع/.test(text)) {
    opportunityKind = "OFFER";
  } else if (/مطلوب|أبحث|ابحث|أبي|ابي|أريد|اريد|شراء|استئجار/.test(text)) {
    opportunityKind = "REQUEST";
  }

  let purpose = "";
  if (/للإيجار|للايجار|ايجار|إيجار|استئجار|مؤجر/.test(text)) {
    purpose = opportunityKind === "REQUEST" ? "LEASE_REQUEST" : "RENT";
  } else if (/شراء|أشتري|اشتري|مشتري/.test(text)) {
    purpose = "PURCHASE";
  } else if (/بيع|للبيع/.test(text)) {
    purpose = "SALE";
  }

  const propertyType =
    matchOne(text, /(فيلا|منزل|بيت|شقة|(?<!ال)دور|أرض|ارض|عمارة|مكتب|محل|مستودع|استراحة)/) || "";

  const city =
    matchOne(text, /(الرياض|جدة|المدينة المنورة|المدينة|الدمام|مكة|الخبر|الطائف|تبوك|أبها)/) || "";

  const district =
    matchOne(text, /(?:حي|مخطط)\s+([^\s،,]{2,40})/) ||
    matchOne(text, /(الرانوناء|النرجس|الياسمين|الملقا|العارض|العقيق|النخيل|الروضة|الشاطئ|السلام)/) ||
    "";

  const priceOrBudget = extractNumber(text, /(?:سعر|بميزانية|ميزانية|بـ|ب)\s*([0-9][0-9,\.]{2,})/i) ||
    extractNumber(text, /([0-9][0-9,\.]{3,})\s*(?:ألف|الف|مليون)?/);
  const annualRent = purpose === "RENT"
    ? extractNumber(text, /(?:الإيجار\s+السنوي|سنوي[ًاا]?)\s*[:：]?\s*([0-9][0-9,.]*)/i)
      || extractNumber(text, /([0-9][0-9,.]*)\s*(?:ريال|ر\.?\s?س)?\s*سنوي[ًاا]?/i)
      || priceOrBudget
    : null;

  const area = extractNumber(text, /([0-9]{2,6}(?:\.[0-9]+)?)\s*(?:م2|م²|متر)/);
  const rooms = extractNumber(text, /([0-9]{1,2})\s*(?:غرف|غرفة|غرف نوم)/);
  const bathrooms = extractNumber(text, /([0-9]{1,2})\s*(?:دورات مياه|دورة مياه|حمامات|حمام)/);
  const floorNumber = extractFloorNumber(text);
  const paymentInstallments = extractInstallmentCount(text);
  const optionalMonthlyRentAfterSixMonths = purpose === "RENT"
    ? extractNumber(text, /(?:بعد\s+(?:أول\s+)?6\s+أشهر[\s\S]{0,80}?شهري[^\s0-9]{0,3}\s*(?:بـ)?\s*)([0-9][0-9,.]*)/)
      || extractNumber(text, /(?:بعد\s+(?:أول\s+)?6\s+أشهر[\s\S]{0,80}?)([0-9][0-9,.]*)\s*ريال\s*شهري/)
    : null;
  const phone = normalizeSaudiPhone(matchOne(text, /((?:\+?966|0)?5[0-9]{8})/));

  const fields = normalizeOpportunityFields({
    opportunityKind,
    purpose,
    propertyType,
    city,
    district,
    priceOrBudget: purpose === "RENT" ? annualRent : priceOrBudget,
    salePrice: purpose === "SALE" ? priceOrBudget : null,
    annualRent,
    budget: purpose === "PURCHASE" || purpose === "LEASE_REQUEST" ? priceOrBudget : null,
    optionalMonthlyRentAfterSixMonths,
    paymentInstallments,
    area,
    rooms,
    bathrooms,
    floorNumber,
    advertiserPhoneNormalized: phone
  });

  const requiredFields = requiredOpportunityFieldsFor(fields);
  const filled = requiredFields.filter((key) => {
    const value = fields[key];
    return value !== null && value !== undefined && String(value).trim() !== "";
  }).length;
  const confidence = Math.round((filled / requiredFields.length) * 100);

  return {
    extractionMode: meta.label,
    extractionProvider: "iaqar.deterministic_text_parser",
    productionAi: false,
    productionExtraction: true,
    extractionConfidence: confidence,
    fields,
    rawHints: { sourceType: meta.sourceType, textLength: text.length, lowerHost: lower.slice(0, 40) }
  };
}

function matchOne(text, re) {
  const m = text.match(re);
  if (!m) return "";
  return safeText(m[1] || m[0], 80);
}

function extractNumber(text, re) {
  const m = text.match(re);
  if (!m) return null;
  const n = Number(String(m[1]).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function extractInstallmentCount(text) {
  const numeric = extractNumber(text, /(?:على|بواقع)\s*([0-9]{1,2})\s*دفعات?/)
    || extractNumber(text, /عدد\s*الدفعات\s*[:：]?\s*([0-9]{1,2})/);
  if (numeric != null) return numeric;
  if (/دفعتين|دفعتان/.test(text)) return 2;
  if (/ثلاث\s+دفعات/.test(text)) return 3;
  if (/أربع\s+دفعات|اربع\s+دفعات/.test(text)) return 4;
  if (/دفعة\s+واحدة/.test(text)) return 1;
  return null;
}

function extractFloorNumber(text) {
  const numeric = extractNumber(text, /(?:الدور|الطابق)\s*(?:رقم\s*)?([0-9]{1,2})/);
  if (numeric != null) return numeric;
  const ordinals = [
    [/الدور\s+(?:الأول|الاول)|الطابق\s+(?:الأول|الاول)/, 1],
    [/الدور\s+الثاني|الطابق\s+الثاني/, 2],
    [/الدور\s+الثالث|الطابق\s+الثالث/, 3],
    [/الدور\s+الرابع|الطابق\s+الرابع/, 4]
  ];
  return ordinals.find(([expression]) => expression.test(text))?.[1] ?? null;
}

function normalizeSaudiPhone(value) {
  const digits = normalizeDigits(value).replace(/\D/g, "");
  if (/^05[0-9]{8}$/.test(digits)) return `+966${digits.slice(1)}`;
  if (/^5[0-9]{8}$/.test(digits)) return `+966${digits}`;
  if (/^9665[0-9]{8}$/.test(digits)) return `+${digits}`;
  return "";
}

export function listMissingFields(fields) {
  const normalized = normalizeOpportunityFields(fields);
  return requiredOpportunityFieldsFor(normalized).filter((key) => {
    const value = normalized[key];
    return value === null || value === undefined || String(value).trim() === "";
  });
}

export function computeDataCompleteness(fields) {
  const normalized = normalizeOpportunityFields(fields);
  const requiredFields = requiredOpportunityFieldsFor(normalized);
  const missing = listMissingFields(normalized);
  const filled = requiredFields.length - missing.length;
  return {
    missingFields: missing,
    dataCompleteness: Math.round((filled / requiredFields.length) * 100),
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
  const normalizedFields = normalizeOpportunityFields(fields);
  const completeness = computeDataCompleteness(normalizedFields);
  const internalStatus = completeness.isComplete ? "READY" : "NEEDS_DATA";
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
    opportunityKind: normalizedFields.opportunityKind,
    purpose: normalizedFields.purpose,
    transactionType: normalizedFields.transactionType,
    propertyType: normalizedFields.propertyType,
    city: normalizedFields.city,
    district: normalizedFields.district,
    salePrice: normalizedFields.salePrice,
    annualRent: normalizedFields.annualRent,
    monthlyRent: normalizedFields.monthlyRent,
    optionalMonthlyRentAfterSixMonths: normalizedFields.optionalMonthlyRentAfterSixMonths,
    paymentInstallments: normalizedFields.paymentInstallments,
    budget: normalizedFields.budget,
    priceOrBudget: normalizedFields.priceOrBudget,
    price: normalizedFields.priceOrBudget,
    area: normalizedFields.area,
    rooms: isLandProperty(normalizedFields.propertyType) ? null : normalizedFields.rooms,
    bathrooms: isLandProperty(normalizedFields.propertyType) ? null : normalizedFields.bathrooms,
    floorNumber: isLandProperty(normalizedFields.propertyType) ? null : normalizedFields.floorNumber,
    advertiserPhoneNormalized: normalizedFields.advertiserPhoneNormalized,
    extractionConfidence: Number(extraction?.extractionConfidence || 0),
    dataCompleteness: completeness.dataCompleteness,
    internalStatus,
    lifecycleStatus: completeness.isComplete ? "ACTIVE" : "ACTIVE",
    deduplicationFingerprint,
    missingFields: completeness.missingFields,
    extractionMode: extraction?.extractionMode || "unavailable",
    extractionProvider: extraction?.extractionProvider || "none",
    productionAi: extraction?.productionAi === true,
    productionExtraction: extraction?.productionExtraction === true,
    cooperationState: "NOT_SHARED",
    cooperationStatus: "NOT_SHARED",
    version: 1,
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
  extractedText = "",
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
    extractedText: safeText(extractedText),
    createdAt: now.toISOString(),
    schemaVersion: 1
  };
}

export function mergeBrokerProvidedFields(baseFields, provided = {}) {
  const normalizedBase = normalizeOpportunityFields(baseFields);
  const providedPurpose = Object.prototype.hasOwnProperty.call(provided, "purpose")
    ? normalizePurpose(provided.purpose)
    : normalizedBase.purpose;
  const purposeChanged = Boolean(
    normalizedBase.purpose
    && providedPurpose
    && normalizedBase.purpose !== providedPurpose
  );
  const next = { ...normalizedBase };
  if (purposeChanged) {
    for (const key of [
      "salePrice",
      "annualRent",
      "monthlyRent",
      "optionalMonthlyRentAfterSixMonths",
      "paymentInstallments",
      "budget",
      "priceOrBudget"
    ]) {
      next[key] = null;
    }
  }
  for (const key of ALL_OPPORTUNITY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(provided, key)) continue;
    if (purposeChanged && !["purpose", "transactionType"].includes(key) && [
      "salePrice",
      "annualRent",
      "monthlyRent",
      "optionalMonthlyRentAfterSixMonths",
      "paymentInstallments",
      "budget",
      "priceOrBudget"
    ].includes(key)) continue;
    next[key] = NUMERIC_OPPORTUNITY_FIELDS.has(key)
      ? nullableNumber(provided[key])
      : safeText(provided[key], 80);
  }
  return normalizeOpportunityFields(next);
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
    sourceType = detectSourceTypeFromText(text);
  }

  if (!SOURCE_TYPES.includes(sourceType)) {
    return { ok: false, state: "failed", error: "لم يتم التعرف على مصدر الفرصة", retryable: true };
  }

  if (sourceType === "url") {
    url = normalizeUrl(text || input.url);
    if (!url) {
      return { ok: false, state: "failed", error: "الرابط غير صالح", retryable: true };
    }
    text = url;
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
    contentType,
    mediaPath
  });

  const extractedFields = extraction?.fields;
  const hasRealFields = extractedFields
    && typeof extractedFields === "object"
    && !Array.isArray(extractedFields)
    && Object.values(extractedFields).some((value) =>
      value !== null && value !== undefined && String(value).trim() !== ""
    );
  if (!hasRealFields) {
    return {
      ok: false,
      state: "failed",
      error: "تعذر إكمال تحليل الإعلان. حاول مرة أخرى.",
      retryable: true
    };
  }

  let fields = normalizeOpportunityFields(extractedFields);
  if (input.brokerFields) fields = mergeBrokerProvidedFields(fields, input.brokerFields);

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
    byteSize,
    extractedText: extraction.extractedText
  });

  if (input.requireReview || (!completeness.isComplete && !input.allowIncomplete)) {
    return {
      ok: true,
      state: input.requireReview ? "review" : "missing_information",
      missingFields: completeness.missingFields,
      fields,
      extraction,
      source,
      deduplicationFingerprint: fingerprint,
      productionAi: extraction.productionAi === true,
      productionExtraction: extraction.productionExtraction === true
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
    extraction,
    missingFields: completeness.missingFields,
    deduplicationFingerprint: fingerprint,
    createsOperation: false,
    runsMatching: false,
    productionAi: extraction.productionAi === true,
    productionExtraction: extraction.productionExtraction === true
  };
}

export function completeOpportunityIntake(prepared, brokerFields = {}) {
  if (
    !prepared?.ok
    || !["review", "missing_information"].includes(prepared.state)
    || !prepared.source
    || !prepared.extraction
  ) {
    throw new Error("prepared_intake_required");
  }
  const fields = mergeBrokerProvidedFields(prepared.fields, brokerFields);
  const completeness = computeDataCompleteness(fields);
  if (!completeness.isComplete) {
    return {
      ...prepared,
      state: prepared.state === "review" ? "review" : "missing_information",
      fields,
      missingFields: completeness.missingFields
    };
  }
  const opportunity = buildOpportunityRecord({
    officeId: prepared.source.officeId,
    brokerId: prepared.source.brokerId,
    sourceType: prepared.source.sourceType,
    sourceReference: prepared.source.id,
    fields,
    extraction: prepared.extraction,
    deduplicationFingerprint: prepared.deduplicationFingerprint
  });
  return {
    ok: true,
    state: "saved",
    opportunity,
    source: prepared.source,
    extraction: prepared.extraction,
    missingFields: [],
    deduplicationFingerprint: prepared.deduplicationFingerprint,
    createsOperation: false,
    runsMatching: false,
    productionAi: prepared.extraction.productionAi === true,
    productionExtraction: prepared.extraction.productionExtraction === true
  };
}
