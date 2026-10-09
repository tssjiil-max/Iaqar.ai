/**
 * «قنوات المكتب» — each office links its own channels; the link is stored on the server
 * against the office id and decides which office an inbound message belongs to.
 *
 *   WhatsApp  per-office WhatsApp Business number through Meta Embedded Signup (existing
 *             /meta/signup/complete). Routing truth: whatsapp_accounts/<phoneNumberId>.
 *   Telegram  ONE platform bot. An office links a chat to itself with a one-time code
 *             («/start <code>»). Routing truth: telegramChats/<chatId> → officeId.
 *
 * Both routing collections are top level and closed to every client by the Firestore rules
 * (only this Worker reads or writes them). No token or secret is ever returned to a browser.
 * Channels stay inbound transport: nothing here sends a message.
 */

import { AUDIT_ACTIONS, writeAudit } from "./audit-log.js";
import { forbidden } from "./permissions.js";
import {
  LINK_STATE, TELEGRAM_LINK_MINUTES, isLinkCode, parseStartCommand, telegramDeepLink, telegramLinkView, whatsappLinkView
} from "../../../public/os/domain/channel-link-domain.js";

import { botStatus, completeBotLink, handleBotCallback, handleBotChatMessage } from "./bot-service.js";
import { handleValidityCallback, isValidityCallback } from "./validity-service.js";

const text = (value) => String(value ?? "").trim();

export function telegramConfig(env = {}) {
  const botUsername = text(env.TELEGRAM_BOT_USERNAME).replace(/^@/, "");
  return { configured: Boolean(text(env.TELEGRAM_BOT_TOKEN) && text(env.TELEGRAM_WEBHOOK_SECRET) && botUsername), botUsername };
}

export function whatsappConfig(env = {}) {
  return {
    signupEnabled: Boolean(text(env.META_APP_ID) && text(env.META_CONFIG_ID) && text(env.META_APP_SECRET)),
    // «coexistence» keeps the number on the WhatsApp Business app; it is the default so a link never migrates a number.
    onboardingMode: text(env.META_ONBOARDING_MODE).toLowerCase() === "standard" ? "standard" : "coexistence",
    webhookReady: Boolean(text(env.META_APP_SECRET) && text(env.META_WEBHOOK_VERIFY_TOKEN))
  };
}

