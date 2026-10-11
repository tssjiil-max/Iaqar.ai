/**
 * «الباحث عن الفرص» — pure rules shared by the office UI, the Worker and node:test (no DOM, no network).
 *
 *   • The scout is a lens over the office's own data and the sources the office is allowed to use. It never
 *     has its own understanding of an ad: every text goes through the shared «تعبئة ذكية» analysis
 *     (smart-fill-domain.js), and every fit is scored by the platform's matching engine (Worker side).
 *   • Three search modes that really behave differently — see MODE_CONFIG below; nothing else in the code
 *     decides cadence, depth, lifetime, alerts or model use.
 *   • Quality over quantity: a find reaches the broker only when it is strong AND reachable. Weak finds are
 *     dropped, medium ones wait silently, a find without a usable contact is kept for merging only.
 *   • The broker sees a level and reasons — never a number, a queue, a source log or a model call.
 */

import { cleanText, formatNumber, toDate, toNumber } from "./format-domain.js";
import { PROPERTY_TYPES, kindOf, recordTitle, transactionTypeFor } from "./records-domain.js";
import { extractFacts } from "./visitor-domain.js";
import { amountFrom, analyzeListing, districtsFrom, phoneFrom, splitListings, toLatinDigits } from "./smart-fill-domain.js";
import { MADINAH_ADJACENCY_BY_NAME } from "../../js/neighborhood-adjacency-data.js";

// ------------------------------------------------------------------ the three modes (the ONE place that tells them apart)

export const SCOUT_MODE = Object.freeze({ GENERAL: "GENERAL", DEEP: "DEEP", URGENT: "URGENT" });
export const BAND = Object.freeze({ WEAK: "WEAK", MEDIUM: "MEDIUM", STRONG: "STRONG", VERY_STRONG: "VERY_STRONG" });

/**
 * عام 24/7 — the office's standing radar: cheap, slow, exact, rules only, alerts only for the very best.
 * عميق    — one target studied for a day: many query forms, wider price and type, older ads, every known find
 *           re-checked each round, the model may fill gaps; it ends with a summary.
 * مستعجل  — first round immediately, then every scheduler beat for three days, neighbouring districts from the
 *           first round, an alert for every strong find; afterwards it keeps watching at the general pace.
 */
export const MODE_CONFIG = Object.freeze({
  GENERAL: Object.freeze({
    label: "عام 24/7", priority: 1, intervalMinutes: 360, inlineFirstRun: false,
    windowHours: 0, afterWindow: "", backfillDays: 7, itemsPerCycle: 25, queryVariants: 1,
    startRing: 0, expandAfterEmptyCycles: 3, priceTolerance: 0.10, relatedTypes: false,
    recheckEvery: 4, ai: Object.freeze({ allowed: false, perDay: 0 }),
    // Paid outside searches (web search, X): how often one search may ask, and how many query forms each time.
    metered: Object.freeze({ everyMinutes: 1440, queries: 1 }),
    notify: Object.freeze({ minBand: BAND.VERY_STRONG, throttled: true, summaryOnComplete: false, urgentTag: false })
  }),
  DEEP: Object.freeze({
    label: "عميق", priority: 2, intervalMinutes: 30, inlineFirstRun: false,
    windowHours: 24, afterWindow: "COMPLETE", backfillDays: 30, itemsPerCycle: 80, queryVariants: 6,
    startRing: 0, expandAfterEmptyCycles: 1, priceTolerance: 0.25, relatedTypes: true,
    recheckEvery: 1, ai: Object.freeze({ allowed: true, perDay: 30 }),
    metered: Object.freeze({ everyMinutes: 120, queries: 3 }),
    notify: Object.freeze({ minBand: BAND.VERY_STRONG, throttled: false, summaryOnComplete: true, urgentTag: false })
  }),
  URGENT: Object.freeze({
    label: "مستعجل", priority: 3, intervalMinutes: 5, inlineFirstRun: true,
    windowHours: 72, afterWindow: "DOWNGRADE", backfillDays: 14, itemsPerCycle: 40, queryVariants: 3,
    startRing: 1, expandAfterEmptyCycles: 0, priceTolerance: 0.15, relatedTypes: false,
    recheckEvery: 1, ai: Object.freeze({ allowed: true, perDay: 10 }),
    metered: Object.freeze({ everyMinutes: 60, queries: 2 }),
    notify: Object.freeze({ minBand: BAND.STRONG, throttled: false, summaryOnComplete: false, urgentTag: true })
  })
});

export const MODE_OPTIONS = Object.freeze([
  { id: SCOUT_MODE.GENERAL, label: "عام", hint: "مراقبة دائمة بدورات اقتصادية" },
  { id: SCOUT_MODE.DEEP, label: "عميق", hint: "دراسة هدف واحد بتوسع ليوم كامل" },
  { id: SCOUT_MODE.URGENT, label: "مستعجل", hint: "أول دورة فورًا وتنبيه لكل فرصة قوية" }
]);

/** «وتيرة البحث»: how often the office's general searches look. */
export const CADENCE_OPTIONS = Object.freeze([
  { id: 180, label: "كل 3 ساعات" }, { id: 360, label: "كل 6 ساعات" }, { id: 720, label: "كل 12 ساعة" }, { id: 1440, label: "مرة يوميًا" }
]);

export function modeOf(value) {
  const key = String(value || "").toUpperCase();
  return MODE_CONFIG[key] ? key : SCOUT_MODE.GENERAL;
}

/** The pace a task runs at right now (an urgent task past its window keeps watching at the general pace). */
export function taskCadence(task = {}, now = new Date(), settings = null) {
  const mode = modeOf(task.mode);
  const config = MODE_CONFIG[mode];
  // «وتيرة البحث» is the office's: it sets the pace of the general (24/7) searches only.
  const generalMinutes = CADENCE_OPTIONS.some((o) => o.id === Number(settings?.cadenceMinutes)) ? Number(settings.cadenceMinutes) : MODE_CONFIG.GENERAL.intervalMinutes;
  const until = toDate(task.intensiveUntil);
  const windowOver = Boolean(config.windowHours && until && until.getTime() <= now.getTime());
  if (windowOver && config.afterWindow === "COMPLETE") return { mode, config, windowOver, complete: true, intervalMinutes: 0, priority: config.priority };
  if (windowOver && config.afterWindow === "DOWNGRADE") {
    return { mode, config, windowOver, complete: false, downgraded: true, intervalMinutes: generalMinutes, priority: MODE_CONFIG.GENERAL.priority };
  }
  return { mode, config, windowOver: false, complete: false, intervalMinutes: mode === SCOUT_MODE.GENERAL ? generalMinutes : config.intervalMinutes, priority: config.priority };
}

// ------------------------------------------------------------------ what is searched for, and task states

export const SEEK = Object.freeze({ OFFER: "OFFER", REQUEST: "REQUEST", OWNER: "OWNER", ANY: "ANY" });
export const SEEK_OPTIONS = Object.freeze([
  { id: SEEK.OFFER, label: "عقار / عرض" },
  { id: SEEK.REQUEST, label: "مشتري / طلب" },
  { id: SEEK.OWNER, label: "مالك مباشر محتمل" },
  { id: SEEK.ANY, label: "فرصة عامة" }
]);
export const TX_OPTIONS = Object.freeze([{ id: "sale", label: "بيع" }, { id: "rent", label: "إيجار" }]);
export const FRESHNESS_OPTIONS = Object.freeze([
  { id: 1, label: "24 ساعة" }, { id: 2, label: "48 ساعة" }, { id: 7, label: "7 أيام" }, { id: 30, label: "30 يومًا" }
]);

export const TASK_STATUS = Object.freeze({ ACTIVE: "ACTIVE", PAUSED: "PAUSED", COMPLETED: "COMPLETED", ENDED: "ENDED" });
export const TASK_STATUS_LABEL = Object.freeze({ ACTIVE: "يعمل", PAUSED: "متوقف مؤقتًا", COMPLETED: "اكتمل", ENDED: "انتهى" });
export const TASK_ORIGIN = Object.freeze({ AUTO: "AUTO", RECORD: "RECORD", CUSTOM: "CUSTOM", DISCOVERY: "DISCOVERY" });
export const TASK_CONTROL = Object.freeze({ PAUSE: "PAUSE", RESUME: "RESUME", END: "END", RUN_NOW: "RUN_NOW", SET_MODE: "SET_MODE" });

