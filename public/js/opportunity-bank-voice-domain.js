/**
 * Opportunity Bank voice search — browser Speech Recognition only, no persistence.
 */

export function isVoiceSearchSupported() {
  return typeof window !== "undefined"
    && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function createVoiceSearchSession({ onResult, onError, onEnd, language = "ar-SA" } = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    return {
      start() {
        onError?.({ code: "unsupported", message: "المتصفح لا يدعم البحث الصوتي." });
      },
      stop() {},
      supported: false
    };
  }

  const recognition = new SpeechRecognition();
  recognition.lang = language;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript || "";
    onResult?.(String(transcript).trim());
  };
  recognition.onerror = (event) => {
    const code = String(event?.error || "voice_error");
    if (code === "not-allowed" || code === "service-not-allowed") {
      onError?.({ code, message: "لم يتم السماح باستخدام الميكروفون." });
      return;
    }
    if (code === "no-speech") {
      onError?.({ code, message: "لم يُسمع أي كلام — حاول مرة أخرى." });
      return;
    }
    onError?.({ code, message: "تعذر إكمال البحث الصوتي." });
  };
  recognition.onend = () => onEnd?.();

  return {
    supported: true,
    start() {
      try {
        recognition.start();
      } catch (error) {
        onError?.({ code: "start_failed", message: "تعذر بدء الاستماع." });
      }
    },
    stop() {
      try {
        recognition.stop();
      } catch (_) { /* ignore */ }
    }
  };
}
