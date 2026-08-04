import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const core = require("../js/office-profile-core.js");

test("office name shorter than 4 significant characters is rejected", () => {
  assert.equal(core.validateOfficeName("أب"), "اسم المكتب يجب أن يكون 4 أحرف على الأقل؛ الأسماء الأقصر محجوزة لإدارة المنصة");
  assert.equal(core.validateOfficeName("   "), "اكتب اسم المكتب");
  assert.equal(core.significantCharacterCount("أ ب ج د"), 4);
});

test("normalized duplicate office names collide", () => {
  assert.equal(core.normalizeOfficeNameKey("مكتب  المسار"), core.normalizeOfficeNameKey("مكتب المسار"));
  assert.equal(core.normalizeOfficeNameKey("Al-Masar Office"), core.normalizeOfficeNameKey("al masar office"));
  assert.equal(core.namesAreEquivalent("مكتب المسار", "مكتب   المسار"), true);
  assert.equal(core.namesAreEquivalent("مكتب المسار", "مكتب آخر"), false);
});

test("unique valid office name is accepted", () => {
  assert.equal(core.validateOfficeName("مكتب المسار"), "");
  assert.equal(core.validateOfficeName("AlMasar Realty"), "");
});

test("cooperation mode defaults to approval required", () => {
  assert.equal(core.normalizeCooperationMode(""), "APPROVAL_REQUIRED");
  assert.equal(core.normalizeCooperationMode("disabled"), "DISABLED");
  assert.equal(core.normalizeCooperationMode("SMART_AUTOMATIC"), "SMART_AUTOMATIC");
  assert.equal(core.DEFAULT_COOPERATION_MODE, "APPROVAL_REQUIRED");
});

test("notification preferences normalize with defaults", () => {
  const prefs = core.normalizeNotificationPreferences({ match: false });
  assert.equal(prefs.match, false);
  assert.equal(prefs.cooperation, true);
  assert.equal(prefs.importantSystem, true);
});

test("cover crop presets are configurable design settings", () => {
  assert.ok(core.COVER_CROP_PRESETS.whatsappWide.aspectRatio > 1);
  assert.equal(core.getCoverCropPreset("whatsappWide").id, "whatsappWide");
  assert.equal(core.getCoverCropPreset("missing").id, "display");
});

test("clean office profile mirrors mobile into whatsapp and omits inventing email", () => {
  const cleaned = core.cleanOfficeProfile({
    officeName: "مكتب المسار",
    brokerName: "أحمد",
    phone: "0551234567",
    licenseNumber: "1234567",
    city: "المدينة المنورة",
    specialties: ["sale", "sale", "hack"],
    cooperationMode: "DISABLED"
  }, {});
  assert.equal(cleaned.whatsapp, "0551234567");
  assert.equal(cleaned.officeNameKey, core.normalizeOfficeNameKey("مكتب المسار"));
  assert.deepEqual(cleaned.specialties, ["sale"]);
  assert.equal(cleaned.cooperationMode, "DISABLED");
  assert.equal("email" in cleaned, false);
});

test("image validation rejects unsupported types and oversized files", () => {
  assert.match(core.validateImageFile({ type: "application/pdf", size: 10 }), /JPG/);
  assert.match(core.validateImageFile({ type: "image/png", size: 11 * 1024 * 1024 }), /10/);
  assert.equal(core.validateImageFile({ type: "image/webp", size: 1000 }), "");
});
