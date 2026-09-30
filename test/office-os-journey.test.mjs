// Office OS — full journey through the real Worker (/os routes + existing intake and
// matching) on the in-memory Firestore double. Isolated test data only.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, BROKER_A2, OWNER_B } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());

async function call(route, body, uid) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const list = (p) => h.store.list(p);
const ops = () => list(`offices/${OFFICE_A}/operations`);
const active = (op) => ["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE"].includes(String(op.status));
const tokenOf = (url) => String(url).split("#")[1];

const ctx = {};

test("broker adds a request without area; public office link adds an offer; match + one review task", async () => {
  const saved = await call("/os/records/save", {
    officeId: OFFICE_A, requestKey: "req-1",
    record: { kind: "REQUEST", purpose: "PURCHASE", propertyType: "شقة", city: "الرياض", district: "الملقا", price: "1,300,000", contactName: "أحمد المطيري", contactPhone: "0551234567" }
  }, OWNER_A);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  ctx.requestId = saved.body.recordId;
  const replay = await call("/os/records/save", { officeId: OFFICE_A, requestKey: "req-1", record: { kind: "REQUEST", purpose: "PURCHASE", propertyType: "شقة", city: "الرياض", district: "الملقا", price: "1,300,000", contactName: "أحمد المطيري", contactPhone: "0551234567" } }, OWNER_A);
  assert.equal(replay.body.recordId, ctx.requestId, "same requestKey → same record");
  assert.equal(h.store.get(`offices/${OFFICE_A}/opportunities/${ctx.requestId}`).area, null, "area stays optional");

  // Office link submission (the page writes publicIntake, then asks the Worker to process it).
  h.store.seed(`offices/${OFFICE_A}/publicIntake/intake00001`, {
    officeId: OFFICE_A, kind: "owner", name: "عبدالله السبيعي", phone: "0557654321", propertyType: "شقة", district: "الملقا", city: "الرياض",
    purpose: "SALE", transactionType: "sale", amount: 1250000, area: 120, rooms: 3, details: "شقة حديثة بإطلالة", mediaPaths: [], imageCount: 0,
    hasVideo: false, source: "office_public_link", status: "new"
  });
  const intake = await call("/pipeline/public-intake", { officeId: OFFICE_A, intakeId: "intake00001" });
  assert.ok([200, 201].includes(intake.status), JSON.stringify(intake.body));
  ctx.offerId = intake.body.opportunityId;
  const offer = h.store.get(`offices/${OFFICE_A}/opportunities/${ctx.offerId}`);
  assert.equal(offer.brokerId, OWNER_A, "office-link record assigned by the office rule, not visitor input");

  const reviews = ops().filter((op) => op.type === "MATCH_REVIEW" && active(op));
  assert.equal(reviews.length, 1, "exactly one MATCH_REVIEW");
  const review = reviews[0];
  assert.equal(review.offerId, ctx.offerId);
  assert.equal(review.requestId, ctx.requestId);
  assert.equal(review.officeId, OFFICE_A);
  assert.ok(review.matchId);
  assert.equal(review.assignedBrokerId, OWNER_A);
  ctx.matchId = review.matchId;
  ctx.reviewId = review.id;

  const again = await call("/pipeline/public-intake", { officeId: OFFICE_A, intakeId: "intake00001" });
  assert.equal(again.body.duplicate, true);
  const rec = await call("/os/reconcile", { officeId: OFFICE_A }, OWNER_A);
  assert.equal(rec.status, 200);
  assert.equal(ops().filter((op) => op.type === "MATCH_REVIEW").length, 1, "replays and reconcile never duplicate the review");
});

test("offices are isolated", async () => {
  const foreign = await call("/os/review/decide", { officeId: OFFICE_A, matchId: ctx.matchId, decision: "approve" }, OWNER_B);
  assert.equal(foreign.status, 403, "office B cannot act in office A");
  const ownOffice = await call("/os/review/decide", { officeId: OFFICE_B, matchId: ctx.matchId, decision: "approve" }, OWNER_B);
  assert.equal(ownOffice.status, 404, "office A match does not exist in office B");
  const noAuth = await call("/os/records/save", { officeId: OFFICE_A, record: {} });
  assert.equal(noAuth.status, 401);
  const candidates = await call("/os/records/candidates", { officeId: OFFICE_A, recordId: ctx.requestId }, OWNER_A);
  assert.ok(candidates.body.candidates.every((c) => c.recordId !== "opp_b_offer"), "other office records never offered");
});

