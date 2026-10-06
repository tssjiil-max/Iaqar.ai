/**
 * «بوت المكتب» — the sending side: the one place that calls Telegram, and the small lookups
 * every caller needs (who is linked, is the office's switch on). It imports no service, so the
 * journey, session and task services can use it without import cycles.
 *
 * Three independent gates, all required before anything is written to a side:
 *   1. the platform bot is set up on this environment AND sending is allowed there
 *      (TELEGRAM_OUTBOUND = "enabled" — set for Staging only);
 *   2. the office switched its bot on («قنوات المكتب»);
 *   3. the person pressed Start on the office's link (Telegram's own rule) and did not stop it.
 * A broker's own alerts need gate 1 and his own link only.
 *
 * Routing collections are top level and closed to every client by the Firestore rules:
 *   telegramParties/<key>      one linked side of one office (key = hash of office + mobile)
 *   telegramBrokers/<o>__<uid> a broker's alerts chat
 *   telegramBotChats/<chatId>  reverse lookup: which offices this chat belongs to, and as what
 */

import { BOT_ROLE, isQuietHour, partyPhone, relayMessage, BOT_TEXT } from "../../../public/os/domain/bot-domain.js";

const text = (value) => String(value ?? "").trim();
const CHAT_ID = /^-?\d{1,20}$/;

export function botOutboundConfig(env = {}) {
  const botUsername = text(env.TELEGRAM_BOT_USERNAME).replace(/^@/, "");
  const configured = Boolean(text(env.TELEGRAM_BOT_TOKEN) && text(env.TELEGRAM_WEBHOOK_SECRET) && botUsername);
  return { configured, available: configured && text(env.TELEGRAM_OUTBOUND).toLowerCase() === "enabled", botUsername };
}

/** Never let a token reach a log line (Telegram addresses carry it). */
function redact(message, token) {
  let out = String(message || "");
  if (token) out = out.split(token).join("<token>");
  return out.replace(/bot\d{5,20}:[A-Za-z0-9_-]{20,}/g, "bot<token>").slice(0, 200);
}

// When Telegram cannot be reached, calls are skipped for a short while instead of each one
// waiting for its own timeout — matching and replies must never queue behind a dead network.
const PAUSE_AFTER_FAILURE_MS = 60 * 1000;
let pausedUntil = 0;

/**
 * One Bot API call. Never throws: { ok, messageId, blocked, description }.
 * `blocked` = the person stopped or deleted the bot (403) — the link is then switched off.
 */