function utcDayId(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function assertManager(ctx, actor) {
  if (!actor?.isManager) throw forbidden(ctx.deps, "ربط القنوات وفصلها لمدير المكتب فقط");
}

/** base64url, 32 random bytes → 43 chars: valid as a Telegram start parameter and unguessable. */
function newLinkCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The office's WhatsApp link, trusted only when the server-side routing record agrees. */
async function whatsappState(ctx, officeId) {
  const integration = (await ctx.store.get(["offices", officeId, "integrations", "whatsapp"])) || {};
  const phoneNumberId = text(integration.phoneNumberId);
  if (!phoneNumberId) return { status: "", phoneNumberId: "" };
  const account = await ctx.store.get(["whatsapp_accounts", phoneNumberId]);
  if (!account || !ctx.deps.officeIdsEquivalent(account.officeId, officeId)) return { status: "", phoneNumberId: "" };
  return {
    status: text(account.status), phoneNumberId,
    displayPhoneNumber: text(account.displayPhoneNumber || integration.displayPhoneNumber),
    lastInboundAt: integration.lastInboundAt || "", lastError: text(integration.lastError),
    connectedAt: account.connectedAt || integration.connectedAt || "", disconnectedAt: account.disconnectedAt || ""
  };
}

export async function channelsStatus(ctx, { officeId, actor = null }) {
  const now = ctx.now();
  const [wa, tg, usage] = await Promise.all([
    whatsappState(ctx, officeId),
    ctx.store.get(["telegramOfficeLinks", officeId]),
    ctx.store.get(["offices", officeId, "usage", `whatsapp_${utcDayId(now)}`])
  ]);
  const bot = await botStatus(ctx, { actor, officeId });
  return {
    ok: true,
    // «assisted»: the system prepares, a human decides. With the office's bot switched on, the
    // bot asks the two sides about a match and passes room moves between them — nothing else is sent.
    automationMode: bot.enabled ? "BOT_PARTIES" : "ASSISTED",
    outboundEnabled: bot.enabled,
    bot,
    channels: [
      whatsappLinkView(wa, whatsappConfig(ctx.env), usage || {}),
      telegramLinkView(tg || {}, telegramConfig(ctx.env), now)
    ]
  };
}

// ------------------------------------------------------------------ Telegram

export async function startTelegramLink(ctx, { actor, officeId }) {
  assertManager(ctx, actor);
  const config = telegramConfig(ctx.env);
  if (!config.configured) return { ok: true, state: "NOT_CONFIGURED", message: "بوت المنصة غير مفعّل على هذه البيئة بعد" };
  const now = ctx.now();
  const code = newLinkCode();
  const hash = await ctx.deps.sha256Hex(`telegram-link|${code}`);
  const expiresAt = new Date(now.getTime() + TELEGRAM_LINK_MINUTES * 60 * 1000);
  const existing = (await ctx.store.get(["telegramOfficeLinks", officeId])) || {};
  // A previous unused code stops working as soon as a new one is issued.
  if (existing.pendingCodeHash && existing.pendingCodeHash !== hash) {
    await ctx.store.set(["telegramLinkCodes", existing.pendingCodeHash], { status: "REPLACED", updatedAt: now }).catch(() => {});
  }
  // Only the hash is stored: the code itself exists in the link shown to the manager and nowhere else.
  await ctx.store.set(["telegramLinkCodes", hash], { officeId, createdBy: actor.uid, createdAt: now, expiresAt: expiresAt.toISOString(), status: "PENDING" });
  await ctx.store.set(["telegramOfficeLinks", officeId], {
    officeId,
    // An existing connected chat keeps working until the new link is completed.
    status: existing.status === LINK_STATE.CONNECTED && existing.chatId ? LINK_STATE.CONNECTED : LINK_STATE.PENDING,
    pendingCodeHash: hash, pendingExpiresAt: expiresAt.toISOString(), pendingBy: actor.uid, lastError: "", updatedAt: now
  });
  await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.CHANNEL_LINK_STARTED, actorUid: actor.uid, entityType: "channel", entityId: "telegram", key: hash.slice(0, 16), details: { channel: "telegram" } });
  return { ok: true, state: LINK_STATE.PENDING, deepLink: telegramDeepLink(config.botUsername, code), botUsername: config.botUsername, expiresAt: expiresAt.toISOString() };
}

export async function unlinkTelegram(ctx, { actor, officeId }) {
  assertManager(ctx, actor);
  const now = ctx.now();
  const link = await ctx.store.get(["telegramOfficeLinks", officeId]);
  if (!link) return { ok: true, state: LINK_STATE.DISCONNECTED, changed: false };
  if (link.chatId) {
    const chat = await ctx.store.get(["telegramChats", String(link.chatId)]);
    if (chat && ctx.deps.officeIdsEquivalent(chat.officeId, officeId)) {
      await ctx.store.set(["telegramChats", String(link.chatId)], { status: "UNLINKED", unlinkedAt: now, unlinkedBy: actor.uid, updatedAt: now });
    }
  }
  if (link.pendingCodeHash) await ctx.store.set(["telegramLinkCodes", link.pendingCodeHash], { status: "CANCELLED", updatedAt: now }).catch(() => {});
  await ctx.store.set(["telegramOfficeLinks", officeId], {
    officeId, status: LINK_STATE.DISCONNECTED, chatId: "", chatTitle: "", username: "", pendingCodeHash: "", pendingExpiresAt: "", lastError: "",
    unlinkedAt: now, unlinkedBy: actor.uid, updatedAt: now
  });
  await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.CHANNEL_UNLINKED, actorUid: actor.uid, entityType: "channel", entityId: "telegram", key: now.toISOString(), details: { channel: "telegram" } });
  return { ok: true, state: LINK_STATE.DISCONNECTED, changed: true };
}

/**
 * «/start <code>» from the manager's chat completes the link. One chat serves one office:
 * a chat already linked to another office is refused and the reason is shown to the manager
 * who started this link.
 */