test("approve creates one journey; replay is idempotent", async () => {
  const first = await call("/os/review/decide", { officeId: OFFICE_A, matchId: ctx.matchId, decision: "approve" }, OWNER_A);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  ctx.journeyId = first.body.journeyId;
  const second = await call("/os/review/decide", { officeId: OFFICE_A, matchId: ctx.matchId, decision: "approve" }, OWNER_A);
  assert.equal(second.body.journeyId, ctx.journeyId);
  assert.equal(list(`offices/${OFFICE_A}/journeys`).length, 1);
  assert.equal(h.store.get(`offices/${OFFICE_A}/operations/${ctx.reviewId}`).status, "COMPLETED");
  const send = ops().filter((op) => op.type === "SEND_PROPOSAL" && active(op));
  assert.equal(send.length, 1);
  assert.equal(send[0].journeyId, ctx.journeyId);
  assert.equal(send[0].assignedBrokerId, OWNER_A, "task reaches the responsible broker");
  const events = list(`offices/${OFFICE_A}/journeys/${ctx.journeyId}/events`);
  assert.equal(events.filter((e) => e.type === "MATCH_APPROVED").length, 1);
});

test("editing an approved record does not raise a second review", async () => {
  const edit = await call("/os/records/save", {
    officeId: OFFICE_A, recordId: ctx.requestId,
    record: { kind: "REQUEST", purpose: "PURCHASE", propertyType: "شقة", city: "الرياض", district: "الملقا", price: "1,350,000", area: "", contactName: "أحمد المطيري", contactPhone: "0551234567" }
  }, OWNER_A);
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(ops().filter((op) => op.type === "MATCH_REVIEW" && active(op)).length, 0);
});

