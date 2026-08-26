/**
 * Opportunity Router — Worker persistence.
 * Canonical PLATFORM_PUBLIC opportunity stays at offices/platform/opportunities/{id}.
 * Assigned office receives the same opportunityId after ACCEPT.
 */

import { createHash } from "node:crypto";
import {
  OPERATION_STATUS,
  OPERATION_TYPES,
  buildInAppNotification,
  buildPlatformOpportunityOfferOperation,
  operationDocumentId,
  buildPlatformOfferDedupKey
} from "./operations-domain.js";
import { upsertNotificationDocument, upsertOperationDocument, operationToFirestoreFields } from "./operations-service.js";
import {
  ASSIGNMENT_REASON,
  ATTEMPT_DECISION,
  DECLINE_REASON_VALUES,
  ORIGIN_SOURCE_TYPE,
  PLATFORM_OPPORTUNITY_ACCEPT_WINDOW_MINUTES,
  ROUTER_REASON_LABELS,
  ROUTING_STATUS,
  applyRatingAggregate,
  canAcceptAttempt,
  isValidStarRating,
  livingTaskIdForOpportunity,
  nextPendingCandidate,
  originSourceFromIntake,
  platformOpportunityHeadline,
  platformOpportunityMoneyLine,
  rankRouterCandidates,
  ratingUniquenessKey,
  routerCompleteness,
  routingLogEvent,
  mergeRouterStats,
  scoreOfficeForOpportunity,
  statsFromOffice
} from "../../public/js/opportunity-router-domain.js";
import { districtIdFromOfficialName, districtLabelById } from "../../public/js/service-neighborhood-domain.js";

export const PLATFORM_OFFICE_ID = "platform";

function nowIso(now = new Date()) {
  return now.toISOString();
}

function logRouter(event, payload = {}) {
  const name = routingLogEvent(event) || event;
  console.log(JSON.stringify({ event: name, ...payload, at: nowIso() }));
}

function text(value) {
  return String(value == null ? "" : value).trim();
}

function enrichOpportunityGeography(opportunity = {}) {
  const city = text(opportunity.city);
  const district = text(opportunity.district);
  const districtId = text(opportunity.districtId) || districtIdFromOfficialName(district, city) || "";
  return { ...opportunity, city, district, districtId };
}

function enrichOfficeGeography(office = {}) {
  const ids = Array.isArray(office.serviceNeighborhoodIds) ? office.serviceNeighborhoodIds : [];
  const labels = ids.map((id) => districtLabelById(id)).filter(Boolean);
  return {
    ...office,
    serviceNeighborhoodLabels: Array.isArray(office.serviceNeighborhoodLabels) && office.serviceNeighborhoodLabels.length
      ? office.serviceNeighborhoodLabels
      : labels
  };
}

function recordToFields(fh, record = {}) {
  const fields = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (typeof fh.jsToFirestoreValue === "function") {
      fields[key] = fh.jsToFirestoreValue(value);
    } else if (value instanceof Date) {
      fields[key] = fh.firestoreTimestamp(value);
    } else if (typeof value === "boolean") {
      fields[key] = fh.firestoreBoolean(value);
    } else if (typeof value === "number" && Number.isInteger(value)) {
      fields[key] = fh.firestoreInteger(value);
    } else if (typeof value === "number") {
      fields[key] = { doubleValue: value };
    } else if (Array.isArray(value) || (value && typeof value === "object")) {
      fields[key] = fh.firestoreString(JSON.stringify(value));
    } else {
      fields[key] = fh.firestoreString(String(value));
    }
  }
  return fields;
}

function buildAttemptId(opportunityId, officeId, rank) {
  return createHash("sha256")
    .update(`attempt|${opportunityId}|${officeId}|${rank}`)
    .digest("hex")
    .slice(0, 28);
}

function docIdFromName(doc) {
  return decodeURIComponent(String(doc?.name || "").split("/").pop() || "");
}

