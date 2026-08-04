/*
 * IAQAR.AI — Office core (Phase 1)
 * Pure, dependency-free helpers shared by the browser (window.IAQAROfficeCore)
 * and Node tests (module.exports). No DOM, no Firebase, no globals with side
 * effects. Keep this file deterministic and testable.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.IAQAROfficeCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SPECIALTY_LABELS = Object.freeze({
    sale: "بيع",
    purchase: "شراء",
    rent: "تأجير",
    property_management: "إدارة أملاك"
  });
  const SPECIALTY_KEYS = Object.freeze(Object.keys(SPECIALTY_LABELS));

  // WhatsApp/link-preview friendly wide cover. Configurable design setting:
  // change the ratio here without touching the upload workflow (Section 7.1).
  const COVER_ASPECT = Object.freeze({ width: 1.91, height: 1 });

  // Approved notification channels (Section 7.5).
  const NOTIFICATION_KEYS = Object.freeze([
    "match",
    "ownerCustomer",
    "cooperation",
    "message",
    "appointment",
    "system"
  ]);

  // Approved cooperation modes (Section 7.7 / 19). Default requires approval.
  const COOPERATION_MODES = Object.freeze(["disabled", "approval_required", "smart_automatic"]);
  const DEFAULT_COOPERATION_MODE = "approval_required";

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

  // Returns "" when valid, otherwise an Arabic validation message.
  function validateOfficeName(value, options) {
    const isPlatformAdmin = !!(options && options.isPlatformAdmin);
    const name = safeText(value);
    if (!name) return "اكتب اسم المكتب";
    if (!allowedOfficeName(name)) return "اسم المكتب يقبل العربية أو الإنجليزية والأرقام والمسافات فقط";
    if (!isPlatformAdmin && significantCharacterCount(name) < 4) {
      return "اسم المكتب يجب أن يكون 4 أحرف على الأقل؛ الأسماء الأقصر محجوزة لإدارة المنصة";
    }
    if (significantCharacterCount(name) > 80) return "اسم المكتب طويل جدًا";
    return "";
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

  function normalizedSpecialties(value) {
    const list = Array.isArray(value) ? value : [];
    return [...new Set(list.filter(item => SPECIALTY_KEYS.includes(item)))];
  }

  function defaultNotificationPreferences() {
    const prefs = {};
    NOTIFICATION_KEYS.forEach(key => { prefs[key] = true; });
    return prefs;
  }

  // Coerce arbitrary input into the six approved boolean channels. Unknown keys
  // are dropped; missing keys default to enabled.
  function normalizeNotificationPreferences(value) {
    const source = value && typeof value === "object" ? value : {};
    const prefs = {};
    NOTIFICATION_KEYS.forEach(key => {
      prefs[key] = key in source ? source[key] !== false : true;
    });
    return prefs;
  }

  function normalizeCooperationMode(value) {
    const mode = safeText(value);
    return COOPERATION_MODES.includes(mode) ? mode : DEFAULT_COOPERATION_MODE;
  }

  // Largest centered crop rectangle inside a (naturalWidth x naturalHeight)
  // image that matches the given aspect ratio (defaults to COVER_ASPECT).
  function coverCropRect(naturalWidth, naturalHeight, aspect) {
    const width = Number(naturalWidth) || 0;
    const height = Number(naturalHeight) || 0;
    const ratioSpec = aspect || COVER_ASPECT;
    const targetRatio = ratioSpec.width / ratioSpec.height;
    if (width <= 0 || height <= 0) {
      return { sx: 0, sy: 0, sWidth: 0, sHeight: 0 };
    }
    const imageRatio = width / height;
    if (imageRatio > targetRatio) {
      const sWidth = Math.round(height * targetRatio);
      return { sx: Math.round((width - sWidth) / 2), sy: 0, sWidth, sHeight: height };
    }
    const sHeight = Math.round(width / targetRatio);
    return { sx: 0, sy: Math.round((height - sHeight) / 2), sWidth: width, sHeight };
  }

  // Output canvas dimensions for a cropped cover at the configured ratio.
  function coverOutputSize(maxWidth, aspect) {
    const ratioSpec = aspect || COVER_ASPECT;
    const targetRatio = ratioSpec.width / ratioSpec.height;
    const outWidth = Math.max(1, Math.round(Number(maxWidth) || 1200));
    return { width: outWidth, height: Math.round(outWidth / targetRatio) };
  }

  const DEFAULTS = Object.freeze({
    officeName: "مكتب عقاري",
    brokerName: "وسيط عقاري",
    phone: "",
    whatsapp: "",
    licenseNumber: "",
    city: "المدينة المنورة",
    specialties: [],
    logoUrl: "",
    coverUrl: "",
    publicSlug: "",
    cooperationMode: DEFAULT_COOPERATION_MODE
  });

  function cleanProfile(data) {
    const input = data || {};
    return {
      officeName: safeText(input.officeName, DEFAULTS.officeName).slice(0, 80),
      officeNameKey: normalizeOfficeNameKey(input.officeName || DEFAULTS.officeName).slice(0, 100),
      brokerName: safeText(input.brokerName, DEFAULTS.brokerName).slice(0, 80),
      phone: safeText(input.phone).replace(/[^0-9+]/g, "").slice(0, 20),
      whatsapp: safeText(input.whatsapp || input.phone).replace(/[^0-9+]/g, "").slice(0, 20),
      licenseNumber: safeText(input.licenseNumber, DEFAULTS.licenseNumber).replace(/[^0-9]/g, "").slice(0, 20),
      city: safeText(input.city, DEFAULTS.city).slice(0, 60),
      specialties: normalizedSpecialties(input.specialties),
      logoUrl: safeText(input.logoUrl).slice(0, 2000),
      coverUrl: safeText(input.coverUrl).slice(0, 2000),
      publicSlug: safeText(input.publicSlug)
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64),
      cooperationMode: normalizeCooperationMode(input.cooperationMode),
      notificationPreferences: normalizeNotificationPreferences(input.notificationPreferences)
    };
  }

  return {
    SPECIALTY_LABELS,
    SPECIALTY_KEYS,
    COVER_ASPECT,
    NOTIFICATION_KEYS,
    COOPERATION_MODES,
    DEFAULT_COOPERATION_MODE,
    DEFAULTS,
    safeText,
    significantCharacterCount,
    allowedOfficeName,
    normalizeOfficeNameKey,
    validateOfficeName,
    publicSlugBase,
    shortHash,
    buildPublicSlug,
    normalizedSpecialties,
    defaultNotificationPreferences,
    normalizeNotificationPreferences,
    normalizeCooperationMode,
    coverCropRect,
    coverOutputSize,
    cleanProfile
  };
});
