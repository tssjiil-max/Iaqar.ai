/**
 * Broker-only match/deal UX fields — negotiation and viewing confirmation.
 * Stored in Firestore `brokerUx` map; does not change Worker workflow stages.
 */

import { parseTaskInstant } from "./daily-tasks-domain.js";

export const NEGOTIATION_STATUSES = Object.freeze({
  in_progress: { label: "جاري التفاوض", cssClass: "is-medium" },
  agreed: { label: "اتفقوا", cssClass: "is-very-high" },
  failed: { label: "فشل", cssClass: "is-low" }
});

const VIEWING_ALERT_HOURS = 3;

function normalizeBrokerUx(record = {}) {
  const raw = record.brokerUx && typeof record.brokerUx === "object" ? record.brokerUx : {};
  return { ...raw };
}

export function defaultBrokerUx() {
  return {
    ownerPrice: null,
    clientPrice: null,
    lastOffer: null,
    negotiationStatus: "in_progress",
    negotiationNote: "",
    clientViewingConfirmed: false,
    ownerViewingConfirmed: false,
    viewingConfirmedAt: null
  };
}

export function mergeBrokerUx(record = {}, patch = {}) {
  const current = { ...defaultBrokerUx(), ...normalizeBrokerUx(record) };
  return { ...current, ...patch };
}

export function buildNegotiationPanelView(record = {}) {
  const ux = mergeBrokerUx(record);
  const statusMeta = NEGOTIATION_STATUSES[ux.negotiationStatus] || NEGOTIATION_STATUSES.in_progress;
  return {
    ownerPrice: ux.ownerPrice,
    clientPrice: ux.clientPrice,
    lastOffer: ux.lastOffer,
    negotiationStatus: ux.negotiationStatus,
    negotiationNote: ux.negotiationNote,
    statusLabel: statusMeta.label,
    statusCssClass: statusMeta.cssClass
  };
}

export function buildViewingConfirmationView(record = {}, now = new Date()) {
  const ux = mergeBrokerUx(record);
  const viewingAt = parseTaskInstant(record.viewingAt || record.appointmentAt);
  const clientOk = ux.clientViewingConfirmed === true;
  const ownerOk = ux.ownerViewingConfirmed === true;
  const bothOk = clientOk && ownerOk;
  let needsAlert = false;
  if (viewingAt && !bothOk) {
    const diffMs = viewingAt.getTime() - now.getTime();
    needsAlert = diffMs > 0 && diffMs <= VIEWING_ALERT_HOURS * 3600000;
  }
  const lines = [];
  if (viewingAt) {
    lines.push(`عميل ${clientOk ? "✅" : "⏳"} — مالك ${ownerOk ? "✅" : "⏳"}`);
    if (needsAlert) lines.push("تنبيه: موعد قريب بدون تأكيد كامل");
  }
  return {
    clientViewingConfirmed: clientOk,
    ownerViewingConfirmed: ownerOk,
    bothConfirmed: bothOk,
    needsAlert,
    summaryLine: lines[0] || "",
    alertLine: needsAlert ? lines[1] || "" : ""
  };
}

export function viewingConfirmationOpsLine(record = {}) {
  const view = buildViewingConfirmationView(record);
  if (!view.summaryLine) return "";
  return view.needsAlert ? `${view.summaryLine} — ${view.alertLine}` : view.summaryLine;
}

export function negotiationOpsLine(record = {}) {
  const panel = buildNegotiationPanelView(record);
  const parts = [];
  if (panel.clientPrice) parts.push(`عميل: ${Number(panel.clientPrice).toLocaleString("ar-SA")}`);
  if (panel.ownerPrice) parts.push(`مالك: ${Number(panel.ownerPrice).toLocaleString("ar-SA")}`);
  if (panel.lastOffer) parts.push(`آخر عرض: ${Number(panel.lastOffer).toLocaleString("ar-SA")}`);
  if (parts.length) return `${panel.statusLabel} — ${parts.join(" · ")}`;
  return panel.statusLabel;
}

export function parseBrokerUxPatch(form = {}) {
  const patch = {};
  const ownerPrice = Number(String(form.ownerPrice ?? "").replace(/\D/g, ""));
  const clientPrice = Number(String(form.clientPrice ?? "").replace(/\D/g, ""));
  const lastOffer = Number(String(form.lastOffer ?? "").replace(/\D/g, ""));
  if (ownerPrice > 0) patch.ownerPrice = ownerPrice;
  if (clientPrice > 0) patch.clientPrice = clientPrice;
  if (lastOffer > 0) patch.lastOffer = lastOffer;
  if (form.negotiationStatus && NEGOTIATION_STATUSES[form.negotiationStatus]) {
    patch.negotiationStatus = form.negotiationStatus;
  }
  if (typeof form.negotiationNote === "string") patch.negotiationNote = form.negotiationNote.trim().slice(0, 500);
  if (form.clientViewingConfirmed === true || form.clientViewingConfirmed === false) {
    patch.clientViewingConfirmed = form.clientViewingConfirmed === true;
  }
  if (form.ownerViewingConfirmed === true || form.ownerViewingConfirmed === false) {
    patch.ownerViewingConfirmed = form.ownerViewingConfirmed === true;
  }
  if (patch.clientViewingConfirmed && patch.ownerViewingConfirmed) {
    patch.viewingConfirmedAt = new Date().toISOString();
  }
  return patch;
}
