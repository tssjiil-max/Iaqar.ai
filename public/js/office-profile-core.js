/**
 * IAQAR.AI — Office profile pure helpers (Phase 1).
 * Usable from browser (window.IAQAR.officeProfile) and Node tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.IAQAR = root.IAQAR || {};
  root.IAQAR.officeProfile = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SPECIALTY_LABELS = Object.freeze({
    sale: "بيع",
    purchase: "شراء",
    rent: "تأجير",
    property_management: "إدارة أملاك"
  });
  const SPECIALTY_KEYS = Object.freeze(Object.keys(SPECIALTY_LABELS));

  const COOPERATION_MODES = Object.freeze({
    DISABLED: "DISABLED",
    APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
    SMART_AUTOMATIC: "SMART_AUTOMATIC"
  });

  const COOPERATION_MODE_LABELS = Object.freeze({
    DISABLED: "إيقاف التعاون",
    APPROVAL_REQUIRED: "يتطلب موافقة الوسيط على كل طلب",
    SMART_AUTOMATIC: "تعاون ذكي تلقائي وفق القواعد المعتمدة"
  });

  const DEFAULT_COOPERATION_MODE = COOPERATION_MODES.APPROVAL_REQUIRED;

  /** Configurable design presets — change ratios here without rewriting upload workflow. */
  const COVER_CROP_PRESETS = Object.freeze({
    display: Object.freeze({ id: "display", label: "صورة العرض", aspectRatio: 16 / 9, width: 1280, height: 720 }),
    whatsappWide: Object.freeze({ id: "whatsappWide", label: "غلاف واتساب العريض", aspectRatio: 1.91, width: 1146, height: 600 }),
    logo: Object.freeze({ id: "logo", label: "شعار المكتب", aspectRatio: 1, width: 512, height: 512 })
  });

  const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
    match: true,
    ownerCustomer: true,
    cooperation: true,
    message: true,
    appointmentFollowUp: true,
    importantSystem: true
  });

  const NOTIFICATION_PREFERENCE_LABELS = Object.freeze({
    match: "إشعارات المطابقة",
    ownerCustomer: "إشعارات المالك والعميل",
    cooperation: "إشعارات التعاون",
    message: "إشعارات الرسائل",
    appointmentFollowUp: "إشعارات المواعيد والمتابعة",
    importantSystem: "إشعارات النظام المهمة"
  });

  function safeText(value, fallback = "") {
    return String(value == null ? fallback : value).trim();
  }

  function significantCharacterCount(value) {
    const matches = safeText(value).match(/[A-Za-z0-9\u0600-\u06FF]/g);
    return matches ? matches.length : 0;
  }

  function allowedOfficeName(value) {
    const name = safeText(value);
    return /^[A-Za-z0-9\u0600-\u06FF\s._-]+$/.test(name);
  }

  function normalizeOfficeNameKey(value) {
    return safeText(value)
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/[\s._-]+/g, "")
      .replace(/[^A-Za-z0-9\u0600-\u06FF]/g, "");
  }

  function validateOfficeName(value, { isPlatformAdmin = false } = {}) {
    const name = safeText(value);
    if (!name) return "اكتب اسم المكتب";
    if (!allowedOfficeName(name)) return "اسم المكتب يقبل العربية أو الإنجليزية والأرقام والمسافات فقط";
    if (!isPlatformAdmin && significantCharacterCount(name) < 4) {
      return "اسم المكتب يجب أن يكون 4 أحرف على الأقل؛ الأسماء الأقصر محجوزة لإدارة المنصة";
    }
    if (significantCharacterCount(name) > 80) return "اسم المكتب طويل جدًا";
    return "";
  }

  function namesAreEquivalent(a, b) {
    const keyA = normalizeOfficeNameKey(a);
    const keyB = normalizeOfficeNameKey(b);
    return Boolean(keyA) && keyA === keyB;
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

  function shortHash(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).slice(0, 6);
  }

  function buildPublicSlug(name, officeId) {
    return `${publicSlugBase(name)}-${shortHash(officeId)}`.slice(0, 64);
  }

  function normalizeCooperationMode(value) {
    const mode = safeText(value).toUpperCase();
    if (mode === COOPERATION_MODES.DISABLED) return COOPERATION_MODES.DISABLED;
    if (mode === COOPERATION_MODES.SMART_AUTOMATIC) return COOPERATION_MODES.SMART_AUTOMATIC;
    return DEFAULT_COOPERATION_MODE;
  }

  function normalizeNotificationPreferences(value) {
    const source = value && typeof value === "object" ? value : {};
    const next = {};
    for (const key of Object.keys(DEFAULT_NOTIFICATION_PREFERENCES)) {
      next[key] = source[key] === undefined ? DEFAULT_NOTIFICATION_PREFERENCES[key] : Boolean(source[key]);
    }
    return next;
  }

  function normalizedSpecialties(value) {
    const list = Array.isArray(value) ? value : [];
    return [...new Set(list.filter(item => SPECIALTY_KEYS.includes(item)))];
  }

  function specialtyText(list) {
    return normalizedSpecialties(list).map(key => SPECIALTY_LABELS[key]).join(" • ");
  }

  function getCoverCropPreset(id) {
    return COVER_CROP_PRESETS[id] || COVER_CROP_PRESETS.display;
  }

  function validateImageFile(file, { maxBytes = 10 * 1024 * 1024 } = {}) {
    if (!file) return "اختر صورة";
    if (!/^image\/(jpeg|png|webp)$/.test(file.type || "")) {
      return "اختر صورة JPG أو PNG أو WebP";
    }
    if (Number(file.size) > maxBytes) {
      return "حجم الصورة يتجاوز 10 ميجابايت";
    }
    return "";
  }

  /**
   * Center-crop source bitmap into preset aspect ratio, return PNG blob via canvas factory.
   * @param {HTMLImageElement|ImageBitmap} image
   * @param {{aspectRatio:number,width:number,height:number}} preset
   * @param {function(): HTMLCanvasElement} createCanvas
   */
  async function cropImageToPreset(image, preset, createCanvas) {
    const canvas = createCanvas();
    const width = Math.max(1, Math.round(preset.width || 1280));
    const height = Math.max(1, Math.round(preset.height || Math.round(width / (preset.aspectRatio || 1))));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    const scale = Math.max(width / naturalWidth, height / naturalHeight);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    const sourceX = (naturalWidth - sourceWidth) / 2;
    const sourceY = (naturalHeight - sourceHeight) / 2;
    ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
    return new Promise((resolve, reject) => {
      if (canvas.toBlob) {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("CROP_FAILED"))), "image/jpeg", 0.92);
      } else {
        reject(new Error("CROP_UNSUPPORTED"));
      }
    });
  }

  function cleanOfficeProfile(data, defaults) {
    const base = defaults || {};
    const phone = safeText(data.phone).replace(/[^0-9+]/g, "").slice(0, 20);
    return {
      officeName: safeText(data.officeName, base.officeName || "").slice(0, 80),
      officeNameKey: normalizeOfficeNameKey(data.officeName || base.officeName || "").slice(0, 100),
      brokerName: safeText(data.brokerName, base.brokerName || "").slice(0, 80),
      phone,
      whatsapp: safeText(data.whatsapp || phone).replace(/[^0-9+]/g, "").slice(0, 20),
      licenseNumber: safeText(data.licenseNumber, base.licenseNumber || "").replace(/[^0-9]/g, "").slice(0, 20),
      city: safeText(data.city, base.city || "").slice(0, 60),
      specialties: normalizedSpecialties(data.specialties),
      logoUrl: safeText(data.logoUrl).slice(0, 2000),
      coverUrl: safeText(data.coverUrl).slice(0, 2000),
      whatsappCoverUrl: safeText(data.whatsappCoverUrl).slice(0, 2000),
      publicSlug: safeText(data.publicSlug).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64),
      cooperationMode: normalizeCooperationMode(data.cooperationMode),
      notificationPreferences: normalizeNotificationPreferences(data.notificationPreferences)
    };
  }

  return {
    SPECIALTY_LABELS,
    SPECIALTY_KEYS,
    COOPERATION_MODES,
    COOPERATION_MODE_LABELS,
    DEFAULT_COOPERATION_MODE,
    COVER_CROP_PRESETS,
    DEFAULT_NOTIFICATION_PREFERENCES,
    NOTIFICATION_PREFERENCE_LABELS,
    safeText,
    significantCharacterCount,
    allowedOfficeName,
    normalizeOfficeNameKey,
    validateOfficeName,
    namesAreEquivalent,
    publicSlugBase,
    shortHash,
    buildPublicSlug,
    normalizeCooperationMode,
    normalizeNotificationPreferences,
    normalizedSpecialties,
    specialtyText,
    getCoverCropPreset,
    validateImageFile,
    cropImageToPreset,
    cleanOfficeProfile
  };
});
