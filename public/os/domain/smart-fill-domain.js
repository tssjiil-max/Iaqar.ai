/**
 * «تعبئة ذكية» — one shared understanding of a pasted ad or a free description, used by the public office
 * page, the office app («إضافة سريعة») and, through extractFacts, the Telegram office manager.
 *
 *   • Only what is written is taken: no city, district, price, name or phone is guessed.
 *   • The text is data, never instructions (it is only read with patterns here; a model, when one is set up
 *     on the Worker, only fills gaps and every value it gives is checked against the text).
 *   • The result has ONE shape (normalizeAnalysis) whether it came from the rules or the rules + a model.
 */

import { CITIES, detailLines, extractFacts } from "./visitor-domain.js";
import { PROPERTY_TYPES } from "./records-domain.js";

export const SMART_FILL_LIMITS = Object.freeze({ maxChars: 4000, minChars: 6, maxListings: 10 });
export const FILL_MODE = Object.freeze({ SMART: "smart", MANUAL: "manual" });
export const FILL_MODE_LABEL = Object.freeze({ smart: "تعبئة ذكية", manual: "تعبئة يدوية" });
export const URGENCY_LABEL = Object.freeze({ yes: "مستعجل", no: "غير مستعجل" });
export const INTAKE_CHANNELS = Object.freeze([
  { id: "WHATSAPP", label: "واتساب" }, { id: "TELEGRAM", label: "تيليجرام" }, { id: "CALL", label: "اتصال" }, { id: "OTHER", label: "أخرى" }
]);
export const INTAKE_ROLES = Object.freeze([
  { id: "OWNER", label: "مالك عقار" }, { id: "CLIENT", label: "عميل يبحث عن عقار" },
  { id: "EXTERNAL_BROKER", label: "وسيط متعاون" }, { id: "OFFICE", label: "المكتب نفسه" }
]);

const KINDS = ["OFFER", "REQUEST"];
const PURPOSES = { OFFER: ["SALE", "RENT"], REQUEST: ["PURCHASE", "LEASE_REQUEST"] };

export const toLatinDigits = (value) => String(value ?? "")
  .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
  .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
  .replace(/٫/g, ".").replace(/٬/g, ",");
