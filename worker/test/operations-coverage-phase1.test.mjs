import test from "node:test";
import assert from "node:assert/strict";

import {
  OPERATION_TYPES,
  OPERATION_PRIORITY,
  buildOpportunityReviewOperation,
  buildOpportunityFollowUpOperation,
  buildDealActionOperation
} from "../src/operations-domain.js";
import { operationToFirestoreFields } from "../src/operations-service.js";

const FIXED_NOW = new Date("2026-09-07T03:00:00.000Z");

test("worker exposes Phase 1 coverage operation types", () => {
  assert.equal(OPERATION_TYPES.OPPORTUNITY_REVIEW, "OPPORTUNITY_REVIEW");
  assert.equal(OPERATION_TYPES.OPPORTUNITY_FOLLOW_UP, "OPPORTUNITY_FOLLOW_UP");
  assert.equal(OPERATION_TYPES.DEAL_ACTION, "DEAL_ACTION");
});

test("opportunity review has a stable id per office/opportunity", async () => {
  const a = await buildOpportunityReviewOperation({
    officeId: "office-1",
    opportunityId: "opp-1",
    propertyType: "شقة",
    district: "عروة",
    now: FIXED_NOW
  });
  const b = await buildOpportunityReviewOperation({
    officeId: "office-1",
    opportunityId: "opp-1",
    propertyType: "فيلا",
    now: new Date("2026-09-07T04:00:00.000Z")
  });

  assert.equal(a.id, b.id);
  assert.equal(a.sourceEntityType, "opportunity");
  assert.equal(a.sourceEntityId, "opp-1");
  assert.equal(a.type, OPERATION_TYPES.OPPORTUNITY_REVIEW);
});

test("follow-up id changes only when the scheduled instant changes", async () => {
  const first = await buildOpportunityFollowUpOperation({
    officeId: "office-1",
    opportunityId: "opp-2",
    dueAt: "2026-09-07T14:00:00.000Z",
    now: FIXED_NOW
  });
  const same = await buildOpportunityFollowUpOperation({
    officeId: "office-1",
    opportunityId: "opp-2",
    dueAt: "2026-09-07T14:00:00.000Z",
    note: "ملاحظة محدثة",
    now: FIXED_NOW
  });
  const moved = await buildOpportunityFollowUpOperation({
    officeId: "office-1",
    opportunityId: "opp-2",
    dueAt: "2026-09-08T14:00:00.000Z",
    now: FIXED_NOW
  });

  assert.equal(first.id, same.id);
  assert.notEqual(first.id, moved.id);
  assert.equal(first.dueAt, "2026-09-07T14:00:00.000Z");
  assert.equal(first.metadata.followUpAt, first.dueAt);
});

test("deal action identity is stage-aware and closing is high priority", async () => {
  const negotiation = await buildDealActionOperation({
    officeId: "office-1",
    dealId: "deal-7",
    matchId: "match-7",
    stage: "negotiation",
    nextActionText: "تجهيز الاتفاقية",
    now: FIXED_NOW
  });
  const closing = await buildDealActionOperation({
    officeId: "office-1",
    dealId: "deal-7",
    matchId: "match-7",
    stage: "closing",
    nextActionText: "إغلاق الصفقة",
    now: FIXED_NOW
  });

  assert.notEqual(negotiation.id, closing.id);
  assert.equal(closing.dealId, "deal-7");
  assert.equal(closing.sourceEntityType, "deal");
  assert.equal(closing.priority, OPERATION_PRIORITY.HIGH);
});

test("Firestore projection keeps deal and viewing coverage fields", () => {
  const helpers = {
    firestoreString: (value) => ({ stringValue: String(value ?? "") }),
    firestoreBoolean: (value) => ({ booleanValue: Boolean(value) }),
    firestoreInteger: (value) => ({ integerValue: String(value) }),
    firestoreTimestamp: (value) => ({ timestampValue: value.toISOString() })
  };
  const fields = operationToFirestoreFields({
    id: "op-1",
    officeId: "office-1",
    type: OPERATION_TYPES.DEAL_ACTION,
    sourceEntityType: "deal",
    sourceEntityId: "deal-1",
    dealId: "deal-1",
    appointmentAt: "2026-09-08T15:00:00.000Z",
    appointmentStatus: "CONFIRMED",
    viewingAt: "2026-09-08T15:00:00.000Z",
    createdAt: "2026-09-07T03:00:00.000Z",
    updatedAt: "2026-09-07T03:00:00.000Z",
    metadata: {}
  }, helpers);

  assert.equal(fields.dealId.stringValue, "deal-1");
  assert.equal(fields.appointmentStatus.stringValue, "CONFIRMED");
  assert.equal(fields.viewingAt.stringValue, "2026-09-08T15:00:00.000Z");
});
