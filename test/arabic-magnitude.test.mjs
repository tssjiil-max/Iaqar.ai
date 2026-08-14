import test from "node:test";
import assert from "node:assert/strict";
import {
  applyMagnitude,
  extractAnnualRentAmount,
  extractMonetaryAmount,
  normalizeArabicMagnitudeNumber,
  parseArabicMagnitudePhrase,
  parseArabicNumberWords
} from "../public/js/arabic-magnitude.js";
import { extractArabicOpportunityText } from "../public/js/opportunity-text-extraction.js";
import {
  mapGeminiToOpportunityFields,
  normalizeGeminiVoicePayload
} from "../public/js/gemini-voice-intake-domain.js";

test("50 مليون → 50000000", () => {
  const result = extractMonetaryAmount("المطلوب 50 مليون");
  assert.equal(result?.amount, 50_000_000);
});

test("٥٠ مليون → 50000000", () => {
  const result = extractMonetaryAmount("المطلوب ٥٠ مليون");
  assert.equal(result?.amount, 50_000_000);
});

test("خمسين مليون → 50000000", () => {
  const result = extractMonetaryAmount("المطلوب خمسين مليون");
  assert.equal(result?.amount, 50_000_000);
});

test("2 مليون → 2000000", () => {
  assert.equal(parseArabicMagnitudePhrase("2 مليون"), 2_000_000);
});

test("500 ألف → 500000", () => {
  assert.equal(parseArabicMagnitudePhrase("500 ألف"), 500_000);
});

test("خمسمائة ألف → 500000", () => {
  assert.equal(parseArabicMagnitudePhrase("خمسمائة ألف"), 500_000);
});

test("1.5 مليون → 1500000", () => {
  assert.equal(parseArabicMagnitudePhrase("1.5 مليون"), 1_500_000);
});

test("30 ألف بالسنة → 30000", () => {
  const result = extractAnnualRentAmount("الإيجار 30 ألف بالسنة");
  assert.equal(result?.amount, 30_000);
});

test("area is not corrupted by magnitude parser", () => {
  const result = extractArabicOpportunityText(
    "أرض تجارية استثمارية للبيع\nالمدينة المنورة\nمساحتها 50000\nالمطلوب 50 مليون\nجوال 0552019909"
  );
  assert.equal(result.publicShape.area, 50000);
  assert.equal(result.publicShape.salePrice, 50_000_000);
  assert.equal(result.publicShape.city, "المدينة المنورة");
});

test("street width and plot number are not magnitude-scaled", () => {
  const areaOnly = extractArabicOpportunityText("مساحة 50000 متر شارع 30 متر قطعة رقم 50");
  assert.equal(areaOnly.publicShape.area, 50000);
});

test("text extraction real staging acceptance ad", () => {
  const result = extractArabicOpportunityText(
    "أرض تجارية استثمارية للبيع\nالمدينة المنورة\nمساحتها 50000\nالمطلوب 50 مليون\nجوال 0552019909"
  );
  const s = result.publicShape;
  assert.match(s.propertyType || "", /أرض/);
  assert.equal(s.city, "المدينة المنورة");
  assert.equal(s.salePrice, 50_000_000);
  assert.equal(s.area, 50000);
});

test("voice mapping reconciles underscaled Gemini salePrice from transcript text", () => {
  const structured = normalizeGeminiVoicePayload({
    transactionType: "بيع",
    propertyType: "أرض",
    city: "المدينة المنورة",
    salePrice: 50,
    description: "المطلوب خمسين مليون"
  });
  const mapped = mapGeminiToOpportunityFields(structured, {
    context: "office",
    sourceText: "أرض للبيع المدينة المنورة المطلوب خمسين مليون"
  });
  assert.equal(mapped.salePrice, 50_000_000);
});

test("parseArabicNumberWords supports خمسين", () => {
  assert.equal(parseArabicNumberWords("خمسين"), 50);
  assert.equal(applyMagnitude(parseArabicNumberWords("خمسين"), "مليون"), 50_000_000);
});
