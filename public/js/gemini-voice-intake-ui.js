/**
 * Gemini voice intake UI controller — explicit recording state machine.
 */

import {
  VOICE_MAX_DURATION_MS,
  classifyMicError,
  validateVoiceBlob,
  voiceErrorMessageAr
} from "./gemini-voice-intake-domain.js";

export const VOICE_UI_STATE = Object.freeze({
  IDLE: "idle",
  REQUESTING_PERMISSION: "requesting_permission",
  RECORDING: "recording",
  STOPPING: "stopping",
  ANALYZING: "analyzing",
  ERROR: "error"
});

export const VOICE_STOP_TIMEOUT_MS = 8_000;
export const VOICE_ANALYZE_TIMEOUT_MS = 45_000;

export const VOICE_UI_BUILD = "20260812-2";

export function voiceUiVisibility(state = VOICE_UI_STATE.IDLE) {
  const showRecording = state === VOICE_UI_STATE.RECORDING;
  const showErrorActions = state === VOICE_UI_STATE.ERROR;
  return {
    showStart: state === VOICE_UI_STATE.IDLE,
    showRecording: showRecording && !showErrorActions,
    showErrorActions: showErrorActions && !showRecording,
    showAnalyzingStatus: state === VOICE_UI_STATE.STOPPING || state === VOICE_UI_STATE.ANALYZING,
    blockStart: state === VOICE_UI_STATE.REQUESTING_PERMISSION
      || state === VOICE_UI_STATE.RECORDING
      || state === VOICE_UI_STATE.STOPPING
      || state === VOICE_UI_STATE.ANALYZING
  };
}

