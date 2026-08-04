(function (global, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.IAQAR = global.IAQAR || {};
  global.IAQAR.OfficePolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

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

  const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
    match: true,
    ownerCustomer: true,
    cooperation: true,
    message: true,
    appointment: true,
    system: true
  });

  const NOTIFICATION_PREF_LABELS = Object.freeze({
    match: "إشعارات المطابقات",
    ownerCustomer: "إشعارات الملاك والعملاء",
    cooperation: "إشعارات التعاون",
    message: "إشعارات الرسائل",
    appointment: "إشعارات المواعيد والمتابعات",
    system: "إشعارات النظام المهمة"
  });

  function safeText(value, fallback) {
    return String(value == null ? (fallback || "") : value).trim();
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

  function validateOfficeName(value, options) {
    const opts = options || {};
    const isPlatformAdmin = opts.isPlatformAdmin === true;
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

  function normalizeCooperationMode(value) {
    const mode = safeText(value).toUpperCase();
    if (mode === COOPERATION_MODES.DISABLED) return COOPERATION_MODES.DISABLED;
    if (mode === COOPERATION_MODES.SMART_AUTOMATIC) return COOPERATION_MODES.SMART_AUTOMATIC;
    return COOPERATION_MODES.APPROVAL_REQUIRED;
  }

  function normalizeNotificationPreferences(value) {
    const source = value && typeof value === "object" ? value : {};
    const result = {};
    Object.keys(DEFAULT_NOTIFICATION_PREFERENCES).forEach(function (key) {
      result[key] = source[key] === false ? false : true;
    });
    return result;
  }

  function isNotificationEnabled(prefs, category) {
    const normalized = normalizeNotificationPreferences(prefs);
    if (!Object.prototype.hasOwnProperty.call(normalized, category)) return true;
    return normalized[category] !== false;
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
    return (publicSlugBase(name) + "-" + shortHash(officeId)).slice(0, 64);
  }

  function officeMediaObjectKey(officeId, kind) {
    const id = String(officeId || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
    const mediaKind = String(kind || "").trim().toLowerCase();
    if (!id) return "";
    if (mediaKind === "logo") return "office-covers/" + id + "/logo";
    if (mediaKind === "whatsapp-cover" || mediaKind === "whatsapp_cover") {
      return "office-covers/" + id + "/whatsapp-cover";
    }
    if (mediaKind === "cover" || mediaKind === "display") return "office-covers/" + id + "/cover";
    return "";
  }

  function isOfficeMediaPublicKey(key) {
    return /^office-covers\/[a-z0-9_-]{1,80}\/(cover|logo|whatsapp-cover)$/.test(String(key || ""));
  }

  return {
    COOPERATION_MODES,
    COOPERATION_MODE_LABELS,
    DEFAULT_NOTIFICATION_PREFERENCES,
    NOTIFICATION_PREF_LABELS,
    safeText,
    significantCharacterCount,
    allowedOfficeName,
    normalizeOfficeNameKey,
    validateOfficeName,
    normalizeCooperationMode,
    normalizeNotificationPreferences,
    isNotificationEnabled,
    publicSlugBase,
    shortHash,
    buildPublicSlug,
    officeMediaObjectKey,
    isOfficeMediaPublicKey
  };
});
