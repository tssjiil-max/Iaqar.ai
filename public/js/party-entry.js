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

const LIVE_POLL_MS = 3000;
const liveState = { token: "", stateVersion: "", timer: null, busy: false, retry: null };

function captureLiveInputs() {
  const values = {};
  document.querySelectorAll("[data-party-live-condition], [data-party-agreement-field], [data-party-agreement-value], [data-party-reply-text]").forEach((field) => {
    const name = [...field.attributes].map((attr) => attr.name).find((attr) => attr.startsWith("data-party-"));
    if (!name) return;
    const value = field.getAttribute(name);
    values[value ? `${name}="${value}"` : name] = field.value;
  });
  return values;
}

function restoreLiveInputs(values = {}) {
  for (const [key, value] of Object.entries(values)) {
    const field = document.querySelector(`[${key}]`);
    if (field && value != null) field.value = value;
  }
}

function renderView(view, token) {
  const inputs = captureLiveInputs();
  const next = attachPhotos(view, token);
  const root = mount(buildPartyShellHtml(next));
  restoreLiveInputs(inputs);
  liveState.stateVersion = String(view?.negotiation?.stateVersion || "");
  bindActions(root, token);
  bindLiveNegotiation(root, token);
  return root;
}

function newClientEventId() {
  try { return globalThis.crypto?.randomUUID?.() || `ce_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`; } catch { return `ce_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`; }
}

// A party's own choice / agreement proposal: a real event from this party's link.
async function submitLiveEvent(token, body, button) {
  if (button) button.disabled = true;
  showStatus("");
  // Retrying the same choice after a failure replays the same event id, so the
  // Worker completes that event instead of storing a second one.
  const key = JSON.stringify(body);
  const clientEventId = liveState.retry?.key === key ? liveState.retry.id : newClientEventId();
  try {
    let response;
    try {
      response = await fetch(`${workerBase()}/party/sessions/${encodeURIComponent(token)}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ ...body, clientEventId })
      });
    } catch (networkError) {
      liveState.retry = { key, id: clientEventId };
      throw networkError;
    }
    const payload = await response.json().catch(() => ({}));
    if (response.status >= 500) liveState.retry = { key, id: clientEventId };
    if (!response.ok || !payload.ok) throw Object.assign(new Error(payload.message || "تعذر حفظ اختيارك."), { status: response.status });
    liveState.retry = null;
    const fresh = await loadSession(token);
    renderView(fresh, token);
    showStatus("وصل تحديثك للوسيط.");
  } catch (error) {
    if (error.status === 409) {
      const fresh = await loadSession(token).catch(() => null);
      if (fresh) renderView(fresh, token);
    }
    if (button) button.disabled = false;
    showStatus(error.message || "تعذر حفظ اختيارك.", true);
  }
}

function bindLiveNegotiation(root, token) {
  root.querySelectorAll("[data-party-live-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      const choiceId = button.getAttribute("data-party-live-choice");
      const condition = choiceId === "condition" ? String(root.querySelector("[data-party-live-condition]")?.value || "").trim() : "";
      if (choiceId === "condition" && !condition) {
        showStatus("اكتب الشرط أولًا.", true);
        return;
      }
      void submitLiveEvent(token, { choiceId, condition }, button);
    });
  });
  root.querySelectorAll("[data-party-reply]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      const replyToEventId = button.getAttribute("data-party-reply");
      const text = [...root.querySelectorAll("[data-party-reply-text]")].find((input) => input.getAttribute("data-party-reply-text") === replyToEventId);
      void submitLiveEvent(token, {
        replyToEventId,
        responseId: button.getAttribute("data-response-id"),
        responseText: String(text?.value || "").trim()
      }, button);
    });
  });
  root.querySelector("[data-party-agreement-submit]")?.addEventListener("click", (event) => {
    const field = String(root.querySelector("[data-party-agreement-field]")?.value || "").trim();
    const input = root.querySelector("[data-party-agreement-value]");
    const value = String(input?.value || "").trim();
    if (!field || !value) {
      showStatus("اختر البند واكتب القيمة.", true);
      return;
    }
    if (input) input.value = "";
    void submitLiveEvent(token, { agreement: { field, value } }, event.currentTarget);
  });
}

// LINK_OPENED once per page visit (a refresh of the same tab is not a new open).
async function recordLinkOpened(token) {
  let openId = "";
  const key = `iaqar.partyOpen.${String(token).slice(0, 16)}`;
  try {
    openId = sessionStorage.getItem(key) || "";
    if (!openId) {
      openId = newClientEventId();
      sessionStorage.setItem(key, openId);
    }
  } catch {
    openId = newClientEventId();
  }
  await fetch(`${workerBase()}/party/sessions/${encodeURIComponent(token)}/opened`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ openId })
  }).catch(() => {});
}

// Live updates while the link is open: re-render when a new event lands.
function startLivePolling(token) {
  liveState.token = token;
  clearInterval(liveState.timer);
  liveState.timer = setInterval(async () => {
    if (liveState.busy || document.hidden) return;
    liveState.busy = true;
    try {
      const response = await fetch(`${workerBase()}/party/sessions/${encodeURIComponent(token)}/state`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok && String(payload.stateVersion || "") !== liveState.stateVersion) {
        const fresh = await loadSession(token);
        renderView(fresh, token);
      }
    } catch {
      /* next tick retries */
    } finally {
      liveState.busy = false;
    }
  }, LIVE_POLL_MS);
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

async function submitBundle(token, bundle, button, photoFiles = []) {
  button.disabled = true;
  const originalLabel = button.innerHTML;
  button.textContent = "جارٍ إرسال الرد…";
  showStatus("");
  try {
    const postOnce = async (timeoutMs) => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        if (photoFiles.length) {
          const form = new FormData();
          form.append("bundle", JSON.stringify(bundle));
          photoFiles.forEach((file) => form.append("photos", file));
          return await fetch(`${workerBase()}/party/sessions/${encodeURIComponent(token)}/bundle`, {
            method: "POST",
            body: form,
            signal: controller.signal
          });
        }
        return await fetch(`${workerBase()}/party/sessions/${encodeURIComponent(token)}/bundle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bundle }),
          signal: controller.signal
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
    };
    let lastError = null;
    for (const timeoutMs of [15000, 25000]) {
      try {
        const response = await postOnce(timeoutMs);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok || !payload.view) {
          const error = new Error(payload.message || "تعذر تسجيل الرد.");
          error.status = response.status;
          throw error;
        }
        renderView(payload.view, token);
        return;
      } catch (error) {
        lastError = error;
        const retryable = error?.name === "AbortError"
          || !Number.isFinite(Number(error?.status))
          || Number(error.status) >= 500;
        if (!retryable) break;
      }
    }
    const fresh = await loadSession(token).catch(() => null);
    if (fresh?.replied || fresh?.decisionPackage?.submitted) {
      renderView(fresh, token);
      return;
    }
    throw lastError || new Error("تعذر تسجيل الرد.");
  } catch (error) {
    button.disabled = false;
    button.innerHTML = originalLabel;
    const message = error?.name === "AbortError"
      ? "لم يصل تأكيد الحفظ. تحقق من الاتصال ثم اضغط إرسال الرد مرة أخرى."
      : (error.message || "تعذر تسجيل الرد.");
    showStatus(message, true);
  }
}

