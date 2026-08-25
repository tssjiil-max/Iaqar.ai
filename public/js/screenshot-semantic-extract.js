/**
 * Multi-source screenshot / listing-image semantic extraction.
 *
 * Pipeline: extract all text → classify spans by meaning → resolve from context.
 * Visual position is never the source of truth. No fixed-layout coordinates.
 */

import { DISTRICTS, CITIES, PROPERTY_TYPES } from "./reference-catalog.js";
import {
  formatLocalPhoneDisplay,
  normalizeAdvertiserPhoneE164
} from "./advertiser-phone-domain.js";

export const SCREENSHOT_SOURCE_TYPES = Object.freeze({
  WHATSAPP_SCREENSHOT: "WHATSAPP_SCREENSHOT",
  PROPERTY_SITE_SCREENSHOT: "PROPERTY_SITE_SCREENSHOT",
  DESIGNED_AD_IMAGE: "DESIGNED_AD_IMAGE",
  GENERIC_SCREENSHOT: "GENERIC_SCREENSHOT"
});

export const PHONE_CONFLICT_MESSAGE = "تم العثور على أكثر من رقم تواصل";
export const PRICE_CONFLICT_MESSAGE = "وجدنا قيمتين للسعر";
export const AREA_CONFLICT_MESSAGE = "وجدنا قيمتين للمساحة";

export const CONFIDENCE_HIGH = 0.85;
export const CONFIDENCE_MEDIUM = 0.55;

const PHONE_CUE_RE = /للتواصل|واتساب|واتس(?:اب)?|اتصال|اتصل|جوال|رقم\s*(?:الجوال|التواصل|المعلن)|تواصل/i;
const PRICE_CUE_RE = /المطلوب|السعر|سعر|الحد|صافي|السوم|بكم|على\s+(?:حد|السوم)/i;
const REQUEST_SEEKING_RE = /(?:^|\s)(?:مطلوب(?!\s*[:：]?\s*[\d.])|أبحث|ابحث|أبغى|ابغى|أرغب|نبحث|طلب\s+عميل)/i;
const SALE_CUE_RE = /للبيع|للتمليك|بيع(?:\s|$)|تمليك/i;
const RENT_CUE_RE = /للإيجار|للايجار|إيجار|ايجار/i;
const PURCHASE_CUE_RE = /مطلوب\s+شراء|شراء(?:\s|$)|مشتري/i;
const MAPS_URL_RE = /https?:\/\/(?:maps\.app\.goo\.gl|www\.google\.com\/maps|google\.com\/maps|goo\.gl\/maps|maps\.google\.com)[^\s)\]>'"]*/gi;
const CARDINAL_RE = /شمالي(?:\s*شرقي|\s*غربي)?|جنوبي(?:\s*شرقي|\s*غربي)?|شرقي|غربي|شمال(?:\s*شرق|\s*غرب)?|جنوب(?:\s*شرق|\s*غرب)?|شرق|غرب/;
const UNIT_PRICE_RE = /سعر\s*(?:الوحدة|المتر|م2|م²)/i;

const PROPERTY_TYPE_RULES = [
  { type: "أرض", patterns: [/أراضي/, /أرض/, /ارض/] },
  { type: "شقة", patterns: [/شقق/, /شقة/, /شقه/] },
  { type: "فيلا", patterns: [/فلل/, /فيلا/, /فيلة/, /فله/] },
  { type: "عمارة", patterns: [/عماير/, /عمارة/, /عماره/] },
  { type: "دور", patterns: [/دور\s+مستقل/, /دور\s+(?:علوي|أرضي|ارضي)/, /(?:^|\s)دور(?:\s|$)/] },
  { type: "مزرعة", patterns: [/مزرعة/, /مزرعه/] },
  { type: "استراحة", patterns: [/استراحة/, /استراحه/] },
  { type: "محل", patterns: [/محلات/, /محل(?:\s|$)/] },
  { type: "مكتب", patterns: [/مكاتب/, /مكتب(?:\s|$)/] },
  { type: "مستودع", patterns: [/مستودعات/, /مستودع/, /مخزن/] },
  { type: "دوبلكس", patterns: [/دوبلكس/, /دوبليكس/] },
  { type: "منزل", patterns: [/منزل/, /بيت\s+شعبي/, /(?:^|\s)بيت(?:\s|$)/] },
  { type: "قصر", patterns: [/قصور/, /قصر/] },
  { type: "شاليه", patterns: [/شاليهات/, /شاليه/] },
  { type: "معرض", patterns: [/معرض/] },
  { type: "فندق", patterns: [/فندق/] }
];

function emptyField(sourceType = "missing") {
  return {
    value: null,
    confidence: 0,
    sourceSnippet: "",
    sourceType,
    inferredPrice: false,
    needsReview: true
  };
}

