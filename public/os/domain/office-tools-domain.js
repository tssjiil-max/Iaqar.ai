/**
 * «أدوات المكتب» — pure rules behind the six tools on the office page.
 *   ملفاتي   → the office library (existing screen)
 *   النماذج  → ready message drafts the broker copies or shares himself (nothing is sent by the system)
 *   الدليل   → the working path of the office, one step at a time, each step opening its screen
 *   الخدمات  → official real-estate services (external links)
 *   الحاسبة  → brokerage commission and tax estimate
 *   السوق    → indicators computed from the office's own active offers and requests only
 * No DOM, no network: shared by the views and node:test.
 */

import { cleanText, formatNumber, toNumber } from "./format-domain.js";
import { LIFECYCLE, RECORD_KIND, kindOf, lifecycleOf, priceOf } from "./records-domain.js";

/** Same labels, order and glyphs as the approved office page. `route` is where the card opens. */
export const OFFICE_TOOLS = Object.freeze([
  { id: "files", label: "ملفاتي", route: "library", hint: "عقود ومستندات المكتب" },
  { id: "forms", label: "النماذج", route: "tools/forms", hint: "رسائل جاهزة للمالك والعميل" },
  { id: "guide", label: "الدليل", route: "tools/guide", hint: "خطوات العمل من العرض حتى الإغلاق" },
  { id: "services", label: "الخدمات", route: "tools/services", hint: "روابط الجهات والمنصات الرسمية" },
  { id: "calculator", label: "الحاسبة", route: "tools/calculator", hint: "السعي والضريبة" },
  { id: "market", label: "السوق", route: "tools/market", hint: "مؤشرات من بيانات مكتبك" }
]);

export function officeToolByLabel(label) {
  return OFFICE_TOOLS.find((tool) => tool.label === label) || null;
}

export function officeToolById(id) {
  return OFFICE_TOOLS.find((tool) => tool.id === id) || null;
}

// ------------------------------------------------------------------ الحاسبة

/** Editable starting values. The broker confirms the actual rates; the result is an estimate. */
export const CALC_DEFAULTS = Object.freeze({ commissionPercent: 2.5, vatPercent: 15, transferTaxPercent: 5 });
export const CALC_KINDS = Object.freeze([
  { id: "sale", label: "بيع", amountLabel: "سعر البيع" },
  { id: "rent", label: "إيجار", amountLabel: "الإيجار السنوي" }
]);

const money = (value) => Math.round(value * 100) / 100;
const percent = (value, fallback) => {
  if (value === "" || value === null || value === undefined) return fallback;
  const n = toNumber(value);
  return n >= 0 && n <= 100 ? n : fallback;
};

/**
 * Commission and tax estimate.
 *   sale: commission on the price, VAT on the commission, real-estate transaction tax on the price.
 *   rent: commission on the annual rent, VAT on the commission (no transaction tax).
 * Returns { ok, errors, kind, amount, rates, commission, commissionVat, commissionTotal,
 *           transferTax, buyerTotal, rows[] } — rows are ready to display.
 */
