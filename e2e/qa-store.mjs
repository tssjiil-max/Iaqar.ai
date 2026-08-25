/**
 * Deterministic in-memory QA world. Namespace: qa_*
 * Used by the local mock worker so Playwright tests never touch production data.
 */

import { evaluateMatchingReadiness } from "../public/js/opportunity-readiness-domain.js";
import { buildV2FieldPatch } from "../public/js/opportunity-details-v2.js";
import {
  createOpaquePartyToken,
  sanitizePartyPublicView,
  buildPartySnapshot,
  isAllowedPartyAction,
  isPrimaryPartyAction,
  PARTY_SESSION_STATUS,
  revealedDetailFromSnapshot
} from "../public/js/party-session-domain.js";
import {
  livingStageAfterPartyAction,
  appendLivingTimeline,
  nextActorForLivingStage,
  partyReplyTimelineLabel,
  LIVING_TASK_STAGE
} from "../public/js/match-group-domain.js";
import {
  applyCooperationWorkflowTransition,
  COOPERATION_STAGE,
  COOPERATION_ACTION
} from "../public/js/cooperation-workflow-domain.js";

export const QA_NS = "qa";

export const OFFICES = Object.freeze({
  client: { id: "qa-office-client", name: "مكتب النور العقاري" },
  partner: { id: "qa-office-wadi", name: "مكتب الوادي العقاري" }
});

function nowIso() {
  return "2026-08-25T09:20:00.000Z";
}

function stampReadiness(record) {
  const readiness = evaluateMatchingReadiness(record);
  return {
    ...record,
    matchingReadiness: readiness.matchingReadiness,
    matchingReadinessMissing: readiness.matchingReadinessMissing,
    isReadyForMatching: readiness.isReadyForMatching
  };
}

function opportunity(id, officeId, extra) {
  return stampReadiness({
    id,
    officeId,
    city: "المدينة المنورة",
    updatedAt: nowIso(),
    createdAt: nowIso(),
    ...extra
  });
}

