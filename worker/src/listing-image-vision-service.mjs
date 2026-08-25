/**
 * Listing image vision — Gemini Vision primary, Workers AI Vision fallback.
 * Server-side only; never expose API keys to the browser.
 */

import { bytesToBase64, resolveGeminiModel } from "./gemini-voice-service.js";
import { safeText } from "../../public/js/opportunity-intake-domain.js";
import {
  buildGeminiIntakeGenerationConfig,
  geminiIntakeResponseJsonSchema,
  mapVisionPayloadToBrokerFields,
  sanitizeGeminiIntakeResponse
} from "./gemini-intake-schema.mjs";
import { callGeminiGenerateContent } from "./gemini-api-client.mjs";
import { prepareListingImageForAnalysis } from "./listing-image-prepare.mjs";
import { mergeVisionWithScreenshotSemantics } from "../../public/js/screenshot-semantic-extract.js";

export const ANALYZER_PROVIDERS = Object.freeze({
  GEMINI_VISION: "gemini_vision",
  WORKERS_AI_VISION: "workers_ai_vision"
});

export const IMAGE_READ_ERROR_AR = "تعذر قراءة الصورة. أرسل صورة أوضح أو لقطة شاشة كاملة للإعلان.";

export function listingImageResponseJsonSchema() {
  return geminiIntakeResponseJsonSchema();
}

