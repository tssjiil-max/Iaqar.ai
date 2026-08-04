(() => {
  "use strict";

  const OFFICE_COVER_DESIGN = Object.freeze({
    whatsappCoverAspectRatio: 1.91,
    displayImageAspectRatio: 16 / 9,
    logoAspectRatio: 1,
    maxImageBytes: 10 * 1024 * 1024,
    allowedImageTypes: Object.freeze(["image/jpeg", "image/png", "image/webp"])
  });

  const COOPERATION_MODES = Object.freeze({
    DISABLED: "DISABLED",
    APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
    SMART_AUTOMATIC: "SMART_AUTOMATIC"
  });

  const DEFAULT_COOPERATION_MODE = COOPERATION_MODES.APPROVAL_REQUIRED;

  const COOPERATION_MODE_LABELS_AR = Object.freeze({
    DISABLED: "التعاون معطّل",
    APPROVAL_REQUIRED: "يتطلب موافقة الوسيط لكل طلب",
    SMART_AUTOMATIC: "تعاون ذكي تلقائي وفق القواعد المعتمدة"
  });

  const NOTIFICATION_PREF_KEYS = Object.freeze([
    "match",
    "ownerCustomer",
    "cooperation",
    "message",
    "appointmentFollowUp",
    "systemImportant"
  ]);

  const NOTIFICATION_PREF_LABELS_AR = Object.freeze({
    match: "إشعارات المطابقة",
    ownerCustomer: "إشعارات المالك والعميل",
    cooperation: "إشعارات التعاون",
    message: "إشعارات الرسائل",
    appointmentFollowUp: "إشعارات المواعيد والمتابعة",
    systemImportant: "إشعارات النظام المهمة"
  });

  const VISIBLE_COOPERATION_STATUS_AR = Object.freeze({
    NOT_SHARED: "لم تُشارك",
    PENDING: "بانتظار الموافقة",
    ACTIVE: "تعاون نشط",
    REJECTED: "رُفض الطلب",
    ENDED: "انتهى التعاون"
  });

  function defaultNotificationPreferences() {
    return {
      match: true,
      ownerCustomer: true,
      cooperation: true,
      message: true,
      appointmentFollowUp: true,
      systemImportant: true
    };
  }

  function normalizeNotificationPreferences(value) {
    const defaults = defaultNotificationPreferences();
    const source = value && typeof value === "object" ? value : {};
    const next = {};
    for (const key of NOTIFICATION_PREF_KEYS) {
      next[key] = source[key] === false ? false : defaults[key];
    }
    return next;
  }

  function normalizeCooperationMode(value) {
    const mode = String(value || "").trim().toUpperCase();
    if (mode === COOPERATION_MODES.DISABLED) return COOPERATION_MODES.DISABLED;
    if (mode === COOPERATION_MODES.SMART_AUTOMATIC) return COOPERATION_MODES.SMART_AUTOMATIC;
    return DEFAULT_COOPERATION_MODE;
  }

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

  function validateOfficeName(value, options = {}) {
    const isPlatformAdmin = options.isPlatformAdmin === true;
    const name = safeText(value);
    if (!name) return "اكتب اسم المكتب";
    if (!allowedOfficeName(name)) {
      return "اسم المكتب يقبل العربية أو الإنجليزية والأرقام والمسافات فقط";
    }
    if (!isPlatformAdmin && significantCharacterCount(name) < 4) {
      return "اسم المكتب يجب أن يكون 4 أحرف على الأقل؛ الأسماء الأقصر محجوزة لإدارة المنصة";
    }
    if (significantCharacterCount(name) > 80) return "اسم المكتب طويل جدًا";
    return "";
  }

  function isValidImageFileMeta({ type, size }, design = OFFICE_COVER_DESIGN) {
    if (!design.allowedImageTypes.includes(type)) return false;
    if (!Number.isFinite(size) || size <= 0 || size > design.maxImageBytes) return false;
    return true;
  }

  function cropRectForAspect(sourceWidth, sourceHeight, aspectRatio) {
    const width = Number(sourceWidth) || 0;
    const height = Number(sourceHeight) || 0;
    const ratio = Number(aspectRatio) || 1;
    if (width <= 0 || height <= 0 || ratio <= 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    const sourceRatio = width / height;
    if (sourceRatio > ratio) {
      const cropWidth = Math.round(height * ratio);
      return {
        x: Math.round((width - cropWidth) / 2),
        y: 0,
        width: cropWidth,
        height
      };
    }
    const cropHeight = Math.round(width / ratio);
    return {
      x: 0,
      y: Math.round((height - cropHeight) / 2),
      width,
      height: cropHeight
    };
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

  window.IAQAR_OFFICE_PROFILE = Object.freeze({
    OFFICE_COVER_DESIGN,
    COOPERATION_MODES,
    DEFAULT_COOPERATION_MODE,
    COOPERATION_MODE_LABELS_AR,
    NOTIFICATION_PREF_KEYS,
    NOTIFICATION_PREF_LABELS_AR,
    VISIBLE_COOPERATION_STATUS_AR,
    defaultNotificationPreferences,
    normalizeNotificationPreferences,
    normalizeCooperationMode,
    safeText,
    significantCharacterCount,
    allowedOfficeName,
    normalizeOfficeNameKey,
    validateOfficeName,
    isValidImageFileMeta,
    cropRectForAspect,
    publicSlugBase,
    shortHash,
    buildPublicSlug
  });
})();
