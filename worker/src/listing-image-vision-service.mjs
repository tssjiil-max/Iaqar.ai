/**
 * Listing image vision — Gemini Vision primary, Workers AI Vision fallback.
 * Server-side only; never expose API keys to the browser.
 */

import { bytesToBase64, resolveGeminiModel } from "./gemini-voice-service.js";
import { mapGeminiToOpportunityFields, normalizeGeminiVoicePayload } from "../../public/js/gemini-voice-intake-domain.js";
import { safeText } from "../../public/js/opportunity-intake-domain.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const ANALYZER_PROVIDERS = Object.freeze({
  GEMINI_VISION: "gemini_vision",
  WORKERS_AI_VISION: "workers_ai_vision"
});

export function listingImageResponseJsonSchema() {
  return {
    type: "object",
    properties: {
      transactionType: { type: "string", nullable: true },
      opportunityKind: { type: "string", nullable: true },
      propertyType: { type: "string", nullable: true },
      city: { type: "string", nullable: true },
      district: { type: "string", nullable: true },
      salePrice: { type: "number", nullable: true },
      annualRent: { type: "number", nullable: true },
      area: { type: "number", nullable: true },
      rooms: { type: "number", nullable: true },
      livingRooms: { type: "number", nullable: true },
      bathrooms: { type: "number", nullable: true },
      streetWidth: { type: "number", nullable: true },
      facade: { type: "string", nullable: true },
      propertyAge: { type: "string", nullable: true },
      usage: { type: "string", nullable: true },
      advertiserPhone: { type: "string", nullable: true },
      description: { type: "string", nullable: true },
      needsReview: {
        type: "array",
        nullable: true,
        items: { type: "string" }
      }
    }
  };
}

function buildImageSystemPrompt() {
  return [
    "You extract structured real-estate listing data from Arabic property advertisement screenshots for IAQAR.AI.",
    "Read only text clearly visible in the image.",
    "Return JSON only. Use null for any field not explicitly visible.",
    "Never guess price, phone, district, or contact unless clearly shown.",
    "transactionType: sale or rent when visible.",
    "opportunityKind: OFFER for listings for sale/rent; REQUEST only if clearly a buyer/tenant request.",
    "propertyType: use Arabic label (فيلا, شقة, أرض, etc.).",
    "facade: cardinal direction in Arabic (غربي, شرقي, etc.) when shown.",
    "propertyAge: جديد or age text when shown.",
    "usage: سكني or تجاري when shown."
  ].join("\n");
}

function parseGeminiJsonResponse(responseJson) {
  const text = responseJson?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!text) throw new Error("GEMINI_EMPTY_RESPONSE");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("GEMINI_PARSE_FAILED");
    parsed = JSON.parse(match[0]);
  }
  return parsed;
}

export function mapVisionStructuredToBrokerFields(structured = {}) {
  const payload = normalizeGeminiVoicePayload(structured);
  const brokerFields = mapGeminiToOpportunityFields(structured);
  if (structured.opportunityKind) {
    brokerFields.opportunityKind = safeText(structured.opportunityKind, 20).toUpperCase();
  }
  if (structured.livingRooms != null) {
    brokerFields.livingRoom = Number(structured.livingRooms);
  }
  if (structured.streetWidth != null) {
    brokerFields.streetWidth = Number(structured.streetWidth);
  }
  if (structured.facade) {
    brokerFields.facade = safeText(structured.facade, 40);
    brokerFields.direction = brokerFields.facade;
  }
  if (structured.propertyAge) {
    brokerFields.propertyAge = safeText(structured.propertyAge, 40);
  }
  if (structured.usage) {
    brokerFields.usage = safeText(structured.usage, 40);
  }
  return brokerFields;
}

export function buildFieldSourcesFromVision(brokerFields = {}, analyzerProvider = "") {
  const sources = {};
  const provider = safeText(analyzerProvider, 40);
  for (const [key, value] of Object.entries(brokerFields)) {
    if (value === null || value === undefined || String(value).trim() === "") continue;
    sources[key] = provider;
  }
  return sources;
}

export function hasExtractableListingFields(brokerFields = {}) {
  if (!brokerFields || typeof brokerFields !== "object") return false;
  const core = [
    brokerFields.opportunityKind,
    brokerFields.purpose,
    brokerFields.propertyType,
    brokerFields.city,
    brokerFields.area
  ];
  return core.some((value) => value !== null && value !== undefined && String(value).trim() !== "");
}

