/**
 * Arabic phrase/context opportunity text extraction tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCEPTANCE_FIXTURE_TEXT,
  extractArabicOpportunityText
} from "../public/js/opportunity-text-extraction.js";
import { createExtractionAdapter, prepareOpportunityIntake } from "../public/js/opportunity-intake-domain.js";

function shape(result) {
  return result.publicShape;
}

test("acceptance fixture — شقة للإيجار with الدور الأول must not become propertyType دور", () => {
  const result = extractArabicOpportunityText(ACCEPTANCE_FIXTURE_TEXT);
  const s = shape(result);

  assert.equal(s.propertyType, "شقة");
  assert.notEqual(s.propertyType, "دور");
  assert.equal(s.transactionType, "إيجار");
  assert.equal(s.district, "السلام");
  assert.equal(s.city, null);
  assert.equal(s.annualRent, 22000);
  assert.equal(s.paymentInstallments, 2);
  assert.equal(s.optionalMonthlyRentAfterSixMonths, 1850);
  assert.equal(s.rooms, 4);
  assert.equal(s.bathrooms, 3);
  assert.equal(s.floorNumber, 1);
  assert.equal(s.livingRoom, true);
  assert.equal(s.kitchen, true);
  assert.equal(s.condition, "مجددة بالكامل");
  assert.equal(s.electricityMeter, "مستقل");
  assert.equal(s.waterAndSewagePaidBy, "المؤجر");
  assert.equal(s.electricityPaidBy, "المستأجر");
  assert.deepEqual(s.ownerConditions, ["عريس", "موظف حكومي"]);
  assert.equal(s.area, null);

  assert.equal(result.legacyFields.propertyType, "شقة");
  assert.equal(result.legacyFields.priceOrBudget, 22000);
  assert.equal(result.legacyFields.rooms, 4);
  assert.equal(result.legacyFields.city, "");
});

test("1) دور مستقل للإيجار، الدور الثاني", () => {
  const s = shape(extractArabicOpportunityText("دور مستقل للإيجار، الدور الثاني"));
  assert.equal(s.propertyType, "دور");
  assert.equal(s.floorNumber, 2);
});

test("2) شقة في الدور الثالث", () => {
  const s = shape(extractArabicOpportunityText("شقة في الدور الثالث"));
  assert.equal(s.propertyType, "شقة");
  assert.equal(s.floorNumber, 3);
});

test("3) فيلا مكونة من دورين", () => {
  const s = shape(extractArabicOpportunityText("فيلا مكونة من دورين"));
  assert.equal(s.propertyType, "فيلا");
  assert.equal(s.floorsCount, 2);
  assert.notEqual(s.propertyType, "دور");
});

test("4) مطلوب دور أرضي مستقل", () => {
  const s = shape(extractArabicOpportunityText("مطلوب دور أرضي مستقل"));
  assert.equal(s.propertyType, "دور");
  assert.equal(s.floorPosition, "أرضي");
});

test("5) أرض للبيع في حي السلام", () => {
  const s = shape(extractArabicOpportunityText("أرض للبيع في حي السلام"));
  assert.equal(s.propertyType, "أرض");
  assert.equal(s.transactionType, "بيع");
});

test("6) عمارة للبيع مكونة من 4 أدوار", () => {
  const s = shape(extractArabicOpportunityText("عمارة للبيع مكونة من 4 أدوار"));
  assert.equal(s.propertyType, "عمارة");
  assert.equal(s.floorsCount, 4);
});

test("7) شقة ٤ غرف و٣ دورات مياه", () => {
  const s = shape(extractArabicOpportunityText("شقة ٤ غرف و٣ دورات مياه"));
  assert.equal(s.propertyType, "شقة");
  assert.equal(s.rooms, 4);
  assert.equal(s.bathrooms, 3);
});

test("8) الإيجار ٢٢٬٠٠٠ ريال على دفعتين", () => {
  const s = shape(extractArabicOpportunityText("الإيجار ٢٢٬٠٠٠ ريال على دفعتين"));
  assert.equal(s.annualRent, 22000);
  assert.equal(s.paymentInstallments, 2);
});

test("intake pipeline uses phrase extractor for text (not single-keyword propertyType)", async () => {
  const adapter = createExtractionAdapter();
  const extraction = await adapter.extract({
    sourceType: "text",
    text: ACCEPTANCE_FIXTURE_TEXT
  });
  assert.equal(extraction.fields.propertyType, "شقة");
  assert.equal(extraction.extended.floorNumber, 1);
  assert.equal(extraction.extended.annualRent, 22000);
  assert.equal(extraction.productionAi, false);

  const prepared = await prepareOpportunityIntake({
    officeId: "office-a",
    brokerId: "broker-a",
    text: ACCEPTANCE_FIXTURE_TEXT,
    allowIncomplete: true
  }, adapter);
  assert.equal(prepared.ok, true);
  assert.equal(prepared.opportunity.propertyType, "شقة");
  assert.equal(prepared.opportunity.annualRent, 22000);
  assert.equal(prepared.opportunity.bathrooms, 3);
  assert.equal(prepared.opportunity.floorNumber, 1);
});
