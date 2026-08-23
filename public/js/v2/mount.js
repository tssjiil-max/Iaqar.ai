/**
 * Mounts the empty content surface into #contentV2 under the existing App Shell.
 * Does not create a V2 header, V2 nav, or a separate app identity.
 */

import { isContentResetEnabled } from "./flag.js";
import { buildContentV2Html, currentContentView } from "./domain.js";

function $(id) {
  return document.getElementById(id);
}

function applyIsolation(enabled) {
  document.documentElement.classList.toggle("is-content-v2", enabled);
  const legacy = document.querySelector("[data-legacy-content]");
  if (legacy) {
    legacy.hidden = enabled;
    legacy.setAttribute("aria-hidden", enabled ? "true" : "false");
  }
  const host = $("contentV2");
  if (host) {
    host.hidden = !enabled;
    host.setAttribute("aria-hidden", enabled ? "false" : "true");
  }
}

function render(host) {
  const view = currentContentView(window.location, window.IAQAR?.homeTabs?.getState?.());
  host.innerHTML = buildContentV2Html(view);
  host.dataset.contentView = view.name;
  if (view.id) host.dataset.opportunityId = view.id;
  else delete host.dataset.opportunityId;
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

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}
