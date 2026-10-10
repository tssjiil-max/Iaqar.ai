/**
 * Repository (العروض والطلبات) domain — pure, shared by the office UI, the public
 * office page and the Worker. Records live in offices/{officeId}/opportunities and keep
 * the canonical field names the matching engine and admission gate already read.
 *
 * Area is optional everywhere: form, server validation, completeness and matching.
 */

import { cleanText, formatArea, formatPrice, localPhone, toNumber, whatsappDigits } from "./format-domain.js";

export const RECORD_KIND = Object.freeze({ OFFER: "OFFER", REQUEST: "REQUEST" });

export const PURPOSES = Object.freeze({
  OFFER: Object.freeze([
    { id: "SALE", label: "بيع", tx: "sale" },
    { id: "RENT", label: "إيجار", tx: "rent" }
  ]),
  REQUEST: Object.freeze([
    { id: "PURCHASE", label: "شراء", tx: "sale" },
    { id: "LEASE_REQUEST", label: "استئجار", tx: "rent" }
  ])
});

export const PROPERTY_TYPES = Object.freeze([
  "شقة", "فيلا", "دور", "دوبلكس", "أرض", "عمارة", "محل تجاري", "مكتب", "استراحة", "مستودع", "غرفة"
]);

export const LIFECYCLE = Object.freeze({ ACTIVE: "ACTIVE", ARCHIVED: "ARCHIVED", DELETED: "DELETED" });

export const LIFECYCLE_LABELS = Object.freeze({
  ACTIVE: "نشط",
  ARCHIVED: "مؤرشف",
  DELETED: "محذوف"
});

const PURPOSE_LABEL = Object.freeze({
  SALE: "للبيع", RENT: "للإيجار", PURCHASE: "طلب شراء", LEASE_REQUEST: "طلب استئجار"
});

export function kindOf(record = {}) {
  const raw = String(record.opportunityKind || record.kind || "").toUpperCase();
  if (raw.includes("OFFER") || raw === "OWNER") return RECORD_KIND.OFFER;
  if (raw.includes("REQUEST") || raw === "CLIENT") return RECORD_KIND.REQUEST;
  const purpose = String(record.purpose || "").toUpperCase();
  if (purpose === "SALE" || purpose === "RENT") return RECORD_KIND.OFFER;
  if (purpose === "PURCHASE" || purpose === "LEASE_REQUEST") return RECORD_KIND.REQUEST;
  return "";
}

export function purposeOptions(kind) {
  return PURPOSES[kind] || [];
}

export function purposeLabel(purpose) {
  return PURPOSE_LABEL[String(purpose || "").toUpperCase()] || "";
}

export function purposeShortLabel(purpose) {
  const all = [...PURPOSES.OFFER, ...PURPOSES.REQUEST];
  return all.find((p) => p.id === String(purpose || "").toUpperCase())?.label || "";
}

export function transactionTypeFor(purpose) {
  const all = [...PURPOSES.OFFER, ...PURPOSES.REQUEST];
  return all.find((p) => p.id === String(purpose || "").toUpperCase())?.tx || "";
}

export function lifecycleOf(record = {}) {
  if (record.deletedAt) return LIFECYCLE.DELETED;
  const raw = String(record.lifecycleStatus || "ACTIVE").toUpperCase();
  if (raw === "DELETED") return LIFECYCLE.DELETED;
  if (raw === "ARCHIVED" || raw === "CLOSED" || raw === "LOST") return LIFECYCLE.ARCHIVED;
  return LIFECYCLE.ACTIVE;
}

/** A paused record is out of matching for now («موقوف مؤقتًا»); an archived one is filed away. Both keep their history. */
export function isPaused(record = {}) {
  return lifecycleOf(record) === LIFECYCLE.ARCHIVED && String(record.archiveKind || "").toUpperCase() === "PAUSED";
}

/** ACTIVE | PAUSED | ARCHIVED | DELETED — what the broker sees and filters by. */
export function recordState(record = {}) {
  const lifecycle = lifecycleOf(record);
  return lifecycle === LIFECYCLE.ARCHIVED && isPaused(record) ? "PAUSED" : lifecycle;
}

