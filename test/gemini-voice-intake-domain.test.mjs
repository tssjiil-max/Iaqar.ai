import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeGeminiVoicePayload,
  mapGeminiToOpportunityFields,
  mapGeminiToPublicFormValues,
  mergePrefillRespectingManual,
  buildReviewDefaultsFromGemini,
  validateVoiceBlob,
  createVoiceExtractionAdapter,
} from "../public/js/gemini-voice-intake-domain.js";

test("normalizeGeminiVoicePayload nulls unknown fields", () => {
  const out = normalizeGeminiVoicePayload({
    transactionType: "بيع",
    city: "",
    rooms: "maybe",
    salePrice: "600000",
  });
  assert.equal(out.transactionType, "بيع");
  assert.equal(out.city, null);
  assert.equal(out.rooms, null);
  assert.equal(out.salePrice, 600000);
});

test("office land sale voice mapping suppresses rooms", () => {
  const normalized = normalizeGeminiVoicePayload({
    transactionType: "بيع",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "الرانوناء",
    area: 431,
    salePrice: 580000,
    rooms: 3,
  });
  const mapped = mapGeminiToOpportunityFields(normalized);
  assert.equal(mapped.propertyType, "أرض");
  assert.equal(mapped.rooms, null);
  assert.equal(mapped.bathrooms, null);
  assert.equal(mapped.area, 431);
  assert.equal(mapped.salePrice, 580000);
});

test("manual override beats voice prefill", () => {
  const merged = mergePrefillRespectingManual(
    { advertiserPhone: "0500000000", city: "الرياض" },
    { advertiserPhone: "0511111111", district: "السلام" }
  );
  assert.equal(merged.advertiserPhone, "0500000000");
  assert.equal(merged.district, "السلام");
});

test("public client rent maps budget and rooms", () => {
  const normalized = normalizeGeminiVoicePayload({
    transactionType: "إيجار",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "السلام",
    rooms: 4,
    annualRent: 22000,
  });
  const mapped = mapGeminiToPublicFormValues(normalized, {
    context: "client",
    manualValues: {},
  });
  assert.equal(mapped.requestKind, "rent");
  assert.equal(mapped.rooms, 4);
  assert.equal(mapped.annualRent, 22000);
  assert.equal(mapped.city, "المدينة المنورة");
  assert.equal(mapped.district, "السلام");
});

test("public owner preserves manual phone in merge", () => {
  const normalized = normalizeGeminiVoicePayload({
    transactionType: "بيع",
    propertyType: "شقة",
    district: "العزيزية",
    rooms: 5,
    salePrice: 750000,
    advertiserPhone: "0599999999",
  });
  const voiceFields = mapGeminiToPublicFormValues(normalized, {
    context: "owner",
    manualValues: { phone: "0501234567", name: "أحمد" },
  });
  assert.equal(voiceFields.phone, "0501234567");
  assert.equal(voiceFields.rooms, 5);
});

test("buildReviewDefaultsFromGemini for office land sale", () => {
  const normalized = normalizeGeminiVoicePayload({
    transactionType: "بيع",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "الرانوناء",
    area: 431,
    salePrice: 580000,
  });
  const review = buildReviewDefaultsFromGemini(normalized, "summary");
  assert.equal(review.operationTypeId, "sale");
  assert.equal(review.salePrice, 580000);
  assert.equal(review.city, "المدينة المنورة");
  assert.equal(review.district, "الرانوناء");
  assert.ok(review.rooms == null || review.rooms === "");
});

test("validateVoiceBlob rejects oversize", () => {
  const blob = new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "audio/webm" });
  const result = validateVoiceBlob({ blob });
  assert.equal(result.ok, false);
  assert.equal(result.error, "audio_too_large");
});

test("createVoiceExtractionAdapter produces gemini_voice source", async () => {
  const adapter = createVoiceExtractionAdapter(
    { transactionType: "بيع", propertyType: "شقة" },
    { context: "office" }
  );
  const extracted = await adapter.extract();
  assert.equal(extracted.extractionMode, "gemini_voice_adapter");
  assert.equal(extracted.productionAi, true);
});
