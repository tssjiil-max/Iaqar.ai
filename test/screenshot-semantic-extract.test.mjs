/**
 * Semantic screenshot extraction — layout-independent, no fixed coordinates.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CURRENT_SCREENSHOT_EXAMPLE_TEXT,
  PHONE_CONFLICT_MESSAGE,
  PRICE_CONFLICT_MESSAGE,
  SCREENSHOT_LAYOUT_FIXTURES,
  SCREENSHOT_SOURCE_TYPES,
  applyScreenshotExtractionToReview,
  extractScreenshotSemantics,
  mergeVisionWithScreenshotSemantics,
  screenshotSemanticsToBrokerFields
} from "../public/js/screenshot-semantic-extract.js";
import {
  buildImportSimplifiedReviewDefaults
} from "../public/js/import-advert-review-domain.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const extractSource = readFileSync(path.join(root, "public/js/screenshot-semantic-extract.js"), "utf8");
const visionSource = readFileSync(path.join(root, "worker/src/listing-image-vision-service.mjs"), "utf8");

function core(result) {
  const broker = screenshotSemanticsToBrokerFields(result);
  return {
    propertyType: broker.propertyType,
    purpose: broker.purpose,
    district: broker.district,
    city: broker.city,
    area: broker.area,
    streetDirection: broker.streetDirection,
    streetWidth: broker.streetWidth,
    direction: broker.direction,
    depth: broker.depth,
    plotNumber: broker.plotNumber,
    salePrice: broker.salePrice,
    phone: broker.advertiserPhoneRaw,
    locationUrl: broker.locationUrl,
    inferredPrice: broker.inferredPrice,
    conflicts: (result.conflicts || []).map((row) => row.field).sort()
  };
}

function assertLandExample(result, label) {
  const got = core(result);
  assert.equal(got.propertyType, "أرض", `${label} propertyType`);
  assert.equal(got.purpose, "SALE", `${label} purpose`);
  assert.equal(got.district, "السكب", `${label} district`);
  assert.equal(got.city, "المدينة المنورة", `${label} city`);
  assert.equal(got.area, 1175, `${label} area`);
  assert.equal(got.streetDirection, "جنوبي", `${label} streetDirection`);
  assert.equal(got.streetWidth, 10, `${label} streetWidth`);
  assert.equal(got.direction, 25, `${label} facade/direction`);
  assert.equal(got.depth, 47, `${label} depth`);
  assert.equal(String(got.plotNumber), "14", `${label} plotNumber`);
  assert.equal(got.salePrice, 850000, `${label} price`);
  assert.equal(got.phone, "0530899289", `${label} phone`);
  assert.match(String(got.locationUrl), /maps\.app\.goo\.gl/, `${label} maps`);
}

test("module does not use fixed image coordinates as source of truth", () => {
  assert.doesNotMatch(extractSource, /top\s*20%|bottom\s*30%|right side = property type/i);
  assert.doesNotMatch(extractSource, /yPercent|bbox\.y|boundingBox|layoutX|layoutY|imageHeight\s*\*/);
  assert.doesNotMatch(visionSource, /top\s*20%|bottom\s*30%|header is always phone|footer is always price/i);
});

test("current screenshot example extracts land sale in السكب", () => {
  const result = extractScreenshotSemantics(CURRENT_SCREENSHOT_EXAMPLE_TEXT);
  assertLandExample(result, "current");
  assert.equal(result.inferredPrice, true);
  assert.equal(result.fields.price.confidence < 0.85, true);
  assert.equal(result.fields.price.inferredPrice, true);
  assert.match(result.fields.price.sourceSnippet, /850/);
});

test("A — WhatsApp header phone above ad body", () => {
  const result = extractScreenshotSemantics(SCREENSHOT_LAYOUT_FIXTURES.A);
  assertLandExample(result, "A");
});

test("B — WhatsApp phone only inside the message", () => {
  const result = extractScreenshotSemantics(SCREENSHOT_LAYOUT_FIXTURES.B);
  assertLandExample(result, "B");
  assert.equal(result.sourceType, SCREENSHOT_SOURCE_TYPES.WHATSAPP_SCREENSHOT);
});

test("C — designed ad price on top phone at bottom", () => {
  const result = extractScreenshotSemantics(SCREENSHOT_LAYOUT_FIXTURES.C);
  assertLandExample(result, "C");
});

test("D — website screenshot price mid contact footer", () => {
  const result = extractScreenshotSemantics(SCREENSHOT_LAYOUT_FIXTURES.D);
  const got = core(result);
  assert.equal(got.propertyType, "أرض");
  assert.equal(got.district, "السكب");
  assert.equal(got.city, "المدينة المنورة");
  assert.equal(got.area, 1175);
  assert.equal(got.salePrice, 850000);
  assert.equal(got.phone, "0530899289");
  assert.equal(result.sourceType, SCREENSHOT_SOURCE_TYPES.PROPERTY_SITE_SCREENSHOT);
  assert.equal(got.inferredPrice, false);
});

