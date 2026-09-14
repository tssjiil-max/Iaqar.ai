/**
 * Manual listing share text — WhatsApp / Telegram / native share.
 * Never includes private client phone unless explicitly allowed.
 */

import { safeText } from "./opportunity-intake-domain.js";
import { bankOpportunityKindDisplayLabel } from "./opportunity-bank-domain.js";
import { officeLinkFor } from "./office-domain.js";

const PURPOSE_LABELS = Object.freeze({
  SALE: "للبيع", SELL: "للبيع", PURCHASE: "للشراء", BUY: "للشراء",
  RENT: "للإيجار", LEASE: "للإيجار", RENT_REQUEST: "للاستئجار", LEASE_REQUEST: "للاستئجار"
});

function isRequest(record = {}) {
  const kind = String(record.opportunityKind || record.kind || record.recordType || "").toUpperCase();
  return record.contactType === "client" || kind.includes("REQUEST") || kind === "CLIENT";
}

export function listingOfficeLink(officeProfile = {}, origin = "") {
  if (!officeProfile.publicSlug && !officeProfile.officeId) return "";
  return officeLinkFor({
    origin: origin || officeProfile.origin || (typeof window !== "undefined" ? window.location?.origin : ""),
    publicSlug: officeProfile.publicSlug || "",
    officeId: officeProfile.officeId || ""
  });
}

export function buildListingShareMessage(record = {}, officeProfile = {}, { includeContactPhone = false } = {}) {
  const kindLabel = bankOpportunityKindDisplayLabel(record) || safeText(record.opportunityKind, 30);
  const propertyType = safeText(record.propertyType, 60);
  const purposeKey = String(record.purpose || "").toUpperCase();
  const purposeLabel = isRequest(record) && ["RENT", "LEASE"].includes(purposeKey)
    ? "للاستئجار"
    : (PURPOSE_LABELS[purposeKey] || (isRequest(record) ? "مطلوب" : "متاح"));
  const price = record.priceOrBudget ?? record.salePrice ?? record.budget ?? record.annualRent;
  const rawReference = safeText(record.referenceCode || record.referenceId || record.id || record.opportunityId, 80);
  const reference = rawReference.length > 14 ? rawReference.slice(-8) : rawReference;
  const lines = [
    [propertyType || kindLabel || "فرصة عقارية", purposeLabel].filter(Boolean).join(" "),
    record.district ? `الحي: ${safeText(record.district, 80)}` : "",
    price != null && price !== ""
      ? `${isRequest(record) ? "الميزانية" : "السعر"}: ${price} ريال`
      : "",
    record.area ? `المساحة: ${record.area} م²` : "",
    reference ? `المرجع: ${reference}` : ""
  ].filter(Boolean);

  if (includeContactPhone) {
    const phone = safeText(record.advertiserPhoneNormalized || record.contactPhone, 20);
    if (phone) lines.push(`للتواصل: ${phone}`);
  }

  lines.push("", "عبر مكتب:", safeText(officeProfile.officeName, 120) || "مكتب عقاري");
  const link = listingOfficeLink(officeProfile);
  if (link) lines.push("", "رابط المكتب:", link);
  const registrationLink = safeText(officeProfile.registrationLink, 300);
  if (/^https:\/\//i.test(registrationLink)) {
    lines.push("", "للتعاون والتسجيل مع المكتب:", registrationLink);
  }

  return lines.join("\n");
}

export function whatsAppShareUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(String(text || ""))}`;
}

export function telegramShareUrl(text) {
  return `https://t.me/share/url?text=${encodeURIComponent(String(text || ""))}`;
}
