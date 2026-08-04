// Pure domain logic for the office card, office settings and the opportunity bank.
//
// This module must stay free of DOM access, network access and imports so the same code
// runs in the browser (imported by office-settings.js) and under node:test.

export const OFFICE_NAME_MAX_LENGTH = 80;
export const OFFICE_NAME_MIN_VISIBLE_CHARACTERS = 4;
export const OFFICE_NAME_KEY_MAX_LENGTH = 100;

const ARABIC_LETTERS = "\u0621-\u064A";
const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670]/g;
const ARABIC_TATWEEL = /\u0640/g;
const ARABIC_EQUIVALENTS = Object.freeze([
  [/[\u0623\u0625\u0622\u0671]/g, "\u0627"],
  [/\u0629/g, "\u0647"],
  [/\u0649/g, "\u064A"],
  [/\u0624/g, "\u0648"],
  [/\u0626/g, "\u064A"]
]);
const ALLOWED_OFFICE_NAME = /^[A-Za-z0-9\u0600-\u06FF\s._-]+$/;
const VISIBLE_OFFICE_NAME_CHARACTER = new RegExp(`[A-Za-z0-9${ARABIC_LETTERS}]`, "g");

export const OFFICE_NAME_MESSAGES = Object.freeze({
  empty: "اكتب اسم المكتب",
  characters: "اسم المكتب يقبل العربية أو الإنجليزية والأرقام والمسافات فقط",
  tooShort: "اسم المكتب يجب أن يكون 4 أحرف على الأقل؛ الأسماء الأقصر محجوزة لإدارة المنصة",
  tooLong: "اسم المكتب طويل جدًا",
  taken: "اسم المكتب مستخدم أو محجوز؛ اختر اسمًا آخر",
  available: "الاسم متاح"
});

export function safeText(value, fallback = "") {
  return String(value == null ? fallback : value).trim();
}

/** Display name: trimmed, with internal whitespace runs collapsed. Never altered further. */
export function normalizeOfficeName(value) {
  return safeText(value).replace(/\s+/g, " ").slice(0, OFFICE_NAME_MAX_LENGTH);
}

/**
 * Counts only characters a reader would consider part of the name. Spaces, dots, dashes
 * and underscores do not count, so "م ك ت" is three visible characters, not five.
 */
export function significantCharacterCount(value) {
  const matches = safeText(value).match(VISIBLE_OFFICE_NAME_CHARACTER);
  return matches ? matches.length : 0;
}

export function isAllowedOfficeName(value) {
  const name = safeText(value);
  return name.length > 0 && ALLOWED_OFFICE_NAME.test(name);
}

/**
 * The system-wide uniqueness key and the officeNameClaims document ID.
 *
 * Folding Arabic orthographic variants is what makes "مكتب الأمل" and "مكتب الامل"
 * collide, which the constitution requires ("prevent equivalent duplicate names after
 * normalization"). Changing this function changes every future claim ID, so existing
 * claims migrate lazily on the office's next save.
 */
export function normalizeOfficeNameKey(value) {
  let text = safeText(value)
    .replace(/\s+/g, " ")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(ARABIC_DIACRITICS, "")
    .replace(ARABIC_TATWEEL, "");
  for (const [pattern, replacement] of ARABIC_EQUIVALENTS) {
    text = text.replace(pattern, replacement);
  }
  return text
    .replace(new RegExp(`[^a-z0-9${ARABIC_LETTERS}]`, "g"), "")
    .slice(0, OFFICE_NAME_KEY_MAX_LENGTH);
}

/** Returns "" when the name is acceptable, otherwise an Arabic message for the broker. */
export function validateOfficeName(value, { isPlatformAdmin = false } = {}) {
  const name = safeText(value);
  if (!name) return OFFICE_NAME_MESSAGES.empty;
  if (!isAllowedOfficeName(name)) return OFFICE_NAME_MESSAGES.characters;
  const visible = significantCharacterCount(name);
  if (!isPlatformAdmin && visible < OFFICE_NAME_MIN_VISIBLE_CHARACTERS) {
    return OFFICE_NAME_MESSAGES.tooShort;
  }
  if (name.length > OFFICE_NAME_MAX_LENGTH) return OFFICE_NAME_MESSAGES.tooLong;
  if (!normalizeOfficeNameKey(name)) return OFFICE_NAME_MESSAGES.characters;
  return "";
}

// ---------------------------------------------------------------------------
// Visual identity
// ---------------------------------------------------------------------------

