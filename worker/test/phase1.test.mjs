import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  normalizeNotificationPreferences,
  normalizeOfficeNameKey,
  officeImageKey,
  validateOfficeSettingsInput
} from "../src/index.js";
import worker from "../src/index.js";

const root = new URL("../../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("office-name normalization rejects equivalent Arabic spacing and diacritic variants", () => {
  assert.equal(normalizeOfficeNameKey("  المَسـار العقاري "), normalizeOfficeNameKey("المسار_العقاري"));
  assert.equal(normalizeOfficeNameKey("AL MASAR"), normalizeOfficeNameKey("al-masar"));
});

test("backend office settings reject names shorter than four visible characters", () => {
  assert.throws(
    () => validateOfficeSettingsInput({
      officeName: "دار",
      brokerName: "وسيط معتمد",
      phone: "0551234567",
      licenseNumber: "123456",
      city: "المدينة المنورة"
    }, "office-one"),
    error => error && error.code === "office_name_too_short"
  );
  assert.throws(
    () => validateOfficeSettingsInput({
      officeName: "َ َ َ َ",
      brokerName: "وسيط معتمد",
      phone: "0551234567",
      licenseNumber: "123456",
      city: "المدينة المنورة"
    }, "office-one"),
    error => error && error.code === "office_name_too_short"
  );
});

test("backend office settings accept Arabic and Latin names and apply safe defaults", () => {
  for (const officeName of ["المسار العقاري", "Al Masar 2026"]) {
    const profile = validateOfficeSettingsInput({
      officeName,
      brokerName: "وسيط معتمد",
      phone: "0551234567",
      licenseNumber: "123456",
      city: "المدينة المنورة"
    }, "office-one");
    assert.equal(profile.officeId, "office-one");
    assert.equal(profile.cooperationMode, "APPROVAL_REQUIRED");
    assert.deepEqual(profile.notificationPreferences, normalizeNotificationPreferences({}));
  }
});

test("visual identity storage keys are tenant-scoped and kind-limited", () => {
  assert.equal(officeImageKey("office-one", "logo"), "office-images/office-one/logo");
  assert.equal(officeImageKey("office-one", "display"), "office-images/office-one/display");
  assert.equal(officeImageKey("office-one", "whatsapp-cover"), "office-images/office-one/whatsapp-cover");
  assert.equal(officeImageKey("office-one", "other"), "");
  assert.notEqual(officeImageKey("office-one", "logo"), officeImageKey("office-two", "logo"));
});

test("visual identity upload and removal use the authorized office-scoped R2 object", async () => {
  const writes = [];
  const removals = [];
  const mediaEnv = {
    FIREBASE_PROJECT_ID: "aqar-b5d76",
    META_TRIAL_OFFICE_ID: "office-one",
    ALLOW_TRIAL_NO_AUTH: "true",
    IAQAR_MEDIA: {
      put: async (...args) => writes.push(args),
      delete: async key => removals.push(key)
    }
  };
  const upload = await worker.fetch(new Request("https://example.test/media/office-image", {
    method: "POST",
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": "4",
      "X-Office-Id": "office-one",
      "X-Office-Image-Kind": "logo"
    },
    body: new Uint8Array([1, 2, 3, 4])
  }), mediaEnv);
  assert.equal(upload.status, 201);
  assert.equal(writes[0][0], "office-images/office-one/logo");
  assert.match((await upload.json()).imageUrl, /\/media\/public\/office-images\/office-one\/logo\?v=/);

  const removal = await worker.fetch(new Request("https://example.test/media/office-image", {
    method: "DELETE",
    headers: {
      "X-Office-Id": "office-one",
      "X-Office-Image-Kind": "logo"
    }
  }), mediaEnv);
  assert.equal(removal.status, 200);
  assert.deepEqual(removals, ["office-images/office-one/logo"]);

  const crossOffice = await worker.fetch(new Request("https://example.test/media/office-image", {
    method: "DELETE",
    headers: {
      "X-Office-Id": "office-two",
      "X-Office-Image-Kind": "logo"
    }
  }), mediaEnv);
  assert.equal(crossOffice.status, 401);
});