export function buildListingTextFromBrokerFields(brokerFields = {}) {
  return [
    brokerFields.opportunityKind === "OFFER" ? "عرض" : brokerFields.opportunityKind === "REQUEST" ? "طلب" : "",
    brokerFields.purpose === "SALE" ? "للبيع" : brokerFields.purpose === "RENT" ? "للإيجار" : "",
    brokerFields.propertyType,
    brokerFields.city,
    brokerFields.district,
    brokerFields.area != null ? `المساحة ${brokerFields.area}` : "",
    brokerFields.rooms != null ? `${brokerFields.rooms} غرف` : "",
    brokerFields.bathrooms != null ? `${brokerFields.bathrooms} دورات مياه` : "",
    brokerFields.livingRoom != null ? `${brokerFields.livingRoom} صالة` : "",
    brokerFields.streetWidth != null ? `عرض الشارع ${brokerFields.streetWidth}` : "",
    brokerFields.facade ? `واجهة ${brokerFields.facade}` : "",
    brokerFields.propertyAge ? `عمر العقار ${brokerFields.propertyAge}` : "",
    brokerFields.usage ? `الاستخدام ${brokerFields.usage}` : ""
  ].filter(Boolean).join(" ").trim();
}

export function mapParsedLegacyToBrokerFields(parsed = {}) {
  const legacy = parsed.legacyFields || parsed;
  const kind = parsed.kind === "owner_offer" ? "OFFER"
    : (parsed.kind === "client_request" ? "REQUEST" : "");
  const purpose = parsed.transactionType === "rent" ? "RENT"
    : (parsed.transactionType === "sale" ? "SALE" : "");
  return {
    opportunityKind: safeText(legacy.opportunityKind || kind, 20),
    purpose: safeText(legacy.purpose || purpose, 30),
    propertyType: safeText(legacy.propertyType || parsed.propertyType, 40),
    city: safeText(legacy.city || parsed.city, 80),
    district: safeText(legacy.district || parsed.district, 80),
    area: legacy.area ?? parsed.area ?? null,
    rooms: legacy.rooms ?? parsed.rooms ?? null,
    bathrooms: legacy.bathrooms ?? parsed.bathrooms ?? null,
    livingRoom: legacy.livingRoom ?? parsed.livingRooms ?? null,
    streetWidth: legacy.streetWidth ?? parsed.streetWidth ?? null,
    priceOrBudget: legacy.priceOrBudget ?? parsed.price ?? null
  };
}

export async function analyzeListingImageWithGemini({
  env,
  imageBytes,
  mimeType,
  fetchImpl = fetch
} = {}) {
  const apiKey = String(env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    return { ok: false, error: "GEMINI_NOT_CONFIGURED", retryable: false };
  }
  const model = resolveGeminiModel(env);
  const base64 = bytesToBase64(imageBytes instanceof Uint8Array ? imageBytes : new Uint8Array(imageBytes));
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const started = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildImageSystemPrompt() }] },
        contents: [{
          role: "user",
          parts: [
            { text: "Extract structured listing data from this Arabic real-estate advertisement image. Return JSON only." },
            { inline_data: { mime_type: mimeType, data: base64 } }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          responseJsonSchema: listingImageResponseJsonSchema()
        }
      })
    });
    const bodyText = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        error: response.status === 429 ? "GEMINI_QUOTA_EXCEEDED" : "GEMINI_API_FAILED",
        retryable: true,
        model,
        latencyMs: Date.now() - started
      };
    }
    const json = JSON.parse(bodyText);
    const structured = parseGeminiJsonResponse(json);
    const brokerFields = mapVisionStructuredToBrokerFields(structured);
    const rawText = buildListingTextFromBrokerFields(brokerFields)
      || safeText(structured.description, 12000);
    return {
      ok: true,
      structured,
      brokerFields,
      rawText,
      model,
      analyzerProvider: ANALYZER_PROVIDERS.GEMINI_VISION,
      extractionMode: "gemini_vision_adapter",
      confidence: hasExtractableListingFields(brokerFields) ? 75 : 35,
      latencyMs: Date.now() - started,
      productionAi: true
    };
  } catch (error) {
    return {
      ok: false,
      error: "GEMINI_VISION_FAILED",
      retryable: true,
      model,
      latencyMs: Date.now() - started,
      detail: String(error?.message || error).slice(0, 120)
    };
  }
}

export async function analyzeListingImageWithWorkersAi({
  env,
  imageBytes,
  mimeType,
  runLlamaVisionExtract
} = {}) {
  if (!env.AI || typeof runLlamaVisionExtract !== "function") {
    return { ok: false, error: "WORKERS_AI_UNAVAILABLE" };
  }
  const dataUrl = `data:${mimeType};base64,${bytesToBase64(imageBytes)}`;
  const visionInput = {
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "اقرأ النص العربي الظاهر في صورة إعلان عقاري حرفياً فقط. لا تخترع. أعد النص المقروء فقط." },
        { type: "image_url", image_url: { url: dataUrl } }
      ]
    }],
    max_tokens: 2048
  };
  try {
    const aiResult = await runLlamaVisionExtract(env, visionInput);
    const rawText = typeof aiResult === "string"
      ? aiResult
      : String(aiResult?.response || aiResult?.result?.response || aiResult?.result || "");
    const text = safeText(rawText, 12000);
    if (!text) return { ok: false, error: "empty_listing_text" };
    return {
      ok: true,
      text,
      analyzerProvider: ANALYZER_PROVIDERS.WORKERS_AI_VISION,
      extractionMode: "workers_ai_vision_adapter",
      productionAi: false
    };
  } catch (error) {
    return { ok: false, error: "WORKERS_AI_VISION_FAILED", detail: String(error?.message || error).slice(0, 120) };
  }
}

