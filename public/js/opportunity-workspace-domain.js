/**
 * Ready Opportunity Workspace — pure projection and best-next-action engine.
 */

import { buildBankListCardView } from "./bank-list-card-domain.js";
import {
  evaluateMatchingReadiness,
  missingFieldLabelsArabic,
  MISSING_FIELD_LABELS
} from "./opportunity-readiness-domain.js";
import { contactLineMarkup } from "./opportunity-card-domain.js";
import { activeFollowUpFromRecord } from "./opportunity-followup-domain.js";

const COOPERATION_STATUS_LABELS = Object.freeze({
  PENDING: "بانتظار الموافقة",
  ACCEPTED: "مقبول",
  REJECTED: "مرفوض",
  REVOKED: "ملغي",
  ENDED: "منتهي",
  CANCELLED: "ملغي"
});

function safeId(value = "") {
  return String(value || "").trim();
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeMatchRow(match = {}, opportunityId = "") {
  const id = safeId(match.matchId || match.id);
  const score = Number(match.score || match.opportunityScore || 0);
  const reasons = parseJsonArray(match.reasonsJson || match.reasons);
  const warnings = parseJsonArray(match.warningsJson || match.warnings);
  const breakdown = parseJsonArray(match.breakdownJson || match.breakdown);
  const isInternal = !match.cooperationMatch && !match.sharedViaCooperation;
  return {
    matchId: id,
    score: Math.round(score),
    reasons,
    warnings,
    breakdown,
    isInternal,
    opportunityId: safeId(match.opportunityId),
    counterpartOpportunityId: safeId(match.counterpartOpportunityId),
    propertyType: match.propertyType || "",
    district: match.district || "",
    city: match.city || "",
    status: match.status || "active",
    isCurrent: match.isCurrent !== false,
    rank: Number(match.rank || 0)
  };
}

export function sortMatchesForWorkspace(matches = [], opportunityId = "") {
  const oppId = safeId(opportunityId);
  return [...matches]
    .map((row) => normalizeMatchRow(row, oppId))
    .filter((row) => row.isCurrent && row.status !== "superseded" && row.score > 0)
    .filter((row) => row.opportunityId === oppId || row.counterpartOpportunityId === oppId)
    .sort((a, b) => b.score - a.score || a.rank - b.rank);
}

export function buildBestNextAction({
  record = {},
  matches = [],
  suggestions = [],
  followUp = null
} = {}) {
  const readiness = evaluateMatchingReadiness(record);
  if (!readiness.isReadyForMatching) {
    const missing = missingFieldLabelsArabic(readiness.matchingReadinessMissing || []);
    const first = missing[0] || "البيانات الناقصة";
    const label = first.includes("جوال") ? `أكمل ${first}` : `أكمل ${first}`;
    return { label, action: "complete_fields", count: 0 };
  }

  const contactAttempted = Boolean(
    record.lastWhatsAppOpenedAt || record.lastCallOpenedAt || record.lastContactAt
  );
  const lastOutcome = String(record.lastContactOutcome || record.advertiserContactStatus || "").toUpperCase();
  const activeFollowUp = followUp || activeFollowUpFromRecord(record);
  const now = Date.now();
  const followUpAt = activeFollowUp?.at ? new Date(activeFollowUp.at).getTime() : 0;
  const followUpDue = followUpAt > 0 && followUpAt <= now;

  if (lastOutcome === "AGREED") {
    return { label: "أغلق الفرصة وسجل النتيجة", action: "close_opportunity", count: 0 };
  }
  if (followUpDue && activeFollowUp?.status === "scheduled") {
    return { label: "أكد موعد المتابعة", action: "confirm_followup", count: 0 };
  }
  if (lastOutcome === "NO_RESPONSE") {
    return { label: "حدد موعد متابعة", action: "schedule_followup", count: 0 };
  }
  if (contactAttempted && !lastOutcome) {
    return { label: "سجل نتيجة التواصل", action: "record_contact", count: 0 };
  }

  const realMatches = sortMatchesForWorkspace(matches, record.id || record.opportunityId);
  if (realMatches.length > 0) {
    return {
      label: `راجع ${realMatches.length} مطابقات حقيقية`,
      action: "review_matches",
      count: realMatches.length
    };
  }

  const eligible = (suggestions || []).filter((row) => safeId(row.officeId));
  if (eligible.length > 0) {
    const hood = eligible[0].neighborhoodLabel || eligible[0].district || "الحي";
    const reason = hood.includes("حي") ? hood : `حي ${hood}`;
    return {
      label: `اطلب تعاونًا من مكتب متخصص في ${reason}`,
      action: "request_cooperation",
      count: eligible.length
    };
  }

  return { label: "أكمل بيانات الفرصة", action: "complete_fields", count: 0 };
}

export function buildWorkspaceHeader(record = {}) {
  const card = buildBankListCardView(record);
  const readiness = evaluateMatchingReadiness(record);
  const contact = contactLineMarkup(record);
  const showContact = contact && contact !== "غير محدد" && readiness.isReadyForMatching;
  return {
    kindBadge: card.kindBadge,
    title: card.title,
    headerStatus: card.headerStatus,
    location: card.location,
    priceText: card.priceText,
    areaText: card.areaText,
    roomsText: card.roomsText,
    contactMarkup: showContact ? contact : "",
    isReadyForMatching: readiness.isReadyForMatching
  };
}

export function missingFieldEditorRows(record = {}) {
  const readiness = evaluateMatchingReadiness(record);
  const missing = readiness.matchingReadinessMissing || [];
  return missing.map((key) => ({
    key,
    label: MISSING_FIELD_LABELS[key] || key,
    value: inferFieldValue(record, key)
  }));
}

function inferFieldValue(record = {}, key = "") {
  switch (key) {
    case "propertyType":
      return record.propertyType || "";
    case "city":
      return record.city || "";
    case "district":
      return record.district || "";
    case "priceOrBudget":
      return record.priceOrBudget ?? record.price ?? record.budget ?? "";
    case "advertiserRole":
      return record.advertiserRole || "";
    case "contactPhone":
      return record.advertiserPhoneNormalized || record.contactPhone || record.phone || "";
    case "purpose":
      return record.purpose || record.transactionType || "";
    default:
      return record[key] ?? "";
  }
}

export function cooperationStatusLabel(status = "") {
  const key = String(status || "").toUpperCase();
  return COOPERATION_STATUS_LABELS[key] || status || "";
}

export function buildWorkspaceActivity(record = {}, cooperationRequests = []) {
  const items = [];
  if (record.createdAt) {
    items.push({ at: record.createdAt, text: "تمت إضافة الفرصة" });
  }
  if (record.lastContactAt) {
    items.push({ at: record.lastContactAt, text: "تم التواصل مع الجهة" });
  }
  if (record.lastContactOutcome) {
    items.push({ at: record.lastContactAt || record.updatedAt, text: `نتيجة التواصل: ${record.lastContactOutcome}` });
  }
  const followUp = activeFollowUpFromRecord(record);
  if (followUp?.at) {
    items.push({ at: followUp.at, text: "موعد متابعة محدد" });
  }
  for (const req of cooperationRequests) {
    const status = cooperationStatusLabel(req.status);
    items.push({
      at: req.updatedAt || req.createdAt,
      text: `تعاون مع ${req.targetOfficeName || req.targetOfficeId}: ${status}`
    });
  }
  if (record.closedAt) {
    items.push({ at: record.closedAt, text: "تم إنهاء الفرصة" });
  }
  return items
    .filter((row) => row.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 12);
}

export function workspaceSmartActions(record = {}) {
  const isOwner = String(record.contactType || "").toLowerCase() === "owner"
    || String(record.opportunityKind || "").toUpperCase() === "OFFER";
  const whatsappLabel = isOwner ? "واتساب المالك" : "واتساب العميل";
  return [
    { id: "review_matches", label: "عرض المطابقات" },
    { id: "suggested_offices", label: "مكاتب مقترحة" },
    { id: "share_broker", label: "مشاركة مع وسيط" },
    { id: "whatsapp", label: whatsappLabel },
    { id: "schedule_followup", label: "تحديد متابعة" },
    { id: "close_opportunity", label: "إنهاء الفرصة" }
  ];
}

export function filterSuggestionsByCity(record = {}, suggestions = []) {
  const city = safeId(record.city).toLowerCase();
  if (!city) return suggestions;
  return suggestions.filter((row) => {
    const officeCity = safeId(row.city).toLowerCase();
    return !officeCity || officeCity === city;
  });
}
