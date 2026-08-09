/**
 * Advertiser phone extraction and normalization — separate from property-type extraction.
 */

import { normalizeDigits, safeText } from "./opportunity-intake-domain.js";

const MOBILE_CANDIDATE_RE = /(?:\+?966|00966|0)?5\d{8}/g;
const PHONE_CONTEXT_RE = /(?:جوال|اتصال|تواصل|واتساب|واتس|المعلن|المالك|للتواصل|اتصل|تواصل مع|رقم\s*جوال|رقم\s*الجوال|رقم\s*التواصل)/i;
const LICENSE_CONTEXT_RE = /(?:رخصة\s*فال|رقم\s*الرخصة|فال\s*رقم|ترخيص\s*فال)/i;
const PRICE_CONTEXT_RE = /(?:السعر|سعر|مبلغ|ريال\s*سنوي|إيجار\s*سنوي)/i;

export const ADVERTISER_ROLES = Object.freeze([
  { id: "OWNER", label: "مالك" },
  { id: "DELEGATE", label: "مفوض" },
  { id: "BROKER", label: "وسيط عقاري" },
  { id: "UNKNOWN", label: "غير محدد" }
]);

export const ADVERTISER_CONTACT_STATUSES = Object.freeze([
  { id: "NOT_CONTACTED", label: "لم يتم التواصل" },
  { id: "OPENED_WHATSAPP", label: "تم فتح واتساب" },
  { id: "NO_RESPONSE", label: "لم يرد" },
  { id: "CALL_LATER", label: "طلب التواصل لاحقًا" },
  { id: "RESPONDED", label: "تم الرد" },
  { id: "INVALID_NUMBER", label: "الرقم غير صحيح" },
  { id: "REFUSED", label: "رفض التواصل" }
]);

export const MARKETING_CONSENT_STATUSES = Object.freeze([
  { id: "NOT_STARTED", label: "لم تبدأ" },
  { id: "AWAITING_RESPONSE", label: "بانتظار الرد" },
  { id: "PRELIMINARY_YES", label: "وافق مبدئيًا على استكمال الإجراءات" },
  { id: "REFUSED", label: "رفض" },
  { id: "NEEDS_FOLLOWUP", label: "يحتاج متابعة" }
]);

export function normalizeAdvertiserPhoneE164(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^009665\d{8}$/.test(digits)) return `+${digits.slice(2)}`;
  if (/^9665\d{8}$/.test(digits)) return `+${digits}`;
  if (/^05\d{8}$/.test(digits)) return `+966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `+966${digits}`;
  return "";
}

export function whatsappDigitsFromE164(e164) {
  const digits = String(e164 || "").replace(/\D/g, "");
  if (/^9665\d{8}$/.test(digits)) return digits;
  return "";
}

export function e164ToLocalInput(e164) {
  const normalized = normalizeAdvertiserPhoneE164(e164);
  if (!normalized) return "";
  return normalized.replace(/^\+966/, "");
}

export function safeAdvertiserDisplayName(value) {
  const text = safeText(value, 120).replace(/[<>`]/g, "");
  return text.trim();
}

export function readAdvertiserDisplayName(record = {}) {
  return safeAdvertiserDisplayName(record.advertiserDisplayName || "");
}

export function validateAdvertiserPhoneLocalInput(localDigits) {
  const local = String(localDigits || "").replace(/\D/g, "");
  if (!local) return { ok: true, e164: "", error: "" };
  const e164 = normalizeAdvertiserPhoneE164(local.length === 9 ? local : `0${local}`);
  if (!e164) {
    return { ok: false, e164: "", error: "رقم الجوال غير صحيح — استخدم صيغة 05XXXXXXXX" };
  }
  return { ok: true, e164, error: "" };
}

let advertiserMessageModalContext = null;

export function setAdvertiserMessageModalContext(context) {
  advertiserMessageModalContext = context && typeof context === "object" ? { ...context } : null;
}

export function getAdvertiserMessageModalContext() {
  return advertiserMessageModalContext;
}

export function clearAdvertiserMessageModalContext() {
  advertiserMessageModalContext = null;
}

function contextWindow(text, start, end, radius = 42) {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  return text.slice(from, to);
}

function isLicenseOrPriceContext(windowText) {
  const hasLicense = LICENSE_CONTEXT_RE.test(windowText);
  const hasPrice = PRICE_CONTEXT_RE.test(windowText);
  const hasPhoneCue = PHONE_CONTEXT_RE.test(windowText);
  if (hasLicense && !hasPhoneCue) return true;
  if (hasPrice && !hasPhoneCue && !/5\d{8}/.test(windowText.replace(/\d{6,}/g, ""))) {
    // Price line with large numbers but no mobile cue.
    const nums = windowText.match(/\d{4,}/g) || [];
    if (nums.some((n) => !/^5\d{8}$/.test(n) && !/^05\d{8}$/.test(n))) return true;
  }
  return false;
}

/**
 * Extract advertiser phone candidates from free text.
 * Returns array (no auto-pick when multiple).
 */
