/**
 * Arabic opportunity text extraction — phrase/context pipeline (not single-keyword matching).
 * Stages: normalize → structured extract (value/evidence/confidence) → validate → resolve conflicts.
 */

import {
  extractAnnualRentAmount,
  extractBudgetAmount,
  extractMonetaryAmount,
  normalizeArabicMagnitudeNumber
} from "./arabic-magnitude.js";

export const CONFIDENCE_AUTO_FILL = 0.85;

export const ACCEPTANCE_FIXTURE_TEXT = `🏡 شقة للإيجار | حي السلام

✨ شقة مجددة بالكامل ونظيفة، مناسبة للعرسان.

🔹 المواصفات:
▪️ 4 غرف
▪️ صالة
▪️ مطبخ
▪️ 3 دورات مياه
▪️ الدور الأول
▪️ مجددة بالكامل ونظيفة

💰 الإيجار:
▪️ 22,000 ريال سنويًا على دفعتين
▪️ بعد أول 6 أشهر يمكن الاستمرار شهريًا بـ 1,850 ريال

💡 الخدمات:
▪️ الماء والصرف الصحي على المؤجر
▪️ الكهرباء على المستأجر
▪️ عداد كهرباء مستقل

⚠️ شروط المالك:
▪️ عريس
▪️ موظف حكومي

📍 حي السلام`;

/** Regression fixture — أرض للبيع في الرانوناء (STAGING URL intake). */
export const RANONA_LAND_REGRESSION_FIXTURE_TEXT = `أرض للبيع
المدينة المنورة
حي الرانوناء
المساحة 431.75 م²
السعر المطلوب 580000 ريال
سعر الوحدة 1390 ريال
جوال: 0507561577
رقم المخطط: 716 / ت / 1416
رقم القطعة: 860 / 2
الواجهة: شرقية
عرض الشارع: 18
العمق: 39.25`;

function makeField(value, evidence = "", confidence = 0) {
  const hasValue = value !== null && value !== undefined && value !== "";
  return {
    value: hasValue ? value : null,
    evidence: String(evidence || "").trim(),
    confidence: Number.isFinite(confidence) ? confidence : 0
  };
}

function emptyField() {
  return makeField(null, "", 0);
}

export function gateField(field) {
  if (!field || field.value == null || field.confidence < CONFIDENCE_AUTO_FILL) {
    return { ...field, value: null, needsReview: true };
  }
  return { ...field, needsReview: false };
}

export function normalizeListingText(raw) {
  let text = String(raw ?? "");
  text = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
  text = text.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
  text = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ");
  text = text.replace(/[▪️🔹✨💰💡⚠️📍🏡]+/g, " ");
  text = text.replace(/\u0640/g, "");
  text = text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n");
  return text.trim();
}

function parseNumberToken(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[،,\s\u066C]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function firstLine(text) {
  return text.split("\n").map((l) => l.trim()).filter(Boolean)[0] || "";
}

function firstSentence(text) {
  const line = firstLine(text);
  const m = line.match(/^[^.!?\n|]+/);
  return (m && m[0].trim()) || line.slice(0, 240);
}

function findPhrase(text, patterns, baseConfidence, sourceLabel) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      return makeField(m.value ?? m[1], m[0], baseConfidence, sourceLabel);
    }
  }
  return null;
}

const FLOOR_LEVEL_PATTERNS = [
  { re: /(?:في|تقع\s+في|بال)\s+الدور\s+الأول/i, num: 1 },
  { re: /(?:في|تقع\s+في|بال)\s+الدور\s+الثاني/i, num: 2 },
  { re: /(?:في|تقع\s+في|بال)\s+الدور\s+الثالث/i, num: 3 },
  { re: /(?:في|تقع\s+في|بال)\s+الدور\s+الرابع/i, num: 4 },
  { re: /بالطابق\s+الأول/i, num: 1 },
  { re: /بالطابق\s+الثاني/i, num: 2 },
  { re: /بالطابق\s+الثالث/i, num: 3 },
  { re: /الطابق\s+الأرضي/i, num: 0, floorPosition: "أرضي" },
  { re: /الدور\s+الأرضي/i, num: 0, floorPosition: "أرضي" },
  { re: /الدور\s+الأول/i, num: 1 },
  { re: /الدور\s+الثاني/i, num: 2 },
  { re: /الدور\s+الثالث/i, num: 3 },
  { re: /الدور\s+الرابع/i, num: 4 }
];

