/**
 * «بوت المكتب» — the office's Telegram bot talks to the two sides of a match.
 *
 *   new match → the client is asked «مناسب؟» → on yes the owner is asked → on two yeses the
 *   deal opens (the same approval the broker gives by hand) and each side receives its own
 *   negotiation-room link. A «غير مناسب» closes that match. The broker is told only when a
 *   side needs him. A side that never opened the bot changes nothing: its match stays the
 *   broker's review task, exactly as before.
 *
 * Everything is off until the office's manager switches it on, and it can be switched off at
 * any moment; a broker can also take one deal back from the bot. Every step is written to the
 * match / the deal's log, and a message counts as sent only when Telegram accepted it.
 */

import { AUDIT_ACTIONS, writeAudit } from "./audit-log.js";
import { assertCanActOn, forbidden } from "./permissions.js";
import { applyJourneyChange, decideMatchReview, loadJourney } from "./journey-service.js";
import { journeyTitle } from "./task-service.js";
import { sessionLinks } from "./session-service.js";
import { isLinkCode, telegramDeepLink } from "../../../public/os/domain/channel-link-domain.js";
import { buildWhatsAppUrl, cleanText, toDate, whatsappDigits } from "../../../public/os/domain/format-domain.js";
import { isJourneyOpen } from "../../../public/os/domain/journey-domain.js";
import { LIFECYCLE, lifecycleOf, priceOf } from "../../../public/os/domain/records-domain.js";
import {
  ASK_STATE, BOT_LIMITS, BOT_ROLE, BOT_ROLE_LABEL, BOT_TEXT, askBlocker, askButtons, askMessage, awaitedRole, botView,
  parseCallback, partyCommand, partyPhone, partyWelcome, planAnswer, reaskDecision, riyadhDayId
} from "../../../public/os/domain/bot-domain.js";
import {
  alertBrokerOnTelegram, botOutboundConfig, botSettings, brokerKey, notifyOffice, partyKey, partyLinkFor, sendToChat, sendToParty
} from "./bot-notify.js";

const text = (value) => String(value ?? "").trim();
const CHAT_ID = /^-?\d{1,20}$/;

/** The bot acts with the office's own authority once both sides agreed; it is never a request's actor. */
export const BOT_ACTOR = Object.freeze({ uid: "telegram-bot", role: "system", isManager: true });

function newToken(bytes = 16) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function summaryOf(record = {}) {
  return {
    propertyType: cleanText(record.propertyType, 40), purpose: String(record.purpose || "").toUpperCase(),
    city: cleanText(record.city, 60), district: cleanText(record.district, 80),
    price: priceOf(record), area: Number(record.area || 0) || null, rooms: Number(record.rooms || 0) || null
  };
}

async function officeName(ctx, officeId) {
  const office = (await ctx.store.get(["offices", officeId])) || {};
  return cleanText(office.officeName || office.name, 60);
}

function assertManager(ctx, actor) {
  if (!actor?.isManager) throw forbidden(ctx.deps, "تشغيل بوت المكتب وإيقافه لمدير المكتب فقط");
}

function assertAvailable(ctx) {
  if (!botOutboundConfig(ctx.env).available) throw ctx.deps.appError("bot_unavailable", 409, "بوت المنصة غير مفعّل للإرسال على هذه البيئة بعد");
}

// ------------------------------------------------------------------ the office's switch

export async function botStatus(ctx, { actor, officeId }) {
  const config = botOutboundConfig(ctx.env);
  const [settings, broker] = await Promise.all([
    botSettings(ctx.store, officeId),
    actor?.uid ? ctx.store.get(["telegramBrokers", brokerKey(officeId, actor.uid)]) : null
  ]);
  return botView({ available: config.available, botUsername: config.botUsername, settings, linkedParties: settings.linkedParties, broker: broker || {} });
}

export async function setBotEnabled(ctx, { actor, officeId, enabled }) {
  assertManager(ctx, actor);
  const on = enabled === true;
  if (on) assertAvailable(ctx);
  const now = ctx.now();
  const current = await botSettings(ctx.store, officeId);
  if ((current.enabled === true) === on) return { ok: true, enabled: on, changed: false };
  await ctx.store.set(["offices", officeId, "botSettings", "telegram"], {
    officeId, enabled: on, minScore: Number(current.minScore || BOT_LIMITS.minScore),
    // Only matches found after this moment are asked about — never a backlog of older ones.
    ...(on ? { enabledAt: now.toISOString(), enabledBy: actor.uid } : { disabledAt: now.toISOString(), disabledBy: actor.uid }),
    updatedAt: now
  });
  await writeAudit(ctx, { officeId, action: on ? AUDIT_ACTIONS.BOT_ENABLED : AUDIT_ACTIONS.BOT_DISABLED, actorUid: actor.uid, entityType: "channel", entityId: "telegram-bot", key: now.toISOString(), details: { channel: "telegram" } });
  return { ok: true, enabled: on, changed: true };
}

// ------------------------------------------------------------------ links (a side · a broker)

