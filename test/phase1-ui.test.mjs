import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const settingsJs = readFileSync(new URL("../public/js/office-settings.js", import.meta.url), "utf8");
const workerJs = readFileSync(new URL("../worker/src/index.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8");

test("office logo and cover are the only visible settings entry points", () => {
  assert.match(html, /id="officeLogoSettingsBtn"[^>]+data-office-settings-trigger/);
  assert.match(html, /id="officeCoverSettingsBtn"[^>]+data-office-settings-trigger/);
  assert.doesNotMatch(html, /id="officeSettingsBtn"/);
  assert.match(html, /<span>شعار المكتب<\/span>/);
});

test("home page has no deals tab, no bottom navigation, and no static demo operations", () => {
  assert.doesNotMatch(html, /data-main="deals"/);
  assert.doesNotMatch(html, /<strong>الصفقات<\/strong>/);
  assert.doesNotMatch(html, /bottom-nav|bottomNavigation|navbar-fixed-bottom/);
  assert.match(html, /let data = \[\];/);
});

test("office settings expose approved Phase 1 controls", () => {
  for (const id of [
    "officeLogoInput",
    "officeCoverInput",
    "officeWhatsappCoverInput",
    "officeLinkInput",
    "shareOfficeLinkBtn",
    "previewOfficeLinkBtn",
    "officeQrCanvas",
    "openOpportunityBankBtn",
    "officeCooperationMode"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="officeWhatsappInput"[^>]+type="hidden"/);
  assert.doesNotMatch(html, /name="email"|id="officeEmail/i);
  assert.equal((html.match(/name="officeNotificationPreference"/g) || []).length, 6);
});

test("office name and media enforcement match Phase 1 requirements", () => {
  assert.match(settingsJs, /significantCharacterCount\(name\) < 4/);
  assert.doesNotMatch(settingsJs, /isPlatformAdmin\(\) && significantCharacterCount\(name\) < 4/);
  assert.match(rules, /request\.resource\.data\.officeNameKey\.size\(\) >= 4/);
  assert.match(rules, /nameKey\.size\(\) >= 4/);
  assert.match(workerJs, /"logo", "cover", "whatsapp-cover"/);
  assert.match(workerJs, /office-covers\/\$\{officeId\}\/\$\{mediaRole\}/);
});

test("manifest does not expose a deals shortcut", () => {
  const parsed = JSON.parse(manifest);
  assert.equal(parsed.dir, "rtl");
  assert.ok(Array.isArray(parsed.shortcuts));
  assert.equal(parsed.shortcuts.some(shortcut => String(shortcut.url || "").includes("open=deals")), false);
});