function makeField(value, snippet, confidence, sourceType, extras = {}) {
  const hasValue = value !== null && value !== undefined && value !== "";
  const conf = Number.isFinite(confidence) ? confidence : 0;
  return {
    value: hasValue ? value : null,
    confidence: conf,
    sourceSnippet: String(snippet || "").trim(),
    sourceType,
    inferredPrice: Boolean(extras.inferredPrice),
    needsReview: !hasValue || conf < CONFIDENCE_HIGH || Boolean(extras.forceReview)
  };
}

export function normalizeScreenshotText(raw) {
  let text = String(raw ?? "");
  text = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
  text = text.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
  text = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ");
  text = text.replace(/\u0640/g, "");
  text = text.replace(/\u00a0/g, " ");
  return text.replace(/[ \t]+/g, " ").trim();
}

function contextWindow(text, start, end, radius = 48) {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  return text.slice(from, to);
}

function parseNumberToken(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[،,\s\u066C]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Assistive source classification only. Never drives field values.
 */
export function classifyScreenshotSourceType(text) {
  const sample = String(text || "");
  if (/whatsapp|واتساب|آخر ظهور|last seen|typing\.\.\.|يبكتب|متصل الآن|online/i.test(sample)) {
    return SCREENSHOT_SOURCE_TYPES.WHATSAPP_SCREENSHOT;
  }
  if (/aqar\.fm|haraj\.com|dealapp|bayut|propertyfinder|عقار\.كوم|حراج|ديل\s*أب/i.test(sample)) {
    return SCREENSHOT_SOURCE_TYPES.PROPERTY_SITE_SCREENSHOT;
  }
  if (/للتواصل|مكتب\s+عقاري|تصميم|advert/i.test(sample) && /https?:\/\//i.test(sample)) {
    return SCREENSHOT_SOURCE_TYPES.DESIGNED_AD_IMAGE;
  }
  if (/للتواصل|مكتب\s+عقاري/.test(sample) && !/whatsapp|واتساب/i.test(sample)) {
    return SCREENSHOT_SOURCE_TYPES.DESIGNED_AD_IMAGE;
  }
  return SCREENSHOT_SOURCE_TYPES.GENERIC_SCREENSHOT;
}

export function extractMapsLocationUrls(text) {
  const raw = String(text || "");
  const found = [];
  for (const match of raw.matchAll(MAPS_URL_RE)) {
    const url = String(match[0] || "").replace(/[.,؛،]+$/, "");
    if (!url) continue;
    found.push({
      value: url,
      snippet: url,
      index: match.index || 0
    });
  }
  return uniqueBy(found, (item) => item.value);
}

function phonePriority(windowText, sourceType, index, textLength) {
  if (PHONE_CUE_RE.test(windowText)) return { rank: 1, sourceType: "contact_cue" };
  const isHeaderZone = index < Math.min(80, Math.max(24, textLength * 0.08));
  const looksLikeHeader = isHeaderZone && windowText.length < 70 && !/أرض|شقة|فيلا|المطلوب|مساحة/i.test(windowText);
  if (looksLikeHeader && sourceType === SCREENSHOT_SOURCE_TYPES.WHATSAPP_SCREENSHOT) {
    return { rank: 3, sourceType: "whatsapp_header" };
  }
  if (/أرض|شقة|فيلا|عمارة|للبيع|مساحة|المطلوب|حي\s/i.test(windowText)) {
    return { rank: 2, sourceType: "ad_body" };
  }
  if (looksLikeHeader) return { rank: 3, sourceType: "header_like" };
  return { rank: 4, sourceType: "other_phone" };
}

export function extractScreenshotPhoneCandidates(text, sourceType = SCREENSHOT_SOURCE_TYPES.GENERIC_SCREENSHOT) {
  const raw = normalizeScreenshotText(text);
  if (!raw) return [];
  const results = [];
  const seen = new Set();
  const flexible = /(?:\+?966|00966)?[\s-]*0?5(?:[\s-]*\d){8}/g;
  for (const match of raw.matchAll(flexible)) {
    const snippet = match[0];
    const e164 = normalizeAdvertiserPhoneE164(snippet);
    if (!e164 || seen.has(e164)) continue;
    seen.add(e164);
    const index = match.index || 0;
    const windowText = contextWindow(raw, index, index + snippet.length);
    if (/رخصة\s*فال|رقم\s*الرخصة/.test(windowText) && !PHONE_CUE_RE.test(windowText)) continue;
    const priority = phonePriority(windowText, sourceType, index, raw.length);
    results.push({
      value: formatLocalPhoneDisplay(e164) || snippet,
      e164,
      local: formatLocalPhoneDisplay(e164),
      confidence: priority.rank === 1 ? 0.96 : priority.rank === 2 ? 0.9 : priority.rank === 3 ? 0.78 : 0.62,
      sourceSnippet: windowText.trim(),
      sourceType: priority.sourceType,
      rank: priority.rank,
      index
    });
  }
  return results.sort((a, b) => a.rank - b.rank || b.confidence - a.confidence);
}

function spokenMillion(text) {
  const sample = String(text || "");
  const millionAnd = sample.match(/مليون(?:ين)?\s*و\s*(مائتين|مئتين|مائة|مئة|ثلاثمائة|أربعمائة|خمسمائة)/);
  if (millionAnd) {
    const frac = {
      مائتين: 200000,
      مئتين: 200000,
      مائة: 100000,
      مئة: 100000,
      ثلاثمائة: 300000,
      أربعمائة: 400000,
      خمسمائة: 500000
    };
    const extra = frac[millionAnd[1]] || 0;
    const millions = /مليونين/.test(millionAnd[0]) ? 2 : 1;
    return { value: millions * 1000000 + extra, snippet: millionAnd[0] };
  }
  if (/مليونين/.test(sample)) return { value: 2000000, snippet: "مليونين" };
  return null;
}

function normalizePriceAmount(number, unitSnippet, inferred) {
  if (number == null || number <= 0) return null;
  let amount = number;
  let inferredPrice = Boolean(inferred);
  const unit = String(unitSnippet || "");
  if (/مليون/.test(unit)) {
    amount = number < 1000 ? Math.round(number * 1000000) : Math.round(number);
  } else if (/ألف|الف|آلاف|الاف/.test(unit)) {
    amount = number < 100000 ? Math.round(number * 1000) : Math.round(number);
  } else if (/صافي/.test(unit) && number < 10000) {
    amount = Math.round(number * 1000);
    inferredPrice = true;
  } else if (number > 0 && number < 100 && /مليون/.test(unit)) {
    amount = Math.round(number * 1000000);
  }
  if (amount < 1000) return null;
  return { amount, inferredPrice };
}

export function extractScreenshotPriceCandidates(text) {
  const raw = normalizeScreenshotText(text);
  const candidates = [];

  const spoken = spokenMillion(raw);
  if (spoken) {
    candidates.push({
      value: spoken.value,
      confidence: 0.88,
      sourceSnippet: spoken.snippet,
      sourceType: "spoken_million",
      inferredPrice: false
    });
  }

  const patterns = [
    { re: /المطلوب\s*[:：]?\s*([\d]+(?:[.,]\d+)?)\s*(صافي|ألف|الف|مليون)?/gi, conf: 0.9, type: "asking" },
    { re: /(?:السعر|سعر\s*البيع|الحد|السوم)\s*[:：]?\s*([\d]+(?:[.,]\d+)?)\s*(صافي|ألف|الف|مليون|ريال)?/gi, conf: 0.92, type: "labeled" },
    { re: /([\d]+(?:[.,]\d+)?)\s*(صافي)/gi, conf: 0.72, type: "net_shorthand", inferred: true },
    { re: /([\d]+(?:[.,]\d+)?)\s*(ألف|الف)\b/gi, conf: 0.86, type: "thousands" },
    { re: /([\d]+(?:[.,]\d+)?)\s*(مليون)/gi, conf: 0.9, type: "millions" },
    { re: /بكم\s*[:：]?\s*([\d]+(?:[.,]\d+)?)\s*(صافي|ألف|الف|مليون|ريال)?/gi, conf: 0.8, type: "how_much" },
    { re: /([\d][\d,،\s]{3,})\s*ريال/gi, conf: 0.88, type: "riyal" }
  ];

  for (const rule of patterns) {
    for (const match of raw.matchAll(rule.re)) {
      const windowText = contextWindow(raw, match.index || 0, (match.index || 0) + match[0].length);
      if (UNIT_PRICE_RE.test(windowText)) continue;
      if (/رخصة|فال/.test(windowText)) continue;
      const number = parseNumberToken(String(match[1]).replace(/[.,](?=\d{3})/g, ""));
      const normalized = normalizePriceAmount(number, `${match[2] || ""} ${match[0]}`, rule.inferred);
      if (!normalized) continue;
      if (normalized.amount >= 1e9) continue;
      candidates.push({
        value: normalized.amount,
        confidence: rule.inferred || normalized.inferredPrice ? Math.min(rule.conf, 0.72) : rule.conf,
        sourceSnippet: match[0].trim(),
        sourceType: rule.type,
        inferredPrice: Boolean(rule.inferred || normalized.inferredPrice)
      });
    }
  }

  return uniqueBy(candidates, (item) => String(item.value));
}

function lastLabelBeforeNumber(beforeText) {
  const sample = String(beforeText || "");
  const labels = [
    { kind: "plotNumber", re: /رقم\s*القطعة|القطعة|قطعة\s*رقم/g },
    { kind: "depth", re: /العمق|عمق/g },
    { kind: "facadeWidth", re: /عرض\s*الواجهة|الواجهة|واجهة/g },
    { kind: "streetWidth", re: /عرض\s*الشارع|شارع/g },
    { kind: "area", re: /المساحة|مساحة|متر\s*مربع/g }
  ];
  let best = { kind: "", index: -1 };
  for (const label of labels) {
    let match;
    const re = new RegExp(label.re.source, "g");
    while ((match = re.exec(sample))) {
      if (match.index >= best.index) best = { kind: label.kind, index: match.index };
    }
  }
  return best.kind;
}

export function extractScreenshotDimensions(text) {
  const raw = normalizeScreenshotText(text);
  const assigned = {
    area: [],
    streetWidth: [],
    facadeWidth: [],
    depth: [],
    plotNumber: []
  };

  const labeledPlot = [...raw.matchAll(/(?:رقم\s*)?القطعة\s*[:：]?\s*([\d]+(?:\s*\/\s*[\d]+)?)/gi)];
  for (const match of labeledPlot) {
    assigned.plotNumber.push({
      value: String(match[1]).replace(/\s+/g, ""),
      confidence: 0.96,
      sourceSnippet: match[0],
      sourceType: "plot_label"
    });
  }

  const measures = [...raw.matchAll(/([\d]+(?:[.,]\d+)?)\s*(م²|م2|متر(?:\s*مربع)?|م)(?=$|[\s,،.|]|[^\u0600-\u06FFa-zA-Z])/gi)];
  const claimedIndexes = new Set();
  for (const match of measures) {
    const index = match.index || 0;
    const before = raw.slice(Math.max(0, index - 40), index);
    const kind = lastLabelBeforeNumber(before);
    const amount = parseNumberToken(String(match[1]).replace(",", "."));
    if (amount == null) continue;
    if (kind && assigned[kind]) {
      assigned[kind].push({
        value: amount,
        confidence: 0.95,
        sourceSnippet: `${before}${match[0]}`.trim(),
        sourceType: kind
      });
      claimedIndexes.add(index);
    }
  }

  for (const match of measures) {
    const index = match.index || 0;
    if (claimedIndexes.has(index)) continue;
    const amount = parseNumberToken(String(match[1]).replace(",", "."));
    if (amount == null) continue;
    if (amount >= 80 && amount <= 200000) {
      assigned.area.push({
        value: amount,
        confidence: 0.72,
        sourceSnippet: match[0],
        sourceType: "unlabeled_area_remainder"
      });
    }
  }

  const streetDirection = [];
  const dirMatch = raw.match(new RegExp(String.raw`شارع\s*(${CARDINAL_RE.source})|(${CARDINAL_RE.source})\s*(?:شارع)?`, "i"));
  if (dirMatch) {
    const label = (dirMatch[1] || dirMatch[2] || "").trim();
    if (label) {
      streetDirection.push({
        value: label,
        confidence: 0.93,
        sourceSnippet: dirMatch[0],
        sourceType: "street_cardinal"
      });
    }
  }
  const facadeCardinal = [];
  const faceDir = raw.match(new RegExp(String.raw`واجه[ةه]\s*(${CARDINAL_RE.source})`, "i"));
  if (faceDir && !/[\d]/.test(faceDir[0])) {
    facadeCardinal.push({
      value: faceDir[1],
      confidence: 0.92,
      sourceSnippet: faceDir[0],
      sourceType: "facade_cardinal"
    });
  }

  return { ...assigned, streetDirection, facadeCardinal };
}

export function extractScreenshotPropertyTypes(text) {
  const raw = normalizeScreenshotText(text);
  const found = [];
  for (const rule of PROPERTY_TYPE_RULES) {
    for (const pattern of rule.patterns) {
      const match = raw.match(pattern);
      if (!match) continue;
      const snippet = match[0];
      if (rule.type === "دور" && /دورات?\s*مياه|أدوار|دورين/.test(contextWindow(raw, match.index || 0, (match.index || 0) + snippet.length))) {
        continue;
      }
      found.push({
        value: rule.type,
        confidence: 0.9,
        sourceSnippet: snippet,
        sourceType: "property_keyword",
        catalog: PROPERTY_TYPES.find((row) => row.label === rule.type)?.id || ""
      });
      break;
    }
  }
  return uniqueBy(found, (item) => item.value);
}

export function extractScreenshotPurpose(text, propertyTypes = []) {
  const raw = normalizeScreenshotText(text);
  const hasSale = SALE_CUE_RE.test(raw);
  const hasRent = RENT_CUE_RE.test(raw);
  const hasPurchase = PURCHASE_CUE_RE.test(raw);
  const askingPrice = /المطلوب\s*[:：]?\s*[\d.]/.test(raw);
  const seeking = REQUEST_SEEKING_RE.test(raw) && !askingPrice;
  const hasProperty = propertyTypes.length > 0;

  if (hasSale && !hasRent && !seeking) {
    return {
      purpose: makeField("SALE", "للبيع", 0.93, "sale_cue"),
      opportunityKind: makeField("OFFER", "للبيع", 0.9, "sale_cue"),
      purposeLabel: makeField("بيع", "للبيع", 0.93, "sale_cue")
    };
  }
  if (hasRent && !hasSale && !seeking) {
    return {
      purpose: makeField("RENT", "للإيجار", 0.93, "rent_cue"),
      opportunityKind: makeField("OFFER", "للإيجار", 0.9, "rent_cue"),
      purposeLabel: makeField("إيجار", "للإيجار", 0.93, "rent_cue")
    };
  }
  if (hasPurchase && !hasSale) {
    return {
      purpose: makeField("PURCHASE", "شراء", 0.9, "purchase_cue"),
      opportunityKind: makeField("REQUEST", "شراء", 0.9, "purchase_cue"),
      purposeLabel: makeField("شراء", "شراء", 0.9, "purchase_cue")
    };
  }
  if (seeking) {
    const rentSeek = hasRent || /استئجار|للإيجار/.test(raw);
    return {
      purpose: makeField(rentSeek ? "LEASE_REQUEST" : "PURCHASE", "مطلوب", 0.82, "request_cue"),
      opportunityKind: makeField("REQUEST", "مطلوب", 0.86, "request_cue"),
      purposeLabel: makeField(rentSeek ? "طلب" : "طلب", "مطلوب", 0.82, "request_cue")
    };
  }
  if (askingPrice && hasProperty && !seeking && !hasRent) {
    return {
      purpose: makeField("SALE", "المطلوب", 0.7, "asking_plus_property"),
      opportunityKind: makeField("OFFER", "المطلوب", 0.68, "asking_plus_property"),
      purposeLabel: makeField("بيع", "المطلوب", 0.7, "asking_plus_property")
    };
  }
  return {
    purpose: emptyField("purpose"),
    opportunityKind: emptyField("opportunityKind"),
    purposeLabel: emptyField("purposeLabel")
  };
}

export function extractScreenshotCity(text) {
  const raw = normalizeScreenshotText(text);
  const found = [];
  for (const city of CITIES) {
    if (city.id === "other") continue;
    for (const alias of city.aliases || []) {
      if (!alias || alias.length < 3) continue;
      if (alias === "المدينة" && !/المدينة\s+المنورة|مدينة\s+المنورة/.test(raw)) {
        if (!new RegExp(`(?:^|[\\s،,|])${alias}(?:$|[\\s،,|])`).test(raw)) continue;
      }
      const re = new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const match = raw.match(re);
      if (match) {
        found.push({
          value: city.label,
          confidence: alias.length >= 8 ? 0.95 : 0.86,
          sourceSnippet: match[0],
          sourceType: "city_dictionary"
        });
        break;
      }
    }
  }
  return uniqueBy(found, (item) => item.value);
}

export function extractScreenshotDistrict(text) {
  const raw = normalizeScreenshotText(text);
  const found = [];
  const haystack = ` ${raw} `;
  for (const district of DISTRICTS) {
    const names = [district.officialName, ...(district.aliases || [])];
    for (const name of names) {
      const token = String(name || "").trim();
      if (token.length < 3) continue;
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(?:^|[\\s،,|])${escaped}(?:$|[\\s،,|])`);
      if (!re.test(haystack)) continue;
      const hasHayPrefix = new RegExp(`حي\\s+${escaped}`).test(raw);
      found.push({
        value: district.officialName,
        confidence: hasHayPrefix ? 0.96 : 0.9,
        sourceSnippet: hasHayPrefix ? `حي ${district.officialName}` : token,
        sourceType: "district_dictionary"
      });
      break;
    }
  }
  const labeled = raw.match(/حي\s+([^\n|،,]{2,40})/);
  if (labeled && !found.length) {
    const name = labeled[1].replace(/\s+(?:المساحة|مساحة|السعر|للتواصل).*$/i, "").trim();
    if (name) {
      found.push({
        value: name.split(/\s+/).slice(0, 4).join(" "),
        confidence: 0.7,
        sourceSnippet: labeled[0],
        sourceType: "district_labeled"
      });
    }
  }
  return uniqueBy(found, (item) => item.value);
}

function resolveSingleOrConflict(candidates, field, conflictMessage) {
  const uniq = uniqueBy(candidates || [], (item) => String(item.value));
  if (!uniq.length) {
    return { field: emptyField(field), conflict: null };
  }
  if (uniq.length === 1) {
    const item = uniq[0];
    return {
      field: makeField(item.value, item.sourceSnippet, item.confidence, item.sourceType, {
        inferredPrice: item.inferredPrice,
        forceReview: item.confidence < CONFIDENCE_HIGH
      }),
      conflict: null
    };
  }
  return {
    field: emptyField(field),
    conflict: {
      field,
      message: conflictMessage,
      candidates: uniq.map((item) => ({
        value: item.value,
        sourceSnippet: item.sourceSnippet,
        confidence: item.confidence,
        sourceType: item.sourceType,
        inferredPrice: Boolean(item.inferredPrice)
      }))
    }
  };
}

function firstOrEmpty(candidates, sourceType) {
  if (!candidates?.length) return emptyField(sourceType);
  if (candidates.length > 1) {
    const values = uniqueBy(candidates, (item) => String(item.value));
    if (values.length > 1) return emptyField(sourceType);
  }
  const item = candidates[0];
  return makeField(item.value, item.sourceSnippet, item.confidence, item.sourceType);
}

export function extractScreenshotSemantics(rawText, options = {}) {
  const normalizedText = normalizeScreenshotText(rawText);
  const sourceType = options.sourceType || classifyScreenshotSourceType(normalizedText);
  const phones = extractScreenshotPhoneCandidates(normalizedText, sourceType);
  const prices = extractScreenshotPriceCandidates(normalizedText);
  const dimensions = extractScreenshotDimensions(normalizedText);
  const propertyTypes = extractScreenshotPropertyTypes(normalizedText);
  const cities = extractScreenshotCity(normalizedText);
  const districts = extractScreenshotDistrict(normalizedText);
  const maps = extractMapsLocationUrls(normalizedText);
  const purpose = extractScreenshotPurpose(normalizedText, propertyTypes);

  const phoneResolved = resolveSingleOrConflict(phones, "phone", PHONE_CONFLICT_MESSAGE);
  const priceResolved = resolveSingleOrConflict(prices, "price", PRICE_CONFLICT_MESSAGE);
  const areaResolved = resolveSingleOrConflict(dimensions.area, "area", AREA_CONFLICT_MESSAGE);
  const typeResolved = resolveSingleOrConflict(propertyTypes, "propertyType", "وجدنا أكثر من نوع عقار");
  const cityResolved = resolveSingleOrConflict(cities, "city", "وجدنا أكثر من مدينة");
  const districtResolved = districts.length > 1
    ? resolveSingleOrConflict(districts, "district", "وجدنا أكثر من حي")
    : { field: firstOrEmpty(districts, "district"), conflict: null };

  const conflicts = [
    phoneResolved.conflict,
    priceResolved.conflict,
    areaResolved.conflict,
    typeResolved.conflict,
    cityResolved.conflict,
    districtResolved.conflict
  ].filter(Boolean);

  const locationUrl = maps[0]
    ? makeField(maps[0].value, maps[0].snippet, 0.97, "maps_url")
    : emptyField("locationUrl");

  const streetWidth = firstOrEmpty(dimensions.streetWidth, "streetWidth");
  const facadeWidth = firstOrEmpty(dimensions.facadeWidth, "facadeWidth");
  const depth = firstOrEmpty(dimensions.depth, "depth");
  const plotNumber = firstOrEmpty(dimensions.plotNumber, "plotNumber");
  const streetDirection = firstOrEmpty(dimensions.streetDirection, "streetDirection");
  const facadeCardinal = firstOrEmpty(dimensions.facadeCardinal, "facadeCardinal");
  const direction = facadeWidth.value != null
    ? makeField(facadeWidth.value, facadeWidth.sourceSnippet, facadeWidth.confidence, "facadeWidth")
    : facadeCardinal;

  const fields = {
    phone: phoneResolved.field,
    price: priceResolved.field,
    area: areaResolved.field,
    propertyType: typeResolved.field,
    city: cityResolved.field,
    district: districtResolved.field,
    purpose: purpose.purpose,
    opportunityKind: purpose.opportunityKind,
    purposeLabel: purpose.purposeLabel,
    streetWidth,
    streetDirection,
    facadeWidth,
    direction,
    depth,
    plotNumber,
    locationUrl
  };

  const needsReview = {};
  for (const [key, field] of Object.entries(fields)) {
    needsReview[key] = Boolean(field?.needsReview);
  }
  for (const conflict of conflicts) {
    needsReview[conflict.field] = true;
  }

  return {
    normalizedText,
    sourceType,
    fields,
    conflicts,
    needsReview,
    phones,
    prices,
    propertyTypes,
    maps,
    inferredPrice: Boolean(fields.price?.inferredPrice)
  };
}

export function screenshotSemanticsToBrokerFields(extraction = {}) {
  const fields = extraction.fields || {};
  const take = (key, min = CONFIDENCE_MEDIUM) => {
    const field = fields[key];
    if (!field || field.value == null || field.value === "") return null;
    if (extraction.conflicts?.some((row) => row.field === key)) return null;
    if (field.confidence < min) return null;
    return field.value;
  };
  const propertyType = take("propertyType", CONFIDENCE_MEDIUM) || "";
  const purpose = take("purpose", CONFIDENCE_MEDIUM) || "";
  const opportunityKind = take("opportunityKind", CONFIDENCE_MEDIUM) || "";
  const city = take("city", CONFIDENCE_MEDIUM) || "";
  const district = take("district", CONFIDENCE_MEDIUM) || "";
  const area = take("area", CONFIDENCE_MEDIUM);
  const price = take("price", CONFIDENCE_MEDIUM);
  const phoneLocal = take("phone", CONFIDENCE_MEDIUM) || "";
  const broker = {
    opportunityKind,
    purpose,
    propertyType,
    city,
    district,
    area,
    rooms: null,
    bathrooms: null,
    streetWidth: take("streetWidth", CONFIDENCE_MEDIUM),
    direction: take("direction", CONFIDENCE_MEDIUM),
    streetDirection: take("streetDirection", CONFIDENCE_MEDIUM),
    facadeWidth: take("facadeWidth", CONFIDENCE_MEDIUM),
    depth: take("depth", CONFIDENCE_MEDIUM),
    plotNumber: take("plotNumber", CONFIDENCE_MEDIUM),
    locationUrl: take("locationUrl", CONFIDENCE_MEDIUM) || "",
    advertiserPhoneRaw: phoneLocal,
    advertiserPhoneNormalized: phoneLocal ? normalizeAdvertiserPhoneE164(phoneLocal) : "",
    salePrice: null,
    annualRent: null,
    budget: null,
    priceOrBudget: null,
    inferredPrice: Boolean(fields.price?.inferredPrice && price != null)
  };
  if (price != null) {
    if (purpose === "RENT") broker.annualRent = price;
    else if (purpose === "PURCHASE" || opportunityKind === "REQUEST") broker.budget = price;
    else broker.salePrice = price;
    broker.priceOrBudget = price;
  }
  return broker;
}

export function groundBrokerFieldsInText(brokerFields = {}, rawText = "") {
  const text = normalizeScreenshotText(rawText);
  if (!text) return {};
  const grounded = {};
  for (const [key, value] of Object.entries(brokerFields || {})) {
    if (value === null || value === undefined || String(value).trim() === "") continue;
    const token = String(value).trim();
    const digits = token.replace(/\D/g, "");
    const ok = text.includes(token)
      || (digits.length >= 4 && text.replace(/\D/g, "").includes(digits))
      || (key === "purpose" && /SALE|RENT|PURCHASE/.test(token))
      || (key === "opportunityKind" && /OFFER|REQUEST/.test(token));
    if (ok) grounded[key] = value;
  }
  return grounded;
}

export function mergeVisionWithScreenshotSemantics(rawText, visionBrokerFields = {}) {
  const extraction = extractScreenshotSemantics(rawText);
  const semanticBroker = screenshotSemanticsToBrokerFields(extraction);
  const groundedVision = groundBrokerFieldsInText(visionBrokerFields, rawText);
  const merged = { ...semanticBroker };
  const conflictFields = new Set((extraction.conflicts || []).map((row) => row.field));
  const visionKeyMap = {
    phone: ["advertiserPhoneRaw", "advertiserPhoneNormalized"],
    price: ["salePrice", "annualRent", "budget", "priceOrBudget"]
  };
  for (const [key, value] of Object.entries(groundedVision)) {
    if (value === null || value === undefined || String(value).trim() === "") continue;
    const conflicted = Object.entries(visionKeyMap).some(([field, keys]) => conflictFields.has(field) && keys.includes(key));
    if (conflicted || conflictFields.has(key)) continue;
    if (merged[key] === null || merged[key] === undefined || merged[key] === "") {
      merged[key] = value;
    }
  }
  return {
    brokerFields: merged,
    screenshotExtraction: extraction
  };
}

export function clearConflictedScreenshotFields(fields = {}, extraction = {}) {
  const next = { ...fields };
  for (const conflict of extraction.conflicts || []) {
    if (conflict.field === "price") {
      next.salePrice = null;
      next.annualRent = null;
      next.budget = null;
      next.priceOrBudget = null;
    } else if (conflict.field === "phone") {
      next.advertiserPhoneRaw = "";
      next.advertiserPhoneNormalized = "";
    } else if (conflict.field === "area") {
      next.area = null;
    } else if (conflict.field === "propertyType") {
      next.propertyType = "";
    } else if (conflict.field === "city") {
      next.city = "";
    } else if (conflict.field === "district") {
      next.district = "";
    }
  }
  return next;
}

export function applyScreenshotExtractionToReview(extraction, currentReview = {}, userEditedFields = {}) {
  const broker = screenshotSemanticsToBrokerFields(extraction);
  const fields = extraction.fields || {};
  const extras = {};
  const extraKeys = ["streetWidth", "streetDirection", "depth", "plotNumber", "locationUrl", "direction", "description"];
  for (const key of extraKeys) {
    const value = broker[key];
    if (value !== null && value !== undefined && value !== "") extras[key] = value;
  }
  const next = {
    opportunityKind: broker.opportunityKind || currentReview.opportunityKind || "OFFER",
    purpose: broker.purpose || currentReview.purpose || "",
    rawPropertyTypeText: broker.propertyType || "",
    rawCityText: broker.city || "",
    rawNeighborhoodText: broker.district || "",
    salePrice: broker.salePrice ?? "",
    annualRent: broker.annualRent ?? "",
    budget: broker.budget ?? "",
    area: broker.area ?? "",
    advertiserPhoneNormalized: broker.advertiserPhoneNormalized || "",
    advertiserPhoneLocal: fields.phone?.value || "",
    importExtraFields: { ...(currentReview.importExtraFields || {}), ...extras },
    direction: extras.direction || "",
    streetWidth: extras.streetWidth || "",
    streetDirection: extras.streetDirection || "",
    depth: extras.depth || "",
    plotNumber: extras.plotNumber || "",
    locationUrl: extras.locationUrl || "",
    inferredPrice: Boolean(broker.inferredPrice),
    extractionConflicts: extraction.conflicts || [],
    screenshotPhoneCandidates: extraction.phones || [],
    screenshotSourceType: extraction.sourceType,
    needsReview: { ...(extraction.needsReview || {}) }
  };
  if (fields.price?.inferredPrice && next.salePrice !== "") {
    next.needsReview.price = true;
    next.needsReview.salePrice = true;
  }
  const edited = userEditedFields && typeof userEditedFields === "object" ? userEditedFields : {};
  for (const [key, editedValue] of Object.entries(edited)) {
    if (key === "importExtraFields" && editedValue && typeof editedValue === "object") {
      next.importExtraFields = { ...next.importExtraFields, ...editedValue };
      continue;
    }
    next[key] = editedValue;
  }
  return next;
}

export const CURRENT_SCREENSHOT_EXAMPLE_TEXT = `أرض للبيع
حي السكب
المدينة المنورة
المساحة 1175م
شارع جنوبي 10م
الواجهة 25م
العمق 47م
رقم القطعة 14
المطلوب 850 صافي
للتواصل +966 53 089 9289
https://maps.app.goo.gl/sakkabLandExample`;

export const SCREENSHOT_LAYOUT_FIXTURES = Object.freeze({
  A: `+966 53 089 9289
أحمد
أرض للبيع حي السكب المدينة المنورة
المساحة 1175م شارع جنوبي 10م الواجهة 25م العمق 47م رقم القطعة 14
المطلوب 850 صافي
https://maps.app.goo.gl/layoutA`,
  B: `مجموعة السكب
أرض للبيع حي السكب المدينة المنورة المساحة 1175م
شارع جنوبي 10م الواجهة 25م العمق 47م رقم القطعة 14
المطلوب 850 صافي واتساب 0530899289
https://maps.app.goo.gl/layoutB`,
  C: `المطلوب 850 صافي
أرض حي السكب المدينة المنورة
1175م شارع جنوبي 10م الواجهة 25م العمق 47م القطعة 14
للتواصل 0530899289
https://maps.app.goo.gl/layoutC`,
  D: `عقار.كوم
أرض للبيع
حي السكب — المدينة المنورة
السعر 850000 ريال
المساحة 1175م
شارع جنوبي 10م الواجهة 25م العمق 47م رقم القطعة 14
https://maps.app.goo.gl/layoutD
تواصل معنا 0530899289`,
  E: `أرض للبيع حي السكب المدينة المنورة المساحة 1175م
المطلوب 850 صافي
للتواصل 0530899289
أو اتصال 0501234567
https://maps.app.goo.gl/layoutE`,
  F: `أرض للبيع حي السكب المدينة المنورة المساحة 1175م
السعر 850000 ريال
الحد 900000 ريال
شارع جنوبي 10م الواجهة 25م العمق 47م رقم القطعة 14
0530899289
https://maps.app.goo.gl/layoutF`
});

export const __test = {
  normalizeScreenshotText,
  classifyScreenshotSourceType,
  extractScreenshotPhoneCandidates,
  extractScreenshotPriceCandidates,
  extractScreenshotDimensions,
  extractScreenshotPropertyTypes,
  extractScreenshotPurpose,
  extractScreenshotCity,
  extractScreenshotDistrict,
  extractMapsLocationUrls,
  resolveSingleOrConflict
};
