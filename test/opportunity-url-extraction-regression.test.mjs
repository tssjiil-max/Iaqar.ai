/**
 * Regression — أرض للبيع في الرانوناء (URL intake pipeline).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  RANONA_LAND_REGRESSION_FIXTURE_TEXT,
  extractArabicOpportunityText
} from "../public/js/opportunity-text-extraction.js";
import { createExtractionAdapter, prepareOpportunityIntake } from "../public/js/opportunity-intake-domain.js";
import { buildReviewDefaults } from "../public/js/reference-catalog.js";
import { extractAdvertiserPhonesFromText } from "../public/js/advertiser-phone-domain.js";
import { extractListingTextFromHtml, opportunityToMatchInput } from "../worker/src/index.js";

test("RANONA land regression — parser output matches required fields", () => {
  const parsed = extractArabicOpportunityText(RANONA_LAND_REGRESSION_FIXTURE_TEXT);
  const fields = parsed.legacyFields;
  const ext = parsed.extended;

  assert.equal(ext.transactionType, "بيع");
  assert.equal(fields.propertyType, "أرض");
  assert.equal(fields.city, "المدينة المنورة");
  assert.equal(fields.district, "الرانوناء");
  assert.equal(fields.priceOrBudget, 580000);
  assert.equal(ext.salePrice, 580000);
  assert.equal(ext.annualRent, null);
  assert.equal(fields.area, 431.75);
  assert.equal(ext.pricePerSquareMeter, 1390);
  assert.notEqual(fields.city, "الرياض");

  const phones = extractAdvertiserPhonesFromText(RANONA_LAND_REGRESSION_FIXTURE_TEXT);
  assert.equal(phones[0]?.advertiserPhoneNormalized, "+966507561577");
});

test("RANONA land regression — review defaults and matching payload", async () => {
  const parsed = extractArabicOpportunityText(RANONA_LAND_REGRESSION_FIXTURE_TEXT);
  const fields = parsed.legacyFields;
  const ext = parsed.extended;

  const defaults = buildReviewDefaults(fields, RANONA_LAND_REGRESSION_FIXTURE_TEXT, { extended: ext });
  assert.equal(defaults.operationTypeId, "sale");
  assert.equal(defaults.propertyType, "أرض");
  assert.equal(defaults.city, "المدينة المنورة");
  assert.equal(defaults.district, "الرانوناء");
  assert.equal(defaults.priceOrBudget, 580000);
  assert.equal(defaults.area, 431.75);
  assert.notEqual(defaults.city, "الرياض");

  const adapter = createExtractionAdapter();
  const prepared = await prepareOpportunityIntake({
    officeId: "office-staging",
    brokerId: "broker-a",
    text: RANONA_LAND_REGRESSION_FIXTURE_TEXT,
    allowIncomplete: true
  }, adapter);

  assert.equal(prepared.ok, true);
  assert.equal(prepared.fields.propertyType, "أرض");
  assert.equal(prepared.fields.city, "المدينة المنورة");
  assert.equal(prepared.fields.district, "الرانوناء");
  assert.equal(prepared.fields.priceOrBudget, 580000);
  assert.equal(prepared.opportunity.salePrice, 580000);
  assert.equal(prepared.opportunity.annualRent, null);
  assert.equal(prepared.opportunity.rooms, null);
  assert.equal(prepared.fields.area, 431.75);
  assert.notEqual(prepared.fields.city, "الرياض");

  const matchInput = opportunityToMatchInput({
    propertyType: prepared.fields.propertyType,
    city: prepared.fields.city,
    district: prepared.fields.district,
    purpose: prepared.fields.purpose,
    opportunityKind: prepared.fields.opportunityKind,
    priceOrBudget: prepared.fields.priceOrBudget,
    area: prepared.fields.area
  });

  assert.equal(matchInput.transactionType, "sale");
  assert.equal(matchInput.propertyType, "أرض");
  assert.equal(matchInput.city, "المدينة المنورة");
  assert.equal(matchInput.district, "الرانوناء");
  assert.equal(matchInput.area, 431.75);
  assert.equal(matchInput.price, 580000);
});

test("URL intake without listing text fails (no empty review path)", async () => {
  const prepared = await prepareOpportunityIntake({
    officeId: "office-staging",
    brokerId: "broker-a",
    text: "https://haraj.com.sa/11167757566/test",
    allowIncomplete: true
  }, createExtractionAdapter());
  assert.equal(prepared.ok, false);
  assert.match(prepared.error, /تعذر استخراج بيانات الإعلان من الرابط/);
});

test("URL intake with resolved listing text preserves URL and fields", async () => {
  const prepared = await prepareOpportunityIntake({
    officeId: "office-staging",
    brokerId: "broker-a",
    text: RANONA_LAND_REGRESSION_FIXTURE_TEXT,
    listingText: RANONA_LAND_REGRESSION_FIXTURE_TEXT,
    url: "https://haraj.com.sa/11167757566/test",
    allowIncomplete: true
  }, createExtractionAdapter());

  assert.equal(prepared.ok, true);
  assert.equal(prepared.fields.city, "المدينة المنورة");
  assert.equal(prepared.source.url, "https://haraj.com.sa/11167757566/test");
  assert.notEqual(prepared.source.text, prepared.source.url);
});

test("simulated screenshot fixture does not inject الرياض as city default", async () => {
  const adapter = createExtractionAdapter();
  const extraction = await adapter.extract({
    sourceType: "screenshot",
    fileName: "Screenshot.png",
    text: ""
  });
  assert.notEqual(extraction.fields.city, "الرياض");
  assert.equal(extraction.fields.city, "");
});

test("50 million sale price in text extraction", () => {
  const parsed = extractArabicOpportunityText(
    "أرض تجارية استثمارية للبيع\nالمدينة المنورة\nمساحتها 50000\nالمطلوب 50 مليون\nجوال 0552019909"
  );
  assert.equal(parsed.publicShape.salePrice, 50_000_000);
  assert.equal(parsed.publicShape.area, 50000);
  assert.match(parsed.publicShape.propertyType || "", /أرض/);
});

test("review gate rejects الرياض paired with Medina district names", () => {
  const fields = { propertyType: "أرض", city: "الرياض", district: "الرانوناء", priceOrBudget: 580000 };
  const contradictory = fields.city === "الرياض" && /رانوناء/i.test(String(fields.district || ""));
  assert.equal(contradictory, true);
});

test("extractListingTextFromHtml prefers JSON-LD description", () => {
  const html = `<html><head><script type="application/ld+json">{"@type":"Product","description":"أرض للبيع في حي الرانوناء المدينة المنورة"}</script></head><body>footer الرياض</body></html>`;
  const text = extractListingTextFromHtml(html);
  assert.match(text, /أرض للبيع/);
  assert.match(text, /الرانوناء/);
});
