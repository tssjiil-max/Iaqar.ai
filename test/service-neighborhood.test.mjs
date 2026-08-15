import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";
import {
  validateServiceNeighborhoodIds,
  normalizeServiceNeighborhoodIds,
  districtLabelById,
  SERVICE_NEIGHBORHOOD_MAX
} from "../public/js/service-neighborhood-domain.js";
import { assertValidServiceNeighborhoodIds } from "../worker/src/service-neighborhood-validation.js";
import { rankCooperationNearbySuggestions } from "../public/js/cooperation-nearby-domain.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function readRepo(...parts) {
  return readFileSync(path.join(root, "..", ...parts), "utf8");
}

const CITY = "المدينة المنورة";
const ONE = ["madinah-027"];
const FIVE = ["madinah-027", "madinah-092", "madinah-041", "madinah-016", "madinah-003"];
const SIX = [...FIVE, "madinah-004"];

test("1 neighborhood saves successfully", () => {
  const result = validateServiceNeighborhoodIds(ONE, CITY);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ids, ONE);
  assert.deepEqual(assertValidServiceNeighborhoodIds(ONE, CITY), ONE);
});

test("5 neighborhoods save successfully", () => {
  const result = validateServiceNeighborhoodIds(FIVE, CITY);
  assert.equal(result.ok, true);
  assert.equal(result.ids.length, 5);
});

test("0 neighborhoods rejected on explicit save", () => {
  const result = validateServiceNeighborhoodIds([], CITY, { requireMin: true });
  assert.equal(result.ok, false);
  assert.equal(result.code, "min");
  assert.throws(() => assertValidServiceNeighborhoodIds([], CITY), /اختر حيًا واحدًا على الأقل/);
});

test("6 neighborhoods rejected", () => {
  const result = validateServiceNeighborhoodIds(SIX, CITY);
  assert.equal(result.ok, false);
  assert.equal(result.code, "max");
});

test("duplicate IDs are rejected safely", () => {
  const result = validateServiceNeighborhoodIds(["madinah-027", "madinah-027"], CITY);
  assert.equal(result.ok, false);
  assert.equal(result.code, "duplicate");
  assert.deepEqual(normalizeServiceNeighborhoodIds(["madinah-027", "madinah-027"], CITY), ONE);
});

test("neighborhood from another city is rejected", () => {
  const result = validateServiceNeighborhoodIds(["madinah-027"], "الرياض");
  assert.equal(result.ok, false);
  assert.equal(result.code, "city");
});

test("existing office without field still loads with empty list", () => {
  const normalized = normalizeServiceNeighborhoodIds(undefined, CITY);
  assert.deepEqual(normalized, []);
  const optional = validateServiceNeighborhoodIds([], CITY, { requireMin: false });
  assert.equal(optional.ok, true);
});

test("office can add opportunity outside specializations — no restriction in intake", () => {
  const bank = readRepo("public", "js", "opportunity-bank.js");
  const workflow = readRepo("public", "js", "workflow-office.js");
  assert.equal(/serviceNeighborhoodIds/.test(bank), false);
  assert.equal(/serviceNeighborhoodIds/.test(workflow), false);
});

test("cooperation ranking prefers specialized neighborhood offices", () => {
  const ranked = rankCooperationNearbySuggestions({
    sourceOpportunity: {
      opportunityKind: "REQUEST",
      propertyType: "شقة",
      city: CITY,
      district: "الرانوناء",
      purpose: "PURCHASE",
      priceOrBudget: 500000,
      area: 120
    },
    ownOfficeId: "office-a",
    publicOffices: [
      {
        officeId: "office-b",
        officeName: "متخصص",
        city: CITY,
        cooperationMode: "APPROVAL_REQUIRED",
        serviceNeighborhoodIds: ["madinah-027"]
      },
      {
        officeId: "office-c",
        officeName: "عام",
        city: CITY,
        cooperationMode: "APPROVAL_REQUIRED",
        serviceNeighborhoodIds: ["madinah-003"]
      }
    ],
    candidateOpportunities: [
      {
        id: "opp-b",
        officeId: "office-b",
        opportunityKind: "OFFER",
        propertyType: "شقة",
        city: CITY,
        district: "الرانوناء",
        purpose: "SALE",
        priceOrBudget: 480000,
        area: 120
      },
      {
        id: "opp-c",
        officeId: "office-c",
        opportunityKind: "OFFER",
        propertyType: "شقة",
        city: CITY,
        district: "الرانوناء",
        purpose: "SALE",
        priceOrBudget: 470000,
        area: 120
      }
    ]
  });
  assert.ok(ranked.length >= 2);
  assert.equal(ranked[0].officeId, "office-b");
  assert.ok(ranked[0].tier <= ranked[1].tier);
});

test("office card HTML exposes neighborhood chips region inside card", () => {
  const html = readRepo("public", "index.html");
  assert.ok(html.includes("id=\"officeDisplayNeighborhoods\""));
  assert.ok(html.includes("أحياء التخصص"));
  const cardStart = html.indexOf("<section class=\"card license\">");
  const cardEnd = html.indexOf("</section>", cardStart);
  const block = html.slice(cardStart, cardEnd);
  assert.ok(block.includes("office-neighborhood-block"));
  assert.ok(block.includes("office-services-inline"));
});

test("office image CSS targets real #officeSettingsBtn logo with enlarged clamp", () => {
  const html = readRepo("public", "index.html");
  assert.ok(html.includes(".card.license .office-logo"));
  assert.ok(html.includes("clamp(112px,29vw,124px)"));
  assert.ok(html.includes("clamp(132px,34vw,148px)"));
  const at390 = 390 * 0.29;
  assert.ok(at390 >= 112 && at390 <= 124);
});

test("mobile office card chips markup supports up to 5 without overflow styles", () => {
  const dom = new JSDOM(`<!doctype html><div class="office-neighborhood-chips" id="c"></div>`, {
    url: "https://example.test/"
  });
  const node = dom.window.document.getElementById("c");
  node.innerHTML = FIVE.map((id) =>
    `<span class="office-neighborhood-chip">${districtLabelById(id)}</span>`
  ).join("");
  assert.equal(node.querySelectorAll(".office-neighborhood-chip").length, 5);
  assert.ok(node.innerHTML.includes("الرانوناء"));
});

test("firestore rules require 1-5 serviceNeighborhoodIds when field present", () => {
  const rules = readRepo("firestore.rules");
  assert.ok(rules.includes("validServiceNeighborhoodIdsField"));
  assert.ok(rules.includes("serviceNeighborhoodIds.size() >= 1"));
  assert.ok(rules.includes("serviceNeighborhoodIds.size() <= 5"));
});

test("settings UI includes searchable neighborhood multi-select", () => {
  const html = readRepo("public", "index.html");
  assert.ok(html.includes("أحياء تخصص المكتب"));
  assert.ok(html.includes("id=\"officeNeighborhoodSearch\""));
  assert.ok(html.includes("id=\"officeNeighborhoodChips\""));
  assert.ok(html.includes("يمكنك العمل في جميع أحياء المدينة"));
});

test("save path stores canonical IDs not display-only", () => {
  const settings = readRepo("public", "js", "office-settings.js");
  assert.ok(settings.includes("serviceNeighborhoodIds: data.serviceNeighborhoodIds"));
  assert.equal(settings.includes("buildDefaultServiceNeighborhoodIds"), false);
});
