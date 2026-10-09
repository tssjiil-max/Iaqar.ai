/**
 * «مركز التواصل والدعم» — platform support through a Telegram Business account.
 *
 * A SEPARATE support bot (its own token, its own webhook: /telegram/support/webhook) is connected
 * by the support manager to his Telegram Business account (Telegram → Settings → Business →
 * Chatbots). Telegram then hands the bot every customer message of that account
 * (`business_message`) and the bot answers on the account's behalf (`business_connection_id`).
 * The central intake bot (@iaqar_intake_bot), its webhook and the offices' deal paths are not
 * touched by anything here.
 *
 *   supportConnections/<businessConnectionId>  the account link (owner, can reply, enabled)
 *   supportChats/<connectionId>__<chatId>      BOT / HUMAN mode of one customer chat
 *   supportTickets/<id>                        reports and questions (from Telegram or the office app)
 *   supportSettings/telegram                   which connection is active (for office tickets' alerts)
 *   supportRate/<uid>__<day>                   office tickets per member per day
 *   supportResume/<token>                      what an alert's «إعادة الرد الآلي» button refers to
 * All six are closed to every client by the Firestore rules.
 *
 * Nothing is sent unless the support bot token AND an enabled business connection exist; no reply
 * is invented — see public/os/domain/support-domain.js for the only answers the assistant gives.
 */

import {
  SUPPORT_MODE, SUPPORT_TEXT, TICKET_KIND, TICKET_KIND_LABEL, planSupportReply, supportUsername, validateOfficeTicket
} from "../../../public/os/domain/support-domain.js";

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const CHAT_ID = /^-?\d{1,20}$/;
const TOKEN_SHAPE = /^\d{5,20}:[A-Za-z0-9_-]{30,80}$/;
export const SUPPORT_SECRET_HEADER = "x-telegram-bot-api-secret-token";
export const OFFICE_TICKETS_PER_DAY = 5;

export function supportConfig(env = {}) {
  const token = text(env.TELEGRAM_SUPPORT_BOT_TOKEN, 120);
  return {
    botConfigured: TOKEN_SHAPE.test(token) && Boolean(text(env.TELEGRAM_SUPPORT_WEBHOOK_SECRET, 300)),
    username: supportUsername(env.SUPPORT_TELEGRAM_BUSINESS_USERNAME)
  };
}

function constantTimeEqual(a, b) {
  const x = String(a || ""); const y = String(b || "");
  if (!x || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export function verifySupportSecret(request, env = {}) {
  const expected = text(env.TELEGRAM_SUPPORT_WEBHOOK_SECRET, 300);
  if (!expected) return { ok: false, status: 503, error: "support_webhook_not_configured" };
  if (!constantTimeEqual(request?.headers?.get?.(SUPPORT_SECRET_HEADER), expected)) return { ok: false, status: 401, error: "support_webhook_unauthorized" };
  return { ok: true };
}

function redact(message, token) {
  let out = String(message || "");
  if (token) out = out.split(token).join("<token>");
  return out.replace(/bot\d{5,20}:[A-Za-z0-9_-]{20,}/g, "bot<token>").slice(0, 200);
}

/** One Bot API call with the SUPPORT bot's token. Never throws; never logs the token. */
export async function callSupportTelegram(env, method, payload = {}, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const token = text(env?.TELEGRAM_SUPPORT_BOT_TOKEN, 120);
  if (!TOKEN_SHAPE.test(token)) return { ok: false, skipped: true, description: "support_bot_off" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal
    });
    const body = await response.json().catch(() => null);
    if (body?.ok === true) return { ok: true, result: body.result };
    return { ok: false, status: response.status, description: redact(body?.description || `HTTP ${response.status}`, token) };
  } catch (error) {
    return { ok: false, unreachable: true, description: redact(error?.name === "AbortError" ? "timeout" : error?.message, token) };
  } finally {
    clearTimeout(timer);
  }
}

