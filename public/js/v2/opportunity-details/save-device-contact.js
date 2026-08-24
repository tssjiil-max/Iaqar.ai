/**
 * User-initiated local device contact save for the opportunity phone field.
 * Does not persist to Firestore, does not read the address book, and does not
 * report success unless a real Contacts-write API or vCard open/download ran.
 */

import {
  formatLocalPhoneDisplay,
  normalizeAdvertiserPhoneE164
} from "../../advertiser-phone-domain.js";

export const CONTACT_SAVE_MESSAGES = Object.freeze({
  saved: "تم حفظ جهة الاتصال",
  opened: "تم فتح حفظ جهة الاتصال",
  openedForSave: "تم فتح جهة الاتصال للحفظ",
  vcardReady: "تم تجهيز جهة الاتصال للإضافة.",
  failed: "تعذر فتح حفظ جهة الاتصال على هذا الجهاز.",
  invalidPhone: "رقم الجوال غير صحيح — استخدم صيغة 05XXXXXXXX"
});

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function vcardEscape(value) {
  return cleanText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function safeVCardFileName(name) {
  const base = cleanText(name).replace(/[\\/:*?"<>|]+/g, " ").trim() || "contact";
  return `${base.slice(0, 60)}.vcf`;
}

export function contactsWriteApiAvailable(contacts) {
  if (!contacts || typeof contacts !== "object") return false;
  return ["save", "create", "add"].some((method) => typeof contacts[method] === "function");
}

export function buildDeviceContactPayload({ phone, advertiserName, officeName } = {}) {
  const e164 = normalizeAdvertiserPhoneE164(phone);
  const local = formatLocalPhoneDisplay(phone);
  if (!e164 || !local) {
    return { ok: false, code: "invalid_phone" };
  }
  const office = cleanText(officeName) || "مكتب عقاري";
  const person = cleanText(advertiserName);
  const name = person ? `${person} - ${office}` : `مالك عقار - ${office}`;
  return { ok: true, e164, local, name, office };
}

export function buildContactVCard({ name, e164, office } = {}) {
  const built = name && e164 ? { name, e164, office } : null;
  if (!built?.name || !built?.e164) return "";
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${vcardEscape(built.name)}`,
    `N:;${vcardEscape(built.name)};;;`,
    built.office ? `ORG:${vcardEscape(built.office)}` : "",
    `TEL;TYPE=CELL:${built.e164}`,
    "END:VCARD"
  ].filter(Boolean).join("\r\n") + "\r\n";
}

async function writeViaContactsApi(payload, contacts) {
  const contact = {
    name: [payload.name],
    tel: [payload.e164]
  };
  if (typeof contacts.save === "function") {
    const result = await contacts.save(contact);
    return { result, confirmed: result === true || result?.id || result?.ok === true };
  }
  if (typeof contacts.create === "function") {
    const result = await contacts.create(contact);
    return { result, confirmed: Boolean(result?.id || result === true) };
  }
  const result = await contacts.add(contact);
  return { result, confirmed: Boolean(result?.id || result === true) };
}

export async function openVCardFile(vcf, name, io = {}) {
  const text = String(vcf || "");
  if (!text.includes("BEGIN:VCARD") || !text.includes("TEL;TYPE=CELL:")) {
    return { ok: false, mode: "none" };
  }
  const fileName = safeVCardFileName(name);
  if (typeof io.openVCard === "function") {
    return io.openVCard(text, fileName);
  }
  if (typeof Blob !== "function" || typeof URL === "undefined" || typeof document === "undefined") {
    return { ok: false, mode: "none" };
  }
  const blob = new Blob([text], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    return { ok: true, mode: "download" };
  } catch {
    return { ok: false, mode: "none" };
  } finally {
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }, 2000);
  }
}

export async function saveDeviceContact(input = {}, io = {}) {
  const payload = buildDeviceContactPayload(input);
  if (!payload.ok) {
    return {
      ok: false,
      method: "none",
      confirmed: false,
      message: CONTACT_SAVE_MESSAGES.invalidPhone,
      code: "invalid_phone"
    };
  }

  const contacts = io.contacts;
  if (contactsWriteApiAvailable(contacts)) {
    try {
      const written = await writeViaContactsApi(payload, contacts);
      if (written.confirmed) {
        return {
          ok: true,
          method: "contacts-api",
          confirmed: true,
          message: CONTACT_SAVE_MESSAGES.saved,
          payload
        };
      }
      return {
        ok: true,
        method: "contacts-api",
        confirmed: false,
        message: CONTACT_SAVE_MESSAGES.opened,
        payload
      };
    } catch (error) {
      if (error?.name === "AbortError") {
        return {
          ok: false,
          method: "contacts-api",
          confirmed: false,
          message: CONTACT_SAVE_MESSAGES.failed,
          code: "aborted"
        };
      }
    }
  }

  const vcf = buildContactVCard(payload);
  const opened = await openVCardFile(vcf, payload.name, io);
  if (!opened?.ok) {
    return {
      ok: false,
      method: "vcard",
      confirmed: false,
      message: CONTACT_SAVE_MESSAGES.failed,
      code: "vcard_failed"
    };
  }
  return {
    ok: true,
    method: "vcard",
    confirmed: false,
    message: opened.mode === "download" || opened.mode === "open"
      ? (opened.mode === "download" ? CONTACT_SAVE_MESSAGES.vcardReady : CONTACT_SAVE_MESSAGES.openedForSave)
      : CONTACT_SAVE_MESSAGES.vcardReady,
    payload
  };
}
