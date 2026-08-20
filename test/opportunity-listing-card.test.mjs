import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { buildOpportunityListingCardInnerHtml } from "../public/js/opportunity-listing-card-ui.js";

test("listing card inner html uses unified بيانات الفرصة table", () => {
  const html = buildOpportunityListingCardInnerHtml({
    id: "opp_1",
    opportunityKind: "OFFER",
    purpose: "RENT",
    propertyType: "دور",
    city: "الرياض",
    district: "الورود",
    annualRent: 50000,
    area: 120,
    rooms: 4
  });
  assert.ok(html.includes("listing-card-inner--unified"));
  assert.ok(html.includes("opp-details-data-table"));
  assert.ok(html.includes("بيانات الفرصة"));
  assert.ok(html.includes("العقار والغرض"));
  assert.ok(html.includes("opp-details-row"));
  assert.ok(!html.includes("bank-row-header"));
  assert.ok(!html.includes("listing-field-marks"));
});

test("listing table marks missing fields with ناقص tag and status icon", () => {
  const html = buildOpportunityListingCardInnerHtml({
    opportunityKind: "REQUEST",
    propertyType: "أرض",
    purpose: "PURCHASE",
    city: "المدينة المنورة",
    district: "الجمعة",
    budget: 10000
  });
  assert.ok(html.includes("opp-details-missing-tag"));
  assert.ok(html.includes("✕") || html.includes("✓"));
  assert.ok(html.includes("غير محدد"));
});

test("bank row html uses shared listing card builder", () => {
  const bankSource = readFileSync(new URL("../public/js/opportunity-bank.js", import.meta.url), "utf8");
  assert.ok(bankSource.includes("buildOpportunityListingCardInnerHtml"));
});

test("listing table DOM has six data rows", () => {
  const html = buildOpportunityListingCardInnerHtml({
    opportunityKind: "OFFER",
    propertyType: "أرض",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "الجمعة",
    price: 10000,
    area: 165.13
  });
  const dom = new JSDOM(`<div id="root">${html}</div>`);
  const rows = dom.window.document.querySelectorAll(".opp-details-row");
  assert.equal(rows.length, 6);
  assert.ok(dom.window.document.querySelector(".opp-details-data-title-text")?.textContent.includes("بيانات الفرصة"));
});
