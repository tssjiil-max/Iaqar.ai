import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const settingsJs = readFileSync(join(root, "js/office-settings.js"), "utf8");
const whatsappJs = readFileSync(join(root, "js/whatsapp-office.js"), "utf8");
const constitution = readFileSync(join(root, "..", "docs", "PROJECT_CONSTITUTION.md"), "utf8");
const cursorRule = readFileSync(join(root, "..", ".cursor", "rules", "iaqar-project-constitution.mdc"), "utf8");

test("TEST 1 markers: logo and cover open settings; no standalone settings button label", () => {
  assert.match(html, /id="officeSettingsBtn"/);
  assert.match(html, /id="officeCoverBtn"/);
  assert.match(html, /aria-label="فتح إعدادات المكتب من الشعار"/);
  assert.match(html, /aria-label="فتح إعدادات المكتب من صورة العرض"/);
  assert.equal(/إعدادات المكتب<\/span>/.test(html), false);
  assert.equal(/id="standaloneSettingsBtn"/.test(html), false);
  assert.match(whatsappJs, /officeCoverBtn/);
  assert.match(whatsappJs, /openSettings/);
});

test("TEST 2: no bottom navigation bar markup", () => {
  assert.equal(/bottom-nav|bottomNav|nav-bar|navbar/.test(html), false);
  assert.equal(/<nav[^>]*class="[^"]*bottom/.test(html), false);
});

test("Phase 1 office settings fields: required data, no email, visual identity, bank, cooperation, notifications", () => {
  for (const id of [
    "officeNameInput",
    "brokerNameInput",
    "officePhoneInput",
    "licenseNumberInput",
    "officeCityInput",
    "officeLogoInput",
    "officeCoverInput",
    "officeWhatsappCoverInput",
    "copyOfficeLinkBtn",
    "shareOfficeLinkBtn",
    "previewOfficeLinkBtn",
    "officeQrCanvas",
    "opportunityBankEntry",
    "officeNotificationPrefs",
    "officeCooperationModes",
    "officeCropOverlay"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, />بنك الفرص</);
  assert.match(html, /value="APPROVAL_REQUIRED"/);
  assert.match(html, /value="whatsappWide"|whatsappWide/);
  assert.equal(/type="email"|id="officeEmailInput"|officeWhatsappInput/.test(html), false);
});

test("governance documents and cursor rule exist with constitution authority", () => {
  assert.match(constitution, /PROJECT CONSTITUTION|supreme product rule|بنك الفرص/i);
  assert.match(cursorRule, /alwaysApply:\s*true/);
  assert.match(cursorRule, /docs\/PROJECT_CONSTITUTION\.md/);
});

test("office settings persistence includes cooperation mode and notification preferences", () => {
  assert.match(settingsJs, /cooperationMode/);
  assert.match(settingsJs, /notificationPreferences/);
  assert.match(settingsJs, /\/media\/office-logo/);
  assert.match(settingsJs, /\/media\/office-whatsapp-cover/);
  assert.match(settingsJs, /opportunityBank/);
});

test("TEST 14 tracked: deals home card still present (known Phase 1 limitation)", () => {
  // Documented FAIL until owner-approved home restructure (ADR-003).
  assert.match(html, /data-main="deals"/);
});
