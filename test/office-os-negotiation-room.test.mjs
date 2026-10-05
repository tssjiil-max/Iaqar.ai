// غرفة التفاوض — one room per deal, rules per property type and deal kind, through the real
// Worker (/os routes) on the in-memory Firestore double. Isolated test data only.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  FAMILY, canMarkReady, partyStatus, planTermAction, propertyFacts, propertyFamily, relaySafeText, roomAgreedItems, roomSchema, termRows
} from "../public/os/domain/negotiation-room-domain.js";
import { PROPERTY_TYPES } from "../public/os/domain/records-domain.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());

async function call(route, body, uid) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
let seq = 0;
const act = (token, action, extra = {}) => call("/os/session/act", { token, action, submissionId: `room-sub-${++seq}-${action}`.replace(/_/g, "-"), ...extra });
const view = async (token) => (await call("/os/session/view", { token })).body.session;
const journeyDoc = (id) => h.store.get(`offices/${OFFICE_A}/journeys/${id}`);
const events = (id) => h.store.list(`offices/${OFFICE_A}/journeys/${id}/events`);
const ops = () => h.store.list(`offices/${OFFICE_A}/operations`);
const active = (op) => ["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE"].includes(String(op.status));
const term = (session, id) => session.room.terms.find((row) => row.id === id);

/** A real approved deal for one property type and deal kind, with both room links. */
async function deal({ type, rent = false, price, budget, area = null, rooms = null }) {
  seq += 1;
  const district = `حي الغرفة ${seq}`;
  const offer = await call("/os/records/save", { officeId: OFFICE_A, requestKey: `room-off-${seq}`, record: { kind: "OFFER", purpose: rent ? "RENT" : "SALE", propertyType: type, city: "الرياض", district, price, area, rooms, contactName: "مالك الغرفة السري", contactPhone: `05512${String(40000 + seq)}` } }, OWNER_A);
  assert.equal(offer.status, 200, JSON.stringify(offer.body));
  const request = await call("/os/records/save", { officeId: OFFICE_A, requestKey: `room-req-${seq}`, record: { kind: "REQUEST", purpose: rent ? "LEASE_REQUEST" : "PURCHASE", propertyType: type, city: "الرياض", district, price: budget, contactName: "عميل الغرفة السري", contactPhone: `05513${String(40000 + seq)}` } }, OWNER_A);
  assert.equal(request.status, 200, JSON.stringify(request.body));
  const match = h.store.list(`offices/${OFFICE_A}/matches`).find((m) => m.offerId === offer.body.recordId && m.requestId === request.body.recordId);
  assert.ok(match, `match exists for ${type}`);
  const approved = await call("/os/review/decide", { officeId: OFFICE_A, matchId: match.id, decision: "approve" }, OWNER_A);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const links = await call("/os/session/links", { officeId: OFFICE_A, journeyId: approved.body.journeyId }, OWNER_A);
  return { journeyId: approved.body.journeyId, offerId: offer.body.recordId, owner: links.body.links.owner.url.split("#")[1], client: links.body.links.client.url.split("#")[1] };
}

// ------------------------------------------------------------------ rules

