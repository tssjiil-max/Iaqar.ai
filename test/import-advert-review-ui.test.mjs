/**
 * Import advert simplified review — no dropdowns, primary fields, extras collapsed.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readRepositoryFile } from "./helpers/shell.mjs";
import { DISTRICTS } from "../public/js/reference-catalog.js";
import {
  IMPORT_EXTRA_FIELD_DEFS,
  IMPORT_RECORD_LABEL,
  buildImportSimplifiedReviewDefaults,
  classifyImportPropertyType,
  evaluateImportReviewSaveMinimum,
  importSimplifiedReviewValuesToBrokerFields,
  prefillImportReviewFromGeminiFields,
  resolveImportPrimaryInfoFields
} from "../public/js/import-advert-review-domain.js";
import { findImportDuplicateOpportunities } from "../public/js/opportunity-import-advert-domain.js";
import { importReadinessPresentation } from "../public/js/opportunity-import-advert-domain.js";

const reviewUi = readRepositoryFile("public", "js", "opportunity-review.js");
const importUi = readRepositoryFile("public", "js", "opportunity-import-advert-ui.js");
const bankFilters = readRepositoryFile("public", "js", "opportunity-bank-filters-domain.js");

function simplifiedImportSection(source) {
  const start = source.indexOf("function renderImportSimplifiedReviewForm");
  const end = source.indexOf("function renderReviewForm", start);
  assert.ok(start > -1, "renderImportSimplifiedReviewForm missing");
  return source.slice(start, end > start ? end : undefined);
}

test("property type is plain text input without select or datalist in import review", () => {
  const section = simplifiedImportSection(reviewUi);
  assert.match(section, /plainTextField\(\s*"rawPropertyTypeText"/);
  assert.doesNotMatch(section, /searchField\("propertyTypeId"/);
  assert.doesNotMatch(section, /<select[^>]*propertyType/i);
  assert.doesNotMatch(section, /<datalist/i);
});

test("city is plain text input without select or datalist in import review", () => {
  const section = simplifiedImportSection(reviewUi);
  assert.match(section, /plainTextField\(\s*"rawCityText"/);
  assert.doesNotMatch(section, /searchField\("cityId"/);
  assert.doesNotMatch(section, /<datalist/i);
});

test("district is plain text input without select or datalist in import review", () => {
  const section = simplifiedImportSection(reviewUi);
  assert.match(section, /plainTextField\(\s*"rawNeighborhoodText"/);
  assert.doesNotMatch(section, /searchField\("districtId"/);
  assert.doesNotMatch(section, /<datalist/i);
});

test("import simplified review does not wire hybrid suggestion lists", () => {
  const section = simplifiedImportSection(reviewUi);
  assert.doesNotMatch(section, /hybrid-suggestions/);
  assert.doesNotMatch(section, /search-select-list/);
  assert.doesNotMatch(section, /wireSearchFields/);
  assert.match(section, /autocomplete="off"/);
});

test("non-catalog neighborhood value can be saved through broker mapping", () => {
  const broker = importSimplifiedReviewValuesToBrokerFields({
    opportunityKind: "OFFER",
    operationTypeId: "sale",
    rawCityText: "المدينة المنورة",
    rawNeighborhoodText: "حي مخصص جديد",
    rawPropertyTypeText: "استراحة",
    salePrice: "500000",
    area: "400",
    extractedSnapshot: { opportunityKind: "OFFER", purpose: "SALE" }
  });
  assert.equal(broker.district, "مخصص جديد");
  assert.equal(broker.propertyType, "استراحة");
});

test("Gemini-style extraction pre-fills plain text review fields", () => {
  const filled = prefillImportReviewFromGeminiFields({
    opportunityKind: "OFFER",
    propertyType: "فيلا",
    city: "المدينة المنورة",
    district: "حي الرانوناء",
    salePrice: 1200000,
    rooms: 5,
    area: 300
  });
  assert.equal(filled.rawPropertyTypeText, "فيلا");
  assert.match(filled.rawCityText, /المدينة المنورة/);
  assert.equal(filled.rawNeighborhoodText, "الرانوناء");
  assert.equal(filled.salePrice, 1200000);
});

test("land property shows area as primary info field", () => {
  assert.equal(classifyImportPropertyType("أرض سكنية"), "land");
  const fields = resolveImportPrimaryInfoFields("أرض", {});
  assert.equal(fields.length, 1);
  assert.equal(fields[0].name, "area");
});

test("villa and apartment show rooms as primary info field", () => {
  for (const type of ["فيلا", "شقة", "دور"]) {
    const fields = resolveImportPrimaryInfoFields(type, {});
    assert.equal(fields[0].name, "rooms", type);
    assert.ok(fields.some((field) => field.name === "area" && field.optional));
  }
});

test("simplified import review surfaces extraction conflicts for user choice", () => {
  const section = simplifiedImportSection(reviewUi);
  assert.match(section, /extractionConflictsMarkup/);
  assert.match(reviewUi, /extraction-conflict-option/);
  assert.match(importUi, /applyScreenshotExtractionToReview/);
  assert.match(importUi, /snapshotImportReviewUserEdits/);
});

test("extra import fields are defined for collapsed details section", () => {
  assert.match(reviewUi, /function importExtraFieldsMarkup/);
  assert.match(reviewUi, /تفاصيل إضافية/);
  assert.match(reviewUi, /<details class="import-extra-details"/);
  assert.match(reviewUi, /IMPORT_EXTRA_FIELD_DEFS\.map/);
  for (const name of ["bathrooms", "livingRoom", "description", "floorNumber", "depth", "plotNumber", "locationUrl", "streetDirection"]) {
    assert.ok(IMPORT_EXTRA_FIELD_DEFS.some((field) => field.name === name));
  }
});

test("incomplete import review maps to needs completion presentation", () => {
  const broker = importSimplifiedReviewValuesToBrokerFields({
    opportunityKind: "OFFER",
    operationTypeId: "sale",
    rawCityText: "المدينة المنورة",
    rawNeighborhoodText: "الرانوناء",
    rawPropertyTypeText: "شقة",
    salePrice: "850000",
    extractedSnapshot: { opportunityKind: "OFFER", purpose: "SALE" }
  });
  const presentation = importReadinessPresentation(broker);
  assert.equal(presentation.matchingReadinessLabel, "تحتاج استكمال");
  assert.ok(presentation.matchingReadinessMissing.includes("contactPhone"));
});

test("incomplete save minimum reports Arabic missing labels without blocking mapping", () => {
  const minimum = evaluateImportReviewSaveMinimum({
    opportunityKind: "OFFER",
    operationTypeId: "sale",
    rawPropertyTypeText: "شقة",
    rawCityText: "المدينة المنورة"
  });
  assert.equal(minimum.ok, false);
  assert.ok(minimum.missingLabelsArabic.some((label) => /الحي أو المدينة|السعر/.test(label)));
});

test("same source URL resolves to duplicate instead of creating a new opportunity", () => {
  const docs = [{
    id: "opp_same_url",
    data: {
      officeId: "office_a",
      status: "active",
      sourceUrl: "https://sa.aqar.fm/r/abc123",
      propertyType: "فيلا",
      city: "المدينة المنورة",
      district: "الرانوناء"
    }
  }];
  const hits = findImportDuplicateOpportunities(docs, {
    sourceUrl: "https://sa.aqar.fm/r/abc123",
    officeId: "office_a"
  }, "office_a");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].opportunityId, "opp_same_url");
  assert.equal(hits[0].reason, "source_url");
});

test("opportunity bank filters remain unchanged outside import review", () => {
  assert.ok(bankFilters.includes("matchesBankQueryFilters"));
  assert.doesNotMatch(bankFilters, /importSimplifiedReview/);
  assert.doesNotMatch(bankFilters, /rawNeighborhoodText/);
  assert.equal(DISTRICTS.length > 0, true);
});

test("import UI enables simplified review flow with record label فرصة", () => {
  assert.ok(importUi.includes("importSimplifiedReview: true"));
  assert.ok(importUi.includes("buildImportSimplifiedReviewDefaults"));
  assert.ok(reviewUi.includes("IMPORT_RECORD_LABEL"));
  assert.equal(IMPORT_RECORD_LABEL, "فرصة");
});
