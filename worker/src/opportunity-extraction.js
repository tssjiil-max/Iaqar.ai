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
  "area"
]);

export function requiredExtractedFieldsFor(fields = {}) {
  const required = [...REQUIRED_EXTRACTED_FIELDS];
  if (fields.purpose === "SALE") required.push("salePrice");
  else if (fields.purpose === "RENT") required.push("annualRent");
  else if (fields.purpose === "PURCHASE" || fields.purpose === "LEASE_REQUEST") required.push("budget");
  if (!/أرض|ارض/.test(String(fields.propertyType || ""))) required.push("rooms");
  return required;
}

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
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

const ARABIC_NUMBER_VALUES = Object.freeze({
  صفر: 0,
  واحد: 1,
  واحدة: 1,
  أحد: 1,
  احد: 1,
  اثنان: 2,
  اثنين: 2,
  اثنتان: 2,
  اثنتين: 2,
  ثلاثة: 3,
  ثلاث: 3,
  أربعة: 4,
  اربعة: 4,
  أربع: 4,
  اربع: 4,
  خمسة: 5,
  خمس: 5,
  ستة: 6,
  ست: 6,
  سبعة: 7,
  سبع: 7,
  ثمانية: 8,
  ثمان: 8,
  تسعة: 9,
  تسع: 9,
  عشرة: 10,
  عشر: 10,
  أحدعشر: 11,
  احدعشر: 11,
  اثناعشر: 12,
  اثنيعشر: 12,
  عشرون: 20,
  عشرين: 20,
  ثلاثون: 30,
  ثلاثين: 30,
  أربعون: 40,
  اربعون: 40,
  أربعين: 40,
  اربعين: 40,
  خمسون: 50,
  خمسين: 50,
  ستون: 60,
  ستين: 60,
  سبعون: 70,
  سبعين: 70,
  ثمانون: 80,
  ثمانين: 80,
  تسعون: 90,
  تسعين: 90,
  مئة: 100,
  مائة: 100,
  مئه: 100,
  مائه: 100,
  مئتان: 200,
  مائتان: 200,
  مئتين: 200,
  مائتين: 200,
  ثلاثمئة: 300,
  ثلاثمائة: 300,
  أربعمئة: 400,
  اربعمئة: 400,
  أربعمائة: 400,
  اربعمائة: 400,
  خمسمئة: 500,
  خمسمائة: 500,
  ستمئة: 600,
  ستمائة: 600,
  سبعمئة: 700,
  سبعمائة: 700,
  ثمانمئة: 800,
  ثمانمائة: 800,
  تسعمئة: 900,
  تسعمائة: 900
});

const ARABIC_NUMBER_SCALES = Object.freeze({
  ألف: 1_000,
  الف: 1_000,
  آلاف: 1_000,
  الاف: 1_000,
  مليون: 1_000_000,
  مليونان: 1_000_000,
  مليونين: 1_000_000,
  ملايين: 1_000_000
});

function normalizedNumberToken(token) {
  const normalized = String(token || "")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[^\u0621-\u064A]/g, "");
  if (ARABIC_NUMBER_VALUES[normalized] !== undefined || ARABIC_NUMBER_SCALES[normalized]) {
    return normalized;
  }
  if (normalized.startsWith("و")) {
    const withoutConjunction = normalized.slice(1);
    if (ARABIC_NUMBER_VALUES[withoutConjunction] !== undefined || ARABIC_NUMBER_SCALES[withoutConjunction]) {
      return withoutConjunction;
    }
  }
  return "";
}

export function parseArabicNumberWords(value) {
  let total = 0;
  let current = 0;
  let recognized = 0;
  for (const rawToken of String(value || "").split(/\s+/)) {
    const token = normalizedNumberToken(rawToken);
    if (!token) continue;
    recognized += 1;
    const scale = ARABIC_NUMBER_SCALES[token];
    if (scale) {
      total += (current || 1) * scale;
      current = 0;
    } else {
      current += ARABIC_NUMBER_VALUES[token];
    }
  }
  return recognized ? total + current : null;
}

function arabicWordsNear(text, expression) {
  const match = text.match(expression);
  return match ? parseArabicNumberWords(match[1]) : null;
}

