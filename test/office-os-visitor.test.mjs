// «مدير المكتب الذكي» phase 2: people talking to an office through its own bot link, the broker's
// executive commands (with the approval gate), proactive suggestions, «دخول بتيليجرام», and the office's
// validity settings. Through the real Worker on the in-memory Firestore double; Telegram and Gemini are doubles.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import {
  detectLang, isSmallTalk, mergeDraft, nextMissing, officeBotLink, parseOfficeStart, wantsHuman
} from "../public/os/domain/visitor-domain.js";
import { negotiationSummary, proactiveSuggestions, stuckReason, viewingPlan, fallbackIntent } from "../public/os/domain/agent-domain.js";
import { botIdFromToken, loginNonceMatches, parseTgAuthResult, telegramLoginCheckString, telegramLoginFresh, telegramLoginUrl } from "../public/os/domain/telegram-login-domain.js";
import { validitySettingsFrom } from "../public/os/domain/validity-domain.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());
const SECRET = "tg-secret-for-visitor-tests";
const BOT_TOKEN = "987654321:VISITOR-TOKEN-never-in-a-response-0"; // pragma: allowlist secret
Object.assign(h.env, { TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_BOT_USERNAME: "iaqar_test_bot", TELEGRAM_OUTBOUND: "enabled" });

const sent = [];
const script = [];
let geminiCalls = 0;
let refuseWritesTo = "";
const realFetch = globalThis.fetch;
let messageSeq = 500;
globalThis.fetch = async (input, init = {}) => {
  const url = String(typeof input === "string" ? input : input.url);
  if (url.startsWith("https://generativelanguage.googleapis.com/")) {
    geminiCalls += 1;
    const next = script.shift();
    if (!next || next.fail) return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(next) }] } }] }), { status: 200 });
  }
  if (!url.startsWith("https://api.telegram.org/")) return realFetch(input, init);
  const method = url.split("/").pop();
  const payload = JSON.parse(init.body || "{}");
  if (method === "sendMessage" && refuseWritesTo && String(payload.chat_id) === refuseWritesTo) {
    return new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" }), { status: 403 });
  }
  sent.push({ method, ...payload });
  return new Response(JSON.stringify({ ok: true, result: { message_id: ++messageSeq } }), { status: 200 });
};
test.after(() => { globalThis.fetch = realFetch; });