async function readOffice(deps, officeId) {
  const raw = await deps.getFirestoreDocument({
    projectId: deps.projectId,
    segments: ["offices", officeId],
    accessToken: deps.accessToken,
    allowMissing: true
  });
  if (!raw) return null;
  const data = deps.firestoreFieldsToJs(raw.fields || {});
  return {
    ...data,
    id: data.id || officeId,
    officeId: data.officeId || officeId,
    updateTime: raw.updateTime || ""
  };
}

async function writeOfficePatch(deps, officeId, patch) {
  await deps.setFirestoreDocument({
    projectId: deps.projectId,
    segments: ["offices", officeId],
    accessToken: deps.accessToken,
    fields: recordToFields(deps.firestoreHelpers, {
      ...patch,
      officeId,
      updatedAt: nowIso()
    })
  });
}

function routingFields(opportunity = {}) {
  return {
    officeId: opportunity.officeId,
    id: opportunity.id || opportunity.opportunityId,
    originSourceType: opportunity.originSourceType || "",
    originSourceOfficeId: opportunity.originSourceOfficeId || "",
    assignedOfficeId: opportunity.assignedOfficeId || "",
    assignmentReason: opportunity.assignmentReason || "",
    routingStatus: opportunity.routingStatus || "",
    currentOfferedOfficeId: opportunity.currentOfferedOfficeId || "",
    currentAttemptId: opportunity.currentAttemptId || "",
    currentOfferedExpiresAt: opportunity.currentOfferedExpiresAt || "",
    livingTaskId: opportunity.livingTaskId || "",
    opportunityKind: opportunity.opportunityKind || "",
    purpose: opportunity.purpose || "",
    propertyType: opportunity.propertyType || "",
    city: opportunity.city || "",
    district: opportunity.district || "",
    districtId: opportunity.districtId || "",
    budget: Number(opportunity.budget || 0),
    salePrice: Number(opportunity.salePrice || 0)
  };
}

async function readOpportunity(deps, officeId, opportunityId) {
  const raw = await deps.getFirestoreDocument({
    projectId: deps.projectId,
    segments: ["offices", officeId, "opportunities", opportunityId],
    accessToken: deps.accessToken,
    allowMissing: true
  });
  if (!raw) return null;
  const data = deps.firestoreFieldsToJs(raw.fields || {});
  return {
    ...data,
    id: data.id || opportunityId,
    opportunityId: data.opportunityId || opportunityId,
    officeId: data.officeId || officeId,
    updateTime: raw.updateTime || ""
  };
}

async function writeOpportunity(deps, officeId, opportunityId, data, { updateTime, full = false } = {}) {
  const payload = full
    ? { ...data, officeId, id: opportunityId, opportunityId }
    : { ...routingFields({ ...data, officeId, id: opportunityId }), officeId, id: opportunityId };
  delete payload.updateTime;
  const fields = recordToFields(deps.firestoreHelpers, payload);
  const writer = typeof deps.patchFirestoreDocument === "function" && updateTime
    ? deps.patchFirestoreDocument
    : deps.setFirestoreDocument;
  return writer({
    projectId: deps.projectId,
    segments: ["offices", officeId, "opportunities", opportunityId],
    accessToken: deps.accessToken,
    fields,
    updateTime
  });
}

async function copyOpportunityToOffice(deps, fromOfficeId, toOfficeId, opportunityId, extra = {}) {
  const raw = await deps.getFirestoreDocument({
    projectId: deps.projectId,
    segments: ["offices", fromOfficeId, "opportunities", opportunityId],
    accessToken: deps.accessToken,
    allowMissing: true
  });
  if (!raw) throw new Error("opportunity_not_found");
  const fields = { ...(raw.fields || {}) };
  const extraFields = recordToFields(deps.firestoreHelpers, {
    ...extra,
    officeId: toOfficeId,
    id: opportunityId,
    opportunityId
  });
  await deps.setFirestoreDocument({
    projectId: deps.projectId,
    segments: ["offices", toOfficeId, "opportunities", opportunityId],
    accessToken: deps.accessToken,
    fields: { ...fields, ...extraFields }
  });
}

