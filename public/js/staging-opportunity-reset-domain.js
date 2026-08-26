/**
 * Staging office opportunity-cycle reset contract.
 * Deletes only opportunity workflow data. Never classifies the office profile.
 */

export const RESET_TARGET_OFFICE_ID = "staging-logo-live-20260807";

export const PRESERVED_COLLECTIONS = Object.freeze([
  "members",
  "officeSettings",
  "brokerSettings",
  "devices",
  "library",
  "activityEvents",
  "contacts"
]);

export const DELETE_COLLECTIONS = Object.freeze([
  "opportunities",
  "matches",
  "operations",
  "partySessions",
  "partyLinks",
  "partySessionKeys",
  "clients",
  "owners",
  "alerts",
  "notifications",
  "opportunitySources",
  "importJobs",
  "messages",
  "matchDiagnostics",
  "deals",
  "appointments",
  "cooperations"
]);

const COMPLETED_DEAL_RE = /DEAL_COMPLETED|COMPLETED_DEAL|DEALCOMPLETED/;

export function isProtectedCollection(name = "") {
  return PRESERVED_COLLECTIONS.includes(String(name || "").trim());
}

export function isDeleteCollection(name = "") {
  return DELETE_COLLECTIONS.includes(String(name || "").trim());
}

export function officeIdentityMatches(office = {}, expectedOfficeId = RESET_TARGET_OFFICE_ID) {
  const id = String(office.officeId || office.id || "").trim();
  return id === expectedOfficeId && Boolean(office.exists !== false);
}

export function isCompletedDealRecord(record = {}) {
  const blob = [
    record.lifecycleStatus,
    record.status,
    record.operationType,
    record.type,
    record.stage,
    record.workflowStage,
    record.livingStage,
    record.dealStatus,
    record.result
  ].map((value) => String(value || "").toUpperCase()).join(" ");
  if (COMPLETED_DEAL_RE.test(blob)) return true;
  const type = String(record.operationType || record.type || "").toUpperCase();
  const status = String(record.status || "").toUpperCase();
  const recordType = String(record.recordType || "").toLowerCase();
  if (type === "DEAL_COMPLETED") return true;
  if (status === "COMPLETED" && recordType.includes("deal")) return true;
  if (status === "COMPLETED" && type.includes("DEAL") && !type.includes("REVIEW")) return true;
  return false;
}

export function isClearlyExperimentalDeal(record = {}) {
  if (record.isTestFixture === true || record.qaLiveE2e === true) return true;
  const createdBy = String(record.createdBy || "").toUpperCase();
  if (["E2E", "QA", "LIVE_E2E"].includes(createdBy)) return true;
  const blob = [
    record.id,
    record.testRunId,
    record.qaLiveRunId,
    record.matchId,
    record.opportunityId,
    record.contactName
  ].map((value) => String(value || "")).join(" ");
  return /livee2e_|(?:^|_)qa[_-]|e2e/i.test(blob);
}

export function completedDealSafety(records = []) {
  const completed = (records || []).filter(isCompletedDealRecord);
  const blocked = completed.filter((row) => !isClearlyExperimentalDeal(row));
  return {
    completedCount: completed.length,
    blocked,
    ok: blocked.length === 0
  };
}

export function opportunityKind(record = {}) {
  const kind = String(record.opportunityKind || record.kind || record.recordType || "").toUpperCase();
  if (kind === "REQUEST" || kind === "CLIENT_REQUEST" || kind === "BUYER") return "REQUEST";
  if (kind === "OFFER" || kind === "OWNER_OFFER" || kind === "OWNER") return "OFFER";
  return kind || "UNKNOWN";
}

export function countOpportunitySides(records = []) {
  let offers = 0;
  let requests = 0;
  let other = 0;
  for (const record of records) {
    const kind = opportunityKind(record);
    if (kind === "OFFER") offers += 1;
    else if (kind === "REQUEST") requests += 1;
    else other += 1;
  }
  return { offers, requests, other };
}
