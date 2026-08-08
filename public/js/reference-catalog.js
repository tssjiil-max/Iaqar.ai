/**
 * Central reference catalog — operation types, property types, cities, districts.
 * Single source for review UI and extraction matching. Update here only.
 */

const MADINAH_DISTRICT_NAMES = Object.freeze([
  "أبيار علي", "أبو بريقاء", "أبو سدر", "أحد", "الإسكان", "الأزهري", "الأصيفرين",
  "البدراني", "البركة", "البيداء", "الجامعة", "الجابرة", "الجصة", "الجماوات", "الجرف",
  "الجمعة", "الحرم الشريف", "الحساء", "الحديقة", "الخاتم", "الخالدية", "الدفاع", "الدعيثة",
  "الدويمة", "الراية", "الربوة", "الرانوناء", "الرمانة", "الروابي", "السحمان", "السد",
  "السلام", "السكب", "السيح", "الشريبات", "الشهباء", "الصادقية", "الصويدرة", "العالية",
  "العريض", "العزيزية", "العصبة", "العهن", "العنبرية", "العيون", "الغراء", "الفيصلية",
  "الفريش", "الفتح", "القصواء", "القبلتين", "المبعوث", "المطار", "المصانع", "المستراح",
  "المتنزه", "المزيين", "المغيسلة", "المفرحات", "المهدية", "المناخة", "الملك فهد",
  "النخيل", "النصر", "النقاء", "النقمى", "النواعم", "الهدراء", "الهجرة", "الوبرة",
  "باقدو", "بضاعة", "بني بياضة", "بني حارثة", "بني ظفر", "بني النجار", "تلعة الهبوب",
  "جبل أحد", "جبل عير", "جماء أم خالد", "جشم", "حرة الوبرة", "حمراء الأسد", "حزرة الجنوب",
  "ذو الحليفة", "رهط", "سد الغابة", "سكة الحديد", "سيد الشهداء", "شوران", "طيبة", "عروة",
  "عين الخيف", "قربان", "نبلاء", "وادي العقيق", "وادي مذينب", "وادي مهزور", "ورقان", "وعيرة"
]);

export const DISTRICT_SOURCE_META = Object.freeze({
  sourceName: "أمانة منطقة المدينة المنورة — البوابة الجيومكانية",
  sourceUrl: "https://geomed.amana-md.gov.sa/Portal/apps/sites/#/home",
  supplementarySourceUrl: "https://www.amana-md.gov.sa/OpenData/NamingNumbering",
  lastVerifiedAt: "2026-05-05",
  verificationNote:
    "أسماء الأحياء مطابقة لطبقة أحياء البوابة الجيومكانية. ملفات CSV المفتوحة للتسمية والترقيم (2024) توفر إجماليات فقط."
});

export const OPERATION_TYPES = Object.freeze([
  { id: "sale", label: "بيع", purpose: "SALE", defaultKind: "OFFER" },
  { id: "purchase", label: "شراء", purpose: "PURCHASE", defaultKind: "REQUEST" },
  { id: "rent", label: "إيجار", purpose: "RENT", defaultKind: "OFFER" },
  { id: "investment", label: "استثمار", purpose: "INVESTMENT", defaultKind: "OFFER" }
]);

export const PROPERTY_TYPES = Object.freeze([
  { id: "land", label: "أرض", matchTerms: ["أرض", "ارض", "أرض سكنية", "أرض تجارية"] },
  { id: "apartment", label: "شقة", matchTerms: ["شقة", "شقه"] },
  { id: "villa", label: "فيلا", matchTerms: ["فيلا", "فيلة"] },
  { id: "floor", label: "دور", matchTerms: ["دور", "أدوار"] },
  { id: "building", label: "عمارة", matchTerms: ["عمارة", "عماره"] },
  { id: "house", label: "منزل", matchTerms: ["منزل", "بيت", "بيت شعبي"] },
  { id: "rest_house", label: "استراحة", matchTerms: ["استراحة", "استراحه"] },
  { id: "farm", label: "مزرعة", matchTerms: ["مزرعة", "مزرعه"] },
  { id: "shop", label: "محل", matchTerms: ["محل", "محل تجاري"] },
  { id: "office", label: "مكتب", matchTerms: ["مكتب"] },
  { id: "showroom", label: "معرض", matchTerms: ["معرض"] },
  { id: "warehouse", label: "مستودع", matchTerms: ["مستودع"] },
  { id: "commercial_building", label: "مبنى تجاري", matchTerms: ["مبنى تجاري", "مجمع تجاري"] },
  { id: "hotel", label: "فندق", matchTerms: ["فندق"] },
  { id: "furnished", label: "شقق مفروشة / مخدومة", matchTerms: ["شقق مفروشة", "مفروشة", "مخدومة"] },
  { id: "other", label: "أخرى", matchTerms: [] }
]);