async function listRoutingAttempts(deps, opportunityId) {
  const docs = await deps.listCollectionDocuments({
    projectId: deps.projectId,
    segments: ["offices", PLATFORM_OFFICE_ID, "opportunities", opportunityId, "routingAttempts"],
    accessToken: deps.accessToken,
    pageSize: 100
  });
  return (docs || []).map((doc) => {
    const data = deps.firestoreFieldsToJs(doc.fields || {});
    const id = data.id || docIdFromName(doc);
    return { ...data, id };
  });
}

async function writeAttempt(deps, opportunityId, attempt) {
  await deps.setFirestoreDocument({
    projectId: deps.projectId,
    segments: ["offices", PLATFORM_OFFICE_ID, "opportunities", opportunityId, "routingAttempts", attempt.id],
    accessToken: deps.accessToken,
    fields: recordToFields(deps.firestoreHelpers, {
      ...attempt,
      officeId: attempt.officeId,
      opportunityId
    })
  });
}

async function listOfficeProfiles(deps) {
  const docs = await deps.listCollectionDocuments({
    projectId: deps.projectId,
    segments: ["offices"],
    accessToken: deps.accessToken,
    pageSize: 200
  });
  return (docs || [])
    .map((doc) => {
      const data = deps.firestoreFieldsToJs(doc.fields || {});
      const id = data.officeId || data.id || docIdFromName(doc);
      return { ...data, id, officeId: id };
    })
    .filter((office) => office.officeId && office.officeId !== PLATFORM_OFFICE_ID);
}

async function closeOfficeOfferOperation(deps, { officeId, opportunityId, status }) {
  const deduplicationKey = buildPlatformOfferDedupKey({ officeId, opportunityId });
  const id = await operationDocumentId(deduplicationKey);
  const raw = await deps.getFirestoreDocument({
    projectId: deps.projectId,
    segments: ["offices", officeId, "operations", id],
    accessToken: deps.accessToken,
    allowMissing: true
  });
  if (!raw) return;
  const existing = deps.firestoreFieldsToJs(raw.fields || {});
  const now = nowIso();
  const next = {
    ...existing,
    id,
    officeId,
    status,
    updatedAt: now,
    completedAt: status === OPERATION_STATUS.COMPLETED ? now : existing.completedAt || "",
    dismissedAt: status === OPERATION_STATUS.DISMISSED ? now : existing.dismissedAt || ""
  };
  await deps.setFirestoreDocument({
    projectId: deps.projectId,
    segments: ["offices", officeId, "operations", id],
    accessToken: deps.accessToken,
    fields: operationToFirestoreFields(next, deps.firestoreHelpers)
  });
}

async function updateOfficeRouterStats(deps, officeId, event) {
  const office = await readOffice(deps, officeId);
  if (!office) return;
  const platformRouterStats = mergeRouterStats(office.platformRouterStats || {}, event);
  await writeOfficePatch(deps, officeId, { platformRouterStats });
}

function rankOffices({ opportunity, offices, attempts }) {
  const geoOpportunity = enrichOpportunityGeography(opportunity);
  const geoOffices = offices.map(enrichOfficeGeography);
  const eligibleLoad = geoOffices.map((office) => Number(statsFromOffice(office).recentPlatformAssignments || 0));
  const scored = geoOffices.map((office) => {
    const stats = statsFromOffice(office);
    const row = scoreOfficeForOpportunity({
      office,
      opportunity: geoOpportunity,
      stats,
      eligibleLoad
    });
    return {
      ...row,
      office,
      recentPlatformAt: stats.lastPlatformAssignedAt || ""
    };
  });
  const ranked = rankRouterCandidates(scored);
  const attempted = attempts
    .filter((attempt) => {
      const decision = String(attempt.decision || "").toUpperCase();
      return decision && decision !== ATTEMPT_DECISION.PENDING;
    })
    .map((attempt) => attempt.officeId);
  const pendingOffered = attempts
    .filter((attempt) => String(attempt.decision || "").toUpperCase() === ATTEMPT_DECISION.PENDING)
    .map((attempt) => attempt.officeId);
  return {
    ranked,
    next: nextPendingCandidate(ranked, [...attempted, ...pendingOffered])
  };
}

