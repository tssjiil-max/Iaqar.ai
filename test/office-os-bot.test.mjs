// «بوت المكتب» — the office's Telegram bot asks the two sides about a match, opens the deal on
// two yeses, passes room moves between them and tells the broker only when he is needed.
// Through the real Worker on the in-memory Firestore double; Telegram itself is a double here.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ASK_STATE, BOT_LIMITS, askBlocker, askButtons, askMessage, awaitedRole, botView, callbackData, isQuietHour, parseCallback, partyCommand, planAnswer, reaskDecision
} from "../public/os/domain/bot-domain.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B, BROKER_A2 } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());

const SECRET = "tg-secret-for-bot-tests";
const BOT_TOKEN = "123456789:TEST-TOKEN-never-in-a-response-000000"; // pragma: allowlist secret
Object.assign(h.env, { TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_BOT_USERNAME: "iaqar_test_bot", TELEGRAM_OUTBOUND: "enabled" });

// ---- Telegram double: every Bot API call the Worker makes lands here.
const sent = [];
const blockedChats = new Set();
let messageSeq = 900;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (!String(url).startsWith("https://api.telegram.org/")) return realFetch(input, init);
  const method = String(url).split("/").pop();
  const payload = JSON.parse(init.body || "{}");
  assert.ok(String(url).includes(`/bot${BOT_TOKEN}/`), "the bot token is used for Telegram only");
  if (blockedChats.has(String(payload.chat_id))) return new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }), { status: 403 });
  const record = { method, ...payload, message_id: method === "sendMessage" ? ++messageSeq : payload.message_id };
  sent.push(record);
  return new Response(JSON.stringify({ ok: true, result: { message_id: record.message_id } }), { status: 200 });
};
test.after(() => { globalThis.fetch = realFetch; });