export function seedWorld() {
  const req1842 = opportunity("qa_req_1842", OFFICES.client.id, {
    opportunityKind: "REQUEST",
    purpose: "RENT",
    propertyType: "شقة",
    district: "العزيزية",
    budget: 55000,
    priceOrBudget: 55000,
    area: 120,
    advertiserRole: "CLIENT",
    contactPhone: "0501111842",
    advertiserPhoneNormalized: "+966501111842"
  });
  const offer1842 = opportunity("qa_offer_1842", OFFICES.client.id, {
    opportunityKind: "OFFER",
    purpose: "RENT",
    propertyType: "شقة",
    district: "العزيزية",
    salePrice: 50000,
    priceOrBudget: 50000,
    area: 125,
    advertiserRole: "OWNER",
    contactPhone: "0502221842",
    advertiserPhoneNormalized: "+966502221842",
    photos: ["https://example.com/qa/aziziyah.jpg"]
  });
  const incomplete = opportunity("qa_offer_incomplete", OFFICES.client.id, {
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "أرض",
    district: "",
    salePrice: 0,
    area: 0,
    advertiserRole: "OWNER",
    contactPhone: "0503331849"
  });
  const lastField = opportunity("qa_offer_last_field", OFFICES.client.id, {
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "أرض",
    district: "",
    salePrice: 850000,
    area: 1175,
    advertiserRole: "OWNER",
    contactPhone: "0504441850",
    advertiserPhoneNormalized: "+966504441850"
  });
  const nomatch = opportunity("qa_req_nomatch", OFFICES.client.id, {
    opportunityKind: "REQUEST",
    purpose: "SALE",
    propertyType: "قصر",
    district: "جبل أحد",
    budget: 9000000,
    priceOrBudget: 9000000,
    area: 900,
    advertiserRole: "CLIENT",
    contactPhone: "0505551999"
  });
  const multiReq = opportunity("qa_req_multi", OFFICES.client.id, {
    opportunityKind: "REQUEST",
    purpose: "SALE",
    propertyType: "أرض",
    district: "السكب",
    budget: 850000,
    priceOrBudget: 850000,
    area: 1175,
    advertiserRole: "CLIENT",
    contactPhone: "0506662000"
  });
  const multiOffers = [1, 2, 3].map((n) => opportunity(`qa_offer_multi_${n}`, OFFICES.client.id, {
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "أرض",
    district: "السكب",
    salePrice: 830000 + n * 1000,
    priceOrBudget: 830000 + n * 1000,
    area: 1180 + n,
    advertiserRole: "OWNER",
    contactPhone: `050777200${n}`
  }));
  const closeReq = opportunity("qa_req_close", OFFICES.client.id, {
    opportunityKind: "REQUEST",
    purpose: "RENT",
    propertyType: "شقة",
    district: "العزيزية",
    budget: 56000,
    priceOrBudget: 56000,
    area: 110,
    advertiserRole: "CLIENT",
    contactPhone: "0501011843"
  });
  const closeOffer = opportunity("qa_offer_close", OFFICES.client.id, {
    opportunityKind: "OFFER",
    purpose: "RENT",
    propertyType: "شقة",
    district: "العزيزية",
    salePrice: 52000,
    priceOrBudget: 52000,
    area: 112,
    advertiserRole: "OWNER",
    contactPhone: "0502021843"
  });
  const coopReq = opportunity("qa_req_coop", OFFICES.client.id, {
    opportunityKind: "REQUEST",
    purpose: "SALE",
    propertyType: "أرض",
    district: "السكب",
    budget: 850000,
    priceOrBudget: 850000,
    area: 1175,
    advertiserRole: "CLIENT",
    contactPhone: "0508884310"
  });
  const coopOffer = opportunity("qa_offer_coop", OFFICES.partner.id, {
    opportunityKind: "OFFER",
    purpose: "SALE",
    propertyType: "أرض",
    district: "السكب",
    salePrice: 830000,
    priceOrBudget: 830000,
    area: 1180,
    advertiserRole: "OWNER",
    contactPhone: "0509994311"
  });

  const opportunities = {
    [req1842.id]: req1842,
    [offer1842.id]: offer1842,
    [incomplete.id]: incomplete,
    [lastField.id]: lastField,
    [nomatch.id]: nomatch,
    [multiReq.id]: multiReq,
    [coopReq.id]: coopReq,
    [coopOffer.id]: coopOffer,
    [closeReq.id]: closeReq,
    [closeOffer.id]: closeOffer
  };
  for (const row of multiOffers) opportunities[row.id] = row;

  const matches = {
    match_close_9901: {
      id: "match_close_9901",
      officeId: OFFICES.client.id,
      operationType: "MATCH_REVIEW",
      clientRequestId: closeReq.id,
      ownerOfferId: closeOffer.id,
      livingStage: LIVING_TASK_STAGE.FOLLOW_UP,
      livingTimeline: [
        { type: "reply", actor: "OWNER", label: "المالك أكد أن العقار متاح", createdAt: nowIso() }
      ],
      hasNewResponse: false,
      nextActor: "BROKER",
      ownerContactNeeded: false
    },
    match_aziz_1842: {
      id: "match_aziz_1842",
      officeId: OFFICES.client.id,
      operationType: "MATCH_REVIEW",
      clientRequestId: req1842.id,
      ownerOfferId: offer1842.id,
      livingStage: LIVING_TASK_STAGE.MATCH_FOUND,
      livingTimeline: [],
      hasNewResponse: false,
      nextActor: "BROKER",
      ownerContactNeeded: false
    }
  };
  for (const row of multiOffers) {
    matches[`match_multi_${row.id}`] = {
      id: `match_multi_${row.id}`,
      officeId: OFFICES.client.id,
      operationType: "MATCH_REVIEW",
      clientRequestId: multiReq.id,
      ownerOfferId: row.id,
      livingStage: LIVING_TASK_STAGE.MATCH_FOUND,
      livingTimeline: [],
      hasNewResponse: false,
      nextActor: "BROKER"
    };
  }

  const cooperations = {
    coop_431: {
      id: "coop_431",
      cooperationId: "coop_431",
      cooperationTaskId: "coop_431",
      originatingOfficeId: OFFICES.client.id,
      targetOfficeId: OFFICES.partner.id,
      originatingOfficeName: OFFICES.client.name,
      targetOfficeName: OFFICES.partner.name,
      currentStage: COOPERATION_STAGE.MATCH_FOUND,
      status: "SUGGESTED",
      originOpportunityId: coopReq.id,
      counterpartOpportunityId: coopOffer.id,
      originListing: {
        opportunityKind: "REQUEST",
        propertyType: "أرض",
        purpose: "SALE",
        district: "السكب",
        priceOrBudget: 850000,
        area: 1175
      },
      counterpartListing: {
        opportunityKind: "OFFER",
        propertyType: "أرض",
        purpose: "SALE",
        district: "السكب",
        priceOrBudget: 830000,
        area: 1180
      },
      proximityLabel: "نفس الحي",
      compatibilityLabel: "مطابقة مرتفعة",
      matchReasons: ["السعر مناسب", "المواصفات متقاربة"]
    }
  };

  return {
    opportunities,
    matches,
    cooperations,
    partySessions: {},
    failNextPatch: 0,
    appointments: [],
    requestLog: []
  };
}

