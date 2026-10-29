/**
 * «قنوات المكتب» data. Everything goes through the Worker, which checks office membership
 * (and the manager role for linking). No token or secret ever reaches the browser: the only
 * Meta values used here are the public app id and signup configuration id.
 */
import { signupConfiguration, safeMetaFailure } from "../domain/meta-signup-diagnostics.js";
import { api, idToken, workerBase } from "./runtime.js";
import { embeddedSignupOptions, isMetaOrigin, SIGNUP_TEXT, signupCancelFromEvent, signupDataFromEvent, signupProgress } from "../domain/channel-link-domain.js";

/** Older read-only status (kept for screens that still use it). */
export function loadChannelStatus(officeId) {
  return api("/office/channels/status", { officeId });
}

/** State of every channel of this office: { automationMode, outboundEnabled, channels: [whatsapp, telegram] }. */
export function loadChannels(officeId) {
  return api("/os/channels/status", { officeId });
}

export function startTelegramLink(officeId) {
  return api("/os/channels/telegram/link", { officeId });
}

export function unlinkTelegram(officeId) {
  return api("/os/channels/telegram/unlink", { officeId });
}

export function disconnectWhatsapp(officeId) {
  return api("/os/channels/whatsapp/disconnect", { officeId });
}

async function metaConfig(officeId) {
  const response = await fetch(`${workerBase()}/meta/config?officeId=${encodeURIComponent(officeId)}`, { headers: { Authorization: `Bearer ${await idToken()}` } }).catch(() => null);
  const payload = response ? await response.json().catch(() => ({})) : {};
  if (!response || !response.ok) {
    throw new Error("الربط الرسمي مع Meta غير مفعّل على هذه البيئة بعد.");
  }
  const readiness = signupConfiguration(payload);
  if (!readiness.valid) throw Object.assign(new Error(readiness.message), { code: readiness.code });
  return payload;
}

// How long to wait for Meta's «WA_EMBEDDED_SIGNUP» message after the login answered: Meta posts it
// independently of the login callback, so it can arrive just after.
const SIGNUP_EVENT_WAIT_MS = 45000; // generous: a phone can be slow to hand the result back
let sdkPromise = null;
let signupInProgress = false;

function loadFacebookSdk(config) {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const init = () => {
      window.FB.init({ appId: config.appId, autoLogAppEvents: false, xfbml: false, version: config.graphVersion || "v25.0" });
      resolve(window.FB);
    };
    if (window.FB) return init();
    window.fbAsyncInit = init;
    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/ar_AR/sdk.js";
    script.async = true;
    script.onerror = () => { sdkPromise = null; reject(new Error("تعذر تحميل نافذة Meta — تحقق من الإنترنت وحاول مجددًا.")); };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/**
 * Link the office's WhatsApp Business number through Meta Embedded Signup.
 * The window is Meta's own: the manager signs in and approves there. In «coexistence» mode
 * the number stays on the WhatsApp Business app on the phone. Resolves with the Worker's
 * answer ({ connected, displayPhoneNumber }) or rejects with a message for the manager.
 */
export async function prepareWhatsapp(officeId) {
  const config = await metaConfig(officeId);
  const FB = await loadFacebookSdk(config);
  return { officeId, config, FB };
}

// Must run in the confirm button's click handler: no await before FB.login.
export function connectWhatsapp(officeId, prepared) {
  return new Promise((resolve, reject) => {
    if (!prepared || prepared.officeId !== officeId) {
      reject(new Error("تعذر تجهيز ربط Meta — أعد فتح الربط."));
      return;
    }
    if (signupInProgress) {
      reject(Object.assign(new Error("توجد محاولة ربط قيد التنفيذ؛ انتظر نتيجتها."), { code: "SIGNUP_IN_PROGRESS" }));
      return;
    }
    signupInProgress = true;
    const { config, FB } = prepared;
    let signup = null;
    let cancelled = null;
    const seen = []; // fixed event categories only; never arbitrary Meta text or tokens
    let waiter = null;
    const onMessage = (event) => {
      if (!isMetaOrigin(event.origin)) return;
      let payload = event.data;
      if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch (_) { return; } }
      if (payload?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (seen.length < 4) seen.push(["FINISH", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", "FINISH_ONLY_WABA", "CANCEL", "ERROR"].includes(payload.event) ? payload.event : "OTHER");
      if (payload.event === "ERROR") return finish(() => reject(safeMetaFailure(payload.data)));
      signup = signupDataFromEvent(payload) || signup;
      cancelled = signupCancelFromEvent(payload) || cancelled;
      if (typeof waiter === "function" && (signup?.wabaId || cancelled)) waiter();
    };
    window.addEventListener("message", onMessage);
    let finished = false;
    let timer = null;
    const finish = (work) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      waiter = null;
      signupInProgress = false;
      window.removeEventListener("message", onMessage);
      work();
    };
    try {
      FB.login((response) => {
        if (finished) return;
        if (response?.error) return finish(() => reject(safeMetaFailure(response.error)));
        const code = response?.authResponse?.code || "";
        const complete = () => {
          if (finished || waiter === "completing") return;
          waiter = "completing";
          const progress = signupProgress({ loginAnswered: true, code, signup, cancelled });
          if (progress === "closed" || progress === "cancelled") {
            const message = response?.error ? SIGNUP_TEXT.failed : cancelled ? SIGNUP_TEXT.closed : SIGNUP_TEXT.notCompleted;
            return finish(() => reject(new Error(message)));
          }
          if (progress !== "ready") {
            console.warn("[iaqar-whatsapp] signup event missing", seen);
            return finish(() => reject(new Error(`${SIGNUP_TEXT.noData} (رمز التشخيص: ${seen.length ? seen.join(" | ") : "لا أحداث"})`)));
          }
          api("/meta/signup/complete", { officeId, code, wabaId: signup.wabaId, phoneNumberId: signup.phoneNumberId, signupEvent: signup.event })
            .then((result) => finish(() => {
              if (result.connected !== true) return reject(Object.assign(new Error("لم يؤكد الخادم اكتمال الربط؛ لم يُعتمد نجاح العملية."), { code: "SIGNUP_NOT_CONFIRMED" }));
              resolve(result);
            }), (error) => finish(() => reject(error)));
        };
        if (!code || signup?.wabaId || cancelled) return complete();
        timer = setTimeout(complete, SIGNUP_EVENT_WAIT_MS);
        waiter = () => { clearTimeout(timer); complete(); };
      }, embeddedSignupOptions({ configId: config.configId, onboardingMode: config.onboardingMode }));
    } catch (_) {
      finish(() => reject(new Error(SIGNUP_TEXT.failed)));
    }
  });
}

export function rehearseWhatsapp(officeId) { return api("/os/channels/whatsapp/rehearse", {officeId}); }