async function issueCode(ctx, fields, { minutes }) {
  const now = ctx.now();
  const code = newToken(32);
  const hash = await ctx.deps.sha256Hex(`telegram-link|${code}`);
  const expiresAt = new Date(now.getTime() + minutes * 60 * 1000);
  // Only the hash is stored: the code exists in the link and nowhere else.
  await ctx.store.set(["telegramLinkCodes", hash], { ...fields, createdAt: now, expiresAt: expiresAt.toISOString(), status: "PENDING" });
  return { code, hash, expiresAt };
}

/**
 * The link the office gives one owner or client so the bot may write to him (one use).
 * Opening it is not enough: the person then confirms by sharing his own mobile from Telegram,
 * and only the mobile saved on the record is accepted — so a link never binds the wrong person.
 */
export async function startPartyLink(ctx, { actor, officeId, recordId }) {
  assertAvailable(ctx);
  const record = await ctx.store.get(["offices", officeId, "opportunities", recordId]);
  if (!record || (record.officeId && !ctx.deps.officeIdsEquivalent(record.officeId, officeId))) throw ctx.deps.appError("record_not_found", 404, "السجل غير موجود");
  assertCanActOn(ctx.deps, actor, { assignedBrokerId: record.brokerId || "" });
  const phone = partyPhone(record);
  if (!phone) throw ctx.deps.appError("party_phone_required", 409, "أضف رقم جوال صحيح للسجل أولًا — به يُعرف صاحب الرابط");
  const key = await partyKey(ctx.deps, officeId, phone);
  const name = cleanText(record.contactName, 60);
  const { code, expiresAt } = await issueCode(ctx, { kind: "party", officeId, recordId, partyKey: key, phone, name, createdBy: actor.uid }, { minutes: BOT_LIMITS.partyLinkDays * 24 * 60 });
  const deepLink = telegramDeepLink(botOutboundConfig(ctx.env).botUsername, code);
  const office = await officeName(ctx, officeId);
  const message = `${name ? `مرحبًا ${name}، ` : "مرحبًا، "}لتصلك العقارات والعملاء المناسبون لك من ${office || "مكتبنا"} مباشرة على تيليجرام، افتح الرابط واضغط «Start»:\n${deepLink}`;
  return { ok: true, deepLink, text: message, whatsappUrl: buildWhatsAppUrl(phone, message), expiresAt: expiresAt.toISOString() };
}

export async function partyLinkStatus(ctx, { officeId, recordId }) {
  const available = botOutboundConfig(ctx.env).available;
  const record = await ctx.store.get(["offices", officeId, "opportunities", recordId]);
  if (!record || (record.officeId && !ctx.deps.officeIdsEquivalent(record.officeId, officeId))) throw ctx.deps.appError("record_not_found", 404, "السجل غير موجود");
  if (!partyPhone(record)) return { ok: true, available, state: "NO_PHONE" };
  const link = await partyLinkFor(ctx.store, ctx.deps, officeId, record, { includeStopped: true });
  if (!link) return { ok: true, available, state: "NOT_LINKED" };
  return { ok: true, available, state: link.status === "ACTIVE" ? "LINKED" : "STOPPED", linkedAt: link.linkedAt || "" };
}

export async function startBrokerLink(ctx, { actor, officeId }) {
  assertAvailable(ctx);
  const { code, expiresAt } = await issueCode(ctx, { kind: "broker", officeId, uid: actor.uid, createdBy: actor.uid }, { minutes: BOT_LIMITS.brokerLinkMinutes });
  return { ok: true, deepLink: telegramDeepLink(botOutboundConfig(ctx.env).botUsername, code), expiresAt: expiresAt.toISOString() };
}

export async function unlinkBroker(ctx, { actor, officeId }) {
  const now = ctx.now();
  const segments = ["telegramBrokers", brokerKey(officeId, actor.uid)];
  const link = await ctx.store.get(segments);
  if (!link || link.status !== "ACTIVE") return { ok: true, changed: false };
  await ctx.store.set(segments, { status: "UNLINKED", unlinkedAt: now, updatedAt: now });
  return { ok: true, changed: true };
}

/** Which offices a chat belongs to, and as what. `drop` removes one office's side entry (a side moved to another chat). */
async function rememberChat(store, chatId, { parties = {}, brokers = {}, drop = "" } = {}, now = new Date()) {
  const segments = ["telegramBotChats", chatId];
  const current = (await store.get(segments)) || {};
  const nextParties = { ...(current.parties || {}), ...parties };
  if (drop) delete nextParties[drop];
  // Each map is written whole, so a removed entry really goes away.
  await store.set(segments, { chatId, parties: nextParties, brokers: { ...(current.brokers || {}), ...brokers }, updatedAt: now });
}

const CONTACT_KEYBOARD = Object.freeze({ keyboard: [[{ text: BOT_TEXT.shareContactButton, request_contact: true }]], one_time_keyboard: true, resize_keyboard: true });
const CONTACT_MINUTES = 30;
const CONTACT_ATTEMPTS = 3;

