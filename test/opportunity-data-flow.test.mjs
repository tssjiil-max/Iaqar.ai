import test from "node:test";
import assert from "node:assert/strict";
import {
  MATCH_CONTACT_INCOMPLETE_LABEL,
  canonicalFirestoreOfficeId,
  dedupeOperationsFeedItems,
  evaluateMatchContactGate,
  extractOpportunityIdFromOperationsItem,
  isValidContactPhone,
  matchDedupeKey,
  resolveDetailsOpportunityId,
  resolveMatchIds,
  shouldShowBankLoadMore,
  scopedMatchGroupKey
} from "../public/js/opportunity-data-flow-domain.js";

test("resolveMatchIds normalizes request and offer ids", () => {
  const ids = resolveMatchIds({
    recordType: "match",
    id: "m1",
    matchId: "m1",
    clientRequestId: "req-1",
    ownerOfferId: "off-1"
  });
  assert.equal(ids.matchId, "m1");
  assert.equal(ids.requestId, "req-1");
  assert.equal(ids.offerId, "off-1");
});

test("matchDedupeKey scopes by office and pair", () => {
  const key = matchDedupeKey({
    clientRequestId: "req-1",
    ownerOfferId: "off-1"
  }, "Office-A");
  assert.equal(key, "Office-A|req-1|off-1");
});

test("evaluateMatchContactGate blocks matched state without phones", () => {
  const gate = evaluateMatchContactGate({
    item: { clientPhone: "", ownerPhone: "" },
    request: { contactPhone: "" },
    offer: { contactPhone: "" }
  });
  assert.equal(gate.canShowAsMatched, false);
  assert.equal(gate.canSendToClient, false);
  assert.equal(gate.statusLabel, MATCH_CONTACT_INCOMPLETE_LABEL);
});

test("evaluateMatchContactGate accepts Saudi local and +966 formats", () => {
  const gate = evaluateMatchContactGate({
    item: {},
    request: { contactPhone: "0512345678" },
    offer: { contactPhone: "+966501234567" }
  });
  assert.equal(gate.clientComplete, true);
  assert.equal(gate.ownerComplete, true);
  assert.equal(gate.canShowAsMatched, true);
});

test("isValidContactPhone rejects short numbers", () => {
  assert.equal(isValidContactPhone("055123"), false);
  assert.equal(isValidContactPhone("0512345678"), true);
});

test("extractOpportunityIdFromOperationsItem resolves match offer/request", () => {
  assert.equal(extractOpportunityIdFromOperationsItem({
    recordType: "match",
    matchId: "m1",
    ownerOfferId: "off-9",
    clientRequestId: "req-2"
  }), "off-9");
});

test("resolveDetailsOpportunityId prefers offer for open action", () => {
  assert.equal(resolveDetailsOpportunityId({
    offerId: "off-1",
    requestId: "req-1"
  }, "offer"), "off-1");
  assert.equal(resolveDetailsOpportunityId({
    offerId: "off-1",
    requestId: "req-1"
  }, "request"), "req-1");
});

test("dedupeOperationsFeedItems keeps match doc over MATCH_REVIEW operation", () => {
  const items = [
    {
      id: "op-1",
      operationType: "MATCH_REVIEW",
      matchId: "m1",
      recordType: "operation",
      clientRequestId: "req-1",
      ownerOfferId: "off-1"
    },
    {
      id: "m1",
      recordId: "m1",
      recordType: "match",
      matchId: "m1",
      clientRequestId: "req-1",
      ownerOfferId: "off-1"
    }
  ];
  const out = dedupeOperationsFeedItems(items);
  assert.equal(out.length, 1);
  assert.equal(out[0].recordType, "match");
});

test("shouldShowBankLoadMore hides when exhausted with zero visible rows", () => {
  assert.equal(shouldShowBankLoadMore({ hasMore: true, visibleCount: 0, scanExhausted: true }), false);
  assert.equal(shouldShowBankLoadMore({ hasMore: true, visibleCount: 3, scanExhausted: false }), true);
});

test("scopedMatchGroupKey includes office scope", () => {
  const key = scopedMatchGroupKey({
    clientRequestId: "req-1",
    opportunityKind: "REQUEST"
  }, "MyOffice");
  assert.equal(key, "MyOffice|req-1");
});

test("canonicalFirestoreOfficeId preserves mixed case", () => {
  assert.equal(canonicalFirestoreOfficeId("Office-A"), "Office-A");
});
