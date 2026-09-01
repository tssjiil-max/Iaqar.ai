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

test("access-gate owner and client intake include required price field", () => {
  const gate = readRepo("public", "js", "access-gate.js");
  assert.ok(gate.includes('name="priceOrBudget"'));
  assert.ok(gate.includes("updateIntakePriceLabel"));
  assert.ok(gate.includes("intakePriceFieldLabel"));
  assert.ok(gate.includes("client-price"));
  assert.ok(gate.includes("owner-price"));
  const formSlice = gate.slice(
    gate.indexOf("id=\"intakeForm\""),
    gate.indexOf("id=\"accessStatus\"")
  );
  assert.equal(formSlice.includes("سعر قيمة الإيجار أو الشراء"), false);
});

test("access-gate public forms use plain text inputs without catalog selects", () => {
  const gate = readRepo("public", "js", "access-gate.js");
  assert.ok(gate.includes("id=\"propertyTypeInput\""));
  assert.ok(gate.includes("id=\"districtInput\""));
  assert.ok(gate.includes("id=\"requestKindInput\""));
  assert.equal(gate.includes("id=\"propertyTypeSelect\""), false);
  assert.equal(gate.includes("id=\"districtSelect\""), false);
  assert.equal(gate.includes("id=\"requestKindSelect\""), false);
  assert.equal(gate.includes("wireArabicSuggestInput(propertyInput"), false);
  assert.doesNotMatch(gate, /<select[^>]*name="requestKind"/);
});

test("opportunity bank incomplete form uses plain text inputs without selects", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  const workspaceUi = readRepo("public", "js", "opportunity-bank-workspace-ui.js");
  const combined = `${bank}\n${workspaceUi}`;
  assert.ok(combined.includes('name="propertyType"'));
  assert.ok(combined.includes('name="district"'));
  assert.equal(/select[^>]*name="propertyType"/.test(combined), false);
  assert.equal(/select[^>]*name="district"/.test(combined), false);
  assert.equal(/select[^>]*name="purpose"/.test(combined), false);
  assert.equal(bank.includes("wireArabicSuggestInput(propertyInput"), false);
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

test("operations shell listens for bank tasks redirect event", () => {
  const ui = readRepo("public", "js", "operations-center-ui.js");
  assert.ok(ui.includes("iaqar:open-operations-category"));
});

test("operations shell renders readiness badges on task cards", () => {
  const ui = readRepo("public", "js", "operations-center-ui.js");
  assert.ok(ui.includes("ops-readiness-badge"));
  assert.ok(ui.includes("buildOpsCardBadge"));
  assert.ok(ui.includes("ops-task-head"));
});

test("operations shell renders opsStatusLine on task cards", () => {
  const ui = readRepo("public", "js", "operations-center-ui.js");
  assert.ok(ui.includes("ops-task-status"));
  assert.ok(ui.includes("item.opsStatusLine"));
});

test("entire opportunity card opens inline daily task panel", () => {
  const ui = readRepo("public", "js", "operations-center-ui.js");
  const bank = readRepo("public", "js", "opportunity-bank.js");
  assert.ok(ui.includes("renderDailyTaskOpportunity"));
  assert.ok(bank.includes("renderDailyTaskOpportunity"));
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
  assert.ok(settings.includes("officeBrandIconCandidates"));
  assert.ok(settings.includes("PLATFORM_DEFAULT_LOGO"));
  assert.ok(settings.includes("إرسال العروض والطلبات"));
  assert.ok(settings.includes("مكاتب عقارية ذكية"));
  assert.ok(settings.includes("const brandX = 600"));
  assert.equal(settings.includes("createOfficeCardBlob() {\n  const missing = officeMissingFields()"), false);
});
