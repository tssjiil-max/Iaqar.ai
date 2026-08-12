/**
 * Gemini voice intake UI controller — recording + single analyze call.
 */

import {
  VOICE_MAX_DURATION_MS,
  classifyMicError,
  validateVoiceBlob,
  voiceErrorMessageAr
} from "./gemini-voice-intake-domain.js";

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export function createVoiceIntakeController({
  context = "office",
  officeId = "",
  getOfficeId = null,
  workerBase = "",
  getAuthToken = async () => "",
  publicRoute = false,
  hooks = {}
} = {}) {
  let mediaRecorder = null;
  let mediaStream = null;
  let chunks = [];
  let startedAt = 0;
  let lastBlob = null;
  let lastDurationMs = 0;
  let analyzing = false;
  let recording = false;
  let maxTimer = null;

  function endpoint() {
    const base = String(workerBase || "").replace(/\/$/, "");
    return publicRoute
      ? `${base}/pipeline/public-voice-analyze`
      : `${base}/pipeline/voice-analyze`;
  }

  async function stopTracks() {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
  }

  async function startRecording() {
    if (recording || analyzing) return { ok: false, error: "busy" };
    if (!navigator.mediaDevices?.getUserMedia) {
      return { ok: false, error: "MIC_PERMISSION_DENIED" };
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      return { ok: false, error: classifyMicError(error) };
    }
    const mimeType = pickMimeType();
    chunks = [];
    mediaRecorder = mimeType
      ? new MediaRecorder(mediaStream, { mimeType })
      : new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    startedAt = Date.now();
    recording = true;
    hooks.onRecordingChange?.(true);
    mediaRecorder.start(250);
    maxTimer = window.setTimeout(() => {
      void stopRecording();
    }, VOICE_MAX_DURATION_MS);
    return { ok: true, state: "recording" };
  }

  async function cancelRecording() {
    if (maxTimer) window.clearTimeout(maxTimer);
    maxTimer = null;
    recording = false;
    hooks.onRecordingChange?.(false);
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try { mediaRecorder.stop(); } catch (_) { /* ignore */ }
    }
    mediaRecorder = null;
    chunks = [];
    lastBlob = null;
    await stopTracks();
    return { ok: true, state: "idle" };
  }

  async function stopRecording() {
    if (!recording || !mediaRecorder) return { ok: false, error: "not_recording" };
    if (maxTimer) window.clearTimeout(maxTimer);
    maxTimer = null;
    recording = false;
    hooks.onRecordingChange?.(false);
    await new Promise((resolve) => {
      mediaRecorder.addEventListener("stop", resolve, { once: true });
      try { mediaRecorder.stop(); } catch (_) { resolve(); }
    });
    await stopTracks();
    const mimeType = mediaRecorder.mimeType || pickMimeType() || "audio/webm";
    mediaRecorder = null;
    lastDurationMs = Date.now() - startedAt;
    lastBlob = new Blob(chunks, { type: mimeType });
    chunks = [];
    const validation = validateVoiceBlob({ blob: lastBlob, durationMs: lastDurationMs });
    if (!validation.ok) {
      hooks.onError?.({ code: validation.error, message: voiceErrorMessageAr(validation.error), retryable: false });
      return { ok: false, error: validation.error };
    }
    return analyzeLastRecording();
  }

  async function analyzeLastRecording() {
    if (!lastBlob || analyzing) return { ok: false, error: "no_recording" };
    analyzing = true;
    hooks.onAnalyzing?.(true);
    try {
      const resolvedOfficeId = typeof getOfficeId === "function"
        ? getOfficeId()
        : officeId;
      const headers = {
        "Content-Type": lastBlob.type || "audio/webm",
        "X-Office-Id": resolvedOfficeId,
        "X-Voice-Context": context,
        "X-Voice-Duration-Sec": String(Math.ceil(lastDurationMs / 1000))
      };
      if (!publicRoute) {
        const token = await getAuthToken();
        if (!token) throw new Error("auth_required");
        headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetch(endpoint(), {
        method: "POST",
        headers,
        body: lastBlob
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok || !body.structured) {
        const code = body.error || "GEMINI_API_FAILED";
        hooks.onError?.({ code, message: voiceErrorMessageAr(code), retryable: body.retryable !== false });
        return { ok: false, error: code, retryable: body.retryable !== false };
      }
      hooks.onStructured?.(body.structured, body);
      return { ok: true, structured: body.structured, meta: body };
    } catch {
      const code = "AUDIO_UPLOAD_FAILED";
      hooks.onError?.({ code, message: voiceErrorMessageAr(code), retryable: true });
      return { ok: false, error: code, retryable: true };
    } finally {
      analyzing = false;
      hooks.onAnalyzing?.(false);
    }
  }

  return {
    startRecording,
    stopRecording,
    cancelRecording,
    retryAnalyze: () => analyzeLastRecording(),
    continueManually: () => {
      hooks.onManualContinue?.();
      return { ok: true };
    },
    isRecording: () => recording,
    isAnalyzing: () => analyzing,
    hasRecording: () => Boolean(lastBlob)
  };
}

export function mountVoiceIntakePanel(root, options = {}) {
  if (!root || root.dataset.voiceBound === "1") return null;
  root.dataset.voiceBound = "1";
  const {
    startLabel = "تسجيل صوتي",
    recordingLabel = "● جارٍ التسجيل",
    analyzingLabel = "جارٍ تحليل التسجيل…",
    onStructured = () => {},
    onManualContinue = () => {}
  } = options;

  root.innerHTML = `
    <div class="voice-intake-panel">
      <button type="button" class="voice-intake-start identity-btn" data-voice-start>${startLabel}</button>
      <div class="voice-intake-recording" data-voice-recording hidden>
        <span class="voice-intake-dot" aria-hidden="true">●</span>
        <span>${recordingLabel}</span>
        <button type="button" class="voice-intake-stop" data-voice-stop>إيقاف</button>
        <button type="button" class="voice-intake-cancel" data-voice-cancel>إلغاء</button>
      </div>
      <p class="voice-intake-status" data-voice-status role="status"></p>
      <div class="voice-intake-actions" data-voice-error-actions hidden>
        <button type="button" class="voice-intake-retry" data-voice-retry>إعادة المحاولة</button>
        <button type="button" class="voice-intake-manual" data-voice-manual>المتابعة يدويًا</button>
      </div>
    </div>`;

  const startBtn = root.querySelector("[data-voice-start]");
  const recordingEl = root.querySelector("[data-voice-recording]");
  const statusEl = root.querySelector("[data-voice-status]");
  const errorActions = root.querySelector("[data-voice-error-actions]");

  const setStatus = (text, isError = false) => {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.classList.toggle("is-error", isError);
  };

  let controller;
  controller = createVoiceIntakeController({
    ...options,
    hooks: {
      onRecordingChange(active) {
        recordingEl.hidden = !active;
        startBtn.hidden = active;
        if (active) errorActions.hidden = true;
      },
      onAnalyzing(busy) {
        if (busy) {
          recordingEl.hidden = true;
          startBtn.hidden = true;
          errorActions.hidden = true;
          setStatus(analyzingLabel);
        } else if (!controller?.isRecording?.()) {
          startBtn.hidden = false;
        }
      },
      onStructured(structured, meta) {
        errorActions.hidden = true;
        setStatus("");
        startBtn.hidden = false;
        recordingEl.hidden = true;
        onStructured(structured, meta);
      },
      onError({ message } = {}) {
        recordingEl.hidden = true;
        startBtn.hidden = false;
        errorActions.hidden = false;
        setStatus(message || voiceErrorMessageAr("GEMINI_API_FAILED"), true);
      },
      onManualContinue() {
        errorActions.hidden = true;
        setStatus("");
        startBtn.hidden = false;
        onManualContinue();
      }
    }
  });

  startBtn?.addEventListener("click", async () => {
    errorActions.hidden = true;
    setStatus("");
    const result = await controller.startRecording();
    if (!result.ok) {
      setStatus(voiceErrorMessageAr(result.error), true);
      errorActions.hidden = false;
    }
  });
  root.querySelector("[data-voice-stop]")?.addEventListener("click", () => void controller.stopRecording());
  root.querySelector("[data-voice-cancel]")?.addEventListener("click", async () => {
    await controller.cancelRecording();
    recordingEl.hidden = true;
    startBtn.hidden = false;
    setStatus("");
  });
  root.querySelector("[data-voice-retry]")?.addEventListener("click", () => void controller.retryAnalyze());
  root.querySelector("[data-voice-manual]")?.addEventListener("click", () => controller.continueManually());

  return controller;
}