/** Why a task stopped by itself — shown to the broker in plain words. */
export const END_REASON_LABEL = Object.freeze({
  RECORD_CLOSED: "أُغلق السجل المرتبط",
  RECORD_SOLD: "تم البيع أو التأجير أو وُجد العقار",
  RECORD_PAUSED: "السجل موقوف مؤقتًا",
  RECORD_EXPIRED: "انتهت مدة السجل",
  RECORD_MATCHED: "وُجد مقابل مناسب داخل مكتبك",
  DEEP_COMPLETE: "اكتمل البحث العميق",
  BROKER: "أنهاه الوسيط",
  SCOUT_OFF: "الباحث عن الفرص متوقف"
});

export const OPP_STATUS = Object.freeze({ NEW: "NEW", SAVED: "SAVED", CONTACTED: "CONTACTED", IGNORED: "IGNORED", CONVERTED: "CONVERTED" });
export const OPP_ACTION = Object.freeze({ CONTACT: "CONTACT", SAVE: "SAVE", IGNORE: "IGNORE", RESTORE: "RESTORE", CONVERTED: "CONVERTED", RECHECK: "RECHECK", FOLLOW_UP: "FOLLOW_UP", OUTCOME: "OUTCOME" });
export const OUTCOME_OPTIONS = Object.freeze([
  { id: "INTERESTED", label: "مهتم — نكمل معه" }, { id: "CALL_LATER", label: "طلب التواصل لاحقًا" }, { id: "NO_ANSWER", label: "لم يرد" }, { id: "NOT_INTERESTED", label: "غير مهتم أو غير متاح" }
]);
export const SURFACE = Object.freeze({ HIDDEN: "HIDDEN", SHOWN: "SHOWN" });

// ------------------------------------------------------------------ text helpers

export const normText = (value) => toLatinDigits(String(value || "")).toLowerCase()
  .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627").replace(/\u0629/g, "\u0647").replace(/\u0649/g, "\u064A").replace(/[\u064B-\u065F\u0670\u0640]/g, "")
  .replace(/\p{Extended_Pictographic}/gu, " ").replace(/[^\p{L}\p{N}\s.]/gu, " ").replace(/\s+/g, " ").trim();

export function normPhone(value) {
  const digits = toLatinDigits(String(value || "")).replace(/\D/g, "");
  const m = digits.match(/^(?:00966|966|0)?(5\d{8})$/);
  return m ? `0${m[1]}` : "";
}

export const normDistrict = (value) => normText(value).replace(/^حي\s+/, "").replace(/^ال(?=\S{3,})/, "").trim();

const TOKEN_STOP = new Set(["في", "من", "علي", "الي", "عن", "مع", "او", "و", "هذا", "هذه", "يوجد", "لدينا", "للتواصل", "تواصل", "واتساب", "جوال", "رقم", "ريال", "متر", "حي", "الحي"]);
export function tokenSet(text) {
  const out = new Set();
  for (const word of normText(text).split(" ")) {
    if (word.length < 2 || TOKEN_STOP.has(word) || /^0?5\d{8}$/.test(word)) continue;
    out.add(word);
    if (out.size >= 90) break;
  }
  return out;
}

/** Word overlap of two ads (0…1). Enough to recognise a repost; never used alone to merge different properties. */
export function textSimilarity(a, b) {
  const x = a instanceof Set ? a : tokenSet(a);
  const y = b instanceof Set ? b : tokenSet(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const word of x) if (y.has(word)) common += 1;
  return common / (x.size + y.size - common);
}

/** What is hashed to know «same content as last time» (spacing, emoji and digit script do not count as a change). */
export const contentKey = (text) => normText(text).slice(0, 2000);

// ------------------------------------------------------------------ districts: same → neighbouring → city

const ADJACENT = (() => {
  const map = new Map();
  const link = (a, b) => { if (!map.has(a)) map.set(a, new Set()); map.get(a).add(b); };
  for (const [name, neighbours] of Object.entries(MADINAH_ADJACENCY_BY_NAME)) {
    for (const other of neighbours) { link(normDistrict(name), other); link(normDistrict(other), name); }
  }
  return map;
})();

/** Documented neighbours only (the platform's adjacency table) — a name that merely looks similar is never a neighbour. */
export function adjacentDistricts(name) {
  return [...(ADJACENT.get(normDistrict(name)) || [])];
}

export const RING = Object.freeze({ SAME: 0, ADJACENT: 1, CITY: 2, UNKNOWN: 3 });

/** Where a found district sits relative to the wanted ones. */
export function districtRing(wanted = [], found = "") {
  const target = normDistrict(found);
  const list = (Array.isArray(wanted) ? wanted : [wanted]).map(normDistrict).filter(Boolean);
  if (!list.length) return { ring: RING.SAME, near: "" };
  if (!target) return { ring: RING.UNKNOWN, near: "" };
  if (list.includes(target)) return { ring: RING.SAME, near: "" };
  for (const district of Array.isArray(wanted) ? wanted : [wanted]) {
    if (adjacentDistricts(district).some((n) => normDistrict(n) === target)) return { ring: RING.ADJACENT, near: cleanText(district, 60) };
  }
  return { ring: RING.CITY, near: "" };
}

/** The furthest ring a task may look at now: its mode's start, widened only after empty rounds, the city only when allowed. */
export function allowedRing(task = {}) {
  const config = MODE_CONFIG[modeOf(task.mode)];
  const expanded = Number(task.emptyCycles || 0) >= config.expandAfterEmptyCycles && (config.expandAfterEmptyCycles > 0 || config.startRing > 0);
  const base = Math.max(config.startRing, Number(task.geoRing || 0), expanded ? RING.ADJACENT : RING.SAME);
  const cityWide = task.profile?.allowCityWide === true && Number(task.emptyCycles || 0) >= Math.max(2, config.expandAfterEmptyCycles * 2);
  return cityWide ? RING.CITY : Math.min(RING.ADJACENT, base);
}

// ------------------------------------------------------------------ office settings

export const QUALITY_OPTIONS = Object.freeze([
  { id: BAND.STRONG, label: "قوية فأعلى" },
  { id: BAND.VERY_STRONG, label: "قوية جدًا فقط" }
]);
/** «نوع الفرصة» the office wants discovered for it (its own records are always searched for, whatever is chosen here). */
export const KIND_OPTIONS = Object.freeze([{ id: "OFFER", label: "عروض" }, { id: "REQUEST", label: "طلبات" }]);
/** «حساسية التنبيهات»: from which level a general search alerts. */
export const ALERT_OPTIONS = Object.freeze([
  { id: BAND.VERY_STRONG, label: "القوية جدًا فقط" },
  { id: BAND.STRONG, label: "كل فرصة قوية" }
]);

const list = (value, max, each = 60) => (Array.isArray(value) ? value : String(value || "").split(/[،,\n]/))
  .map((item) => cleanText(item, each).replace(/^حي\s+/, "")).filter(Boolean).filter((item, i, all) => all.indexOf(item) === i).slice(0, max);

export function defaultScoutSettings(office = {}) {
  return {
    enabled: false, generalEnabled: true, city: cleanText(office.city, 60), districts: [], propertyTypes: [], purposes: ["sale", "rent"],
    priceMin: 0, priceMax: 0, areaMin: 0, areaMax: 0, kinds: ["OFFER", "REQUEST"], cadenceMinutes: MODE_CONFIG.GENERAL.intervalMinutes,
    preferDirectOwner: false, minQuality: BAND.STRONG, notify: true, alertLevel: BAND.VERY_STRONG, notifyPush: true, sources: {}
  };
}