const PROPERTY_PHRASE_RULES = [
  { type: "شقة", patterns: [/شقة\s+للإيجار/i, /شقة\s+للبيع/i, /شقة\s+للايجار/i, /^شقة(?:\s|$)/i, /(?:^|\s)شقة(?:\s|$)/i] },
  { type: "فيلا", patterns: [/فيلا\s+للإيجار/i, /فيلا\s+للبيع/i, /^فيلا(?:\s|$)/i, /فيلا\s+مكونة/i, /(?:^|\s)فيلا(?:\s|$)/i] },
  { type: "أرض", patterns: [/أرض\s+للبيع/i, /للبيع\s+أرض/i, /للبيع\s+ارض/i, /^أرض(?:\s|$)/i, /ارض\s+للبيع/i] },
  { type: "عمارة", patterns: [/عمارة\s+للبيع/i, /^عمارة(?:\s|$)/i, /عمارة\s+مكونة/i] },
  { type: "مستودع", patterns: [/مستودع\s+للإيجار/i, /مستودع\s+للبيع/i, /^مستودع(?:\s|$)/i] },
  { type: "محل", patterns: [/محل\s+للإيجار/i, /محل\s+للبيع/i, /^محل(?:\s|$)/i] },
  { type: "مكتب", patterns: [/مكتب\s+للإيجار/i, /مكتب\s+للبيع/i, /^مكتب(?:\s|$)/i] },
  { type: "استراحة", patterns: [/استراحة\s+للإيجار/i, /^استراحة(?:\s|$)/i] },
  { type: "منزل", patterns: [/منزل\s+للبيع/i, /^منزل(?:\s|$)/i, /^بيت(?:\s|$)/i] }
];

const FLOOR_UNIT_PATTERNS = [
  /دور\s+مستقل\s+للإيجار/i,
  /دور\s+للإيجار/i,
  /دور\s+للبيع/i,
  /دور\s+مستقل/i,
  /مطلوب\s+دور/i,
  /عرض\s+مالك\s*[—\-]\s*دور/i,
  /دور\s+علوي\s+مستقل/i,
  /دور\s+أرضي\s+مستقل/i,
  /مطلوب\s+دور\s+أرضي\s+مستقل/i
];

function extractPropertyTypeCandidates(text, title, firstSent) {
  const candidates = [];
  const sources = [
    { chunk: title, confidence: 0.99, label: "title" },
    { chunk: firstSent, confidence: 0.96, label: "first_sentence" },
    { chunk: text, confidence: 0.88, label: "body" }
  ];

  for (const src of sources) {
    if (!src.chunk) continue;
    for (const rule of PROPERTY_PHRASE_RULES) {
      for (const pat of rule.patterns) {
        const m = src.chunk.match(pat);
        if (m) {
          let label = rule.type;
          if (rule.type === "أرض") {
            const extended = src.chunk.slice(m.index).match(
              /^أرض(?:\s+(?:تجارية|استثمارية|سكنية|زراعية|صناعية|خام|مزرعة|سكنيه|تجاريه|استثماريه))+?/i
            );
            if (extended) label = extended[0].trim();
          }
          candidates.push({
            field: "propertyType",
            ...makeField(label, m[0], src.confidence),
            source: src.label
          });
          break;
        }
      }
    }
    for (const pat of FLOOR_UNIT_PATTERNS) {
      const m = src.chunk.match(pat);
      if (m) {
        candidates.push({
          field: "propertyType",
          ...makeField("دور", m[0], 0.94),
          source: src.label
        });
      }
    }
  }
  return candidates;
}

function pickBestCandidate(candidates) {
  if (!candidates.length) return emptyField();
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const best = sorted[0];
  return makeField(best.value, best.evidence, best.confidence);
}

function extractFloorNumber(text) {
  for (const rule of FLOOR_LEVEL_PATTERNS) {
    const m = text.match(rule.re);
    if (m) {
      const field = makeField(rule.num, m[0], 0.98);
      if (rule.floorPosition) {
        return {
          floorNumber: field,
          floorPosition: makeField(rule.floorPosition, m[0], 0.98)
        };
      }
      return { floorNumber: field, floorPosition: emptyField() };
    }
  }
  const groundUnit = text.match(/دور\s+أرضي\s+مستقل/i);
  if (groundUnit) {
    return {
      floorNumber: makeField(0, groundUnit[0], 0.95),
      floorPosition: makeField("أرضي", groundUnit[0], 0.95)
    };
  }
  return { floorNumber: emptyField(), floorPosition: emptyField() };
}

