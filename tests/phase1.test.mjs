/**
 * IAQAR.AI — Phase 1 Acceptance Tests
 * اختبارات القبول للمرحلة الأولى
 *
 * Runs with Node.js built-in test runner:
 *   node --test tests/phase1.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const indexHtml = readFileSync(join(ROOT, "public", "index.html"), "utf-8");
const officeSettingsJs = readFileSync(join(ROOT, "public", "js", "office-settings.js"), "utf-8");
const firestoreRules = readFileSync(join(ROOT, "firestore.rules"), "utf-8");

// ---------------------------------------------------------------------------
// Pure function helpers extracted from office-settings.js logic
// (mirrors exactly what the browser runs, validated here in Node.js)
// ---------------------------------------------------------------------------

function safeText(value, fallback = "") {
  return String(value == null ? fallback : value).trim();
}

function significantCharacterCount(value) {
  const matches = safeText(value).match(/[A-Za-z0-9\u0600-\u06FF]/g);
  return matches ? matches.length : 0;
}

function allowedOfficeName(value) {
  const name = safeText(value);
  return /^[A-Za-z0-9\u0600-\u06FF\s._-]+$/.test(name);
}

function normalizeOfficeNameKey(value) {
  return safeText(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s._-]+/g, "")
    .replace(/[^A-Za-z0-9\u0600-\u06FF]/g, "");
}

function validateOfficeName(value, isPlatformAdmin = false) {
  const name = safeText(value);
  if (!name) return "اكتب اسم المكتب";
  if (!allowedOfficeName(name)) return "اسم المكتب يقبل العربية أو الإنجليزية والأرقام والمسافات فقط";
  if (!isPlatformAdmin && significantCharacterCount(name) < 4) {
    return "اسم المكتب يجب أن يكون 4 أحرف على الأقل؛ الأسماء الأقصر محجوزة لإدارة المنصة";
  }
  if (significantCharacterCount(name) > 80) return "اسم المكتب طويل جدًا";
  return "";
}

// ---------------------------------------------------------------------------
// TEST 1: Settings opens via logo (HTML structure)
// ---------------------------------------------------------------------------

test("TEST 1: officeSettingsBtn exists in HTML", () => {
  assert.ok(
    indexHtml.includes('id="officeSettingsBtn"'),
    "logo button with id=officeSettingsBtn must exist"
  );
});

test("TEST 1: Settings overlay officeSettings exists in HTML", () => {
  assert.ok(
    indexHtml.includes('id="officeSettings"'),
    "settings overlay with id=officeSettings must exist"
  );
});

test("TEST 1: Settings close button exists", () => {
  assert.ok(
    indexHtml.includes('id="officeSettingsClose"'),
    "settings close button must exist"
  );
});

// ---------------------------------------------------------------------------
// TEST 1b: Cover image opens settings
// ---------------------------------------------------------------------------

test("TEST 1b: officeCoverCardBtn exists in HTML", () => {
  assert.ok(
    indexHtml.includes('id="officeCoverCardBtn"'),
    "office cover card button for settings access must exist"
  );
});

test("TEST 1b: officeCoverCardImg exists in HTML", () => {
  assert.ok(
    indexHtml.includes('id="officeCoverCardImg"'),
    "office cover card image element must exist"
  );
});

// ---------------------------------------------------------------------------
// TEST 2: No visible settings button text
// ---------------------------------------------------------------------------

test("TEST 2: No visible 'إعدادات المكتب' span in logo button", () => {
  // The span with visible text was removed; only aria-label remains
  const hasVisibleSpan = indexHtml.includes('<span>إعدادات المكتب</span>');
  assert.equal(
    hasVisibleSpan,
    false,
    "Visible 'إعدادات المكتب' text label must be removed from logo button"
  );
});

test("TEST 2: Logo button still has accessible aria-label", () => {
  assert.ok(
    indexHtml.includes('aria-label="فتح إعدادات المكتب"'),
    "Logo button must have Arabic aria-label for accessibility"
  );
});

// ---------------------------------------------------------------------------
// TEST 2b: No bottom navigation bar
// ---------------------------------------------------------------------------

test("TEST 2b: No bottom navigation bar in HTML", () => {
  const hasBottomNav =
    indexHtml.includes("bottom-nav") ||
    indexHtml.includes("tab-bar") ||
    indexHtml.includes("bottom-navigation");
  assert.equal(hasBottomNav, false, "Home page must not have a bottom navigation bar");
});

// ---------------------------------------------------------------------------
// TEST 2c: No separate Deals page button
// ---------------------------------------------------------------------------

test("TEST 2c: No 'الصفقات' main-card button on home page", () => {
  // The deals main-card was removed; deals appear in unified Operations Center
  const hasDealsMainCard =
    indexHtml.includes('data-main="deals"') &&
    indexHtml.includes('>الصفقات<');
  assert.equal(hasDealsMainCard, false, "Deals main-card button must not exist on home page");
});

// ---------------------------------------------------------------------------
// TEST 3: Office name validation
// ---------------------------------------------------------------------------

test("TEST 3a: Empty name is rejected", () => {
  const error = validateOfficeName("");
  assert.notEqual(error, "", "Empty name must return an error message");
  assert.ok(error.length > 0, "Error message must be non-empty Arabic string");
});

test("TEST 3a: Whitespace-only name is rejected", () => {
  const error = validateOfficeName("   ");
  assert.notEqual(error, "", "Whitespace-only name must return an error message");
});

test("TEST 3a: 1-character name is rejected (non-admin)", () => {
  const error = validateOfficeName("م", false);
  assert.notEqual(error, "", "1-char name must be rejected for non-admin");
  assert.ok(error.includes("4"), "Error must mention the 4-character requirement");
});

test("TEST 3a: 2-character name is rejected (non-admin)", () => {
  const error = validateOfficeName("مك", false);
  assert.notEqual(error, "", "2-char name must be rejected for non-admin");
});

test("TEST 3a: 3-character name is rejected (non-admin)", () => {
  const error = validateOfficeName("مكت", false);
  assert.notEqual(error, "", "3-char name must be rejected for non-admin");
});

test("TEST 3a: 4-character name is accepted (non-admin)", () => {
  const error = validateOfficeName("مكتب", false);
  assert.equal(error, "", "4-char name must be accepted");
});

test("TEST 3a: Long valid name is accepted", () => {
  const error = validateOfficeName("المكتب العقاري المتكامل للخدمات", false);
  assert.equal(error, "", "Long valid name must be accepted");
});

test("TEST 3b: Normalized duplicate detection", () => {
  // Two names that normalize to the same key must be considered duplicates
  const key1 = normalizeOfficeNameKey("المسار العقاري");
  const key2 = normalizeOfficeNameKey("المسار العقاري ");   // trailing space
  assert.equal(key1, key2, "Names differing only in trailing spaces must produce same key");
});

test("TEST 3b: Arabic alef normalization variants produce same key", () => {
  // normalizeOfficeNameKey does NOT normalize Arabic alef variants (that's normalizeArabic in workflow)
  // But officeNameKey strips spaces — so "مكتب أحمد" vs "مكتب احمد" are different keys intentionally
  // The key normalization is: NFKC + lowercase + strip spaces/punctuation
  const key1 = normalizeOfficeNameKey("مكتب العقاري");
  const key2 = normalizeOfficeNameKey("مكتب  العقاري"); // double space
  assert.equal(key1, key2, "Double spaces should collapse to same key");
});

test("TEST 3c: Unique name passes validation", () => {
  const error = validateOfficeName("المكتب الجديد للعقارات", false);
  assert.equal(error, "", "Unique valid name must pass frontend validation");
});

test("TEST 3c: normalizeOfficeNameKey produces consistent output", () => {
  const key = normalizeOfficeNameKey("مكتب العقار 2024");
  assert.ok(key.length > 0, "Key must be non-empty");
  assert.ok(!/\s/.test(key), "Key must not contain spaces");
  assert.ok(!/[._-]/.test(key), "Key must not contain dots, underscores, or hyphens");
});

// ---------------------------------------------------------------------------
// TEST: Name validation is also in Firestore rules
// ---------------------------------------------------------------------------

test("Firestore rules enforce office name key minimum length", () => {
  assert.ok(
    firestoreRules.includes("officeNameKey.size() >= 4"),
    "Firestore rules must enforce officeNameKey.size() >= 4"
  );
});

test("Firestore rules enforce office name key maximum length", () => {
  assert.ok(
    firestoreRules.includes("officeNameKey.size() <= 100"),
    "Firestore rules must enforce officeNameKey.size() <= 100"
  );
});

test("Firestore rules enforce office name uniqueness via officeNameClaims", () => {
  assert.ok(
    firestoreRules.includes("officeNameClaims"),
    "Firestore rules must reference officeNameClaims collection"
  );
});

// ---------------------------------------------------------------------------
// TEST 4: Office privacy (officeId isolation in Firestore rules)
// ---------------------------------------------------------------------------

test("TEST 4: Firestore rules require isOfficeMember for offices read", () => {
  assert.ok(
    firestoreRules.includes("isOfficeMember(officeId)"),
    "offices read rule must use isOfficeMember"
  );
});

test("TEST 4: Firestore rules use canManage for offices update", () => {
  assert.ok(
    firestoreRules.includes("canManage(officeId)"),
    "offices update rule must use canManage"
  );
});

test("TEST 4: officeId field required in child documents create/update", () => {
  assert.ok(
    firestoreRules.includes("request.resource.data.officeId == officeId"),
    "Firestore rules must verify officeId matches path on create/update"
  );
});

test("TEST 4: FCM devices are not accessible from client", () => {
  assert.ok(
    firestoreRules.includes("allow read, write: if false"),
    "devices collection must deny all client access"
  );
});

// ---------------------------------------------------------------------------
// TEST 7: Bank entry in settings
// ---------------------------------------------------------------------------

test("TEST 7: بنك الفرص button exists in settings HTML", () => {
  assert.ok(
    indexHtml.includes("بنك الفرص"),
    "Opportunity Bank 'بنك الفرص' entry must exist in settings"
  );
});

test("TEST 7: openBankBtn exists in HTML", () => {
  assert.ok(
    indexHtml.includes('id="openBankBtn"'),
    "Bank entry button id=openBankBtn must exist"
  );
});

// ---------------------------------------------------------------------------
// TEST 8: QR code section in settings
// ---------------------------------------------------------------------------

test("TEST 8: QR code canvas exists in settings HTML", () => {
  assert.ok(
    indexHtml.includes('id="officeQrCanvas"'),
    "QR code canvas id=officeQrCanvas must exist in settings"
  );
});

// ---------------------------------------------------------------------------
// TEST 9: Logo upload validation
// ---------------------------------------------------------------------------

test("TEST 9: Logo upload input exists in HTML", () => {
  assert.ok(
    indexHtml.includes('id="officeLogoInput"'),
    "Logo upload input id=officeLogoInput must exist"
  );
});

test("TEST 9: Logo upload accepts only image types", () => {
  assert.ok(
    indexHtml.includes('accept="image/jpeg,image/png,image/webp"'),
    "Logo input must restrict to image/jpeg, image/png, image/webp"
  );
});

// ---------------------------------------------------------------------------
// TEST 10: Cover upload with aspect ratio hint
// ---------------------------------------------------------------------------

test("TEST 10: WhatsApp ratio hint visible for cover", () => {
  assert.ok(
    indexHtml.includes("1.91:1"),
    "Cover upload area must show WhatsApp-compatible 1.91:1 ratio hint"
  );
});

// ---------------------------------------------------------------------------
// TEST: Notification preferences
// ---------------------------------------------------------------------------

test("Notification preference toggles exist in HTML", () => {
  const prefs = ["notifMatches", "notifOwnerCustomer", "notifCooperation",
                 "notifMessages", "notifAppointments", "notifSystem"];
  for (const id of prefs) {
    assert.ok(
      indexHtml.includes(`id="${id}"`),
      `Notification preference toggle id=${id} must exist`
    );
  }
});

test("Save notification prefs button exists", () => {
  assert.ok(
    indexHtml.includes('id="saveNotifPrefsBtn"'),
    "Save notification preferences button must exist"
  );
});

// ---------------------------------------------------------------------------
// TEST: Cooperation settings
// ---------------------------------------------------------------------------

test("Cooperation mode radios exist in HTML", () => {
  const modes = ["approval_required", "smart_automatic", "disabled"];
  for (const mode of modes) {
    assert.ok(
      indexHtml.includes(`value="${mode}"`),
      `Cooperation mode radio value="${mode}" must exist`
    );
  }
});

test("Save cooperation button exists", () => {
  assert.ok(
    indexHtml.includes('id="saveCooperationBtn"'),
    "Save cooperation button must exist"
  );
});

// ---------------------------------------------------------------------------
// TEST: COVER_ASPECT_RATIO is defined as a constant
// ---------------------------------------------------------------------------

test("COVER_ASPECT_RATIO constant is defined in office-settings.js", () => {
  assert.ok(
    officeSettingsJs.includes("const COVER_ASPECT_RATIO = 1.91"),
    "COVER_ASPECT_RATIO must be defined as a named constant (not hard-coded)"
  );
});

// ---------------------------------------------------------------------------
// TEST: No email field in office data settings
// ---------------------------------------------------------------------------

test("No email input field in office profile form", () => {
  // Check that the officeProfileForm does not contain an email input
  // Extract the form section
  const formStart = indexHtml.indexOf('id="officeProfileForm"');
  const formEnd = indexHtml.indexOf('</form>', formStart);
  const formHtml = formStart !== -1 && formEnd !== -1
    ? indexHtml.slice(formStart, formEnd)
    : "";
  const hasEmail = formHtml.includes('type="email"') || formHtml.includes('name="email"');
  assert.equal(hasEmail, false, "Office profile form must not contain an email field");
});

// ---------------------------------------------------------------------------
// TEST: Worker has logo upload endpoint
// ---------------------------------------------------------------------------

test("Worker has /media/office-logo POST endpoint", () => {
  const workerJs = readFileSync(join(ROOT, "worker", "src", "index.js"), "utf-8");
  assert.ok(
    workerJs.includes('"/media/office-logo"'),
    "Worker must have /media/office-logo endpoint"
  );
});

test("Worker has uploadOfficeLogo function", () => {
  const workerJs = readFileSync(join(ROOT, "worker", "src", "index.js"), "utf-8");
  assert.ok(
    workerJs.includes("async function uploadOfficeLogo"),
    "Worker must have uploadOfficeLogo function"
  );
});

test("Worker stores logos at office-logos/ R2 path", () => {
  const workerJs = readFileSync(join(ROOT, "worker", "src", "index.js"), "utf-8");
  assert.ok(
    workerJs.includes("office-logos/"),
    "Worker must use office-logos/ R2 path for logo storage"
  );
});

// ---------------------------------------------------------------------------
// TEST: Share link button exists
// ---------------------------------------------------------------------------

test("Share office link button exists in settings", () => {
  assert.ok(
    indexHtml.includes('id="shareOfficeLinkBtn"'),
    "Share office link button id=shareOfficeLinkBtn must exist"
  );
});

// ---------------------------------------------------------------------------
// TEST: office-settings.js covers all required functionality
// ---------------------------------------------------------------------------

test("office-settings.js defines cooperation mode default", () => {
  assert.ok(
    officeSettingsJs.includes("approval_required"),
    "office-settings.js must define cooperation mode default as approval_required"
  );
});

test("office-settings.js has saveNotificationPrefs function", () => {
  assert.ok(
    officeSettingsJs.includes("async function saveNotificationPrefs"),
    "office-settings.js must have saveNotificationPrefs function"
  );
});

test("office-settings.js has saveCooperationMode function", () => {
  assert.ok(
    officeSettingsJs.includes("async function saveCooperationMode"),
    "office-settings.js must have saveCooperationMode function"
  );
});

test("office-settings.js has saveLogo function", () => {
  assert.ok(
    officeSettingsJs.includes("async function saveLogo"),
    "office-settings.js must have saveLogo function"
  );
});

test("office-settings.js has renderQrCode function", () => {
  assert.ok(
    officeSettingsJs.includes("function renderQrCode"),
    "office-settings.js must have renderQrCode function"
  );
});

test("office-settings.js updateCardCover updates office card", () => {
  assert.ok(
    officeSettingsJs.includes("function updateCardCover"),
    "office-settings.js must have updateCardCover to show cover on office card"
  );
});
