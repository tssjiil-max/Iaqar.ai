import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const utilsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "js", "office-utils.js");
const utils = require(utilsPath);

test("office name rejects blank and whitespace-only values", () => {
  assert.equal(utils.validateOfficeName(""), utils.OFFICE_NAME_ERRORS.REQUIRED);
  assert.equal(utils.validateOfficeName("   "), utils.OFFICE_NAME_ERRORS.REQUIRED);
  assert.equal(utils.validateOfficeName(null), utils.OFFICE_NAME_ERRORS.REQUIRED);
});

test("office name shorter than 4 significant characters is rejected for brokers", () => {
  assert.equal(utils.validateOfficeName("أبو"), utils.OFFICE_NAME_ERRORS.TOO_SHORT);
  assert.equal(utils.validateOfficeName("ab1"), utils.OFFICE_NAME_ERRORS.TOO_SHORT);
  assert.equal(utils.validateOfficeName("م ك ت"), utils.OFFICE_NAME_ERRORS.TOO_SHORT);
  assert.equal(utils.validateOfficeName("ع-1_2"), utils.OFFICE_NAME_ERRORS.TOO_SHORT);
});

test("office name of 4 or more significant characters passes", () => {
  assert.equal(utils.validateOfficeName("مكتب المسار"), "");
  assert.equal(utils.validateOfficeName("Almasar"), "");
  assert.equal(utils.validateOfficeName("مكتب 1234 للعقارات"), "");
});

test("platform admin may use reserved short names", () => {
  assert.equal(utils.validateOfficeName("أبو", { isPlatformAdmin: true }), "");
  assert.equal(utils.validateOfficeName("ab", { isPlatformAdmin: true }), "");
});

test("office name rejects unsupported characters and overly long names", () => {
  assert.equal(utils.validateOfficeName("مكتب <script>"), utils.OFFICE_NAME_ERRORS.INVALID_CHARS);
  assert.equal(utils.validateOfficeName("office @home"), utils.OFFICE_NAME_ERRORS.INVALID_CHARS);
  assert.equal(utils.validateOfficeName("أ".repeat(81)), utils.OFFICE_NAME_ERRORS.TOO_LONG);
});

test("normalized office name key prevents equivalent duplicates", () => {
  const first = utils.normalizeOfficeNameKey("مكتب المسار");
  const variants = [
    "مكتب   المسار",
    "مكتب_المسار",
    "مكتب-المسار",
    "مكتب.المسار",
    "  مكتب المسار  "
  ];
  variants.forEach(value => assert.equal(utils.normalizeOfficeNameKey(value), first));
  assert.equal(utils.normalizeOfficeNameKey("Al Masar"), utils.normalizeOfficeNameKey("almasar"));
  assert.equal(utils.normalizeOfficeNameKey("ALMASAR"), utils.normalizeOfficeNameKey("almasar"));
  assert.notEqual(utils.normalizeOfficeNameKey("مكتب المسار"), utils.normalizeOfficeNameKey("مكتب النخبة"));
});

test("normalized key keeps Arabic and Latin letters and drops separators", () => {
  assert.equal(utils.normalizeOfficeNameKey("مكتب-النخبة 2026"), "مكتبالنخبة2026");
  assert.equal(utils.normalizeOfficeNameKey("Al-Masar_Office"), "almasaroffice");
});

test("public slug is stable per office and safe for URLs", () => {
  const slugA = utils.buildPublicSlug("مكتب المسار", "office-1");
  const slugB = utils.buildPublicSlug("مكتب المسار", "office-2");
  assert.match(slugA, /^maktab-[a-z0-9]+$/);
  assert.notEqual(slugA, slugB);
  assert.equal(utils.buildPublicSlug("Almasar Real Estate", "office-1"), `almasar-real-estate-${utils.shortHash("office-1")}`);
  const sanitized = utils.sanitizePublicSlug("  AL__Masar--Office!! ");
  assert.equal(sanitized, "al-masar-office");
});

test("office link uses the /o/{slug} form", () => {
  assert.equal(utils.officeLinkForSlug("https://iaqar.ai", "almasar-abc123"), "https://iaqar.ai/o/almasar-abc123");
});

test("notification prefs default to all enabled and sanitize unknown values", () => {
  const defaults = utils.defaultNotificationPrefs();
  assert.deepEqual(Object.keys(defaults).sort(), [...utils.NOTIFICATION_PREF_KEYS].sort());
  Object.values(defaults).forEach(value => assert.equal(value, true));

  const sanitized = utils.sanitizeNotificationPrefs({ matches: false, unknown: true, contacts: "yes" });
  assert.equal(sanitized.matches, false);
  assert.equal(sanitized.contacts, true);
  assert.equal("unknown" in sanitized, false);
  assert.equal(sanitized.cooperation, true);

  assert.deepEqual(utils.sanitizeNotificationPrefs(null), defaults);
});

