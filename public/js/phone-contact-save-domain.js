/**
 * Save an opportunity phone number into the device contact book as a vCard.
 * Contact display name is built from opportunity data: name + role + district
 * (e.g. «أبو أحمد عميل في الوبرة» or «مالك عمارة في عروة»).
 */

import {
  formatLocalPhoneDisplay,
  normalizeAdvertiserPhoneE164,
  safeAdvertiserDisplayName
} from "./advertiser-phone-domain.js";

export const SAVE_PHONE_CONTACT_LABEL = "حفظ الرقم في سجل الهاتف";

function escapeVcard(value = "") {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function cleanPart(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanDistrict(value = "") {
  let district = cleanPart(value);
  if (district.startsWith("حي ")) district = district.slice(3).trim();
  return district;
}

function cleanRole(value = "") {
  const role = cleanPart(value);
  if (!role || role === "غير محدد" || role === "—") return "";
  return role;
}

function cleanPropertyType(value = "") {
  const type = cleanPart(value);
  if (!type || type === "تحتاج مراجعة" || type === "غير محدد" || type === "—") return "";
  // Prefer bare property type («عمارة»، «شقة») over full purpose line («شقة للإيجار»).
  const purposeTail = type.match(/^(.*?)\s+(للبيع|للإيجار|للشراء|للتأجير)$/);
  if (purposeTail) return cleanPart(purposeTail[1]);
  return type;
}

/**
 * Build the phone-book display name from opportunity fields.
 * With a person name: «أبو أحمد عميل في الوبرة»
 * Without a person name: «مالك عمارة في عروة»
 */
export function buildPhoneContactDisplayName({
  displayName = "",
  roleLabel = "",
  propertyType = "",
  district = ""
} = {}) {
  const name = safeAdvertiserDisplayName(displayName);
  const role = cleanRole(roleLabel);
  const property = cleanPropertyType(propertyType);
  const place = cleanDistrict(district);

  if (name) {
    const parts = [name];
    if (role) parts.push(role);
    if (place) parts.push(`في ${place}`);
    return parts.join(" ");
  }

  const parts = [];
  if (role) parts.push(role);
  if (property) parts.push(property);
  if (place) parts.push(`في ${place}`);
  if (parts.length) return parts.join(" ");
  return "";
}

export function validatePhoneContactSave(input = {}) {
  const phoneRaw = typeof input === "string" ? input : (input.phoneRaw || input.phoneE164 || "");
  const phoneE164 = normalizeAdvertiserPhoneE164(phoneRaw);
  if (!phoneE164) {
    return { ok: false, error: "لا يوجد رقم جوال مكتمل للحفظ" };
  }
  const phoneLocal = formatLocalPhoneDisplay(phoneE164) || phoneE164;
  const payload = typeof input === "string" ? { phoneRaw: input } : (input || {});
  const displayName = buildPhoneContactDisplayName(payload) || phoneLocal;
  return { ok: true, phoneE164, phoneLocal, displayName };
}

export function buildPhoneContactVcard(input = {}) {
  const check = validatePhoneContactSave(input);
  if (!check.ok) return "";
  const fn = escapeVcard(check.displayName);
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN;CHARSET=UTF-8:${fn}`,
    `N;CHARSET=UTF-8:;${fn};;;`,
    `TEL;TYPE=CELL,VOICE:${check.phoneE164}`,
    `TEL;TYPE=CELL:${check.phoneLocal}`,
    "END:VCARD"
  ].join("\r\n");
}

export function phoneContactVcardFilename(input = {}) {
  const check = validatePhoneContactSave(input);
  const namePart = String(check.displayName || "جهة")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 40) || "جهة";
  const phonePart = String(check.phoneLocal || "").replace(/\D/g, "").slice(-10);
  return `IAQAR-${namePart}${phonePart ? `-${phonePart}` : ""}.vcf`;
}
