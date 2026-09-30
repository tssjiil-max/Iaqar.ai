import test from "node:test";
import assert from "node:assert/strict";

import {
  FLOW_STAGE,
  PRICE_STATUS,
  normalizePriceStatus,
  primaryActionForStage,
  routeForStage,
  groupTasksByJourney,
  inferStageFromTasks,
  nextAfterPriceDecision,
  applyPriceAgreement,
  applyViewingResult,
  brokerHasConflict,
  availableViewingSlots,
  confirmViewingSlot
} from "../public/os/domain/flow-domain.js";

test("1 fixed price accept skips negotiation and opens viewing scheduling", () => {
  const result = nextAfterPriceDecision({ priceStatus: PRICE_STATUS.FIXED, accepted: true });
  assert.equal(result.stage, FLOW_STAGE.VIEWING_SCHEDULING);
});

test("2 negotiable accepted price is stored and moves to viewing scheduling", () => {
  const journey = { agreedItems: [] };
  const result = applyPriceAgreement(journey, 850000);
  assert.equal(result.stage, FLOW_STAGE.VIEWING_SCHEDULING);
  assert.deepEqual(result.agreedItems, [{ key: "price", label: "السعر المتفق عليه", value: 850000 }]);
});

test("3 overlapping broker slot is unavailable", () => {
  const existing = [{ brokerId: "b1", start: "2026-10-02T18:00:00.000Z", end: "2026-10-02T19:00:00.000Z", state: "CONFIRMED" }];
  assert.equal(brokerHasConflict(existing, { brokerId: "b1", start: "2026-10-02T18:30:00.000Z", end: "2026-10-02T19:30:00.000Z" }), true);
  assert.equal(brokerHasConflict(existing, { brokerId: "b2", start: "2026-10-02T18:30:00.000Z", end: "2026-10-02T19:30:00.000Z" }), false);
});

test("4 confirmed viewing is appended to agreed items", () => {
  const result = confirmViewingSlot({ agreedItems: [] }, { at: "2026-10-02T18:00:00.000Z" });
  assert.equal(result.stage, FLOW_STAGE.VIEWING_SCHEDULING);
  assert.equal(result.agreedItems[0].key, "viewing");
  assert.equal(result.viewing.state, "CONFIRMED");
});

test("5 suitable viewing result advances to final agreement", () => {
  assert.equal(applyViewingResult({ agreedItems: [] }, "suitable").stage, FLOW_STAGE.FINAL_AGREEMENT);
});

test("6 needs negotiation reopens only price", () => {
  const result = applyViewingResult({ agreedItems: [{ key: "viewing", value: "x" }] }, "needs_negotiation");
  assert.equal(result.stage, FLOW_STAGE.PRICE_NEGOTIATION);
  assert.deepEqual(result.activeTopics, ["price"]);
  assert.equal(result.agreedItems.length, 1);
});

test("7 not suitable closes only current journey", () => {
  const result = applyViewingResult({ offerId: "o1", requestId: "r1" }, "not_suitable");
  assert.equal(result.stage, FLOW_STAGE.CLOSED);
  assert.equal(result.closeScope, "JOURNEY_ONLY");
  assert.equal(result.offerId, "o1");
  assert.equal(result.requestId, "r1");
});

test("8 each journey stage exposes one primary action", () => {
  for (const stage of Object.values(FLOW_STAGE).filter((s) => s !== FLOW_STAGE.CLOSED)) {
    const action = primaryActionForStage(stage);
    assert.ok(action.label);
    assert.ok(action.href);
  }
  assert.deepEqual(primaryActionForStage(FLOW_STAGE.CLOSED), { label: "", href: "" });
});

test("10 daily tasks dedupe open operations by journey", () => {
  const grouped = groupTasksByJourney([
    { id: "a", journeyId: "j1", type: "PROPOSAL_REPLY", status: "OPEN", updatedAt: "2026-10-01T10:00:00Z" },
    { id: "b", journeyId: "j1", type: "SESSION_INTERVENTION", status: "OPEN", updatedAt: "2026-10-01T11:00:00Z" },
    { id: "c", journeyId: "j2", type: "VIEWING_RESULT", status: "OPEN", updatedAt: "2026-10-01T12:00:00Z" }
  ]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped.find((x) => x.journeyId === "j1").tasks.length, 2);
});

test("11 card route goes directly to current stage", () => {
  assert.equal(routeForStage("j1", FLOW_STAGE.PRICE_NEGOTIATION), "session/j1");
  assert.equal(routeForStage("j1", FLOW_STAGE.VIEWING_SCHEDULING), "journey/j1?focus=VIEWING_SCHEDULING");
});

test("12 legacy offer without price status remains legacy, never silently fixed", () => {
  assert.equal(normalizePriceStatus({}), PRICE_STATUS.LEGACY);
  assert.equal(normalizePriceStatus({ priceStatus: "fixed" }), PRICE_STATUS.FIXED);
  assert.equal(normalizePriceStatus({ priceNegotiable: true }), PRICE_STATUS.NEGOTIABLE);
});

test("13 race: slot can become unavailable between display and confirmation", () => {
  const slots = [{ start: "2026-10-02T18:00:00.000Z", end: "2026-10-02T19:00:00.000Z" }];
  assert.equal(availableViewingSlots(slots, [], "b1").length, 1);
  const nowBusy = [{ brokerId: "b1", start: slots[0].start, end: slots[0].end, state: "CONFIRMED" }];
  assert.throws(() => confirmViewingSlot({}, { at: slots[0].start, end: slots[0].end, brokerId: "b1", existing: nowBusy }), /viewing_slot_conflict/);
});

test("14 re-negotiation after viewing preserves prior agreement memory", () => {
  const before = { agreedItems: [{ key: "viewing", label: "موعد المعاينة", value: "2026-10-02T18:00:00.000Z" }] };
  const result = applyViewingResult(before, "needs_negotiation");
  assert.deepEqual(result.agreedItems, before.agreedItems);
  assert.deepEqual(result.activeTopics, ["price"]);
});

test("15 fixed price decline closes current journey only", () => {
  const result = nextAfterPriceDecision({ priceStatus: PRICE_STATUS.FIXED, accepted: false });
  assert.equal(result.stage, FLOW_STAGE.CLOSED);
  assert.equal(result.closeScope, "JOURNEY_ONLY");
});

test("16 closed tasks do not appear in active journey groups", () => {
  const grouped = groupTasksByJourney([
    { id: "x", journeyId: "j1", type: "VIEWING_RESULT", status: "COMPLETED" },
    { id: "y", journeyId: "j2", type: "VIEWING_RESULT", status: "OPEN" }
  ]);
  assert.deepEqual(grouped.map((x) => x.journeyId), ["j2"]);
});

test("stage inference prefers the furthest current journey action", () => {
  assert.equal(inferStageFromTasks([{ type: "MATCH_REVIEW" }]), FLOW_STAGE.MATCHED);
  assert.equal(inferStageFromTasks([{ type: "PROPOSAL_REPLY" }]), FLOW_STAGE.PRICE_NEGOTIATION);
  assert.equal(inferStageFromTasks([{ type: "VIEWING_CONFIRM" }]), FLOW_STAGE.VIEWING_SCHEDULING);
  assert.equal(inferStageFromTasks([{ type: "VIEWING_RESULT" }]), FLOW_STAGE.VIEWING_RESULT);
});
