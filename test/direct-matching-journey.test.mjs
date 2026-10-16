// Direct matching journey against the real Worker + in-memory Firestore (harness). No jsdom needed.
import test from "node:test";
import assert from "node:assert/strict";
import { startOfficeOsHarness, OFFICE_A, OFFICE_B, OWNER_A, BROKER_A2, OWNER_B, idTokenFor } from "../scripts/qa/office-os/server.mjs";

const h = await startOfficeOsHarness();
test.after(() => h.server.close());

const offer = { opportunityKind: "OFFER", purpose: "SALE", transactionType: "sale", propertyType: "شقة", city: "المدينة المنورة", district: "الجماوات", priceOrBudget: 450000, salePrice: 450000, advertiserRole: "OWNER", contactPhone: "0551234567", contactName: "مالك سري", rooms: 4, area: 180, publicSearchVisible: true, validityConfirmedAt: "2026-10-10T00:00:00Z", internalNotes: "كود الباب 1234" };
const seedOffer = (office, id, extra = {}) => h.store.seed(`offices/${office}/opportunities/${id}`, { ...offer, officeId: office, ...extra });
for (const office of [OFFICE_A, OFFICE_B]) h.store.patch(`publicOffices/${office}`, { city: "المدينة المنورة" });
const allDocs = () => [...h.store.docs.keys()].map((k) => [k, h.store.get(k)]);
for (let i = 0; i < 12; i++) seedOffer(OFFICE_A, `jm-${i}`, { priceOrBudget: 400000 + i * 1000, salePrice: 400000 + i * 1000 });
seedOffer(OFFICE_A, "jm-reserved", { reservation: { state: "RESERVED", journeyId: "x" } });
seedOffer(OFFICE_A, "jm-sold", { availabilityStatus: "SOLD" });
seedOffer(OFFICE_A, "jm-private", { publicSearchVisible: false });
seedOffer(OFFICE_A, "jm-deal");
h.store.seed(`offices/${OFFICE_A}/journeys/jr-jm-deal`, { officeId: OFFICE_A, offerId: "jm-deal", requestId: "req-x", status: "ACTIVE", stage: "NEGOTIATION" });
seedOffer(OFFICE_B, "jm-b1", { priceOrBudget: 300000, salePrice: 300000 });

