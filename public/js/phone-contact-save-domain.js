/**
 * Save an opportunity phone number into the device contact book as a vCard.
 * Reuses existing phone formatters. Does not mutate stored Firestore values.
 */

import {
  formatLocalPhoneDisplay,
  normalizeAdvertiserPhoneE164,
  safeAdvertiserDisplayName
} from "./advertiser-phone-domain.js";

export const SAVE_PHONE_CONTACT_LABEL = "حفظ في سجل الهاتف";
export const SAVE_PHONE_CONTACT_PREPARING = "جاري تجهيز جهة الاتصال...";
export const SAVE_PHONE_CONTACT_OPENED = "تم فتح حفظ جهة الاتصال";

const NOTE_MAX = 160;

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
  const purposeTail = type.match(/^(.*?)\s+(للبيع|للإيجار|للشراء|للتأجير)$/);
  if (purposeTail) return cleanPart(purposeTail[1]);
  return type;
}

function isOwnerPerson({ isOwner = false, personKind = "" } = {}) {
  const kind = String(personKind || "").trim().toLowerCase();
  if (kind === "owner" || kind === "مالك") return true;
  if (kind === "client" || kind === "عميل") return false;
  return Boolean(isOwner);
}

/** مالك / عميل from opportunity person, not invented personal names. */
export function resolveContactPersonRole({
  isOwner = false,
  personKind = "",
  roleLabel = ""
} = {}) {
  const role = cleanRole(roleLabel);
  if (role === "مالك" || role === "عميل") return role;
  return isOwnerPerson({ isOwner, personKind }) ? "مالك" : "عميل";
}

function namelessFallback(role) {
  return role === "عميل" ? "عميل عقاري" : "مالك عقار";
}

function looksLikeComposedContactName(name = "", role = "") {
  const value = String(name || "").trim();
  if (!value) return false;
  if (value === "مالك عقار" || value === "عميل عقاري") return true;
  if (value.startsWith("مالك عقار —") || value.startsWith("عميل عقاري —")) return true;
  if (role && value.endsWith(` — ${role}`)) return true;
  return false;
}

/**
 * Phone-book FN:
 * With name: «محمد أحمد — مالك»
 * Without name: «مالك عقار — الحرة الغربية»
 */
export function buildPhoneContactDisplayName({
  displayName = "",
  roleLabel = "",
  isOwner = false,
  personKind = "",
  district = ""
} = {}) {
  const name = safeAdvertiserDisplayName(displayName);
  const role = resolveContactPersonRole({ isOwner, personKind, roleLabel });
  const place = cleanDistrict(district);
  if (name && !looksLikeComposedContactName(name, role)) return `${name} — ${role}`;
  if (looksLikeComposedContactName(name, role)) return name;
  const fallback = namelessFallback(role);
  if (place) return `${fallback} — ${place}`;
  return fallback;
}

function purposeWord(purpose = "") {
  const value = String(purpose || "").trim().toUpperCase();
  if (value === "RENT" || value === "LEASE_REQUEST") return "للإيجار";
  if (value === "SALE" || value === "PURCHASE") return "للبيع";
  if (value === "INVESTMENT") return "للاستثمار";
  return "";
}

function opportunityPhrase({ isOwner = false, personKind = "", propertyType = "", purpose = "" } = {}) {
  const owner = isOwnerPerson({ isOwner, personKind });
  const property = cleanPropertyType(propertyType);
  const purposeKey = String(purpose || "").trim().toUpperCase();
  const word = purposeWord(purpose);
  if (owner) {
    if (property && word) return `عرض ${property} ${word}`;
    if (property) return `عرض ${property}`;
    return "";
  }
  if (property && (purposeKey === "PURCHASE" || purposeKey === "SALE")) {
    return `طلب شراء ${property}`;
  }
  if (property && (purposeKey === "RENT" || purposeKey === "LEASE_REQUEST")) {
    return `طلب إيجار ${property}`;
  }
  if (property && word) return `طلب ${property} ${word}`;
  if (property) return `طلب ${property}`;
  return "";
}

function placeNote(district = "", city = "") {
  const place = cleanDistrict(district);
  if (place) return `حي ${place}`;
  return cleanPart(city);
}

/**
 * Short vCard NOTE from already-visible opportunity facts only.
 * Example: «مالك عقار — عرض عمارة للبيع — حي الحرة الغربية»
 */
export function buildPhoneContactNote({
  isOwner = false,
  personKind = "",
  roleLabel = "",
  propertyType = "",
  purpose = "",
  district = "",
  city = ""
} = {}) {
  const role = resolveContactPersonRole({ isOwner, personKind, roleLabel });
  const headline = role === "عميل" ? "عميل" : "مالك عقار";
  const parts = [
    headline,
    opportunityPhrase({ isOwner, personKind, propertyType, purpose }),
    placeNote(district, city)
  ].filter(Boolean);
  return parts.join(" — ").slice(0, NOTE_MAX);
}

export function validatePhoneContactSave(input = {}) {
  const phoneRaw = typeof input === "string" ? input : (input.phoneRaw || input.phoneE164 || "");
  const phoneE164 = normalizeAdvertiserPhoneE164(phoneRaw);
  if (!phoneE164) {
    return { ok: false, error: "لا يوجد رقم جوال مكتمل للحفظ" };
  }
  const phoneLocal = formatLocalPhoneDisplay(phoneE164) || phoneE164;
  const payload = typeof input === "string" ? { phoneRaw: input } : (input || {});
  const displayName = buildPhoneContactDisplayName(payload) || namelessFallback(
    resolveContactPersonRole(payload)
  );
  const note = buildPhoneContactNote(payload);
  return { ok: true, phoneE164, phoneLocal, displayName, note };
}

export function buildPhoneContactVcard(input = {}) {
  const check = validatePhoneContactSave(input);
  if (!check.ok) return "";
  const fn = escapeVcard(check.displayName);
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN;CHARSET=UTF-8:${fn}`,
    `N;CHARSET=UTF-8:;${fn};;;`,
    `TEL;TYPE=CELL,VOICE:${check.phoneE164}`
  ];
  if (check.note) lines.push(`NOTE;CHARSET=UTF-8:${escapeVcard(check.note)}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
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
