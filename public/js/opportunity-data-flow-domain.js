/**
 * Unified opportunity / match data flow — IDs, contact gates, dedupe, and navigation.
 * Single source for daily tasks, operations center, and opportunity bank.
 */

import { firestoreOfficeId } from "./office-id-domain.js";
import { normalizeAdvertiserPhoneE164 } from "./advertiser-phone-domain.js";
import { isContactPhoneComplete } from "./opportunity-field-completion-domain.js";
import { evaluateMatchingReadiness } from "./opportunity-readiness-domain.js";
import { isRequestSource } from "./match-group-domain.js";

export const MATCH_CONTACT_INCOMPLETE_LABEL = "مطابقة محتملة — تحتاج استكمال بيانات التواصل";

export const COMPLETENESS_STATUS = Object.freeze({
  INCOMPLETE: "INCOMPLETE",
  READY_FOR_MATCHING: "READY_FOR_MATCHING"
});

export const READINESS_STATUS = Object.freeze({
  NEEDS_COMPLETION: "NEEDS_COMPLETION",
  READY_FOR_MATCHING: "READY_FOR_MATCHING"
});

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function canonicalFirestoreOfficeId(officeId = "") {
  return firestoreOfficeId(officeId) || text(officeId);
}

export function resolveMatchIds(item = {}) {
  const recordType = String(item.recordType || "").toLowerCase();
  const matchId = text(
    item.matchId || (recordType === "match" ? item.recordId || item.id : "")
  );
  const requestId = text(item.clientRequestId || item.requestId);
  const offerId = text(item.ownerOfferId || item.offerId);
  const opportunityId = text(
    item.opportunityId
      || (recordType === "opportunity" || recordType === "intake" ? item.recordId : "")
      || offerId
      || requestId
  );
  return { matchId, requestId, offerId, opportunityId };
}

export function matchDedupeKey(item = {}, officeId = "") {
  const ids = resolveMatchIds(item);
  const office = canonicalFirestoreOfficeId(officeId || item.officeId || item.viewerOfficeId || "");
  if (!ids.requestId && !ids.offerId) return ids.matchId ? `${office}|${ids.matchId}` : "";
  return [office, ids.requestId, ids.offerId].filter(Boolean).join("|");
}

export function isValidContactPhone(value) {
  return isContactPhoneComplete(value);
}

export function resolvePartyContactPhone(item = {}, canonical = null, party = "client") {
  const fromCanonical = canonical && typeof canonical === "object" ? canonical : null;
  if (party === "owner") {
    const raw = text(
      item.ownerPhone
        || item.ownerContactPhone
        || item.advertiserPhone
        || fromCanonical?.contactPhone
        || fromCanonical?.advertiserPhoneNormalized
        || fromCanonical?.phone
    );
    return isValidContactPhone(raw) ? normalizeAdvertiserPhoneE164(raw) : "";
  }
  const raw = text(
    item.clientPhone
      || item.clientContactPhone
      || item.buyerPhone
      || fromCanonical?.contactPhone
      || fromCanonical?.advertiserPhoneNormalized
      || fromCanonical?.phone
  );
  return isValidContactPhone(raw) ? normalizeAdvertiserPhoneE164(raw) : "";
}

