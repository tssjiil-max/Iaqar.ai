/**
 * Party-mode entry. Runs only when ?cv2Party= is present.
 * Does not render the broker app or Access Gate.
 */

import {
  isOpaquePartyToken,
  PARTY_INVALID_COPY,
  readPartyTokenFromSearch
} from "./party-session-domain.js";
import {
  buildPartyErrorHtml,
  buildPartyLoadingHtml,
  buildPartyShellHtml
} from "./party-shell-ui.js";

function workerBase() {
  if (window.IAQAR && typeof window.IAQAR.resolveWorkerBase === "function") {
    return window.IAQAR.resolveWorkerBase();
  }
  try {
    const host = String(window.location.hostname || "").toLowerCase();
    if (host.includes("iaqar-ai-staging") || host.includes("--staging") || host.startsWith("staging.")) {
      return "https://iaqar-intake-staging.iaqar-ai.workers.dev";
    }
  } catch {
    /* ignore */
  }
  return "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
}

function mount(html) {
  let root = document.getElementById("partyRoot");
  if (!root) {
    root = document.createElement("div");
    root.id = "partyRoot";
    document.body.appendChild(root);
  }
  root.innerHTML = html;
  return root;
}

function resolvePartyToken(locationLike = window.location) {
  const fromSearch = readPartyTokenFromSearch(locationLike.search || "");
  if (fromSearch) return fromSearch;
  if (document.documentElement.dataset.partyMode === "1") {
    const fromWindow = String(window.__IAQAR_PARTY_TOKEN__ || "").trim();
    if (fromWindow) return fromWindow;
    try {
      return String(sessionStorage.getItem("iaqar.partyToken") || "").trim();
    } catch {
      return "";
    }
  }
  return "";
}

function partyDiag(event, extra) {
  if (typeof window.__IAQAR_PARTY_DIAG__ === "function") {
    window.__IAQAR_PARTY_DIAG__(event, extra || {});
  }
}

function showStatus(message, isError) {
  const node = document.getElementById("partyStatus");
  if (!node) return;
  node.hidden = !message;
  node.textContent = message || "";
  node.classList.toggle("is-error", Boolean(isError));
}

async function loadSession(token) {
  const response = await fetch(`${workerBase()}/party/sessions/${encodeURIComponent(token)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok || !payload.view) {
    throw new Error(payload.message || PARTY_INVALID_COPY);
  }
  return payload.view;
}

async function submitReply(token, action, button) {
  button.disabled = true;
  showStatus("");
  try {
    const response = await fetch(`${workerBase()}/party/sessions/${encodeURIComponent(token)}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok || !payload.view) {
      throw new Error(payload.message || "تعذر تسجيل الرد.");
    }
    mount(buildPartyShellHtml(payload.view));
  } catch (error) {
    button.disabled = false;
    showStatus(error.message || "تعذر تسجيل الرد.", true);
  }
}

function bindActions(root, token) {
  root.querySelectorAll("[data-party-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      void submitReply(token, button.getAttribute("data-party-action"), button);
    });
  });
}

export async function bootPartyEntry(locationLike = window.location) {
  const token = resolvePartyToken(locationLike);
  if (!token) return false;
  partyDiag("PARTY_BOOTSTRAP_STARTED", { opaque: isOpaquePartyToken(token) });
  document.documentElement.dataset.partyMode = "1";
  document.documentElement.classList.add("is-party-mode");
  if (!isOpaquePartyToken(token)) {
    mount(buildPartyErrorHtml(PARTY_INVALID_COPY));
    partyDiag("PARTY_VIEW_RENDERED", { invalid: true });
    return true;
  }
  const root = mount(buildPartyLoadingHtml());
  try {
    const view = await loadSession(token);
    partyDiag("PARTY_SESSION_RESOLVED", { party: view.party || "" });
    mount(buildPartyShellHtml(view));
    bindActions(document.getElementById("partyRoot") || root, token);
    partyDiag("PARTY_VIEW_RENDERED", { party: view.party || "" });
  } catch {
    mount(buildPartyErrorHtml(PARTY_INVALID_COPY));
    partyDiag("PARTY_VIEW_RENDERED", { invalid: true });
  }
  return true;
}

if (typeof document !== "undefined" && document.documentElement.dataset.partyMode === "1") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void bootPartyEntry();
    }, { once: true });
  } else {
    void bootPartyEntry();
  }
}
