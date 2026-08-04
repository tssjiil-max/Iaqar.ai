(function initOfficeSettingsCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.IAQAROfficeSettingsCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function buildOfficeSettingsCore() {
  "use strict";

  const COOPERATION_MODES = Object.freeze([
    "DISABLED",
    "APPROVAL_REQUIRED",
    "SMART_AUTOMATIC"
  ]);

  const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
    matches: true,
    contacts: true,
    cooperation: true,
    messages: true,
    appointments: true,
    system: true
  });

  // Ratios are product configuration, not external-platform pixel dimensions.
  const IDENTITY_PRESETS = Object.freeze({
    logo: Object.freeze({ ratio: 1, maxWidth: 900, quality: 0.9 }),
    display: Object.freeze({ ratio: 4 / 3, maxWidth: 1440, quality: 0.9 }),
    cover: Object.freeze({ ratio: 1.91, maxWidth: 1600, quality: 0.9 })
  });

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function normalizeOfficeNameKey(value) {
    return text(value)
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .replace(/\u0640/g, "")
      .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
      .replace(/[^\p{L}\p{N}]/gu, "");
  }

  function visibleCharacterCount(value) {
    const characters = text(value).normalize("NFKC").match(/[\p{L}\p{N}]/gu);
    return characters ? characters.length : 0;
  }

  function validateOfficeName(value) {
    const name = text(value);
    if (!name) return "اكتب اسم المكتب";
    if (visibleCharacterCount(name) < 4) return "اسم المكتب يجب أن يكون 4 أحرف ظاهرة على الأقل";
    if (visibleCharacterCount(name) > 80) return "اسم المكتب طويل جدًا";
    if (!normalizeOfficeNameKey(name)) return "اسم المكتب يجب أن يحتوي أحرفًا أو أرقامًا";
    return "";
  }

  function notificationPreferences(value) {
    const source = value && typeof value === "object" ? value : {};
    return Object.fromEntries(Object.keys(DEFAULT_NOTIFICATION_PREFERENCES).map(key => [
      key,
      typeof source[key] === "boolean" ? source[key] : DEFAULT_NOTIFICATION_PREFERENCES[key]
    ]));
  }

  function cooperationMode(value) {
    return COOPERATION_MODES.includes(value) ? value : "APPROVAL_REQUIRED";
  }

  function notificationCategory(type) {
    const key = text(type).toLowerCase();
    if (["match", "new_match"].includes(key)) return "matches";
    if (["owner", "customer", "public_intake", "contact"].includes(key)) return "contacts";
    if (key.startsWith("cooperation")) return "cooperation";
    if (["message", "reply"].includes(key)) return "messages";
    if (["appointment", "follow_up", "deal"].includes(key)) return "appointments";
    return "system";
  }

  function mediaPreset(kind) {
    return IDENTITY_PRESETS[kind] || null;
  }

  return Object.freeze({
    COOPERATION_MODES,
    DEFAULT_NOTIFICATION_PREFERENCES,
    IDENTITY_PRESETS,
    normalizeOfficeNameKey,
    visibleCharacterCount,
    validateOfficeName,
    notificationPreferences,
    notificationCategory,
    cooperationMode,
    mediaPreset
  });
});
