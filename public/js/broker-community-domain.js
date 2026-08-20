/**
 * مجتمع الوسطاء — مطابقة عابرة للمكاتب، خصوصية الطرف، اتفاقية عمولة ثنائية.
 * لا يقرر النظام العمولة ولا ينشئ التزامًا ماليًا؛ يسجّل اتفاق الوسطاء فقط.
 */

import { evaluateMatchingReadiness } from "./opportunity-readiness-domain.js";
import {
  adjacentNeighborhoodIds,
  neighborhoodRelationLabel,
  resolveDistrictIdFromLabel
} from "./neighborhood-adjacency-domain.js";
import { normalizeCooperationMode } from "./cooperation-phase6-domain.js";
import {
  MATCH_THRESHOLD,
  normalizeOpportunitySide,
  opportunityToMatchInput,
  scoreMatch
} from "../../worker/src/matching-engine.js";

export const BROKER_COMMUNITY_MAX_MATCHES = 3;
export const COMMUNITY_STRONG_CITY_SCORE = 70;
export const COMMUNITY_ADJACENT_SCORE_BOOST = 18;

export const COMMUNITY_REQUEST_STATUSES = Object.freeze({
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  ENDED: "ENDED"
});

export const COMMUNITY_OUTCOMES = Object.freeze({
  DEAL_COMPLETED: "DEAL_COMPLETED",
  ENDED_WITHOUT_DEAL: "ENDED_WITHOUT_DEAL"
});

export const COMMUNITY_AGREEMENT_STATUSES = Object.freeze({
  PENDING_COUNTERPARTY: "PENDING_COUNTERPARTY",
  ACTIVE: "ACTIVE",
  SUPERSEDED: "SUPERSEDED"
});

export const COMMUNITY_STATUS_LABELS = Object.freeze({
  PENDING: "بانتظار الرد",
  ACCEPTED: "تم قبول التعاون",
  REJECTED: "مرفوض",
  DEAL_COMPLETED: "تمت الصفقة",
  ENDED_WITHOUT_DEAL: "انتهى بدون صفقة",
  ENDED: "انتهى التعاون",
  PENDING_COUNTERPARTY: "بانتظار موافقة الطرف الآخر",
  ACTIVE: "اتفاقية التعاون فعالة"
});

const PII_KEYS = Object.freeze([
  "contactName",
  "clientName",
  "ownerName",
  "name",
  "senderName",
  "fullName",
  "contactPhone",
  "phone",
  "mobile",
  "whatsapp",
  "advertiserPhoneRaw",
  "advertiserPhoneNormalized",
  "advertiserPhoneLocal",
  "email",
  "mail",
  "nationalId",
  "idNumber",
  "identityNumber",
  "notes",
  "privateNotes",
  "internalNotes",
  "brokerNotes",
  "ownerNotes",
  "clientNotes",
  "documents",
  "mediaPaths",
  "attachments",
  "clientId",
  "ownerId",
  "whatsappUrl",
  "ownerWhatsapp",
  "clientWhatsapp"
]);

const PII_KEY_SET = new Set(PII_KEYS.map((key) => key.toLowerCase()));

export function isBrokerCommunityEnabled(modeOrOffice = "") {
  if (modeOrOffice && typeof modeOrOffice === "object") {
    const mode = normalizeCooperationMode(
      modeOrOffice.cooperationMode || modeOrOffice.mode || ""
    );
    if (mode === "DISABLED") return false;
    if (modeOrOffice.brokerCommunityEnabled === false) return false;
    return true;
  }
  return normalizeCooperationMode(modeOrOffice) !== "DISABLED";
}

export function canListingEnterBrokerCommunity(record = {}, office = {}) {
  if (!isBrokerCommunityEnabled(office)) return false;
  return evaluateMatchingReadiness(record).isReadyForMatching === true;
}

export function communityKind(record = {}) {
  const side = normalizeOpportunitySide(record);
  if (side === "offer") return "OFFER";
  if (side === "request") return "REQUEST";
  const raw = String(record.opportunityKind || record.kind || "").toUpperCase();
  if (raw.includes("OFFER") || raw === "OWNER") return "OFFER";
  if (raw.includes("REQUEST") || raw === "CLIENT") return "REQUEST";
  return "";
}

