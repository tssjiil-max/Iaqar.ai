// Office OS — channels: each office links its own WhatsApp / Telegram, the link decides which
// office a message belongs to, and not every message becomes a record. Through the real Worker
// on the in-memory Firestore double.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  LINK_STATE, embeddedSignupOptions, isLinkCode, parseStartCommand, signupDataFromEvent, telegramDeepLink, telegramLinkView, whatsappLinkView
} from "../public/os/domain/channel-link-domain.js";
import { MESSAGE_CLASS, classifyInboundMessage, countByClass, filterInbox, inboxItemView } from "../public/os/domain/message-class-domain.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B, BROKER_A2 } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());

const SECRET = "tg-secret-for-tests";
const BOT_TOKEN = "123456:TEST-TOKEN-never-in-a-response";

async function call(route, body, uid) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
let updateId = 5000;
async function telegram(update, { secret = SECRET, route = "/telegram/webhook" } = {}) {
  const headers = { "content-type": "application/json" };
  if (secret) headers["x-telegram-bot-api-secret-token"] = secret;
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers, body: JSON.stringify({ update_id: ++updateId, ...update }) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const message = (chatId, text, extra = {}) => ({ message: { message_id: updateId + 1, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: "private", first_name: "سلطان" }, from: { id: chatId, first_name: "سلطان", username: "sultan_office" }, text, ...extra } });
const inbox = (office) => h.store.list(`offices/${office}/inbox`);
const channel = (payload, id) => payload.body.channels.find((item) => item.id === id);
const codeOf = (deepLink) => new URL(deepLink).searchParams.get("start");

// ------------------------------------------------------------------ pure rules

test("link rules: codes, deep link, start command", () => {
  const code = "A".repeat(43);
  assert.equal(isLinkCode(code), true);
  assert.equal(isLinkCode("short"), false);
  assert.equal(telegramDeepLink("@iaqar_bot", code), `https://t.me/iaqar_bot?start=${code}`);
  assert.equal(telegramDeepLink("bad name", code), "", "an invalid bot name never produces a link");
  assert.equal(parseStartCommand(`/start ${code}`), code);
  assert.equal(parseStartCommand(`/start@iaqar_bot ${code}`), code);
  assert.equal(parseStartCommand("/start"), "");
  assert.equal(parseStartCommand(`hello /start ${code}`), "");
});

test("the four link states are shown honestly, with the right actions", () => {
  const now = new Date("2026-10-05T10:00:00Z");
  const on = { configured: true, botUsername: "iaqar_bot" };
  assert.deepEqual(telegramLinkView({}, on, now).actions, ["connect"]);
  assert.equal(telegramLinkView({}, on, now).stateLabel, "غير مرتبط");
  const pending = telegramLinkView({ status: "PENDING", pendingExpiresAt: "2026-10-05T10:10:00Z" }, on, now);
  assert.equal(pending.state, LINK_STATE.PENDING);
  const expired = telegramLinkView({ status: "PENDING", pendingExpiresAt: "2026-10-05T09:00:00Z" }, on, now);
  assert.equal(expired.state, LINK_STATE.DISCONNECTED);
  assert.match(expired.detail, /انتهت صلاحية/);
  const connected = telegramLinkView({ status: "CONNECTED", chatId: "987654321", chatTitle: "مكتب سلطان" }, on, now);
  assert.equal(connected.stateLabel, "مرتبط");
  assert.deepEqual(connected.actions, ["reconnect", "disconnect"]);
  assert.ok(!connected.detail.includes("987654321"), "the chat id is masked");
  const error = telegramLinkView({ status: "ERROR", lastError: "هذه المحادثة مرتبطة بمكتب آخر." }, on, now);
  assert.equal(error.stateLabel, "خطأ في الربط");
  assert.deepEqual(error.actions, ["reconnect"]);
  const off = telegramLinkView({}, { configured: false }, now);
  assert.deepEqual(off.actions, [], "no button pretends to work when the bot is not set up");
  assert.match(off.note, /غير مفعّل/);

  const wa = whatsappLinkView({ status: "connected", displayPhoneNumber: "+966 55 123 4567", phoneNumberId: "1", lastInboundAt: "2026-10-05T09:00:00Z" }, { signupEnabled: true, webhookReady: true }, { inboundMessages: 4 });
  assert.equal(wa.state, LINK_STATE.CONNECTED);
  assert.ok(wa.number.endsWith("4567") && !wa.number.includes("123"), "the number is masked");
  assert.deepEqual(wa.actions, ["reconnect", "disconnect"]);
  assert.equal(wa.inboundToday, 4);
  assert.match(wa.webhookLabel, /يعمل/);
  assert.equal(wa.onboardingMode, "coexistence");
  const waOff = whatsappLinkView({}, { signupEnabled: false, webhookReady: false });
  assert.deepEqual(waOff.actions, []);
  assert.match(waOff.note, /غير مفعّل/);
  assert.match(waOff.webhookLabel, /غير مهيأ/);
});

