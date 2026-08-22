/**
 * Ready-for-matching workspace — four primary actions, listing share, party actions.
 * Arabic UI labels only; no owner/client PII in public listing text.
 */

import { bankOpportunityKindDisplayLabel } from "./opportunity-bank-domain.js";
import { safeText } from "./opportunity-intake-domain.js";
import { officeLinkFor } from "./office-domain.js";
import { formatLocalPhoneDisplay } from "./advertiser-phone-domain.js";

export const READY_PRIMARY_ACTION_IDS = Object.freeze([
  "send_and_share",
  "contact_party",
  "manage_opportunity"
]);

export const OFFICE_SHARE_UI_STATUS_LABELS = Object.freeze({
  PENDING: "بانتظار رد المكتب",
  ACCEPTED: "قَبِل المكتب",
  REJECTED: "اعتذر المكتب",
  DETAILS_REQUESTED: "طلب تفاصيل",
  ACTIVE: "بدأ التعاون",
  ENDED: "انتهى التعاون",
  REVOKED: "انتهى التعاون",
  CANCELLED: "انتهى التعاون"
});

const PURPOSE_LABELS = Object.freeze({
  SALE: "بيع",
  PURCHASE: "شراء",
  RENT: "إيجار",
  LEASE_REQUEST: "طلب إيجار"
});

const PARTY_ACTIVITY_LABELS = Object.freeze({
  party_call: "تم فتح اتصال",
  party_whatsapp: "تم فتح واتساب",
  party_request_media: "تم طلب صور أو مستندات",
  party_request_listing_approval: "تم طلب موافقة على الإعلان",
  party_request_price_change: "تم طلب تعديل السعر",
  party_update_property: "تم فتح تحديث بيانات العقار",
  party_schedule_viewing: "تم تحديد موعد معاينة",
  party_record_contact: "تم فتح تسجيل نتيجة التواصل",
  party_confirm_request: "تم تأكيد الطلب والميزانية",
  party_send_suggested: "تم فتح العقارات المقترحة",
  party_property_found: "تم تسجيل العثور على العقار"
});

function isOwnerOffer(record = {}) {
  const kind = String(record.opportunityKind || record.kind || record.recordType || "").toUpperCase();
  return record.contactType === "owner"
    || kind === "OWNER"
    || kind === "OWNER_OFFER"
    || kind === "OFFER";
}

export function officeShareStatusLabel(status = "") {
  const key = String(status || "").toUpperCase();
  return OFFICE_SHARE_UI_STATUS_LABELS[key] || "";
}

export function readyWorkspacePrimaryActions(record = {}) {
  const partyLabel = isOwnerOffer(record) ? "إجراء مع المالك" : "إجراء مع العميل";
  return [
    { id: "send_and_share", label: "إرسال ومشاركة" },
    { id: "contact_party", label: partyLabel },
    { id: "manage_opportunity", label: "إدارة الفرصة" }
  ];
}

export function partyContactActions(record = {}) {
  const owner = isOwnerOffer(record);
  const shared = [
    { id: "party_call", label: owner ? "اتصال بالمالك" : "اتصال بالعميل", type: "call" },
    { id: "party_whatsapp", label: owner ? "واتساب المالك" : "واتساب العميل", type: "whatsapp" },
    { id: "party_schedule_viewing", label: "تحديد موعد معاينة", type: "schedule_viewing" },
    { id: "party_record_contact", label: "تسجيل نتيجة التواصل", type: "record_contact" }
  ];
  if (owner) {
    return [
      ...shared.slice(0, 2),
      { id: "party_request_media", label: "طلب صور أو مستندات", type: "whatsapp_message" },
      { id: "party_request_listing_approval", label: "طلب موافقة على الإعلان", type: "whatsapp_message" },
      { id: "party_request_price_change", label: "طلب تعديل السعر", type: "whatsapp_message" },
      { id: "party_update_property", label: "تحديث بيانات العقار", type: "manage" },
      shared[2],
      shared[3]
    ];
  }
  return [
    ...shared.slice(0, 2),
    { id: "party_confirm_request", label: "تأكيد الطلب والميزانية", type: "whatsapp_message" },
    { id: "party_send_suggested", label: "إرسال عقارات مقترحة", type: "search_matches" },
    shared[2],
    shared[3],
    { id: "party_property_found", label: "تم العثور على العقار", type: "property_found" }
  ];
}

export function partyActionActivityText(actionId = "") {
  return PARTY_ACTIVITY_LABELS[String(actionId || "").trim()] || "";
}

export function validateOfficeShareSend({
  opportunityId = "",
  originatingOfficeId = "",
  targetOfficeId = ""
} = {}) {
  const oppId = String(opportunityId || "").trim();
  const origin = String(originatingOfficeId || "").trim().toLowerCase();
  const target = String(targetOfficeId || "").trim().toLowerCase();
  if (!oppId) return { ok: false, message: "لا يمكن الإرسال — معرف الفرصة غير متوفر" };
  if (!origin) return { ok: false, message: "لا يمكن الإرسال — معرف المكتب غير متوفر" };
  if (!target) return { ok: false, message: "اختر مكتبًا للإرسال" };
  if (origin === target) return { ok: false, message: "لا يمكن الإرسال إلى المكتب نفسه" };
  return { ok: true };
}

