// اختبارات هيكلية لمعايير قبول المرحلة الأولى (docs/ACCEPTANCE_TESTS.md).
// تفحص ملفات الواجهة والقواعد نصيًا للتأكد من الالتزامات غير القابلة للتفاوض.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexHtml = readFileSync(join(root, "public/index.html"), "utf8");
const officeSettingsJs = readFileSync(join(root, "public/js/office-settings.js"), "utf8");
const whatsappOfficeJs = readFileSync(join(root, "public/js/whatsapp-office.js"), "utf8");
const rules = readFileSync(join(root, "firestore.rules"), "utf8");

function settingsFormSection() {
  const start = indexHtml.indexOf('id="officeProfileForm"');
  const end = indexHtml.indexOf("</form>", start);
  assert.ok(start > -1 && end > start, "office settings form exists");
  return indexHtml.slice(start, end);
}

test("TEST 1: office logo and office cover both open Office Settings", () => {
  assert.ok(indexHtml.includes('id="officeSettingsBtn"'), "logo button exists");
  assert.ok(indexHtml.includes('id="officeCoverBtn"'), "cover button exists");
  assert.match(whatsappOfficeJs, /getElementById\("officeSettingsBtn"\)/);
  assert.match(whatsappOfficeJs, /getElementById\("officeCoverBtn"\)/);
  assert.match(whatsappOfficeJs, /coverBtn\.addEventListener\("click", openSettings\)/);
});

test("TEST 1: no visible standalone settings button on the office card", () => {
  assert.ok(!indexHtml.includes("<span>إعدادات المكتب</span>"),
    "the office logo button must not carry a visible settings label");
});

test("TEST 2: no bottom navigation bar", () => {
  assert.ok(!/<nav[\s>]/i.test(indexHtml), "no <nav> element");
  assert.ok(!/bottom-nav|bottomnav|tabbar|tab-bar/i.test(indexHtml), "no bottom-nav classes");
});

test("TEST 3: office name validation exists on frontend and in Firestore rules", () => {
  assert.match(officeSettingsJs, /significantCharacterCount\(name\) < 4/);
  assert.match(officeSettingsJs, /normalizeOfficeNameKey/);
  assert.match(officeSettingsJs, /OFFICE_NAME_TAKEN/);
  assert.match(rules, /officeNameKey\.size\(\) >= 4/);
  assert.match(rules, /officeNameClaims/);
});

test("TEST 4: tenant isolation rules remain intact", () => {
  assert.match(rules, /function isOfficeMember/);
  assert.match(rules, /request\.resource\.data\.officeId == officeId/);
  assert.match(rules, /match \/devices\/\{deviceId\}[\s\S]*?allow read, write: if false/);
});

test("office settings shows only the approved data fields — no email field", () => {
  const form = settingsFormSection();
  assert.ok(!form.includes('type="email"'), "no email input in office settings");
  assert.ok(!/name="email"/.test(form), "no email field name in office settings");
  for (const id of ["officeNameInput", "brokerNameInput", "licenseNumberInput", "officeCityInput", "officePhoneInput"]) {
    assert.ok(form.includes(`id="${id}"`), `${id} present`);
  }
});

test("visual identity workflow: logo + cover upload, crop preset, remove controls", () => {
  const form = settingsFormSection();
  for (const id of ["officeLogoInput", "officeLogoPreview", "officeLogoRemoveBtn",
    "officeCoverInput", "officeCoverPreview", "officeCoverRemoveBtn", "officeCoverCropOffset"]) {
    assert.ok(form.includes(`id="${id}"`), `${id} present`);
  }
  assert.match(officeSettingsJs, /COVER_CROP_PRESET\s*=\s*Object\.freeze\(\{\s*\n?\s*ratio:/,
    "cover crop ratio is a configurable design setting");
  assert.match(officeSettingsJs, /media\/office-logo/);
  assert.match(officeSettingsJs, /media\/office-cover/);
});

test("office link tools: copy, share, QR, preview", () => {
  const form = settingsFormSection();
  for (const id of ["officeLinkInput", "copyOfficeLinkBtn", "shareOfficeLinkBtn", "showOfficeQrBtn", "previewOfficeLinkBtn", "officeQrCanvas"]) {
    assert.ok(form.includes(`id="${id}"`), `${id} present`);
  }
});

test("notification preferences: the six approved categories are present", () => {
  const form = settingsFormSection();
  for (const key of ["matches", "ownerCustomer", "cooperation", "messages", "appointments", "system"]) {
    assert.ok(form.includes(`name="notificationPref" value="${key}"`), `preference ${key} present`);
  }
  assert.match(rules, /notificationPreferences/);
});

test("smart cooperation modes present with approval_required as default", () => {
  const form = settingsFormSection();
  assert.ok(form.includes("السماح بالتعاون الذكي بين الوسطاء"));
  for (const mode of ["disabled", "approval_required", "smart_automatic"]) {
    assert.ok(form.includes(`name="cooperationMode" value="${mode}"`), `mode ${mode} present`);
  }
  assert.match(form, /value="approval_required" checked/);
  assert.match(officeSettingsJs, /DEFAULT_COOPERATION_MODE = "approval_required"/);
  assert.match(rules, /'disabled','approval_required','smart_automatic'/);
});

test("Opportunity Bank entry exists inside Office Settings — not on the home page", () => {
  assert.ok(indexHtml.includes("بنك الفرص"), "bank entry label present");
  assert.ok(indexHtml.includes('id="opportunityBankBtn"'), "bank entry button present");
  assert.ok(indexHtml.includes('id="opportunityBank"'), "bank overlay present");
  const mainSections = indexHtml.slice(indexHtml.indexOf('class="main-sections"'), indexHtml.indexOf('id="workspace"'));
  assert.ok(!mainSections.includes("بنك الفرص"), "bank is not a permanent home-page section");
});

test("Opportunity Bank summary shows only date added + cooperation status", () => {
  assert.match(officeSettingsJs, /أُضيفت:/);
  assert.match(officeSettingsJs, /التعاون:/);
  assert.ok(!officeSettingsJs.includes("confidence") || !/bank[\s\S]{0,400}confidence/i.test(officeSettingsJs),
    "bank items expose no internal confidence calculations");
});

test("no static demo operations remain in the home page script", () => {
  assert.match(indexHtml, /let data = \[\];/);
  for (const demoTitle of ["صفقة جاهزة للإغلاق", "اتفاقية وساطة بانتظار الاعتماد", "متابعة مالك عقار"]) {
    assert.ok(!indexHtml.includes(demoTitle), `demo card "${demoTitle}" removed`);
  }
  assert.ok(indexHtml.includes("workspace-empty"), "honest empty state exists");
});

test("forbidden opportunity status labels never appear in the UI", () => {
  for (const label of ["فرصة مرصودة", "فرصة قيد المتابعة", "فرصة غير مطابقة"]) {
    assert.ok(!indexHtml.includes(label) && !officeSettingsJs.includes(label), `label "${label}" absent`);
  }
});
