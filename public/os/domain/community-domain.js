/**
 * «مجتمع الوسطاء» — cooperation between offices, shown in the new UI.
 * Pure rules over cooperationRequests rows; reuses the old app's cooperation domain
 * so both UIs always agree on stages, turns and available actions.
 */

import { buildCooperationDailyTaskView, workflowActionFromButton } from "../../js/cooperation-workflow-domain.js";

export const COMMUNITY_TABS = Object.freeze([
  { id: "needs", label: "تحتاج ردك" },
  { id: "waiting", label: "بانتظار الآخرين" },
  { id: "done", label: "المنتهية" }
]);

/** Buttons the new UI runs itself through /cooperation/workflow (no extra input needed). */
const DIRECT_ACTIONS = new Set([
  "accept_cooperation", "reject_cooperation", "follow_customer", "customer_interested",
  "customer_not_suitable", "property_available", "property_unavailable", "confirm_completion"
]);

export function directActionFor(button) {
  if (!button || !DIRECT_ACTIONS.has(button.id)) return null;
  const action = workflowActionFromButton(button.id);
  return action ? { id: button.id, label: button.label, action } : null;
}

function millis(value) {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : 0;
}

/** Rows (any order, may repeat) → views split by tab, newest first. */
export function communityViews(rows, officeId, now = new Date()) {
  const seen = new Map();
  for (const row of rows || []) if (row && row.id) seen.set(row.id, row);
  const views = [...seen.values()]
    .map((row) => buildCooperationDailyTaskView({ ...row, id: row.id }, { officeId, now }))
    .sort((a, b) => millis(b.livingUpdatedAt) - millis(a.livingUpdatedAt));
  const tabs = { needs: [], waiting: [], done: [] };
  for (const view of views) {
    if (view.archived) tabs.done.push(view);
    else if (view.requiresAction) tabs.needs.push(view);
    else tabs.waiting.push(view);
  }
  return tabs;
}

/** What a card offers: direct buttons it can run here, or a hand-off to the old screen. */
export function cardActions(view) {
  const primary = directActionFor(view.primaryAction);
  const secondary = (view.secondaryActions || []).map(directActionFor).filter(Boolean);
  const needsLegacy = Boolean(view.requiresAction && !primary);
  return { primary, secondary, needsLegacy };
}
