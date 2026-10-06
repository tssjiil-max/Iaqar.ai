/**
 * «سجل النشاط» — the office audit trail as the manager reads it: who did what, to what, when.
 * Entries are written by the Worker only (offices/{o}/auditLogs); this file turns them into
 * plain Arabic lines. Unknown actions are still listed, never hidden.
 */

import { toDate } from "./format-domain.js";

const ACTION_TEXT = Object.freeze({
  RECORD_CREATED: "أضاف سجلًا",
  RECORD_UPDATED: "عدّل سجلًا",
  RECORD_PAUSED: "أوقف سجلًا مؤقتًا",
  RECORD_ARCHIVED: "أرشف سجلًا",
  RECORD_RESTORED: "أعاد سجلًا إلى النشاط",
  RECORD_DELETED: "حذف سجلًا",
  RECORD_MEDIA_UPDATED: "حدّث صور عقار",
  DEAL_DOCUMENT_UPDATED: "حدّث مستندات صفقة",
  DEAL_CLOSED: "أغلق صفقة",
  CHANNEL_LINK_STARTED: "بدأ ربط قناة",
  CHANNEL_UNLINKED: "فصل قناة",
  INBOX_CONVERTED: "حوّل رسالة واردة إلى سجل",
  BOT_ENABLED: "شغّل بوت المكتب",
  BOT_DISABLED: "أوقف بوت المكتب",
  COOPERATION_REQUEST_CREATED: "أرسل طلب تعاون",
  COOPERATION_REQUEST_ACCEPTED: "قبل طلب تعاون",
  COOPERATION_REQUEST_REJECTED: "رفض طلب تعاون",
  COOPERATION_REQUEST_REVOKED: "أنهى تعاونًا",
  BANK_SHARING_SCOPE_CREATED: "فعّل مشاركة مع مكتب متعاون",
  BANK_SHARING_SCOPE_REVOKED: "أوقف مشاركة مع مكتب متعاون",
  SHARED_OPPORTUNITY_WRITTEN: "شارك سجلًا مع مكتب متعاون",
  SHARED_OPPORTUNITY_REMOVED: "أزال سجلًا من المشاركة"
});

export const AUDIT_FILTERS = Object.freeze([
  { id: "ALL", label: "الكل" },
  { id: "record", label: "السجلات" },
  { id: "deal", label: "الصفقات" },
  { id: "channel", label: "القنوات" },
  { id: "cooperation", label: "التعاون" }
]);

const DOC_STATUS_TEXT = Object.freeze({ MISSING: "ناقص", RECEIVED: "موجود", REVIEWED: "تمت المراجعة", NOT_REQUIRED: "غير مطلوب", REMOVED: "حُذف" });
const CHANNEL_NAME = Object.freeze({ whatsapp: "واتساب", telegram: "تيليجرام" });

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "")); } catch (_) { return fallback; }
}

function groupOf(action, entityType) {
  if (/^(COOPERATION_|BANK_SHARING_|SHARED_OPPORTUNITY_)/.test(action)) return "cooperation";
  if (entityType === "journey" || entityType === "deal" || action.startsWith("DEAL_")) return "deal";
  if (entityType === "channel" || entityType === "inbox" || action.startsWith("CHANNEL_") || action.startsWith("INBOX_")) return "channel";
  return "record";
}

/** One audit document → { id, group, text, detail, actor, at, route }. */
export function auditEntryView(entry = {}, { memberNames = {}, recordTitles = {} } = {}) {
  const action = String(entry.action || "").toUpperCase();
  const entityType = String(entry.entityType || "");
  const entityId = String(entry.entityId || "");
  const details = parseJson(entry.detailsJson, {}) || {};
  const group = groupOf(action, entityType);
  const actorUid = String(entry.actorUid || "");
  const actor = entry.createdBySystem === true && !actorUid ? "النظام" : memberNames[actorUid] || (actorUid ? "عضو في المكتب" : "النظام");
  const detail = [];
  if (entityType === "record") detail.push(recordTitles[entityId] || [details.propertyType, details.district].filter(Boolean).join(" · "));
  if (entityType === "channel") detail.push(CHANNEL_NAME[entityId] || CHANNEL_NAME[details.channel] || "");
  if (action === "DEAL_CLOSED") detail.push(details.result === "WON" ? "تمت الصفقة" : details.result === "LOST" ? "أُغلقت دون صفقة" : "");
  if (action === "DEAL_DOCUMENT_UPDATED" && details.label) detail.push(`${details.label}${DOC_STATUS_TEXT[details.status] ? ` — ${DOC_STATUS_TEXT[details.status]}` : ""}`);
  if (action === "RECORD_MEDIA_UPDATED" && Number.isFinite(Number(details.count))) detail.push(`عدد الصور الآن: ${Number(details.count)}`);
  if ((action === "RECORD_PAUSED" || action === "RECORD_ARCHIVED" || action === "RECORD_DELETED") && details.reason) detail.push(String(details.reason).slice(0, 120));
  const route = entityType === "record" && entityId ? `record/${entityId}`
    : (entityType === "journey" || entityType === "deal") && entityId ? `journey/${entityId}`
      : entityType === "channel" ? "settings/channels"
        : entityType === "inbox" ? (details.recordId ? `record/${details.recordId}` : "inbox")
          : group === "cooperation" ? "community" : "";
  return {
    id: String(entry.id || ""), action, group, actor,
    text: ACTION_TEXT[action] || "إجراء مسجَّل في النظام",
    detail: detail.filter(Boolean).join(" · "),
    at: toDate(entry.createdAt), route
  };
}

export function auditViews(entries = [], context = {}) {
  return entries.map((entry) => auditEntryView(entry, context))
    .sort((a, b) => (b.at?.getTime() || 0) - (a.at?.getTime() || 0));
}

export function filterAudit(views = [], group = "ALL") {
  return group === "ALL" ? views : views.filter((view) => view.group === group);
}
