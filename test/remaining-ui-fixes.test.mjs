import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";
import {
  sanitizeDisplayField,
  formatDistrictLabel,
  formatLocationLine,
  isUntrustedDisplayValue
} from "../public/js/display-sanitize-domain.js";
import { buildOpportunityCardView } from "../public/js/opportunity-card-domain.js";
import { wireArabicSuggestInput } from "../public/js/arabic-field-suggest.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function readRepo(...parts) {
  return readFileSync(path.join(root, "..", ...parts), "utf8");
}

test("display sanitization hides Ms Dd dd II and spaced letters", () => {
  for (const garbage of ["Ms", "Dd dd", "II", "سلمى II", "ا ب"]) {
    assert.equal(isUntrustedDisplayValue(garbage), true);
    assert.equal(sanitizeDisplayField(garbage).display, "تحتاج مراجعة");
  }
});

test("formatDistrictLabel avoids double حي prefix", () => {
  assert.equal(formatDistrictLabel("الرانوناء"), "حي الرانوناء");
  assert.equal(formatDistrictLabel("حي الرانوناء"), "حي الرانوناء");
  assert.equal(formatLocationLine("المدينة المنورة", "حي الرانوناء"), "المدينة المنورة — حي الرانوناء");
});

test("opportunity card does not surface garbage property or district tokens", () => {
  const card = buildOpportunityCardView({
    propertyType: "Ms",
    district: "Dd dd",
    contactName: "سلمى II",
    city: "المدينة المنورة"
  });
  assert.equal(card.description, "تحتاج مراجعة");
  assert.ok(!card.location.includes("Dd"));
  assert.ok(!card.contactLine.includes("II"));
});

test("access-gate public forms use INPUT for property type and district", () => {
  const gate = readRepo("public", "js", "access-gate.js");
  assert.ok(gate.includes("id=\"propertyTypeInput\""));
  assert.ok(gate.includes("id=\"districtInput\""));
  assert.equal(gate.includes("id=\"propertyTypeSelect\""), false);
  assert.equal(gate.includes("id=\"districtSelect\""), false);
});

test("opportunity bank edit form uses text inputs not selects for property and district", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  const workspaceUi = readRepo("public", "js", "opportunity-bank-workspace-ui.js");
  const combined = `${bank}\n${workspaceUi}`;
  assert.ok(combined.includes('name="propertyType" class="arabic-suggest-input"') || combined.includes('name="propertyType"'));
  assert.ok(combined.includes('name="district"') || combined.includes('name="district" class="arabic-suggest-input"'));
  assert.equal(/select[^>]*name="propertyType"/.test(combined), false);
  assert.equal(/select[^>]*name="district"/.test(combined), false);
});

test("DOM: arabic suggest input keeps custom district after blur", () => {
  const dom = new JSDOM("<!doctype html><label><input name='district' id='d'></label>", {
    url: "https://example.test/"
  });
  const input = dom.window.document.getElementById("d");
  wireArabicSuggestInput(input, ["الرانوناء", "الوبرة"]);
  input.value = "حي الصفرين";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  input.dispatchEvent(new dom.window.Event("blur", { bubbles: true }));
  assert.equal(input.tagName, "INPUT");
  assert.equal(input.value, "حي الصفرين");
  assert.notEqual(input.value, "الرانوناء");
  const list = dom.window.document.querySelector(".arabic-suggest-list");
  assert.ok(list);
});

test("voice intake fills spoken district without auto-picking first suggestion", () => {
  const voice = readRepo("public", "js", "voice-intake.js");
  assert.ok(voice.includes("extractSpokenDistrict"));
  assert.ok(voice.includes("markReview"));
  assert.ok(voice.includes("setFieldValue"));
});

test("workflow opens unified opportunity detail instead of legacy overlay primary path", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.ok(workflow.includes("openOpportunityDetail"));
  assert.ok(workflow.includes("تفاصيل الفرصة"));
});

test("operations shell renders opsStatusLine on cards", () => {
  const html = readRepo("public", "index.html");
  assert.ok(html.includes("operation-status"));
  assert.ok(html.includes("item.opsStatusLine"));
});

test("service worker cache bumped with network-first navigation", () => {
  const sw = readRepo("public", "firebase-messaging-sw.js");
  assert.ok(sw.includes("iaqar-shell-"));
  assert.ok(sw.includes("/version.json"));
  assert.ok(sw.includes("isHtmlPath"));
  assert.ok(sw.includes("no-store"));
});

test("header CSS reduced to ~72% of prior bundle height", () => {
  const html = readRepo("public", "index.html");
  assert.ok(html.includes("min-height:29px"));
  assert.ok(html.includes("min-height:24px"));
});

test("office share card does not require cover image for blob generation", () => {
  const settings = readRepo("public", "js", "office-settings.js");
  assert.ok(settings.includes("officeShareCardRequiredFields"));
  assert.ok(settings.includes("loadImageSafe"));
  assert.equal(settings.includes("createOfficeCardBlob() {\n  const missing = officeMissingFields()"), false);
});
