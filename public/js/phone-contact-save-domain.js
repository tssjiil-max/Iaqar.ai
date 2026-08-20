/**
 * Save an opportunity phone number into the device contact book as a vCard.
 * Domain only — no person names (client / owner / broker).
 */

import {
  formatLocalPhoneDisplay,
  normalizeAdvertiserPhoneE164
} from "./advertiser-phone-domain.js";

export const SAVE_PHONE_CONTACT_LABEL = "حفظ الرقم في سجل الهاتف";

function escapeVcard(value = "") {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function validatePhoneContactSave(phoneRaw = "") {
  const phoneE164 = normalizeAdvertiserPhoneE164(phoneRaw);
  if (!phoneE164) {
    return { ok: false, error: "لا يوجد رقم جوال مكتمل للحفظ" };
  }
  const phoneLocal = formatLocalPhoneDisplay(phoneE164) || phoneE164;
  return { ok: true, phoneE164, phoneLocal };
}

export function buildPhoneContactVcard(phoneRaw = "") {
  const check = validatePhoneContactSave(phoneRaw);
  if (!check.ok) return "";
  const fn = escapeVcard(check.phoneLocal);
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN;CHARSET=UTF-8:${fn}`,
    `TEL;TYPE=CELL,VOICE:${check.phoneE164}`,
    `TEL;TYPE=CELL:${check.phoneLocal}`,
    "END:VCARD"
  ].join("\r\n");
}

export function phoneContactVcardFilename(phoneRaw = "") {
  const check = validatePhoneContactSave(phoneRaw);
  const phonePart = String(check.phoneLocal || "").replace(/\D/g, "").slice(-10);
  return `IAQAR-${phonePart || "رقم"}.vcf`;
}
