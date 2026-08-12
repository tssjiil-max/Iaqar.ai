/**
 * Gemini voice analysis — server-side only. No API keys in the browser.
 */

const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash-lite";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export const VOICE_MAX_BYTES = 5 * 1024 * 1024;
export const VOICE_MAX_DURATION_SEC = 120;

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
  return {
    type: "object",
    properties: {
      transactionType: { type: "string", nullable: true },
      propertyType: { type: "string", nullable: true },
      city: { type: "string", nullable: true },
      district: { type: "string", nullable: true },
      salePrice: { type: "number", nullable: true },
      annualRent: { type: "number", nullable: true },
      budget: { type: "number", nullable: true },
      area: { type: "number", nullable: true },
      rooms: { type: "number", nullable: true },
      bathrooms: { type: "number", nullable: true },
      floorNumber: { type: "number", nullable: true },
      streetWidth: { type: "number", nullable: true },
      direction: { type: "string", nullable: true },
      planNumber: { type: "string", nullable: true },
      plotNumber: { type: "string", nullable: true },
      advertiserName: { type: "string", nullable: true },
      advertiserPhone: { type: "string", nullable: true },
      advertiserRole: { type: "string", nullable: true },
      description: { type: "string", nullable: true },
      needsReview: {
        type: "array",
        nullable: true,
        items: { type: "string" }
      }
    }
  };
}

export function buildGeminiVoiceGenerationConfig() {
  return {
    temperature: 0.1,
    responseMimeType: "application/json",
    responseJsonSchema: voiceResponseJsonSchema()
  };
}

function buildVoiceSystemPrompt(context = "office") {
  const roleHint = context === "owner"
    ? "Speaker is a property owner submitting an offer."
    : context === "client"
      ? "Speaker is a client submitting a purchase or rent request."
      : "Speaker is a licensed broker adding an office opportunity.";
  return [
    "You extract structured real-estate listing data from Arabic speech for IAQAR.AI.",
    roleHint,
    "Return JSON only. Use null for any field not explicitly stated.",
    "Never guess city, district, price, rooms, phone, or property type.",
    "If uncertain, use null and include the field name in needsReview (array of field names).",
    "Do not convert vague ranges like '500 or 600 thousand' into a single number without including the price field in needsReview.",
    "Normalize Saudi prices to integer riyals when clearly stated (e.g. 580 thousand -> 580000).",
    "transactionType values: sale, rent, purchase, lease_request, investment (Arabic equivalents allowed in output).",
    "advertiserRole values when stated: OWNER, CLIENT, BROKER, UNKNOWN."
  ].join("\n");
}

function classifyGeminiHttpFailure(status, bodyText = "") {
  const sample = String(bodyText || "").toLowerCase();
  if (status === 429 || sample.includes("resource_exhausted") || sample.includes("quota")) {
    return "GEMINI_QUOTA_EXCEEDED";
  }
  if (status === 401 || status === 403) return "GEMINI_API_FAILED";
  if (status >= 500) return "GEMINI_API_FAILED";
  return "GEMINI_API_FAILED";
}

function sanitizeGeminiPayload(raw = {}) {
  const out = {};
  const keys = [
    "transactionType", "propertyType", "city", "district",
    "salePrice", "annualRent", "budget", "area", "rooms", "bathrooms", "floorNumber",
    "streetWidth", "direction", "planNumber", "plotNumber",
    "advertiserName", "advertiserPhone", "advertiserRole", "description"
  ];
  for (const key of keys) {
    const value = raw[key];
    if (value === null || value === undefined) {
      out[key] = null;
      continue;
    }
    if (["salePrice", "annualRent", "budget", "area", "rooms", "bathrooms", "floorNumber", "streetWidth"].includes(key)) {
      const num = Number(value);
      out[key] = Number.isFinite(num) ? num : null;
      continue;
    }
    const text = String(value).trim();
    out[key] = text || null;
  }
  out.needsReview = normalizeNeedsReview(raw.needsReview);
  return out;
}