function extractTransactionType(text, title) {
  const hasRent = /للإيجار|للايجار|إيجار|ايجار|مؤجر/.test(text);
  const hasSale = /للبيع|بيع/.test(text);
  const hasPurchase = /شراء|مطلوب\s+شراء/.test(text);
  if ([hasRent, hasSale, hasPurchase].filter(Boolean).length > 1) {
    return emptyField();
  }
  const sources = [title, text];
  for (const chunk of sources) {
    if (!chunk) continue;
    if (/للإيجار|للايجار|إيجار|ايجار|مؤجر/.test(chunk)) {
      const m = chunk.match(/(?:شقة|فيلا|دور|محل|مكتب|مستودع)?\s*للإيجار|للإيجار/i) || chunk.match(/إيجار|ايجار/i);
      return makeField("إيجار", m ? m[0] : "للإيجار", chunk === title ? 0.99 : 0.94);
    }
    if (/للبيع|بيع/.test(chunk)) {
      const m = chunk.match(/للبيع|بيع/i);
      return makeField("بيع", m ? m[0] : "للبيع", chunk === title ? 0.99 : 0.94);
    }
    if (/شراء|مطلوب\s+شراء/.test(chunk)) {
      const m = chunk.match(/شراء|مطلوب/i);
      return makeField("شراء", m ? m[0] : "شراء", 0.9);
    }
  }
  return emptyField();
}

function cleanExtractedDistrictName(raw) {
  let name = String(raw || "").trim().replace(/\s+/g, " ");
  if (!name) return "";
  // Stop before common listing continuations glued onto one line.
  // Note: JS \\b is Latin-only — do not use it for Arabic tokens.
  name = name.split(
    /\s+(?:المساحة|مساحة|السعر|سعر|للتواصل|رقم|جوال|واتساب|غرفة|غرف|متر|م²|م2|ريال|ألف|الف)(?=\s|$|[0-9])/i
  )[0] || name;
  name = name.replace(/[|،,.:؛]+$/g, "").trim();
  // Keep a short district label (1–4 Arabic tokens), not the rest of the ad.
  const tokens = name.split(/\s+/).filter(Boolean).slice(0, 4);
  return tokens.join(" ").trim();
}

function extractDistrict(text) {
  const ranona = text.match(/(?:في\s+)?(?:حي\s+)?الرانوناء/i);
  if (ranona) {
    return makeField("الرانوناء", ranona[0], 0.96);
  }
  const patterns = [
    /حي\s+([^\n|،,]{2,40})/i,
    /في\s+حي\s+([^\n|،,]{2,40})/i,
    /📍\s*حي\s+([^\n،,]+)/i,
    /\|\s*حي\s+([^\n|،,]+)/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const name = cleanExtractedDistrictName(m[1]);
      if (name) return makeField(name, m[0], 0.95);
    }
  }
  return emptyField();
}

function extractSalePrice(text) {
  const magnitude = extractMonetaryAmount(text);
  if (magnitude?.amount != null && magnitude.amount > 0) {
    return makeField(magnitude.amount, magnitude.evidence, 0.97);
  }
  const abbreviated = text.match(/المطلوب\s+([\d][\d,،]*)\s*الف/i);
  if (abbreviated) {
    const base = parseNumberToken(abbreviated[1]);
    if (base != null && base >= 10) {
      return makeField(base * 1000, abbreviated[0], 0.95);
    }
  }
  const labeled = text.match(
    /(?:السعر\s*المطلوب|سعر\s*البيع|السعر\s*المطلوب|سعر)[:\s]*([\d][\d,،.\s\u066C]*)\s*ريال/i
  );
  if (labeled) {
    const amount = parseNumberToken(String(labeled[1]).replace(/[.,](?=\d{3})/g, ""));
    if (amount != null && amount >= 10000) {
      return makeField(amount, labeled[0], 0.97);
    }
  }
  const amounts = [];
  for (const m of text.matchAll(/([\d][\d,،\s\u066C]*)\s*ريال/gi)) {
    const amount = parseNumberToken(String(m[1]).replace(/[.,](?=\d{3})/g, ""));
    if (amount != null && amount >= 10000) amounts.push(amount);
  }
  if (!amounts.length) return emptyField();
  const max = Math.max(...amounts);
  return makeField(max, String(max), 0.86);
}