/** Whatever was stored or typed → the settings the scout actually uses (unknown values fall back, never crash a run). */
export function normalizeScoutSettings(raw = {}, office = {}) {
  const base = defaultScoutSettings(office);
  const purposes = list(raw.purposes, 2).filter((p) => p === "sale" || p === "rent");
  const sources = {};
  for (const [id, on] of Object.entries(raw.sources && typeof raw.sources === "object" ? raw.sources : {})) {
    if (/^[a-z_]{2,30}$/.test(id)) sources[id] = on !== false;
  }
  const amount = (value, max) => { const n = Math.round(toNumber(value)); return n > 0 && n <= max ? n : 0; };
  let [priceMin, priceMax] = [amount(raw.priceMin, 10_000_000_000), amount(raw.priceMax, 10_000_000_000)];
  if (priceMin && priceMax && priceMin > priceMax) [priceMin, priceMax] = [priceMax, priceMin];
  let [areaMin, areaMax] = [amount(raw.areaMin, 10_000_000), amount(raw.areaMax, 10_000_000)];
  if (areaMin && areaMax && areaMin > areaMax) [areaMin, areaMax] = [areaMax, areaMin];
  const kinds = (Array.isArray(raw.kinds) ? raw.kinds : []).filter((k, i, all) => (k === "OFFER" || k === "REQUEST") && all.indexOf(k) === i);
  return {
    enabled: raw.enabled === true,
    generalEnabled: raw.generalEnabled !== false,
    priceMin, priceMax, areaMin, areaMax,
    kinds: kinds.length ? kinds : base.kinds,
    cadenceMinutes: CADENCE_OPTIONS.some((o) => o.id === Number(raw.cadenceMinutes)) ? Number(raw.cadenceMinutes) : base.cadenceMinutes,
    notify: raw.notify !== false,
    alertLevel: raw.alertLevel === BAND.STRONG ? BAND.STRONG : BAND.VERY_STRONG,
    city: cleanText(raw.city, 60) || base.city,
    districts: list(raw.districts, 12),
    propertyTypes: list(raw.propertyTypes, 11, 40).filter((t) => PROPERTY_TYPES.includes(t)),
    purposes: purposes.length ? purposes : base.purposes,
    preferDirectOwner: raw.preferDirectOwner === true,
    minQuality: raw.minQuality === BAND.VERY_STRONG ? BAND.VERY_STRONG : BAND.STRONG,
    notifyPush: raw.notifyPush !== false,
    sources
  };
}

// ------------------------------------------------------------------ search profiles

const TYPE_PLURALS = Object.freeze([
  [/(^|\s)(اراضي|اراض|ارضا|قطع ارض)(\s|$)/, "أرض"], [/(^|\s)(عمائر|عماير|عمارات)(\s|$)/, "عمارة"], [/(^|\s)(فلل|فيلل|فيلات)(\s|$)/, "فيلا"],
  [/(^|\s)(شقق)(\s|$)/, "شقة"], [/(^|\s)(محلات|معارض)(\s|$)/, "محل تجاري"], [/(^|\s)(مكاتب)(\s|$)/, "مكتب"], [/(^|\s)(استراحات)(\s|$)/, "استراحة"],
  [/(^|\s)(مستودعات)(\s|$)/, "مستودع"], [/(^|\s)(ادوار)(\s|$)/, "دور"], [/(^|\s)(تجاري|تجاريه)(\s|$)/, "محل تجاري"]
]);

export function propertyTypeFrom(text) {
  const t = normText(text);
  for (const [re, type] of TYPE_PLURALS) if (re.test(t)) return type;
  const found = extractFacts(text).propertyType || "";
  return PROPERTY_TYPES.includes(found) ? found : "";
}

/** Types close enough to be worth a look in a deep search (shown with a note, never as an exact fit). */
const RELATED_TYPES = Object.freeze({ "فيلا": ["دوبلكس", "دور"], "دوبلكس": ["فيلا"], "شقة": ["دور"], "دور": ["شقة", "دوبلكس"], "محل تجاري": ["مكتب"], "مكتب": ["محل تجاري"] });
export const relatedTypes = (type) => RELATED_TYPES[type] || [];

function cleanProfile(input = {}) {
  const price = (v) => { const n = toNumber(v); return n > 0 && n <= 10_000_000_000 ? Math.round(n) : 0; };
  let priceMin = price(input.priceMin);
  let priceMax = price(input.priceMax);
  if (priceMin && priceMax && priceMin > priceMax) [priceMin, priceMax] = [priceMax, priceMin];
  const area = (v) => { const n = toNumber(v); return n > 0 && n <= 10_000_000 ? Math.round(n) : 0; };
  const freshness = Math.round(toNumber(input.freshnessDays));
  return {
    tx: input.tx === "rent" ? "rent" : input.tx === "sale" ? "sale" : "",
    propertyTypes: list(input.propertyTypes ?? input.propertyType, 4, 40).filter((t) => PROPERTY_TYPES.includes(t)),
    city: cleanText(input.city, 60),
    districts: list(input.districts ?? input.district, 6),
    priceMin, priceMax,
    areaMin: area(input.areaMin), areaMax: area(input.areaMax),
    rooms: Math.max(0, Math.min(50, Math.round(toNumber(input.rooms)) || 0)),
    freshnessDays: freshness >= 1 && freshness <= 90 ? freshness : 0,
    preferDirectOwner: input.preferDirectOwner === true,
    ...(Array.isArray(input.kinds) && input.kinds.length === 1 && ["OFFER", "REQUEST"].includes(input.kinds[0]) ? { kinds: [input.kinds[0]] } : {}),
    allowCityWide: input.allowCityWide === true
  };
}

/** «+ بحث جديد»: the form or the understood sentence → a search the scout can run. */
export function validateCustomSearch(input = {}, { defaultCity = "" } = {}) {
  const errors = {};
  const seek = SEEK[String(input.seek || "").toUpperCase()] || SEEK.OFFER;
  const profile = cleanProfile({ ...input, city: input.city || defaultCity });
  if (!profile.tx && seek !== SEEK.ANY) errors.tx = "اختر بيع أو إيجار";
  if (!profile.propertyTypes.length && !profile.districts.length) errors.propertyTypes = "اختر نوع العقار أو اكتب الحي";
  if (!profile.city) errors.city = "اكتب المدينة";
  if (seek === SEEK.OWNER) profile.preferDirectOwner = true;
  return { ok: !Object.keys(errors).length, errors, value: { mode: modeOf(input.mode), seek, profile, nlText: cleanText(input.nlText, 600) } };
}

/** Other districts the client accepts, when the record's notes list them («أحياء مقبولة أيضًا: …»). */
function extraDistricts(notes = "") {
  const m = String(notes || "").match(/أحياء مقبولة أيضًا:\s*([^—\n]+)/);
  return m ? list(m[1], 5) : [];
}

/**
 * A record of the office → the search for its other side, read from the record itself (nothing is asked again):
 * an offer looks for buyers/tenants, a request looks for properties.
 */
export function profileFromRecord(record = {}) {
  const kind = kindOf(record);
  if (!kind) return null;
  const tx = transactionTypeFor(record.purpose) || (String(record.transactionType || "").toLowerCase() === "rent" ? "rent" : "sale");
  const price = toNumber(record.priceOrBudget ?? record.price ?? record.budget ?? record.salePrice ?? record.annualRent);
  const area = toNumber(record.area);
  const districts = [cleanText(record.district, 60).replace(/^حي\s+/, ""), ...(kind === "REQUEST" ? extraDistricts(record.notes || record.details) : [])].filter(Boolean);
  const profile = cleanProfile({
    tx, propertyTypes: [record.propertyType], city: record.city, districts,
    priceMin: kind === "REQUEST" ? toNumber(record.priceMin) : 0,
    priceMax: price,
    areaMin: area ? Math.round(area * 0.75) : 0, areaMax: area ? Math.round(area * 1.25) : 0,
    rooms: record.rooms
  });
  return { seek: kind === "OFFER" ? SEEK.REQUEST : SEEK.OFFER, recordKind: kind, profile, exactPrice: kind === "OFFER" ? price : 0 };
}

/** The office's standing interests (settings) → the discovery search that runs with no record behind it. */
export function discoveryProfile(settings = {}) {
  return cleanProfile({
    tx: settings.purposes?.length === 1 ? settings.purposes[0] : "", propertyTypes: settings.propertyTypes, city: settings.city, districts: settings.districts, preferDirectOwner: settings.preferDirectOwner,
    priceMin: settings.priceMin, priceMax: settings.priceMax, areaMin: settings.areaMin, areaMax: settings.areaMax, kinds: settings.kinds
  });
}

const TX_WORD = { sale: "للبيع", rent: "للإيجار" };
const TYPE_PLURAL_LABEL = { "أرض": "أراضٍ", "عمارة": "عمائر", "فيلا": "فلل", "شقة": "شقق", "دور": "أدوار", "دوبلكس": "دوبلكسات", "محل تجاري": "محلات تجارية", "مكتب": "مكاتب", "استراحة": "استراحات", "مستودع": "مستودعات", "غرفة": "غرف" };

export function profileSummary(profile = {}, seek = SEEK.OFFER) {
  const types = (profile.propertyTypes || []).map((t) => TYPE_PLURAL_LABEL[t] || t).join(" أو ") || "عقارات";
  const where = (profile.districts || []).length ? `في ${profile.districts.join(" أو ")}` : profile.city ? `في ${profile.city}` : "";
  const price = profile.priceMax ? `حتى ${formatNumber(profile.priceMax)}` : profile.priceMin ? `من ${formatNumber(profile.priceMin)}` : "";
  const tx = TX_WORD[profile.tx] || "";
  if (seek === SEEK.REQUEST) return [`طلبات ${profile.tx === "rent" ? "استئجار" : "شراء"} ${types}`, where, price].filter(Boolean).join(" ");
  if (seek === SEEK.OWNER) return [`ملاك ${types}`, tx, where, price].filter(Boolean).join(" ");
  if (seek === SEEK.ANY) return ["فرص جديدة", types !== "عقارات" ? types : "", where].filter(Boolean).join(" ");
  return [types, tx, where, price].filter(Boolean).join(" ");
}