function scaledMoney(text) {
  const labelled = text.match(
    /(?:السعر|سعر|الميزانية|ميزانية|المطلوب|بحدود|بـ)\s*[:：]?\s*([0-9][0-9,.]*)\s*(مليون|ملايين|ألف|الف)?/i
  );
  const fallback = text.match(/([0-9][0-9,.]*)\s*(مليون|ملايين|ألف|الف|ريال)/i);
  const match = labelled || fallback;
  if (match) {
    const base = numericValue(match[1]);
    const unit = match[2] || "";
    if (base != null && /مليون|ملايين/.test(unit)) return Math.round(base * 1_000_000);
    if (base != null && /ألف|الف/.test(unit)) return Math.round(base * 1_000);
    if (base != null && base >= 1000) return Math.round(base);
  }
  return arabicWordsNear(
    text,
    /(?:السعر|سعر|الميزانية|ميزانية|المطلوب|بحدود)\s*[:：]?\s*([\u0621-\u064A\s]+?)(?:ريال|ر\.?\s?س|$)/i
  );
}

function optionalMonthlyRent(text) {
  const patterns = [
    /بعد\s+(?:أول\s+)?6\s+أشهر[\s\S]{0,100}?شهري[^\s0-9]{0,3}\s*(?:بـ|ب)?\s*([0-9][0-9,.]*)/i,
    /بعد\s+(?:أول\s+)?ستة\s+أشهر[\s\S]{0,100}?شهري[^\s0-9]{0,3}\s*(?:بـ|ب)?\s*([0-9][0-9,.]*)/i,
    /بعد\s+(?:أول\s+)?6\s+أشهر[\s\S]{0,100}?([0-9][0-9,.]*)\s*(?:ريال)?\s*شهري/i
  ];
  for (const pattern of patterns) {
    const value = numericValue(firstMatch(text, pattern));
    if (value != null) return value;
  }
  return null;
}

function annualRentValue(text) {
  const labelled = numericValue(
    firstMatch(text, /(?:الإيجار\s+السنوي|سنوي[ًاا]?)\s*[:：]?\s*([0-9][0-9,.]*)/i)
  );
  if (labelled != null) return labelled;
  return numericValue(
    firstMatch(text, /([0-9][0-9,.]*)\s*(?:ريال|ر\.?\s?س)?\s*سنوي[ًاا]?/i)
  );
}

function installmentCount(text) {
  const numeric = numericValue(
    firstMatch(text, /(?:على|بواقع)\s*([0-9]{1,2})\s*دفعات?/)
      || firstMatch(text, /عدد\s*الدفعات\s*[:：]?\s*([0-9]{1,2})/)
  );
  if (numeric != null) return numeric;
  if (/دفعتين|دفعتان/.test(text)) return 2;
  if (/ثلاث\s+دفعات/.test(text)) return 3;
  if (/أربع\s+دفعات|اربع\s+دفعات/.test(text)) return 4;
  if (/دفعة\s+واحدة/.test(text)) return 1;
  return null;
}

function floorNumber(text) {
  const numeric = numericValue(firstMatch(text, /(?:الدور|الطابق)\s*(?:رقم\s*)?([0-9]{1,2})/));
  if (numeric != null) return numeric;
  const ordinals = [
    [/(?:الدور|الطابق)\s+(?:الأول|الاول)/, 1],
    [/(?:الدور|الطابق)\s+الثاني/, 2],
    [/(?:الدور|الطابق)\s+الثالث/, 3],
    [/(?:الدور|الطابق)\s+الرابع/, 4]
  ];
  return ordinals.find(([expression]) => expression.test(text))?.[1] ?? null;
}