const norm = (value) => String(value || "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ـ/g, "");

// ------------------------------------------------------------------ amounts: «مليونين»، «1.5 مليون»، «مليون ونص»، «500 ألف»

const WORD_UNITS = [
  [/(?:^|[\s،,])(?:مليونين|مليونان)(?=[\s،,.]|$)/, 2_000_000],
  [/(?:^|[\s،,])(?:ثلاث(?:ه)?|ثلاثه)\s+ملايين/, 3_000_000],
  [/(?:^|[\s،,])(?:اربع(?:ه)?)\s+ملايين/, 4_000_000],
  [/(?:^|[\s،,])(?:خمس(?:ه)?)\s+ملايين/, 5_000_000],
  [/(?:^|[\s،,])(?:نص|نصف)\s+مليون/, 500_000],
  [/(?:^|[\s،,])مليون\s*(?:و\s*)?(?:نص|نصف)/, 1_500_000],
  [/(?:^|[\s،,])مليون\s*(?:و\s*)?ربع/, 1_250_000],
  [/(?:^|[\s،,])(?:الفين|ألفين)(?=[\s،,.]|$)/, 2_000],
  [/(?:^|[\s،,]|ب)مليون(?=[\s،,.]|$)/, 1_000_000]
];
const PRICE_WORDS = /(سعر|السعر|بسعر|ميزاني|الميزاني|حدود|السوم|سوم|المطلوب|مطلوب\s+فيه|ريال|ر\.?س|قيمه|القيمه|الايجار\s+السنوي|ايجار\s+سنوي)/;

/** Amount in riyals written in the text, or 0. A phone number or an area is never read as a price. */
export function amountFrom(raw = "") {
  const text = norm(toLatinDigits(raw)).replace(/(\d),(?=\d{3}\b)/g, "$1");
  const clean = text.replace(/(?:\+?966|00966)?0?5\d{8}/g, " ");
  const candidates = [];
  // Compound amounts first: «مليون و900 ألف»، «2 مليون و500 ألف»، «مليونين و300 الف».
  const compound = /(?:(\d+(?:\.\d+)?)\s*(?:مليون|ملايين)|(مليونين|مليونان)|(?:^|[\s،,]|ب)(مليون))\s*و\s*(\d+)\s*(?:الف|الاف)/;
  const c = clean.match(compound);
  if (c) {
    const millions = c[1] ? Number(c[1]) : c[2] ? 2 : 1;
    const value = Math.round(millions * 1_000_000 + Number(c[4]) * 1000);
    if (value > 0) return value <= 10_000_000_000 ? value : 0;
  }
  const unitRe = /(\d+(?:\.\d+)?)\s*(مليون|ملايين|الف|الاف|k|m)(?![a-zء-ي])/gi;
  for (const m of clean.matchAll(unitRe)) {
    const n = Number(m[1]);
    if (!(n > 0)) continue;
    const big = /مليون|ملايين|^m$/i.test(m[2]);
    candidates.push({ at: m.index, value: Math.round(n * (big ? 1_000_000 : 1000)) + (big && /^\s*(?:و\s*)?(?:نص|نصف)/.test(clean.slice(m.index + m[0].length)) ? 500_000 : 0) });
  }
  for (const [re, value] of WORD_UNITS) {
    const m = clean.match(re);
    if (m && !candidates.some((c) => Math.abs(c.at - m.index) < 12)) candidates.push({ at: m.index, value });
  }
  if (!candidates.length) {
    // A plain number counts only next to a price word, and never next to an area unit.
    const plain = /(\d{3,}(?:\.\d+)?)/g;
    for (const m of clean.matchAll(plain)) {
      const before = clean.slice(Math.max(0, m.index - 22), m.index);
      const after = clean.slice(m.index + m[0].length, m.index + m[0].length + 8);
      if (/^\s*(م2|م²|متر|م\b|مربع)/.test(after)) continue;
      if (PRICE_WORDS.test(before) || /^\s*(ريال|ر\.?س)/.test(after)) candidates.push({ at: m.index, value: Math.round(Number(m[1])) });
    }
  }
  candidates.sort((a, b) => a.at - b.at);
  const value = candidates[0]?.value || 0;
  return value > 0 && value <= 10_000_000_000 ? value : 0;
}

// ------------------------------------------------------------------ offer or request, and what for

const REQUEST_STRONG = /(^|\s)(مطلوب|مطلوبه|ابحث|نبحث|ادور|ندور|ابغي|ابغا|نبغي|ابي|نبي|احتاج|نحتاج|محتاج|ودي|اريد|نريد|طالب)(\s|$)/;
const REQUEST_WEAK = /(^|\s)(للشراء|شراء|اشتري|نشتري|استئجار|استاجر|نستاجر|للاستئجار|طلب)(\s|$)/;
const OFFER_STRONG = /(^|\s)(للبيع|للايجار|للتاجير|عندي|عندنا|لدي|لدينا|متوفر|متوفره|يوجد|ابيع|نبيع|اؤجر|نؤجر|اجر|معروض|معروضه)(\s|$)/;
const OFFER_WEAK = /(^|\s)(بيع|عرض|تاجير|تمليك)(\s|$)/;

export function kindFrom(raw = "") {
  const t = norm(raw);
  const req = (REQUEST_STRONG.test(t) ? 2 : 0) + (REQUEST_WEAK.test(t) ? 1 : 0);
  const off = (OFFER_STRONG.test(t) ? 2 : 0) + (OFFER_WEAK.test(t) ? 1 : 0);
  // «مطلوب …» opening the text decides it (an ad that starts with what is wanted is a request).
  if (/^\s*(مطلوب|ابحث|ادور|ابغي|ابغا|ابي|نبي|احتاج)/.test(t)) return "REQUEST";
  if (req === off) return "";
  return req > off ? "REQUEST" : "OFFER";
}

export function purposeFrom(raw = "", kind = "") {
  const t = norm(raw);
  const rent = /(ايجار|للايجار|تاجير|للتاجير|اوجر|نوجر|اؤجر|استئجار|استاجر|نستاجر|للاستئجار|سنوي|شهري)/.test(t);
  const sale = /(للبيع|(^|\s)بيع|ابيع|نبيع|شراء|للشراء|اشتري|نشتري|تمليك)/.test(t);
  if (rent === sale) return "";
  if (kind === "OFFER") return rent ? "RENT" : "SALE";
  if (kind === "REQUEST") return rent ? "LEASE_REQUEST" : "PURCHASE";
  return "";
}

// ------------------------------------------------------------------ districts: «في شوران أو الهجرة أو الرانوناء»

const STOP_WORDS = new Set(["في", "فى", "ب", "و", "او", "أو", "مع", "من", "الى", "إلى", "على", "عند", "قريب", "جنب", "بجوار", "شارع", "طريق", "حدود", "الحدود",
  "الميزانيه", "ميزانيه", "الميزانية", "ميزانية", "السعر", "سعر", "بسعر", "شراء", "للشراء", "بيع", "للبيع", "ايجار", "للايجار", "استئجار", "مستعجل", "عاجل", "ضروري",
  "مساحه", "المساحه", "مساحة", "المساحة", "متر", "غرف", "غرفه", "غرفة", "الدور", "دور", "واجهه", "واجهة", "شمالي", "جنوبي", "شرقي", "غربي", "سنوي", "شهري",
  "المدينه", "المدينة", "مدينه", "مدينة", "منطقه", "منطقة", "جديد", "جديده", "جديدة", "مؤثث", "مفروش", "تواصل", "التواصل", "للتواصل", "جوال", "رقم", "واتساب", "او", "يكون", "تكون",
  "الحي", "حي", "احياء", "أحياء", "الاحياء", "الأحياء", "افضل", "يفضل", "ويفضل", "فقط", "كاش", "بنك", "تمويل", "عمر", "العمر", "سنه", "سنة", "سنوات", "تقريبا", "تقريبًا", "موقع", "مكان", "حاله", "وضع", "ممتاز", "ممتازه", "مميز", "مميزه", "نفس", "اي", "أي", "كل", "داخل", "خارج", "وسط", "شمال", "جنوب", "شرق", "غرب", "ايش", "وش"]);
const CITY_NORMS = CITIES.map(norm);
const CITY_ALIASES = { "المدينه": "المدينة المنورة", "المدينه المنوره": "المدينة المنورة", "مكه": "مكة المكرمة", "جده": "جدة" };
const TYPE_WORDS = /^(عقار|عقارات|شقه|شقق|فيلا|فله|فيلل|دوبلكس|ارض|اراضي|عماره|عمائر|محل|محلات|مكتب|استراحه|مستودع|غرفه|ملحق|بيت|منزل|قصر|مزرعه|شاليه)$/;

const STOP_PREFIX = /^(مساح|سعر|بسعر|السعر|ميزاني|الميزاني|بميزاني|تواصل|التواصل|للتواصل|واتس|الواتس|جوال|الجوال|كامل|الكامل|التقسيط|تقسيط|التمويل|الكاش|السوم|الشهر|السنه|اليوم|الاتفاق|التفاوض|مستعجل|عاجل|ضروري|غرف|صال|دور|حمام|مطبخ)/;
const isStop = (word) => STOP_WORDS.has(word) || STOP_WORDS.has(norm(word)) || STOP_PREFIX.test(norm(word)) || /\d/.test(word) || TYPE_WORDS.test(norm(word));
const isCityWord = (word) => CITY_NORMS.includes(norm(word)) || Boolean(CITY_ALIASES[norm(word)]) || CITY_NORMS.some((c) => c.startsWith(`${norm(word)} `));

function readNameAt(tokens, i) {
  const w = tokens[i];
  return Boolean(w && w !== "،" && !isStop(w) && !isCityWord(w) && /^[\u0621-\u064A\u0640]+$/.test(w));
}

export function districtsFrom(raw = "") {
  // «بالهجرة» = «في الهجرة» (a city such as «بالرياض» is still read as the city, never as a district).
  const tokens = toLatinDigits(raw).replace(/(^|\s)بال(?=[\u0621-\u064A]{2,})/g, "$1في ال").replace(/[.!؟?()«»"]/g, " ").replace(/[،,\/]/g, " ، ").replace(/\s+و(?=\S)/g, " و ").split(/\s+/).filter(Boolean);
  const out = [];
  const add = (name) => {
    const clean = name.replace(/^حي\s+/, "").trim();
    if (clean.length < 2 || out.some((d) => norm(d) === norm(clean))) return;
    out.push(clean);
  };
  const readName = (i) => {
    const w = tokens[i];
    if (!w || w === "،" || isStop(w) || isCityWord(w) || !/^[ء-يـ]+$/.test(w)) return { name: "", next: i };
    let name = w;
    let next = i + 1;
    const second = tokens[next];
    if (second && second !== "،" && !isStop(second) && !isCityWord(second) && /^[ء-ي]+$/.test(second)
      && (/^ال/.test(norm(second)) || /^(ابو|ام|بن|عبد)$/.test(norm(w)))) { name = `${w} ${second}`; next += 1; }
    return { name, next };
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const w = norm(tokens[i]);
    const fi = w === "في" || w === "فى";
    const nextOk = tokens[i + 1] && !isCityWord(tokens[i + 1]) && !isStop(tokens[i + 1]);
    // «في الهجرة» — or «في شوران أو الهجرة» (a name without «ال» counts when a list of names follows it).
    const listFollows = /^(او|،|و)$/.test(norm(tokens[i + 2] || "")) && Boolean(readNameAt(tokens, i + 3));
    const trigger = /^(حي|بحي|الحي|احياء|الاحياء|باحياء)$/.test(w) || (fi && nextOk && (/^ال/.test(norm(tokens[i + 1])) || listFollows))
      || ((w === "في" || w === "فى") && tokens[i + 1] && /^(حي|احياء)$/.test(norm(tokens[i + 1])));
    if (!trigger) continue;
    let j = i + 1;
    if (/^(حي|احياء)$/.test(norm(tokens[j] || ""))) j += 1;
    // A list: «شوران أو الهجرة أو الرانوناء»، «الملقا، النرجس والياسمين».
    for (let guard = 0; guard < 8; guard += 1) {
      const { name, next } = readName(j);
      if (!name) break;
      add(name);
      j = next;
      const sep = norm(tokens[j] || "");
      if (sep === "او" || sep === "و" || sep === "،") { j += 1; if (/^(حي)$/.test(norm(tokens[j] || ""))) j += 1; continue; }
      break;
    }
    i = Math.max(i, j - 1);
  }
  return out.slice(0, 6);
}

// ------------------------------------------------------------------ the rest

const FEATURES = [
  [/واجهه\s*(شماليه|جنوبيه|شرقيه|غربيه)/, (m) => `واجهة ${m[1].replace(/ه$/, "ة")}`], [/زاويه|ركنيه|على\s*شارعين/, () => "على شارعين أو زاوية"],
  [/مسبح/, () => "مسبح"], [/حديقه|حوش/, () => "حوش أو حديقة"], [/مدخل\s*خاص|مدخلين/, () => "مدخل خاص"], [/(^|\s)جديد(ه)?(\s|$)/, () => "جديد"],
  [/مؤجر(ه)?|دخل\s*سنوي|دخلها/, () => "مؤجر أو بدخل"], [/صك\s*الكتروني|صك/, () => "صك"], [/خادمه|غرفه\s*سائق/, () => "غرفة سائق أو خادمة"], [/سطح/, () => "سطح"]
];

export function urgencyFrom(raw = "") {
  const t = norm(raw);
  if (/(غير|مو|مش|ما\s*ني|مب)\s*مستعجل|على\s*راحت|مافي\s*عجله/.test(t)) return false;
  if (/مستعجل|عاجل|ضروري|باسرع\s*وقت|اسرع\s*وقت|فوري|خلال\s*(يوم|ايام|اسبوع)/.test(t)) return true;
  return null;
}

export function phoneFrom(raw = "") {
  const m = toLatinDigits(raw).replace(/[\s-]/g, "").match(/(?:\+?966|00966|0)?(5\d{8})(?!\d)/);
  return m ? `0${m[1]}` : "";
}

/** Several ads pasted together → one block per ad (blank lines, numbering, or a new «مطلوب/للبيع…» line). */
export function splitListings(raw = "") {
  const text = toLatinDigits(raw).replace(/\r/g, "").trim();
  if (!text) return [];
  const lines = text.split("\n");
  const blocks = [];
  let current = [];
  const flush = () => { const b = current.join("\n").trim(); if (b) blocks.push(b); current = []; };
  const starts = /^\s*(?:\d{1,2}\s*[-.)–]|[•\-*▪◾🔹🔸✅📍]|(?:مطلوب|للبيع|للإيجار|للايجار|عرض|طلب|يوجد|متوفر)(?:\s|:|$))/;
  for (const line of lines) {
    if (!line.trim()) { flush(); continue; }
    if (starts.test(line) && current.length && signals(current.join(" ")) >= 2) flush();
    current.push(line);
  }
  flush();
  const real = blocks.filter((b) => signals(b) >= 2);
  return (real.length > 1 ? real : [text]).slice(0, SMART_FILL_LIMITS.maxListings);
}

function signals(text) {
  const facts = extractFacts(text);
  return [facts.propertyType, kindFrom(text), amountFrom(text), districtsFrom(text).length, facts.area, facts.city].filter(Boolean).length;
}

const REQUIRED = ["kind", "purpose", "propertyType", "city", "district", "price"];
export const FIELD_LABEL = Object.freeze({
  kind: "عرض أو طلب", purpose: "نوع العملية", propertyType: "نوع العقار", city: "المدينة", district: "الحي", price: "السعر أو الميزانية",
  area: "المساحة", rooms: "الغرف", features: "المواصفات", urgent: "درجة الاستعجال", phone: "رقم الجوال"
});
const QUESTION = Object.freeze({
  kind: "هل هذا عرض (لديك عقار) أم طلب (تبحث عن عقار)؟", purpose: "هل هو بيع/شراء أم إيجار/استئجار؟", propertyType: "ما نوع العقار؟",
  city: "في أي مدينة؟", district: "في أي حي؟ (يمكن أكثر من حي)", price: "كم السعر أو الميزانية؟"
});

/** One ad → the unified shape. */
export function analyzeListing(raw = "") {
  const original = String(raw || "").slice(0, SMART_FILL_LIMITS.maxChars);
  const text = toLatinDigits(original);
  const facts = extractFacts(text);
  const kind = kindFrom(text);
  const typesSeen = PROPERTY_TYPES.filter((type) => new RegExp(`(^|\\s|ال)${norm(type).replace(/ه$/, "(ه|ات)?")}`).test(norm(text)));
  const districts = districtsFrom(text);
  if (!districts.length && facts.district && !isCityWord(facts.district)) districts.push(facts.district);
  const features = [...detailLines(facts)];
  for (const [re, label] of FEATURES) { const m = norm(text).match(re); if (m && !features.includes(label(m))) features.push(label(m)); }
  // A request with a written budget in the hundreds of thousands or more and no rent word reads as a purchase
  // (shown in the review and confirmed by the person, never saved on its own).
  const budget = amountFrom(text) || facts.price || 0;
  const impliedPurchase = kind === "REQUEST" && budget >= 500_000 && /ميزاني|حدود/.test(norm(text)) && !/(ايجار|استئجار|استاجر|تاجير|سنوي|شهري)/.test(norm(text)) ? "PURCHASE" : "";
  const listing = normalizeListing({
    kind,
    purpose: purposeFrom(text, kind) || impliedPurchase || (kind && facts.transactionType ? (kind === "OFFER" ? (facts.transactionType === "rent" ? "RENT" : "SALE") : (facts.transactionType === "rent" ? "LEASE_REQUEST" : "PURCHASE")) : ""),
    propertyType: facts.propertyType || "",
    city: facts.city || "",
    districts,
    area: facts.area || 0,
    price: amountFrom(text) || facts.price || 0,
    rooms: facts.rooms || 0,
    features,
    urgent: urgencyFrom(text),
    phone: phoneFrom(text),
    original
  });
  if (typesSeen.length > 1 && /(^|\s)(او|أو)(\s|$)/.test(text)) listing.notes = `أنواع مقبولة: ${typesSeen.join(" أو ")}`;
  return finish(listing);
}

function finish(listing) {
  const missing = REQUIRED.filter((key) => key === "district" ? !listing.districts.length : !listing[key]);
  listing.missing = missing;
  listing.questions = missing.slice(0, 2).map((key) => QUESTION[key]);
  listing.understood = Boolean(listing.propertyType || listing.price || listing.districts.length || (listing.kind && (listing.area || listing.city)));
  return listing;
}

/** The whole paste → { listings, notRealEstate }. `multi` false keeps the paste as one ad (the public page). */
export function analyzeText(raw = "", { multi = false } = {}) {
  const text = String(raw || "").trim();
  if (text.length < SMART_FILL_LIMITS.minChars) return { ok: false, error: "too_short", message: "اكتب تفاصيل أكثر أو الصق الإعلان كاملًا" };
  const truncated = text.length > SMART_FILL_LIMITS.maxChars;
  const blocks = multi ? splitListings(text.slice(0, SMART_FILL_LIMITS.maxChars)) : [text.slice(0, SMART_FILL_LIMITS.maxChars)];
  const listings = blocks.map(analyzeListing);
  const understood = listings.filter((l) => l.understood);
  // Public page: one ad at a time — say so when the paste plainly holds several.
  const several = !multi && splitListings(text).length > 1;
  return normalizeAnalysis({ ok: true, engine: "rules", listings: understood.length ? understood : listings.slice(0, 1), notRealEstate: !understood.length, several, truncated });
}

// ------------------------------------------------------------------ the one schema (rules, model, network): checked before use

const str = (v, max) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const num = (v, max) => { const n = Number(toLatinDigits(v).toString().replace(/[,\s]/g, "")); return n > 0 && n <= max ? Math.round(n) : 0; };

export function normalizeListing(input = {}) {
  const kind = KINDS.includes(input.kind) ? input.kind : "";
  const purpose = kind && PURPOSES[kind].includes(input.purpose) ? input.purpose : "";
  const type = str(input.propertyType, 40);
  return {
    kind,
    purpose,
    propertyType: PROPERTY_TYPES.includes(type) ? type : "",
    city: str(input.city, 60),
    districts: (Array.isArray(input.districts) ? input.districts : []).map((d) => str(d, 60)).filter((d) => d.length >= 2 && /^[\u0621-\u064A\u0640\s]+$/.test(d)).slice(0, 6),
    area: num(input.area, 10_000_000),
    price: num(input.price, 10_000_000_000),
    rooms: num(input.rooms, 50),
    features: (Array.isArray(input.features) ? input.features : []).map((f) => str(f, 60)).filter(Boolean).slice(0, 12),
    urgent: input.urgent === true ? true : input.urgent === false ? false : null,
    phone: /^05\d{8}$/.test(String(input.phone || "")) ? String(input.phone) : "",
    notes: str(input.notes, 300),
    original: String(input.original ?? "").slice(0, SMART_FILL_LIMITS.maxChars),
    missing: Array.isArray(input.missing) ? input.missing.filter((m) => REQUIRED.includes(m)) : [],
    questions: Array.isArray(input.questions) ? input.questions.map((q) => str(q, 160)).filter(Boolean).slice(0, 3) : [],
    understood: input.understood !== false
  };
}

export function normalizeAnalysis(input = {}) {
  if (!input || input.ok === false) return { ok: false, error: str(input?.error || "failed", 40), message: str(input?.message || "تعذر التحليل", 200) };
  return {
    ok: true,
    engine: input.engine === "rules+ai" ? "rules+ai" : "rules",
    ai: ["used", "not_configured", "failed", "skipped"].includes(input.ai) ? input.ai : "skipped",
    listings: (Array.isArray(input.listings) ? input.listings : []).slice(0, SMART_FILL_LIMITS.maxListings).map(normalizeListing).map((l) => finish(l)),
    notRealEstate: input.notRealEstate === true,
    several: input.several === true,
    truncated: input.truncated === true
  };
}

// ------------------------------------------------------------------ form helpers shared by the views

/** Districts typed in one box («الملقا، النرجس») → the first is the record's district, the others are kept in the description. */
export function splitDistrictInput(value = "") {
  const parts = String(value || "").split(/[،,\/]|\s+(?:او|أو)\s+/).map((p) => p.trim().replace(/^حي\s+/, "")).filter(Boolean);
  return { district: parts[0] || "", others: parts.slice(1, 6) };
}

export function notesWithDistricts(notes = "", others = []) {
  if (!others.length) return notes;
  const line = `أحياء مقبولة أيضًا: ${others.join("، ")}`;
  return String(notes || "").includes(line) ? notes : [line, notes].filter(Boolean).join(" — ").slice(0, 1000);
}

/** A record of THIS office that looks like the same ad (same kind, type and district, close price — or the same phone). */
export function similarRecords(listing = {}, records = []) {
  const districts = (listing.districts || []).map(norm);
  return records.filter((r) => {
    if (r.deletedAt || String(r.lifecycleStatus || "ACTIVE").toUpperCase() === "DELETED") return false;
    const kind = String(r.opportunityKind || r.kind || "").toUpperCase();
    if (listing.kind && kind && kind !== listing.kind) return false;
    if (listing.phone && String(r.contactPhone || r.phone || "").replace(/\D/g, "").endsWith(listing.phone.slice(1))) return true;
    const price = Number(r.price || r.priceOrBudget || r.budget || 0);
    const close = listing.price && price ? Math.abs(price - listing.price) / Math.max(price, listing.price) <= 0.05 : false;
    return Boolean(listing.propertyType) && norm(r.propertyType) === norm(listing.propertyType) && districts.includes(norm(r.district)) && close;
  }).slice(0, 3);
}

export function listingTitle(listing = {}) {
  const kind = listing.kind === "REQUEST" ? "طلب" : listing.kind === "OFFER" ? "عرض" : "";
  const purpose = { SALE: "للبيع", RENT: "للإيجار", PURCHASE: "للشراء", LEASE_REQUEST: "للاستئجار" }[listing.purpose] || "";
  return [kind, listing.propertyType, purpose, listing.districts?.[0] ? `في ${listing.districts.join(" أو ")}` : ""].filter(Boolean).join(" ") || "إعلان غير مكتمل";
}

/**
 * Where a record typed in the office came from («إضافة سريعة»): the channel, who wrote the ad, how it was filled,
 * and the original text (kept on the record for the office only). An ad from an external broker is a claim, never
 * an exclusive mandate or proof of ownership: the record waits for the office's cooperation review.
 */
export function intakeOriginFrom(input, { now = new Date() } = {}) {
  if (!input || typeof input !== "object") return null;
  const channel = INTAKE_CHANNELS.some((c) => c.id === input.channel) ? input.channel : input.channel === "PASTE" ? "PASTE" : "";
  const role = INTAKE_ROLES.some((r) => r.id === input.role) ? input.role : "";
  const method = input.method === "SMART_FILL" ? "SMART_FILL" : "MANUAL";
  const originalText = String(input.text || "").slice(0, SMART_FILL_LIMITS.maxChars);
  if (!channel && !role && method === "MANUAL") return null;
  return { channel: channel || "", role: role || "", method, originalText: method === "SMART_FILL" ? originalText : "", at: now.toISOString() };
}

export const EXTERNAL_BROKER_PENDING = Object.freeze({
  submitterRole: "EXTERNAL_BROKER", externalBrokerOffice: "", externalBrokerLicense: "", representationClaim: "", representationReference: "",
  representationStatus: "PENDING", cooperationStatus: "REQUESTED", commissionStatus: "NONE", contactType: "broker", advertiserRole: "BROKER",
  matchingReadiness: "NEEDS_COMPLETION"
});