test("cooperation mode defaults to approval_required and rejects unknown modes", () => {
  assert.equal(utils.DEFAULT_COOPERATION_MODE, "approval_required");
  assert.equal(utils.sanitizeCooperationMode("approval_required"), "approval_required");
  assert.equal(utils.sanitizeCooperationMode("smart_automatic"), "smart_automatic");
  assert.equal(utils.sanitizeCooperationMode("disabled"), "disabled");
  assert.equal(utils.sanitizeCooperationMode("everything"), "approval_required");
  assert.equal(utils.sanitizeCooperationMode(undefined), "approval_required");
});

test("cooperation visible statuses use only the approved labels", () => {
  assert.equal(utils.cooperationStatusLabel("not_shared"), "لم تُشارك");
  assert.equal(utils.cooperationStatusLabel("pending"), "بانتظار الموافقة");
  assert.equal(utils.cooperationStatusLabel("active"), "تعاون نشط");
  assert.equal(utils.cooperationStatusLabel("rejected"), "رُفض الطلب");
  assert.equal(utils.cooperationStatusLabel("ended"), "انتهى التعاون");
  assert.equal(utils.cooperationStatusLabel("unknown"), "لم تُشارك");
});

test("cover crop ratio is a configurable design setting with a whatsapp-style wide default", () => {
  const design = utils.OFFICE_DESIGN;
  assert.equal(design.coverCrop.defaultPreset, "whatsappWide");
  const preset = utils.resolveCoverCropPreset("");
  assert.equal(preset.key, "whatsappWide");
  assert.ok(preset.ratio > 1.5 && preset.ratio < 2.2);
  assert.equal(utils.resolveCoverCropPreset("wide169").ratio, 16 / 9);
  assert.equal(utils.resolveCoverCropPreset("original").ratio, null);
  assert.equal(design.logoCrop.ratio, 1);
});

test("centered crop rect keeps the requested ratio inside the source", () => {
  const landscape = utils.centeredCropRect(1200, 800, 1.91);
  assert.ok(Math.abs(landscape.width / landscape.height - 1.91) < 0.01);
  assert.ok(landscape.x >= 0 && landscape.y >= 0);

  const portrait = utils.centeredCropRect(600, 1200, 1.91);
  assert.equal(portrait.width, 600);
  assert.ok(portrait.height <= 1200);
  assert.ok(Math.abs(portrait.width / portrait.height - 1.91) < 0.01);

  const original = utils.centeredCropRect(500, 400, null);
  assert.deepEqual(original, { x: 0, y: 0, width: 500, height: 400 });
});

test("office image validation enforces type and size", () => {
  assert.equal(utils.validateOfficeImage({ type: "image/png", size: 1024 }), "");
  assert.equal(utils.validateOfficeImage({ type: "image/jpeg", size: 1024 }), "");
  assert.equal(utils.validateOfficeImage({ type: "image/webp", size: 1024 }), "");
  assert.equal(utils.validateOfficeImage({ type: "image/gif", size: 1024 }), utils.OFFICE_IMAGE_RULES.typeError);
  assert.equal(utils.validateOfficeImage({ type: "application/pdf", size: 1024 }), utils.OFFICE_IMAGE_RULES.typeError);
  assert.equal(
    utils.validateOfficeImage({ type: "image/png", size: utils.OFFICE_IMAGE_RULES.maxBytes + 1 }),
    utils.OFFICE_IMAGE_RULES.sizeError
  );
  assert.equal(utils.validateOfficeImage(null), utils.OFFICE_IMAGE_RULES.typeError);
});

test("bank items expose only the approved summary fields", () => {
  const item = utils.bankItemFromRecord("owner", "rec-1", {
    propertyType: "فيلا",
    city: "المدينة المنورة",
    district: "العزيزية",
    price: 1200000,
    contactName: "سالم المالك",
    createdAt: "2026-08-01T10:00:00Z"
  });
  assert.equal(item.kindLabel, "عرض مالك");
  assert.equal(item.propertyType, "فيلا");
  assert.equal(item.district, "العزيزية");
  assert.equal(item.cooperationStatus, "not_shared");
  assert.equal(utils.cooperationStatusLabel(item.cooperationStatus), "لم تُشارك");
  assert.ok(item.priceLabel.includes("ريال"));
  assert.equal("confidence" in item, false);
  assert.equal("score" in item, false);

  const request = utils.bankItemFromRecord("client", "rec-2", {
    propertyType: "شقة",
    priceMin: 600000,
    priceMax: 700000
  });
  assert.equal(request.kindLabel, "طلب عميل");
  assert.ok(request.priceLabel.includes("–"));
});
