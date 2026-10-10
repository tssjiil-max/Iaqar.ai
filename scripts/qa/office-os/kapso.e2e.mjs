// Kapso WhatsApp Sandbox → central understanding → records → matching → Daily Tasks → negotiation room.
// Real Worker + in-memory Firestore (isolated). Kapso's reply API is intercepted here (nothing leaves the machine).
//   node scripts/qa/office-os/kapso.e2e.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A } from "./server.mjs";

const SECRET = crypto.randomBytes(24).toString("hex");
const PHONE_ID = "597907523413541";
const OWNER_WA = "966559100001";
const BUYER_WA = "966559100002";
const sent = [];
const h = await startOfficeOsHarness();
// After the harness installed its Firestore double: Kapso's reply API is answered here.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (String(url?.url || url).startsWith("https://kapso.test/")) { sent.push({ url: String(url), key: init.headers?.["X-API-Key"], body: JSON.parse(init.body) }); return new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] }), { status: 200 }); }
  return realFetch(url, init);
};
Object.assign(h.env, { KAPSO_WEBHOOK_SECRET: SECRET, KAPSO_OFFICE_ID: OFFICE_A, KAPSO_PHONE_NUMBER_ID: PHONE_ID, KAPSO_ALLOWED_SENDERS: `${OWNER_WA},${BUYER_WA}`, KAPSO_API_KEY: "test-key", KAPSO_API_BASE: "https://kapso.test/v24.0" });
const results = [];
const pass = (name) => { results.push(name); console.log(`PASS ${name}`); };
const out = process.env.OUT_DIR || "/tmp/iaqar-kapso";
fs.mkdirSync(out, { recursive: true });