let world = seedWorld();

export function resetWorld() {
  world = seedWorld();
  return snapshot();
}

export function snapshot() {
  return world;
}

export function setFailNextPatch(count = 1) {
  world.failNextPatch = Number(count) || 1;
}

function listingFrom(opp = {}) {
  return {
    propertyType: opp.propertyType,
    purpose: opp.purpose,
    district: opp.district,
    city: opp.city,
    budget: opp.budget,
    salePrice: opp.salePrice,
    area: opp.area,
    annualRent: opp.annualRent
  };
}

export function operationsForOffice(officeId) {
  const items = [];
  for (const match of Object.values(world.matches)) {
    if (match.officeId !== officeId) continue;
    if (match.livingStage === LIVING_TASK_STAGE.COMPLETED || match.livingStage === LIVING_TASK_STAGE.MATCH_EXHAUSTED) {
      continue;
    }
    const request = world.opportunities[match.clientRequestId] || {};
    const offer = world.opportunities[match.ownerOfferId] || {};
    items.push({
      operationType: "MATCH_REVIEW",
      matchId: match.id,
      clientRequestId: match.clientRequestId,
      ownerOfferId: match.ownerOfferId,
      opportunityId: match.clientRequestId,
      propertyType: request.propertyType,
      purpose: request.purpose,
      district: request.district,
      city: request.city,
      budget: request.budget,
      area: request.area,
      candidatePropertyType: offer.propertyType,
      candidatePurpose: offer.purpose,
      candidateDistrict: offer.district,
      candidateCity: offer.city,
      candidateSalePrice: offer.salePrice,
      candidateArea: offer.area,
      matchReasons: ["نفس الحي", "ضمن الميزانية", "المساحة متقاربة"],
      livingStage: match.livingStage,
      livingTimeline: match.livingTimeline || [],
      hasNewResponse: Boolean(match.hasNewResponse),
      nextActor: match.nextActor,
      ownerContactNeeded: Boolean(match.ownerContactNeeded),
      livingUpdatedAt: match.livingUpdatedAt || "",
      clientPhone: request.contactPhone,
      ownerPhone: offer.contactPhone,
      clientName: "عميل QA",
      ownerName: "مالك QA"
    });
  }
  for (const coop of Object.values(world.cooperations)) {
    if (coop.originatingOfficeId !== officeId && coop.targetOfficeId !== officeId) continue;
    if (String(coop.currentStage || "").toUpperCase() === "COMPLETED"
      || String(coop.currentStage || "").toUpperCase() === "REJECTED") {
      continue;
    }
    items.push({
      ...coop,
      operationType: "COOPERATION_MATCH",
      officeId,
      viewerOfficeId: officeId
    });
  }
  return items;
}

export function opportunitiesForOffice(officeId) {
  return Object.values(world.opportunities).filter((row) => row.officeId === officeId);
}