export function taskTitle(task = {}, record = null) {
  if (task.origin === TASK_ORIGIN.DISCOVERY) return "اكتشاف فرص جديدة لمكتبك";
  if (record) return kindOf(record) === "OFFER" ? `مشترٍ محتمل لـ«${recordTitle(record)}»` : `عقار مناسب لـ«${recordTitle(record)}»`;
  return cleanText(task.title, 160) || profileSummary(task.profile, task.seek);
}

// ------------------------------------------------------------------ «ماذا تريد أن أبحث لك عنه؟»

const NOT_A_DISTRICT = /^(بحد|حد|حتي|اقصي|بسعر|سعر|ميزانيه|بميزانيه|ويفضل|يفضل|مباشره|المالك|مالك|مستعجل|بشكل|بعمق|فقط|تقريبا)(\s|$)/;
const AMOUNT_UP_TO = /(حتي|لحد|الي حد|بحد اقصي|حد اقصي|لا يتجاوز|ما يتجاوز|اقل من|في حدود|بحدود|حدود|ميزاني)/;
const AMOUNT_FROM = /(لا يقل عن|ما يقل عن|اكثر من|فوق|يبدا من|تبدا من)/;

/**
 * One sentence from the broker → mode, what to look for, operation, type, districts, price and the direct-owner
 * preference. Only what is written is taken (the shared analysis); a missing essential is named, never guessed.
 */
export function parseScoutCommand(raw = "") {
  const original = String(raw || "").slice(0, 600);
  const t = ` ${normText(original)} `;
  const mode = /(مستعجل|عاجل|ضروري|فورا|فوري|باسرع وقت|اسرع وقت)/.test(t) ? SCOUT_MODE.URGENT
    : /(بعمق|عميق|معمق|بتوسع|موسع|شامل|دراسه)/.test(t) ? SCOUT_MODE.DEEP : SCOUT_MODE.GENERAL;
  const preferDirectOwner = /(من المالك|مالك مباشر|المالك مباشره|بدون وسطاء|بدون وسيط|بلا وسطاء)/.test(t);
  // «ابحث عن مشترين / أشخاص يبحثون عن…» looks for requests; «عميل يريد عمارة» is the office's own client → it looks for offers.
  const seek = /( ملاك | مالكين | اصحاب (ال)?(اراضي|عقارات|عمائر|فلل|شقق) )/.test(t) ? SEEK.OWNER
    : /( اشخاص | ناس | عملاء | مشترين | مستاجرين | طلبات | طلب شراء | طلب استئجار | يبحثون | يدورون | يبغون | يبون )|عن (مشتري|مستاجر) /.test(t) ? SEEK.REQUEST
      : /( فرص | فرصه )/.test(t) && !propertyTypeFrom(original) ? SEEK.ANY : SEEK.OFFER;
  const rent = /(ايجار|للايجار|تاجير|استئجار|مستاجر)/.test(t);
  const sale = /(للبيع| بيع |شراء|مشتري|تمليك)/.test(t);
  const tx = rent && !sale ? "rent" : sale && !rent ? "sale" : "";
  const facts = extractFacts(original);
  // A list of districts ends where the sentence turns to the price or a preference («…أو الهجرة، بحد أقصى مليونين»).
  const districts = districtsFrom(original).filter((name) => !NOT_A_DISTRICT.test(normText(name)));
  if (!districts.length && facts.district && !NOT_A_DISTRICT.test(normText(facts.district))) districts.push(facts.district);
  const amount = amountFrom(original);
  // «من 1 مليون إلى 2 مليون»: both ends; one amount is a ceiling unless the sentence says «أكثر من / لا يقل عن».
  const range = t.match(/من\s+(\S+(?:\s+(?:مليون|الف|ملايين))?)\s+(?:الي|ل)\s+(\S+(?:\s+(?:مليون|الف|ملايين))?)/);
  let priceMin = 0;
  let priceMax = 0;
  if (range && amountFrom(`بسعر ${range[1]}`) && amountFrom(`بسعر ${range[2]}`)) {
    priceMin = amountFrom(`بسعر ${range[1]}`); priceMax = amountFrom(`بسعر ${range[2]}`);
  } else if (amount) {
    if (!AMOUNT_UP_TO.test(t) && AMOUNT_FROM.test(t)) priceMin = amount; else priceMax = amount;
  }
  const freshnessDays = /(24 ساعه|اخر يوم|اليوم)/.test(t) ? 1 : /(48 ساعه|يومين)/.test(t) ? 2 : /(اسبوع|7 ايام)/.test(t) ? 7 : 0;
  const propertyType = propertyTypeFrom(original);
  const understood = Boolean(propertyType || districts.length || amount);
  const missing = [];
  if (!propertyType && !districts.length) missing.push("propertyTypes");
  if (!tx && seek !== SEEK.ANY) missing.push("tx");
  return {
    ok: understood, mode, seek, tx, propertyTypes: propertyType ? [propertyType] : [], city: facts.city || "", districts: districts.slice(0, 6),
    priceMin, priceMax, areaMin: facts.area ? Math.round(facts.area * 0.75) : 0, areaMax: facts.area ? Math.round(facts.area * 1.25) : 0,
    preferDirectOwner: preferDirectOwner || seek === SEEK.OWNER, freshnessDays, missing, nlText: original.trim()
  };
}

// ------------------------------------------------------------------ query plan (what a round actually asks for)

/**
 * The query forms of one round. A general round asks once, exactly; an urgent one adds the neighbouring districts
 * and a wider price; a deep one also asks per district, for close property types and for older ads.
 * Local pools are filtered with the union of these forms; a licensed feed gets one request per form.
 */
export function planQueries(task = {}) {
  const config = MODE_CONFIG[modeOf(task.mode)];
  const profile = task.profile || {};
  const ring = allowedRing(task);
  const districts = (profile.districts || []).slice(0, 6);
  const near = ring >= RING.ADJACENT ? [...new Set(districts.flatMap(adjacentDistricts))].filter((d) => !districts.map(normDistrict).includes(normDistrict(d))) : [];
  const types = (profile.propertyTypes || []).slice(0, 4);
  const widen = (ratio) => ({ priceMin: profile.priceMin ? Math.round(profile.priceMin * (1 - ratio)) : 0, priceMax: profile.priceMax ? Math.round(profile.priceMax * (1 + ratio)) : 0 });
  const base = { seek: task.seek || "", tx: profile.tx || "", city: profile.city || "", districts, propertyTypes: types, ...widen(0), freshnessDays: profile.freshnessDays || config.backfillDays, preferDirectOwner: profile.preferDirectOwner === true };
  const forms = [{ id: "exact", ...base }];
  if (near.length) forms.push({ id: "adjacent", ...base, districts: near });
  if (config.priceTolerance > 0.10 && (profile.priceMin || profile.priceMax)) forms.push({ id: "price", ...base, ...widen(config.priceTolerance) });
  if (config.relatedTypes) {
    const related = [...new Set(types.flatMap(relatedTypes))].filter((type) => !types.includes(type));
    if (related.length) forms.push({ id: "related", ...base, propertyTypes: related });
    for (const district of districts.slice(0, 2)) if (districts.length > 1) forms.push({ id: `district:${district}`, ...base, districts: [district] });
    forms.push({ id: "older", ...base, freshnessDays: Math.max(base.freshnessDays, config.backfillDays) });
  }
  if (ring >= RING.CITY) forms.push({ id: "city", ...base, districts: [] });
  return forms.slice(0, config.queryVariants + (ring >= RING.CITY ? 1 : 0));
}

/**
 * A query form in the words people write ads with — for a web search or a posts search. The price is left out on
 * purpose (search engines match numbers badly); it is judged afterwards on what comes back.
 *   offer for sale   «أرض للبيع حي الحمراء المدينة المنورة»
 *   a buyer          «مطلوب أرض للشراء حي الحمراء المدينة المنورة»
 */
