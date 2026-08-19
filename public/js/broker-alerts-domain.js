/**
 * In-app broker alert scan — no outbound WhatsApp; UI-only signals for Operations Center.
 */

import { isTaskArchived, isTaskOverdue, isViewingSoon, parseTaskInstant } from "./daily-tasks-domain.js";
import { buildViewingConfirmationView } from "./broker-match-ux-domain.js";

const VIEWING_CONFIRM_ALERT_HOURS = 3;

function isOpenMatchOrDeal(item = {}) {
  if (!item || isTaskArchived(item)) return false;
  const recordType = String(item.recordType || "").toLowerCase();
  if (!["match", "deal"].includes(recordType)) return false;
  const status = String(item.status || "").toLowerCase();
  return !["completed", "closed", "lost"].includes(status);
}

export function scanViewingConfirmationAlerts(items = [], now = new Date()) {
  return items.filter((item) => {
    if (!isOpenMatchOrDeal(item)) return false;
    const viewingAt = parseTaskInstant(item.viewingAt || item.appointmentAt);
    if (!viewingAt) return false;
    const diffMs = viewingAt.getTime() - now.getTime();
    if (diffMs <= 0 || diffMs > VIEWING_CONFIRM_ALERT_HOURS * 3600000) return false;
    const view = buildViewingConfirmationView(item, now);
    return !view.bothConfirmed;
  }).map((item) => ({
    id: `alert-viewing-${item.id}`,
    recordType: "broker_alert",
    alertKind: "viewing_unconfirmed",
    priority: 0,
    icon: "i-calendar",
    title: "معاينة قريبة بدون تأكيد",
    subtitle: item.title || item.subtitle || "مطابقة تحتاج تأكيد الطرفين",
    opsStatusLine: buildViewingConfirmationView(item, now).summaryLine,
    targetRecordType: item.recordType,
    targetRecordId: item.recordId || item.id,
    viewingAt: item.viewingAt || item.appointmentAt
  }));
}

export function scanAtRiskDealAlerts(items = [], now = new Date()) {
  return items.filter((item) => {
    if (String(item.recordType || "").toLowerCase() !== "deal") return false;
    if (!isOpenMatchOrDeal(item)) return false;
    const healthKey = String(item.healthKey || "").toLowerCase();
    if (healthKey === "at_risk" || healthKey === "needs_intervention") return true;
    if (isTaskOverdue(item, now) && ["negotiation", "agreement", "closing"].includes(String(item.workflowStage || ""))) {
      return true;
    }
    return false;
  }).map((item) => ({
    id: `alert-deal-${item.id}`,
    recordType: "broker_alert",
    alertKind: "deal_at_risk",
    priority: 0,
    icon: "i-alert",
    title: "صفقة تحتاج تدخل",
    subtitle: item.subtitle || "صفقة معرضة للفشل أو متأخرة",
    opsStatusLine: item.opsStatusLine || item.nextAction || "متابعة عاجلة",
    targetRecordType: "deal",
    targetRecordId: item.recordId || item.id
  }));
}

export function scanOverdueFollowUpAlerts(items = [], now = new Date()) {
  return items.filter((item) => {
    if (!isOpenMatchOrDeal(item)) return false;
    return isTaskOverdue(item, now);
  }).map((item) => ({
    id: `alert-overdue-${item.id}`,
    recordType: "broker_alert",
    alertKind: "overdue_followup",
    priority: 0,
    icon: "i-clock",
    title: "متابعة متأخرة",
    subtitle: item.title || item.subtitle || "",
    opsStatusLine: item.opsStatusLine || "تجاوز موعد المتابعة",
    targetRecordType: item.recordType,
    targetRecordId: item.recordId || item.id
  }));
}

export function scanBrokerAlerts(items = [], now = new Date()) {
  const seen = new Set();
  const alerts = [
    ...scanViewingConfirmationAlerts(items, now),
    ...scanAtRiskDealAlerts(items, now)
  ];
  return alerts.filter((alert) => {
    const key = `${alert.alertKind}:${alert.targetRecordId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isViewingSoonUnconfirmed(item = {}, now = new Date()) {
  if (!isViewingSoon(item, now)) return false;
  const view = buildViewingConfirmationView(item, now);
  return !view.bothConfirmed;
}
