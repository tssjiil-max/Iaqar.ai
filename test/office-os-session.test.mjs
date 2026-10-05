// جلسة التفاوض — the real Worker (/os routes) on the in-memory Firestore double.
// Isolated test data only.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OWNER_A, OWNER_B } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const { availableActions, parseTypedPrice, roundPrice, sessionStageLabel } = await import(path.join(ROOT, "public/os/domain/session-domain.js"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());

async function call(route, body, uid) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const tokenOf = (url) => String(url).split("#")[1];
const ops = () => h.store.list(`offices/${OFFICE_A}/operations`);
const active = (op) => ["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE"].includes(String(op.status));
const events = () => h.store.list(`offices/${OFFICE_A}/journeys/${ctx.journeyId}/events`);
const ctx = {};
let sub = 0;
const act = (token, action, extra = {}) => call("/os/session/act", { token, action, submissionId: `test-sub-${++sub}-${action}`.replace(/_/g, "-"), ...extra });

test("setup: approved deal between an owner at 1,200,000 and a client at 1,100,000", async () => {
  const request = await call("/os/records/save", { officeId: OFFICE_A, requestKey: "s-req", record: {
    kind: "REQUEST", purpose: "PURCHASE", propertyType: "شقة", city: "الرياض", district: "الملقا", price: "1,100,000", contactName: "خالد العميل السري", contactPhone: "0551230001"
  } }, OWNER_A);
  const offer = await call("/os/records/save", { officeId: OFFICE_A, requestKey: "s-off", record: {
    kind: "OFFER", purpose: "SALE", propertyType: "شقة", city: "الرياض", district: "الملقا", price: "1,200,000", contactName: "فهد المالك السري", contactPhone: "0551230002"
  } }, OWNER_A);
  assert.equal(request.status, 200, JSON.stringify(request.body));
  const match = h.store.list(`offices/${OFFICE_A}/matches`).find((m) => m.offerId === offer.body.recordId && m.requestId === request.body.recordId);
  assert.ok(match, "match exists");
  const approved = await call("/os/review/decide", { officeId: OFFICE_A, matchId: match.id, decision: "approve" }, OWNER_A);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  ctx.journeyId = approved.body.journeyId;
  h.store.seed(`offices/${OFFICE_A}/devices/session-test-phone`, { fcmRegistrationId: "fid-session-test", registrationType: "fid", userUid: OWNER_A, enabled: true });
  ctx.recordIds = [offer.body.recordId, request.body.recordId, match.id];
});

