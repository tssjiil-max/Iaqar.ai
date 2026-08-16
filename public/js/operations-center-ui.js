/**
 * Daily tasks (المهام اليومية) — shell UI controller.
 */
import { missingFieldLabelsArabic } from "./opportunity-readiness-domain.js";
import {
  bestActionHint,
  extractOpportunityId,
  primaryActionLabel
} from "./operations-center-domain.js";

const VIEW_MODES = Object.freeze({
  CATEGORIES: "categories",
  CATEGORY_LIST: "category-list",
  OPPORTUNITY_DETAIL: "opportunity-detail"
});

export function bootDailyTasksUi(rootDocument = typeof document !== "undefined" ? document : null) {
  if (!rootDocument) return;
  const rootWindow = rootDocument.defaultView;
  if (!rootWindow) return;

  const state = {
    viewMode: VIEW_MODES.CATEGORIES,
    activeCategory: null,
    opened: null,
    activeTaskId: null,
    pendingOpen: null,
    listScrollTop: 0
  };

  let data = [];

  const workspace = rootDocument.getElementById("workspace");
  const operationList = rootDocument.getElementById("operationList");
  const operationsEmpty = rootDocument.getElementById("operationsEmpty");
  const operationsCategoryGrid = rootDocument.getElementById("operationsCategoryGrid");
  const operationsCategoryDetailHead = rootDocument.getElementById("operationsCategoryDetailHead");
  const operationsCategoryTitle = rootDocument.getElementById("operationsCategoryTitle");
  const operationsCategoryClose = rootDocument.getElementById("operationsCategoryClose");
  const operationsDetailBack = rootDocument.getElementById("operationsDetailBack");
  const operationsTaskPanel = rootDocument.getElementById("operationsTaskPanel");
  const opsViewCategories = rootDocument.getElementById("opsViewCategories");
  const opsViewCategoryList = rootDocument.getElementById("opsViewCategoryList");
  const opsViewOpportunityDetail = rootDocument.getElementById("opsViewOpportunityDetail");
  const total = rootDocument.getElementById("total");
  const toast = rootDocument.getElementById("toast");

  function opsCenterDomain() {
    return rootWindow.IAQAR?.operationsCenterDomain || null;
  }

  function prefersReducedMotion() {
    try {
      return rootWindow.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }

  function scrollWorkspaceTop() {
    const behavior = prefersReducedMotion() ? "auto" : "auto";
    if (workspace) {
      workspace.scrollIntoView({ behavior, block: "start" });
    }
    const mainPanel = rootDocument.getElementById("mainPanelOperations");
    if (mainPanel) {
      mainPanel.scrollIntoView({ behavior, block: "start" });
    }
  }

  function focusStageHeading() {
    const raf = rootWindow.requestAnimationFrame || ((cb) => rootWindow.setTimeout(cb, 0));
    raf(() => {
      let target = null;
      if (state.viewMode === VIEW_MODES.CATEGORY_LIST) {
        target = operationsCategoryTitle;
      } else if (state.viewMode === VIEW_MODES.OPPORTUNITY_DETAIL) {
        target = operationsTaskPanel?.querySelector("h3, h4");
      } else if (state.viewMode === VIEW_MODES.CATEGORIES) {
        target = workspace?.querySelector(".section-title-bar h2");
      }
      if (target && typeof target.focus === "function") {
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      }
    });
  }

  function afterViewChange() {
    const raf = rootWindow.requestAnimationFrame || ((cb) => rootWindow.setTimeout(cb, 0));
    raf(() => {
      scrollWorkspaceTop();
      focusStageHeading();
    });
  }

  function setStageView(node, visible) {
    if (!node) return;
    node.hidden = !visible;
    node.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function applyViewMode() {
    setStageView(opsViewCategories, state.viewMode === VIEW_MODES.CATEGORIES);
    setStageView(opsViewCategoryList, state.viewMode === VIEW_MODES.CATEGORY_LIST);
    setStageView(opsViewOpportunityDetail, state.viewMode === VIEW_MODES.OPPORTUNITY_DETAIL);

    if (operationsCategoryDetailHead) {
      operationsCategoryDetailHead.hidden = state.viewMode !== VIEW_MODES.CATEGORY_LIST;
    }
    if (operationList) {
      operationList.hidden = state.viewMode !== VIEW_MODES.CATEGORY_LIST;
    }
    if (operationsCategoryGrid) {
      operationsCategoryGrid.hidden = state.viewMode !== VIEW_MODES.CATEGORIES;
    }
    if (operationsEmpty) {
      operationsEmpty.hidden = state.viewMode !== VIEW_MODES.CATEGORIES
        || visibleItems().length > 0;
    }
  }

  function visibleItems() {
    const domain = opsCenterDomain();
    const items = domain?.filterBrokerVisibleItems
      ? domain.filterBrokerVisibleItems(data)
      : data.filter((item) => {
        const type = String(item?.operationType || "").toUpperCase();
        const title = String(item?.title || "").trim();
        return type !== "OPPORTUNITY_SAVED" && title !== "فرصة محفوظة مسبقًا";
      });
    return [...items].sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2));
  }

  function categoryGroups() {
    const domain = opsCenterDomain();
    if (domain?.groupItems) return domain.groupItems(data);
    return {};
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeTimeHtml(value) {
    return String(value == null ? "الآن" : value)
      .split(/<br\s*\/?\s*>/i)
      .map((part) => escapeHtml(part))
      .join("<br>");
  }

  function dispatchOpened(item) {
    if (!item || !item.recordType) return;
    rootWindow.dispatchEvent(new rootWindow.CustomEvent("iaqar:operation-opened", {
      detail: { recordId: item.recordId || item.id, recordType: item.recordType }
    }));
  }

  function dispatchWorkflowPrimary(item) {
    if (!item) return;
    rootWindow.dispatchEvent(new rootWindow.CustomEvent("iaqar:workflow-action", {
      detail: { ...item, recordId: item.recordId || item.id, actionMode: "primary" }
    }));
  }

  function notify(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function clearTaskPanel() {
    if (operationsTaskPanel) {
      operationsTaskPanel.innerHTML = "";
    }
  }

  function hideTaskPanel() {
    state.activeTaskId = null;
    clearTaskPanel();
  }

  function renderCategoryGrid() {
    const domain = opsCenterDomain();
    const categories = domain?.OPERATIONS_CATEGORIES || [];
    const groups = categoryGroups();
    if (!operationsCategoryGrid) return;
    operationsCategoryGrid.innerHTML = categories.map((cat) => {
      const count = (groups[cat.key] || []).length;
      return `
        <button type="button" class="ops-category-card ${escapeHtml(cat.colorClass)}"
          data-ops-category="${escapeHtml(cat.key)}"
          aria-label="${escapeHtml(cat.label)} — ${escapeHtml(String(count))}">
          <div class="ops-category-card-head">
            <h3>${escapeHtml(cat.label)}</h3>
            <span class="ops-category-count">${escapeHtml(String(count))}</span>
          </div>
          <p class="ops-category-desc">${escapeHtml(cat.description)}</p>
          <p class="ops-category-open">${escapeHtml(cat.openLabel)}</p>
        </button>`;
    }).join("");
  }

  function incompleteMetaHtml(item) {
    const labels = missingFieldLabelsArabic(
      item.matchingReadinessMissing || item.missingFields || []
    );
    const count = labels.length || (opsCenterDomain()?.missingFieldCount?.(item) || 0);
    const source = String(item.normalizedSource || item.source || "").trim();
    const parts = [];
    if (labels.length) {
      parts.push(`<p class="ops-task-missing">ينقص: ${escapeHtml(labels.join("، "))} (${escapeHtml(String(count))})</p>`);
    } else if (count > 0) {
      parts.push(`<p class="ops-task-missing">عدد الحقول الناقصة: ${escapeHtml(String(count))}</p>`);
    }
    if (source) parts.push(`<p class="ops-task-source">المصدر: ${escapeHtml(source)}</p>`);
    return parts.join("");
  }

  function taskCardHtml(item) {
    const domain = opsCenterDomain();
    const hint = domain?.bestActionHint ? domain.bestActionHint(item) : bestActionHint(item);
    const primaryLabel = domain?.primaryActionLabel ? domain.primaryActionLabel(item) : primaryActionLabel(item);
    const cat = domain?.categoryKey ? domain.categoryKey(item) : "";
    const incompleteMeta = cat === "incomplete" ? incompleteMetaHtml(item) : "";

    return `
      <article class="ops-task-card" id="ops-task-${escapeHtml(item.id)}" data-ops-task-id="${escapeHtml(item.id)}">
        <button type="button" class="ops-task-card-main" data-ops-open-task="${escapeHtml(item.id)}"
          aria-expanded="false" aria-controls="operationsTaskPanel">
          <span class="ops-task-icon" aria-hidden="true">
            <svg class="icon"><use href="#${escapeHtml(item.icon || "i-clipboard-list")}"/></svg>
          </span>
          <span class="ops-task-body">
            <h4>${escapeHtml(item.title)}</h4>
            <p>${escapeHtml(item.subtitle)}</p>
            ${item.opsStatusLine ? `<p class="ops-task-status">${escapeHtml(item.opsStatusLine)}</p>` : ""}
            ${incompleteMeta}
            ${hint ? `<p class="ops-task-hint"><span>الإجراء الأفضل الآن:</span> ${escapeHtml(hint)}</p>` : ""}
          </span>
          <span class="ops-task-time">${safeTimeHtml(item.time)}</span>
        </button>
        <div class="ops-task-actions">
          <button type="button" class="ops-task-primary" data-ops-primary="${escapeHtml(item.id)}">
            ${escapeHtml(primaryLabel)}
          </button>
        </div>
      </article>`;
  }

  function renderOperationList(items) {
    if (!operationList) return;
    operationList.innerHTML = items.map((item) => taskCardHtml(item)).join("");
  }

  function updateCategoryHead(count) {
    const domain = opsCenterDomain();
    const cat = domain?.getCategoryDefinition?.(state.activeCategory);
    if (operationsCategoryTitle && cat) {
      operationsCategoryTitle.textContent = `${cat.label} (${count})`;
    }
  }

  function openCategory(categoryKey) {
    const domain = opsCenterDomain();
    const cat = domain?.getCategoryDefinition?.(categoryKey);
    if (!cat) return;
    state.viewMode = VIEW_MODES.CATEGORY_LIST;
    state.activeCategory = categoryKey;
    state.opened = null;
    state.activeTaskId = null;
    state.listScrollTop = 0;
    hideTaskPanel();
    render();
    afterViewChange();
  }

  function closeCategory() {
    state.viewMode = VIEW_MODES.CATEGORIES;
    state.activeCategory = null;
    state.opened = null;
    state.activeTaskId = null;
    state.listScrollTop = 0;
    hideTaskPanel();
    render();
    afterViewChange();
  }

  function backToCategoryList() {
    if (state.viewMode !== VIEW_MODES.OPPORTUNITY_DETAIL) return;
    hideTaskPanel();
    state.viewMode = VIEW_MODES.CATEGORY_LIST;
    state.activeTaskId = null;
    applyViewMode();
    if (operationList && state.listScrollTop > 0) {
      operationList.scrollTop = state.listScrollTop;
    }
    afterViewChange();
  }

  async function openDailyTaskItem(item) {
    if (!item) return;
    if (operationList) {
      state.listScrollTop = operationList.scrollTop;
    }
    state.activeTaskId = item.id;
    const oppId = extractOpportunityId(item);

    if (oppId && rootWindow.IAQAR?.renderDailyTaskOpportunity) {
      state.viewMode = VIEW_MODES.OPPORTUNITY_DETAIL;
      applyViewMode();
      clearTaskPanel();
      const ok = await rootWindow.IAQAR.renderDailyTaskOpportunity("operationsTaskPanel", oppId);
      if (!ok) {
        notify("تعذر فتح الفرصة");
        backToCategoryList();
        return;
      }
      dispatchOpened(item);
      afterViewChange();
      return;
    }

    if (["match", "deal", "operation", "intake"].includes(item.recordType)) {
      dispatchWorkflowPrimary(item);
      return;
    }

    notify("لا يوجد إجراء متاح لهذا العنصر");
  }

  function render() {
    const items = visibleItems();
    if (total) total.textContent = items.length;

    if (items.length === 0 && state.viewMode !== VIEW_MODES.CATEGORIES) {
      state.viewMode = VIEW_MODES.CATEGORIES;
      state.activeCategory = null;
      state.opened = null;
      state.activeTaskId = null;
      hideTaskPanel();
    }

    if (state.viewMode === VIEW_MODES.CATEGORIES) {
      renderCategoryGrid();
      applyViewMode();
      return;
    }

    const groups = categoryGroups();
    const categoryItems = [...(groups[state.activeCategory] || [])];
    updateCategoryHead(categoryItems.length);

    if (state.viewMode === VIEW_MODES.CATEGORY_LIST) {
      renderOperationList(categoryItems);
      if (operationList) operationList.hidden = categoryItems.length === 0;
    }

    if (state.activeTaskId && !categoryItems.some((row) => row.id === state.activeTaskId)) {
      hideTaskPanel();
      state.activeTaskId = null;
      if (state.viewMode === VIEW_MODES.OPPORTUNITY_DETAIL) {
        state.viewMode = VIEW_MODES.CATEGORY_LIST;
      }
    }

    applyViewMode();
  }

  rootDocument.addEventListener("click", (event) => {
    const categoryCard = event.target.closest("[data-ops-category]");
    if (categoryCard) {
      openCategory(categoryCard.getAttribute("data-ops-category"));
      return;
    }

    if (event.target.closest("#operationsCategoryClose")) {
      closeCategory();
      return;
    }

    if (event.target.closest("#operationsDetailBack")) {
      backToCategoryList();
      return;
    }

    const viewButton = event.target.closest("[data-opportunity-view]");
    if (viewButton && rootWindow.IAQAR_WORKFLOW && typeof rootWindow.IAQAR_WORKFLOW.setOpportunityView === "function") {
      rootWindow.IAQAR_WORKFLOW.setOpportunityView(viewButton.dataset.opportunityView);
      return;
    }

    const primaryBtn = event.target.closest("[data-ops-primary]");
    if (primaryBtn) {
      event.stopPropagation();
      const item = data.find((entry) => entry.id === primaryBtn.getAttribute("data-ops-primary"));
      void openDailyTaskItem(item);
      return;
    }

    const openTaskBtn = event.target.closest("[data-ops-open-task]");
    if (openTaskBtn) {
      const item = data.find((entry) => entry.id === openTaskBtn.getAttribute("data-ops-open-task"));
      void openDailyTaskItem(item);
      return;
    }
  });

  rootWindow.addEventListener("iaqar:operations-data", (event) => {
    const detail = event.detail || {};
    const items = Array.isArray(detail.items) ? detail.items : [];
    const filters = rootDocument.getElementById("opportunityViewFilters");
    if (filters) {
      const hasLifecycleItems = items.some((item) => ["intake", "opportunity"].includes(item.recordType));
      filters.hidden = !hasLifecycleItems;
      filters.querySelectorAll("[data-opportunity-view]").forEach((button) => {
        button.classList.toggle("active", button.dataset.opportunityView === (detail.opportunityView || "active"));
      });
    }
    if (detail.authoritative || items.length > 0) {
      data = items;
      const pendingMatches = (item) => state.pendingOpen && (
        item.id === state.pendingOpen.id
        || (state.pendingOpen.matchId && item.matchId === state.pendingOpen.matchId)
        || item.matchId === state.pendingOpen.id
      );
      if (state.pendingOpen && data.some(pendingMatches)) {
        const item = data.find(pendingMatches);
        const domain = opsCenterDomain();
        if (domain?.categoryKey) {
          state.viewMode = VIEW_MODES.CATEGORY_LIST;
          state.activeCategory = domain.categoryKey(item);
        }
        state.pendingOpen = null;
        render();
        void openDailyTaskItem(item);
        return;
      }
      if (state.opened && !data.some((item) => item.id === state.opened) && !state.pendingOpen) {
        state.opened = null;
      }
      render();
    }
  });

  rootWindow.addEventListener("iaqar:open-operation", (event) => {
    const detail = event.detail || {};
    const requested = { id: detail.id || null, matchId: detail.matchId || null };
    state.opened = requested.id;
    if (!requested.id && !requested.matchId) {
      state.pendingOpen = null;
      render();
      return;
    }
    const item = data.find((entry) =>
      entry.id === requested.id
      || (requested.matchId && entry.matchId === requested.matchId)
      || entry.matchId === requested.id
    );
    if (!item) {
      state.pendingOpen = requested;
      render();
      return;
    }
    const domain = opsCenterDomain();
    if (domain?.categoryKey) {
      state.viewMode = VIEW_MODES.CATEGORY_LIST;
      state.activeCategory = domain.categoryKey(item);
    }
    state.opened = item.id;
    state.pendingOpen = null;
    render();
    void openDailyTaskItem(item);
  });

  rootWindow.addEventListener("iaqar:daily-task-closed", () => {
    if (state.viewMode === VIEW_MODES.OPPORTUNITY_DETAIL) {
      backToCategoryList();
    } else {
      state.activeTaskId = null;
      clearTaskPanel();
    }
  });

  rootWindow.addEventListener("iaqar:daily-task-completed", () => {
    state.activeTaskId = null;
    clearTaskPanel();
    if (state.activeCategory) {
      state.viewMode = VIEW_MODES.CATEGORY_LIST;
    } else {
      state.viewMode = VIEW_MODES.CATEGORIES;
    }
    render();
    afterViewChange();
  });

  rootWindow.addEventListener("iaqar:operations-center-domain-ready", () => render());

  render();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => bootDailyTasksUi(document), { once: true });
  } else {
    bootDailyTasksUi(document);
  }
}