export function patchOpportunity(id, formData, editorKey, rawPatch) {
  const existing = world.opportunities[id];
  if (!existing) return { ok: false, error: "not_found", status: 404 };
  if (world.failNextPatch > 0) {
    world.failNextPatch -= 1;
    return { ok: false, error: "forced_fail", message: "تعذر حفظ الحقل، حاول مرة أخرى", status: 500 };
  }
  let patch = rawPatch && typeof rawPatch === "object" ? { ...rawPatch } : null;
  if (!patch) {
    const built = buildV2FieldPatch(existing, editorKey, formData);
    if (!built.ok) return { ok: false, error: built.error, status: 400 };
    patch = built.patch;
  }
  const next = stampReadiness({
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString()
  });
  world.opportunities[id] = next;
  return { ok: true, reloaded: next, readiness: evaluateMatchingReadiness(next) };
}

function stampMatch(matchId, patch) {
  const match = world.matches[matchId];
  if (!match) return;
  const timeline = appendLivingTimeline(match.livingTimeline, patch.timelineEvent, { now: new Date() });
  world.matches[matchId] = {
    ...match,
    livingStage: patch.livingStage || match.livingStage,
    ownerContactNeeded: patch.ownerContactNeeded != null ? patch.ownerContactNeeded : match.ownerContactNeeded,
    hasNewResponse: Boolean(patch.hasNewResponse),
    nextActor: patch.nextActor || match.nextActor,
    livingTimeline: timeline,
    livingUpdatedAt: new Date().toISOString()
  };
}

export function mintPartySession({ officeId, matchId, party }) {
  const side = party === "owner" ? "owner" : "client";
  const match = world.matches[matchId];
  if (!match) return { ok: false, error: "match_not_found", status: 404 };
  const existing = Object.values(world.partySessions).find((row) => row.matchId === matchId && row.party === side && row.status !== PARTY_SESSION_STATUS.REVOKED);
  if (existing) {
    return { ok: true, token: existing.token, reused: true };
  }
  const token = createOpaquePartyToken();
  const listingId = side === "owner" ? match.ownerOfferId : match.clientRequestId;
  const record = world.opportunities[listingId] || world.opportunities[match.ownerOfferId];
  const offer = world.opportunities[match.ownerOfferId] || {};
  world.partySessions[token] = {
    token,
    officeId,
    matchId,
    party: side,
    status: PARTY_SESSION_STATUS.ACTIVE,
    snapshot: buildPartySnapshot(offer),
    createdAt: new Date().toISOString(),
    replyAction: "",
    followUpAction: ""
  };
  stampMatch(matchId, {
    livingStage: side === "owner" ? LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION : LIVING_TASK_STAGE.WAITING_CLIENT,
    ownerContactNeeded: false,
    hasNewResponse: false,
    nextActor: side === "owner" ? "OWNER" : "CLIENT",
    timelineEvent: {
      type: side === "owner" ? "whatsapp_owner_opened" : "whatsapp_client_opened",
      actor: "BROKER",
      label: side === "owner" ? "تم فتح واتساب للمالك" : "تم فتح واتساب للعميل"
    }
  });
  return { ok: true, token, reused: false };
}

function partyView(session) {
  const office = session.officeId === OFFICES.partner.id ? OFFICES.partner : OFFICES.client;
  const match = world.matches[session.matchId] || {};
  return sanitizePartyPublicView({
    party: session.party,
    status: session.status,
    snapshot: session.snapshot,
    officeName: office.name,
    replyAction: session.replyAction || "",
    followUpAction: session.followUpAction || "",
    revealedDetail: session.followUpAction
      ? revealedDetailFromSnapshot(session.snapshot, session.followUpAction)
      : null,
    livingStage: match.livingStage || ""
  });
}

