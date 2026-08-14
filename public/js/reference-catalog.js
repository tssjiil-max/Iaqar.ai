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
export const DISTRICT_UNCONFIRMED_WARNING = "لم يتم التعرف على الحي بدقة — راجعه قبل الإرسال.";

const LEGACY_LABEL_MAP = Object.freeze({
  madina: "المدينة المنورة",
  "al madina": "المدينة المنورة",
  "al-wabra": "الوبرة",
  "al wabra": "الوبرة",
  alwabra: "الوبرة"
});

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

export function containsArabicPhrase(text, phrase) {
  const hay = normalizeSearchText(text);
  const needle = normalizeSearchText(phrase);
  if (!hay || !needle) return false;
  if (hay === needle) return true;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`, "u").test(hay);
}

export function normalizeLegacyArabicLabel(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return "";
  const asciiKey = text.toLowerCase().replace(/[_-]/g, " ").trim();
  if (LEGACY_LABEL_MAP[asciiKey]) return LEGACY_LABEL_MAP[asciiKey];
  const normalized = normalizeSearchText(text);
  for (const [key, label] of Object.entries(LEGACY_LABEL_MAP)) {
    if (normalizeSearchText(key) === normalized) return label;
  }
  return text;
}

export function conservativeMatchPropertyType(raw = "") {
  const display = normalizeLegacyArabicLabel(raw);
  const hay = normalizeSearchText(display);
  if (!hay) return { match: null, confirmed: false, display: "" };
  let best = null;
  let bestLen = 0;
  for (const item of PROPERTY_TYPES) {
    if (item.id === "other") continue;
    for (const term of item.matchTerms) {
      const t = normalizeSearchText(term);
      if (!t || t.length < 2) continue;
      if (hay === t && t.length >= bestLen) {
        best = item;
        bestLen = t.length;
      } else if (t.length >= 2 && containsArabicPhrase(hay, t) && t.length >= bestLen) {
        best = item;
        bestLen = t.length;
      }
    }
  }
  if (best) return { match: best, confirmed: true, display: best.label };
  return { match: null, confirmed: false, display: display };
}

export function conservativeMatchDistrict(raw = "", cityId = "madinah") {
  const display = normalizeLegacyArabicLabel(raw).replace(/^حي\s+/, "").trim();
  const hay = normalizeSearchText(display);
  if (!hay || cityId !== "madinah") {
    return {
      match: null,
      confirmed: false,
      display,
      warning: display ? DISTRICT_UNCONFIRMED_WARNING : ""
    };
  }
  const ranked = [...DISTRICTS]
    .filter((d) => d.active)
    .sort((a, b) => {
      const al = Math.max(...a.aliases.map((x) => normalizeSearchText(x).length));
      const bl = Math.max(...b.aliases.map((x) => normalizeSearchText(x).length));
      return bl - al;
    });
  for (const district of ranked) {
    for (const alias of district.aliases) {
      const a = normalizeSearchText(alias).replace(/^حي\s+/, "");
      if (!a || a.length < 3) continue;
      if (hay === a) {
        return { match: district, confirmed: true, display: district.officialName, warning: "" };
      }
      if (containsArabicPhrase(hay, a) && hay.length >= a.length - 1) {
        return { match: district, confirmed: true, display: district.officialName, warning: "" };
      }
    }
  }
  return {
    match: null,
    confirmed: false,
    display,
    warning: display ? DISTRICT_UNCONFIRMED_WARNING : ""
  };
}

export function matchPropertyType(raw = "") {
  return conservativeMatchPropertyType(raw).match;
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
  return conservativeMatchDistrict(raw, cityId).match;
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

export function reviewTransactionMode(operationId, context = {}) {
  const purpose = String(context.purpose || "").toUpperCase();
  const kind = String(context.opportunityKind || "").toUpperCase();
  if (purpose === "LEASE_REQUEST" || (operationId === "rent" && kind === "REQUEST")) {
    return "budget";
  }
  if (operationId === "sale") return "sale";
  if (operationId === "rent") return "rent";
  if (operationId === "purchase") return "budget";
  if (operationId === "investment") return "investment";
  return "unknown";
}

export function buildReviewDefaults(extractionFields = {}, sourceText = "", meta = {}) {
  const text = String(sourceText || "");
  const extended = meta.extended || extractionFields.extended || {};
  const op = matchOperationType(extractionFields, text);
  const propertyLabel = normalizeLegacyArabicLabel(
    safeTrim(extractionFields.propertyType || extended.propertyType)
  );
  const propertyResult = propertyLabel ? conservativeMatchPropertyType(propertyLabel) : { match: null, confirmed: false, display: "" };
  const property = propertyResult.match;
  const cityLabel = normalizeLegacyArabicLabel(safeTrim(extractionFields.city));
  const city = cityLabel ? matchCity(cityLabel) : null;
  const districtLabel = normalizeLegacyArabicLabel(
    safeTrim(extractionFields.district || extended.district)
  );
  const cityIdForDistrict = city?.id || "madinah";
  const districtResult = districtLabel
    ? conservativeMatchDistrict(districtLabel, cityIdForDistrict)
    : { match: null, confirmed: false, display: "", warning: "" };
  const district = districtResult.match;
  const unmatchedDistrictManual = !district && districtLabel
    ? districtLabel.split(/\s+/).slice(0, 4).join(" ").trim()
    : "";

  const reviewContext = {
    purpose: extractionFields.purpose || extended.purpose || "",
    opportunityKind: extractionFields.opportunityKind || extended.opportunityKind || ""
  };
  const mode = reviewTransactionMode(op?.id || "", reviewContext);
  const legacyValue = extractionFields.priceOrBudget ?? extractionFields.budget ?? extractionFields.annualRent ?? "";
  const salePrice = extended.salePrice ?? (mode === "sale" ? legacyValue : "");
  const annualRent = extended.annualRent ?? (mode === "rent" ? legacyValue : "");
  const budget = extended.budget ?? extractionFields.budget ?? (mode === "budget" ? legacyValue : "");
  const investmentValue = mode === "investment" ? legacyValue : "";

  return {
    operationTypeId: op?.id || "",
    propertyTypeId: property?.id || (propertyLabel ? "other" : ""),
    propertyTypeManual: property ? "" : (propertyResult.display || propertyLabel),
    propertyTypeDisplay: propertyResult.display || property?.label || propertyLabel,
    propertyTypeConfirmed: propertyResult.confirmed,
    districtDisplay: districtResult.display || district?.officialName || districtLabel,
    districtConfirmed: districtResult.confirmed,
    districtUnconfirmedWarning: districtResult.warning || "",
    cityId: city?.id || "",
    cityManual: city ? "" : cityLabel,
    districtId: district?.id || (unmatchedDistrictManual ? DISTRICT_OTHER_ID : ""),
    districtManual: district ? "" : unmatchedDistrictManual,
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

function safeTrim(v) {
  return String(v == null ? "" : v).trim();
}

export function reviewValuesToBrokerFields(review) {
  const op = OPERATION_TYPES.find((o) => o.id === review.operationTypeId);
  const property = PROPERTY_TYPES.find((p) => p.id === review.propertyTypeId);
  const city = CITIES.find((c) => c.id === review.cityId);
  const district = DISTRICTS.find((d) => d.id === review.districtId);

  const snapshot = review.extractedSnapshot || {};
  const broker = mapOperationToBrokerFields(
    review.operationTypeId,
    snapshot.opportunityKind
  );
  const mode = reviewTransactionMode(review.operationTypeId, {
    purpose: snapshot.purpose || broker.purpose || "",
    opportunityKind: snapshot.opportunityKind || broker.opportunityKind || ""
  });
  const isLand = review.propertyTypeId === "land" || property?.label === "أرض";
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

  let propertyType = safeTrim(review.propertyTypeDisplay) || safeTrim(review.propertyTypeManual);
  if (!propertyType && property) propertyType = property.label || "";
  let cityName = city?.label || "";
  if (review.cityId === "other") cityName = safeTrim(review.cityManual);
  let districtName = safeTrim(review.districtDisplay) || safeTrim(review.districtManual);
  if (!districtName && district) districtName = district.officialName || "";

  return {
    ...broker,
    propertyType,
    city: cityName === "مدينة أخرى" ? safeTrim(review.cityManual) : cityName,
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
    reviewPropertyTypeId: review.propertyTypeId,
    reviewCityId: review.cityId,
    reviewDistrictId: review.districtId === DISTRICT_OTHER_ID ? "" : review.districtId,
    extractedSnapshot: review.extractedSnapshot || null
  };
}
