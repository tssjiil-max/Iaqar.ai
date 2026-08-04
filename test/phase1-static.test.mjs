import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const officeSettings = readFileSync(new URL("../public/js/office-settings.js", import.meta.url), "utf8");
const whatsappOffice = readFileSync(new URL("../public/js/whatsapp-office.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

test("home exposes approved Phase 1 surfaces without deals or visible settings button", () => {
  assert.match(html, /id="officeSettingsBtn"[\s\S]*class="sr-only">فتح إعدادات المكتب/);
  assert.match(html, /id="officeCoverSettingsBtn"/);
  assert.match(html, />إضافة فرصة</);
  assert.match(html, />مركز العمليات</);
  assert.doesNotMatch(html, /data-main="deals"/);
  assert.doesNotMatch(html, />الصفقات</);
});

test("logo and cover both open Office Settings", () => {
  assert.match(whatsappOffice, /openCoverBtn = document\.getElementById\("officeCoverSettingsBtn"\)/);
  assert.match(whatsappOffice, /\[elements\.openBtn, elements\.openCoverBtn\]/);
});

test("Office Settings contains required Phase 1 controls", () => {
  for (const id of [
    "officeLogoInput",
    "officeCoverInput",
    "officeWhatsappCoverInput",
    "officeNameInput",
    "brokerNameInput",
    "licenseNumberInput",
    "officeCityInput",
    "officePhoneInput",
    "officeLinkInput",
    "shareOfficeLinkBtn",
    "previewOfficeLinkBtn",
    "officeQrCanvas",
    "officeBankBtn"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  assert.doesNotMatch(html, /name="email"|id="[^"]*Email/i);
  assert.match(html, /name="notificationPreference" value="matches"/);
  assert.match(html, /name="cooperationMode" value="APPROVAL_REQUIRED"/);
});

test("Office Settings script saves Phase 1 state explicitly", () => {
  assert.match(officeSettings, /VISUAL_IDENTITY/);
  assert.match(officeSettings, /notificationPreferences/);
  assert.match(officeSettings, /cooperationMode/);
  assert.match(officeSettings, /uploadOfficeImage/);
  assert.match(officeSettings, /cropImageFile/);
});

test("Firestore rules enforce office name claim ownership and minimum length", () => {
  assert.match(rules, /request\.resource\.data\.officeNameKey\.size\(\) >= 4/);
  assert.match(rules, /match \/officeNameClaims\/\{nameKey\}/);
  assert.match(rules, /allow create: if signedIn\(\)/);
  assert.match(rules, /allow update: if signedIn\(\)[\s\S]*resource\.data\.officeId == request\.resource\.data\.officeId/);
  assert.doesNotMatch(rules, /isPlatformAdmin\(\) \|\| nameKey\.size\(\) >= 4/);
});
