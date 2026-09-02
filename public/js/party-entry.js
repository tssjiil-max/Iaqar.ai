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
          throw new Error(payload.message || "تعذر تسجيل الرد.");
        }
        renderView(payload.view, token);
        return;
      } catch (error) {
        lastError = error;
        const fresh = await loadSession(token).catch(() => null);
        if (fresh?.replied || fresh?.decisionPackage?.submitted) {
          renderView(fresh, token);
          return;
        }
        if (error?.name !== "AbortError") break;
      }
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

  const smartQuestion = root.querySelector("[data-smart-detail-key]");
  const smartDetailKey = String(smartQuestion?.getAttribute("data-smart-detail-key") || "");
  const smartImportance = String(bundle.smartDetailImportance || "");
  if (smartDetailKey && smartImportance === "yes") {
    bundle.requestedDetailKeys = [...new Set([...(bundle.requestedDetailKeys || []), smartDetailKey])];
  } else if (smartDetailKey && ["no", "not_important"].includes(smartImportance)) {
    bundle.ignoredDetailKeys = [...new Set([...(bundle.ignoredDetailKeys || []), smartDetailKey])];
  }
  delete bundle.smartDetailImportance;

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
  const party = root.closest("[data-party-shell]")?.getAttribute("data-party") || "client";
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
  const submit = form.querySelector("[data-party-bundle-submit]");
  if (submit) {
    submit.addEventListener("click", () => {
      if (submit.disabled) return;
      const bundle = collectPackageFromForm(form, party);
      const photos = fileInput && !fileInput.hidden ? Array.from(fileInput.files || []) : [];
      void submitBundle(token, bundle, submit, photos);
    });
  }
  refreshPackageSections(form);
}

function bindCoordinationForm(root, token) {
  bindDecisionPackage(root, token);
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