/**
 * «/start <code>» for a side's or a broker's link. Returns { handled: false } for an office
 * link code (the existing flow completes it) and for unknown codes.
 * A broker's link is complete at once (he issued it for himself, signed in). A side's link
 * waits for the side to share his own mobile.
 */
export async function completeBotLink(ctx, { code, chat = {}, from = {} }) {
  if (!isLinkCode(code)) return { handled: false };
  const { store, deps } = ctx;
  const now = ctx.now();
  const hash = await deps.sha256Hex(`telegram-link|${code}`);
  const record = await store.get(["telegramLinkCodes", hash]);
  if (!record || (record.kind !== "party" && record.kind !== "broker")) return { handled: false };
  const chatId = text(chat.id);
  const reply = (message, options = {}) => sendToChat(deps, chatId, message, { ...options, now });
  if (!CHAT_ID.test(chatId)) return { handled: true, ok: false, reason: "chat_invalid" };
  if (text(chat.type) !== "private") { await reply(BOT_TEXT.privateOnly); return { handled: true, ok: false, reason: "private_chat_required" }; }
  const officeId = deps.firestoreOfficeId(record.officeId);
  const expired = new Date(record.expiresAt || 0).getTime() <= now.getTime();
  // Claimed atomically, so a forwarded link can never be used twice.
  const claim = record.status === "PENDING" && !expired && officeId
    ? await store.update(["telegramLinkCodes", hash], (current) => (current.status === "PENDING" ? { status: "USED", usedAt: now, chatId, updatedAt: now } : null))
    : null;
  if (!claim || !claim.patch) { await reply(BOT_TEXT.linkUnknown); return { handled: true, ok: false, reason: expired ? "code_expired" : "code_unknown" }; }
  const tgName = cleanText([from.first_name, from.last_name].filter(Boolean).join(" "), 60);

  if (record.kind === "broker") {
    await store.set(["telegramBrokers", brokerKey(officeId, record.uid)], { officeId, uid: record.uid, chatId, status: "ACTIVE", telegramName: tgName, linkedAt: now.toISOString(), updatedAt: now });
    await rememberChat(store, chatId, { brokers: { [officeId]: record.uid } }, now);
    await reply(BOT_TEXT.brokerLinked);
    return { handled: true, ok: true, kind: "broker", officeId };
  }

  await store.set(["telegramPartyPending", chatId], {
    chatId, officeId, partyKey: text(record.partyKey), phone: text(record.phone), name: cleanText(record.name, 60), recordId: text(record.recordId),
    createdBy: text(record.createdBy), telegramName: tgName, telegramUserId: text(from.id), status: "WAITING", attempts: 0,
    expiresAt: new Date(now.getTime() + CONTACT_MINUTES * 60 * 1000).toISOString(), createdAt: now, updatedAt: now
  });
  await reply(BOT_TEXT.shareContact, { keyboard: CONTACT_KEYBOARD });
  return { handled: true, ok: false, kind: "party", awaiting: "contact", reason: "contact_required", officeId };
}

/**
 * The side shared a contact after opening its link. Linked only when the contact is the
 * sender's own (Telegram marks it) and its mobile is the one saved on the record.
 * Returns null when this chat is not waiting for a contact.
 */
async function completePartyContact(ctx, { message = {} }) {
  const { store, deps } = ctx;
  const chatId = text(message.chat?.id);
  const pending = await store.get(["telegramPartyPending", chatId]);
  if (!pending || pending.status !== "WAITING") return null;
  const now = ctx.now();
  const reply = (body, options = {}) => sendToChat(deps, chatId, body, { ...options, now });
  const removeKeyboard = { remove_keyboard: true };
  const end = async (status) => store.set(["telegramPartyPending", chatId], { status, updatedAt: now });
  if (new Date(pending.expiresAt || 0).getTime() <= now.getTime()) {
    await end("EXPIRED");
    await reply(BOT_TEXT.linkUnknown, { keyboard: removeKeyboard });
    return { ok: true, status: 200, linked: false, reason: "contact_expired" };
  }
  const contact = message.contact || {};
  if (!contact.user_id || text(contact.user_id) !== text(message.from?.id)) {
    await reply(BOT_TEXT.contactNotYours, { keyboard: CONTACT_KEYBOARD });
    return { ok: true, status: 200, linked: false, reason: "contact_not_own" };
  }
  if (!pending.phone || whatsappDigits(contact.phone_number) !== text(pending.phone)) {
    const attempts = Number(pending.attempts || 0) + 1;
    await store.set(["telegramPartyPending", chatId], { attempts, status: attempts >= CONTACT_ATTEMPTS ? "FAILED" : "WAITING", updatedAt: now });
    await reply(BOT_TEXT.contactMismatch, { keyboard: removeKeyboard });
    return { ok: true, status: 200, linked: false, reason: "contact_mismatch" };
  }
  const officeId = deps.firestoreOfficeId(pending.officeId);
  const key = text(pending.partyKey);
  const existing = await store.get(["telegramParties", key]);
  await store.set(["telegramParties", key], {
    officeId, partyKey: key, chatId, status: "ACTIVE", name: cleanText(pending.name, 60), telegramName: cleanText(pending.telegramName, 60), recordId: text(pending.recordId),
    linkedAt: now.toISOString(), linkedByCodeOf: text(pending.createdBy), phoneConfirmed: true, updatedAt: now
  });
  // The person moved to another Telegram account: the old chat no longer speaks for him.
  if (existing?.chatId && text(existing.chatId) !== chatId) await rememberChat(store, text(existing.chatId), { drop: officeId }, now);
  await rememberChat(store, chatId, { parties: { [officeId]: key } }, now);
  await store.set(["telegramBotChats", chatId], { lastOfficeId: officeId, lastOfficeAt: now }).catch(() => {});
  if (!existing) {
    const counted = await store.update(["offices", officeId, "botSettings", "telegram"], (current) => ({ linkedParties: Number(current.linkedParties || 0) + 1, updatedAt: now })).catch(() => "failed");
    if (counted === null) await store.set(["offices", officeId, "botSettings", "telegram"], { officeId, linkedParties: 1, updatedAt: now }).catch(() => {});
  }
  await end("DONE");
  await reply(partyWelcome({ officeName: await officeName(ctx, officeId), name: pending.name }), { keyboard: removeKeyboard });
  return { ok: true, status: 200, linked: true, kind: "party", officeId };
}

