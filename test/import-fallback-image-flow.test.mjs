/**
 * Import fallback URL + image vision flow tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_URL_MESSAGE,
  buildImportProvenanceSummary,
  mergeImageAnalysisWithCanonical,
  importStatusMessageForExtraction
} from "../public/js/canonical-listing-intake-domain.js";
import {
  ANALYZER_PROVIDERS,
  __test as visionTest,
  analyzeListingImageWithGemini,
  analyzeListingImageWithWorkersAi,
  extractListingFromImage,
  mediaExtractPublicMessage
} from "../worker/src/listing-image-vision-service.mjs";
import { resolveCanonicalListingUrl, __test as intakeTest } from "../worker/src/canonical-listing-intake.mjs";

const MINIMAL_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAD0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0)
);
const MINIMAL_JPEG = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0xFF, 0xD9]);

const AQAR_URL = "https://sa.aqar.fm/r/fd2f5397";
const AQAR_NAV_SHELL = `<!DOCTYPE html><html><head><title>عقار</title></head><body>
دور للإيجار شقق للإيجار في الرياض فيلا للبيع</body></html>`;

const AQAR_VISION_STRUCTURED = {
  transactionType: "sale",
  opportunityKind: "OFFER",
  propertyType: "فيلا",
  city: "المدينة المنورة",
  area: 291,
  facade: "غربي",
  rooms: 6,
  livingRooms: 1,
  bathrooms: 7,
  streetWidth: 20,
  propertyAge: "جديد",
  usage: "سكني"
};

test("aqar live-style nav shell resolves fallback_required without broker fields", async () => {
  const resolved = await intakeTest.resolveCanonicalListingUrl({
    originalUrl: AQAR_URL,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "text/html"]]),
      arrayBuffer: async () => new TextEncoder().encode(AQAR_NAV_SHELL).buffer
    })
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.extractionStatus, "fallback_required");
  assert.equal(resolved.adapterId, "aqar");
  assert.equal(resolved.externalListingId, "fd2f5397");
  assert.equal(Boolean(resolved.brokerFields?.purpose && resolved.brokerFields?.propertyType), false);
});

test("fallback URL message is exact Arabic copy", () => {
  assert.equal(FALLBACK_URL_MESSAGE, "تعذر قراءة تفاصيل الرابط. أرفق صورة الإعلان أو الصق نصه لإكمال الاستيراد.");
  assert.equal(importStatusMessageForExtraction({ extractionStatus: "fallback_required" }), FALLBACK_URL_MESSAGE);
});

test("image analysis merges into same canonical intake without duplicate source ids", () => {
  const urlCanonical = {
    originalUrl: AQAR_URL,
    resolvedUrl: AQAR_URL,
    sourceSiteId: "aqar",
    adapterId: "aqar",
    externalListingId: "fd2f5397",
    extractionStatus: "fallback_required",
    classificationStatus: "fallback_required",
    fieldSources: { externalListingId: "site_adapter_aqar" }
  };
  const imageAnalysis = {
    brokerFields: visionTest.mapVisionStructuredToBrokerFields(AQAR_VISION_STRUCTURED),
    fieldSources: visionTest.buildFieldSourcesFromVision(
      visionTest.mapVisionStructuredToBrokerFields(AQAR_VISION_STRUCTURED),
      ANALYZER_PROVIDERS.GEMINI_VISION
    ),
    analyzerProvider: ANALYZER_PROVIDERS.GEMINI_VISION,
    extractionMode: "gemini_vision_adapter",
    extractionStatus: "extracted",
    confidence: 75,
    mediaPath: "opportunity-sources/office-a/src_abc/listing.jpg"
  };
  const merged = mergeImageAnalysisWithCanonical({}, urlCanonical, imageAnalysis);
  assert.equal(merged.fields.opportunityKind, "OFFER");
  assert.equal(merged.fields.purpose, "SALE");
  assert.match(merged.fields.propertyType, /فيلا/);
  assert.match(merged.fields.city, /المدينة المنورة/);
  assert.equal(merged.fields.area, 291);
  assert.equal(merged.fields.livingRoom, 1);
  assert.equal(merged.fields.bathrooms, 7);
  assert.equal(merged.fields.streetWidth, 20);
  assert.equal(merged.fields.facade, "غربي");
  assert.equal(merged.fields.propertyAge, "جديد");
  assert.equal(merged.fields.usage, "سكني");
  assert.equal(merged.extractionStatus, "extracted");
  assert.equal(merged.analyzerProvider, ANALYZER_PROVIDERS.GEMINI_VISION);
  assert.equal(merged.intake.externalListingId, "fd2f5397");
  assert.equal(merged.intake.mediaPath, imageAnalysis.mediaPath);
  assert.equal(merged.fieldSources.city, ANALYZER_PROVIDERS.GEMINI_VISION);
});

test("vision mapping does not invent price phone or district", () => {
  const fields = visionTest.mapVisionStructuredToBrokerFields(AQAR_VISION_STRUCTURED);
  assert.equal(fields.salePrice, null);
  assert.equal(fields.priceOrBudget, null);
  assert.equal(fields.district, "");
  assert.equal(fields.advertiserPhoneNormalized, "");
});

test("Gemini Vision prompt forbids fixed layout assumptions", () => {
  const prompt = visionTest.buildImageSystemPrompt();
  assert.match(prompt, /ALL visible text|rawText/i);
  assert.match(prompt, /Do not assume a fixed layout|Ignore layout position/i);
  assert.doesNotMatch(prompt, /header is always|footer is always|top of the image is phone/i);
});

test("Gemini Vision primary path returns analyzer provider", async () => {
  const geminiResponse = {
    candidates: [{
      content: {
        parts: [{ text: JSON.stringify(AQAR_VISION_STRUCTURED) }]
      }
    }]
  };
  const result = await analyzeListingImageWithGemini({
    env: { GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-test" },
    imageBytes: MINIMAL_PNG,
    mimeType: "image/png",
    fetchImpl: async (_url, init) => {
      assert.equal(init?.headers?.["x-goog-api-key"], "test-key");
      return {
        ok: true,
        text: async () => JSON.stringify(geminiResponse)
      };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.analyzerProvider, ANALYZER_PROVIDERS.GEMINI_VISION);
  assert.equal(result.brokerFields.opportunityKind, "OFFER");
});

test("Workers AI OCR text is classified semantically without layout", async () => {
  const listingText = `المطلوب 850 صافي
أرض حي السكب المدينة المنورة
1175م شارع جنوبي 10م الواجهة 25م العمق 47م رقم القطعة 14
للتواصل 0530899289`;
  const result = await extractListingFromImage({
    env: { AI: {} },
    imageBytes: MINIMAL_JPEG,
    mimeType: "image/jpeg",
    runLlamaVisionExtract: async () => listingText,
    parseRealEstateMessage: () => ({ legacyFields: {}, confidence: 0 })
  });
  assert.equal(result.ok, true);
  assert.equal(result.brokerFields.propertyType, "أرض");
  assert.equal(result.brokerFields.district, "السكب");
  assert.equal(result.brokerFields.city, "المدينة المنورة");
  assert.equal(result.brokerFields.area, 1175);
  assert.equal(result.brokerFields.salePrice, 850000);
  assert.equal(result.brokerFields.streetWidth, 10);
  assert.equal(result.brokerFields.depth, 47);
  assert.equal(String(result.brokerFields.plotNumber), "14");
  assert.equal(result.brokerFields.advertiserPhoneRaw, "0530899289");
});

test("Workers AI fallback when Gemini unavailable", async () => {
  const listingText = "فيلا للبيع في المدينة المنورة المساحة 291 6 غرف 7 دورات مياه";
  const result = await extractListingFromImage({
    env: { AI: {} },
    imageBytes: MINIMAL_JPEG,
    mimeType: "image/jpeg",
    runLlamaVisionExtract: async () => listingText,
    parseRealEstateMessage: (text) => ({
      kind: "owner_offer",
      transactionType: "sale",
      propertyType: "فيلا",
      city: "المدينة المنورة",
      area: 291,
      rooms: 6,
      bathrooms: 7,
      confidence: 60,
      legacyFields: {
        opportunityKind: "OFFER",
        purpose: "SALE",
        propertyType: "فيلا",
        city: "المدينة المنورة",
        area: 291,
        rooms: 6,
        bathrooms: 7
      }
    })
  });
  assert.equal(result.ok, true);
  assert.equal(result.analyzerProvider, ANALYZER_PROVIDERS.WORKERS_AI_VISION);
  assert.equal(result.brokerFields?.opportunityKind, "OFFER");
  assert.equal(result.brokerFields?.purpose, "SALE");
});

test("provider failures do not fabricate listing fields", async () => {
  const result = await extractListingFromImage({
    env: {},
    imageBytes: new Uint8Array([1]),
    mimeType: "image/png",
    runLlamaVisionExtract: async () => "",
    parseRealEstateMessage: () => ({ legacyFields: {}, confidence: 0 })
  });
  assert.equal(result.ok, false);
  assert.ok(result.error);
  assert.equal(visionTest.hasExtractableListingFields(result.brokerFields || {}), false);
});

test("R2 media path must stay office-scoped", () => {
  const officeAPath = "opportunity-sources/office-a/src_hash/file.jpg";
  const officeBPath = "opportunity-sources/office-b/src_hash/file.jpg";
  assert.match(officeAPath, /^opportunity-sources\/office-a\//);
  assert.doesNotMatch(officeAPath, /office-b/);
  assert.notEqual(officeAPath, officeBPath);
});

test("Arabic media extract errors are specific", () => {
  assert.match(mediaExtractPublicMessage("media_ai_failed", { geminiError: "x", workersError: "y" }), /تعذر قراءة الصورة/);
  assert.match(mediaExtractPublicMessage("empty_listing_text"), /تعذر قراءة الصورة/);
});

test("review provenance mentions link image and analyzer", () => {
  const summary = buildImportProvenanceSummary({
    canonical: { originalUrl: AQAR_URL, mediaPath: "opportunity-sources/x/y.jpg" },
    extraction: { analyzerProvider: "gemini_vision" },
    sourceSite: "عقار"
  });
  assert.match(summary, /رابط/);
  assert.match(summary, /صورة/);
  assert.match(summary, /Gemini Vision/);
});