test("E — two phones do not auto-pick", () => {
  const result = extractScreenshotSemantics(SCREENSHOT_LAYOUT_FIXTURES.E);
  const got = core(result);
  assert.equal(got.phone, "");
  assert.ok(got.conflicts.includes("phone"));
  const conflict = result.conflicts.find((row) => row.field === "phone");
  assert.equal(conflict.message, PHONE_CONFLICT_MESSAGE);
  assert.equal(conflict.candidates.length, 2);
  const locals = conflict.candidates.map((row) => row.value).sort();
  assert.deepEqual(locals, ["0501234567", "0530899289"]);
  assert.equal(got.district, "السكب");
  assert.equal(got.area, 1175);
});

test("F — two prices do not auto-pick", () => {
  const result = extractScreenshotSemantics(SCREENSHOT_LAYOUT_FIXTURES.F);
  const got = core(result);
  assert.equal(got.salePrice, null);
  assert.ok(got.conflicts.includes("price"));
  const conflict = result.conflicts.find((row) => row.field === "price");
  assert.equal(conflict.message, PRICE_CONFLICT_MESSAGE);
  const amounts = conflict.candidates.map((row) => row.value).sort((a, b) => a - b);
  assert.deepEqual(amounts, [850000, 900000]);
  assert.equal(got.phone, "0530899289");
});

test("line order permutation still extracts the same land fields", () => {
  const lines = [
    "رقم القطعة 14",
    "المطلوب 850 صافي",
    "حي السكب",
    "الواجهة 25م",
    "أرض للبيع",
    "0530899289",
    "المدينة المنورة",
    "العمق 47م",
    "المساحة 1175م",
    "شارع جنوبي 10م",
    "https://maps.app.goo.gl/perm"
  ];
  const reversed = extractScreenshotSemantics([...lines].reverse().join("\n"));
  const shuffled = extractScreenshotSemantics([
    lines[4], lines[9], lines[0], lines[6], lines[1], lines[8], lines[3], lines[7], lines[2], lines[10], lines[5]
  ].join("\n"));
  assertLandExample(reversed, "reversed");
  assertLandExample(shuffled, "shuffled");
});

test("does not invent missing city district phone or price", () => {
  const result = extractScreenshotSemantics("شقة مجددة بالكامل 4 غرف");
  const broker = screenshotSemanticsToBrokerFields(result);
  assert.equal(broker.city, "");
  assert.equal(broker.district, "");
  assert.equal(broker.advertiserPhoneRaw, "");
  assert.equal(broker.salePrice, null);
  assert.equal(broker.area, null);
});

test("user edits win over re-extraction", () => {
  const extraction = extractScreenshotSemantics(CURRENT_SCREENSHOT_EXAMPLE_TEXT);
  const extracted = applyScreenshotExtractionToReview(extraction, {}, {});
  const merged = applyScreenshotExtractionToReview(extraction, extracted, {
    salePrice: "700000",
    rawNeighborhoodText: "حي عدّله المستخدم"
  });
  assert.equal(extracted.salePrice, 850000);
  assert.equal(merged.salePrice, "700000");
  assert.equal(merged.rawNeighborhoodText, "حي عدّله المستخدم");
  assert.equal(merged.rawPropertyTypeText, "أرض");
});

test("vision structured fields are ignored when not grounded in raw text", () => {
  const merged = mergeVisionWithScreenshotSemantics(
    "أرض للبيع في حي السكب",
    { city: "الرياض", salePrice: 999999, district: "النخيل" }
  );
  assert.notEqual(merged.brokerFields.city, "الرياض");
  assert.notEqual(merged.brokerFields.salePrice, 999999);
  assert.equal(merged.brokerFields.district, "السكب");
});

test("review defaults mark inferred price for review and keep extra dimensions", () => {
  const extraction = extractScreenshotSemantics(CURRENT_SCREENSHOT_EXAMPLE_TEXT);
  const broker = screenshotSemanticsToBrokerFields(extraction);
  const defaults = buildImportSimplifiedReviewDefaults(broker, CURRENT_SCREENSHOT_EXAMPLE_TEXT, {
    extended: broker,
    needsReview: extraction.needsReview,
    allowOfficeCityFallback: false
  }, { city: "الرياض" });
  const patched = applyScreenshotExtractionToReview(extraction, defaults, {});
  assert.equal(patched.salePrice, 850000);
  assert.equal(patched.inferredPrice, true);
  assert.equal(patched.needsReview.price, true);
  assert.equal(patched.depth, 47);
  assert.equal(String(patched.plotNumber), "14");
  assert.match(String(patched.locationUrl), /maps\.app\.goo\.gl/);
});
