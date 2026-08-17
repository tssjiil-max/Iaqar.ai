/**
 * Gemini voice analysis — server-side only. No API keys in the browser.
 * Transcribe first, then parse via canonical text parser when available.
 */

import {
  buildGeminiIntakeGenerationConfig,
  geminiTranscriptionResponseJsonSchema
} from "./gemini-intake-schema.mjs";
import { extractListingFromAudio } from "./gemini-audio-intake.mjs";

const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
export const VOICE_MAX_DURATION_SEC = 120;
export const VOICE_MAX_BYTES = 5 * 1024 * 1024;

export const ALLOWED_VOICE_MIMES = Object.freeze([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/flac"
]);

const voiceTelemetry = {
  success: 0,
  failure: 0,
  quota: 0,
  lastLatencyMs: 0,
  lastModel: "",
  lastErrorClass: ""
};

export function resolveGeminiModel(env = {}) {
  return String(env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
}

export function getVoiceTelemetrySnapshot() {
  return { ...voiceTelemetry };
}

export function resetVoiceTelemetryForTests() {
  voiceTelemetry.success = 0;
  voiceTelemetry.failure = 0;
  voiceTelemetry.quota = 0;
  voiceTelemetry.lastLatencyMs = 0;
  voiceTelemetry.lastModel = "";
  voiceTelemetry.lastErrorClass = "";
}

export function validateVoiceAudio({ byteSize = 0, mimeType = "", durationSec = null } = {}) {
  const size = Number(byteSize) || 0;
  if (size <= 0) return { ok: false, error: "audio_empty" };
  if (size > VOICE_MAX_BYTES) return { ok: false, error: "audio_too_large" };
  const mime = String(mimeType || "").split(";")[0].trim().toLowerCase();
  if (!mime || !ALLOWED_VOICE_MIMES.includes(mime)) return { ok: false, error: "audio_mime_invalid" };
  if (durationSec != null && Number(durationSec) > VOICE_MAX_DURATION_SEC) {
    return { ok: false, error: "audio_too_long" };
  }
  return { ok: true, mimeType: mime, byteSize: size };
}

export function voiceResponseJsonSchema() {
  return geminiTranscriptionResponseJsonSchema();
}

export function buildGeminiVoiceGenerationConfig() {
  return buildGeminiIntakeGenerationConfig(geminiTranscriptionResponseJsonSchema());
}

export function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < u8.length; i += step) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + step));
  }
  return btoa(binary);
}

function purposeToTransactionType(purpose = "") {
  const value = String(purpose || "").toUpperCase();
  if (value === "RENT") return "إيجار";
  if (value === "LEASE_REQUEST") return "طلب إيجار";
  if (value === "PURCHASE") return "شراء";
  if (value === "INVESTMENT") return "استثمار";
  if (value === "SALE") return "بيع";
  return "";
}

export function brokerFieldsToVoiceStructured(brokerFields = {}, transcript = "") {
  const fields = brokerFields || {};
  return {
    transactionType: purposeToTransactionType(fields.purpose),
    propertyType: fields.propertyType || null,
    city: fields.city || null,
    district: fields.district || null,
    salePrice: fields.salePrice ?? null,
    annualRent: fields.annualRent ?? null,
    budget: fields.budget ?? null,
    area: fields.area ?? null,
    rooms: fields.rooms ?? null,
    bathrooms: fields.bathrooms ?? null,
    floorNumber: fields.floorNumber ?? null,
    streetWidth: fields.streetWidth ?? null,
    direction: fields.direction || fields.facade || null,
    planNumber: fields.planNumber || null,
    plotNumber: fields.plotNumber || null,
    advertiserName: fields.advertiserName || null,
    advertiserPhone: fields.advertiserPhoneRaw || fields.advertiserPhoneNormalized || null,
    advertiserRole: fields.advertiserRole || null,
    description: transcript || fields.contactNotes || null,
    needsReview: {}
  };
}