async function createOfferForOffice(deps, {
  opportunity,
  scored,
  windowMinutes = PLATFORM_OPPORTUNITY_ACCEPT_WINDOW_MINUTES
}) {
  const opportunityId = String(opportunity.id || opportunity.opportunityId);
  const officeId = scored.officeId;
  const rank = scored.rank || 1;
  const attemptId = buildAttemptId(opportunityId, officeId, rank);
  const offeredAt = nowIso();
  const expiresAt = new Date(
    Date.now() + Math.max(1, Number(windowMinutes) || PLATFORM_OPPORTUNITY_ACCEPT_WINDOW_MINUTES) * 60 * 1000
  ).toISOString();
  const livingTaskId = opportunity.livingTaskId || livingTaskIdForOpportunity(opportunityId);
  const reasonCodes = scored.reasonCodes || [];
  const reasonLabels = (scored.reasonLabels || reasonCodes.map((code) => ROUTER_REASON_LABELS[code])).filter(Boolean);
  const attempt = {
    id: attemptId,
    opportunityId,
    officeId,
    rank,
    score: scored.totalScore,
    scoreBreakdownJson: JSON.stringify(scored.breakdown || {}),
    reasonCodesJson: JSON.stringify(reasonCodes),
    offeredAt,
    expiresAt,
    decision: ATTEMPT_DECISION.PENDING,
    decisionAt: "",
    declineReason: ""
  };
  await writeAttempt(deps, opportunityId, attempt);
  const nextOpportunity = {
    ...opportunity,
    originSourceType: ORIGIN_SOURCE_TYPE.PLATFORM_PUBLIC,
    routingStatus: ROUTING_STATUS.OFFERED_TO_OFFICE,
    currentOfferedOfficeId: officeId,
    currentAttemptId: attemptId,
    currentOfferedExpiresAt: expiresAt,
    livingTaskId,
    assignedOfficeId: opportunity.assignedOfficeId || ""
  };
  await writeOpportunity(deps, PLATFORM_OFFICE_ID, opportunityId, nextOpportunity);

  const moneyLine = platformOpportunityMoneyLine(opportunity);
  const operation = await buildPlatformOpportunityOfferOperation({
    officeId,
    opportunityId,
    livingTaskId,
    attemptId,
    rank,
    propertyType: opportunity.propertyType || "",
    purpose: opportunity.purpose || "",
    city: opportunity.city || "",
    district: opportunity.district || "",
    moneyLine,
    reasonCodes,
    reasonLabels,
    expiresAt
  });
  await upsertOperationDocument({
    projectId: deps.projectId,
    officeId,
    operation,
    accessToken: deps.accessToken,
    setFirestoreDocument: deps.setFirestoreDocument,
    getFirestoreDocument: deps.getFirestoreDocument,
    firestoreHelpers: deps.firestoreHelpers
  });

  const notification = await buildInAppNotification({
    officeId,
    operation: {
      ...operation,
      titleText: "فرصة جديدة من المنصة",
      summaryText: platformOpportunityHeadline(opportunity)
    }
  });
  notification.title = "فرصة جديدة من المنصة";
  notification.body = operation.summaryText || platformOpportunityHeadline(opportunity);
  await upsertNotificationDocument({
    projectId: deps.projectId,
    officeId,
    notification,
    accessToken: deps.accessToken,
    setFirestoreDocument: deps.setFirestoreDocument,
    getFirestoreDocument: deps.getFirestoreDocument,
    firestoreHelpers: deps.firestoreHelpers
  });

  if (typeof deps.sendOfficePush === "function") {
    await deps.sendOfficePush({
      officeId,
      title: "فرصة جديدة من المنصة",
      body: operation.summaryText || "رُشحت فرصة عامة لمكتبك.",
      type: "operation",
      presentationType: OPERATION_TYPES.PLATFORM_OPPORTUNITY_OFFER,
      recordId: operation.id,
      opportunityId,
      taskId: livingTaskId
    }).catch(() => null);
  }

  logRouter("offered", {
    opportunityId,
    officeId,
    rank,
    score: scored.totalScore,
    reasonCodes
  });
  return { attempt, opportunity: nextOpportunity, livingTaskId, operationId: operation.id };
}