export function calculateDeal(input = {}) {
  const kind = input.kind === "rent" ? "rent" : "sale";
  const amount = toNumber(input.amount);
  const errors = {};
  if (!(amount > 0)) errors.amount = kind === "rent" ? "اكتب الإيجار السنوي" : "اكتب سعر البيع";
  else if (amount > 10_000_000_000) errors.amount = "القيمة غير منطقية";
  const rates = {
    commissionPercent: percent(input.commissionPercent, CALC_DEFAULTS.commissionPercent),
    vatPercent: percent(input.vatPercent, CALC_DEFAULTS.vatPercent),
    transferTaxPercent: kind === "sale" ? percent(input.transferTaxPercent, CALC_DEFAULTS.transferTaxPercent) : 0
  };
  if (Object.keys(errors).length) return { ok: false, errors, kind, amount: 0, rates, rows: [] };
  const commission = money(amount * rates.commissionPercent / 100);
  const commissionVat = money(commission * rates.vatPercent / 100);
  const commissionTotal = money(commission + commissionVat);
  const transferTax = kind === "sale" ? money(amount * rates.transferTaxPercent / 100) : 0;
  const buyerTotal = money(amount + commissionTotal + transferTax);
  const rows = [
    { id: "amount", label: kind === "rent" ? "الإيجار السنوي" : "سعر البيع", value: amount },
    { id: "commission", label: `السعي (${rates.commissionPercent}%)`, value: commission },
    { id: "commissionVat", label: `ضريبة القيمة المضافة على السعي (${rates.vatPercent}%)`, value: commissionVat },
    { id: "commissionTotal", label: "إجمالي السعي مع الضريبة", value: commissionTotal, strong: true }
  ];
  if (kind === "sale") rows.push({ id: "transferTax", label: `ضريبة التصرفات العقارية (${rates.transferTaxPercent}%)`, value: transferTax });
  rows.push({ id: "buyerTotal", label: kind === "rent" ? "الإجمالي على المستأجر في السنة الأولى" : "الإجمالي التقديري على المشتري", value: buyerTotal, strong: true });
  return { ok: true, errors, kind, amount, rates, commission, commissionVat, commissionTotal, transferTax, buyerTotal, rows };
}