export async function completeTelegramLink({ store, deps, now = new Date() }, { code, chat = {}, from = {} }) {
  if (!isLinkCode(code)) return { ok: false, reason: "code_invalid" };
  const hash = await deps.sha256Hex(`telegram-link|${code}`);
  const record = await store.get(["telegramLinkCodes", hash]);
  // A side's or a broker's bot link is never an office link (those are completed by the bot service).
  if (!record || record.status !== "PENDING" || (record.kind && record.kind !== "office")) return { ok: false, reason: "code_unknown" };
  const officeId = deps.firestoreOfficeId(record.officeId);
  if (!officeId) return { ok: false, reason: "code_unknown" };
  const chatId = text(chat.id);
  if (!/^-?\d{1,20}$/.test(chatId)) return { ok: false, reason: "chat_invalid" };
  const fail = async (reason, message) => {
    await store.set(["telegramLinkCodes", hash], { status: "FAILED", failedAt: now, failReason: reason, updatedAt: now });
    const current = (await store.get(["telegramOfficeLinks", officeId])) || {};
    await store.set(["telegramOfficeLinks", officeId], {
      officeId, status: current.status === LINK_STATE.CONNECTED && current.chatId ? LINK_STATE.CONNECTED : LINK_STATE.ERROR,
      lastError: message, pendingCodeHash: "", pendingExpiresAt: "", updatedAt: now
    });
    return { ok: false, reason, officeId };
  };
  // The code is claimed atomically, so two chats can never complete the same link.
  const claim = await store.update(["telegramLinkCodes", hash], (current) => (current.status === "PENDING" ? { status: "CLAIMED", claimedAt: now, updatedAt: now } : null));
  if (!claim || !claim.patch) return { ok: false, reason: "code_unknown" };
  if (new Date(record.expiresAt || 0).getTime() <= now.getTime()) return fail("code_expired", "انتهت صلاحية رابط الربط — أنشئ رابطًا جديدًا.");
  const title = text(chat.title || [from.first_name, from.last_name].filter(Boolean).join(" ")).slice(0, 80);
  const username = text(chat.username || from.username).slice(0, 40);
  const chatDoc = {
    chatId, officeId, status: "ACTIVE", chatType: text(chat.type).slice(0, 20), chatTitle: title, username,
    linkedAt: now, linkedBy: record.createdBy || "", linkedTelegramUserId: text(from.id), updatedAt: now
  };
  // One chat serves one office: created if free, otherwise taken over only when it is not
  // actively linked to another office (checked and written under the same precondition).
  let chatLinked = await store.create(["telegramChats", chatId], chatDoc);
  if (!chatLinked) {
    const taken = await store.update(["telegramChats", chatId], (current) => (
      current.status === "ACTIVE" && !deps.officeIdsEquivalent(current.officeId, officeId) ? null : chatDoc));
    chatLinked = Boolean(taken && taken.patch);
  }
  if (!chatLinked) return fail("chat_linked_elsewhere", "هذه المحادثة مرتبطة بمكتب آخر. افصلها هناك أولًا أو استخدم محادثة أخرى.");
  const previous = (await store.get(["telegramOfficeLinks", officeId])) || {};
  if (previous.chatId && String(previous.chatId) !== chatId) {
    await store.set(["telegramChats", String(previous.chatId)], { status: "UNLINKED", unlinkedAt: now, unlinkedBy: record.createdBy || "", updatedAt: now }).catch(() => {});
  }
  await store.set(["telegramLinkCodes", hash], { status: "USED", usedAt: now, chatId, updatedAt: now });
  await store.set(["telegramOfficeLinks", officeId], {
    officeId, status: LINK_STATE.CONNECTED, chatId, chatTitle: title, username, linkedAt: now.toISOString(), linkedBy: record.createdBy || "",
    pendingCodeHash: "", pendingExpiresAt: "", lastError: "", updatedAt: now
  });
  return { ok: true, officeId, chatId };
}

/** Which office does this chat belong to? "" when the chat is not linked (the message is then ignored). */
export async function officeForTelegramChat({ store, deps }, chatId) {
  const id = text(chatId);
  if (!/^-?\d{1,20}$/.test(id)) return "";
  const chat = await store.get(["telegramChats", id]);
  if (!chat || chat.status !== "ACTIVE") return "";
  return deps.firestoreOfficeId(chat.officeId) || "";
}

/**
 * Central bot webhook: POST /telegram/webhook (no office in the address).
 *   1. the shared secret header is verified (same check as the per-office route);
 *   2. «/start <code>» completes an office link;
 *   3. any other message is routed to the office its chat is linked to and handed to
 *      `forward(officeId, update)` — the existing inbound pipeline; an unlinked chat is ignored.
 * Always answers 200 for a well-formed, authorised update so Telegram does not retry forever.
 */