/** Document key of one customer chat: a hash of the connection id (any characters) + the chat id. */
async function chatKey(ctx, connectionId, chatId) {
  return `sc_${(await ctx.deps.sha256Hex(`support-chat|${text(connectionId, 200)}|${text(chatId, 30)}`)).slice(0, 40)}`;
}
const ticketRef = (id) => String(id || "").replace(/[^A-Za-z0-9]/g, "").slice(-6).toUpperCase();

async function newTicket(ctx, data) {
  const id = `st_${(await ctx.deps.sha256Hex(`support-ticket|${crypto.randomUUID()}`)).slice(0, 32)}`;
  const now = ctx.now();
  await ctx.store.create(["supportTickets", id], { id, status: "OPEN", createdAt: now, updatedAt: now, ...data });
  return { id, ref: ticketRef(id) };
}

/** The support manager's private chat with the bot (Telegram gives it with the business connection). */
async function activeConnection(ctx) {
  const settings = await ctx.store.get(["supportSettings", "telegram"]);
  const id = text(settings?.activeConnectionId, 120);
  if (!id) return null;
  const connection = await ctx.store.get(["supportConnections", id]);
  return connection && connection.enabled === true ? { ...connection, id } : null;
}

async function alertOwner(ctx, connection, body, { resume = null } = {}) {
  if (!connection || !CHAT_ID.test(text(connection.ownerChatId, 30))) return { ok: false, skipped: true };
  const payload = { chat_id: text(connection.ownerChatId, 30), text: String(body).slice(0, 3500), link_preview_options: { is_disabled: true } };
  if (resume) {
    // The button carries a short random token; what it refers to is kept on the server (Telegram allows 64 bytes).
    const token = (await ctx.deps.sha256Hex(`support-resume|${crypto.randomUUID()}`)).slice(0, 32);
    await ctx.store.set(["supportResume", token], { connectionId: resume.connectionId, chatId: resume.chatId, key: resume.key, createdAt: ctx.now() });
    payload.reply_markup = { inline_keyboard: [[{ text: SUPPORT_TEXT.ownerResumeButton, callback_data: `sup:r:${token}` }]] };
  }
  return callSupportTelegram(ctx.env, "sendMessage", payload, { fetchImpl: ctx.fetchImpl });
}

// ------------------------------------------------------------------ office app

/** What the office card may show. Any member of the office may read it; no office data is in it. */
export async function supportStatus(ctx) {
  const config = supportConfig(ctx.env);
  let assistantActive = false;
  if (config.botConfigured && config.username) {
    const connection = await activeConnection(ctx).catch(() => null);
    assistantActive = Boolean(connection && connection.canReply === true);
  }
  return {
    ok: true,
    telegramBusiness: { username: config.username, available: Boolean(config.username) },
    assistant: { active: assistantActive },
    ticketsEnabled: true
  };
}

/** A question or report typed in the office app. Stored for the support manager; alerted on Telegram when the assistant is linked. */
export async function createOfficeTicket(ctx, { actor, officeId, input = {} }) {
  const checked = validateOfficeTicket(input);
  if (!checked.ok) throw Object.assign(new Error(checked.error), { status: 400, code: "invalid_ticket", publicMessage: checked.error });
  const day = ctx.now().toISOString().slice(0, 10);
  const rateKey = `${text(actor?.uid, 128).replace(/[^A-Za-z0-9_-]/g, "")}__${day}`;
  // Counted with a create-or-guarded-update, so parallel sends cannot pass the daily limit.
  const ratePath = ["supportRate", rateKey];
  const first = await ctx.store.create(ratePath, { count: 1, day, updatedAt: ctx.now() });
  if (!first) {
    const counted = await ctx.store.update(ratePath, (current) => (Number(current.count || 0) >= OFFICE_TICKETS_PER_DAY ? null : { count: Number(current.count || 0) + 1, updatedAt: ctx.now() }));
    if (!counted?.patch) throw Object.assign(new Error("rate"), { status: 429, code: "support_rate_limited", publicMessage: "وصلت للحد اليومي للبلاغات. سيتابع المسؤول ما أرسلته." });
  }
  const office = await ctx.store.get(["offices", officeId]).catch(() => null);
  const ticket = await newTicket(ctx, {
    source: "office_app", officeId, uid: text(actor?.uid, 128), kind: checked.kind, text: checked.text, needsAdmin: checked.needsAdmin
  });
  let alerted = false;
  if (supportConfig(ctx.env).botConfigured) {
    const connection = await activeConnection(ctx).catch(() => null);
    const officeName = text(office?.businessName || office?.officeName || office?.name, 80) || "مكتب";
    const sent = await alertOwner(ctx, connection, [
      `${TICKET_KIND_LABEL[checked.kind]} من التطبيق — ${officeName}${checked.needsAdmin ? " · يطلب تدخل المسؤول" : ""}`,
      `رقم البلاغ: ${ticket.ref}`,
      checked.text
    ].join("\n")).catch(() => ({ ok: false }));
    alerted = sent.ok === true;
  }
  return { ok: true, ticketRef: ticket.ref, alerted };
}

