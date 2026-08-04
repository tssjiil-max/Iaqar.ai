import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const Core = require(join(repoRoot, "public/js/office-core.js"));
const html = readFileSync(join(repoRoot, "public/index.html"), "utf8");

// ---- Office name validation (Acceptance Test 3) ----

test("office name shorter than 4 visible chars is rejected for brokers", () => {
  assert.notEqual(Core.validateOfficeName("مكـ", { isPlatformAdmin: false }), "");
  assert.notEqual(Core.validateOfficeName("abc", { isPlatformAdmin: false }), "");
});

test("blank or whitespace-only office name is rejected", () => {
  assert.notEqual(Core.validateOfficeName("", { isPlatformAdmin: false }), "");
  assert.notEqual(Core.validateOfficeName("    ", { isPlatformAdmin: false }), "");
});

test("a unique 4+ char Arabic or Latin office name is accepted", () => {
  assert.equal(Core.validateOfficeName("مكتب المسار", { isPlatformAdmin: false }), "");
  assert.equal(Core.validateOfficeName("Almasar", { isPlatformAdmin: false }), "");
});

test("illegal characters in office name are rejected", () => {
  assert.notEqual(Core.validateOfficeName("مكتب<script>", { isPlatformAdmin: false }), "");
});

test("short names are reserved for platform admins only", () => {
  assert.notEqual(Core.validateOfficeName("ab", { isPlatformAdmin: false }), "");
  assert.equal(Core.validateOfficeName("ab", { isPlatformAdmin: true }), "");
});

// ---- Normalized uniqueness key (backs DB-level duplicate prevention) ----

test("equivalent office names normalize to the same uniqueness key", () => {
  const a = Core.normalizeOfficeNameKey("  مكتب  المسار ");
  const b = Core.normalizeOfficeNameKey("مكتب.المسار");
  const c = Core.normalizeOfficeNameKey("مكتب-المسار");
  assert.equal(a, b);
  assert.equal(b, c);

  const lower = Core.normalizeOfficeNameKey("Al Masar");
  const upper = Core.normalizeOfficeNameKey("AL-MASAR");
  assert.equal(lower, upper);
});

test("distinct office names produce distinct keys", () => {
  assert.notEqual(
    Core.normalizeOfficeNameKey("مكتب المسار"),
    Core.normalizeOfficeNameKey("مكتب الرياض")
  );
});

// ---- Public slug ----

test("public slug is deterministic and URL-safe", () => {
  const slug = Core.buildPublicSlug("مكتب المسار", "office-almasar");
  assert.match(slug, /^[a-z0-9-]+$/);
  assert.equal(slug, Core.buildPublicSlug("مكتب المسار", "office-almasar"));
});

// ---- Cover crop geometry (configurable WhatsApp ratio, not hard-coded vendor size) ----

test("cover crop centers a wide rectangle at the configured aspect ratio", () => {
  const ratio = Core.COVER_ASPECT.width / Core.COVER_ASPECT.height;
  // Tall source: crop height, keep full width.
  const tall = Core.coverCropRect(1000, 2000);
  assert.equal(tall.sWidth, 1000);
  assert.ok(Math.abs(tall.sWidth / tall.sHeight - ratio) < 0.02);
  assert.ok(tall.sy > 0 && tall.sx === 0);
  // Wide source: crop width, keep full height.
  const wide = Core.coverCropRect(4000, 1000);
  assert.equal(wide.sHeight, 1000);
  assert.ok(Math.abs(wide.sWidth / wide.sHeight - ratio) < 0.02);
  assert.ok(wide.sx > 0 && wide.sy === 0);
});

test("cover output size honors the configured aspect ratio", () => {
  const out = Core.coverOutputSize(1200);
  const ratio = Core.COVER_ASPECT.width / Core.COVER_ASPECT.height;
  assert.equal(out.width, 1200);
  assert.ok(Math.abs(out.width / out.height - ratio) < 0.02);
});

// ---- Notification preferences model (Section 7.5) ----

test("notification preferences normalize to the six approved channels", () => {
  const prefs = Core.normalizeNotificationPreferences({ match: false, bogus: true });
  assert.deepEqual(Object.keys(prefs).sort(), [...Core.NOTIFICATION_KEYS].sort());
  assert.equal(prefs.match, false);
  assert.equal(prefs.cooperation, true); // missing -> default enabled
  assert.equal("bogus" in prefs, false); // unknown dropped
});

test("default notification preferences enable all channels", () => {
  const prefs = Core.defaultNotificationPreferences();
  Core.NOTIFICATION_KEYS.forEach(key => assert.equal(prefs[key], true));
});

// ---- Cooperation mode model (Section 7.7 / 19) ----

test("cooperation mode defaults to approval_required and rejects unknown modes", () => {
  assert.equal(Core.normalizeCooperationMode(undefined), "approval_required");
  assert.equal(Core.normalizeCooperationMode("nonsense"), "approval_required");
  assert.equal(Core.normalizeCooperationMode("smart_automatic"), "smart_automatic");
  assert.equal(Core.normalizeCooperationMode("disabled"), "disabled");
});

// ---- Profile cleaning keeps ownership/private fields consistent ----

test("cleanProfile carries logo, cooperation mode, and notification prefs", () => {
  const clean = Core.cleanProfile({
    officeName: "مكتب المسار",
    brokerName: "وسيط",
    licenseNumber: "12ab34",
    city: "الرياض",
    logoUrl: "https://example.test/logo",
    cooperationMode: "smart_automatic",
    notificationPreferences: { message: false }
  });
  assert.equal(clean.licenseNumber, "1234"); // digits only
  assert.equal(clean.cooperationMode, "smart_automatic");
  assert.equal(clean.notificationPreferences.message, false);
  assert.equal(clean.notificationPreferences.match, true);
  assert.ok(clean.officeNameKey.length >= 4);
});

// ---- Structural invariants in index.html (Acceptance Tests 1, 2 + Section 6, 7.2) ----

test("Test 1: both office logo and office cover open settings; no visible settings button", () => {
  assert.match(html, /id="officeSettingsBtn"/); // logo trigger
  assert.match(html, /id="officeCoverTrigger"/); // cover trigger
  // The logo button's visible label is screen-reader-only, not a visible button.
  assert.match(html, /class="visually-hidden">إعدادات المكتب/);
});

test("Test 2: the home page has no bottom navigation bar", () => {
  assert.equal(/class="[^"]*bottom-nav/.test(html), false);
  assert.equal(/<nav\b/.test(html), false);
});

test("Section 7.2: office settings has no email field", () => {
  assert.equal(/type="email"/.test(html), false);
  assert.equal(/name="email"/.test(html), false);
});

test("Phase 1 settings surfaces exist: bank entry, cooperation, notifications, QR", () => {
  assert.match(html, /id="openOpportunityBankBtn"/);
  assert.match(html, /بنك الفرص/);
  assert.match(html, /id="cooperationModeSelect"/);
  assert.match(html, /name="notifPref"/);
  assert.match(html, /id="officeLinkQr"/);
  assert.match(html, /id="officeLogoInput"/);
});
