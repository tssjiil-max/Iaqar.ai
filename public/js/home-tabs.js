/**
 * Home main/sub tabs — UI-only show/hide for Operations vs Opportunities.
 */
(() => {
  "use strict";

  const state = {
    main: "operations",
    opp: "add"
  };

  function $(id) {
    return document.getElementById(id);
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
      setOppTab(state.opp || "add", { skipBankPause: true });
    } else if (isInlineBank() && window.IAQAR?.pauseOpportunityBankInline) {
      window.IAQAR.pauseOpportunityBankInline();
    }
  }

  function setOppTab(sub, options = {}) {
    const { skipBankPause = false, skipBankOpen = false } = options;
    const prev = state.opp;
    state.opp = sub;
    const isAdd = sub === "add";
    const addPanel = $("oppPanelAdd");
    const bankPanel = $("oppPanelBank");
    const tabAdd = $("oppTabAdd");
    const tabBank = $("oppTabBank");

    if (addPanel) addPanel.hidden = !isAdd;
    if (bankPanel) bankPanel.hidden = isAdd;
    if (tabAdd) {
      tabAdd.classList.toggle("is-active", isAdd);
      tabAdd.setAttribute("aria-selected", isAdd ? "true" : "false");
    }
    if (tabBank) {
      tabBank.classList.toggle("is-active", !isAdd);
      tabBank.setAttribute("aria-selected", isAdd ? "false" : "true");
    }

    if (!skipBankPause && prev === "bank" && isAdd && isInlineBank()) {
      window.IAQAR?.pauseOpportunityBankInline?.();
    }
    if (!isAdd && !skipBankOpen && isInlineBank()) {
      window.IAQAR?.activateOpportunityBankInline?.();
    }
  }

  function switchTo(main, opp) {
    setMainTab(main);
    if (main === "opportunities") {
      setOppTab(opp || state.opp || "add");
    }
  }

  function boot() {
    const tabOps = $("mainTabOperations");
    const tabOpp = $("mainTabOpportunities");
    if (!tabOps || !tabOpp) return;

    tabOps.addEventListener("click", () => setMainTab("operations"));
    tabOpp.addEventListener("click", () => {
      setMainTab("opportunities");
      setOppTab(state.opp || "add");
    });
    $("oppTabAdd")?.addEventListener("click", () => {
      if (state.main !== "opportunities") setMainTab("opportunities");
      setOppTab("add");
    });
    $("oppTabBank")?.addEventListener("click", () => {
      if (state.main !== "opportunities") setMainTab("opportunities");
      setOppTab("bank");
    });

    setMainTab("operations");
    setOppTab("add", { skipBankPause: true, skipBankOpen: true });
  }

  document.addEventListener("DOMContentLoaded", boot);
  if (document.readyState !== "loading") boot();

  window.IAQAR = window.IAQAR || {};
  window.IAQAR.homeTabs = Object.freeze({ switchTo, setMainTab, setOppTab });
})();