// ------------------------------------------------------------------ asking about a match

/** One question per pair of records (not per match version): editing a record never asks the same thing twice. */
async function askIdFor(ctx, officeId, pair) {
  return `ask_${(await ctx.deps.sha256Hex(`bot-ask|${officeId}|${pair.offerId}|${pair.requestId}`)).slice(0, 40)}`;
}
const askSegments = (officeId, askId) => ["offices", officeId, "matchAsks", askId];

async function mirrorOnMatch(ctx, officeId, matchId, state) {
  if (!matchId) return;
  await ctx.store.set(["offices", officeId, "matches", matchId], { botAskState: state, botAskAt: ctx.now() })
    .catch((error) => console.warn("[office-os] bot state not mirrored", error?.message));
}

async function loadPair(ctx, officeId, match) {
  const offerId = text(match.offerId || match.ownerOfferId);
  const requestId = text(match.requestId || match.clientRequestId);
  if (!offerId || !requestId) return null;
  const [offer, request] = await Promise.all([
    ctx.store.get(["offices", officeId, "opportunities", offerId]),
    ctx.store.get(["offices", officeId, "opportunities", requestId])
  ]);
  return offer && request ? { offer, request, offerId, requestId } : null;
}

const asksTodayOf = (link, today) => (link?.asks?.day === today ? Number(link.asks.count || 0) : 0);

async function countAsk(ctx, link, today) {
  const now = ctx.now();
  await ctx.store.set(["telegramParties", link.key], { asks: { day: today, count: asksTodayOf(link, today) + 1 }, lastAskedAt: now, updatedAt: now }).catch(() => {});
}

/** The side's question token exists (and is saved on the question) before anything is sent. */
async function newSide(ctx, { officeId, askId, role, link }) {
  const token = newToken(16);
  await ctx.store.set(["telegramAsks", token], { officeId, askId, role, partyKey: link.key, createdAt: ctx.now() });
  return { partyKey: link.key, token, askedAt: ctx.now().toISOString() };
}

async function deliverAsk(ctx, { officeId, role, link, pair, token }) {
  const message = askMessage(role, { officeName: await officeName(ctx, officeId), offer: summaryOf(pair.offer), request: summaryOf(pair.request) });
  return sendToParty(ctx.store, ctx.deps, officeId, link, message, { buttons: askButtons(token), now: ctx.now() });
}

/**
 * A new match exists. If the office's bot is on and the client is linked, the client is asked.
 * Returns { asked, reason } — a reason means «this match stays with the broker, as before».
 * Safe to call again for the same match or a new version of it: the question is created once.
 */
