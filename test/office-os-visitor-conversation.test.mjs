// «جرّب مدير مكتبك» and the Telegram office manager: the conversation itself — the persona stays chosen, a long
// message is understood at once, the district is never a city, nothing is asked twice, every detail reaches the
// summary, an offer stays an offer and a request a request, and the try-out never saves, sends or links anything.
// Reproduces the owner's and the client's real try-outs. Real Worker, in-memory Firestore double, Telegram double.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { extractFacts, mergeDraft, personaFromText, summaryLines, toRecordInput } from "../public/os/domain/visitor-domain.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B, BROKER_A2 } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());
const SECRET = "tg-secret-for-conversation-tests";
Object.assign(h.env, { TELEGRAM_BOT_TOKEN: "555666777:CONVERSATION-TOKEN-never-in-a-response", TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_BOT_USERNAME: "iaqar_test_bot", TELEGRAM_OUTBOUND: "enabled" }); // pragma: allowlist secret
delete h.env.GEMINI_API_KEY; // the rules alone must understand the real try-out messages

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(typeof input === "string" ? input : input.url);
  if (!url.startsWith("https://api.telegram.org/")) return realFetch(input, init);
  sent.push({ method: url.split("/").pop(), ...JSON.parse(init.body || "{}") });
  return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200 });
};
test.after(() => { globalThis.fetch = realFetch; });

