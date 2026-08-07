const MAX_EXTRACTED_TEXT = 12000;
const MAX_REMOTE_BYTES = 2 * 1024 * 1024;

export const OPPORTUNITY_EXTRACTION_SOURCE_TYPES = Object.freeze([
  "text",
  "url",
  "image",
  "screenshot",
  "pdf",
  "word",
  "excel",
  "audio"
]);

export const REQUIRED_EXTRACTED_FIELDS = Object.freeze([
  "opportunityKind",
  "purpose",
  "propertyType",
  "city",
  "district",
  "priceOrBudget",
  "area",
  "rooms"
]);

export class OpportunityExtractionError extends Error {
  constructor(code, status, publicMessage) {
    super(publicMessage);
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export function normalizeExtractionDigits(value) {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776));
}

export function safeExtractedText(value, max = MAX_EXTRACTED_TEXT) {
  return normalizeExtractionDigits(value)
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function firstMatch(text, expression, group = 1) {
  const match = text.match(expression);
  return match ? safeExtractedText(match[group] || match[0], 80) : "";
}

function numericValue(value) {
  const normalized = String(value || "").replace(/[,\s]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function scaledMoney(text) {
  const labelled = text.match(
    /(?:السعر|سعر|الميزانية|ميزانية|المطلوب|بحدود|بـ)\s*[:：]?\s*([0-9][0-9,.]*)\s*(مليون|ملايين|ألف|الف)?/i
  );
  const fallback = text.match(/([0-9][0-9,.]*)\s*(مليون|ملايين|ألف|الف|ريال)/i);
  const match = labelled || fallback;
  if (!match) return null;
  const base = numericValue(match[1]);
  if (base == null) return null;
  const unit = match[2] || "";
  if (/مليون|ملايين/.test(unit)) return Math.round(base * 1_000_000);
  if (/ألف|الف/.test(unit)) return Math.round(base * 1_000);
  return base >= 1000 ? Math.round(base) : null;
}

export function parseExtractedOpportunityText(rawText) {
  const text = safeExtractedText(rawText);
  let opportunityKind = "";
  if (/عرض|للبيع|للإيجار|للايجار|أملك|املك|من المالك|مالك مباشر/.test(text)) {
    opportunityKind = "OFFER";
  } else if (/مطلوب|أبحث|ابحث|أريد|اريد|أبي|ابي|شراء|استئجار/.test(text)) {
    opportunityKind = "REQUEST";
  }

  let purpose = "";
  if (/للإيجار|للايجار|إيجار|ايجار|استئجار/.test(text)) {
    purpose = opportunityKind === "REQUEST" ? "LEASE_REQUEST" : "RENT";
  } else if (/شراء|أشتري|اشتري|مشتري/.test(text)) {
    purpose = "PURCHASE";
  } else if (/بيع|للبيع/.test(text)) {
    purpose = "SALE";
  }

  const propertyType = firstMatch(
    text,
    /(فيلا|دوبلكس|منزل|بيت شعبي|بيت|شقة|دور|أرض سكنية|أرض تجارية|أرض|ارض|عمارة|مكتب|محل|مستودع|استراحة|مزرعة|قصر|مجمع سكني|مجمع تجاري)/
  );
  const city = firstMatch(
    text,
    /(المدينة المنورة|الرياض|جدة|الدمام|مكة المكرمة|مكة|الخبر|الطائف|تبوك|أبها)/
  );
  const district = firstMatch(text, /حي\s+([^\s،,؛;:.]{2,40})/)
    || firstMatch(text, /(النرجس|الياسمين|الملقا|العارض|العقيق|النخيل|الروضة|الشاطئ|العزيزية|قباء)/);
  const area = numericValue(
    firstMatch(text, /([0-9]{2,6}(?:\.[0-9]+)?)\s*(?:م2|م²|متر(?:\s+مربع)?)/)
      || firstMatch(text, /(?:المساحة|مساحة)\s*[:：]?\s*([0-9]{2,6}(?:\.[0-9]+)?)/)
  );
  const rooms = numericValue(
    firstMatch(text, /([0-9]{1,2})\s*(?:غرف(?:ة| نوم)?|غرفة)/)
      || firstMatch(text, /(?:عدد الغرف|غرف)\s*[:：]?\s*([0-9]{1,2})/)
  );
  const priceOrBudget = scaledMoney(text);
  const fields = {
    opportunityKind,
    purpose,
    propertyType,
    city,
    district,
    priceOrBudget,
    area,
    rooms
  };
  const missingFields = REQUIRED_EXTRACTED_FIELDS.filter((field) => {
    const value = fields[field];
    return value === "" || value === null || value === undefined;
  });
  return {
    fields,
    missingFields,
    extractionConfidence: Math.round(
      ((REQUIRED_EXTRACTED_FIELDS.length - missingFields.length) / REQUIRED_EXTRACTED_FIELDS.length) * 100
    )
  };
}

function jsonLdListingText(html) {
  const parts = [];
  const scripts = String(html || "").matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  const allowedKeys = new Set([
    "name",
    "description",
    "addressLocality",
    "addressRegion",
    "streetAddress",
    "price",
    "priceCurrency",
    "floorSize",
    "value",
    "unitText",
    "numberOfRooms"
  ]);
  const visit = (value, key = "", parentKey = "") => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key, parentKey));
      return;
    }
    if (typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey, key);
      return;
    }
    if (!allowedKeys.has(key)) return;
    const label = key === "price"
      ? "السعر"
      : key === "numberOfRooms"
        ? "غرف"
        : key === "value" && parentKey === "floorSize"
          ? "المساحة"
          : "";
    parts.push(`${label} ${String(value)}`.trim());
  };
  for (const match of scripts) {
    try {
      visit(JSON.parse(match[1]));
    } catch {
      // Invalid structured data is ignored; visible page text remains authoritative.
    }
  }
  return parts.join(" ");
}

