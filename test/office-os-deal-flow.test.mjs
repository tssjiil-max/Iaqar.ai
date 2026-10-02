// رحلة العقار الموحدة — the spec's journey tests (TEST 1–8), on the real Worker (/os routes)
// with the in-memory Firestore double. Isolated test data only.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OWNER_A } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const { PHASE, journeyPhase, checkBrokerAvailability, brokerBusy, availableSlots, VIEWING_MINUTES } = await import(path.join(ROOT, "public/os/domain/deal-flow-domain.js"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());

async function call(route, body, uid) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const tokenOf = (url) => String(url).split("#")[1];
const journeyDoc = (id) => h.store.get(`offices/${OFFICE_A}/journeys/${id}`);
const record = (id) => h.store.get(`offices/${OFFICE_A}/opportunities/${id}`) || h.store.list(`offices/${OFFICE_A}/opportunities`).find((r) => r.id === id);
const ops = () => h.store.list(`offices/${OFFICE_A}/operations`);
const activeOp = (op) => ["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE"].includes(String(op.status));
let seq = 0;
const act = (token, action, extra = {}) => call("/os/session/act", { token, action, submissionId: `flow-${++seq}-${action}`.replace(/_/g, "-"), ...extra });
const view = async (token) => (await call("/os/session/view", { token })).body.session;

/** One approved deal in its own district (so deals never cross-match). */
async function deal(district, { fixed = false, ownerPrice = "1,200,000", clientPrice = "1,100,000" } = {}) {
  const request = await call("/os/records/save", { officeId: OFFICE_A, requestKey: `r-${district}`, record: {
    kind: "REQUEST", purpose: "PURCHASE", propertyType: "فيلا", city: "الرياض", district, price: clientPrice, contactName: "عميل تجربة", contactPhone: "0551239001"
  } }, OWNER_A);
  const offer = await call("/os/records/save", { officeId: OFFICE_A, requestKey: `o-${district}`, record: {
    kind: "OFFER", purpose: "SALE", propertyType: "فيلا", city: "الرياض", district, price: ownerPrice, priceStatus: fixed ? "FIXED" : "NEGOTIABLE", contactName: "مالك تجربة", contactPhone: "0551239002"
  } }, OWNER_A);
  assert.equal(offer.status, 200, JSON.stringify(offer.body));
  const match = h.store.list(`offices/${OFFICE_A}/matches`).find((m) => m.offerId === offer.body.recordId && m.requestId === request.body.recordId);
  assert.ok(match, `match exists in ${district}`);
  const approved = await call("/os/review/decide", { officeId: OFFICE_A, matchId: match.id, decision: "approve" }, OWNER_A);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const links = (await call("/os/session/links", { officeId: OFFICE_A, journeyId: approved.body.journeyId }, OWNER_A)).body.links;
  return { journeyId: approved.body.journeyId, matchId: match.id, offerId: offer.body.recordId, requestId: request.body.recordId, owner: tokenOf(links.owner.url), client: tokenOf(links.client.url) };
}

async function book(d) {
  const v = await view(d.client);
  const slot = v.slots[0].slots[0];
  assert.equal((await act(d.client, "viewing_pick", { viewingAt: slot })).status, 200);
  const ok = await act(d.owner, "viewing_ok");
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  return slot;
}

const ctx = {};

test("the offer keeps the owner's price decision (السعر ثابت / قابل للتفاوض)", async () => {
  ctx.fixed = await deal("النخيل", { fixed: true });
  assert.equal(record(ctx.fixed.offerId).priceStatus, "FIXED");
  assert.equal(journeyDoc(ctx.fixed.journeyId).offerSummary.priceStatus, "FIXED");
  const v = await view(ctx.fixed.client);
  assert.equal(v.property.priceStatusLabel, "السعر ثابت");
  assert.equal(v.dealPhase, PHASE.PRICE_DECISION);
  assert.deepEqual(v.actions.filter((a) => a.group === "main").map((a) => a.id), ["accept_fixed", "decline_fixed"], "no price negotiation on a fixed price");
  assert.equal((await view(ctx.fixed.owner)).waiting, true);
});

test("TEST 1 — fixed price accepted → PRICE_NEGOTIATION skipped → VIEWING_SCHEDULING", async () => {
  const res = await act(ctx.fixed.client, "accept_fixed");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const j = journeyDoc(ctx.fixed.journeyId);
  assert.equal(journeyPhase(j), PHASE.VIEWING_SCHEDULING);
  assert.equal(j.session.agreedPrice, 1200000);
  const v = await view(ctx.fixed.client);
  assert.deepEqual(v.agreed.map((a) => a.value), ["1,200,000 ريال"]);
  assert.ok(!v.actions.some((a) => ["accept", "adjust", "minus2", "minus5"].includes(a.id)));
});