export const RECORD_STATE_LABELS = Object.freeze({ ACTIVE: "نشط", PAUSED: "موقوف مؤقتًا", ARCHIVED: "مؤرشف", DELETED: "محذوف" });

export function priceOf(record = {}) {
  const purpose = String(record.purpose || "").toUpperCase();
  if (purpose === "SALE") return toNumber(record.salePrice ?? record.priceOrBudget ?? record.price);
  if (purpose === "RENT") return toNumber(record.annualRent ?? record.priceOrBudget ?? record.price);
  return toNumber(record.budget ?? record.priceMax ?? record.priceOrBudget ?? record.price);
}

/**
 * Validate and normalize broker/public form input. Returns
 * { ok, errors: {field: message}, value } — `value` is safe to persist.
 */
export function validateRecordInput(input = {}, { requireName = false } = {}) {
  const errors = {};
  const kind = kindOf({ opportunityKind: input.kind || input.opportunityKind });
  if (!kind) errors.kind = "اختر عرض أو طلب";
  const purpose = String(input.purpose || "").toUpperCase();
  if (!purposeOptions(kind).some((p) => p.id === purpose)) errors.purpose = "اختر الغرض";
  const propertyType = cleanText(input.propertyType, 40);
  if (!propertyType) errors.propertyType = "اختر نوع العقار";
  const city = cleanText(input.city, 60);
  if (!city) errors.city = "اكتب المدينة";
  const district = cleanText(input.district, 80);
  if (!district) errors.district = "اكتب الحي";
  const price = toNumber(input.price ?? input.priceOrBudget ?? input.budget);
  if (!(price > 0)) errors.price = kind === RECORD_KIND.REQUEST ? "اكتب الميزانية" : "اكتب السعر";
  else if (price > 10_000_000_000) errors.price = "القيمة غير منطقية";
  const areaRaw = input.area;
  const area = toNumber(areaRaw);
  if (areaRaw !== undefined && areaRaw !== null && String(areaRaw).trim() !== "" && !(area > 0)) {
    errors.area = "المساحة رقم موجب أو اتركها فارغة";
  }
  const rooms = toNumber(input.rooms);
  if (rooms && (rooms < 0 || rooms > 50)) errors.rooms = "عدد الغرف غير صالح";
  const contactName = cleanText(input.contactName ?? input.name, 80);
  if (requireName && contactName.length < 2) errors.contactName = "اكتب الاسم";
  const phoneDigits = whatsappDigits(input.contactPhone ?? input.phone);
  if (!phoneDigits) errors.contactPhone = "اكتب رقم جوال سعودي يبدأ بـ 05";
  const notes = cleanText(input.notes ?? input.details, 1000);
  // The owner's price decision (offers only): «السعر ثابت» or «قابل للتفاوض» (default).
  const priceStatus = kind === RECORD_KIND.OFFER && String(input.priceStatus || "").toUpperCase() === "FIXED" ? "FIXED" : "NEGOTIABLE";
  const value = {
    kind,
    purpose,
    propertyType,
    city,
    district,
    price,
    area: area > 0 ? area : null,
    rooms: rooms > 0 ? Math.round(rooms) : null,
    contactName,
    contactPhone: phoneDigits ? `0${phoneDigits.slice(3)}` : "",
    notes,
    priceStatus
  };
  return { ok: Object.keys(errors).length === 0, errors, value };
}

/**
 * Canonical Firestore field values (plain JS; the caller encodes them).
 * `existing` keeps immutable ownership fields on edits.
 */
