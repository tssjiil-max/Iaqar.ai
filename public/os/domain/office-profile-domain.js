/**
 * Office settings (بيانات المكتب · رابط المكتب · التعاون) — pure rules shared with the old
 * app through public/js/office-domain.js, so both apps validate the same way and write the
 * same fields. No DOM, no network: the view and the save layer call into this.
 */

import {
  OFFICE_NAME_MESSAGES, normalizeOfficeName, normalizeOfficeNameKey, normalizePublicSlug, safeText, validateOfficeName
} from "../../js/office-domain.js";
import { validateAssignablePublicSlug } from "../../js/office-public-link-domain.js";

export const SPECIALTIES = Object.freeze([
  { value: "sale", label: "بيع" },
  { value: "purchase", label: "شراء" },
  { value: "rent", label: "تأجير" },
  { value: "property_management", label: "إدارة أملاك" }
]);

const SPECIALTY_VALUES = SPECIALTIES.map((s) => s.value);

/** Same normalisation the old settings screen applies before saving. */
export function cleanPhone(value) {
  return safeText(value).replace(/[^0-9+]/g, "").slice(0, 20);
}

function validPhone(phone) {
  return !phone || /^(?:\+?966|0)?5\d{8}$/.test(phone);
}

/**
 * Validate the profile form. Returns { ok, errors: {field: message}, data }.
 * `data` holds only the fields this screen owns, so a merge write never touches the rest
 * (service neighbourhoods, logo, slug, cooperation…).
 */
export function buildOfficeProfile(input = {}, { isPlatformAdmin = false } = {}) {
  const errors = {};
  const officeName = normalizeOfficeName(input.officeName);
  const nameError = validateOfficeName(officeName, { isPlatformAdmin });
  if (nameError) errors.officeName = nameError;
  const brokerName = normalizeOfficeName(input.brokerName);
  if (!brokerName) errors.brokerName = "اكتب اسم الوسيط";
  const licenseNumber = safeText(input.licenseNumber).replace(/[^0-9]/g, "").slice(0, 20);
  if (!licenseNumber) errors.licenseNumber = "اكتب رقم رخصة فال";
  const city = safeText(input.city).slice(0, 60);
  if (!city) errors.city = "اكتب المدينة";
  const phone = cleanPhone(input.phone);
  if (!validPhone(phone)) errors.phone = "اكتب رقم جوال سعودي صحيحًا يبدأ بـ 05";
  const specialties = [...new Set((Array.isArray(input.specialties) ? input.specialties : []).map(String))].filter((v) => SPECIALTY_VALUES.includes(v));
  const data = {
    officeName, officeNameKey: normalizeOfficeNameKey(officeName), brokerName, licenseNumber, city, phone, whatsapp: phone, specialties
  };
  return { ok: Object.keys(errors).length === 0, errors, data };
}

/** The slice of the profile mirrored to publicOffices (the public office page). */
export function publicProfileMirror(data) {
  const { officeName, brokerName, phone, whatsapp, licenseNumber, city, specialties } = data;
  return { officeName, brokerName, phone, whatsapp, licenseNumber, city, specialties };
}

export { OFFICE_NAME_MESSAGES };

/** Slug rules are the ones the Worker enforces (/office/public-slug). */
export function checkPublicSlug(value) {
  return validateAssignablePublicSlug(normalizePublicSlug(value));
}
