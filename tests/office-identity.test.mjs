import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const identity = require("../public/js/office-identity.js");

/* ------------------------------------------------------------- اسم المكتب */

test("office name shorter than four significant characters is rejected", () => {
  assert.match(identity.validateOfficeName("مكت"), /4 أحرف/);
  assert.match(identity.validateOfficeName("abc"), /4 أحرف/);
  assert.match(identity.validateOfficeName("م ك ت"), /4 أحرف/);
});

test("blank or whitespace-only office names are rejected", () => {
  assert.equal(identity.validateOfficeName(""), "اكتب اسم المكتب");
  assert.equal(identity.validateOfficeName("     "), "اكتب اسم المكتب");
  assert.equal(identity.validateOfficeName(null), "اكتب اسم المكتب");
});

test("valid Arabic and Latin office names of four characters or more are accepted", () => {
  assert.equal(identity.validateOfficeName("مكتب"), "");
  assert.equal(identity.validateOfficeName("مكتب المسار العقاري"), "");
  assert.equal(identity.validateOfficeName("Al Masar Real Estate"), "");
  assert.equal(identity.validateOfficeName("  مكتب المسار  "), "");
});

test("platform administrators may use reserved short names", () => {
  assert.match(identity.validateOfficeName("مكت"), /4 أحرف/);
  assert.equal(identity.validateOfficeName("مكت", { allowShortName: true }), "");
});

test("office names with unsupported characters are rejected", () => {
  assert.match(identity.validateOfficeName("مكتب <script>"), /العربية أو الإنجليزية/);
  assert.match(identity.validateOfficeName("office@name"), /العربية أو الإنجليزية/);
});

test("names longer than the maximum are rejected", () => {
  assert.match(identity.validateOfficeName("م".repeat(81)), /طويل/);
});

/* --------------------------------------------------- مفتاح التطابق الموحّد */

test("normalization ignores spaces, separators and letter case", () => {
  assert.equal(identity.normalizeOfficeNameKey("  مكتب  المسار "), identity.normalizeOfficeNameKey("مكتب-المسار"));
  assert.equal(identity.normalizeOfficeNameKey("Al Masar"), identity.normalizeOfficeNameKey("al.masar"));
});

test("normalization folds equivalent Arabic letter forms and diacritics", () => {
  assert.ok(identity.officeNamesAreEquivalent("مكتب الأمانة", "مكتب الامانه"));
  assert.ok(identity.officeNamesAreEquivalent("مَكتَب المسار", "مكتب المسار"));
  assert.ok(identity.officeNamesAreEquivalent("مكتب المُنتهى", "مكتب المنتهي"));
});

test("distinct office names stay distinct after normalization", () => {
  assert.equal(identity.officeNamesAreEquivalent("مكتب المسار", "مكتب النخبة"), false);
  assert.equal(identity.normalizeOfficeNameKey("مكتب المسار"), "مكتبالمسار");
});

test("normalized keys of valid names are at least four characters", () => {
  assert.ok(identity.normalizeOfficeNameKey("مكتب").length >= 4);
  assert.ok(identity.normalizeOfficeNameKey("Al Masar").length >= 4);
});

/* ---------------------------------------------------------- الرابط والجوال */

test("public slug is stable, url-safe and office scoped", () => {
  const first = identity.buildPublicSlug("مكتب المسار", "office-alqiq");
  const second = identity.buildPublicSlug("مكتب المسار", "office-alqiq");
  assert.equal(first, second);
  assert.match(first, /^[a-z0-9-]+$/);
  assert.notEqual(first, identity.buildPublicSlug("مكتب المسار", "office-other"));
});

test("latin office names keep a readable slug base", () => {
  assert.match(identity.buildPublicSlug("Al Masar", "office-1"), /^al-masar-/);
});

test("Saudi mobile numbers are normalized to one canonical local form", () => {
  assert.equal(identity.normalizeSaudiMobile("0551234567"), "0551234567");
  assert.equal(identity.normalizeSaudiMobile("+966 55 123 4567"), "0551234567");
  assert.equal(identity.normalizeSaudiMobile("00966551234567"), "0551234567");
  assert.equal(identity.normalizeSaudiMobile("551234567"), "0551234567");
  assert.equal(identity.normalizeSaudiMobile("12345"), "");
});

test("mobile validation is optional unless required", () => {
  assert.equal(identity.validateMobile(""), "");
  assert.match(identity.validateMobile("", { required: true }), /رقم الجوال/);
  assert.match(identity.validateMobile("123"), /05/);
  assert.equal(identity.validateMobile("0551234567"), "");
});

/* ------------------------------------------------------------ صور المكتب */

test("image presets expose configurable crop ratios for the three office images", () => {
  assert.deepEqual(Object.keys(identity.IMAGE_PRESETS).sort(), ["display", "logo", "share"]);
  assert.equal(identity.IMAGE_PRESETS.logo.aspectRatio, 1);
  assert.equal(identity.IMAGE_PRESETS.share.aspectRatio, 1.91);
  assert.ok(identity.IMAGE_PRESETS.share.aspectRatio > identity.IMAGE_PRESETS.display.aspectRatio);
});