export function recordFields(value, { officeId, brokerId, sourceType = "BROKER_DIRECT", sourceReference = "", existing = null, now = new Date() }) {
  const isOffer = value.kind === RECORD_KIND.OFFER;
  const tx = transactionTypeFor(value.purpose);
  const phoneIntl = whatsappDigits(value.contactPhone);
  const fields = {
    officeId,
    opportunityKind: value.kind,
    kind: isOffer ? "owner" : "client",
    purpose: value.purpose,
    transactionType: tx,
    propertyType: value.propertyType,
    city: value.city,
    district: value.district,
    priceOrBudget: value.price,
    price: value.price,
    salePrice: isOffer && value.purpose === "SALE" ? value.price : null,
    annualRent: value.purpose === "RENT" || value.purpose === "LEASE_REQUEST" ? value.price : null,
    budget: isOffer ? null : value.price,
    priceMax: isOffer ? null : value.price,
    area: value.area,
    rooms: value.rooms,
    contactName: value.contactName,
    contactPhone: value.contactPhone,
    advertiserPhoneNormalized: phoneIntl ? `+${phoneIntl}` : "",
    advertiserDisplayName: value.contactName,
    advertiserRole: isOffer ? "OWNER" : "CLIENT",
    notes: value.notes,
    details: value.notes,
    priceStatus: isOffer ? (value.priceStatus === "FIXED" ? "FIXED" : "NEGOTIABLE") : null,
    matchingReadiness: "READY_FOR_MATCHING",
    matchingReadinessMissingJson: "[]",
    lifecycleStatus: existing ? (existing.lifecycleStatus || LIFECYCLE.ACTIVE) : LIFECYCLE.ACTIVE,
    updatedAt: now,
    version: existing ? Number(existing.version || 1) + 1 : 1,
    brokerConfirmed: true
  };
  if (!existing) {
    Object.assign(fields, {
      brokerId: brokerId || "",
      originatingOfficeId: officeId,
      originatingBrokerId: brokerId || "",
      currentOwningOfficeId: officeId,
      assignedOfficeId: officeId,
      sourceType,
      sourceReference: sourceReference || sourceType,
      originSourceType: sourceType === "OFFICE_LINK" ? "OFFICE_DIRECT" : "DIRECT_ADD",
      createdAt: now
    });
  }
  return fields;
}

/** Stable duplicate key for (office, kind, purpose, phone, type, district). */
export function recordFingerprint(value, officeId) {
  return [officeId, value.kind, value.purpose, whatsappDigits(value.contactPhone), value.propertyType, value.district]
    .map((part) => String(part || "").toLowerCase().replace(/\s+/g, ""))
    .join("|");
}

export function recordTitle(record = {}) {
  const type = cleanText(record.propertyType, 40) || "عقار";
  const purpose = String(record.purpose || "").toUpperCase();
  const kind = kindOf(record);
  const where = cleanText(record.district, 80);
  const place = where ? ` في ${where.startsWith("حي") ? where : `حي ${where}`}` : "";
  if (kind === RECORD_KIND.REQUEST) {
    return `${purpose === "LEASE_REQUEST" ? "طلب استئجار" : "طلب شراء"} ${type}${place}`;
  }
  return `${type} ${purpose === "RENT" ? "للإيجار" : "للبيع"}${place}`;
}

export function recordLocation(record = {}) {
  const district = cleanText(record.district, 80);
  const city = cleanText(record.city, 60);
  const d = district ? (district.startsWith("حي") ? district : `حي ${district}`) : "";
  return [city, d].filter(Boolean).join(" - ");
}

export function recordPriceLabel(record = {}) {
  const kind = kindOf(record);
  const price = formatPrice(priceOf(record));
  if (!price) return "";
  return kind === RECORD_KIND.REQUEST ? `الميزانية ${price}` : `السعر ${price}`;
}

