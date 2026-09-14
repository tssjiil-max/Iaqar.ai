import test from "node:test";
import assert from "node:assert/strict";
import {
  OPPORTUNITY_ACTION_FILTER,
  buildOpportunityActionIndex,
  opportunityMatchesActionFilter,
  projectOpportunityAction
} from "../public/js/opportunity-action-projection-domain.js";

const OFFICE = "thamer";
const NOW = new Date("2026-09-14T08:00:00.000Z");

function operation(overrides = {}) {
  return {
    id: "op-1",
    officeId: OFFICE,
    opportunityId: "opp-1",
    operationType: "MATCH_REVIEW",
    status: "OPEN",
    livingStage: "MATCH_REVIEW",
    matchId: "match-1",
    createdAt: "2026-09-14T07:00:00.000Z",
    updatedAt: "2026-09-14T07:00:00.000Z",
    ...overrides
  };
}

test("plain active MATCH_REVIEW is a matches action", () => {
  const action = projectOpportunityAction(operation(), NOW);
  assert.equal(action?.category, OPPORTUNITY_ACTION_FILTER.MATCHES);
  assert.equal(opportunityMatchesActionFilter(action, OPPORTUNITY_ACTION_FILTER.MATCHES), true);
});

test("future appointment keeps MATCHES membership while appointment is primary", () => {
  const index = buildOpportunityActionIndex([
    operation({ appointmentAt: "2026-09-14T12:00:00.000Z" })
  ], { officeId: OFFICE, now: NOW });
  const action = index.get("opp-1");
  assert.equal(action?.category, OPPORTUNITY_ACTION_FILTER.APPOINTMENTS);
  assert.equal(opportunityMatchesActionFilter(action, OPPORTUNITY_ACTION_FILTER.APPOINTMENTS), true);
  assert.equal(opportunityMatchesActionFilter(action, OPPORTUNITY_ACTION_FILTER.MATCHES), true);
  assert.equal(action?.matchCount, 1);
});

test("negotiation MATCH_REVIEW remains visible in matches", () => {
  const index = buildOpportunityActionIndex([
    operation({ livingStage: "NEGOTIATION_ACTIVE" })
  ], { officeId: OFFICE, now: NOW });
  const action = index.get("opp-1");
  assert.equal(action?.actionCode, "open_negotiation");
  assert.equal(opportunityMatchesActionFilter(action, OPPORTUNITY_ACTION_FILTER.MATCHES), true);
});

test("opening property-available status does not remove عرض الحالة from the opportunity card", () => {
  const beforeOpen = projectOpportunityAction(operation({
    status: "WAITING_EXTERNAL_RESPONSE",
    livingStage: "PROPERTY_AVAILABLE"
  }), NOW);
  const afterOpen = projectOpportunityAction(operation({
    status: "IN_PROGRESS",
    livingStage: "PROPERTY_AVAILABLE",
    openedAt: "2026-09-14T07:30:00.000Z"
  }), NOW);

  assert.equal(beforeOpen?.actionCode, "view_waiting");
  assert.equal(afterOpen?.actionCode, "view_waiting");
  assert.equal(afterOpen?.primaryAction, "عرض الحالة");
});

test("active MATCH_REVIEW projects the same match onto request and offer opportunities", () => {
  const index = buildOpportunityActionIndex([
    operation({
      opportunityId: "request-1",
      clientRequestId: "request-1",
      ownerOfferId: "offer-1"
    })
  ], { officeId: OFFICE, now: NOW });

  const requestAction = index.get("request-1");
  const offerAction = index.get("offer-1");
  assert.equal(requestAction?.matchId, "match-1");
  assert.equal(offerAction?.matchId, "match-1");
  assert.equal(requestAction?.operationId, "op-1");
  assert.equal(offerAction?.operationId, "op-1");
  assert.equal(opportunityMatchesActionFilter(requestAction, OPPORTUNITY_ACTION_FILTER.MATCHES), true);
  assert.equal(opportunityMatchesActionFilter(offerAction, OPPORTUNITY_ACTION_FILTER.MATCHES), true);
  assert.equal(requestAction?.matchCount, 1);
  assert.equal(offerAction?.matchCount, 1);
});

