import test from "node:test";
import assert from "node:assert/strict";

import {
  OPPORTUNITY_ACTION_FILTER,
  buildOpportunityActionIndex,
  opportunityMatchesActionFilter
} from "../public/js/opportunity-action-projection-domain.js";
import {
  BANK_INBOX_STATUS,
  bankInboxStatusKey
} from "../public/js/bank-inbox-card-domain.js";
import { bankOperationalNavigationDetail } from "../public/js/bank-inbox-card-ui.js";
import { projectOperationToUiItem } from "../public/js/operations-domain.js";
import { emptyCoordinationSession, coordinationSessionId } from "../public/js/coordination-session-domain.js";
import { resolveNegotiationState, NEGOTIATION_STATE } from "../public/js/negotiation-domain.js";
import { buildMatchReviewOperation } from "../worker/src/operations-domain.js";

const OFFICE_ID = "office-linkage";
const MATCH_ID = "mat_linkage_contract_1";
const REQUEST_ID = "opp_linkage_request_1";
const OFFER_ID = "opp_linkage_offer_1";

const READY_REQUEST = Object.freeze({
  opportunityKind: "REQUEST",
  purpose: "PURCHASE",
  propertyType: "فيلا",
  city: "المدينة المنورة",
  district: "العزيزية",
  priceOrBudget: 500000,
  budget: 500000,
  advertiserRole: "CLIENT",
  contactPhone: "0501111111",
  advertiserPhoneNormalized: "+966501111111"
});

test("one matchId remains linked from MATCH_REVIEW to both Bank sides and coordination", async () => {
  const operation = await buildMatchReviewOperation({
    officeId: OFFICE_ID,
    assignedBrokerId: "broker-1",
    matchId: MATCH_ID,
    opportunityId: REQUEST_ID,
    counterpartOpportunityId: OFFER_ID,
    clientRequestId: REQUEST_ID,
    ownerOfferId: OFFER_ID,
    dataVersion: "v1",
    score: 91,
    opportunityScore: 91,
    livingStage: "MATCH_FOUND",
    now: new Date("2026-09-16T00:00:00.000Z")
  });

  assert.equal(operation.matchId, MATCH_ID);
  assert.equal(operation.opportunityId, REQUEST_ID);
  assert.equal(operation.metadata.clientRequestId, REQUEST_ID);
  assert.equal(operation.metadata.ownerOfferId, OFFER_ID);

  const uiOperation = projectOperationToUiItem(operation);
  const index = buildOpportunityActionIndex([uiOperation], {
    officeId: OFFICE_ID,
    now: new Date("2026-09-16T00:10:00.000Z")
  });

  for (const opportunityId of [REQUEST_ID, OFFER_ID]) {
    const action = index.get(opportunityId);
    assert.ok(action, `missing projection for ${opportunityId}`);
    assert.equal(action.matchId, MATCH_ID);
    assert.equal(action.operationId, operation.id);
    assert.equal(action.matchCount, 1);
    assert.equal(opportunityMatchesActionFilter(action, OPPORTUNITY_ACTION_FILTER.MATCHES), true);
  }

  const requestAction = index.get(REQUEST_ID);
  assert.equal(
    bankInboxStatusKey(READY_REQUEST, { action: requestAction, matchCount: 0, bestMatchScore: 0 }),
    BANK_INBOX_STATUS.MATCH_FOUND
  );

  const article = {
    getAttribute(name) {
      return name === "data-opportunity-id" ? REQUEST_ID : "";
    }
  };
  const button = {
    getAttribute(name) {
      if (name === "data-opportunity-primary-action") return requestAction.actionCode;
      if (name === "data-match-id") return requestAction.matchId;
      if (name === "data-operation-id") return requestAction.operationId;
      return "";
    },
    closest() {
      return article;
    }
  };
  const navigation = bankOperationalNavigationDetail(button);
  assert.equal(navigation.matchId, MATCH_ID);
  assert.equal(navigation.operationId, operation.id);
  assert.equal(navigation.opportunityId, REQUEST_ID);

  const session = emptyCoordinationSession(MATCH_ID, OFFICE_ID);
  assert.equal(session.id, MATCH_ID);
  assert.equal(session.matchId, MATCH_ID);
  assert.equal(coordinationSessionId(MATCH_ID), MATCH_ID);

  const negotiation = resolveNegotiationState({
    clientBundle: {
      interestStatus: "not_suitable",
      rejectionDisposition: "negotiable",
      proposedPrice: 480000
    },
    ownerBundle: {
      propertyAvailability: "available",
      negotiationDecision: "accept"
    },
    canonicalOffer: { priceOrBudget: 500000 }
  });
  assert.equal(negotiation.applies, true);
  assert.equal(negotiation.state, NEGOTIATION_STATE.ACCEPTED);
  assert.equal(session.matchId, MATCH_ID);
});