function normalizeNeedsReview(raw) {
  if (Array.isArray(raw)) {
    const out = {};
    for (const item of raw) {
      const key = String(item || "").trim();
      if (key) out[key] = true;
    }
    return out;
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  return {};
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
    if (!match) throw new Error("TRANSCRIPTION_EXTRACTION_FAILED");
    parsed = JSON.parse(match[0]);
  }
  return sanitizeGeminiPayload(parsed);
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

export async function analyzeVoiceWithGemini({
  env,
  audioBytes,
  mimeType,
  context = "office",
  fetchImpl = fetch
} = {}) {
  const apiKey = String(env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    return { ok: false, error: "GEMINI_NOT_CONFIGURED", retryable: false };
  }
  const model = resolveGeminiModel(env);
  const started = Date.now();
  const base64 = bytesToBase64(audioBytes instanceof Uint8Array ? audioBytes : new Uint8Array(audioBytes));
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildVoiceSystemPrompt(context) }] },
        contents: [{
          role: "user",
          parts: [
            { text: "Analyze this Arabic real-estate voice note and return structured JSON." },
            { inline_data: { mime_type: mimeType, data: base64 } }
          ]
        }],
        generationConfig: buildGeminiVoiceGenerationConfig()
      })
    });
    const bodyText = await response.text();
    if (!response.ok) {
      const errorClass = classifyGeminiHttpFailure(response.status, bodyText);
      voiceTelemetry.failure += 1;
      voiceTelemetry.quota += errorClass === "GEMINI_QUOTA_EXCEEDED" ? 1 : 0;
      voiceTelemetry.lastErrorClass = errorClass;
      voiceTelemetry.lastLatencyMs = Date.now() - started;
      voiceTelemetry.lastModel = model;
      return {
        ok: false,
        error: errorClass,
        retryable: errorClass !== "GEMINI_NOT_CONFIGURED",
        model,
        latencyMs: Date.now() - started
      };
    }
    const json = JSON.parse(bodyText);
    const structured = parseGeminiJsonResponse(json);
    voiceTelemetry.success += 1;
    voiceTelemetry.lastLatencyMs = Date.now() - started;
    voiceTelemetry.lastModel = model;
    voiceTelemetry.lastErrorClass = "";
    return {
      ok: true,
      structured,
      model,
      extractionMode: "gemini_voice_adapter",
      productionAi: Boolean(apiKey),
      latencyMs: Date.now() - started
    };
  } catch (error) {
    voiceTelemetry.failure += 1;
    voiceTelemetry.lastErrorClass = "TRANSCRIPTION_EXTRACTION_FAILED";
    voiceTelemetry.lastLatencyMs = Date.now() - started;
    voiceTelemetry.lastModel = model;
    return {
      ok: false,
      error: "TRANSCRIPTION_EXTRACTION_FAILED",
      retryable: true,
      model,
      latencyMs: Date.now() - started,
      detail: String(error?.message || error).slice(0, 120)
    };
  }
}

export function voiceAnalyzeHttpErrorMessage(code = "") {
  const map = {
    MIC_PERMISSION_DENIED: "تم منع الوصول إلى الميكروفون. فعّل إذن الميكروفون من إعدادات المتصفح ثم حاول مرة أخرى.",
    AUDIO_UPLOAD_FAILED: "تعذر إرسال التسجيل. حاول مرة أخرى.",
    GEMINI_QUOTA_EXCEEDED: "تعذر تحليل التسجيل حاليًا. يمكنك إعادة المحاولة أو إكمال البيانات يدويًا.",
    GEMINI_API_FAILED: "تعذر تحليل التسجيل حاليًا. يمكنك إعادة المحاولة أو إكمال البيانات يدويًا.",
    GEMINI_NOT_CONFIGURED: "تعذر تحليل التسجيل حاليًا. يمكنك إكمال البيانات يدويًا.",
    TRANSCRIPTION_EXTRACTION_FAILED: "تعذر تحليل التسجيل. يمكنك إعادة المحاولة أو إكمال البيانات يدويًا.",
    audio_empty: "التسجيل فارغ.",
    audio_too_large: "التسجيل كبير جدًا.",
    audio_mime_invalid: "نوع التسجيل غير مدعوم.",
    audio_too_long: "التسجيل أطول من الحد المسموح."
  };
  return map[code] || "تعذر تحليل التسجيل. يمكنك إكمال البيانات يدويًا.";
}