test("every property type of the project has a family, and the rules differ by family and by deal kind", () => {
  const families = Object.fromEntries(PROPERTY_TYPES.map((type) => [type, propertyFamily(type)]));
  assert.deepEqual(families, { "شقة": "UNIT", "فيلا": "VILLA", "دور": "UNIT", "دوبلكس": "VILLA", "أرض": "LAND", "عمارة": "BUILDING", "محل تجاري": "COMMERCIAL", "مكتب": "COMMERCIAL", "استراحة": "VILLA", "مستودع": "COMMERCIAL", "غرفة": "UNIT" });
  assert.equal(propertyFamily("شيء جديد"), FAMILY.OTHER, "an unknown type still gets a working room");
  const ids = (type, purpose) => roomSchema({ offerSummary: { propertyType: type, purpose } }).terms.map((t) => t.id);
  const rentOnly = ["rent_payments", "lease_term", "deposit", "activity_license"];
  const saleOnly = ["payment_method", "transfer_time", "land_pricing", "occupancy", "income_statement"];
  for (const type of PROPERTY_TYPES) {
    assert.ok(ids(type, "SALE").every((id) => !rentOnly.includes(id)), `${type}: no rent terms in a sale`);
    assert.ok(ids(type, "RENT").every((id) => !saleOnly.includes(id)), `${type}: no sale terms in a rent`);
    assert.ok(ids(type, "SALE").length >= 3 && ids(type, "RENT").length >= 3);
  }
  assert.ok(ids("شقة", "RENT").includes("furniture") && ids("شقة", "RENT").includes("rent_payments"));
  assert.ok(ids("أرض", "SALE").includes("land_pricing") && ids("أرض", "SALE").includes("land_use") && !ids("أرض", "SALE").includes("furniture") && !ids("أرض", "SALE").includes("handover"));
  assert.ok(ids("عمارة", "SALE").includes("occupancy") && ids("عمارة", "SALE").includes("income_statement") && !ids("عمارة", "SALE").includes("furniture"));
  assert.ok(ids("محل تجاري", "RENT").includes("activity_license"));
  assert.notDeepEqual(ids("شقة", "SALE"), ids("أرض", "SALE"));
  assert.notDeepEqual(ids("شقة", "SALE"), ids("شقة", "RENT"));
  const schema = (type, purpose) => roomSchema({ offerSummary: { propertyType: type, purpose } });
  assert.equal(schema("شقة", "RENT").priceLabel, "الإيجار السنوي");
  assert.equal(schema("أرض", "SALE").priceLabel, "السعر الإجمالي");
  assert.equal(schema("أرض", "SALE").viewingLabel, "زيارة الموقع");
  assert.equal(schema("فيلا", "SALE").viewingLabel, "المعاينة");
  assert.notDeepEqual(schema("أرض", "SALE").infoTopics, schema("عمارة", "SALE").infoTopics);
  assert.equal(schema("شقة", "SALE").terms.find((t) => t.id === "commission").options[0].label, "على المشتري");
  assert.equal(schema("شقة", "RENT").terms.find((t) => t.id === "commission").options[0].label, "على المستأجر");
});

test("property data fits the kind of property: no rooms for a land, per-metre price for a land", () => {
  const facts = (summary) => Object.fromEntries(propertyFacts({ offerSummary: summary }).map((fact) => [fact.id, fact]));
  const land = facts({ propertyType: "أرض", purpose: "SALE", city: "الرياض", district: "العارض", price: 1500000, area: 600, rooms: 4 });
  assert.equal(land.rooms, undefined, "rooms never shown for a land");
  assert.equal(land.per_meter.value, "2,500 ريال");
  assert.equal(land.area.label, "مساحة الأرض");
  const flat = facts({ propertyType: "شقة", purpose: "RENT", city: "الرياض", district: "حي الملقا", price: 60000, area: 140, rooms: 3 });
  assert.equal(flat.rooms.value, "3");
  assert.equal(flat.per_meter, undefined);
  assert.equal(flat.price.label, "الإيجار السنوي المطلوب");
  assert.equal(flat.deal.value, "إيجار");
  assert.equal(flat.place.value, "الرياض - حي الملقا");
  const building = facts({ propertyType: "عمارة", purpose: "SALE", city: "جدة", district: "الروضة", price: 5000000, rooms: 12 });
  assert.equal(building.rooms, undefined, "rooms do not describe a building");
  assert.equal(building.area, undefined, "an unknown value is not shown as an empty field");
});