test("image validation enforces type and size before any upload", () => {
  assert.equal(identity.validateImageFile({ type: "image/png", size: 1024 }, "logo"), "");
  assert.match(identity.validateImageFile({ type: "image/gif", size: 1024 }, "logo"), /JPG أو PNG أو WebP/);
  assert.match(identity.validateImageFile({ type: "image/png", size: 9 * 1024 * 1024 }, "logo"), /ميجابايت/);
  assert.equal(identity.validateImageFile({ type: "image/png", size: 9 * 1024 * 1024 }, "share"), "");
  assert.match(identity.validateImageFile(null, "logo"), /اختر صورة/);
});

test("crop rectangle keeps the requested ratio and never leaves the source image", () => {
  const wide = identity.computeCropRect({ sourceWidth: 2000, sourceHeight: 1000, aspectRatio: 1 });
  assert.equal(wide.sWidth, 1000);
  assert.equal(wide.sHeight, 1000);
  assert.equal(wide.sy, 0);
  assert.equal(wide.sx, 500);

  const tall = identity.computeCropRect({ sourceWidth: 1000, sourceHeight: 2000, aspectRatio: 1.91 });
  assert.equal(tall.sWidth, 1000);
  assert.equal(tall.sHeight, Math.round(1000 / 1.91));
  assert.equal(tall.sx, 0);
});

test("crop focus moves the window but stays inside bounds", () => {
  const left = identity.computeCropRect({ sourceWidth: 2000, sourceHeight: 1000, aspectRatio: 1, focusX: 0 });
  const right = identity.computeCropRect({ sourceWidth: 2000, sourceHeight: 1000, aspectRatio: 1, focusX: 1 });
  assert.equal(left.sx, 0);
  assert.equal(right.sx, 1000);
  const clamped = identity.computeCropRect({ sourceWidth: 800, sourceHeight: 600, aspectRatio: 4 / 3, focusY: 9 });
  assert.ok(clamped.sy >= 0);
  assert.ok(clamped.sy + clamped.sHeight <= 600);
});

test("output size follows the preset ratio", () => {
  const share = identity.outputSize("share");
  assert.equal(share.width, 1200);
  assert.equal(share.height, Math.round(1200 / 1.91));
  assert.deepEqual(identity.outputSize("logo"), { width: 512, height: 512 });
});

/* ------------------------------------------------- الإشعارات ووضع التعاون */

test("the six approved notification categories exist and default to enabled", () => {
  assert.deepEqual(identity.NOTIFICATION_KEYS, [
    "matches", "ownerCustomer", "cooperation", "messages", "appointments", "system"
  ]);
  assert.deepEqual(identity.defaultNotificationPreferences(), {
    matches: true, ownerCustomer: true, cooperation: true,
    messages: true, appointments: true, system: true
  });
});

test("notification preferences ignore unknown keys and keep booleans", () => {
  const sanitized = identity.sanitizeNotificationPreferences({ matches: false, hacked: true, system: 0 });
  assert.equal(sanitized.matches, false);
  assert.equal(sanitized.system, false);
  assert.equal(sanitized.cooperation, true);
  assert.equal("hacked" in sanitized, false);
});

test("broker preference overrides the office preference, office overrides the default", () => {
  assert.equal(identity.resolveNotificationPreference("matches", {
    brokerPreferences: { matches: false },
    officePreferences: { matches: true }
  }), false);
  assert.equal(identity.resolveNotificationPreference("matches", {
    officePreferences: { matches: false }
  }), false);
  assert.equal(identity.resolveNotificationPreference("matches", {}), true);
  assert.equal(identity.resolveNotificationPreference("unknown_category", {}), false);
});

test("cooperation defaults to approval required and rejects unknown modes", () => {
  assert.equal(identity.DEFAULT_COOPERATION_MODE, "approval_required");
  assert.equal(identity.sanitizeCooperationMode(""), "approval_required");
  assert.equal(identity.sanitizeCooperationMode("open_to_everyone"), "approval_required");
  assert.equal(identity.sanitizeCooperationMode("smart_automatic"), "smart_automatic");
  assert.equal(identity.sanitizeCooperationMode("disabled"), "disabled");
  assert.deepEqual(identity.COOPERATION_MODE_KEYS, ["disabled", "approval_required", "smart_automatic"]);
});

test("approved Arabic cooperation statuses are available for later phases", () => {
  assert.deepEqual(Object.values(identity.COOPERATION_STATUS_LABELS), [
    "لم تُشارك", "بانتظار الموافقة", "تعاون نشط", "رُفض الطلب", "انتهى التعاون"
  ]);
});

test("broker settings document ids are namespaced by uid", () => {
  assert.equal(identity.brokerSettingsDocId("uid-1"), "broker-uid-1");
  assert.equal(identity.brokerSettingsDocId(""), "");
});

test("specialties summary only accepts approved services", () => {
  assert.equal(identity.specialtiesSummary(["sale", "rent", "hacking"]), "بيع • تأجير");
  assert.deepEqual(identity.normalizeSpecialties(["sale", "sale"]), ["sale"]);
});
