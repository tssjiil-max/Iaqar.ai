/**
 * «قنوات المكتب» — one abstraction for every message channel (واتساب، تيليجرام، وما يُضاف لاحقًا).
 * A channel is a transport only: it brings messages into the office's inbox; matching,
 * negotiation and deals stay in the office system. Each office links its own channel, and
 * every link is stored against that office's id on the server (never in the browser).
 * Pure rules shared by the settings screen and the Worker.
 */

export const LINK_STATE = Object.freeze({
  DISCONNECTED: "DISCONNECTED",
  PENDING: "PENDING",
  CONNECTED: "CONNECTED",
  ERROR: "ERROR"
});

export const LINK_STATE_LABEL = Object.freeze({
  DISCONNECTED: "غير مرتبط",
  PENDING: "بانتظار إتمام الربط",
  CONNECTED: "مرتبط",
  ERROR: "خطأ في الربط"
});

/** Registry: adding a channel later is one entry here plus its adapter in the Worker. */
export const CHANNEL_REGISTRY = Object.freeze({
  whatsapp: Object.freeze({ id: "whatsapp", name: "واتساب للأعمال", icon: "whatsapp", linkMethod: "embedded_signup", perOffice: true, inbound: true, outbound: false,
    hint: "كل مكتب يربط رقم واتساب للأعمال الخاص به. تصل الرسائل الواردة إلى مكتبك فقط." }),
  telegram: Object.freeze({ id: "telegram", name: "تيليجرام", icon: "send", linkMethod: "bot_deep_link", perOffice: true, inbound: true, outbound: false,
    hint: "بوت واحد للمنصة، وكل مكتب يربط محادثته به. تصل رسائل المحادثة المرتبطة إلى مكتبك فقط." })
});

export const CHANNEL_ORDER = Object.freeze(["whatsapp", "telegram"]);

export const TELEGRAM_LINK_MINUTES = 15;
const CODE_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

/** A Telegram start parameter: letters, digits, _ and - only (Telegram's own rule), long enough to be unguessable. */
export function isLinkCode(value) {
  return CODE_PATTERN.test(String(value || ""));
}

export function telegramDeepLink(botUsername, code) {
  const username = String(botUsername || "").replace(/^@/, "").trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(username) || !isLinkCode(code)) return "";
  return `https://t.me/${username}?start=${code}`;
}

/** "/start <code>" (or "/start@bot <code>") → the code, else "". */
export function parseStartCommand(text) {
  const match = String(text || "").trim().match(/^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]+)$/);
  return match && isLinkCode(match[1]) ? match[1] : "";
}

function maskTail(value, keep = 4) {
  const text = String(value || "").replace(/[^0-9A-Za-z]/g, "");
  if (text.length <= keep) return text ? "•".repeat(text.length) : "";
  return `${"•".repeat(Math.min(6, text.length - keep))}${text.slice(-keep)}`;
}

const millis = (value) => { const t = new Date(value || 0).getTime(); return Number.isFinite(t) ? t : 0; };

/**
 * Telegram link as the office sees it. `link` is the server's record for this office,
 * `config` says whether the platform bot is set up on this environment.
 * actions ⊆ connect | reconnect | disconnect
 */
export function telegramLinkView(link = {}, config = {}, now = new Date()) {
  const configured = config.configured === true;
  const raw = String(link?.status || "").toUpperCase();
  const pendingValid = raw === LINK_STATE.PENDING && millis(link.pendingExpiresAt) > now.getTime();
  let state = LINK_STATE.DISCONNECTED;
  if (raw === LINK_STATE.CONNECTED && link.chatId) state = LINK_STATE.CONNECTED;
  else if (raw === LINK_STATE.ERROR) state = LINK_STATE.ERROR;
  else if (pendingValid) state = LINK_STATE.PENDING;
  const actions = !configured ? [] : state === LINK_STATE.CONNECTED ? ["reconnect", "disconnect"] : state === LINK_STATE.PENDING ? ["reconnect", "disconnect"] : state === LINK_STATE.ERROR ? ["reconnect"] : ["connect"];
  const detail = [];
  if (state === LINK_STATE.CONNECTED) {
    if (link.chatTitle) detail.push(String(link.chatTitle).slice(0, 60));
    else if (link.username) detail.push(`@${String(link.username).slice(0, 40)}`);
    if (link.chatId) detail.push(`المحادثة ${maskTail(link.chatId)}`);
  }
  if (state === LINK_STATE.ERROR && link.lastError) detail.push(String(link.lastError).slice(0, 160));
  if (state === LINK_STATE.DISCONNECTED && raw === LINK_STATE.PENDING) detail.push("انتهت صلاحية رابط الربط — أنشئ رابطًا جديدًا.");
  return {
    id: "telegram", state, stateLabel: LINK_STATE_LABEL[state], configured, actions,
    detail: detail.join(" · "),
    botUsername: configured ? String(config.botUsername || "") : "",
    linkedAt: state === LINK_STATE.CONNECTED ? link.linkedAt || "" : "",
    lastInboundAt: link.lastInboundAt || "",
    pendingExpiresAt: state === LINK_STATE.PENDING ? link.pendingExpiresAt : "",
    note: configured ? "" : "بوت المنصة غير مفعّل على هذه البيئة بعد. يتفعّل الربط بعد إعداد البوت من إدارة المنصة."
  };
}