export function communityPairFromListings(source = {}, peer = {}) {
  const sourceKind = communityKind(source);
  const peerKind = communityKind(peer);
  const sourceId = String(source.id || source.opportunityId || "").trim();
  const peerId = String(peer.id || peer.opportunityId || "").trim();
  if (!sourceId || !peerId) return null;
  if (sourceKind === "OFFER" && peerKind === "REQUEST") {
    return { offerId: sourceId, requestId: peerId, offer: source, request: peer };
  }
  if (sourceKind === "REQUEST" && peerKind === "OFFER") {
    return { offerId: peerId, requestId: sourceId, offer: peer, request: source };
  }
  return null;
}

export function buildCommunityPairKey(pair = {}) {
  const offer = String(pair?.offerId || "").trim();
  const request = String(pair?.requestId || "").trim();
  if (!offer || !request) return "";
  return [offer, request].sort().join("|");
}

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildCommunityRequestId({ offerId = "", requestId = "" } = {}) {
  const pairKey = buildCommunityPairKey({ offerId, requestId });
  if (!pairKey) return "";
  const hex = await sha256Hex(`community|${pairKey}`);
  return `coop_cmty_${hex.slice(0, 40)}`;
}

export async function buildCommunityAgreementId({
  cooperationRequestId = "",
  version = 1
} = {}) {
  const hex = await sha256Hex(
    `agreement|${String(cooperationRequestId || "")}|${Number(version) || 1}`
  );
  return `agr_${hex.slice(0, 40)}`;
}

export function listingNeighborhoodRelation(source = {}, peer = {}) {
  const city = source.city || peer.city || "";
  const sourceId = resolveDistrictIdFromLabel(source.district, city);
  const peerId = resolveDistrictIdFromLabel(peer.district, city);
  if (sourceId && peerId && sourceId === peerId) {
    return { tier: 1, label: "نفس الحي", sourceDistrictId: sourceId, peerDistrictId: peerId };
  }
  if (sourceId && peerId && adjacentNeighborhoodIds(sourceId).includes(peerId)) {
    return {
      tier: 2,
      label: neighborhoodRelationLabel({
        opportunityDistrictId: sourceId,
        officeServiceIds: [peerId]
      }) || "حي مجاور",
      sourceDistrictId: sourceId,
      peerDistrictId: peerId
    };
  }
  const sourceCity = String(source.city || "").trim();
  const peerCity = String(peer.city || "").trim();
  if (sourceCity && peerCity && sourceCity === peerCity) {
    return { tier: 3, label: "داخل نطاق المدينة", sourceDistrictId: sourceId, peerDistrictId: peerId };
  }
  return { tier: 4, label: "خارج المدينة", sourceDistrictId: sourceId, peerDistrictId: peerId };
}

function hasPiiLeak(value) {
  if (!value || typeof value !== "object") return false;
  for (const key of Object.keys(value)) {
    if (!PII_KEY_SET.has(String(key).toLowerCase())) continue;
    const raw = value[key];
    if (raw == null || raw === "") continue;
    if (Array.isArray(raw) && raw.length === 0) continue;
    return true;
  }
  return false;
}

export function sanitizePeerListing(record = {}, extras = {}) {
  const kind = communityKind(record);
  const price = record.priceOrBudget ?? record.price ?? record.budget ?? record.salePrice ?? null;
  const area = record.area ?? null;
  const safe = {
    opportunityId: String(record.id || record.opportunityId || ""),
    opportunityKind: kind,
    kindLabel: kind === "OFFER" ? "عرض" : kind === "REQUEST" ? "طلب" : "",
    propertyType: String(record.propertyType || ""),
    purpose: String(record.purpose || ""),
    city: String(record.city || ""),
    district: String(record.district || ""),
    area: area == null || area === "" ? "" : String(area),
    priceRange: price == null || price === "" ? "" : String(price),
    rooms: record.rooms == null || record.rooms === "" ? "" : String(record.rooms)
  };
  const office = {
    officeId: String(extras.officeId || record.officeId || ""),
    officeName: String(extras.officeName || record.officeName || "مكتب عقاري مشارك في مجتمع الوسطاء"),
    brokerName: String(extras.brokerName || ""),
    officePhone: String(extras.officePhone || extras.whatsapp || ""),
    officeWhatsapp: String(extras.officeWhatsapp || extras.whatsapp || extras.officePhone || "")
  };
  const projection = { ...safe, ...office };
  if (hasPiiLeak(projection)) {
    for (const key of PII_KEYS) delete projection[key];
  }
  return projection;
}

