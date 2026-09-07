import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  COOPERATION_SUBCONTRACT_STATUS,
  canonicalOwnerForCooperationWorkflowAction,
  cooperationCleanupBoundaryGuarantees,
  cooperationSubcontractIsSigned,
  cooperationWorkflowActionIsDelegated,
  planAcceptedCooperationSubcontract,
  planCooperationSubcontractUpdate
} from "../worker/src/cooperation-contract-domain.js";

const root = path.resolve(import.meta.dirname, "..");

test("acceptance initializes a required subcontract but never signs it", () => {
  const patch = planAcceptedCooperationSubcontract({
    cooperation: { status: "PENDING" },
    now: new Date("2026-09-07T09:00:00.000Z")
  });
  assert.equal(patch.subcontractRequired, true);
  assert.equal(patch.subcontractStatus, COOPERATION_SUBCONTRACT_STATUS.NOT_STARTED);
  assert.equal(cooperationSubcontractIsSigned(patch), false);
});

test("signed subcontract requires accepted cooperation, a primary brokerage contract and reference", () => {
  assert.equal(planCooperationSubcontractUpdate({
    cooperation: { status: "PENDING" },
    requestedStatus: "draft"
  }).reason, "cooperation_not_accepted");

  const noPrimary = planCooperationSubcontractUpdate({
    cooperation: { status: "ACCEPTED", subcontractStatus: "pending_signature" },
    requestedStatus: "signed",
    subcontractReference: "SUB-001"
  });
  assert.equal(noPrimary.reason, "primary_brokerage_contract_required");

  const noRef = planCooperationSubcontractUpdate({
    cooperation: { status: "ACCEPTED", subcontractStatus: "pending_signature" },
    requestedStatus: "signed",
    primaryBrokerageContractId: "BRK-001"
  });
  assert.equal(noRef.reason, "subcontract_reference_required");

  const signed = planCooperationSubcontractUpdate({
    cooperation: { status: "ACCEPTED", subcontractStatus: "pending_signature" },
    requestedStatus: "signed",
    subcontractReference: "SUB-001",
    primaryBrokerageContractId: "BRK-001",
    now: new Date("2026-09-07T09:10:00.000Z")
  });
  assert.equal(signed.ok, true);
  assert.equal(signed.patch.subcontractStatus, "signed");
  assert.equal(signed.patch.primaryBrokerageContractId, "BRK-001");
});

test("signed subcontract is terminal", () => {
  const result = planCooperationSubcontractUpdate({
    cooperation: { status: "ACCEPTED", subcontractStatus: "signed", primaryBrokerageContractId: "BRK-1", subcontractReference: "SUB-1" },
    requestedStatus: "draft"
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "signed_subcontract_terminal");
});

test("cooperation does not own negotiation viewing deal or closing actions", () => {
  assert.equal(canonicalOwnerForCooperationWorkflowAction("CUSTOMER_INTERESTED"), "coordinationSessions");
  assert.equal(canonicalOwnerForCooperationWorkflowAction("PROPERTY_AVAILABLE"), "coordinationSessions");
  assert.equal(canonicalOwnerForCooperationWorkflowAction("CONFIRM_APPOINTMENT"), "matches");
  assert.equal(canonicalOwnerForCooperationWorkflowAction("PRELIMINARY_AGREEMENT"), "deals");
  assert.equal(canonicalOwnerForCooperationWorkflowAction("CONFIRM_COMPLETION"), "deals");
  assert.equal(cooperationWorkflowActionIsDelegated("ACCEPT"), false);
  assert.equal(cooperationWorkflowActionIsDelegated("CONFIRM_COMPLETION"), true);
});

test("ownership boundaries keep property and client at their original offices", () => {
  const boundary = cooperationCleanupBoundaryGuarantees();
  assert.equal(boundary.cooperationSourceOfTruth, "cooperationRequests");
  assert.equal(boundary.negotiationSourceOfTruth, "coordinationSessions");
  assert.equal(boundary.viewingSourceOfTruth, "matches");
  assert.equal(boundary.dealSourceOfTruth, "deals");
  assert.equal(boundary.opportunityOwnershipTransferAllowed, false);
  assert.equal(boundary.propertyOfficeChangesOnAcceptance, false);
  assert.equal(boundary.clientOfficeChangesOnAcceptance, false);
  assert.equal(boundary.acceptanceAutoSignsSubcontract, false);
});

test("runtime acceptance no longer auto-creates an active cooperation agreement", () => {
  const service = readFileSync(path.join(root, "worker", "src", "cooperation-phase6-service.js"), "utf8");
  const workflow = readFileSync(path.join(root, "worker", "src", "cooperation-workflow-service.js"), "utf8");
  const index = readFileSync(path.join(root, "worker", "src", "index.js"), "utf8");

  assert.match(service, /decision === "SET_SUBCONTRACT_STATUS"/);
  assert.match(service, /planAcceptedCooperationSubcontract/);
  assert.match(service, /writeSubcontractLibraryEntriesOnSign/);
  assert.equal(service.includes("writeAgreementLibraryEntriesOnAccept"), false);
  assert.match(service, /agreementType: fh\.firestoreString\("broker_subcontract"\)/);
  assert.match(service, /primaryBrokerageContractId/);

  assert.match(workflow, /canonical_transaction_required/);
  assert.match(workflow, /cooperationWorkflowActionIsDelegated/);
  assert.match(index, /subcontractStatus/);
  assert.match(index, /primaryBrokerageContractId/);
});
