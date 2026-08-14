/**
 * Central Arabic monetary magnitude normalization (ألف / مليون / مليار).
 * Used by text, image, and voice extraction paths — do not duplicate parsers elsewhere.
 */

export function normalizeArabicDigits(value) {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776));
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
  ملايين: 1_000_000,
  مليار: 1_000_000_000,
  مليارات: 1_000_000_000
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

function parseNumericToken(token) {
  const digits = normalizeArabicDigits(token).replace(/[,\s\u066C]/g, "");
  if (digits && /^\d+(?:\.\d+)?$/.test(digits)) {
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  }
  return parseArabicNumberWords(token);
}

export function applyMagnitude(base, unit = "") {
  if (base == null || !Number.isFinite(base)) return null;
  const u = String(unit || "");
  if (/مليار|مليارات/.test(u)) return Math.round(base * 1_000_000_000);
  if (/مليون|ملايين/.test(u)) return Math.round(base * 1_000_000);
  if (/ألف|الف|الاف|آلاف/.test(u)) return Math.round(base * 1_000);
  return Math.round(base);
}

export function parseArabicMagnitudePhrase(phrase) {
  const text = normalizeArabicDigits(String(phrase || "")).trim();
  if (!text) return null;

  const compound = text.match(
    /(\d+(?:\.\d+)?|[\u0621-\u064A]+(?:\s+[\u0621-\u064A]+)*)?\s*(مليون|ملايين|مليار|مليارات)\s*(?:و\s*)?(\d+(?:\.\d+)?|[\u0621-\u064A]+)?\s*(ألف|الف|الاف|آلاف|ونصف|نصف)?/i
  );
  if (compound) {
    const base = compound[1]
      ? parseNumericToken(compound[1])
      : (/نصف|ونصف/.test(compound[0]) ? 0.5 : 1);
    let total = applyMagnitude(base, compound[2]);
    if (compound[3]) {
      const extra = parseNumericToken(compound[3]);
      if (extra != null) total += applyMagnitude(extra, compound[4] || "");
    }
    if (/نصف|ونصف/.test(compound[0]) && !compound[3] && total != null) {
      total += Math.round(0.5 * applyMagnitude(1, compound[2]));
    }
    if (total != null && total > 0) return total;
  }

  const thousand = text.match(
    /(\d+(?:\.\d+)?|[\u0621-\u064A]+(?:\s+[\u0621-\u064A]+)*)\s*(ألف|الف|الاف|آلاف)/i
  );
  if (thousand) {
    const base = parseNumericToken(thousand[1]);
    const total = applyMagnitude(base, thousand[2]);
    if (total != null && total > 0) return total;
  }

  const millionOnly = text.match(/^مليون$/i);
  if (millionOnly) return 1_000_000;

  const plain = Number(normalizeArabicDigits(text).replace(/[,\s\u066C]/g, ""));
  return Number.isFinite(plain) ? plain : null;
}

const NON_PRICE_CONTEXT = /(?:مساحة|مساحتها|متر\s*مربع|م²|م2|شارع|عرض\s+الشارع|قطعة|رقم\s+القطعة|جوال|هاتف|واتساب|تليفون|مخطط)/i;

const SALE_LABELS = [
  "المطلوب",
  "السعر المطلوب",
  "سعر البيع",
  "السعر",
  "بسعر",
  "سعره"
];

const BUDGET_LABELS = ["الميزانية", "ميزانيتي", "ميزانية", "بحدود", "حد الشراء"];

const RENT_LABELS = ["الإيجار", "إيجار", "ايجار", "الايجار"];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractLabeledAmount(text, labels = []) {
  const hay = normalizeArabicDigits(String(text || ""));
  for (const label of labels) {
    const labelRe = escapeRegExp(label);
    const patterns = [
      new RegExp(`${labelRe}\\s*[:：]?\\s*([\\d][\\d,،\\s\\u066C]*)(?:\\s*(مليون|ملايين|مليار|مليارات|ألف|الف|الاف|آلاف))?`, "i"),
      new RegExp(`${labelRe}\\s*[:：]?\\s*([\\u0621-\\u064A]+(?:\\s+[\\u0621-\\u064A]+)*)\\s*(مليون|ملايين|مليار|مليارات|ألف|الف|الاف|آلاف)`, "i"),
      new RegExp(`${labelRe}\\s*[:：]?\\s*([\\d][\\d,،\\s\\u066C]*)\\s*(?:ريال|ر\\.?\\s?س)`, "i")
    ];
    for (const re of patterns) {
      const match = hay.match(re);
      if (!match) continue;
      if (match[2] && /مليون|مليار|ألف|الف|الاف|آلاف/i.test(match[0])) {
        const base = /[\d\u0660-\u0669]/.test(match[1])
          ? Number(normalizeArabicDigits(match[1]).replace(/[,\s\u066C]/g, ""))
          : parseArabicNumberWords(match[1]);
        const amount = applyMagnitude(base, match[2]);
        if (amount != null && amount > 0) return { amount, evidence: match[0] };
      }
      if (match[1] && /[\d\u0660-\u0669]/.test(match[1])) {
        const amount = Number(normalizeArabicDigits(match[1]).replace(/[,\s\u066C]/g, ""));
        if (Number.isFinite(amount) && amount > 0) return { amount: Math.round(amount), evidence: match[0] };
      }
      if (match[1] && /[\u0621-\u064A]/.test(match[1]) && match[2]) {
        const base = parseArabicNumberWords(match[1]);
        const amount = applyMagnitude(base, match[2]);
        if (amount != null && amount > 0) return { amount, evidence: match[0] };
      }
    }
  }
  return null;
}

