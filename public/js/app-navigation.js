/**
 * In-app history: overlays push state; back button / browser back closes top overlay.
 */
(() => {
  "use strict";

  const OVERLAY_ORDER = ["opportunityReviewOverlay", "iaqarWorkflowOverlay", "opportunityBank", "officeSettings"];

  function topOverlayId() {
    for (const id of OVERLAY_ORDER) {
      const el = document.getElementById(id);
      if (el && !el.hidden) return id;
    }
    return "";
  }

  function bankDetailOpen() {
    return Boolean(window.IAQAR?.isBankDetailOpen?.());
  }

  function anyOverlayOpen() {
    return Boolean(topOverlayId()) || bankDetailOpen();
  }

  function syncBodyScroll() {
    document.body.style.overflow = anyOverlayOpen() ? "hidden" : "";
  }

  function closeOverlayById(id) {
    const el = document.getElementById(id);
    if (!el || el.hidden) return;
    if (id === "opportunityBank" && window.IAQAR?.closeOpportunityBank) {
      window.IAQAR.closeOpportunityBank({ fromPopstate: true });
      return;
    }
    if (id === "iaqarWorkflowOverlay") {
      el.hidden = true;
      window.dispatchEvent(new CustomEvent("iaqar:workflow-overlay-closed"));
      syncBodyScroll();
      return;
    }
    if (id === "officeSettings") {
      el.hidden = true;
      window.dispatchEvent(new CustomEvent("iaqar:office-settings-closed"));
      syncBodyScroll();
      return;
    }
    if (id === "opportunityReviewOverlay") {
      el.hidden = true;
      window.dispatchEvent(new CustomEvent("iaqar:opportunity-review-closed"));
      syncBodyScroll();
      return;
    }
    el.hidden = true;
    syncBodyScroll();
  }

  function updateBackButton() {
    const btn = document.getElementById("appNavBack");
    if (!btn) return;
    btn.hidden = !anyOverlayOpen();
  }

  function pushOverlayState(view) {
    if (!view) return;
    window.history.pushState({ iaqarOverlay: view }, "", location.href);
    updateBackButton();
  }

  function requestBack() {
    if (anyOverlayOpen()) window.history.back();
  }

  window.addEventListener("popstate", () => {
    if (bankDetailOpen() && window.IAQAR?.closeBankDetailInternal) {
      window.IAQAR.closeBankDetailInternal();
      updateBackButton();
      return;
    }
    const id = topOverlayId();
    if (id) closeOverlayById(id);
    updateBackButton();
  });

  window.addEventListener("iaqar:nav-open", (event) => {
    pushOverlayState(event.detail?.view || "");
  });

  window.addEventListener("iaqar:nav-close-request", () => {
    requestBack();
  });

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("appNavBack");
    if (btn) btn.addEventListener("click", () => requestBack());
    updateBackButton();
  });

  window.IAQAR = window.IAQAR || {};
  window.IAQAR.navigation = Object.freeze({
    pushOverlayState,
    requestBack,
    updateBackButton
  });
})();
