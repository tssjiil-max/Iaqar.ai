// «مركز التواصل والدعم» — platform support through Telegram Business: the assistant answers only
// the written topics, hands a chat to the support manager (and stays silent there until he hands it
// back), turns problems into tickets, and never touches the intake bot or any office's data.
// Through the real Worker on the in-memory Firestore double; Telegram itself is a double here.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  SUPPORT_FAQ, SUPPORT_INTENT, SUPPORT_MODE, SUPPORT_TEXT, TICKET_KIND, classifySupportMessage, planSupportReply, supportCardView, supportUsername, validateOfficeTicket
} from "../public/os/domain/support-domain.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B, BROKER_A2 } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());

const SUPPORT_SECRET = "support-secret-for-tests-000";
const SUPPORT_TOKEN = "555666777:SUPPORT-TOKEN-never-in-a-response-0000"; // pragma: allowlist secret
const INTAKE_TOKEN = "123456789:INTAKE-TOKEN-must-never-be-used-here-00"; // pragma: allowlist secret
Object.assign(h.env, {
  TELEGRAM_SUPPORT_BOT_TOKEN: SUPPORT_TOKEN, TELEGRAM_SUPPORT_WEBHOOK_SECRET: SUPPORT_SECRET, SUPPORT_TELEGRAM_BUSINESS_USERNAME: "@iaqar_support",
  TELEGRAM_BOT_TOKEN: INTAKE_TOKEN, TELEGRAM_WEBHOOK_SECRET: "intake-secret-000000", TELEGRAM_BOT_USERNAME: "iaqar_intake_bot"
});

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (!String(url).startsWith("https://api.telegram.org/")) return realFetch(input, init);
  assert.ok(String(url).includes(`/bot${SUPPORT_TOKEN}/`), "only the SUPPORT bot's token is used by the support line");
  assert.ok(!String(url).includes(INTAKE_TOKEN), "the intake bot is never called");
  const method = String(url).split("/").pop();
  sent.push({ method, ...JSON.parse(init.body || "{}") });
  return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200 });
};
test.after(() => { globalThis.fetch = realFetch; });