test("a proposal is not an agreement: the term state machine", () => {
  const now = new Date("2026-10-05T10:00:00Z");
  let journey = { status: "ACTIVE", offerSummary: { propertyType: "شقة", purpose: "RENT", price: 60000 }, session: {} };
  const apply = (input) => { const planned = planTermAction(journey, { now, ...input }); if (planned.ok) journey = { ...journey, session: { ...journey.session, terms: planned.terms } }; return planned; };
  assert.equal(apply({ role: "client", action: "term_accept", termId: "rent_payments" }).ok, false, "nothing to accept yet");
  assert.equal(apply({ role: "owner", action: "term_propose", termId: "payment_method", optionId: "cash" }).code, "term_unknown", "a sale term does not exist in a rent room");
  assert.equal(apply({ role: "owner", action: "term_propose", termId: "rent_payments", optionId: "weekly" }).code, "option_unknown");
  assert.equal(apply({ role: "owner", action: "term_propose", termId: "rent_payments", optionId: "two" }).ok, true);
  assert.equal(roomAgreedItems(journey, now).length, 0, "a proposal never appears as agreed");
  assert.equal(apply({ role: "owner", action: "term_accept", termId: "rent_payments" }).ok, false, "a side cannot accept its own proposal");
  assert.deepEqual(termRows(journey, "client").find((r) => r.id === "rent_payments").actions, ["accept", "reject", "propose"]);
  assert.deepEqual(termRows(journey, "owner").find((r) => r.id === "rent_payments").actions, ["propose"]);
  assert.deepEqual(termRows(journey, "broker").find((r) => r.id === "rent_payments").actions, [], "the broker watches; the sides decide");
  assert.equal(partyStatus(journey, "client", { now }).turn, "ACT");
  assert.ok(partyStatus(journey, "client", { now }).items.includes("دفعات الإيجار"));
  // Counter-proposal, then acceptance by the other side.
  assert.equal(apply({ role: "client", action: "term_propose", termId: "rent_payments", optionId: "four" }).ok, true);
  const accepted = apply({ role: "owner", action: "term_accept", termId: "rent_payments" });
  assert.equal(accepted.applied.agreed, true);
  const agreed = roomAgreedItems(journey, now).find((item) => item.id === "term:rent_payments");
  assert.equal(agreed.value, "أربع دفعات");
  assert.match(agreed.meta, /وافق المالك/);
  // A change needs a new agreement; until then the agreed value stays in force.
  assert.equal(apply({ role: "client", action: "term_propose", termId: "rent_payments", optionId: "four" }).code, "term_unchanged");
  assert.equal(apply({ role: "client", action: "term_propose", termId: "rent_payments", optionId: "monthly" }).applied.replaces, "أربع دفعات");
  const changing = roomAgreedItems(journey, now).find((item) => item.id === "term:rent_payments");
  assert.equal(changing.value, "أربع دفعات", "still the agreed value");
  assert.match(changing.changing, /طلب العميل تعديله إلى «شهريًا»/);
  assert.equal(apply({ role: "owner", action: "term_reject", termId: "rent_payments" }).ok, true);
  assert.equal(roomAgreedItems(journey, now).find((item) => item.id === "term:rent_payments").changing, "");
  assert.equal(canMarkReady(journey, "owner"), false, "no «جاهز للاتفاق» before the price is agreed");
  assert.equal(planTermAction({ ...journey, status: "PAUSED" }, { role: "owner", action: "term_propose", termId: "lease_term", optionId: "one_year", now }).code, "room_not_live");
  assert.equal(planTermAction({ ...journey, status: "CLOSED_WON" }, { role: "owner", action: "term_propose", termId: "lease_term", optionId: "one_year", now }).ok, false);
  assert.equal(relaySafeText("كلمني على 0551234567 او https://wa.me/966551234567 ضروري"), "كلمني على او ضروري");
});

// ------------------------------------------------------------------ one real room per main property type

const SCENARIOS = [
  { name: "شقة للإيجار", type: "شقة", rent: true, price: 60000, budget: 62000, area: 140, rooms: 3, family: "UNIT", termId: "rent_payments", option: "four", optionLabel: "أربع دفعات", absent: "payment_method" },
  { name: "أرض للبيع", type: "أرض", price: 1500000, budget: 1550000, area: 600, family: "LAND", termId: "land_pricing", option: "per_meter", optionLabel: "حسب سعر المتر", absent: "furniture" },
  { name: "عمارة للبيع", type: "عمارة", price: 5000000, budget: 5200000, family: "BUILDING", termId: "occupancy", option: "with_tenants", optionLabel: "مع المستأجرين الحاليين", absent: "rent_payments" },
  { name: "فيلا للبيع", type: "فيلا", price: 2400000, budget: 2500000, area: 420, rooms: 5, family: "VILLA", termId: "furniture", option: "kitchen_ac", optionLabel: "المطبخ والمكيفات فقط", absent: "land_use" },
  { name: "محل تجاري للإيجار", type: "محل تجاري", rent: true, price: 90000, budget: 95000, area: 80, family: "COMMERCIAL", termId: "activity_license", option: "tenant", optionLabel: "على المستأجر", absent: "furniture" }
];