test("broker gets two different secure links; other offices cannot", async () => {
  const res = await call("/os/session/links", { officeId: OFFICE_A, journeyId: ctx.journeyId }, OWNER_A);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { owner, client } = res.body.links;
  assert.match(owner.url, /\/s#[A-Za-z0-9_-]{43}$/);
  assert.match(client.url, /\/s#[A-Za-z0-9_-]{43}$/);
  assert.notEqual(owner.url, client.url);
  for (const url of [owner.url, client.url]) {
    assert.ok(!/0551230|خالد|فهد|شقة|الملقا|office|jr_|mat_/.test(decodeURIComponent(url)), `nothing readable in ${url}`);
  }
  assert.match(owner.whatsappUrl, /^https:\/\/wa\.me\/966551230002/);
  ctx.ownerToken = tokenOf(owner.url);
  ctx.clientToken = tokenOf(client.url);
  const again = await call("/os/session/links", { officeId: OFFICE_A, journeyId: ctx.journeyId }, OWNER_A);
  assert.equal(again.body.links.owner.url, owner.url, "same link until replaced");
  const foreign = await call("/os/session/links", { officeId: OFFICE_A, journeyId: ctx.journeyId }, OWNER_B);
  assert.equal(foreign.status, 403);
  assert.equal((await call("/os/session/links", { officeId: OFFICE_A, journeyId: ctx.journeyId })).status, 401);
});

test("party view shows only role labels, property and the deal stage — no personal data", async () => {
  const view = await call("/os/session/view", { token: ctx.clientToken });
  assert.equal(view.status, 200, JSON.stringify(view.body));
  const s = view.body.session;
  assert.equal(s.role, "client");
  assert.equal(s.property.propertyType, "شقة");
  assert.equal(s.property.district, "الملقا");
  assert.equal(s.currentPrice, 1200000);
  assert.equal(s.stageLabel, "تفاوض", "approval moves straight to the price step");
  assert.equal(s.property.priceStatusLabel, "قابل للتفاوض");
  const json = JSON.stringify(view.body);
  for (const secret of ["0551230001", "0551230002", "خالد", "فهد", ctx.journeyId, OWNER_A, ...ctx.recordIds]) assert.ok(!json.includes(secret), `leak: ${secret}`);
  // Few visible buttons: قبول / تعديل العرض; the quick moves live behind «تعديل العرض».
  assert.deepEqual(s.actions.filter((a) => a.group === "main").map((a) => a.id), ["accept", "adjust"]);
  assert.deepEqual(s.actions.filter((a) => a.group === "adjust" && !a.secondary).map((a) => a.id), ["minus2", "minus5", "compromise"]);
  assert.equal(s.actions.find((a) => a.id === "minus5").price, 1140000, "5% below the owner's 1,200,000");
  assert.equal(s.actions.find((a) => a.id === "compromise").price, 1150000, "average of the last two prices");
  const ownerView = await call("/os/session/view", { token: ctx.ownerToken });
  // The client's budget is a starting point, not a proposal: the owner cannot «قبول» it before the client proposes.
  assert.deepEqual(ownerView.body.session.actions.filter((a) => a.group === "main").map((a) => a.id), ["adjust"]);
  assert.deepEqual(ownerView.body.session.actions.filter((a) => a.group === "adjust" && !a.secondary).map((a) => a.id), ["plus2", "plus5", "compromise"]);
  assert.equal(ownerView.body.session.actions.find((a) => a.id === "plus2").price, 1122000);
  assert.ok(events().some((e) => e.type === "SESSION_OPENED"), "opening is logged for the broker");
});

test("client −5% → owner sees the new price and only fitting buttons; duplicates are no-ops", async () => {
  const first = await act(ctx.clientToken, "minus5", { submissionId: "client-minus5-a" });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const replay = await act(ctx.clientToken, "minus5", { submissionId: "client-minus5-a" });
  assert.equal(replay.body.duplicate, true);
  assert.equal(events().filter((e) => e.type === "SESSION_MOVE").length, 1);
  const clientView = (await call("/os/session/view", { token: ctx.clientToken })).body.session;
  assert.equal(clientView.waiting, true);
  assert.deepEqual(clientView.actions.map((a) => a.id), ["intervention"], "waiting party sees only intervention");
  assert.equal(clientView.events[0].who, "أنت");
  assert.equal(clientView.events[0].detail, "1,140,000 ريال");
  const ownerView = (await call("/os/session/view", { token: ctx.ownerToken })).body.session;
  assert.equal(ownerView.currentPrice, 1140000);
  assert.equal(ownerView.stageLabel, "تفاوض");
  assert.equal(ownerView.events[0].who, "العميل");
  assert.equal(ownerView.events[0].text, "اقترح سعرًا أقل بـ 5%");
  const notes = h.store.list(`offices/${OFFICE_A}/notifications`).filter((n) => n.workflowId === ctx.journeyId);
  assert.ok(notes.some((n) => /أقل بـ 5%/.test(n.body)), "broker notified in-app");
  const priceNote = notes.find((n) => /أقل بـ 5%/.test(n.body));
  assert.equal(priceNote.route, `session/${ctx.journeyId}`, "in-app notification opens the session itself");
  const pushes = h.store.fcm.map((f) => JSON.stringify(f.body)).filter((b) => b.includes("أقل بـ 5%"));
  assert.equal(pushes.length, 1, "one push for one move");
  assert.ok(pushes[0].includes(`openOperation=${encodeURIComponent(`session:${ctx.journeyId}`)}`), `push opens the session directly: ${pushes[0].slice(0, 400)}`);
  const stale = await act(ctx.clientToken, "minus2");
  assert.equal(stale.status, 409, "a move that is no longer offered is refused");
});

test("typed price accepts digits only; comments are refused", async () => {
  assert.equal(parseTypedPrice("1,170,000").price, 1170000);
  assert.equal(parseTypedPrice("١٬١٧٠٬٠٠٠").ok, false);
  assert.equal(parseTypedPrice("١١٧٠٠٠٠").price, 1170000);
  assert.equal(parseTypedPrice("1170000 نهائي").ok, false);
  const bad = await act(ctx.ownerToken, "manual", { price: "1,180,000 وهذا آخر سعر" });
  assert.equal(bad.status, 400);
  const good = await act(ctx.ownerToken, "manual", { price: "1,180,000" });
  assert.equal(good.status, 200, JSON.stringify(good.body));
  assert.equal(roundPrice(1159999), 1160000);
});

test("compromise uses the average of the last two prices", async () => {
  const view = (await call("/os/session/view", { token: ctx.clientToken })).body.session;
  assert.equal(view.actions.find((a) => a.id === "compromise").price, 1160000, "(1,180,000 + 1,140,000) / 2");
  const res = await act(ctx.clientToken, "compromise");
  assert.equal(res.status, 200);
  assert.equal((await call("/os/session/view", { token: ctx.ownerToken })).body.session.currentPrice, 1160000);
});

test("price sent to the broker is private", async () => {
  const res = await act(ctx.ownerToken, "to_broker", { price: "1,165,000" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const clientView = (await call("/os/session/view", { token: ctx.clientToken })).body.session;
  assert.ok(!JSON.stringify(clientView).includes("1,165,000"), "client never sees the private price");
  assert.equal(clientView.currentPrice, 1160000);
  assert.ok(ops().some((op) => op.type === "SESSION_PRIVATE_PRICE" && active(op)), "broker task created");
});

test("intervention: event, task in daily tasks, notification, flagged session; log stays visible", async () => {
  const res = await act(ctx.clientToken, "intervention");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const journey = h.store.get(`offices/${OFFICE_A}/journeys/${ctx.journeyId}`);
  assert.equal(journey.session.intervention.required, true);
  const task = ops().find((op) => op.type === "SESSION_INTERVENTION" && active(op));
  assert.ok(task, "SESSION_INTERVENTION task");
  assert.equal(task.priority, "HIGH");
  assert.equal(task.journeyId, ctx.journeyId);
  assert.ok(h.store.list(`offices/${OFFICE_A}/notifications`).some((n) => n.title.startsWith("تدخل مطلوب")));
  const view = (await call("/os/session/view", { token: ctx.clientToken })).body.session;
  assert.equal(view.intervention, true, "the side that asked sees its request is with the broker");
  assert.ok(view.events.length >= 4, "previous log still visible");
  const ownerView = (await call("/os/session/view", { token: ctx.ownerToken })).body.session;
  assert.equal(ownerView.intervention, false, "the other side is not told about a request to the broker");
  assert.ok(!ownerView.events.some((event) => /تدخل الوسيط/.test(event.text)));
  const resolved = await call("/os/session/resolve", { officeId: OFFICE_A, journeyId: ctx.journeyId }, OWNER_A);
  assert.equal(resolved.status, 200);
  assert.equal(h.store.get(`offices/${OFFICE_A}/journeys/${ctx.journeyId}`).session.intervention.required, false);
  assert.equal(ops().filter((op) => op.type === "SESSION_INTERVENTION" && active(op)).length, 0);
});

test("broker free text reaches only the chosen party", async () => {
  const toOwner = await call("/os/session/message", { officeId: OFFICE_A, journeyId: ctx.journeyId, audience: "owner", text: "رسالة خاصة للمالك", requestKey: "m1" }, OWNER_A);
  assert.equal(toOwner.status, 200, JSON.stringify(toOwner.body));
  const both = await call("/os/session/message", { officeId: OFFICE_A, journeyId: ctx.journeyId, audience: "both", text: "رسالة للطرفين", requestKey: "m2" }, OWNER_A);
  assert.equal(both.status, 200);
  const noAudience = await call("/os/session/message", { officeId: OFFICE_A, journeyId: ctx.journeyId, audience: "", text: "x y" }, OWNER_A);
  assert.equal(noAudience.status, 400);
  const client = JSON.stringify((await call("/os/session/view", { token: ctx.clientToken })).body);
  const owner = JSON.stringify((await call("/os/session/view", { token: ctx.ownerToken })).body);
  assert.ok(owner.includes("رسالة خاصة للمالك") && owner.includes("رسالة للطرفين"));
  assert.ok(!client.includes("رسالة خاصة للمالك") && client.includes("رسالة للطرفين"));
  assert.equal((await call("/os/session/act", { token: ctx.clientToken, action: "message", text: "hi" })).status, 400, "parties cannot send free text");
});

test("accepting agrees on the price → viewing slots from the broker calendar → booked on agreement", async () => {
  const res = await act(ctx.ownerToken, "accept");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const view = (await call("/os/session/view", { token: ctx.clientToken })).body.session;
  assert.equal(view.agreedPrice, 1160000);
  assert.equal(view.dealPhase, "VIEWING_SCHEDULING");
  assert.deepEqual(view.agreed.map((a) => a.id), ["price"], "the agreed price moves to «تم الاتفاق عليه»");
  assert.deepEqual(view.actions.map((a) => a.id), ["viewing_pick", "intervention"], "no price buttons remain");
  assert.ok(view.slots.length && view.slots[0].slots.length, "free slots are offered");
  assert.ok(!ops().some((op) => op.type === "SESSION_AGREED" && active(op)));
  const slot = view.slots[0].slots[0];
  const pick = await act(ctx.clientToken, "viewing_pick", { viewingAt: slot });
  assert.equal(pick.status, 200, JSON.stringify(pick.body));
  assert.equal((await call("/os/session/view", { token: ctx.clientToken })).body.session.phase, "VIEWING_WAIT");
  const oView = (await call("/os/session/view", { token: ctx.ownerToken })).body.session;
  assert.equal(oView.stageLabel, "معاينة");
  assert.deepEqual(oView.actions.map((a) => a.id), ["viewing_ok", "viewing_other", "intervention"]);
  const ok = await act(ctx.ownerToken, "viewing_ok");
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const booked = (await call("/os/session/view", { token: ctx.ownerToken })).body.session;
  assert.equal(booked.dealPhase, "VIEWING");
  assert.deepEqual(booked.agreed.map((a) => a.id), ["price", "viewing"]);
  assert.ok(ops().some((op) => op.type === "VIEWING_RESULT" && active(op)), "the result step waits for the viewing time");
});

test("replaced link stops at once; closing the deal stops both links", async () => {
  const replaced = await call("/os/session/links", { officeId: OFFICE_A, journeyId: ctx.journeyId, replace: "client" }, OWNER_A);
  assert.equal(replaced.status, 200);
  const newClient = tokenOf(replaced.body.links.client.url);
  assert.notEqual(newClient, ctx.clientToken);
  assert.equal((await call("/os/session/view", { token: ctx.clientToken })).body.state, "REPLACED");
  assert.equal((await call("/os/session/view", { token: newClient })).body.state, "ACTIVE");
  assert.equal((await call("/os/session/act", { token: ctx.clientToken, action: "intervention", submissionId: "old-link-a" })).body.state, "REPLACED");
  const invalid = await call("/os/session/view", { token: "x".repeat(43) });
  assert.equal(invalid.body.state, "INVALID");
  const closed = await call("/os/journeys/close", { officeId: OFFICE_A, journeyId: ctx.journeyId, outcome: "LOST", reason: "سبب آخر" }, OWNER_A);
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  const after = await call("/os/session/view", { token: newClient });
  assert.equal(after.body.state, "CLOSED");
  assert.deepEqual(after.body.session.actions, []);
  assert.equal((await act(newClient, "intervention")).body.state, "CLOSED");
  assert.ok(after.body.session.events.length > 0, "log remains readable");
});

test("stage labels follow the approved path only", () => {
  assert.equal(sessionStageLabel({ status: "ACTIVE", stage: "NEGOTIATION" }), "تفاوض");
  assert.equal(sessionStageLabel({ status: "ACTIVE", stage: "AGREEMENT" }), "مستندات");
  assert.equal(sessionStageLabel({ status: "CLOSED_WON", stage: "CLOSED" }), "إغلاق");
  assert.deepEqual(availableActions({ status: "CLOSED_LOST" }, "owner").actions, []);
});