async function call(route, body, uid) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
let updateId = 1;
async function support(update, { secret = SUPPORT_SECRET } = {}) {
  const headers = { "content-type": "application/json" };
  if (secret) headers["x-telegram-bot-api-secret-token"] = secret;
  const response = await h.worker.fetch(new Request("https://worker.test/telegram/support/webhook", { method: "POST", headers, body: JSON.stringify({ update_id: ++updateId, ...update }) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const OWNER_ID = 4242; const OWNER_CHAT = 4242; const CONN = "bc_conn_1";
const customer = (chatId, text) => support({ business_message: { message_id: updateId, business_connection_id: CONN, chat: { id: chatId, type: "private" }, from: { id: chatId, first_name: "عميل" }, text } });
const ownerWrites = (chatId, text) => support({ business_message: { message_id: updateId, business_connection_id: CONN, chat: { id: chatId, type: "private" }, from: { id: OWNER_ID, first_name: "المسؤول" }, text } });
const repliesTo = (chatId) => sent.filter((m) => m.method === "sendMessage" && String(m.chat_id) === String(chatId) && m.business_connection_id === CONN);
const alerts = () => sent.filter((m) => m.method === "sendMessage" && String(m.chat_id) === String(OWNER_CHAT) && !m.business_connection_id);

// ------------------------------------------------------------------ pure rules

test("the assistant understands only what is written: a person on request, problems, the listed topics, greetings", () => {
  assert.equal(classifySupportMessage("ابغى اكلم مسؤول").intent, SUPPORT_INTENT.HUMAN);
  assert.equal(classifySupportMessage("عندي مشكلة").intent, SUPPORT_INTENT.PROBLEM);
  assert.equal(classifySupportMessage("كيف أضيف طلب جديد؟").intent, SUPPORT_INTENT.FAQ);
  assert.equal(classifySupportMessage("كيف أربط واتساب الأعمال").faqId, "whatsapp_link");
  assert.equal(classifySupportMessage("السلام عليكم").intent, SUPPORT_INTENT.GREETING);
  assert.equal(classifySupportMessage("كم سعر الاشتراك السنوي").intent, SUPPORT_INTENT.UNKNOWN, "no price is invented");
  // Asking for a person always wins, even inside a problem.
  assert.equal(classifySupportMessage("عندي مشكلة وابي اكلم موظف").intent, SUPPORT_INTENT.HUMAN);
});

test("a chat in HUMAN mode gets nothing from the assistant; unknown twice hands over instead of looping", () => {
  assert.equal(planSupportReply("كيف أضيف عرض", { mode: SUPPORT_MODE.HUMAN }).silent, true);
  const first = planSupportReply("ششش");
  assert.equal(first.reply, SUPPORT_TEXT.unknownOnce);
  const second = planSupportReply("ششش", first);
  assert.equal(second.mode, SUPPORT_MODE.HUMAN);
  assert.equal(second.alertOwner, true);
  // A short problem asks for details; the details become a report ticket.
  const ask = planSupportReply("في مشكلة");
  assert.equal(ask.awaitingDetails, true);
  const report = planSupportReply("لما أضغط ربط واتساب تطلع رسالة لم تصل بيانات الحساب", ask);
  assert.deepEqual(report.ticket, { kind: TICKET_KIND.REPORT, needsAdmin: true });
});

test("every written answer points to a screen of the office app; none promises a price or a legal opinion", () => {
  for (const item of SUPPORT_FAQ) assert.doesNotMatch(item.answer, /ريال|سعر الاشتراك|قانون|نظامي/);
});

test("the office card shows only real states", () => {
  const empty = supportCardView({});
  assert.deepEqual(empty.channels, []);
  assert.equal(empty.telegramBusiness, null);
  assert.equal(empty.assistantActive, false);
  const full = supportCardView({ channels: [{ id: "whatsapp", state: "CONNECTED" }, { id: "telegram", state: "DISCONNECTED" }], support: { telegramBusiness: { username: "iaqar_support" }, assistant: { active: true } } });
  assert.deepEqual(full.channels.map((c) => c.id), ["whatsapp"]);
  assert.equal(full.telegramBusiness.url, "https://t.me/iaqar_support");
  assert.equal(full.assistantActive, true);
  // No account → no assistant line, even if something says active.
  assert.equal(supportCardView({ support: { assistant: { active: true } } }).assistantActive, false);
  assert.equal(supportUsername("https://t.me/iaqar_support"), "iaqar_support");
  assert.equal(supportUsername("bad name!"), "");
  assert.equal(validateOfficeTicket({ text: "قص" }).ok, false);
});

// ------------------------------------------------------------------ through the Worker

test("the support address refuses an unsigned or wrongly signed call before reading anything", async () => {
  assert.equal((await support({}, { secret: "" })).status, 401);
  assert.equal((await support({}, { secret: "wrong-secret-0000000000" })).status, 401);
  const ok = await support({});
  assert.equal(ok.status, 200);
  assert.equal(ok.body.reason, "unsupported_update");
});

test("before the business account links the bot, customer messages are ignored and nothing is sent", async () => {
  const before = sent.length;
  const r = await customer(7001, "السلام عليكم");
  assert.equal(r.body.reason, "connection_not_enabled");
  assert.equal(sent.length, before);
});

test("linking: the account owner is told, and the office card shows the assistant", async () => {
  const linked = await support({ business_connection: { id: CONN, user: { id: OWNER_ID, first_name: "المسؤول" }, user_chat_id: OWNER_CHAT, date: 1, rights: { can_reply: true }, is_enabled: true } });
  assert.equal(linked.body.connection, "enabled");
  assert.equal(alerts().at(-1).text, SUPPORT_TEXT.connected);
  const status = await call("/os/support/status", { officeId: OFFICE_A }, BROKER_A2);
  assert.equal(status.body.ok, true);
  assert.deepEqual(status.body.telegramBusiness, { username: "iaqar_support", available: true });
  assert.equal(status.body.assistant.active, true);
  assert.ok(!JSON.stringify(status.body).includes(SUPPORT_TOKEN) && !JSON.stringify(status.body).includes(SUPPORT_SECRET), "no secret reaches the browser");
});

test("the assistant answers a listed question on the account's behalf", async () => {
  const r = await customer(7001, "كيف أضيف عرض جديد؟");
  assert.equal(r.body.replied, true);
  const reply = repliesTo(7001).at(-1);
  assert.equal(reply.text, SUPPORT_FAQ.find((f) => f.id === "add_record").answer);
  assert.equal(reply.business_connection_id, CONN);
});

test("the assistant's own replies echoed back by Telegram never pause it", async () => {
  await customer(7010, "السلام عليكم");
  // Telegram echoes the bot's reply as a business message from the owner, marked with sender_business_bot.
  const echo = await support({ business_message: { message_id: updateId, business_connection_id: CONN, chat: { id: 7010, type: "private" }, from: { id: OWNER_ID }, sender_business_bot: { id: 555666777, is_bot: true }, text: SUPPORT_TEXT.welcome } });
  assert.equal(echo.body.reason, "own_reply");
  const next = await customer(7010, "كيف أضيف عرض جديد؟");
  assert.equal(next.body.replied, true, "still answering after its own echo");
});

test("while waiting for details, a listed question is answered and a greeting asks again (no empty tickets)", () => {
  const waiting = planSupportReply("في مشكلة");
  assert.equal(planSupportReply("السلام عليكم", waiting).reply, SUPPORT_TEXT.askDetails);
  assert.equal(planSupportReply("", waiting).ticket, null);
  const faq = planSupportReply("كيف أضيف عرض جديد", waiting);
  assert.equal(faq.ticket, null);
  assert.equal(faq.awaitingDetails, false);
});

test("asking for a person: handed over, a ticket, an alert with «إعادة الرد الآلي»; silent until the owner hands it back", async () => {
  const r = await customer(7002, "ابغى اكلم موظف لو سمحت");
  assert.equal(r.body.mode, SUPPORT_MODE.HUMAN);
  assert.ok(r.body.ticketRef);
  assert.equal(repliesTo(7002).at(-1).text, SUPPORT_TEXT.handedOver);
  const alert = alerts().at(-1);
  assert.match(alert.text, /تحويل للمسؤول/);
  const button = alert.reply_markup.inline_keyboard[0][0];
  assert.equal(button.text, SUPPORT_TEXT.ownerResumeButton);
  const tickets = h.store.list("supportTickets").filter((t) => t.chatId === "7002");
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].source, "telegram_business");

  const quiet = sent.length;
  const again = await customer(7002, "كيف أضيف عرض جديد؟");
  assert.equal(again.body.reason, "human_handling");
  assert.equal(sent.length, quiet, "nothing is sent while a person handles the chat");

  // Someone other than the owner cannot hand it back.
  const stranger = await support({ callback_query: { id: "cq1", from: { id: 999 }, data: button.callback_data } });
  assert.equal(stranger.body.reason, "not_the_owner");
  const resumed = await support({ callback_query: { id: "cq2", from: { id: OWNER_ID }, data: button.callback_data } });
  assert.equal(resumed.body.mode, SUPPORT_MODE.BOT);
  const back = await customer(7002, "كيف أضيف عرض جديد؟");
  assert.equal(back.body.replied, true);
});

test("the owner writing in a chat himself pauses the assistant there", async () => {
  await customer(7003, "السلام عليكم");
  const owner = await ownerWrites(7003, "أهلًا، معك المسؤول");
  assert.equal(owner.body.reason, "owner_replied");
  const before = sent.length;
  const later = await customer(7003, "كيف أربط تيليجرام");
  assert.equal(later.body.reason, "human_handling");
  assert.equal(sent.length, before);
});

test("a problem asks for details, then becomes a report the owner is alerted about", async () => {
  await customer(7004, "عندي مشكلة");
  assert.equal(repliesTo(7004).at(-1).text, SUPPORT_TEXT.askDetails);
  const r = await customer(7004, "الصفحة ما تفتح بعد تسجيل الدخول وتطلع رسالة تعذر تحميل الرسائل");
  assert.ok(r.body.ticketRef);
  assert.match(repliesTo(7004).at(-1).text, new RegExp(r.body.ticketRef));
  assert.equal(h.store.list("supportTickets").find((t) => t.chatId === "7004").kind, TICKET_KIND.REPORT);
});

test("unlinking the bot from the account stops every reply", async () => {
  await support({ business_connection: { id: CONN, user: { id: OWNER_ID }, user_chat_id: OWNER_CHAT, date: 2, rights: { can_reply: true }, is_enabled: false } });
  const before = sent.filter((m) => m.business_connection_id).length;
  const r = await customer(7005, "كيف أضيف عرض");
  assert.equal(r.body.reason, "connection_not_enabled");
  assert.equal(sent.filter((m) => m.business_connection_id).length, before);
  const status = await call("/os/support/status", { officeId: OFFICE_A }, OWNER_A);
  assert.equal(status.body.assistant.active, false);
  // Link again for the next tests.
  await support({ business_connection: { id: CONN, user: { id: OWNER_ID }, user_chat_id: OWNER_CHAT, date: 3, rights: { can_reply: true }, is_enabled: true } });
});

test("an office ticket from the app: stored with its office only, alerted to the support manager, limited per day", async () => {
  const bad = await call("/os/support/ticket", { officeId: OFFICE_A, kind: "QUESTION", text: "قص" }, BROKER_A2);
  assert.equal(bad.status, 400);
  const r = await call("/os/support/ticket", { officeId: OFFICE_A, kind: "REPORT", text: "زر المشاركة لا يعمل في صفحة العرض", needsAdmin: true }, BROKER_A2);
  assert.equal(r.body.ok, true);
  assert.ok(r.body.ticketRef);
  assert.equal(r.body.alerted, true);
  assert.match(alerts().at(-1).text, /يطلب تدخل المسؤول/);
  const stored = h.store.list("supportTickets").find((t) => t.source === "office_app");
  assert.equal(stored.officeId, OFFICE_A);
  assert.equal(stored.uid, BROKER_A2);
  // Nothing about it lands in another office, and no office collection is written.
  assert.equal(h.store.list(`offices/${OFFICE_B}/notifications`).length, 0);
  for (let i = 0; i < 4; i += 1) await call("/os/support/ticket", { officeId: OFFICE_A, kind: "QUESTION", text: `سؤال رقم ${i} عن المطابقة` }, BROKER_A2);
  const limited = await call("/os/support/ticket", { officeId: OFFICE_A, kind: "QUESTION", text: "سؤال إضافي بعد الحد" }, BROKER_A2);
  assert.equal(limited.status, 429);
  // A member of another office cannot write into office A.
  const foreign = await call("/os/support/ticket", { officeId: OFFICE_A, kind: "QUESTION", text: "محاولة من مكتب آخر" }, OWNER_B);
  assert.equal(foreign.status, 403);
});

test("wiring: separate bot, separate address; the intake bot's script and webhook are untouched", () => {
  const index = fs.readFileSync(path.join(ROOT, "worker/src/index.js"), "utf8");
  assert.match(index, /url\.pathname === "\/telegram\/support\/webhook"/);
  const script = fs.readFileSync(path.join(ROOT, "scripts/staging-telegram-support-activate.mjs"), "utf8");
  assert.match(script, /TELEGRAM_SUPPORT_BOT_TOKEN/);
  assert.match(script, /must be a different bot from the intake bot/);
  const deploy = fs.readFileSync(path.join(ROOT, "scripts/deploy-staging.sh"), "utf8");
  assert.match(deploy, /staging-telegram-support-activate\.mjs register/);
  const rules = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8");
  for (const name of ["supportConnections", "supportChats", "supportTickets", "supportSettings", "supportRate", "supportResume"]) {
    assert.match(rules, new RegExp(`match /${name}/\\{\\w+\\} \\{\\n\\s+allow read, write: if false;`));
  }
});

test("support activation script: Staging address only, stable secret, never the intake bot", async () => {
  const { prepare, stagingSupportWebhookUrl, supportSecretFor } = await import(path.join(ROOT, "scripts/staging-telegram-support-activate.mjs"));
  assert.equal(stagingSupportWebhookUrl("https://iaqar-intake-staging.iaqar-ai.workers.dev"), "https://iaqar-intake-staging.iaqar-ai.workers.dev/telegram/support/webhook");
  assert.throws(() => stagingSupportWebhookUrl("https://iaqar-intake.iaqar-ai.workers.dev"), /not the Staging Worker/);
  assert.equal(supportSecretFor(SUPPORT_TOKEN), supportSecretFor(SUPPORT_TOKEN));
  assert.notEqual(supportSecretFor(SUPPORT_TOKEN), supportSecretFor(INTAKE_TOKEN));
  await assert.rejects(prepare({ env: { TELEGRAM_SUPPORT_BOT_TOKEN: INTAKE_TOKEN, TELEGRAM_BOT_TOKEN: INTAKE_TOKEN }, dir: "/nonexistent", fetchImpl: async () => { throw new Error("must not call Telegram"); }, log: () => {} }), /different bot from the intake bot/);
});