export const ACCEPTED_IMAGE_TYPES = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
});
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Crop presets are a design setting, deliberately collected in one place so a ratio can
 * change without touching the upload, preview, validation or save code.
 *
 * The cover ratio is a common wide link-preview ratio chosen as our default. It is NOT a
 * verified WhatsApp requirement and must not be described as one.
 */
export const OFFICE_IMAGE_PRESETS = Object.freeze({
  logo: Object.freeze({
    variant: "logo",
    label: "شعار المكتب",
    aspectRatio: 1,
    outputWidth: 512,
    outputHeight: 512,
    outputType: "image/png",
    outputQuality: 1,
    removable: true
  }),
  display: Object.freeze({
    variant: "display",
    label: "صورة المكتب",
    aspectRatio: 4 / 3,
    outputWidth: 1024,
    outputHeight: 768,
    outputType: "image/jpeg",
    outputQuality: 0.9,
    removable: true
  }),
  cover: Object.freeze({
    variant: "cover",
    label: "ترويسة عريضة للمشاركة",
    aspectRatio: 1.91,
    outputWidth: 1200,
    outputHeight: 628,
    outputType: "image/jpeg",
    outputQuality: 0.9,
    // الترويسة مطلوبة لبطاقة المكتب ومواد المشاركة، فلا تُزال بعد رفعها.
    removable: false
  })
});

export const OFFICE_IMAGE_VARIANTS = Object.freeze(Object.keys(OFFICE_IMAGE_PRESETS));

export const OFFICE_IMAGE_MESSAGES = Object.freeze({
  type: "اختر صورة JPG أو PNG أو WebP",
  size: "حجم الصورة يتجاوز 10 ميجابايت",
  missing: "لم يتم اختيار صورة",
  failed: "تعذر تجهيز الصورة، حاول مرة أخرى",
  uploading: "جارٍ رفع الصورة…",
  uploaded: "تم رفع الصورة",
  removing: "جارٍ إزالة الصورة…",
  removed: "تمت إزالة الصورة"
});

export function imagePreset(variant) {
  return OFFICE_IMAGE_PRESETS[variant] || null;
}

export function officeImageStorageKey(officeId, variant) {
  const preset = imagePreset(variant);
  const safeOfficeId = String(officeId || "").trim().toLowerCase();
  if (!preset || !/^[a-z0-9_-]{1,80}$/.test(safeOfficeId)) return "";
  return `office-covers/${safeOfficeId}/${preset.variant}`;
}

/** Returns "" when the file is acceptable, otherwise an Arabic message. */
export function validateImageFile(file) {
  if (!file) return OFFICE_IMAGE_MESSAGES.missing;
  if (!ACCEPTED_IMAGE_TYPES[String(file.type || "").toLowerCase()]) {
    return OFFICE_IMAGE_MESSAGES.type;
  }
  if (Number(file.size || 0) > MAX_IMAGE_BYTES) return OFFICE_IMAGE_MESSAGES.size;
  return "";
}

/**
 * Largest source rectangle matching `aspectRatio`, positioned by `offsetX`/`offsetY`
 * (0 = start, 0.5 = centred, 1 = end) so the broker can reposition the crop.
 */
export function cropRectForAspect({
  naturalWidth,
  naturalHeight,
  aspectRatio,
  offsetX = 0.5,
  offsetY = 0.5
} = {}) {
  const width = Math.floor(Number(naturalWidth) || 0);
  const height = Math.floor(Number(naturalHeight) || 0);
  const ratio = Number(aspectRatio);
  if (width <= 0 || height <= 0 || !(ratio > 0)) return null;

  let sourceWidth = width;
  let sourceHeight = Math.round(width / ratio);
  if (sourceHeight > height) {
    sourceHeight = height;
    sourceWidth = Math.round(height * ratio);
  }
  sourceWidth = Math.min(sourceWidth, width);
  sourceHeight = Math.min(sourceHeight, height);

  const clamp = value => Math.min(1, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0.5));
  return {
    sourceX: Math.round((width - sourceWidth) * clamp(offsetX)),
    sourceY: Math.round((height - sourceHeight) * clamp(offsetY)),
    sourceWidth,
    sourceHeight
  };
}

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

export const NOTIFICATION_CATEGORIES = Object.freeze([
  Object.freeze({ key: "matchNotifications", label: "إشعارات المطابقات" }),
  Object.freeze({ key: "ownerCustomerNotifications", label: "إشعارات الملاك والعملاء" }),
  Object.freeze({ key: "cooperationNotifications", label: "إشعارات التعاون" }),
  Object.freeze({ key: "messageNotifications", label: "إشعارات الرسائل" }),
  Object.freeze({ key: "appointmentNotifications", label: "إشعارات المواعيد والمتابعات" }),
  Object.freeze({ key: "systemNotifications", label: "إشعارات النظام المهمة" })
]);

