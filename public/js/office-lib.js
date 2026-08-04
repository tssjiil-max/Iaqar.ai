/*
 * IAQAR.AI — Office settings shared logic.
 *
 * Pure, dependency-free functions and config used by the Office Settings UI and
 * exercised directly by automated tests (tests/office-settings.test.mjs). Keeping
 * this logic here (instead of inside an IIFE) is what makes Phase 1 testable in a
 * buildless project (see docs/DECISIONS.md D-001).
 *
 * Works both in the browser (attaches window.IAQAROfficeLib) and in Node
 * (module.exports) via a small UMD wrapper.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.IAQAROfficeLib = api;
})(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this), function () {
  "use strict";

  // Configurable design setting: the office cover crop ratio (Directive §7.1,
  // DECISIONS.md D-004). Default ≈1.91:1, WhatsApp / OpenGraph friendly. Changing
  // these values changes the crop everywhere without touching the upload workflow.
  const COVER_CROP_RATIO = Object.freeze({ width: 1200, height: 630 });
  const LOGO_CROP_RATIO = Object.freeze({ width: 1, height: 1 });

  const IMAGE = Object.freeze({
    allowedTypes: Object.freeze(["image/jpeg", "image/png", "image/webp"]),
    maxBytes: 10 * 1024 * 1024
  });

  // Cooperation modes (Directive §7.7 / §19). Default requires broker approval.
  const COOPERATION_MODES = Object.freeze(["disabled", "approval_required", "smart_automatic"]);
  const DEFAULT_COOPERATION_MODE = "approval_required";
  const COOPERATION_MODE_LABELS = Object.freeze({
    disabled: "إيقاف التعاون",
    approval_required: "يتطلب موافقة الوسيط لكل طلب",
    smart_automatic: "تعاون ذكي تلقائي وفق القواعد المعتمدة"
  });

  // Approved notification categories (Directive §7.5 / §17). All default on.
  const NOTIFICATION_CATEGORIES = Object.freeze([
    { key: "match", label: "إشعارات المطابقات" },
    { key: "ownerCustomer", label: "إشعارات الملاك والعملاء" },
    { key: "cooperation", label: "إشعارات التعاون" },
    { key: "messages", label: "إشعارات الرسائل" },
    { key: "appointments", label: "إشعارات المواعيد والمتابعات" },
    { key: "system", label: "إشعارات النظام المهمة" }
  ]);

  function safeText(value, fallback = "") {
    return String(value == null ? fallback : value).trim();
  }

  function significantCharacterCount(value) {
    const matches = safeText(value).match(/[A-Za-z0-9\u0600-\u06FF]/g);
    return matches ? matches.length : 0;
  }

  function allowedOfficeName(value) {
    const name = safeText(value);
    if (!name) return false;
    return /^[A-Za-z0-9\u0600-\u06FF\s._-]+$/.test(name);
  }

  // Normalized, stable key used to guarantee system-wide uniqueness.
  function normalizeOfficeNameKey(value) {
    return safeText(value)
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/[\s._-]+/g, "")
      .replace(/[^A-Za-z0-9\u0600-\u06FF]/g, "");
  }

  // Returns "" when valid, otherwise an Arabic error message.
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

  function normalizeCooperationMode(value) {
    const mode = safeText(value);
    return COOPERATION_MODES.includes(mode) ? mode : DEFAULT_COOPERATION_MODE;
  }

  function defaultNotificationPrefs() {
    const prefs = {};
    NOTIFICATION_CATEGORIES.forEach(category => { prefs[category.key] = true; });
    return prefs;
  }

  // Coerce a stored/partial prefs object to the full, boolean-valued shape.
  function normalizeNotificationPrefs(value) {
    const source = value && typeof value === "object" ? value : {};
    const prefs = {};
    NOTIFICATION_CATEGORIES.forEach(category => {
      prefs[category.key] = source[category.key] === undefined ? true : source[category.key] === true;
    });
    return prefs;
  }

  // { ok, message } — validates an uploaded image against type + size limits.
  function validateImageFile(file) {
    if (!file) return { ok: false, message: "لم يتم اختيار ملف" };
    if (!IMAGE.allowedTypes.includes(file.type)) {
      return { ok: false, message: "اختر صورة JPG أو PNG أو WebP" };
    }
    if (Number(file.size) > IMAGE.maxBytes) {
      return { ok: false, message: "حجم الصورة يتجاوز 10 ميجابايت" };
    }
    return { ok: true, message: "" };
  }

  // Compute the source rectangle to crop from an image so that the result matches
  // the target aspect ratio. `position` (0..1) shifts the crop window along the
  // longer axis (default 0.5 = centered), giving a simple, honest reposition crop.
  function cropRectForRatio(naturalWidth, naturalHeight, ratioWidth, ratioHeight, position = 0.5) {
    const nw = Math.max(1, Number(naturalWidth) || 1);
    const nh = Math.max(1, Number(naturalHeight) || 1);
    const targetRatio = (Number(ratioWidth) || 1) / (Number(ratioHeight) || 1);
    const sourceRatio = nw / nh;
    const pos = Math.min(1, Math.max(0, Number(position)));
    let sw = nw;
    let sh = nh;
    let sx = 0;
    let sy = 0;
    if (sourceRatio > targetRatio) {
      // Source is wider than target → crop the width, slide horizontally.
      sw = nh * targetRatio;
      sx = (nw - sw) * pos;
    } else {
      // Source is taller than target → crop the height, slide vertically.
      sh = nw / targetRatio;
      sy = (nh - sh) * pos;
    }
    return {
      sx: Math.round(sx),
      sy: Math.round(sy),
      sw: Math.round(sw),
      sh: Math.round(sh)
    };
  }

  return {
    COVER_CROP_RATIO,
    LOGO_CROP_RATIO,
    IMAGE,
    COOPERATION_MODES,
    DEFAULT_COOPERATION_MODE,
    COOPERATION_MODE_LABELS,
    NOTIFICATION_CATEGORIES,
    safeText,
    significantCharacterCount,
    allowedOfficeName,
    normalizeOfficeNameKey,
    validateOfficeName,
    normalizeCooperationMode,
    defaultNotificationPrefs,
    normalizeNotificationPrefs,
    validateImageFile,
    cropRectForRatio
  };
});
