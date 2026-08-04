import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  normalizeOfficeNameKey,
  visibleOfficeNameCharacters,
  officeIdentityKey,
  officeNotificationAllowed
} from "../worker/src/index.js";

const root = new URL("../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("home exposes approved Phase 1 surfaces without Deals or demo operations", async () => {
  const html = await read("public/index.html");
  assert.match(html, /id="officeSettingsBtn"/);
  assert.match(html, /id="officeCoverSettingsBtn"/);
  assert.match(html, />إضافة فرصة</);
  assert.match(html, />مركز العمليات</);
  assert.doesNotMatch(html, /data-main="deals"/);
  assert.doesNotMatch(html, /<strong>الصفقات<\/strong>/);
  assert.doesNotMatch(html, /id:"(?:A1|M1|F1|D1|D2)"/);
  assert.match(html, /لا توجد إجراءات تحتاج انتباهك الآن/);
});

test("Office Settings has approved data, identity, link, preference, bank and cooperation controls", async () => {
  const html = await read("public/index.html");
  for (const id of [
    "officeLogoInput", "officeDisplayInput", "officeCoverInput",
    "officeNameInput", "brokerNameInput", "licenseNumberInput",
    "officeCityInput", "officePhoneInput", "copyOfficeLinkBtn",
    "shareOfficeLinkBtn", "showOfficeQrBtn", "previewOfficeLinkBtn",
    "openOpportunityBankBtn", "officeCooperationMode"
  ]) assert.match(html, new RegExp(`id="${id}"`));
  for (const preference of ["matches", "contacts", "cooperation", "messages", "appointments", "system"]) {
    assert.match(html, new RegExp(`data-notification-preference="${preference}"`));
  }
  for (const kind of ["logo", "display", "cover"]) {
    assert.match(html, new RegExp(`data-crop-kind="${kind}" data-crop-axis="x"`));
    assert.match(html, new RegExp(`data-remove-identity="${kind}"`));
  }
  assert.doesNotMatch(html, /id="officeEmailInput"/);
  assert.doesNotMatch(html, /id="officeWhatsappInput"/);
  assert.match(html, /value="APPROVAL_REQUIRED"/);
});

test("both accessible office identity controls open the same settings dialog", async () => {
  const html = await read("public/index.html");
  const logic = await read("public/js/whatsapp-office.js");
  assert.match(html, /id="officeSettingsBtn"[^>]*aria-label="فتح إعدادات المكتب"/);
  assert.match(html, /id="officeCoverSettingsBtn"[^>]*[\s\S]{0,120}aria-label="فتح إعدادات المكتب من صورة الغلاف"/);
  assert.match(logic, /document\.getElementById\("officeSettingsBtn"\)/);
  assert.match(logic, /document\.getElementById\("officeCoverSettingsBtn"\)/);
  assert.match(logic, /elements\.openButtons\.forEach\(button => button\.addEventListener\("click", openSettings\)\)/);
});

test("manifest contains no Deals shortcut", async () => {
  const manifest = JSON.parse(await read("public/manifest.webmanifest"));
  assert.ok(manifest.shortcuts.every(item => item.name !== "الصفقات" && !item.url.includes("deals")));
});

test("backend normalization, identity paths, and category preferences are tenant-aware", () => {
  assert.equal(normalizeOfficeNameKey("مَكتب الـنـور"), normalizeOfficeNameKey("مكتب النور"));
  assert.equal(visibleOfficeNameCharacters(" أب "), 2);
  assert.equal(officeIdentityKey("Office-A", "logo"), "office-identity/office-a/logo");
  assert.equal(officeIdentityKey("office-a", "../cover"), "");
  assert.equal(officeNotificationAllowed({ matches: false }, "match"), false);
  assert.equal(officeNotificationAllowed({ matches: false }, "message"), true);
});

test("Firestore rules lock claims and protected office ownership fields", async () => {
  const rules = await read("firestore.rules");
  assert.match(rules, /match \/officeNameClaims\/\{nameKey\}[\s\S]*allow create, update, delete: if false;/);
  assert.match(rules, /request\.resource\.data\.officeId == resource\.data\.officeId/);
  assert.match(rules, /request\.resource\.data\.ownerUid == resource\.data\.ownerUid/);
  assert.match(rules, /request\.resource\.data\.officeId == officeId/);
});
