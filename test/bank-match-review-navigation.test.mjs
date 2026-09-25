import test from "node:test";
import assert from "node:assert/strict";
import * as navigation from "../public/js/opportunity-navigation-domain.js";

test("review_match opens the exact match even when a stale operation id is present", () => {
  assert.equal(typeof navigation.buildBankOperationalOpenDetail, "function");
  const result = navigation.buildBankOperationalOpenDetail({
    opportunityId: "opp_request_arwa",
    matchId: "mat_exact_arwa",
    operationId: "op_stale_wabra",
    actionCode: "review_match"
  });
  assert.deepEqual(result, {
    ok: true,
    detail: {
      opportunityId: "opp_request_arwa",
      matchId: "mat_exact_arwa",
      operationId: "op_stale_wabra",
      actionCode: "review_match",
      id: "mat_exact_arwa",
      returnTarget: "bank_matches"
    }
  });
});

test("review_match is blocked when its exact match id is missing", () => {
  assert.equal(typeof navigation.buildBankOperationalOpenDetail, "function");
  const result = navigation.buildBankOperationalOpenDetail({
    opportunityId: "opp_request_arwa",
    operationId: "op_stale_wabra",
    actionCode: "review_match"
  });
  assert.deepEqual(result, {
    ok: false,
    error: "match_required"
  });
});