async function call(route, body, uid = "") {
  const r = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers: { "content-type": "application/json", ...(uid ? { authorization: `Bearer ${idTokenFor(uid)}` } : {}) }, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
let n = 0;
const criteria = { purpose: "PURCHASE", propertyType: "شقة", city: "المدينة المنورة", district: "الجماوات", price: 500000, rooms: 3 };
const search = (extra = {}) => call("/os/public/search", { officeId: OFFICE_A, scope: "office", requestKey: `journey-search-${String(++n).padStart(4, "0")}`, criteria, ...extra });
const choose = (s, reference, extra = {}) => call("/os/public/search/select", { searchToken: s.body.searchToken, reference, name: "عميل أول", phone: "0557000111", channel: "whatsapp", consentProcessing: true, consentContact: true, ...extra });

test("1–4: search needs no contact; office scope then all offices; at most ten real results", async () => {
  const office = await search();
  assert.equal(office.status, 200, JSON.stringify(office.body));
  assert.equal(office.body.results.length, 10);
  assert.ok(office.body.results.every((x) => x.officeId === OFFICE_A));
  assert.match(office.body.searchToken, /^[a-f0-9]{48}$/);
  const all = await search({ scope: "all", officeId: "", criteria: { ...criteria, price: 350000 } });
  assert.equal(all.status, 200, JSON.stringify(all.body));
  assert.ok(all.body.results.some((x) => x.officeId === OFFICE_B), "all offices includes the other office's published offer");
  assert.ok(all.body.results.every((x) => x.price <= 350000), "budget respected across offices");
  const officeOnly = await search({ criteria: { ...criteria, price: 350000 } });
  assert.ok(!officeOnly.body.results.some((x) => x.officeId === OFFICE_B), "2: office scope never shows another office");
});

test("10: reserved, sold and unpublished offers are excluded; an offer in negotiation stays listed with its status", async () => {
  const r = await search({ requestKey: "journey-exclusions-0001" });
  const refs = r.body.results.map((x) => x.reference);
  for (const hidden of ["jm-reserved", "jm-sold", "jm-private"]) assert.ok(!refs.some((x) => x.endsWith(`:${hidden}`)), hidden);
  const all = await call("/os/public/search", { officeId: OFFICE_A, scope: "office", requestKey: "journey-exclusions-0002", criteria: { ...criteria, price: 460000 } });
  const deal = all.body.results.find((x) => x.reference === `${OFFICE_A}:jm-deal`);
  assert.ok(deal, "negotiating offer remains available to other clients");
  assert.equal(deal.status, "NEGOTIATING");
  assert.equal(deal.statusLabel, "قيد التفاوض");
});

test("8: results never carry owner data or other clients' data", async () => {
  const r = await search();
  const json = JSON.stringify(r.body);
  for (const secret of ["0551234567", "مالك سري", "كود الباب", "0557000111", "عميل أول"]) assert.ok(!json.includes(secret), secret);
});

test("12: contact and consent are required at selection; a choice outside the client's own results is refused", async () => {
  const s = await search();
  const ref = s.body.results[0].reference;
  for (const patch of [{ name: "" }, { phone: "123" }, { channel: "email" }, { consentProcessing: false }, { consentContact: false }]) assert.equal((await choose(s, ref, patch)).status, 400, JSON.stringify(patch));
  assert.equal((await choose(s, `${OFFICE_B}:jm-b1`)).status, 400, "2: another office's offer is not in an office-scoped session");
  assert.equal((await choose({ body: { searchToken: "f".repeat(48) } }, ref)).status, 400, "unknown session");
});

test("6–7: the interest notice appears only after another client's real choice, and the offer stays available", async () => {
  const before = await search({ requestKey: "journey-interest-before" });
  const target = before.body.results[1];
  assert.equal(target.othersInterested, false, "no notice without real interest");
  const first = await choose(before, target.reference, { phone: "0557000201", name: "عميل أ" });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.othersInterested, false, "a client's own interest is not «others»");
  assert.equal(first.body.contact.sent, false);
  assert.equal(first.body.contact.state, "OPEN_WHATSAPP");
  const wa = new URL(first.body.contact.whatsappUrl);
  assert.equal(wa.hostname, "wa.me");
  assert.equal(wa.pathname, "/966501111111", "the office's own number");
  assert.match(wa.searchParams.get("text"), new RegExp(target.reference.replace(":", ".")));
  const second = await search({ requestKey: "journey-interest-after" });
  const again = second.body.results.find((x) => x.reference === target.reference);
  assert.ok(again, "still available to the next client");
  assert.equal(again.othersInterested, true);
  assert.equal(again.interestNotice, "يوجد اهتمام من عملاء آخرين بهذا العقار، ولا يزال متاحًا");
  assert.ok(!JSON.stringify(second.body).includes("0557000201") && !JSON.stringify(second.body).includes("عميل أ"), "no identity leaks");
  const own = await search({ requestKey: "journey-interest-own", viewerKey: first.body.viewerKey });
  assert.equal(own.body.results.find((x) => x.reference === target.reference).othersInterested, false, "the same client is not told about themselves");
  const lead = allDocs().find(([k, v]) => k.startsWith(`offices/${OFFICE_A}/inbox/ps_`) && v.selectedReference === target.reference)?.[1];
  assert.ok(lead, "the office receives the lead");
  assert.equal(lead.readinessIsApproval, false);
  assert.ok(lead.readinessScore > 0 && lead.readinessScore < 90, "selection alone is not near-closing readiness");
});

test("9 + human approval: official reservation is manager-only, refused without a person, and atomic under a race", async () => {
  const id = "jm-race";
  seedOffer(OFFICE_A, id);
  h.store.seed(`offices/${OFFICE_A}/journeys/jr-race-1`, { officeId: OFFICE_A, offerId: id, status: "ACTIVE", stage: "AGREEMENT" });
  h.store.seed(`offices/${OFFICE_A}/journeys/jr-race-2`, { officeId: OFFICE_A, offerId: id, status: "ACTIVE", stage: "AGREEMENT" });
  assert.equal((await call("/os/records/reserve", { officeId: OFFICE_A, recordId: id, journeyId: "jr-race-1" })).status, 401, "no person, no reservation");
  assert.equal((await call("/os/records/reserve", { officeId: OFFICE_A, recordId: id, journeyId: "jr-race-1" }, BROKER_A2)).status, 403, "a broker cannot reserve");
  assert.equal((await call("/os/records/reserve", { officeId: OFFICE_A, recordId: id, journeyId: "jr-race-1" }, OWNER_B)).status, 403, "another office cannot reserve");
  assert.equal((await call("/os/records/reserve", { officeId: OFFICE_A, recordId: id, journeyId: "jr-jm-deal" }, OWNER_A)).status, 400, "the deal must be on this offer");
  const [a, b] = await Promise.all([
    call("/os/records/reserve", { officeId: OFFICE_A, recordId: id, journeyId: "jr-race-1" }, OWNER_A),
    call("/os/records/reserve", { officeId: OFFICE_A, recordId: id, journeyId: "jr-race-2" }, OWNER_A)
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], `exactly one wins: ${JSON.stringify([a.body, b.body])}`);
  const held = h.store.get(`offices/${OFFICE_A}/opportunities/${id}`).reservation;
  assert.equal(held.state, "RESERVED");
  assert.equal(held.by, OWNER_A);
  assert.equal((await call("/os/records/reserve", { officeId: OFFICE_A, recordId: id, journeyId: held.journeyId }, OWNER_A)).status, 200, "idempotent for the same deal");
  const after = await call("/os/public/search", { officeId: OFFICE_A, scope: "office", requestKey: "journey-after-reserve", criteria });
  assert.ok(!after.body.results.some((x) => x.reference.endsWith(`:${id}`)), "reserved immediately leaves public matches");
  assert.equal((await call("/os/records/release", { officeId: OFFICE_A, recordId: id }, BROKER_A2)).status, 403);
  assert.equal((await call("/os/records/release", { officeId: OFFICE_A, recordId: id }, OWNER_A)).status, 200);
  assert.equal(h.store.get(`offices/${OFFICE_A}/opportunities/${id}`).reservation.state, "RELEASED");
});