test("negotiation MATCH_REVIEW remains a match on both linked opportunities", () => {
  const index = buildOpportunityActionIndex([
    operation({
      opportunityId: "request-1",
      clientRequestId: "request-1",
      ownerOfferId: "offer-1",
      livingStage: "NEGOTIATION_ACTIVE"
    })
  ], { officeId: OFFICE, now: NOW });

  for (const id of ["request-1", "offer-1"]) {
    const action = index.get(id);
    assert.equal(action?.actionCode, "open_negotiation");
    assert.equal(action?.matchId, "match-1");
    assert.equal(opportunityMatchesActionFilter(action, OPPORTUNITY_ACTION_FILTER.MATCHES), true);
    assert.equal(action?.matchCount, 1);
  }
});

test("repeated request id fields do not double count a MATCH_REVIEW", () => {
  const index = buildOpportunityActionIndex([
    operation({
      opportunityId: "request-1",
      clientRequestId: "request-1",
      requestId: "request-1",
      ownerOfferId: "offer-1",
      offerId: "offer-1"
    })
  ], { officeId: OFFICE, now: NOW });
  assert.equal(index.get("request-1")?.matchCount, 1);
  assert.equal(index.get("offer-1")?.matchCount, 1);
});

test("follow-up operation is visible in follow-up filter", () => {
  const index = buildOpportunityActionIndex([
    operation({
      id: "follow-1",
      operationType: "OPPORTUNITY_FOLLOW_UP",
      matchId: "",
      livingStage: "FOLLOW_UP",
      followUpAt: "2026-09-15T08:00:00.000Z"
    })
  ], { officeId: OFFICE, now: NOW });
  const action = index.get("opp-1");
  assert.equal(opportunityMatchesActionFilter(action, OPPORTUNITY_ACTION_FILTER.FOLLOW_UP), true);
});

test("overdue appointment is action required and also remains a match", () => {
  const index = buildOpportunityActionIndex([
    operation({ appointmentAt: "2026-09-14T07:00:00.000Z" })
  ], { officeId: OFFICE, now: NOW });
  const action = index.get("opp-1");
  assert.equal(action?.category, OPPORTUNITY_ACTION_FILTER.NEEDS_ACTION);
  assert.equal(opportunityMatchesActionFilter(action, OPPORTUNITY_ACTION_FILTER.NEEDS_ACTION), true);
  assert.equal(opportunityMatchesActionFilter(action, OPPORTUNITY_ACTION_FILTER.MATCHES), true);
});

test("multiple active operations preserve every filter membership while keeping one primary action", () => {
  const index = buildOpportunityActionIndex([
    operation({ id: "match-activity", appointmentAt: "2026-09-14T13:00:00.000Z" }),
    operation({
      id: "follow-activity",
      operationType: "OPPORTUNITY_FOLLOW_UP",
      matchId: "",
      livingStage: "FOLLOW_UP",
      followUpAt: "2026-09-15T08:00:00.000Z"
    })
  ], { officeId: OFFICE, now: NOW });
  const action = index.get("opp-1");
  assert.equal(action?.category, OPPORTUNITY_ACTION_FILTER.APPOINTMENTS);
  assert.equal(opportunityMatchesActionFilter(action, OPPORTUNITY_ACTION_FILTER.MATCHES), true);
  assert.equal(opportunityMatchesActionFilter(action, OPPORTUNITY_ACTION_FILTER.APPOINTMENTS), true);
  assert.equal(opportunityMatchesActionFilter(action, OPPORTUNITY_ACTION_FILTER.FOLLOW_UP), true);
});

test("office isolation excludes active operations from another office", () => {
  const index = buildOpportunityActionIndex([
    operation(),
    operation({ id: "foreign", officeId: "office-b", opportunityId: "opp-b", matchId: "match-b" })
  ], { officeId: OFFICE, now: NOW });
  assert.equal(index.has("opp-1"), true);
  assert.equal(index.has("opp-b"), false);
});

test("inactive operations do not create action-filter membership", () => {
  const index = buildOpportunityActionIndex([
    operation({ status: "COMPLETED" })
  ], { officeId: OFFICE, now: NOW });
  assert.equal(index.has("opp-1"), false);
});