async function call(route, body, uid) {
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${idTokenFor(uid)}` }, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const tryOut = async (input, uid = OWNER_A, office = OFFICE_A) => (await call("/os/agent/preview", { officeId: office, ...input }, uid)).body;
const last = (r) => r.replies.at(-1)?.text || "";
const all = (r) => r.replies.map((x) => x.text).join("\n");
const WELCOME = /هل أنت مالك عقار، أو وسيط عقاري، أو عميل/;
const previewState = (uid = OWNER_A) => h.store.get(`offices/${OFFICE_A}/agentPreview/${uid}`);
const draftOf = (uid = OWNER_A) => JSON.parse(previewState(uid)?.draftJson || "{}");
const WABRA = "عندي شقة غرفتين وصالة ومطبخ صغير ودورة مياه للإيجار السنوي في الوبرة";

let snapshot;
test.before(async () => {
  await call("/os/agent/settings", { officeId: OFFICE_A, enabled: true }, OWNER_A);
  h.store.patch(`offices/${OFFICE_A}`, { city: "المدينة المنورة" });
  snapshot = {
    records: h.store.list(`offices/${OFFICE_A}/opportunities`).length,
    matches: h.store.list(`offices/${OFFICE_A}/matches`).length,
    parties: h.store.list("telegramParties").length,
    inbox: h.store.list(`offices/${OFFICE_A}/inbox`).length
  };
});

// ------------------------------------------------------------------ the words themselves

test("5 · 7 — one long message is understood at once; «الوبرة» is a district, never a city", () => {
  const f = extractFacts(WABRA);
  assert.deepEqual(f, { propertyType: "شقة", transactionType: "rent", rentPeriod: "YEARLY", rooms: 2, halls: 1, bathrooms: 1, kitchen: "صغير", district: "الوبرة" });
  assert.equal(f.city, undefined, "no city was written, none is invented");
  assert.equal(personaFromText(WABRA), "OWNER");
  assert.equal(personaFromText("أنا عميل"), "CLIENT");
  assert.equal(personaFromText("أدور شقة للإيجار"), "CLIENT");
  assert.equal(personaFromText("وسيط عقاري"), "BROKER");
  assert.equal(personaFromText("السلام عليكم"), "");
  const g = extractFacts("أدور فيلا للشراء في حي النرجس بالرياض بحدود 2 مليون");
  assert.equal(g.district, "النرجس");
  assert.equal(g.city, "الرياض");
  assert.equal(g.price, 2000000);
});

test("6 · 10 — every detail reaches the summary and the record's description; an offer never takes a request's purpose", () => {
  const offer = mergeDraft({ kind: "OFFER" }, { ...extractFacts(WABRA), city: "المدينة المنورة", price: 30000 });
  assert.equal(offer.purpose, "RENT");
  const lines = summaryLines(offer).join("\n");
  for (const part of ["عرض عقار", "شقة للإيجار سنوي", "الوبرة، المدينة المنورة", "السعر: 30,000", "الغرف: 2", "صالة", "مطبخ صغير", "دورة مياه واحدة"]) assert.ok(lines.includes(part), `${part} in:\n${lines}`);
  const input = toRecordInput(offer, { phone: "0556700009" });
  assert.equal(input.kind, "OFFER");
  assert.match(input.notes, /صالة، مطبخ صغير، دورة مياه واحدة — إيجار سنوي/);
  const request = mergeDraft({ kind: "REQUEST" }, { transactionType: "rent", purpose: "RENT" });
  assert.equal(request.purpose, "LEASE_REQUEST", "a request's purpose stays a request's");
  assert.match(summaryLines(request).join("\n"), /طلب عقار/);
});

// ------------------------------------------------------------------ the owner's real try-out (rules only)

test("1 · 3 · 4 · 5 · 6 · 7 · 8 · 9 · 11 · 12 — the owner: offer, no second welcome, everything understood, price asked once, edit keeps the rest", async () => {
  const start = await tryOut({ action: "reset" });
  assert.match(last(start), WELCOME);
  const owner = await tryOut({ action: "button", data: "vp:OWNER" });
  assert.doesNotMatch(all(owner), WELCOME, "no welcome after choosing");
  assert.match(last(owner), /وش العقار اللي تبي تعرضه/);
  assert.equal(previewState().persona, "OWNER");
  assert.equal(draftOf().kind, "OFFER");

  const first = await tryOut({ action: "text", text: WABRA });
  assert.doesNotMatch(all(first), WELCOME);
  const d1 = draftOf();
  assert.deepEqual([d1.propertyType, d1.purpose, d1.rentPeriod, d1.rooms, d1.halls, d1.kitchen, d1.bathrooms, d1.district], ["شقة", "RENT", "YEARLY", 2, 1, "صغير", 1, "الوبرة"]);
  assert.equal(d1.city, undefined);
  assert.equal(last(first), "حي الوبرة في المدينة المنورة؟ إذا كان في مدينة ثانية اكتب اسمها.", "the office's city is proposed, not assumed");
  const city = await tryOut({ action: "text", text: "نعم" });
  assert.equal(draftOf().city, "المدينة المنورة");
  assert.match(last(city), /كم السعر المطلوب/, "the price is asked because it was not given");
  const asks = [first, city].map(last);
  assert.equal(asks.filter((q) => /السعر/.test(q)).length, 1);
  const price = await tryOut({ action: "text", text: "30 ألف" });
  assert.ok(price.replies.some((x) => x.askContact), "then the phone");
  assert.equal(previewState().persona, "OWNER", "the persona is still the owner");

  const phone = await tryOut({ action: "contact", phone: "0556700009" });
  const summary = last(phone);
  for (const part of ["ملخص عرضك", "عرض عقار", "شقة للإيجار سنوي", "الوبرة، المدينة المنورة", "السعر: 30,000", "الغرف: 2", "صالة", "مطبخ صغير", "دورة مياه واحدة"]) assert.ok(summary.includes(part), `${part} in:\n${summary}`);

  const edited = await tryOut({ action: "text", text: "السعر 32 ألف" });
  const after = last(edited);
  assert.match(after, /السعر: 32,000/);
  for (const part of ["الوبرة، المدينة المنورة", "مطبخ صغير", "دورة مياه واحدة", "الغرف: 2"]) assert.ok(after.includes(part), `edit kept ${part}`);
  const done = await tryOut({ action: "button", data: "vc:SAVE" });
  assert.match(last(done), /معاينة ✅/);
});

test("2 · 4 · 10 — the client (the reported try-out): «عميل يبحث عن عقار» goes straight to the request; never back to the welcome", async () => {
  await tryOut({ action: "reset" });
  const client = await tryOut({ action: "button", data: "vp:CLIENT" });
  assert.doesNotMatch(all(client), WELCOME);
  assert.match(last(client), /وش تدور عليه/);
  assert.equal(draftOf().kind, "REQUEST");
  const msg = await tryOut({ action: "text", text: "أبي شقة 3 غرف للإيجار" });
  assert.doesNotMatch(all(msg), WELCOME, "a message after choosing is never treated as a new conversation");
  assert.equal(previewState().persona, "CLIENT");
  assert.equal(draftOf().purpose, "LEASE_REQUEST");
  assert.match(last(msg), /في أي حي/);
  await tryOut({ action: "text", text: "العزيزية" });
  assert.equal(draftOf().district, "العزيزية");
  await tryOut({ action: "text", text: "ايه" });
  const budget = await tryOut({ action: "text", text: "25000" });
  assert.equal(draftOf().price, 25000);
  assert.ok(budget.replies.some((x) => x.askContact));
  const summary = last(await tryOut({ action: "contact", phone: "+966556700010" }));
  assert.match(summary, /ملخص طلبك/);
  assert.match(summary, /طلب عقار/);
  assert.match(summary, /للاستئجار/);
  assert.match(summary, /الميزانية: 25,000/);
});

test("natural words instead of buttons: «أنا عميل» chooses; a greeting before choosing gets the short choice, not the full welcome", async () => {
  await tryOut({ action: "reset" });
  const hi = await tryOut({ action: "text", text: "السلام عليكم" });
  assert.doesNotMatch(all(hi), WELCOME);
  assert.equal(hi.replies[0].buttons.length, 3);
  const said = await tryOut({ action: "text", text: "أنا عميل" });
  assert.match(last(said), /وش تدور عليه/);
  assert.equal(draftOf().kind, "REQUEST");
  // An owner who starts with the property itself: chosen AND understood in one message.
  await tryOut({ action: "reset" });
  const direct = await tryOut({ action: "text", text: WABRA });
  assert.equal(previewState().persona, "OWNER");
  assert.equal(draftOf().kind, "OFFER");
  assert.equal(draftOf().district, "الوبرة");
  assert.match(last(direct), /حي الوبرة في المدينة المنورة؟/);
});

test("opening the page again continues the conversation (no reset, no welcome)", async () => {
  const before = draftOf();
  const opened = await tryOut({ action: "open" });
  assert.doesNotMatch(all(opened), WELCOME);
  assert.match(last(opened), /حي الوبرة في المدينة المنورة؟/);
  assert.deepEqual(draftOf(), before);
});

test("14 — pressing twice does it once", async () => {
  await tryOut({ action: "reset" });
  await tryOut({ action: "button", data: "vp:CLIENT" });
  const again = await tryOut({ action: "button", data: "vp:OWNER" });
  assert.equal(again.replies.length, 0, "an old button changes nothing");
  assert.equal(draftOf().kind, "REQUEST");
  assert.equal(previewState().persona, "CLIENT");
});

test("11 — a typed Saudi number: 05… and 966… both work in the try-out; on Telegram the contact button stays required", async () => {
  for (const number of ["0556700011", "966556700011"]) {
    await tryOut({ action: "reset" });
    await tryOut({ action: "button", data: "vp:OWNER" });
    await tryOut({ action: "text", text: "أرض للبيع في حي الراية بالمدينة المنورة بسعر 900 ألف" });
    const r = await tryOut({ action: "text", text: number });
    assert.match(last(r), /ملخص عرضك/, number);
    assert.equal(previewState().phone, "0556700011");
  }
  // Telegram: a typed number is not accepted as the person's own.
  await call("/os/bot/enable", { officeId: OFFICE_A, enabled: true }, OWNER_A);
  const tg = async (update) => (await h.worker.fetch(new Request("https://worker.test/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET }, body: JSON.stringify(update) }), h.env, { waitUntil() {} })).json();
  let id = 81000;
  const m = (text) => ({ update_id: ++id, message: { message_id: id, chat: { id: 7101, type: "private" }, from: { id: 7101, first_name: "مالك" }, text } });
  await tg(m(`/start of_${OFFICE_A}`));
  await tg({ update_id: ++id, callback_query: { id: "c1", from: { id: 7101 }, data: "vp:OWNER", message: { message_id: 1, chat: { id: 7101, type: "private" } } } });
  await tg(m("أرض للبيع في حي الراية بالمدينة المنورة بسعر 900 ألف"));
  const typed = await tg(m("0556700012"));
  assert.equal(typed.typedNumber, true);
  assert.equal(h.store.get("telegramVisitors/7101").phone, undefined);
});

test("13 · 15 — the try-out saved, sent and linked nothing; each member has his own; another office cannot use it", async () => {
  const bothBefore = JSON.stringify(previewState(OWNER_A));
  await tryOut({ action: "reset" }, BROKER_A2);
  await tryOut({ action: "button", data: "vp:CLIENT" }, BROKER_A2);
  assert.equal(draftOf(BROKER_A2).kind, "REQUEST");
  assert.equal(JSON.stringify(previewState(OWNER_A)), bothBefore, "another member's try-out is untouched");
  assert.equal((await call("/os/agent/preview", { officeId: OFFICE_A, action: "open" }, OWNER_B)).status, 403);
  assert.equal(h.store.get(`offices/${OFFICE_B}/agentPreview/${OWNER_A}`), null);
  const tgSendsFromPreview = sent.filter((m) => String(m.chat_id) === "1000000001");
  assert.equal(tgSendsFromPreview.length, 0, "nothing ever went to Telegram from the try-out");
  assert.equal(h.store.list(`offices/${OFFICE_A}/opportunities`).length, snapshot.records, "no record saved");
  assert.equal(h.store.list(`offices/${OFFICE_A}/matches`).length, snapshot.matches, "no match created");
  assert.equal(h.store.list("telegramParties").length, snapshot.parties, "nobody linked");
  assert.equal(h.store.get("telegramBotChats/1000000001"), null);
});
