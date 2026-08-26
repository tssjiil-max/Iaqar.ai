import test from "node:test";
import assert from "node:assert/strict";
import {
  completedDealSafety,
  countOpportunitySides,
  DELETE_COLLECTIONS,
  isCompletedDealRecord,
  isDeleteCollection,
  isProtectedCollection,
  officeIdentityMatches,
  PRESERVED_COLLECTIONS,
  RESET_TARGET_OFFICE_ID
} from "../public/js/staging-opportunity-reset-domain.js";

test("reset never targets office profile collections", () => {
  for (const name of ["members", "officeSettings", "brokerSettings", "devices", "library"]) {
    assert.equal(isProtectedCollection(name), true);
    assert.equal(isDeleteCollection(name), false);
  }
  assert.ok(!DELETE_COLLECTIONS.includes("members"));
  assert.ok(PRESERVED_COLLECTIONS.includes("officeSettings"));
});

test("reset deletes opportunity-cycle collections only", () => {
  for (const name of ["opportunities", "matches", "operations", "partySessions"]) {
    assert.equal(isDeleteCollection(name), true);
    assert.equal(isProtectedCollection(name), false);
  }
});

test("office identity is the explicit staging office id", () => {
  assert.equal(RESET_TARGET_OFFICE_ID, "staging-logo-live-20260807");
  assert.equal(officeIdentityMatches({ officeId: RESET_TARGET_OFFICE_ID }), true);
  assert.equal(officeIdentityMatches({ officeId: "staging-sultan" }), false);
});

test("unclear completed deals block automatic delete", () => {
  assert.equal(isCompletedDealRecord({ operationType: "DEAL_COMPLETED", id: "op_1" }), true);
  const safety = completedDealSafety([
    { id: "op_real", operationType: "DEAL_COMPLETED", createdBy: "broker" }
  ]);
  assert.equal(safety.ok, false);
  assert.equal(safety.blocked[0].id, "op_real");
});

test("tagged experimental completed deals do not block", () => {
  const safety = completedDealSafety([
    { id: "op_e2e", operationType: "DEAL_COMPLETED", isTestFixture: true }
  ]);
  assert.equal(safety.ok, true);
});

test("opportunity side counts split offers and requests", () => {
  const counts = countOpportunitySides([
    { opportunityKind: "OFFER" },
    { kind: "client_request" },
    { kind: "CLIENT" }
  ]);
  assert.deepEqual(counts, { offers: 1, requests: 1, other: 1 });
});
