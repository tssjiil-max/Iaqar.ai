/**
 * «باحث الفرص» — Telegram groups and channels as a source.
 *
 * The office's manager links a group or a channel to the office's scout:
 *   1. the app gives him a one-time link (t.me/<bot>?startgroup=<code>) — Telegram adds the platform's bot to the
 *      group he picks and sends «/start <code>» there; for a channel he adds the bot as an admin and posts the line himself;
 *   2. from then on, messages in that chat that read as property ads are kept for the office (scoutPosts) and the
 *      scout reads them like any other source. Chatter is never stored.
 *
 * This is Telegram's official Bot API: the bot sees a chat only after an admin of that chat adds it, and it reads
 * ordinary messages only where it was made an admin. No personal account is read, nothing is joined by itself,
 * and nothing is ever posted into the group: this file only receives.
 *
 *   telegramScoutChats/{chatId}            routing: which offices linked this chat (top level, closed to clients)
 *   offices/{o}/scoutChats/{chatId}        the office's own list of its linked chats
 *   offices/{o}/scoutPosts/{id}            the ads that arrived (text + a link to the message; no member list)
 */

import { isLinkCode, telegramDeepLink, TELEGRAM_LINK_MINUTES } from "../../../public/os/domain/channel-link-domain.js";
import { looksLikeAd } from "../../../public/os/domain/scout-domain.js";
import { consumePublicRateLimit, publicRateLimitKey } from "../public-rate-limit.js";
import { AUDIT_ACTIONS, writeAudit } from "./audit-log.js";
import { forbidden } from "./permissions.js";
import { telegramGroupsReady } from "./scout-sources.js";
import { scoutAvailable } from "./scout-store.js";

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const CHAT_ID = /^-?\d{1,20}$/;
const GROUP_TYPES = new Set(["group", "supergroup", "channel"]);
export const SCOUT_CHAT_LIMITS = Object.freeze({ chatsPerOffice: 5, officesPerChat: 5, postsPerChatPerHour: 120 });

const routePath = (chatId) => ["telegramScoutChats", String(chatId)];
const chatPath = (officeId, chatId) => ["offices", officeId, "scoutChats", String(chatId)];

function newLinkCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const activeChats = async (ctx, officeId) => (await ctx.store.list(["offices", officeId, "scoutChats"], 20)).filter((chat) => chat.status === "ACTIVE");

/** What the settings page shows: is the bot there, and which chats this office linked. */
export async function scoutChatsView(ctx, officeId) {
  const configured = scoutAvailable(ctx.env) && telegramGroupsReady(ctx.env);
  if (!configured) return { configured: false, chats: [], limit: SCOUT_CHAT_LIMITS.chatsPerOffice };
  const chats = (await activeChats(ctx, officeId)).map((chat) => ({ chatId: String(chat.chatId), title: text(chat.title, 80) || "قروب تيليجرام", type: text(chat.type, 20), linkedAt: chat.linkedAt || "", lastPostAt: chat.lastPostAt || "" }));
  return { configured: true, chats, limit: SCOUT_CHAT_LIMITS.chatsPerOffice };
}

export async function startScoutChatLink(ctx, { actor, officeId }) {
  if (!actor?.isManager) throw forbidden(ctx.deps, "ربط قروبات تيليجرام بباحث الفرص لمدير المكتب فقط");
  if (!scoutAvailable(ctx.env) || !telegramGroupsReady(ctx.env)) return { ok: true, state: "NOT_CONFIGURED", message: "بوت المنصة على تيليجرام غير مفعّل على هذه البيئة بعد" };
  if ((await activeChats(ctx, officeId)).length >= SCOUT_CHAT_LIMITS.chatsPerOffice) throw ctx.deps.appError("chat_limit", 409, `الحد ${SCOUT_CHAT_LIMITS.chatsPerOffice} قروبات أو قنوات — افصل واحدًا قبل إضافة آخر`);
  const now = ctx.now();
  const code = newLinkCode();
  const hash = await ctx.deps.sha256Hex(`telegram-link|${code}`);
  const expiresAt = new Date(now.getTime() + TELEGRAM_LINK_MINUTES * 60_000);
  // Only the hash is stored. The kind keeps this code from ever completing an office-intake or a side's link.
  await ctx.store.set(["telegramLinkCodes", hash], { kind: "scout_chat", officeId, createdBy: actor.uid, createdAt: now, expiresAt: expiresAt.toISOString(), status: "PENDING" });
  const botUsername = text(ctx.env.TELEGRAM_BOT_USERNAME, 60).replace(/^@/, "");
  return {
    ok: true, state: "PENDING", botUsername, expiresAt: expiresAt.toISOString(), command: `/start ${code}`,
    groupLink: telegramDeepLink(botUsername, code).replace("?start=", "?startgroup=")
  };
}

