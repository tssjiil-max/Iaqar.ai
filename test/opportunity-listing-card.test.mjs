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

test("listing card shows 12-hour recent action mark only after a broker action", () => {
  const nowMs = Date.parse("2026-08-20T12:00:00.000Z");
  const acted = buildOpportunityListingCardInnerHtml({
    id: "opp_acted",
    opportunityKind: "OFFER",
    propertyType: "أرض",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "العريض",
    brokerActionProgress: { "contact:whatsapp": "2026-08-20T08:00:00.000Z" }
  }, { nowMs });
  const untouched = buildOpportunityListingCardInnerHtml({
    id: "opp_plain",
    opportunityKind: "OFFER",
    propertyType: "أرض",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "العريض"
  }, { nowMs });
  const expired = buildOpportunityListingCardInnerHtml({
    id: "opp_old",
    opportunityKind: "OFFER",
    propertyType: "أرض",
    purpose: "SALE",
    city: "المدينة المنورة",
    district: "العريض",
    brokerActionProgress: { "contact:whatsapp": "2026-08-19T11:00:00.000Z" }
  }, { nowMs });
  assert.ok(acted.includes("listing-recent-action-mark"));
  assert.ok(acted.includes("has-recent-action"));
  assert.ok(acted.includes("تم الإجراء"));
  assert.equal(untouched.includes("listing-recent-action-mark"), false);
  assert.equal(expired.includes("listing-recent-action-mark"), false);
});
