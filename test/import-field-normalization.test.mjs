/**
 * Import field normalization — plain-text review + catalog-safe canonicalization.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readRepositoryFile } from "./helpers/shell.mjs";
import { DISTRICTS } from "../public/js/reference-catalog.js";
import {
  NORMALIZATION_STATUS,
  applyPropertyTypeTypoFixes,
  buildImportReviewDefaults,
  importReviewValuesToBrokerFields,
  normalizeImportLocationFields,
  sanitizeImportFieldText,
  stripLeadingHayPrefix
} from "../public/js/import-field-normalization-domain.js";

const reviewUi = readRepositoryFile("public", "js", "opportunity-review.js");
const importUi = readRepositoryFile("public", "js", "opportunity-import-advert-ui.js");

test("import review uses plain text fields instead of catalog dropdowns", () => {
  assert.ok(reviewUi.includes("importPlainLocationFields"));
  assert.ok(reviewUi.includes('plainTextField("rawCityText"'));
  assert.ok(reviewUi.includes('plainTextField("rawNeighborhoodText"'));
  assert.ok(reviewUi.includes('plainTextField("rawPropertyTypeText"'));
  assert.ok(importUi.includes("importPlainLocationFields: true"));
  assert.ok(importUi.includes("buildImportReviewDefaults"));
});

test("strip leading حي and collapse spaces in neighborhood raw text", () => {
  assert.equal(stripLeadingHayPrefix("  حي   الرانوناء  "), "الرانوناء");
  assert.equal(sanitizeImportFieldText("المدينة    المنورة"), "المدينة المنورة");
});

test("property type typo فله normalizes to فيلا for canonical match", () => {
  assert.equal(applyPropertyTypeTypoFixes("فله للبيع"), "فيلا للبيع");
  const norm = normalizeImportLocationFields({ propertyType: "فله" });
  assert.equal(norm.rawPropertyType, "فيلا");
  assert.equal(norm.canonicalPropertyType, "فيلا");
  assert.equal(norm.catalogPropertyTypeId, "villa");
});

test("polluted district text is rejected from canonical neighborhood", () => {
  const norm = normalizeImportLocationFields({
    city: "المدينة المنورة",
    district: "الرانوناء مساحة 431 متر 580000"
  });
  assert.equal(norm.rawNeighborhood, "الرانوناء مساحة 431 متر 580000");
  assert.equal(norm.canonicalNeighborhood, "");
  assert.equal(norm.normalizationStatus, NORMALIZATION_STATUS.NEEDS_REVIEW);
  assert.match(norm.districtWarning, /سعر|مساحة|وصف/);
});

test("confirmed Medina district maps to catalog without mutating DISTRICTS", () => {
  const beforeCount = DISTRICTS.length;
  const norm = normalizeImportLocationFields({
    city: "المدينة المنورة",
    district: "حي الرانوناء",
    propertyType: "فيلا"
  });
  assert.equal(norm.canonicalNeighborhood, "الرانوناء");
  assert.equal(norm.normalizationStatus, NORMALIZATION_STATUS.CONFIRMED);
  assert.equal(DISTRICTS.length, beforeCount);
});

test("unknown neighborhood keeps raw text and needs_review without catalog pollution", () => {
  const norm = normalizeImportLocationFields({
    city: "المدينة المنورة",
    district: "حي تجريبي غير موجود",
    propertyType: "فيلا"
  });
  assert.equal(norm.rawNeighborhood, "تجريبي غير موجود");
  assert.equal(norm.canonicalNeighborhood, "");
  assert.equal(norm.normalizationStatus, NORMALIZATION_STATUS.NEEDS_REVIEW);
  assert.equal(norm.catalogDistrictId, "");
});

test("buildImportReviewDefaults pre-fills plain text from extraction", async () => {
  const defaults = buildImportReviewDefaults({
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "فيلا",
    city: "المدينة المنورة",
    district: "الرانوناء"
  }, "فيلا للبيع في المدينة المنورة حي الرانوناء");
  assert.equal(defaults.importPlainLocationFields, true);
  assert.match(defaults.rawCityText, /المدينة المنورة/);
  assert.match(defaults.rawPropertyTypeText, /فيلا/);
  assert.match(defaults.rawNeighborhoodText, /الرانوناء/);
});

test("importReviewValuesToBrokerFields stores raw and canonical pairs", () => {
  const broker = importReviewValuesToBrokerFields({
    operationTypeId: "sale",
    rawCityText: "المدينة المنورة",
    rawNeighborhoodText: "حي الرانوناء",
    rawPropertyTypeText: "فيلا",
    salePrice: "900000",
    area: "200",
    extractedSnapshot: { opportunityKind: "OFFER", purpose: "SALE" }
  });
  assert.equal(broker.rawCity, "المدينة المنورة");
  assert.equal(broker.canonicalCity, "المدينة المنورة");
  assert.equal(broker.rawNeighborhood, "الرانوناء");
  assert.equal(broker.canonicalNeighborhood, "الرانوناء");
  assert.equal(broker.rawPropertyType, "فيلا");
  assert.equal(broker.canonicalPropertyType, "فيلا");
  assert.equal(broker.city, "المدينة المنورة");
  assert.equal(broker.district, "الرانوناء");
  assert.equal(broker.propertyType, "فيلا");
  assert.equal(broker.normalizationStatus, NORMALIZATION_STATUS.CONFIRMED);
});

test("needs_review normalization does not block broker field output", () => {
  const broker = importReviewValuesToBrokerFields({
    operationTypeId: "sale",
    rawCityText: "مدينة غير معروفة",
    rawNeighborhoodText: "حي جديد",
    rawPropertyTypeText: "استراحة فاخرة",
    extractedSnapshot: { opportunityKind: "OFFER", purpose: "SALE" }
  });
  assert.equal(broker.normalizationStatus, NORMALIZATION_STATUS.NEEDS_REVIEW);
  assert.equal(broker.city, "مدينة غير معروفة");
  assert.equal(broker.district, "جديد");
  assert.match(broker.propertyType, /استراحة/);
});