function extractBudget(text) {
  const magnitude = extractBudgetAmount(text);
  if (magnitude?.amount != null && magnitude.amount > 0) {
    return makeField(magnitude.amount, magnitude.evidence, 0.96);
  }
  const labeled = text.match(
    /(?:الميزانية|ميزانية|حد\s*الشراء|بحدود)\s*[:：]?\s*([\d][\d,،.\s\u066C]*)\s*(?:ريال|ر\.?\s?س)?/i
  );
  if (!labeled) return emptyField();
  const amount = normalizeArabicMagnitudeNumber(
    parseNumberToken(String(labeled[1]).replace(/[.,](?=\d{3})/g, "")),
    { fieldKind: "money" }
  );
  return amount != null && amount > 0 ? makeField(amount, labeled[0], 0.96) : emptyField();
}

function extractPricePerSquareMeter(text) {
  const m = text.match(/سعر\s*الوحدة[:\s]*([\d][\d,،.\s\u066C]*)/i);
  if (!m) return emptyField();
  const amount = parseNumberToken(String(m[1]).replace(/[.,](?=\d{3})/g, ""));
  if (amount == null || amount <= 0) return emptyField();
  return makeField(amount, m[0], 0.9);
}

function extractCity(text) {
  const cities = [
    { name: "المدينة المنورة", re: /المدينة\s+المنورة|مدينة\s+المنورة|المدينة\s*:\s*Madinah|\bMadinah\b/i },
    { name: "الرياض", re: /(?:^|[\s،,|])الرياض(?:$|[\s،,|])/i },
    { name: "جدة", re: /(?:^|[\s،,|])جدة(?:$|[\s،,|])/i },
    { name: "الدمام", re: /(?:^|[\s،,|])الدمام(?:$|[\s،,|])/i },
    { name: "مكة", re: /مكة\s+المكرمة|(?:^|[\s،,|])مكة(?:$|[\s،,|])/i }
  ];
  for (const c of cities) {
    const m = text.match(c.re);
    if (m) return makeField(c.name, m[0], 0.92);
  }
  return emptyField();
}

function extractRooms(text) {
  const m = text.match(/(\d+)\s*غرف(?:\s+نوم)?/i);
  if (m) return makeField(parseNumberToken(m[1]), m[0], 0.97);
  return emptyField();
}

function extractBathrooms(text) {
  const m = text.match(/(\d+)\s*دورات?\s*مياه/i);
  if (m) return makeField(parseNumberToken(m[1]), m[0], 0.97);
  return emptyField();
}

function extractAnnualRent(text) {
  const annualM = text.match(/([\d][\d,،\s\u066C]*)\s*ريال\s*سنوي/i);
  if (annualM) return makeField(parseNumberToken(annualM[1]), annualM[0], 0.98);
  const rentM = text.match(/الإيجار[:\s▪️]*([\d][\d,،\s\u066C]*)\s*ريال/i);
  if (rentM && /دفعتين|دفعات?|سنوي/i.test(text)) {
    return makeField(parseNumberToken(rentM[1]), rentM[0], 0.94);
  }
  const magnitude = extractAnnualRentAmount(text);
  if (magnitude?.amount != null && magnitude.amount > 0) {
    return makeField(magnitude.amount, magnitude.evidence, 0.98);
  }
  return emptyField();
}

function extractOptionalMonthlyRent(text) {
  const patterns = [
    /شهريًا\s*ب[ـ]?\s*([\d][\d,،\s\u066C]*)\s*ريال/i,
    /ب[ـ]?\s*([\d][\d,،\s\u066C]*)\s*ريال\s*شهري/i,
    /([\d][\d,،\s\u066C]*)\s*ريال\s*شهري/i
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return makeField(parseNumberToken(m[1]), m[0], 0.93);
  }
  return emptyField();
}

function extractPaymentInstallments(text) {
  if (/على\s+دفعتين/i.test(text)) return makeField(2, "على دفعتين", 0.96);
  const m = text.match(/على\s+(\d+)\s+دفعات?/i);
  if (m) return makeField(parseNumberToken(m[1]), m[0], 0.94);
  return emptyField();
}