export function htmlToVisibleText(html) {
  const structured = jsonLdListingText(html);
  return safeExtractedText(
    `${structured}\n${String(html || "")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;|&#34;/gi, "\"")
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#(\d+);/g, (_, code) => {
        const point = Number(code);
        return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : " ";
      })}`
  );
}

export function normalizePublicSourceUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new OpportunityExtractionError("invalid_source_url", 400, "الرابط العقاري غير صالح");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new OpportunityExtractionError("invalid_source_url", 400, "الرابط العقاري غير صالح");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const unsafe = host === "localhost"
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host === "0.0.0.0"
    || host === "::1"
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^169\.254\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)
    || /^fc|^fd|^fe80:/i.test(host);
  if (unsafe) {
    throw new OpportunityExtractionError("unsafe_source_url", 400, "لا يمكن تحليل رابط داخلي أو خاص");
  }
  url.hash = "";
  return url.toString();
}

function robotsDisallows(robotsText, pathname) {
  const lines = String(robotsText || "").split(/\r?\n/);
  let applies = false;
  const disallowed = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      applies = value === "*" || value.toLowerCase() === "iaqarbot";
    } else if (applies && key === "disallow" && value) {
      disallowed.push(value);
    }
  }
  return disallowed.some((prefix) => pathname.startsWith(prefix));
}

async function fetchWithSafeRedirects(url, options, fetchImpl) {
  let current = normalizePublicSourceUrl(url);
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const response = await fetchImpl(current, { ...options, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }
    const location = response.headers.get("location");
    if (!location) return response;
    current = normalizePublicSourceUrl(new URL(location, current).toString());
  }
  throw new OpportunityExtractionError("source_url_redirect_loop", 422, "تجاوز الرابط عدد التحويلات المسموح");
}

async function fetchPublicUrlText(sourceUrl, fetchImpl) {
  const normalized = normalizePublicSourceUrl(sourceUrl);
  const url = new URL(normalized);
  const requestHeaders = {
    Accept: "text/markdown, text/html;q=0.9, text/plain;q=0.8",
    "User-Agent": "IAQARBot/1.0 (+https://iaqar.ai)"
  };
  const robotsResponse = await fetchWithSafeRedirects(new URL("/robots.txt", url.origin), {
    headers: requestHeaders,
    signal: AbortSignal.timeout(10_000)
  }, fetchImpl).catch(() => null);
  if (robotsResponse?.ok) {
    const robots = await robotsResponse.text();
    if (robotsDisallows(robots, url.pathname)) {
      throw new OpportunityExtractionError(
        "source_url_disallowed",
        422,
        "الموقع يمنع قراءة هذا الرابط آليًا"
      );
    }
  } else if (robotsResponse && [401, 403].includes(robotsResponse.status)) {
    throw new OpportunityExtractionError(
      "source_url_disallowed",
      422,
      "الموقع يمنع قراءة هذا الرابط آليًا"
    );
  } else if (robotsResponse && robotsResponse.status >= 500) {
    throw new OpportunityExtractionError(
      "source_url_temporarily_unavailable",
      502,
      "تعذر التحقق من سماح الموقع بقراءة الرابط"
    );
  }

  let response;
  try {
    response = await fetchWithSafeRedirects(normalized, {
      headers: requestHeaders,
      signal: AbortSignal.timeout(20_000)
    }, fetchImpl);
  } catch {
    throw new OpportunityExtractionError(
      "source_url_fetch_failed",
      422,
      "تعذر فتح الرابط العقاري أو انتهت مهلة الاتصال"
    );
  }
  if (!response.ok) {
    throw new OpportunityExtractionError(
      "source_url_fetch_failed",
      422,
      `تعذر فتح الرابط العقاري (HTTP ${response.status})`
    );
  }
  normalizePublicSourceUrl(response.url || normalized);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_REMOTE_BYTES) {
    throw new OpportunityExtractionError("source_url_too_large", 413, "محتوى الرابط أكبر من الحد المسموح");
  }
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!/(text\/html|text\/plain|text\/markdown|application\/xhtml\+xml)/.test(contentType)) {
    throw new OpportunityExtractionError("source_url_unsupported", 415, "الرابط لا يعيد صفحة نصية قابلة للتحليل");
  }
  const raw = (await response.text()).slice(0, MAX_REMOTE_BYTES);
  const text = /html|xhtml/.test(contentType) ? htmlToVisibleText(raw) : safeExtractedText(raw);
  if (text.length < 8) {
    throw new OpportunityExtractionError(
      "source_url_no_content",
      422,
      "لم يعرض الرابط نصًا عقاريًا قابلًا للاستخراج"
    );
  }
  return text;
}

