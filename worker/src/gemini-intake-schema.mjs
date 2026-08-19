/**
 * Strict Gemini JSON schemas — no nullable:true; use anyOf for null unions.
 */

import { safeText } from "../../public/js/opportunity-intake-domain.js";

function nullableString() {
  return { anyOf: [{ type: "string" }, { type: "null" }] };
}

function nullableNumber() {
  return { anyOf: [{ type: "number" }, { type: "null" }] };
}

export function geminiIntakeResponseJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      opportunityKind: nullableString(),
      purpose: nullableString(),
      propertyType: nullableString(),
      city: nullableString(),
      district: nullableString(),
      price: nullableNumber(),
      area: nullableNumber(),
      rooms: nullableNumber(),
      bathrooms: nullableNumber(),
      halls: nullableNumber(),
      streetWidth: nullableNumber(),
      facade: nullableString(),
      propertyAge: nullableString(),
      phone: nullableString(),
      rawText: nullableString(),
      confidence: nullableNumber(),
      missingFields: {
        type: "array",
        items: { type: "string" }
      },
      evidence: {
        type: "object",
        additionalProperties: { type: "string" }
      }
    }
  };
}

export function geminiTranscriptionResponseJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      rawText: nullableString(),
      confidence: nullableNumber()
    }
  };
}

export function buildGeminiIntakeGenerationConfig(schema = geminiIntakeResponseJsonSchema()) {
  return {
    temperature: 0,
    responseMimeType: "application/json",
    responseJsonSchema: schema
  };
}

export function sanitizeGeminiIntakeResponse(raw = {}) {
  const out = {};
  for (const key of [
    "opportunityKind", "purpose", "propertyType", "city", "district",
    "facade", "propertyAge", "phone", "rawText"
  ]) {
    const value = raw[key];
    out[key] = value === null || value === undefined ? null : safeText(value, key === "rawText" ? 12000 : 200) || null;
  }
  for (const key of ["price", "area", "rooms", "bathrooms", "halls", "streetWidth", "confidence"]) {
    const value = raw[key];
    if (value === null || value === undefined || value === "") {
      out[key] = null;
      continue;
    }
    const num = Number(value);
    out[key] = Number.isFinite(num) ? num : null;
  }
  out.missingFields = Array.isArray(raw.missingFields)
    ? raw.missingFields.map((item) => safeText(item, 80)).filter(Boolean)
    : [];
  out.evidence = raw.evidence && typeof raw.evidence === "object" && !Array.isArray(raw.evidence)
    ? Object.fromEntries(
      Object.entries(raw.evidence)
        .map(([k, v]) => [safeText(k, 80), safeText(v, 500)])
        .filter(([k, v]) => k && v)
    )
    : {};
  return out;
}

/** Map unified Gemini intake JSON to broker fields used by the app. */
export function mapGeminiIntakeResponseToBrokerFields(response = {}) {
  const payload = sanitizeGeminiIntakeResponse(response);
  const purpose = safeText(payload.purpose, 20).toUpperCase();
  const opportunityKind = safeText(payload.opportunityKind, 20).toUpperCase();
  const broker = {
    opportunityKind,
    purpose,
    propertyType: safeText(payload.propertyType, 40),
    city: safeText(payload.city, 80),
    district: safeText(payload.district, 80),
    area: payload.area,
    rooms: payload.rooms,
    bathrooms: payload.bathrooms,
    livingRoom: payload.halls,
    streetWidth: payload.streetWidth,
    facade: safeText(payload.facade, 40),
    propertyAge: safeText(payload.propertyAge, 40),
    advertiserPhoneRaw: safeText(payload.phone, 40),
    advertiserPhoneNormalized: "",
    salePrice: null,
    annualRent: null,
    budget: null,
    priceOrBudget: null
  };
  if (payload.price != null) {
    if (purpose === "RENT") broker.annualRent = payload.price;
    else if (purpose === "PURCHASE" || opportunityKind === "REQUEST") broker.budget = payload.price;
    else broker.salePrice = payload.price;
    broker.priceOrBudget = payload.price;
  }
  if (broker.facade) broker.direction = broker.facade;
  return broker;
}

/** Backward-compatible vision payload mapping (legacy + unified schema). */
export function mapVisionPayloadToBrokerFields(structured = {}) {
  if (structured.price != null || structured.halls != null || structured.evidence) {
    return mapGeminiIntakeResponseToBrokerFields(structured);
  }
  const legacy = {
    opportunityKind: structured.opportunityKind,
    purpose: structured.transactionType === "rent" ? "RENT"
      : structured.transactionType === "sale" ? "SALE" : structured.purpose,
    propertyType: structured.propertyType,
    city: structured.city,
    district: structured.district,
    price: structured.salePrice ?? structured.annualRent ?? structured.budget ?? null,
    area: structured.area,
    rooms: structured.rooms,
    bathrooms: structured.bathrooms,
    halls: structured.livingRooms,
    streetWidth: structured.streetWidth,
    facade: structured.facade,
    propertyAge: structured.propertyAge,
    phone: structured.advertiserPhone,
    rawText: structured.description,
    confidence: structured.confidence,
    missingFields: structured.needsReview,
    evidence: structured.evidence
  };
  const broker = mapGeminiIntakeResponseToBrokerFields(legacy);
  if (structured.usage) broker.usage = safeText(structured.usage, 40);
  return broker;
}

export const __test = {
  geminiIntakeResponseJsonSchema,
  sanitizeGeminiIntakeResponse,
  mapGeminiIntakeResponseToBrokerFields,
  mapVisionPayloadToBrokerFields
};