for (const scenario of SCENARIOS) {
  test(`room for «${scenario.name}»: its own data, its own terms, proposal → answer → «ما تم الاتفاق عليه»`, async () => {
    const d = await deal(scenario);
    const owner = await view(d.owner);
    assert.equal(owner.room.family, scenario.family);
    assert.equal(owner.room.deal, scenario.rent ? "rent" : "sale");
    assert.ok(term(owner, scenario.termId), "the term of this property is offered");
    assert.equal(term(owner, scenario.absent), undefined, "a term of another kind of property is not offered");
    assert.ok(owner.room.facts.some((fact) => fact.id === "type" && fact.value === scenario.type));
    assert.equal(owner.room.facts.some((fact) => fact.id === "rooms"), Boolean(scenario.rooms) && ["UNIT", "VILLA"].includes(scenario.family));
    assert.deepEqual(owner.room.agreed, [], "nothing agreed at the start");

    const proposed = await act(d.owner, "term_propose", { termId: scenario.termId, optionId: scenario.option });
    assert.equal(proposed.status, 200, JSON.stringify(proposed.body));
    const client = await view(d.client);
    assert.equal(term(client, scenario.termId).pending.label, scenario.optionLabel);
    assert.equal(term(client, scenario.termId).pending.by, "owner");
    assert.deepEqual(term(client, scenario.termId).actions, ["accept", "reject", "propose"]);
    assert.equal(client.room.status.client.turn, "ACT", "the client is told an answer is expected");
    assert.ok(!client.room.agreed.some((item) => item.id === `term:${scenario.termId}`), "an unanswered proposal is not an agreement");

    const foreign = await act(d.owner, "term_propose", { termId: scenario.absent, optionId: "cash" });
    assert.equal(foreign.status, 400, "a term outside this property's rules is refused by the server");
    assert.equal((await act(d.owner, "term_accept", { termId: scenario.termId })).status, 409, "a side cannot accept its own proposal");

    const accepted = await act(d.client, "term_accept", { termId: scenario.termId });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    const after = await view(d.owner);
    const agreed = after.room.agreed.find((item) => item.id === `term:${scenario.termId}`);
    assert.equal(agreed.value, scenario.optionLabel);
    assert.match(agreed.meta, /وافق العميل/);
    assert.equal(term(after, scenario.termId).state, "AGREED");
    const saved = journeyDoc(d.journeyId).session.terms[scenario.termId].agreed;
    assert.equal(saved.acceptedBy, "client");
    assert.equal(saved.proposedBy, "owner");
    assert.ok(saved.at, "the time of the agreement is kept");
    const moves = events(d.journeyId).filter((event) => event.type === "SESSION_MOVE").sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || (JSON.parse(a.payloadJson).move === "term_propose" ? -1 : 1)).map((event) => JSON.parse(event.payloadJson));
    assert.deepEqual(moves.map((m) => m.move), ["term_propose", "term_accept"]);
    assert.equal(moves[1].termPrev, "PENDING");
    assert.equal(moves[1].termNext, "AGREED");
    assert.ok(moves[1].prev && moves[1].next, "the deal state before and after is recorded");
    const json = JSON.stringify(after);
    for (const secret of ["0551", "مالك الغرفة", "عميل الغرفة", d.journeyId, d.offerId]) assert.ok(!json.includes(secret), `leak: ${secret}`);
  });
}

// ------------------------------------------------------------------ the full journey of one room

const room = {};