/** Normalized view for cards and details. Never includes images for requests. */
export function recordView(record = {}) {
  const kind = kindOf(record);
  return {
    id: String(record.id || ""),
    kind,
    kindLabel: kind === RECORD_KIND.REQUEST ? "طلب" : kind === RECORD_KIND.OFFER ? "عرض" : "سجل",
    purpose: String(record.purpose || "").toUpperCase(),
    purposeLabel: purposeShortLabel(record.purpose),
    title: recordTitle(record),
    location: recordLocation(record),
    propertyType: cleanText(record.propertyType, 40),
    price: priceOf(record),
    priceLabel: recordPriceLabel(record),
    area: toNumber(record.area),
    areaLabel: formatArea(record.area),
    rooms: toNumber(record.rooms),
    contactName: cleanText(record.contactName || record.advertiserDisplayName || record.name, 80),
    contactPhone: localPhone(record.contactPhone || record.advertiserPhoneNormalized || record.phone),
    priceStatus: String(record.priceStatus || "").toUpperCase() === "FIXED" ? "FIXED" : "NEGOTIABLE",
    priceStatusLabel: String(record.priceStatus || "").toUpperCase() === "FIXED" ? "السعر ثابت" : "قابل للتفاوض",
    notes: cleanText(record.notes || record.details, 1000),
    lifecycle: lifecycleOf(record),
    state: recordState(record),
    paused: isPaused(record),
    lifecycleLabel: RECORD_STATE_LABELS[recordState(record)] || LIFECYCLE_LABELS[lifecycleOf(record)],
    reference: cleanText(record.referenceCode, 40) || String(record.id || "").slice(-6).toUpperCase(),
    missing: missingForMatching(record)
  };
}

/** Fields still needed before this record can enter matching. Area never blocks. */
export function missingForMatching(record = {}) {
  const missing = [];
  if (!kindOf(record)) missing.push("opportunityKind");
  const purpose = String(record.purpose || "").toUpperCase();
  if (!["SALE", "RENT", "PURCHASE", "LEASE_REQUEST"].includes(purpose)) missing.push("purpose");
  if (!cleanText(record.propertyType)) missing.push("propertyType");
  if (!cleanText(record.city)) missing.push("city");
  if (!cleanText(record.district)) missing.push("district");
  if (!(priceOf(record) > 0)) missing.push("priceOrBudget");
  if (!whatsappDigits(record.contactPhone || record.advertiserPhoneNormalized || record.phone)) missing.push("contactPhone");
  return missing;
}

export const MISSING_LABELS = Object.freeze({
  cooperationReview: "مراجعة التمثيل وقبول التعاون",
  opportunityKind: "نوع السجل",
  purpose: "الغرض",
  propertyType: "نوع العقار",
  city: "المدينة",
  district: "الحي",
  priceOrBudget: "السعر أو الميزانية",
  contactPhone: "رقم الجوال",
  advertiserRole: "صفة المعلن"
});

function norm(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[ً-ٟـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Filter + search. `filters`: { query, kind, purpose, propertyType, location,
 * priceMin, priceMax, status } where status ∈ ACTIVE | PAUSED | ARCHIVED | ALL (DELETED never shown).
 */
export function filterRecords(records = [], filters = {}) {
  const query = norm(filters.query);
  const location = norm(filters.location);
  const min = toNumber(filters.priceMin);
  const max = toNumber(filters.priceMax);
  const status = String(filters.status || "ACTIVE").toUpperCase();
  return records.filter((record) => {
    const view = recordView(record);
    if (view.lifecycle === LIFECYCLE.DELETED) return false;
    if (status !== "ALL" && view.state !== status) return false;
    if (filters.kind && view.kind !== filters.kind) return false;
    if (filters.purpose && view.purpose !== String(filters.purpose).toUpperCase()) return false;
    if (filters.propertyType && norm(view.propertyType) !== norm(filters.propertyType)) return false;
    if (location && !norm(`${record.city || ""} ${record.district || ""}`).includes(location)) return false;
    if (min && view.price < min) return false;
    if (max && view.price > max) return false;
    if (query) {
      const hay = norm([view.title, view.location, view.contactName, view.contactPhone, view.notes, view.reference, view.propertyType].join(" "));
      const digits = query.replace(/\D/g, "");
      if (!hay.includes(query) && !(digits.length >= 4 && hay.replace(/\D/g, "").includes(digits))) return false;
    }
    return true;
  });
}

export function sortRecords(records = []) {
  const ts = (r) => {
    const v = r.updatedAt || r.createdAt;
    if (!v) return 0;
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.seconds === "number") return v.seconds * 1000;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  return [...records].sort((a, b) => ts(b) - ts(a));
}
