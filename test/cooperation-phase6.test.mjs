/**
 * Phase 6 — Cooperation ownership, revocation, audit, mode enforcement.
 * Acceptance Tests 11 and 12.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  FIVE_ARABIC_COOPERATION_STATUSES,
  assertOwnershipPreserved,
  buildCooperationAuditEntry,
  buildRevocationCleanupPlan,
  buildSharedProjection,
  cooperationModeAllowsAccept,
  cooperationModeAllowsExplicitRequest,
  applyCooperationDecision,
  phase6BoundaryGuarantees,
  withCurrentOwningOffice,
  COOPERATION_AUDIT_ACTIONS
} from "../worker/src/cooperation-phase6-domain.js";
import {
  phase6BoundaryGuarantees as clientBoundaries,
  COOPERATION_LIFECYCLE_PATH,
  requestCooperationLifecycle,
  FIVE_ARABIC_COOPERATION_STATUSES as clientStatuses
} from "../public/js/cooperation-phase6-domain.js";
import {
  COOPERATION_STATUS_LABELS,
  PROTECTED_OWNERSHIP_FIELDS,
  buildCooperationRequest,
  sharedOpportunityProjection
} from "../public/js/opportunity-bank-domain.js";
import { readRepositoryFile } from "./helpers/shell.mjs";

test("Phase 6 boundaries never invent automatic cooperation or messaging", () => {
  const g = phase6BoundaryGuarantees();
  assert.equal(g.createsAutomaticCooperation, false);
  assert.equal(g.createsBrokerRecommendation, false);
  assert.equal(g.inventsPerformanceScores, false);
  assert.equal(g.exposesContactAutomatically, false);
  assert.equal(g.createsFinancialCommitment, false);
  assert.equal(g.sendsWhatsApp, false);
  assert.equal(g.sendsTelegram, false);
  assert.equal(g.addsDealsPage, false);
  assert.equal(g.addsBottomNavigation, false);
  assert.equal(g.smartAutomaticImplemented, false);
  assert.deepEqual(clientBoundaries(), g);
});

test("Test 11: five Arabic cooperation statuses remain exact", () => {
  assert.deepEqual([...FIVE_ARABIC_COOPERATION_STATUSES], [
    "لم تُشارك", "بانتظار الموافقة", "تعاون نشط", "رُفض الطلب", "انتهى التعاون"
  ]);
  assert.deepEqual([...clientStatuses], [...FIVE_ARABIC_COOPERATION_STATUSES]);
  assert.deepEqual(Object.values(COOPERATION_STATUS_LABELS), [...FIVE_ARABIC_COOPERATION_STATUSES]);
});

test("Test 11: ownership fields are preserved across cooperation patches", () => {
  const before = {
    id: "opp_1",
    officeId: "office-a",
    brokerId: "broker-a1",
    originatingOfficeId: "office-a",
    originatingBrokerId: "broker-a1",
    currentOwningOfficeId: "office-a",
    createdAt: "2026-08-01T00:00:00.000Z",
    deduplicationFingerprint: "fp1"
  };
  const afterShare = {
    ...before,
    cooperationState: "ACTIVE",
    cooperationStatus: "ACTIVE",
    activeCooperationId: "coop_1"
  };
  const check = assertOwnershipPreserved(before, afterShare);
  assert.equal(check.ok, true);
  assert.ok(PROTECTED_OWNERSHIP_FIELDS.includes("currentOwningOfficeId"));
});

test("Test 11: cooperating projection never includes contact or ownership transfer", () => {
  const projection = buildSharedProjection({
    opportunityId: "opp_1",
    source: {
      officeId: "office-a",
      originatingOfficeId: "office-a",
      currentOwningOfficeId: "office-a",
      opportunityKind: "OFFER",
      purpose: "SALE",
      propertyType: "شقة",
      city: "الرياض",
      district: "النرجس",
      priceOrBudget: 900000,
      contactPhone: "0551111111",
      contactName: "مالك"
    },
    request: { id: "coop_1", permissions: { contactVisible: true } }
  });
  assert.equal(projection.contactPhone, "");
  assert.equal(projection.phone, "");
  assert.equal(projection.contactName, "");
  assert.equal(projection.permissions.contactVisible, false);
  assert.equal(projection.permissions.ownershipModifiable, false);
  assert.equal(projection.originatingOfficeId, "office-a");
  assert.equal(projection.currentOwningOfficeId, "office-a");
  assert.equal(projection.propertyType, "شقة");
  assert.equal(projection.district, "النرجس");
});

test("Test 11: client sharedOpportunityProjection also strips contacts", () => {
  const row = sharedOpportunityProjection("opp_1", {
    officeId: "office-a",
    originatingOfficeId: "office-a",
    contactPhone: "055",
    phone: "055",
    contactName: "x",
    propertyType: "فيلا"
  }, { id: "coop_1" });
  assert.equal(row.contactPhone, "");
  assert.equal(row.phone, "");
  assert.equal(row.contactName, "");
  assert.equal(row.readOnly, true);
});

test("Test 12: revocation cleanup plan targets shared projections", () => {
  const plan = buildRevocationCleanupPlan({
    id: "coop_1",
    originatingOfficeId: "office-a",
    targetOfficeId: "office-b",
    opportunityIds: ["opp_1", "opp_2"]
  });
  assert.equal(plan.removeSharedProjections, true);
  assert.equal(plan.targetOfficeId, "office-b");
  assert.deepEqual(plan.opportunityIds, ["opp_1", "opp_2"]);
  assert.equal(plan.terminalStatus, "REVOKED");
});

test("Test 12: revoke decision is idempotent and terminal", () => {
  const first = applyCooperationDecision({ status: "ACCEPTED" }, "REVOKE", { actorUid: "broker-a1" });
  assert.equal(first.ok, true);
  assert.equal(first.patch.status, "REVOKED");
  const second = applyCooperationDecision({ status: "REVOKED" }, "REVOKE");
  assert.equal(second.ok, true);
  assert.equal(second.idempotent, true);
});

test("DISABLED mode blocks new cooperation requests and accepts", () => {
  assert.equal(cooperationModeAllowsExplicitRequest("DISABLED"), false);
  assert.equal(cooperationModeAllowsAccept("DISABLED"), false);
  assert.equal(cooperationModeAllowsExplicitRequest("APPROVAL_REQUIRED"), true);
  assert.equal(cooperationModeAllowsExplicitRequest("SMART_AUTOMATIC"), true);
});

test("audit entry excludes sensitive contact fields", async () => {
  const entry = await buildCooperationAuditEntry({
    action: COOPERATION_AUDIT_ACTIONS.REQUEST_ACCEPTED,
    officeId: "office-a",
    actorUid: "broker-b1",
    cooperationId: "coop_1",
    originatingOfficeId: "office-a",
    targetOfficeId: "office-b",
    opportunityIds: ["opp_1"],
    details: {
      nextStatus: "ACCEPTED",
      contactPhone: "0559999999",
      phone: "0559999999",
      contactName: "secret"
    }
  });
  assert.ok(entry.id.startsWith("aud_"));
  assert.equal(entry.details.contactPhone, undefined);
  assert.equal(entry.details.phone, undefined);
  assert.equal(entry.details.contactName, undefined);
  assert.equal(entry.details.nextStatus, "ACCEPTED");
});

test("currentOwningOfficeId defaults to officeId", () => {
  const row = withCurrentOwningOffice({ officeId: "office-a", originatingOfficeId: "office-a" });
  assert.equal(row.currentOwningOfficeId, "office-a");
});

test("cooperation request build remains explicit PENDING only", async () => {
  const built = await buildCooperationRequest({
    originatingOfficeId: "office-a",
    originatingBrokerId: "broker-a1",
    targetOfficeId: "office-b",
    opportunityId: "opp_1",
    scopeType: "single"
  });
  assert.equal(built.ok, true);
  assert.equal(built.request.status, "PENDING");
  assert.equal(built.request.permissions.contactVisible, false);
});

test("client lifecycle helper posts to Worker /cooperation/lifecycle", async () => {
  assert.equal(COOPERATION_LIFECYCLE_PATH, "/cooperation/lifecycle");
  const calls = [];
  const result = await requestCooperationLifecycle({
    workerBase: "https://example.test",
    idToken: "token",
    officeId: "office-b",
    cooperationId: "coop_1",
    action: "ACCEPT",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => ({ ok: true, status: "ACCEPTED", projectionsWritten: 1 })
      };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "https://example.test/cooperation/lifecycle");
  assert.equal(JSON.parse(calls[0].init.body).action, "ACCEPT");
});

test("Worker and bank wire Phase 6 lifecycle without Deals or messaging", () => {
  const worker = readRepositoryFile("worker", "src", "index.js");
  const bank = readRepositoryFile("public", "js", "opportunity-bank.js");
  const shell = readRepositoryFile("public", "index.html");
  assert.ok(worker.includes("/cooperation/lifecycle"));
  assert.ok(worker.includes("/cooperation/scope-revoke"));
  assert.ok(worker.includes("runCooperationLifecycle"));
  assert.ok(bank.includes("runTrustedCooperationLifecycle"));
  assert.ok(bank.includes("cooperationModeAllowsExplicitRequest"));
  assert.ok(bank.includes("loadSharedWithUs"));
  assert.ok(shell.includes("id=\"bankSharedWithUs\""));
  assert.ok(shell.includes("id=\"bankOutgoingScopes\""));
  assert.equal(/data-main=\"deals\"/.test(shell), false);
  assert.equal(bank.includes("createsAutomaticCooperation: true"), false);
});

test("intake stamps currentOwningOfficeId", () => {
  const intake = readRepositoryFile("public", "js", "opportunity-intake-domain.js");
  assert.ok(intake.includes("currentOwningOfficeId"));
});