export function buildImageSystemPrompt() {
  return [
    "You transcribe Arabic real-estate advertisement images for IAQAR.AI.",
    "Step 1: Copy ALL visible text into rawText. Include phones, prices, areas, maps URLs, headers, footers, captions, and overlay text.",
    "Do not assume a fixed layout. Phone/price/type/location may appear anywhere.",
    "Do not use coordinates, header/footer position, or left/right placement as the reason for a field.",
    "Step 2: Optional structured fields only when the same value is present in rawText. Use null when not visible.",
    "Never guess price, phone, district, city, area, or property type.",
    "opportunityKind: OFFER for listings; REQUEST only if clearly a buyer/tenant request.",
    "purpose: SALE or RENT when visible in the text itself.",
    "propertyType: Arabic label (فيلا, شقة, أرض, etc.) wherever it appears.",
    "facade: cardinal direction in Arabic when shown as a facing word, not a width in meters.",
    "propertyAge: جديد or age text when shown.",
    "Include evidence snippets copied from rawText."
  ].join("\n");
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

export function mapVisionStructuredToBrokerFields(structured = {}) {
  const brokerFields = mapVisionPayloadToBrokerFields(structured);
  if (structured.usage) brokerFields.usage = safeText(structured.usage, 40);
  return brokerFields;
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
  fetchImpl = fetch,
  requestId = ""
} = {}) {
  const model = resolveGeminiModel(env);
  const prepared = await prepareListingImageForAnalysis(imageBytes, mimeType);
  if (!prepared.ok) {
    return { ok: false, error: prepared.error, retryable: false, model };
  }
  const analysisBytes = prepared.analysisBytes;
  const analysisMime = prepared.analysisMimeType;
  const base64 = bytesToBase64(analysisBytes);
  const result = await callGeminiGenerateContent({
    env,
    model,
    systemInstruction: buildImageSystemPrompt(),
    userParts: [
      { text: "Transcribe every visible Arabic/English listing text first into rawText, then fill schema fields only from that text. Ignore layout position. Return JSON only." },
      { inline_data: { mime_type: analysisMime, data: base64 } }
    ],
    generationConfig: buildGeminiIntakeGenerationConfig(listingImageResponseJsonSchema()),
    fetchImpl,
    requestId,
    sourceType: "image",
    mimeType: analysisMime,
    fileSize: analysisBytes.length
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error === "GEMINI_QUOTA_EXCEEDED" ? result.error : "GEMINI_VISION_FAILED",
      retryable: Boolean(result.retryable),
      model,
      latencyMs: result.latencyMs
    };
  }
  const structured = sanitizeGeminiIntakeResponse(result.parsed || {});
  const brokerFields = mapVisionStructuredToBrokerFields(structured);
  const rawText = safeText(structured.rawText, 12000)
    || buildListingTextFromBrokerFields(brokerFields);
  return {
    ok: true,
    structured,
    brokerFields,
    rawText,
    model,
    analyzerProvider: ANALYZER_PROVIDERS.GEMINI_VISION,
    extractionMode: "gemini_vision_adapter",
    confidence: hasExtractableListingFields(brokerFields) ? Math.round((structured.confidence ?? 0.75) * 100) : 35,
    latencyMs: result.latencyMs,
    productionAi: true
  };
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

function finalizeImageExtraction(rawText, visionBrokerFields, meta = {}) {
  const corpus = safeText(rawText, 12000);
  const merged = mergeVisionWithScreenshotSemantics(corpus, visionBrokerFields || {});
  const brokerFields = merged.brokerFields || {};
  const hasFields = hasExtractableListingFields(brokerFields)
    || Boolean(brokerFields.advertiserPhoneNormalized)
    || Boolean(brokerFields.salePrice)
    || Boolean(brokerFields.area);
  return {
    ok: true,
    text: corpus,
    brokerFields,
    screenshotExtraction: merged.screenshotExtraction || null,
    fieldSources: buildFieldSourcesFromVision(brokerFields, meta.analyzerProvider || ""),
    analyzerProvider: meta.analyzerProvider || "",
    extractionMode: meta.extractionMode || "",
    confidence: hasFields ? Math.max(Number(meta.confidence || 0), 55) : 25,
    extractionStatus: hasFields ? "extracted" : "needs_review",
    productionAi: Boolean(meta.productionAi),
    model: meta.model || "",
    geminiAttempted: meta.geminiAttempted,
    geminiError: meta.geminiError || ""
  };
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
  const geminiText = gemini.ok
    ? (gemini.rawText || buildListingTextFromBrokerFields(gemini.brokerFields || {}))
    : "";
  if (gemini.ok && (hasExtractableListingFields(gemini.brokerFields) || geminiText)) {
    return finalizeImageExtraction(geminiText, gemini.brokerFields, {
      analyzerProvider: ANALYZER_PROVIDERS.GEMINI_VISION,
      extractionMode: "gemini_vision_semantic",
      confidence: gemini.confidence,
      productionAi: gemini.productionAi,
      model: gemini.model
    });
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
      publicMessage: IMAGE_READ_ERROR_AR,
      geminiError: gemini.error || "",
      workersError: workers.error || ""
    };
  }

  const parsed = typeof parseRealEstateMessage === "function"
    ? parseRealEstateMessage(workers.text || "", "", "")
    : null;
  const legacyBroker = parsed ? mapParsedLegacyToBrokerFields(parsed) : {};
  if (!workers.text && !hasExtractableListingFields(legacyBroker)) {
    return { ok: false, error: "empty_listing_text", geminiError: gemini.error || "" };
  }

  return finalizeImageExtraction(workers.text || "", legacyBroker, {
    analyzerProvider: ANALYZER_PROVIDERS.WORKERS_AI_VISION,
    extractionMode: "workers_ai_vision_semantic",
    confidence: Number(parsed?.confidence || 0),
    productionAi: false,
    geminiAttempted: Boolean(gemini.error !== "GEMINI_NOT_CONFIGURED"),
    geminiError: gemini.error || ""
  });
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
    empty_listing_text: IMAGE_READ_ERROR_AR,
    invalid_image: IMAGE_READ_ERROR_AR,
    empty_image: IMAGE_READ_ERROR_AR,
    unsupported_media: "صيغة الصورة غير مدعومة.",
    invalid_media_target: "مسار تخزين الصورة غير صالح.",
    media_type_mismatch: "نوع الملف لا يطابق الصورة المرفوعة.",
    response_too_large: "حجم الصورة كبير جدًا.",
    upload_failed: "تعذر رفع الصورة. تحقق من الاتصال ثم أعد المحاولة.",
    worker_base_missing: "تعذر الاتصال بالخادم.",
    media_path_missing: "لم يُحفظ مسار الصورة. أعد رفع الصورة."
  };
  if (detail?.geminiError && detail?.workersError) {
    return IMAGE_READ_ERROR_AR;
  }
  if (map[code]) return map[code];
  return IMAGE_READ_ERROR_AR;
}

export const __test = {
  mapVisionStructuredToBrokerFields,
  hasExtractableListingFields,
  buildListingTextFromBrokerFields,
  buildFieldSourcesFromVision,
  mediaExtractPublicMessage,
  buildImageSystemPrompt,
  finalizeImageExtraction
};
