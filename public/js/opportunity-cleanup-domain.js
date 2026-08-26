/**
 * Staging opportunity cleanup classification.
 * Fail closed: only tagged QA/test evidence or an explicit allowlist may delete.
 * Never classify by price, district, display name, date, or incomplete data.
 */

export const CLEANUP_DECISION = Object.freeze({
  AUTO_DELETE: "AUTO_DELETE",
  ALLOWLIST: "ALLOWLIST",
  CANDIDATE: "CANDIDATE",
  PRESERVE: "PRESERVE",
  REVIEW_REQUIRED: "REVIEW_REQUIRED"
});

export const STAGING_OFFICE_RE = /^(staging-|qa-e2e-|qa_e2e)/i;
export const TAGGED_ID_RE = /livee2e_|(?:^|_)qa[_-]/i;
export const SUSPECT_ID_RE = /(?:^|_)(?:e2e|dbg|api)_/i;

const TAGGED_CREATORS = new Set(["E2E", "QA", "LIVE_E2E"]);

function text(value) {
  return String(value == null ? "" : value).trim();
}

export function isStagingOfficeId(officeId = "") {
  return STAGING_OFFICE_RE.test(text(officeId));
}

export function recordId(record = {}) {
  return text(record.id || record.recordId || record.matchId || record.opportunityId || record.sessionId);
}

function blob(record = {}) {
  return [
    recordId(record),
    record.matchId,
    record.opportunityId,
    record.requestId,
    record.offerId,
    record.clientRequestId,
    record.ownerOfferId,
    record.sourceRecordId,
    record.counterpartRecordId,
    record.counterpartOpportunityId,
    record.testRunId,
    record.qaLiveRunId,
    record.sourceType,
    record.createdBy
  ].map(text).join(" ");
}

export function isTaggedTestRecord(record = {}) {
  if (record.isTestFixture === true || record.qaLiveE2e === true) return true;
  if (TAGGED_CREATORS.has(text(record.createdBy).toUpperCase())) return true;
  if (text(record.testRunId) || text(record.qaLiveRunId)) return true;
  return TAGGED_ID_RE.test(blob(record));
}

export function isSuspectQaId(record = {}) {
  return SUSPECT_ID_RE.test(blob(record));
}

export function classifyCleanupRecord(record = {}, { allowlistIds = [], integrityLegacyIds = [] } = {}) {
  const id = recordId(record);
  const officeId = text(record.officeId);
  const allow = new Set((allowlistIds || []).map(text).filter(Boolean));
  const legacy = new Set((integrityLegacyIds || []).map(text).filter(Boolean));

  if (!id) {
    return { decision: CLEANUP_DECISION.PRESERVE, reason: "missing_id", id, officeId };
  }
  if (isTaggedTestRecord(record)) {
    return { decision: CLEANUP_DECISION.AUTO_DELETE, reason: "tagged_test_fixture", id, officeId };
  }
  if (legacy.has(id)) {
    return {
      decision: CLEANUP_DECISION.ALLOWLIST,
      reason: "integrity_report_legacy",
      id,
      officeId
    };
  }
  if (allow.has(id)) {
    return { decision: CLEANUP_DECISION.ALLOWLIST, reason: "explicit_allowlist", id, officeId };
  }
  if (isSuspectQaId(record)) {
    return { decision: CLEANUP_DECISION.CANDIDATE, reason: "suspect_id_not_tagged", id, officeId };
  }
  return { decision: CLEANUP_DECISION.REVIEW_REQUIRED, reason: "unproven_not_test", id, officeId };
}

export function canAutoDeleteDecision(decision) {
  return decision === CLEANUP_DECISION.AUTO_DELETE || decision === CLEANUP_DECISION.ALLOWLIST;
}

export function protectedCollections() {
  return Object.freeze([
    "office",
    "members",
    "officeSettings",
    "brokerSettings",
    "devices",
    "publicOffices",
    "officeNameClaims"
  ]);
}