test("price proposal → WhatsApp handoff (opened only) → reply via link, no duplicates", async () => {
  const created = await call("/os/proposals/create", { officeId: OFFICE_A, journeyId: ctx.journeyId, kind: "PRICE", recipients: ["client", "owner"], fields: { price: 1200000 }, requestKey: "p1" }, OWNER_A);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const [client, owner] = ["client", "owner"].map((r) => created.body.proposals.find((p) => p.recipientRole === r));
  assert.match(client.whatsappUrl, /^https:\/\/wa\.me\/966551234567\?text=/);
  assert.ok(client.messageText.includes(client.replyUrl), "message carries the reply link");
  assert.notEqual(tokenOf(client.replyUrl), tokenOf(owner.replyUrl), "one link per recipient");
  assert.ok(!client.messageText.includes("0557654321") && !client.messageText.includes("السبيعي"), "client message has no owner data");
  ctx.clientToken = tokenOf(client.replyUrl);
  ctx.clientProposal = client.proposalId;
  ctx.ownerToken = tokenOf(owner.replyUrl);

  const replayCreate = await call("/os/proposals/create", { officeId: OFFICE_A, journeyId: ctx.journeyId, kind: "PRICE", recipients: ["client", "owner"], fields: { price: 1200000 }, requestKey: "p1" }, OWNER_A);
  assert.deepEqual(replayCreate.body.proposals.map((p) => p.proposalId).sort(), created.body.proposals.map((p) => p.proposalId).sort());

  const handoff = await call("/os/proposals/handoff", { officeId: OFFICE_A, proposalId: client.proposalId }, OWNER_A);
  assert.equal(handoff.status, 200);
  const proposal = h.store.get(`offices/${OFFICE_A}/proposals/${client.proposalId}`);
  assert.equal(proposal.sendState, "OPENED_EXTERNAL");
  assert.ok(!("deliveredAt" in proposal) && !("sentAt" in proposal), "no sent/delivered claim");
  assert.equal(ops().filter((op) => op.type === "SEND_PROPOSAL" && active(op)).length, 0);
  const waiting = ops().filter((op) => op.type === "AWAITING_REPLY" && active(op));
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].status, "WAITING_EXTERNAL_RESPONSE");

  const invalidChannel = await call("/os/proposals/handoff", { officeId: OFFICE_A, proposalId: client.proposalId, channel: "UNKNOWN" }, OWNER_A);
  assert.equal(invalidChannel.status, 400);
  const shared = await call("/os/proposals/handoff", { officeId: OFFICE_A, proposalId: client.proposalId, channel: "SHARE" }, OWNER_A);
  assert.equal(shared.status, 200);
  assert.equal(shared.body.first, false);
  const sharedProposal = h.store.get(`offices/${OFFICE_A}/proposals/${client.proposalId}`);
  assert.equal(sharedProposal.handoffChannel, "SHARE");
  assert.ok(!sharedProposal.sentAt && !sharedProposal.deliveredAt);
  assert.equal(ops().filter((op) => op.type === "AWAITING_REPLY" && active(op)).length, 1, "switching apps must not duplicate tasks");
  assert.ok(list(`offices/${OFFICE_A}/journeys/${ctx.journeyId}/events`).some((e) => e.type === "MESSAGE_SHARED"));

  const view = await call("/os/reply/view", { token: ctx.clientToken });
  assert.equal(view.body.state, "ACTIVE");
  assert.equal(view.body.office.officeName, "مكتب سلطان العقاري");
  assert.deepEqual(view.body.proposal.options.map((o) => o.id), ["accept_initial", "counter", "reject"]);
  assert.ok(!JSON.stringify(view.body).includes("0557654321"), "reply page never shows the other party");

  const bad = await call("/os/reply/submit", { token: ctx.clientToken, optionId: "counter", text: "" });
  assert.equal(bad.status, 400, "counter price requires a value");
  const r1 = await call("/os/reply/submit", { token: ctx.clientToken, optionId: "accept_initial", submissionId: "pagesession01" });
  assert.equal(r1.body.state, "SAVED", JSON.stringify(r1.body));
  const r2 = await call("/os/reply/submit", { token: ctx.clientToken, optionId: "accept_initial", submissionId: "pagesession01" });
  assert.equal(r2.body.duplicate, true);
  const replies = list(`offices/${OFFICE_A}/journeys/${ctx.journeyId}/events`).filter((e) => e.type === "PARTY_REPLY");
  assert.equal(replies.length, 1, "double click / reload → one reply");
  assert.equal(replies[0].source, "REPLY_LINK");
  assert.equal(ops().filter((op) => op.type === "AWAITING_REPLY" && active(op)).length, 0);
  assert.equal(ops().filter((op) => op.type === "PROPOSAL_REPLY" && active(op)).length, 1);
  const notes = list(`offices/${OFFICE_A}/notifications`).filter((n) => n.type === "JOURNEY_UPDATE");
  assert.equal(notes.length, 1, "broker notified once");
  assert.equal(notes[0].brokerId, OWNER_A);

  const bogus = await call("/os/reply/view", { token: "A".repeat(43) });
  assert.equal(bogus.status, 404);
});

test("replacing a proposal retires the previous link", async () => {
  const created = await call("/os/proposals/create", { officeId: OFFICE_A, journeyId: ctx.journeyId, kind: "PRICE", recipients: ["owner"], fields: { price: 1220000 }, requestKey: "p2" }, OWNER_A);
  assert.equal(created.status, 200);
  const old = await call("/os/reply/view", { token: ctx.ownerToken });
  assert.equal(old.body.state, "SUPERSEDED");
  const oldSubmit = await call("/os/reply/submit", { token: ctx.ownerToken, optionId: "accept_initial" });
  assert.equal(oldSubmit.body.state, "SUPERSEDED");
  const fresh = await call("/os/reply/view", { token: tokenOf(created.body.proposals[0].replyUrl) });
  assert.equal(fresh.body.state, "ACTIVE");
});

