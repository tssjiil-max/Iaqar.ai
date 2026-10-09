// صلاحية العروض والطلبات والتأكد من التوفر — rules, the matching gate, the sweep, a side's answers.
// Through the real Worker on the in-memory Firestore double; Telegram is a double here.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  ANSWER, DURATION, STATE, availabilityFresh, availabilityIntent, customExpiry, isOpenForMatching, nextValidityStep, riyadhDayEnd, validityFields, validityState
} from "../public/os/domain/validity-domain.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());
const SECRET = "tg-secret-for-validity-tests";
const BOT_TOKEN = "123456789:VALIDITY-TOKEN-never-in-a-response-00"; // pragma: allowlist secret
Object.assign(h.env, { TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_BOT_USERNAME: "iaqar_test_bot", TELEGRAM_OUTBOUND: "enabled" });

const sent = [];
const realFetch = globalThis.fetch;
let messageSeq = 100;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (!String(url).startsWith("https://api.telegram.org/")) return realFetch(input, init);
  const method = String(url).split("/").pop();
  const payload = JSON.parse(init.body || "{}");
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
let updateId = 90000;
async function telegram(update) {
  const response = await h.worker.fetch(new Request("https://worker.test/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET }, body: JSON.stringify({ update_id: ++updateId, ...update }) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const says = (chatId, text) => telegram({ message: { message_id: updateId + 1, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: "private" }, from: { id: chatId, first_name: "طرف" }, text } });
const shares = (chatId, phone) => telegram({ message: { message_id: updateId + 1, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: "private" }, from: { id: chatId, first_name: "طرف" }, contact: { phone_number: phone, user_id: chatId, first_name: "طرف" } } });
const press = (chatId, data, from = chatId) => telegram({ callback_query: { id: `cq-${updateId}`, from: { id: from }, data, message: { message_id: 1, chat: { id: chatId, type: "private" }, text: "" } } });
const record = (id, office = OFFICE_A) => h.store.get(`offices/${office}/opportunities/${id}`);
const ops = () => h.store.list(`offices/${OFFICE_A}/operations`);
const matchesOf = () => h.store.list(`offices/${OFFICE_A}/matches`);
const lastTo = (chatId) => sent.filter((m) => m.method === "sendMessage" && String(m.chat_id) === String(chatId)).at(-1);

let seq = 0;
async function save(kind, district, extra = {}, uid = OWNER_A, office = OFFICE_A) {
  seq += 1;
  const phone = extra.contactPhone || `0556${String(100000 + seq).slice(-6)}`;
  const r = await call("/os/records/save", { officeId: office, requestKey: `val-${seq}`, record: {
    kind, purpose: kind === "OFFER" ? "SALE" : "PURCHASE", propertyType: "أرض", city: "المدينة المنورة", district, price: kind === "OFFER" ? 900000 : 950000,
    contactName: kind === "OFFER" ? "مالك" : "عميل", contactPhone: phone, ...extra
  } }, uid);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { id: r.body.recordId, phone };
}
async function linkParty(recordId, chatId, phone) {
  const link = await call("/os/bot/party/link", { officeId: OFFICE_A, recordId }, OWNER_A);
  assert.equal(link.status, 200, JSON.stringify(link.body));
  await says(chatId, `/start ${new URL(link.body.deepLink).searchParams.get("start")}`);
  const done = await shares(chatId, `+966${String(phone).slice(1)}`);
  assert.equal(done.body.linked, true, JSON.stringify(done.body));
}
const expire = (id) => h.store.patch(`offices/${OFFICE_A}/opportunities/${id}`, { validityExpiresAt: new Date(Date.now() - 3600000).toISOString() });

// ------------------------------------------------------------------ pure rules

test("durations: week/month/three months end at the END of the Riyadh day; custom must be future; urgency never shortens", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  const week = validityFields({ duration: DURATION.WEEK, now }).fields;
  assert.equal(week.validityExpiresAt, "2026-10-16T20:59:59.999Z", "23:59 Riyadh on the 16th");
  assert.equal(validityFields({ duration: DURATION.MONTH, urgent: true, now }).fields.validityExpiresAt, riyadhDayEnd(new Date(now.getTime() + 30 * 86400000)).toISOString());
  assert.equal(validityFields({ duration: DURATION.QUARTER, now }).fields.validityExpiresAt, riyadhDayEnd(new Date(now.getTime() + 90 * 86400000)).toISOString());
  assert.equal(customExpiry("2026-10-01", now), null, "past date refused");
  assert.equal(customExpiry("2026-13-40", now), null);
  assert.equal(validityFields({ duration: DURATION.CUSTOM, customDate: "2026-11-20", now }).fields.validityExpiresAt, "2026-11-20T20:59:59.999Z");
  const forever = validityFields({ duration: DURATION.UNTIL_CANCELLED, now }).fields;
  assert.equal(forever.validityExpiresAt, null);
  assert.ok(forever.validityNextCheckAt, "periodic confirmation scheduled");
  // On the expiry day itself the record is still active until midnight Riyadh.
  assert.equal(validityState(week, new Date("2026-10-16T20:00:00Z")), STATE.ACTIVE);
  assert.equal(validityState(week, new Date("2026-10-16T21:00:01Z")), STATE.EXPIRED);
});

test("the matching rule: only ACTIVE or older (no fields) records take part; sold, expired or awaiting confirmation do not", () => {
  const now = new Date();
  assert.equal(isOpenForMatching({}, now), true, "older records are not stopped in bulk");
  assert.equal(isOpenForMatching({ validityDuration: "WEEK", validityExpiresAt: new Date(now.getTime() - 1000).toISOString() }, now), false);
  assert.equal(isOpenForMatching({ validityDuration: "MONTH", validityExpiresAt: new Date(now.getTime() + 86400000).toISOString(), availabilityStatus: "SOLD" }, now), false);
  assert.equal(isOpenForMatching({ validityDuration: "UNTIL_CANCELLED", validityNextCheckAt: new Date(now.getTime() - 1000).toISOString() }, now), false);
  assert.equal(availabilityFresh({}, now), false, "no confirmation is never «fresh»");
});

test("one reminder 3 days before, one ask at expiry, one periodic ask — never twice for the same step", () => {
  const now = new Date("2026-10-09T10:00:00Z");
  const r = validityFields({ duration: DURATION.MONTH, now: new Date("2026-09-11T10:00:00Z") }).fields;
  const step = nextValidityStep(r, now);
  assert.equal(step.kind, "REMIND");
  assert.equal(nextValidityStep({ ...r, validityAskedFor: step.key }, now), null);
  const later = new Date("2026-10-12T10:00:00Z");
  assert.equal(nextValidityStep(r, later).kind, "CONFIRM_EXPIRED");
  // A one-week record does not get a «3 days before» reminder on top of its expiry ask… it does: 7 > 4.
  assert.equal(nextValidityStep(validityFields({ duration: DURATION.WEEK, now }).fields, new Date(now.getTime() + 5 * 86400000)).kind, "REMIND");
});

test("a side's own words — Saudi, Egyptian, English — are understood, and unclear words are not guessed", () => {
  assert.equal(availabilityIntent("الأرض انباعت الحمدلله"), ANSWER.SOLD);
  assert.equal(availabilityIntent("أجرنا الشقة"), ANSWER.RENTED);
  assert.equal(availabilityIntent("حصلت شقة خلاص"), ANSWER.FOUND);
  assert.equal(availabilityIntent("لسه موجودة"), ANSWER.AVAILABLE);
  assert.equal(availabilityIntent("ما زلت أدور"), ANSWER.STILL_LOOKING);
  assert.equal(availabilityIntent("Still available"), ANSWER.AVAILABLE);
  assert.equal(availabilityIntent("I found a property"), ANSWER.FOUND);
  assert.equal(availabilityIntent("وقف الإعلان أسبوعين"), ANSWER.PAUSE);
  assert.equal(availabilityIntent("غير متاح"), "", "unclear: sold or rented? not guessed");
  assert.equal(availabilityIntent("السلام عليكم"), "");
  assert.equal(availabilityIntent("فيه موقف سيارات؟"), "", "«موقف» is not «وقف»");
  assert.equal(availabilityIntent("عندكم متاجر؟"), "", "«متاجر» is not «تأجر»");
  assert.equal(availabilityIntent("حصلت على الرابط"), "");
});

// ------------------------------------------------------------------ through the Worker

test("saving: a chosen duration is kept; without one the announced month is applied and marked as not chosen; an edit keeps it", async () => {
  const urgent = await save("OFFER", "العزيزية", { validity: { urgent: true, duration: "WEEK" } });
  assert.equal(record(urgent.id).validityDuration, "WEEK");
  assert.equal(record(urgent.id).validityUrgent, true);
  assert.equal(record(urgent.id).validityDurationChosen, true);
  const plain = await save("REQUEST", "قباء");
  assert.equal(record(plain.id).validityDuration, "MONTH");
  assert.equal(record(plain.id).validityDurationChosen, false);
  const before = record(plain.id).validityExpiresAt;
  await call("/os/records/save", { officeId: OFFICE_A, recordId: plain.id, record: { kind: "REQUEST", purpose: "PURCHASE", propertyType: "أرض", city: "المدينة المنورة", district: "قباء", price: 990000, contactPhone: plain.phone } }, OWNER_A);
  assert.equal(record(plain.id).validityExpiresAt, before, "an edit without a new choice keeps the duration");
  // Only the urgency changed on an edit: the duration and the availability stay as they were.
  h.store.patch(`offices/${OFFICE_A}/opportunities/${urgent.id}`, { availabilityStatus: "SOLD" });
  const kept = record(urgent.id).validityExpiresAt;
  await call("/os/records/save", { officeId: OFFICE_A, recordId: urgent.id, record: { kind: "OFFER", purpose: "SALE", propertyType: "أرض", city: "المدينة المنورة", district: "العزيزية", price: 900000, contactPhone: urgent.phone, validity: { urgent: false, duration: "" } } }, OWNER_A);
  assert.equal(record(urgent.id).validityExpiresAt, kept);
  assert.equal(record(urgent.id).validityUrgent, false);
  assert.equal(record(urgent.id).availabilityStatus, "SOLD", "an edit never makes a sold record available again");
  const custom = await call("/os/records/save", { officeId: OFFICE_A, requestKey: "val-bad", record: { kind: "OFFER", purpose: "SALE", propertyType: "أرض", city: "المدينة المنورة", district: "سلطانة", price: 1, contactPhone: "0551111111", validity: { duration: "CUSTOM", customDate: "2020-01-01" } } }, OWNER_A);
  assert.equal(custom.status, 400);
});

test("an expired offer takes part in no new match; renewing the same record brings it back (no duplicate)", async () => {
  const offer = await save("OFFER", "الحرة الشرقية");
  await expire(offer.id);
  const req = await save("REQUEST", "الحرة الشرقية");
  assert.equal(matchesOf().filter((m) => m.offerId === offer.id && m.requestId === req.id && m.isCurrent !== false).length, 0, "no match with an expired offer");
  const count = h.store.list(`offices/${OFFICE_A}/opportunities`).length;
  const renewed = await call("/os/records/reactivate", { officeId: OFFICE_A, recordId: offer.id }, OWNER_A);
  assert.equal(renewed.body.state, STATE.ACTIVE);
  assert.equal(h.store.list(`offices/${OFFICE_A}/opportunities`).length, count, "same record, no copy");
  assert.ok(matchesOf().some((m) => m.offerId === offer.id && m.requestId === req.id && m.isCurrent !== false), "matching resumed");
});

test("sold: its open matches stop, the record is kept; inside an open deal the broker gets one task, the deal is untouched", async () => {
  const offer = await save("OFFER", "الخالدية");
  const req = await save("REQUEST", "الخالدية");
  const match = matchesOf().find((m) => m.offerId === offer.id && m.requestId === req.id && m.isCurrent !== false);
  assert.ok(match);
  const approved = await call("/os/review/decide", { officeId: OFFICE_A, matchId: match.id, decision: "approve" }, OWNER_A);
  const journeyId = approved.body.journeyId;
  const other = await save("REQUEST", "الخالدية", { price: 960000 });
  const otherMatch = matchesOf().find((m) => m.offerId === offer.id && m.requestId === other.id && m.isCurrent !== false);
  assert.ok(otherMatch, "a second client matched");
  for (let i = 0; i < 2; i += 1) assert.equal((await call("/os/records/availability", { officeId: OFFICE_A, recordId: offer.id, answer: "SOLD" }, OWNER_A)).status, 200);
  assert.equal(record(offer.id).availabilityStatus, "SOLD");
  assert.ok(record(offer.id), "kept, not deleted");
  assert.notEqual(h.store.get(`offices/${OFFICE_A}/matches/${otherMatch.id}`).isCurrent, true, "the other open match stopped");
  assert.equal(h.store.get(`offices/${OFFICE_A}/journeys/${journeyId}`).status, "ACTIVE", "the deal is not closed automatically");
  assert.notEqual(h.store.get(`offices/${OFFICE_A}/matches/${match.id}`).status, "superseded", "the deal's own match is left as it is");
  assert.ok(ops().filter((op) => op.journeyId === journeyId).every((op) => op.status !== "EXPIRED"), "the deal's tasks are not expired");
  const attention = ops().filter((op) => op.type === "AVAILABILITY_ATTENTION" && op.opportunityId === offer.id);
  assert.equal(attention.length, 1, "one task, not one per call");
  const late = await save("REQUEST", "الخالدية", { price: 970000 });
  assert.equal(matchesOf().filter((m) => m.offerId === offer.id && m.requestId === late.id && m.isCurrent !== false).length, 0, "a sold offer gets no new match");
});

test("isolation: another office cannot change a record's validity or availability", async () => {
  const offer = await save("OFFER", "العوالي");
  assert.equal((await call("/os/records/availability", { officeId: OFFICE_A, recordId: offer.id, answer: "SOLD" }, OWNER_B)).status, 403);
  assert.equal((await call("/os/records/validity", { officeId: OFFICE_A, recordId: offer.id, duration: "WEEK" }, OWNER_B)).status, 403);
  assert.equal((await call("/os/records/availability", { officeId: OFFICE_B, recordId: offer.id, answer: "SOLD" }, OWNER_B)).status, 404, "not found in its own office");
  assert.notEqual(record(offer.id).availabilityStatus, "SOLD");
});

test("the sweep: an unreachable side gets nothing and nothing is deleted; an older record is untouched", async () => {
  await call("/os/agent/settings", { officeId: OFFICE_A, enabled: true }, OWNER_A);
  const offer = await save("OFFER", "الراية");
  await expire(offer.id);
  h.store.seed(`offices/${OFFICE_A}/opportunities/legacy_1`, { officeId: OFFICE_A, opportunityKind: "OFFER", propertyType: "أرض", city: "المدينة المنورة", district: "الراية", price: 800000, lifecycleStatus: "ACTIVE" });
  const before = sent.length;
  const swept = await call("/os/validity/sweep", { officeId: OFFICE_A }, OWNER_A);
  assert.equal(swept.status, 200, JSON.stringify(swept.body));
  assert.equal(sent.length, before, "no message to a side that is not linked");
  assert.ok(record(offer.id), "kept");
  assert.equal(record(offer.id).validityReason, "منتهي الصلاحية");
  assert.equal(record("legacy_1").validityReason, undefined, "an older record is not touched");
  assert.equal((await call("/os/validity/sweep", { officeId: OFFICE_A }, OWNER_B)).status, 403);
});

test("a linked side: asked once with buttons, its answer renews the same record; another chat cannot answer", async () => {
  await call("/os/bot/enable", { officeId: OFFICE_A, enabled: true }, OWNER_A);
  const offer = await save("OFFER", "النخيل");
  await linkParty(offer.id, 7701, offer.phone);
  await expire(offer.id);
  await call("/os/validity/sweep", { officeId: OFFICE_A }, OWNER_A);
  const ask = lastTo(7701);
  assert.match(ask.text, /مدير المكتب الذكي/);
  assert.match(ask.text, /مساعد ذكاء اصطناعي/);
  const buttons = ask.reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.map((b) => b.text), ["نعم، متاح", "تم البيع", "أوقف العرض مؤقتًا", "تعديل بيانات العرض"]);
  const asks = sent.length;
  await call("/os/validity/sweep", { officeId: OFFICE_A }, OWNER_A);
  assert.equal(sent.length, asks, "the same step is not asked twice");
  const waiting = ops().find((op) => op.type === "AVAILABILITY_CHECK" && op.opportunityId === offer.id);
  assert.equal(waiting.status, "WAITING_EXTERNAL_RESPONSE", "shown as «يتابعها مدير المكتب»");
  const yes = buttons.find((b) => b.text === "نعم، متاح").callback_data;
  const intruder = await press(7799, yes);
  assert.equal(intruder.body.reason, "not_this_chat");
  const answered = await press(7701, yes);
  assert.equal(answered.body.state, STATE.ACTIVE, JSON.stringify(answered.body));
  assert.equal(validityState(record(offer.id)), STATE.ACTIVE);
  assert.match(record(offer.id).availabilityConfirmedBy, /^party:/);
  const doneTask = h.store.get(`offices/${OFFICE_A}/operations/${waiting.id}`);
  assert.equal(doneTask.status, "COMPLETED");
  assert.equal(doneTask.completedBy, "AGENT");
  assert.equal((await press(7701, yes)).body.reason, "ask_unknown", "a used button is dead");
});

