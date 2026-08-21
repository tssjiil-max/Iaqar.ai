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
import { activeFollowUpFromRecord, formatFollowUpAppointmentLine } from "./opportunity-followup-domain.js";
import { normalizePurpose, normalizeOpportunityFinancials } from "./opportunity-intake-domain.js";
import {
  formatLocalPhoneDisplay,
  validateAdvertiserPhoneLocalInput,
  normalizeAdvertiserRoleInput,
  ADVERTISER_ROLES
} from "./advertiser-phone-domain.js";

function isOwnerOffer(record = {}) {
  const kind = String(record.opportunityKind || record.kind || record.recordType || "").toUpperCase();
  return record.contactType === "owner"
    || kind === "OWNER"
    || kind === "OWNER_OFFER"
    || kind === "OFFER";
}

/** Arabic label for contact party — never derived from officeId. */
export function contactPartyLabel(record = {}) {
  const raw = String(record.contactType || record.kind || record.recordType || "").toLowerCase();
  if (raw === "owner" || raw === "owner_offer") return "مالك";
  if (raw === "client" || raw === "buyer" || raw === "customer") return "عميل";
  if (raw === "broker") return "وسيط";
  if (raw === "office") return "مكتب";
  return isOwnerOffer(record) ? "مالك" : "عميل";
}

export function purposeOptionsForRecord(record = {}) {
  if (isOwnerOffer(record)) {
    return [
      { value: "SALE", label: "بيع" },
      { value: "RENT", label: "تأجير" }
    ];
  }
  return [
    { value: "PURCHASE", label: "شراء" },
    { value: "LEASE_REQUEST", label: "إيجار" }
  ];
}

const PURPOSE_DISPLAY = Object.freeze({
  SALE: "بيع",
  PURCHASE: "شراء",
  RENT: "إيجار",
  LEASE_REQUEST: "طلب إيجار",
  INVESTMENT: "استثمار"
});

function resolveStoredPurpose(record = {}) {
  return normalizePurpose(record.purpose || record.transactionType || "");
}

function purposeInputValue(record = {}, storedPurpose = "") {
  const canonical = normalizePurpose(storedPurpose || record.purpose || record.transactionType || "");
  return PURPOSE_DISPLAY[canonical] || canonical || "";
}

function phoneInputValue(record = {}) {
  const candidates = [
    record.advertiserPhoneNormalized,
    record.contactPhone,
    record.phone,
    record.advertiserPhoneRaw
  ];
  for (const value of candidates) {
    const local = formatLocalPhoneDisplay(value);
    if (local) return local;
  }
  const raw = String(record.advertiserPhoneRaw || record.phone || "").trim();
  return raw && !/^\+?966/.test(raw) ? raw.slice(0, 16) : "";
}

/**
 * Ordered missing-field definitions for the incomplete completion form.
 * @returns {Array<{ key: string, label: string, type: string, value?: string, options?: Array<{value,label}> }>}
 */
export function buildIncompleteFormFields(record = {}, readiness = {}) {
  const missing = readiness.matchingReadinessMissing || [];
  const order = ["contactPhone", "purpose", "propertyType", "city", "district", "priceOrBudget", "advertiserRole", "area", "rooms"];
  const sorted = order.filter((key) => missing.includes(key));
  const storedPurpose = resolveStoredPurpose(record);
  const purposeDisplay = purposeInputValue(record, storedPurpose);

  return sorted.map((key) => {
    switch (key) {
      case "purpose":
        return {
          key,
          label: "الغرض",
          type: "text",
          name: "purpose",
          value: purposeDisplay
        };
      case "propertyType":
        return {
          key,
          label: "نوع العقار",
          type: "text",
          name: "propertyType",
          value: record.propertyType || ""
        };
      case "city":
        return { key, label: "المدينة", type: "text", name: "city", value: record.city || "" };
      case "district":
        return { key, label: "الحي", type: "text", name: "district", value: record.district || "" };
      case "priceOrBudget":
        return {
          key,
          label: isOwnerOffer(record) ? "السعر" : "الميزانية",
          type: "number",
          name: "priceOrBudget",
          value: record.priceOrBudget ?? record.price ?? record.budget ?? ""
        };
      case "advertiserRole":
        return {
          key,
          label: "صفة المعلن",
          type: "select",
          name: "advertiserRole",
          value: normalizeAdvertiserRoleInput(record.advertiserRole || "", { fallback: "" }),
          options: ADVERTISER_ROLES
            .filter((row) => row.id !== "UNKNOWN")
            .map((row) => ({ value: row.id, label: row.label }))
        };
      case "contactPhone":
        return {
          key,
          label: "رقم الجوال الكامل",
          type: "phone",
          name: "advertiserPhoneLocal",
          value: phoneInputValue(record)
        };
      case "area":
        return { key, label: "المساحة", type: "number", name: "area", value: record.area ?? "" };
      case "rooms":
        return { key, label: "الغرف", type: "number", name: "rooms", value: record.rooms ?? "" };
      default:
        return { key, label: MISSING_FIELD_LABELS[key] || key, type: "text", name: key, value: record[key] ?? "" };
    }
  });
}