function collectPackageFromForm(root, party = "client") {
  const bundle = { propertyAvailability: "", viewingAllowed: "" };
  const workflowStep = String(root.getAttribute("data-workflow-step") || "");
  root.querySelectorAll("[data-package-field]").forEach((input) => {
    const field = input.getAttribute("data-package-field");
    if (!field) return;
    if (input.type === "radio") {
      if (!input.checked) return;
      bundle[field] = input.value;
      return;
    }
    if (input.type === "checkbox") {
      if (!input.checked) return;
      if (!Array.isArray(bundle[field])) bundle[field] = [];
      bundle[field].push(input.value);
    }
  });
  root.querySelectorAll("[data-package-bool]").forEach((input) => {
    const field = input.getAttribute("data-package-bool");
    if (field) bundle[field] = Boolean(input.checked);
  });
  root.querySelectorAll("[data-package-number]").forEach((input) => {
    const field = input.getAttribute("data-package-number");
    if (!field) return;
    const value = Number(input.value);
    if (Number.isFinite(value) && value > 0) bundle[field] = value;
  });
  const specValues = {};
  root.querySelectorAll("[data-package-spec]").forEach((input) => {
    const key = input.getAttribute("data-package-spec");
    if (!key) return;
    const raw = input.type === "number" ? Number(input.value) : String(input.value || "").trim();
    if (raw === "" || raw === 0) return;
    specValues[key] = raw;
  });
  const detailValues = {};
  root.querySelectorAll("[data-package-detail]").forEach((input) => {
    const key = input.getAttribute("data-package-detail");
    if (!key) return;
    const raw = input.type === "number" ? Number(input.value) : String(input.value || "").trim();
    if (raw === "" || raw === 0) return;
    detailValues[key] = raw;
  });
  Object.keys(bundle).filter((key) => key.startsWith("detailValue_")).forEach((key) => {
    const value = bundle[key];
    if (value !== "" && value != null) detailValues[key.replace("detailValue_", "")] = value;
    delete bundle[key];
  });
  if (Object.keys(specValues).length) bundle.specValues = specValues;
  if (Object.keys(detailValues).length) bundle.detailValues = detailValues;
  const clientDecision = String(bundle.clientDecision || "");
  if (clientDecision === "interested") {
    bundle.interestStatus = "interested";
    bundle.interestAction = "interest_only";
  } else if (clientDecision === "details") {
    bundle.interestStatus = "interested";
    bundle.interestAction = "details";
  } else if (clientDecision === "viewing") {
    bundle.interestStatus = "interested";
    bundle.interestAction = "viewing";
  } else if (clientDecision === "price") {
    bundle.interestStatus = "not_suitable";
    bundle.rejectionReason = "price";
    const priceChoice = String(bundle.priceNegotiation || "");
    bundle.rejectionDisposition = priceChoice === "final" ? "final" : "negotiable";
    if (priceChoice && priceChoice !== "final") bundle.negotiationPreference = priceChoice;
  } else if (clientDecision === "not_suitable") {
    bundle.interestStatus = "not_suitable";
  }
  delete bundle.clientDecision;
  delete bundle.priceNegotiation;

  const ownerPriceDecision = String(bundle.ownerPriceDecision || "");
  if (ownerPriceDecision === "confirmed") {
    bundle.priceConfirmation = "confirmed";
  } else if (ownerPriceDecision === "accept_discount") {
    bundle.negotiationDecision = "accept";
  } else if (["slight", "fixed", "discuss_at_viewing"].includes(ownerPriceDecision)) {
    bundle.negotiationDecision = "counter";
    bundle.counterPreference = ownerPriceDecision;
  }
  delete bundle.ownerPriceDecision;

  const detailConfirmations = Object.keys(bundle)
    .filter((key) => key.startsWith("detailStatus_") && bundle[key] === "confirm")
    .map((key) => key.replace("detailStatus_", ""));
  const detailNeedsUpdate = Object.keys(bundle)
    .filter((key) => key.startsWith("detailStatus_") && bundle[key] === "needs_update")
    .map((key) => key.replace("detailStatus_", ""));
  Object.keys(bundle).filter((key) => key.startsWith("detailStatus_")).forEach((key) => delete bundle[key]);
  if (detailConfirmations.length) bundle.detailConfirmations = detailConfirmations;
  if (detailNeedsUpdate.length) bundle.detailNeedsUpdate = detailNeedsUpdate;
  if (workflowStep === "client_viewing") {
    bundle.wantsViewing = true;
    bundle.negotiationResponse = "viewing";
  }
  if (bundle.negotiationResponse === "viewing") bundle.wantsViewing = true;
  if (!bundle.propertyAvailability) delete bundle.propertyAvailability;
  if (!bundle.viewingAllowed) delete bundle.viewingAllowed;
  if (party === "owner") {
    // An active offer is available by default. Availability is not a separate
    // administrative confirmation in the negotiation journey.
    if (!bundle.propertyAvailability) bundle.propertyAvailability = "available";
    bundle.locationShare = Boolean(bundle.locationShare);
    if (bundle.mediaAdded) bundle.mediaAdded = true;
  }
  return bundle;
}