export async function callTelegram(env, method, payload = {}, { fetchImpl = fetch, timeoutMs = 5000, now = Date.now() } = {}) {
  const token = text(env?.TELEGRAM_BOT_TOKEN);
  if (!botOutboundConfig(env || {}).available) return { ok: false, skipped: true, description: "telegram_outbound_off" };
  if (now < pausedUntil) return { ok: false, unreachable: true, description: "telegram_unreachable_recently" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal
    });
    const body = await response.json().catch(() => null);
    if (body?.ok === true) return { ok: true, messageId: Number(body.result?.message_id || 0) || 0 };
    if (response.status >= 500 || response.status === 429) pausedUntil = Date.now() + PAUSE_AFTER_FAILURE_MS;
    return { ok: false, status: response.status, blocked: response.status === 403, description: redact(body?.description || `HTTP ${response.status}`, token) };
  } catch (error) {
    pausedUntil = Date.now() + PAUSE_AFTER_FAILURE_MS;
    return { ok: false, unreachable: true, description: redact(error?.name === "AbortError" ? "timeout" : error?.message, token) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Plain text to one chat, with either answer buttons or one link button.
 * `deps.telegram(method, payload)` is bound to the environment by the Worker; absent = nothing is sent.
 */
export async function sendToChat(deps, chatId, body, { buttons = null, link = null, keyboard = null, now = new Date() } = {}) {
  if (typeof deps?.telegram !== "function" || !CHAT_ID.test(text(chatId))) return { ok: false, skipped: true };
  const payload = { chat_id: text(chatId), text: String(body || "").slice(0, 3500), disable_notification: isQuietHour(now), link_preview_options: { is_disabled: true } };
  if (keyboard) payload.reply_markup = keyboard;
  else if (buttons) payload.reply_markup = { inline_keyboard: buttons };
  else if (link && /^https:\/\//.test(String(link.url || ""))) payload.reply_markup = { inline_keyboard: [[{ text: String(link.text || "فتح").slice(0, 40), url: String(link.url) }]] };
  else if (link?.url) payload.text = `${payload.text}\n${link.url}`;
  return deps.telegram("sendMessage", payload);
}

// ------------------------------------------------------------------ lookups

export async function botSettings(store, officeId) {
  return (await store.get(["offices", officeId, "botSettings", "telegram"])) || {};
}

export async function partyKey(deps, officeId, phoneDigits) {
  if (!phoneDigits) return "";
  return `tp_${(await deps.sha256Hex(`telegram-party|${officeId}|${phoneDigits}`)).slice(0, 40)}`;
}

/** The linked side behind a record of this office, or null (not linked, stopped, or no usable mobile). */
export async function partyLinkFor(store, deps, officeId, record, { includeStopped = false } = {}) {
  const key = await partyKey(deps, officeId, partyPhone(record || {}));
  if (!key) return null;
  const link = await store.get(["telegramParties", key]);
  if (!link || !deps.officeIdsEquivalent(link.officeId, officeId) || !CHAT_ID.test(text(link.chatId))) return null;
  if (link.status !== "ACTIVE" && !includeStopped) return null;
  return { ...link, key };
}

export function brokerKey(officeId, uid) {
  return `${officeId}__${uid}`;
}

export async function brokerLinkFor(store, deps, officeId, uid) {
  if (!uid) return null;
  const link = await store.get(["telegramBrokers", brokerKey(officeId, uid)]);
  if (!link || link.status !== "ACTIVE" || !deps.officeIdsEquivalent(link.officeId, officeId) || !CHAT_ID.test(text(link.chatId))) return null;
  return link;
}

/**
 * A message to a linked side: sent, the chat remembers which office wrote last (a reply the
 * side types is then routed to that office only), and a blocked bot switches the link off.
 */
export async function sendToParty(store, deps, officeId, link, body, options = {}) {
  const now = options.now || new Date();
  const sent = await sendToChat(deps, link.chatId, body, { ...options, now });
  if (sent.ok) await store.set(["telegramBotChats", text(link.chatId)], { lastOfficeId: officeId, lastOfficeAt: now, updatedAt: now }).catch(() => {});
  else if (sent.blocked) await markPartyBlocked(store, link.key, now);
  return sent;
}

/** A side stopped or deleted the bot: its link is switched off so nothing more is attempted. */
export async function markPartyBlocked(store, key, now = new Date()) {
  if (!key) return;
  await store.set(["telegramParties", key], { status: "BLOCKED", blockedAt: now, updatedAt: now }).catch(() => {});
}

// ------------------------------------------------------------------ the broker's own alerts

/**
 * A short alert to the broker's own Telegram chat, with a button that opens the place in the
 * office app. Sent only for what needs him; skipped silently when he has not linked his chat.
 */
export async function alertBrokerOnTelegram(store, deps, { officeId, brokerId, title, body = "", route = "", now = new Date() }) {
  if (typeof deps?.telegram !== "function") return { ok: false, skipped: true };
  let uid = text(brokerId);
  if (!uid) uid = text((await store.get(["offices", officeId]))?.ownerUid);
  const link = await brokerLinkFor(store, deps, officeId, uid);
  if (!link) return { ok: false, skipped: true, reason: "broker_not_linked" };
  // Someone who left the office (or was deactivated) receives nothing more about it.
  const member = await store.get(["offices", officeId, "members", uid]);
  if (!member || member.active === false) {
    await store.set(["telegramBrokers", brokerKey(officeId, uid)], { status: "UNLINKED", unlinkedAt: now, unlinkReason: "not_a_member", updatedAt: now }).catch(() => {});
    return { ok: false, skipped: true, reason: "not_a_member" };
  }
  const origin = text(deps.appOrigin).replace(/\/+$/, "");
  const message = [text(title), text(body) && text(body) !== text(title) ? text(body) : ""].filter(Boolean).join("\n");
  const sent = await sendToChat(deps, link.chatId, message, { link: origin && route ? { text: "فتح في النظام", url: `${origin}/#/${route}` } : null, now });
  if (sent.blocked) await store.set(["telegramBrokers", brokerKey(officeId, uid)], { status: "BLOCKED", blockedAt: now, updatedAt: now }).catch(() => {});
  return sent;
}

/**
 * In-app notification (create-only by key) + push + the broker's Telegram alert, for things
 * that are not tied to an open deal yet (a side wrote to the bot, the owner is not linked…).
 */
export async function notifyOffice(store, deps, { officeId, brokerId = "", key, title, body = "", route = "tasks", matchId = "", opportunityId = "", now = new Date() }) {
  const id = `nt_${(await deps.sha256Hex(`notif|bot|${officeId}|${key}`)).slice(0, 40)}`;
  const created = await store.create(["offices", officeId, "notifications", id], {
    schemaVersion: 1, id, officeId, brokerId: text(brokerId), operationId: "", taskId: "", workflowId: "",
    matchId: text(matchId), opportunityId: text(opportunityId), route: text(route), entityType: "bot", entityId: "",
    type: "BOT_UPDATE", title: text(title).slice(0, 120), body: text(body).slice(0, 240), status: "CREATED", readAt: "",
    createdAt: now, updatedAt: now, deduplicationKey: `bot|${key}`, sensitivePreview: false, createdBySystem: true
  });
  if (!created) return { id, created: false };
  if (typeof deps.sendOfficePush === "function") {
    await deps.sendOfficePush({ officeId, title: text(title), body: text(body), type: "message", recordId: "", taskId: "", operationId: "", opportunityId: text(opportunityId), matchId: text(matchId), assignedBrokerId: text(brokerId) })
      .catch((error) => console.warn("[office-os] bot push failed", error?.message));
  }
  await alertBrokerOnTelegram(store, deps, { officeId, brokerId, title, body, route, now }).catch(() => {});
  return { id, created: true };
}

// ------------------------------------------------------------------ between the two sides

/**
 * One side moved in the negotiation room: the other side is told in Telegram, with its own
 * room link. Only what both sides see in the room is relayed. Skipped when the office's bot
 * is off, the broker took this deal over, or the other side is not linked.
 */
export async function relayRoomMove(ctx, { officeId, journey, fromRole, text: moveText, urlFor }) {
  if (typeof ctx.deps?.telegram !== "function") return { ok: false, skipped: true };
  if (journey?.bot?.paused === true) return { ok: false, skipped: true, reason: "broker_took_over" };
  const settings = await botSettings(ctx.store, officeId);
  if (settings.enabled !== true) return { ok: false, skipped: true, reason: "office_switch_off" };
  const toRole = fromRole === BOT_ROLE.OWNER ? BOT_ROLE.CLIENT : BOT_ROLE.OWNER;
  const recordId = toRole === BOT_ROLE.OWNER ? journey.offerId : journey.requestId;
  const record = await ctx.store.get(["offices", officeId, "opportunities", String(recordId || "")]);
  const link = await partyLinkFor(ctx.store, ctx.deps, officeId, record);
  if (!link) return { ok: false, skipped: true, reason: "side_not_linked" };
  const url = await urlFor(toRole);
  const sent = await sendToParty(ctx.store, ctx.deps, officeId, link, relayMessage({ fromRole, text: moveText }), { link: url ? { text: BOT_TEXT.roomButton, url } : null, now: ctx.now() });
  return { ...sent, toRole };
}
