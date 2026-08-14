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
  if (best) return best;
  // Polluted one-line extractions labels: try the first Arabic token(s).
  const tokens = hay.split(/\s+/).filter(Boolean);
  for (let n = Math.min(3, tokens.length); n >= 1; n -= 1) {
    const head = tokens.slice(0, n).join(" ");
    for (const district of DISTRICTS) {
      if (!district.active) continue;
      for (const alias of district.aliases) {
        const a = normalizeSearchText(alias).replace(/^حي\s+/, "");
        if (a && (head === a || a.includes(head) || head.includes(a)) && a.length >= 3) {
          if (!best || a.length >= bestLen) {
            best = district;
            bestLen = a.length;
          }
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * District picker filter: never drop "حي آخر" behind the 40-item cap,
 * and keep it visible when the typed query matches no official district.
 */
export function filterDistrictOptions(query, items, limit = 40) {
  const list = Array.isArray(items) ? items : [];
  const other = list.find((item) => item.id === DISTRICT_OTHER_ID) || null;
  const rest = list.filter((item) => item.id !== DISTRICT_OTHER_ID);
  const filtered = filterBySearch(query, rest, "officialName");
  const cap = Math.max(1, Number(limit) || 40);
  const result = filtered.slice(0, other ? cap - 1 : cap);
  if (other) result.push(other);
  return result;
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

export function reviewTransactionMode(operationId) {
  if (operationId === "sale") return "sale";
  if (operationId === "rent") return "rent";
  if (operationId === "purchase") return "budget";
  if (operationId === "investment") return "investment";
  return "unknown";
}

function safeTrim(v) {
  return String(v == null ? "" : v).trim();
}

export function buildReviewDefaults(extractionFields = {}, sourceText = "", meta = {}) {
  const text = String(sourceText || "");
  const extended = meta.extended || extractionFields.extended || {};
  const op = matchOperationType(extractionFields, text);
  const propertyLabel = safeTrim(extractionFields.propertyType || extended.propertyType);
  const cityLabel = safeTrim(extractionFields.city);
  const districtLabel = safeTrim(extractionFields.district || extended.district);

  const mode = reviewTransactionMode(op?.id || "");
  const legacyValue = extractionFields.priceOrBudget ?? "";
  const salePrice = extended.salePrice ?? (mode === "sale" ? legacyValue : "");
  const annualRent = extended.annualRent ?? (mode === "rent" ? legacyValue : "");
  const budget = extended.budget ?? (mode === "budget" ? legacyValue : "");
  const investmentValue = mode === "investment" ? legacyValue : "";

  return {
    operationTypeId: op?.id || "",
    propertyType: propertyLabel,
    city: cityLabel,
    district: districtLabel,
    salePrice: salePrice === "" || salePrice == null ? "" : salePrice,
    annualRent: annualRent === "" || annualRent == null ? "" : annualRent,
    monthlyRent: extended.monthlyRent ?? "",
    optionalMonthlyRent: extended.optionalMonthlyRentAfterSixMonths ?? "",
    paymentInstallments: extended.paymentInstallments ?? "",
    budget: budget === "" || budget == null ? "" : budget,
    investmentValue: investmentValue === "" || investmentValue == null ? "" : investmentValue,
    priceOrBudget: legacyValue === "" || legacyValue == null ? "" : legacyValue,
    area: extractionFields.area ?? extended.area ?? "",
    rooms: extractionFields.rooms ?? extended.rooms ?? "",
    bathrooms: extended.bathrooms ?? extractionFields.bathrooms ?? "",
    floorNumber: extended.floorNumber ?? extractionFields.floorNumber ?? "",
    needsReview: meta.needsReview || extractionFields.needsReview || {},
    extractedSnapshot: {
      opportunityKind: extractionFields.opportunityKind || "",
      purpose: extractionFields.purpose || "",
      propertyType: propertyLabel,
      city: cityLabel,
      district: districtLabel,
      transactionType: extended.transactionType || "",
      bathrooms: extended.bathrooms ?? null,
      floorNumber: extended.floorNumber ?? null,
      salePrice: extended.salePrice ?? null,
      annualRent: extended.annualRent ?? null,
      budget: extended.budget ?? null
    }
  };
}

export function normalizeCityLabel(raw = "") {
  const label = safeTrim(raw);
  if (!label) return "";
  const matched = matchCity(label);
  return matched?.label || label;
}

export function isLandPropertyLabel(value = "") {
  return /أرض|ارض/.test(safeTrim(value));
}

export function reviewValuesToBrokerFields(review) {
  const broker = mapOperationToBrokerFields(
    review.operationTypeId,
    review.extractedSnapshot?.opportunityKind
  );
  const mode = reviewTransactionMode(review.operationTypeId);
  const propertyType = safeTrim(review.propertyType);
  const isLand = isLandPropertyLabel(propertyType);
  const salePrice = mode === "sale" && review.salePrice !== "" && review.salePrice != null
    ? Number(review.salePrice)
    : null;
  const annualRent = mode === "rent" && review.annualRent !== "" && review.annualRent != null
    ? Number(review.annualRent)
    : null;
  const monthlyRent = mode === "rent" && review.monthlyRent !== "" && review.monthlyRent != null
    ? Number(review.monthlyRent)
    : null;
  const optionalMonthlyRentAfterSixMonths = mode === "rent"
    && review.optionalMonthlyRentAfterSixMonths !== ""
    && review.optionalMonthlyRentAfterSixMonths != null
    ? Number(review.optionalMonthlyRentAfterSixMonths)
    : null;
  const budget = mode === "budget" && review.budget !== "" && review.budget != null
    ? Number(review.budget)
    : null;
  const investmentValue = mode === "investment"
    && review.investmentValue !== ""
    && review.investmentValue != null
    ? Number(review.investmentValue)
    : null;
  const priceOrBudget = mode === "sale"
    ? salePrice
    : mode === "rent"
      ? annualRent
      : mode === "budget"
        ? budget
        : mode === "investment"
          ? investmentValue
          : null;

  const cityName = normalizeCityLabel(review.city);
  const districtName = safeTrim(review.district);
  const matchedProperty = matchPropertyType(propertyType);
  const matchedCity = matchCity(cityName);
  const matchedDistrict = districtName
    ? matchDistrict(districtName, matchedCity?.id || "madinah")
    : null;

  return {
    ...broker,
    propertyType,
    city: cityName,
    district: districtName,
    salePrice,
    annualRent,
    monthlyRent,
    optionalMonthlyRentAfterSixMonths,
    budget,
    priceOrBudget,
    area: review.area === "" || review.area == null ? null : Number(review.area),
    rooms: isLand || review.rooms === "" || review.rooms == null ? null : Number(review.rooms),
    bathrooms: isLand || review.bathrooms === "" || review.bathrooms == null ? null : Number(review.bathrooms),
    floorNumber: isLand || review.floorNumber === "" || review.floorNumber == null ? null : Number(review.floorNumber),
    paymentInstallments: mode !== "rent" || review.paymentInstallments === "" || review.paymentInstallments == null
      ? null
      : Number(review.paymentInstallments),
    reviewOperationTypeId: review.operationTypeId,
    reviewPropertyTypeId: matchedProperty?.id || (propertyType ? "other" : ""),
    reviewCityId: matchedCity?.id || (cityName ? "other" : ""),
    reviewDistrictId: matchedDistrict?.id || (districtName ? DISTRICT_OTHER_ID : ""),
    extractedSnapshot: review.extractedSnapshot || null
  };
}