export function evaluateMatchContactGate({
  item = {},
  request = null,
  offer = null,
  ownerContactNeeded = false
} = {}) {
  const clientPhone = resolvePartyContactPhone(item, request, "client");
  const ownerPhone = resolvePartyContactPhone(item, offer, "owner");
  const clientComplete = Boolean(clientPhone);
  const ownerComplete = Boolean(ownerPhone);
  const needsOwner = Boolean(ownerContactNeeded || item.ownerContactNeeded);
  const missingParties = [];
  if (!clientComplete) missingParties.push("client");
  if (needsOwner && !ownerComplete) missingParties.push("owner");

  const contactComplete = missingParties.length === 0;
  let whatsappBlockedReason = "";
  if (!clientComplete) whatsappBlockedReason = "رقم تواصل العميل غير متوفر.";
  else if (needsOwner && !ownerComplete) whatsappBlockedReason = "رقم تواصل المالك غير متوفر.";

  return {
    clientPhone,
    ownerPhone,
    clientComplete,
    ownerComplete,
    contactComplete,
    missingParties,
    canSendToClient: clientComplete,
    canSendToOwner: ownerComplete,
    canShowAsMatched: contactComplete,
    canWhatsApp: contactComplete,
    statusLabel: contactComplete ? "" : MATCH_CONTACT_INCOMPLETE_LABEL,
    whatsappBlockedReason
  };
}

export function projectOpportunityFlowStatuses(record = {}) {
  const readiness = evaluateMatchingReadiness(record);
  return {
    completenessStatus: readiness.isReadyForMatching
      ? COMPLETENESS_STATUS.READY_FOR_MATCHING
      : COMPLETENESS_STATUS.INCOMPLETE,
    readinessStatus: readiness.matchingReadiness,
    matchingReadiness: readiness.matchingReadiness,
    matchingReadinessMissing: readiness.matchingReadinessMissing,
    isReadyForMatching: readiness.isReadyForMatching,
    matchEligible: readiness.isReadyForMatching && isValidContactPhone(
      record.contactPhone || record.advertiserPhoneNormalized || record.phone
    )
  };
}

export function resolveDetailsOpportunityId(task = {}, side = "auto") {
  const ids = resolveMatchIds(task);
  if (side === "offer" || side === "owner") return ids.offerId;
  if (side === "request" || side === "client") return ids.requestId;
  return ids.offerId || ids.requestId || ids.opportunityId;
}

export function extractOpportunityIdFromOperationsItem(item = {}) {
  if (!item) return "";
  const direct = text(item.opportunityId);
  if (direct) return direct;

  const recordType = String(item.recordType || "").toLowerCase();
  if (recordType === "opportunity" || recordType === "intake") {
    const recordId = text(item.recordId);
    if (recordId) return recordId;
  }

  if (recordType === "match" || item.matchId) {
    const ids = resolveMatchIds(item);
    return ids.offerId || ids.requestId || ids.opportunityId;
  }

  const rawId = text(item.id);
  if (rawId.startsWith("opp-")) return rawId.slice(4);
  return "";
}

function feedItemRank(item = {}) {
  const recordType = String(item.recordType || "").toLowerCase();
  const opType = String(item.operationType || "").toUpperCase();
  if (recordType === "match") return 40;
  if (opType === "MATCH_REVIEW") return 30;
  if (recordType === "deal") return 20;
  if (recordType === "opportunity" && (Number(item.activeMatchCount || item.matchCount || 0) > 0 || item.matchId)) {
    return 10;
  }
  return 0;
}

function feedItemKey(item = {}) {
  return text(item.id || item.recordId || item.matchId);
}