/** «/start <code>» inside a group or a channel. `handled: false` → not a scout code (the other link kinds take it). */
export async function completeScoutChatLink({ store, deps, env, now = new Date() }, { code, chat = {} }) {
  if (!isLinkCode(code)) return { handled: false };
  const hash = await deps.sha256Hex(`telegram-link|${code}`);
  const record = await store.get(["telegramLinkCodes", hash]);
  if (!record || record.kind !== "scout_chat") return { handled: false };
  const chatId = text(chat.id, 24);
  if (!scoutAvailable(env) || !CHAT_ID.test(chatId)) return { handled: true, ok: false, reason: "unavailable" };
  // The code is for a group or a channel; sent in a private chat it links nothing (and stays usable).
  if (!GROUP_TYPES.has(text(chat.type, 20))) return { handled: true, ok: false, reason: "group_required" };
  const officeId = deps.firestoreOfficeId(record.officeId);
  const expired = new Date(record.expiresAt || 0).getTime() <= now.getTime();
  const claim = record.status === "PENDING" && !expired && officeId
    ? await store.update(["telegramLinkCodes", hash], (current) => (current.status === "PENDING" ? { status: "USED", usedAt: now, chatId, updatedAt: now } : null))
    : null;
  if (!claim || !claim.patch) return { handled: true, ok: false, reason: expired ? "code_expired" : "code_unknown" };
  const title = text(chat.title, 80);
  const username = text(chat.username, 40);
  const type = text(chat.type, 20);
  // One chat may serve a few offices (a public market group); each keeps its own copy of what arrives.
  const existing = await store.get(routePath(chatId));
  const officeIds = [...new Set([...(Array.isArray(existing?.officeIds) ? existing.officeIds : []), officeId])];
  if (officeIds.length > SCOUT_CHAT_LIMITS.officesPerChat) return { handled: true, ok: false, reason: "chat_full" };
  await store.set(routePath(chatId), { chatId, title, type, username, officeIds, updatedAt: now });
  await store.set(chatPath(officeId, chatId), { officeId, chatId, title, type, username, status: "ACTIVE", linkedAt: now.toISOString(), linkedBy: record.createdBy || "", updatedAt: now });
  return { handled: true, ok: true, officeId, chatId };
}

const linkOf = (chat, messageId) => {
  const id = Number(messageId);
  if (!Number.isInteger(id) || id <= 0) return "";
  const username = text(chat.username, 40);
  if (/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(username)) return `https://t.me/${username}/${id}`;
  const internal = String(chat.id || "").match(/^-100(\d{5,15})$/);
  return internal ? `https://t.me/c/${internal[1]}/${id}` : "";
};

/**
 * A message in a group or a channel. Returns null when the chat is not linked to any scout (the webhook goes on
 * as before). An ad is written once per linked office; anything else is dropped here and never stored.
 */
export async function handleScoutChatPost({ store, env, now = new Date() }, { message = {}, chat = {} }) {
  if (!scoutAvailable(env) || !GROUP_TYPES.has(text(chat.type, 20))) return null;
  const chatId = text(chat.id, 24);
  if (!CHAT_ID.test(chatId)) return null;
  const route = await store.get(routePath(chatId));
  const officeIds = (Array.isArray(route?.officeIds) ? route.officeIds : []).slice(0, SCOUT_CHAT_LIMITS.officesPerChat);
  if (!officeIds.length) return null;
  const body = text(message.text || message.caption, 4000);
  if (!looksLikeAd(body)) return { ok: true, status: 200, ignored: true, reason: "not_an_ad" };
  const limited = consumePublicRateLimit(publicRateLimitKey({ route: "scout-chat", ip: chatId, officeId: "" }), { limit: SCOUT_CHAT_LIMITS.postsPerChatPerHour, windowMs: 3_600_000 });
  if (!limited.ok) return { ok: true, status: 200, ignored: true, reason: "chat_busy" };
  const messageId = Number(message.message_id) || 0;
  const postedAt = Number(message.date) > 0 ? new Date(Number(message.date) * 1000) : now;
  const id = `sp_${String(9_999_999_999_999 - now.getTime()).padStart(13, "0")}_${chatId.replace("-", "n")}_${messageId}`;
  let kept = 0;
  for (const officeId of officeIds) {
    // Telegram repeats an update it did not see answered: create-only keeps one copy.
    const created = await store.create(["offices", officeId, "scoutPosts", `${id}`], { officeId, chatId, chatTitle: text(route.title, 80), messageId, text: body, link: linkOf(chat, messageId), postedAt, createdAt: now }).catch(() => false);
    if (created !== false) kept += 1;
  }
  console.log("[scout] group ad kept", JSON.stringify({ offices: kept }));
  return { ok: true, status: 200, scout: true, kept };
}

export async function unlinkScoutChat(ctx, { actor, officeId, chatId }) {
  if (!actor?.isManager) throw forbidden(ctx.deps, "فصل قروبات تيليجرام لمدير المكتب فقط");
  const id = text(chatId, 24);
  if (!CHAT_ID.test(id)) throw ctx.deps.appError("chat_invalid", 400, "المحادثة غير معروفة");
  const mine = await ctx.store.get(chatPath(officeId, id));
  if (!mine || mine.status !== "ACTIVE") return { ok: true, changed: false };
  const now = ctx.now();
  await ctx.store.set(chatPath(officeId, id), { status: "UNLINKED", unlinkedAt: now.toISOString(), unlinkedBy: actor.uid, updatedAt: now });
  await ctx.store.update(routePath(id), (current) => ({ officeIds: (Array.isArray(current.officeIds) ? current.officeIds : []).filter((o) => !ctx.deps.officeIdsEquivalent(o, officeId)), updatedAt: now }));
  await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.CHANNEL_UNLINKED, actorUid: actor.uid, entityType: "scout", entityId: id, key: `scout-chat|${now.toISOString()}`, details: { channel: "telegram_group" } });
  return { ok: true, changed: true };
}
