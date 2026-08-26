/**
 * Fail-closed delete plan for an opportunity and exclusive dependents.
 * A dependent that also links a surviving opportunity is skipped, not deleted.
 */

function text(value) {
  return String(value == null ? "" : value).trim();
}

function unique(values = []) {
  return [...new Set(values.map(text).filter(Boolean))];
}

export function opportunityIdsFromMatch(match = {}) {
  return unique([
    match.opportunityId,
    match.counterpartOpportunityId,
    match.requestId,
    match.offerId,
    match.clientRequestId,
    match.ownerOfferId,
    match.sourceCollection === "opportunities" ? match.sourceRecordId : "",
    match.counterpartCollection === "opportunities" ? match.counterpartRecordId : ""
  ]);
}

export function isExclusiveToDeletedSet(linkedIds = [], deletingIds = []) {
  const deleting = new Set((deletingIds || []).map(text).filter(Boolean));
  const linked = unique(linkedIds);
  if (!linked.length) return false;
  return linked.every((id) => deleting.has(id));
}

export function planMatchDelete(match = {}, deletingOpportunityIds = []) {
  const id = text(match.id || match.matchId);
  const linked = opportunityIdsFromMatch(match);
  if (!id) return { action: "skip", id: "", reason: "missing_match_id" };
  if (!linked.length) {
    return { action: "skip", id, reason: "match_has_no_opportunity_ids", linked };
  }
  if (isExclusiveToDeletedSet(linked, deletingOpportunityIds)) {
    return { action: "delete", id, reason: "exclusive_to_deleted_opportunities", linked };
  }
  const overlap = linked.filter((item) => deletingOpportunityIds.includes(item));
  if (!overlap.length) {
    return { action: "skip", id, reason: "unrelated_match", linked };
  }
  return { action: "skip", id, reason: "shared_with_surviving_opportunity", linked };
}

export function planDependentDelete(record = {}, deletingIds = [], extraIds = []) {
  const id = text(record.id || record.recordId || record.sessionId || record.operationId);
  const linked = unique([
    record.opportunityId,
    record.requestId,
    record.offerId,
    record.matchId,
    record.sourceEntityId,
    ...(extraIds || [])
  ]);
  if (!id) return { action: "skip", id: "", reason: "missing_id" };
  const deleting = unique(deletingIds);
  if (deleting.includes(id) || isExclusiveToDeletedSet(linked, deleting)) {
    return { action: "delete", id, reason: "exclusive_to_deleted_set", linked };
  }
  if (!linked.length) {
    return { action: "skip", id, reason: "no_proven_link", linked };
  }
  return { action: "skip", id, reason: "shared_or_unproven", linked };
}

export function buildOpportunityDeletePlan({
  opportunityIds = [],
  matches = [],
  operations = [],
  partySessions = [],
  cooperations = [],
  appointments = [],
  notifications = [],
  timelineEvents = []
} = {}) {
  const deleting = unique(opportunityIds);
  const matchPlans = matches.map((row) => ({ type: "match", ...planMatchDelete(row, deleting) }));
  const deletingMatchIds = matchPlans.filter((row) => row.action === "delete").map((row) => row.id);
  const deletingAll = unique([...deleting, ...deletingMatchIds]);

  const withMatches = (record) => planDependentDelete(record, deletingAll);

  const planList = (type, rows, mapper) => (rows || []).map((row) => ({ type, ...mapper(row) }));

  const operationsPlan = planList("operation", operations, withMatches);
  const sessionsPlan = planList("partySession", partySessions, withMatches);
  const coopPlan = planList("cooperation", cooperations, (row) => planDependentDelete(row, deleting, row.opportunityIds || []));
  const apptPlan = planList("appointment", appointments, withMatches);
  const notifPlan = planList("notification", notifications, withMatches);
  const timelinePlan = planList("timeline", timelineEvents, withMatches);

  const all = [
    ...deleting.map((id) => ({ type: "opportunity", action: "delete", id, reason: "requested" })),
    ...matchPlans,
    ...operationsPlan,
    ...sessionsPlan,
    ...coopPlan,
    ...apptPlan,
    ...notifPlan,
    ...timelinePlan
  ];
  return {
    deletingOpportunityIds: deleting,
    delete: all.filter((row) => row.action === "delete"),
    skip: all.filter((row) => row.action === "skip"),
    counts: countByType(all.filter((row) => row.action === "delete"))
  };
}

function countByType(rows = []) {
  const counts = {};
  for (const row of rows) {
    counts[row.type] = Number(counts[row.type] || 0) + 1;
  }
  return counts;
}

export function archiveActionLabel(record = {}) {
  const lifecycle = text(record.lifecycleStatus).toUpperCase();
  if (lifecycle === "CLOSED_WON" || lifecycle === "DEAL_COMPLETED" || record.dealCompleted === true) {
    return "أرشفة الصفقة";
  }
  return "نقل إلى الأرشيف";
}

export function archiveConfirmCopy(record = {}) {
  const kind = text(record.opportunityKind || record.kind).toUpperCase();
  const noun = kind === "OFFER" || kind === "OWNER_OFFER" || kind === "OWNER" ? "العرض" : "الطلب";
  if (archiveActionLabel(record) === "أرشفة الصفقة") {
    return `سيتم نقل الصفقة إلى الأرشيف ويمكن استعادتها لاحقًا.`;
  }
  return `سيتم نقل ${noun} إلى الأرشيف ويمكن استعادته لاحقًا.`;
}

export function permanentDeleteCopy() {
  return "سيتم حذف هذه الفرصة والبيانات التشغيلية المرتبطة بها نهائيًا، ولن يمكن استعادتها.";
}