test("journey 1 — the owner proposes a price, the client answers, the agreed price moves to «ما تم الاتفاق عليه»", async () => {
  Object.assign(room, await deal({ type: "شقة", price: 1200000, budget: 1100000, area: 150, rooms: 4 }));
  const owner = await view(room.owner);
  assert.equal(owner.room.status.owner.turn, "ACT");
  assert.equal((await act(room.owner, "manual", { price: "1,180,000" })).status, 200);
  const client = await view(room.client);
  assert.equal(client.room.status.client.turn, "ACT");
  assert.equal(client.room.status.owner.turn, "WAIT");
  assert.ok(client.room.status.client.items.includes("السعر"));
  assert.deepEqual(client.room.agreed, [], "a proposed price is not an agreed price");
  assert.equal(client.room.canReady, false);
  assert.equal((await act(room.owner, "manual", { price: "1,170,000" })).status, 409, "not the owner's turn");
  assert.equal((await act(room.client, "manual", { price: "1,150,000" })).status, 200);
  assert.equal((await act(room.owner, "accept")).status, 200);
  const agreed = (await view(room.client)).room.agreed.find((item) => item.id === "price");
  assert.equal(agreed.value, "1,150,000 ريال");
  assert.match(agreed.meta, /وافق المالك/);
});

test("journey 2 — a side asks the broker to step in; the message reaches the broker only", async () => {
  const sent = await act(room.client, "intervention", { message: "أحتاج مهلة أسبوع للتمويل، كلمني 0551234567" });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const journey = journeyDoc(room.journeyId);
  const request = journey.session.requests.find((item) => item.kind === "intervention");
  assert.equal(request.role, "client");
  assert.equal(request.status, "OPEN");
  assert.match(request.text, /مهلة أسبوع/);
  assert.ok(request.at, "the time is kept");
  room.requestId = request.id;
  const task = ops().find((op) => op.type === "SESSION_INTERVENTION" && op.journeyId === room.journeyId && active(op));
  assert.ok(task, "the broker gets a task for this deal");
  assert.equal(task.priority, "HIGH");
  assert.ok(h.store.list(`offices/${OFFICE_A}/notifications`).some((n) => String(n.title).startsWith("تدخل مطلوب")));
  const ownerView = await view(room.owner);
  assert.ok(!JSON.stringify(ownerView).includes("مهلة أسبوع") && !ownerView.events.some((event) => /تدخل الوسيط/.test(event.text)) && ownerView.intervention === false, "the other side sees nothing of it");
  assert.deepEqual(ownerView.room.requests, [], "a side is shown its own requests only");
  const client = await view(room.client);
  assert.equal(client.room.requests[0].statusLabel, "لدى الوسيط");
  assert.equal(client.intervention, true);
});

test("journey 3 — the broker passes it on: marked as passed on by the broker, without the phone number", async () => {
  const foreign = await call("/os/session/request", { officeId: OFFICE_A, journeyId: room.journeyId, requestId: room.requestId, decision: "forward" }, OWNER_B);
  assert.equal(foreign.status, 403, "another office cannot touch this room");
  assert.equal((await call("/os/session/request", { officeId: OFFICE_B, journeyId: room.journeyId, requestId: room.requestId, decision: "forward" }, OWNER_B)).status, 404);
  assert.equal((await call("/os/session/request", { officeId: OFFICE_A, journeyId: room.journeyId, requestId: room.requestId, decision: "burn" }, OWNER_A)).status, 400);
  const done = await call("/os/session/request", { officeId: OFFICE_A, journeyId: room.journeyId, requestId: room.requestId, decision: "forward" }, OWNER_A);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const owner = await view(room.owner);
  const passed = owner.events.find((event) => /نقل الوسيط عن العميل/.test(event.text));
  assert.ok(passed, "the owner reads it as passed on by the broker");
  assert.equal(passed.who, "الوسيط", "never shown as said directly by the client");
  assert.ok(passed.text.includes("مهلة أسبوع") && !passed.text.includes("0551234567"), "phone numbers never pass between the sides");
  const journey = journeyDoc(room.journeyId);
  const request = journey.session.requests.find((item) => item.id === room.requestId);
  assert.equal(request.status, "HANDLED");
  assert.equal(request.decision, "forward");
  assert.equal(request.handledBy, OWNER_A);
  assert.equal(journey.session.intervention.required, false);
  assert.equal(ops().filter((op) => op.type === "SESSION_INTERVENTION" && op.journeyId === room.journeyId && active(op)).length, 0, "the task is finished");
  const log = events(room.journeyId).filter((event) => event.type === "SESSION_REQUEST_HANDLED").map((event) => JSON.parse(event.payloadJson));
  assert.equal(log.length, 1);
  assert.equal(log[0].decision, "forward");
  assert.equal(log[0].requestRole, "client");
  assert.ok((await view(room.client)).events.some((event) => event.text === "تابع الوسيط طلبك"));
  assert.ok(!JSON.stringify(owner.events).includes("تابع الوسيط طلبك"), "the decision log is not shown to the other side");
  const again = await call("/os/session/request", { officeId: OFFICE_A, journeyId: room.journeyId, requestId: room.requestId, decision: "forward" }, OWNER_A);
  assert.equal(again.body.duplicate, true, "a request is handled once");
  assert.equal(events(room.journeyId).filter((event) => event.type === "SESSION_BROKER_MESSAGE").length, 1, "and passed on once");
});