export function webQueryText(form = {}) {
  const rent = form.tx === "rent";
  const type = (form.propertyTypes || [])[0] || "عقار";
  const wanted = form.seek === SEEK.REQUEST;
  const districts = (form.districts || []).slice(0, 2).map((d) => `حي ${d}`).join(" أو ");
  const intent = wanted ? `مطلوب ${type} ${rent ? "للإيجار" : "للشراء"}` : `${type} ${rent ? "للإيجار" : "للبيع"}`;
  const owner = !wanted && (form.seek === SEEK.OWNER || form.preferDirectOwner) ? "من المالك مباشرة" : "";
  return [intent, districts, form.city || "", owner].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 160);
}

/** The same form for a posts search (X): exact words, Arabic posts only, no reposts. */
export function postsQueryText(form = {}) {
  const rent = form.tx === "rent";
  const type = (form.propertyTypes || [])[0] || "";
  const district = (form.districts || [])[0] || "";
  const place = district || form.city || "";
  const intent = form.seek === SEEK.REQUEST ? "مطلوب" : rent ? "(للإيجار OR للايجار)" : "للبيع";
  return [type ? `"${type}"` : "", place ? `"${place}"` : "", intent, "lang:ar -is:retweet -is:reply"].filter(Boolean).join(" ").slice(0, 400);
}

const INDEX_PAGE = /^(?:أراضي|اراضي|شقق|فلل|عمائر|عماير|محلات|مكاتب|مزارع|استراحات|عقارات|بيوت|أدوار|ادوار|مستودعات)\s|\d+\s*(?:إعلان|اعلان|عقار|نتيجة|عرض)(?:\s|$)|أفضل\s+\d+|دليل\s/;
/** A results page («شقق للبيع في … — 250 إعلان») is a list of ads, not an ad: it is never a find. */
export function looksLikeListingIndex(title = "") {
  return INDEX_PAGE.test(String(title || "").trim());
}

/** A cheap first look at a message from a group: is it a property ad at all? (Chatter never reaches the scout.) */
export function looksLikeAd(value = "") {
  const body = String(value || "").trim();
  if (body.length < 25 || body.length > 4000) return false;
  const candidate = candidateFromRaw({ text: body });
  return candidate.understood && Boolean(candidate.kind) && Boolean(candidate.propertyType) && Boolean(candidate.price || candidate.area || candidate.district);
}

// ------------------------------------------------------------------ a found ad → a candidate

const PLACEHOLDER_PRICES = new Set([1, 11, 111, 1111, 11111, 111111, 123, 1234, 12345, 123456, 999999999]);

/** Several ads pasted or forwarded together → one block per ad (longer digests than «إضافة سريعة» accepts). */
export function splitDigest(raw = "", { max = 40 } = {}) {
  const text = String(raw || "").replace(/\r/g, "").trim();
  if (!text) return [];
  const out = [];
  let chunk = "";
  const flush = () => { if (chunk.trim()) out.push(...splitListings(chunk)); chunk = ""; };
  for (const paragraph of text.split(/\n\s*\n/)) {
    if (chunk.length + paragraph.length > 3200) flush();
    chunk += `${paragraph}\n\n`;
  }
  flush();
  return out.map((block) => block.trim()).filter((block) => block.length >= 12).slice(0, max);
}

/**
 * One raw item of a source → the candidate the scout scores. Structured fields a licensed source supplies win over
 * what the text analysis reads; everything else comes from the shared analysis only.
 */
export function candidateFromRaw(raw = {}, analysis = null) {
  const text = String(raw.text || "").slice(0, 2000);
  const listing = analysis || analyzeListing(text);
  const given = raw.structured && typeof raw.structured === "object" ? raw.structured : {};
  const kind = ["OFFER", "REQUEST"].includes(given.kind) ? given.kind : listing.kind || "";
  const purpose = given.purpose || listing.purpose || "";
  const tx = given.tx === "rent" || given.tx === "sale" ? given.tx : transactionTypeFor(purpose) || "";
  let price = toNumber(given.price) || listing.price || 0;
  const badPrice = PLACEHOLDER_PRICES.has(price);
  if (badPrice) price = 0;
  const type = PROPERTY_TYPES.includes(given.propertyType) ? given.propertyType : listing.propertyType || "";
  const districts = given.district ? [cleanText(given.district, 60)] : (listing.districts || []);
  const phone = normPhone(raw.phone) || normPhone(given.phone) || phoneFrom(text);
  const known = [kind, tx, type, districts[0], price].filter(Boolean).length;
  return {
    sourceId: String(raw.sourceId || ""), externalId: String(raw.externalId || ""), url: /^https:\/\//.test(String(raw.url || "")) ? String(raw.url).slice(0, 500) : "",
    kind, purpose, tx, propertyType: type, city: cleanText(given.city, 60) || listing.city || "", district: districts[0] || "", districts: districts.slice(0, 6),
    price, area: toNumber(given.area) || listing.area || 0, rooms: toNumber(given.rooms) || listing.rooms || 0,
    phone, contactName: cleanText(raw.contactName, 80), contactRoute: /^https:\/\//.test(String(raw.contactRoute || "")) ? String(raw.contactRoute).slice(0, 500) : "",
    title: cleanText(raw.title, 160), text, features: (listing.features || []).slice(0, 8),
    publishedAt: toDate(raw.publishedAt)?.toISOString() || "", advertiserHint: String(raw.advertiserHint || "").toUpperCase(),
    // How much of the core was read: 5 fields → 1.0. A source that gives structured fields is trusted for them.
    confidence: Math.min(1, known / 5 + (Object.keys(given).length ? 0.1 : 0)), badPrice, understood: listing.understood !== false && known >= 2
  };
}

// ------------------------------------------------------------------ who wrote the ad (never «the owner» without a sign of it)

export const ADVERTISER = Object.freeze({ OWNER_HIGH: "OWNER_HIGH", OWNER_MEDIUM: "OWNER_MEDIUM", UNCLEAR: "UNCLEAR", BROKER_LIKELY: "BROKER_LIKELY" });
export const ADVERTISER_LABEL = Object.freeze({
  OWNER_HIGH: "مرجّح مالك مباشر — ثقة مرتفعة", OWNER_MEDIUM: "مرجّح مالك مباشر — ثقة متوسطة", UNCLEAR: "صفة المعلن غير واضحة", BROKER_LIKELY: "وسيط محتمل"
});
const DIRECT_STRONG = /(من المالك|المالك مباشره|مباشره من المالك|انا المالك|بدون وسطاء|بدون وسيط|بلا وسطاء|بدون سعي|لا يوجد سعي|بدون عموله|صاحب العقار)/;
const DIRECT_SOFT = /( ملكي | بيتي | ارضي | شقتي | فيلتي | عمارتي | للورثه | ورثه | لي شخصيا | لنفسي | لاخوي | لوالدي )/;
const BROKER_SIGNS = /(للعقارات|العقاريه|مكتب عقار|مؤسسه|شركه|وسيط|مسوق|للتسويق|السعي|عموله|رخصه فال|ترخيص فال|ترخيص الاعلان|رقم الترخيص|عروض اخري|لدينا عروض|عملائنا|عميل جاد|عميل كاش|لعميل|مفوض|وكيل)/;

/** `repeat` = how many other finds of this office carry the same number (an owner rarely has many). */
export function classifyAdvertiser(candidate = {}, { repeat = 0 } = {}) {
  const t = ` ${normText(candidate.text)} `;
  const reasons = [];
  if (candidate.advertiserHint === "BROKER" || candidate.advertiserHint === "OFFICE") return { kind: ADVERTISER.BROKER_LIKELY, reasons: ["المصدر يصنّف المعلن وسيطًا أو مكتبًا"] };
  const broker = BROKER_SIGNS.test(t);
  const strong = DIRECT_STRONG.test(t);
  const soft = DIRECT_SOFT.test(t);
  if (broker) reasons.push("صياغة مكتب أو وسيط في الإعلان");
  if (repeat >= 3) reasons.push("الرقم نفسه على عدة إعلانات");
  if (broker || repeat >= 3) return { kind: strong && !broker ? ADVERTISER.UNCLEAR : ADVERTISER.BROKER_LIKELY, reasons };
  if (candidate.advertiserHint === "OWNER") return { kind: ADVERTISER.OWNER_HIGH, reasons: ["المصدر يصنّف المعلن مالكًا"] };
  if (strong) return { kind: repeat === 0 ? ADVERTISER.OWNER_HIGH : ADVERTISER.OWNER_MEDIUM, reasons: ["الإعلان يذكر أنه من المالك مباشرة", ...(repeat ? ["للرقم إعلان آخر"] : [])] };
  if (soft) return { kind: ADVERTISER.OWNER_MEDIUM, reasons: ["صياغة شخصية توحي بأنه صاحب العقار"] };
  return { kind: ADVERTISER.UNCLEAR, reasons: ["لا توجد إشارة كافية لصفة المعلن"] };
}