export function stampDirectOfficeAssignment(opportunity, officeId) {
  const id = opportunity.id || opportunity.opportunityId;
  return {
    ...opportunity,
    originSourceType: ORIGIN_SOURCE_TYPE.OFFICE_DIRECT,
    originSourceOfficeId: officeId,
    assignedOfficeId: officeId,
    assignmentReason: ASSIGNMENT_REASON.DIRECT_OFFICE_LINK,
    routingStatus: ROUTING_STATUS.ASSIGNED,
    livingTaskId: livingTaskIdForOpportunity(id)
  };
}

export async function afterPublicIntakePersisted(deps, { officeId, opportunity, source } = {}) {
  const origin = originSourceFromIntake({
    officeId,
    source,
    originSourceType: opportunity?.originSourceType
  });
  const opportunityId = opportunity.id || opportunity.opportunityId;

  if (origin.type === ORIGIN_SOURCE_TYPE.OFFICE_DIRECT) {
    const stamped = stampDirectOfficeAssignment(opportunity, officeId);
    await writeOpportunity(deps, officeId, opportunityId, stamped);
    logRouter("directAssigned", { opportunityId, officeId });
    return {
      originSourceType: origin.type,
      routingStatus: ROUTING_STATUS.ASSIGNED,
      assignedOfficeId: officeId,
      skippedRouter: true
    };
  }

  const completeness = routerCompleteness(opportunity);
  const stamped = {
    ...enrichOpportunityGeography(opportunity),
    originSourceType: ORIGIN_SOURCE_TYPE.PLATFORM_PUBLIC,
    originSourceOfficeId: "",
    assignedOfficeId: opportunity.assignedOfficeId || "",
    assignmentReason: "",
    routingStatus: completeness.ok ? ROUTING_STATUS.ROUTING : ROUTING_STATUS.NEEDS_COMPLETION,
    livingTaskId: livingTaskIdForOpportunity(opportunityId)
  };
  await writeOpportunity(deps, PLATFORM_OFFICE_ID, opportunityId, stamped);
  if (!completeness.ok) {
    logRouter("started", { opportunityId, skipped: "needs_completion", missing: completeness.missing });
    return {
      originSourceType: ORIGIN_SOURCE_TYPE.PLATFORM_PUBLIC,
      routingStatus: ROUTING_STATUS.NEEDS_COMPLETION,
      assignedOfficeId: null
    };
  }
  return routePlatformOpportunity(deps, { opportunityId });
}