test("journey 4 — reply to the sender, own wording to the other side, or not passed on at all", async () => {
  const ids = [];
  for (const message of ["هل يقبل المالك تأجيل الإفراغ؟", "السعر مبالغ فيه", "رسالة لا تُمرَّر"]) {
    assert.equal((await act(room.client, "intervention", { message })).status, 200);
    ids.push(journeyDoc(room.journeyId).session.requests.at(-1).id);
  }
  assert.equal((await act(room.client, "intervention", { message: "رابعة" })).status, 409, "no more than three waiting requests from one side");
  assert.equal((await view(room.client)).room.canRequest, false);
  const send = (requestId, decision, text) => call("/os/session/request", { officeId: OFFICE_A, journeyId: room.journeyId, requestId, decision, text }, OWNER_A);
  assert.equal((await send(ids[0], "reply", "")).status, 400, "a reply needs text");
  assert.equal((await send(ids[0], "reply", "سأسأل المالك وأعود إليك اليوم")).status, 200);
  assert.equal((await send(ids[1], "rephrase", "العميل يرى أن السعر يحتاج مراجعة بسيطة")).status, 200);
  assert.equal((await send(ids[2], "dismiss")).status, 200);
  const owner = JSON.stringify((await view(room.owner)).events);
  const client = JSON.stringify((await view(room.client)).events);
  assert.ok(client.includes("سأسأل المالك") && !owner.includes("سأسأل المالك"), "the reply reaches the sender only");
  assert.ok(owner.includes("يحتاج مراجعة بسيطة") && !owner.includes("مبالغ فيه"), "the owner gets the broker's wording, not the client's");
  assert.ok(!owner.includes("نقل الوسيط عن العميل: «العميل يرى"), "the broker's own wording is not put in the client's mouth");
  assert.ok(!owner.includes("لا تُمرَّر"), "a dismissed message never reaches the other side");
  const decisions = events(room.journeyId).filter((event) => event.type === "SESSION_REQUEST_HANDLED").map((event) => JSON.parse(event.payloadJson).decision);
  assert.deepEqual(decisions.sort(), ["dismiss", "forward", "rephrase", "reply"], "every intervention of the broker is in his log");
  assert.equal((await view(room.client)).room.canRequest, true);
});

test("journey 5 — information request: a fixed topic, to the broker", async () => {
  assert.equal((await act(room.client, "info_request", { topicId: "units" })).status, 400, "a topic of another kind of property is refused");
  assert.equal((await act(room.client, "info_request", { topicId: "age" })).status, 200);
  const request = journeyDoc(room.journeyId).session.requests.at(-1);
  assert.equal(request.kind, "info");
  assert.equal(request.topicLabel, "عمر العقار");
  const task = ops().find((op) => op.type === "SESSION_INTERVENTION" && op.journeyId === room.journeyId && active(op));
  assert.match(JSON.stringify(task), /طلب العميل معلومة: عمر العقار/);
  assert.ok(!(await view(room.owner)).events.some((event) => /طلب معلومة/.test(event.text)), "the owner is not shown the client's request");
  assert.equal((await call("/os/session/request", { officeId: OFFICE_A, journeyId: room.journeyId, requestId: request.id, decision: "reply", text: "عمر العقار خمس سنوات" }, OWNER_A)).status, 200);
});

