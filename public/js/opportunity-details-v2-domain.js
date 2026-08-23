/**
 * OpportunityDetailsV2 — ViewModel mapper only.
 * Maps current domain records into a stable V2 view-model.
 * Does not render UI and does not mutate Firestore.
 */

import { evaluateMatchingReadiness, MISSING_FIELD_LABELS } from "./opportunity-readiness-domain.js";
import {
  ADVERTISER_ROLES,
  formatLocalPhoneDisplay,
  readAdvertiserDisplayName
} from "./advertiser-phone-domain.js";
import { normalizeOpportunityFinancials, safeText } from "./opportunity-intake-domain.js";
import {
  formatLocationLine,
  normalizePropertyTypeDisplay,
  sanitizeDisplayField
} from "./display-sanitize-domain.js";
import { normalizeLegacyArabicLabel } from "./reference-catalog.js";
import {
  activeFollowUpFromRecord,
  formatFollowUpAppointmentLine
} from "./opportunity-followup-domain.js";
import { buildWorkspaceActivity } from "./opportunity-workspace-domain.js";

const TZ = "Asia/Riyadh";

export const OPPORTUNITY_DETAILS_V2_FLAG = "iaqar.opportunityDetailsV2";
export const OPPORTUNITY_V2_DEEP_LINK_PREFIX = "#/opportunities-v2/";

export const V2_DATA_ROWS = Object.freeze([
  { key: "propertyPurpose", label: "العقار والغرض", icon: "i-house" },
  { key: "location", label: "الموقع", icon: "i-map-pin" },
  { key: "price", label: "السعر", icon: "i-money" },
  { key: "specs", label: "المساحة والمواصفات", icon: "i-ruler" },
  { key: "advertiser", label: "المعلن وصفته", icon: "i-user" },
  { key: "contact", label: "رقم التواصل", icon: "i-phone" }
]);

export const V2_MISSING_FIELD_EDITORS = Object.freeze({
  advertiserRole: { editor: "advertiserRole", label: "صفة المعلن" },
  contactPhone: { editor: "contactNumber", label: "رقم التواصل" },
  contactNumber: { editor: "contactNumber", label: "رقم التواصل" },
  priceOrBudget: { editor: "price", label: "السعر" },
  price: { editor: "price", label: "السعر" },
  salePrice: { editor: "price", label: "السعر" },
  annualRent: { editor: "price", label: "السعر" },
  budget: { editor: "price", label: "الميزانية" },
  area: { editor: "area", label: "المساحة" },
  city: { editor: "location", label: "الموقع" },
  district: { editor: "location", label: "الموقع" },
  location: { editor: "location", label: "الموقع" },
  purpose: { editor: "propertyPurpose", label: "الغرض" },
  propertyType: { editor: "propertyPurpose", label: "نوع العقار" }
});

const CITY_ALIASES = Object.freeze({
  riyadh: "الرياض",
  madina: "المدينة المنورة",
  "al-madinah": "المدينة المنورة"
});

function isOwnerRecord(record = {}) {
  const kind = String(record.opportunityKind || record.kind || record.recordType || "").toUpperCase();
  return record.contactType === "owner"
    || kind === "OWNER"
    || kind === "OWNER_OFFER"
    || kind === "OFFER";
}

function riyadhDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatHijriDate(value) {
  const date = riyadhDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return year && month && day ? `${year}/${month}/${day}` : "";
}

function formatClockLabel(value) {
  const date = riyadhDate(value);
  if (!date) return "";
  return date.toLocaleTimeString("ar-SA", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).replace(/\s+/g, " ").trim();
}

function isSameRiyadhDay(a, b) {
  const left = new Date(a.toLocaleString("en-US", { timeZone: TZ }));
  const right = new Date(b.toLocaleString("en-US", { timeZone: TZ }));
  return left.toDateString() === right.toDateString();
}

