/**
 * OpenAI Whisper transcription — server-side only. API key never leaves Worker secrets.
 */

import { safeText } from "../../public/js/opportunity-intake-domain.js";

const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_WHISPER_MODEL = "whisper-1";

function extensionForMime(mimeType = "") {
  const mime = String(mimeType || "").split(";")[0].trim().toLowerCase();
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("flac")) return "flac";
  return "webm";
}

export function resolveOpenAiWhisperModel(env = {}) {
  return String(env.OPENAI_WHISPER_MODEL || DEFAULT_WHISPER_MODEL).trim() || DEFAULT_WHISPER_MODEL;
}

export async function transcribeAudioWithOpenAI({
  env,
  audioBytes,
  mimeType,
  fetchImpl = fetch
} = {}) {
  const apiKey = String(env?.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return { ok: false, error: "OPENAI_NOT_CONFIGURED", provider: "" };
  }

  const model = resolveOpenAiWhisperModel(env);
  const started = Date.now();
  const bytes = audioBytes instanceof Uint8Array ? audioBytes : new Uint8Array(audioBytes);
  const blob = new Blob([bytes], { type: mimeType || "audio/webm" });
  const form = new FormData();
  form.append("file", blob, `voice.${extensionForMime(mimeType)}`);
  form.append("model", model);
  form.append("language", "ar");
  form.append("response_format", "json");

  try {
    const response = await fetchImpl(OPENAI_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    });
    const bodyText = await response.text();
    if (!response.ok) {
      const sample = bodyText.toLowerCase();
      const error = response.status === 429 || sample.includes("rate_limit")
        ? "OPENAI_QUOTA_EXCEEDED"
        : "OPENAI_API_FAILED";
      return {
        ok: false,
        error,
        provider: "openai",
        model,
        latencyMs: Date.now() - started,
        retryable: error === "OPENAI_QUOTA_EXCEEDED"
      };
    }
    let parsed = {};
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = { text: bodyText };
    }
    const rawText = safeText(parsed.text || parsed.transcript || "", 12000);
    if (!rawText) {
      return {
        ok: false,
        error: "TRANSCRIPTION_EMPTY",
        provider: "openai",
        model,
        latencyMs: Date.now() - started
      };
    }
    return {
      ok: true,
      rawText,
      confidence: 0.85,
      provider: "openai",
      analyzerProvider: "openai_whisper",
      extractionMode: "openai_whisper_adapter",
      model,
      latencyMs: Date.now() - started,
      productionAi: true
    };
  } catch (error) {
    return {
      ok: false,
      error: "OPENAI_API_FAILED",
      provider: "openai",
      model,
      latencyMs: Date.now() - started,
      detail: String(error?.message || error).slice(0, 120)
    };
  }
}