export function extractAdvertiserPhonesFromText(text) {
  const raw = safeText(text);
  if (!raw) return [];
  const normalized = normalizeDigits(raw);
  const compact = normalized.replace(/[\s()-]/g, "");
  const results = [];
  const seen = new Set();

  for (const match of compact.matchAll(MOBILE_CANDIDATE_RE)) {
    const rawMatch = match[0];
    const index = match.index ?? 0;
    const windowText = contextWindow(compact, index, index + rawMatch.length);
    if (isLicenseOrPriceContext(windowText)) continue;

    const hasCue = PHONE_CONTEXT_RE.test(windowText) || /واتساب|whatsapp/i.test(windowText);
    if (!hasCue && compact.length > rawMatch.length + 20) {
      // Long text without cue — still allow if preceded by typical separators near match in original
      const rawWindow = contextWindow(normalized, index, index + rawMatch.length, 30);
      if (!PHONE_CONTEXT_RE.test(rawWindow) && !/واتساب|whatsapp/i.test(rawWindow)) continue;
    }

    const e164 = normalizeAdvertiserPhoneE164(rawMatch);
    if (!e164 || seen.has(e164)) continue;
    seen.add(e164);
    results.push({
      advertiserPhoneRaw: rawMatch,
      advertiserPhoneNormalized: e164,
      advertiserPhoneSource: "text_extraction",
      advertiserPhoneEvidence: contextWindow(normalized, index, index + rawMatch.length, 24).trim()
    });
  }
  return results;
}

export function pickPrimaryAdvertiserPhone(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  return null;
}

export function advertiserRoleLabel(id) {
  return ADVERTISER_ROLES.find((r) => r.id === id)?.label || "غير محدد";
}

export function advertiserContactStatusLabel(id) {
  return ADVERTISER_CONTACT_STATUSES.find((r) => r.id === id)?.label || id || "—";
}

export function marketingConsentStatusLabel(id) {
  return MARKETING_CONSENT_STATUSES.find((r) => r.id === id)?.label || id || "—";
}

export function buildAdvertiserWhatsAppMessage({
  brokerName = "",
  officeName = "",
  licenseNumber = "",
  propertyType = "",
  district = "",
  city = "",
  officeLink = "",
  advertiserDisplayName = ""
} = {}) {
  const displayName = safeAdvertiserDisplayName(advertiserDisplayName);
  let greeting = "السلام عليكم";
  if (displayName) {
    if (/^أبو\s*/u.test(displayName)) greeting = `السلام عليكم ${displayName}`;
    else greeting = `السلام عليكم أستاذ/أبو ${displayName}`;
  }

  const broker = safeText(brokerName) || safeText(officeName) || "الوسيط";
  const office = safeText(officeName) || "المكتب";
  const license = safeText(licenseNumber);
  let introLine = `معكم ${broker} من ${office}`;
  if (license) introLine += `، وسيط عقاري مرخص برقم فال ${license}.`;
  else introLine += "، وسيط عقاري.";

  const property = safeText(propertyType) || "العقار";
  const districtText = safeText(district);
  const cityText = safeText(city);
  let propertyPhrase = `اطلعت على إعلانكم بخصوص ${property}`;
  if (districtText && cityText) propertyPhrase += ` في ${districtText} — ${cityText}`;
  else if (districtText) propertyPhrase += ` في حي ${districtText}`;
  else if (cityText) propertyPhrase += ` في ${cityText}`;
  propertyPhrase +=
    "، وأرغب في التعاون معكم لتسويق العقار وعرضه على شبكة من الوسطاء والعملاء المهتمين، بعد موافقتكم واستكمال الإجراءات اللازمة.";

  const link = safeText(officeLink, 500);
  const lines = [
    `${greeting}،`,
    "",
    introLine,
    "",
    propertyPhrase,
    "",
    "يسعدني تزويدكم بمزيد من التفاصيل والتعريف بخدمات المكتب."
  ];
  if (link) {
    lines.push("", "رابط بطاقة المكتب للتحقق:", link);
  }
  lines.push("", "شاكرين لكم.");
  return lines.join("\n");
}

export function buildAdvertiserCompletionMessage({
  brokerName = "",
  officeName = "",
  licenseNumber = "",
  propertyType = "",
  district = "",
  city = ""
} = {}) {
  const broker = safeText(brokerName) || safeText(officeName) || "الوسيط";
  const office = safeText(officeName) || "المكتب";
  const licenseLine = safeText(licenseNumber)
    ? `معك ${broker} من ${office}، المرخص برقم فال ${licenseNumber}.`
    : `معك ${broker} من ${office}.`;

  const property = safeText(propertyType) || "عقار";
  let locationPhrase = "";
  const districtText = safeText(district);
  const cityText = safeText(city);
  if (districtText && cityText) locationPhrase = ` في ${districtText} — ${cityText}`;
  else if (districtText) locationPhrase = ` في حي ${districtText}`;
  else if (cityText) locationPhrase = ` في ${cityText}`;

  return [
    "السلام عليكم،",
    licenseLine,
    "",
    `وصلتنا معلومات ${property}${locationPhrase}، ونرغب في التأكد من صفتكم واستكمال بيانات العقار.`,
    "",
    "هل أنتم المالك أو المفوض أو وسيطًا عقاريًا؟",
    "",
    "وفي حال رغبتكم بالتعاون، نوضح لكم خطوات استكمال إجراءات الوساطة والتسويق قبل البدء.",
    "",
    "شاكرين لكم."
  ].join("\n");
}