export function formatMoney(value) {
  const n = Number(value) || 0;
  const whole = Math.round(n);
  if (Math.abs(n - whole) < 0.005) return `${formatNumber(whole) || "0"} ريال`;
  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ريال`;
}

// -------------------------------------------------------------------- السوق

function average(values) {
  return values.length ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length) : 0;
}

function districtName(record) {
  const raw = cleanText(record.district, 80).replace(/^حي\s+/, "");
  return raw;
}

/**
 * Indicators from the office's own ACTIVE records only (never another office, never estimates):
 *   totals, average asking price / budget per property type and purpose, and where demand
 *   (requests) has no matching supply (offers) in the same district and type.
 */
export function marketSnapshot(records = []) {
  const active = records.filter((r) => lifecycleOf(r) === LIFECYCLE.ACTIVE && kindOf(r));
  const offers = active.filter((r) => kindOf(r) === RECORD_KIND.OFFER);
  const requests = active.filter((r) => kindOf(r) === RECORD_KIND.REQUEST);
  const txOf = (r) => (["RENT", "LEASE_REQUEST"].includes(String(r.purpose || "").toUpperCase()) ? "rent" : "sale");

  const groups = new Map();
  for (const record of active) {
    const type = cleanText(record.propertyType, 40) || "غير محدد";
    const tx = txOf(record);
    const key = `${tx}|${type}`;
    if (!groups.has(key)) groups.set(key, { key, tx, txLabel: tx === "rent" ? "إيجار" : "بيع", propertyType: type, offerPrices: [], budgets: [], offers: 0, requests: 0 });
    const group = groups.get(key);
    const price = priceOf(record);
    if (kindOf(record) === RECORD_KIND.OFFER) { group.offers += 1; if (price > 0) group.offerPrices.push(price); }
    else { group.requests += 1; if (price > 0) group.budgets.push(price); }
  }
  const byType = [...groups.values()]
    .map((g) => ({ key: g.key, tx: g.tx, txLabel: g.txLabel, propertyType: g.propertyType, offers: g.offers, requests: g.requests, avgOffer: average(g.offerPrices), avgBudget: average(g.budgets) }))
    .sort((a, b) => (b.offers + b.requests) - (a.offers + a.requests) || a.propertyType.localeCompare(b.propertyType, "ar"));

  const districts = new Map();
  for (const record of active) {
    const name = districtName(record);
    if (!name) continue;
    const city = cleanText(record.city, 60);
    const key = `${city}|${name}`;
    if (!districts.has(key)) districts.set(key, { key, city, district: name, offers: 0, requests: 0 });
    districts.get(key)[kindOf(record) === RECORD_KIND.OFFER ? "offers" : "requests"] += 1;
  }
  const byDistrict = [...districts.values()].sort((a, b) => (b.offers + b.requests) - (a.offers + a.requests) || a.district.localeCompare(b.district, "ar"));

  // Demand without supply: a request whose (purpose group, type, district) has no active offer.
  const supply = new Set(offers.map((r) => `${txOf(r)}|${cleanText(r.propertyType, 40)}|${districtName(r)}`));
  const gapMap = new Map();
  for (const record of requests) {
    const key = `${txOf(record)}|${cleanText(record.propertyType, 40)}|${districtName(record)}`;
    if (supply.has(key) || !districtName(record)) continue;
    if (!gapMap.has(key)) gapMap.set(key, { key, txLabel: txOf(record) === "rent" ? "إيجار" : "شراء", propertyType: cleanText(record.propertyType, 40), district: districtName(record), requests: 0, budgets: [] });
    const gap = gapMap.get(key);
    gap.requests += 1;
    const budget = priceOf(record);
    if (budget > 0) gap.budgets.push(budget);
  }
  const gaps = [...gapMap.values()]
    .map((g) => ({ key: g.key, txLabel: g.txLabel, propertyType: g.propertyType, district: g.district, requests: g.requests, avgBudget: average(g.budgets) }))
    .sort((a, b) => b.requests - a.requests || b.avgBudget - a.avgBudget);

  return { total: active.length, offers: offers.length, requests: requests.length, byType, byDistrict, gaps };
}

// ------------------------------------------------------------------ النماذج

/** {key} placeholders are filled from the office profile; unknown keys are left out, never shown raw. */
export function fillTemplate(text, context = {}) {
  return String(text || "")
    .replace(/\{(\w+)\}/g, (_, key) => cleanText(context[key], 200))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const TEMPLATE_GROUPS = Object.freeze([
  { id: "owner", label: "للمالك" },
  { id: "client", label: "للعميل" },
  { id: "general", label: "عامة" }
]);

/** Drafts only: the broker reviews, edits and sends each message himself. */
export const MESSAGE_TEMPLATES = Object.freeze([
  { id: "owner-details", group: "owner", title: "طلب بيانات العقار",
    body: "السلام عليكم ورحمة الله\nمعك {brokerName} من {officeName}.\nلتسجيل عقاركم لدينا نحتاج: نوع العقار، الحي، المساحة، السعر المطلوب، وصور حديثة.\nويمكنكم تسجيله مباشرة من رابط المكتب:\n{officeLink}" },
  { id: "owner-update", group: "owner", title: "تحديث السعر والتوفر",
    body: "السلام عليكم\nمعك {brokerName} من {officeName}.\nنود التأكد: هل العقار ما زال متاحًا؟ وهل السعر المطلوب كما هو أو قابل للتفاوض؟" },
  { id: "owner-interest", group: "owner", title: "عميل مهتم بالعقار",
    body: "السلام عليكم\nمعك {brokerName} من {officeName}.\nلدينا عميل مهتم بعقاركم. هل يناسبكم تحديد موعد للمعاينة خلال الأيام القادمة؟" },
  { id: "client-received", group: "client", title: "استلام طلب العميل",
    body: "السلام عليكم ورحمة الله\nمعك {brokerName} من {officeName}.\nوصلنا طلبكم ونعمل على البحث عن العقار المناسب، وسنتواصل معكم فور توفر خيار مطابق." },
  { id: "client-option", group: "client", title: "عرض مناسب للعميل",
    body: "السلام عليكم\nمعك {brokerName} من {officeName}.\nتوفر لدينا عقار قريب من طلبكم. هل تودون معرفة التفاصيل أو تحديد موعد للمعاينة؟" },
  { id: "client-after-viewing", group: "client", title: "متابعة بعد المعاينة",
    body: "السلام عليكم\nمعك {brokerName} من {officeName}.\nنشكركم على حضور المعاينة. ما رأيكم في العقار؟ وهل لديكم ملاحظات على السعر أو أي تفاصيل أخرى؟" },
  { id: "viewing-reminder", group: "general", title: "تذكير بموعد المعاينة",
    body: "السلام عليكم\nتذكير من {officeName} بموعد المعاينة المتفق عليه. نرجو التأكيد أو إبلاغنا إن رغبتم في تغيير الموعد." },
  { id: "office-intro", group: "general", title: "التعريف بالمكتب ورابط التسجيل",
    body: "{officeName}\nالوسيط: {brokerName} — رخصة فال {licenseNumber}\nسجّل عقارك أو طلبك مباشرة من رابط المكتب:\n{officeLink}" },
  { id: "deal-thanks", group: "general", title: "شكر بعد إتمام الصفقة",
    body: "السلام عليكم\nيسعدنا في {officeName} إتمام صفقتكم، ونتمنى لكم التوفيق.\nيسعدنا خدمتكم دائمًا، ورابط المكتب لمن تودون إحالته إلينا:\n{officeLink}" }
]);

export function templatesFor(context = {}) {
  return MESSAGE_TEMPLATES.map((item) => ({ ...item, text: fillTemplate(item.body, context) }));
}

// ------------------------------------------------------------------- الدليل

/** The office's working path. `route` opens the screen where the step is done. */
export const GUIDE_STEPS = Object.freeze([
  { id: "add", title: "أضف عرضًا أو طلبًا", text: "سجّل عقار المالك أو طلب العميل. الحقول المطلوبة قليلة، والمساحة اختيارية.", action: "إضافة سجل", route: "repo" },
  { id: "link", title: "شارك رابط المكتب", text: "المالك والعميل يسجّلان مباشرة من الرابط دون حساب، ويصل ما يسجّلانه إلى مكتبك فقط.", action: "رابط المكتب", route: "settings/link", managerOnly: true },
  { id: "match", title: "راجع المطابقات", text: "عند توافق عرض مع طلب تصلك مهمة «تطابق» مع أسباب التوافق. اعتمدها أو ارفضها.", action: "مرحلة التطابق", route: "tasks?step=0" },
  { id: "negotiate", title: "تواصل وتفاوض", text: "أرسل المقترح للطرفين عبر واتساب، ويردّان بأزرار جاهزة من رابط خاص بكل طرف.", action: "مرحلة التفاوض", route: "tasks?step=2" },
  { id: "viewing", title: "حدّد المعاينة وسجّل نتيجتها", text: "اختر موعدًا متاحًا، أكّده، ثم سجّل النتيجة بعد المعاينة.", action: "مرحلة المعاينة", route: "tasks?step=3" },
  { id: "documents", title: "أكمل المستندات", text: "تابع المطلوب والموجود والناقص من مستندات الصفقة قبل الإغلاق.", action: "مرحلة المستندات", route: "tasks?step=4" },
  { id: "close", title: "أغلق الصفقة", text: "إتمام الصفقة إجراء صريح، ويبقى تاريخها كاملًا في السجل.", action: "الصفقات المغلقة", route: "tasks?step=5" }
]);

// ------------------------------------------------------------------ الخدمات

/** Official services only. Links open outside the app; the system exchanges no data with them. */
export const OFFICIAL_SERVICES = Object.freeze([
  { id: "rega", name: "الهيئة العامة للعقار", hint: "الأنظمة واللوائح ورخصة فال", url: "https://rega.gov.sa" },
  { id: "ejar", name: "منصة إيجار", hint: "توثيق عقود الإيجار", url: "https://www.ejar.sa" },
  { id: "srem", name: "البورصة العقارية", hint: "الصفقات والمؤشرات العقارية الرسمية", url: "https://srem.moj.gov.sa" },
  { id: "najiz", name: "ناجز", hint: "الخدمات العدلية والإفراغ العقاري", url: "https://najiz.sa" },
  { id: "sakani", name: "سكني", hint: "برامج الدعم السكني", url: "https://sakani.sa" },
  { id: "balady", name: "بلدي", hint: "الخدمات البلدية والرخص", url: "https://balady.gov.sa" }
]);

export function isOfficialServiceUrl(url) {
  return OFFICIAL_SERVICES.some((service) => service.url === url) && /^https:\/\//.test(String(url || ""));
}
