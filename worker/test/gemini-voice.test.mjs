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

test("buildGeminiVoiceGenerationConfig uses responseJsonSchema only", () => {
  const config = buildGeminiVoiceGenerationConfig();
  assert.equal(config.responseMimeType, "application/json");
  assert.ok(config.responseJsonSchema);
  assert.equal(config.responseSchema, undefined);
  assert.equal(config.responseJsonSchema.type, "object");
  assert.equal(config.responseJsonSchema.properties.needsReview.type, "array");
  assert.deepEqual(config.responseJsonSchema.properties.needsReview.items, { type: "string" });
  assert.equal(config.responseJsonSchema.additionalProperties, undefined);
  assert.equal(
    Object.keys(config.responseJsonSchema.properties).length,
    Object.keys(voiceResponseJsonSchema().properties).length
  );
});

test("analyzeVoiceWithGemini sends responseJsonSchema not responseSchema", async () => {
  resetVoiceTelemetryForTests();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  let capturedBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body || "{}"));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ city: "الرياض", needsReview: ["salePrice"] }) }] } }]
      }),
    };
  };

  try {
    const result = await analyzeVoiceWithGemini({
      env: { GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-3.1-flash-lite" },
      audioBytes: bytes,
      mimeType: "audio/webm",
      context: "owner",
    });
    assert.equal(result.ok, true);
    assert.equal(capturedBody.generationConfig.responseMimeType, "application/json");
    assert.ok(capturedBody.generationConfig.responseJsonSchema);
    assert.equal(capturedBody.generationConfig.responseSchema, undefined);
    assert.deepEqual(result.structured.needsReview, { salePrice: true });
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

test("analyzeVoiceWithGemini parses structured JSON on success", async () => {
  resetVoiceTelemetryForTests();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const fakeResponse = {
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                transactionType: "بيع",
                propertyType: "أرض",
                city: "المدينة المنورة",
                district: "الرانوناء",
                area: 431,
                salePrice: 580000,
                rooms: null,
              }),
            },
          ],
        },
      },
    ],
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(fakeResponse),
  });

  try {
    const result = await analyzeVoiceWithGemini({
      env: { GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-2.0-flash-lite" },
      audioBytes: bytes,
      mimeType: "audio/webm",
      context: "office",
    });
    assert.equal(result.ok, true);
    assert.equal(result.structured.propertyType, "أرض");
    assert.equal(result.structured.rooms, null);
    const telemetry = getVoiceTelemetrySnapshot();
    assert.equal(telemetry.success, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
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
