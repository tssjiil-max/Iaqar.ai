/**
 * Canonical match persist contract.
 * An active Match may be written only when requestId and offerId both exist
 * and resolve to canonical REQUEST and OFFER opportunity documents.
 * Intake/client/owner temporary IDs are never stored as requestId/offerId.
 */

import { normalizeOpportunitySide } from "./matching-engine.js";

export const MATCH_INTEGRITY = Object.freeze({
  VALID: "VALID",
  INVALID: "INVALID"
});

const TEMPORARY_ID_RE = /^(?:cli|own)_intake_|^(?:cli|own)_wa_|^intake_cycle_/i;
const LEGACY_PARTY_ID_RE = /^(?:cli|own)_/i;

export function isTemporaryLinkageId(id = "") {
  const value = String(id || "").trim();
  if (!value) return false;
  if (/^opp_/i.test(value)) return false;
  return TEMPORARY_ID_RE.test(value);
}

export function isLegacyPartyRecordId(id = "") {
  const value = String(id || "").trim();
  if (!value || /^opp_/i.test(value)) return false;
  return LEGACY_PARTY_ID_RE.test(value);
}

export function proposedCanonicalIdsFromAlias(id = "") {
  const value = String(id || "").trim();
  if (!value || /^opp_/i.test(value)) return [];
  const out = [];
  const intake = value.match(/^(?:cli|own)_intake_(.+)$/i);
  if (intake) {
    const rest = intake[1].replace(/_(?:req|request|offer)$/i, "");
    out.push(`opp_intake_${rest}`);
    out.push(`opp_intake_${intake[1]}`);
  }
  const party = value.match(/^(?:cli|own)_(.+)$/i);
  if (party && !/_intake_/i.test(value)) {
    out.push(`opp_${party[1]}`);
  }
  return [...new Set(out.filter(Boolean))];
}

export function collectCandidateOpportunityIds(match = {}) {
  const ids = [];
  const push = (value) => {
    const id = String(value || "").trim();
    if (id) ids.push(id);
  };
  push(match.opportunityId);
  push(match.counterpartOpportunityId);
  if (String(match.sourceCollection || "") === "opportunities") push(match.sourceRecordId);
  if (String(match.counterpartCollection || "") === "opportunities") push(match.counterpartRecordId);
  for (const raw of [
    match.requestId,
    match.offerId,
    match.clientRequestId,
    match.ownerOfferId,
    match.sourceRecordId,
    match.counterpartRecordId
  ]) {
    if (!isTemporaryLinkageId(raw) && !isLegacyPartyRecordId(raw)) push(raw);
    for (const alias of proposedCanonicalIdsFromAlias(raw)) push(alias);
  }
  return [...new Set(ids)];
}

export function evaluateActiveMatchContract({
  requestId = "",
  offerId = "",
  requestDoc = null,
  offerDoc = null,
  officeId = "",
  propertyOfficeId = ""
} = {}) {
  const reasons = [];
  const reqId = String(requestId || "").trim();
  const offId = String(offerId || "").trim();
  if (!reqId) reasons.push("missing_requestId");
  if (!offId) reasons.push("missing_offerId");
  if (isTemporaryLinkageId(reqId) || isLegacyPartyRecordId(reqId)) reasons.push("temporary_request_id");
  if (isTemporaryLinkageId(offId) || isLegacyPartyRecordId(offId)) reasons.push("temporary_offer_id");
  if (reqId && !requestDoc) reasons.push("unresolved_request");
  if (offId && !offerDoc) reasons.push("unresolved_offer");
  if (requestDoc && normalizeOpportunitySide(requestDoc) !== "request") {
    reasons.push("request_not_canonical_request");
  }
  if (offerDoc && normalizeOpportunitySide(offerDoc) !== "offer") {
    reasons.push("offer_not_canonical_offer");
  }
  const requestOffice = String(officeId || requestDoc?.officeId || "").trim();
  const offerOffice = String(propertyOfficeId || officeId || offerDoc?.officeId || "").trim();
  if (requestOffice && requestDoc && String(requestDoc.officeId || "") !== requestOffice) {
    reasons.push("request_office_mismatch");
  }
  if (offerOffice && offerDoc && String(offerDoc.officeId || "") !== offerOffice) {
    reasons.push("offer_office_mismatch");
  }
  const unique = [...new Set(reasons)];
  return {
    ok: unique.length === 0,
    integrityStatus: unique.length ? MATCH_INTEGRITY.INVALID : MATCH_INTEGRITY.VALID,
    integrityReason: unique.join(",") || "",
    reasons: unique,
    requestId: reqId,
    offerId: offId
  };
}

