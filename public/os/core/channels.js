/**
 * «قنوات المكتب» data. Everything goes through the Worker, which checks office membership
 * (and the manager role for linking). No token or secret ever reaches the browser: the only
 * Meta values used here are the public app id and signup configuration id.
 */
import { api, idToken, workerBase } from "./runtime.js";
import { embeddedSignupOptions, isMetaOrigin, signupCancelFromEvent, signupDataFromEvent } from "../domain/channel-link-domain.js";

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
  if (!response || !response.ok || payload.enabled !== true || !payload.appId || !payload.configId) {
    throw new Error("الربط الرسمي مع Meta غير مفعّل على هذه البيئة بعد.");
  }
  return payload;
}

// How long to wait for Meta's «WA_EMBEDDED_SIGNUP» message after the login answered: Meta posts it
// independently of the login callback, so it can arrive just after.
const SIGNUP_EVENT_WAIT_MS = 15000;
let sdkPromise = null;

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
export async function connectWhatsapp(officeId) {
  const config = await metaConfig(officeId);
  const FB = await loadFacebookSdk(config);
  return new Promise((resolve, reject) => {
    let signup = null;
    let cancelled = null;
    const seen = []; // what arrived, without any value: host / type / event names only (for the error code)
    let waiter = null;
    const onMessage = (event) => {
      if (!isMetaOrigin(event.origin)) return;
      let payload = event.data;
      if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch (_) { return; } }
      if (payload && seen.length < 4) seen.push(`${new URL(event.origin).hostname.replace(/\.facebook\.com$/, "")}/${String(payload.type || "?").slice(0, 24)}/${String(payload.event || "-").slice(0, 40)}`);
      signup = signupDataFromEvent(payload) || signup;
      cancelled = signupCancelFromEvent(payload) || cancelled;
      if (waiter && (signup?.wabaId || cancelled)) waiter();
    };
    window.addEventListener("message", onMessage);
    const finish = (work) => { window.removeEventListener("message", onMessage); work(); };
    FB.login((response) => {
      const code = response?.authResponse?.code;
      if (!code) return finish(() => reject(new Error("لم يكتمل الربط — أُغلقت نافذة Meta قبل الإتمام.")));
      const complete = () => {
        waiter = null;
        if (cancelled) return finish(() => reject(new Error("لم يكتمل الربط — أُغلقت نافذة Meta قبل الإتمام.")));
        if (!signup?.wabaId) {
          console.warn("[iaqar-whatsapp] signup event missing", seen);
          return finish(() => reject(new Error(`لم تصل بيانات الحساب من Meta — أعد المحاولة. (رمز التشخيص: ${seen.length ? seen.join(" | ") : "لا أحداث"})`)));
        }
        api("/meta/signup/complete", { officeId, code, wabaId: signup.wabaId, phoneNumberId: signup.phoneNumberId })
          .then((result) => finish(() => resolve(result)), (error) => finish(() => reject(error)));
      };
      if (signup?.wabaId || cancelled) return complete();
      const timer = setTimeout(complete, SIGNUP_EVENT_WAIT_MS);
      waiter = () => { clearTimeout(timer); complete(); };
    }, embeddedSignupOptions({ configId: config.configId, onboardingMode: config.onboardingMode }));
  });
}
