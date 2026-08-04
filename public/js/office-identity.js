/**
 * قواعد هوية المكتب المشتركة — IAQAR.AI
 * وحدة نقية بلا اعتماديات: تعمل في المتصفح عبر window.IAQAR_OFFICE_IDENTITY
 * وتعمل في Node عبر module.exports حتى تُختبر القواعد نفسها المستخدمة في الواجهة.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.IAQAR = root.IAQAR || {};
    root.IAQAR.identity = api;
    root.IAQAR_OFFICE_IDENTITY = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SPECIALTY_LABELS = Object.freeze({
    sale: "بيع",
    purchase: "شراء",
    rent: "تأجير",
    property_management: "إدارة أملاك"
  });
  const SPECIALTY_KEYS = Object.freeze(Object.keys(SPECIALTY_LABELS));

  const OFFICE_NAME_MIN_CHARS = 4;
  const OFFICE_NAME_MAX_CHARS = 80;

  /**
   * إعدادات القص قابلة للتغيير من مكان واحد دون إعادة كتابة مسار الرفع.
   * aspectRatio = العرض ÷ الارتفاع. لا تُعتمد أي مقاسات خارجية غير موثقة.
   */
  const IMAGE_PRESETS = Object.freeze({
    logo: Object.freeze({
      key: "logo",
      label: "شعار المكتب",
      aspectRatio: 1,
      outputWidth: 512,
      maxBytes: 5 * 1024 * 1024,
      mimeTypes: Object.freeze(["image/jpeg", "image/png", "image/webp"])
    }),
    display: Object.freeze({
      key: "display",
      label: "صورة المكتب",
      aspectRatio: 4 / 3,
      outputWidth: 1200,
      maxBytes: 10 * 1024 * 1024,
      mimeTypes: Object.freeze(["image/jpeg", "image/png", "image/webp"])
    }),
    share: Object.freeze({
      key: "share",
      label: "غلاف المشاركة العريض",
      aspectRatio: 1.91,
      outputWidth: 1200,
      maxBytes: 10 * 1024 * 1024,
      mimeTypes: Object.freeze(["image/jpeg", "image/png", "image/webp"])
    })
  });

  const NOTIFICATION_CATEGORIES = Object.freeze([
    Object.freeze({ key: "matches", label: "إشعارات المطابقات" }),
    Object.freeze({ key: "ownerCustomer", label: "إشعارات الملاك والعملاء" }),
    Object.freeze({ key: "cooperation", label: "إشعارات التعاون" }),
    Object.freeze({ key: "messages", label: "إشعارات الرسائل" }),
    Object.freeze({ key: "appointments", label: "إشعارات المواعيد والمتابعة" }),
    Object.freeze({ key: "system", label: "إشعارات النظام المهمة" })
  ]);
  const NOTIFICATION_KEYS = Object.freeze(NOTIFICATION_CATEGORIES.map(item => item.key));

  const COOPERATION_MODES = Object.freeze([
    Object.freeze({ key: "disabled", label: "إيقاف التعاون" }),
    Object.freeze({ key: "approval_required", label: "التعاون بموافقة الوسيط لكل طلب" }),
    Object.freeze({ key: "smart_automatic", label: "تعاون ذكي تلقائي وفق القواعد المعتمدة" })
  ]);
  const COOPERATION_MODE_KEYS = Object.freeze(COOPERATION_MODES.map(item => item.key));
  const DEFAULT_COOPERATION_MODE = "approval_required";

  const COOPERATION_STATUS_LABELS = Object.freeze({
    not_shared: "لم تُشارك",
    pending: "بانتظار الموافقة",
    active: "تعاون نشط",
    rejected: "رُفض الطلب",
    ended: "انتهى التعاون"
  });

  const OFFICE_SETTINGS_DOCS = Object.freeze({
    notifications: "notifications",
    cooperation: "cooperation",
    brokerPrefix: "broker-"
  });

  function brokerSettingsDocId(uid) {
    const clean = String(uid == null ? "" : uid).trim();
    return clean ? `${OFFICE_SETTINGS_DOCS.brokerPrefix}${clean}` : "";
  }

  function safeText(value, fallback = "") {
    return String(value == null ? fallback : value).trim();
  }

  function significantCharacterCount(value) {
    const matches = safeText(value).match(/[A-Za-z0-9\u0600-\u06FF]/g);
    return matches ? matches.length : 0;
  }

  function allowedOfficeName(value) {
    return /^[A-Za-z0-9\u0600-\u06FF\s._-]+$/.test(safeText(value));
  }

  /**
   * مفتاح التطابق: يوحّد المسافات والتشكيل وصور الألف والتاء المربوطة
   * حتى لا يمر اسمان متكافئان على أنهما مختلفان.
   */
  function normalizeOfficeNameKey(value) {
    return safeText(value)
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
      .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
      .replace(/\u0629/g, "\u0647")
      .replace(/\u0649/g, "\u064A")
      .replace(/[\u0624]/g, "\u0648")
      .replace(/[\u0626]/g, "\u064A")
      .replace(/[\s._-]+/g, "")
      .replace(/[^A-Za-z0-9\u0600-\u06FF]/g, "");
  }

  /** تُعيد رسالة عربية عند الخطأ، أو نصًا فارغًا عند القبول. */
  function validateOfficeName(value, options = {}) {
    const name = safeText(value);
    if (!name) return "اكتب اسم المكتب";
    if (!allowedOfficeName(name)) return "اسم المكتب يقبل العربية أو الإنجليزية والأرقام والمسافات فقط";
    const significant = significantCharacterCount(name);
    if (!significant) return "اكتب اسم المكتب";
    if (!options.allowShortName && significant < OFFICE_NAME_MIN_CHARS) {
      return "اسم المكتب يجب أن يكون 4 أحرف على الأقل؛ الأسماء الأقصر محجوزة لإدارة المنصة";
    }
    if (name.length > OFFICE_NAME_MAX_CHARS) return "اسم المكتب طويل جدًا";
    if (!normalizeOfficeNameKey(name)) return "اسم المكتب غير صالح";
    return "";
  }

  function officeNamesAreEquivalent(left, right) {
    const leftKey = normalizeOfficeNameKey(left);
    return Boolean(leftKey) && leftKey === normalizeOfficeNameKey(right);
  }

  function shortHash(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).slice(0, 6);
  }

  function publicSlugBase(value) {
    const asciiName = safeText(value)
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36);
    return asciiName || "maktab";
  }

  function buildPublicSlug(name, officeId) {
    return `${publicSlugBase(name)}-${shortHash(officeId)}`.slice(0, 64);
  }

  function normalizeSlug(value) {
    return safeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64);
  }

  function normalizeSaudiMobile(value) {
    let digits = String(value == null ? "" : value).replace(/\D/g, "");
    if (digits.startsWith("00966")) digits = digits.slice(2);
    if (digits.startsWith("966")) digits = `0${digits.slice(3)}`;
    if (digits.startsWith("5") && digits.length === 9) digits = `0${digits}`;
    return /^05\d{8}$/.test(digits) ? digits : "";
  }

  function validateMobile(value, { required = false } = {}) {
    const raw = safeText(value);
    if (!raw) return required ? "أدخل رقم الجوال" : "";
    return normalizeSaudiMobile(raw) ? "" : "أدخل رقم جوال سعودي صحيحًا يبدأ بـ 05";
  }

  function imagePreset(kind) {
    return IMAGE_PRESETS[kind] || IMAGE_PRESETS.display;
  }

  function formatMegabytes(bytes) {
    const value = bytes / (1024 * 1024);
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  /** تحقق من نوع الملف وحجمه قبل أي رفع. يعيد رسالة عربية عند الرفض. */
  function validateImageFile(file, kind) {
    const preset = imagePreset(kind);
    if (!file) return "اختر صورة أولًا";
    const type = String(file.type || "").toLowerCase();
    if (!preset.mimeTypes.includes(type)) return "اختر صورة JPG أو PNG أو WebP";
    const size = Number(file.size || 0);
    if (!Number.isFinite(size) || size <= 0) return "تعذر قراءة حجم الصورة";
    if (size > preset.maxBytes) return `حجم الصورة يتجاوز ${formatMegabytes(preset.maxBytes)} ميجابايت`;
    return "";
  }

  function clampUnit(value, fallback = 0.5) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(1, Math.max(0, number));
  }

  /**
   * مستطيل القص لنسبة معتمدة، مع نقطة تركيز أفقية ورأسية بين 0 و1.
   * لا يقص أبدًا خارج حدود الصورة الأصلية.
   */
  function computeCropRect({ sourceWidth, sourceHeight, aspectRatio, focusX = 0.5, focusY = 0.5 } = {}) {
    const width = Math.max(1, Math.round(Number(sourceWidth) || 0));
    const height = Math.max(1, Math.round(Number(sourceHeight) || 0));
    const ratio = Number(aspectRatio) > 0 ? Number(aspectRatio) : 1;
    let cropWidth = width;
    let cropHeight = Math.round(width / ratio);
    if (cropHeight > height) {
      cropHeight = height;
      cropWidth = Math.round(height * ratio);
    }
    cropWidth = Math.min(width, Math.max(1, cropWidth));
    cropHeight = Math.min(height, Math.max(1, cropHeight));
    const x = Math.round(clampUnit(focusX) * width - cropWidth / 2);
    const y = Math.round(clampUnit(focusY) * height - cropHeight / 2);
    return {
      sx: Math.min(Math.max(0, x), width - cropWidth),
      sy: Math.min(Math.max(0, y), height - cropHeight),
      sWidth: cropWidth,
      sHeight: cropHeight
    };
  }

  function outputSize(kind) {
    const preset = imagePreset(kind);
    return {
      width: preset.outputWidth,
      height: Math.round(preset.outputWidth / preset.aspectRatio)
    };
  }

  function defaultNotificationPreferences() {
    return NOTIFICATION_KEYS.reduce((accumulator, key) => {
      accumulator[key] = true;
      return accumulator;
    }, {});
  }

  /** القيمة غير المحددة تعني التفعيل الافتراضي، وأي قيمة غير منطقية تُعامل كإيقاف. */
  function sanitizeNotificationPreferences(value) {
    const source = value && typeof value === "object" ? value : {};
    return NOTIFICATION_KEYS.reduce((accumulator, key) => {
      accumulator[key] = source[key] === undefined ? true : source[key] === true;
      return accumulator;
    }, {});
  }

  /** أولوية تفضيل الوسيط ثم تفضيل المكتب ثم الافتراضي المفعّل. */
  function resolveNotificationPreference(category, { brokerPreferences = null, officePreferences = null } = {}) {
    if (!NOTIFICATION_KEYS.includes(category)) return false;
    if (brokerPreferences && typeof brokerPreferences === "object" && brokerPreferences[category] !== undefined) {
      return brokerPreferences[category] === true;
    }
    if (officePreferences && typeof officePreferences === "object" && officePreferences[category] !== undefined) {
      return officePreferences[category] === true;
    }
    return true;
  }

  function sanitizeCooperationMode(value) {
    const mode = safeText(value);
    return COOPERATION_MODE_KEYS.includes(mode) ? mode : DEFAULT_COOPERATION_MODE;
  }

  function cooperationModeLabel(value) {
    const mode = sanitizeCooperationMode(value);
    const found = COOPERATION_MODES.find(item => item.key === mode);
    return found ? found.label : "";
  }

  function normalizeSpecialties(value) {
    const list = Array.isArray(value) ? value : [];
    return [...new Set(list.filter(item => SPECIALTY_KEYS.includes(item)))];
  }

  function specialtiesSummary(value) {
    return normalizeSpecialties(value).map(key => SPECIALTY_LABELS[key]).join(" • ");
  }

  return Object.freeze({
    SPECIALTY_LABELS,
    SPECIALTY_KEYS,
    OFFICE_NAME_MIN_CHARS,
    OFFICE_NAME_MAX_CHARS,
    IMAGE_PRESETS,
    NOTIFICATION_CATEGORIES,
    NOTIFICATION_KEYS,
    COOPERATION_MODES,
    COOPERATION_MODE_KEYS,
    DEFAULT_COOPERATION_MODE,
    COOPERATION_STATUS_LABELS,
    OFFICE_SETTINGS_DOCS,
    brokerSettingsDocId,
    safeText,
    significantCharacterCount,
    allowedOfficeName,
    normalizeOfficeNameKey,
    validateOfficeName,
    officeNamesAreEquivalent,
    shortHash,
    publicSlugBase,
    buildPublicSlug,
    normalizeSlug,
    normalizeSaudiMobile,
    validateMobile,
    imagePreset,
    validateImageFile,
    computeCropRect,
    outputSize,
    defaultNotificationPreferences,
    sanitizeNotificationPreferences,
    resolveNotificationPreference,
    sanitizeCooperationMode,
    cooperationModeLabel,
    normalizeSpecialties,
    specialtiesSummary
  });
});