export function resolveCanonicalPairFromDocs(match = {}, docsById = {}) {
  const lookup = (id) => {
    const key = String(id || "").trim();
    return key ? (docsById[key] || null) : null;
  };

  const oppA = String(match.opportunityId || "").trim();
  const oppB = String(match.counterpartOpportunityId || "").trim();
  const docA = lookup(oppA);
  const docB = lookup(oppB);
  if (docA && docB) {
    const sideA = normalizeOpportunitySide(docA);
    const sideB = normalizeOpportunitySide(docB);
    const crossOffice = String(docA.officeId || "") !== String(docB.officeId || "");
    if (sideA === "request" && sideB === "offer") {
      return evaluateActiveMatchContract({
        requestId: oppA,
        offerId: oppB,
        requestDoc: docA,
        offerDoc: docB,
        officeId: crossOffice ? docA.officeId : match.officeId,
        propertyOfficeId: crossOffice ? docB.officeId : String(match.propertyOfficeId || "")
      });
    }
    if (sideA === "offer" && sideB === "request") {
      return evaluateActiveMatchContract({
        requestId: oppB,
        offerId: oppA,
        requestDoc: docB,
        offerDoc: docA,
        officeId: crossOffice ? docB.officeId : match.officeId,
        propertyOfficeId: crossOffice ? docA.officeId : String(match.propertyOfficeId || "")
      });
    }
  }

  let requestId = "";
  let offerId = "";
  for (const id of collectCandidateOpportunityIds(match)) {
    const doc = lookup(id);
    if (!doc) continue;
    const side = normalizeOpportunitySide(doc);
    if (side === "request" && !requestId) requestId = id;
    else if (side === "offer" && !offerId) offerId = id;
  }

  return evaluateActiveMatchContract({
    requestId,
    offerId,
    requestDoc: lookup(requestId),
    offerDoc: lookup(offerId),
    officeId: match.officeId
  });
}

export function classifyHistoricalMatch(match = {}, docsById = {}) {
  const resolved = resolveCanonicalPairFromDocs(match, docsById);
  if (resolved.ok) {
    return {
      class: "REPAIRABLE",
      method: repairMethodFor(match, resolved),
      ...resolved
    };
  }
  return {
    class: "UNREPAIRABLE",
    method: "",
    ...resolved
  };
}

function repairMethodFor(match, resolved) {
  const oppA = String(match.opportunityId || "").trim();
  const oppB = String(match.counterpartOpportunityId || "").trim();
  if (
    (oppA === resolved.requestId && oppB === resolved.offerId)
    || (oppA === resolved.offerId && oppB === resolved.requestId)
  ) {
    return "opportunityId_counterpartOpportunityId";
  }
  const aliases = [
    match.clientRequestId,
    match.ownerOfferId,
    match.requestId,
    match.offerId,
    match.sourceRecordId,
    match.counterpartRecordId
  ];
  if (aliases.some((id) => proposedCanonicalIdsFromAlias(id).includes(resolved.requestId)
    || proposedCanonicalIdsFromAlias(id).includes(resolved.offerId))) {
    return "intake_or_legacy_sourceRecord_alias";
  }
  return "canonical_opportunity_lookup";
}

export function uiLinkageReasons({
  requestId = "",
  offerId = "",
  requestDoc = null,
  offerDoc = null,
  integrityStatus = "",
  integrityReason = ""
} = {}) {
  const reasons = [];
  if (String(integrityStatus || "").toUpperCase() === MATCH_INTEGRITY.INVALID) {
    reasons.push(...String(integrityReason || "integrity_invalid").split(",").filter(Boolean));
  }
  if (!requestId) reasons.push("missing_requestId");
  if (!offerId) reasons.push("missing_offerId");
  if (isTemporaryLinkageId(requestId) || isLegacyPartyRecordId(requestId)) {
    reasons.push("temporary_request_id");
  }
  if (isTemporaryLinkageId(offerId) || isLegacyPartyRecordId(offerId)) {
    reasons.push("temporary_offer_id");
  }
  if (requestId && !requestDoc) reasons.push("unresolved_request");
  if (offerId && !offerDoc) reasons.push("unresolved_offer");
  return [...new Set(reasons)];
}
