import test from "node:test";
import assert from "node:assert/strict";

// office-lib.js is a UMD script (loaded as a classic <script> in the browser).
// Importing it for its side effect registers the API on globalThis.
await import("../public/js/office-lib.js");
const lib = globalThis.IAQAROfficeLib;

test("office name shorter than 4 significant characters is rejected", () => {
  assert.notEqual(lib.validateOfficeName("ابج", { isPlatformAdmin: false }), "");
  assert.notEqual(lib.validateOfficeName("abc", { isPlatformAdmin: false }), "");
  assert.notEqual(lib.validateOfficeName("   ", { isPlatformAdmin: false }), "");
  assert.notEqual(lib.validateOfficeName("", { isPlatformAdmin: false }), "");
});

test("a valid office name (Arabic or Latin) is accepted", () => {
  assert.equal(lib.validateOfficeName("مكتب المسار", { isPlatformAdmin: false }), "");
  assert.equal(lib.validateOfficeName("Al Masar", { isPlatformAdmin: false }), "");
});

test("short names are reserved for platform admins", () => {
  assert.notEqual(lib.validateOfficeName("abc", { isPlatformAdmin: false }), "");
  assert.equal(lib.validateOfficeName("abc", { isPlatformAdmin: true }), "");
});

test("normalized office-name key detects equivalent duplicates", () => {
  // Spacing / separators / case must not create a distinct key.
  assert.equal(lib.normalizeOfficeNameKey("Al  Masar"), lib.normalizeOfficeNameKey("al-masar"));
  assert.equal(lib.normalizeOfficeNameKey("مكتب المسار"), lib.normalizeOfficeNameKey("مكتب  المسار"));
  assert.equal(lib.normalizeOfficeNameKey("Al.Masar_Office"), lib.normalizeOfficeNameKey("almasaroffice"));
  // Genuinely different names must produce different keys.
  assert.notEqual(lib.normalizeOfficeNameKey("مكتب المسار"), lib.normalizeOfficeNameKey("مكتب النخبة"));
});

test("office names reject disallowed characters", () => {
  assert.notEqual(lib.validateOfficeName("مكتب <script>", { isPlatformAdmin: false }), "");
});

test("cooperation mode defaults to approval_required and rejects unknown values", () => {
  assert.equal(lib.DEFAULT_COOPERATION_MODE, "approval_required");
  assert.equal(lib.normalizeCooperationMode("smart_automatic"), "smart_automatic");
  assert.equal(lib.normalizeCooperationMode("disabled"), "disabled");
  assert.equal(lib.normalizeCooperationMode("hacked"), "approval_required");
  assert.equal(lib.normalizeCooperationMode(undefined), "approval_required");
});

test("notification preferences default all-on and coerce to booleans", () => {
  const defaults = lib.defaultNotificationPrefs();
  assert.equal(lib.NOTIFICATION_CATEGORIES.length, 6);
  for (const category of lib.NOTIFICATION_CATEGORIES) {
    assert.equal(defaults[category.key], true);
  }
  const normalized = lib.normalizeNotificationPrefs({ match: false, cooperation: "yes", junk: true });
  assert.equal(normalized.match, false);
  assert.equal(normalized.cooperation, false); // non-strict-true coerces to false
  assert.equal(normalized.system, true); // missing → default true
  assert.equal("junk" in normalized, false); // unknown keys dropped (no mass assignment)
});

test("image validation enforces allowed types and size limit", () => {
  assert.equal(lib.validateImageFile({ type: "image/png", size: 1000 }).ok, true);
  assert.equal(lib.validateImageFile({ type: "image/gif", size: 1000 }).ok, false);
  assert.equal(lib.validateImageFile({ type: "image/jpeg", size: 20 * 1024 * 1024 }).ok, false);
  assert.equal(lib.validateImageFile(null).ok, false);
});

test("cover crop ratio is configurable and produces a matching crop rect", () => {
  const { width, height } = lib.COVER_CROP_RATIO;
  const target = width / height;
  // Wide source: crop the width, centered.
  let rect = lib.cropRectForRatio(3000, 1000, width, height, 0.5);
  assert.ok(Math.abs(rect.sw / rect.sh - target) < 0.01);
  assert.equal(rect.sh, 1000);
  assert.ok(rect.sx > 0);
  // Tall source: crop the height, top-aligned.
  rect = lib.cropRectForRatio(1000, 3000, width, height, 0);
  assert.ok(Math.abs(rect.sw / rect.sh - target) < 0.01);
  assert.equal(rect.sw, 1000);
  assert.equal(rect.sy, 0);
});

test("logo crop ratio is square", () => {
  assert.equal(lib.LOGO_CROP_RATIO.width, lib.LOGO_CROP_RATIO.height);
  const rect = lib.cropRectForRatio(1600, 900, lib.LOGO_CROP_RATIO.width, lib.LOGO_CROP_RATIO.height, 0.5);
  assert.equal(rect.sw, rect.sh);
});