// ------------------------------------------------------------------ Telegram Business webhook

async function onBusinessConnection(ctx, connection) {
  const id = text(connection?.id, 120);
  if (!id) return { ok: true, ignored: true, reason: "no_connection_id" };
  const now = ctx.now();
  const enabled = connection.is_enabled === true;
  // Bot API 9: rights.can_reply; older: can_reply.
  const canReply = connection?.rights ? connection.rights.can_reply === true : connection.can_reply === true;
  const record = {
    ownerUserId: text(connection.user?.id, 30), ownerChatId: text(connection.user_chat_id, 30),
    enabled, canReply, updatedAt: now, ...(enabled ? { connectedAt: now } : { disconnectedAt: now })
  };
  await ctx.store.set(["supportConnections", id], record);
  if (enabled) await ctx.store.set(["supportSettings", "telegram"], { activeConnectionId: id, updatedAt: now });
  else {
    const settings = await ctx.store.get(["supportSettings", "telegram"]);
    if (text(settings?.activeConnectionId, 120) === id) await ctx.store.set(["supportSettings", "telegram"], { activeConnectionId: "", updatedAt: now });
  }
  await alertOwner(ctx, { ...record, id }, enabled ? SUPPORT_TEXT.connected : SUPPORT_TEXT.disconnected).catch(() => {});
  return { ok: true, connection: enabled ? "enabled" : "disabled" };
}

async function onBusinessMessage(ctx, message) {
  const connectionId = text(message?.business_connection_id, 120);
  const chatId = text(message?.chat?.id, 30);
  if (!connectionId || !CHAT_ID.test(chatId)) return { ok: true, ignored: true, reason: "not_a_business_message" };
  const connection = await ctx.store.get(["supportConnections", connectionId]);
  if (!connection || connection.enabled !== true) return { ok: true, ignored: true, reason: "connection_not_enabled" };
  // The assistant's own replies come back as business messages too (marked with sender_business_bot): never act on them.
  if (message?.sender_business_bot) return { ok: true, ignored: true, reason: "own_reply" };
  const key = await chatKey(ctx, connectionId, chatId);
  const now = ctx.now();
  // The account owner wrote in the chat himself: a person is answering, the assistant steps back.
  if (text(message?.from?.id, 30) && text(message.from.id, 30) === text(connection.ownerUserId, 30)) {
    await ctx.store.set(["supportChats", key], { mode: SUPPORT_MODE.HUMAN, humanAt: now, awaitingDetails: false, unknownCount: 0, updatedAt: now });
    return { ok: true, mode: SUPPORT_MODE.HUMAN, reason: "owner_replied" };
  }
  const chat = (await ctx.store.get(["supportChats", key])) || {};
  const body = text(message?.text || message?.caption, 2000);
  const plan = planSupportReply(body, chat);
  if (plan.silent) return { ok: true, ignored: true, reason: "human_handling" };
  const customer = text([message?.from?.first_name, message?.from?.last_name].filter(Boolean).join(" "), 80) || "عميل";
  let reply = plan.reply;
  let ticket = null;
  if (plan.ticket) {
    ticket = await newTicket(ctx, { source: "telegram_business", connectionId, chatId, customer, kind: plan.ticket.kind, text: body.slice(0, 1000), needsAdmin: plan.ticket.needsAdmin });
    if (plan.replyIsTicket) reply = SUPPORT_TEXT.ticketSaved(ticket.ref);
  }
  await ctx.store.set(["supportChats", key], {
    mode: plan.mode, unknownCount: plan.unknownCount, awaitingDetails: plan.awaitingDetails, lastCustomerAt: now, updatedAt: now,
    ...(ticket ? { lastTicketId: ticket.id } : {}), ...(plan.mode === SUPPORT_MODE.HUMAN ? { humanAt: now } : {})
  });
  let sent = { ok: false, skipped: true };
  if (reply && connection.canReply === true) {
    sent = await callSupportTelegram(ctx.env, "sendMessage", { business_connection_id: connectionId, chat_id: chatId, text: reply, link_preview_options: { is_disabled: true } }, { fetchImpl: ctx.fetchImpl });
  }
  if (plan.alertOwner) {
    await alertOwner(ctx, connection, [
      SUPPORT_TEXT.ownerAlertTitle,
      `${customer}${ticket ? ` · ${TICKET_KIND_LABEL[ticket ? plan.ticket.kind : TICKET_KIND.QUESTION]} رقم ${ticket.ref}` : ""}`,
      body.slice(0, 600) || "رسالة بلا نص",
      "ردّك من حسابك في المحادثة نفسها؛ المساعد متوقف فيها حتى تعيده."
    ].join("\n"), { resume: { connectionId, chatId, key } }).catch(() => {});
  }
  return { ok: true, mode: plan.mode, replied: sent.ok === true, ticketRef: ticket?.ref || "" };
}

