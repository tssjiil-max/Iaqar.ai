import test from "node:test";
import assert from "node:assert/strict";
import {
  LISTING_STATUS, listingStatus, isMatchable, othersInterested, interestRecord, INTEREST_NOTICE,
  reservationDecision, releaseDecision, resolveListingReference, readiness, READINESS_EVENT,
  mandateDecision, MANDATE
} from "../public/os/domain/direct-match-domain.js";

const now = new Date("2026-10-16T12:00:00Z");
const manager = { kind: "human", uid: "uid-owner", isManager: true };

test("listing status comes from facts: sold/rented, official reservation, the office's own open deals", () => {
  assert.equal(listingStatus({ availabilityStatus: "SOLD" }), LISTING_STATUS.SOLD);
  assert.equal(listingStatus({ availabilityStatus: "RENTED" }), LISTING_STATUS.RENTED);
  assert.equal(listingStatus({ availabilityStatus: "FOUND" }), LISTING_STATUS.UNAVAILABLE);
  assert.equal(listingStatus({ reservation: { state: "RESERVED" } }), LISTING_STATUS.RESERVED);
  assert.equal(listingStatus({ reservation: { state: "RELEASED" } }), LISTING_STATUS.AVAILABLE);
  const open = [{ offerId: "o1", status: "ACTIVE", stage: "NEGOTIATION" }];
  assert.equal(listingStatus({ id: "o1" }, { openJourneys: open }), LISTING_STATUS.NEGOTIATING);
  assert.equal(listingStatus({ id: "o2" }, { openJourneys: open }), LISTING_STATUS.AVAILABLE, "another offer's deal does not count");
  assert.equal(listingStatus({ id: "o1" }, { openJourneys: [{ offerId: "o1", status: "CLOSED_LOST", stage: "CLOSED" }] }), LISTING_STATUS.AVAILABLE);
  assert.equal(listingStatus({ id: "o1" }, { openJourneys: [{ offerId: "o1", status: "ACTIVE", stage: "MATCH_REVIEW" }] }), LISTING_STATUS.AVAILABLE, "a match under review is not a negotiation");
});

test("reserved, sold, rented and unavailable never reach new matches; negotiating follows office policy", () => {
  for (const s of ["RESERVED", "SOLD", "RENTED", "UNAVAILABLE"]) assert.equal(isMatchable(s), false, s);
  assert.equal(isMatchable("AVAILABLE"), true);
  assert.equal(isMatchable("NEGOTIATING"), true);
  assert.equal(isMatchable("NEGOTIATING", { showNegotiating: false }), false);
});

test("interest notice: only real, recent interest from OTHER clients; never from nothing", () => {
  assert.equal(othersInterested([], { now }), false);
  assert.equal(othersInterested([{ key: "me", lastAt: now.toISOString() }], { viewerKey: "me", now }), false, "own interest is not «others»");
  assert.equal(othersInterested([{ key: "x", lastAt: "2026-09-01T00:00:00Z" }], { now }), false, "stale interest expires");
  assert.equal(othersInterested([{ key: "x", lastAt: now.toISOString(), active: false }], { now }), false);
  assert.equal(othersInterested([{ key: "", lastAt: now.toISOString() }], { now }), false);
  assert.equal(othersInterested([{ key: "me", lastAt: now.toISOString() }, { key: "x", lastAt: now.toISOString() }], { viewerKey: "me", now }), true);
  assert.match(INTEREST_NOTICE, /ولا يزال متاحًا/);
  assert.doesNotMatch(INTEREST_NOTICE, /\d/, "the notice carries no count");
});

test("interest gives no priority: the record holds only a key, the reference and timestamps", () => {
  const r = interestRecord({ key: "k1", reference: "o:1", now });
  assert.deepEqual(Object.keys(r).sort(), ["active", "createdAt", "key", "lastAt", "reference", "selections"]);
  assert.equal(interestRecord({ key: "k1", reference: "o:1", now, previous: r }).createdAt, r.createdAt);
});