test("a result reserved after the search cannot be chosen from the old list", async () => {
  const s = await search({ requestKey: "journey-stale-choice" });
  const target = s.body.results[2];
  const recordId = target.reference.split(":")[1];
  h.store.seed(`offices/${OFFICE_A}/journeys/jr-stale`, { officeId: OFFICE_A, offerId: recordId, status: "ACTIVE", stage: "AGREEMENT" });
  assert.equal((await call("/os/records/reserve", { officeId: OFFICE_A, recordId, journeyId: "jr-stale" }, OWNER_A)).status, 200);
  const picked = await choose(s, target.reference, { phone: "0557000303" });
  assert.equal(picked.status, 409);
  await call("/os/records/release", { officeId: OFFICE_A, recordId }, OWNER_A);
});

test("11 + 12: Telegram — nothing is sent before consent; «العرض الثاني» in the chat records that choice", async () => {
  Object.assign(h.env, { TELEGRAM_BOT_TOKEN: "123456789:journey-test-token", TELEGRAM_WEBHOOK_SECRET: "journey-secret", TELEGRAM_BOT_USERNAME: "iaqar_test_bot", TELEGRAM_OUTBOUND: "enabled" });
  const sent = [], original = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).startsWith("https://api.telegram.org/") ? (sent.push(JSON.parse(init.body)), new Response(JSON.stringify({ ok: true, result: { message_id: 900 + sent.length } }), { status: 200 })) : original(url, init);
  const webhook = (chat, text) => h.worker.fetch(new Request("https://worker.test/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "journey-secret" }, body: JSON.stringify({ update_id: 5000 + sent.length + Math.floor(Math.random() * 1e6), message: { chat: { id: chat, type: "private" }, from: { id: chat }, text } }) }), h.env, { waitUntil() {} });
  try {
    const s = await search({ requestKey: "journey-telegram-0001" });
    await webhook(4242, `/start ps_${s.body.searchToken}`);
    assert.equal(sent.length, 0, "no consent yet → nothing is sent");
    const picked = await choose(s, s.body.results[0].reference, { channel: "telegram", phone: "0557000404", name: "عميل تيليجرام" });
    assert.equal(picked.status, 200, JSON.stringify(picked.body));
    assert.equal(picked.body.contact.state, "START_REQUIRED");
    await webhook(4242, `/start ps_${s.body.searchToken}`);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /اخترت/);
    assert.ok(!sent[0].text.includes("0551234567"));
    await webhook(4242, "أبغى العرض الثاني");
    assert.equal(sent.length, 2);
    assert.match(sent[1].text, /تم تسجيل اهتمامك بالعرض رقم 2/);
    assert.match(sent[1].text, /يعتمده المكتب/);
    const second = s.body.results[1];
    const interest = [...h.store.docs.keys()].find((k) => k.startsWith(`offices/${OFFICE_A}/opportunities/${second.reference.split(":")[1]}/interests/`));
    assert.ok(interest, "the second choice is a real recorded interest");
    await webhook(4242, "ابغاه");
    assert.match(sent[2].text, /ما تأكدت أي عقار تقصد/, "an unclear reply is asked about, never guessed");
    await webhook(5151, "أبغى العرض الثاني");
    assert.equal(sent.length, 3, "an unrelated chat is not treated as this guest");
  } finally { globalThis.fetch = original; }
});
