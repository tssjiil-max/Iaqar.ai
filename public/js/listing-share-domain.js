/**
 * Manual listing share text — WhatsApp / Telegram / native share.
 * Never includes private client phone unless explicitly allowed.
 */

import { safeText } from "./opportunity-intake-domain.js";
import { advertiserRoleLabel } from "./advertiser-phone-domain.js";
import { bankOpportunityKindDisplayLabel } from "./opportunity-bank-domain.js";
import { officeLinkFor } from "./office-domain.js";

export function buildListingShareMessage(record = {}, officeProfile = {}, { includeContactPhone = false } = {}) {
  const kindLabel = bankOpportunityKindDisplayLabel(record) || safeText(record.opportunityKind, 30);
  const lines = [
    kindLabel || "فرصة عقارية",
    record.propertyType ? `نوع العقار: ${record.propertyType}` : "",
    record.city ? `المدينة: ${record.city}` : "",
    record.district ? `الحي: ${record.district}` : "",
    record.priceOrBudget != null && record.priceOrBudget !== ""
      ? `السعر / الميزانية: ${record.priceOrBudget} ريال`
      : "",
    record.area ? `المساحة: ${record.area} م²` : "",
    record.rooms ? `الغرف: ${record.rooms}` : "",
    record.bathrooms ? `الحمامات: ${record.bathrooms}` : "",
    record.advertiserRole ? `صفة المعلن: ${advertiserRoleLabel(record.advertiserRole)}` : ""
  ].filter(Boolean);

  if (includeContactPhone) {
    const phone = safeText(record.advertiserPhoneNormalized || record.contactPhone, 20);
    if (phone) lines.push(`للتواصل: ${phone}`);
  }

  lines.push("", "—", officeProfile.officeName || "مكتب عقاري");
  if (officeProfile.brokerName) lines.push(`الوسيط: ${officeProfile.brokerName}`);
  if (officeProfile.licenseNumber) lines.push(`رخصة فال: ${officeProfile.licenseNumber}`);
  const link = officeProfile.publicSlug || officeProfile.officeId
    ? officeLinkFor({
      origin: typeof window !== "undefined" ? window.location?.origin : "",
      publicSlug: officeProfile.publicSlug || "",
      officeId: officeProfile.officeId || ""
    })
    : "";
  if (link) lines.push(link);

  return lines.join("\n");
}

export function whatsAppShareUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(String(text || ""))}`;
}

export function telegramShareUrl(text) {
  return `https://t.me/share/url?text=${encodeURIComponent(String(text || ""))}`;
}
