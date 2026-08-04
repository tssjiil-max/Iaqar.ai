/**
 * Phase 2 — Unified Opportunity Intake domain.
 *
 * Deterministic detection, normalization, simulated/deterministic extraction,
 * missing-field tracking, and deduplication. No production AI is claimed here.
 */

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
    matchOne(text, /(فيلا|منزل|بيت|شقة|دور|أرض|ارض|عمارة|مكتب|محل|مستودع|استراحة)/) || "";

  const city =
    matchOne(text, /(الرياض|جدة|المدينة المنورة|المدينة|الدمام|مكة|الخبر|الطائف|تبوك|أبها)/) || "";

  const district =
    matchOne(text, /حي\s+([^\s،,]{2,40})/) ||
    matchOne(text, /(النرجس|الياسمين|الملقا|العارض|العقيق|النخيل|الروضة|الشاطئ)/) ||
    "";

  const priceOrBudget = extractNumber(text, /(?:سعر|بميزانية|ميزانية|بـ|ب)\s*([0-9][0-9,\.]{2,})/i) ||
    extractNumber(text, /([0-9][0-9,\.]{3,})\s*(?:ألف|الف|مليون)?/);

  const area = extractNumber(text, /([0-9]{2,5})\s*(?:م2|م²|متر)/);
  const rooms = extractNumber(text, /([0-9]{1,2})\s*(?:غرف|غرفة|غرف نوم)/);

  const filled = countFilled({
    opportunityKind, purpose, propertyType, city, district, priceOrBudget, area, rooms
  });
  const confidence = Math.round((filled / REQUIRED_OPPORTUNITY_FIELDS.length) * 100);

  return {
    extractionMode: meta.label,
    extractionProvider: "iaqar.deterministic_text_parser",
    productionAi: false,
    extractionConfidence: confidence,
    fields: {
      opportunityKind,
      purpose,
      propertyType,
      city,
      district,
      priceOrBudget: priceOrBudget || null,
      area: area || null,
      rooms: rooms || null
    },
    rawHints: { sourceType: meta.sourceType, textLength: text.length, lowerHost: lower.slice(0, 40) }
  };
}

function extractFromSimulatedAttachment(input, meta) {
  // Deterministic fixture keyed by source type — partial fields only.
  const fixtures = {
    image: { propertyType: "شقة", city: "", district: "", opportunityKind: "", purpose: "" },
    screenshot: { propertyType: "", city: "الرياض", district: "", opportunityKind: "", purpose: "" },
    pdf: { propertyType: "فيلا", city: "", district: "", opportunityKind: "OFFER", purpose: "" },
    word: { propertyType: "", city: "", district: "", opportunityKind: "REQUEST", purpose: "PURCHASE" },
    excel: { propertyType: "أرض", city: "الرياض", district: "", opportunityKind: "OFFER", purpose: "SALE" },
    audio: { propertyType: "", city: "", district: "", opportunityKind: "", purpose: "RENT" }
  };
  const base = fixtures[input.sourceType] || {};
  const fields = {
    opportunityKind: base.opportunityKind || "",
    purpose: base.purpose || "",
    propertyType: base.propertyType || "",
    city: base.city || "",
    district: base.district || "",
    priceOrBudget: null,
    area: null,
    rooms: null
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

function countFilled(fields) {
  return REQUIRED_OPPORTUNITY_FIELDS.filter((key) => {
    const value = fields[key];
    return value !== null && value !== undefined && String(value).trim() !== "";
  }).length;
}

export function listMissingFields(fields) {
  return REQUIRED_OPPORTUNITY_FIELDS.filter((key) => {
    const value = fields?.[key];
    return value === null || value === undefined || String(value).trim() === "";
  });
}

export function computeDataCompleteness(fields) {
  const missing = listMissingFields(fields);
  const filled = REQUIRED_OPPORTUNITY_FIELDS.length - missing.length;
  return {
    missingFields: missing,
    dataCompleteness: Math.round((filled / REQUIRED_OPPORTUNITY_FIELDS.length) * 100),
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
  const completeness = computeDataCompleteness(fields);
  const internalStatus = completeness.isComplete ? "READY" : "NEEDS_DATA";
  const id = existingId || opportunityDocumentId(deduplicationFingerprint);
  const timestamp = now.toISOString();

  return {
    id,
    officeId: safeText(officeId, 80),
    brokerId: safeText(brokerId, 120),
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceType,
    sourceReference: safeText(sourceReference, 500),
    opportunityKind: safeText(fields.opportunityKind, 20),
    purpose: safeText(fields.purpose, 20),
    propertyType: safeText(fields.propertyType, 40),
    city: safeText(fields.city, 80),
    district: safeText(fields.district, 80),
    priceOrBudget: fields.priceOrBudget == null || fields.priceOrBudget === ""
      ? null
      : Number(fields.priceOrBudget),
    area: fields.area == null || fields.area === "" ? null : Number(fields.area),
    rooms: fields.rooms == null || fields.rooms === "" ? null : Number(fields.rooms),
    extractionConfidence: Number(extraction?.extractionConfidence || 0),
    dataCompleteness: completeness.dataCompleteness,
    internalStatus,
    deduplicationFingerprint,
    missingFields: completeness.missingFields,
    extractionMode: extraction?.extractionMode || "simulated_fixture",
    extractionProvider: extraction?.extractionProvider || "iaqar.simulated_fixture",
    productionAi: false,
    cooperationState: "NOT_SHARED",
    // Legacy projection helpers used by the Opportunity Bank list.
    recordType: fields.opportunityKind === "OFFER" ? "owner" : "client",
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
  const next = { ...baseFields };
  for (const key of REQUIRED_OPPORTUNITY_FIELDS) {
    if (provided[key] !== undefined && provided[key] !== null && String(provided[key]).trim() !== "") {
      next[key] = typeof baseFields[key] === "number" || key === "priceOrBudget" || key === "area" || key === "rooms"
        ? (Number(provided[key]) || provided[key])
        : safeText(provided[key], 80);
    }
  }
  return next;
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
    contentType
  });

  let fields = { ...extraction.fields };
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
    extraction,
    missingFields: completeness.missingFields,
    deduplicationFingerprint: fingerprint,
    createsOperation: false,
    runsMatching: false,
    productionAi: false
  };
}