export async function handleCentralTelegramWebhook({ request, env, store, deps, verifySecret, forward, now = new Date(), bot = null }) {
  const secret = verifySecret(request, env.TELEGRAM_WEBHOOK_SECRET);
  if (!secret.ok) return secret;
  const update = await request.json().catch(() => null);
  if (!update || typeof update !== "object" || update.update_id === undefined) return { ok: false, status: 400, error: "telegram_update_invalid" };
  // «بوت المكتب»: a side pressed «مناسب / غير مناسب». A failure is logged, never sent back to Telegram as an error (it would retry forever).
  if (update.callback_query) {
    if (!bot) return { ok: true, status: 200, ignored: true, reason: "bot_off" };
    try { return isValidityCallback(update.callback_query.data) ? await handleValidityCallback(bot, update.callback_query) : await handleBotCallback(bot, update.callback_query); } catch (error) {
      console.error("[office-os] bot callback failed", error?.code || error?.message);
      return { ok: true, status: 200, ignored: true, reason: "bot_error" };
    }
  }
  const message = update.message || update.channel_post || update.edited_message || {};
  const chat = message.chat || {};
  const code = parseStartCommand(message.text);
  if (code) {
    if (bot) {
      try {
        const botLink = await completeBotLink(bot, { code, chat, from: message.from || {} });
        if (botLink.handled) return { ok: true, status: 200, linked: botLink.ok === true, kind: botLink.kind || "", awaiting: botLink.awaiting || "", reason: botLink.ok ? "" : botLink.reason };
      } catch (error) {
        console.error("[office-os] bot link failed", error?.code || error?.message);
        return { ok: true, status: 200, linked: false, reason: "bot_error" };
      }
    }
    const linked = await completeTelegramLink({ store, deps, now }, { code, chat, from: message.from || {} });
    return { ok: true, status: 200, linked: linked.ok, reason: linked.ok ? "" : linked.reason };
  }
  if (/^\/start\b/.test(text(message.text))) {
    // «/start» alone from a side that had stopped the bot: it is its way back.
    if (bot && update.message && text(message.text) === "/start") {
      try { const resumed = await handleBotChatMessage(bot, { update, message }); if (resumed) return resumed; } catch (error) { console.error("[office-os] bot resume failed", error?.code || error?.message); }
    }
    return { ok: true, status: 200, ignored: true, reason: "start_without_code" };
  }
  const officeId = await officeForTelegramChat({ store, deps }, chat.id);
  if (!officeId) {
    // Not an office's intake chat: it may be a side's own chat with the bot.
    if (bot && update.message) {
      try {
        const handled = await handleBotChatMessage(bot, { update, message });
        if (handled) return handled;
      } catch (error) { console.error("[office-os] bot message failed", error?.code || error?.message); }
    }
    return { ok: true, status: 200, ignored: true, reason: "chat_not_linked" };
  }
  const result = await forward(officeId, update);
  // «آخر رسالة» is stamped only when the message was really accepted for this office.
  if (result?.ok !== false && Number(result?.status || 200) < 400) {
    await store.set(["telegramOfficeLinks", officeId], { lastInboundAt: now.toISOString(), updatedAt: now }).catch(() => {});
  }
  return { ...result, routedBy: "chat_link" };
}

// ------------------------------------------------------------------ WhatsApp

/**
 * Stop receiving for this office: the routing record is switched off, so the Meta webhook no
 * longer delivers this number's messages to any office. The business keeps its WhatsApp
 * account; removing the app from Meta's side is done in WhatsApp Business settings.
 */
export async function disconnectWhatsapp(ctx, { actor, officeId }) {
  assertManager(ctx, actor);
  const now = ctx.now();
  const state = await whatsappState(ctx, officeId);
  if (!state.phoneNumberId) return { ok: true, state: LINK_STATE.DISCONNECTED, changed: false };
  if (state.status !== "connected") return { ok: true, state: LINK_STATE.DISCONNECTED, changed: false };
  await ctx.store.set(["whatsapp_accounts", state.phoneNumberId], { status: "disconnected", disconnectedAt: now, disconnectedByUid: actor.uid, updatedAt: now });
  await ctx.store.set(["offices", officeId, "integrations", "whatsapp"], { officeId, status: "disconnected", disconnectedAt: now, updatedAt: now });
  await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.CHANNEL_UNLINKED, actorUid: actor.uid, entityType: "channel", entityId: "whatsapp", key: now.toISOString(), details: { channel: "whatsapp" } });
  return { ok: true, state: LINK_STATE.DISCONNECTED, changed: true };
}