test("official reservation: a person who manages the office, never the AI, a bot or an anonymous call", () => {
  assert.equal(reservationDecision({}, { actor: { kind: "agent", uid: "bot", isManager: true }, journeyId: "j1" }).code, "human_approval_required");
  assert.equal(reservationDecision({}, { actor: { uid: "u", isManager: true }, journeyId: "j1" }).code, "human_approval_required");
  assert.equal(reservationDecision({}, { actor: { kind: "human", uid: "u", isManager: false }, journeyId: "j1" }).code, "not_authorized");
  assert.equal(reservationDecision({ availabilityStatus: "SOLD" }, { actor: manager, journeyId: "j1" }).code, "not_available");
  const ok = reservationDecision({}, { actor: manager, journeyId: "j1", now });
  assert.equal(ok.ok, true);
  assert.equal(ok.patch.reservation.state, "RESERVED");
  assert.equal(ok.patch.reservation.by, "uid-owner");
});

test("two conflicting reservations cannot both be approved; the same deal is idempotent", () => {
  const held = { reservation: { state: "RESERVED", journeyId: "j1" } };
  assert.equal(reservationDecision(held, { actor: manager, journeyId: "j2" }).code, "already_reserved");
  assert.deepEqual(reservationDecision(held, { actor: manager, journeyId: "j1" }), { ok: true, unchanged: true });
  assert.equal(releaseDecision({}, { actor: manager }).code, "not_reserved");
  assert.equal(releaseDecision(held, { actor: { kind: "agent", uid: "bot", isManager: true } }).code, "human_approval_required");
  assert.equal(releaseDecision(held, { actor: manager, now }).patch.reservation.state, "RELEASED");
});

test("«أبغى العرض الثاني» and references are understood; ambiguous or out-of-range messages are not guessed", () => {
  const results = [{ reference: "office-a:p1" }, { reference: "office-a:p2" }, { reference: "office-b:p3" }];
  const pick = (m) => resolveListingReference(m, results)?.index ?? null;
  assert.equal(pick("أبغى العرض الثاني"), 1);
  assert.equal(pick("الثالثة لو سمحت"), 2);
  assert.equal(pick("ابي الأول"), 0);
  assert.equal(pick("رقم ٢"), 1);
  assert.equal(pick("العرض 3"), 2);
  assert.equal(pick("المرجع office-b:p3"), 2);
  assert.equal(resolveListingReference("office-b:p3", results).by, "reference");
  assert.equal(pick("2 او 3"), null);
  assert.equal(pick("العاشر"), null);
  assert.equal(pick("ابغاه"), null);
  assert.equal(resolveListingReference("الثاني", []), null);
});

test("readiness counts each real event once, and ≥90 is guidance — never approval or auto-close", () => {
  assert.deepEqual(readiness([]), { score: 0, events: [], advanced: false, approval: false, autoClose: false });
  const partial = readiness(["SELECTED", "SELECTED", "BUDGET_FIT", "CONTACT_CONSENT", "invented"]);
  assert.equal(partial.score, 45);
  const all = readiness(Object.values(READINESS_EVENT));
  assert.equal(all.score, 100);
  assert.equal(all.advanced, true);
  assert.equal(all.approval, false);
  assert.equal(all.autoClose, false);
});

test("negotiation: within the recorded mandate is still not acceptance; outside or no mandate needs the owner", () => {
  assert.equal(mandateDecision({ floor: 480000 }, 500000), MANDATE.WITHIN);
  assert.equal(mandateDecision({ floor: 480000 }, 470000), MANDATE.OWNER_APPROVAL);
  assert.equal(mandateDecision({}, 470000), MANDATE.OWNER_APPROVAL, "no mandate recorded");
  assert.equal(mandateDecision({ floor: 480000 }, 0), MANDATE.INVALID);
  assert.ok(!Object.values(MANDATE).some((v) => /ACCEPT/.test(v)), "silence or a number is never acceptance");
});

test("the office AI assistant refuses official reservation, like price acceptance and closing", async () => {
  const { toolGate } = await import("../public/os/domain/agent-domain.js");
  for (const name of ["reserve_listing", "accept_price", "set_final_price", "close_deal"]) {
    assert.deepEqual(toolGate(name), { allowed: false, category: "FORBIDDEN", reason: "forbidden" }, name);
  }
});