export async function askPartiesAboutMatch(ctx, { officeId, matchId }) {
  if (!botOutboundConfig(ctx.env).available) return { asked: false, reason: "bot_unavailable" };
  const settings = await botSettings(ctx.store, officeId);
  if (settings.enabled !== true) return { asked: false, reason: "office_switch_off" };
  const match = await ctx.store.get(["offices", officeId, "matches", matchId]);
  if (!match) return { asked: false, reason: "match_not_found" };
  const pair = await loadPair(ctx, officeId, match);
  if (!pair) return { asked: false, reason: "match_incomplete" };
  if (lifecycleOf(pair.offer) !== LIFECYCLE.ACTIVE || lifecycleOf(pair.request) !== LIFECYCLE.ACTIVE) return { asked: false, reason: "record_inactive" };
  const client = await partyLinkFor(ctx.store, ctx.deps, officeId, pair.request, { includeStopped: true });
  const today = riyadhDayId(ctx.now());
  const blocker = askBlocker({ match, settings, clientLinked: Boolean(client), clientStopped: Boolean(client) && client.status !== "ACTIVE", asksToday: asksTodayOf(client, today) });
  if (blocker) return { asked: false, reason: blocker };

  const now = ctx.now();
  const askId = await askIdFor(ctx, officeId, pair);
  const offerPrice = priceOf(pair.offer);
  const existing = await ctx.store.get(askSegments(officeId, askId));
  if (existing) {
    const decision = reaskDecision(existing, { offerPrice });
    if (decision === "follow") {
      // The question already out now speaks for this newer version of the same match.
      await ctx.store.set(askSegments(officeId, askId), { matchId, updatedAt: now });
      await mirrorOnMatch(ctx, officeId, matchId, existing.state);
      return { asked: false, reason: "already_asked" };
    }
    if (decision === "keep") return { asked: false, reason: "already_answered" };
  } else {
    // A pair that had already matched before the office switched its bot on is never asked about.
    const enabledAt = toDate(settings.enabledAt)?.getTime() || 0;
    const earlier = enabledAt ? (await ctx.store.list(["offices", officeId, "matches"], 300)).some((other) => (
      text(other.offerId || other.ownerOfferId) === pair.offerId && text(other.requestId || other.clientRequestId) === pair.requestId
      && (toDate(other.createdAt)?.getTime() || Infinity) < enabledAt)) : false;
    if (earlier) return { asked: false, reason: "pair_older_than_switch" };
  }
  const side = await newSide(ctx, { officeId, askId, role: BOT_ROLE.CLIENT, link: client });
  const fresh = {
    schemaVersion: 1, officeId, askId, matchId, offerId: pair.offerId, requestId: pair.requestId, score: Number(match.score || 0), offerPrice,
    assignedBrokerId: text(match.assignedBrokerId), state: ASK_STATE.CLIENT_ASKED, client: side, owner: null, journeyId: "", failReason: "", updatedAt: now
  };
  if (existing) {
    const reset = await ctx.store.update(askSegments(officeId, askId), (current) => (reaskDecision(current, { offerPrice }) === "ask" ? { ...fresh, reaskedAt: now } : null));
    if (!reset || !reset.patch) return { asked: false, reason: "already_asked" };
  } else if (!(await ctx.store.create(askSegments(officeId, askId), { ...fresh, createdAt: now }))) {
    return { asked: false, reason: "already_asked" };
  }
  const sent = await deliverAsk(ctx, { officeId, role: BOT_ROLE.CLIENT, link: client, pair, token: side.token });
  if (!sent.ok) {
    await ctx.store.set(askSegments(officeId, askId), { state: ASK_STATE.FAILED, failReason: text(sent.description).slice(0, 160), updatedAt: ctx.now() });
    await mirrorOnMatch(ctx, officeId, matchId, ASK_STATE.FAILED);
    return { asked: false, reason: sent.blocked ? "client_blocked_bot" : "send_failed" };
  }
  await ctx.store.set(askSegments(officeId, askId), { client: { ...side, messageId: sent.messageId || 0 }, updatedAt: ctx.now() });
  await countAsk(ctx, client, today);
  await mirrorOnMatch(ctx, officeId, matchId, ASK_STATE.CLIENT_ASKED);
  return { asked: true, state: ASK_STATE.CLIENT_ASKED };
}

async function tellSide(ctx, officeId, record, message) {
  const link = await partyLinkFor(ctx.store, ctx.deps, officeId, record);
  if (!link) return { ok: false, skipped: true };
  return sendToParty(ctx.store, ctx.deps, officeId, link, message, { now: ctx.now() });
}

/**
 * The deal is open: each linked side receives its own room link. Logged on the deal with
 * exactly who it was sent to. `by` = "sides" (both agreed through the bot) | "broker".
 */
export async function announceRoom(ctx, { officeId, journeyId, by = "broker" }) {
  if (!botOutboundConfig(ctx.env).available) return { ok: true, sent: [], missing: [], off: true };
  const settings = await botSettings(ctx.store, officeId);
  if (settings.enabled !== true) return { ok: true, sent: [], missing: [], off: true };
  const journey = await loadJourney(ctx, officeId, journeyId);
  if (!isJourneyOpen(journey) || journey.bot?.paused === true) return { ok: true, sent: [], missing: [], off: true };
  const roles = [BOT_ROLE.CLIENT, BOT_ROLE.OWNER];
  const linked = {};
  for (const role of roles) {
    const record = await ctx.store.get(["offices", officeId, "opportunities", text(role === BOT_ROLE.OWNER ? journey.offerId : journey.requestId)]);
    linked[role] = await partyLinkFor(ctx.store, ctx.deps, officeId, record);
  }
  if (!linked.client && !linked.owner) return { ok: true, sent: [], missing: roles };
  const { links } = await sessionLinks(ctx, { actor: BOT_ACTOR, officeId, journeyId });
  const sent = [];
  const missing = [];
  for (const role of roles) {
    if (!linked[role]) { missing.push(role); continue; }
    const result = await sendToParty(ctx.store, ctx.deps, officeId, linked[role], by === "sides" ? BOT_TEXT.roomReady : BOT_TEXT.roomReadyByBroker, { link: { text: BOT_TEXT.roomButton, url: links[role].url }, now: ctx.now() });
    (result.ok ? sent : missing).push(role);
  }
  if (sent.length) {
    await applyJourneyChange(ctx, {
      officeId, journeyId, actor: null,
      mutate: (current) => ({ bot: { ...(current.bot || {}), managed: true, startedAt: current.bot?.startedAt || ctx.now().toISOString() } }),
      event: {
        type: "BOT_MESSAGE", key: ["bot-room", sent.join(",")],
        text: `أرسل البوت رابط صفحة التفاوض عبر تيليجرام إلى: ${sent.map((role) => BOT_ROLE_LABEL[role]).join(" و")}`,
        payload: { audience: "broker", roles: sent, channel: "telegram" }
      }
    });
  }
  return { ok: true, sent, missing };
}