export function getPartySession(token) {
  const session = world.partySessions[token];
  if (!session || session.status === PARTY_SESSION_STATUS.REVOKED) {
    return { ok: false, error: "invalid_party_link", status: 404 };
  }
  if (!session.openedAt) {
    session.openedAt = new Date().toISOString();
    stampMatch(session.matchId, {
      livingStage: world.matches[session.matchId]?.livingStage,
      hasNewResponse: false,
      timelineEvent: {
        type: "party_opened",
        actor: session.party === "owner" ? "OWNER" : "CLIENT",
        label: partyReplyTimelineLabel(session.party, "opened")
      }
    });
  }
  return { ok: true, view: partyView(session) };
}

export function replyPartySession(token, action) {
  const session = world.partySessions[token];
  if (!session) return { ok: false, error: "invalid_party_link", status: 404 };
  if (!isAllowedPartyAction(session.party, action, session.replyAction || "")) {
    return { ok: false, error: "invalid_party_action", message: "هذا الرد غير متاح.", status: 400 };
  }
  const alreadyPrimary = session.status === PARTY_SESSION_STATUS.REPLIED && session.replyAction;
  const isFollowUp = alreadyPrimary && !isPrimaryPartyAction(session.party, action);
  if (alreadyPrimary && !isFollowUp) return { ok: true, view: partyView(session) };
  const living = livingStageAfterPartyAction({
    party: session.party,
    action,
    followUp: isFollowUp,
    snapshot: session.snapshot,
    hasNextCandidate: false
  });
  if (isFollowUp) {
    session.followUpAction = action;
  } else {
    session.status = PARTY_SESSION_STATUS.REPLIED;
    session.replyAction = action;
  }
  stampMatch(session.matchId, {
    livingStage: living.stage,
    missingInfoKey: living.missingInfoKey || "",
    ownerContactNeeded: Boolean(living.ownerContactNeeded),
    hasNewResponse: true,
    nextActor: nextActorForLivingStage(living.stage, { ownerContactNeeded: Boolean(living.ownerContactNeeded) }),
    timelineEvent: {
      type: `party_reply_${action}`,
      actor: session.party === "owner" ? "OWNER" : "CLIENT",
      label: partyReplyTimelineLabel(session.party, action)
    }
  });
  return { ok: true, view: partyView(session) };
}

export function confirmCompletion(matchId) {
  stampMatch(matchId, {
    livingStage: LIVING_TASK_STAGE.COMPLETED,
    ownerContactNeeded: false,
    hasNewResponse: false,
    nextActor: "NONE",
    timelineEvent: { type: "deal_completed", actor: "BROKER", label: "تم إتمام الصفقة" }
  });
  return { ok: true, livingStage: LIVING_TASK_STAGE.COMPLETED };
}

export function cooperationAction(officeId, cooperationId, action) {
  const record = world.cooperations[cooperationId];
  if (!record) return { ok: false, error: "not_found", status: 404 };
  const mapped = action === "ACCEPT" || action === "accept_cooperation"
    ? COOPERATION_ACTION.ACCEPT
    : action === "REJECT" || action === "reject_cooperation"
      ? COOPERATION_ACTION.REJECT
      : COOPERATION_ACTION.REQUEST;
  const result = applyCooperationWorkflowTransition(record, mapped, { actorOfficeId: officeId });
  if (!result.ok) return { ...result, status: 400 };
  if (result.duplicate) return { ok: true, duplicate: true, cooperation: record };
  world.cooperations[cooperationId] = { ...record, ...result.patch };
  return { ok: true, cooperation: world.cooperations[cooperationId] };
}

export function bookAppointment({ matchId, slot }) {
  const taken = world.appointments.some((row) => row.slot === slot && row.status === "booked");
  if (taken) return { ok: false, error: "slot_taken", message: "هذا الموعد محجوز.", status: 409 };
  world.appointments.push({ matchId, slot, status: "booked" });
  stampMatch(matchId, {
    livingStage: LIVING_TASK_STAGE.APPOINTMENT_COORDINATION,
    hasNewResponse: true,
    nextActor: "OWNER",
    timelineEvent: { type: "appointment_selected", actor: "CLIENT", label: "العميل اختار موعد معاينة" }
  });
  return { ok: true };
}

export { listingFrom };
