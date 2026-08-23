/**
 * Canonical in-app back navigation — explicit parent targets with safe history sync.
 */
(() => {
  "use strict";

  let domain = null;
  let historyDepth = 0;

  function getDomain() {
    return domain || window.IAQAR?.navigationDomain || null;
  }

  function overlaySnapshot() {
    const order = getDomain()?.NAV_OVERLAY_ORDER || [
      "opportunityReviewOverlay",
      "iaqarWorkflowOverlay",
      "officeSettings"
    ];
    const overlays = {};
    for (const id of order) {
      const el = document.getElementById(id);
      overlays[id] = Boolean(el && !el.hidden);
    }
    return overlays;
  }

  function collectSnapshot() {
    const tabs = window.IAQAR?.homeTabs?.getState?.() || { main: "operations", opp: "add" };
    return {
      overlays: overlaySnapshot(),
      bankDetailOpen: Boolean(window.IAQAR?.isBankDetailOpen?.()),
      mainTab: tabs.main || "operations",
      oppSubTab: tabs.opp || "add",
      accessScreen: document.body.classList.contains("access-locked")
        ? String(document.getElementById("accessGate")?.dataset.activeScreen || "")
        : ""
    };
  }

  function bankDetailOpen() {
    return Boolean(window.IAQAR?.isBankDetailOpen?.());
  }

  function anyOverlayOpen() {
    const overlays = overlaySnapshot();
    return Object.values(overlays).some(Boolean) || bankDetailOpen();
  }

  function syncBodyScroll() {
    const locked = anyOverlayOpen()
      || (document.getElementById("opportunityReviewOverlay") && !document.getElementById("opportunityReviewOverlay").hidden);
    document.body.style.overflow = locked ? "hidden" : "";
  }

  function trimHistoryIfNeeded() {
    if (historyDepth > 0 && window.history?.state?.iaqarOverlay) {
      historyDepth -= 1;
      window.history.replaceState(null, "", location.href);
    }
  }

  function closeOverlayById(id) {
    const el = document.getElementById(id);
    if (!el || el.hidden) return false;

    if (id === "iaqarWorkflowOverlay") {
      el.hidden = true;
      window.dispatchEvent(new CustomEvent("iaqar:workflow-overlay-closed"));
      trimHistoryIfNeeded();
      syncBodyScroll();
      return true;
    }
    if (id === "officeSettings") {
      if (typeof window.IAQAR?.closeOfficeSettings === "function") {
        window.IAQAR.closeOfficeSettings({ explicit: true });
        trimHistoryIfNeeded();
        syncBodyScroll();
        return true;
      }
      el.hidden = true;
      window.dispatchEvent(new CustomEvent("iaqar:office-settings-closed"));
      trimHistoryIfNeeded();
      syncBodyScroll();
      return true;
    }
    if (id === "opportunityReviewOverlay") {
      if (typeof window.IAQAR?.closeOpportunityReview === "function") {
        window.IAQAR.closeOpportunityReview({ explicit: true });
        trimHistoryIfNeeded();
        syncBodyScroll();
        return true;
      }
      el.hidden = true;
      document.body.style.overflow = "";
      window.dispatchEvent(new CustomEvent("iaqar:opportunity-review-closed"));
      trimHistoryIfNeeded();
      syncBodyScroll();
      return true;
    }

    el.hidden = true;
    trimHistoryIfNeeded();
    syncBodyScroll();
    return true;
  }

  function executeBackAction(action) {
    if (!action) return false;

    if (action.type === "close-overlay") {
      return closeOverlayById(action.id);
    }
    if (action.type === "close-bank-detail") {
      const closed = Boolean(window.IAQAR?.closeBankDetailInternal?.());
      trimHistoryIfNeeded();
      syncBodyScroll();
      return closed;
    }
    if (action.type === "switch-opp-sub") {
      window.IAQAR?.homeTabs?.setOppTab?.(action.sub || "add");
      return true;
    }
    if (action.type === "switch-main-tab") {
      window.IAQAR?.homeTabs?.setMainTab?.(action.tab || "operations");
      return true;
    }
    return false;
  }

  function updateBackButton() {
    const btn = document.getElementById("appNavBack");
    if (!btn) return;
    const resolver = getDomain()?.shouldShowHeaderBack || (() => anyOverlayOpen());
    const snapshot = collectSnapshot();
    btn.hidden = document.body.classList.contains("access-locked")
      ? true
      : !resolver(snapshot);
  }

  function pushOverlayState(view, url) {
    if (!view) return;
    let href = location.href;
    if (typeof url === "string" && url) {
      href = url.startsWith("#")
        ? `${location.pathname}${location.search}${url}`
        : url;
    }
    window.history.pushState({ iaqarOverlay: view }, "", href);
    historyDepth += 1;
    updateBackButton();
  }

  function requestBack() {
    const resolver = getDomain()?.resolveBackAction;
    const action = resolver ? resolver(collectSnapshot()) : null;
    if (!action) {
      if (bankDetailOpen()) {
        return executeBackAction({ type: "close-bank-detail" });
      }
      const id = getDomain()?.topOverlayIdFromSnapshot?.(overlaySnapshot())
        || "";
      if (id) return executeBackAction({ type: "close-overlay", id });
      return false;
    }
    const handled = executeBackAction(action);
    updateBackButton();
    return handled;
  }

  window.addEventListener("popstate", () => {
    if (historyDepth > 0) historyDepth -= 1;

    if (bankDetailOpen() && window.IAQAR?.closeBankDetailInternal) {
      window.IAQAR.closeBankDetailInternal();
      updateBackButton();
      return;
    }

    const overlays = overlaySnapshot();
    const topId = getDomain()?.topOverlayIdFromSnapshot?.(overlays)
      || Object.keys(overlays).find((id) => overlays[id])
      || "";
    if (topId) closeOverlayById(topId);
    updateBackButton();
  });

  window.addEventListener("iaqar:nav-open", (event) => {
    pushOverlayState(event.detail?.view || "", event.detail?.url || "");
  });

  window.addEventListener("iaqar:nav-close-request", () => {
    requestBack();
  });

  window.addEventListener("iaqar:navigation-changed", () => {
    updateBackButton();
  });

  async function boot() {
    domain = window.IAQAR?.navigationDomain || null;
    if (!domain) {
      try {
        domain = await import("./app-navigation-domain.js");
      } catch (_) {
        domain = window.IAQAR?.navigationDomain || null;
      }
    }

    const btn = document.getElementById("appNavBack");
    if (btn && !btn.dataset.boundBack) {
      btn.dataset.boundBack = "1";
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        requestBack();
      });
    }
    updateBackButton();
  }

  document.addEventListener("DOMContentLoaded", boot);
  if (document.readyState !== "loading") boot();

  window.IAQAR = window.IAQAR || {};
  window.IAQAR.navigation = Object.freeze({
    pushOverlayState,
    requestBack,
    updateBackButton,
    collectSnapshot,
    executeBackAction
  });
})();
