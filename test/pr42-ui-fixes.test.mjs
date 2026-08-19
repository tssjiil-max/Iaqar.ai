import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  conservativeMatchDistrict,
  normalizeLegacyArabicLabel
} from "../public/js/reference-catalog.js";
import { usesDeviceGpsForCooperation } from "../public/js/cooperation-nearby-domain.js";
import { rankCooperationNearbySuggestions } from "../public/js/cooperation-nearby-domain.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function readRepo(...parts) {
  return readFileSync(path.join(root, "..", ...parts), "utf8");
}

test("conservative district matching does not map unknown حي الصفرين to الرانوناء", () => {
  const result = conservativeMatchDistrict("حي الصفرين", "madinah");
  assert.equal(result.confirmed, false);
  assert.notEqual(result.match?.officialName, "الرانوناء");
});

test("legacy English labels map to Arabic display only", () => {
  assert.equal(normalizeLegacyArabicLabel("Madina"), "المدينة المنورة");
  assert.equal(normalizeLegacyArabicLabel("Al-Wabra"), "الوبرة");
});

test("shell does not expose removed bank filter dropdown ids", () => {
  const html = readRepo("public", "index.html");
  assert.equal(html.includes("id=\"bankFilterCity\""), false);
  assert.equal(html.includes("id=\"bankFilterDistrict\""), false);
  assert.equal(html.includes("id=\"bankFilterPurpose\""), false);
  assert.equal(html.includes("id=\"bankFilterPropertyType\""), false);
  assert.equal(html.includes("id=\"bankFilterStatus\""), false);
  assert.equal(html.includes("id=\"bankFilterClearBtn\""), false);
});

test("shell removes legacy office link buttons", () => {
  const html = readRepo("public", "index.html");
  assert.ok(html.includes("shareOfficeLinkCardBtn"));
  assert.equal(html.includes("copyOfficeLinkBtn"), false);
  assert.equal(html.includes("toggleOfficeQrBtn"), false);
  assert.equal(html.includes("previewOfficeLinkBtn"), false);
  assert.equal(html.includes("shareOfficeCardBtn"), false);
});

test("office search requires officeId before share submit", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("اختر مكتبًا من نتائج البحث"));
  assert.ok(bank.includes("hiddenInput.value = \"\""));
});

test("cooperation nearby does not use device GPS", () => {
  assert.equal(usesDeviceGpsForCooperation(), false);
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.equal(/navigator\.geolocation|getCurrentPosition/.test(workflow), false);
});

test("whatsapp lifecycle flow avoids silent popup pre-open", () => {
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.equal(workflow.includes("window.prompt"), false);
  assert.ok(workflow.includes("تم فتح واتساب"));
  assert.ok(workflow.includes("whatsapp_opened"));
});

test("cooperation suggestions require real match score threshold", () => {
  const suggestions = rankCooperationNearbySuggestions({
    sourceOpportunity: {
      opportunityKind: "REQUEST",
      propertyType: "شقة",
      city: "المدينة المنورة",
      district: "الوبرة",
      purpose: "PURCHASE",
      priceOrBudget: 500000
    },
    ownOfficeId: "office-a",
    publicOffices: [
      {
        officeId: "office-b",
        officeName: "مكتب ب",
        city: "المدينة المنورة",
        cooperationMode: "APPROVAL_REQUIRED",
        serviceNeighborhoodIds: ["madinah-016"]
      }
    ],
    candidateOpportunities: [
      {
        id: "opp-offer-1",
        officeId: "office-b",
        opportunityKind: "OFFER",
        propertyType: "شقة",
        city: "المدينة المنورة",
        district: "الوبرة",
        purpose: "SALE",
        priceOrBudget: 480000,
        area: 120
      }
    ]
  });
  assert.ok(suggestions.length <= 4);
  if (suggestions.length) {
    assert.ok(suggestions[0].matchScore >= 55);
    assert.ok(suggestions[0].officeName);
    assert.equal(typeof suggestions[0].matchScore, "number");
  }
});