export async function routePlatformOpportunity(deps, { opportunityId, windowMinutes } = {}) {
  const loaded = await readOpportunity(deps, PLATFORM_OFFICE_ID, opportunityId);
  if (!loaded) return { ok: false, error: "opportunity_not_found" };
  const opportunity = enrichOpportunityGeography(loaded);
  if (opportunity.originSourceType === ORIGIN_SOURCE_TYPE.OFFICE_DIRECT) {
    return { ok: true, skippedRouter: true, assignedOfficeId: opportunity.assignedOfficeId };
  }
  if (opportunity.assignedOfficeId && opportunity.routingStatus === ROUTING_STATUS.ASSIGNED) {
    return { ok: true, alreadyAssigned: true, assignedOfficeId: opportunity.assignedOfficeId };
  }
  if (!routerCompleteness(opportunity).ok) {
    await writeOpportunity(deps, PLATFORM_OFFICE_ID, opportunityId, {
      ...opportunity,
      routingStatus: ROUTING_STATUS.NEEDS_COMPLETION
    });
    return { ok: true, routingStatus: ROUTING_STATUS.NEEDS_COMPLETION };
  }

  const attempts = await listRoutingAttempts(deps, opportunityId);
  const active = attempts.find((attempt) => {
    const pending = String(attempt.decision || "").toUpperCase() === ATTEMPT_DECISION.PENDING;
    const expires = Date.parse(attempt.expiresAt || "") || 0;
    return pending && expires > Date.now();
  });
  if (active && opportunity.routingStatus === ROUTING_STATUS.OFFERED_TO_OFFICE) {
    logRouter("started", {
      opportunityId,
      idempotent: true,
      currentOfferedOfficeId: active.officeId
    });
    return {
      ok: true,
      idempotent: true,
      routingStatus: ROUTING_STATUS.OFFERED_TO_OFFICE,
      currentOfferedOfficeId: active.officeId,
      livingTaskId: opportunity.livingTaskId || livingTaskIdForOpportunity(opportunityId)
    };
  }

  logRouter("started", { opportunityId });
  const offices = await listOfficeProfiles(deps);
  const { ranked, next } = rankOffices({ opportunity, offices, attempts });
  logRouter("candidates", {
    opportunityId,
    candidateCount: ranked.length,
    nextOfficeId: next?.officeId || null
  });

  if (!next) {
    await writeOpportunity(deps, PLATFORM_OFFICE_ID, opportunityId, {
      ...opportunity,
      routingStatus: ROUTING_STATUS.NO_ELIGIBLE_OFFICE,
      currentOfferedOfficeId: "",
      currentAttemptId: ""
    });
    logRouter("noEligibleOffice", { opportunityId });
    return {
      ok: true,
      routingStatus: ROUTING_STATUS.NO_ELIGIBLE_OFFICE,
      assignedOfficeId: null
    };
  }

  const result = await createOfferForOffice(deps, {
    opportunity: { ...opportunity, routingStatus: ROUTING_STATUS.ROUTING },
    scored: next,
    windowMinutes
  });
  return {
    ok: true,
    routingStatus: ROUTING_STATUS.OFFERED_TO_OFFICE,
    currentOfferedOfficeId: next.officeId,
    livingTaskId: result.livingTaskId,
    score: next.totalScore,
    reasonCodes: next.reasonCodes
  };
}

export async function expireDuePlatformOffers(deps, { opportunityId, officeId } = {}) {
  const ids = [];
  if (opportunityId) {
    ids.push(opportunityId);
  } else {
    const docs = await deps.listCollectionDocuments({
      projectId: deps.projectId,
      segments: ["offices", PLATFORM_OFFICE_ID, "opportunities"],
      accessToken: deps.accessToken,
      pageSize: 200
    });
    for (const doc of docs || []) {
      const data = deps.firestoreFieldsToJs(doc.fields || {});
      const id = data.id || docIdFromName(doc);
      if (data.routingStatus !== ROUTING_STATUS.OFFERED_TO_OFFICE) continue;
      if (officeId && data.currentOfferedOfficeId !== officeId) continue;
      ids.push(id);
    }
  }

  const expired = [];
  for (const id of ids) {
    const opportunity = await readOpportunity(deps, PLATFORM_OFFICE_ID, id);
    if (!opportunity || opportunity.routingStatus !== ROUTING_STATUS.OFFERED_TO_OFFICE) continue;
    const expiresAt = Date.parse(opportunity.currentOfferedExpiresAt || "") || 0;
    if (expiresAt > Date.now()) continue;
    const attempts = await listRoutingAttempts(deps, id);
    const current = attempts.find((attempt) => attempt.id === opportunity.currentAttemptId)
      || attempts.find((attempt) => String(attempt.decision || "").toUpperCase() === ATTEMPT_DECISION.PENDING);
    if (current) {
      await writeAttempt(deps, id, {
        ...current,
        decision: ATTEMPT_DECISION.EXPIRED,
        decisionAt: nowIso()
      });
      const offeredAt = Date.parse(current.offeredAt || "") || Date.now();
      await updateOfficeRouterStats(deps, current.officeId, {
        responseMs: Math.max(0, Date.now() - offeredAt),
        followed: false,
        at: nowIso()
      });
    }
    if (opportunity.currentOfferedOfficeId) {
      await closeOfficeOfferOperation(deps, {
        officeId: opportunity.currentOfferedOfficeId,
        opportunityId: id,
        status: OPERATION_STATUS.EXPIRED
      });
    }
    await writeOpportunity(deps, PLATFORM_OFFICE_ID, id, {
      ...opportunity,
      routingStatus: ROUTING_STATUS.EXPIRED
    });
    logRouter("expired", {
      opportunityId: id,
      officeId: opportunity.currentOfferedOfficeId || null
    });
    expired.push(id);
    await routePlatformOpportunity(deps, { opportunityId: id });
  }
  return { ok: true, expiredCount: expired.length, expired };
}

