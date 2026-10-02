/**
 * «التعاون بين الوسطاء» — cooperation with other offices, shown in the new UI.
 * Pure rules over cooperationRequests rows; reuses the old app's cooperation domain
 * so both UIs always agree on stages, turns and available actions. Three states only:
 * نشط · بانتظار رد · السجل.
 */

import { buildCooperationDailyTaskView, workflowActionFromButton } from "../../js/cooperation-workflow-domain.js";
import { cooperationBrokerCount, isCooperationActive } from "../../js/cooperation-brokers-domain.js";

export const COMMUNITY_TABS = Object.freeze([
  { id: "active", label: "نشط" },
  { id: "waiting", label: "بانتظار رد" },
  { id: "history", label: "السجل" }
]);

/**
 * Buttons the new UI runs itself through /cooperation/workflow: asking, accepting, declining.
 * Everything after acceptance (follow the client/owner, viewing, agreement, closing) is owned by the
 * negotiation session / match / deal, so those steps are opened there — never faked here.
 */
const DIRECT_ACTIONS = new Set(["request_cooperation", "accept_cooperation", "reject_cooperation"]);

export function directActionFor(button) {
  if (!button || !DIRECT_ACTIONS.has(button.id)) return null;
  const action = workflowActionFromButton(button.id);
  return action ? { id: button.id, label: button.label, action } : null;
}

function millis(value) {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : 0;
}

/** Rows (any order, may repeat) → views split by state, needing-action first then newest. */
export function communityViews(rows, officeId, now = new Date()) {
  const seen = new Map();
  for (const row of rows || []) if (row && row.id) seen.set(row.id, row);
  const views = [...seen.values()]
    .map((row) => ({ ...buildCooperationDailyTaskView({ ...row, id: row.id }, { officeId, now }), record: row, brokerCount: cooperationBrokerCount(row), active: isCooperationActive(row) }))
    .sort((a, b) => Number(b.requiresAction) - Number(a.requiresAction) || millis(b.livingUpdatedAt) - millis(a.livingUpdatedAt));
  const tabs = { active: [], waiting: [], history: [] };
  for (const view of views) {
    if (view.archived) tabs.history.push(view);
    else if (view.active) tabs.active.push(view);
    else tabs.waiting.push(view);
  }
  return tabs;
}

/** One line for the office card: «2 نشط · 1 بانتظار الرد», empty when there is nothing. */
export function communitySummary(tabs) {
  const bits = [];
  if (tabs.active.length) bits.push(`${tabs.active.length} نشط`);
  if (tabs.waiting.length) bits.push(`${tabs.waiting.length} بانتظار الرد`);
  return bits.join(" · ");
}

/** Short «who acts now» line: «مطلوب منك الآن: …» or the waiting state. */
export function turnLine(view) {
  if (!view.requiresAction) return view.statusLabel || view.yourTurnLine || "";
  const accept = view.primaryAction?.id === "accept_cooperation";
  return `مطلوب منك الآن: ${accept ? "قبول التعاون أو غير مناسب" : (view.yourTurnLine || "").replace(/[.。]$/, "")}`;
}

/** What a card offers: direct buttons it can run here, or the hand-off to where the work lives. */
export function cardActions(view) {
  const primary = directActionFor(view.primaryAction);
  const secondary = (view.secondaryActions || []).map(directActionFor).filter(Boolean);
  const followUp = Boolean(view.active && view.requiresAction && !primary);
  return { primary, secondary, followUp };
}