test("active MATCH_REVIEW never disappears from either opportunity during linked lifecycle stages", () => {
  const stages = [
    "BROKER_REVIEW",
    "CLIENT_SENT",
    "CLIENT_NEEDS_DETAILS",
    "CLIENT_NEEDS_MISSING_INFO",
    "VIEWING_DECISION",
    "APPOINTMENT_COORDINATION"
  ];

  for (const livingStage of stages) {
    const operation = {
      id: `op_${livingStage}`,
      officeId: OFFICE_ID,
      recordType: "operation",
      operationType: "MATCH_REVIEW",
      status: "OPEN",
      matchId: MATCH_ID,
      opportunityId: REQUEST_ID,
      requestId: REQUEST_ID,
      offerId: OFFER_ID,
      clientRequestId: REQUEST_ID,
      ownerOfferId: OFFER_ID,
      livingStage,
      createdAt: "2026-09-16T00:00:00.000Z",
      updatedAt: "2026-09-16T00:05:00.000Z"
    };
    const index = buildOpportunityActionIndex([operation], {
      officeId: OFFICE_ID,
      now: new Date("2026-09-16T01:00:00.000Z")
    });

    for (const opportunityId of [REQUEST_ID, OFFER_ID]) {
      const action = index.get(opportunityId);
      assert.ok(action, `${livingStage} disappeared for ${opportunityId}`);
      assert.equal(action.matchId, MATCH_ID);
      assert.equal(action.operationId, operation.id);
      assert.equal(opportunityMatchesActionFilter(action, OPPORTUNITY_ACTION_FILTER.MATCHES), true);
    }
  }
});

test("Bank never advertises a persisted match from stale counters without the active MATCH_REVIEW projection", () => {
  const staleRecord = {
    ...READY_REQUEST,
    activeMatchCount: 2,
    matchCount: 2,
    bestMatchScore: 99,
    matchNeedsReview: true
  };

  assert.equal(
    bankInboxStatusKey(staleRecord, {
      action: null,
      matchCount: 2,
      bestMatchScore: 99,
      bestMatchComputed: true
    }),
    BANK_INBOX_STATUS.MATCHING
  );

  // Callers outside the Bank controller that do not provide an action projection
  // retain legacy stored-counter behavior for backward compatibility.
  assert.equal(bankInboxStatusKey(staleRecord), BANK_INBOX_STATUS.MATCH_FOUND);
});

test("MATCH_REVIEW identity is idempotent for the same match and data version", async () => {
  const input = {
    officeId: OFFICE_ID,
    matchId: MATCH_ID,
    opportunityId: REQUEST_ID,
    counterpartOpportunityId: OFFER_ID,
    clientRequestId: REQUEST_ID,
    ownerOfferId: OFFER_ID,
    dataVersion: "v1",
    score: 90,
    opportunityScore: 90
  };
  const first = await buildMatchReviewOperation(input);
  const second = await buildMatchReviewOperation(input);
  assert.equal(first.id, second.id);
  assert.equal(first.matchId, MATCH_ID);
  assert.equal(second.matchId, MATCH_ID);

  const index = buildOpportunityActionIndex([projectOperationToUiItem(first), projectOperationToUiItem(second)], {
    officeId: OFFICE_ID,
    now: new Date("2026-09-16T00:10:00.000Z")
  });
  assert.equal(index.get(REQUEST_ID).matchCount, 1);
  assert.equal(index.get(OFFER_ID).matchCount, 1);
  assert.equal(emptyCoordinationSession(MATCH_ID, OFFICE_ID).id, MATCH_ID);
});
