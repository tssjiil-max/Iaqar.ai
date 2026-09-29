// Office OS — server-side permissions and public reply-link hardening, through the
// real Worker on the in-memory Firestore double.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, OFFICE_A, OFFICE_B, OWNER_A, BROKER_A2, OWNER_B } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const { seedStates, callWorker } = await import(path.join(ROOT, "scripts/qa/office-os/seed.mjs"));
const h = await startOfficeOsHarness();
const s = await seedStates(h);
test.after(() => h.server.close());

async function raw(route, body, uid) {
  try { return { status: 200, body: await callWorker(h, route, body, uid) }; } catch (error) {
    const m = String(error.message).match(/ (\d{3}) (.*)$/s);
    return { status: Number(m?.[1] || 0), body: m ? JSON.parse(m[2].endsWith("}") ? m[2] : `${m[2]}"}`) : {} };
  }
}
const statusOf = async (route, body, uid) => (await raw(route, body, uid)).status;

test("a broker cannot act on an opportunity assigned to another broker; managers can", async () => {
  const jid = s.negotiation.journeyId;
  assert.equal(h.store.get(`offices/${OFFICE_A}/journeys/${jid}`).assignedBrokerId, OWNER_A);
  assert.equal(await statusOf("/os/proposals/create", { officeId: OFFICE_A, journeyId: jid, kind: "PRICE", recipients: ["client"], fields: { price: 100 }, requestKey: "x" }, BROKER_A2), 403);
  assert.equal(await statusOf("/os/journeys/note", { officeId: OFFICE_A, journeyId: jid, text: "محاولة" }, BROKER_A2), 403);
  assert.equal(await statusOf("/os/journeys/viewing/confirm", { officeId: OFFICE_A, journeyId: s.viewingConfirm.journeyId }, BROKER_A2), 403);
  assert.equal(await statusOf("/os/review/decide", { officeId: OFFICE_A, matchId: s.review.matchId, decision: "reject" }, BROKER_A2), 403, "review task is assigned to the owner");
  assert.equal(await statusOf("/os/journeys/note", { officeId: OFFICE_A, journeyId: jid, text: "ملاحظة المدير", requestKey: "m1" }, OWNER_A), 200);
});

test("deal completion: brokerMayClose lets only the assigned broker close", async () => {
  const jid = s.viewingResult.journeyId;
  h.store.patch(`offices/${OFFICE_A}/journeys/${jid}`, { assignedBrokerId: BROKER_A2 });
  assert.equal(await statusOf("/os/journeys/close", { officeId: OFFICE_A, journeyId: jid, outcome: "WON" }, BROKER_A2), 403, "default: manager only");
  h.store.seed(`offices/${OFFICE_A}/officeSettings/deals`, { officeId: OFFICE_A, brokerMayClose: true });
  h.store.patch(`offices/${OFFICE_A}/journeys/${s.negotiation.journeyId}`, { assignedBrokerId: OWNER_A });
  assert.equal(await statusOf("/os/journeys/close", { officeId: OFFICE_A, journeyId: s.negotiation.journeyId, outcome: "WON" }, BROKER_A2), 403, "not their opportunity");
  assert.equal(await statusOf("/os/journeys/close", { officeId: OFFICE_A, journeyId: jid, outcome: "WON" }, BROKER_A2), 200);
  h.store.seed(`offices/${OFFICE_A}/officeSettings/deals`, { officeId: OFFICE_A, brokerMayClose: false });
});

test("inactive members, other offices and anonymous callers are refused before any data access", async () => {
  h.store.patch(`offices/${OFFICE_A}/members/${BROKER_A2}`, { active: false });
  assert.equal(await statusOf("/os/records/candidates", { officeId: OFFICE_A, recordId: s.review.offerId }, BROKER_A2), 403);
  h.store.patch(`offices/${OFFICE_A}/members/${BROKER_A2}`, { active: true });
  const proposal = h.store.list(`offices/${OFFICE_A}/proposals`)[0];
  assert.equal(await statusOf("/os/proposals/handoff", { officeId: OFFICE_A, proposalId: proposal.id }, OWNER_B), 403);
  assert.equal(await statusOf("/os/proposals/handoff", { officeId: OFFICE_B, proposalId: proposal.id }, OWNER_B), 404);
  assert.equal(await statusOf("/os/reconcile", { officeId: OFFICE_A }, ""), 401);
  assert.equal(await statusOf("/os/records/save", { officeId: "platform", record: {} }, OWNER_A), 400);
});

test("reply links: expired, locked and closed states; wrong options refused", async () => {
  const token = s.negotiation.ownerReplyToken;
  const view = await raw("/os/reply/view", { token }, "");
  assert.equal(view.body.state, "ACTIVE");
  assert.equal(await statusOf("/os/reply/submit", { token, optionId: "not-an-option" }, ""), 400);
  const proposalId = h.store.list(`offices/${OFFICE_A}/proposals`).find((p) => p.replyUrl.endsWith(token)).id;
  h.store.patch(`offices/${OFFICE_A}/proposals/${proposalId}`, { expiresAt: "2020-01-01T00:00:00.000Z" });
  assert.equal((await raw("/os/reply/view", { token }, "")).body.state, "EXPIRED");
  assert.equal((await raw("/os/reply/submit", { token, optionId: "accept_initial" }, "")).body.state, "EXPIRED");
  h.store.patch(`offices/${OFFICE_A}/proposals/${proposalId}`, { expiresAt: new Date(Date.now() + 86400000).toISOString() });
  // Client already answered on the viewingConfirm journey; the broker acknowledges → locked.
  const clientToken = s.viewingConfirm.clientReplyToken;
  const clientProposal = h.store.list(`offices/${OFFICE_A}/proposals`).find((p) => p.replyUrl.endsWith(clientToken));
  await callWorker(h, "/os/journeys/ack-reply", { officeId: OFFICE_A, journeyId: s.viewingConfirm.journeyId, proposalId: clientProposal.id });
  const locked = await raw("/os/reply/submit", { token: clientToken, optionId: "reject" }, "");
  assert.equal(locked.body.state, "LOCKED");
  assert.equal(h.store.get(`offices/${OFFICE_A}/proposals/${clientProposal.id}`).reply.optionId, "accept_initial", "locked reply unchanged");
  assert.equal((await raw("/os/reply/view", { token: s.closed.clientReplyToken }, "")).body.state, "CLOSED");
});

test("public reply endpoints are rate limited", async () => {
  let limited = false;
  for (let i = 0; i < 80 && !limited; i += 1) {
    const r = await raw("/os/reply/view", { token: "Q".repeat(43) }, "");
    if (r.status === 429) limited = true;
  }
  assert.ok(limited, "429 after the public limit");
});

test("a visitor cannot move a submission to another office", async () => {
  h.store.seed(`offices/${OFFICE_B}/publicIntake/intakeXoffice`, {
    officeId: OFFICE_B, kind: "owner", name: "زائر تجريبي", phone: "0555550000", propertyType: "شقة", district: "الملقا", city: "الرياض",
    amount: 900000, details: "", mediaPaths: [], imageCount: 0, hasVideo: false, source: "office_public_link", status: "new"
  });
  const r = await raw("/pipeline/public-intake", { officeId: OFFICE_A, intakeId: "intakeXoffice" }, "");
  assert.equal(r.status, 404, "intake is looked up only under the office named in the path");
  assert.equal(h.store.list(`offices/${OFFICE_A}/opportunities`).some((o) => o.contactPhone === "0555550000"), false);
});