test("home exposes logo and display-image settings triggers without a visible settings label", async () => {
  const html = await read("public/index.html");
  assert.match(html, /id="officeSettingsBtn"[^>]+aria-label="فتح إعدادات المكتب"/);
  assert.match(html, /id="officeCoverSettingsBtn"[^>]+aria-label="فتح إعدادات المكتب من صورة العرض"/);
  assert.match(html, /<span class="visually-hidden">فتح إعدادات المكتب من الشعار<\/span>/);
  assert.doesNotMatch(html, /<span>إعدادات المكتب<\/span>/);
});

test("approved home has no bottom navigation, deals card, or static demo operations", async () => {
  const html = await read("public/index.html");
  assert.doesNotMatch(html, /<nav\b/i);
  assert.doesNotMatch(html, /data-main="deals"/);
  assert.doesNotMatch(html, /id:"(?:A1|M1|F1|M2|D1|D2)"/);
  assert.match(html, /<h2>مركز العمليات<\/h2>/);
  assert.match(html, /لا توجد إجراءات مطلوبة الآن/);
});

test("office data form contains only the five approved data inputs", async () => {
  const html = await read("public/index.html");
  const start = html.indexOf('id="officeDataTitle"');
  const end = html.indexOf("</section>", start);
  const officeData = html.slice(start, end);
  for (const id of ["officeNameInput", "brokerNameInput", "licenseNumberInput", "officeCityInput", "officePhoneInput"]) {
    assert.match(officeData, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(officeData, /type="email"|officeWhatsappInput|officeSpecialty/);
});

test("settings include all three crop workflows and office-link controls", async () => {
  const html = await read("public/index.html");
  for (const id of [
    "officeLogoInput",
    "officeLogoCropX",
    "officeDisplayImageInput",
    "officeDisplayImageCropX",
    "officeWhatsappCoverInput",
    "officeWhatsappCoverCropX",
    "copyOfficeLinkBtn",
    "shareOfficeLinkBtn",
    "previewOfficeLinkBtn",
    "officeQrCanvas"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const settings = await read("public/js/office-settings.js");
  assert.match(settings, /officeWideCoverRatio/);
  assert.match(settings, /canvas\.toBlob\(/);
  assert.match(settings, /\/media\/office-image/);
});

test("settings include six notification categories, bank entry, and cooperation modes", async () => {
  const html = await read("public/index.html");
  for (const key of ["matches", "participants", "cooperation", "messages", "appointmentsFollowUps", "systemImportant"]) {
    assert.match(html, new RegExp(`name="notificationPreference" value="${key}"`));
  }
  assert.match(html, /id="opportunityBankEntry"/);
  for (const mode of ["DISABLED", "APPROVAL_REQUIRED", "SMART_AUTOMATIC"]) {
    assert.match(html, new RegExp(`name="cooperationMode" value="${mode}"`));
  }
  const bank = await read("public/js/opportunity-bank.js");
  assert.match(bank, /runtime\.refs\.opportunities/);
  assert.match(bank, /orderBy\("createdAt", "desc"\)/);
});

test("Firestore rules protect tenant ownership, name claims, handles, and public projection", async () => {
  const rules = await read("firestore.rules");
  assert.match(rules, /request\.resource\.data\.officeId == officeId/);
  assert.match(rules, /request\.resource\.data\.ownerUid == resource\.data\.ownerUid/);
  assert.match(rules, /request\.resource\.data\.officeName == resource\.data\.officeName/);
  assert.match(rules, /match \/officeNameClaims\/\{nameKey\}[\s\S]*?allow write: if false;/);
  assert.match(rules, /match \/officeHandles\/\{handle\}[\s\S]*?allow read: if true;[\s\S]*?allow write: if false;/);
  assert.match(rules, /match \/publicOffices\/\{officeId\}[\s\S]*?allow write: if false;/);
});

test("Worker uses authenticated image/settings routes and transactional name claims", async () => {
  const source = await read("worker/src/index.js");
  assert.match(source, /url\.pathname === "\/office\/settings"/);
  assert.match(source, /url\.pathname === "\/media\/office-image"/);
  assert.match(source, /authorizeOfficeRequest\(request, env, officeId, "manage"\)/);
  assert.match(source, /beginFirestoreTransaction/);
  assert.match(source, /\["officeNameClaims", profile\.officeNameKey\]/);
  assert.match(source, /\["officeHandles", publicSlug\]/);
  assert.match(source, /notificationPreferenceKey/);
});
