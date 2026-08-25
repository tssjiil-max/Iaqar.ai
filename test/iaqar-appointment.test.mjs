import { test } from "node:test";
import assert from "node:assert/strict";
import {
  availableIaqarSlots,
  slotIsTaken,
  slotsOverlap,
  APPOINTMENT_SLOT_TAKEN_COPY,
  IAQAR_QA_SLOTS
} from "../public/js/iaqar-appointment-domain.js";
import { livingStageAfterPartyAction, LIVING_TASK_STAGE } from "../public/js/match-group-domain.js";

test("Iaqar slots hide booked times and keep duration/buffer occupancy", () => {
  const first = IAQAR_QA_SLOTS[0].startAt;
  const overlapping = new Date(new Date(first).getTime() + 15 * 60 * 1000).toISOString();
  assert.equal(slotsOverlap(first, overlapping), true);
  const open = availableIaqarSlots({ bookedStarts: [first] });
  assert.equal(open.some((slot) => slot.id === first), false);
  assert.ok(open.length >= 1);
  assert.equal(slotIsTaken(first, [first]), true);
  assert.equal(APPOINTMENT_SLOT_TAKEN_COPY.includes("لم يعد متاحًا"), true);
});

test("client interested waits; viewing is what asks the broker to contact the owner", () => {
  const interested = livingStageAfterPartyAction({ party: "client", action: "interested" });
  assert.equal(interested.stage, LIVING_TASK_STAGE.CLIENT_INTERESTED);
  assert.equal(interested.ownerContactNeeded, false);
  const viewing = livingStageAfterPartyAction({ party: "client", action: "want_viewing", followUp: true });
  assert.equal(viewing.stage, LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION);
  assert.equal(viewing.ownerContactNeeded, true);
});
