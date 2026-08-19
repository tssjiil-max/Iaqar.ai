/**
 * Apply persisted broker action checkmarks to action buttons in a container.
 */

import {
  isBrokerActionDone,
  resolveCompletedBrokerActionKeys
} from "./broker-action-progress-domain.js";

export function applyBrokerActionMarks(root, record = {}) {
  if (!root) return;
  const done = resolveCompletedBrokerActionKeys(record);
  root.querySelectorAll("[data-broker-action]").forEach((node) => {
    const key = String(node.getAttribute("data-broker-action") || "").trim();
    const active = key && done.has(key);
    node.classList.toggle("is-action-done", Boolean(active));
    if (node.classList.contains("iaqar-contact-outcome-btn") || node.classList.contains("bank-contact-outcome-btn")) {
      node.classList.toggle("is-selected", Boolean(active));
    }
    node.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

export function markBrokerActionDoneLocally(record = {}, actionKey = "", atIso = "") {
  const key = String(actionKey || "").trim();
  if (!key) return record;
  const progress = record.brokerActionProgress && typeof record.brokerActionProgress === "object"
    ? { ...record.brokerActionProgress }
    : {};
  progress[key] = String(atIso || new Date().toISOString());
  return { ...record, brokerActionProgress: progress };
}

export function markFollowUpProgressLocally(record = {}, patch = {}) {
  const follow = record.followUp && typeof record.followUp === "object"
    ? { ...record.followUp }
    : {};
  if (patch.confirmationOutcome) follow.confirmationOutcome = patch.confirmationOutcome;
  if (patch.whatsappRole) {
    const roles = new Set(Array.isArray(follow.whatsappRolesOpened) ? follow.whatsappRolesOpened : []);
    roles.add(String(patch.whatsappRole).toLowerCase());
    follow.whatsappRolesOpened = [...roles];
  }
  return { ...record, followUp: follow };
}

export { isBrokerActionDone };
