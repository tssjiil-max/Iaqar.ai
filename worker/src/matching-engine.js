/**
 * Phase 4 — Matching Engine (pure domain).
 * Thresholds, eligibility, scoring, reasons, and versioned match identity live here only.
 * Does not create Operations Center items or send messages.
 */

import {
  areTransactionIntentsCompatible,
  normalizeTransactionIntent,
  opportunityKindFromTransactionIntent,
  purposeFromTransactionIntent,
  resolveTransactionIntentFromRecord
} from "../../public/js/transaction-intent-domain.js";
import { normalizeOpportunityFinancials } from "../../public/js/opportunity-intake-domain.js";

export const MATCHING_RULE_VERSION = "4.1.0";

export const MATCHING_CONFIG = Object.freeze({
  threshold: 55,
  maxCandidates: 60,
  maxResults: 3,
  defaultCity: "المدينة المنورة",
  maxPriceGapRatio: 0.4,
  maxAreaDiffWithPropertyConflict: 0.65,
  maxRoomsDiff: 3,
  weights: Object.freeze({
    citySame: 5,
    districtSame: 30,
    districtConflict: -12,
    propertySame: 22,
    propertyConflict: -14,
    transactionSame: 14,
    priceOverlap: 20,
    priceGap10: 14,
    priceGap20: 7,
    priceGapHigh: -15,
    area10: 8,
    area25: 4,
    areaHigh: -5,
    roomsExact: 5,
    roomsNear: 3,
    roomsFar: -3,
    financingReady: 5,
    directOwner: 4,
    urgencyHigh: 4,
    completenessHigh: 3,
    completenessLow: -3
  }),
  opportunityBoost: Object.freeze({
    financingReady: 5,
    directOwner: 4,
    urgencyHigh: 3
  }),
  priorityBands: Object.freeze({
    critical: 88,
    high: 72,
    medium: 55
  })
});

export const MATCH_THRESHOLD = MATCHING_CONFIG.threshold;
export const MAX_MATCH_CANDIDATES = MATCHING_CONFIG.maxCandidates;
export const MAX_MATCH_RESULTS = MATCHING_CONFIG.maxResults;
export const DEFAULT_CITY = MATCHING_CONFIG.defaultCity;

const READINESS_LABELS = Object.freeze({
  very_high: "عالية جدًا",
  high: "عالية",
  medium: "متوسطة",
  low: "منخفضة"
});

export function phase4BoundaryGuarantees() {
  return {
    createsOperation: false,
    sendsWhatsApp: false,
    sendsTelegram: false,
    runsAutomaticCooperation: false,
    matchingRuleVersion: MATCHING_RULE_VERSION
  };
}

