import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOfficeNameKey,
  significantOfficeNameChars,
  OFFICE_MEDIA_KINDS
} from "../src/index.js";
import {
  validateOfficeName,
  normalizeOfficeNameKey as sharedNormalizeOfficeNameKey,
  normalizeCooperationMode,
  DEFAULT_COOPERATION_MODE,
  COOPERATION_MODES,
  normalizeNotificationPreferences,
  defaultNotificationPreferences,
  cropRectForAspect,
  OFFICE_COVER_DESIGN,
  isValidImageFileMeta,
  buildPublicSlug
} from "../../shared/office-profile.mjs";

test("Phase1: office name shorter than 4 significant characters is rejected", () => {
  assert.equal(validateOfficeName("اب"), "اسم المكتب يجب أن يكون 4 أحرف على الأقل؛ الأسماء الأقصر محجوزة لإدارة المنصة");
  assert.equal(validateOfficeName("   "), "اكتب اسم المكتب");
  assert.equal(validateOfficeName("أ ب"), "اسم المكتب يجب أن يكون 4 أحرف على الأقل؛ الأسماء الأقصر محجوزة لإدارة المنصة");
});

test("Phase1: unique valid office names are accepted after trim", () => {
  assert.equal(validateOfficeName("  المسار العقاري  "), "");
  assert.equal(validateOfficeName("AlMasar Office"), "");
});

test("Phase1: normalized name keys collapse equivalent duplicates", () => {
  const a = sharedNormalizeOfficeNameKey("المسار العقاري");
  const b = sharedNormalizeOfficeNameKey("  المسار   العقاري ");
  const c = sharedNormalizeOfficeNameKey("المسار-العقاري");
  assert.equal(a, b);
  assert.equal(a, c);
  assert.equal(normalizeOfficeNameKey("Office Name"), sharedNormalizeOfficeNameKey("office  name"));
  assert.ok(significantOfficeNameChars("المسار") >= 4);
});

test("Phase1: cooperation mode defaults to APPROVAL_REQUIRED", () => {
  assert.equal(DEFAULT_COOPERATION_MODE, COOPERATION_MODES.APPROVAL_REQUIRED);
  assert.equal(normalizeCooperationMode(""), COOPERATION_MODES.APPROVAL_REQUIRED);
  assert.equal(normalizeCooperationMode("disabled"), COOPERATION_MODES.DISABLED);
  assert.equal(normalizeCooperationMode("SMART_AUTOMATIC"), COOPERATION_MODES.SMART_AUTOMATIC);
});

test("Phase1: notification preferences normalize to per-category booleans", () => {
  const defaults = defaultNotificationPreferences();
  assert.equal(defaults.match, true);
  const normalized = normalizeNotificationPreferences({ match: false, message: false, unknown: true });
  assert.equal(normalized.match, false);
  assert.equal(normalized.message, false);
  assert.equal(normalized.systemImportant, true);
  assert.equal("unknown" in normalized, false);
});

test("Phase1: cover crop ratio is configurable and centers the crop window", () => {
  assert.equal(OFFICE_COVER_DESIGN.whatsappCoverAspectRatio, 1.91);
  const wide = cropRectForAspect(1910, 1000, OFFICE_COVER_DESIGN.whatsappCoverAspectRatio);
  assert.equal(wide.y, 0);
  assert.equal(wide.height, 1000);
  assert.ok(wide.width <= 1910);
  const tall = cropRectForAspect(1000, 2000, 1);
  assert.equal(tall.x, 0);
  assert.equal(tall.width, 1000);
  assert.equal(tall.height, 1000);
});

test("Phase1: image meta validation enforces type and size", () => {
  assert.equal(isValidImageFileMeta({ type: "image/png", size: 1024 }), true);
  assert.equal(isValidImageFileMeta({ type: "image/gif", size: 1024 }), false);
  assert.equal(isValidImageFileMeta({ type: "image/jpeg", size: OFFICE_COVER_DESIGN.maxImageBytes + 1 }), false);
});

test("Phase1: public slug is stable handle separate from display name key", () => {
  const slug = buildPublicSlug("المسار العقاري", "office-1");
  assert.match(slug, /^[a-z0-9-]+$/);
  assert.ok(slug.includes("-"));
  assert.notEqual(slug, sharedNormalizeOfficeNameKey("المسار العقاري"));
});

test("Phase1: worker exposes logo and whatsapp-cover media kinds", () => {
  assert.equal(OFFICE_MEDIA_KINDS.logo.urlField, "logoUrl");
  assert.equal(OFFICE_MEDIA_KINDS.cover.urlField, "coverUrl");
  assert.equal(OFFICE_MEDIA_KINDS["whatsapp-cover"].urlField, "whatsappCoverUrl");
  assert.equal(OFFICE_MEDIA_KINDS.logo.key("office-alqiq"), "office-logos/office-alqiq/logo");
  assert.equal(OFFICE_MEDIA_KINDS["whatsapp-cover"].key("office-alqiq"), "office-covers/office-alqiq/whatsapp-cover");
});

test("Phase1: media upload routes exist and require auth/office headers", async () => {
  const { default: worker } = await import("../src/index.js");
  for (const path of ["/media/office-logo", "/media/office-cover", "/media/office-whatsapp-cover"]) {
    const response = await worker.fetch(new Request(`https://example.test${path}`, {
      method: "POST",
      headers: { "content-type": "image/png", "content-length": "12" },
      body: new Uint8Array(12)
    }), { FIREBASE_PROJECT_ID: "aqar-b5d76" });
    assert.notEqual(response.status, 404);
    assert.ok([400, 401, 403, 503].includes(response.status));
  }
});

test("Phase1: public HTML wires logo/cover settings entry and bank/cooperation controls", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="officeSettingsBtn"/);
  assert.match(html, /id="officeCoverSettingsBtn"/);
  assert.match(html, /بنك الفرص/);
  assert.match(html, /name="cooperationMode"/);
  assert.match(html, /data-pref="match"/);
  assert.match(html, /id="officeLinkQrCanvas"/);
  assert.match(html, /id="officeLogoInput"/);
  assert.match(html, /id="officeWhatsappCoverInput"/);
  assert.doesNotMatch(html, /id="officeWhatsappInput"/);
  assert.doesNotMatch(html, /type="email"/);
  assert.doesNotMatch(html, /bottom-nav|bottom_nav|bottomNav/);
  assert.doesNotMatch(html, /<span>إعدادات المكتب<\/span>/);
});

test("Phase1: firestore rules require officeNameClaims ownership on office writes", async () => {
  const { readFile } = await import("node:fs/promises");
  const rules = await readFile(new URL("../../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /officeNameClaimOwned/);
  assert.match(rules, /getAfter\(\/databases\/\$\(database\)\/documents\/officeNameClaims/);
  assert.match(rules, /DISABLED','APPROVAL_REQUIRED','SMART_AUTOMATIC/);
});
