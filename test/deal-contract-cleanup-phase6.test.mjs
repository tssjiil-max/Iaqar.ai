import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BROKERAGE_CONTRACT_STATUS,
  DEAL_STAGE_ORDER,
  brokerageContractIsSigned,
  dealContractBoundaryGuarantees,
  evaluateDealCreation,
  nextDealStage,
  planBrokerageContractUpdate,
  planDealClosure,
  planDealStageTransition
} from "../worker/src/deal-contract-domain.js";

test("deal creation requires serious coordination or confirmed viewing", () => {
  assert.equal(evaluateDealCreation({ match: { status: "active" } }).allowed, false);
  assert.equal(evaluateDealCreation({ match: { appointmentAt: "2026-09-08T10:00:00.000Z" } }).allowed, true);
  assert.equal(evaluateDealCreation({ coordination: { outcome: "VIEWING_READY" } }).allowed, true);
  assert.equal(evaluateDealCreation({ coordination: { outcome: "PRICE_ALIGNED" } }).allowed, true);
});

test("deal stages are sequential and cannot move backward or skip", () => {
  assert.deepEqual(DEAL_STAGE_ORDER, ["contact", "viewing", "negotiation", "agreement", "closing", "closed"]);
  assert.equal(nextDealStage("negotiation"), "agreement");
  assert.equal(planDealStageTransition({ deal: { workflowStage: "negotiation" }, requestedStage: "viewing" }).reason, "backward_transition");
  assert.equal(planDealStageTransition({ deal: { workflowStage: "negotiation" }, requestedStage: "closing" }).reason, "skipped_stage");
});

test("brokerage contract is mandatory before entering closing", () => {
  const blocked = planDealStageTransition({
    deal: { workflowStage: "agreement", brokerageContractStatus: "pending_signature" },
    requestedStage: "closing"
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "brokerage_contract_required");

  const allowed = planDealStageTransition({
    deal: { workflowStage: "agreement", brokerageContractStatus: "signed" },
    requestedStage: "closing"
  });
  assert.equal(allowed.ok, true);
});

test("deal cannot close before closing stage and a signed contract", () => {
  assert.equal(planDealClosure({ deal: { workflowStage: "agreement", brokerageContractStatus: "signed" } }).reason, "deal_not_ready_to_close");
  assert.equal(planDealClosure({ deal: { workflowStage: "closing", brokerageContractStatus: "draft" } }).reason, "brokerage_contract_required");
  assert.equal(planDealClosure({ deal: { workflowStage: "closing", brokerageContractStatus: "signed" } }).ok, true);
});

test("signed brokerage contract is terminal and cannot be silently changed", () => {
  const signed = planBrokerageContractUpdate({
    deal: { brokerageContractStatus: "pending_signature" },
    requestedStatus: BROKERAGE_CONTRACT_STATUS.SIGNED,
    reference: "BRK-2026-001",
    now: new Date("2026-09-07T09:00:00.000Z")
  });
  assert.equal(signed.ok, true);
  assert.equal(signed.patch.brokerageContractStatus, "signed");
  assert.equal(signed.patch.brokerageContractReference, "BRK-2026-001");
  assert.equal(brokerageContractIsSigned(signed.patch), true);

  const reopen = planBrokerageContractUpdate({
    deal: { brokerageContractStatus: "signed" },
    requestedStatus: "draft"
  });
  assert.equal(reopen.ok, false);
  assert.equal(reopen.reason, "signed_contract_terminal");
});

test("deal boundary keeps Deal authoritative and Operations projection-only", () => {
  const boundary = dealContractBoundaryGuarantees();
  assert.equal(boundary.dealSourceOfTruth, "deals");
  assert.equal(boundary.matchOwnsDealStage, false);
  assert.equal(boundary.operationOwnsDealStage, false);
  assert.equal(boundary.brokerageContractRequiredBeforeClosing, true);
});