async function call(route, body, uid) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
let updateId = 70000;
async function telegram(update, id = ++updateId) {
  const response = await h.worker.fetch(new Request("https://worker.test/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET }, body: JSON.stringify({ update_id: id, ...update }) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const msg = (chatId, extra) => ({ message: { message_id: updateId + 1, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: "private" }, from: { id: chatId, first_name: "سعد", language_code: "ar" }, ...extra } });
const says = (chatId, text) => telegram(msg(chatId, { text }));
const shares = (chatId, phone, userId = chatId) => telegram(msg(chatId, { contact: { phone_number: phone, user_id: userId, first_name: "سعد" } }));
const press = (chatId, data, from = chatId) => telegram({ callback_query: { id: `cq-${updateId}`, from: { id: from }, data, message: { message_id: 1, chat: { id: chatId, type: "private" }, text: "" } } });
const lastTo = (chatId) => sent.filter((m) => m.method === "sendMessage" && String(m.chat_id) === String(chatId)).at(-1);
const recordsOf = (office) => h.store.list(`offices/${office}/opportunities`);
const ANSWERS = { purpose: "للبيع", propertyType: "أرض", district: "حي الراية", city: "المدينة المنورة", price: "900000" };

// ------------------------------------------------------------------ pure rules

test("rules: the office link, languages, small talk, a request for a person, one question at a time", () => {
  assert.equal(parseOfficeStart("/start of_office-alpha"), "office-alpha");
  assert.equal(parseOfficeStart("/start lnk_abc"), "");
  assert.equal(officeBotLink("@iaqar_test_bot", "office-alpha"), "https://t.me/iaqar_test_bot?start=of_office-alpha");
  assert.equal(officeBotLink("bad name!", "office-alpha"), "");
  assert.equal(detectLang("I have a villa for rent"), "en");
  assert.equal(detectLang("عندي فيلا للإيجار"), "ar");
  assert.ok(isSmallTalk("السلام عليكم") && isSmallTalk("شكرا!") && !isSmallTalk("عندي أرض للبيع في الراية"));
  assert.ok(wantsHuman("ابي اكلم الوسيط") && wantsHuman("can I talk to a person") && !wantsHuman("أرض للبيع"));
  let draft = mergeDraft({ kind: "OFFER" }, { propertyType: "أرض", transactionType: "sale" });
  assert.equal(draft.purpose, "SALE");
  assert.equal(nextMissing(draft), "district");
  draft = mergeDraft(draft, { district: "حي الراية", city: "المدينة المنورة", price: 900000 });
  assert.equal(draft.district, "الراية");
  assert.equal(nextMissing(draft), "");
  assert.equal(mergeDraft(draft, { price: 0 }).price, 900000, "an empty value never erases what was said");
});

test("rules: executive commands are understood without the model; summaries use only the deal's own data", () => {
  assert.equal(fallbackIntent("تابع العملاء اللي ما ردوا").tool, "follow_up_silent");
  assert.equal(fallbackIntent("رتب المعاينات").tool, "plan_viewings");
  assert.equal(fallbackIntent("جهز ملخص المفاوضة في أرض الراية").tool, "negotiation_summary");
  assert.equal(fallbackIntent("ليش توقفت صفقة الراية؟").tool, "why_stuck");
  assert.equal(fallbackIntent("اقبل السعر عن المالك").tool, "forbidden");
  const now = new Date("2026-10-09T10:00:00Z");
  const lines = negotiationSummary({ offerSummary: { price: 900000 }, lastReplies: { client: { label: "سعر مقابل", at: "2026-10-07T10:00:00Z" } } }, { now, nextStep: "راجع الرد" });
  assert.ok(lines.some((l) => l.includes("900,000")) && lines.some((l) => l.includes("سعر مقابل") && l.includes("2 يوم")) && lines.some((l) => l.includes("رد المالك: لا يوجد")));
  assert.match(stuckReason({ status: "ACTIVE", viewing: { state: "CONFIRMED", at: "2026-10-07T10:00:00Z" } }, { now }), /مضى ولم تُسجل/);
  assert.match(stuckReason({ status: "ACTIVE", lastEvent: { at: "2026-10-01T10:00:00Z" } }, { now }), /لم يُرسل أي مقترح/);
  const plan = viewingPlan([
    { journeyId: "b", viewing: { state: "CONFIRMED", at: "2026-10-10T12:00:00Z" } },
    { journeyId: "a", viewing: { state: "ACCEPTED", at: "2026-10-10T11:00:00Z" } },
    { journeyId: "old", viewing: { state: "CONFIRMED", at: "2026-10-01T11:00:00Z" } }
  ], { now });
  assert.deepEqual(plan.map((p) => p.journey.journeyId), ["a", "b"]);
  assert.deepEqual(plan[0].flags, ["غير مؤكد", "قريب من موعد آخر"]);
  assert.equal(proactiveSuggestions({}).length, 0);
  assert.equal(proactiveSuggestions({ silent: 2, stuck: 1 })[0].prompt, "تابع العملاء اللي ما ردوا");
  assert.deepEqual(validitySettingsFrom({ defaultDuration: "WEEK", periodicDays: 500, remindBeforeDays: 0 }), { defaultDuration: "WEEK", periodicDays: 90, remindBeforeDays: 1 });
});

test("rules: «دخول بتيليجرام» — the sign-in address, the returned data, Telegram's check string, freshness", () => {
  assert.equal(botIdFromToken(BOT_TOKEN), "987654321");
  assert.equal(botIdFromToken("nonsense"), "");
  const url = telegramLoginUrl({ botId: "987654321", origin: "https://office.test", returnTo: "https://office.test/" });
  assert.match(url, /^https:\/\/oauth\.telegram\.org\/auth\?bot_id=987654321&origin=https%3A%2F%2Foffice\.test&request_access=write/);
  assert.equal(telegramLoginUrl({ botId: "1", origin: "https://office.test", returnTo: "https://evil.test/" }), "");
  const auth = { id: "42", first_name: "سعد", auth_date: "1760000000", hash: "a".repeat(64) };
  const encoded = Buffer.from(JSON.stringify(auth)).toString("base64").replace(/=+$/, "");
  assert.deepEqual(parseTgAuthResult(`#tgAuthResult=${encoded}`, (b) => Buffer.from(b, "base64").toString("binary")), auth);
  assert.equal(parseTgAuthResult("#/office"), null);
  assert.equal(telegramLoginCheckString({ ...auth, extra: "x" }), "auth_date=1760000000\nfirst_name=سعد\nid=42");
  assert.ok(telegramLoginFresh(auth, new Date(1760000000 * 1000 + 10 * 60000)));
  assert.ok(!telegramLoginFresh(auth, new Date(1760000000 * 1000 + 3600000)), "a sign-in is used right away, not hours later");
  const nonce = "a1b2c3d4e5f6a7b8c9d0";
  assert.ok(loginNonceMatches(`${nonce}|${Date.now()}`, nonce));
  assert.ok(!loginNonceMatches("", nonce), "a result this browser did not start is refused");
  assert.ok(!loginNonceMatches(`${nonce}|${Date.now()}`, "someone-elses-nonce"));
  assert.ok(!loginNonceMatches(`${nonce}|${Date.now() - 3600000}`, nonce));
});

// ------------------------------------------------------------------ the office's own bot link

test("gates: with the office manager off, an office link sends nothing", async () => {
  const before = sent.length;
  const r = await says(5101, `/start of_${OFFICE_A}`);
  assert.equal(r.body.reason, "agent_off");
  assert.equal(sent.length, before);
});

test("an owner registers an offer from the office link: persona button, one question at a time, own number, summary, «سجّل»", async () => {
  await call("/os/bot/enable", { officeId: OFFICE_A, enabled: true }, OWNER_A);
  await call("/os/agent/settings", { officeId: OFFICE_A, enabled: true }, OWNER_A);
  const status = await call("/os/agent/status", { officeId: OFFICE_A }, OWNER_A);
  assert.equal(status.body.officeBotLink, `https://t.me/iaqar_test_bot?start=of_${OFFICE_A}`);
  const chat = 5101;
  const start = await says(chat, `/start of_${OFFICE_A}`);
  assert.equal(start.body.visitor, "started");
  const welcome = lastTo(chat);
  assert.match(welcome.text, /مدير المكتب الذكي/);
  assert.deepEqual(welcome.reply_markup.inline_keyboard.map((row) => row[0].callback_data), ["vp:OWNER", "vp:BROKER", "vp:CLIENT"]);
  await press(chat, "vp:OWNER");
  assert.match(lastTo(chat).text, /وش العقار/);
  const before = recordsOf(OFFICE_A).length;
  const hello = await says(chat, "السلام عليكم");
  assert.equal(hello.body.smallTalk, true);
  assert.equal(recordsOf(OFFICE_A).length, before, "small talk never becomes a record");

  let r = await says(chat, "عندي أرض للبيع");
  const asked = [];
  for (let i = 0; i < 6 && r.body.asked && r.body.asked !== "phone"; i += 1) {
    asked.push(r.body.asked);
    r = await says(chat, ANSWERS[r.body.asked]);
  }
  assert.equal(r.body.asked, "phone", JSON.stringify(r.body));
  assert.equal(new Set(asked).size, asked.length, "never asks the same thing twice");
  assert.ok(lastTo(chat).reply_markup.keyboard[0][0].request_contact);
  const other = await shares(chat, "+966556711111", 999);
  assert.equal(other.body.phone, "not_own");
  const own = await shares(chat, "+966556700001");
  assert.equal(own.body.stage, "CONFIRM");
  assert.match(lastTo(chat).text, /أسجله؟/);
  assert.equal(recordsOf(OFFICE_A).length, before, "nothing is saved before «سجّل»");
  const intruder = await press(chat, "vc:SAVE", 31337);
  assert.equal(intruder.body.reason, "not_this_chat");
  const saved = await press(chat, "vc:SAVE");
  assert.equal(saved.body.saved, true, JSON.stringify(saved.body));
  const record = h.store.get(`offices/${OFFICE_A}/opportunities/${saved.body.recordId}`);
  assert.equal(record.sourceType, "TELEGRAM_AGENT");
  assert.equal(record.district, "الراية");
  assert.equal(record.contactPhone || record.phone, "0556700001");
  assert.ok(record.validityDuration, "the office's validity applies");
  assert.match(lastTo(chat).text, new RegExp(saved.body.reference));
  // The chat now speaks for the record (no «Start» again).
  const chats = h.store.get(`telegramBotChats/${chat}`);
  assert.ok(chats.parties?.[OFFICE_A]);
  assert.equal(recordsOf(OFFICE_B).filter((x) => x.sourceType === "TELEGRAM_AGENT").length, 0, "the other office got nothing");
});

test("the same person registers a second transaction without linking again; English in → English out (the model)", async () => {
  const chat = 5101;
  await press(chat, "vn:NEW");
  await press(chat, "vp:CLIENT");
  h.env.GEMINI_API_KEY = "test-key-not-real"; // pragma: allowlist secret
  script.push({ found: { propertyType: "فيلا", district: "الملقا", city: "الرياض", price: 120000, transactionType: "rent" }, lang: "en", question: "" });
  const r = await says(chat, "Looking for a villa to rent in Al Malqa, Riyadh, budget 120k a year");
  assert.equal(r.body.stage, "CONFIRM", JSON.stringify(r.body));
  assert.match(lastTo(chat).text, /Here is the summary/);
  const saved = await press(chat, "vc:SAVE");
  assert.equal(saved.body.saved, true);
  const record = h.store.get(`offices/${OFFICE_A}/opportunities/${saved.body.recordId}`);
  assert.equal(record.opportunityKind || record.kind, "REQUEST");
  assert.equal(record.contactPhone || record.phone, "0556700001", "the number shared before is reused");
  delete h.env.GEMINI_API_KEY;
});

test("another language: the model's own question (Urdu here) is what the person gets", async () => {
  const chat = 5202;
  await says(chat, `/start of_${OFFICE_A}`);
  await press(chat, "vp:OWNER");
  h.env.GEMINI_API_KEY = "test-key-not-real"; // pragma: allowlist secret
  script.push({ found: { propertyType: "شقة", transactionType: "rent" }, lang: "ur", question: "اپارٹمنٹ کس محلے میں ہے؟" });
  const r = await says(chat, "میرے پاس کرائے کے لیے ایک اپارٹمنٹ ہے");
  assert.equal(r.body.asked, "district");
  assert.equal(r.body.source, "ai");
  assert.equal(lastTo(chat).text, "اپارٹمنٹ کس محلے میں ہے؟");
  // The model failing never loses the conversation: the rules ask instead.
  script.push({ fail: true });
  const again = await says(chat, "الراية");
  assert.equal(again.body.source, "rules");
  delete h.env.GEMINI_API_KEY;
});

test("«أبي أكلم الوسيط» hands the chat to the office; a webhook delivered twice is answered once", async () => {
  const chat = 5303;
  await says(chat, `/start of_${OFFICE_A}`);
  await press(chat, "vp:CLIENT");
  const inboxBefore = h.store.list(`offices/${OFFICE_A}/inbox`).length;
  const r = await says(chat, "ابي اكلم الوسيط لو سمحت");
  assert.equal(r.body.handedOver, true);
  assert.match(lastTo(chat).text, /بلّغت الوسيط/);
  assert.equal(h.store.list(`offices/${OFFICE_A}/inbox`).length, inboxBefore + 1);
  const update = msg(chat, { text: "متى تتصلون؟" });
  const first = await telegram(update, 88001);
  const second = await telegram(update, 88001);
  assert.equal(first.body.forwarded, 1);
  assert.equal(second.body.duplicate, true);
  assert.equal(h.store.list(`offices/${OFFICE_A}/inbox`).length, inboxBefore + 2);
});

test("office isolation: a link to an office whose manager is off is ignored; an unknown office is told so", async () => {
  const before = sent.length;
  const off = await says(5404, `/start of_${OFFICE_B}`);
  assert.equal(off.body.reason, "agent_off");
  assert.equal(sent.length, before);
  const unknown = await says(5404, "/start of_no-such-office");
  assert.equal(unknown.body.visitor, "unknown_office");
});

// ------------------------------------------------------------------ the broker's executive commands

function seedAsk({ askId, partyKey, chatId, hoursAgo }) {
  const records = recordsOf(OFFICE_A);
  const offer = records.find((r) => (r.opportunityKind || r.kind) === "OFFER");
  const request = records.find((r) => (r.opportunityKind || r.kind) === "REQUEST");
  h.store.seed(`telegramParties/${partyKey}`, { officeId: OFFICE_A, partyKey, chatId: String(chatId), status: "ACTIVE" });
  h.store.seed(`offices/${OFFICE_A}/matchAsks/${askId}`, {
    officeId: OFFICE_A, askId, matchId: "", offerId: offer.id, requestId: request.id, state: "CLIENT_ASKED", assignedBrokerId: OWNER_A,
    client: { partyKey, token: `tok${askId}`.padEnd(20, "x"), askedAt: new Date(Date.now() - hoursAgo * 3600000).toISOString() }, owner: null
  });
}

test("«تابع العملاء اللي ما ردوا»: shown first, sent only after the broker presses, once per side", async () => {
  seedAsk({ askId: "ask_silent_1", partyKey: "tp_silent_1", chatId: 6101, hoursAgo: 30 });
  seedAsk({ askId: "ask_recent_1", partyKey: "tp_recent_1", chatId: 6102, hoursAgo: 2 });
  const before = sent.length;
  const r = await call("/os/agent/chat", { officeId: OFFICE_A, message: "تابع العملاء اللي ما ردوا" }, OWNER_A);
  assert.equal(r.body.action.tool, "follow_up_silent");
  assert.deepEqual(r.body.action.askIds, ["ask_silent_1"], "a question asked 2 hours ago is not «silent»");
  assert.equal(sent.length, before, "nothing is sent before the press");
  assert.equal((await call("/os/agent/act", { officeId: OFFICE_A, tool: "follow_up_silent", askIds: ["ask_silent_1"] }, OWNER_B)).status, 403, "another office cannot press it");
  const pressed = await call("/os/agent/act", { officeId: OFFICE_A, tool: "follow_up_silent", askIds: r.body.action.askIds }, OWNER_A);
  assert.equal(pressed.body.sent, 1);
  const reminder = lastTo(6101);
  assert.match(reminder.text, /تذكير لطيف/);
  assert.ok(reminder.reply_markup.inline_keyboard.flat().some((b) => String(b.callback_data).startsWith("ask:")), "the same question's buttons");
  const again = await call("/os/agent/act", { officeId: OFFICE_A, tool: "follow_up_silent", askIds: r.body.action.askIds }, OWNER_A);
  assert.equal(again.body.sent, 0, "one reminder only");
  assert.equal(lastTo(6102), undefined);
});

test("«رتب المعاينات» / «ليش توقفت» / «جهز ملخص المفاوضة» from the office's own deals; suggestions are counts only", async () => {
  const now = Date.now();
  const base = { officeId: OFFICE_A, status: "ACTIVE", offerSummary: { propertyType: "أرض", district: "العزيزية", price: 750000 }, requestSummary: { district: "العزيزية", price: 700000 } };
  h.store.seed(`offices/${OFFICE_A}/journeys/jv_one`, { ...base, journeyId: "jv_one", stage: "VIEWING", viewing: { state: "ACCEPTED", at: new Date(now + 26 * 3600000).toISOString() }, lastEvent: { at: new Date(now).toISOString(), text: "قبول الموعد" } });
  h.store.seed(`offices/${OFFICE_A}/journeys/jv_two`, { ...base, journeyId: "jv_two", stage: "VIEWING", offerSummary: { ...base.offerSummary, district: "قباء" }, viewing: { state: "CONFIRMED", at: new Date(now + 27 * 3600000).toISOString() }, lastEvent: { at: new Date(now).toISOString() } });
  h.store.seed(`offices/${OFFICE_A}/journeys/jv_stuck`, { ...base, journeyId: "jv_stuck", stage: "NEGOTIATION", offerSummary: { ...base.offerSummary, district: "الخالدية" }, lastProposal: { label: "مقترح سعر", fields: { price: 720000 } }, lastProposalAt: new Date(now - 6 * 86400000).toISOString(), lastReplies: { client: { label: "سعر مقابل", at: new Date(now - 5 * 86400000).toISOString() } }, currentAction: { code: "REVIEW_REPLY", label: "مراجعة الرد" }, lastEvent: { at: new Date(now - 5 * 86400000).toISOString(), text: "وصل رد" } });
  const plan = await call("/os/agent/chat", { officeId: OFFICE_A, message: "رتب المعاينات" }, OWNER_A);
  assert.deepEqual(plan.body.items.map((i) => i.id), ["jv_one", "jv_two"]);
  assert.match(plan.body.items[0].sub, /غير مؤكد/);
  assert.match(plan.body.reply, /1 غير مؤكدة/);
  const why = await call("/os/agent/chat", { officeId: OFFICE_A, message: "ليش توقفت صفقة الخالدية؟" }, OWNER_A);
  assert.deepEqual(why.body.items.map((i) => i.id), ["jv_stuck"]);
  assert.match(why.body.items[0].sub, /وصل رد ولم يُراجع منذ 5 يوم/);
  const summary = await call("/os/agent/chat", { officeId: OFFICE_A, message: "جهز ملخص المفاوضة في أرض الخالدية" }, OWNER_A);
  assert.match(summary.body.reply, /720,000/);
  assert.match(summary.body.reply, /رد العميل: سعر مقابل/);
  assert.doesNotMatch(summary.body.reply, /تم الاتفاق|تم البيع/);
  const s = await call("/os/agent/suggestions", { officeId: OFFICE_A }, OWNER_A);
  const ids = s.body.suggestions.map((x) => x.id);
  assert.ok(ids.includes("viewings") && ids.includes("stuck"), JSON.stringify(s.body));
  const b = await call("/os/agent/suggestions", { officeId: OFFICE_B }, OWNER_B);
  assert.deepEqual(b.body.suggestions, [], "office B's manager is off and sees nothing of A");
});

// ------------------------------------------------------------------ «دخول بتيليجرام»

function signed(fields) {
  const secret = createHash("sha256").update(BOT_TOKEN).digest();
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  return { ...fields, hash: createHmac("sha256", secret).update(check).digest("hex") };
}

test("«دخول بتيليجرام»: the Worker checks Telegram's signature and age; a valid one links the broker's alerts", async () => {
  const status = await call("/os/channels/status", { officeId: OFFICE_A }, OWNER_A);
  if (status.status === 200 && status.body.bot) assert.equal(status.body.bot.loginBotId, "987654321");
  const fresh = String(Math.floor(Date.now() / 1000) - 60);
  const forged = { ...signed({ id: "7301", first_name: "سعد", auth_date: fresh }), first_name: "غيره" };
  assert.equal((await call("/os/bot/broker/telegram-login", { officeId: OFFICE_A, auth: forged }, OWNER_A)).status, 400);
  const old = signed({ id: "7301", first_name: "سعد", auth_date: String(Math.floor(Date.now() / 1000) - 3 * 86400) });
  assert.equal((await call("/os/bot/broker/telegram-login", { officeId: OFFICE_A, auth: old }, OWNER_A)).status, 400);
  refuseWritesTo = "7302";
  const blocked = await call("/os/bot/broker/telegram-login", { officeId: OFFICE_A, auth: signed({ id: "7302", first_name: "سعد", auth_date: fresh }) }, OWNER_A);
  assert.equal(blocked.body.reason, "bot_cannot_write");
  assert.match(blocked.body.deepLink, /^https:\/\/t\.me\/iaqar_test_bot\?start=/, "the one-time link stays as the other way");
  refuseWritesTo = "";
  const ok = await call("/os/bot/broker/telegram-login", { officeId: OFFICE_A, auth: signed({ id: "7301", first_name: "سعد", auth_date: fresh }) }, OWNER_A);
  assert.equal(ok.body.linked, true, JSON.stringify(ok.body));
  const replay = await call("/os/bot/broker/telegram-login", { officeId: OFFICE_A, auth: signed({ id: "7301", first_name: "سعد", auth_date: fresh }) }, OWNER_A);
  assert.equal(replay.status, 409, "each signed result links once");
  const link = h.store.list("telegramBrokers").find((x) => x.uid === OWNER_A && x.officeId === OFFICE_A);
  assert.equal(link.chatId, "7301");
  assert.equal(link.status, "ACTIVE");
  assert.ok(!JSON.stringify(ok.body).includes(BOT_TOKEN.split(":")[1]), "the token never reaches a response");
});

// ------------------------------------------------------------------ the office's validity settings

test("validity settings: the office default applies to a new record that chose none; limits are enforced", async () => {
  const saved = await call("/os/agent/settings", { officeId: OFFICE_A, validity: { defaultDuration: "WEEK", periodicDays: 500, remindBeforeDays: 2 } }, OWNER_A);
  assert.equal(saved.body.validity.defaultDuration, "WEEK");
  assert.equal(saved.body.validity.periodicDays, 90);
  assert.equal((await call("/os/agent/settings", { officeId: OFFICE_A, validity: { defaultDuration: "QUARTER" } }, OWNER_B)).status, 403, "another office cannot change it");
  const r = await call("/os/records/save", { officeId: OFFICE_A, requestKey: "vis-validity-1", record: {
    kind: "OFFER", purpose: "SALE", propertyType: "أرض", city: "المدينة المنورة", district: "شوران", price: 650000, contactName: "مالك", contactPhone: "0556799001"
  } }, OWNER_A);
  const record = h.store.get(`offices/${OFFICE_A}/opportunities/${r.body.recordId}`);
  assert.equal(record.validityDuration, "WEEK");
  const days = (new Date(record.validityExpiresAt) - Date.now()) / 86400000;
  assert.ok(days > 6 && days <= 8, String(days));
  const other = await call("/os/records/save", { officeId: OFFICE_B, requestKey: "vis-validity-2", record: {
    kind: "OFFER", purpose: "SALE", propertyType: "أرض", city: "المدينة المنورة", district: "شوران", price: 650000, contactName: "مالك", contactPhone: "0556799002"
  } }, OWNER_B);
  assert.equal(h.store.get(`offices/${OFFICE_B}/opportunities/${other.body.recordId}`).validityDuration, "MONTH", "office B keeps the platform default");
});

test("the office's public page: the owner's chosen duration is kept; none chosen → the office default; an older page → unchanged", async () => {
  const seedIntake = (id, extra) => h.store.seed(`offices/${OFFICE_A}/publicIntake/${id}`, {
    officeId: OFFICE_A, kind: "owner", name: "مالك من الصفحة", phone: extra.phone, propertyType: "أرض", district: "سلطانة", city: "المدينة المنورة",
    purpose: "SALE", transactionType: "sale", amount: 610000, details: "", mediaPaths: [], imageCount: 0, hasVideo: false, source: "office_public_link", status: "new", ...extra
  });
  const run = async (id) => {
    const r = await call("/pipeline/public-intake", { officeId: OFFICE_A, intakeId: id });
    assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
    return h.store.get(`offices/${OFFICE_A}/opportunities/${r.body.opportunityId}`);
  };
  seedIntake("intakeVal01", { phone: "0556788001", validityDuration: "QUARTER", validityUrgent: true });
  const chosen = await run("intakeVal01");
  assert.equal(chosen.validityDuration, "QUARTER");
  assert.equal(chosen.validityUrgent, true);
  seedIntake("intakeVal02", { phone: "0556788002", validityDuration: "", validityUrgent: false });
  assert.equal((await run("intakeVal02")).validityDuration, "WEEK", "the office's default (set above)");
  seedIntake("intakeVal03", { phone: "0556788003" });
  assert.equal((await run("intakeVal03")).validityDuration ?? null, null, "an older page's intake gets no invented dates");
});

test("review fixes: old buttons do nothing; a non-Saudi number is told clearly; updates out of order are both handled", async () => {
  const chat = 5505;
  await says(chat, `/start of_${OFFICE_A}`);
  await press(chat, "vp:CLIENT");
  const stale = await press(chat, "vk:OFFER");
  assert.equal(stale.body.reason, "stale_button", "a client's request cannot be turned into an offer by an old button");
  const early = await press(chat, "vc:SAVE");
  assert.equal(early.body.reason, "stale_button");
  // Two messages delivered in parallel/reversed: the lower id is not dropped as a «duplicate».
  const later = await telegram(msg(chat, { text: "فيلا" }), 99010);
  const earlier = await telegram(msg(chat, { text: "شراء" }), 99009);
  assert.notEqual(later.body.duplicate, true);
  assert.notEqual(earlier.body.duplicate, true);
  for (const answer of ["حي النرجس", "الرياض", "2000000"]) await says(chat, answer);
  const foreign = await shares(chat, "+201001234567");
  assert.equal(foreign.body.phone, "not_saudi");
  assert.match(lastTo(chat).text, /أرقام الجوال السعودية/);
});

test("review fixes: a started conversation does not hold a linked side's messages forever, and «إيقاف» stays a side command", async () => {
  const chat = 5101; // linked as a side of office A since the first transaction
  await press(chat, "vn:NEW"); // back at the persona buttons
  const stop = await says(chat, "إيقاف");
  assert.equal(stop.body.command, "stop", "the side's stop word is not taken by the office manager");
  await says(chat, "تشغيل");
  // An hour later the unanswered persona question no longer captures his messages: they reach the office as a side's message.
  h.store.patch(`telegramVisitors/${chat}`, { updatedAt: new Date(Date.now() - 3600000) });
  const later = await says(chat, "متى موعد المعاينة؟");
  assert.equal(later.body.forwarded, 1, JSON.stringify(later.body));
});

test("review fixes: a reminder is not used up when it cannot be delivered (side stopped the bot), nor sent about a sold offer", async () => {
  seedAsk({ askId: "ask_silent_2", partyKey: "tp_silent_2", chatId: 6201, hoursAgo: 40 });
  h.store.patch("telegramParties/tp_silent_2", { status: "STOPPED" });
  const r = await call("/os/agent/act", { officeId: OFFICE_A, tool: "follow_up_silent", askIds: ["ask_silent_2"] }, OWNER_A);
  assert.equal(r.body.sent, 0);
  assert.ok(!h.store.get(`offices/${OFFICE_A}/matchAsks/ask_silent_2`).client.remindedAt, "still remindable once the side is back");
  h.store.patch("telegramParties/tp_silent_2", { status: "ACTIVE" });
  const ask = h.store.get(`offices/${OFFICE_A}/matchAsks/ask_silent_2`);
  h.store.patch(`offices/${OFFICE_A}/opportunities/${ask.offerId}`, { availabilityStatus: "SOLD" });
  const sold = await call("/os/agent/act", { officeId: OFFICE_A, tool: "follow_up_silent", askIds: ["ask_silent_2"] }, OWNER_A);
  assert.equal(sold.body.sent, 0, "never reminded about an offer that is no longer available");
  h.store.patch(`offices/${OFFICE_A}/opportunities/${ask.offerId}`, { availabilityStatus: "AVAILABLE" });
});