test("viewing: accepted ≠ confirmed ≠ done; result drives the next step", async () => {
  const at = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  const created = await call("/os/proposals/create", { officeId: OFFICE_A, journeyId: ctx.journeyId, kind: "VIEWING", recipients: ["client"], fields: { viewingAt: at }, requestKey: "v1" }, OWNER_A);
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const token = tokenOf(created.body.proposals[0].replyUrl);
  await call("/os/proposals/handoff", { officeId: OFFICE_A, proposalId: created.body.proposals[0].proposalId }, OWNER_A);
  const early = await call("/os/journeys/viewing/confirm", { officeId: OFFICE_A, journeyId: ctx.journeyId }, OWNER_A);
  assert.equal(early.status, 409, "cannot confirm before acceptance");
  const reply = await call("/os/reply/submit", { token, optionId: "accept" });
  assert.equal(reply.body.state, "SAVED");
  let journey = h.store.get(`offices/${OFFICE_A}/journeys/${ctx.journeyId}`);
  assert.equal(journey.viewing.state, "ACCEPTED");
  assert.equal(journey.stage, "VIEWING");
  assert.equal(ops().filter((op) => op.type === "VIEWING_CONFIRM" && active(op)).length, 1);
  const confirm = await call("/os/journeys/viewing/confirm", { officeId: OFFICE_A, journeyId: ctx.journeyId }, OWNER_A);
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
  const confirmAgain = await call("/os/journeys/viewing/confirm", { officeId: OFFICE_A, journeyId: ctx.journeyId }, OWNER_A);
  assert.equal(confirmAgain.body.changed, false);
  journey = h.store.get(`offices/${OFFICE_A}/journeys/${ctx.journeyId}`);
  assert.equal(journey.viewing.state, "CONFIRMED");
  assert.equal(ops().filter((op) => op.type === "VIEWING_RESULT" && active(op)).length, 1);
  const result = await call("/os/journeys/viewing/result", { officeId: OFFICE_A, journeyId: ctx.journeyId, result: "interested", note: "" }, OWNER_A);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  journey = h.store.get(`offices/${OFFICE_A}/journeys/${ctx.journeyId}`);
  assert.equal(journey.viewing.state, "DONE");
  assert.equal(journey.stage, "AGREEMENT");
  assert.equal(journey.status, "ACTIVE", "interest is not a completed deal");
  assert.equal(ops().filter((op) => op.type === "DEAL_ACTION" && active(op)).length, 1);
});

test("deal completion needs explicit permission; closing archives and retires links", async () => {
  const broker = await call("/os/journeys/close", { officeId: OFFICE_A, journeyId: ctx.journeyId, outcome: "WON" }, BROKER_A2);
  assert.equal(broker.status, 403, "non-manager broker cannot complete by default");
  const remove = await call("/os/records/remove", { officeId: OFFICE_A, recordId: ctx.offerId }, OWNER_A);
  assert.equal(remove.status, 409, "record in an open opportunity cannot be removed");
  const won = await call("/os/journeys/close", { officeId: OFFICE_A, journeyId: ctx.journeyId, outcome: "WON", finalPrice: 1210000 }, OWNER_A);
  assert.equal(won.status, 200, JSON.stringify(won.body));
  const journey = h.store.get(`offices/${OFFICE_A}/journeys/${ctx.journeyId}`);
  assert.equal(journey.status, "CLOSED_WON");
  assert.ok(journey.archivedAt);
  assert.equal(ops().filter((op) => op.journeyId === ctx.journeyId && active(op)).length, 0);
  const closedLink = await call("/os/reply/view", { token: ctx.clientToken });
  assert.equal(closedLink.body.state, "CLOSED");
  assert.ok(list(`offices/${OFFICE_A}/journeys/${ctx.journeyId}/events`).length >= 8, "history kept");
});

test("delete: linked record is archived, unlinked record soft-deleted; neither re-enters matching", async () => {
  const archived = await call("/os/records/remove", { officeId: OFFICE_A, recordId: ctx.offerId }, OWNER_A);
  assert.equal(archived.body.mode, "archived");
  const other = await call("/os/records/save", { officeId: OFFICE_A, requestKey: "tmp", record: { kind: "OFFER", purpose: "RENT", propertyType: "محل تجاري", city: "الرياض", district: "العليا", price: 90000, contactPhone: "0550001111" } }, OWNER_A);
  const deleted = await call("/os/records/remove", { officeId: OFFICE_A, recordId: other.body.recordId }, OWNER_A);
  assert.equal(deleted.body.mode, "deleted");
  const doc = h.store.get(`offices/${OFFICE_A}/opportunities/${other.body.recordId}`);
  assert.equal(doc.lifecycleStatus, "DELETED");
  assert.ok(doc.deletedAt, "soft delete keeps the document");
  const candidates = await call("/os/records/candidates", { officeId: OFFICE_A, recordId: ctx.requestId }, OWNER_A);
  assert.ok(candidates.body.candidates.every((c) => c.recordId !== ctx.offerId && c.recordId !== other.body.recordId));
});
