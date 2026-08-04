(() => {
  "use strict";

  const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
  const ARABIC_DIGITS = Object.freeze({
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9"
  });

  const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
    matches: true,
    participants: true,
    cooperation: true,
    messages: true,
    appointments: true,
    system: true
  });

  const COOPERATION_MODES = Object.freeze([
    "DISABLED",
    "APPROVAL_REQUIRED",
    "SMART_AUTOMATIC"
  ]);

  const DEFAULT_MEDIA_DESIGN = Object.freeze({
    logo: Object.freeze({ aspectRatio: 1, outputWidth: 640 }),
    displayImage: Object.freeze({ aspectRatio: 16 / 9, outputWidth: 1280 }),
    whatsappCover: Object.freeze({ aspectRatio: 16 / 9, outputWidth: 1600 })
  });

  function safeText(value) {
    return String(value == null ? "" : value)
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeDigits(value) {
    return String(value || "").replace(/[٠-٩۰-۹]/g, character => ARABIC_DIGITS[character] || character);
  }

  function normalizeOfficeNameKey(value) {
    return normalizeDigits(safeText(value))
      .toLocaleLowerCase("en-US")
      .replace(ARABIC_DIACRITICS, "")
      .replace(/\u0640/g, "")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/[\s._-]+/g, "")
      .replace(/[^a-z0-9\u0600-\u06FF]/g, "");
  }

  function visibleCharacterCount(value) {
    const matches = safeText(value).match(/[A-Za-z0-9\u0600-\u06FF]/g);
    return matches ? matches.length : 0;
  }

  function validateOfficeName(value, options = {}) {
    const name = safeText(value);
    const allowReservedShortName = options.allowReservedShortName === true;
    if (!name) return { valid: false, name, key: "", message: "اكتب اسم المكتب" };
    if (!/^[A-Za-z0-9\u0600-\u06FF\s._-]+$/.test(name)) {
      return {
        valid: false,
        name,
        key: "",
        message: "اسم المكتب يقبل العربية أو الإنجليزية والأرقام والمسافات فقط"
      };
    }
    const length = visibleCharacterCount(name);
    if (!allowReservedShortName && length < 4) {
      return {
        valid: false,
        name,
        key: normalizeOfficeNameKey(name),
        message: "اسم المكتب يجب أن يتكون من 4 أحرف ظاهرة على الأقل"
      };
    }
    if (length > 80) {
      return { valid: false, name, key: normalizeOfficeNameKey(name), message: "اسم المكتب طويل جدًا" };
    }
    const key = normalizeOfficeNameKey(name);
    if (!allowReservedShortName && key.length < 4) {
      return { valid: false, name, key, message: "اسم المكتب يجب أن يتكون من 4 أحرف ظاهرة على الأقل" };
    }
    return { valid: true, name, key, message: "" };
  }

  function normalizeNotificationPreferences(value) {
    const input = value && typeof value === "object" ? value : {};
    return Object.fromEntries(
      Object.keys(DEFAULT_NOTIFICATION_PREFERENCES).map(key => [
        key,
        typeof input[key] === "boolean" ? input[key] : DEFAULT_NOTIFICATION_PREFERENCES[key]
      ])
    );
  }

  function normalizeCooperationMode(value) {
    return COOPERATION_MODES.includes(value) ? value : "APPROVAL_REQUIRED";
  }

  function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function mediaDesignConfig(overrides = {}) {
    const configured = overrides && typeof overrides === "object" ? overrides : {};
    return Object.fromEntries(Object.entries(DEFAULT_MEDIA_DESIGN).map(([asset, defaults]) => {
      const value = configured[asset] && typeof configured[asset] === "object" ? configured[asset] : {};
      return [asset, Object.freeze({
        aspectRatio: positiveNumber(value.aspectRatio, defaults.aspectRatio),
        outputWidth: Math.round(positiveNumber(value.outputWidth, defaults.outputWidth))
      })];
    }));
  }

  function validateImageFile(file, maxBytes = 10 * 1024 * 1024) {
    if (!file) return { valid: false, message: "اختر صورة أولًا" };
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return { valid: false, message: "اختر صورة JPG أو PNG أو WebP" };
    }
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maxBytes) {
      return { valid: false, message: "حجم الصورة يجب ألا يتجاوز 10 ميجابايت" };
    }
    return { valid: true, message: "" };
  }

  function calculateCropRect(imageWidth, imageHeight, aspectRatio, zoom = 1, focusX = 50, focusY = 50) {
    const width = positiveNumber(imageWidth, 1);
    const height = positiveNumber(imageHeight, 1);
    const ratio = positiveNumber(aspectRatio, 1);
    const safeZoom = Math.min(3, Math.max(1, positiveNumber(zoom, 1)));
    let cropWidth = width;
    let cropHeight = width / ratio;
    if (cropHeight > height) {
      cropHeight = height;
      cropWidth = height * ratio;
    }
    cropWidth /= safeZoom;
    cropHeight /= safeZoom;
    const normalizedX = Math.min(100, Math.max(0, Number(focusX) || 0)) / 100;
    const normalizedY = Math.min(100, Math.max(0, Number(focusY) || 0)) / 100;
    return {
      x: (width - cropWidth) * normalizedX,
      y: (height - cropHeight) * normalizedY,
      width: cropWidth,
      height: cropHeight
    };
  }

  const api = Object.freeze({
    COOPERATION_MODES,
    DEFAULT_MEDIA_DESIGN,
    DEFAULT_NOTIFICATION_PREFERENCES,
    calculateCropRect,
    mediaDesignConfig,
    normalizeCooperationMode,
    normalizeDigits,
    normalizeNotificationPreferences,
    normalizeOfficeNameKey,
    safeText,
    validateImageFile,
    validateOfficeName,
    visibleCharacterCount
  });

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.IAQAROfficeProfileCore = api;
})();
