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

function attachPhotos(view, token) {
  const property = view?.property && typeof view.property === "object" ? { ...view.property } : {};
  const httpsPhotos = Array.isArray(property.photos)
    ? property.photos.filter((url) => /^https:\/\//i.test(String(url || "")))
    : [];
  const count = Number(property.photoCount || 0);
  const fromSession = [];
  for (let index = 0; index < count; index += 1) {
    fromSession.push(`${workerBase()}/party/sessions/${encodeURIComponent(token)}/photos/${index}`);
  }
  return {
    ...view,
    property: {
      ...property,
      photos: [...httpsPhotos, ...fromSession]
    }
  };
}

function renderView(view, token) {
  const next = attachPhotos(view, token);
  const root = mount(buildPartyShellHtml(next));
  bindActions(root, token);
  return root;
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
    const fresh = await loadSession(token);
    renderView(fresh, token);
  } catch (error) {
    button.disabled = false;
    showStatus(error.message || "تعذر تسجيل الرد.", true);
  }
}

async function submitBundle(token, bundle, button) {
  button.disabled = true;
  showStatus("");
  try {
    const response = await fetch(`${workerBase()}/party/sessions/${encodeURIComponent(token)}/bundle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bundle })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok || !payload.view) {
      throw new Error(payload.message || "تعذر تسجيل الرد.");
    }
    renderView(payload.view, token);
  } catch (error) {
    button.disabled = false;
    showStatus(error.message || "تعذر تسجيل الرد.", true);
  }
}

function collectBundleFromForm(root) {
  const bundle = {};
  root.querySelectorAll("[data-bundle-choice]").forEach((button) => {
    if (button.classList.contains("is-selected")) {
      bundle[button.getAttribute("data-bundle-choice")] = button.getAttribute("data-bundle-value");
    }
  });
  root.querySelectorAll("[data-bundle-field]").forEach((input) => {
    if (!input.checked) return;
    const field = input.getAttribute("data-bundle-field");
    if (!field) return;
    if (!Array.isArray(bundle[field])) bundle[field] = [];
    bundle[field].push(input.value);
  });
  root.querySelectorAll("[data-bundle-bool]").forEach((input) => {
    const field = input.getAttribute("data-bundle-bool");
    if (field) bundle[field] = Boolean(input.checked);
  });
  return bundle;
}

function stepVisible(stepEl, bundle = {}) {
  const whenRaw = stepEl.getAttribute("data-bundle-when");
  if (!whenRaw || whenRaw === "null") return true;
  try {
    const when = JSON.parse(whenRaw);
    if (!when || typeof when !== "object") return true;
    return Object.entries(when).every(([key, value]) => String(bundle[key] || "") === String(value));
  } catch {
    return true;
  }
}

function refreshBundleSteps(root) {
  const bundle = collectBundleFromForm(root);
  root.querySelectorAll("[data-bundle-step]").forEach((stepEl) => {
    stepEl.hidden = !stepVisible(stepEl, bundle);
  });
}

function bindCoordinationForm(root, token) {
  const form = root.querySelector("[data-party-coordination-form]");
  if (!form) return;
  form.querySelectorAll("[data-bundle-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const field = button.getAttribute("data-bundle-choice");
      form.querySelectorAll(`[data-bundle-choice="${field}"]`).forEach((node) => {
        node.classList.remove("is-selected");
      });
      button.classList.add("is-selected");
      refreshBundleSteps(form);
    });
  });
  form.querySelectorAll("[data-bundle-field], [data-bundle-bool]").forEach((input) => {
    input.addEventListener("change", () => refreshBundleSteps(form));
  });
  const submit = form.querySelector("[data-party-bundle-submit]");
  if (submit) {
    submit.addEventListener("click", () => {
      if (submit.disabled) return;
      const bundle = collectBundleFromForm(form);
      void submitBundle(token, bundle, submit);
    });
  }
  refreshBundleSteps(form);
}

function bindActions(root, token) {
  bindCoordinationForm(root, token);
  root.querySelectorAll("[data-party-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      void submitReply(token, button.getAttribute("data-party-action"), button);
    });
  });
  root.querySelectorAll("[data-party-slot]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      void submitAppointment(token, "select", button.getAttribute("data-party-slot"), button);
    });
  });
  root.querySelectorAll("[data-party-appointment]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      void submitAppointment(token, button.getAttribute("data-party-appointment"), "", button);
    });
  });
}

async function submitAppointment(token, action, slot, button) {
  button.disabled = true;
  showStatus("");
  try {
    const response = await fetch(`${workerBase()}/party/sessions/${encodeURIComponent(token)}/appointment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ action, slot })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 409 || payload.error === "slot_taken") {
      const fresh = payload.view || await loadSession(token);
      renderView({
        ...fresh,
        appointment: {
          ...(fresh.appointment || {}),
          takenMessage: payload.message || "هذا الموعد لم يعد متاحًا، اختر موعدًا آخر."
        }
      }, token);
      return;
    }
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "تعذر حفظ الموعد.");
    }
    const fresh = await loadSession(token);
    renderView(fresh, token);
  } catch (error) {
    button.disabled = false;
    showStatus(error.message || "تعذر حفظ الموعد.", true);
  }
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
    renderView(view, token);
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