export function extractMonetaryAmount(text, options = {}) {
  const hay = normalizeArabicDigits(String(text || ""));
  if (!hay.trim()) return null;

  const labels = options.labels || SALE_LABELS;
  const labeled = extractLabeledAmount(hay, labels);
  if (labeled) return labeled;

  const segments = hay.split(/[\n|،,;]+/);
  for (const segment of segments) {
    if (NON_PRICE_CONTEXT.test(segment) && !/(?:السعر|المطلوب|الميزانية|الإيجار|ميزانيتي)/i.test(segment)) {
      continue;
    }
    const parsed = parseArabicMagnitudePhrase(segment);
    if (parsed != null && parsed >= 1_000) {
      return { amount: parsed, evidence: segment.trim().slice(0, 120) };
    }
  }

  return null;
}

export function extractAnnualRentAmount(text) {
  const hay = normalizeArabicDigits(String(text || ""));
  const annualThousand = hay.match(
    /(\d+(?:\.\d+)?|[\u0621-\u064A]+(?:\s+[\u0621-\u064A]+)*)\s*(ألف|الف|الاف|آلاف)\s*(?:بالسنة|سنوي|سنويا|سنويًا)/i
  );
  if (annualThousand) {
    const base = parseNumericToken(annualThousand[1]);
    const amount = applyMagnitude(base, annualThousand[2]);
    if (amount != null && amount > 0) return { amount, evidence: annualThousand[0] };
  }
  const labeled = extractLabeledAmount(hay, RENT_LABELS);
  if (labeled) return labeled;
  const annualRiyal = hay.match(/(\d[\d,،\s]*)\s*ريال\s*سنوي/i);
  if (annualRiyal) {
    const amount = Number(normalizeArabicDigits(annualRiyal[1]).replace(/[,\s]/g, ""));
    if (Number.isFinite(amount) && amount > 0) return { amount, evidence: annualRiyal[0] };
  }
  return null;
}

export function extractBudgetAmount(text) {
  return extractMonetaryAmount(text, { labels: BUDGET_LABELS });
}

export function normalizeArabicMagnitudeNumber(input, options = {}) {
  const fieldKind = options.fieldKind || "money";
  if (fieldKind !== "money") {
    if (typeof input === "number" && Number.isFinite(input)) return input;
    const plain = Number(normalizeArabicDigits(String(input || "")).replace(/[,\s]/g, ""));
    return Number.isFinite(plain) ? plain : null;
  }
  if (input == null || input === "") return null;
  if (typeof input === "number" && Number.isFinite(input)) {
    if (input >= 10_000) return Math.round(input);
  }
  const text = typeof input === "string" ? input : String(input);
  const fromPhrase = parseArabicMagnitudePhrase(text);
  if (fromPhrase != null && fromPhrase > 0) return fromPhrase;
  const plain = Number(normalizeArabicDigits(text).replace(/[,\s\u066C]/g, ""));
  return Number.isFinite(plain) ? plain : null;
}

export function applyMonetaryNormalization(fields = {}, sourceText = "") {
  const text = String(sourceText || "");
  const out = { ...fields };

  const saleFromText = extractMonetaryAmount(text, { labels: SALE_LABELS });
  if (saleFromText?.amount) {
    out.salePrice = saleFromText.amount;
  } else if (out.salePrice != null) {
    out.salePrice = normalizeArabicMagnitudeNumber(out.salePrice, { fieldKind: "money" });
  }

  const rentFromText = extractAnnualRentAmount(text);
  if (rentFromText?.amount) {
    out.annualRent = rentFromText.amount;
  } else if (out.annualRent != null) {
    out.annualRent = normalizeArabicMagnitudeNumber(out.annualRent, { fieldKind: "money" });
  }

  const budgetFromText = extractBudgetAmount(text);
  if (budgetFromText?.amount) {
    out.budget = budgetFromText.amount;
  } else if (out.budget != null) {
    out.budget = normalizeArabicMagnitudeNumber(out.budget, { fieldKind: "money" });
  }

  if (out.price != null) {
    out.price = normalizeArabicMagnitudeNumber(out.price, { fieldKind: "money" });
  }

  return out;
}