function setVoiceSectionVisible(el, visible, displayMode = "flex") {
  if (!el) return;
  el.hidden = !visible;
  el.classList.toggle("is-active", visible);
  el.style.setProperty("display", visible ? displayMode : "none", "important");
  el.setAttribute("aria-hidden", visible ? "false" : "true");
}

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function withTimeout(promise, ms, code = "timeout") {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(code)), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
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
  let state = VOICE_UI_STATE.IDLE;
  let mediaRecorder = null;
  let mediaStream = null;
  let chunks = [];
  let startedAt = 0;
  let lastBlob = null;
  let lastDurationMs = 0;
  let maxTimer = null;
  let stopInFlight = false;

  function setState(nextState) {
    state = nextState;
    hooks.onStateChange?.(nextState, voiceUiVisibility(nextState));
  }

  function endpoint() {
    const base = String(workerBase || "").replace(/\/$/, "");
    return publicRoute
      ? `${base}/pipeline/public-voice-analyze`
      : `${base}/pipeline/voice-analyze`;
  }

  function clearMaxTimer() {
    if (maxTimer) window.clearTimeout(maxTimer);
    maxTimer = null;
  }

  async function stopTracks() {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => {
        try { track.stop(); } catch (_) { /* ignore */ }
      });
      mediaStream = null;
    }
  }

  function resetRecorderRefs() {
    mediaRecorder = null;
    chunks = [];
    stopInFlight = false;
  }

  async function waitForRecorderStop(recorder) {
    if (!recorder || recorder.state === "inactive") return;
    await withTimeout(new Promise((resolve) => {
      recorder.addEventListener("stop", resolve, { once: true });
      try {
        if (recorder.state === "recording") recorder.requestData();
        recorder.stop();
      } catch (_) {
        resolve();
      }
    }), VOICE_STOP_TIMEOUT_MS, "stop_timeout");
  }

  async function startRecording() {
    const visibility = voiceUiVisibility(state);
    if (visibility.blockStart) return { ok: false, error: "busy" };
    if (!navigator.mediaDevices?.getUserMedia) {
      setState(VOICE_UI_STATE.ERROR);
      return { ok: false, error: "MIC_PERMISSION_DENIED" };
    }

    setState(VOICE_UI_STATE.REQUESTING_PERMISSION);
    lastBlob = null;
    lastDurationMs = 0;

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      setState(VOICE_UI_STATE.ERROR);
      return { ok: false, error: classifyMicError(error) };
    }

    const mimeType = pickMimeType();
    chunks = [];
    mediaRecorder = mimeType
      ? new MediaRecorder(mediaStream, { mimeType })
      : new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (event) => {
      if (state !== VOICE_UI_STATE.RECORDING) return;
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    startedAt = Date.now();
    setState(VOICE_UI_STATE.RECORDING);
    mediaRecorder.start(250);
    maxTimer = window.setTimeout(() => {
      void stopRecording();
    }, VOICE_MAX_DURATION_MS);
    return { ok: true, state: VOICE_UI_STATE.RECORDING };
  }

  async function cancelRecording() {
    clearMaxTimer();
    stopInFlight = false;
    const recorder = mediaRecorder;
    resetRecorderRefs();
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch (_) { /* ignore */ }
    }
    lastBlob = null;
    lastDurationMs = 0;
    await stopTracks();
    setState(VOICE_UI_STATE.IDLE);
    return { ok: true, state: VOICE_UI_STATE.IDLE };
  }

  async function stopRecording() {
    if (state !== VOICE_UI_STATE.RECORDING || stopInFlight) {
      return { ok: false, error: "not_recording" };
    }
    stopInFlight = true;
    clearMaxTimer();
    setState(VOICE_UI_STATE.STOPPING);

    const recorder = mediaRecorder;
    const mimeType = recorder?.mimeType || pickMimeType() || "audio/webm";

    try {
      await waitForRecorderStop(recorder);
    } catch {
      resetRecorderRefs();
      await stopTracks();
      setState(VOICE_UI_STATE.ERROR);
      hooks.onError?.({
        code: "AUDIO_UPLOAD_FAILED",
        message: voiceErrorMessageAr("AUDIO_UPLOAD_FAILED"),
        retryable: true
      });
      return { ok: false, error: "stop_timeout" };
    }

    await stopTracks();
    mediaRecorder = null;
    lastDurationMs = Math.max(0, Date.now() - startedAt);
    lastBlob = new Blob(chunks, { type: mimeType });
    chunks = [];
    stopInFlight = false;

    const validation = validateVoiceBlob({ blob: lastBlob, durationMs: lastDurationMs });
    if (!validation.ok) {
      setState(VOICE_UI_STATE.ERROR);
      hooks.onError?.({
        code: validation.error,
        message: voiceErrorMessageAr(validation.error),
        retryable: false
      });
      return { ok: false, error: validation.error };
    }

    return analyzeLastRecording();
  }

  async function analyzeLastRecording() {
    if (!lastBlob || state === VOICE_UI_STATE.ANALYZING) {
      return { ok: false, error: "no_recording" };
    }
    setState(VOICE_UI_STATE.ANALYZING);

    const abortController = typeof AbortController !== "undefined" ? new AbortController() : null;
    const abortTimer = abortController
      ? window.setTimeout(() => abortController.abort(), VOICE_ANALYZE_TIMEOUT_MS)
      : null;

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

      const fetchPromise = fetch(endpoint(), {
        method: "POST",
        headers,
        body: lastBlob,
        signal: abortController?.signal
      });
      const response = await (abortController
        ? withTimeout(fetchPromise, VOICE_ANALYZE_TIMEOUT_MS, "analyze_timeout")
        : fetchPromise);
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok || !body.structured) {
        const code = body.error || "GEMINI_API_FAILED";
        setState(VOICE_UI_STATE.ERROR);
        hooks.onError?.({
          code,
          message: voiceErrorMessageAr(code),
          retryable: body.retryable !== false
        });
        return { ok: false, error: code, retryable: body.retryable !== false };
      }
      hooks.onStructured?.(body.structured, body);
      setState(VOICE_UI_STATE.IDLE);
      return { ok: true, structured: body.structured, meta: body };
    } catch (error) {
      const timedOut = String(error?.message || "").includes("timeout")
        || String(error?.name || "") === "AbortError";
      const code = timedOut ? "GEMINI_API_FAILED" : "AUDIO_UPLOAD_FAILED";
      setState(VOICE_UI_STATE.ERROR);
      hooks.onError?.({
        code,
        message: voiceErrorMessageAr(code),
        retryable: true
      });
      return { ok: false, error: code, retryable: true };
    } finally {
      if (abortTimer) window.clearTimeout(abortTimer);
    }
  }

  return {
    startRecording,
    stopRecording,
    cancelRecording,
    retryAnalyze: () => {
      if (!lastBlob) {
        setState(VOICE_UI_STATE.ERROR);
        hooks.onError?.({
          code: "audio_empty",
          message: voiceErrorMessageAr("audio_empty"),
          retryable: false
        });
        return Promise.resolve({ ok: false, error: "no_recording" });
      }
      return analyzeLastRecording();
    },
    continueManually: () => {
      setState(VOICE_UI_STATE.IDLE);
      hooks.onManualContinue?.();
      return { ok: true };
    },
    getState: () => state,
    isRecording: () => state === VOICE_UI_STATE.RECORDING,
    isAnalyzing: () => state === VOICE_UI_STATE.ANALYZING || state === VOICE_UI_STATE.STOPPING,
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
        <span data-voice-recording-label>${recordingLabel}</span>
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

  const applyVisibility = (uiState) => {
    const view = voiceUiVisibility(uiState);
    root.dataset.voiceUiState = uiState;
    if (startBtn) {
      startBtn.hidden = !view.showStart;
      startBtn.disabled = view.blockStart && !view.showStart;
      startBtn.style.setProperty("display", view.showStart ? "" : "none", "important");
    }
    setVoiceSectionVisible(recordingEl, view.showRecording, "flex");
    setVoiceSectionVisible(errorActions, view.showErrorActions, "flex");
    if (view.showAnalyzingStatus) {
      setStatus(analyzingLabel, false);
    } else if (uiState !== VOICE_UI_STATE.ERROR) {
      setStatus("");
    }
  };

  let controller;
  controller = createVoiceIntakeController({
    ...options,
    hooks: {
      onStateChange(nextState) {
        applyVisibility(nextState);
      },
      onStructured(structured, meta) {
        onStructured(structured, meta);
      },
      onError({ message } = {}) {
        applyVisibility(controller.getState());
        setStatus(message || voiceErrorMessageAr("GEMINI_API_FAILED"), true);
      },
      onManualContinue() {
        onManualContinue();
      }
    }
  });

  applyVisibility(VOICE_UI_STATE.IDLE);

  startBtn?.addEventListener("click", async () => {
    setStatus("");
    const result = await controller.startRecording();
    if (!result.ok && controller.getState() === VOICE_UI_STATE.ERROR) {
      applyVisibility(VOICE_UI_STATE.ERROR);
      setStatus(voiceErrorMessageAr(result.error), true);
    }
  });

  root.querySelector("[data-voice-stop]")?.addEventListener("click", () => {
    void controller.stopRecording();
  });

  root.querySelector("[data-voice-cancel]")?.addEventListener("click", () => {
    void controller.cancelRecording();
  });

  root.querySelector("[data-voice-retry]")?.addEventListener("click", () => {
    setStatus("");
    void controller.retryAnalyze();
  });

  root.querySelector("[data-voice-manual]")?.addEventListener("click", () => {
    controller.continueManually();
  });

  return controller;
}