export function mergeAdvertiserFieldsIntoOpportunity(base = {}, advertiser = {}) {
  const phone = normalizeAdvertiserPhoneE164(advertiser.advertiserPhoneNormalized || advertiser.phone);
  const raw = safeText(advertiser.advertiserPhoneRaw || advertiser.phoneRaw, 40);
  const displayName = safeAdvertiserDisplayName(advertiser.advertiserDisplayName);
  return {
    ...base,
    advertiserDisplayName: displayName,
    advertiserPhoneRaw: phone ? raw : "",
    advertiserPhoneNormalized: phone,
    advertiserPhoneSource: safeText(advertiser.advertiserPhoneSource, 40),
    advertiserPhoneEvidence: safeText(advertiser.advertiserPhoneEvidence, 200),
    advertiserRole: safeText(advertiser.advertiserRole || "UNKNOWN", 20),
    advertiserContactStatus: safeText(advertiser.advertiserContactStatus || "NOT_CONTACTED", 30),
    marketingConsentStatus: safeText(advertiser.marketingConsentStatus || "NOT_STARTED", 30),
    lastContactAt: advertiser.lastContactAt || null,
    contactNotes: safeText(advertiser.contactNotes, 500)
  };
}

export function buildAdvertiserDataPatch(existing = {}, input = {}) {
  const displayName = safeAdvertiserDisplayName(input.advertiserDisplayName);
  const phoneCheck = validateAdvertiserPhoneLocalInput(input.advertiserPhoneLocal);
  if (!phoneCheck.ok) return { ok: false, error: phoneCheck.error };

  const hadPhone = Boolean(readAdvertiserPhoneFromRecord(existing).phone);
  const patch = {
    advertiserDisplayName: displayName,
    advertiserRole: safeText(input.advertiserRole || existing.advertiserRole || "UNKNOWN", 20)
  };

  if (phoneCheck.e164) {
    const local = String(input.advertiserPhoneLocal || "").replace(/\D/g, "");
    patch.advertiserPhoneNormalized = phoneCheck.e164;
    patch.advertiserPhoneRaw = safeText(input.advertiserPhoneRaw || `0${local}`, 40);
    if (!hadPhone && !existing.advertiserPhoneSource) {
      patch.advertiserPhoneSource = "manual_entry";
    }
  } else {
    patch.advertiserPhoneNormalized = "";
    patch.advertiserPhoneRaw = "";
  }

  return { ok: true, patch };
}

/** Unified read adapter for legacy and current advertiser phone fields. */
export function readAdvertiserPhoneFromRecord(record = {}) {
  const candidates = [
    record.advertiserPhoneNormalized,
    record.advertiserPhone,
    record.ownerPhone,
    record.contactPhone,
    record.phone
  ];
  for (const value of candidates) {
    const normalized = normalizeAdvertiserPhoneE164(value);
    if (normalized) {
      return {
        phone: normalized,
        raw: safeText(record.advertiserPhoneRaw || value, 40),
        source: safeText(record.advertiserPhoneSource, 80),
        role: safeText(record.advertiserRole, 20),
        contactStatus: safeText(record.advertiserContactStatus, 30)
      };
    }
  }
  return {
    phone: "",
    raw: "",
    source: safeText(record.advertiserPhoneSource, 80),
    role: safeText(record.advertiserRole, 20),
    contactStatus: safeText(record.advertiserContactStatus, 30)
  };
}

export function buildAdvertiserContactSection(record = {}) {
  const info = readAdvertiserPhoneFromRecord(record);
  const displayName = readAdvertiserDisplayName(record);
  const rows = [];
  rows.push({
    label: "اسم أو وصف المعلن",
    value: displayName || "إضافة اسم أو وصف"
  });
  rows.push({
    label: "رقم الجوال",
    value: info.phone || "لا يوجد رقم معلن محفوظ"
  });
  rows.push({ label: "صفة المعلن", value: advertiserRoleLabel(info.role || "UNKNOWN") });
  if (info.contactStatus && info.contactStatus !== "NOT_CONTACTED") {
    rows.push({ label: "حالة التواصل", value: advertiserContactStatusLabel(info.contactStatus) });
  }
  return { title: "بيانات المعلن", rows, phone: info.phone, displayName };
}

export function buildAdvertiserContactActions(record = {}) {
  const info = readAdvertiserPhoneFromRecord(record);
  const phone = info.phone;
  return [
    { action: "call", label: "اتصال", phone, disabled: !phone },
    { action: "copy", label: "نسخ الرقم", phone, disabled: !phone },
    { action: "whatsapp", label: "واتساب", phone, disabled: !phone },
    { action: "edit", label: "تعديل البيانات", phone, disabled: false }
  ];
}
