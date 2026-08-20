/**
 * Build a phone-book vCard from advertiser name + number.
 * Domain only — no DOM.
 */

import {
  formatLocalPhoneDisplay,
  normalizeAdvertiserPhoneE164,
  safeAdvertiserDisplayName
} from "./advertiser-phone-domain.js";

export const SAVE_PHONE_CONTACT_LABEL = "حفظ الرقم في الجوال";

export function advertiserContactNameLabel(role = "") {
  const id = String(role || "").trim().toUpperCase();
  if (id === "OWNER") return "اسم المالك";
  if (id === "CLIENT") return "اسم العميل";
  if (id === "BROKER") return "اسم الوسيط";
  if (id === "DELEGATE") return "اسم المفوض";
  return "اسم المالك أو العميل أو الوسيط";
}

function escapeVcard(value = "") {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\n|\r/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function resolveContactSaveDisplayName({
  displayName = "",
  roleLabel = "",
  phoneLocal = ""
} = {}) {
  const name = safeAdvertiserDisplayName(displayName);
  if (name) return name;
  const role = String(roleLabel || "").trim();
  if (role) return role;
  const phone = String(phoneLocal || "").trim();
  return phone;
}

export function validateContactSavePayload(input = {}) {
  const phoneE164 = normalizeAdvertiserPhoneE164(
    input.phoneRaw || input.phoneE164 || input.phoneLocal || ""
  );
  if (!phoneE164) {
    return { ok: false, error: "أدخل رقم جوال صحيح بصيغة 05XXXXXXXX" };
  }
  const phoneLocal = formatLocalPhoneDisplay(phoneE164);
  const displayName = resolveContactSaveDisplayName({
    displayName: input.displayName,
    roleLabel: input.roleLabel,
    phoneLocal
  });
  if (!displayName) {
    return { ok: false, error: "أدخل اسم المالك أو العميل أو الوسيط" };
  }
  return { ok: true, displayName, phoneE164, phoneLocal };
}

/**
 * One vCard 3.0 record: FN = name, TEL = number.
 * @param {{ displayName?: string, phoneE164?: string, phoneLocal?: string }} payload
 */
export function buildContactVcard(payload = {}) {
  const check = payload.ok === true ? payload : validateContactSavePayload(payload);
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

export function contactSaveFilename(payload = {}) {
  const check = payload.ok === true ? payload : validateContactSavePayload(payload);
  const namePart = String(check.displayName || "جهة")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 40) || "جهة";
  const phonePart = String(check.phoneLocal || "").replace(/\D/g, "").slice(-10);
  return `IAQAR-${namePart}${phonePart ? `-${phonePart}` : ""}.vcf`;
}

export function buildContactSavePatch(payload = {}) {
  const check = payload.ok === true && payload.phoneE164
    ? payload
    : validateContactSavePayload(payload);
  if (!check.ok) return {};
  const typedName = safeAdvertiserDisplayName(payload.displayName);
  const patch = {
    advertiserPhoneNormalized: check.phoneE164,
    advertiserPhoneRaw: check.phoneLocal
  };
  if (typedName) {
    patch.advertiserDisplayName = typedName;
    patch.contactName = typedName;
  }
  return patch;
}