function extractArea(text) {
  const labeled = text.match(/مساحة\s*العقار\s*[:：]\s*([\d]{1,5}(?:[.,]\d+)?)/i);
  if (labeled) {
    const raw = String(labeled[1]).replace(",", ".");
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 20 && n <= 200000) {
      return makeField(n, labeled[0], 0.94);
    }
  }
  const possessive = text.match(/مساحتها\s+([\d]{2,6}(?:[.,]\d+)?)/i);
  if (possessive) {
    const raw = String(possessive[1]).replace(",", ".");
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 20 && n <= 200000) {
      return makeField(n, possessive[0], 0.93);
    }
  }
  const decimal = text.match(/([\d]{1,5}(?:[.,]\d+)?)\s*(?:م2|م²|متر\s*مربع|متر)/i);
  if (decimal) {
    const raw = String(decimal[1]).replace(",", ".");
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 20 && n <= 200000) {
      return makeField(n, decimal[0], 0.92);
    }
  }
  const m = text.match(/([\d]{2,5})\s*(?:م2|م²|متر)/i);
  if (m) return makeField(parseNumberToken(m[1]), m[0], 0.9);
  return emptyField();
}

function extractFloorsCount(text) {
  const wordMap = { دورين: 2, ثلاث: 3, أربع: 4, خمس: 5 };
  if (!/(فيلا|عمارة)/i.test(text)) return emptyField();

  let m = text.match(/مكونة\s+من\s+(\d+)\s+أدوار?/i);
  if (m) return makeField(parseNumberToken(m[1]), m[0], 0.94);

  const wm = text.match(/مكونة\s+من\s+(دورين|ثلاث|أربع|خمس)(?:\s+أدوار?)?/i);
  if (wm) {
    const n = wordMap[wm[1]] || parseNumberToken(wm[1]);
    if (n != null) return makeField(n, wm[0], 0.94);
  }
  return emptyField();
}

function extractBooleanFeature(text, label, pattern) {
  const m = text.match(pattern);
  if (m) return makeField(true, m[0], 0.9);
  return emptyField();
}

function extractLivingRoom(text) {
  return extractBooleanFeature(text, "صالة", /(?:^|\s)صالة(?:\s|$)/i);
}

function extractKitchen(text) {
  return extractBooleanFeature(text, "مطبخ", /(?:^|\s)مطبخ(?:\s|$)/i);
}

function extractCondition(text) {
  const m = text.match(/مجددة\s+بالكامل/i);
  if (m) return makeField("مجددة بالكامل", m[0], 0.9);
  return emptyField();
}

function extractElectricityMeter(text) {
  const m = text.match(/عداد\s+كهرباء\s+مستقل/i);
  if (m) return makeField("مستقل", m[0], 0.94);
  return emptyField();
}

function extractWaterPaidBy(text) {
  const m = text.match(/الماء\s+والصرف\s+الصحي\s+على\s+(المؤجر|المالك)/i);
  if (m) return makeField("المؤجر", m[0], 0.94);
  return emptyField();
}

function extractElectricityPaidBy(text) {
  const m = text.match(/الكهرباء\s+على\s+(المستأجر|المالك|المؤجر)/i);
  if (m) return makeField(m[1], m[0], 0.94);
  return emptyField();
}

function extractOwnerConditions(text) {
  const section = text.split(/شروط\s+المالك/i)[1] || "";
  const slice = section.split(/📍|💡|💰|\n\s*حي\s+/i)[0] || section;
  const lines = slice.split("\n").map((l) => l.trim()).filter(Boolean);
  const conditions = [];
  const evidenceParts = [];
  for (const line of lines) {
    const cleaned = line.replace(/^▪️\s*/, "").trim();
    if (!cleaned || cleaned.length > 60) continue;
    if (/^(شروط|المالك|:|▪)$/i.test(cleaned)) continue;
    if (/^حي\s/i.test(cleaned)) continue;
    conditions.push(cleaned);
    evidenceParts.push(cleaned);
  }
  if (!conditions.length) return emptyField();
  return makeField(conditions, evidenceParts.join("، "), 0.9);
}