/**
 * WhatsApp link as the office sees it.
 * `integration` = the office's stored link (status, displayPhoneNumber, phoneNumberId…),
 * `config` = { signupEnabled, onboardingMode, webhookReady }.
 */
export function whatsappLinkView(integration = {}, config = {}, usage = {}) {
  const raw = String(integration?.status || "").toLowerCase();
  const signupEnabled = config.signupEnabled === true;
  let state = LINK_STATE.DISCONNECTED;
  if (raw === "connected") state = LINK_STATE.CONNECTED;
  else if (raw === "error") state = LINK_STATE.ERROR;
  else if (raw === "pending" || raw === "setup") state = LINK_STATE.PENDING;
  const actions = state === LINK_STATE.CONNECTED ? [...(signupEnabled ? ["reconnect"] : []), "disconnect"] : signupEnabled ? [state === LINK_STATE.DISCONNECTED && !integration?.phoneNumberId ? "connect" : "reconnect"] : [];
  const number = state === LINK_STATE.CONNECTED || integration?.displayPhoneNumber ? maskTail(String(integration?.displayPhoneNumber || "").replace(/\D/g, "")) : "";
  const inboundToday = Number(usage?.inboundMessages || 0);
  const webhookReady = config.webhookReady === true;
  const webhookLabel = !webhookReady ? "غير مهيأ على هذه البيئة"
    : state !== LINK_STATE.CONNECTED ? "جاهز — يبدأ الاستقبال بعد الربط"
      : integration?.lastInboundAt ? "يعمل — تصل الرسائل" : "جاهز — لم تصل رسالة بعد";
  return {
    id: "whatsapp", state, stateLabel: LINK_STATE_LABEL[state], signupEnabled, actions,
    number, inboundToday, webhookReady, webhookLabel,
    lastInboundAt: integration?.lastInboundAt || "",
    onboardingMode: config.onboardingMode === "standard" ? "standard" : "coexistence",
    detail: state === LINK_STATE.ERROR ? String(integration?.lastError || "").slice(0, 160) : "",
    note: signupEnabled ? "" : "الربط الرسمي مع Meta غير مفعّل على هذه البيئة بعد. يتفعّل الزر بعد إدخال بيانات تطبيق Meta من إدارة المنصة."
  };
}

/**
 * Embedded Signup options. «coexistence» keeps the number working in the WhatsApp Business
 * app on the phone (the office scans a QR from the app); it never migrates the number.
 */
export function embeddedSignupOptions({ configId, onboardingMode = "coexistence" } = {}) {
  const extras = { setup: {}, sessionInfoVersion: "3" };
  if (onboardingMode !== "standard") extras.featureType = "whatsapp_business_app_onboarding";
  return { config_id: String(configId || ""), response_type: "code", override_default_response_type: true, extras };
}

/** Events Meta posts when the signup window finishes: standard flow and business-app (coexistence) onboarding. */
export const SIGNUP_FINISH_EVENTS = Object.freeze(["FINISH", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", "FINISH_ONLY_WABA"]);

export function signupDataFromEvent(payload) {
  if (!payload || payload.type !== "WA_EMBEDDED_SIGNUP" || !SIGNUP_FINISH_EVENTS.includes(String(payload.event || ""))) return null;
  const data = payload.data || {};
  const clean = (value) => String(value || "").replace(/[^0-9A-Za-z_-]/g, "").slice(0, 120);
  const wabaId = clean(data.waba_id || data.wabaId);
  if (!wabaId) return null;
  return { wabaId, phoneNumberId: clean(data.phone_number_id || data.phoneNumberId), event: String(payload.event) };
}
