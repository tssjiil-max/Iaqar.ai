/**
 * Gemini REST client — API key in header only, safe structured logging.
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export function resolveGeminiApiBase() {
  return GEMINI_API_BASE;
}

export function parseGeminiJsonResponse(responseJson) {
  const text = responseJson?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!text) throw new Error("GEMINI_EMPTY_RESPONSE");
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("GEMINI_PARSE_FAILED");
    return JSON.parse(match[0]);
  }
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

export function logGeminiIntakeEvent({
  requestId = "",
  sourceType = "",
  mimeType = "",
  fileSize = 0,
  model = "",
  durationMs = 0,
  extractionStatus = "",
  errorCode = ""
} = {}) {
  console.log(JSON.stringify({
    requestId: String(requestId || "").slice(0, 80),
    sourceType: String(sourceType || "").slice(0, 40),
    mimeType: String(mimeType || "").slice(0, 80),
    fileSize: Number(fileSize) || 0,
    model: String(model || "").slice(0, 80),
    durationMs: Number(durationMs) || 0,
    extractionStatus: String(extractionStatus || "").slice(0, 40),
    errorCode: String(errorCode || "").slice(0, 80)
  }));
}

export async function callGeminiGenerateContent({
  env,
  model,
  systemInstruction = "",
  userParts = [],
  generationConfig = {},
  fetchImpl = fetch,
  requestId = "",
  sourceType = "",
  mimeType = "",
  fileSize = 0
} = {}) {
  const apiKey = String(env?.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    return { ok: false, error: "GEMINI_NOT_CONFIGURED", retryable: false, model };
  }
  const started = Date.now();
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: systemInstruction
          ? { parts: [{ text: systemInstruction }] }
          : undefined,
        contents: [{ role: "user", parts: userParts }],
        generationConfig
      })
    });
    const bodyText = await response.text();
    const durationMs = Date.now() - started;
    if (!response.ok) {
      const error = classifyGeminiHttpFailure(response.status, bodyText);
      logGeminiIntakeEvent({
        requestId, sourceType, mimeType, fileSize, model, durationMs,
        extractionStatus: "failed", errorCode: error
      });
      return {
        ok: false,
        error,
        retryable: error !== "GEMINI_NOT_CONFIGURED",
        model,
        latencyMs: durationMs
      };
    }
    const json = JSON.parse(bodyText);
    const parsed = parseGeminiJsonResponse(json);
    logGeminiIntakeEvent({
      requestId, sourceType, mimeType, fileSize, model, durationMs,
      extractionStatus: "ok", errorCode: ""
    });
    return { ok: true, parsed, model, latencyMs: durationMs };
  } catch (error) {
    const durationMs = Date.now() - started;
    logGeminiIntakeEvent({
      requestId, sourceType, mimeType, fileSize, model, durationMs,
      extractionStatus: "failed", errorCode: "GEMINI_REQUEST_FAILED"
    });
    return {
      ok: false,
      error: "GEMINI_REQUEST_FAILED",
      retryable: true,
      model,
      latencyMs: durationMs,
      detail: String(error?.message || error).slice(0, 120)
    };
  }
}

export const __test = {
  classifyGeminiHttpFailure,
  parseGeminiJsonResponse
};