function refreshPackageSections(root) {
  const party = root.closest("[data-party-shell]")?.getAttribute("data-party") || "client";
  const bundle = collectPackageFromForm(root, party);
  const clientDecision = String(root.querySelector('[data-package-field="clientDecision"]:checked')?.value || "");
  const notSuitable = clientDecision === "not_suitable";
  const rejectionDisposition = String(bundle.rejectionDisposition || "");
  const rejectionReason = String(bundle.rejectionReason || "");
  const detailSection = root.querySelector("[data-package-section=\"requestedDetailKeys\"]");
  const viewingSection = root.querySelector("[data-package-section=\"viewing\"]");
  const priceNegotiationSection = root.querySelector("[data-package-section=\"priceNegotiation\"]");
  const rejectionSection = root.querySelector("[data-package-section=\"rejection\"]");
  const preference = root.querySelector("[data-package-section=\"negotiationPreference\"]");
  const responseViewing = root.querySelector("[data-package-section=\"responseViewing\"]");
  if (detailSection) detailSection.hidden = clientDecision !== "details";
  if (viewingSection) viewingSection.hidden = clientDecision !== "viewing";
  if (priceNegotiationSection) priceNegotiationSection.hidden = clientDecision !== "price";
  if (rejectionSection) rejectionSection.hidden = !notSuitable;
  if (preference) preference.hidden = !notSuitable
    || rejectionDisposition !== "negotiable" || !rejectionReason;
  if (responseViewing) responseViewing.hidden = bundle.negotiationResponse !== "viewing";
  if (party === "owner") {
    const available = bundle.propertyAvailability !== "not_available";
    const unavailable = bundle.propertyAvailability === "not_available";
    root.querySelectorAll("[data-package-section=\"price\"],[data-package-section=\"photos\"],[data-package-section=\"location\"],[data-package-section=\"ownerSpecs\"],[data-package-section=\"ownerViewing\"]").forEach((node) => {
      if (unavailable) node.hidden = true;
      else if (node.getAttribute("data-package-section") === "ownerViewing") node.hidden = !available;
      else node.hidden = !available;
    });
    const photosSection = root.querySelector("[data-package-section=\"photos\"]");
    const fileInput = root.querySelector("[data-package-photos]");
    if (fileInput) fileInput.hidden = !bundle.mediaAdded;
    if (photosSection && bundle.mediaAdded && fileInput) fileInput.hidden = false;
    const ownerAvailability = root.querySelector("[data-package-section=\"ownerAvailability\"]");
    if (ownerAvailability) ownerAvailability.hidden = bundle.viewingAllowed !== "yes";
    const counterPreference = root.querySelector("[data-package-section=\"counterPreference\"]");
    if (counterPreference) counterPreference.hidden = bundle.negotiationDecision !== "counter";
  }
}