test("journey 6 — terms continue after the price; «جاهز للاتفاق» needs an agreed price and no waiting proposal", async () => {
  assert.equal((await act(room.client, "term_propose", { termId: "payment_method", optionId: "bank" })).status, 200);
  assert.equal((await view(room.client)).room.canReady, false, "a waiting proposal blocks «جاهز للاتفاق»");
  assert.equal((await act(room.client, "ready")).status, 409);
  assert.equal((await act(room.owner, "term_reject", { termId: "payment_method" })).status, 200);
  assert.equal((await act(room.owner, "term_propose", { termId: "payment_method", optionId: "mixed" })).status, 200);
  assert.equal((await act(room.client, "term_accept", { termId: "payment_method" })).status, 200);
  const client = await view(room.client);
  assert.equal(client.room.canReady, true);
  assert.equal((await act(room.client, "ready")).status, 200);
  assert.equal((await view(room.owner)).room.ready.other, true);
  assert.equal(ops().filter((op) => op.type === "DEAL_ACTION" && op.journeyId === room.journeyId && /جاهزان/.test(JSON.stringify(op))).length, 0, "one side alone is not an agreement");
  assert.equal((await act(room.owner, "ready")).status, 200);
  const journey = journeyDoc(room.journeyId);
  assert.ok(journey.session.ready.owner && journey.session.ready.client);
  assert.ok(ops().some((op) => op.type === "DEAL_ACTION" && op.journeyId === room.journeyId && active(op) && /جاهزان/.test(JSON.stringify(op))), "the broker is told both sides are ready");
  assert.ok((await view(room.owner)).room.agreed.some((item) => item.id === "ready"));
  // A new proposal reopens the agreement.
  assert.equal((await act(room.owner, "term_propose", { termId: "transfer_time", optionId: "month" })).status, 200);
  assert.deepEqual(journeyDoc(room.journeyId).session.ready, {});
  assert.equal((await act(room.client, "term_accept", { termId: "transfer_time" })).status, 200);
});

test("journey 7 — agreeing on the viewing moves the deal to the viewing stage; the room stops with the deal", async () => {
  const client = await view(room.client);
  assert.equal(client.dealPhase, "VIEWING_SCHEDULING");
  const pick = client.actions.find((action) => action.id === "viewing_pick");
  assert.equal(pick.label, "طلب معاينة");
  const slot = client.slots[0].slots[0];
  assert.equal((await act(room.client, "viewing_pick", { viewingAt: slot })).status, 200);
  const owner = await view(room.owner);
  assert.ok(owner.room.status.owner.items.includes("المعاينة"));
  assert.equal((await act(room.owner, "viewing_ok")).status, 200);
  const journey = journeyDoc(room.journeyId);
  assert.equal(journey.phase, "VIEWING");
  assert.equal(journey.viewing.state, "CONFIRMED");
  assert.equal(h.store.get(`offices/${OFFICE_A}/matches/${journey.matchId}`).appointmentStatus, "CONFIRMED_BY_BROKER", "a viewing booked by both sides gets its reminders");
  const agreed = (await view(room.client)).room.agreed.map((item) => item.id);
  assert.ok(agreed.includes("price") && agreed.includes("viewing") && agreed.includes("term:payment_method") && agreed.includes("term:transfer_time"));
  // Every room belongs to one office: no other office reads or drives it.
  assert.equal((await call("/os/session/links", { officeId: OFFICE_A, journeyId: room.journeyId }, OWNER_B)).status, 403);
  assert.equal((await call("/os/session/message", { officeId: OFFICE_A, journeyId: room.journeyId, audience: "both", text: "تجربة" }, OWNER_B)).status, 403);
  const closed = await call("/os/journeys/close", { officeId: OFFICE_A, journeyId: room.journeyId, outcome: "LOST", reason: "اختبار" }, OWNER_A);
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal((await act(room.client, "term_propose", { termId: "handover", optionId: "month" })).body.state, "CLOSED");
  assert.equal((await call("/os/session/view", { token: room.client })).body.state, "CLOSED", "the history stays readable after closing");
});
