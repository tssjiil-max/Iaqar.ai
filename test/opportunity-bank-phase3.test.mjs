/**
 * Phase 3 — Opportunity Bank automated tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  COOPERATION_STATE,
  EDITABLE_OPPORTUNITY_FIELDS,
  HIDDEN_TECHNICAL_FIELDS,
  LIFECYCLE,
  PROTECTED_OWNERSHIP_FIELDS,
  SHARE_REQUEST_STATUS,
  applyCooperationDecision,
  assertNoOwnershipMutation,
  bankDetailView,
  bankListItem,
  buildArchivePatch,
  buildBankSharingScope,
  buildCooperationRequest,
  buildEditPatch,
  buildRestorePatch,
  buildSoftDeletePatch,
  cooperationStateFromShareStatus,
  defaultSharePermissions,
  isActiveOpportunity,
  isArchivedOpportunity,
  phase3BoundaryGuarantees,
  scopeAllowsOpportunity,
  sharedOpportunityProjection,
  validateOwnedOpportunityIds
} from "../public/js/opportunity-bank-domain.js";
import { loadShell, readRepositoryFile } from "./helpers/shell.mjs";

const sample = {
  id: "opp_1",
  officeId: "office-a",
  brokerId: "broker-a",
  originatingOfficeId: "office-a",
  originatingBrokerId: "broker-a",
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
  opportunityKind: "OFFER",
  purpose: "SALE",
  propertyType: "شقة",
  city: "الرياض",
  district: "النرجس",
  priceOrBudget: 1200000,
  area: 180,
  rooms: 4,
  cooperationState: "NOT_SHARED",
  cooperationStatus: "NOT_SHARED",
  lifecycleStatus: "ACTIVE",
  version: 1,
  deduplicationFingerprint: "fp1",
  sourceReference: "src1",
  sourceType: "text",
  extractionConfidence: 80,
  rawText: "secret"
};

test("بنك الفرص entry opens from Office Settings and is not a home section", async () => {
  const context = await loadShell({ bootSettingsModule: true });
  try {
    const { document } = context;
    assert.ok(document.getElementById("openOpportunityBankBtn"));
    assert.ok(document.getElementById("opportunityBankSection"));
    assert.ok(document.getElementById("opportunityBank"));
    assert.equal(document.getElementById("opportunityBank").hasAttribute("hidden"), true);

    // Not a permanent home-page section inside .app
    const homeIds = Array.from(document.querySelector(".app").children).map((n) => n.id || n.className);
    assert.equal(homeIds.includes("opportunityBank"), false);
    assert.ok([...document.querySelector(".app").children].every((n) => n.id !== "opportunityBank"));

    // No bottom nav / deals
    assert.equal(document.querySelector("nav"), null);
    assert.equal(document.querySelector("[data-main='deals']"), null);
  } finally {
    context.close();
  }
});

test("list item shows essential fields and hides technical internals", () => {
  const row = bankListItem("opp_1", sample);
  assert.equal(row.propertyType, "شقة");
  assert.equal(row.purpose, "بيع");
  assert.ok(row.dateAdded);
  assert.equal(row.cooperationStatus, "لم تُشارك");
  for (const key of HIDDEN_TECHNICAL_FIELDS) {
    assert.equal(Object.prototype.hasOwnProperty.call(row, key), false);
  }
  assert.equal(Object.prototype.hasOwnProperty.call(row, "deduplicationFingerprint"), false);
});

test("detail view supports lazy source attachment preview only when requested", () => {
  const closed = bankDetailView("opp_1", sample);
  assert.equal(closed.sourcePreview, undefined);
  const open = bankDetailView("opp_1", sample, {
    includeSource: true,
    source: { sourceType: "pdf", fileName: "a.pdf", text: "", url: "", mediaPath: "x" }
  });
  assert.equal(open.sourcePreview.fileName, "a.pdf");
  assert.equal(open.extractionConfidence, undefined);
});

test("authorized edit succeeds and bumps version/updatedAt", () => {
  const result = buildEditPatch(sample, { city: "جدة", priceOrBudget: 1300000 }, { actorUid: "broker-a" });
  assert.equal(result.ok, true);
  assert.equal(result.patch.city, "جدة");
  assert.equal(result.patch.version, 2);
  assert.ok(result.patch.updatedAt);
  assert.equal(result.patch.brokerConfirmed, true);
});

test("protected ownership fields cannot be changed", () => {
  const violations = assertNoOwnershipMutation(sample, { officeId: "office-b" });
  assert.deepEqual(violations, ["officeId"]);
  const blocked = buildEditPatch(sample, { officeId: "office-b", city: "جدة" });
  assert.equal(blocked.ok, false);
  assert.ok(PROTECTED_OWNERSHIP_FIELDS.includes("createdAt"));
  assert.ok(EDITABLE_OPPORTUNITY_FIELDS.includes("city"));
});

test("createdAt cannot be changed through edit patch builder", () => {
  const result = buildEditPatch(sample, { createdAt: "1999-01-01T00:00:00.000Z", city: "جدة" });
  assert.equal(result.ok, false);
});

test("archive / restore / soft-delete are idempotent and preserve audit fields", () => {
  const archived = buildArchivePatch(sample, { actorUid: "broker-a" });
  assert.equal(archived.ok, true);
  assert.equal(archived.patch.lifecycleStatus, LIFECYCLE.ARCHIVED);
  assert.ok(archived.patch.archivedAt);
  assert.equal(buildArchivePatch({ ...sample, ...archived.patch }).idempotent, true);

  const restored = buildRestorePatch({ ...sample, ...archived.patch }, { actorUid: "broker-a" });
  assert.equal(restored.patch.lifecycleStatus, LIFECYCLE.ACTIVE);

  const deleted = buildSoftDeletePatch(sample, { actorUid: "broker-a", reason: "test" });
  assert.equal(deleted.patch.lifecycleStatus, LIFECYCLE.DELETED);
  assert.ok(deleted.patch.deletedAt);
  assert.equal(deleted.patch.deletionReason, "test");
  assert.equal(buildSoftDeletePatch({ ...sample, ...deleted.patch }).idempotent, true);

  assert.equal(isArchivedOpportunity({ ...sample, lifecycleStatus: "ARCHIVED", archivedAt: "x" }), true);
  assert.equal(isActiveOpportunity({ ...sample, lifecycleStatus: "DELETED", deletedAt: "x" }), false);
});

test("cooperation status transitions use approved Arabic labels", async () => {
  assert.equal(cooperationStateFromShareStatus("PENDING"), COOPERATION_STATE.PENDING_APPROVAL);
  assert.equal(cooperationStateFromShareStatus("ACCEPTED"), COOPERATION_STATE.ACTIVE);
  assert.equal(cooperationStateFromShareStatus("REJECTED"), COOPERATION_STATE.REJECTED);
  assert.equal(cooperationStateFromShareStatus("REVOKED"), COOPERATION_STATE.ENDED);

  const built = await buildCooperationRequest({
    originatingOfficeId: "office-a",
    originatingBrokerId: "broker-a",
    targetOfficeId: "office-b",
    opportunityId: "opp_1",
    scopeType: "single"
  });
  assert.equal(built.ok, true);
  assert.equal(built.request.status, SHARE_REQUEST_STATUS.PENDING);
  assert.deepEqual(built.request.permissions, defaultSharePermissions());

  const accepted = applyCooperationDecision(built.request, "ACCEPT", { actorUid: "broker-b" });
  assert.equal(accepted.patch.status, SHARE_REQUEST_STATUS.ACCEPTED);
  const rejected = applyCooperationDecision(built.request, "REJECT");
  assert.equal(rejected.patch.status, SHARE_REQUEST_STATUS.REJECTED);
  const revoked = applyCooperationDecision({ ...built.request, status: "ACCEPTED" }, "REVOKE");
  assert.equal(revoked.patch.status, SHARE_REQUEST_STATUS.REVOKED);
});

test("duplicate active cooperation request ids are stable", async () => {
  const a = await buildCooperationRequest({
    originatingOfficeId: "office-a",
    originatingBrokerId: "broker-a",
    targetOfficeId: "office-b",
    opportunityId: "opp_1",
    scopeType: "single"
  });
  const b = await buildCooperationRequest({
    originatingOfficeId: "office-a",
    originatingBrokerId: "broker-a",
    targetOfficeId: "office-b",
    opportunityId: "opp_1",
    scopeType: "single"
  });
  assert.equal(a.request.id, b.request.id);
});

test("selected sharing rejects mixed-office IDs", () => {
  const map = new Map([
    ["opp_1", { officeId: "office-a" }],
    ["opp_2", { officeId: "office-b" }]
  ]);
  const result = validateOwnedOpportunityIds("office-a", map, ["opp_1", "opp_2"]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.rejected, ["opp_2"]);
  assert.deepEqual(result.accepted, ["opp_1"]);
});

test("scoped bank sharing is disabled by default and hides contacts", async () => {
  const disabled = await buildBankSharingScope({
    originatingOfficeId: "office-a",
    originatingBrokerId: "broker-a",
    targetOfficeId: "office-b",
    enabled: false
  });
  assert.equal(disabled.scope.status, "DISABLED");
  assert.equal(disabled.scope.enabled, false);
  assert.equal(disabled.scope.permissions.contactVisible, false);
  assert.equal(disabled.scope.permissions.readOnly, true);

  const enabled = await buildBankSharingScope({
    originatingOfficeId: "office-a",
    originatingBrokerId: "broker-a",
    targetOfficeId: "office-b",
    enabled: true,
    opportunityIds: ["opp_1"]
  });
  assert.equal(scopeAllowsOpportunity(enabled.scope, { id: "opp_1", lifecycleStatus: "ACTIVE" }), true);
  assert.equal(scopeAllowsOpportunity(enabled.scope, { id: "opp_2", lifecycleStatus: "ACTIVE" }), false);
  assert.equal(scopeAllowsOpportunity({ ...enabled.scope, status: "REVOKED", revokedAt: "x" }, { id: "opp_1" }), false);
});

test("shared projection never exposes contact or ownership mutation rights", () => {
  const shared = sharedOpportunityProjection("opp_1", {
    ...sample,
    contactPhone: "0551111111",
    phone: "0551111111",
    contactName: "Secret"
  }, { id: "coop_1", permissions: defaultSharePermissions() });
  assert.equal(shared.contactPhone, "");
  assert.equal(shared.phone, "");
  assert.equal(shared.contactName, "");
  assert.equal(shared.readOnly, true);
  assert.equal(shared.permissions.canDelete, false);
  assert.equal(shared.permissions.ownershipModifiable, false);
});

test("Phase 3 boundaries: no match, operations, messaging, or matching engine", () => {
  const g = phase3BoundaryGuarantees();
  assert.equal(g.createsMatch, false);
  assert.equal(g.createsOperation, false);
  assert.equal(g.sendsNotification, false);
  assert.equal(g.sendsWhatsApp, false);
  assert.equal(g.sendsTelegram, false);
  assert.equal(g.runsMatchingEngine, false);
});

test("shell wires opportunity-bank module and keeps settings entry", () => {
  const shell = readRepositoryFile("public", "index.html");
  assert.ok(shell.includes("js/opportunity-bank.js"));
  assert.ok(shell.includes("id=\"openOpportunityBankBtn\""));
  assert.ok(shell.includes("id=\"bankFilterArchived\""));
  assert.ok(shell.includes("id=\"opportunityBankDetail\""));
  assert.ok(shell.includes("id=\"bankLoadMoreBtn\""));
  assert.ok(shell.includes("id=\"bankDeleteConfirm\"") || readRepositoryFile("public", "js", "opportunity-bank.js").includes("bankDeleteConfirm"));
  assert.equal(/data-main=\"deals\"/.test(shell), false);
});

test("delete requires an explicit confirmation step in the bank UI", () => {
  const bank = readRepositoryFile("public", "js", "opportunity-bank.js");
  assert.ok(bank.includes("bankDeleteConfirm"));
  assert.ok(bank.includes("تأكيد الحذف"));
  assert.ok(bank.includes("bankDeleteConfirmBtn"));
});

test("new Opportunity defaults to NOT_SHARED / لم تُشارك", () => {
  const row = bankListItem("x", { ...sample, cooperationState: undefined, cooperationStatus: undefined });
  assert.equal(row.cooperationState, COOPERATION_STATE.NOT_SHARED);
  assert.equal(row.cooperationStatus, "لم تُشارك");
});

test("soft-deleted opportunities are not active and not archived", () => {
  const deleted = { ...sample, lifecycleStatus: "DELETED", deletedAt: "2026-08-03T00:00:00.000Z" };
  assert.equal(isActiveOpportunity(deleted), false);
  assert.equal(isArchivedOpportunity(deleted), false);
});