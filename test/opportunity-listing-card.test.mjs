import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { buildOpportunityListingCardInnerHtml } from "../public/js/opportunity-listing-card-ui.js";

test("listing card inner html matches bank row structure", () => {
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
  assert.ok(html.includes("bank-row-header"));
  assert.ok(html.includes("bank-kind-badge"));
  assert.ok(html.includes("bank-row-title"));
  assert.ok(html.includes("bank-readiness-badge"));
  assert.ok(html.includes("bank-row-location"));
  assert.ok(html.includes("bank-row-stats"));
  assert.ok(html.includes("listing-field-marks"));
});

test("listing field marks place status icon after label for far-left alignment", () => {
  const html = buildOpportunityListingCardInnerHtml({
    opportunityKind: "REQUEST",
    propertyType: "أرض",
    purpose: "PURCHASE",
    city: "المدينة المنورة",
    district: "الجمعة",
    budget: 10000
  });
  assert.match(html, /listing-field-mark-label[^<]*<\/span>\s*<span class="listing-field-mark-icon"/);
  assert.ok(html.includes("✕") || html.includes("✓"));
});

test("bank row html uses shared listing card builder", () => {
  const bankSource = readFileSync(new URL("../public/js/opportunity-bank.js", import.meta.url), "utf8");
  assert.ok(bankSource.includes("buildOpportunityListingCardInnerHtml"));
});