// ------------------------------------------------------------------ same property or request seen twice?

const close = (a, b, ratio) => a > 0 && b > 0 && Math.abs(a - b) / Math.max(a, b) <= ratio;

/**
 * Do two finds describe the same thing? Compared on kind, operation and type first; then the phone, the district,
 * the price and area, and the wording. Two different properties of one advertiser stay two finds.
 */
export function sameEntity(a = {}, b = {}) {
  if (a.kind && b.kind && a.kind !== b.kind) return { same: false };
  if (a.tx && b.tx && a.tx !== b.tx) return { same: false };
  if (a.propertyType && b.propertyType && a.propertyType !== b.propertyType) return { same: false };
  const wordsA = a.tokens instanceof Set ? a.tokens : tokenSet(a.text);
  const wordsB = b.tokens instanceof Set ? b.tokens : tokenSet(b.text);
  const sim = textSimilarity(wordsA, wordsB);
  // Two short ads share most of their words by chance («مطلوب عمارة في شوران»): wording alone counts only for a full ad.
  const rich = Math.min(wordsA.size, wordsB.size) >= 10;
  const sameDistrict = Boolean(a.district && b.district && normDistrict(a.district) === normDistrict(b.district));
  const otherDistrict = Boolean(a.district && b.district && !sameDistrict);
  const bothPriced = Boolean(a.price && b.price);
  const priceClose = close(a.price, b.price, 0.05);
  if (a.phone && b.phone) {
    // Another number: only an almost identical full text at the same price is the same ad. The same number: the same
    // ad when the wording, or the place and the price, agree — two different properties of one advertiser stay two finds.
    if (a.phone !== b.phone) return sim >= 0.9 && rich && (!bothPriced || close(a.price, b.price, 0.03)) ? { same: true, by: "text" } : { same: false };
    if (sim >= 0.5) return { same: true, by: "phone" };
    if (sameDistrict && (priceClose || !bothPriced || close(a.price, b.price, 0.30))) return { same: true, by: "phone" };
    if (!otherDistrict && (priceClose || !bothPriced)) return { same: true, by: "phone" };
    return { same: false };
  }
  if (sim >= 0.8 && rich && !otherDistrict && (!bothPriced || close(a.price, b.price, 0.30))) return { same: true, by: "text" };
  const areaOk = !(a.area && b.area) || close(a.area, b.area, 0.05);
  // The same place with the price moved (a reduced price is the usual case): the wording must be almost the same.
  if (sameDistrict && areaOk && sim >= 0.6 && close(a.price, b.price, 0.30)) return { same: true, by: "attributes" };
  return sameDistrict && close(a.price, b.price, 0.03) && areaOk && sim >= 0.3 ? { same: true, by: "attributes" } : { same: false };
}

/**
 * A new sighting folded into the find already kept: sources are united, what was missing is filled, and what
 * changed (price, contact, wording) is listed so the find can be judged again.
 */
export function mergeSighting(existing = {}, candidate = {}, { now = new Date(), sourceLabel = "" } = {}) {
  const at = now.toISOString();
  const next = { ...existing };
  const changes = [];
  const sources = Array.isArray(existing.sources) ? existing.sources.map((s) => ({ ...s })) : [];
  const ref = `${candidate.sourceId}|${candidate.externalId}`;
  const known = sources.find((s) => `${s.sourceId}|${s.ref}` === ref);
  if (known) known.lastSeenAt = at;
  else sources.push({ sourceId: candidate.sourceId, label: sourceLabel, ref: candidate.externalId, url: candidate.url || "", firstSeenAt: at, lastSeenAt: at });
  next.sources = sources.slice(0, 12);
  next.sourceCount = new Set(next.sources.map((s) => s.sourceId)).size;
  if (candidate.price && existing.price && candidate.price !== existing.price) { changes.push({ at, field: "price", from: existing.price, to: candidate.price }); next.price = candidate.price; }
  if (!existing.phone && candidate.phone) { changes.push({ at, field: "contact", from: "", to: "phone" }); next.phone = candidate.phone; }
  else if (existing.phone && candidate.phone && existing.phone !== candidate.phone && known) { changes.push({ at, field: "contact", from: "phone", to: "phone" }); next.phone = candidate.phone; }
  if (!existing.contactRoute && candidate.contactRoute) { next.contactRoute = candidate.contactRoute; if (!next.phone) changes.push({ at, field: "contact", from: "", to: "route" }); }
  if (known && candidate.text && textSimilarity(existing.text, candidate.text) < 0.9) { changes.push({ at, field: "description", from: "", to: "" }); next.text = candidate.text; }
  for (const key of ["kind", "purpose", "tx", "propertyType", "city", "district", "area", "rooms", "price", "contactName", "title", "url"]) {
    if (!next[key] && candidate[key]) next[key] = candidate[key];
  }
  if (!next.text) next.text = candidate.text || "";
  if (candidate.publishedAt && (!next.publishedAt || candidate.publishedAt > next.publishedAt)) next.publishedAt = candidate.publishedAt;
  next.lastSeenAt = at;
  next.changes = [...(Array.isArray(existing.changes) ? existing.changes : []), ...changes].slice(-12);
  return { next, changes, newSource: !known };
}

// ------------------------------------------------------------------ quality (the part of the score that is not «fit»)

export const BAND_MIN = Object.freeze({ VERY_STRONG: 82, STRONG: 66, MEDIUM: 48 });
export const BAND_LABEL = Object.freeze({ WEAK: "ضعيفة", MEDIUM: "متوسطة", STRONG: "قوية", VERY_STRONG: "قوية جدًا" });
const BAND_RANK = Object.freeze({ WEAK: 0, MEDIUM: 1, STRONG: 2, VERY_STRONG: 3 });
export const bandRank = (band) => BAND_RANK[band] ?? 0;
export function bandOf(score) {
  const n = Number(score) || 0;
  return n >= BAND_MIN.VERY_STRONG ? BAND.VERY_STRONG : n >= BAND_MIN.STRONG ? BAND.STRONG : n >= BAND_MIN.MEDIUM ? BAND.MEDIUM : BAND.WEAK;
}

/** A reachable find has a number, or the contact route a licensed source gives. Nothing else counts. */
export const isContactable = (entity = {}) => Boolean(normPhone(entity.phone) || entity.contactRoute);

export function freshness(entity = {}, now = new Date()) {
  // «نُشرت» only when the source gave a publication time; otherwise it is when the scout first saw it («رُصدت»).
  const published = toDate(entity.publishedAt);
  const at = published || toDate(entity.firstSeenAt);
  if (!at) return { hours: null, points: 4, label: "" };
  const hours = Math.max(0, (now.getTime() - at.getTime()) / 3_600_000);
  const points = hours <= 24 ? 10 : hours <= 48 ? 8 : hours <= 168 ? 6 : hours <= 336 ? 3 : hours <= 720 ? 1 : 0;
  const verb = published ? "نُشرت" : "رُصدت";
  const label = hours <= 24 ? `${verb} خلال 24 ساعة` : hours <= 48 ? `${verb} خلال يومين` : hours <= 168 ? `${verb} هذا الأسبوع` : hours <= 720 ? `${verb} خلال شهر` : published ? "إعلان قديم" : "رُصدت منذ أكثر من شهر";
  return { hours, points, label };
}

/**
 * Up to 38 points for everything that is not «does it fit»: how fresh, reachable, complete and trustworthy the
 * find is, who wrote it, and signs of noise. Every point has a reason the office can read.
 */