export function normalizeArabicText(value) {
  return String(value || "")
    .trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function readinessFromScore(score) {
  const safe = clamp(Math.round(Number(score) || 0), 0, 100);
  const key = safe >= 85 ? "very_high" : safe >= 70 ? "high" : safe >= 50 ? "medium" : "low";
  return { score: safe, key, label: READINESS_LABELS[key] };
}

export function normalizeMatchStatus(value) {
  const status = String(value || "active").trim();
  if (status === "new" || status === "in_progress") return "active";
  if (status === "converted") return "negotiation";
  return ["active", "waiting_response", "viewing", "negotiation", "completed", "closed"].includes(status)
    ? status
    : "active";
}

export function calculateClosingReadiness({
  matchScore = 0,
  source = {},
  candidate = {},
  status = "active"
} = {}) {
  const normalized = normalizeMatchStatus(status);
  if (normalized === "completed") return readinessFromScore(100);
  if (normalized === "closed") return readinessFromScore(0);
  const completeness = Math.min(Number(source.completeness || 0), Number(candidate.completeness || 0));
  let score = Math.round(clamp(Number(matchScore) || 0, 0, 100) * 0.28);
  score += Math.round(clamp(completeness, 0, 100) * 0.18);
  if (source.financingReady === true || candidate.financingReady === true) score += 18;
  if (source.directOwner === true || candidate.directOwner === true) score += 14;
  if (source.urgency === "high" || candidate.urgency === "high") score += 5;
  if (source.availabilityConfirmed === true || candidate.availabilityConfirmed === true) score += 7;
  if (source.priceConfirmed === true || candidate.priceConfirmed === true) score += 5;
  const stageFloor = { active: 25, waiting_response: 42, viewing: 72, negotiation: 88 }[normalized] || 20;
  return readinessFromScore(Math.max(stageFloor, score));
}

export function normalizePriceRange(record = {}) {
  const price = Number(record.price || record.priceOrBudget || 0);
  let min = Number(record.priceMin || price || 0);
  let max = Number(record.priceMax || price || 0);
  if (!min && !max) return null;
  if (!min) min = max;
  if (!max) max = min;
  if (min > max) [min, max] = [max, min];
  return { min, max };
}

export function rangesIntersect(a, b) {
  return Math.max(a.min, b.min) <= Math.min(a.max, b.max);
}

export function rangeGapRatio(a, b) {
  const gap = a.max < b.min ? b.min - a.max : (b.max < a.min ? a.min - b.max : 0);
  const midpoint = Math.max(1, (a.min + a.max + b.min + b.max) / 4);
  return gap / midpoint;
}

/** Map canonical transactionIntent (or legacy purpose) into sale|rent for scoring. */
export function normalizeTransactionType(record = {}) {
  const intent = resolveTransactionIntentFromRecord(record);
  if (intent) {
    const purpose = purposeFromTransactionIntent(intent);
    if (purpose === "RENT" || purpose === "LEASE_REQUEST") return "rent";
    if (purpose === "SALE" || purpose === "PURCHASE") return "sale";
  }
  const raw = String(record.transactionType || record.purpose || "").trim().toUpperCase();
  if (["RENT", "LEASE", "LEASE_REQUEST", "إيجار", "تأجير"].includes(raw) || raw === "RENT") return "rent";
  if (raw === "SALE" || raw === "PURCHASE" || raw === "BUY" || raw === "بيع" || raw === "شراء") return "sale";
  const lower = String(record.transactionType || "").toLowerCase();
  if (lower === "rent") return "rent";
  if (lower === "sale" || lower === "purchase") return "sale";
  return "";
}

export function normalizeOpportunitySide(record = {}) {
  const kind = String(record.opportunityKind || record.kind || record.recordType || "").toUpperCase();
  if (kind.includes("OFFER") || kind === "OWNER" || kind.includes("OWNER")) return "offer";
  if (kind.includes("REQUEST") || kind === "CLIENT" || kind.includes("CLIENT")) return "request";
  const intent = resolveTransactionIntentFromRecord(record);
  if (intent) {
    const derived = opportunityKindFromTransactionIntent(intent);
    if (derived === "OFFER") return "offer";
    if (derived === "REQUEST") return "request";
  }
  if (String(record.sourceCollection || "") === "owners") return "offer";
  if (String(record.sourceCollection || "") === "clients") return "request";
  return "";
}

export function isActiveLifecycle(record = {}) {
  if (record.deletedAt) return false;
  const life = String(record.lifecycleStatus || record.status || "ACTIVE").toUpperCase();
  if (["DELETED", "ARCHIVED", "CLOSED", "LOST"].includes(life)) return false;
  if (record.archivedAt && life !== "ACTIVE") return false;
  if (record.status && !["active", "new", "open", "ACTIVE", "READY"].includes(String(record.status))) {
    // Legacy clients/owners use status active/new/open.
    if (!record.lifecycleStatus) return false;
  }
  return true;
}

export function opportunityToMatchInput(record = {}, { id = "" } = {}) {
  const price = record.priceOrBudget ?? record.price ?? null;
  const intent = resolveTransactionIntentFromRecord(record);
  const financials = normalizeOpportunityFinancials({
    ...record,
    transactionIntent: intent || record.transactionIntent,
    purpose: intent ? purposeFromTransactionIntent(intent) : record.purpose
  });
  return {
    id: String(id || record.id || ""),
    city: record.city || "",
    district: record.district || "",
    propertyType: record.propertyType || "",
    transactionType: normalizeTransactionType(record),
    transactionIntent: intent || "",
    purpose: financials.purpose || (intent ? purposeFromTransactionIntent(intent) : (record.purpose || "")),
    opportunityKind: record.opportunityKind || "",
    price: price == null || price === "" ? 0 : Number(price),
    priceMin: record.priceMin != null ? Number(record.priceMin) : undefined,
    priceMax: record.priceMax != null ? Number(record.priceMax) : undefined,
    salePrice: financials.salePrice,
    annualRent: financials.annualRent,
    budget: financials.budget,
    priceOrBudget: financials.priceOrBudget,
    area: record.area != null ? Number(record.area) : 0,
    rooms: record.rooms != null ? Number(record.rooms) : 0,
    completeness: Number(record.dataCompleteness ?? record.completeness ?? 0),
    financingReady: record.financingReady === true,
    directOwner: record.directOwner === true,
    urgency: record.urgency || "",
    availabilityConfirmed: record.availabilityConfirmed === true,
    priceConfirmed: record.priceConfirmed === true || record.brokerConfirmed === true,
    phone: record.contactPhone || record.phone || "",
    senderName: record.contactName || record.name || "",
    lifecycleStatus: record.lifecycleStatus || "ACTIVE",
    version: Number(record.version || 1)
  };
}

export function counterpartsEligible(sourceRecord, candidateRecord) {
  if (!isActiveLifecycle(sourceRecord) || !isActiveLifecycle(candidateRecord)) return false;
  const sourceSide = normalizeOpportunitySide(sourceRecord);
  const candidateSide = normalizeOpportunitySide(candidateRecord);
  if (sourceSide && candidateSide && sourceSide === candidateSide) return false;

  const sourceIntent = normalizeTransactionIntent(sourceRecord.transactionIntent)
    || resolveTransactionIntentFromRecord(sourceRecord);
  const candidateIntent = normalizeTransactionIntent(candidateRecord.transactionIntent)
    || resolveTransactionIntentFromRecord(candidateRecord);
  if (!sourceIntent || !candidateIntent) return false;
  if (!areTransactionIntentsCompatible(sourceIntent, candidateIntent)) return false;

  const sourceTx = normalizeTransactionType(sourceRecord);
  const candidateTx = normalizeTransactionType(candidateRecord);
  if (sourceTx && candidateTx && sourceTx !== candidateTx) return false;
  return true;
}

function isFilledLabel(value = "") {
  const text = String(value || "").trim();
  return text.length > 0;
}

function partitionOfferRequest(source, candidate) {
  const sourceSide = normalizeOpportunitySide(source);
  const candidateSide = normalizeOpportunitySide(candidate);
  if (sourceSide === "offer" && candidateSide === "request") {
    return { offer: source, request: candidate };
  }
  if (sourceSide === "request" && candidateSide === "offer") {
    return { offer: candidate, request: source };
  }
  return null;
}

function requestPriceRange(requestInput = {}, requestFin = {}) {
  const purpose = requestFin.purpose;
  const hasMin = Number(requestInput.priceMin || 0) > 0;
  const hasMax = Number(requestInput.priceMax || 0) > 0;
  const budgetCap = Number(requestFin.budget ?? requestFin.priceOrBudget ?? requestInput.price ?? 0);
  if (purpose === "PURCHASE" || purpose === "LEASE_REQUEST") {
    const max = hasMax ? Number(requestInput.priceMax) : budgetCap;
    const min = hasMin ? Number(requestInput.priceMin) : 0;
    if (!max) return null;
    return { min, max };
  }
  return normalizePriceRange({
    budget: requestFin.budget,
    priceMin: requestInput.priceMin,
    priceMax: requestInput.priceMax,
    price: requestFin.budget ?? requestFin.priceOrBudget ?? requestInput.price,
    priceOrBudget: requestFin.budget ?? requestFin.priceOrBudget
  });
}

function passesHardPriceMatch(offerInput = {}, requestInput = {}) {
  const offerFin = normalizeOpportunityFinancials({
    ...offerInput,
    transactionIntent: offerInput.transactionIntent,
    purpose: offerInput.purpose
  });
  const requestFin = normalizeOpportunityFinancials({
    ...requestInput,
    transactionIntent: requestInput.transactionIntent,
    purpose: requestInput.purpose
  });
  const requestRange = requestPriceRange(requestInput, requestFin);
  const offerAmount = offerFin.purpose === "RENT" || Number(offerFin.annualRent) > 0
    ? Number(offerFin.annualRent ?? offerFin.priceOrBudget ?? offerInput.price ?? 0)
    : Number(offerFin.salePrice ?? offerFin.priceOrBudget ?? offerInput.price ?? 0);
  if (!requestRange || Number(requestRange.max || 0) <= 0) return false;
  if (!offerAmount || offerAmount <= 0) return false;
  const offerRange = normalizePriceRange({
    price: offerAmount,
    priceMin: offerAmount,
    priceMax: offerAmount,
    priceOrBudget: offerAmount
  });
  if (offerAmount <= requestRange.max && offerAmount >= requestRange.min) return true;
  return rangesIntersect(offerRange, requestRange);
}

/**
 * LEVEL 1 — hard match gate. All checks must pass before a match may exist.
 */
export function evaluateHardMatch(source, candidate, config = MATCHING_CONFIG) {
  const eq = (a, b) => a && b && normalizeArabicText(a) === normalizeArabicText(b);
  const fail = (failureReason) => ({ hardMatch: false, failureReason });

  const sourceRecord = {
    transactionIntent: source.transactionIntent,
    opportunityKind: source.opportunityKind,
    lifecycleStatus: source.lifecycleStatus || "ACTIVE"
  };
  const candidateRecord = {
    transactionIntent: candidate.transactionIntent,
    opportunityKind: candidate.opportunityKind,
    lifecycleStatus: candidate.lifecycleStatus || "ACTIVE"
  };
  if (!counterpartsEligible(sourceRecord, candidateRecord)) {
    const sourceIntent = normalizeTransactionIntent(source.transactionIntent);
    const candidateIntent = normalizeTransactionIntent(candidate.transactionIntent);
    if (!sourceIntent || !candidateIntent || !areTransactionIntentsCompatible(sourceIntent, candidateIntent)) {
      return fail("نوع العملية غير متوافق");
    }
    return fail("الأطراف غير متوافقة للمطابقة");
  }

  if (!isFilledLabel(source.propertyType) || !isFilledLabel(candidate.propertyType)) {
    return fail("نوع العقار غير مكتمل");
  }
  if (!eq(source.propertyType, candidate.propertyType)) {
    return fail("نوع العقار غير متوافق");
  }

  const sourceCity = source.city || config.defaultCity;
  const candidateCity = candidate.city || config.defaultCity;
  if (!eq(sourceCity, candidateCity)) {
    return fail("المدينة غير متوافقة");
  }

  if (!isFilledLabel(source.district) || !isFilledLabel(candidate.district)) {
    return fail("الحي غير مكتمل");
  }
  if (!eq(source.district, candidate.district)) {
    return fail("الحي غير متوافق");
  }

  const sides = partitionOfferRequest(source, candidate);
  if (!sides) return fail("اتجاه الطرفين غير صالح للمطابقة");
  if (!passesHardPriceMatch(sides.offer, sides.request)) {
    return fail("السعر خارج الميزانية");
  }

  return { hardMatch: true, failureReason: "" };
}

export function relevantFieldsFingerprint(record = {}) {
  const side = normalizeOpportunitySide(record);
  const range = normalizePriceRange(record);
  return [
    side,
    normalizeTransactionType(record),
    normalizeArabicText(record.city || ""),
    normalizeArabicText(record.district || ""),
    normalizeArabicText(record.propertyType || ""),
    range ? `${range.min}-${range.max}` : "",
    Number(record.area || 0),
    Number(record.rooms || 0),
    Number(record.version || 1),
    String(record.lifecycleStatus || record.status || "ACTIVE").toUpperCase()
  ].join("|");
}

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function canonicalPairKey(leftRef, rightRef) {
  return [String(leftRef || ""), String(rightRef || "")].sort().join("|");
}

export async function relevantDataVersion(leftRecord, rightRecord) {
  const left = relevantFieldsFingerprint(leftRecord);
  const right = relevantFieldsFingerprint(rightRecord);
  const ordered = [left, right].sort().join("||");
  const hex = await sha256Hex(ordered);
  return hex.slice(0, 24);
}

export async function buildMatchId({
  officeId,
  pairKey,
  matchingRuleVersion = MATCHING_RULE_VERSION,
  dataVersion
}) {
  const hex = await sha256Hex(
    `${String(officeId || "")}|${String(pairKey || "")}|${String(matchingRuleVersion)}|${String(dataVersion || "")}`
  );
  return `mat_${hex.slice(0, 36)}`;
}

/** Stable key for locating current matches for a pair under a rule version (without data version). */
export async function pairRuleKey({ officeId, pairKey, matchingRuleVersion = MATCHING_RULE_VERSION }) {
  const hex = await sha256Hex(
    `${String(officeId || "")}|${String(pairKey || "")}|${String(matchingRuleVersion)}`
  );
  return `pair_${hex.slice(0, 40)}`;
}

export function scoreMatch(source, candidate, config = MATCHING_CONFIG) {
  const reasons = [];
  const warnings = [];
  const rejectionChecks = [];
  const metrics = { priceDifferencePercent: 0, areaDifferencePercent: 0 };
  const breakdown = {
    city: 0, district: 0, propertyType: 0, transactionType: 0,
    price: 0, area: 0, rooms: 0, readiness: 0, urgency: 0, completeness: 0
  };
  const eq = (a, b) => a && b && normalizeArabicText(a) === normalizeArabicText(b);
  const reject = (message) => ({
    eligible: false,
    hardMatch: false,
    score: 0,
    opportunityScore: 0,
    priority: "rejected",
    readiness: readinessFromScore(0),
    reasons: [],
    warnings: [message],
    rejectionChecks: [message],
    breakdown,
    metrics
  });

  const hard = evaluateHardMatch(source, candidate, config);
  if (!hard.hardMatch) {
    return reject(hard.failureReason || "فشلت شروط المطابقة الحاسمة");
  }

  breakdown.city = config.weights.citySame;
  reasons.push("نفس المدينة");

  breakdown.district = config.weights.districtSame;
  reasons.push("نفس الحي");

  breakdown.propertyType = config.weights.propertySame;
  reasons.push("نفس نوع العقار");

  const sourceTx = normalizeTransactionType(source);
  const candidateTx = normalizeTransactionType(candidate);
  if (sourceTx && candidateTx && sourceTx === candidateTx) {
    breakdown.transactionType = config.weights.transactionSame;
    reasons.push("نفس نوع العملية");
  }

  const sourceRange = normalizePriceRange(source);
  const candidateRange = normalizePriceRange(candidate);
  if (sourceRange && candidateRange) {
    const gap = rangeGapRatio(sourceRange, candidateRange);
    metrics.priceDifferencePercent = Math.round(gap * 100);
    const overlaps = rangesIntersect(sourceRange, candidateRange);
    if (overlaps) {
      breakdown.price = config.weights.priceOverlap;
      reasons.push("السعر داخل الميزانية");
    } else if (gap <= 0.10) {
      breakdown.price = config.weights.priceGap10;
      reasons.push(`فرق السعر ${metrics.priceDifferencePercent}٪`);
    } else if (gap <= 0.20) {
      breakdown.price = config.weights.priceGap20;
      reasons.push(`فرق السعر ${metrics.priceDifferencePercent}٪ وقابل للتفاوض`);
    } else {
      breakdown.price = config.weights.priceGapHigh;
      warnings.push(`فرق السعر مرتفع: ${metrics.priceDifferencePercent}٪`);
    }
    if (metrics.priceDifferencePercent > 0) {
      reasons.push(`فرق السعر ${metrics.priceDifferencePercent}٪`);
    }
  } else {
    warnings.push("السعر غير مكتمل في أحد الطرفين");
  }

  const sa = Number(source.area || 0);
  const ca = Number(candidate.area || 0);
  if (sa && ca) {
    const diff = Math.abs(sa - ca) / Math.max(sa, ca);
    metrics.areaDifferencePercent = Math.round(diff * 100);
    if (diff <= 0.10) {
      breakdown.area = config.weights.area10;
      reasons.push(`فرق المساحة ${metrics.areaDifferencePercent}٪`);
    } else if (diff <= 0.25) {
      breakdown.area = config.weights.area25;
      reasons.push(`المساحة ضمن نطاق مقبول: فرق ${metrics.areaDifferencePercent}٪`);
    } else {
      breakdown.area = config.weights.areaHigh;
      warnings.push(`المساحة مختلفة: فرق ${metrics.areaDifferencePercent}٪`);
    }
  }

  const sr = Number(source.rooms || 0);
  const cr = Number(candidate.rooms || 0);
  if (sr && cr) {
    const diff = Math.abs(sr - cr);
    if (diff === 0) {
      breakdown.rooms = config.weights.roomsExact;
      reasons.push("عدد الغرف مطابق");
    } else if (diff === 1) {
      breakdown.rooms = config.weights.roomsNear;
      reasons.push("عدد الغرف قريب");
    } else {
      breakdown.rooms = config.weights.roomsFar;
      warnings.push("عدد الغرف غير مناسب");
    }
  }

  if (source.financingReady === true || candidate.financingReady === true) {
    breakdown.readiness += config.weights.financingReady;
    reasons.push("جاهزية مالية مرتفعة");
  }
  if (source.directOwner === true || candidate.directOwner === true) {
    breakdown.readiness += config.weights.directOwner;
    reasons.push("تواصل مباشر مع المالك");
  }
  if (source.urgency === "high" || candidate.urgency === "high") {
    breakdown.urgency = config.weights.urgencyHigh;
    reasons.push("فرصة عاجلة");
  }

  const completeness = Math.min(Number(source.completeness || 0), Number(candidate.completeness || 0));
  if (completeness >= 80) {
    breakdown.completeness = config.weights.completenessHigh;
    reasons.push("بيانات الطرفين مكتملة");
  } else if (completeness && completeness < 50) {
    breakdown.completeness = config.weights.completenessLow;
    warnings.push("بيانات المطابقة ناقصة");
  }

  const rawScore = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const score = clamp(Math.round(rawScore), 0, 100);
  const opportunityBoost = (source.financingReady || candidate.financingReady ? config.opportunityBoost.financingReady : 0)
    + (source.directOwner || candidate.directOwner ? config.opportunityBoost.directOwner : 0)
    + (source.urgency === "high" || candidate.urgency === "high" ? config.opportunityBoost.urgencyHigh : 0);
  const opportunityScore = clamp(score + opportunityBoost, 0, 100);
  const bands = config.priorityBands;
  const priority = opportunityScore >= bands.critical
    ? "critical"
    : opportunityScore >= bands.high
      ? "high"
      : opportunityScore >= bands.medium
        ? "medium"
        : "low";
  const readiness = calculateClosingReadiness({ matchScore: score, source, candidate, status: "active" });
  return {
    eligible: true,
    hardMatch: true,
    score,
    opportunityScore,
    readiness,
    reasons,
    warnings,
    rejectionChecks,
    breakdown,
    metrics,
    priority
  };
}

export function rankMatchCandidates(source, candidates, config = MATCHING_CONFIG) {
  return candidates
    .map((candidate, index) => ({ candidateIndex: index, candidate, ...scoreMatch(source, candidate, config) }))
    .filter((item) => item.hardMatch && item.eligible)
    .sort((a, b) => b.opportunityScore - a.opportunityScore || b.score - a.score)
    .slice(0, config.maxResults)
    .map((item, index) => ({ ...item, rank: index + 1, isBestOpportunity: index === 0 }));
}