export const CITIES = Object.freeze([
  { id: "madinah", label: "المدينة المنورة", aliases: ["المدينة المنورة", "المدينة", "مدينة المنورة"] },
  { id: "riyadh", label: "الرياض", aliases: ["الرياض", "رياض"] },
  { id: "jeddah", label: "جدة", aliases: ["جدة"] },
  { id: "dammam", label: "الدمام", aliases: ["الدمام"] },
  { id: "makkah", label: "مكة", aliases: ["مكة", "مكة المكرمة"] },
  { id: "other", label: "مدينة أخرى", aliases: [] }
]);

function districtAliases(name) {
  const base = String(name || "").trim();
  const aliases = [base];
  if (base.startsWith("ال")) aliases.push(base.slice(2));
  aliases.push(`حي ${base}`);
  if (base.startsWith("ال")) aliases.push(`حي ${base.slice(2)}`);
  return [...new Set(aliases.filter(Boolean))];
}

export const DISTRICTS = Object.freeze(
  MADINAH_DISTRICT_NAMES.map((officialName, index) => ({
    id: `madinah-${String(index + 1).padStart(3, "0")}`,
    officialName,
    aliases: districtAliases(officialName),
    cityId: "madinah",
    active: true,
    sourceName: DISTRICT_SOURCE_META.sourceName,
    sourceUrl: DISTRICT_SOURCE_META.sourceUrl,
    lastVerifiedAt: DISTRICT_SOURCE_META.lastVerifiedAt
  }))
);

export const DISTRICT_OTHER_ID = "__other_district__";

export function normalizeSearchText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\u0640/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\u0600-\u06FFa-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function filterBySearch(query, items, labelKey = "label") {
  const q = normalizeSearchText(query);
  if (!q) return [...items];
  return items.filter((item) => {
    const label = normalizeSearchText(item[labelKey]);
    const aliases = (item.aliases || item.matchTerms || []).map((a) => normalizeSearchText(a));
    return label.includes(q) || aliases.some((a) => a.includes(q) || q.includes(a));
  });
}

export function matchOperationType(fields = {}, text = "") {
  const purpose = String(fields.purpose || "").toUpperCase();
  const kind = String(fields.opportunityKind || "").toUpperCase();
  const hay = normalizeSearchText(text);

  if (purpose === "INVESTMENT" || /استثمار/.test(text)) {
    return OPERATION_TYPES.find((o) => o.id === "investment");
  }
  if (purpose === "PURCHASE" || kind === "REQUEST" && /شراء|مطلوب|ابحث/.test(text)) {
    return OPERATION_TYPES.find((o) => o.id === "purchase");
  }
  if (purpose === "LEASE_REQUEST" || (purpose === "RENT" && kind === "REQUEST")) {
    return OPERATION_TYPES.find((o) => o.id === "rent");
  }
  if (purpose === "RENT" || /ايجار|إيجار|للإيجار/.test(text)) {
    return OPERATION_TYPES.find((o) => o.id === "rent");
  }
  if (purpose === "SALE" || /بيع|للبيع/.test(hay)) {
    return OPERATION_TYPES.find((o) => o.id === "sale");
  }
  return null;
}

export function matchPropertyType(raw = "") {
  const hay = normalizeSearchText(raw);
  if (!hay) return null;
  let best = null;
  let bestLen = 0;
  for (const item of PROPERTY_TYPES) {
    if (item.id === "other") continue;
    for (const term of item.matchTerms) {
      const t = normalizeSearchText(term);
      if (t && hay.includes(t) && t.length >= bestLen) {
        best = item;
        bestLen = t.length;
      }
    }
  }
  return best;
}

export function matchCity(raw = "") {
  const hay = normalizeSearchText(raw);
  if (!hay) return null;
  for (const city of CITIES) {
    if (city.id === "other") continue;
    for (const alias of city.aliases) {
      const a = normalizeSearchText(alias);
      if (a && hay.includes(a)) return city;
    }
  }
  return null;
}