async function call(route, body, uid) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
let updateId = 70000;
async function telegram(update, { secret = SECRET } = {}) {
  const headers = { "content-type": "application/json" };
  if (secret) headers["x-telegram-bot-api-secret-token"] = secret;
  const response = await h.worker.fetch(new Request("https://worker.test/telegram/webhook", { method: "POST", headers, body: JSON.stringify({ update_id: ++updateId, ...update }) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const says = (chatId, text, type = "private") => telegram({ message: { message_id: updateId + 1, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type }, from: { id: chatId, first_name: "طرف", last_name: "تجريبي" }, text } });
/** The side presses «مشاركة رقمي»: Telegram sends his own contact (user_id = the sender) — or someone else's when `of` differs. */
const shares = (chatId, phone, { of = chatId } = {}) => telegram({ message: { message_id: updateId + 1, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: "private" }, from: { id: chatId, first_name: "طرف" }, contact: { phone_number: phone, user_id: of, first_name: "طرف" } } });
const presses = (chatId, ask, answer) => telegram({ callback_query: { id: `cq-${updateId}`, from: { id: chatId }, data: callbackData(tokenOf(ask), answer), message: { message_id: ask.message_id, chat: { id: chatId, type: "private" }, text: ask.text } } });
const tokenOf = (ask) => parseCallback(ask.reply_markup.inline_keyboard[0][0].callback_data).token;
const messagesTo = (chatId) => sent.filter((m) => m.method === "sendMessage" && String(m.chat_id) === String(chatId));
const lastTo = (chatId) => messagesTo(chatId).at(-1);
const askTo = (chatId) => messagesTo(chatId).filter((m) => m.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data).at(-1);
const codeOf = (deepLink) => new URL(deepLink).searchParams.get("start");
const ops = (office = OFFICE_A) => h.store.list(`offices/${office}/operations`);
const matchesOf = (office = OFFICE_A) => h.store.list(`offices/${office}/matches`);

let seq = 0;
/** One request and one matching offer of office A; returns their ids, the match, and the two phones. */
async function pair(district, { office = OFFICE_A, uid = OWNER_A, link = { client: 0, owner: 0 }, before = async () => {} } = {}) {
  seq += 1;
  const clientPhone = `05530${String(1000 + seq).slice(-4)}1`;
  const ownerPhone = `05540${String(1000 + seq).slice(-4)}2`;
  const request = await call("/os/records/save", { officeId: office, requestKey: `bot-req-${seq}`, record: { kind: "REQUEST", purpose: "PURCHASE", propertyType: "شقة", city: "الرياض", district, price: 950000, contactName: `عميل ${district}`, contactPhone: clientPhone } }, uid);
  assert.equal(request.status, 200, JSON.stringify(request.body));
  if (link.client) await linkParty(request.body.recordId, link.client, { office, uid });
  await before({ requestId: request.body.recordId });
  const offer = await call("/os/records/save", { officeId: office, requestKey: `bot-off-${seq}`, record: { kind: "OFFER", purpose: "SALE", propertyType: "شقة", city: "الرياض", district, price: 900000, area: 180, rooms: 4, contactName: `مالك ${district}`, contactPhone: ownerPhone } }, uid);
  assert.equal(offer.status, 200, JSON.stringify(offer.body));
  if (link.owner) await linkParty(offer.body.recordId, link.owner, { office, uid });
  const match = matchesOf(office).find((m) => m.offerId === offer.body.recordId && m.requestId === request.body.recordId);
  assert.ok(match, "the pair matched");
  return { requestId: request.body.recordId, offerId: offer.body.recordId, matchId: match.id, clientPhone, ownerPhone };
}
async function linkParty(recordId, chatId, { office = OFFICE_A, uid = OWNER_A } = {}) {
  const link = await call("/os/bot/party/link", { officeId: office, recordId }, uid);
  assert.equal(link.status, 200, JSON.stringify(link.body));
  const opened = await says(chatId, `/start ${codeOf(link.body.deepLink)}`);
  assert.equal(opened.body.awaiting, "contact", JSON.stringify(opened.body));
  const phone = h.store.get(`offices/${office}/opportunities/${recordId}`).contactPhone;
  const done = await shares(chatId, `+966${String(phone).slice(1)}`);
  assert.equal(done.body.linked, true, JSON.stringify(done.body));
  return link.body;
}
const match = (id, office = OFFICE_A) => h.store.get(`offices/${office}/matches/${id}`);
/** The bot's question about the pair of this match (one per pair, whatever the match version). */
const ask = (id, office = OFFICE_A) => h.store.list(`offices/${office}/matchAsks`).find((entry) => entry.matchId === id) || null;
const reviewTask = (matchId) => ops().find((op) => op.type === "MATCH_REVIEW" && op.matchId === matchId);
const journeyOf = (matchId) => h.store.list(`offices/${OFFICE_A}/journeys`).find((j) => j.matchId === matchId);
const notes = () => h.store.list(`offices/${OFFICE_A}/notifications`);

// ------------------------------------------------------------------ pure rules

test("the question never shows one side the other's name, number or address", () => {
  const offer = { propertyType: "فيلا", purpose: "SALE", city: "الرياض", district: "النرجس", price: 2400000, area: 400, rooms: 6, contactName: "مالك سري", contactPhone: "0551234567" };
  const request = { propertyType: "فيلا", purpose: "PURCHASE", city: "الرياض", district: "النرجس", price: 2500000, contactName: "عميل سري", contactPhone: "0557654321" };
  const toClient = askMessage("client", { officeName: "مكتب سلطان", offer, request });
  const toOwner = askMessage("owner", { officeName: "مكتب سلطان", offer, request });
  for (const body of [toClient, toOwner]) {
    assert.ok(!/مالك سري|عميل سري|0551234567|0557654321/.test(body), "no name and no number of the other side");
    assert.ok(body.startsWith("مكتب سلطان"), "it says which office is writing");
  }
  assert.match(toClient, /فيلا للبيع — الرياض، حي النرجس/);
  assert.match(toClient, /2,400,000 ريال/);
  assert.match(toClient, /هل هذا العقار مناسب لك؟/);
  assert.match(toOwner, /شراء فيلا/);
  assert.ok(!/2,500,000|ميزانيت/.test(toOwner), "the owner is never told the client's budget");
  assert.match(askMessage("client", { offer: { ...offer, purpose: "RENT" }, request }), /للإيجار/);
});

test("buttons carry only the question's token and the answer", () => {
  const token = "AbCdEfGhIjKlMnOpQrStUv";
  assert.equal(callbackData(token, "yes"), `ask:${token}:y`);
  assert.ok(callbackData(token, "no").length <= 64, "within Telegram's 64 bytes");
  assert.deepEqual(parseCallback(`ask:${token}:n`), { token, answer: "no" });
  assert.equal(parseCallback("ask:short:y"), null);
  assert.equal(parseCallback("anything else"), null);
  assert.deepEqual(askButtons(token)[0].map((button) => button.text), ["مناسب", "غير مناسب"]);
});

test("the decision table: client first, then the owner; one «غير مناسب» ends the match", () => {
  const waitingClient = { state: ASK_STATE.CLIENT_ASKED };
  assert.equal(awaitedRole(waitingClient), "client");
  assert.deepEqual(planAnswer(waitingClient, "client", "yes", { ownerLinked: true }), { ok: true, next: ASK_STATE.OWNER_ASKED, effect: "ask_owner" });
  assert.deepEqual(planAnswer(waitingClient, "client", "yes", { ownerLinked: false }), { ok: true, next: ASK_STATE.OWNER_NOT_LINKED, effect: "broker_follows" });
  assert.deepEqual(planAnswer(waitingClient, "client", "no"), { ok: true, next: ASK_STATE.CLIENT_NO, effect: "reject" });
  assert.equal(planAnswer(waitingClient, "owner", "yes").ok, false, "the owner cannot answer before the client");
  const waitingOwner = { state: ASK_STATE.OWNER_ASKED };
  assert.deepEqual(planAnswer(waitingOwner, "owner", "yes"), { ok: true, next: ASK_STATE.OPENED, effect: "open" });
  assert.deepEqual(planAnswer(waitingOwner, "owner", "no"), { ok: true, next: ASK_STATE.OWNER_NO, effect: "reject" });
  assert.equal(planAnswer(waitingOwner, "client", "yes").ok, false, "an answered question cannot be answered again");
  for (const state of [ASK_STATE.OPENED, ASK_STATE.CLIENT_NO, ASK_STATE.OWNER_NO, ASK_STATE.CANCELLED, ASK_STATE.FAILED, ASK_STATE.OWNER_NOT_LINKED]) {
    assert.equal(planAnswer({ state }, "client", "yes").ok, false, `${state} is final for the bot`);
  }
  assert.equal(planAnswer(waitingClient, "client", "maybe").ok, false);
  // The office switched its bot off after the question went out: any answer goes to the broker, nothing is decided.
  for (const [state, role] of [[waitingClient, "client"], [waitingOwner, "owner"]]) {
    for (const answer of ["yes", "no"]) assert.deepEqual(planAnswer(state, role, answer, { ownerLinked: true, botOn: false }), { ok: true, next: ASK_STATE.HANDED_TO_BROKER, effect: "hand_to_broker" });
  }
  // The same pair matched again after an edit.
  assert.equal(reaskDecision(waitingClient, { offerPrice: 1 }), "follow");
  assert.equal(reaskDecision({ state: ASK_STATE.CLIENT_NO, offerPrice: 900000 }, { offerPrice: 900000 }), "keep", "a «غير مناسب» is not asked again for the same price");
  assert.equal(reaskDecision({ state: ASK_STATE.CLIENT_NO, offerPrice: 900000 }, { offerPrice: 850000 }), "ask", "a new price is a new question");
  assert.equal(reaskDecision({ state: ASK_STATE.OWNER_NO, offerPrice: 900000 }, { offerPrice: 850000 }), "ask");
  assert.equal(reaskDecision({ state: ASK_STATE.OPENED }, { offerPrice: 1 }), "keep");
  assert.equal(reaskDecision({ state: ASK_STATE.CANCELLED }, { offerPrice: 1 }), "keep");
  assert.equal(reaskDecision({ state: ASK_STATE.FAILED }, { offerPrice: 1 }), "ask");
});

test("when the bot stays out: switch off, weak match, side not linked, stopped, daily limit, already decided", () => {
  const good = { match: { score: 82, status: "active", integrityStatus: "valid" }, settings: { enabled: true }, clientLinked: true };
  assert.equal(askBlocker(good), "");
  assert.equal(askBlocker({ ...good, settings: {} }), "office_switch_off");
  assert.equal(askBlocker({ ...good, match: { ...good.match, score: BOT_LIMITS.minScore - 1 } }), "score_below_minimum");
  assert.equal(askBlocker({ ...good, clientLinked: false }), "client_not_linked");
  assert.equal(askBlocker({ ...good, clientStopped: true }), "client_stopped");
  assert.equal(askBlocker({ ...good, asksToday: BOT_LIMITS.dailyAsks }), "daily_limit");
  assert.equal(askBlocker({ ...good, asksToday: BOT_LIMITS.dailyAsks - 1 }), "");
  assert.equal(askBlocker({ ...good, match: { ...good.match, brokerDecision: "APPROVED" } }), "already_decided");
  assert.equal(askBlocker({ ...good, match: { ...good.match, isCurrent: false } }), "match_not_current");
  assert.equal(askBlocker({ ...good, match: { ...good.match, integrityStatus: "broken" } }), "match_not_valid");
  assert.equal(partyCommand(" إيقاف "), "stop");
  assert.equal(partyCommand("تشغيل"), "resume");
  assert.equal(partyCommand("أريد موعدًا آخر"), "");
  assert.equal(isQuietHour(new Date("2026-10-06T20:30:00Z")), true, "11:30pm in Riyadh is quiet");
  assert.equal(isQuietHour(new Date("2026-10-06T10:00:00Z")), false);
  const off = botView({ available: true, settings: {} });
  assert.equal(off.enabled, false);
  assert.match(off.note, /تبقى مهمة مراجعة عندك/);
  assert.equal(botView({ available: false, settings: { enabled: true } }).enabled, false, "an office switch never overrides the environment");
});

// ------------------------------------------------------------------ the switch and the links

test("off by default; only the manager switches it; nothing is asked while it is off", async () => {
  const status = await call("/os/channels/status", { officeId: OFFICE_A }, OWNER_A);
  assert.equal(status.body.bot.available, true);
  assert.equal(status.body.bot.enabled, false);
  assert.equal(status.body.outboundEnabled, false);
  assert.ok(!JSON.stringify(status.body).includes(BOT_TOKEN) && !JSON.stringify(status.body).includes(SECRET), "no secret reaches the screen");
  const before = sent.length;
  const quiet = await pair("حي الهدوء", { link: { client: 81001 } });
  assert.equal(askTo(81001), undefined, "linked, but the office's bot is off: no question");
  assert.equal(ask(quiet.matchId), null);
  assert.equal(reviewTask(quiet.matchId).status, "OPEN", "the match is the broker's review task, as before");
  assert.deepEqual(sent.slice(before).map((m) => m.method), ["sendMessage", "sendMessage"], "only the request to confirm the number and the welcome");

  assert.equal((await call("/os/bot/enable", { officeId: OFFICE_A, enabled: true }, BROKER_A2)).status, 403, "a broker cannot switch the bot on");
  assert.equal((await call("/os/bot/enable", { officeId: OFFICE_A, enabled: true }, OWNER_B)).status, 403, "another office cannot");
  h.env.TELEGRAM_OUTBOUND = "";
  assert.equal((await call("/os/bot/enable", { officeId: OFFICE_A, enabled: true }, OWNER_A)).status, 409, "not where sending is not allowed");
  assert.equal((await call("/os/channels/status", { officeId: OFFICE_A }, OWNER_A)).body.bot.available, false);
  h.env.TELEGRAM_OUTBOUND = "enabled";

  const on = await call("/os/bot/enable", { officeId: OFFICE_A, enabled: true }, OWNER_A);
  assert.equal(on.status, 200, JSON.stringify(on.body));
  const after = await call("/os/channels/status", { officeId: OFFICE_A }, BROKER_A2);
  assert.equal(after.body.bot.enabled, true);
  assert.equal(after.body.automationMode, "BOT_PARTIES");
  assert.ok(h.store.list(`offices/${OFFICE_A}/auditLogs`).some((entry) => entry.action === "BOT_ENABLED" && entry.actorUid === OWNER_A));
  assert.equal((await call("/os/channels/status", { officeId: OFFICE_B }, OWNER_B)).body.bot.enabled, false, "each office has its own switch");

  // A match found before the switch is never asked about afterwards.
  await call("/os/reconcile", { officeId: OFFICE_A }, OWNER_A);
  assert.equal(ask(quiet.matchId), null, "no backlog is sent when the bot is switched on");
});

test("a side joins by the office's link: private chat only, one use, tied to the mobile on the record", async () => {
  const request = await call("/os/records/save", { officeId: OFFICE_A, requestKey: "bot-link-1", record: { kind: "REQUEST", purpose: "PURCHASE", propertyType: "أرض", city: "جدة", district: "حي الربط", price: 500000, contactName: "عميل الربط", contactPhone: "0559000001" } }, OWNER_A);
  const recordId = request.body.recordId;
  assert.equal((await call("/os/bot/party/status", { officeId: OFFICE_A, recordId }, OWNER_A)).body.state, "NOT_LINKED");
  assert.equal((await call("/os/bot/party/link", { officeId: OFFICE_B, recordId }, OWNER_B)).status, 404, "another office cannot issue a link for this record");
  assert.equal((await call("/os/bot/party/status", { officeId: OFFICE_A, recordId }, OWNER_B)).status, 403);
  const link = await call("/os/bot/party/link", { officeId: OFFICE_A, recordId }, OWNER_A);
  assert.match(link.body.deepLink, /^https:\/\/t\.me\/iaqar_test_bot\?start=[A-Za-z0-9_-]{22,64}$/);
  assert.ok(link.body.text.includes(link.body.deepLink) && link.body.text.includes("عميل الربط"), "a ready message for the broker to send himself");
  assert.match(link.body.whatsappUrl, /^https:\/\/wa\.me\/966559000001\?text=/);
  const code = codeOf(link.body.deepLink);
  assert.ok(!JSON.stringify(h.store.list("telegramLinkCodes")).includes(code), "only the hash of the code is stored");

  const group = await says(-100777, `/start ${code}`, "group");
  assert.equal(group.body.linked, false);
  assert.equal(group.body.reason, "private_chat_required");
  const opened = await says(82001, `/start ${code}`);
  assert.equal(opened.body.linked, false, "opening the link is not enough");
  assert.equal(opened.body.awaiting, "contact");
  assert.equal(lastTo(82001).reply_markup.keyboard[0][0].request_contact, true, "the bot asks for the person's own number with Telegram's button");
  assert.equal((await call("/os/bot/party/status", { officeId: OFFICE_A, recordId }, OWNER_A)).body.state, "NOT_LINKED");
  const again = await says(82002, `/start ${code}`);
  assert.equal(again.body.linked, false, "a forwarded link cannot be opened by a second person");
  assert.equal(again.body.awaiting, "");

  const someoneElses = await shares(82001, "+966559000001", { of: 99999 });
  assert.equal(someoneElses.body.reason, "contact_not_own", "a contact card of another person is refused, even with the right number");
  const wrongNumber = await shares(82001, "+966558888888");
  assert.equal(wrongNumber.body.reason, "contact_mismatch", "his own number, but not the one on the record");
  assert.match(lastTo(82001).text, /لا يطابق الرقم المسجل لدى المكتب/);
  assert.equal((await call("/os/bot/party/status", { officeId: OFFICE_A, recordId }, OWNER_A)).body.state, "NOT_LINKED");
  const done = await shares(82001, "+966559000001");
  assert.equal(done.body.linked, true, JSON.stringify(done.body));
  assert.equal(done.body.kind, "party");
  assert.match(lastTo(82001).text, /أهلًا عميل الربط\. تم ربطك بـمكتب سلطان العقاري/);
  assert.deepEqual(lastTo(82001).reply_markup, { remove_keyboard: true });
  assert.equal((await call("/os/bot/party/status", { officeId: OFFICE_A, recordId }, OWNER_A)).body.state, "LINKED");
  assert.equal((await call("/os/channels/status", { officeId: OFFICE_A }, OWNER_A)).body.bot.linkedParties >= 2, true);
  assert.equal((await shares(82001, "+966559000001")).body.ignored, true, "a contact sent later is just ignored");

  // A record without a usable mobile cannot be linked at all.
  h.store.seed(`offices/${OFFICE_A}/opportunities/opp_bot_nophone`, { officeId: OFFICE_A, opportunityKind: "REQUEST", purpose: "PURCHASE", propertyType: "أرض", city: "جدة", district: "حي بلا رقم", contactName: "بلا رقم", contactPhone: "", lifecycleStatus: "ACTIVE", brokerId: OWNER_A });
  assert.equal((await call("/os/bot/party/status", { officeId: OFFICE_A, recordId: "opp_bot_nophone" }, OWNER_A)).body.state, "NO_PHONE");
  assert.equal((await call("/os/bot/party/link", { officeId: OFFICE_A, recordId: "opp_bot_nophone" }, OWNER_A)).status, 409);

  // Another broker of the same office cannot take this client over: his own record with the same mobile
  // gives him a link, but only the client's own Telegram number completes it.
  const copycat = await call("/os/records/save", { officeId: OFFICE_A, requestKey: "bot-link-copy", record: { kind: "REQUEST", purpose: "PURCHASE", propertyType: "أرض", city: "جدة", district: "حي آخر للربط", price: 450000, contactName: "نسخة", contactPhone: "0559000001" } }, BROKER_A2);
  assert.equal((await call("/os/bot/party/link", { officeId: OFFICE_A, recordId }, BROKER_A2)).status, 403, "not on another broker's record");
  const copyLink = await call("/os/bot/party/link", { officeId: OFFICE_A, recordId: copycat.body.recordId }, BROKER_A2);
  assert.equal(copyLink.status, 200);
  assert.equal((await says(82666, `/start ${codeOf(copyLink.body.deepLink)}`)).body.awaiting, "contact");
  assert.equal((await shares(82666, "+966502222222")).body.reason, "contact_mismatch", "the broker's own number is not the client's");
  assert.equal(h.store.list("telegramParties").find((party) => party.recordId === recordId).chatId, "82001", "the client's link is untouched");

  // The office's own intake link keeps working beside the bot links.
  const officeLink = await call("/os/channels/telegram/link", { officeId: OFFICE_A }, OWNER_A);
  assert.equal((await says(82900, `/start ${codeOf(officeLink.body.deepLink)}`)).body.linked, true);
  assert.equal((await call("/os/channels/telegram/unlink", { officeId: OFFICE_A }, OWNER_A)).status, 200);
});

// ------------------------------------------------------------------ the whole path

const deal = {};

test("new match → the client is asked → yes → the owner is asked → yes → the deal opens and each side gets its own room link", async () => {
  const brokerLink = await call("/os/bot/broker/link", { officeId: OFFICE_A }, OWNER_A);
  assert.equal((await says(83900, `/start ${codeOf(brokerLink.body.deepLink)}`)).body.kind, "broker");
  assert.equal((await call("/os/channels/status", { officeId: OFFICE_A }, OWNER_A)).body.bot.brokerLinked, true);
  assert.equal((await call("/os/channels/status", { officeId: OFFICE_A }, BROKER_A2)).body.bot.brokerLinked, false, "each broker links his own alerts");

  Object.assign(deal, await pair("حي المسار", { link: { client: 83001, owner: 83002 } }));
  const toClient = askTo(83001);
  assert.ok(toClient, "the client received the question as soon as the match was found");
  assert.match(toClient.text, /شقة للبيع — الرياض، حي المسار/);
  assert.ok(!toClient.text.includes("مالك حي المسار") && !toClient.text.includes(deal.ownerPhone), "the owner stays unknown to the client");
  assert.equal(askTo(83002), undefined, "the owner is not asked before the client agrees");
  assert.equal(ask(deal.matchId).state, ASK_STATE.CLIENT_ASKED);
  assert.equal(match(deal.matchId).botAskState, ASK_STATE.CLIENT_ASKED, "the review page can show what the bot is doing");
  assert.equal(reviewTask(deal.matchId).status, "OPEN", "the broker can still decide himself");
  assert.equal(journeyOf(deal.matchId), undefined);

  const strangerPress = await presses(83999, toClient, "yes");
  assert.equal(strangerPress.body.reason, "not_this_chat", "a button pressed from another chat does nothing");
  assert.equal(ask(deal.matchId).state, ASK_STATE.CLIENT_ASKED);

  const yes = await presses(83001, toClient, "yes");
  assert.equal(yes.body.state, ASK_STATE.OWNER_ASKED, JSON.stringify(yes.body));
  const edited = sent.filter((m) => m.method === "editMessageText" && String(m.chat_id) === "83001").at(-1);
  assert.match(edited.text, /— إجابتك: مناسب$/);
  assert.equal(edited.reply_markup, undefined, "the buttons are gone once answered");
  assert.match(lastTo(83001).text, /نتأكد الآن من المالك/);
  const toOwner = askTo(83002);
  assert.match(toOwner.text, /لدينا عميل مهتم بعقارك/);
  assert.ok(!toOwner.text.includes("عميل حي المسار") && !toOwner.text.includes(deal.clientPhone), "the client stays unknown to the owner");
  assert.equal(journeyOf(deal.matchId), undefined, "one yes opens nothing");

  assert.equal((await presses(83001, toClient, "no")).body.ignored, true, "the client cannot change an answer already acted on");
  const open = await presses(83002, toOwner, "yes");
  assert.equal(open.body.state, ASK_STATE.OPENED, JSON.stringify(open.body));

  const journey = journeyOf(deal.matchId);
  assert.ok(journey, "the deal is open");
  deal.journeyId = journey.journeyId || journey.id;
  assert.equal(journey.status, "ACTIVE");
  assert.equal(journey.approvedBy, "telegram-bot");
  assert.equal(journey.assignedBrokerId, OWNER_A, "the deal belongs to the broker of the records, not to the bot");
  assert.equal(match(deal.matchId).brokerDecision, "APPROVED");
  assert.equal(match(deal.matchId).brokerDecisionBy, "telegram-bot");
  assert.equal(reviewTask(deal.matchId).status, "COMPLETED");
  assert.ok(!Object.values(journey.openTasks).some((task) => task.type === "SEND_PROPOSAL"), "no «prepare the first proposal» task: the sides already have their links");
  assert.ok(Object.values(journey.openTasks).some((task) => task.type === "DEAL_JOURNEY"), "the deal still has its one card in Daily Tasks");

  const roomClient = lastTo(83001);
  const roomOwner = lastTo(83002);
  for (const message of [roomClient, roomOwner]) assert.match(message.text, /وافق الطرفان\. افتح صفحة التفاوض/);
  const linkIn = (message) => (message.text.match(/\/s#[A-Za-z0-9_-]+/) || [message.reply_markup?.inline_keyboard?.[0]?.[0]?.url || ""])[0];
  assert.ok(linkIn(roomClient) && linkIn(roomOwner) && linkIn(roomClient) !== linkIn(roomOwner), "each side has its own room link");
  const events = h.store.list(`offices/${OFFICE_A}/journeys/${deal.journeyId}/events`);
  assert.ok(events.some((event) => event.type === "MATCH_APPROVED" && /وافق العميل والمالك عبر بوت تيليجرام/.test(event.text)));
  assert.ok(events.some((event) => event.type === "BOT_MESSAGE" && /أرسل البوت رابط صفحة التفاوض عبر تيليجرام إلى: العميل والمالك/.test(event.text)));
  const note = notes().find((n) => n.title === "صفقة جديدة — وافق الطرفان عبر البوت");
  assert.ok(note && note.route === `deal/${deal.journeyId}` && note.brokerId === OWNER_A);
  assert.match(lastTo(83900).text, /صفقة جديدة — وافق الطرفان عبر البوت/, "the broker is told on his own Telegram chat");
  assert.equal((await presses(83002, toOwner, "no")).body.ignored, true, "a second press changes nothing");
  assert.equal(journeyOf(deal.matchId).status, "ACTIVE");
});

test("in the room: a move reaches the other side; a request to the broker reaches the broker only", async () => {
  const links = (await call("/os/session/links", { officeId: OFFICE_A, journeyId: deal.journeyId }, OWNER_A)).body.links;
  const token = (url) => String(url).split("#")[1];
  const ownerBefore = messagesTo(83002).length;
  const clientBefore = messagesTo(83001).length;
  const brokerBefore = messagesTo(83900).length;
  const move = await call("/os/session/act", { token: token(links.client.url), action: "minus5", submissionId: "bot-move-1" }, "");
  assert.equal(move.body.state, "SAVED", JSON.stringify(move.body));
  assert.equal(messagesTo(83002).length, ownerBefore + 1, "the owner is told the client moved");
  const relay = lastTo(83002);
  assert.match(relay.text, /^العميل: /);
  assert.match(relay.text, /افتح صفحة التفاوض للرد/);
  assert.ok(relay.text.includes(links.owner.url) || relay.reply_markup?.inline_keyboard?.[0]?.[0]?.url === links.owner.url, "with the owner's own link");
  assert.equal(messagesTo(83001).length, clientBefore, "the client is not told about his own move");
  assert.equal(messagesTo(83900).length, brokerBefore, "an ordinary move does not ring the broker's Telegram");

  const help = await call("/os/session/act", { token: token(links.owner.url), action: "intervention", message: "أحتاج رأي الوسيط في السعر", submissionId: "bot-move-2" }, "");
  assert.equal(help.body.state, "SAVED", JSON.stringify(help.body));
  assert.equal(messagesTo(83001).length, clientBefore, "a request to the broker is never shown to the other side");
  assert.equal(messagesTo(83900).length, brokerBefore + 1, "the broker is told at once");
  assert.match(lastTo(83900).text, /تدخل مطلوب — المالك/);
  assert.ok(lastTo(83900).text.includes(`/#/session/${deal.journeyId}`) || lastTo(83900).reply_markup?.inline_keyboard?.[0]?.[0]?.url.endsWith(`/#/session/${deal.journeyId}`), "with a button that opens the room");

  // The broker takes this deal back: the bot goes quiet for it.
  assert.equal((await call("/os/journeys/bot", { officeId: OFFICE_A, journeyId: deal.journeyId, paused: true }, BROKER_A2)).status, 403, "only its broker or a manager");
  assert.equal((await call("/os/journeys/bot", { officeId: OFFICE_A, journeyId: deal.journeyId, paused: true }, OWNER_A)).status, 200);
  const quietBefore = messagesTo(83001).length;
  const ownerMove = await call("/os/session/act", { token: token(links.owner.url), action: "plus2", submissionId: "bot-move-3" }, "");
  assert.equal(ownerMove.body.state, "SAVED", JSON.stringify(ownerMove.body));
  assert.equal(messagesTo(83001).length, quietBefore, "nothing is passed on while the broker holds the deal");
  assert.ok(h.store.list(`offices/${OFFICE_A}/journeys/${deal.journeyId}/events`).some((event) => event.type === "BOT_HANDOVER" && /استلم الوسيط التواصل/.test(event.text)));
  assert.equal((await call("/os/journeys/bot", { officeId: OFFICE_A, journeyId: deal.journeyId, paused: false }, OWNER_A)).status, 200);
});

test("«غير مناسب» from the client closes the match and the owner is never bothered", async () => {
  const p = await pair("حي الرفض", { link: { client: 84001, owner: 84002 } });
  const no = await presses(84001, askTo(84001), "no");
  assert.equal(no.body.state, ASK_STATE.CLIENT_NO);
  assert.equal(match(p.matchId).brokerDecision, "REJECTED");
  assert.equal(match(p.matchId).brokerDecisionBy, "telegram-bot");
  assert.match(match(p.matchId).brokerDecisionReason, /العميل: غير مناسب \(عبر بوت تيليجرام\)/);
  assert.equal(reviewTask(p.matchId).status, "DISMISSED", "the broker has nothing left to do for it");
  assert.equal(askTo(84002), undefined, "the owner received nothing");
  assert.equal(journeyOf(p.matchId), undefined);
  assert.match(lastTo(84001).text, /سنبحث لك عن خيار أنسب/);
});

test("the owner declines: the match closes and the client is told, without the owner's identity", async () => {
  const p = await pair("حي اعتذار", { link: { client: 85001, owner: 85002 } });
  await presses(85001, askTo(85001), "yes");
  const no = await presses(85002, askTo(85002), "no");
  assert.equal(no.body.state, ASK_STATE.OWNER_NO);
  assert.equal(match(p.matchId).brokerDecision, "REJECTED");
  assert.match(match(p.matchId).brokerDecisionReason, /المالك: غير مناسب/);
  assert.match(lastTo(85001).text, /اعتذر المالك عن هذا العقار/);
  assert.equal(journeyOf(p.matchId), undefined);
});

test("the owner is not on the bot: the broker is told and continues; his approval sends the client's link", async () => {
  const p = await pair("حي نصف", { link: { client: 86001 } });
  const brokerBefore = messagesTo(83900).length;
  const yes = await presses(86001, askTo(86001), "yes");
  assert.equal(yes.body.state, ASK_STATE.OWNER_NOT_LINKED);
  assert.equal(match(p.matchId).brokerDecision ?? "", "", "nothing is decided for the broker");
  assert.equal(reviewTask(p.matchId).status, "OPEN");
  assert.match(lastTo(86001).text, /سيتواصل معك الوسيط/);
  const note = notes().find((n) => n.matchId === p.matchId && n.title === "العميل وافق على المطابقة عبر البوت");
  assert.ok(note && note.route === `review/${p.matchId}` && /المالك غير مرتبط بالبوت/.test(note.body));
  assert.equal(messagesTo(83900).length, brokerBefore + 1);
  const approved = await call("/os/review/decide", { officeId: OFFICE_A, matchId: p.matchId, decision: "approve" }, OWNER_A);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.match(lastTo(86001).text, /افتح صفحة التفاوض/, "the linked client gets his room link when the broker approves");
  const journey = h.store.get(`offices/${OFFICE_A}/journeys/${approved.body.journeyId}`);
  assert.equal(journey.approvedBy, OWNER_A);
  assert.ok(Object.values(journey.openTasks).some((task) => task.type === "SEND_PROPOSAL"), "the broker's own approval keeps its usual first task");
  assert.ok(h.store.list(`offices/${OFFICE_A}/journeys/${approved.body.journeyId}/events`).some((event) => event.type === "BOT_MESSAGE" && /إلى: العميل$/.test(event.text)), "the log says exactly who received it");
});

test("the broker decides first: the side's button no longer does anything", async () => {
  const p = await pair("حي السبق", { link: { client: 87001, owner: 87002 } });
  const question = askTo(87001);
  assert.equal((await call("/os/review/decide", { officeId: OFFICE_A, matchId: p.matchId, decision: "reject", reason: "غير مناسب" }, OWNER_A)).status, 200);
  const late = await presses(87001, question, "yes");
  assert.equal(late.body.ignored, true);
  assert.equal(late.body.reason, "match_already_decided");
  assert.equal(ask(p.matchId).state, ASK_STATE.CANCELLED);
  assert.equal(match(p.matchId).brokerDecisionBy, OWNER_A, "the broker's decision stands");
  assert.equal(askTo(87002), undefined);
  assert.match(sent.filter((m) => m.method === "answerCallbackQuery").at(-1).text, /لم يعد قائمًا/);
});

test("what a side writes is never answered by the bot itself: it goes to the office and the broker", async () => {
  const p = await pair("حي الرسائل", { link: { client: 88001 } });
  const inboxBefore = h.store.list(`offices/${OFFICE_A}/inbox`).length;
  const wrote = await says(88001, "هل يمكن تأجيل المعاينة إلى السبت؟");
  assert.equal(wrote.body.forwarded, 1, JSON.stringify(wrote.body));
  const item = h.store.list(`offices/${OFFICE_A}/inbox`).find((entry) => entry.source === "telegram_bot_party" && /تأجيل المعاينة/.test(entry.messageText));
  assert.ok(item && h.store.list(`offices/${OFFICE_A}/inbox`).length === inboxBefore + 1);
  assert.equal(item.processingState, "kept", "it is kept for the broker, never turned into a record by itself");
  assert.equal(item.messageClass, "DEAL");
  assert.equal(item.senderName, "عميل حي الرسائل");
  assert.equal(h.store.list(`offices/${OFFICE_B}/inbox`).length, 0, "and only for his own office");
  assert.match(lastTo(88001).text, /وصلت رسالتك إلى الوسيط/);
  assert.ok(notes().some((n) => /رسالة عبر البوت — عميل حي الرسائل/.test(n.title) && n.route === "inbox"));
  assert.equal((await says(88777, "مرحبا")).body.reason, "chat_not_linked", "a stranger's message is ignored");

  // «إيقاف» is obeyed at once.
  assert.equal((await says(88001, "إيقاف")).body.command, "stop");
  assert.match(lastTo(88001).text, /تم إيقاف رسائل البوت/);
  assert.equal((await call("/os/bot/party/status", { officeId: OFFICE_A, recordId: p.requestId }, OWNER_A)).body.state, "STOPPED");
  const questionsTo = (chatId) => messagesTo(chatId).filter((m) => m.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data).length;
  const askedBefore = questionsTo(88001);
  seq += 1;
  const second = await call("/os/records/save", { officeId: OFFICE_A, requestKey: `bot-off-extra-${seq}`, record: { kind: "OFFER", purpose: "SALE", propertyType: "شقة", city: "الرياض", district: "حي الرسائل", price: 910000, area: 170, rooms: 4, contactName: "مالك آخر", contactPhone: "0554009991" } }, OWNER_A);
  const secondMatch = matchesOf().find((m) => m.offerId === second.body.recordId && m.requestId === p.requestId);
  assert.ok(secondMatch);
  assert.equal(questionsTo(88001), askedBefore, "a side that stopped the bot is asked nothing");
  assert.equal(ask(secondMatch.id), null);
  assert.equal((await says(88001, "تشغيل")).body.command, "resume");
  assert.equal((await call("/os/bot/party/status", { officeId: OFFICE_A, recordId: p.requestId }, OWNER_A)).body.state, "LINKED");
});

test("a side that blocked the bot: the question fails honestly and the match stays with the broker", async () => {
  blockedChats.add("89001");
  const p = await pair("حي الحظر", { before: async ({ requestId }) => { blockedChats.delete("89001"); await linkParty(requestId, 89001); blockedChats.add("89001"); } });
  assert.equal(ask(p.matchId).state, ASK_STATE.FAILED);
  assert.equal(match(p.matchId).botAskState, ASK_STATE.FAILED);
  assert.equal(reviewTask(p.matchId).status, "OPEN");
  assert.equal((await call("/os/bot/party/status", { officeId: OFFICE_A, recordId: p.requestId }, OWNER_A)).body.state, "STOPPED", "the link is switched off so nothing more is attempted");
  blockedChats.delete("89001");
});

test("switching the bot off stops everything at once: answers still out go to the broker, nothing is decided or sent on", async () => {
  const p = await pair("حي الإيقاف", { link: { client: 90001, owner: 90002 } });
  const q2 = await pair("حي الإيقاف الثاني", { link: { client: 90011, owner: 90012 } });
  const question = askTo(90001);
  assert.ok(question);
  await presses(90011, askTo(90011), "yes");
  const ownerQuestion = askTo(90012);
  assert.ok(ownerQuestion, "the second pair is waiting for its owner");

  assert.equal((await call("/os/bot/enable", { officeId: OFFICE_A, enabled: false }, OWNER_A)).status, 200);
  assert.ok(h.store.list(`offices/${OFFICE_A}/auditLogs`).some((entry) => entry.action === "BOT_DISABLED"));
  const before = sent.filter((m) => m.method === "sendMessage").length;
  const later = await pair("حي بعد الإيقاف", { link: { client: 90003 } });
  assert.equal(ask(later.matchId), null, "a new match is not asked about");
  assert.equal(sent.filter((m) => m.method === "sendMessage").length, before + 2, "only the newly linked side's confirmation and welcome");

  // The client answers a question that went out earlier: the owner is NOT asked; the broker is told.
  const ownerQuestionsBefore = messagesTo(90002).length;
  const yes = await presses(90001, question, "yes");
  assert.equal(yes.body.state, ASK_STATE.HANDED_TO_BROKER, JSON.stringify(yes.body));
  assert.equal(messagesTo(90002).length, ownerQuestionsBefore, "the owner receives nothing after the switch-off");
  assert.equal(match(p.matchId).brokerDecision ?? "", "", "nothing is decided");
  assert.equal(reviewTask(p.matchId).status, "OPEN");
  assert.match(lastTo(90001).text, /وصل ردك إلى الوسيط/);
  assert.ok(notes().some((n) => n.matchId === p.matchId && /رد العميل على المطابقة عبر البوت: مناسب/.test(n.title) && n.route === `review/${p.matchId}`));
  // The owner of the other pair says yes: no deal is opened by the bot while it is off.
  const ownerYes = await presses(90012, ownerQuestion, "yes");
  assert.equal(ownerYes.body.state, ASK_STATE.HANDED_TO_BROKER);
  assert.equal(journeyOf(q2.matchId), undefined, "the deal waits for the broker's own approval");
  assert.equal(match(q2.matchId).brokerDecision ?? "", "");
  assert.ok(notes().some((n) => n.matchId === q2.matchId && /رد المالك على المطابقة عبر البوت: مناسب/.test(n.title)));
  // A room move is not passed on either.
  const links = (await call("/os/session/links", { officeId: OFFICE_A, journeyId: deal.journeyId }, OWNER_A)).body.links;
  const ownerBefore = messagesTo(83002).length;
  const moved = await call("/os/session/act", { token: String(links.client.url).split("#")[1], action: "compromise", submissionId: "bot-off-move" }, "");
  assert.equal(moved.body.state, "SAVED", JSON.stringify(moved.body));
  assert.equal(messagesTo(83002).length, ownerBefore, "no relay while the office's bot is off");
  assert.equal((await call("/os/bot/enable", { officeId: OFFICE_A, enabled: true }, OWNER_A)).status, 200);
});

test("editing a record never repeats a question: «غير مناسب» stands until the price changes, and no old pair is asked", async () => {
  const p = await pair("حي التعديل", { link: { client: 91001, owner: 91002 } });
  const questions = (chatId) => messagesTo(chatId).filter((m) => m.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data).length;
  assert.equal(questions(91001), 1);
  // While the client is still deciding, the owner's record is edited: the same question now covers the new version.
  const edit = (patch, key) => call("/os/records/save", { officeId: OFFICE_A, recordId: p.offerId, requestKey: key, record: { kind: "OFFER", purpose: "SALE", propertyType: "شقة", city: "الرياض", district: "حي التعديل", price: 900000, area: 180, rooms: 4, contactName: "مالك حي التعديل", contactPhone: p.ownerPhone, ...patch } }, OWNER_A);
  assert.equal((await edit({ rooms: 5 }, "bot-edit-1")).status, 200);
  assert.equal(questions(91001), 1, "an edit while waiting does not ask again");
  const current = () => matchesOf().filter((m) => m.offerId === p.offerId && m.requestId === p.requestId && m.isCurrent !== false && String(m.status) === "active").at(-1);
  const pairAsk = () => h.store.list(`offices/${OFFICE_A}/matchAsks`).find((entry) => entry.offerId === p.offerId && entry.requestId === p.requestId);
  assert.equal(pairAsk().matchId, current().id, "the question follows the newest version of the match");
  const no = await presses(91001, askTo(91001), "no");
  assert.equal(no.body.state, ASK_STATE.CLIENT_NO, JSON.stringify(no.body));
  assert.equal(match(current().id)?.brokerDecision ?? matchesOf().find((m) => m.id === pairAsk().matchId).brokerDecision, "REJECTED");
  // The owner's name is corrected: the client is not asked again about a property he declined.
  assert.equal((await edit({ rooms: 5, contactName: "مالك التعديل المصحح" }, "bot-edit-2")).status, 200);
  assert.equal(questions(91001), 1, "«غير مناسب» is respected after an unrelated edit");
  assert.equal(pairAsk().state, ASK_STATE.CLIENT_NO);
  // The price drops: that is a new question.
  assert.equal((await edit({ rooms: 5, contactName: "مالك التعديل المصحح", price: 820000 }, "bot-edit-3")).status, 200);
  assert.equal(questions(91001), 2, "a new price is asked about once");
  assert.match(askTo(91001).text, /820,000 ريال/);
  assert.equal(pairAsk().state, ASK_STATE.CLIENT_ASKED);
  assert.equal(h.store.list(`offices/${OFFICE_A}/matchAsks`).filter((entry) => entry.offerId === p.offerId).length, 1, "one question document per pair");

  // A pair that matched while the bot was off is not asked about after it is switched on, even when edited later.
  assert.equal((await call("/os/bot/enable", { officeId: OFFICE_A, enabled: false }, OWNER_A)).status, 200);
  const old = await pair("حي قديم", { link: { client: 91011 } });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal((await call("/os/bot/enable", { officeId: OFFICE_A, enabled: true }, OWNER_A)).status, 200);
  const touched = await call("/os/records/save", { officeId: OFFICE_A, recordId: old.offerId, requestKey: "bot-edit-old", record: { kind: "OFFER", purpose: "SALE", propertyType: "شقة", city: "الرياض", district: "حي قديم", price: 900000, area: 181, rooms: 4, contactName: "مالك حي قديم", contactPhone: old.ownerPhone } }, OWNER_A);
  assert.equal(touched.status, 200);
  assert.equal(questions(91011), 0, "no backlog: the old pair stays the broker's");
});

test("one person, two offices: what he writes reaches only the office that wrote to him last", async () => {
  assert.equal((await call("/os/bot/enable", { officeId: OFFICE_B, enabled: true }, OWNER_B)).status, 200);
  const phone = "0556000777";
  const inA = await call("/os/records/save", { officeId: OFFICE_A, requestKey: "bot-two-a", record: { kind: "REQUEST", purpose: "PURCHASE", propertyType: "شقة", city: "الرياض", district: "حي المكتبين", price: 950000, contactName: "عميل المكتبين", contactPhone: phone } }, OWNER_A);
  const inB = await call("/os/records/save", { officeId: OFFICE_B, requestKey: "bot-two-b", record: { kind: "REQUEST", purpose: "PURCHASE", propertyType: "شقة", city: "الرياض", district: "حي المكتبين", price: 950000, contactName: "عميل المكتبين", contactPhone: phone } }, OWNER_B);
  await linkParty(inA.body.recordId, 92001, { office: OFFICE_A, uid: OWNER_A });
  await linkParty(inB.body.recordId, 92001, { office: OFFICE_B, uid: OWNER_B });
  // Office A's bot asks him about a match; then he writes.
  const offerA = await call("/os/records/save", { officeId: OFFICE_A, requestKey: "bot-two-a-off", record: { kind: "OFFER", purpose: "SALE", propertyType: "شقة", city: "الرياض", district: "حي المكتبين", price: 900000, area: 150, rooms: 3, contactName: "مالك أ", contactPhone: "0556000778" } }, OWNER_A);
  assert.equal(offerA.status, 200);
  assert.ok(askTo(92001), "office A's bot wrote to him last");
  const inboxA = h.store.list(`offices/${OFFICE_A}/inbox`).length;
  const inboxB = h.store.list(`offices/${OFFICE_B}/inbox`).length;
  const wrote = await says(92001, "متى أستطيع المعاينة؟");
  assert.equal(wrote.body.forwarded, 1);
  assert.equal(h.store.list(`offices/${OFFICE_A}/inbox`).length, inboxA + 1);
  assert.equal(h.store.list(`offices/${OFFICE_B}/inbox`).length, inboxB, "office B never sees a message about office A's deal");
  // His answer is office A's business only.
  const yes = await presses(92001, askTo(92001), "yes");
  assert.equal(yes.body.state, ASK_STATE.OWNER_NOT_LINKED);
  assert.equal(h.store.list(`offices/${OFFICE_B}/matchAsks`).length, 0);
  assert.equal((await call("/os/bot/enable", { officeId: OFFICE_B, enabled: false }, OWNER_B)).status, 200);
});

test("a side that moves to another Telegram account: the old chat no longer speaks for him", async () => {
  const p = await pair("حي الانتقال", { link: { client: 93001 } });
  await linkParty(p.requestId, 93002);
  assert.equal(h.store.list("telegramParties").find((party) => party.recordId === p.requestId).chatId, "93002");
  assert.equal((await says(93001, "إيقاف")).body.reason, "chat_not_linked", "the old chat cannot stop the new link");
  assert.equal((await call("/os/bot/party/status", { officeId: OFFICE_A, recordId: p.requestId }, OWNER_A)).body.state, "LINKED");
  assert.equal((await says(93002, "إيقاف")).body.command, "stop");
  assert.equal((await says(93001, "تشغيل")).body.reason, "chat_not_linked", "nor switch it back on");
  assert.equal((await call("/os/bot/party/status", { officeId: OFFICE_A, recordId: p.requestId }, OWNER_A)).body.state, "STOPPED");
  assert.equal((await says(93002, "/start")).body.command, "resume", "«/start» alone brings a stopped side back");
});

test("the deal the bot opens belongs to the records' broker — never to the bot; an unreachable side becomes a clear task", async () => {
  const p = await pair("حي الوسيط الثاني", { uid: BROKER_A2, link: { client: 94001, owner: 94002 } });
  await presses(94001, askTo(94001), "yes");
  // The owner stops the bot between his «مناسب» being read and the room link going out.
  blockedChats.add("94002");
  const open = await presses(94002, askTo(94002), "yes");
  blockedChats.delete("94002");
  assert.equal(open.body.state, ASK_STATE.OPENED, JSON.stringify(open.body));
  const journey = journeyOf(p.matchId);
  assert.equal(journey.assignedBrokerId, BROKER_A2);
  assert.notEqual(journey.assignedBrokerId, "telegram-bot");
  const followUp = Object.values(journey.openTasks).find((task) => task.type === "JOURNEY_FOLLOW_UP");
  assert.ok(followUp && /لم يصل رابط صفحة التفاوض إلى المالك/.test(followUp.reason), "the broker has a task to send the missing link himself");
  assert.ok(notes().some((n) => n.matchId === p.matchId && /لم يصل الرابط إلى: المالك/.test(n.body)));
  assert.match(lastTo(94001).text, /افتح صفحة التفاوض/, "the client still received his link");
  // A removed member keeps no alerts.
  const link = await call("/os/bot/broker/link", { officeId: OFFICE_A }, BROKER_A2);
  assert.equal((await says(94900, `/start ${codeOf(link.body.deepLink)}`)).body.kind, "broker");
  h.store.patch(`offices/${OFFICE_A}/members/${BROKER_A2}`, { active: false });
  const before = messagesTo(94900).length;
  const links = h.store.list("sessionLinkSecrets").filter((secret) => String(secret.id).includes(journey.journeyId || journey.id));
  const clientSecret = links.find((secret) => String(secret.id).endsWith("__client"));
  const help = await call("/os/session/act", { token: clientSecret.token, action: "intervention", message: "أحتاج الوسيط", submissionId: "bot-removed-1" }, "");
  assert.equal(help.body.state, "SAVED", JSON.stringify(help.body));
  assert.equal(messagesTo(94900).length, before, "someone who left the office receives nothing more about it");
  h.store.patch(`offices/${OFFICE_A}/members/${BROKER_A2}`, { active: true });
});

test("the daily limit: after three questions in a day the next match stays with the broker", async () => {
  const requestPhone = "0556100900";
  const request = await call("/os/records/save", { officeId: OFFICE_A, requestKey: "bot-limit-req", record: { kind: "REQUEST", purpose: "PURCHASE", propertyType: "شقة", city: "الرياض", district: "حي الحد", price: 950000, contactName: "عميل الحد", contactPhone: requestPhone } }, OWNER_A);
  await linkParty(request.body.recordId, 95001);
  const questions = () => messagesTo(95001).filter((m) => m.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data).length;
  for (let i = 1; i <= BOT_LIMITS.dailyAsks + 1; i += 1) {
    const offer = await call("/os/records/save", { officeId: OFFICE_A, requestKey: `bot-limit-off-${i}`, record: { kind: "OFFER", purpose: "SALE", propertyType: "شقة", city: "الرياض", district: "حي الحد", price: 880000 + i * 5000, area: 150 + i, rooms: 3, contactName: `مالك الحد ${i}`, contactPhone: `055610090${i}` } }, OWNER_A);
    assert.equal(offer.status, 200, JSON.stringify(offer.body));
  }
  assert.equal(questions(), BOT_LIMITS.dailyAsks, "no more than the daily limit");
  const mine = matchesOf().filter((m) => m.requestId === request.body.recordId);
  assert.equal(mine.length, BOT_LIMITS.dailyAsks + 1);
  assert.equal(mine.filter((m) => reviewTask(m.id)?.status === "OPEN").length, BOT_LIMITS.dailyAsks + 1, "every one of them is still a review task for the broker");
});

test("webhook safety: no secret → refused; the bot's collections are closed to every client", async () => {
  const refused = await telegram({ callback_query: { id: "x", data: "ask:AbCdEfGhIjKlMnOpQrStUv:y", message: { chat: { id: 1 } } } }, { secret: "" });
  assert.equal(refused.status, 401);
  const wrong = await telegram({ callback_query: { id: "x", data: "ask:AbCdEfGhIjKlMnOpQrStUv:y", message: { chat: { id: 1 } } } }, { secret: "wrong" });
  assert.equal(wrong.status, 401);
  const unknown = await telegram({ callback_query: { id: "x", from: { id: 1 }, data: "ask:AbCdEfGhIjKlMnOpQrStUv:y", message: { message_id: 1, chat: { id: 1, type: "private" } } } });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.body.reason, "ask_unknown");
  const rules = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8");
  // Collections inside an office are open to its members by a general rule unless they are on this list
  // (rules add up, they never narrow) — so the list is what really closes them. The emulator suite proves it.
  const restricted = rules.slice(rules.indexOf("function isRestrictedOfficeCollection"), rules.indexOf("function validOfficeProfile"));
  for (const name of ["botSettings", "matchAsks"]) assert.ok(restricted.includes(`'${name}'`), `${name} is excluded from the general member rule`);
  const flat = rules.replace(/\s+/g, " ");
  for (const name of ["telegramParties/{partyKey}", "telegramBrokers/{brokerKey}", "telegramBotChats/{chatId}", "telegramAsks/{token}", "telegramPartyPending/{chatId}"]) {
    assert.ok(flat.includes(`match /${name} { allow read, write: if false; }`), name);
  }
  const emulator = fs.readFileSync(path.join(ROOT, "test/emulator/office-os-rules.emulator.test.mjs"), "utf8");
  assert.ok(emulator.includes("offices/office-a/botSettings/telegram") && emulator.includes("offices/office-a/matchAsks/ask_1"), "the emulator suite covers them with real requests");
  const toml = fs.readFileSync(path.join(ROOT, "worker/wrangler.toml"), "utf8");
  const production = toml.slice(0, toml.indexOf("[env.staging]"));
  assert.ok(!production.includes("TELEGRAM_OUTBOUND"), "sending is allowed on Staging only");
  assert.ok(sent.every((m) => ["sendMessage", "answerCallbackQuery", "editMessageText"].includes(m.method)), "the bot uses only these three calls");
  assert.ok(!JSON.stringify(sent).includes(SECRET), "the webhook secret is never sent anywhere");
});