function validateContext(fields, text) {
  const next = { ...fields };
  const explicitBuilding = ["شقة", "فيلا", "أرض", "عمارة", "مستودع", "محل", "مكتب", "منزل", "استراحة"];
  const pt = next.propertyType?.value;

  if (pt === "دور" && next.floorNumber?.value != null) {
    const floorEvidence = next.floorNumber.evidence || "";
    if (next.propertyType.evidence && floorEvidence.includes(next.propertyType.evidence)) {
      next.propertyType = emptyField();
    }
  }

  for (const type of explicitBuilding) {
    const re = new RegExp(`${type}\\s+للإيجار|${type}\\s+للبيع|^${type}`, "i");
    if (re.test(text) && pt === "دور" && next.propertyType?.confidence < 0.93) {
      const m = text.match(re);
      next.propertyType = makeField(type, m[0], 0.97);
    }
  }

  if (next.floorsCount?.value != null && pt === "دور") {
    if (/فيلا/i.test(text)) {
      next.propertyType = makeField("فيلا", "فيلا", 0.95);
    } else if (/عمارة/i.test(text)) {
      next.propertyType = makeField("عمارة", "عمارة", 0.95);
    }
  }

  if (next.city?.value && !text.match(/الرياض|جدة|الدمام|مكة|المدينة|Madinah/i)) {
    next.city = emptyField();
  }

  return next;
}

function resolveConflicts(fields) {
  const next = { ...fields };
  const pt = next.propertyType;
  if (pt?.value === "دور" && next.floorNumber?.value != null) {
    const evidence = String(pt.evidence || "");
    const isFloorUnitPhrase = /دور\s+مستقل|مطلوب\s+دور|عرض\s+مالك/i.test(evidence);
    const isFloorLevelOnly = /^(الدور|في الدور|بالطابق|الطابق)/i.test(evidence.trim());
    if (isFloorLevelOnly && !isFloorUnitPhrase) {
      next.propertyType = emptyField();
    }
  }
  return next;
}

function resolveFinancialSemantics(fields) {
  const next = { ...fields };
  const transaction = next.transactionType?.value;
  if (transaction === "بيع") {
    next.annualRent = emptyField();
    next.monthlyRent = emptyField();
    next.optionalMonthlyRentAfterSixMonths = emptyField();
    next.paymentInstallments = emptyField();
    next.budget = emptyField();
  } else if (transaction === "إيجار") {
    next.salePrice = emptyField();
    next.budget = emptyField();
  } else if (transaction === "شراء") {
    next.salePrice = emptyField();
    next.annualRent = emptyField();
    next.monthlyRent = emptyField();
    next.optionalMonthlyRentAfterSixMonths = emptyField();
    next.paymentInstallments = emptyField();
  } else {
    next.salePrice = emptyField();
    next.annualRent = emptyField();
    next.monthlyRent = emptyField();
    next.optionalMonthlyRentAfterSixMonths = emptyField();
    next.paymentInstallments = emptyField();
    next.budget = emptyField();
  }
  return next;
}

function structuredToPublicShape(fields) {
  const out = {};
  for (const [key, field] of Object.entries(fields)) {
    if (!field || typeof field !== "object") continue;
    const gated = gateField(field);
    out[key] = gated.value;
  }
  return out;
}

function mapLegacyFields(fields) {
  const transaction = fields.transactionType?.value;
  let opportunityKind = "";
  let purpose = "";

  if (transaction === "إيجار") {
    opportunityKind = /مطلوب|أبحث|ابحث/i.test(fields.transactionType?.evidence || "") ? "REQUEST" : "OFFER";
    purpose = opportunityKind === "REQUEST" ? "LEASE_REQUEST" : "RENT";
  } else if (transaction === "بيع") {
    opportunityKind = "OFFER";
    purpose = "SALE";
  } else if (transaction === "شراء") {
    opportunityKind = "REQUEST";
    purpose = "PURCHASE";
  }

  const annual = gateField(fields.annualRent).value;
  const sale = gateField(fields.salePrice).value;
  const budget = gateField(fields.budget).value;
  let priceOrBudget = null;
  if (transaction === "بيع" && sale != null) priceOrBudget = sale;
  else if (transaction === "إيجار" && annual != null) priceOrBudget = annual;
  else if (transaction === "شراء" && budget != null) priceOrBudget = budget;

  return {
    opportunityKind: gateField({ value: opportunityKind, evidence: fields.transactionType?.evidence, confidence: fields.transactionType?.confidence || 0 }).value || "",
    purpose: gateField({ value: purpose, evidence: fields.transactionType?.evidence, confidence: fields.transactionType?.confidence || 0 }).value || "",
    propertyType: gateField(fields.propertyType).value || "",
    city: gateField(fields.city).value || "",
    district: gateField(fields.district).value || "",
    priceOrBudget,
    area: gateField(fields.area).value,
    rooms: gateField(fields.rooms).value
  };
}

