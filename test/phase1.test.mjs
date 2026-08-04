import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const core = require("../public/js/office-profile-core.js");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const settingsSource = await readFile(new URL("../public/js/office-settings.js", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));

test("office names require at least four visible characters", () => {
  assert.equal(core.validateOfficeName("دار").valid, false);
  assert.equal(core.validateOfficeName("  دار العقار  ").valid, true);
  assert.equal(core.validateOfficeName("   ").valid, false);
});

test("equivalent Arabic and Latin office names normalize to stable unique keys", () => {
  assert.equal(core.normalizeOfficeNameKey("  مَـسَار العقار "), "مسارالعقار");
  assert.equal(core.normalizeOfficeNameKey("مــسار_العقار"), "مسارالعقار");
  assert.equal(core.normalizeOfficeNameKey("Alpha Office"), core.normalizeOfficeNameKey("alpha-office"));
  assert.equal(core.normalizeOfficeNameKey("مكتب ١٢٣"), "مكتب123");
});

test("crop calculation preserves the configured ratio and remains in bounds", () => {
  const crop = core.calculateCropRect(2000, 1000, 1, 2, 100, 0);
  assert.equal(crop.width, crop.height);
  assert.ok(crop.x >= 0 && crop.x + crop.width <= 2000);
  assert.ok(crop.y >= 0 && crop.y + crop.height <= 1000);
});

test("notification and cooperation defaults are explicit and safe", () => {
  assert.deepEqual(core.normalizeNotificationPreferences({ matches: false }), {
    matches: false,
    participants: true,
    cooperation: true,
    messages: true,
    appointments: true,
    system: true
  });
  assert.equal(core.normalizeCooperationMode("UNKNOWN"), "APPROVAL_REQUIRED");
});

test("logo and cover are the only visible settings entry targets on the office card", () => {
  assert.match(html, /id="officeSettingsBtn"/);
  assert.match(html, /id="officeCoverSettingsBtn"/);
  assert.doesNotMatch(html, /<span>إعدادات المكتب<\/span>/);
});

test("settings expose only the approved office data fields", () => {
  for (const id of [
    "officeNameInput",
    "brokerNameInput",
    "licenseNumberInput",
    "officeCityInput",
    "officePhoneInput"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /id="officeWhatsappInput"/);
  assert.doesNotMatch(html, /type="email"/);
  assert.doesNotMatch(html, /name="officeSpecialty"/);
});

test("Phase 1 settings include identity, link, notification, bank and cooperation controls", () => {
  for (const id of [
    "officeLogoInput",
    "officeDisplayImageInput",
    "officeWhatsappCoverInput",
    "copyOfficeLinkBtn",
    "shareOfficeLinkBtn",
    "showOfficeQrBtn",
    "previewOfficeLinkBtn",
    "opportunityBankEntry"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /value="APPROVAL_REQUIRED" checked/);
  assert.equal((html.match(/data-notification-preference=/g) || []).length, 6);
});

test("home and PWA have no Deals page or Deals navigation", () => {
  assert.doesNotMatch(html, /data-main="deals"/);
  assert.doesNotMatch(html, />الصفقات</);
  assert.equal(JSON.stringify(manifest).includes("deals"), false);
  assert.equal(JSON.stringify(manifest).includes("الصفقات"), false);
});

test("production workspace starts empty instead of rendering demo operations", () => {
  assert.match(html, /let data = \[\];/);
  assert.match(html, /لا توجد إجراءات تحتاج انتباهك الآن/);
  assert.doesNotMatch(html, /id:"A1"/);
});

test("profile persistence uses an office-scoped transaction and audit record", () => {
  assert.match(settingsSource, /runTransaction/);
  assert.match(settingsSource, /officeNameClaims/);
  assert.match(settingsSource, /collection\("auditLogs"\)/);
  assert.match(settingsSource, /officeId:\s*officeId\(\)/);
});