export function qualityScore(entity = {}, { now = new Date(), sourceQuality = 0.5, preferDirectOwner = false, advertiser = ADVERTISER.UNCLEAR, repeat = 0 } = {}) {
  const reasons = [];
  const warnings = [];
  const fresh = freshness(entity, now);
  if (fresh.label && fresh.points >= 6) reasons.push(fresh.label);
  if (fresh.points === 0) warnings.push("الإعلان قديم");
  const contact = normPhone(entity.phone) ? 10 : entity.contactRoute ? 7 : 0;
  if (contact === 10) reasons.push("يوجد رقم تواصل"); else if (contact) reasons.push("يوجد مسار تواصل من المصدر");
  const complete = [entity.kind, entity.tx, entity.propertyType, entity.district, entity.price, entity.area].filter(Boolean).length;
  if (complete >= 5) reasons.push("بيانات الإعلان مكتملة");
  if (!entity.price) warnings.push("السعر غير مذكور");
  const source = Math.round(Math.max(0, Math.min(1, sourceQuality)) * 4);
  const confidence = Math.round(Math.max(0, Math.min(1, Number(entity.confidence ?? 0.6))) * 4);
  const owner = advertiser === ADVERTISER.OWNER_HIGH ? (preferDirectOwner ? 4 : 2) : advertiser === ADVERTISER.OWNER_MEDIUM ? (preferDirectOwner ? 3 : 1)
    : advertiser === ADVERTISER.BROKER_LIKELY && preferDirectOwner ? -4 : 0;
  if (advertiser === ADVERTISER.OWNER_HIGH || advertiser === ADVERTISER.OWNER_MEDIUM) reasons.push(ADVERTISER_LABEL[advertiser]);
  if (advertiser === ADVERTISER.BROKER_LIKELY && preferDirectOwner) warnings.push("المعلن وسيط محتمل وليس المالك");
  const sources = Number(entity.sourceCount || 1);
  const corroborated = sources >= 2 ? 2 : 0;
  if (sources >= 2) reasons.push(`وُجدت في ${sources} مصادر`);
  let noise = 0;
  const text = String(entity.text || "");
  if ((Number(entity.textLength || 0) || text.length) < 25) { noise -= 5; warnings.push("نص الإعلان قصير جدًا"); }
  if ((text.match(/https?:\/\//g) || []).length >= 3) { noise -= 4; warnings.push("الإعلان مليء بالروابط"); }
  if (entity.badPrice) noise -= 3;
  if (repeat >= 6) { noise -= 3; warnings.push("معلن ينشر بكثافة"); }
  const parts = { freshness: fresh.points, contact, completeness: complete, source, confidence, owner, corroborated, noise };
  const quality = Math.max(0, Math.min(38, Object.values(parts).reduce((a, b) => a + b, 0)));
  return { quality, parts, reasons, warnings };
}

/**
 * The scout's level for one find against one search: `fit` is the matching engine's score (already adjusted for a
 * neighbouring district); `quality` is qualityScore(). A discovery find with nothing of the office behind it and a
 * broker's ad for an owners-only search can never be «very strong».
 */
export function scoutScore({ fit = 0, quality = 0, capBand = "" } = {}) {
  let score = Math.max(0, Math.min(100, Math.round(Number(fit) * 0.62 + Number(quality))));
  if (capBand === BAND.STRONG) score = Math.min(score, BAND_MIN.VERY_STRONG - 1);
  if (capBand === BAND.MEDIUM) score = Math.min(score, BAND_MIN.STRONG - 1);
  return { score, band: bandOf(score) };
}

/** Does this find reach the broker, and does it alert him? (the office's minimum level, the mode, reachability) */
export function surfaceDecision({ band, contactable, minQuality = BAND.STRONG, mode = SCOUT_MODE.GENERAL, status = OPP_STATUS.NEW, pinned = false, alerts = true, alertLevel = BAND.VERY_STRONG } = {}) {
  if (status === OPP_STATUS.IGNORED) return { surface: SURFACE.HIDDEN, notify: false };
  // An ad the broker brought himself (a link, one pasted ad) is his own choice: it is on his page whatever its level.
  if (pinned) return { surface: SURFACE.SHOWN, notify: false };
  if (!contactable) return { surface: SURFACE.HIDDEN, notify: false };
  const shown = bandRank(band) >= bandRank(minQuality === BAND.VERY_STRONG ? BAND.VERY_STRONG : BAND.STRONG);
  // A general search alerts from the level the office chose; deep and urgent keep their own rule.
  const from = modeOf(mode) === SCOUT_MODE.GENERAL ? (alertLevel === BAND.STRONG ? BAND.STRONG : BAND.VERY_STRONG) : MODE_CONFIG[modeOf(mode)].notify.minBand;
  const notify = alerts !== false && shown && bandRank(band) >= bandRank(from);
  return { surface: shown ? SURFACE.SHOWN : SURFACE.HIDDEN, notify };
}

// ------------------------------------------------------------------ the page's five lists

export const BUCKET = Object.freeze({ NEW: "NEW", MATCHED: "MATCHED", REVIEW: "REVIEW", SAVED: "SAVED", EXCLUDED: "EXCLUDED" });
export const BUCKET_OPTIONS = Object.freeze([
  { id: BUCKET.MATCHED, label: "مطابقة" }, { id: BUCKET.NEW, label: "جديدة" }, { id: BUCKET.REVIEW, label: "قيد المراجعة" },
  { id: BUCKET.SAVED, label: "محفوظة" }, { id: BUCKET.EXCLUDED, label: "مستبعدة" }
]);
/** Where a find sits: excluded, saved, under review (the broker opened its contact), matched to one of the office's records, or simply new. */
export function bucketOf(card = {}) {
  if (card.status === OPP_STATUS.IGNORED) return BUCKET.EXCLUDED;
  if (card.status === OPP_STATUS.SAVED) return BUCKET.SAVED;
  if (card.status === OPP_STATUS.CONTACTED) return BUCKET.REVIEW;
  return card.recordId ? BUCKET.MATCHED : BUCKET.NEW;
}
export function bucketCounts(cards = []) {
  const counts = Object.fromEntries(Object.values(BUCKET).map((id) => [id, 0]));
  for (const card of cards) counts[bucketOf(card)] += 1;
  return counts;
}

// ------------------------------------------------------------------ what is missing, and how it differs from the office's record

const MISSING_FIELDS = [["propertyType", "نوع العقار"], ["city", "المدينة"], ["district", "الحي"], ["price", "السعر"], ["area", "المساحة"]];
/** What the ad did not say. Never guessed — listed, so the broker asks for it. */
export function missingFacts(entity = {}) {
  const out = MISSING_FIELDS.filter(([field]) => !entity[field]).map(([, label]) => label);
  if (!normPhone(entity.phone) && !entity.contactRoute) out.push("وسيلة التواصل");
  if (!entity.publishedAt) out.push("تاريخ النشر");
  return out;
}
export function completenessLabel(entity = {}) {
  const missing = missingFacts(entity).filter((label) => label !== "تاريخ النشر");
  return !missing.length ? "البيانات مكتملة" : missing.length <= 2 ? "البيانات شبه مكتملة" : "البيانات ناقصة";
}

const percent = (a, b) => Math.round((Math.abs(a - b) / b) * 100);
/** The find beside the office's own record: where price and area differ, in plain words. */
export function matchDifferences(entity = {}, record = null) {
  if (!record) return [];
  const out = [];
  const ours = Number(record.priceOrBudget ?? record.price ?? record.budget ?? 0) || 0;
  const theirs = Number(entity.price || 0);
  if (ours && theirs) {
    const gap = percent(theirs, ours);
    if (entity.kind === "OFFER") out.push(gap < 1 ? "السعر يساوي ميزانية عميلك" : theirs > ours ? `السعر أعلى من ميزانية عميلك بـ${gap}%` : `السعر أقل من ميزانية عميلك بـ${gap}%`);
    else out.push(gap < 1 ? "الميزانية تساوي سعر عرضك" : theirs < ours ? `ميزانيته أقل من سعر عرضك بـ${gap}%` : `ميزانيته أعلى من سعر عرضك بـ${gap}%`);
  }
  const ourArea = Number(record.area || 0);
  const theirArea = Number(entity.area || 0);
  if (ourArea && theirArea) {
    const gap = percent(theirArea, ourArea);
    out.push(gap < 3 ? "المساحة متقاربة" : `المساحة ${theirArea > ourArea ? "أكبر" : "أصغر"} بـ${gap}% (${formatNumber(theirArea)} م² مقابل ${formatNumber(ourArea)} م²)`);
  }
  const ourDistrict = normDistrict(String(record.district || ""));
  if (ourDistrict && entity.district && normDistrict(entity.district) !== ourDistrict) out.push(`الحي مختلف: ${entity.district} بدل ${String(record.district).replace(/^حي\s+/, "")}`);
  return out;
}

// ------------------------------------------------------------------ what the broker reads

export const CATEGORY = Object.freeze({ BUYER: "BUYER", PROPERTY: "PROPERTY", OWNER: "OWNER", OFFER: "OFFER", REQUEST: "REQUEST" });
export const CATEGORY_LABEL = Object.freeze({
  BUYER: "مشترٍ محتمل لعرض لديك", PROPERTY: "عقار مناسب لطلب عميلك", OWNER: "مالك محتمل لعقار جديد", OFFER: "عرض جديد يناسب نشاط مكتبك", REQUEST: "طلب جديد يناسب نشاط مكتبك"
});

export function categoryOf(entity = {}, link = {}) {
  if (link.recordId) return link.recordKind === "OFFER" ? CATEGORY.BUYER : CATEGORY.PROPERTY;
  if (entity.kind === "REQUEST") return CATEGORY.REQUEST;
  return [ADVERTISER.OWNER_HIGH, ADVERTISER.OWNER_MEDIUM].includes(entity.advertiser) ? CATEGORY.OWNER : CATEGORY.OFFER;
}

export function entityHeadline(entity = {}) {
  const type = entity.propertyType || "عقار";
  const place = entity.district ? ` في ${/^حي /.test(entity.district) ? entity.district : `حي ${entity.district}`}` : entity.city ? ` في ${entity.city}` : "";
  if (entity.kind === "REQUEST") return `طلب ${entity.tx === "rent" ? "استئجار" : "شراء"} ${type}${place}`;
  return `${type} ${entity.tx === "rent" ? "للإيجار" : "للبيع"}${place}`;
}

export const priceLine = (entity = {}) => (entity.price ? `${entity.kind === "REQUEST" ? "الميزانية" : "السعر"} ${formatNumber(entity.price)} ريال` : "");

/** The notification: the point in one line, with no numbers of the engine and no contact details on the lock screen. */
export function notificationCopy({ entity = {}, link = {}, recordTitleText = "", change = null, urgent = false } = {}) {
  const tag = urgent ? "عاجل — " : "";
  if (change?.field === "price" && Number(change.to) < Number(change.from)) {
    return { title: `${tag}انخفض السعر`, body: `${entityHeadline(entity)}: أصبح ${formatNumber(change.to)} بعد ${formatNumber(change.from)}${recordTitleText ? ` — يناسب «${recordTitleText}»` : ""}.` };
  }
  if (change?.field === "contact") return { title: `${tag}فرصة أصبحت قابلة للتواصل`, body: `${entityHeadline(entity)}: ظهرت لها وسيلة تواصل.` };
  const category = categoryOf(entity, link);
  if (category === CATEGORY.BUYER) return { title: `${tag}فرصة قوية`, body: `وجد الباحث عن الفرص ${entity.tx === "rent" ? "طلب استئجار" : "طلب شراء"} حديثًا مناسبًا لـ«${recordTitleText || "عرض لديك"}».` };
  if (category === CATEGORY.PROPERTY) return { title: `${tag}تطابق جديد`, body: `وجدنا ${entity.propertyType || "عقارًا"}${entity.district ? ` في ${entity.district}` : ""} ضمن ميزانية عميلك.` };
  if (category === CATEGORY.OWNER) return { title: `${tag}مالك محتمل`, body: `${entityHeadline(entity)} — مرجّح من المالك مباشرة.` };
  return { title: `${tag}فرصة قوية`, body: `${entityHeadline(entity)}${entity.price ? ` · ${formatNumber(entity.price)} ريال` : ""}.` };
}

/** One card on the scout page (built by the Worker, kept small: it is stored with the office's scout state). */
export function boardCard(entity = {}, link = {}, { recordTitleText = "", now = new Date() } = {}) {
  const category = categoryOf(entity, link);
  return {
    id: String(entity.id || ""), band: entity.band, category, headline: entityHeadline(entity), price: priceLine(entity),
    why: [...(link.reasons || []), ...(entity.reasons || [])].filter((r, i, all) => r && all.indexOf(r) === i).slice(0, 3),
    recordId: String(link.recordId || ""), recordTitle: cleanText(recordTitleText, 120), taskId: String(link.taskId || ""),
    at: entity.lastChangeAt || entity.firstSeenAt || now.toISOString(), status: entity.status || OPP_STATUS.NEW,
    urgent: link.mode === SCOUT_MODE.URGENT, sources: Number(entity.sourceCount || 1), changed: entity.lastChange || ""
  };
}

/** Arabic counts as a person would write them: «فرصة قوية واحدة»، «فرصتان قويتان»، «3 فرص قوية»، «12 فرصة قوية». */
export function countLabel(n, { one, two, few, many }) {
  const count = Math.max(0, Math.round(Number(n) || 0));
  return count === 1 ? one : count === 2 ? two : count >= 3 && count <= 10 ? `${count} ${few}` : `${count} ${many}`;
}
export const strongCount = (n) => countLabel(n, { one: "فرصة قوية واحدة", two: "فرصتان قويتان", few: "فرص قوية", many: "فرصة قوية" });
export const adsCount = (n) => countLabel(n, { one: "إعلانًا واحدًا", two: "إعلانين", few: "إعلانات", many: "إعلانًا" });

/** The numbers at the top of the page — real counts of this office only. */
export function scoutCounters({ board = [], tasks = [], now = new Date() } = {}) {
  const dayStart = new Date(now.getTime() + 3 * 3_600_000); dayStart.setUTCHours(0, 0, 0, 0);
  const since = dayStart.getTime() - 3 * 3_600_000;
  const active = tasks.filter((t) => t.status === TASK_STATUS.ACTIVE);
  const open = board.filter((c) => [OPP_STATUS.NEW, OPP_STATUS.SAVED].includes(c.status));
  return {
    strongToday: open.filter((c) => (toDate(c.at)?.getTime() || 0) >= since).length,
    strong: open.length,
    activeSearches: active.length,
    urgent: active.filter((t) => modeOf(t.mode) === SCOUT_MODE.URGENT).length,
    forOffers: active.filter((t) => t.recordKind === "OFFER").length,
    forRequests: active.filter((t) => t.recordKind === "REQUEST").length
  };
}

/** The line a broker reads when he comes back: «الباحث عن الفرص عمل أثناء غيابك». */
export function awaySummary(board = []) {
  const open = board.filter((c) => c.status === OPP_STATUS.NEW);
  const count = (category) => open.filter((c) => c.category === category).length;
  const lines = [];
  const say = (n, one, two, many) => { if (n) lines.push(n === 1 ? one : n === 2 ? two : many.replace("#", String(n))); };
  say(count(CATEGORY.BUYER), "مشترٍ محتمل لعرض لديك", "مشتريان محتملان لعروض لديك", "# مشترين محتملين لعروض لديك");
  say(count(CATEGORY.PROPERTY), "عقار مناسب لطلب عميل", "عقاران مناسبان لطلبات عملائك", "# عقارات مناسبة لطلبات عملائك");
  say(count(CATEGORY.OWNER), "مالك محتمل لعقار جديد", "مالكان محتملان لعقارات جديدة", "# ملاك محتملين لعقارات جديدة");
  say(count(CATEGORY.OFFER) + count(CATEGORY.REQUEST), "فرصة جديدة تناسب نشاط مكتبك", "فرصتان جديدتان تناسبان نشاط مكتبك", "# فرص جديدة تناسب نشاط مكتبك");
  return { total: open.length, lines };
}

export function statusView(overview = {}) {
  if (overview.available === false) return { state: "unavailable", label: "غير متاح", tone: "" };
  if (!overview.settings?.enabled) return { state: "off", label: "متوقف", tone: "" };
  if (overview.health?.failing) return { state: "trouble", label: "يعمل — مصدر متعطل", tone: "warn" };
  return { state: "on", label: "يعمل الآن", tone: "ok" };
}

export function taskView(task = {}, now = new Date()) {
  const cadence = taskCadence(task, now);
  const mode = modeOf(task.mode);
  const status = TASK_STATUS[task.status] || TASK_STATUS.ACTIVE;
  const ring = Number(task.geoRing || 0);
  return {
    id: String(task.id || ""), title: cleanText(task.title, 160), mode, modeLabel: MODE_CONFIG[mode].label,
    status, statusLabel: status === TASK_STATUS.ACTIVE && cadence.downgraded ? "يعمل — بوتيرة عامة" : TASK_STATUS_LABEL[status],
    reason: END_REASON_LABEL[task.statusReason] || "", origin: task.origin || TASK_ORIGIN.CUSTOM, recordId: String(task.recordId || ""), recordKind: task.recordKind || "",
    scope: ring >= RING.CITY ? "يشمل المدينة" : ring >= RING.ADJACENT ? "يشمل الأحياء المجاورة" : "",
    found: Number(task.stats?.strong || 0), lastRunAt: task.lastRunAt || "",
    canPause: status === TASK_STATUS.ACTIVE, canResume: status === TASK_STATUS.PAUSED, canEnd: status === TASK_STATUS.ACTIVE || status === TASK_STATUS.PAUSED
  };
}
