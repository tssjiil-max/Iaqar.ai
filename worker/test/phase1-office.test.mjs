import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import worker, { officeMediaObjectKey, isOfficeMediaPublicKey } from "../src/index.js";

const require = createRequire(import.meta.url);
const policy = require("../../shared/office-policy.js");
const design = require("../../shared/office-design.js");

const root = resolve(import.meta.dirname, "../..");
const indexHtml = readFileSync(resolve(root, "public/index.html"), "utf8");
const firestoreRules = readFileSync(resolve(root, "firestore.rules"), "utf8");

test("office name rejects fewer than 4 significant characters", () => {
  assert.equal(policy.validateOfficeName("أب"), "اسم المكتب يجب أن يكون 4 أحرف على الأقل؛ الأسماء الأقصر محجوزة لإدارة المنصة");
  assert.equal(policy.validateOfficeName("   "), "اكتب اسم المكتب");
  assert.equal(policy.validateOfficeName("ا ب ج"), "اسم المكتب يجب أن يكون 4 أحرف على الأقل؛ الأسماء الأقصر محجوزة لإدارة المنصة");
});

test("office name accepts unique Arabic and Latin names of 4+ characters", () => {
  assert.equal(policy.validateOfficeName("المسار العقاري"), "");
  assert.equal(policy.validateOfficeName("AlMasar"), "");
});

test("normalized office name keys collapse equivalent duplicates", () => {
  assert.equal(policy.normalizeOfficeNameKey("المسار  العقاري"), policy.normalizeOfficeNameKey("المسار العقاري"));
  assert.equal(policy.normalizeOfficeNameKey("Al-Masar"), policy.normalizeOfficeNameKey("al masar"));
  assert.notEqual(policy.normalizeOfficeNameKey("المسار"), policy.normalizeOfficeNameKey("النخبة"));
});

test("cooperation mode defaults to APPROVAL_REQUIRED", () => {
  assert.equal(policy.normalizeCooperationMode(""), "APPROVAL_REQUIRED");
  assert.equal(policy.normalizeCooperationMode("DISABLED"), "DISABLED");
  assert.equal(policy.normalizeCooperationMode("SMART_AUTOMATIC"), "SMART_AUTOMATIC");
});

test("notification preferences default to enabled and can disable categories", () => {
  const defaults = policy.normalizeNotificationPreferences(null);
  assert.equal(defaults.match, true);
  assert.equal(policy.isNotificationEnabled({ match: false }, "match"), false);
  assert.equal(policy.isNotificationEnabled({ match: false }, "system"), true);
});

test("WhatsApp cover crop ratio is configurable and used by crop math", () => {
  assert.equal(design.OFFICE_IMAGE_DESIGN.whatsappCoverCropRatio, 1.91);
  const rect = design.computeCoverCropRect(1910, 1000, design.OFFICE_IMAGE_DESIGN.whatsappCoverCropRatio);
  assert.equal(rect.sw, 1910);
  assert.equal(rect.sh, 1000);
  const tall = design.computeCoverCropRect(1000, 1000, 1.91);
  assert.equal(tall.sw, 1000);
  assert.ok(tall.sh < 1000);
});

test("office media object keys cover logo display and whatsapp cover", () => {
  assert.equal(officeMediaObjectKey("office-1", "cover"), "office-covers/office-1/cover");
  assert.equal(officeMediaObjectKey("office-1", "logo"), "office-covers/office-1/logo");
  assert.equal(officeMediaObjectKey("office-1", "whatsapp-cover"), "office-covers/office-1/whatsapp-cover");
  assert.equal(policy.officeMediaObjectKey("office-1", "logo"), "office-covers/office-1/logo");
  assert.equal(isOfficeMediaPublicKey("office-covers/office-1/logo"), true);
  assert.equal(isOfficeMediaPublicKey("office-covers/office-1/secret"), false);
});

test("office logo upload route requires auth and writes the logo key", async () => {
  const writes = [];
  const mediaEnv = { FIREBASE_PROJECT_ID: "aqar-b5d76", IAQAR_MEDIA: { put: async (...args) => writes.push(args) } };
  const response = await worker.fetch(new Request("https://example.test/media/office-logo", {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      "Content-Length": "4",
      "X-Office-Id": "office-1"
    },
    body: new Uint8Array([1, 2, 3, 4])
  }), mediaEnv);
  // Without Firebase auth secrets / membership, authorizeOfficeRequest must reject.
  assert.notEqual(response.status, 201);
  assert.equal(writes.length, 0);
});

test("home page has no bottom navigation bar", () => {
  assert.equal(/bottom-nav|bottomnav|nav-bar|navbar/i.test(indexHtml), false);
  assert.equal(indexHtml.includes('role="navigation"'), false);
});

test("office settings opens from logo and cover with no standalone settings button", () => {
  assert.match(indexHtml, /id="officeSettingsBtn"/);
  assert.match(indexHtml, /id="officeCoverSettingsBtn"/);
  assert.match(indexHtml, /id="officeSettings"/);
  assert.equal(/إعدادات المكتب<\/button>/.test(indexHtml), false);
  assert.equal(/id="settingsBtn"|id="openSettingsBtn"/i.test(indexHtml), false);
});

test("office settings form has required fields and no email field", () => {
  assert.match(indexHtml, /id="officeNameInput"/);
  assert.match(indexHtml, /id="brokerNameInput"/);
  assert.match(indexHtml, /id="licenseNumberInput"/);
  assert.match(indexHtml, /id="officeCityInput"/);
  assert.match(indexHtml, /id="officePhoneInput"/);
  assert.match(indexHtml, /id="officeLogoInput"/);
  assert.match(indexHtml, /id="officeCoverInput"/);
  assert.match(indexHtml, /id="officeWhatsappCoverInput"/);
  assert.match(indexHtml, /id="opportunityBankEntry"/);
  assert.match(indexHtml, /id="cooperationModeSelect"/);
  assert.match(indexHtml, /id="notifyMatch"/);
  assert.match(indexHtml, /id="officeQrPreview"/);
  assert.match(indexHtml, /id="previewOfficeLinkBtn"/);
  const settingsChunk = indexHtml.slice(indexHtml.indexOf('id="officeSettings"'), indexHtml.indexOf('id="opportunityBank"'));
  assert.equal(/type="email"|officeEmail|البريد الإلكتروني/.test(settingsChunk), false);
});

test("firestore rules prevent foreign officeNameClaims overwrites", () => {
  assert.match(firestoreRules, /!exists\(\/databases\/\$\(database\)\/documents\/officeNameClaims\/\$\(nameKey\)\)/);
  assert.match(firestoreRules, /resource\.data\.officeId == request\.resource\.data\.officeId/);
  assert.match(firestoreRules, /officeNameKey == nameKey/);
});

test("constitution docs and cursor rule exist", () => {
  const files = [
    "docs/PROJECT_CONSTITUTION.md",
    "docs/SYSTEM_ARCHITECTURE.md",
    "docs/DATA_MODEL.md",
    "docs/EVENT_WORKFLOW.md",
    "docs/ACCEPTANCE_TESTS.md",
    "docs/IMPLEMENTATION_PLAN.md",
    "docs/DECISIONS.md",
    ".cursor/rules/iaqar-project-constitution.mdc"
  ];
  for (const file of files) {
    assert.ok(readFileSync(resolve(root, file), "utf8").length > 50, file);
  }
});