export async function extractListingFromImage({
  env,
  imageBytes,
  mimeType,
  runLlamaVisionExtract,
  parseRealEstateMessage,
  fetchImpl = fetch
} = {}) {
  const gemini = await analyzeListingImageWithGemini({ env, imageBytes, mimeType, fetchImpl });
  if (gemini.ok && hasExtractableListingFields(gemini.brokerFields)) {
    return {
      ok: true,
      text: gemini.rawText || "",
      brokerFields: gemini.brokerFields,
      fieldSources: buildFieldSourcesFromVision(gemini.brokerFields, ANALYZER_PROVIDERS.GEMINI_VISION),
      analyzerProvider: ANALYZER_PROVIDERS.GEMINI_VISION,
      extractionMode: gemini.extractionMode,
      confidence: gemini.confidence,
      extractionStatus: "extracted",
      productionAi: gemini.productionAi,
      model: gemini.model
    };
  }

  const workers = await analyzeListingImageWithWorkersAi({
    env,
    imageBytes,
    mimeType,
    runLlamaVisionExtract
  });
  if (!workers.ok) {
    return {
      ok: false,
      error: workers.error || gemini.error || "media_ai_failed",
      geminiError: gemini.error || "",
      workersError: workers.error || ""
    };
  }

  const parsed = typeof parseRealEstateMessage === "function"
    ? parseRealEstateMessage(workers.text || "", "", "")
    : null;
  const brokerFields = parsed ? mapParsedLegacyToBrokerFields(parsed) : {};
  const hasFields = hasExtractableListingFields(brokerFields);
  if (!workers.text && !hasFields) {
    return { ok: false, error: "empty_listing_text", geminiError: gemini.error || "" };
  }

  return {
    ok: true,
    text: workers.text,
    brokerFields,
    fieldSources: buildFieldSourcesFromVision(brokerFields, ANALYZER_PROVIDERS.WORKERS_AI_VISION),
    analyzerProvider: ANALYZER_PROVIDERS.WORKERS_AI_VISION,
    extractionMode: workers.extractionMode,
    confidence: hasFields ? Math.max(Number(parsed?.confidence || 0), 45) : 25,
    extractionStatus: hasFields ? "extracted" : "needs_review",
    productionAi: false,
    geminiAttempted: Boolean(gemini.error !== "GEMINI_NOT_CONFIGURED"),
    geminiError: gemini.error || ""
  };
}

export function mediaExtractPublicMessage(error = "", detail = {}) {
  const code = safeText(error, 80);
  const map = {
    fallback_required: "تعذر قراءة تفاصيل الرابط. أرفق صورة الإعلان أو الصق نصه لإكمال الاستيراد.",
    media_not_found: "الملف غير موجود على الخادم. أعد رفع الصورة.",
    media_scope_mismatch: "الصورة لا تتبع مكتبك. أعد تسجيل الدخول ثم ارفعها مجددًا.",
    media_extraction_unavailable: "خدمة تحليل الصور غير متاحة حاليًا.",
    media_ai_failed: "تعذر تحليل الصورة بالذكاء الاصطناعي. حاول صورة أوضح أو الصق نص الإعلان.",
    WORKERS_AI_VISION_FAILED: "تعذر تحليل الصورة عبر Workers AI. حاول صورة أوضح أو الصق نص الإعلان.",
    GEMINI_VISION_FAILED: "تعذر تحليل الصورة عبر Gemini. جارٍ المحاولة بالبديل أو أكمل يدويًا.",
    GEMINI_NOT_CONFIGURED: "Gemini غير مهيأ. سيتم استخدام Workers AI.",
    empty_listing_text: "لم نقرأ نصًا كافيًا من الصورة. حاول صورة أوضح أو الصق نص الإعلان.",
    unsupported_media: "صيغة الصورة غير مدعومة.",
    invalid_media_target: "مسار تخزين الصورة غير صالح.",
    media_type_mismatch: "نوع الملف لا يطابق الصورة المرفوعة.",
    response_too_large: "حجم الصورة كبير جدًا.",
    upload_failed: "تعذر رفع الصورة. تحقق من الاتصال ثم أعد المحاولة.",
    worker_base_missing: "تعذر الاتصال بالخادم.",
    media_path_missing: "لم يُحفظ مسار الصورة. أعد رفع الصورة."
  };
  if (detail?.geminiError && detail?.workersError) {
    return "تعذر تحليل الصورة بعد محاولة Gemini وWorkers AI. أرفق صورة أوضح أو الصق نص الإعلان.";
  }
  if (map[code]) return map[code];
  return "تعذر تحليل صورة الإعلان";
}

export const __test = {
  mapVisionStructuredToBrokerFields,
  hasExtractableListingFields,
  buildListingTextFromBrokerFields,
  buildFieldSourcesFromVision,
  mediaExtractPublicMessage
};
