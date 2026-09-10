import test from "node:test";
import assert from "node:assert/strict";
import {
  POST_VIEWING_ACTIONS,
  isAllowedPostViewingAction,
  postViewingActionsForRole,
  resolvePostViewingPair
} from "../public/js/post-viewing-party-domain.js";

test("post-viewing choices are exposed only after viewing completes", () => {
  assert.deepEqual(postViewingActionsForRole("client", { livingStage: "FOLLOW_UP" }), []);
  assert.deepEqual(postViewingActionsForRole("owner", { livingStage: "APPOINTMENT_CONFIRMED" }), []);
  assert.deepEqual(
    postViewingActionsForRole("client", { livingStage: "VIEWING_COMPLETED" }).map((x) => x.label),
    ["جدي ونكمل", "أحتاج تفاوض", "غير مهتم"]
  );
  assert.deepEqual(
    postViewingActionsForRole("owner", { livingStage: "VIEWING_COMPLETED" }).map((x) => x.label),
    ["موافق نكمل", "أحتاج تفاوض", "غير مهتم"]
  );
});

test("a stored post-viewing decision cannot be offered again", () => {
  assert.deepEqual(postViewingActionsForRole("client", {
    livingStage: "VIEWING_COMPLETED",
    existingDecision: "serious_continue"
  }), []);
});

test("role-specific actions cannot cross roles", () => {
  assert.equal(isAllowedPostViewingAction("client", "serious_continue", { livingStage: "VIEWING_COMPLETED" }), true);
  assert.equal(isAllowedPostViewingAction("owner", "serious_continue", { livingStage: "VIEWING_COMPLETED" }), false);
  assert.equal(isAllowedPostViewingAction("owner", "approve_continue", { livingStage: "VIEWING_COMPLETED" }), true);
  assert.equal(isAllowedPostViewingAction("client", "approve_continue", { livingStage: "VIEWING_COMPLETED" }), false);
  assert.equal(isAllowedPostViewingAction("client", "serious_continue", { livingStage: "WAITING_CLIENT" }), false);
});

test("one party alone never resolves both parties as serious", () => {
  assert.equal(resolvePostViewingPair({ clientDecision: "serious_continue" }).bothContinue, false);
  assert.equal(resolvePostViewingPair({ ownerDecision: "approve_continue" }).bothContinue, false);
  assert.equal(resolvePostViewingPair({ clientDecision: "serious_continue" }).awaitingOtherParty, true);
});

test("both approved continuation decisions produce broker agreement action", () => {
  const result = resolvePostViewingPair({ clientDecision: "serious_continue", ownerDecision: "approve_continue" });
  assert.equal(result.bothContinue, true);
  assert.match(result.brokerAction, /اتفاق الوساطة\/الصفقة/);
});

test("approved labels remain exact", () => {
  assert.deepEqual(POST_VIEWING_ACTIONS.client.map((x) => x.label), ["جدي ونكمل", "أحتاج تفاوض", "غير مهتم"]);
  assert.deepEqual(POST_VIEWING_ACTIONS.owner.map((x) => x.label), ["موافق نكمل", "أحتاج تفاوض", "غير مهتم"]);
});