export function matchDistrict(raw = "", cityId = "madinah") {
  const hay = normalizeSearchText(raw).replace(/^حي\s+/, "");
  if (!hay || cityId !== "madinah") return null;
  let best = null;
  let bestLen = 0;
  for (const district of DISTRICTS) {
    if (!district.active) continue;
    for (const alias of district.aliases) {
      const a = normalizeSearchText(alias).replace(/^حي\s+/, "");
      if (a && (hay === a || hay.includes(a) || a.includes(hay)) && a.length >= bestLen) {
        best = district;
        bestLen = a.length;
      }
    }
  }
  return best;
}

export function districtsForCity(cityId) {
  if (cityId !== "madinah") return [];
  return DISTRICTS.filter((d) => d.active);
}

export function mapOperationToBrokerFields(operationId, hintKind = "") {
  const op = OPERATION_TYPES.find((o) => o.id === operationId);
  if (!op) return {};
  let opportunityKind = op.defaultKind;
  if (hintKind === "OFFER" || hintKind === "REQUEST") opportunityKind = hintKind;
  if (operationId === "rent" && hintKind === "REQUEST") {
    return { purpose: "LEASE_REQUEST", opportunityKind: "REQUEST" };
  }
  return { purpose: op.purpose, opportunityKind };
}

export function buildReviewDefaults(extractionFields = {}, sourceText = "") {
  const text = String(sourceText || "");
  const op = matchOperationType(extractionFields, text);
  const property = matchPropertyType(extractionFields.propertyType || text);
  const city = matchCity(extractionFields.city || text);
  const district = matchDistrict(extractionFields.district || text, city?.id || "madinah");

  return {
    operationTypeId: op?.id || "",
    propertyTypeId: property?.id || (extractionFields.propertyType ? "other" : ""),
    propertyTypeManual: property ? "" : safeTrim(extractionFields.propertyType),
    cityId: city?.id || "",
    cityManual: city ? "" : safeTrim(extractionFields.city),
    districtId: district?.id || "",
    districtManual: district ? "" : safeTrim(extractionFields.district),
    priceOrBudget: extractionFields.priceOrBudget ?? "",
    area: extractionFields.area ?? "",
    rooms: extractionFields.rooms ?? "",
    extractedSnapshot: {
      opportunityKind: extractionFields.opportunityKind || "",
      purpose: extractionFields.purpose || "",
      propertyType: extractionFields.propertyType || "",
      city: extractionFields.city || "",
      district: extractionFields.district || ""
    }
  };
}

function safeTrim(v) {
  return String(v == null ? "" : v).trim();
}

export function reviewValuesToBrokerFields(review) {
  const op = OPERATION_TYPES.find((o) => o.id === review.operationTypeId);
  const property = PROPERTY_TYPES.find((p) => p.id === review.propertyTypeId);
  const city = CITIES.find((c) => c.id === review.cityId);
  const district = DISTRICTS.find((d) => d.id === review.districtId);

  const broker = mapOperationToBrokerFields(
    review.operationTypeId,
    review.extractedSnapshot?.opportunityKind
  );

  let propertyType = property?.label || "";
  if (review.propertyTypeId === "other") propertyType = safeTrim(review.propertyTypeManual);
  let cityName = city?.label || "";
  if (review.cityId === "other") cityName = safeTrim(review.cityManual);
  let districtName = district?.officialName || "";
  if (review.districtId === DISTRICT_OTHER_ID || !districtName) {
    districtName = safeTrim(review.districtManual);
  }

  return {
    ...broker,
    propertyType,
    city: cityName === "مدينة أخرى" ? safeTrim(review.cityManual) : cityName,
    district: districtName,
    priceOrBudget: review.priceOrBudget === "" || review.priceOrBudget == null
      ? null
      : Number(review.priceOrBudget),
    area: review.area === "" || review.area == null ? null : Number(review.area),
    rooms: review.rooms === "" || review.rooms == null ? null : Number(review.rooms),
    reviewOperationTypeId: review.operationTypeId,
    reviewPropertyTypeId: review.propertyTypeId,
    reviewCityId: review.cityId,
    reviewDistrictId: review.districtId === DISTRICT_OTHER_ID ? "" : review.districtId,
    extractedSnapshot: review.extractedSnapshot || null
  };
}