function bindDecisionPackage(root, token) {
  const form = root.querySelector("[data-party-decision-package]");
  if (!form) return;
  form.querySelectorAll("input").forEach((input) => {
    input.addEventListener("change", () => {
      refreshPackageSections(form);
    });
  });
  const mediaToggle = form.querySelector("[data-package-bool=\"mediaAdded\"]");
  const fileInput = form.querySelector("[data-package-photos]");
  const preview = form.querySelector("[data-package-photo-preview]");
  if (mediaToggle && fileInput) {
    mediaToggle.addEventListener("change", () => {
      fileInput.hidden = !mediaToggle.checked;
      if (!mediaToggle.checked && preview) preview.innerHTML = "";
    });
  }
  if (fileInput && preview) {
    fileInput.addEventListener("change", () => {
      preview.innerHTML = "";
      Array.from(fileInput.files || []).forEach((file) => {
        const img = document.createElement("img");
        img.src = URL.createObjectURL(file);
        preview.appendChild(img);
      });
    });
  }
  refreshPackageSections(form);
}

function bindBundleSubmit(root, token) {
  if (root.dataset.partyBundleSubmitBound === "1") return;
  root.dataset.partyBundleSubmitBound = "1";
  root.addEventListener("click", (event) => {
    const target = event.target;
    const submit = target && typeof target.closest === "function"
      ? target.closest("[data-party-bundle-submit]")
      : null;
    if (!submit || !root.contains(submit) || submit.disabled) return;
    const form = submit.closest("[data-party-decision-package]");
    if (!form) return;
    const party = form.closest("[data-party-shell]")?.getAttribute("data-party") || "client";
    const fileInput = form.querySelector("[data-package-photos]");
    const bundle = collectPackageFromForm(form, party);
    const photos = fileInput && !fileInput.hidden ? Array.from(fileInput.files || []) : [];
    void submitBundle(token, bundle, submit, photos);
  });
}

function bindCoordinationForm(root, token) {
  bindDecisionPackage(root, token);
}

function bindActions(root, token) {
  bindBundleSubmit(root, token);
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
    await recordLinkOpened(token);
    const view = await loadSession(token);
    partyDiag("PARTY_SESSION_RESOLVED", { party: view.party || "" });
    renderView(view, token);
    partyDiag("PARTY_VIEW_RENDERED", { party: view.party || "" });
    startLivePolling(token);
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