let n = 0;
const payload = (from, body, { phoneId = PHONE_ID, id } = {}) => ({
  message: { id: id || `wamid.test.${++n}`, type: "text", from, timestamp: String(Math.floor(Date.now() / 1000)), text: { body }, kapso: { direction: "inbound", status: "received", origin: "cloud_api", has_media: false, content: body } },
  conversation: { id: `conv_${from}`, phone_number: from, contact_name: from === OWNER_WA ? "مالك واتساب تجريبي" : "مشتري واتساب تجريبي", phone_number_id: phoneId },
  is_new_conversation: false,
  phone_number_id: phoneId
});
const sign = (raw, secret = SECRET) => crypto.createHmac("sha256", secret).update(raw).digest("hex");
async function deliver(obj, { secret = SECRET, event = "whatsapp.message.received", signature } = {}) {
  const raw = JSON.stringify(obj);
  const res = await realFetch(`${h.origin}/worker/integrations/kapso/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-webhook-event": event, "x-webhook-signature": signature ?? sign(raw, secret), "x-idempotency-key": crypto.randomUUID(), "x-webhook-payload-version": "v2" }, body: raw });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const say = async (from, text) => { const r = await deliver(payload(from, text)); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.results[0]; };
const lastReply = (to) => [...sent].reverse().find((m) => m.body.to === to)?.body.text.body || "";
const records = () => h.store.list(`offices/${OFFICE_A}/opportunities`);
const api = async (path, body, uid = OWNER_A) => (await realFetch(`${h.origin}/worker${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${idTokenFor(uid)}` }, body: JSON.stringify(body) })).json();

try {
  // 7 security first
  const before = records().length;
  assert.equal((await deliver(payload(OWNER_WA, "عندي شقة"), { signature: "" })).status, 401);
  assert.equal((await deliver(payload(OWNER_WA, "عندي شقة"), { secret: "wrong-secret" })).status, 401);
  assert.equal((await deliver(payload(OWNER_WA, "عندي شقة"), { signature: "0".repeat(64) })).status, 401);
  assert.equal(records().length, before);
  pass("untrusted deliveries (no signature, wrong secret, forged) → 401, nothing read or written");
  const prodEnv = h.env.DEPLOYMENT_ENV; h.env.DEPLOYMENT_ENV = "production";
  const prod = await deliver(payload(OWNER_WA, "عندي شقة"));
  h.env.DEPLOYMENT_ENV = prodEnv;
  assert.equal(prod.status, 503); assert.equal(prod.body.reason, "not_staging");
  pass("on a production Worker the endpoint answers 503 (Staging only)");

  // 8 another number / another sender / other events
  const other = await deliver(payload(OWNER_WA, "للبيع شقة في الملقا بالرياض 900 ألف", { phoneId: "111111111111111" }));
  assert.equal(other.body.results[0].status, "other_number");
  const stranger = await deliver(payload("966500000999", "للبيع شقة في الملقا بالرياض 900 ألف"));
  assert.equal(stranger.body.results[0].status, "sender_not_allowed");
  const sentEvent = await deliver(payload(OWNER_WA, "x"), { event: "whatsapp.message.sent" });
  assert.equal(sentEvent.body.ignored, "event");
  assert.equal(records().length, before);
  assert.equal(h.store.list(`offices/${OFFICE_B}/opportunities`).length, 1, "office B untouched");
  pass("a message to another number, from a sender not allowed, or another event → ignored; no office other than the configured one is touched");

  // 3 social
  const social = await say(OWNER_WA, "السلام عليكم، كيف حالك؟");
  assert.equal(social.status, "social");
  assert.match(lastReply(OWNER_WA), /وعليكم السلام/);
  assert.equal(records().length, before);
  pass("social message → a short reply, no offer or request created");

  // 1 owner offer (the prompt's example), city asked with the office's city, then confirmed
  let r = await say(OWNER_WA, "عندي عمارة للبيع في الهجرة، مساحتها 600 متر، السعر مليون و900 ألف.");
  assert.equal(r.status, "asked"); assert.equal(r.missing, "city");
  assert.match(lastReply(OWNER_WA), /العقار في الرياض؟/);
  r = await say(OWNER_WA, "نعم");
  assert.equal(r.status, "confirm");
  const summary = lastReply(OWNER_WA);
  assert.match(summary, /عمارة/); assert.match(summary, /الهجرة/); assert.match(summary, /1,900,000/); assert.match(summary, /600/);
  assert.equal(records().length, before, "nothing saved before «نعم» to the summary");
  // 6 the same delivery again (Kapso retry)
  const retryId = `wamid.retry.${Date.now()}`;
  const first = await deliver(payload(OWNER_WA, "نعم", { id: retryId }));
  assert.equal(first.body.results[0].status, "saved");
  const again = await deliver(payload(OWNER_WA, "نعم", { id: retryId }));
  assert.equal(again.body.results[0].status, "duplicate");
  const offer = records().find((x) => x.contactPhone === "0559100001");
  assert.ok(offer);
  assert.deepEqual([offer.opportunityKind, offer.purpose, offer.propertyType, offer.district, offer.city, Number(offer.area), Number(offer.priceOrBudget || offer.price)], ["OFFER", "SALE", "عمارة", "الهجرة", "الرياض", 600, 1900000]);
  assert.equal(offer.intakeOrigin.channel, "WHATSAPP");
  assert.equal(records().filter((x) => x.contactPhone === "0559100001").length, 1);
  assert.match(lastReply(OWNER_WA), /تم تسجيل عرضك/);
  pass("owner message → عرض · عمارة · بيع · الهجرة · 600 م² · 1,900,000 · source WhatsApp · saved only after «نعم»; Kapso retry → one record");

  // 2 buyer request with a correction and a short answer
  r = await say(BUYER_WA, "مطلوب عمارة في الهجرة، الميزانية مليونين.");
  assert.equal(r.missing, "city");
  r = await say(BUYER_WA, "الرياض");
  assert.equal(r.status, "confirm");
  r = await say(BUYER_WA, "لا، الميزانية 2.1 مليون");
  assert.equal(r.status, "confirm");
  assert.match(lastReply(BUYER_WA), /2,100,000/);
  r = await say(BUYER_WA, "نعم");
  assert.equal(r.status, "saved");
  const request = records().find((x) => x.contactPhone === "0559100002");
  assert.deepEqual([request.opportunityKind, request.purpose, request.propertyType, request.district, Number(request.priceOrBudget || request.price)], ["REQUEST", "PURCHASE", "عمارة", "الهجرة", 2100000]);
  pass("buyer message → طلب · عمارة · شراء · الهجرة · مليونين, the city answered in one word, a correction replaces the budget (2,100,000)");

  // 4 long pasted ad with several districts and urgency; 5 incomplete
  r = await say(OWNER_WA, "مطلوب عمارة بالهجرة أو شوران، الميزانية 2 مليون، مستعجل، التواصل واتساب.");
  assert.equal(r.missing, "city");
  r = await say(OWNER_WA, "المدينة المنورة");
  assert.equal(r.status, "confirm");
  assert.match(lastReply(OWNER_WA), /الهجرة أو شوران/); assert.match(lastReply(OWNER_WA), /مستعجل/);
  assert.doesNotMatch(lastReply(OWNER_WA), /على راحتي/);
  pass("pasted ad → districts الهجرة + شوران, 2,000,000, «مستعجل»; the original wording kept");
  r = await say(BUYER_WA, "أبغى شقة");
  assert.equal(r.status, "asked");
  assert.ok(["purpose", "district", "city", "price"].includes(r.missing));
  pass(`incomplete message → one question at a time (${r.missing}), nothing saved`);

  // 9 matching on the existing engine → Daily Tasks
  const match = h.store.list(`offices/${OFFICE_A}/matches`).find((m) => [m.offerId, m.requestId].includes(offer.id) && [m.offerId, m.requestId].includes(request.id));
  assert.ok(match, "a match record between the WhatsApp offer and request");
  const review = h.store.list(`offices/${OFFICE_A}/operations`).find((op) => String(op.type).toUpperCase() === "MATCH_REVIEW" && op.status === "OPEN" && (op.matchId === match.id || JSON.stringify(op).includes(match.id)));
  assert.ok(review, "a MATCH_REVIEW task in the office's Daily Tasks");
  pass("existing matching engine: offer × request → a match record and one «مراجعة مطابقة» task in Daily Tasks");
  // 10 no wrong match: a rent offer of a flat in another district must not match the building purchase
  const wrong = h.store.list(`offices/${OFFICE_A}/matches`).filter((m) => m.requestId === request.id && m.offerId !== offer.id && m.isCurrent !== false);
  assert.equal(wrong.length, 0);
  pass("no wrong match for the request (only the building for sale in الهجرة)");

  // 12 the office approves → the negotiation room (existing flow), opened once
  const decided = await api("/os/review/decide", { officeId: OFFICE_A, matchId: match.id, decision: "approve" });
  assert.equal(decided.ok, true, JSON.stringify(decided));
  const again2 = await api("/os/review/decide", { officeId: OFFICE_A, matchId: match.id, decision: "approve" });
  assert.equal(h.store.list(`offices/${OFFICE_A}/journeys`).filter((j) => j.matchId === match.id || j.offerId === offer.id).length, 1, JSON.stringify(again2).slice(0, 200));
  const links = await api("/os/session/links", { officeId: OFFICE_A, journeyId: decided.journeyId });
  assert.equal(links.ok, true);
  const roomLinks = JSON.stringify(links);
  assert.ok(/#|token|\/s\//.test(roomLinks));
  assert.ok(!roomLinks.includes("0559100001") && !roomLinks.includes("0559100002"), "no phone in the room links");
  pass("the office approves → one journey (no duplicate on a second press) → negotiation-room links prepared, without phone numbers");

  // 13 replies via Kapso: only to the senders, with the API key, on the sandbox number
  assert.ok(sent.length >= 8);
  assert.ok(sent.every((m) => [OWNER_WA, BUYER_WA].includes(m.body.to) && m.url === `https://kapso.test/v24.0/${PHONE_ID}/messages` && m.key === "test-key"));
  assert.ok(!sent.some((m) => /0559100002|0559100001/.test(m.body.text.body)), "a side never receives the other side's number");
  pass(`replies (${sent.length}) went only to the sandbox senders, through Kapso's API on the sandbox number, never with the other side's number`);

  // 14 Meta / Telegram routes untouched
  const meta = await realFetch(`${h.origin}/worker/meta/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`);
  assert.notEqual(meta.status, 200);
  pass("the Meta webhook still refuses a wrong verify token (unchanged)");

  fs.writeFileSync(`${out}/result.json`, JSON.stringify({ passed: results.length, results, replies: sent.map((m) => ({ to: m.body.to.replace(/\d{4}$/, "****"), text: m.body.text.body })) }, null, 2));
  console.log(`\n${results.length} Kapso checks passed`);
} finally {
  await new Promise((resolve) => h.server.close(resolve));
}