export const NOTIFICATION_CATEGORY_KEYS = Object.freeze(
  NOTIFICATION_CATEGORIES.map(category => category.key)
);

export function defaultNotificationPreferences() {
  const preferences = {};
  for (const key of NOTIFICATION_CATEGORY_KEYS) preferences[key] = true;
  return preferences;
}

/** Keeps only known category keys, and only when they are an explicit boolean. */
export function sanitizeNotificationPreferences(value) {
  const source = value && typeof value === "object" ? value : {};
  const preferences = {};
  for (const key of NOTIFICATION_CATEGORY_KEYS) {
    if (typeof source[key] === "boolean") preferences[key] = source[key];
  }
  return preferences;
}

/** Broker override wins over office default, which wins over the built-in default. */
export function resolveNotificationPreferences({ officeDefaults, brokerOverrides } = {}) {
  return {
    ...defaultNotificationPreferences(),
    ...sanitizeNotificationPreferences(officeDefaults),
    ...sanitizeNotificationPreferences(brokerOverrides)
  };
}

/**
 * Maps a push `type` to the preference category that governs it. Kept in sync with the
 * identical table in worker/src/index.js; both copies are covered by tests so a drift
 * fails the build. The Worker cannot import from public/ without adding a build step.
 */
export const PUSH_TYPE_CATEGORIES = Object.freeze({
  match: "matchNotifications",
  deal: "matchNotifications",
  client_request: "ownerCustomerNotifications",
  owner_offer: "ownerCustomerNotifications",
  intake: "ownerCustomerNotifications",
  cooperation: "cooperationNotifications",
  cooperation_request: "cooperationNotifications",
  cooperation_response: "cooperationNotifications",
  message: "messageNotifications",
  conversation: "messageNotifications",
  appointment: "appointmentNotifications",
  followup: "appointmentNotifications",
  viewing: "appointmentNotifications"
});

/** Types the broker triggered themself, which must never be silently swallowed. */
export const ALWAYS_ALLOWED_PUSH_TYPES = Object.freeze(["notification_test"]);

export function notificationCategoryForPushType(type) {
  const key = String(type || "").trim().toLowerCase();
  return PUSH_TYPE_CATEGORIES[key] || "systemNotifications";
}

export function isNotificationAllowed(type, preferences) {
  if (ALWAYS_ALLOWED_PUSH_TYPES.includes(String(type || "").trim().toLowerCase())) return true;
  const resolved = { ...defaultNotificationPreferences(), ...sanitizeNotificationPreferences(preferences) };
  return resolved[notificationCategoryForPushType(type)] !== false;
}

// ---------------------------------------------------------------------------
// Cooperation
// ---------------------------------------------------------------------------

export const COOPERATION_MODES = Object.freeze([
  Object.freeze({
    value: "DISABLED",
    label: "إيقاف التعاون",
    help: "لا يستقبل المكتب أي طلب تعاون من وسطاء آخرين."
  }),
  Object.freeze({
    value: "APPROVAL_REQUIRED",
    label: "التعاون بموافقة الوسيط لكل طلب",
    help: "يصل الطلب إلى المكتب، ولا يُفتح أي وصول قبل موافقتك."
  }),
  Object.freeze({
    value: "SMART_AUTOMATIC",
    label: "تعاون ذكي تلقائي وفق القواعد المعتمدة",
    help: "يُفتح وصول محدود تلقائيًا وفق القواعد، وبيانات التواصل تبقى مخفية."
  })
]);

export const DEFAULT_COOPERATION_MODE = "APPROVAL_REQUIRED";

export const COOPERATION_MODE_VALUES = Object.freeze(
  COOPERATION_MODES.map(mode => mode.value)
);

export function normalizeCooperationMode(value) {
  const mode = String(value || "").trim().toUpperCase();
  return COOPERATION_MODE_VALUES.includes(mode) ? mode : DEFAULT_COOPERATION_MODE;
}

/** The five approved broker-visible cooperation statuses. */
export const COOPERATION_STATUS_LABELS = Object.freeze({
  NOT_SHARED: "لم تُشارك",
  PENDING_APPROVAL: "بانتظار الموافقة",
  ACTIVE: "تعاون نشط",
  REJECTED: "رُفض الطلب",
  ENDED: "انتهى التعاون"
});

