import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../public/js/office-settings-core.js");

test("office names require at least four visible characters", () => {
  assert.match(core.validateOfficeName("  أب "), /4 أحرف/);
  assert.match(core.validateOfficeName("   "), /اكتب اسم/);
  assert.equal(core.validateOfficeName("المسار"), "");
  assert.equal(core.validateOfficeName("Home 24"), "");
});

test("equivalent Arabic and Latin office names normalize to one key", () => {
  assert.equal(core.normalizeOfficeNameKey(" الـمـسـار "), core.normalizeOfficeNameKey("المسار"));
  assert.equal(core.normalizeOfficeNameKey("مَكتبُ النُّور"), core.normalizeOfficeNameKey("مكتب النور"));
  assert.equal(core.normalizeOfficeNameKey("North.Home"), core.normalizeOfficeNameKey(" north home "));
});

test("notification defaults and explicit preferences are deterministic", () => {
  assert.deepEqual(core.notificationPreferences(), {
    matches: true,
    contacts: true,
    cooperation: true,
    messages: true,
    appointments: true,
    system: true
  });
  assert.equal(core.notificationPreferences({ matches: false }).matches, false);
  assert.equal(core.notificationPreferences({ matches: false }).contacts, true);
  assert.equal(core.notificationCategory("cooperation_request"), "cooperation");
  assert.equal(core.notificationCategory("follow_up"), "appointments");
});

test("cooperation defaults to approval and identity crop ratios are centralized", () => {
  assert.equal(core.cooperationMode("UNKNOWN"), "APPROVAL_REQUIRED");
  assert.equal(core.cooperationMode("SMART_AUTOMATIC"), "SMART_AUTOMATIC");
  assert.equal(core.mediaPreset("logo").ratio, 1);
  assert.ok(core.mediaPreset("cover").ratio > 1);
  assert.equal(core.mediaPreset("unknown"), null);
});
