import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFICE_PAUSE_REASONS,
  OFFICE_DELETE_REASONS,
  OFFICE_DELETE_CONFIRM_PHRASE,
  OFFICE_FULL_DELETE_UNAVAILABLE_MESSAGE,
  isOfficePaused,
  isOfficeAcceptingNewWork,
  sanitizeReasonNote,
  validatePauseReason,
  parseOptionalReturnDate,
  buildOfficePausePatch,
  buildOfficeResumePatch,
  shouldSuggestPauseInsteadOfDelete,
  validateOfficeDeleteReason,
  isOfficeDeleteConfirmPhrase,
  officeDeleteIsFullySupported
} from "../public/js/office-account-lifecycle-domain.js";
import { isOfficeEligibleForCooperationListing } from "../public/js/suitable-offices-domain.js";
import { rankBrokerCommunityMatches } from "../public/js/broker-community-domain.js";
import { buildOpportunityMoreMenuHtml, buildWorkspaceCoopRowsHtml } from "../public/js/opportunity-bank-workspace-ui.js";
import { readRepositoryFile } from "./helpers/shell.mjs";
import { ACCOUNT_STATUSES, officeMatchesTab } from "../worker/src/admin-domain.js";

test("pause reasons and delete reasons use the requested codes", () => {
  assert.deepEqual(OFFICE_PAUSE_REASONS.map((row) => row.code), [
    "vacation", "temporary_break", "busy", "personal_reason",
    "office_reorganization", "team_unavailable", "not_accepting_now", "other"
  ]);
  assert.equal(OFFICE_DELETE_REASONS.length, 17);
  assert.equal(OFFICE_DELETE_CONFIRM_PHRASE, "حذف المكتب");
});

test("accountStatus paused is the existing office status field", () => {
  assert.equal(isOfficePaused({ accountStatus: "paused" }), true);
  assert.equal(isOfficePaused({ accountStatus: "active" }), false);
  assert.equal(isOfficeAcceptingNewWork({ accountStatus: "paused" }), false);
  assert.equal(isOfficeEligibleForCooperationListing({
    officeId: "office-x",
    cooperationMode: "APPROVAL_REQUIRED",
    approvalStatus: "approved",
    accountStatus: "paused",
    receiveExternalOpportunities: true,
    cooperationAvailableNow: true,
    licenseNumber: "123"
  }), false);
});

test("pause reason is required and return date is optional", () => {
  assert.equal(validatePauseReason({}).ok, false);
  assert.equal(validatePauseReason({ reasonCode: "vacation" }).ok, true);
  assert.equal(validatePauseReason({ reasonCode: "other", otherNote: "" }).ok, false);
  assert.equal(validatePauseReason({ reasonCode: "other", otherNote: "ظرف عائلي" }).ok, true);
  assert.equal(parseOptionalReturnDate("", { unspecified: true }).ok, true);
  assert.equal(parseOptionalReturnDate("").iso, "");
  const patch = buildOfficePausePatch({ reasonCode: "busy", unspecifiedReturn: true, actorUid: "u1" });
  assert.equal(patch.ok, true);
  assert.equal(patch.patch.accountStatus, "paused");
  assert.equal(patch.patch.pauseExpectedReturnAt, "");
  assert.equal(buildOfficeResumePatch().accountStatus, "active");
});

test("reason notes strip html and scripts", () => {
  assert.equal(sanitizeReasonNote("<b>ظرف</b>"), "ظرف");
  assert.equal(sanitizeReasonNote("javascript:alert(1)").includes("javascript:"), false);
  assert.equal(sanitizeReasonNote("أ".repeat(400)).length, 300);
});

test("delete reason is required and pause can be suggested without being forced", () => {
  assert.equal(validateOfficeDeleteReason({}).ok, false);
  const low = validateOfficeDeleteReason({ reasonCode: "low_usage" });
  assert.equal(low.ok, true);
  assert.equal(low.suggestPause, true);
  assert.equal(shouldSuggestPauseInsteadOfDelete("too_difficult"), false);
  assert.equal(isOfficeDeleteConfirmPhrase("حذف المكتب"), true);
  assert.equal(isOfficeDeleteConfirmPhrase("حذف"), false);
  assert.equal(officeDeleteIsFullySupported(), false);
  assert.ok(OFFICE_FULL_DELETE_UNAVAILABLE_MESSAGE.includes("Backend"));
});