export function formatV2DisplayNumber(id = "") {
  const raw = String(id || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  if (raw.length <= 8) return raw;
  return raw.slice(-8);
}

function normalizePlace(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const alias = CITY_ALIASES[raw.toLowerCase().replace(/[_-]/g, " ").trim()];
  if (alias) return alias;
  const cleaned = sanitizeDisplayField(normalizePropertyTypeDisplay(normalizeLegacyArabicLabel(raw)));
  const text = cleaned.display || raw;
  if (!text || text === "غير محدد" || text.includes("تحتاج مراجعة")) return "";
  return text;
}

function purposeWord(record = {}) {
  const purpose = String(record.purpose || record.transactionType || "").toUpperCase();
  if (purpose === "RENT" || purpose === "LEASE_REQUEST") return "للإيجار";
  if (purpose === "SALE" || purpose === "PURCHASE") return "للبيع";
  if (purpose === "INVESTMENT") return "للاستثمار";
  return "";
}

function propertyPurposeLine(record = {}) {
  const propertyType = normalizePlace(record.propertyType);
  const purpose = purposeWord(record);
  if (propertyType && purpose) return `${propertyType} ${purpose}`;
  return propertyType || purpose || "";
}

function locationParts(record = {}) {
  const city = normalizePlace(record.city);
  const district = normalizePlace(record.district).replace(/^حي\s+/, "");
  const primary = [city, district ? `حي ${district}` : ""].filter(Boolean).join(" - ");
  return {
    primary: primary || formatLocationLine(city, district) || "",
    secondary: district ? `الحي: ${district}` : ""
  };
}

function moneyValue(record = {}) {
  const fields = normalizeOpportunityFinancials(record);
  const isOwner = isOwnerRecord(record);
  const price = Number(fields.salePrice ?? record.price ?? record.priceOrBudget ?? 0);
  const budget = Number(fields.budget ?? record.budget ?? record.priceOrBudget ?? 0);
  const annualRent = Number(fields.annualRent ?? record.annualRent ?? 0);
  if (isOwner && price > 0) return `${price.toLocaleString("en-US")} ريال`;
  if (!isOwner && budget > 0) return `${budget.toLocaleString("en-US")} ريال`;
  if (annualRent > 0) return `${annualRent.toLocaleString("en-US")} ريال`;
  if (price > 0) return `${price.toLocaleString("en-US")} ريال`;
  return "";
}

function specsParts(record = {}) {
  const area = Number(record.area || 0);
  const primary = area > 0 ? `${area.toLocaleString("en-US")} م²` : "";
  const bits = [];
  const streetWidth = Number(record.streetWidth || 0);
  if (streetWidth > 0) bits.push(`شارع ${streetWidth.toLocaleString("en-US")} م`);
  const facing = safeText(record.facing || record.direction || "", 40);
  if (facing) bits.push(`واجهة ${facing}`);
  const rooms = Number(record.rooms || 0);
  if (rooms > 0) bits.push(`${rooms.toLocaleString("en-US")} غرف`);
  return { primary, secondary: bits.join("، ") };
}

function advertiserRoleLabel(value = "") {
  const id = String(value || "").trim().toUpperCase();
  return ADVERTISER_ROLES.find((row) => row.id === id)?.label || "";
}

function advertiserSecondaryLabel(value = "") {
  const id = String(value || "").trim().toUpperCase();
  if (id === "OWNER") return "مالك مباشر";
  if (id === "CLIENT") return "عميل مباشر";
  if (id === "DELEGATE") return "مفوض عن الطرف";
  if (id === "BROKER") return "وسيط عقاري";
  return "";
}

function resolveStatus(record = {}, readiness = {}) {
  const lifecycle = String(record.lifecycleStatus || "").trim().toUpperCase();
  if (lifecycle === "ARCHIVED" || record.archivedAt) return { id: "ended", label: "منتهية" };
  if (lifecycle === "CLOSED_WON" || lifecycle === "CLOSED_LOST") return { id: "ended", label: "منتهية" };
  if (readiness.isReadyForMatching) return { id: "ready", label: "جاهزة" };
  return { id: "incomplete", label: "ناقصة" };
}

function missingLabel(key = "", isOwner = true) {
  if (key === "priceOrBudget" || key === "price" || key === "salePrice" || key === "annualRent" || key === "budget") {
    return isOwner ? "السعر" : "الميزانية";
  }
  if (key === "contactPhone" || key === "contactNumber") return "رقم التواصل";
  return MISSING_FIELD_LABELS[key] || key;
}

function classifyActivity(item = {}) {
  const text = String(item.text || item.result || "").trim();
  if (/واتساب|تواصل/.test(text)) return { title: "متابعة المالك", result: text };
  if (/موعد|معاينة/.test(text)) {
    return { title: "تحديد موعد", result: text.replace(/^تم تحديد موعد متابعة:\s*/u, "") || text };
  }
  if (/تعاون|إرسال|مكتب/.test(text)) return { title: "إرسال الفرصة", result: text };
  if (/نواقص|إضافة|استيراد|مراجعة/.test(text)) return { title: "مراجعة البيانات", result: text };
  return { title: item.title || "نشاط", result: text };
}

function mapActivities(record = {}, extras = {}) {
  if (Array.isArray(extras.activities) && extras.activities.length) {
    return extras.activities.map((row) => ({
      time: row.time || formatClockLabel(row.at) || "",
      title: row.title || "",
      result: row.result || ""
    }));
  }
  const activity = Array.isArray(extras.activity) && extras.activity.length
    ? extras.activity
    : buildWorkspaceActivity(record, extras.cooperationRequests || []);
  return activity.map((item) => {
    const classified = classifyActivity(item);
    return {
      time: item.time || formatClockLabel(item.at) || "",
      title: item.title || classified.title,
      result: item.result || classified.result
    };
  }).filter((row) => row.time || row.title || row.result);
}

function mapAppointment(record = {}, extras = {}) {
  if (extras.nextAppointment && typeof extras.nextAppointment === "object") {
    return {
      dateTime: extras.nextAppointment.dateTime || "",
      type: extras.nextAppointment.type || "",
      confirmationStatus: extras.nextAppointment.confirmationStatus || ""
    };
  }
  const followUp = activeFollowUpFromRecord(record);
  if (!followUp?.at) {
    return { dateTime: "", type: "", confirmationStatus: "" };
  }
  const when = (formatFollowUpAppointmentLine(followUp.at) || formatClockLabel(followUp.at) || "")
    .replace("غدًا", "غداً");
  const rawType = String(followUp.purpose || followUp.title || followUp.kind || "").trim();
  const type = rawType === "inspection" || rawType === "viewing" || !rawType
    ? "معاينة العقار"
    : rawType;
  const party = isOwnerRecord(record) ? "المالك" : "العميل";
  const confirmed = String(followUp.confirmationOutcome || "").toLowerCase() === "confirmed";
  return {
    dateTime: when,
    type,
    confirmationStatus: `${party}: ${confirmed ? "تم التأكيد" : "بانتظار التأكيد"}`
  };
}

export function isOpportunityDetailsV2Enabled(locationLike, storageLike) {
  const loc = locationLike || (typeof window !== "undefined" ? window.location : {});
  const params = new URLSearchParams(loc.search || "");
  if (params.get("oppV2") === "1" || params.get("oppV2") === "true") return true;
  if (/^#\/opportunities-v2\//.test(String(loc.hash || ""))) return true;
  try {
    const storage = storageLike || (typeof localStorage !== "undefined" ? localStorage : null);
    return storage?.getItem(OPPORTUNITY_DETAILS_V2_FLAG) === "1";
  } catch {
    return false;
  }
}

export function parseOpportunityV2IdFromHash(hash = "") {
  const match = String(hash || "").match(/^#\/opportunities-v2\/([^/?#]+)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return "";
  }
}

export function buildOpportunityV2DeepLinkHash(opportunityId) {
  const id = String(opportunityId || "").trim();
  return id ? `${OPPORTUNITY_V2_DEEP_LINK_PREFIX}${encodeURIComponent(id)}` : "";
}

export function mapOpportunityDetailsV2ViewModel(id, record = {}, extras = {}) {
  const readiness = extras.readiness?.matchingReadiness
    ? extras.readiness
    : evaluateMatchingReadiness(record);
  const isOwner = isOwnerRecord(record);
  const added = riyadhDate(record.createdAt || record.receivedAt || record.updatedAt);
  const hijri = added ? formatHijriDate(added) : "";
  const clock = added ? formatClockLabel(added) : "";
  const dayBit = added && extras.now && isSameRiyadhDay(added, extras.now) ? "اليوم " : "";
  const createdAt = [hijri, `${dayBit}${clock}`.trim()].filter(Boolean).join(" | ");
  const location = locationParts(record);
  const specs = specsParts(record);
  const roleRaw = record.advertiserRole || record.ownerRole || "";
  const roleLabel = advertiserRoleLabel(roleRaw);
  const advertiserName = readAdvertiserDisplayName(record);
  const phoneRaw = record.advertiserPhoneNormalized || record.contactPhone || record.phone || "";
  const contactNumber = formatLocalPhoneDisplay(phoneRaw) || "";
  const missing = (readiness.matchingReadinessMissing || []).map((key) => ({
    key,
    editor: V2_MISSING_FIELD_EDITORS[key]?.editor || key,
    label: missingLabel(key, isOwner)
  }));
  const status = resolveStatus(record, readiness);
  const currentResult = missing.length
    ? `النتيجة الحالية: بانتظار استكمال ${missing.map((row) => row.label).join(" و")}`
    : status.id === "ready"
      ? "النتيجة الحالية: جاهزة للمطابقة"
      : status.id === "ended"
        ? "النتيجة الحالية: منتهية"
        : "النتيجة الحالية: بانتظار المتابعة";

  return {
    id: String(id || record.id || ""),
    displayNumber: formatV2DisplayNumber(id || record.id || ""),
    type: isOwner ? "عرض مالك" : "طلب عميل",
    status: status.label,
    statusId: status.id,
    createdAt,
    propertyPurpose: propertyPurposeLine(record),
    location: location.primary,
    locationSecondary: location.secondary,
    price: moneyValue(record),
    priceLabel: isOwner ? "السعر" : "الميزانية",
    area: specs.primary,
    specifications: specs.secondary,
    advertiserName,
    advertiserRole: roleLabel,
    advertiserSecondary: advertiserSecondaryLabel(roleRaw),
    contactNumber,
    missingFields: missing,
    activities: mapActivities(record, extras),
    currentResult,
    nextAppointment: mapAppointment(record, extras),
    isOwner
  };
}

export function v2ReferenceFixture() {
  return {
    id: "opp_v2_ref_1258",
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "عروة",
    area: 1000,
    streetWidth: 20,
    facing: "شمالية",
    advertiserRole: "OWNER",
    advertiserDisplayName: "",
    createdAt: "2026-08-22T07:40:00.000Z",
    lifecycleStatus: "ACTIVE",
    matchingReadiness: "NEEDS_COMPLETION",
    matchingReadinessMissing: ["priceOrBudget", "contactPhone"]
  };
}

export function v2ReferenceActivities() {
  return [
    { time: "10:40 ص", title: "مراجعة البيانات", result: "تم اكتشاف النواقص" },
    { time: "11:05 ص", title: "متابعة المالك", result: "تم فتح واتساب" }
  ];
}

export function v2ReferenceAppointment() {
  return {
    dateTime: "غداً 9:15 ص",
    type: "معاينة العقار",
    confirmationStatus: "المالك: بانتظار التأكيد"
  };
}
