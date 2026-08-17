import test from "node:test";
import assert from "node:assert/strict";
import {
  validateVoiceAudio,
  analyzeVoiceWithGemini,
  resolveGeminiModel,
  resetVoiceTelemetryForTests,
  getVoiceTelemetrySnapshot,
  voiceResponseJsonSchema,
  buildGeminiVoiceGenerationConfig,
  brokerFieldsToVoiceStructured
} from "../src/gemini-voice-service.js";

test("resolveGeminiModel uses env override", () => {
  assert.equal(resolveGeminiModel({ GEMINI_MODEL: "custom-model" }), "custom-model");
  assert.equal(resolveGeminiModel({}), "gemini-3.1-flash-lite");
});

test("validateVoiceAudio rejects bad mime", () => {
  const result = validateVoiceAudio({ byteSize: 3, mimeType: "application/pdf", durationSec: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.error, "audio_mime_invalid");
});

test("validateVoiceAudio rejects oversize", () => {
  const result = validateVoiceAudio({ byteSize: 6 * 1024 * 1024, mimeType: "audio/webm", durationSec: 10 });
  assert.equal(result.ok, false);
  assert.equal(result.error, "audio_too_large");
});

test("validateVoiceAudio accepts webm under limit", () => {
  const result = validateVoiceAudio({ byteSize: 1000, mimeType: "audio/webm", durationSec: 30 });
  assert.equal(result.ok, true);
});

test("buildGeminiVoiceGenerationConfig uses transcription schema", () => {
  const config = buildGeminiVoiceGenerationConfig();
  assert.equal(config.responseMimeType, "application/json");
  assert.ok(config.responseJsonSchema);
  assert.equal(config.temperature, 0);
  assert.ok(config.responseJsonSchema.properties.rawText);
  assert.ok(config.responseJsonSchema.properties.confidence);
  assert.equal(
    Object.keys(config.responseJsonSchema.properties).length,
    Object.keys(voiceResponseJsonSchema().properties).length
  );
});

test("analyzeVoiceWithGemini sends x-goog-api-key header and transcription schema", async () => {
  resetVoiceTelemetryForTests();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  let capturedHeaders = null;
  let capturedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    capturedHeaders = init?.headers || {};
    capturedBody = JSON.parse(String(init?.body || "{}"));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ rawText: "فيلا للبيع في الرياض", confidence: 0.9 }) }] } }]
      }),
    };
  };

  try {
    const result = await analyzeVoiceWithGemini({
      env: { GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-3.1-flash-lite" },
      audioBytes: bytes,
      mimeType: "audio/webm",
      context: "owner",
      parseRealEstateMessage: () => ({
        kind: "owner_offer",
        transactionType: "sale",
        propertyType: "فيلا",
        city: "الرياض",
        confidence: 0.8,
        legacyFields: { opportunityKind: "OFFER", purpose: "SALE", propertyType: "فيلا", city: "الرياض" }
      })
    });
    assert.equal(result.ok, true);
    assert.equal(capturedHeaders["x-goog-api-key"], "test-key");
    assert.equal(capturedBody.generationConfig.responseMimeType, "application/json");
    assert.ok(capturedBody.generationConfig.responseJsonSchema);
    assert.equal(result.structured.propertyType, "فيلا");
    assert.equal(result.transcript, "فيلا للبيع في الرياض");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("analyzeVoiceWithGemini returns not configured without key", async () => {
  resetVoiceTelemetryForTests();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const result = await analyzeVoiceWithGemini({
    env: {},
    audioBytes: bytes,
    mimeType: "audio/webm",
    context: "office",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "GEMINI_NOT_CONFIGURED");
});

test("analyzeVoiceWithGemini maps quota errors", async () => {
  resetVoiceTelemetryForTests();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    text: async () => "quota exceeded",
  });

  try {
    const result = await analyzeVoiceWithGemini({
      env: { GEMINI_API_KEY: "test-key" },
      audioBytes: bytes,
      mimeType: "audio/webm",
      context: "client",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "GEMINI_QUOTA_EXCEEDED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("brokerFieldsToVoiceStructured maps purpose to Arabic transaction type", () => {
  const structured = brokerFieldsToVoiceStructured({ purpose: "SALE", propertyType: "أرض", city: "المدينة المنورة" }, "نص");
  assert.equal(structured.transactionType, "بيع");
  assert.equal(structured.propertyType, "أرض");
  assert.equal(structured.city, "المدينة المنورة");
});