test("WhatsApp signup keeps the number on the WhatsApp Business app by default (coexistence)", () => {
  const options = embeddedSignupOptions({ configId: "cfg-1" });
  assert.equal(options.config_id, "cfg-1");
  assert.equal(options.response_type, "code");
  assert.equal(options.extras.featureType, "whatsapp_business_app_onboarding");
  assert.equal(embeddedSignupOptions({ configId: "cfg-1", onboardingMode: "standard" }).extras.featureType, undefined);
  assert.deepEqual(signupDataFromEvent({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", data: { waba_id: "111", phone_number_id: "222" } }), { wabaId: "111", phoneNumberId: "222", event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" });
  assert.equal(signupDataFromEvent({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: {} }), null);
  assert.equal(signupDataFromEvent({ type: "OTHER" }), null);
});

test("message classes: only clear non-property messages are kept out of the records", () => {
  const cls = (text) => classifyInboundMessage(text).messageClass;
  assert.equal(cls("السلام عليكم ورحمة الله وبركاته"), MESSAGE_CLASS.SOCIAL);
  assert.equal(cls("صباح الخير يا أبو محمد"), MESSAGE_CLASS.SOCIAL);
  assert.equal(cls("صباح الخير عندك شي جديد"), MESSAGE_CLASS.UNKNOWN, "a greeting followed by anything else is not social");
  assert.equal(cls("تمام شكراً 🙏"), MESSAGE_CLASS.SOCIAL);
  assert.equal(cls("هل الشقة متوفرة؟"), MESSAGE_CLASS.INQUIRY);
  assert.equal(cls("كم السعر؟"), MESSAGE_CLASS.INQUIRY);
  assert.equal(cls("تم تحويل العربون"), MESSAGE_CLASS.DEAL);
  assert.equal(cls("الموعد بكرة الساعة 5"), MESSAGE_CLASS.DEAL);
  assert.equal(cls("للبيع فيلا في حي النرجس مساحة 400 متر السعر 2.4 مليون"), MESSAGE_CLASS.OFFER);
  assert.equal(cls("السلام عليكم، عندي فيلا للبيع بحي الياسمين 3 مليون"), MESSAGE_CLASS.OFFER, "a greeting in front of an offer does not hide the offer");
  assert.equal(cls("مطلوب شقة للإيجار في الملقا بحدود 60 ألف"), MESSAGE_CLASS.REQUEST);
  assert.equal(cls("ابغى ارض في العارض 600 متر"), MESSAGE_CLASS.REQUEST);
  // Anything unclear keeps going through the usual processing — never dropped.
  for (const text of ["شقة 3 غرف النرجس 55000", "محمد", "ارض 600 متر", ""]) {
    const result = classifyInboundMessage(text);
    assert.equal(result.messageClass, MESSAGE_CLASS.UNKNOWN, text);
    assert.equal(result.autoConvert, true);
  }
  // Anything that names a property, a purpose, a place or a specification is always processed,
  // whatever else the message says (greeting in front, deal words, a question mark).
  for (const text of [
    "أرض بحي العارض إفراغ فوري", "فيلا دورين بحي الملقا الصك إلكتروني", "شقة تمليك التسليم فوري حي العزيزية",
    "دوبلكس جديد العزيزية الدفعه الاولى 50", "فلة درج صالة حي شوران البيع نقدا او بنك الافراغ فوري",
    "فيه شقة للايجار حي الملز 3 غرف", "محتاج دور ارضي للايجار؟", "لو سمحت شقة غرفتين وصالة بحي العزيزية ايجار سنوي",
    "ممكن شقة عوائل بحي الروضة غرفتين وصالة", "هل يوجد فيلا للبيع في حي الياسمين", "السلام عليكم محتاج استديو",
    "هلا روف جديد بالنرجس", "مساء الخير متوفر استديوهات مفروشه", "السلام عليكم ابو فهد عندك شي بالنرجس",
    "ملحق عزاب شهري 1500", "نبي فيلا درج داخلي", "هل الارض للبيع؟", "كم سعر الفيلا اللي بالنرجس؟"
  ]) assert.equal(classifyInboundMessage(text).autoConvert, true, text);
  assert.equal(classifyInboundMessage("كم السعر؟").autoConvert, false);
  assert.equal(classifyInboundMessage("مطلوب شقة للإيجار").autoConvert, true);

  const views = [
    inboxItemView({ id: "1", channel: "telegram", messageText: "السلام عليكم", messageClass: "SOCIAL", processingState: "kept", senderName: "خالد" }),
    inboxItemView({ id: "2", source: "whatsapp_cloud_api", messageText: "للبيع فيلا", processingState: "processed", opportunityId: "opp1", senderPhone: "966551234567" }),
    inboxItemView({ id: "3", channel: "whatsapp", messageText: "", processingState: "needs_media_adapter" })
  ];
  assert.equal(views[0].canConvert, true);
  assert.equal(views[0].channelLabel, "تيليجرام");
  assert.equal(views[1].canConvert, false, "already a record");
  assert.equal(views[1].sender, "••••4567", "a phone is masked in the list");
  assert.equal(views[1].messageClass, MESSAGE_CLASS.OFFER, "older messages are classified on the fly");
  assert.equal(views[2].canConvert, false, "nothing to convert without text");
  assert.equal(countByClass(views).SOCIAL, 1);
  assert.equal(filterInbox(views, "OFFER").length, 1);
});

// ------------------------------------------------------------------ Worker

test("status is honest before anything is configured, and carries no secret", async () => {
  const status = await call("/os/channels/status", { officeId: OFFICE_A }, OWNER_A);
  assert.equal(status.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.automationMode, "ASSISTED");
  assert.equal(status.body.outboundEnabled, false);
  const tg = channel(status, "telegram");
  const wa = channel(status, "whatsapp");
  assert.equal(tg.state, "DISCONNECTED");
  assert.deepEqual(tg.actions, []);
  assert.equal(wa.state, "DISCONNECTED");
  assert.deepEqual(wa.actions, []);
  assert.equal(wa.onboardingMode, "coexistence");
  const link = await call("/os/channels/telegram/link", { officeId: OFFICE_A }, OWNER_A);
  assert.equal(link.body.state, "NOT_CONFIGURED");
  assert.equal(link.body.deepLink, undefined);
  const hook = await telegram(message(1, "hi"));
  assert.equal(hook.status, 503, "the central webhook refuses to run without its secret");
  const outsider = await call("/os/channels/status", { officeId: OFFICE_A }, OWNER_B);
  assert.equal(outsider.status, 403, "another office cannot read this office's channels");
});

test("Telegram: a manager links the office's chat through the central bot with a one-time code", async () => {
  Object.assign(h.env, { TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_BOT_USERNAME: "iaqar_test_bot" });
  const broker = await call("/os/channels/telegram/link", { officeId: OFFICE_A }, BROKER_A2);
  assert.equal(broker.status, 403, "linking is the manager's");

  const link = await call("/os/channels/telegram/link", { officeId: OFFICE_A }, OWNER_A);
  assert.equal(link.status, 200, JSON.stringify(link.body));
  assert.equal(link.body.state, "PENDING");
  assert.match(link.body.deepLink, /^https:\/\/t\.me\/iaqar_test_bot\?start=[A-Za-z0-9_-]{43}$/);
  const code = codeOf(link.body.deepLink);
  const everything = JSON.stringify([h.store.list("telegramLinkCodes"), h.store.get(`telegramOfficeLinks/${OFFICE_A}`)]);
  assert.ok(!everything.includes(code), "only the hash of the code is stored");
  assert.ok(!JSON.stringify(link.body).includes(BOT_TOKEN) && !JSON.stringify(link.body).includes(SECRET));
  assert.equal(channel(await call("/os/channels/status", { officeId: OFFICE_A }, OWNER_A), "telegram").state, "PENDING");

  assert.equal((await telegram(message(700100, `/start ${code}`), { secret: "" })).status, 401);
  assert.equal((await telegram(message(700100, `/start ${code}`), { secret: "wrong" })).status, 401);
  assert.equal(channel(await call("/os/channels/status", { officeId: OFFICE_A }, OWNER_A), "telegram").state, "PENDING", "an unauthorised call changes nothing");

  const wrong = await telegram(message(700100, `/start ${"B".repeat(43)}`));
  assert.equal(wrong.body.linked, false);
  const done = await telegram(message(700100, `/start ${code}`));
  assert.equal(done.status, 200);
  assert.equal(done.body.linked, true);
  const chat = h.store.get("telegramChats/700100");
  assert.equal(chat.officeId, OFFICE_A);
  assert.equal(chat.status, "ACTIVE");
  const status = channel(await call("/os/channels/status", { officeId: OFFICE_A }, OWNER_A), "telegram");
  assert.equal(status.state, "CONNECTED");
  assert.equal(status.stateLabel, "مرتبط");
  assert.ok(!JSON.stringify(status).includes("700100"), "the chat id is not sent to the browser in full");

  const replay = await telegram(message(700200, `/start ${code}`));
  assert.equal(replay.body.linked, false, "a code works once");
  assert.equal(h.store.get("telegramChats/700200"), null);
  assert.ok(h.store.list(`offices/${OFFICE_A}/auditLogs`).some((entry) => entry.action === "CHANNEL_LINK_STARTED"));
});

test("Telegram: the linked chat decides the office — no cross-office delivery", async () => {
  const offer = await telegram(message(700100, "للبيع فيلا في حي النرجس بالرياض مساحة 400 متر السعر 2400000 ريال"));
  assert.equal(offer.status, 200, JSON.stringify(offer.body));
  assert.equal(offer.body.routedBy, "chat_link");
  const mine = inbox(OFFICE_A).filter((item) => item.channel === "telegram");
  assert.equal(mine.length, 1);
  assert.equal(mine[0].officeId, OFFICE_A);
  assert.equal(mine[0].messageClass, "OFFER");
  assert.equal(inbox(OFFICE_B).length, 0, "nothing lands in another office");

  const stranger = await telegram(message(999999, "للبيع شقة في حي الملقا 900000"));
  assert.equal(stranger.status, 200);
  assert.equal(stranger.body.ignored, true);
  assert.equal(stranger.body.reason, "chat_not_linked");
  assert.equal(inbox(OFFICE_A).filter((item) => item.channel === "telegram").length, 1);
  assert.equal(inbox(OFFICE_B).length, 0);

  // Office B tries to take over office A's chat: refused, shown as an error to office B, A keeps working.
  const linkB = await call("/os/channels/telegram/link", { officeId: OFFICE_B }, OWNER_B);
  const taken = await telegram(message(700100, `/start ${codeOf(linkB.body.deepLink)}`));
  assert.equal(taken.body.linked, false);
  assert.equal(taken.body.reason, "chat_linked_elsewhere");
  assert.equal(h.store.get("telegramChats/700100").officeId, OFFICE_A);
  const statusB = channel(await call("/os/channels/status", { officeId: OFFICE_B }, OWNER_B), "telegram");
  assert.equal(statusB.state, "ERROR");
  assert.match(statusB.detail, /مرتبطة بمكتب آخر/);
  assert.deepEqual(statusB.actions, ["reconnect"]);
});

test("Telegram: a greeting or a short question stays in the inbox and does not become a record", async () => {
  const before = h.store.list(`offices/${OFFICE_A}/opportunities`).length;
  const hello = await telegram(message(700100, "السلام عليكم ورحمة الله وبركاته"));
  assert.equal(hello.status, 200);
  assert.equal(hello.body.kept, true);
  assert.equal(hello.body.messageClass, "SOCIAL");
  const question = await telegram(message(700100, "هل الشقة متوفرة؟"));
  assert.equal(question.body.messageClass, "INQUIRY");
  const kept = inbox(OFFICE_A).filter((item) => item.processingState === "kept");
  assert.equal(kept.length, 2);
  assert.ok(kept.every((item) => !item.opportunityId && item.messageClassReason));
  assert.equal(h.store.list(`offices/${OFFICE_A}/opportunities`).length, before, "no record was created");

  // The broker decides it is worth a record after all.
  const other = await call("/os/inbox/convert", { officeId: OFFICE_B, inboxId: kept[0].id }, OWNER_B);
  assert.equal(other.status, 404, "another office cannot touch this message");
  const converted = await call("/os/inbox/convert", { officeId: OFFICE_A, inboxId: kept[0].id }, BROKER_A2);
  assert.equal(converted.status, 200, JSON.stringify(converted.body));
  const after = h.store.get(`offices/${OFFICE_A}/inbox/${kept[0].id}`);
  assert.notEqual(after.processingState, "kept");
  assert.ok(h.store.list(`offices/${OFFICE_A}/auditLogs`).some((entry) => entry.action === "INBOX_CONVERTED" && entry.entityId === kept[0].id));
  const again = await call("/os/inbox/convert", { officeId: OFFICE_A, inboxId: kept[0].id }, BROKER_A2);
  assert.ok(again.status === 409 || again.body.duplicate === true, "a message is converted once");
});

test("Telegram: reconnect moves the office to a new chat; disconnect stops delivery", async () => {
  const relink = await call("/os/channels/telegram/link", { officeId: OFFICE_A }, OWNER_A);
  const waiting = channel(await call("/os/channels/status", { officeId: OFFICE_A }, OWNER_A), "telegram");
  assert.equal(waiting.linkWaiting, true, "the screen knows a new link is waiting while the old chat still works");
  assert.equal(channel(await call("/os/channels/status", { officeId: OFFICE_A }, OWNER_A), "telegram").state, "CONNECTED", "the current chat keeps working until the new link is completed");
  const moved = await telegram(message(700300, `/start ${codeOf(relink.body.deepLink)}`));
  assert.equal(moved.body.linked, true);
  assert.equal(h.store.get("telegramChats/700100").status, "UNLINKED");
  assert.equal(h.store.get("telegramChats/700300").officeId, OFFICE_A);
  assert.equal(channel(await call("/os/channels/status", { officeId: OFFICE_A }, OWNER_A), "telegram").linkWaiting, false);
  // A legacy single-office pin on the per-office address does not break central routing.
  h.env.TELEGRAM_OFFICE_ID = OFFICE_B;
  const pinned = await telegram(message(700300, "للبيع عمارة في حي العليا بالرياض السعر 5200000 ريال"));
  delete h.env.TELEGRAM_OFFICE_ID;
  assert.equal(pinned.status, 200, JSON.stringify(pinned.body));
  assert.equal(pinned.body.officeId, OFFICE_A);
  assert.ok(h.store.get(`telegramOfficeLinks/${OFFICE_A}`).lastInboundAt, "last message time is stamped after a real delivery");
  assert.equal((await telegram(message(700100, "للبيع ارض في العارض 600 متر 1500000"))).body.reason, "chat_not_linked");

  assert.equal((await call("/os/channels/telegram/unlink", { officeId: OFFICE_A }, BROKER_A2)).status, 403);
  const off = await call("/os/channels/telegram/unlink", { officeId: OFFICE_A }, OWNER_A);
  assert.equal(off.body.changed, true);
  assert.equal(channel(await call("/os/channels/status", { officeId: OFFICE_A }, OWNER_A), "telegram").state, "DISCONNECTED");
  const count = inbox(OFFICE_A).length;
  assert.equal((await telegram(message(700300, "للبيع ارض في العارض 600 متر 1500000"))).body.reason, "chat_not_linked");
  assert.equal(inbox(OFFICE_A).length, count);
  assert.ok(h.store.list(`offices/${OFFICE_A}/auditLogs`).some((entry) => entry.action === "CHANNEL_UNLINKED"));
});

test("WhatsApp: the state comes from the server routing record, per office, and disconnect is the manager's", async () => {
  Object.assign(h.env, { META_APP_ID: "app-1", META_CONFIG_ID: "cfg-1", META_APP_SECRET: "meta-secret-never-in-a-response", META_WEBHOOK_VERIFY_TOKEN: "verify-1" });
  h.store.seed("whatsapp_accounts/pn_100", { officeId: OFFICE_A, wabaId: "waba_1", phoneNumberId: "pn_100", displayPhoneNumber: "+966 55 123 4567", status: "connected" });
  h.store.seed(`offices/${OFFICE_A}/integrations/whatsapp`, { officeId: OFFICE_A, phoneNumberId: "pn_100", displayPhoneNumber: "+966 55 123 4567", status: "connected" });
  // Office B points its own integration document at office A's number: it must not be believed.
  h.store.seed(`offices/${OFFICE_B}/integrations/whatsapp`, { officeId: OFFICE_B, phoneNumberId: "pn_100", displayPhoneNumber: "+966 55 123 4567", status: "connected" });

  const a = channel(await call("/os/channels/status", { officeId: OFFICE_A }, OWNER_A), "whatsapp");
  assert.equal(a.state, "CONNECTED");
  assert.ok(a.number.endsWith("4567") && !a.number.includes("123"));
  assert.deepEqual(a.actions, ["reconnect", "disconnect"]);
  assert.equal(a.webhookReady, true);
  const b = channel(await call("/os/channels/status", { officeId: OFFICE_B }, OWNER_B), "whatsapp");
  assert.equal(b.state, "DISCONNECTED");
  assert.equal(b.number, "");
  assert.deepEqual(b.actions, ["connect"]);
  const raw = JSON.stringify(await call("/os/channels/status", { officeId: OFFICE_A }, OWNER_A));
  assert.ok(!raw.includes("meta-secret") && !raw.includes("verify-1") && !raw.includes("waba_1") && !raw.includes("pn_100"));

  assert.equal((await call("/os/channels/whatsapp/disconnect", { officeId: OFFICE_B }, OWNER_B)).body.changed, false, "office B cannot switch off office A's number");
  assert.equal(h.store.get("whatsapp_accounts/pn_100").status, "connected");
  assert.equal((await call("/os/channels/whatsapp/disconnect", { officeId: OFFICE_A }, BROKER_A2)).status, 403);
  const off = await call("/os/channels/whatsapp/disconnect", { officeId: OFFICE_A }, OWNER_A);
  assert.equal(off.body.changed, true);
  assert.equal(h.store.get("whatsapp_accounts/pn_100").status, "disconnected", "the webhook routes only «connected» numbers");
  assert.equal(h.store.get("whatsapp_accounts/pn_100").wabaId, "waba_1", "nothing is deleted");
  assert.equal(channel(await call("/os/channels/status", { officeId: OFFICE_A }, OWNER_A), "whatsapp").state, "DISCONNECTED");

  const config = await h.worker.fetch(new Request(`https://worker.test/meta/config?officeId=${OFFICE_A}`), h.env, { waitUntil() {} });
  const body = await config.json();
  assert.equal(body.onboardingMode, "coexistence");
  assert.ok(!JSON.stringify(body).includes("meta-secret"));
});

test("the routing collections are closed to every client in the Firestore rules", () => {
  const rules = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8").replace(/\s+/g, " ");
  for (const name of ["whatsapp_accounts/{phoneNumberId}", "telegramChats/{chatId}", "telegramLinkCodes/{codeHash}", "telegramOfficeLinks/{officeId}"]) {
    assert.ok(rules.includes(`match /${name} { allow read, write: if false; }`), name);
  }
  // No channel secret or Meta app secret is referenced by anything served to the browser.
  const served = ["public/os/core/channels.js", "public/os/views/office-settings.js", "public/os/domain/channel-link-domain.js"].map((file) => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");
  assert.ok(!/APP_SECRET|BOT_TOKEN|WEBHOOK_SECRET|VERIFY_TOKEN|access_token/i.test(served));
});