/** A deal the bot opened but could not hand a room link to both sides: the broker gets a clear task for it. */
async function addLinkTask(ctx, { officeId, journeyId, missing }) {
  const who = missing.map((role) => BOT_ROLE_LABEL[role]).join(" و");
  await applyJourneyChange(ctx, {
    officeId, journeyId, actor: null,
    mutate: () => ({}),
    add: [{ type: "JOURNEY_FOLLOW_UP", ref: `bot-link:${missing.join(",")}`, priority: "HIGH", reason: `لم يصل رابط صفحة التفاوض إلى ${who} — أرسله من غرفة التفاوض`, actionLabel: "فتح غرفة التفاوض" }],
    event: { type: "BOT_MESSAGE", key: ["bot-room-missing", missing.join(",")], text: `لم يرسل البوت رابط صفحة التفاوض إلى ${who}`, payload: { audience: "broker", roles: [], channel: "telegram" } }
  });
}

/** A side pressed «مناسب» / «غير مناسب». Always answers the button; never throws to Telegram. */
export async function handleBotCallback(ctx, query = {}) {
  const { store, deps } = ctx;
  const chatId = text(query.message?.chat?.id);
  const toast = (message) => deps.telegram("answerCallbackQuery", { callback_query_id: text(query.id), text: String(message).slice(0, 180) });
  const stale = async (reason) => { await toast(BOT_TEXT.stale); return { ok: true, status: 200, ignored: true, reason }; };
  const parsed = parseCallback(query.data);
  if (!parsed) return stale("callback_unknown");
  const pointer = await store.get(["telegramAsks", parsed.token]);
  if (!pointer) return stale("ask_unknown");
  const officeId = deps.firestoreOfficeId(pointer.officeId);
  const { askId, role } = pointer;
  const party = await store.get(["telegramParties", text(pointer.partyKey)]);
  // Only the chat the question was sent to — and the person pressing must be that chat's own user.
  if (!party || text(party.chatId) !== chatId || (query.from?.id !== undefined && text(query.from.id) !== chatId)) {
    await toast(BOT_TEXT.notYours);
    return { ok: true, status: 200, ignored: true, reason: "not_this_chat" };
  }
  const ask = await store.get(askSegments(officeId, text(askId)));
  // The button must be the one of the current question to this side (an older message's button is dead).
  if (!ask || awaitedRole(ask) !== role || ask[role]?.token !== parsed.token) return stale("ask_not_waiting");
  const matchId = text(ask.matchId);
  const match = await store.get(["offices", officeId, "matches", matchId]);
  const pair = match ? await loadPair(ctx, officeId, match) : null;
  const now = ctx.now();
  if (!match || !pair || match.brokerDecision || match.isCurrent === false) {
    await store.set(askSegments(officeId, askId), { state: ASK_STATE.CANCELLED, updatedAt: now });
    await mirrorOnMatch(ctx, officeId, matchId, ASK_STATE.CANCELLED);
    return stale("match_already_decided");
  }

  // The gates are read again now: a question sent while the bot was on may be answered after it was switched off.
  const settings = await botSettings(store, officeId);
  const botOn = botOutboundConfig(ctx.env).available && settings.enabled === true;
  const today = riyadhDayId(now);
  let ownerLink = role === BOT_ROLE.CLIENT && botOn ? await partyLinkFor(store, deps, officeId, pair.offer) : null;
  if (ownerLink && asksTodayOf(ownerLink, today) >= BOT_LIMITS.dailyAsks) ownerLink = null;
  const plan = planAnswer(ask, role, parsed.answer, { ownerLinked: Boolean(ownerLink), botOn });
  if (!plan.ok) return stale(plan.reason);
  // The owner's question (token included) is saved in the same step that records the client's yes.
  const ownerSide = plan.effect === "ask_owner" ? await newSide(ctx, { officeId, askId, role: BOT_ROLE.OWNER, link: ownerLink }) : null;
  const moved = await store.update(askSegments(officeId, askId), (current) => (
    awaitedRole(current) === role && current[role]?.token === parsed.token
      ? { state: plan.next, [role]: { ...(current[role] || {}), answer: parsed.answer, answeredAt: now.toISOString() }, ...(ownerSide ? { owner: ownerSide } : {}), updatedAt: now }
      : null));
  if (!moved || !moved.patch) return stale("ask_not_waiting");

  const brokerId = text(ask.assignedBrokerId || match.assignedBrokerId || pair.request.brokerId || pair.offer.brokerId);
  const answered = parsed.answer === "yes" ? BOT_TEXT.answeredYes : BOT_TEXT.answeredNo;
  let state = plan.next;
  const setState = async (next, extra = {}) => { state = next; await store.set(askSegments(officeId, askId), { state: next, ...extra, updatedAt: ctx.now() }); };
  const tellBroker = (key, title, body, route = `review/${matchId}`) => notifyOffice(store, deps, { officeId, brokerId, key: `ask|${askId}|${key}`, title, body, route, matchId, now: ctx.now() });
  try {
    await toast(answered);
    // The buttons go away and the message keeps what was answered.
    if (query.message?.message_id) {
      await deps.telegram("editMessageText", { chat_id: chatId, message_id: query.message.message_id, text: `${text(query.message.text).slice(0, 3300)}\n\n— ${answered}` });
    }
    const who = BOT_ROLE_LABEL[role];
    if (plan.effect === "hand_to_broker") {
      await sendToChat(deps, chatId, BOT_TEXT.answerWithBroker, { now });
      await tellBroker("handed", `رد ${who} على المطابقة عبر البوت: ${parsed.answer === "yes" ? "مناسب" : "غير مناسب"}`, "بوت المكتب متوقف الآن — راجع المطابقة وأكمل أنت.");
    } else if (plan.effect === "reject") {
      await decideMatchReview(ctx, { actor: BOT_ACTOR, officeId, matchId, decision: "reject", reason: `${who}: غير مناسب (عبر بوت تيليجرام)` });
      await sendToChat(deps, chatId, BOT_TEXT.thanksNo, { now });
      if (role === BOT_ROLE.OWNER) await tellSide(ctx, officeId, pair.request, BOT_TEXT.ownerDeclined);
    } else if (plan.effect === "ask_owner") {
      const sent = await deliverAsk(ctx, { officeId, role: BOT_ROLE.OWNER, link: ownerLink, pair, token: ownerSide.token });
      if (sent.ok) {
        await store.set(askSegments(officeId, askId), { owner: { ...ownerSide, messageId: sent.messageId || 0 }, updatedAt: ctx.now() });
        await countAsk(ctx, ownerLink, today);
        await sendToChat(deps, chatId, BOT_TEXT.clientYesWaitOwner, { now });
      } else {
        // The owner cannot be reached by the bot after all: the broker continues from here.
        await setState(ASK_STATE.OWNER_NOT_LINKED);
      }
    } else if (plan.effect === "open") {
      const decided = await decideMatchReview(ctx, { actor: BOT_ACTOR, officeId, matchId, decision: "approve", viaBot: true });
      await store.set(askSegments(officeId, askId), { journeyId: decided.journeyId, updatedAt: ctx.now() });
      const announced = await announceRoom(ctx, { officeId, journeyId: decided.journeyId, by: "sides" });
      const missing = announced.missing || [];
      if (missing.length) await addLinkTask(ctx, { officeId, journeyId: decided.journeyId, missing });
      const journey = await store.get(["offices", officeId, "journeys", decided.journeyId]);
      await notifyOffice(store, deps, {
        officeId, brokerId: text(journey?.assignedBrokerId || brokerId), key: `ask|${askId}|opened`,
        title: "صفقة جديدة — وافق الطرفان عبر البوت",
        body: `${journeyTitle({ ...journey, journeyId: decided.journeyId })}${missing.length ? ` — لم يصل الرابط إلى: ${missing.map((r) => BOT_ROLE_LABEL[r]).join(" و")}` : ""}`,
        route: `deal/${decided.journeyId}`, matchId, now: ctx.now()
      });
    }
    if (state === ASK_STATE.OWNER_NOT_LINKED) {
      await sendToChat(deps, chatId, BOT_TEXT.clientYesBrokerFollows, { now });
      await tellBroker("owner-not-linked", "العميل وافق على المطابقة عبر البوت", "المالك غير مرتبط بالبوت — تواصل معه واعتمد المطابقة.");
    }
  } catch (error) {
    // The answer is saved; whatever could not be completed is handed to the broker instead of being left hanging.
    console.warn("[office-os] bot step failed", plan.effect, error?.code || error?.message);
    await setState(ASK_STATE.FAILED, { failReason: text(error?.code || error?.message).slice(0, 160) }).catch(() => {});
    await sendToChat(deps, chatId, BOT_TEXT.answerWithBroker, { now }).catch(() => {});
    await tellBroker("failed", `رد ${BOT_ROLE_LABEL[role]} على المطابقة عبر البوت: ${parsed.answer === "yes" ? "مناسب" : "غير مناسب"}`, "تعذر إكمال الخطوة تلقائيًا — راجع المطابقة وأكمل أنت.").catch(() => {});
  } finally {
    await mirrorOnMatch(ctx, officeId, matchId, state);
  }
  return { ok: true, status: 200, answered: parsed.answer, role, state };
}

