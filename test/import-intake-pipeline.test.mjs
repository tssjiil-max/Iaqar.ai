/**
 * Import intake pipeline — image, audio, URL, SSRF, validation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  validateListingImageBytes,
  prepareListingImageForAnalysis,
  __test as imagePrepareTest
} from "../worker/src/listing-image-prepare.mjs";
import {
  __test as visionTest,
  mapVisionStructuredToBrokerFields,
  mediaExtractPublicMessage
} from "../worker/src/listing-image-vision-service.mjs";
import {
  __test as audioTest,
  parseTranscriptToBrokerFields,
  AUDIO_TRANSCRIBE_ERROR_AR
} from "../worker/src/gemini-audio-intake.mjs";
import { __test as geminiApiTest } from "../worker/src/gemini-api-client.mjs";
import { __test as schemaTest } from "../worker/src/gemini-intake-schema.mjs";
import { brokerFieldsToVoiceStructured } from "../worker/src/gemini-voice-service.js";
import { resolveCanonicalListingUrl, __test as intakeTest } from "../worker/src/canonical-listing-intake.mjs";
import { normalizeListingFetchUrl } from "../worker/src/listing-site-adapters.mjs";

const MINIMAL_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAD0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0)
);
const MINIMAL_JPEG = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0xFF, 0xD9]);

const AQAR_VISION_STRUCTURED = {
  opportunityKind: "OFFER",
  purpose: "SALE",
  propertyType: "فيلا",
  city: "المدينة المنورة",
  area: 291,
  facade: "غربي",
  rooms: 6,
  halls: 1,
  bathrooms: 7,
  streetWidth: 20,
  propertyAge: "جديد",
  usage: "سكني"
};

test("known aqar image fields map without inventing price or district", () => {
  const fields = mapVisionStructuredToBrokerFields(AQAR_VISION_STRUCTURED);
  assert.equal(fields.opportunityKind, "OFFER");
  assert.equal(fields.purpose, "SALE");
  assert.match(fields.propertyType, /فيلا/);
  assert.match(fields.city, /المدينة المنورة/);
  assert.equal(fields.area, 291);
  assert.equal(fields.livingRoom, 1);
  assert.equal(fields.bathrooms, 7);
  assert.equal(fields.streetWidth, 20);
  assert.match(fields.facade, /غرب/);
  assert.equal(fields.propertyAge, "جديد");
  assert.equal(fields.usage, "سكني");
  assert.equal(fields.salePrice, null);
  assert.equal(fields.district, "");
});

test("image validation rejects empty and invalid mime", () => {
  assert.equal(validateListingImageBytes(new Uint8Array(), "image/png").error, "empty_image");
  assert.equal(validateListingImageBytes(MINIMAL_PNG, "application/pdf").error, "unsupported_media");
  assert.equal(validateListingImageBytes(new Uint8Array([1, 2, 3]), "image/png").error, "invalid_image");
});

test("valid png passes magic-byte validation", () => {
  const result = validateListingImageBytes(MINIMAL_PNG, "image/png");
  assert.equal(result.ok, true);
});

test("spoken arabic numbers normalize before parsing", () => {
  const out = audioTest.normalizeSpokenArabicNumbers("مليون ومئتين ريال ومساحة ثلاثمئة متر وخمس غرف");
  assert.match(out, /1200000/);
  assert.match(out, /300 متر/);
  assert.match(out, /5 غرف/);
});

test("audio transcript parser does not invent missing fields", () => {
  const parsed = parseTranscriptToBrokerFields("فيلا للبيع في المدينة المنورة", () => ({
    kind: "owner_offer",
    transactionType: "sale",
    propertyType: "فيلا",
    city: "المدينة المنورة",
    confidence: 0.7,
    legacyFields: { opportunityKind: "OFFER", purpose: "SALE", propertyType: "فيلا", city: "المدينة المنورة" }
  }));
  assert.equal(parsed.brokerFields.opportunityKind, "OFFER");
  assert.equal(parsed.brokerFields.district, "");
  assert.equal(parsed.brokerFields.salePrice, null);
});

test("gemini schema avoids nullable:true", () => {
  const schema = schemaTest.geminiIntakeResponseJsonSchema();
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.city.anyOf.length, 2);
  assert.equal(JSON.stringify(schema).includes("nullable"), false);
});

test("gemini client classifies quota errors", () => {
  assert.equal(geminiApiTest.classifyGeminiHttpFailure(429, "quota"), "GEMINI_QUOTA_EXCEEDED");
});

test("SSRF blocked for localhost and private networks", () => {
  const isPrivate = (host) => {
    const h = String(host || "").toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h.startsWith("192.168.");
  };
  assert.equal(normalizeListingFetchUrl("http://localhost/listing", isPrivate), "");
  assert.equal(normalizeListingFetchUrl("http://127.0.0.1/listing", isPrivate), "");
  assert.equal(normalizeListingFetchUrl("file:///etc/passwd", isPrivate), "");
});

test("aqar URL resolves external listing id", async () => {
  const resolved = await intakeTest.resolveCanonicalListingUrl({
    originalUrl: "https://sa.aqar.fm/r/fd2f5397?utm_source=x",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "text/html"]]),
      arrayBuffer: async () => new TextEncoder().encode("<html><body>nav shell</body></html>").buffer
    })
  });
  assert.equal(resolved.externalListingId, "fd2f5397");
  assert.equal(resolved.extractionStatus, "fallback_required");
});

test("same aqar URL normalizes to same fingerprint inputs", async () => {
  const a = await intakeTest.resolveCanonicalListingUrl({
    originalUrl: "https://sa.aqar.fm/r/fd2f5397?x=1",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "text/html"]]),
      arrayBuffer: async () => new TextEncoder().encode("<html></html>").buffer
    })
  });
  const b = await intakeTest.resolveCanonicalListingUrl({
    originalUrl: "https://sa.aqar.fm/r/fd2f5397?y=2",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "text/html"]]),
      arrayBuffer: async () => new TextEncoder().encode("<html></html>").buffer
    })
  });
  assert.equal(a.externalListingId, b.externalListingId);
  assert.equal(a.adapterId, b.adapterId);
});

test("image read failure message is exact Arabic copy", () => {
  assert.match(mediaExtractPublicMessage("empty_listing_text"), /تعذر قراءة الصورة/);
  assert.equal(AUDIO_TRANSCRIBE_ERROR_AR, "تعذر فهم التسجيل الصوتي. أعد التسجيل بوضوح أو أرسل التفاصيل كتابةً.");
});

test("broker fields map to voice structured payload", () => {
  const structured = brokerFieldsToVoiceStructured({
    purpose: "SALE",
    propertyType: "فيلا",
    city: "المدينة المنورة",
    area: 291
  }, "فيلا للبيع");
  assert.equal(structured.transactionType, "بيع");
  assert.equal(structured.propertyType, "فيلا");
  assert.equal(structured.description, "فيلا للبيع");
});

test("prepare listing image keeps original bytes and analysis bytes", async () => {
  const prepared = await prepareListingImageForAnalysis(MINIMAL_JPEG, "image/jpeg");
  assert.equal(prepared.ok, true);
  assert.ok(prepared.originalBytes.length > 0);
  assert.ok(prepared.analysisBytes.length > 0);
});