function markdownData(result) {
  const item = Array.isArray(result) ? result[0] : result;
  return safeExtractedText(item?.data || item?.markdown || item?.text || "");
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function extractBinaryText({ sourceType, fileName, contentType, fileBytes, ai }) {
  const requiredMethod = sourceType === "audio" ? "run" : "toMarkdown";
  if (!ai || typeof ai[requiredMethod] !== "function") {
    throw new OpportunityExtractionError(
      "production_extraction_unavailable",
      503,
      "خدمة التحليل الفعلي غير متاحة حاليًا؛ حاول مرة أخرى لاحقًا"
    );
  }
  if (sourceType === "audio") {
    let response;
    try {
      response = await ai.run("@cf/openai/whisper-large-v3-turbo", {
        audio: bytesToBase64(fileBytes),
        task: "transcribe",
        language: "ar",
        vad_filter: true,
        condition_on_previous_text: false
      });
    } catch {
      throw new OpportunityExtractionError(
        "audio_transcription_failed",
        502,
        "تعذر تحويل الملف الصوتي إلى نص عربي؛ تحقق من وضوح الصوت وصيغته"
      );
    }
    const transcript = safeExtractedText(response?.text || response?.transcription || "");
    if (!transcript) {
      throw new OpportunityExtractionError(
        "audio_no_speech",
        422,
        "لم يتم التعرف على كلام عربي واضح في الملف الصوتي"
      );
    }
    return {
      text: transcript,
      extractionMode: "production_asr",
      extractionProvider: "cloudflare.workers_ai.whisper-large-v3-turbo",
      productionAi: true
    };
  }

  let converted;
  try {
    converted = await ai.toMarkdown({
      name: fileName || `opportunity.${sourceType}`,
      blob: new Blob([fileBytes], { type: contentType || "application/octet-stream" })
    });
  } catch {
    throw new OpportunityExtractionError(
      "document_conversion_failed",
      502,
      sourceType === "image" || sourceType === "screenshot"
        ? "تعذر قراءة الصورة؛ تحقق من وضوحها وصيغتها"
        : "تعذر قراءة المستند؛ تحقق من أن الملف غير تالف وصيغته مدعومة"
    );
  }
  const text = markdownData(converted);
  if (!text) {
    const label = sourceType === "image" || sourceType === "screenshot" ? "الصورة" : "المستند";
    throw new OpportunityExtractionError(
      "document_no_text",
      422,
      `لم يتم العثور على نص عقاري واضح داخل ${label}`
    );
  }
  return {
    text,
    extractionMode: sourceType === "image" || sourceType === "screenshot"
      ? "production_ocr"
      : "production_document_conversion",
    extractionProvider: "cloudflare.workers_ai.to_markdown",
    productionAi: sourceType === "image" || sourceType === "screenshot"
  };
}

export async function extractOpportunitySource(input, env, dependencies = {}) {
  const sourceType = String(input?.sourceType || "").toLowerCase();
  if (!OPPORTUNITY_EXTRACTION_SOURCE_TYPES.includes(sourceType)) {
    throw new OpportunityExtractionError("unsupported_source_type", 400, "نوع مصدر الفرصة غير مدعوم");
  }

  let extracted;
  if (sourceType === "text") {
    const text = safeExtractedText(input.text);
    if (!text) throw new OpportunityExtractionError("source_text_empty", 400, "أدخل نص الفرصة");
    extracted = {
      text,
      extractionMode: "deterministic_text_parser",
      extractionProvider: "iaqar.deterministic_arabic_parser",
      productionAi: false
    };
  } else if (sourceType === "url") {
    extracted = {
      text: await fetchPublicUrlText(input.url || input.text, dependencies.fetchImpl || fetch),
      extractionMode: "public_url_content",
      extractionProvider: "iaqar.authorized_http_content",
      productionAi: false
    };
  } else {
    if (!(input.fileBytes instanceof Uint8Array) || input.fileBytes.byteLength === 0) {
      throw new OpportunityExtractionError("source_file_empty", 400, "الملف المرفق فارغ");
    }
    extracted = await extractBinaryText({
      sourceType,
      fileName: input.fileName,
      contentType: input.contentType,
      fileBytes: input.fileBytes,
      ai: env?.AI
    });
  }

  const parsed = parseExtractedOpportunityText(extracted.text);
  if (parsed.missingFields.length === REQUIRED_EXTRACTED_FIELDS.length) {
    throw new OpportunityExtractionError(
      "no_property_data_found",
      422,
      "لم يتم العثور على بيانات عقارية واضحة في المصدر المرسل"
    );
  }
  return {
    ...extracted,
    ...parsed,
    productionExtraction: true,
    extractedText: extracted.text
  };
}