// ------------------------------------------------------------------ what a side writes to the bot

/**
 * A message from a chat the bot knows (or one that is confirming its link). A side's
 * «إيقاف / تشغيل» is obeyed at once; any other text is never answered by the bot itself — it
 * goes to the communication center of the office that wrote to this side last, and the broker
 * is told. Returns null when the chat is not one of the bot's.
 */
export async function handleBotChatMessage(ctx, { update = {}, message = {} }) {
  const { store, deps } = ctx;
  const chatId = text(message.chat?.id);
  if (!CHAT_ID.test(chatId)) return null;
  if (message.contact) {
    const confirmed = await completePartyContact(ctx, { message });
    if (confirmed) return confirmed;
  }
  const known = await store.get(["telegramBotChats", chatId]);
  if (!known) return null;
  // Only the links that really point at this chat count (an older chat of the same person does not).
  const mine = [];
  for (const [office, key] of Object.entries(known.parties || {})) {
    const officeId = deps.firestoreOfficeId(office);
    const party = await store.get(["telegramParties", text(key)]);
    if (officeId && party && text(party.chatId) === chatId && deps.officeIdsEquivalent(party.officeId, officeId)) mine.push({ officeId, key: text(key), party });
  }
  if (!mine.length) return null;
  const now = ctx.now();
  const body = cleanText(message.text, 1200);
  const command = partyCommand(body);
  if (command) {
    for (const { key } of mine) {
      await store.set(["telegramParties", key], { status: command === "stop" ? "STOPPED" : "ACTIVE", ...(command === "stop" ? { stoppedAt: now } : { resumedAt: now }), updatedAt: now });
    }
    await sendToChat(deps, chatId, command === "stop" ? BOT_TEXT.stopped : BOT_TEXT.resumed, { now });
    return { ok: true, status: 200, command };
  }
  if (!body) return { ok: true, status: 200, ignored: true, reason: "no_text" };
  // One office only: the one that wrote to this person last (else the most recent link).
  const target = mine.find((entry) => deps.officeIdsEquivalent(entry.officeId, known.lastOfficeId))
    || [...mine].sort((a, b) => String(b.party.linkedAt || "").localeCompare(String(a.party.linkedAt || "")))[0];
  const { officeId, party } = target;
  const inboxId = `tgp_${String(update.update_id).replace(/[^0-9A-Za-z_-]/g, "").slice(0, 40)}`;
  const created = await store.create(["offices", officeId, "inbox", inboxId], {
    schemaVersion: 3, officeId, direction: "inbound", source: "telegram_bot_party", channel: "telegram",
    status: "kept", processingState: "kept", isProcessed: true, outboundEnabled: false,
    messageId: text(message.message_id), externalUpdateId: text(update.update_id), messageType: "text", messageText: body,
    senderName: cleanText(party.name || party.telegramName, 60), messageClass: "DEAL", messageClassReason: "رسالة من طرف مرتبط ببوت المكتب",
    partyRecordId: text(party.recordId), receivedAt: now, createdAt: now
  });
  if (!created) return { ok: true, status: 200, duplicate: true, forwarded: 0 };
  const record = party.recordId ? await store.get(["offices", officeId, "opportunities", text(party.recordId)]) : null;
  await notifyOffice(store, deps, {
    officeId, brokerId: text(record?.brokerId), key: `party-message|${inboxId}`,
    title: `رسالة عبر البوت — ${cleanText(party.name, 40) || "طرف مرتبط"}`, body: body.slice(0, 200), route: "inbox",
    opportunityId: text(party.recordId), now
  });
  await sendToChat(deps, chatId, BOT_TEXT.messageForwarded, { now });
  return { ok: true, status: 200, forwarded: 1, officeId };
}

// ------------------------------------------------------------------ the broker takes a deal back

/** «استلام الصفقة من البوت» / إعادتها: while paused the bot sends nothing more about this deal. */
export async function setJourneyBotPaused(ctx, { actor, officeId, journeyId, paused }) {
  const journey = await loadJourney(ctx, officeId, journeyId);
  assertCanActOn(ctx.deps, actor, journey);
  const stop = paused === true;
  const now = ctx.now();
  return applyJourneyChange(ctx, {
    officeId, journeyId, actor,
    mutate: (current) => ((current.bot?.paused === true) === stop ? null : { bot: { ...(current.bot || {}), paused: stop, pausedAt: stop ? now.toISOString() : null, pausedBy: stop ? actor.uid : "" } }),
    event: { type: "BOT_HANDOVER", key: ["bot-pause", String(stop), now.toISOString().slice(0, 16)], text: stop ? "استلم الوسيط التواصل في هذه الصفقة — توقف البوت عن مراسلة الطرفين" : "أعاد الوسيط التواصل في هذه الصفقة إلى البوت", payload: { audience: "broker" } }
  });
}

export { alertBrokerOnTelegram };
