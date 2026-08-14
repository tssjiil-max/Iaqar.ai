import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  buildReviewDefaults,
  reviewValuesToBrokerFields
} from "../public/js/reference-catalog.js";
import {
  mapGeminiToPublicFormValues,
  normalizeGeminiVoicePayload,
  buildReviewDefaultsFromGemini,
  mergePrefillRespectingManual
} from "../public/js/gemini-voice-intake-domain.js";

test("office review defaults expose editable city and district text", () => {
  const defaults = buildReviewDefaults({
    purpose: "SALE",
    opportunityKind: "OFFER",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "العزيزية"
  }, "أرض للبيع في العزيزية");
  assert.equal(defaults.city, "المدينة المنورة");
  assert.equal(defaults.district, "العزيزية");
});

test("office voice review prefill keeps city and district text", () => {
  const normalized = normalizeGeminiVoicePayload({
    transactionType: "بيع",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "العزيزية",
    area: 431,
    salePrice: 580000
  });
  const review = buildReviewDefaultsFromGemini(normalized, "summary");
  assert.equal(review.city, "المدينة المنورة");
  assert.equal(review.district, "العزيزية");
});

test("public client voice maps city and district for text inputs", () => {
  const normalized = normalizeGeminiVoicePayload({
    transactionType: "إيجار",
    propertyType: "شقة",
    city: "المدينة المنورة",
    district: "السلام",
    annualRent: 22000
  });
  const mapped = mapGeminiToPublicFormValues(normalized, {
    context: "client",
    manualValues: {}
  });
  assert.equal(mapped.city, "المدينة المنورة");
  assert.equal(mapped.district, "السلام");
});

test("public owner voice maps city and district for text inputs", () => {
  const normalized = normalizeGeminiVoicePayload({
    transactionType: "بيع",
    propertyType: "فيلا",
    city: "المدينة المنورة",
    district: "العزيزية",
    salePrice: 900000
  });
  const mapped = mapGeminiToPublicFormValues(normalized, {
    context: "owner",
    manualValues: {}
  });
  assert.equal(mapped.city, "المدينة المنورة");
  assert.equal(mapped.district, "العزيزية");
});

test("manual city and district override voice prefill", () => {
  const merged = mergePrefillRespectingManual(
    { city: "جدة", district: "الروضة" },
    { city: "المدينة المنورة", district: "العزيزية" }
  );
  assert.equal(merged.city, "جدة");
  assert.equal(merged.district, "الروضة");
});

test("public intake form uses text inputs for city and district", () => {
  const dom = new JSDOM(`<!DOCTYPE html><form id="intakeForm">
    <input name="city" id="intakeCityInput">
    <input name="district" id="intakeDistrictInput">
  </form>`);
  const form = dom.window.document.getElementById("intakeForm");
  const city = form.querySelector("#intakeCityInput");
  const district = form.querySelector("#intakeDistrictInput");
  assert.equal(city?.tagName, "INPUT");
  assert.equal(district?.tagName, "INPUT");
  city.value = "المدينة المنورة";
  district.value = "العزيزية";
  assert.equal(form.elements.city.value, "المدينة المنورة");
  assert.equal(form.elements.district.value, "العزيزية");
});

test("reviewValuesToBrokerFields normalizes trimmed location text", () => {
  const broker = reviewValuesToBrokerFields({
    operationTypeId: "sale",
    propertyTypeId: "apartment",
    city: "  المدينة المنورة ",
    district: " العزيزية ",
    salePrice: "1000000",
    extractedSnapshot: null
  });
  assert.equal(broker.city, "المدينة المنورة");
  assert.equal(broker.district, "العزيزية");
});
