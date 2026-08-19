import test from "node:test";
import assert from "node:assert/strict";
import { transcribeAudioWithOpenAI, resolveOpenAiWhisperModel } from "../src/openai-voice-service.mjs";
import { extractListingFromAudio } from "../src/gemini-audio-intake.mjs";

test("resolveOpenAiWhisperModel defaults to whisper-1", () => {
  assert.equal(resolveOpenAiWhisperModel({}), "whisper-1");
  assert.equal(resolveOpenAiWhisperModel({ OPENAI_WHISPER_MODEL: "whisper-1" }), "whisper-1");
});

test("transcribeAudioWithOpenAI returns openai provider on success", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const fetchImpl = async (_url, init) => {
    assert.match(String(init?.headers?.Authorization || ""), /^Bearer test-openai-key$/);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ text: "فيلا للبيع في المدينة المنورة حي العريض جوال صفر خمسة صفر" })
    };
  };
  const result = await transcribeAudioWithOpenAI({
    env: { OPENAI_API_KEY: "test-openai-key" },
    audioBytes: bytes,
    mimeType: "audio/webm",
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "openai");
  assert.equal(result.analyzerProvider, "openai_whisper");
  assert.match(result.rawText, /المدينة المنورة/);
});

test("extractListingFromAudio prefers OpenAI and preserves Arabic location fields", async () => {
  const parseRealEstateMessage = (text) => ({
    kind: "owner_offer",
    transactionType: "sale",
    propertyType: "فيلا",
    city: "المدينة المنورة",
    district: "العريض",
    phone: "+966501234567",
    confidence: 0.9,
    legacyFields: {
      opportunityKind: "OFFER",
      purpose: "SALE",
      propertyType: "فيلا",
      city: "المدينة المنورة",
      district: "العريض",
      advertiserPhoneRaw: "0501234567"
    }
  });
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      text: "عرض للبيع فيلا في المدينة المنورة حي العريض جوال صفر خمسة صفر واحد اثنين ثلاثة أربعة خمسة ستة"
    })
  });
  const result = await extractListingFromAudio({
    env: { OPENAI_API_KEY: "test-openai-key" },
    audioBytes: new Uint8Array([9, 8, 7]),
    mimeType: "audio/webm",
    parseRealEstateMessage,
    fetchImpl
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "openai");
  assert.equal(result.brokerFields.propertyType, "فيلا");
  assert.equal(result.brokerFields.city, "المدينة المنورة");
  assert.equal(result.brokerFields.district, "العريض");
  assert.notEqual(result.brokerFields.city, "madinah");
  assert.notEqual(result.brokerFields.district, "al_ariyd");
});