function mapExtendedFields(fields) {
  return {
    transactionType: gateField(fields.transactionType).value,
    salePrice: gateField(fields.salePrice).value,
    budget: gateField(fields.budget).value,
    pricePerSquareMeter: gateField(fields.pricePerSquareMeter).value,
    annualRent: gateField(fields.annualRent).value,
    monthlyRent: gateField(fields.monthlyRent).value,
    paymentInstallments: gateField(fields.paymentInstallments).value,
    optionalMonthlyRentAfterSixMonths: gateField(fields.optionalMonthlyRentAfterSixMonths).value,
    bathrooms: gateField(fields.bathrooms).value,
    floorNumber: gateField(fields.floorNumber).value,
    floorPosition: gateField(fields.floorPosition).value,
    floorsCount: gateField(fields.floorsCount).value,
    livingRoom: gateField(fields.livingRoom).value,
    kitchen: gateField(fields.kitchen).value,
    condition: gateField(fields.condition).value,
    electricityMeter: gateField(fields.electricityMeter).value,
    waterAndSewagePaidBy: gateField(fields.waterAndSewagePaidBy).value,
    electricityPaidBy: gateField(fields.electricityPaidBy).value,
    ownerConditions: gateField(fields.ownerConditions).value
  };
}

function computeExtractionConfidence(fields) {
  const keys = ["transactionType", "propertyType", "district", "annualRent", "rooms", "bathrooms"];
  let sum = 0;
  let count = 0;
  for (const key of keys) {
    const f = fields[key];
    if (f && f.confidence > 0) {
      sum += f.confidence;
      count += 1;
    }
  }
  if (!count) return 0;
  return Math.round((sum / count) * 100);
}

/**
 * Main entry — four-stage Arabic listing extraction.
 */
export function extractArabicOpportunityText(rawText) {
  const normalized = normalizeListingText(rawText);
  const title = firstLine(normalized);
  const firstSent = firstSentence(normalized);

  const propertyCandidates = extractPropertyTypeCandidates(normalized, title, firstSent);
  const floorParts = extractFloorNumber(normalized);

  const structured = {
    transactionType: extractTransactionType(normalized, title),
    propertyType: pickBestCandidate(propertyCandidates),
    city: extractCity(normalized),
    district: extractDistrict(normalized),
    annualRent: extractAnnualRent(normalized),
    paymentInstallments: extractPaymentInstallments(normalized),
    optionalMonthlyRentAfterSixMonths: extractOptionalMonthlyRent(normalized),
    rooms: extractRooms(normalized),
    bathrooms: extractBathrooms(normalized),
    floorNumber: floorParts.floorNumber,
    floorPosition: floorParts.floorPosition,
    floorsCount: extractFloorsCount(normalized),
    area: extractArea(normalized),
    salePrice: extractSalePrice(normalized),
    budget: extractBudget(normalized),
    monthlyRent: emptyField(),
    pricePerSquareMeter: extractPricePerSquareMeter(normalized),
    livingRoom: extractLivingRoom(normalized),
    kitchen: extractKitchen(normalized),
    condition: extractCondition(normalized),
    electricityMeter: extractElectricityMeter(normalized),
    waterAndSewagePaidBy: extractWaterPaidBy(normalized),
    electricityPaidBy: extractElectricityPaidBy(normalized),
    ownerConditions: extractOwnerConditions(normalized)
  };

  let validated = validateContext(structured, normalized);
  validated = resolveConflicts(validated);
  validated = resolveFinancialSemantics(validated);

  const publicShape = structuredToPublicShape(validated);
  const legacyFields = mapLegacyFields(validated);
  const extended = mapExtendedFields(validated);

  const needsReview = {};
  for (const [key, field] of Object.entries(validated)) {
    if (field && typeof field === "object") {
      needsReview[key] = field.confidence < CONFIDENCE_AUTO_FILL || field.value == null;
    }
  }

  return {
    normalizedText: normalized,
    structured: validated,
    publicShape,
    legacyFields,
    extended,
    needsReview,
    fieldEvidence: validated,
    extractionConfidence: computeExtractionConfidence(validated)
  };
}

export const __test = {
  normalizeListingText,
  extractArabicOpportunityText,
  gateField,
  makeField
};