export function dedupeOperationsFeedItems(items = []) {
  const winnersByMatch = new Map();
  const dropKeys = new Set();

  for (const item of items || []) {
    const ids = resolveMatchIds(item);
    if (!ids.matchId) continue;
    const prev = winnersByMatch.get(ids.matchId);
    if (!prev) {
      winnersByMatch.set(ids.matchId, item);
      continue;
    }
    if (feedItemRank(item) > feedItemRank(prev)) {
      dropKeys.add(feedItemKey(prev));
      winnersByMatch.set(ids.matchId, item);
    } else {
      dropKeys.add(feedItemKey(item));
    }
  }

  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = feedItemKey(item);
    if (!key || dropKeys.has(key) || seen.has(key)) continue;
    const ids = resolveMatchIds(item);
    if (ids.matchId) {
      const winner = winnersByMatch.get(ids.matchId);
      if (winner && feedItemKey(winner) !== key) continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function enrichOperationsItemContactGate(item = {}, opportunities = new Map()) {
  const ids = resolveMatchIds(item);
  if (!ids.matchId && !ids.requestId && !ids.offerId) return item;
  const request = item._canonicalRequest || opportunities.get(ids.requestId) || null;
  const offer = item._canonicalOffer || opportunities.get(ids.offerId) || null;
  const gate = evaluateMatchContactGate({
    item,
    request,
    offer,
    ownerContactNeeded: item.ownerContactNeeded
  });
  return {
    ...item,
    _canonicalRequest: request || item._canonicalRequest,
    _canonicalOffer: offer || item._canonicalOffer,
    clientPhone: gate.clientPhone || item.clientPhone,
    ownerPhone: gate.ownerPhone || item.ownerPhone,
    canSendToClient: gate.canSendToClient,
    canSendToOwner: gate.canSendToOwner,
    canShowAsMatched: gate.canShowAsMatched,
    matchContactStatusLabel: gate.statusLabel,
    whatsappBlockedReason: gate.whatsappBlockedReason,
    _contactGate: gate
  };
}

export function indexOpportunityRecordsFromFeed(items = []) {
  const map = new Map();
  for (const item of items || []) {
    if (String(item?.recordType || "").toLowerCase() !== "opportunity") continue;
    const id = text(item.recordId || item.opportunityId || item.id?.replace(/^opp-/, ""));
    if (!id) continue;
    map.set(id, { id, ...item });
  }
  return map;
}

export function opportunityRecordsFromFeed(items = []) {
  return [...indexOpportunityRecordsFromFeed(items).values()];
}

export function shouldShowBankLoadMore({ hasMore = false, visibleCount = 0, scanExhausted = false } = {}) {
  if (!hasMore) return false;
  if (scanExhausted && visibleCount === 0) return false;
  return true;
}

export function isOwnedByOffice(record = {}, officeId = "") {
  const current = canonicalFirestoreOfficeId(officeId);
  if (!current) return false;
  const owner = canonicalFirestoreOfficeId(record.officeId || current);
  const origin = canonicalFirestoreOfficeId(record.originatingOfficeId || "");
  if (owner !== current) return false;
  return !origin || origin === current;
}

export function operationsCategoryForItem(item = {}) {
  const recordType = String(item.recordType || "").toLowerCase();
  const status = String(item.status || item.statusLabel || "").toUpperCase();
  const archivedDealStatuses = new Set([
    "COMPLETED", "ARCHIVED", "CLOSED_WON", "CLOSED_LOST", "DISMISSED", "EXPIRED", "CLOSED", "LOST"
  ]);
  if (recordType === "deal" && !archivedDealStatuses.has(status)) return "matched";

  const ids = resolveMatchIds(item);
  const hasMatch = Boolean(ids.matchId)
    || String(item.operationType || "").toUpperCase() === "MATCH_REVIEW"
    || String(item.recordType || "").toLowerCase() === "match";
  if (!hasMatch) return "";
  const gate = item._contactGate || evaluateMatchContactGate({
    item,
    request: item._canonicalRequest,
    offer: item._canonicalOffer,
    ownerContactNeeded: item.ownerContactNeeded
  });
  if (!gate.canShowAsMatched) return "incomplete";
  return "matched";
}

export function scopedMatchGroupKey(item = {}, officeId = "") {
  const office = canonicalFirestoreOfficeId(officeId || item.officeId || item.viewerOfficeId || "");
  const ids = resolveMatchIds(item);
  const sourceIsRequest = isRequestSource(item);
  const pair = sourceIsRequest
    ? (ids.requestId || ids.opportunityId || ids.offerId)
    : (ids.offerId || ids.opportunityId || ids.requestId || ids.matchId);
  if (office && pair) return `${office}|${pair}`;
  return pair || ids.matchId;
}
