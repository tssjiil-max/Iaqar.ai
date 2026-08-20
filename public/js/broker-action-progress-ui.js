/**
 * Apply persisted broker action checkmarks to action buttons in a container.
 */

import {
  isBrokerActionDone,
  mergeBrokerActionProgress,
  resolveCompletedBrokerActionKeys,
  resolveSavedContactOutcome,
  contactOutcomeActionKey
} from "./broker-action-progress-domain.js";

export function applyBrokerActionMarks(root, record = {}) {
  if (!root) return;
  const done = resolveCompletedBrokerActionKeys(record);
  const savedOutcome = resolveSavedContactOutcome(record);
  const pendingNode = root.querySelector(".bank-contact-outcome-btn.is-selected, .iaqar-contact-outcome-btn.is-selected");
  const pendingOutcome = String(
    pendingNode?.getAttribute("data-contact-outcome")
      || pendingNode?.getAttribute("data-outcome")
      || ""
  ).toUpperCase();

  root.querySelectorAll("[data-broker-action]").forEach((node) => {
    const key = String(node.getAttribute("data-broker-action") || "").trim();
    const isContactOutcomeBtn = node.classList.contains("bank-contact-outcome-btn")
      || node.classList.contains("iaqar-contact-outcome-btn");
    let active = key && done.has(key);

    if (isContactOutcomeBtn) {
      const btnOutcome = String(
        node.getAttribute("data-contact-outcome") || node.getAttribute("data-outcome") || ""
      ).toUpperCase();
      const showSavedCheck = Boolean(savedOutcome)
        && btnOutcome === savedOutcome
        && (!pendingOutcome || pendingOutcome === savedOutcome);
      active = showSavedCheck;
      node.classList.toggle("is-selected", pendingOutcome
        ? btnOutcome === pendingOutcome
        : btnOutcome === savedOutcome);
    }

    node.classList.toggle("is-action-done", Boolean(active));
    node.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

export function markBrokerActionDoneLocally(record = {}, actionKey = "", atIso = "") {
  const key = String(actionKey || "").trim();
  if (!key) return record;
  return {
    ...record,
    brokerActionProgress: mergeBrokerActionProgress(record, key, atIso)
  };
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