test("fixed price declined → only this match closes; offer and request stay available", async () => {
  const d = await deal("الغدير", { fixed: true });
  const res = await act(d.client, "decline_fixed");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const j = journeyDoc(d.journeyId);
  assert.equal(j.status, "CLOSED_LOST");
  assert.match(j.outcome.reason, /السعر ثابت/);
  assert.equal(String(record(d.offerId).lifecycleStatus || "ACTIVE").toUpperCase(), "ACTIVE");
  assert.equal(String(record(d.requestId).lifecycleStatus || "ACTIVE").toUpperCase(), "ACTIVE");
  assert.ok(!ops().some((op) => op.journeyId === d.journeyId && activeOp(op)), "no task left for the closed match");
  assert.equal((await call("/os/session/view", { token: d.client })).body.state, "CLOSED");
});

test("TEST 2 — negotiable: client offers a price, owner accepts → «تم الاتفاق عليه» → VIEWING_SCHEDULING", async () => {
  ctx.neg = await deal("الربيع");
  const start = await view(ctx.neg.client);
  assert.equal(start.dealPhase, PHASE.PRICE_NEGOTIATION);
  assert.deepEqual(start.actions.filter((a) => a.group === "main").map((a) => a.id), ["accept", "adjust"]);
  assert.equal((await act(ctx.neg.client, "manual", { price: "1,150,000" })).status, 200);
  const owner = await view(ctx.neg.owner);
  assert.deepEqual(owner.actions.filter((a) => a.group === "main").map((a) => a.id), ["accept", "adjust", "reject"], "قبول / تعديل العرض / رفض");
  assert.equal((await act(ctx.neg.owner, "accept")).status, 200);
  const j = journeyDoc(ctx.neg.journeyId);
  assert.equal(j.session.agreedPrice, 1150000);
  assert.equal(journeyPhase(j), PHASE.VIEWING_SCHEDULING);
  assert.deepEqual((await view(ctx.neg.owner)).agreed.map((a) => a.id), ["price"]);
});

test("TEST 3 — a slot that clashes with the broker's other viewing is not offered and cannot be confirmed", async () => {
  // Deal A (fixed, price agreed) books the first free slot.
  const slot = await book(ctx.fixed);
  // Deal B (same broker) no longer sees that slot…
  const b = await view(ctx.neg.client);
  assert.ok(!b.slots.some((d) => d.slots.includes(slot)), "the booked slot is not offered");
  const direct = await act(ctx.neg.client, "viewing_pick", { viewingAt: slot });
  assert.equal(direct.status, 409, "a clashing slot cannot be proposed");
  // …and a proposal made before A booked is re-checked at the moment of confirmation.
  const c = await deal("الوادي");
  assert.equal((await act(c.client, "manual", { price: "1,150,000" })).status, 200);
  assert.equal((await act(c.owner, "accept")).status, 200);
  const cSlots = (await view(c.client)).slots;
  const shared = cSlots[0].slots.find((s) => b.slots.some((d) => d.slots.includes(s)));
  assert.equal((await act(c.client, "viewing_pick", { viewingAt: shared })).status, 200);
  assert.equal((await act(ctx.neg.client, "viewing_pick", { viewingAt: shared })).status, 200);
  assert.equal((await act(ctx.neg.owner, "viewing_ok")).status, 200, "first confirmation books the slot");
  const late = await act(c.owner, "viewing_ok");
  assert.equal(late.status, 409, "the second confirmation of the same time is refused");
  assert.match(late.body.message, /لم يعد متاحًا/);
  // Pure rule used by both: overlap ⇒ not available.
  const busy = brokerBusy([journeyDoc(ctx.fixed.journeyId)], journeyDoc(ctx.fixed.journeyId).assignedBrokerId);
  const s = new Date(slot);
  assert.equal(checkBrokerAvailability(busy, s, new Date(s.getTime() + VIEWING_MINUTES * 60000)).ok, false);
  assert.equal(checkBrokerAvailability(busy, new Date(s.getTime() + VIEWING_MINUTES * 60000), new Date(s.getTime() + 2 * VIEWING_MINUTES * 60000)).ok, true);
  assert.ok(!availableSlots(busy, new Date()).some((d) => d.slots.includes(slot)));
});