test("paused offices are excluded from community suggestions", () => {
  const source = {
    id: "offer-a",
    officeId: "office-a",
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "عروة",
    salePrice: 400000,
    priceOrBudget: 400000,
    area: 600,
    advertiserRole: "OWNER",
    advertiserPhoneNormalized: "+966500000001"
  };
  const candidate = {
    id: "req-b",
    officeId: "office-b",
    opportunityKind: "REQUEST",
    purpose: "PURCHASE",
    propertyType: "أرض",
    city: "المدينة المنورة",
    district: "عروة",
    budget: 420000,
    priceOrBudget: 420000,
    area: 580,
    advertiserRole: "CLIENT",
    advertiserPhoneNormalized: "+966500000002"
  };
  const ownOffice = { officeId: "office-a", cooperationMode: "APPROVAL_REQUIRED" };
  const activePeer = {
    officeId: "office-b",
    officeName: "مكتب باء",
    city: "المدينة المنورة",
    cooperationMode: "APPROVAL_REQUIRED",
    accountStatus: "active"
  };
  const pausedPeer = { ...activePeer, accountStatus: "paused" };
  const active = rankBrokerCommunityMatches({
    sourceOpportunity: source,
    ownOfficeId: "office-a",
    ownOffice,
    publicOffices: [activePeer],
    candidateOpportunities: [candidate],
    requireReadiness: true
  });
  const paused = rankBrokerCommunityMatches({
    sourceOpportunity: source,
    ownOfficeId: "office-a",
    ownOffice,
    publicOffices: [pausedPeer],
    candidateOpportunities: [candidate],
    requireReadiness: true
  });
  assert.ok(active.length >= 1);
  assert.equal(paused.length, 0);
});

test("more menu uses secondary delete labels", () => {
  const active = buildOpportunityMoreMenuHtml({ archived: false });
  const archived = buildOpportunityMoreMenuHtml({ archived: true });
  assert.ok(active.includes("حذف الفرصة"));
  assert.equal(active.includes("حذف نهائي"), false);
  assert.ok(archived.includes("حذف نهائي"));
  assert.ok(active.includes("bankMoreToggle"));
});

test("old cooperation rows keep the peer name and may mark paused", () => {
  const html = buildWorkspaceCoopRowsHtml([{
    id: "coop_1",
    status: "ACCEPTED",
    originatingOfficeId: "office-a",
    targetOfficeId: "office-b",
    targetOfficeName: "مكتب النور",
    requestedAt: "2026-08-01T00:00:00.000Z"
  }], {
    ownOfficeId: "office-a",
    pausedPeerIds: new Set(["office-b"])
  });
  assert.ok(html.includes("مكتب النور"));
  assert.ok(html.includes("متوقف مؤقتًا"));
});

test("settings shell keeps logout, pause, and delete in account management", () => {
  const shell = readRepositoryFile("public", "index.html");
  const settings = readRepositoryFile("public", "js", "office-settings.js");
  const bank = readRepositoryFile("public", "js", "opportunity-bank.js");
  assert.ok(shell.includes("id=\"officeAccountSection\""));
  assert.ok(shell.includes("إدارة الحساب"));
  assert.ok(shell.includes("id=\"officeLogoutBtn\""));
  assert.ok(shell.includes("إيقاف المكتب مؤقتًا"));
  assert.ok(shell.includes("حذف المكتب والبيانات"));
  assert.ok(shell.includes("id=\"officePausedBanner\""));
  assert.ok(settings.includes("firebase.auth().signOut()"));
  assert.ok(settings.includes("onLogout"));
  assert.ok(settings.includes("officeDeleteIsFullySupported"));
  assert.equal(bank.includes("window.confirm"), false);
  assert.equal(bank.includes("window.alert"), false);
  const accountIdx = shell.indexOf("id=\"officeAccountSection\"");
  const logoutIdx = shell.indexOf("id=\"officeLogoutBtn\"");
  const pauseIdx = shell.indexOf("id=\"officePauseBtn\"");
  const resumeSettingsIdx = shell.indexOf("id=\"officeResumeSettingsBtn\"");
  const deleteIdx = shell.indexOf("id=\"officeDeleteBtn\"");
  assert.ok(accountIdx > 0 && logoutIdx > accountIdx && pauseIdx > logoutIdx && deleteIdx > pauseIdx);
  assert.ok(resumeSettingsIdx > pauseIdx && resumeSettingsIdx < deleteIdx);
});

test("public intake path blocks paused offices without removing the link", () => {
  const gate = readRepositoryFile("public", "js", "access-gate.js");
  const worker = readRepositoryFile("worker", "src", "index.js");
  assert.ok(gate.includes("المكتب متوقف مؤقتًا عن استقبال الطلبات."));
  assert.ok(worker.includes("office_paused"));
  assert.ok(worker.includes("المكتب متوقف مؤقتًا عن استقبال الطلبات."));
});

test("paused remains a valid existing accountStatus value", () => {
  assert.ok(ACCOUNT_STATUSES.includes("paused"));
  const paused = { officeId: "p", approvalStatus: "approved", accountStatus: "paused", subscriptionStatus: "active", licenseStatus: "valid" };
  assert.equal(officeMatchesTab(paused, "approved"), true);
  assert.equal(officeMatchesTab(paused, "suspended"), false);
});