export function hasCompleteContactPhone(record = {}) {
  const candidates = [
    record.advertiserPhoneNormalized,
    record.contactPhone,
    record.phone
  ];
  for (const value of candidates) {
    if (formatLocalPhoneDisplay(value)) return true;
  }
  return false;
}

export function mergeIncompleteFormPreview(existing = {}, formData = {}) {
  const editKeys = ["purpose", "propertyType", "city", "district", "priceOrBudget", "area", "rooms", "advertiserRole"];
  const merged = { ...existing };
  for (const key of editKeys) {
    if (formData[key] !== undefined && formData[key] !== "") {
      if (key === "purpose") {
        merged[key] = normalizePurpose(formData[key]);
      } else if (key === "advertiserRole") {
        const normalized = normalizeAdvertiserRoleInput(formData[key], { fallback: "" });
        if (normalized) merged[key] = normalized;
      } else {
        merged[key] = formData[key];
      }
    }
  }
  if (formData.advertiserPhoneLocal) {
    merged.advertiserPhoneLocal = formData.advertiserPhoneLocal;
    const phoneCheck = validateAdvertiserPhoneLocalInput(formData.advertiserPhoneLocal);
    if (phoneCheck.ok && phoneCheck.e164) {
      const local = String(formData.advertiserPhoneLocal || "").replace(/\D/g, "");
      merged.advertiserPhoneNormalized = phoneCheck.e164;
      merged.contactPhone = phoneCheck.e164;
      merged.advertiserPhoneRaw = local.startsWith("0") ? local : `0${local.replace(/^966/, "")}`;
      merged.phone = merged.advertiserPhoneRaw;
    }
  }
  return normalizeOpportunityFinancials(merged);
}

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
    const missingKeys = readiness.matchingReadinessMissing || [];
    if (missingKeys.includes("contactPhone")) {
      return { label: "استكمال رقم الجوال", action: "complete_fields", count: 0 };
    }
    const missing = missingFieldLabelsArabic(missingKeys);
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
    return { label: "إتمام الصفقة", action: "complete_deal", count: 0 };
  }
  if (lastOutcome === "REFUSED") {
    return { label: "إنهاء الفرصة", action: "close_opportunity", count: 0 };
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

  return { label: "عرض المطابقات", action: "review_matches", count: 0 };
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
    if (record.importActivityText) {
      items.push({ at: record.importedAt || record.createdAt, text: record.importActivityText });
    } else {
      items.push({ at: record.createdAt, text: "تمت إضافة الفرصة" });
    }
  }
  if (record.lastContactAt) {
    items.push({ at: record.lastContactAt, text: "تم التواصل مع الجهة" });
  }
  if (record.lastContactOutcome) {
    items.push({ at: record.lastContactAt || record.updatedAt, text: `نتيجة التواصل: ${record.lastContactOutcome}` });
  }
  const followUp = activeFollowUpFromRecord(record);
  if (followUp?.at) {
    const line = formatFollowUpAppointmentLine(followUp.at);
    items.push({
      at: followUp.at,
      text: line ? `تم تحديد موعد متابعة: ${line}` : "تم تحديد موعد متابعة"
    });
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

const ACTIVE_COOP_STATUSES = new Set(["PENDING", "ACCEPTED", "ACTIVE", "PENDING_APPROVAL"]);

function shareStatusFromCooperationState(state = "") {
  const key = String(state || "").trim().toUpperCase();
  if (key === "PENDING_APPROVAL") return "PENDING";
  if (key === "ACTIVE") return "ACCEPTED";
  return key;
}

export function mergeWorkspaceCooperationRequests(record = {}, bundleRequests = [], ownOfficeId = "") {
  const fromBundle = Array.isArray(bundleRequests) ? bundleRequests.filter(Boolean) : [];
  if (fromBundle.length) return fromBundle;
  const coopId = safeId(record.activeCooperationId);
  const state = shareStatusFromCooperationState(record.cooperationState || record.cooperationStatus);
  if (!coopId || !ACTIVE_COOP_STATUSES.has(state)) return [];
  return [{
    id: coopId,
    status: state === "ACTIVE" ? "ACCEPTED" : state,
    originatingOfficeId: safeId(record.officeId || ownOfficeId),
    targetOfficeId: safeId(record.cooperationTargetOfficeId),
    targetOfficeName: safeId(record.cooperationTargetOfficeName || record.cooperationTargetOfficeId || "مكتب"),
    originatingOfficeName: safeId(record.originatingOfficeName || ownOfficeId)
  }];
}

export function activeWorkspaceCooperationRequests(requests = []) {
  return (Array.isArray(requests) ? requests : []).filter((row) =>
    ACTIVE_COOP_STATUSES.has(String(row.status || "").toUpperCase())
  );
}