test("TEST 4 — booked viewing → «تم الاتفاق عليه» and the phase follows the time (VIEWING → VIEWING_RESULT)", async () => {
  const j = journeyDoc(ctx.fixed.journeyId);
  assert.equal(j.viewing.state, "CONFIRMED");
  assert.equal(journeyPhase(j), PHASE.VIEWING);
  const after = new Date(new Date(j.viewing.at).getTime() + (VIEWING_MINUTES + 1) * 60000);
  assert.equal(journeyPhase(j, after), PHASE.VIEWING_RESULT);
  assert.deepEqual((await view(ctx.fixed.client)).agreed.map((a) => a.id), ["price", "viewing"]);
});

test("TEST 5 — result «مناسب» → FINAL_AGREEMENT", async () => {
  const res = await call("/os/journeys/viewing/result", { officeId: OFFICE_A, journeyId: ctx.fixed.journeyId, result: "interested" }, OWNER_A);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(journeyPhase(journeyDoc(ctx.fixed.journeyId)), PHASE.FINAL_AGREEMENT);
  assert.ok(ops().some((op) => op.journeyId === ctx.fixed.journeyId && op.type === "DEAL_ACTION" && activeOp(op)));
});

test("TEST 6 — result «يحتاج تفاوض» reopens the price only (no restart), then goes straight to the final step", async () => {
  const d = ctx.neg; // booked in TEST 3
  const res = await call("/os/journeys/viewing/result", { officeId: OFFICE_A, journeyId: d.journeyId, result: "needs_negotiation" }, OWNER_A);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const j = journeyDoc(d.journeyId);
  assert.equal(journeyPhase(j), PHASE.PRICE_NEGOTIATION);
  assert.equal(j.viewing.state, "DONE", "the viewing is not redone");
  const v = await view(d.client);
  assert.deepEqual(v.agreed.map((a) => a.id), ["viewing"], "only the price left «تم الاتفاق عليه»");
  assert.equal((await act(d.client, "manual", { price: "1,120,000" })).status, 200);
  assert.equal((await act(d.owner, "accept")).status, 200);
  assert.equal(journeyPhase(journeyDoc(d.journeyId)), PHASE.FINAL_AGREEMENT, "no second viewing scheduling");
});

test("TEST 7 — result «غير مناسب» closes this match only; offer and request stay in their normal state", async () => {
  const d = await deal("الملز");
  assert.equal((await act(d.client, "manual", { price: "1,150,000" })).status, 200);
  assert.equal((await act(d.owner, "accept")).status, 200);
  await book(d);
  const res = await call("/os/journeys/viewing/result", { officeId: OFFICE_A, journeyId: d.journeyId, result: "not_suitable" }, OWNER_A);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(journeyDoc(d.journeyId).status, "CLOSED_LOST");
  assert.equal(h.store.get(`offices/${OFFICE_A}/matches/${d.matchId}`).status, "closed");
  assert.equal(String(record(d.offerId).lifecycleStatus || "ACTIVE").toUpperCase(), "ACTIVE");
  assert.equal(String(record(d.requestId).lifecycleStatus || "ACTIVE").toUpperCase(), "ACTIVE");
  const bad = await call("/os/journeys/viewing/result", { officeId: OFFICE_A, journeyId: ctx.neg.journeyId, result: "follow_later" }, OWNER_A);
  assert.equal(bad.status, 400, "only three results exist");
});

test("TEST 8 — one card per open deal, with one phase and one action", () => {
  const open = h.store.list(`offices/${OFFICE_A}/journeys`).filter((j) => ["ACTIVE", "PAUSED"].includes(j.status));
  assert.ok(open.length >= 2);
  for (const j of open) {
    const cards = ops().filter((op) => op.journeyId === (j.journeyId || j.id) && op.type === "DEAL_JOURNEY" && activeOp(op));
    assert.equal(cards.length, 1, `exactly one card for ${j.journeyId}`);
    const meta = JSON.parse(cards[0].metadataJson || "{}");
    assert.equal(meta.journeyPhase, journeyPhase(j));
    assert.ok(cards[0].recommendedActionText, "the one action is named");
  }
  const closed = h.store.list(`offices/${OFFICE_A}/journeys`).filter((j) => String(j.status).startsWith("CLOSED"));
  for (const j of closed) assert.ok(!ops().some((op) => op.journeyId === (j.journeyId || j.id) && op.type === "DEAL_JOURNEY" && activeOp(op)), "closed deals have no card");
});