export function communityWhatsAppMessage({ sourceKind = "" } = {}) {
  const peerKind = String(sourceKind || "").toUpperCase() === "REQUEST" ? "طلباتكم" : "عروضكم";
  return `السلام عليكم، لدي فرصة متوافقة مع أحد ${peerKind} من خلال مجتمع الوسطاء في iAqar.ai، وأرغب في مناقشة إمكانية التعاون.`;
}

export function communityWhatsAppUrl({ officeWhatsapp = "", officePhone = "", sourceKind = "" } = {}) {
  const digits = String(officeWhatsapp || officePhone || "").replace(/\D+/g, "");
  if (!digits) return "";
  let local = digits;
  if (local.startsWith("966")) local = local;
  else if (local.startsWith("0")) local = `966${local.slice(1)}`;
  else if (local.length === 9) local = `966${local}`;
  const text = encodeURIComponent(communityWhatsAppMessage({ sourceKind }));
  return `https://wa.me/${local}?text=${text}`;
}

export function normalizeCommissionSplit(officeAPercent, officeBPercent) {
  const a = Math.round(Number(officeAPercent));
  const b = Math.round(Number(officeBPercent));
  return { officeAPercent: a, officeBPercent: b };
}

export function validateCommissionSplit(officeAPercent, officeBPercent) {
  const { officeAPercent: a, officeBPercent: b } = normalizeCommissionSplit(
    officeAPercent,
    officeBPercent
  );
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { ok: false, error: "invalid_split", message: "أدخل نسبًا رقمية لتوزيع العمولة." };
  }
  if (a < 1 || b < 1 || a > 99 || b > 99) {
    return { ok: false, error: "split_range", message: "يجب أن تكون كل نسبة بين 1 و99." };
  }
  if (a + b !== 100) {
    return { ok: false, error: "split_sum", message: "مجموع النسب يجب أن يساوي 100٪." };
  }
  return { ok: true, officeAPercent: a, officeBPercent: b };
}

export function defaultCommissionSplit() {
  return { officeAPercent: 50, officeBPercent: 50 };
}

export function communityStatusLabel(request = {}) {
  const status = String(request.status || "").toUpperCase();
  const outcome = String(request.outcome || "").toUpperCase();
  if (outcome === COMMUNITY_OUTCOMES.DEAL_COMPLETED) return COMMUNITY_STATUS_LABELS.DEAL_COMPLETED;
  if (outcome === COMMUNITY_OUTCOMES.ENDED_WITHOUT_DEAL) {
    return COMMUNITY_STATUS_LABELS.ENDED_WITHOUT_DEAL;
  }
  if (status === "PENDING") return COMMUNITY_STATUS_LABELS.PENDING;
  if (status === "ACCEPTED") return COMMUNITY_STATUS_LABELS.ACCEPTED;
  if (status === "REJECTED") return COMMUNITY_STATUS_LABELS.REJECTED;
  if (status === "ENDED" || status === "REVOKED") return COMMUNITY_STATUS_LABELS.ENDED;
  return "جديد";
}

export function agreementStatusLabel(agreement = {}) {
  const status = String(agreement.status || "").toUpperCase();
  return COMMUNITY_STATUS_LABELS[status] || COMMUNITY_STATUS_LABELS.PENDING_COUNTERPARTY;
}