test("a side's words: one record → a confirmation button; several → «which one?»; nothing changes without the press", async () => {
  const phone = "0557000111";
  const one = await save("OFFER", "الأزهري", { contactPhone: phone });
  await linkParty(one.id, 7702, phone);
  const r1 = await says(7702, "الأرض انباعت");
  assert.equal(r1.body.confirmAsked, 1, JSON.stringify(r1.body));
  assert.notEqual(record(one.id).availabilityStatus, "SOLD", "words alone change nothing");
  const two = await save("OFFER", "الدفاع", { contactPhone: phone, price: 700000 });
  const r2 = await says(7702, "انباعت الأرض");
  assert.equal(r2.body.chooseAsked, 2, JSON.stringify(r2.body));
  const choose = lastTo(7702);
  assert.match(choose.text, /تقصد أي/);
  const pick = choose.reply_markup.inline_keyboard.flat().find((b) => b.text.includes("الدفاع"));
  await press(7702, pick.callback_data);
  assert.equal(record(two.id).availabilityStatus, "SOLD");
  assert.notEqual(record(one.id).availabilityStatus, "SOLD", "the other record is untouched");
});

test("before telling a client, an offer with stale availability is confirmed with the owner first", async () => {
  const offer = await save("OFFER", "بني حارثة", { contactPhone: "0557000222" });
  await linkParty(offer.id, 7703, "0557000222");
  h.store.patch(`offices/${OFFICE_A}/opportunities/${offer.id}`, { availabilityConfirmedAt: new Date(Date.now() - 30 * 86400000).toISOString() });
  const before = sent.length;
  const req = await save("REQUEST", "بني حارثة");
  assert.ok(matchesOf().some((m) => m.offerId === offer.id && m.requestId === req.id && m.isCurrent !== false), "matched");
  const toOwner = sent.slice(before).filter((m) => m.method === "sendMessage" && String(m.chat_id) === "7703");
  assert.equal(toOwner.length, 1, "the owner is asked once");
  assert.match(toOwner[0].text, /قبل ما نتواصل معه/);
  assert.ok(ops().some((op) => op.type === "AVAILABILITY_CHECK" && op.opportunityId === offer.id && op.status === "WAITING_EXTERNAL_RESPONSE"));
});
