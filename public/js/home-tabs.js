/**
 * Home main/sub tabs — UI-only show/hide for Operations vs Opportunities.
 */
(() => {
  "use strict";

  const state = {
    main: "operations",
    opp: "bank"
  };

  const ADD_CLOSED_LABEL = "+ إضافة عرض أو طلب";
  const ADD_OPEN_LABEL = "إغلاق الإضافة";

  function $(id) {
    return document.getElementById(id);
  }

  function setAddComposerOpen(open) {
    const composer = $("addOpportunity");
    const tabAdd = $("oppTabAdd");
    if (composer) {
      composer.hidden = !open;
      composer.setAttribute("aria-hidden", open ? "false" : "true");
    }
    if (tabAdd) {
      tabAdd.setAttribute("aria-expanded", open ? "true" : "false");
      tabAdd.textContent = open ? ADD_OPEN_LABEL : ADD_CLOSED_LABEL;
      tabAdd.classList.toggle("is-open", open);
    }
  }

  function isAddComposerOpen() {
    const composer = $("addOpportunity");
    return Boolean(composer && !composer.hidden);
  }

  function isInlineBank() {
    return $("opportunityBank")?.dataset.inlineBank === "1";
  }

  function setMainTab(tab) {
    state.main = tab;
    const isOps = tab === "operations";
    const opsPanel = $("mainPanelOperations");
    const oppPanel = $("mainPanelOpportunities");
    const tabOps = $("mainTabOperations");
    const tabOpp = $("mainTabOpportunities");

    if (opsPanel) opsPanel.hidden = !isOps;
    if (oppPanel) oppPanel.hidden = isOps;
    if (tabOps) {
      tabOps.classList.toggle("is-active", isOps);
      tabOps.setAttribute("aria-selected", isOps ? "true" : "false");
    }
    if (tabOpp) {
      tabOpp.classList.toggle("is-active", !isOps);
      tabOpp.setAttribute("aria-selected", isOps ? "false" : "true");
    }

    if (!isOps) {
      setOppTab("bank", { skipBankPause: true });
    } else if (isInlineBank() && window.IAQAR?.pauseOpportunityBankInline) {
      window.IAQAR.pauseOpportunityBankInline();
    }
    window.dispatchEvent(new CustomEvent("iaqar:navigation-changed"));
  }

  function setOppTab(sub, options = {}) {
    const { skipBankPause = false, skipBankOpen = false } = options;
    const prev = state.opp;
    state.opp = "bank";
    const addPanel = $("oppPanelAdd");
    const bankPanel = $("oppPanelBank");
    const tabBank = $("oppTabBank");

    if (addPanel) addPanel.hidden = true;
    if (bankPanel) bankPanel.hidden = false;
    if (tabBank) {
      tabBank.classList.toggle("is-active", true);
      tabBank.setAttribute("aria-selected", "true");
    }

    void sub;
    void skipBankPause;
    void prev;
    if (!skipBankOpen && isInlineBank()) {
      window.IAQAR?.activateOpportunityBankInline?.();
    }
    setAddComposerOpen(false);
    window.dispatchEvent(new CustomEvent("iaqar:navigation-changed"));
  }

  function switchTo(main, opp) {
    setMainTab(main);
    if (main === "opportunities") {
      setOppTab("bank");
    }
    void opp;
  }

  function boot() {
    const tabOps = $("mainTabOperations");
    const tabOpp = $("mainTabOpportunities");
    if (!tabOps || !tabOpp) return;

    tabOps.addEventListener("click", () => {
      const hash = String(window.location.hash || "");
      if (/^#\/opportunities(?:-v2)?\//.test(hash) && window.history?.replaceState) {
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname || "/"}${window.location.search || ""}`
        );
      }
      setMainTab("operations");
    });
    tabOpp.addEventListener("click", () => {
      setMainTab("opportunities");
      setOppTab(state.opp || "bank");
    });
    $("oppTabAdd")?.addEventListener("click", () => {
      if (state.main !== "opportunities") setMainTab("opportunities");
      const next = !isAddComposerOpen();
      setAddComposerOpen(next);
      if (next) $("addOpportunityInput")?.focus();
    });
    $("oppTabBank")?.addEventListener("click", () => {
      if (state.main !== "opportunities") setMainTab("opportunities");
      setOppTab("bank");
    });

    setMainTab("operations");
    setOppTab("bank", { skipBankPause: true, skipBankOpen: true });
  }

  document.addEventListener("DOMContentLoaded", boot);
  if (document.readyState !== "loading") boot();

  window.IAQAR = window.IAQAR || {};
  window.IAQAR.homeTabs = Object.freeze({
    switchTo,
    setMainTab,
    setOppTab,
    getState: () => ({ main: state.main, opp: state.opp })
  });
})();