export async function declinePlatformOffer(deps, { officeId, opportunityId, reason } = {}) {
  const opportunity = await readOpportunity(deps, PLATFORM_OFFICE_ID, opportunityId);
  if (!opportunity) return { ok: false, error: "opportunity_not_found" };
  if (opportunity.currentOfferedOfficeId !== officeId) {
    return { ok: false, error: "not_offered_to_office" };
  }
  if (opportunity.assignedOfficeId) {
    return { ok: false, error: "already_assigned" };
  }
  const attempts = await listRoutingAttempts(deps, opportunityId);
  const current = attempts.find((attempt) => attempt.id === opportunity.currentAttemptId);
  if (current) {
    await writeAttempt(deps, opportunityId, {
      ...current,
      decision: ATTEMPT_DECISION.DECLINED,
      decisionAt: nowIso(),
      declineReason: DECLINE_REASON_VALUES.includes(reason) ? reason : "OTHER"
    });
    const offeredAt = Date.parse(current.offeredAt || "") || Date.now();
    await updateOfficeRouterStats(deps, officeId, {
      responseMs: Math.max(0, Date.now() - offeredAt),
      at: nowIso()
    });
  }
  await closeOfficeOfferOperation(deps, {
    officeId,
    opportunityId,
    status: OPERATION_STATUS.DISMISSED
  });
  await writeOpportunity(deps, PLATFORM_OFFICE_ID, opportunityId, {
    ...opportunity,
    routingStatus: ROUTING_STATUS.DECLINED,
    currentOfferedOfficeId: ""
  });
  logRouter("declined", { opportunityId, officeId, reason: reason || "OTHER" });
  const next = await routePlatformOpportunity(deps, { opportunityId });
  return { ok: true, declined: true, next };
}

export async function acceptPlatformOffer(deps, { officeId, opportunityId } = {}) {
  const opportunity = await readOpportunity(deps, PLATFORM_OFFICE_ID, opportunityId);
  if (!opportunity) return { ok: false, error: "opportunity_not_found" };
  const attempts = await listRoutingAttempts(deps, opportunityId);
  const current = attempts.find((attempt) => attempt.id === opportunity.currentAttemptId);
  const gate = canAcceptAttempt({
    attempt: current,
    opportunity,
    officeId,
    now: new Date()
  });
  if (!gate.ok) return gate;

  const claimed = {
    ...opportunity,
    assignedOfficeId: officeId,
    routingStatus: ROUTING_STATUS.ASSIGNED,
    assignmentReason: ASSIGNMENT_REASON.PLATFORM_ROUTER,
    currentOfferedOfficeId: officeId
  };
  try {
    await writeOpportunity(deps, PLATFORM_OFFICE_ID, opportunityId, claimed, {
      updateTime: opportunity.updateTime
    });
  } catch (error) {
    const message = String(error?.message || error || "");
    if (/FAILED_PRECONDITION|ABORTED|409|precondition/i.test(message)) {
      return { ok: false, error: "lost_race" };
    }
    throw error;
  }
  const verified = await readOpportunity(deps, PLATFORM_OFFICE_ID, opportunityId);
  if (!verified || verified.assignedOfficeId !== officeId) {
    return { ok: false, error: "lost_race" };
  }

  if (current) {
    await writeAttempt(deps, opportunityId, {
      ...current,
      decision: ATTEMPT_DECISION.ACCEPTED,
      decisionAt: nowIso()
    });
    const offeredAt = Date.parse(current.offeredAt || "") || Date.now();
    await updateOfficeRouterStats(deps, officeId, {
      responseMs: Math.max(0, Date.now() - offeredAt),
      followed: true,
      assigned: true,
      at: nowIso()
    });
  }

  const livingTaskId = opportunity.livingTaskId || livingTaskIdForOpportunity(opportunityId);
  await copyOpportunityToOffice(deps, PLATFORM_OFFICE_ID, officeId, opportunityId, {
    originSourceType: ORIGIN_SOURCE_TYPE.PLATFORM_PUBLIC,
    assignedOfficeId: officeId,
    assignmentReason: ASSIGNMENT_REASON.PLATFORM_ROUTER,
    routingStatus: ROUTING_STATUS.ASSIGNED,
    livingTaskId
  });
  await closeOfficeOfferOperation(deps, {
    officeId,
    opportunityId,
    status: OPERATION_STATUS.COMPLETED
  });
  logRouter("accepted", { opportunityId, officeId });

  if (typeof deps.runCanonicalMatchingAfterOpportunityPersist === "function") {
    await deps.runCanonicalMatchingAfterOpportunityPersist({
      officeId,
      opportunityId,
      source: "platform_router_accept"
    }).catch((error) => {
      logRouter("matchingFailed", {
        opportunityId,
        officeId,
        error: error instanceof Error ? error.message : "matching_failed"
      });
    });
  }

  return {
    ok: true,
    assignedOfficeId: officeId,
    opportunityId,
    livingTaskId
  };
}