function normalizeAdvertiserPhone(value) {
  const digits = normalizeExtractionDigits(value).replace(/\D/g, "");
  if (/^05[0-9]{8}$/.test(digits)) return `+966${digits.slice(1)}`;
  if (/^5[0-9]{8}$/.test(digits)) return `+966${digits}`;
  if (/^9665[0-9]{8}$/.test(digits)) return `+${digits}`;
  return "";
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
    /(فيلا|دوبلكس|منزل|بيت شعبي|بيت|شقة|(?<!ال)دور|أرض سكنية|أرض تجارية|أرض|ارض|عمارة|مكتب|محل|مستودع|استراحة|مزرعة|قصر|مجمع سكني|مجمع تجاري)/
  );
  const city = firstMatch(
    text,
    /(المدينة المنورة|الرياض|جدة|الدمام|مكة المكرمة|مكة|الخبر|الطائف|تبوك|أبها)/
  );
  const district = firstMatch(text, /(?:حي|مخطط)\s+([^\s،,؛;:.]{2,40})/)
    || firstMatch(text, /(الرانوناء|السلام|النرجس|الياسمين|الملقا|العارض|العقيق|النخيل|الروضة|الشاطئ|العزيزية|قباء)/);
  const area = numericValue(
    firstMatch(text, /([0-9]{2,6}(?:\.[0-9]+)?)\s*(?:م2|م²|متر(?:\s+مربع)?)/)
      || firstMatch(text, /(?:المساحة|مساحة)\s*[:：]?\s*([0-9]{2,6}(?:\.[0-9]+)?)/)
  ) || arabicWordsNear(
    text,
    /(?:المساحة|مساحة)\s*[:：]?\s*([\u0621-\u064A\s]+?)\s*(?:م2|م²|متر(?:\s+مربع)?)/
  );
  const rooms = numericValue(
    firstMatch(text, /(?:^|[^0-9])([0-9]{1,2})\s*(?:غرف(?:ة| نوم)?|غرفة)/)
      || firstMatch(text, /(?:عدد الغرف|غرف)\s*[:：]?\s*([0-9]{1,2})/)
  ) || arabicWordsNear(
    text,
    /((?:[\u0621-\u064A]+\s+){0,5}[\u0621-\u064A]+)\s+(?:غرف(?:ة| نوم)?|غرفة)/
  );
  const bathrooms = numericValue(
    firstMatch(text, /(?:^|[^0-9])([0-9]{1,2})\s*(?:دورات مياه|دورة مياه|حمامات|حمام)/)
  ) || arabicWordsNear(
    text,
    /((?:[\u0621-\u064A]+\s+){0,5}[\u0621-\u064A]+)\s+(?:دورات مياه|دورة مياه|حمامات|حمام)/
  );
  const priceOrBudget = scaledMoney(text);
  const optionalMonthlyRentAfterSixMonths = purpose === "RENT" ? optionalMonthlyRent(text) : null;
  const salePrice = purpose === "SALE" ? priceOrBudget : null;
  const annualRent = purpose === "RENT" ? (annualRentValue(text) ?? priceOrBudget) : null;
  const budget = purpose === "PURCHASE" || purpose === "LEASE_REQUEST" ? priceOrBudget : null;
  const fields = {
    opportunityKind,
    purpose,
    transactionType: purpose === "SALE"
      ? "بيع"
      : purpose === "PURCHASE"
        ? "شراء"
        : purpose === "RENT"
          ? "إيجار"
          : purpose === "LEASE_REQUEST"
            ? "طلب إيجار"
            : "",
    propertyType,
    city,
    district,
    salePrice,
    annualRent,
    monthlyRent: null,
    optionalMonthlyRentAfterSixMonths,
    paymentInstallments: purpose === "RENT" ? installmentCount(text) : null,
    budget,
    priceOrBudget: purpose === "RENT" ? annualRent : priceOrBudget,
    area,
    rooms,
    bathrooms,
    floorNumber: floorNumber(text),
    advertiserPhoneNormalized: normalizeAdvertiserPhone(
      firstMatch(text, /((?:\+?966|0)?5[0-9]{8})/)
    )
  };
  const requiredFields = requiredExtractedFieldsFor(fields);
  const missingFields = requiredFields.filter((field) => {
    const value = fields[field];
    return value === "" || value === null || value === undefined;
  });
  const recognizedFieldCount = Object.values(fields).filter((value) => {
    return value !== "" && value !== null && value !== undefined;
  }).length;
  return {
    fields,
    missingFields,
    recognizedFieldCount,
    extractionConfidence: Math.round(
      ((requiredFields.length - missingFields.length) / requiredFields.length) * 100
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
  const userText = safeExtractedText(input?.text);
  if (!OPPORTUNITY_EXTRACTION_SOURCE_TYPES.includes(sourceType)) {
    throw new OpportunityExtractionError("unsupported_source_type", 400, "نوع مصدر الفرصة غير مدعوم");
  }

  let extracted;
  if (sourceType === "text") {
    if (!userText) throw new OpportunityExtractionError("source_text_empty", 400, "أدخل نص الفرصة");
    extracted = {
      text: userText,
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
    try {
      extracted = await extractBinaryText({
        sourceType,
        fileName: input.fileName,
        contentType: input.contentType,
        fileBytes: input.fileBytes,
        ai: env?.AI
      });
    } catch (error) {
      if (!userText || error?.code !== "document_no_text") throw error;
      extracted = {
        text: "",
        extractionMode: sourceType === "image" || sourceType === "screenshot"
          ? "production_ocr"
          : "production_document_conversion",
        extractionProvider: "cloudflare.workers_ai.to_markdown",
        productionAi: sourceType === "image" || sourceType === "screenshot"
      };
    }
  }

  const analysisText = sourceType === "text"
    ? extracted.text
    : safeExtractedText([userText, extracted.text].filter(Boolean).join("\n"));
  const parsed = parseExtractedOpportunityText(analysisText);
  if (parsed.recognizedFieldCount === 0) {
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
    extractedText: extracted.text,
    userTextUsed: Boolean(sourceType !== "text" && userText)
  };
}