async function onCallback(ctx, query) {
  const data = text(query?.data, 64);
  const match = data.match(/^sup:r:([a-f0-9]{32})$/);
  const answer = (message) => callSupportTelegram(ctx.env, "answerCallbackQuery", { callback_query_id: text(query?.id, 80), text: message }, { fetchImpl: ctx.fetchImpl }).catch(() => {});
  if (!match) { await answer(""); return { ok: true, ignored: true, reason: "unknown_callback" }; }
  const target = await ctx.store.get(["supportResume", match[1]]);
  const connection = target ? await ctx.store.get(["supportConnections", text(target.connectionId, 200)]) : null;
  // Only the account owner may hand a chat back to the assistant.
  if (!target || !connection || text(query?.from?.id, 30) !== text(connection.ownerUserId, 30)) { await answer(""); return { ok: true, ignored: true, reason: "not_the_owner" }; }
  await ctx.store.set(["supportChats", text(target.key, 80)], { mode: SUPPORT_MODE.BOT, unknownCount: 0, awaitingDetails: false, resumedAt: ctx.now(), updatedAt: ctx.now() });
  await answer(SUPPORT_TEXT.ownerResumed);
  return { ok: true, mode: SUPPORT_MODE.BOT };
}

/** The support bot's private chat (not a business chat): it only explains itself. */
async function onPrivateMessage(ctx, message) {
  const chatId = text(message?.chat?.id, 30);
  if (!CHAT_ID.test(chatId) || message?.chat?.type !== "private") return { ok: true, ignored: true, reason: "not_private" };
  await callSupportTelegram(ctx.env, "sendMessage", { chat_id: chatId, text: "هذا مساعد دعم منصة iAqar. يعمل من خلال حساب الأعمال في تيليجرام، ولا يستقبل العروض والطلبات." }, { fetchImpl: ctx.fetchImpl });
  return { ok: true, reason: "private_explained" };
}

export async function handleSupportUpdate(ctx, update = {}) {
  if (update.business_connection) return onBusinessConnection(ctx, update.business_connection);
  if (update.business_message) return onBusinessMessage(ctx, update.business_message);
  if (update.edited_business_message) return { ok: true, ignored: true, reason: "edit" };
  if (update.callback_query) return onCallback(ctx, update.callback_query);
  if (update.message) return onPrivateMessage(ctx, update.message);
  return { ok: true, ignored: true, reason: "unsupported_update" };
}