export async function submitOfficeRating(deps, {
  officeId,
  opportunityId,
  raterId,
  raterRole = "party",
  stars
} = {}) {
  if (!isValidStarRating(stars)) return { ok: false, error: "invalid_stars" };
  if (!text(raterId)) return { ok: false, error: "rater_required" };
  const office = await readOffice(deps, officeId);
  if (!office) return { ok: false, error: "office_not_found" };
  const assigned = await readOpportunity(deps, officeId, opportunityId)
    || await readOpportunity(deps, PLATFORM_OFFICE_ID, opportunityId);
  if (!assigned || assigned.assignedOfficeId !== officeId || assigned.routingStatus !== ROUTING_STATUS.ASSIGNED) {
    return { ok: false, error: "not_eligible_interaction" };
  }
  const ratingId = ratingUniquenessKey({ opportunityId, raterId, raterRole });
  const existing = await deps.getFirestoreDocument({
    projectId: deps.projectId,
    segments: ["offices", officeId, "officeRatings", ratingId],
    accessToken: deps.accessToken,
    allowMissing: true
  });
  if (existing) return { ok: false, error: "duplicate_rating" };
  const createdAt = nowIso();
  await deps.setFirestoreDocument({
    projectId: deps.projectId,
    segments: ["offices", officeId, "officeRatings", ratingId],
    accessToken: deps.accessToken,
    fields: recordToFields(deps.firestoreHelpers, {
      officeId,
      ratingId,
      opportunityId,
      raterId,
      raterRole,
      stars: Number(stars),
      createdAt
    })
  });
  const next = applyRatingAggregate({
    ratingAverage: office.ratingAverage,
    ratingCount: office.ratingCount,
    stars
  });
  await writeOfficePatch(deps, officeId, next);
  const publicRaw = await deps.getFirestoreDocument({
    projectId: deps.projectId,
    segments: ["publicOffices", officeId],
    accessToken: deps.accessToken,
    allowMissing: true
  });
  if (publicRaw) {
    const publicOffice = deps.firestoreFieldsToJs(publicRaw.fields || {});
    await deps.setFirestoreDocument({
      projectId: deps.projectId,
      segments: ["publicOffices", officeId],
      accessToken: deps.accessToken,
      fields: recordToFields(deps.firestoreHelpers, {
        officeId,
        ratingAverage: next.ratingAverage,
        ratingCount: next.ratingCount
      })
    });
  }
  return { ok: true, ratingId, ...next };
}
