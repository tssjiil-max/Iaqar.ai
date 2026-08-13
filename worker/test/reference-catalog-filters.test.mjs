import test from "node:test";
import assert from "node:assert/strict";
import {
  MEDINA_NEIGHBORHOODS,
  NEIGHBORHOOD_ALIASES,
  PROPERTY_TYPES,
  normalizeNeighborhood,
  neighborhoodsEquivalent,
  normalizePropertyTypeLabel,
  parseVoiceSearchCriteria,
  bankFilterNeighborhoodOptions
} from "../../public/js/reference-catalog.js";
import {
  emptyBankFilters,
  matchesBankQueryFilters,
  mergeVoiceCriteriaIntoFilters,
  collectBankFilterOptions
} from "../../public/js/opportunity-bank-filters-domain.js";
import { isVoiceSearchSupported } from "../../public/js/opportunity-bank-voice-domain.js";

test("normalizeNeighborhood keeps canonical Arabic name", () => {
  assert.equal(normalizeNeighborhood("الإسكان"), "الإسكان");
  assert.equal(normalizeNeighborhood("  الإسكان  "), "الإسكان");
});

test("normalizeNeighborhood deduplicates equivalent input", () => {
  const values = ["الإسكان", "الإسكان"].map(normalizeNeighborhood);
  assert.deepEqual([...new Set(values)], ["الإسكان"]);
});

test("normalizeNeighborhood resolves documented alias", () => {
  assert.equal(normalizeNeighborhood("حرة الوبرة"), "الوبرة");
  assert.ok(neighborhoodsEquivalent("حرة الوبرة", "الوبرة"));
});

test("polluted legacy neighborhood is cleaned not shown as canonical", () => {
  const cleaned = normalizeNeighborhood("الجمعة المساحة: 1");
  assert.equal(cleaned, "الجمعة");
  assert.ok(!bankFilterNeighborhoodOptions().includes("الجمعة المساحة: 1"));
});

test("polluted star-separated neighborhood is cleaned", () => {
  assert.equal(normalizeNeighborhood("الجمعة * المساحة: 1"), "الجمعة");
});

test("bank filter options use canonical neighborhoods only", () => {
  const options = collectBankFilterOptions([
    { city: "المدينة المنورة", district: "حرة الوبرة", propertyType: "فيلا" },
    { city: "المدينة المنورة", district: "الجمعة المساحة: 1", propertyType: "أرض" }
  ]);
  assert.ok(options.districts.includes("الوبرة"));
  assert.ok(options.districts.includes("الجمعة"));
  assert.equal(options.districts.filter((name) => name === "الجمعة").length, 1);
  assert.ok(!options.districts.includes("الجمعة المساحة: 1"));
  assert.ok(!options.districts.includes("حرة الوبرة"));
});

test("legacy alias search matches canonical neighborhood without mutation", () => {
  const record = { city: "المدينة المنورة", district: "حرة الوبرة", propertyType: "فيلا", purpose: "SALE" };
  const filters = { ...emptyBankFilters(), district: "الوبرة" };
  assert.equal(matchesBankQueryFilters(record, filters), true);
});

test("property type legacy alias matching", () => {
  const record = { propertyType: "ارض", district: "عروة", purpose: "SALE" };
  const filters = { ...emptyBankFilters(), propertyType: "أرض" };
  assert.equal(matchesBankQueryFilters(record, filters), true);
});

test("price and area filters ignore records without values", () => {
  const record = { district: "عروة", propertyType: "أرض", purpose: "SALE" };
  const filters = { ...emptyBankFilters(), priceMin: "100000", areaMin: "200" };
  assert.equal(matchesBankQueryFilters(record, filters), true);
});

test("price range excludes only when record has price", () => {
  const record = { district: "عروة", propertyType: "أرض", purpose: "SALE", salePrice: 50000 };
  const filters = { ...emptyBankFilters(), priceMin: "100000" };
  assert.equal(matchesBankQueryFilters(record, filters), false);
});

test("voice criteria parser extracts sale land in urwah", () => {
  const parsed = parseVoiceSearchCriteria("أرض للبيع في عروة");
  assert.equal(parsed.district, "عروة");
  assert.equal(parsed.propertyType, "أرض");
  assert.equal(parsed.purpose, "SALE");
});

test("voice merge keeps existing filters unless parsed value exists", () => {
  const merged = mergeVoiceCriteriaIntoFilters(
    { ...emptyBankFilters(), city: "المدينة المنورة", priceMin: "1000" },
    "فيلا في الوبرة"
  );
  assert.equal(merged.city, "المدينة المنورة");
  assert.equal(merged.priceMin, "1000");
  assert.equal(merged.district, "الوبرة");
  assert.equal(merged.propertyType, "فيلا");
});

test("taxonomy counts are stable", () => {
  assert.ok(MEDINA_NEIGHBORHOODS.length >= 90);
  assert.ok(PROPERTY_TYPES.length >= 20);
  assert.ok(Object.keys(NEIGHBORHOOD_ALIASES).length >= 5);
});

test("voice support probe does not throw in node", () => {
  assert.equal(isVoiceSearchSupported(), false);
});

test("property type normalization", () => {
  assert.equal(normalizePropertyTypeLabel("ارض"), "أرض");
});
