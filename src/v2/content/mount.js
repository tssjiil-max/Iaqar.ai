/**
 * Mounts the content surface into #contentV2 under the existing App Shell.
 * Does not create a V2 header, V2 nav, or a separate app identity.
 */

import { isContentResetEnabled } from "./flag.js";
import { buildContentV2Html, currentContentView } from "./domain.js";
import { setupOfficeCardCollapse, teardownOfficeCardCollapse } from "./office-collapse.js";
import { mountOpportunityDetailsContentV2, unmountOpportunityDetailsContentV2 } from "./opportunity-details/controller.js";
import { mountDailyTasksContentV2, unmountDailyTasksContentV2 } from "./daily-tasks/controller.js";

function $(id) {
  return document.getElementById(id);
}

function applyIsolation(enabled) {
  document.documentElement.classList.toggle("is-content-v2", enabled);
}

function setLegacyListVisible(visible) {
  const legacy = document.querySelector("[data-legacy-content]");
  const host = $("contentV2");
  if (legacy) {
    legacy.hidden = !visible;
    legacy.setAttribute("aria-hidden", visible ? "false" : "true");
  }
  if (host) {
    host.hidden = visible;
    host.setAttribute("aria-hidden", visible ? "true" : "false");
  }
}

function render(host) {
  const view = currentContentView(window.location, window.IAQAR?.homeTabs?.getState?.());
  host.dataset.contentView = view.name;
  if (view.id) host.dataset.opportunityId = view.id;
  else delete host.dataset.opportunityId;

  if (view.name === "opportunity" && view.id) {
    unmountDailyTasksContentV2();
    setLegacyListVisible(false);
    host.classList.add("is-details");
    setupOfficeCardCollapse();
    void mountOpportunityDetailsContentV2(host, { opportunityId: view.id });
    return;
  }

  unmountOpportunityDetailsContentV2();
  teardownOfficeCardCollapse();
  host.classList.remove("is-details");

  if (view.name === "opportunities") {
    unmountDailyTasksContentV2();
    host.innerHTML = "";
    setLegacyListVisible(true);
    return;
  }

  if (view.name === "tasks") {
    setLegacyListVisible(false);
    mountDailyTasksContentV2(host);
    return;
  }

  unmountDailyTasksContentV2();
  host.innerHTML = buildContentV2Html(view);
  setLegacyListVisible(false);
}

function boot() {
  const enabled = isContentResetEnabled();
  applyIsolation(enabled);
  if (!enabled) return;

  const host = $("contentV2");
  if (!host) return;
  const sync = () => render(host);
  sync();
  window.addEventListener("hashchange", sync);
  window.addEventListener("iaqar:navigation-changed", sync);
  window.addEventListener("iaqar:firebase-ready", sync);
  window.addEventListener("iaqar:firebase-status", sync);

  window.IAQAR = window.IAQAR || {};
  window.IAQAR.contentV2 = Object.freeze({
    enabled: true,
    currentView: () => currentContentView(window.location, window.IAQAR?.homeTabs?.getState?.()),
    render: sync
  });
}

export function mountContentV2(root, view) {
  if (!root || !view) return;
  if (view.name === "opportunity" && (view.id || view.opportunityId)) {
    unmountDailyTasksContentV2();
    root.classList.add("is-details");
    setupOfficeCardCollapse();
    void mountOpportunityDetailsContentV2(root, { opportunityId: view.id || view.opportunityId });
    return;
  }
  unmountOpportunityDetailsContentV2();
  teardownOfficeCardCollapse();
  root.classList.remove("is-details");
  if (view.name === "tasks") {
    mountDailyTasksContentV2(root);
    return;
  }
  unmountDailyTasksContentV2();
  root.innerHTML = buildContentV2Html(view);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}