export function cooperationStatusLabel(value) {
  const key = String(value || "NOT_SHARED").trim().toUpperCase();
  return COOPERATION_STATUS_LABELS[key] || COOPERATION_STATUS_LABELS.NOT_SHARED;
}

/**
 * Automatic cooperation must never expose contact information on its own, so this is a
 * constant rather than a setting the interface can flip.
 */
export function cooperationSettingsPayload(mode) {
  return {
    mode: normalizeCooperationMode(mode),
    exposeContactAutomatically: false
  };
}

// ---------------------------------------------------------------------------
// Office link and handle
// ---------------------------------------------------------------------------

export function publicSlugBase(value) {
  const asciiName = safeText(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return asciiName || "maktab";
}

export function shortHash(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 6);
}

export function buildPublicSlug(name, officeId) {
  return `${publicSlugBase(name)}-${shortHash(officeId)}`.slice(0, 64);
}

export function normalizePublicSlug(value) {
  return safeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

/** The canonical shareable office link. Prefers the stable handle over a query string. */
export function officeLinkFor({ origin, publicSlug, officeId, pathname = "/" } = {}) {
  const base = safeText(origin) || "https://iaqar.ai";
  const slug = normalizePublicSlug(publicSlug);
  if (slug) return new URL(`/o/${encodeURIComponent(slug)}`, base).toString();
  const url = new URL(pathname || "/", base);
  url.searchParams.set("office", safeText(officeId) || "platform");
  url.searchParams.set("view", "public");
  return url.toString();
}

// ---------------------------------------------------------------------------
// Opportunity bank projection
// ---------------------------------------------------------------------------

const OPPORTUNITY_KIND_LABELS = Object.freeze({
  owner_offer: "عرض مالك",
  client_request: "طلب عميل",
  owner: "عرض مالك",
  client: "طلب عميل"
});

function formatMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return `${amount.toLocaleString("ar-SA")} ريال`;
}

export function opportunityAmountText(record = {}) {
  const isOwner = String(record.recordType || "").startsWith("owner");
  const exact = formatMoney(record.price || record.amount);
  if (exact) return { label: isOwner ? "السعر المطلوب" : "الميزانية", value: exact };
  const min = Number(record.priceMin || 0);
  const max = Number(record.priceMax || 0);
  if (min > 0 && max > 0) {
    return { label: isOwner ? "السعر المطلوب" : "الميزانية", value: `${formatMoney(min)} — ${formatMoney(max)}` };
  }
  const single = formatMoney(max || min);
  if (single) return { label: isOwner ? "السعر المطلوب" : "الميزانية", value: `حتى ${single}` };
  return { label: isOwner ? "السعر المطلوب" : "الميزانية", value: "غير محدد" };
}

export function formatDateAdded(value) {
  const date = toDateValue(value);
  if (!date) return "غير محدد";
  return date.toLocaleDateString("ar-SA", { year: "numeric", month: "long", day: "numeric" });
}

export function toDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") {
    try {
      const date = value.toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    } catch (_) {
      return null;
    }
  }
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Projects an opportunity document to the row the bank may display.
 *
 * The constitution limits the visible activity summary to date added and cooperation
 * status, and keeps contact information hidden by default, so this projection carries a
 * display name but never a phone number, and never a score, confidence value, parser log
 * or match-run count.
 */
export function opportunityBankRow(id, record = {}) {
  const kindKey = String(record.recordType || record.kind || "").toLowerCase();
  const amount = opportunityAmountText(record);
  const attributes = [];
  if (Number(record.area || 0) > 0) attributes.push(`${Number(record.area).toLocaleString("ar-SA")} م²`);
  if (Number(record.rooms || 0) > 0) attributes.push(`${Number(record.rooms).toLocaleString("ar-SA")} غرف`);
  if (record.furnished === true) attributes.push("مفروش");

  return {
    id: String(id || ""),
    kindLabel: OPPORTUNITY_KIND_LABELS[kindKey] || "فرصة",
    propertyType: safeText(record.propertyType) || "غير محدد",
    location: [safeText(record.city), safeText(record.district)].filter(Boolean).join(" — ") || "غير محدد",
    amountLabel: amount.label,
    amountText: amount.value,
    attributes,
    contactName: safeText(record.contactName || record.name),
    dateAdded: formatDateAdded(record.createdAt),
    cooperationStatus: cooperationStatusLabel(record.cooperationStatus)
  };
}