export function applyAgreementCreate({
  originatingOfficeId = "",
  targetOfficeId = "",
  createdByOfficeId = "",
  createdByUid = "",
  officeAPercent = 50,
  officeBPercent = 50,
  version = 1,
  now = new Date()
} = {}) {
  const split = validateCommissionSplit(officeAPercent, officeBPercent);
  if (!split.ok) return split;
  const createdBy = String(createdByOfficeId || originatingOfficeId);
  return {
    ok: true,
    agreement: {
      originatingOfficeId: String(originatingOfficeId),
      targetOfficeId: String(targetOfficeId),
      createdByOfficeId: createdBy,
      createdByUid: String(createdByUid || ""),
      officeAPercent: split.officeAPercent,
      officeBPercent: split.officeBPercent,
      status: COMMUNITY_AGREEMENT_STATUSES.PENDING_COUNTERPARTY,
      version: Number(version) || 1,
      approvals: {
        [createdBy]: {
          uid: String(createdByUid || ""),
          at: now.toISOString()
        }
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      activatedAt: null,
      financialCommitmentCreated: false
    }
  };
}

export function applyAgreementAccept({
  agreement = {},
  actorOfficeId = "",
  actorUid = "",
  now = new Date()
} = {}) {
  const origin = String(agreement.originatingOfficeId || "");
  const target = String(agreement.targetOfficeId || "");
  const actor = String(actorOfficeId || "");
  if (actor !== origin && actor !== target) {
    return { ok: false, error: "not_party", message: "لا يخص هذا المكتب هذه الاتفاقية." };
  }
  const status = String(agreement.status || "").toUpperCase();
  if (status === COMMUNITY_AGREEMENT_STATUSES.ACTIVE) {
    return { ok: true, idempotent: true, agreement };
  }
  if (status !== COMMUNITY_AGREEMENT_STATUSES.PENDING_COUNTERPARTY) {
    return { ok: false, error: "not_pending", message: "الاتفاقية ليست بانتظار الموافقة." };
  }
  const createdBy = String(agreement.createdByOfficeId || origin);
  if (actor === createdBy) {
    return { ok: false, error: "counterparty_only", message: "بانتظار موافقة الطرف الآخر." };
  }
  const approvals = { ...(agreement.approvals || {}) };
  approvals[actor] = { uid: String(actorUid || ""), at: now.toISOString() };
  return {
    ok: true,
    agreement: {
      ...agreement,
      approvals,
      status: COMMUNITY_AGREEMENT_STATUSES.ACTIVE,
      acceptedByOfficeId: actor,
      acceptedByUid: String(actorUid || ""),
      activatedAt: now.toISOString(),
      updatedAt: now.toISOString()
    }
  };
}

export function applyAgreementRevise({
  agreement = {},
  actorOfficeId = "",
  actorUid = "",
  officeAPercent,
  officeBPercent,
  now = new Date()
} = {}) {
  const origin = String(agreement.originatingOfficeId || "");
  const target = String(agreement.targetOfficeId || "");
  const actor = String(actorOfficeId || "");
  if (actor !== origin && actor !== target) {
    return { ok: false, error: "not_party", message: "لا يخص هذا المكتب هذه الاتفاقية." };
  }
  const split = validateCommissionSplit(officeAPercent, officeBPercent);
  if (!split.ok) return split;
  const currentA = Number(agreement.officeAPercent);
  const currentB = Number(agreement.officeBPercent);
  if (
    String(agreement.status || "").toUpperCase() === COMMUNITY_AGREEMENT_STATUSES.PENDING_COUNTERPARTY
    && currentA === split.officeAPercent
    && currentB === split.officeBPercent
  ) {
    return { ok: true, idempotent: true, agreement };
  }
  return {
    ok: true,
    requiresCounterparty: true,
    previousStatus: agreement.status,
    agreement: {
      ...agreement,
      officeAPercent: split.officeAPercent,
      officeBPercent: split.officeBPercent,
      status: COMMUNITY_AGREEMENT_STATUSES.PENDING_COUNTERPARTY,
      version: Number(agreement.version || 1) + 1,
      createdByOfficeId: actor,
      createdByUid: String(actorUid || ""),
      approvals: {
        [actor]: { uid: String(actorUid || ""), at: now.toISOString() }
      },
      activatedAt: null,
      acceptedByOfficeId: "",
      acceptedByUid: "",
      revisedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      previousSplit: { officeAPercent: currentA, officeBPercent: currentB }
    }
  };
}

export function canUnilaterallyChangeActiveAgreement(agreement = {}) {
  return String(agreement.status || "").toUpperCase() !== COMMUNITY_AGREEMENT_STATUSES.ACTIVE;
}

export function applyCommunityOutcome({
  request = {},
  outcome = "",
  actorOfficeId = "",
  now = new Date()
} = {}) {
  const origin = String(request.originatingOfficeId || "");
  const target = String(request.targetOfficeId || "");
  const actor = String(actorOfficeId || "");
  if (actor !== origin && actor !== target) {
    return { ok: false, error: "not_party", message: "لا يخص هذا المكتب فرصة التعاون." };
  }
  const status = String(request.status || "").toUpperCase();
  if (status !== "ACCEPTED" && status !== "ENDED") {
    return { ok: false, error: "not_accepted", message: "لا يمكن إنهاء الصفقة قبل قبول التعاون." };
  }
  const next = String(outcome || "").toUpperCase();
  if (!Object.values(COMMUNITY_OUTCOMES).includes(next)) {
    return { ok: false, error: "unknown_outcome", message: "اختر إتمام الصفقة أو الإنهاء بدون صفقة." };
  }
  if (String(request.outcome || "").toUpperCase() === next && status === "ENDED") {
    return { ok: true, idempotent: true, request };
  }
  return {
    ok: true,
    request: {
      ...request,
      status: "ENDED",
      outcome: next,
      closedAt: now.toISOString(),
      endedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      closedByOfficeId: actor,
      open: false
    }
  };
}

export function matchStrengthLabel(score = 0) {
  const value = Math.round(Number(score) || 0);
  if (value >= 80) return "مرتفع جدًا";
  if (value >= 70) return "مرتفع";
  if (value >= MATCH_THRESHOLD) return "مناسب";
  return "منخفض";
}

export function communityBadgeLabel(sourceKind = "") {
  const kind = String(sourceKind || "").toUpperCase();
  if (kind === "OFFER") return "يوجد وسيط لديه طلب متوافق";
  if (kind === "REQUEST") return "يوجد وسيط لديه عرض متوافق";
  return "فرصة تعاون";
}

export function shouldShowCommunityBadge(matches = []) {
  return Array.isArray(matches) && matches.some((row) => Number(row.matchScore || 0) >= MATCH_THRESHOLD);
}

function priceGap(source = {}, peer = {}) {
  const a = Number(source.priceOrBudget ?? source.price ?? source.budget ?? 0);
  const b = Number(peer.priceOrBudget ?? peer.price ?? peer.budget ?? 0);
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  return Math.abs(a - b);
}

function areaGap(source = {}, peer = {}) {
  const a = Number(source.area || 0);
  const b = Number(peer.area || 0);
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  return Math.abs(a - b);
}

function recencyMs(record = {}) {
  const raw = record.updatedAt || record.createdAt || record.dateAdded || 0;
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : 0;
}

export function sortCommunityMatches(matches = []) {
  return [...matches].sort((a, b) => {
    if (a.listingTier !== b.listingTier) return a.listingTier - b.listingTier;
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    if (a.priceGap !== b.priceGap) return a.priceGap - b.priceGap;
    if (a.areaGap !== b.areaGap) return a.areaGap - b.areaGap;
    return (b.recencyMs || 0) - (a.recencyMs || 0);
  });
}

export function scoreBrokerCommunityMatch({ source = {}, candidate = {} } = {}) {
  const pair = communityPairFromListings(source, candidate);
  if (!pair) return { eligible: false, score: 0, reasons: [], listingTier: 4 };
  const relation = listingNeighborhoodRelation(source, candidate);
  if (relation.tier >= 4) {
    return { eligible: false, score: 0, reasons: ["خارج نطاق المدينة"], listingTier: relation.tier };
  }
  const scored = scoreMatch(
    opportunityToMatchInput(source, { id: source.id }),
    opportunityToMatchInput(candidate, { id: candidate.id })
  );
  let score = Number(scored.score || 0);
  const reasons = [...(scored.reasons || [])];
  if (relation.tier === 1) {
    if (!reasons.includes("نفس الحي")) reasons.unshift("نفس الحي");
  } else if (relation.tier === 2) {
    score += COMMUNITY_ADJACENT_SCORE_BOOST;
    reasons.unshift("حي مجاور");
  }
  if (relation.tier === 3 && score < COMMUNITY_STRONG_CITY_SCORE) {
    return {
      eligible: false,
      score,
      reasons,
      listingTier: relation.tier,
      neighborhoodLabel: relation.label
    };
  }
  const eligible = scored.eligible !== false && score >= MATCH_THRESHOLD;
  return {
    eligible,
    score: Math.round(score),
    reasons,
    listingTier: relation.tier,
    neighborhoodLabel: relation.label,
    matchId: scored.matchId || ""
  };
}

export function rankBrokerCommunityMatches({
  sourceOpportunity = {},
  ownOfficeId = "",
  ownOffice = {},
  publicOffices = [],
  candidateOpportunities = [],
  requireReadiness = true
} = {}) {
  const ownId = String(ownOfficeId || "").trim().toLowerCase();
  if (!ownId) return [];
  if (!isBrokerCommunityEnabled(ownOffice.cooperationMode || ownOffice)) return [];
  const source = {
    ...sourceOpportunity,
    id: String(sourceOpportunity.id || sourceOpportunity.opportunityId || "source").trim() || "source"
  };
  if (requireReadiness && !evaluateMatchingReadiness(source).isReadyForMatching) {
    return [];
  }

  const byOffice = new Map();
  for (const row of candidateOpportunities) {
    const officeId = String(row.officeId || "").trim().toLowerCase();
    if (!officeId || officeId === ownId) continue;
    if (requireReadiness && !evaluateMatchingReadiness(row).isReadyForMatching) continue;
    if (!byOffice.has(officeId)) byOffice.set(officeId, []);
    byOffice.get(officeId).push(row);
  }

  const seenPairs = new Set();
  const matches = [];
  for (const office of publicOffices) {
    const officeId = String(office.officeId || office.id || "").trim().toLowerCase();
    if (!officeId || officeId === ownId) continue;
    if (!isBrokerCommunityEnabled(office)) continue;
    const officeCandidates = byOffice.get(officeId) || [];
    for (const candidate of officeCandidates) {
      const scored = scoreBrokerCommunityMatch({ source, candidate });
      if (!scored.eligible) continue;
      const pair = communityPairFromListings(source, candidate);
      const pairKey = buildCommunityPairKey(pair);
      if (!pairKey || seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      const safe = sanitizePeerListing(candidate, {
        officeId,
        officeName: office.officeName || officeId,
        brokerName: office.brokerName || "",
        officePhone: office.phone || office.whatsapp || "",
        officeWhatsapp: office.whatsapp || office.phone || ""
      });
      matches.push({
        ...safe,
        offerId: pair.offerId,
        requestId: pair.requestId,
        pairKey,
        listingTier: scored.listingTier,
        neighborhoodLabel: scored.neighborhoodLabel,
        matchScore: scored.score,
        matchReason: scored.reasons[0] || "مطابقة حقيقية وفق قواعد المنصة",
        matchStrength: matchStrengthLabel(scored.score),
        priceGap: priceGap(sourceOpportunity, candidate),
        areaGap: areaGap(sourceOpportunity, candidate),
        recencyMs: recencyMs(candidate),
        cooperationMode: normalizeCooperationMode(office.cooperationMode)
      });
    }
  }

  return sortCommunityMatches(matches).slice(0, BROKER_COMMUNITY_MAX_MATCHES);
}

export function communityNotificationCopy(type, extras = {}) {
  const district = String(extras.district || "").trim();
  const kind = String(extras.sourceKind || "").toUpperCase();
  switch (String(type || "")) {
    case "community_match":
      return {
        title: "فرصة تعاون جديدة",
        body: kind === "OFFER"
          ? `يوجد وسيط لديه طلب متوافق مع عرضك${district ? ` في ${district}` : "."}`
          : `يوجد وسيط لديه عرض متوافق مع طلبك${district ? ` في ${district}` : "."}`
      };
    case "community_request":
      return { title: "طلب تعاون جديد", body: "طلب تعاون جديد من وسيط عقاري." };
    case "community_agreement":
      return { title: "اتفاقية التعاون", body: "تم قبول اتفاقية التعاون." };
    case "community_deal":
      return { title: "إتمام الصفقة", body: "تم تسجيل إتمام الصفقة بنجاح." };
    default:
      return { title: "مجتمع الوسطاء", body: "تحديث جديد في فرصة تعاون." };
  }
}

export function resolveCommunityEmptyReason({
  sourceOpportunity = {},
  ownOffice = {},
  matches = []
} = {}) {
  if (Array.isArray(matches) && matches.length) return null;
  if (!isBrokerCommunityEnabled(ownOffice)) {
    return { code: "community_disabled" };
  }
  const readiness = evaluateMatchingReadiness(sourceOpportunity);
  if (!readiness.isReadyForMatching) {
    return { code: "incomplete_data", missing: readiness.matchingReadinessMissing || [] };
  }
  return { code: "no_match" };
}

export function containsBlockedPeerPii(payload = {}) {
  return hasPiiLeak(payload);
}
