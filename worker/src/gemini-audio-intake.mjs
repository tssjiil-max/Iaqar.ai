/**
 * Audio intake — Gemini transcription primary, Workers AI Whisper fallback, then text parser.
 */

import { safeText } from "../../public/js/opportunity-intake-domain.js";
import { mapGeminiToOpportunityFields } from "../../public/js/gemini-voice-intake-domain.js";
import { resolveGeminiModel } from "./gemini-voice-service.js";
import {
  buildGeminiIntakeGenerationConfig,
  geminiTranscriptionResponseJsonSchema,
  sanitizeGeminiIntakeResponse
} from "./gemini-intake-schema.mjs";
import { callGeminiGenerateContent } from "./gemini-api-client.mjs";
import { bytesToBase64 } from "./gemini-voice-service.js";
import { normalizeSpokenArabicNumbers } from "./arabic-spoken-numbers.mjs";

export const AUDIO_TRANSCRIBE_ERROR_AR = "تعذر فهم التسجيل الصوتي. أعد التسجيل بوضوح أو أرسل التفاصيل كتابةً.";

function buildTranscriptionPrompt() {
  return [
    "Transcribe Arabic real-estate speech accurately for Saudi dialect.",
    "Return JSON only with rawText (full transcript) and confidence (0-1).",
    "Do not invent words not spoken. Use null for rawText if unintelligible."
  ].join("\n");
}

export async function transcribeAudioWithGemini({
  env,
  audioBytes,
  mimeType,
  fetchImpl = fetch,
  requestId = ""
} = {}) {
  const model = resolveGeminiModel(env);
  const base64 = bytesToBase64(audioBytes instanceof Uint8Array ? audioBytes : new Uint8Array(audioBytes));
  const result = await callGeminiGenerateContent({
    env,
    model,
    systemInstruction: buildTranscriptionPrompt(),
    userParts: [
      { text: "Transcribe this Arabic voice note. JSON only." },
      { inline_data: { mime_type: mimeType, data: base64 } }
    ],
    generationConfig: buildGeminiIntakeGenerationConfig(geminiTranscriptionResponseJsonSchema()),
    fetchImpl,
    requestId,
    sourceType: "audio",
    mimeType,
    fileSize: audioBytes?.byteLength || audioBytes?.length || 0
  });
  if (!result.ok) return result;
  const payload = sanitizeGeminiIntakeResponse(result.parsed || {});
  const rawText = safeText(payload.rawText, 12000);
  if (!rawText) {
    return { ok: false, error: "TRANSCRIPTION_EMPTY", model, latencyMs: result.latencyMs };
  }
  return {
    ok: true,
    rawText,
    confidence: payload.confidence ?? null,
    model,
    analyzerProvider: "gemini_audio_transcribe",
    latencyMs: result.latencyMs
  };
}

export async function transcribeAudioWithWorkersAi({
  env,
  audioBytes,
  mimeType
} = {}) {
  if (!env?.AI) return { ok: false, error: "WORKERS_AI_UNAVAILABLE" };
  try {
    const blob = new Blob([audioBytes], { type: mimeType });
    const file = new File([blob], "audio.webm", { type: mimeType });
    const result = await env.AI.run("@cf/openai/whisper", { audio: file });
    const rawText = safeText(result?.text || result?.transcript || "", 12000);
    if (!rawText) return { ok: false, error: "TRANSCRIPTION_EMPTY" };
    return {
      ok: true,
      rawText,
      confidence: 0.45,
      analyzerProvider: "workers_ai_whisper",
      extractionMode: "workers_ai_whisper_adapter"
    };
  } catch (error) {
    return {
      ok: false,
      error: "WORKERS_AI_WHISPER_FAILED",
      detail: String(error?.message || error).slice(0, 120)
    };
  }
}

export function parseTranscriptToBrokerFields(transcript = "", parseRealEstateMessage) {
  const normalized = normalizeSpokenArabicNumbers(transcript);
  const parsed = typeof parseRealEstateMessage === "function"
    ? parseRealEstateMessage(normalized, "", "")
    : null;
  const legacy = parsed?.legacyFields || parsed || {};
  const structured = {
    transactionType: parsed?.transactionType || legacy.purpose || "",
    propertyType: legacy.propertyType || parsed?.propertyType || "",
    city: legacy.city || parsed?.city || "",
    district: legacy.district || parsed?.district || "",
    salePrice: legacy.salePrice ?? legacy.priceOrBudget ?? parsed?.price ?? null,
    annualRent: legacy.annualRent ?? null,
    budget: legacy.budget ?? null,
    area: legacy.area ?? parsed?.area ?? null,
    rooms: legacy.rooms ?? parsed?.rooms ?? null,
    bathrooms: legacy.bathrooms ?? parsed?.bathrooms ?? null,
    description: normalized
  };
  const brokerFields = mapGeminiToOpportunityFields(structured, { context: "office" });
  return {
    brokerFields,
    transcript: normalized,
    parsed,
    confidence: Number(parsed?.confidence || 0)
  };
}

export async function extractListingFromAudio({
  env,
  audioBytes,
  mimeType,
  parseRealEstateMessage,
  fetchImpl = fetch,
  requestId = ""
} = {}) {
  const gemini = await transcribeAudioWithGemini({ env, audioBytes, mimeType, fetchImpl, requestId });
  let transcriptResult = gemini;
  if (!gemini.ok) {
    const workers = await transcribeAudioWithWorkersAi({ env, audioBytes, mimeType });
    if (!workers.ok) {
      const primaryError = gemini.error === "GEMINI_QUOTA_EXCEEDED"
        ? "GEMINI_QUOTA_EXCEEDED"
        : (gemini.error === "GEMINI_NOT_CONFIGURED" && !env?.AI)
          ? "GEMINI_NOT_CONFIGURED"
          : (workers.error || gemini.error || "audio_transcribe_failed");
      return {
        ok: false,
        error: primaryError,
        publicMessage: AUDIO_TRANSCRIBE_ERROR_AR,
        geminiError: gemini.error || "",
        workersError: workers.error || ""
      };
    }
    transcriptResult = workers;
  }

  const mapped = parseTranscriptToBrokerFields(transcriptResult.rawText, parseRealEstateMessage);
  return {
    ok: true,
    text: mapped.transcript,
    transcript: mapped.transcript,
    brokerFields: mapped.brokerFields,
    fieldSources: Object.fromEntries(
      Object.entries(mapped.brokerFields || {})
        .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
        .map(([key]) => [key, transcriptResult.analyzerProvider || "audio_transcript"])
    ),
    analyzerProvider: transcriptResult.analyzerProvider || "gemini_audio_transcribe",
    extractionMode: transcriptResult.extractionMode || "gemini_audio_transcribe_adapter",
    confidence: Math.round((transcriptResult.confidence ?? mapped.confidence ?? 0.5) * 100),
    extractionStatus: "extracted",
    productionAi: transcriptResult.analyzerProvider?.startsWith("gemini")
  };
}

export const __test = {
  parseTranscriptToBrokerFields,
  normalizeSpokenArabicNumbers,
  AUDIO_TRANSCRIBE_ERROR_AR
};