function stripEmbeddedPhones(text = "") {
  return String(text || "")
    .replace(/(\+?966|0)?5\d{8}/g, "")
    .replace(/\b\d{10,15}\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function purposeLine(record = {}) {
  const kindLabel = bankOpportunityKindDisplayLabel(record);
  if (kindLabel) return kindLabel;
  const purpose = String(record.purpose || record.transactionType || "").toUpperCase();
  const purposeLabel = PURPOSE_LABELS[purpose] || "";
  const kind = isOwnerOffer(record) ? "عرض" : "طلب";
  if (purposeLabel) return `${kind} ${purposeLabel}`;
  return kind;
}

function pickPublicDescription(record = {}) {
  const candidates = [
    record.publicListingText,
    record.listingText,
    record.details,
    record.sourceText,
    record.intakeSummary
  ];
  for (const value of candidates) {
    const cleaned = stripEmbeddedPhones(safeText(value, 280));
    if (cleaned.length >= 12) return cleaned;
  }
  const property = safeText(record.propertyType, 60);
  const district = safeText(record.district, 60);
  const city = safeText(record.city, 60);
  const parts = [property, district, city].filter(Boolean);
  return parts.length ? `عقار ${parts.join(" — ")}` : "فرصة عقارية متاحة";
}

export function formatOpportunityRefId(record = {}) {
  const id = String(record.id || record.opportunityId || "").trim();
  if (!id) return "";
  return id.length > 24 ? id.slice(0, 24) : id;
}

export function formatOfficeContactPhone(officeProfile = {}) {
  const local = formatLocalPhoneDisplay(officeProfile.phone || officeProfile.mobile || "");
  if (local) return local;
  const raw = safeText(officeProfile.phone || officeProfile.mobile, 20);
  return raw;
}

/**
 * Arabic public listing — office phone only; never owner/client PII.
 */
export function buildPublicListingAnnouncement(record = {}, officeProfile = {}, options = {}) {
  const includeOfficeLink = options.includeOfficeLink !== false;
  const lines = [];
  const headline = purposeLine(record);
  if (headline) lines.push(headline);
  if (record.propertyType) lines.push(`نوع العقار: ${safeText(record.propertyType, 80)}`);
  const purpose = String(record.purpose || "").toUpperCase();
  const purposeLabel = PURPOSE_LABELS[purpose];
  if (purposeLabel && !headline.includes(purposeLabel)) lines.push(`الغرض: ${purposeLabel}`);
  if (record.city) lines.push(`المدينة: ${safeText(record.city, 80)}`);
  if (record.district) lines.push(`الحي: ${safeText(record.district, 80)}`);
  if (record.priceOrBudget != null && record.priceOrBudget !== "") {
    lines.push(`السعر: ${record.priceOrBudget} ريال`);
  }
  if (record.area) lines.push(`المساحة: ${record.area} م²`);
  if (record.rooms) lines.push(`الغرف: ${record.rooms}`);
  lines.push("");
  lines.push(pickPublicDescription(record));
  const ref = formatOpportunityRefId(record);
  if (ref) lines.push("", `رقم الفرصة: ${ref}`);
  const officePhone = formatOfficeContactPhone(officeProfile);
  if (officePhone) lines.push(`للتواصل: ${officePhone}`);
  if (includeOfficeLink) {
    const link = officeProfile.publicSlug || officeProfile.officeId
      ? officeLinkFor({
        origin: typeof options.origin === "string" ? options.origin : "",
        publicSlug: officeProfile.publicSlug || "",
        officeId: officeProfile.officeId || ""
      })
      : "";
    if (link) lines.push("", "رابط المكتب:", link);
  }
  const officeName = safeText(officeProfile.officeName, 120);
  if (officeName) {
    lines.push("", "—", officeName);
  }
  return lines.join("\n");
}

export function listingShareActivityText(channel = "") {
  const key = String(channel || "").trim().toLowerCase();
  if (key === "whatsapp") return "تمت مشاركة إعلان الفرصة عبر واتساب";
  if (key === "copy") return "تم نسخ إعلان الفرصة";
  return "";
}

export function officeShareSentActivityText(officeName = "") {
  const name = safeText(officeName, 120) || "مكتب";
  return `تم إرسال الفرصة إلى مكتب ${name} — بانتظار الرد`;
}

export function partyWhatsAppPresetMessage(actionId = "", record = {}) {
  const property = safeText(record.propertyType, 60) || "العقار";
  const district = safeText(record.district, 60);
  const place = district ? ` في حي ${district}` : "";
  switch (String(actionId || "")) {
    case "party_request_media":
      return `السلام عليكم، نرجو تزويدنا بصور أو مستندات ل${property}${place} لتجهيز الإعلان.`;
    case "party_request_listing_approval":
      return `السلام عليكم، نرجو موافقتكم على نشر إعلان ${property}${place} بعد مراجعته.`;
    case "party_request_price_change":
      return `السلام عليكم، نرجو تحديث السعر المطلوب ل${property}${place} أو إبلاغنا بالسعر المناسب.`;
    case "party_confirm_request":
      const budget = record.priceOrBudget != null && record.priceOrBudget !== ""
        ? `${record.priceOrBudget} ريال`
        : "الميزانية المتفق عليها";
      return `السلام عليكم، نؤكد طلبكم ل${property}${place} والميزانية ${budget}.`;
    default:
      return "";
  }
}

export function sendAndShareHubOptions() {
  return [
    { id: "share_whatsapp_listing", label: "إرسال لشخص أو مجموعة عبر واتساب" },
    { id: "share_to_office", label: "إرسال لمكتب عقاري" },
    { id: "copy_listing_text", label: "نسخ نص الإعلان" }
  ];
}