function classifyVoiceError(error = "") {
  const code = String(error || "");
  if (code === "GEMINI_QUOTA_EXCEEDED") return "GEMINI_QUOTA_EXCEEDED";
  if (code === "GEMINI_NOT_CONFIGURED") return "GEMINI_NOT_CONFIGURED";
  if (code.startsWith("GEMINI_")) return "GEMINI_API_FAILED";
  if (code === "TRANSCRIPTION_EMPTY" || code === "audio_transcribe_failed") {
    return "TRANSCRIPTION_EXTRACTION_FAILED";
  }
  return "TRANSCRIPTION_EXTRACTION_FAILED";
}

export async function analyzeVoiceWithGemini({
  env,
  audioBytes,
  mimeType,
  context = "office",
  fetchImpl = fetch,
  parseRealEstateMessage,
  requestId = ""
} = {}) {
  const model = resolveGeminiModel(env);
  const started = Date.now();
  const apiKey = String(env?.GEMINI_API_KEY || "").trim();
  if (!apiKey && !env?.AI) {
    return { ok: false, error: "GEMINI_NOT_CONFIGURED", retryable: false, model, latencyMs: 0 };
  }
  const result = await extractListingFromAudio({
    env,
    audioBytes,
    mimeType,
    parseRealEstateMessage,
    fetchImpl,
    requestId
  });
  const latencyMs = Date.now() - started;
  if (!result.ok) {
    const errorClass = result.error === "GEMINI_QUOTA_EXCEEDED"
      ? "GEMINI_QUOTA_EXCEEDED"
      : result.error === "GEMINI_NOT_CONFIGURED"
        ? "GEMINI_NOT_CONFIGURED"
        : classifyVoiceError(result.error);
    voiceTelemetry.failure += 1;
    voiceTelemetry.quota += errorClass === "GEMINI_QUOTA_EXCEEDED" ? 1 : 0;
    voiceTelemetry.lastErrorClass = errorClass;
    voiceTelemetry.lastLatencyMs = latencyMs;
    voiceTelemetry.lastModel = model;
    return {
      ok: false,
      error: errorClass,
      retryable: errorClass !== "GEMINI_NOT_CONFIGURED",
      model,
      latencyMs,
      publicMessage: result.publicMessage || ""
    };
  }
  const transcript = result.transcript || result.text || "";
  const structured = brokerFieldsToVoiceStructured(result.brokerFields || {}, transcript);
  voiceTelemetry.success += 1;
  voiceTelemetry.lastLatencyMs = latencyMs;
  voiceTelemetry.lastModel = model;
  voiceTelemetry.lastErrorClass = "";
  return {
    ok: true,
    structured,
    transcript,
    brokerFields: result.brokerFields || null,
    fieldSources: result.fieldSources || {},
    extractionMode: result.extractionMode || "gemini_audio_transcribe_adapter",
    productionAi: Boolean(result.productionAi),
    model,
    latencyMs,
    confidence: result.confidence || 0
  };
}

export function voiceAnalyzeHttpErrorMessage(code = "") {
  const map = {
    MIC_PERMISSION_DENIED: "تم منع الوصول إلى الميكروفون. فعّل إذن الميكروفون من إعدادات المتصفح ثم حاول مرة أخرى.",
    AUDIO_UPLOAD_FAILED: "تعذر إرسال التسجيل. حاول مرة أخرى.",
    GEMINI_QUOTA_EXCEEDED: "تعذر تحليل التسجيل حاليًا. يمكنك إعادة المحاولة أو إكمال البيانات يدويًا.",
    GEMINI_API_FAILED: "تعذر تحليل التسجيل حاليًا. يمكنك إعادة المحاولة أو إكمال البيانات يدويًا.",
    GEMINI_NOT_CONFIGURED: "تعذر تحليل التسجيل حاليًا. يمكنك إكمال البيانات يدويًا.",
    TRANSCRIPTION_EXTRACTION_FAILED: "تعذر فهم التسجيل الصوتي. أعد التسجيل بوضوح أو أرسل التفاصيل كتابةً.",
    audio_empty: "التسجيل فارغ.",
    audio_too_large: "التسجيل كبير جدًا.",
    audio_mime_invalid: "نوع التسجيل غير مدعوم.",
    audio_too_long: "التسجيل أطول من الحد المسموح."
  };
  return map[code] || "تعذر تحليل التسجيل. يمكنك إكمال البيانات يدويًا.";
}
