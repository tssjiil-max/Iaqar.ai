/**
 * Phase 3 — Opportunity Bank UI controller.
 * Accessible only from Office Settings → العروض والطلبات.
 */

import {
  BANK_PAGE_SIZE,
  LIFECYCLE,
  SHARE_REQUEST_STATUS,
  bankDetailView,
  bankListItem,
  buildArchivePatch,
  buildBankSharingScope,
  buildCooperationRequest,
  buildEditPatch,
  buildRestorePatch,
  buildReviewCompletionPatch,
  buildSoftDeletePatch,
  cooperationStateFromShareStatus,
  cooperationStatusLabel,
  shareRequestStatusLabel,
  phase3BoundaryGuarantees,
  recordToReviewFields,
  readinessMissingToNeedsReview,
  validateOwnedOpportunityIds,
  validatePermanentDelete
} from "./opportunity-bank-domain.js";
import {
  phase4BoundaryGuarantees,
  requestOpportunityRematch
} from "./matching-domain.js";
import {
  phase5BoundaryGuarantees,
  requestCooperationOperationSync,
  requestMissingDataOperationSync
} from "./operations-domain.js";
import {
  buildAdvertiserDataPatch,
  buildAdvertiserWhatsAppMessage,
  formatLocalPhoneDisplay,
  mergeAdvertiserFieldsIntoOpportunity,
  whatsappDigitsFromE164,
  readAdvertiserDisplayName,
  readAdvertiserPhoneFromRecord
} from "./advertiser-phone-domain.js";
import { openWhatsApp } from "./whatsapp-handoff-domain.js";
import { officeLinkFor } from "./office-domain.js";
import {
  phase6BoundaryGuarantees,
  cooperationModeAllowsExplicitRequest,
  cooperationModeAllowsAccept,
  normalizeCooperationMode,
  requestCooperationLifecycle,
  requestScopeRevoke,
  FIVE_ARABIC_COOPERATION_STATUSES
} from "./cooperation-phase6-domain.js";
import { DEFAULT_COOPERATION_MODE } from "./office-domain.js";
import {
  collectBankFilterOptions,
  emptyBankFilters,
  emptyBankSummary,
  hasActiveBankQuery,
  matchesBankQueryFilters,
  summarizeBankCounts
} from "./opportunity-bank-filters-domain.js";
import {
  evaluateMatchingReadiness,
  matchingReadinessLabel,
  missingFieldLabelsArabic
} from "./opportunity-readiness-domain.js";
import {
  buildFollowUpLifecycleBody,
  buildQuickFollowUpDateTimeInput,
  formatFollowUpAppointmentLine,
  followUpActivityText,
  parseFollowUpForSave,
  validateFollowUpSaveIds,
  validateTodayRequiresFutureTime,
  activeFollowUpFromRecord
} from "./opportunity-followup-domain.js";
import {
  buildListingShareMessage,
  telegramShareUrl
} from "./listing-share-domain.js";
import { buildOpportunityCardView, contactLineMarkup } from "./opportunity-card-domain.js";
import { buildBankListCardView } from "./bank-list-card-domain.js";
import { buildOpportunityListingCardInnerHtml } from "./opportunity-listing-card-ui.js";
import {
  buildNeedsCompletionDetailHtml,
  buildReadyWorkspaceHtml,
  buildMatchComparisonHtml,
  buildCooperationRoomHtml,
  buildContactOutcomeActionHtml,
  buildWorkspaceMatchRowsHtml,
  buildWorkspaceCoopRowsHtml,
  buildWorkspaceCoopEmptyHintHtml
} from "./opportunity-bank-workspace-ui.js";
import { buildOpportunityDetailsCoreHtml } from "./opportunity-details-ui.js";
import {
  sortMatchesForWorkspace,
  mergeIncompleteFormPreview,
  mergeWorkspaceCooperationRequests,
  activeWorkspaceCooperationRequests,
  mergeUniqueCooperationRequests
} from "./opportunity-workspace-domain.js";
import {
  buildPublicListingAnnouncement,
  listingShareActivityText,
  officeShareSentActivityText,
  officeShareStatusLabel,
  partyActionActivityText,
  partyContactActions,
  partyWhatsAppPresetMessage,
  readyWorkspacePrimaryActions,
  validateOfficeShareSend
} from "./opportunity-ready-actions-domain.js";
import {
  contactOutcomeActivityText,
  contactOutcomeSelectionHint,
  contactOutcomeSelectedBadgeLabel,
  CONTACT_OUTCOME_LABELS,
  refusalReasonLabel,
  validateContactOutcomeSave,
  followUpLabelFromIso,
  shouldShowContactOutcomePanel
} from "./opportunity-contact-outcome-domain.js";
import { normalizeOpportunityFinancials } from "./opportunity-intake-domain.js";
import { buildImportSimplifiedReviewDefaults } from "./import-advert-review-domain.js";
import {
  buildSharedPreviewHtml,
  buildIncomingCooperationItemHtml,
  buildSelectedOfficeChipsHtml,
  buildOfficeSearchResultsHtml
} from "./suitable-offices-ui.js";
import {
  addSelectedOffice,
  removeSelectedOffice,
  uniqueSelectedOfficeIds,
  filterOfficesForCooperationSearch,
  assertSafeCooperationSharePayload
} from "./office-cooperation-ui-domain.js";
import {
  flattenRankedOffices
} from "./suitable-offices-domain.js";
import { openOpportunityReview } from "./opportunity-review.js";

function $(id) {
  return document.getElementById(id);
}

function toast(message) {
  const node = $("toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => node.classList.remove("show"), 2800);
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function officeRuntime() {
  return window.IAQAR?.office || null;
}

function authUser() {
  try {
    return window.firebase?.auth?.()?.currentUser || null;
  } catch {
    return null;
  }
}

function officeId() {
  return officeRuntime()?.officeId || "";
}

function setStatus(message, tone = "") {
  const node = $("opportunityBankStatus");
  if (!node) return;
  node.textContent = message || "";
  node.classList.remove("is-error", "is-done");
  if (tone) node.classList.add(tone);
}

function setShareActionStatus(message, tone = "") {
  const coopNode = document.getElementById("bankCoopSendStatus");
  if (coopNode) {
    coopNode.textContent = message || "";
    coopNode.classList.remove("is-error", "is-done");
    if (tone) coopNode.classList.add(tone);
    return;
  }
  const node = document.getElementById("bankShareStatus");
  if (!node) return setStatus(message, tone);
  node.textContent = message || "";
  node.classList.remove("is-error", "is-done");
  if (tone) node.classList.add(tone);
}

const state = {
  filter: "active", // active | archived
  queryFilters: emptyBankFilters(),
  unsubscribe: null,
  records: new Map(),
  facetMeta: [],
  summary: emptyBankSummary(),
  activeId: null,
  bankReviewOpportunityId: null,
  sourceCache: new Map(),
  lastDoc: null,
  hasMore: false,
  busy: false,
  pendingQueryRefresh: false,
  resultTotal: 0,
  scanExhausted: false,
  detailRenderContext: null
};

function detailRenderContext() {
  return state.detailRenderContext || { panelId: "opportunityBankDetail", dailyTask: false };
}

function isDailyTaskDetail() {
  return Boolean(detailRenderContext().dailyTask);
}

function setDetailRenderContext(options = {}) {
  if (options.dailyTask || options.panelId === "operationsTaskPanel") {
    state.detailRenderContext = {
      panelId: options.panelId || "operationsTaskPanel",
      dailyTask: true
    };
  } else {
    state.detailRenderContext = { panelId: "opportunityBankDetail", dailyTask: false };
  }
}

function clearOtherDetailPanels(activePanelId) {
  for (const id of ["opportunityBankDetail", "operationsTaskPanel"]) {
    if (id === activePanelId) continue;
    const el = document.getElementById(id);
    if (el) {
      el.hidden = true;
      el.innerHTML = "";
    }
  }
}

function closeActiveDetailPanel() {
  const ctx = detailRenderContext();
  const panel = document.getElementById(ctx.panelId);
  if (panel) {
    panel.hidden = true;
    panel.innerHTML = "";
  }
  if (ctx.dailyTask) {
    state.detailRenderContext = null;
    window.dispatchEvent(new CustomEvent("iaqar:daily-task-closed"));
  } else {
    window.dispatchEvent(new CustomEvent("iaqar:nav-close-request"));
  }
}

let activeOutgoingShareKey = "";
const outgoingShareRowsCache = [];

let publicOfficeDirectoryCache = null;

async function loadPublicOfficeDirectory() {
  if (publicOfficeDirectoryCache) return publicOfficeDirectoryCache;
  const runtime = officeRuntime();
  if (!runtime?.db) return [];
  try {
    const snap = await runtime.db.collection("publicOffices").limit(150).get();
    publicOfficeDirectoryCache = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.warn("[iaqar] office directory", error);
    publicOfficeDirectoryCache = [];
  }
  return publicOfficeDirectoryCache;
}

function filterPublicOffices(query, offices, filters = {}) {
  const current = officeId();
  const normalized = String(query || "").trim().toLowerCase();
  const cityFilter = String(filters.city || "").trim().toLowerCase();
  const districtFilter = String(filters.district || "").trim().toLowerCase();
  return offices
    .filter((row) => {
      const id = String(row.officeId || row.id || "").trim().toLowerCase();
      if (!id || id === current) return false;
      const mode = String(row.cooperationMode || "APPROVAL_REQUIRED").toUpperCase();
      if (mode === "DISABLED") return false;
      if (cityFilter && !String(row.city || "").toLowerCase().includes(cityFilter)) return false;
      if (districtFilter && !String(row.district || "").toLowerCase().includes(districtFilter)) return false;
      if (!normalized) return true;
      const name = String(row.officeName || "").toLowerCase();
      const city = String(row.city || "").toLowerCase();
      const district = String(row.district || "").toLowerCase();
      const license = String(row.licenseNumber || "");
      return name.includes(normalized) || city.includes(normalized) || district.includes(normalized) || license.includes(normalized);
    })
    .slice(0, 8);
}

function bindOfficeSearch({ searchInput, hiddenInput, labelNode, resultsNode, cityInput, districtInput }) {
  if (!searchInput || !hiddenInput) return;
  const readFilters = () => ({
    city: cityInput?.value || "",
    district: districtInput?.value || ""
  });
  const renderResults = (rows) => {
    if (!resultsNode) return;
    if (!rows.length) {
      resultsNode.hidden = true;
      resultsNode.innerHTML = "";
      return;
    }
    resultsNode.hidden = false;
    resultsNode.innerHTML = rows.map((row) => {
      const id = String(row.officeId || row.id || "");
      const license = row.licenseNumber ? ` — فال ${escapeHtml(row.licenseNumber)}` : "";
      return `<button type="button" class="bank-office-search-item" data-office-pick="${escapeHtml(id)}">
        <strong>${escapeHtml(row.officeName || id)}</strong>
        <span>${escapeHtml(row.city || "")}${license}</span>
      </button>`;
    }).join("");
    resultsNode.querySelectorAll("[data-office-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const picked = btn.getAttribute("data-office-pick") || "";
        hiddenInput.value = picked;
        if (labelNode) {
          labelNode.hidden = false;
          const district = btn.querySelector("span")?.textContent?.trim() || "";
          const name = btn.querySelector("strong")?.textContent || picked;
          labelNode.textContent = `تم اختيار: ${name}${district ? ` — ${district}` : ""}`;
        }
        searchInput.value = btn.querySelector("strong")?.textContent || picked;
        resultsNode.hidden = true;
        resultsNode.innerHTML = "";
      });
    });
  };
  searchInput.addEventListener("input", async () => {
    hiddenInput.value = "";
    if (labelNode) labelNode.hidden = true;
    const offices = await loadPublicOfficeDirectory();
    renderResults(filterPublicOffices(searchInput.value, offices, readFilters()));
  });
  searchInput.addEventListener("focus", async () => {
    const offices = await loadPublicOfficeDirectory();
    renderResults(filterPublicOffices(searchInput.value, offices, readFilters()));
  });
  if (cityInput) {
    cityInput.addEventListener("input", () => searchInput.dispatchEvent(new Event("input")));
  }
  if (districtInput) {
    districtInput.addEventListener("input", () => searchInput.dispatchEvent(new Event("input")));
  }
}

function facetSourceRecords() {
  if (state.facetMeta.length) return state.facetMeta;
  return [...state.records.values()];
}

function syncFilterControls() {
  /* dropdown filters removed — single search box only */
}

function syncFilterInputsFromState() {
  const search = $("bankFilterSearch");
  if (search) search.value = state.queryFilters.search || "";
}

function passesListFilters(record) {
  return isVisibleForFilter(record) && matchesBankQueryFilters(record, state.queryFilters);
}

function mediaServeUrl(mediaPath) {
  const path = String(mediaPath || "").trim();
  if (!path) return "";
  const base = workerBaseUrl();
  const oid = officeId();
  if (!base || !oid) return "";
  return `${base}/media/office?officeId=${encodeURIComponent(oid)}&path=${encodeURIComponent(path)}`;
}

function renderOpportunityMedia(record = {}) {
  const paths = Array.isArray(record.mediaPaths) ? record.mediaPaths : [];
  const sourcePath = record.sourceMediaPath || "";
  const allPaths = [...paths];
  if (sourcePath && !allPaths.includes(sourcePath)) allPaths.unshift(sourcePath);
  if (!allPaths.length) return "";
  const tiles = allPaths.map((mediaPath) => {
    const isVideo = /video\./i.test(mediaPath);
    if (isVideo) {
      return `<div class="bank-media-item" data-media-path="${escapeHtml(mediaPath)}" data-media-kind="video"></div>`;
    }
    return `<div class="bank-media-item" data-media-path="${escapeHtml(mediaPath)}" data-media-kind="image"></div>`;
  }).join("");
  return `<section class="bank-media-gallery" aria-label="صور وفيديو الفرصة"><h4>الصور والفيديو</h4><div class="bank-media-grid" id="bankDetailMediaGrid">${tiles}</div></section>`;
}

async function hydrateDetailMediaUrls() {
  const grid = document.getElementById("bankDetailMediaGrid");
  const user = authUser();
  if (!grid || !user?.getIdToken) return;
  let token = "";
  try {
    token = await user.getIdToken();
  } catch {
    return;
  }
  const items = grid.querySelectorAll("[data-media-path]");
  for (const item of items) {
    const mediaPath = item.getAttribute("data-media-path") || "";
    const kind = item.getAttribute("data-media-kind") || "image";
    const url = mediaServeUrl(mediaPath);
    if (!url) continue;
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) continue;
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (kind === "video") {
        item.innerHTML = `<video controls preload="metadata" src="${objectUrl}"></video>`;
      } else {
        item.innerHTML = `<img src="${objectUrl}" alt="وسائط الفرصة" loading="lazy">`;
      }
    } catch (error) {
      console.warn("[iaqar] bank media", error);
    }
  }
}

function officeProfileForShare() {
  const office = officeContextForAdvertiser();
  return {
    officeName: office.officeName || office.displayName || "",
    brokerName: office.brokerName || office.displayBroker || "",
    licenseNumber: office.licenseNumber || office.falLicense || "",
    publicSlug: office.publicSlug || "",
    officeId: office.officeId || officeId(),
    phone: office.phone || office.mobile || ""
  };
}

function stopListener() {
  if (state.unsubscribe) {
    try { state.unsubscribe(); } catch (_) {}
    state.unsubscribe = null;
  }
}

function isVisibleForFilter(record) {
  if (record.deletedAt || record.lifecycleStatus === LIFECYCLE.DELETED) return false;
  if (state.filter === "archived") {
    return record.lifecycleStatus === LIFECYCLE.ARCHIVED || Boolean(record.archivedAt);
  }
  // active
  if (record.lifecycleStatus === LIFECYCLE.ARCHIVED) return false;
  if (record.archivedAt && record.lifecycleStatus !== LIFECYCLE.ACTIVE) return false;
  return true;
}


function bankRowHtml(row) {
  const record = state.records.get(row.id) || row;
  const card = buildBankListCardView({ ...record, id: row.id });
  const inner = buildOpportunityListingCardInnerHtml({ ...record, id: row.id });
  return `
    <article
      class="bank-row bank-row-card"
      role="button"
      tabindex="0"
      data-opportunity-id="${escapeHtml(card.opportunityId || row.id)}"
      data-open-id="${escapeHtml(card.opportunityId || row.id)}"
      aria-label="${escapeHtml(card.ariaLabel)} — ${escapeHtml(card.headerStatus)}">
      ${inner}
    </article>`;
}

function isOwnerRecord(record = {}) {
  const kind = String(record.opportunityKind || record.kind || record.recordType || "").toUpperCase();
  return record.contactType === "owner"
    || kind === "OWNER"
    || kind === "OWNER_OFFER"
    || kind === "OFFER";
}

let bankDetailOpenLock = "";

const BANK_MISSING_FIELD_SELECTORS = Object.freeze({
  propertyType: 'input[name="propertyType"]',
  city: 'input[name="city"]',
  district: 'input[name="district"]',
  priceOrBudget: 'input[name="priceOrBudget"]',
  purpose: 'input[name="purpose"]',
  contactPhone: 'input[name="advertiserPhoneLocal"]',
  advertiserRole: '[name="advertiserRole"]'
});

function resolveBankRowOpportunityId(node) {
  if (!node) return "";
  return String(node.getAttribute("data-opportunity-id") || "").trim();
}

function canOpenBankOpportunity(record) {
  if (!record) return false;
  const currentOffice = officeId();
  const owner = String(record.officeId || currentOffice);
  const origin = String(record.originatingOfficeId || "").trim();
  return owner === currentOffice || origin === currentOffice;
}

function revealIncompleteEditForm(readiness = {}) {
  const section = document.getElementById("bankIncompleteEditSection");
  const saveWrap = document.getElementById("bankUnifiedSaveWrap");
  if (section) section.hidden = false;
  if (saveWrap) saveWrap.hidden = false;
  window.requestAnimationFrame(() => focusFirstMissingBankField(readiness));
}

function focusFirstMissingBankField(readiness = {}, preferredKey = "") {
  let missing = Array.isArray(readiness.matchingReadinessMissing)
    ? readiness.matchingReadinessMissing
    : [];
  const preferred = String(preferredKey || "").trim();
  if (preferred && missing.includes(preferred)) {
    missing = [preferred, ...missing.filter((key) => key !== preferred)];
  }
  if (!missing.length) return false;

  const section = document.getElementById("bankIncompleteEditSection");
  const saveWrap = document.getElementById("bankUnifiedSaveWrap");
  if (section) section.hidden = false;
  if (saveWrap) saveWrap.hidden = false;

  const form = $("bankUnifiedForm");
  for (const key of missing) {
    const selector = BANK_MISSING_FIELD_SELECTORS[key];
    if (!selector) continue;
    const field = form?.querySelector(selector) || document.querySelector(selector);
    if (!field) continue;
    const sectionNode = field.closest("details.bank-section");
    if (sectionNode) sectionNode.open = true;
    field.scrollIntoView({ behavior: "smooth", block: "center" });
    try {
      field.focus({ preventScroll: true });
    } catch (_) {
      field.focus();
    }
    return true;
  }
  return false;
}

async function openBankDetailFromList(opportunityId) {
  const id = String(opportunityId || "").trim();
  if (!id || bankDetailOpenLock === id) return;
  const record = state.records.get(id);
  if (!record || !canOpenBankOpportunity(record)) {
    toast("لا يمكن فتح هذه الفرصة من هذا المكتب");
    return;
  }
  bankDetailOpenLock = id;
  try {
    await renderDetail(id);
    scrollBankDetailIntoView();
  } finally {
    window.setTimeout(() => {
      if (bankDetailOpenLock === id) bankDetailOpenLock = "";
    }, 400);
  }
}

function scrollBankDetailIntoView() {
  const ctx = detailRenderContext();
  const panel = document.getElementById(ctx.panelId);
  if (!panel || panel.hidden) return;
  window.requestAnimationFrame(() => {
    if (ctx.dailyTask) {
      const workspace = document.getElementById("workspace");
      const detailView = document.getElementById("opsViewOpportunityDetail");
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const behavior = reduced ? "auto" : "smooth";
      if (detailView) {
        detailView.scrollIntoView({ behavior, block: "start" });
      }
      if (workspace) {
        workspace.scrollIntoView({ behavior: "auto", block: "start" });
      }
      panel.scrollIntoView({ behavior, block: "start" });
      return;
    }
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

async function loadWorkspaceBundle(opportunityId) {
  const user = authUser();
  if (!user?.getIdToken) return {};
  try {
    const token = await user.getIdToken();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 12000);
    const response = await fetch(`${workerBaseUrl()}/opportunity/workspace`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Office-Id": officeId()
      },
      body: JSON.stringify({ officeId: officeId(), opportunityId })
    });
    window.clearTimeout(timeoutId);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.warn("[iaqar] workspace bundle", payload);
      return {};
    }
    if (payload.opportunity) {
      state.records.set(opportunityId, { ...payload.opportunity, id: opportunityId });
    }
    return payload;
  } catch (error) {
    console.warn("[iaqar] workspace bundle", error);
    return {};
  }
}

function renderSummaryHtml(summary = emptyBankSummary()) {
  const activeKey = state.queryFilters.summaryKey || "ready";
  const chip = (key, label, count) => {
    const active = activeKey === key ? " is-active" : "";
    return `<button type="button" class="bank-summary-chip${active}" data-summary-key="${key}">
      <span>${escapeHtml(label)}</span><strong>${escapeHtml(count)}</strong>
    </button>`;
  };
  const needsCount = Number(summary.needsCompletion || 0);
  const tasksBanner = needsCount > 0 && state.filter !== "archived"
    ? `<div class="bank-tasks-banner">
        <p>${escapeHtml(String(needsCount))} فرصة تحتاج استكمال — أكملها من المهام اليومية</p>
        <button type="button" class="bank-tasks-banner-btn" data-bank-open-tasks>اذهب للمهام</button>
      </div>`
    : "";
  return `
    <div class="bank-summary-card" id="bankSummaryCard">
      ${tasksBanner}
      <div class="bank-summary-chips">
        ${chip("ready", "جاهزة للمطابقة", summary.readyForMatching)}
        ${chip("archived", "مؤرشفة", summary.archived)}
      </div>
    </div>`;
}

function renderList() {
  const list = $("opportunityBankList");
  const loadMoreBtn = $("bankLoadMoreBtn");
  if (!list) return;

  const summary = state.summary || emptyBankSummary();

  const rows = [...state.records.entries()]
    .filter(([, record]) => passesListFilters(record))
    .map(([id, record]) => ({
      ...bankListItem(id, record),
      matchingReadiness: evaluateMatchingReadiness(record).matchingReadiness
    }));

  let bodyHtml = "";
  if (!rows.length && !hasActiveBankQuery(state.queryFilters)) {
    const needsCount = Number(summary.needsCompletion || 0);
    if (state.filter !== "archived" && needsCount > 0) {
      bodyHtml = `<p class="bank-query-hint">لا توجد فرص جاهزة للمطابقة حاليًا. ${escapeHtml(String(needsCount))} فرصة تحتاج استكمال — أكملها من المهام اليومية.</p>`;
    } else {
      bodyHtml = `<p class="bank-query-hint">لا توجد فرص محفوظة بعد. تُحفظ الفرص هنا تلقائيًا عند إضافتها.</p>`;
    }
    if (loadMoreBtn) loadMoreBtn.hidden = true;
  } else if (!rows.length) {
    bodyHtml = `<p class="bank-query-hint">لا توجد نتائج مطابقة. عدّل البحث.</p>`;
    if (loadMoreBtn) loadMoreBtn.hidden = !state.hasMore;
  } else {
    const loadedCount = rows.length;
    const filteredTotal = state.resultTotal > 0 ? state.resultTotal : loadedCount;
    const totalLabel = loadedCount < filteredTotal || state.hasMore
      ? `عرض ${escapeHtml(String(loadedCount))} من ${escapeHtml(String(filteredTotal))} فرصة`
      : `${escapeHtml(String(filteredTotal))} نتيجة`;
    const rowsHtml = rows.map((row) => bankRowHtml(row)).join("");
    bodyHtml = `<p class="bank-results-count" id="bankResultsCount">${escapeHtml(totalLabel)}</p>${rowsHtml}`;
    if (loadMoreBtn) loadMoreBtn.hidden = !state.hasMore;
  }

  list.innerHTML = "";
  const summaryNode = document.createElement("div");
  summaryNode.innerHTML = renderSummaryHtml(summary);
  list.appendChild(summaryNode.firstElementChild || summaryNode);
  const bodyWrap = document.createElement("div");
  bodyWrap.innerHTML = bodyHtml;
  while (bodyWrap.firstChild) list.appendChild(bodyWrap.firstChild);
  bindSummaryChips(list);
}

function bindSummaryChips(root) {
  root?.querySelector("[data-bank-open-tasks]")?.addEventListener("click", () => {
    navigateToTasksIncomplete();
  });
  root?.querySelectorAll("[data-summary-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-summary-key") || "ready";
      if (key === "archived") {
        state.filter = "archived";
        state.queryFilters.summaryKey = "archived";
        syncFilterButtons();
      } else {
        state.filter = "active";
        state.queryFilters.summaryKey = "ready";
        syncFilterButtons();
      }
      renderList();
      if (hasActiveBankQuery(state.queryFilters)) scheduleBankQueryRefresh();
    });
  });
}

function navigateToTasksIncomplete(opportunityId = "") {
  const bankRoot = $("opportunityBank");
  const settings = $("officeSettings");
  if (bankRoot && !bankRoot.hidden && !isInlineBankRoot()) {
    stopListener();
    bankRoot.hidden = true;
    if (state.activeId) closeBankDetailInternal();
  }
  if (settings && !settings.hidden) {
    settings.hidden = true;
    document.body.style.overflow = "";
  }
  if (isInlineBankRoot()) {
    window.IAQAR?.homeTabs?.switchTo("operations");
  }
  window.dispatchEvent(new CustomEvent("iaqar:open-operations-category", {
    detail: {
      categoryKey: "incomplete",
      opportunityId: String(opportunityId || "").trim()
    }
  }));
  document.getElementById("workspace")?.scrollIntoView({ behavior: "auto", block: "start" });
  toast(opportunityId ? "افتح استكمال البيانات من المهام" : "انتقل إلى المهام اليومية");
}

async function lazyLoadSource(record) {
  if (!record?.sourceReference) return null;
  if (state.sourceCache.has(record.sourceReference)) {
    return state.sourceCache.get(record.sourceReference);
  }
  const runtime = officeRuntime();
  if (!runtime?.db) return null;
  const snap = await runtime.db.collection("offices").doc(officeId())
    .collection("opportunitySources").doc(record.sourceReference).get();
  const data = snap.exists ? snap.data() : null;
  state.sourceCache.set(record.sourceReference, data);
  return data;
}

function closeBankDetailInternal() {
  if (!state.activeId) return false;
  state.activeId = null;
  const panel = $("opportunityBankDetail");
  if (panel) {
    panel.hidden = true;
    panel.innerHTML = "";
  }
  window.IAQAR?.navigation?.updateBackButton?.();
  window.dispatchEvent(new CustomEvent("iaqar:navigation-changed"));
  return true;
}

function isOwnedOpportunityRecord(record) {
  const current = officeId();
  const owner = String(record?.officeId || current);
  const origin = String(record?.originatingOfficeId || "").trim();
  return owner === current && (!origin || origin === current);
}

function officeContextForAdvertiser() {
  return window.IAQAR?.office || {};
}

function officePublicLink() {
  const office = officeContextForAdvertiser();
  return officeLinkFor({
    origin: window.location.origin,
    publicSlug: office.publicSlug || "",
    officeId: office.officeId || officeId()
  });
}

function openBankAdvertiserWhatsApp(record, phone) {
  if (!phone) return;
  const digits = whatsappDigitsFromE164(phone);
  if (!digits) {
    toast("رقم الجوال غير مكتمل");
    return;
  }
  const office = officeContextForAdvertiser();
  const displayName = readAdvertiserDisplayName(record);
  const message = buildAdvertiserWhatsAppMessage({
    brokerName: office.brokerName || office.displayBroker || "",
    officeName: office.officeName || office.displayName || "",
    licenseNumber: office.licenseNumber || office.falLicense || "",
    propertyType: record.propertyType || "",
    district: record.district || "",
    city: record.city || "",
    officeLink: officePublicLink(),
    advertiserDisplayName: displayName
  });
  openWhatsApp({ phone: digits, text: message });
  const opportunityId = record.id || state.activeId;
  if (!opportunityId) return;
  void recordLifecycleWhatsAppOpened(opportunityId);
}

async function recordLifecycleWhatsAppOpened(opportunityId) {
  const user = authUser();
  if (!user?.getIdToken) return;
  try {
    const payload = await postOpportunityLifecycle(opportunityId, { action: "whatsapp_opened" });
    syncBankRecordFromLifecyclePayload(opportunityId, payload, "contact:whatsapp");
  } catch (error) {
    console.warn("[iaqar] whatsapp opened log", error);
  }
}

function isBankDetailOpen() {
  return Boolean(state.activeId);
}

async function renderDetail(id, options = {}) {
  if (options.panelId || options.dailyTask) {
    setDetailRenderContext(options);
  } else if (!state.detailRenderContext) {
    setDetailRenderContext({ dailyTask: false });
  }
  const ctx = detailRenderContext();
  const panel = document.getElementById(ctx.panelId);
  if (!panel) return;
  const record = state.records.get(id);
  if (!record) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }

  setStatus("جارٍ تجهيز التفاصيل…");
  state.activeId = id;
  clearOtherDetailPanels(ctx.panelId);
  panel.hidden = false;

  const archived = record.lifecycleStatus === LIFECYCLE.ARCHIVED || Boolean(record.archivedAt);
  const readiness = evaluateMatchingReadiness(record);

  if (archived) {
    const { html: detailsHtml } = buildOpportunityDetailsCoreHtml(id, record, readiness);
    panel.innerHTML = `
      <div class="bank-detail-head iaqar-workflow-head">
        <h3>تفاصيل الفرصة (مؤرشفة)</h3>
        <button type="button" class="settings-close iaqar-workflow-close" id="bankDetailClose" aria-label="إغلاق">×</button>
      </div>
      ${detailsHtml}
      <p class="bank-note opp-details-archived-note">قراءة فقط — ${escapeHtml(record.closureReason || "مؤرشفة")}</p>`;
    $("bankDetailClose")?.addEventListener("click", () => closeActiveDetailPanel());
    scrollBankDetailIntoView();
    if (!ctx.dailyTask) {
      setStatus(`${rowsCountLabel()} — تم فتح التفاصيل`);
      window.dispatchEvent(new CustomEvent("iaqar:nav-open", { detail: { view: "bank-detail" } }));
      window.IAQAR?.navigation?.updateBackButton?.();
    }
    return;
  }

  if (!readiness.isReadyForMatching) {
    panel.innerHTML = buildNeedsCompletionDetailHtml(id, record, readiness);
    wireIncompleteDetailHandlers(id, record);
    scrollBankDetailIntoView();
    if (!ctx.dailyTask) {
      setStatus(`${rowsCountLabel()} — تم فتح التفاصيل`);
      window.dispatchEvent(new CustomEvent("iaqar:nav-open", { detail: { view: "bank-detail" } }));
      window.IAQAR?.navigation?.updateBackButton?.();
    }
    return;
  }

  panel.innerHTML = `<div class="bank-detail-loading"><p>جارٍ تجهيز التفاصيل…</p></div>`;
  await loadOutgoingScopes();
  const bundle = await loadWorkspaceBundle(id);
  const enrichedBundle = {
    ...bundle,
    cooperationRequests: mergeUniqueCooperationRequests(
      bundle.cooperationRequests || [],
      cooperationRequestsFromOutgoingCache(id)
    )
  };
  const freshRecord = state.records.get(id) || record;
  panel.innerHTML = buildReadyWorkspaceHtml(id, freshRecord, enrichedBundle, {
    officeProfile: officeProfileForShare(),
    origin: window.location.origin,
    ownOfficeId: officeId()
  });
  wireWorkspaceHandlers(id, freshRecord, enrichedBundle);
  applyBankBrokerMarks(freshRecord);
  applyWorkspaceLifecycleFlow(id, freshRecord, enrichedBundle);
  scrollBankDetailIntoView();
  if (!ctx.dailyTask) {
    setStatus(`${rowsCountLabel()} — تم فتح التفاصيل`);
    window.dispatchEvent(new CustomEvent("iaqar:nav-open", { detail: { view: "bank-workspace" } }));
    window.IAQAR?.navigation?.updateBackButton?.();
  }
}

function syncWorkspaceActionLayout() {
  /* side panel removed — primary actions live in main column */
}

let listingShareActivityBusy = false;
let partyActionActivityBusy = false;

function bankBrokerProgress() {
  return window.IAQAR?.brokerActionProgress || {};
}

function mergeBankRecordProgress(record = {}, actionKey = "", followPatch = null) {
  let next = record;
  const bap = bankBrokerProgress();
  if (actionKey) next = bap.markBrokerActionDoneLocally?.(next, actionKey) || next;
  if (followPatch) next = bap.markFollowUpProgressLocally?.(next, followPatch) || next;
  return next;
}

function applyBankBrokerMarks(record = {}) {
  const panel = document.getElementById(detailRenderContext().panelId);
  bankBrokerProgress().applyBrokerActionMarks?.(panel, record);
}

function syncBankRecordFromLifecyclePayload(opportunityId, payload = {}, actionKey = "", followPatch = null) {
  const existing = state.records.get(opportunityId) || {};
  let merged = {
    ...existing,
    ...payload,
    followUp: payload.followUp || existing.followUp,
    brokerActionProgress: payload.brokerActionProgress || existing.brokerActionProgress
  };
  merged = mergeBankRecordProgress(merged, actionKey, followPatch);
  state.records.set(opportunityId, merged);
  applyBankBrokerMarks(merged);
  return merged;
}

async function recordBrokerActionDone(opportunityId, actionKey, recordPatch = {}) {
  if (!actionKey) return;
  const existing = state.records.get(opportunityId) || {};
  let merged = mergeBankRecordProgress({ ...existing, ...recordPatch }, actionKey);
  state.records.set(opportunityId, merged);
  applyBankBrokerMarks(merged);
  try {
    const payload = await postOpportunityLifecycle(opportunityId, {
      action: "broker_action_done",
      actionKey
    });
    syncBankRecordFromLifecyclePayload(opportunityId, payload, actionKey);
  } catch (error) {
    console.warn("[iaqar] broker action progress", error);
  }
}

function cooperationRequestsFromOutgoingCache(opportunityId = "") {
  const oppId = String(opportunityId || "").trim();
  if (!oppId) return [];
  return outgoingShareRowsCache
    .filter((row) => Array.isArray(row.opportunityIds) && row.opportunityIds.includes(oppId))
    .map((row) => ({
      id: row.id,
      status: row.status,
      targetOfficeId: row.targetOfficeId,
      targetOfficeName: row.officeLabel || row.targetOfficeId,
      originatingOfficeId: officeId(),
      shareKind: row.shareKind
    }));
}

function renderWorkspaceCoopList(opportunityId, record = {}, bundle = {}) {
  const list = document.getElementById("bankWorkspaceCoopList");
  if (!list) return;
  const requests = mergeWorkspaceCooperationRequests(
    record,
    mergeUniqueCooperationRequests(
      bundle.cooperationRequests || [],
      cooperationRequestsFromOutgoingCache(opportunityId)
    ),
    officeId()
  );
  const rowsHtml = buildWorkspaceCoopRowsHtml(requests, { ownOfficeId: officeId() });
  list.innerHTML = rowsHtml || buildWorkspaceCoopEmptyHintHtml();
  wireWorkspaceCoopRowHandlers(opportunityId, record, { ...bundle, cooperationRequests: requests });
}

function setWorkspaceCoopStatus(message = "", tone = "") {
  const node = document.getElementById("bankWorkspaceCoopStatus");
  if (!node) return;
  node.textContent = message || "";
  node.hidden = !message;
  node.classList.remove("is-error", "is-done");
  if (tone) node.classList.add(tone);
}

async function refreshWorkspaceCoopSection(opportunityId, recordPatch = {}) {
  const existing = state.records.get(opportunityId) || {};
  const mergedRecord = { ...existing, ...recordPatch };
  if (Object.keys(recordPatch).length) {
    state.records.set(opportunityId, mergedRecord);
  }
  await loadOutgoingScopes();
  const bundle = await loadWorkspaceBundle(opportunityId);
  const record = state.records.get(opportunityId) || mergedRecord;
  renderWorkspaceCoopList(opportunityId, record, bundle);
  applyWorkspaceLifecycleFlow(opportunityId, record, {
    ...bundle,
    cooperationRequests: mergeUniqueCooperationRequests(
      bundle.cooperationRequests || [],
      cooperationRequestsFromOutgoingCache(opportunityId)
    )
  });
  return bundle;
}

function showWorkspaceSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return null;
  section.hidden = false;
  section.classList.add("is-open");
  section.classList.remove("is-collapsed");
  const toggle = section.querySelector(".bank-workspace-collapsible-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "true");
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  return section;
}

function openWorkspaceCollapsible(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  section.classList.add("is-open");
  section.classList.remove("is-collapsed");
  const toggle = section.querySelector(".bank-workspace-collapsible-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "true");
}

function runWorkspaceNextAction(opportunityId, record, bundle = {}, actionKey = "") {
  const action = String(actionKey || "").trim();
  if (!action) return;

  if (action === "complete_fields") {
    $("oppDetailsRevealFormBtn")?.click();
    revealIncompleteEditForm(evaluateMatchingReadiness(state.records.get(opportunityId) || record));
    return;
  }
  if (action === "complete_deal") {
    if (window.IAQAR?.openOpportunityManagement) {
      void window.IAQAR.openOpportunityManagement(opportunityId);
    }
    return;
  }
  if (action === "close_opportunity") {
    document.querySelector('[data-workspace-action="open_lifecycle_close"]')?.click();
    openWorkspaceCollapsible("bankWorkspaceCloseSection");
    showWorkspaceSection("bankWorkspaceCloseSection");
    return;
  }
  if (action === "confirm_followup" || action === "schedule_followup") {
    showWorkspaceSection("bankWorkspaceFollowUpSection");
    return;
  }
  if (action === "record_contact") {
    showWorkspaceSection("bankWorkspaceContactSection");
    return;
  }
  if (action === "review_matches") {
    document.querySelector('[data-workspace-action="search_matches"]')?.click();
    return;
  }
  if (action === "request_cooperation") {
    openOfficeShareFlow(opportunityId, state.records.get(opportunityId) || record);
    return;
  }
}

function wireWorkspaceUxPresentation(opportunityId, record, bundle = {}) {
  document.querySelectorAll(".bank-workspace-collapsible-toggle").forEach((toggle) => {
    if (toggle.dataset.uxWired === "1") return;
    toggle.dataset.uxWired = "1";
    toggle.addEventListener("click", () => {
      const section = toggle.closest(".bank-workspace-collapsible");
      if (!section) return;
      const open = section.classList.toggle("is-open");
      section.classList.toggle("is-collapsed", !open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });

  const nextBtn = $("bankWorkspaceNextActionBtn");
  if (nextBtn && nextBtn.dataset.uxWired !== "1") {
    nextBtn.dataset.uxWired = "1";
    nextBtn.addEventListener("click", () => {
      runWorkspaceNextAction(
        opportunityId,
        record,
        bundle,
        nextBtn.getAttribute("data-next-action") || ""
      );
    });
  }

  document.querySelectorAll(".bank-workspace-ux-missing-chip[data-missing-field]").forEach((chip) => {
    if (chip.dataset.uxWired === "1") return;
    chip.dataset.uxWired = "1";
    chip.addEventListener("click", () => {
      const key = chip.getAttribute("data-missing-field") || "";
      const fresh = state.records.get(opportunityId) || record;
      const readiness = evaluateMatchingReadiness(fresh);
      revealIncompleteEditForm(readiness);
      focusFirstMissingBankField(readiness, key);
    });
  });
}

function openOfficeShareFlow(opportunityId, record) {
  showWorkspaceSection("bankWorkspaceCoopSection");
  const search = $("bankCoopOfficesSearch");
  if (search) search.focus();
  void loadCooperationOfficesForShare(opportunityId, record);
  void recordBrokerActionDone(opportunityId, "workspace:send_and_share");
}

function applyWorkspaceLifecycleFlow(id, record = {}, bundle = {}) {
  const progress = record.brokerActionProgress || {};
  const requests = mergeWorkspaceCooperationRequests(record, bundle.cooperationRequests || [], officeId());
  const hasActiveCoop = activeWorkspaceCooperationRequests(requests).length > 0;
  const matches = sortMatchesForWorkspace(bundle.matches || [], id);
  const outcome = String(record.lastContactOutcome || record.advertiserContactStatus || "").toUpperCase();
  const contactAttempted = Boolean(
    record.lastWhatsAppOpenedAt
    || record.lastCallOpenedAt
    || record.lastContactAt
    || progress["party:whatsapp"]
    || progress["party:call"]
  );

  const hint = document.getElementById("bankWorkspaceCoopHint");
  if (hint) {
    hint.hidden = hasActiveCoop;
  }

  if (progress["workspace:search_matches"] && matches.length) {
    const matchesSection = document.getElementById("bankWorkspaceMatchesSection");
    if (matchesSection) matchesSection.hidden = false;
  }

  if (progress["workspace:send_and_share"]) {
    showWorkspaceSection("bankWorkspaceCoopSection");
  }

  if (contactAttempted) {
    const contactSection = document.getElementById("bankWorkspaceContactSection");
    if (contactSection && shouldShowContactOutcomePanel(record)) {
      contactSection.hidden = false;
    }
  }

  const followUp = bundle.followUp || activeFollowUpFromRecord(record);
  if (followUp?.at) {
    showWorkspaceSection("bankWorkspaceFollowUpSection");
  }

  if (outcome === "REFUSED" || outcome === "AGREED" || progress["workspace:manage_opportunity"]) {
    showWorkspaceSection("bankWorkspaceCloseSection");
  }
}

function wireWorkspaceCoopRowHandlers(id, record, bundle = {}) {
  document.querySelectorAll("[data-open-coop-room]").forEach((btn) => {
    if (btn.getAttribute("data-coop-wired") === "1") return;
    btn.setAttribute("data-coop-wired", "1");
    btn.addEventListener("click", () => {
      void openCooperationRoom(id, btn.getAttribute("data-open-coop-room"));
    });
  });
  document.querySelectorAll("[data-cancel-coop-request]").forEach((btn) => {
    if (btn.getAttribute("data-coop-wired") === "1") return;
    btn.setAttribute("data-coop-wired", "1");
    btn.addEventListener("click", () => {
      const requestId = btn.getAttribute("data-cancel-coop-request") || "";
      if (!requestId) return;
      void cancelOutgoingCooperationRequest(id, requestId);
    });
  });
}

async function cancelOutgoingCooperationRequest(opportunityId, requestId) {
  setWorkspaceCoopStatus("جارٍ إلغاء الطلب…");
  try {
    const result = await runTrustedCooperationLifecycle(requestId, "REVOKE", "broker_cancelled_share");
    if (!result.ok) {
      setWorkspaceCoopStatus(result.message || "تعذر إلغاء الطلب", "is-error");
      return;
    }
    setWorkspaceCoopStatus("تم إلغاء طلب المشاركة", "is-done");
    toast("تم إلغاء طلب المشاركة");
    await refreshWorkspaceCoopSection(opportunityId, {
      activeCooperationId: "",
      cooperationState: "NOT_SHARED",
      cooperationStatus: "NOT_SHARED"
    });
    await loadOutgoingScopes();
  } catch (error) {
    console.warn("[iaqar] cancel cooperation request", error);
    setWorkspaceCoopStatus(error?.message || "تعذر إلغاء الطلب", "is-error");
  }
}

function appendCoopRowToWorkspace(targetOfficeId, officeName, status = "PENDING", requestId = "") {
  const record = state.records.get(state.activeId) || {};
  const fallbackRequests = mergeWorkspaceCooperationRequests(record, [], officeId());
  const nextRequests = [...fallbackRequests];
  const target = String(targetOfficeId || "").trim();
  if (target && !nextRequests.some((row) => String(row.targetOfficeId || "") === target)) {
    nextRequests.unshift({
      id: requestId || record.activeCooperationId || "",
      status,
      targetOfficeId: target,
      targetOfficeName: officeName || target,
      originatingOfficeId: officeId()
    });
  }
  renderWorkspaceCoopList(state.activeId || "", {
    ...record,
    cooperationTargetOfficeId: target,
    cooperationTargetOfficeName: officeName || target,
    activeCooperationId: requestId || record.activeCooperationId || ""
  }, { cooperationRequests: nextRequests });
}

function openPartyWhatsAppWithMessage(record, phone, message) {
  if (!phone) {
    toast("أكمل رقم الجوال أولًا");
    return false;
  }
  const digits = whatsappDigitsFromE164(phone);
  if (!digits) {
    toast("رقم الجوال غير مكتمل");
    return false;
  }
  openWhatsApp({ phone: digits, text: String(message || "") });
  return true;
}

async function recordWorkspaceLifecycleAction(opportunityId, action, extra = {}) {
  try {
    await postOpportunityLifecycle(opportunityId, { action, ...extra });
  } catch (error) {
    console.warn("[iaqar] workspace lifecycle", error);
  }
}

async function logListingShareActivity(opportunityId, channel) {
  if (listingShareActivityBusy) return;
  const text = listingShareActivityText(channel);
  if (!text) return;
  listingShareActivityBusy = true;
  try {
    const action = channel === "whatsapp" ? "listing_shared_whatsapp" : "listing_copied";
    const actionKey = channel === "whatsapp" ? "hub:share_whatsapp_listing" : "hub:copy_listing_text";
    const payload = await postOpportunityLifecycle(opportunityId, { action });
    syncBankRecordFromLifecyclePayload(opportunityId, payload, actionKey);
    appendWorkspaceActivityLine(text);
    applyBankBrokerMarks(state.records.get(opportunityId) || {});
  } finally {
    listingShareActivityBusy = false;
  }
}

async function logPartyActionActivity(opportunityId, actionId) {
  if (partyActionActivityBusy) return;
  const text = partyActionActivityText(actionId);
  if (!text) return;
  partyActionActivityBusy = true;
  try {
    const bap = bankBrokerProgress();
    const actionKey = bap.partyActionKey?.(actionId) || (actionId === "party_whatsapp" ? "party:whatsapp" : actionId === "party_call" ? "party:call" : `party:${actionId}`);
    const payload = await postOpportunityLifecycle(opportunityId, { action: "party_action", partyAction: actionId });
    syncBankRecordFromLifecyclePayload(opportunityId, payload, actionKey);
    appendWorkspaceActivityLine(text);
    applyBankBrokerMarks(state.records.get(opportunityId) || {});
  } finally {
    partyActionActivityBusy = false;
  }
}

async function runWorkspaceMatchingSearch(opportunityId, bundleRef = {}) {
  const statusNode = document.getElementById("bankMatchesStatus");
  if (statusNode) statusNode.textContent = "جارٍ البحث عن مطابقة…";
  await rematchOpportunity(opportunityId, { reason: "workspace_search" });
  const freshBundle = await loadWorkspaceBundle(opportunityId);
  Object.assign(bundleRef, freshBundle);
  const list = document.querySelector("#bankWorkspaceMatchesSection .bank-workspace-match-list");
  if (list) {
    list.innerHTML = buildWorkspaceMatchRowsHtml(opportunityId, freshBundle.matches || []);
    wireWorkspaceMatchRowHandlers(opportunityId, state.records.get(opportunityId) || {}, freshBundle);
  }
  const count = sortMatchesForWorkspace(freshBundle.matches || [], opportunityId).length;
  if (statusNode) {
    statusNode.textContent = count
      ? `تم العثور على ${count} مطابقة مرتبة حسب نسبة التطابق.`
      : "لا توجد مطابقات مناسبة حاليًا.";
  }
  void recordBrokerActionDone(opportunityId, "workspace:search_matches");
  applyWorkspaceLifecycleFlow(opportunityId, state.records.get(opportunityId) || {}, freshBundle);
}

function wireWorkspaceMatchRowHandlers(id, record, bundle = {}) {
  document.querySelectorAll("[data-match-id]").forEach((btn) => {
    if (btn.getAttribute("data-match-wired") === "1") return;
    btn.setAttribute("data-match-wired", "1");
    btn.addEventListener("click", async () => {
      const matchId = btn.getAttribute("data-match-id");
      const counterpartId = btn.getAttribute("data-counterpart-id");
      const matches = sortMatchesForWorkspace(bundle.matches || [], id);
      const match = matches.find((row) => row.matchId === matchId) || {};
      let counterpart = {};
      if (counterpartId) {
        const runtime = officeRuntime();
        if (runtime?.db) {
          const snap = await runtime.db.collection("offices").doc(officeId())
            .collection("opportunities").doc(counterpartId).get();
          if (snap.exists) counterpart = snap.data() || {};
        }
      }
      const panel = document.getElementById("bankMatchComparisonPanel");
      if (!panel) return;
      panel.hidden = false;
      panel.innerHTML = `${buildMatchComparisonHtml(state.records.get(id) || record, counterpart, match)}
        <div class="bank-workspace-actions iaqar-workflow-actions">
          ${counterpartId ? `<button type="button" class="bank-action iaqar-workflow-btn secondary" id="bankOpenCounterpartBtn">فتح الفرصة المطابقة</button>` : ""}
        </div>`;
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("bankMatchComparisonClose")?.addEventListener("click", () => {
        panel.hidden = true;
        panel.innerHTML = "";
      }, { once: true });
      document.getElementById("bankOpenCounterpartBtn")?.addEventListener("click", () => {
        if (counterpartId) void renderDetail(counterpartId);
      }, { once: true });
    });
  });
}

async function executePartyContactAction(actionId, opportunityId, record, bundle = {}) {
  const fresh = state.records.get(opportunityId) || record;
  const phone = readAdvertiserPhoneFromRecord(fresh).phone;
  const actionDef = partyContactActions(fresh).find((row) => row.id === actionId);
  if (!actionDef) return;

  if (actionId === "party_call") {
    if (!phone) return toast("أكمل رقم الجوال أولًا");
    const local = formatLocalPhoneDisplay(phone);
    if (!local) return toast("رقم الجوال غير مكتمل");
    window.location.href = `tel:${local}`;
    void recordLifecycleCallOpened(opportunityId);
    await logPartyActionActivity(opportunityId, actionId);
    return;
  }

  if (actionId === "party_whatsapp") {
    openBankAdvertiserWhatsApp(fresh, phone);
    await logPartyActionActivity(opportunityId, actionId);
    return;
  }

  if (actionDef.type === "whatsapp_message") {
    const preset = partyWhatsAppPresetMessage(actionId, fresh);
    const greeting = buildAdvertiserWhatsAppMessage({
      brokerName: officeContextForAdvertiser().brokerName || "",
      officeName: officeContextForAdvertiser().officeName || "",
      licenseNumber: officeContextForAdvertiser().licenseNumber || "",
      propertyType: fresh.propertyType || "",
      district: fresh.district || "",
      city: fresh.city || "",
      officeLink: officePublicLink(),
      advertiserDisplayName: readAdvertiserDisplayName(fresh)
    });
    const message = preset || greeting;
    if (openPartyWhatsAppWithMessage(fresh, phone, message)) {
      void recordLifecycleWhatsAppOpened(opportunityId);
      await logPartyActionActivity(opportunityId, actionId);
    }
    return;
  }

  if (actionDef.type === "manage" || actionId === "party_update_property") {
    if (window.IAQAR?.openOpportunityManagement) {
      void window.IAQAR.openOpportunityManagement(opportunityId);
    }
    await logPartyActionActivity(opportunityId, actionId);
    return;
  }

  if (actionId === "party_schedule_viewing") {
    const section = document.getElementById("bankWorkspaceFollowUpSection");
    if (section) {
      section.hidden = false;
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    await logPartyActionActivity(opportunityId, actionId);
    return;
  }

  if (actionId === "party_record_contact") {
    const section = document.getElementById("bankWorkspaceContactSection");
    if (section) {
      section.hidden = false;
      section.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    await logPartyActionActivity(opportunityId, actionId);
    return;
  }

  if (actionId === "party_send_suggested") {
    await runWorkspaceMatchingSearch(opportunityId, bundle);
    const section = document.getElementById("bankWorkspaceMatchesSection");
    if (section) {
      section.hidden = false;
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    await logPartyActionActivity(opportunityId, actionId);
    return;
  }

  if (actionId === "party_property_found") {
    if (window.IAQAR?.openOpportunityManagement) {
      void window.IAQAR.openOpportunityManagement(opportunityId);
    }
    await logPartyActionActivity(opportunityId, actionId);
  }
}

function wireIncompleteDetailHandlers(id, record) {
  $("bankDetailClose")?.addEventListener("click", () => closeActiveDetailPanel());
  wireBankFormArabicInputs(record);
  wireWorkspaceUxPresentation(id, record, {});

  $("oppDetailsRevealFormBtn")?.addEventListener("click", () => {
    const fresh = state.records.get(id) || record;
    revealIncompleteEditForm(evaluateMatchingReadiness(fresh));
  });

  async function saveIncomplete() {
    const form = $("bankUnifiedForm");
    const statusNode = $("bankUnifiedSaveStatus");
    const btn = $("bankUnifiedSaveBtn");
    if (!form || btn?.disabled) return;
    const existing = state.records.get(id) || record;
    const data = Object.fromEntries(new FormData(form).entries());
    const editResult = buildEditPatch(existing, data, { actorUid: authUser()?.uid || "" });
    const advResult = buildAdvertiserDataPatch(existing, data);
    const phoneErrorEl = document.getElementById("bankAdvertiserPhoneError");
    if (!advResult.ok) {
      if (phoneErrorEl) {
        phoneErrorEl.textContent = advResult.error || "رقم الجوال غير صحيح";
        phoneErrorEl.hidden = false;
      }
      if (statusNode) statusNode.textContent = advResult.error || "رقم الجوال غير صحيح";
      return;
    }
    if (phoneErrorEl) phoneErrorEl.hidden = true;

    let editPatch = {};
    if (editResult.ok) {
      editPatch = editResult.patch;
    } else if (editResult.error !== "no_editable_fields") {
      const msg = editResult.error === "ownership_fields_protected"
        ? "لا تملك صلاحية تعديل هذه الفرصة."
        : (editResult.error || "تعذر حفظ التغييرات");
      if (statusNode) statusNode.textContent = msg;
      setStatus(msg, "is-error");
      return;
    }

    const mergedPreview = mergeIncompleteFormPreview(existing, data);
    const readinessCheck = evaluateMatchingReadiness(mergedPreview);
    const patch = {
      ...editPatch,
      ...advResult.patch,
      matchingReadiness: readinessCheck.matchingReadiness,
      matchingReadinessMissing: readinessCheck.matchingReadinessMissing || []
    };
    if (advResult.patch.advertiserPhoneNormalized) {
      patch.contactPhone = advResult.patch.advertiserPhoneNormalized;
      patch.phone = advResult.patch.advertiserPhoneRaw || advResult.patch.advertiserPhoneNormalized;
    }
    if (mergedPreview.purpose) {
      patch.purpose = mergedPreview.purpose;
      patch.transactionType = mergedPreview.transactionType || "";
    }
    if (mergedPreview.priceOrBudget != null) patch.priceOrBudget = mergedPreview.priceOrBudget;
    if (mergedPreview.salePrice != null) patch.salePrice = mergedPreview.salePrice;
    if (mergedPreview.annualRent != null) patch.annualRent = mergedPreview.annualRent;
    if (mergedPreview.budget != null) patch.budget = mergedPreview.budget;

    const hasChanges = Object.keys(editPatch).length > 0
      || Object.keys(advResult.patch).some((key) => String(advResult.patch[key] ?? "") !== String(existing[key] ?? ""));
    if (!hasChanges) {
      if (statusNode) statusNode.textContent = "لا توجد تغييرات للحفظ";
      return;
    }

    btn.disabled = true;
    if (statusNode) statusNode.textContent = "جارٍ الحفظ…";
    try {
      await patchOpportunity(id, patch);
      await reloadOpportunityFromBackend(id);
      if (isDailyTaskDetail() && readinessCheck.isReadyForMatching) {
        toast("تم حفظ الفرصة ونقلها للمطابقة");
        if (statusNode) {
          statusNode.textContent = "تم حفظ الفرصة ونقلها للمطابقة";
          statusNode.classList.add("is-done");
        }
        closeActiveDetailPanel();
        window.dispatchEvent(new CustomEvent("iaqar:daily-task-completed", { detail: { opportunityId: id } }));
        renderList();
        return;
      }
      toast(readinessCheck.isReadyForMatching ? "تم حفظ الفرصة ونقلها للمطابقة" : "تم حفظ الفرصة");
      await renderDetail(id);
      renderList();
    } catch (error) {
      const msg = mapClientPatchError(error, "تعذر حفظ البيانات");
      if (statusNode) statusNode.textContent = msg;
      setStatus(msg, "is-error");
    } finally {
      btn.disabled = false;
    }
  }

  $("bankUnifiedSaveBtn")?.addEventListener("click", () => void saveIncomplete());
}

const cooperationUiState = {
  selectedOffices: [],
  allOffices: [],
  sharedPreview: null,
  opportunityId: "",
  sendBusy: false
};

function renderCooperationSelectedChips() {
  const host = $("bankCoopSelectedChips");
  if (!host) return;
  host.innerHTML = buildSelectedOfficeChipsHtml(cooperationUiState.selectedOffices);
}

function renderCooperationSearchResults() {
  const container = $("bankCoopSearchResults");
  const input = $("bankCoopOfficesSearch");
  if (!container || !input) return;
  const query = input.value || "";
  const matches = filterOfficesForCooperationSearch({
    offices: cooperationUiState.allOffices,
    query,
    ownOfficeId: officeId(),
    selectedOfficeIds: uniqueSelectedOfficeIds(cooperationUiState.selectedOffices)
  });
  if (!String(query || "").trim()) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  container.innerHTML = buildOfficeSearchResultsHtml(matches, query);
  container.hidden = false;
}

function updateCooperationSendButton() {
  const btn = $("bankCoopSendBtn");
  if (!btn) return;
  const count = uniqueSelectedOfficeIds(cooperationUiState.selectedOffices).length;
  btn.disabled = cooperationUiState.sendBusy || count === 0;
  btn.textContent = cooperationUiState.sendBusy ? "جاري الإرسال..." : "إرسال الفرصة";
}

function pickCooperationOffice(office = {}) {
  cooperationUiState.selectedOffices = addSelectedOffice(cooperationUiState.selectedOffices, office);
  renderCooperationSelectedChips();
  updateCooperationSendButton();
  const input = $("bankCoopOfficesSearch");
  if (input) input.value = "";
  renderCooperationSearchResults();
}

function removeCooperationOffice(officeIdValue = "") {
  cooperationUiState.selectedOffices = removeSelectedOffice(
    cooperationUiState.selectedOffices,
    officeIdValue
  );
  renderCooperationSelectedChips();
  updateCooperationSendButton();
  renderCooperationSearchResults();
}

async function loadCooperationOfficesForShare(opportunityId, record) {
  const user = authUser();
  cooperationUiState.opportunityId = opportunityId;
  cooperationUiState.selectedOffices = [];
  cooperationUiState.allOffices = [];
  renderCooperationSelectedChips();
  updateCooperationSendButton();
  setShareActionStatus("جارٍ تحميل المكاتب…");
  if (!user?.getIdToken) {
    setShareActionStatus("يلزم تسجيل الدخول", "is-error");
    return;
  }
  try {
    const token = await user.getIdToken();
    const response = await fetch(`${workerBaseUrl()}/cooperation/suitable-offices`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Office-Id": officeId()
      },
      body: JSON.stringify({
        officeId: officeId(),
        opportunityId
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || "تعذر جلب المكاتب");
    }
    if (payload.requiresCompletion) {
      setShareActionStatus(
        payload.message || "يلزم استكمال المدينة والحي لعرض المكاتب",
        "is-error"
      );
      cooperationUiState.allOffices = [];
      renderCooperationSearchResults();
      if (window.IAQAR?.openOpportunityManagement) {
        void window.IAQAR.openOpportunityManagement(opportunityId);
      }
      return;
    }
    cooperationUiState.allOffices = flattenRankedOffices({ buckets: payload.buckets || {} }, 0);
    cooperationUiState.sharedPreview = payload.sharedPreview || null;
    if (cooperationUiState.sharedPreview) {
      const safe = assertSafeCooperationSharePayload(cooperationUiState.sharedPreview);
      if (!safe.ok) {
        console.warn("[iaqar] unsafe cooperation preview blocked keys", safe.blocked);
      }
    }
    setShareActionStatus(
      cooperationUiState.allOffices.length ? "" : "لا توجد مكاتب متاحة للتعاون في هذه المدينة حاليًا"
    );
    renderCooperationSearchResults();
  } catch (error) {
    console.warn("[iaqar] cooperation offices", error);
    setShareActionStatus(error?.message || "تعذر جلب المكاتب — أعد المحاولة", "is-error");
  }
}

async function sendCooperationToSelectedOffices(opportunityId) {
  if (cooperationUiState.sendBusy) return;
  const own = String(officeId() || "").trim().toLowerCase();
  const selectedIds = uniqueSelectedOfficeIds(cooperationUiState.selectedOffices)
    .filter((id) => String(id || "").trim().toLowerCase() !== own);
  if (!selectedIds.length) {
    setShareActionStatus("اختر مكتبًا للإرسال", "is-error");
    return;
  }

  if (cooperationUiState.sharedPreview) {
    const safe = assertSafeCooperationSharePayload(cooperationUiState.sharedPreview);
      if (!safe.ok) {
        console.error("[iaqar] cooperation share blocked preview keys", safe.blocked);
        setShareActionStatus("تعذر إرسال الفرصة. حاول مرة أخرى.", "is-error");
        return;
      }
  }

  const cooperationMessage = String($("bankCoopMessage")?.value || "").slice(0, 500);
  cooperationUiState.sendBusy = true;
  updateCooperationSendButton();
  setShareActionStatus("جاري الإرسال...");

  let sentCount = 0;
  let skippedDuplicates = 0;
  let lastError = "";
  try {
    for (const targetOfficeId of selectedIds) {
      const result = await createShareRequest({
        opportunityIds: [opportunityId],
        targetOfficeId,
        scopeType: "single",
        cooperationMessage,
        suppressUi: true
      });
      if (result.ok && !result.duplicate) {
        sentCount += 1;
      } else if (result.duplicate) {
        skippedDuplicates += 1;
      } else {
        lastError = result.errorMessage || lastError;
        if (result.technicalError) {
          console.error("[iaqar] cooperation send failed", result.technicalError);
        }
      }
    }
  } catch (error) {
    console.error("[iaqar] cooperation send failed", error);
    lastError = error?.message || lastError;
  } finally {
    cooperationUiState.sendBusy = false;
    updateCooperationSendButton();
  }

  if (sentCount > 0) {
    setShareActionStatus("تم إرسال الفرصة", "is-done");
    cooperationUiState.selectedOffices = [];
    const messageInput = $("bankCoopMessage");
    if (messageInput) messageInput.value = "";
    renderCooperationSelectedChips();
    await refreshWorkspaceCoopSection(opportunityId);
    return;
  }

  if (skippedDuplicates && !lastError) {
    setShareActionStatus("يوجد مشاركة نشطة لهذه الفرصة مع المكاتب المختارة", "is-error");
    return;
  }

  setShareActionStatus("تعذر إرسال الفرصة. حاول مرة أخرى.", "is-error");
}

function wireCooperationHandlers(opportunityId, record, bundle = {}) {
  const section = $("bankWorkspaceCoopSection");
  if (!section || section.dataset.coopBound === opportunityId) return;
  section.dataset.coopBound = opportunityId;

  $("bankCoopOfficesSearch")?.addEventListener("input", () => {
    renderCooperationSearchResults();
  });
  $("bankCoopOfficesSearch")?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const container = $("bankCoopSearchResults");
      if (container) {
        container.hidden = true;
        container.innerHTML = "";
      }
    }
  });

  section.addEventListener("click", (event) => {
    const pickBtn = event.target.closest?.("[data-pick-office-id]");
    if (pickBtn) {
      const officeIdPick = pickBtn.getAttribute("data-pick-office-id") || "";
      const office = cooperationUiState.allOffices.find(
        (row) => String(row.officeId).toLowerCase() === officeIdPick.toLowerCase()
      );
      if (office) pickCooperationOffice(office);
      return;
    }
    const removeBtn = event.target.closest?.("[data-remove-office-id]");
    if (removeBtn) {
      removeCooperationOffice(removeBtn.getAttribute("data-remove-office-id") || "");
    }
  });

  $("bankCoopSendBtn")?.addEventListener("click", () => {
    void sendCooperationToSelectedOffices(opportunityId);
  });
}

function wireWorkspaceHandlers(id, record, bundle = {}) {
  $("bankDetailClose")?.addEventListener("click", () => closeActiveDetailPanel());

  const showSection = (sectionId) => {
    showWorkspaceSection(sectionId);
  };

  document.querySelectorAll("[data-workspace-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-workspace-action");
      if (action === "search_matches") {
        showSection("bankWorkspaceMatchesSection");
        void runWorkspaceMatchingSearch(id, bundle);
        return;
      }
      if (action === "send_and_share") {
        showSection("bankWorkspaceSendShareHub");
        void recordBrokerActionDone(id, "workspace:send_and_share");
        applyWorkspaceLifecycleFlow(id, state.records.get(id) || record, bundle);
        return;
      }
      if (action === "contact_party") {
        showSection("bankWorkspacePartySection");
        void recordBrokerActionDone(id, "workspace:contact_party");
        return;
      }
      if (action === "manage_opportunity") {
        void recordBrokerActionDone(id, "workspace:manage_opportunity");
        showSection("bankWorkspaceFollowUpSection");
        showSection("bankWorkspaceCloseSection");
        applyWorkspaceLifecycleFlow(id, state.records.get(id) || record, bundle);
        if (window.IAQAR?.openOpportunityManagement) {
          void window.IAQAR.openOpportunityManagement(id);
        }
        return;
      }
      if (action === "goto_office_share") {
        openOfficeShareFlow(id, state.records.get(id) || record);
        return;
      }
      if (action === "open_lifecycle_close") {
        if (window.IAQAR?.openOpportunityManagement) {
          void window.IAQAR.openOpportunityManagement(id, { openLifecycleClose: true });
        }
        return;
      }
    });
  });

  document.querySelectorAll("[data-send-share-option]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const option = btn.getAttribute("data-send-share-option");
      if (option === "share_whatsapp_listing") {
        const fresh = state.records.get(id) || record;
        const preview = buildPublicListingAnnouncement(fresh, officeProfileForShare(), {
          origin: window.location.origin
        });
        const previewNode = document.getElementById("bankListingPreviewText");
        if (previewNode) previewNode.textContent = preview;
        showSection("bankWorkspaceWhatsAppListing");
        return;
      }
      if (option === "share_to_office") {
        showWorkspaceSection("bankWorkspaceCoopSection");
        const search = $("bankCoopOfficesSearch");
        if (search) search.focus();
        void loadCooperationOfficesForShare(id, record);
        return;
      }
      if (option === "copy_listing_text") {
        const fresh = state.records.get(id) || record;
        const text = buildPublicListingAnnouncement(fresh, officeProfileForShare(), {
          origin: window.location.origin
        });
        try {
          await navigator.clipboard.writeText(text);
          toast("تم نسخ الإعلان");
          const statusNode = document.getElementById("bankListingShareStatus");
          if (statusNode) statusNode.textContent = "تم نسخ إعلان الفرصة";
          await logListingShareActivity(id, "copy");
        } catch (error) {
          console.warn("[iaqar] listing copy", error);
          toast("تعذر نسخ الإعلان");
        }
      }
    });
  });

  $("bankOpenWhatsAppListingBtn")?.addEventListener("click", () => {
    const fresh = state.records.get(id) || record;
    const message = buildPublicListingAnnouncement(fresh, officeProfileForShare(), {
      origin: window.location.origin
    });
    openWhatsApp({ text: message });
    const statusNode = document.getElementById("bankListingShareStatus");
    if (statusNode) statusNode.textContent = "تم فتح واتساب — اختر المستلم";
    void logListingShareActivity(id, "whatsapp");
  });

  $("bankCopyListingBtn")?.addEventListener("click", async () => {
    const fresh = state.records.get(id) || record;
    const text = buildPublicListingAnnouncement(fresh, officeProfileForShare(), {
      origin: window.location.origin
    });
    try {
      await navigator.clipboard.writeText(text);
      toast("تم نسخ الإعلان");
      const statusNode = document.getElementById("bankListingShareStatus");
      if (statusNode) statusNode.textContent = "تم نسخ إعلان الفرصة";
      await logListingShareActivity(id, "copy");
    } catch (error) {
      toast("تعذر نسخ الإعلان");
    }
  });

  document.querySelectorAll("[data-party-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const actionId = btn.getAttribute("data-party-action");
      void executePartyContactAction(actionId, id, record, bundle);
    });
  });

  wireWorkspaceMatchRowHandlers(id, record, bundle);
  wireWorkspaceCoopRowHandlers(id, record, bundle);

  wireContactOutcomeHandlers(id, record, bundle);

  wireCooperationHandlers(id, record, bundle);
  void loadCooperationOfficesForShare(id, record);
  wireWorkspaceUxPresentation(id, record, bundle);

  document.querySelectorAll("[data-followup-days]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const days = Number(btn.getAttribute("data-followup-days") || 0);
      const input = $("bankCustomFollowUp");
      const value = buildQuickFollowUpDateTimeInput(days);
      if (input) input.value = value;
      const parsed = parseFollowUpForSave(value);
      if (!parsed) return toast("موعد المتابعة غير صحيح");
      const todayCheck = validateTodayRequiresFutureTime(parsed);
      if (!todayCheck.ok) return toast(todayCheck.message);
      void saveWorkspaceFollowUp(id, parsed.toISOString());
    });
  });
  $("bankSaveFollowUpCustom")?.addEventListener("click", () => {
    const custom = $("bankCustomFollowUp")?.value || "";
    if (!custom) return toast("اختر موعد المتابعة");
    const parsed = parseFollowUpForSave(custom);
    if (!parsed) return toast("موعد المتابعة غير صحيح");
    const todayCheck = validateTodayRequiresFutureTime(parsed);
    if (!todayCheck.ok) return toast(todayCheck.message);
    void saveWorkspaceFollowUp(id, parsed.toISOString());
  });
}

let bankFollowUpSaveBusy = false;

function mapFollowUpSaveError(error, payload = {}) {
  const code = String(error?.code || payload?.error || "").trim();
  if (code === "followup_past") return "اختر وقتًا قادمًا للمتابعة";
  if (code === "followup_today_past") return "اختر وقتًا قادمًا اليوم";
  if (code === "followup_invalid") return "موعد المتابعة غير صحيح";
  if (code === "followup_ids_missing") return "تعذر حفظ موعد المتابعة — المعرف غير متوفر";
  if (payload?.message) return payload.message;
  if (error?.message && error.message !== "followup_failed") return error.message;
  return "تعذر حفظ موعد المتابعة";
}

function patchWorkspaceFollowUpUi(opportunityId, followUp) {
  if (!followUp?.at) return;
  const label = formatFollowUpAppointmentLine(followUp.at);
  const section = document.getElementById("bankWorkspaceFollowUpSection");
  if (!section) return;
  const cardText = `الموعد القادم: ${label}`;
  let card = section.querySelector(".bank-workspace-followup-card");
  if (card) {
    card.textContent = cardText;
  } else {
    card = document.createElement("p");
    card.className = "bank-workspace-followup-card";
    card.textContent = cardText;
    const heading = section.querySelector("h4");
    if (heading) heading.after(card);
  }
  const activityText = followUpActivityText(followUp.at);
  const ul = section.querySelector("ul.bank-workspace-activity");
  if (ul) {
    const duplicate = [...ul.querySelectorAll("li")].some((li) => li.textContent.includes(activityText));
    if (!duplicate) {
      const li = document.createElement("li");
      const stamp = new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
      li.innerHTML = `<time>${stamp}</time> ${activityText}`;
      ul.insertBefore(li, ul.firstChild);
    }
  }
  const record = state.records.get(opportunityId);
  if (record) {
    state.records.set(opportunityId, {
      ...record,
      followUp,
      nextFollowUpAt: followUp.at,
      nextActionAt: followUp.at,
      lifecycleStatus: "FOLLOW_UP"
    });
  }
}

let bankContactOutcomeSaveBusy = false;

function appendWorkspaceActivityLine(text = "") {
  const section = document.getElementById("bankWorkspaceFollowUpSection");
  const ul = section?.querySelector("ul.bank-workspace-activity")
    || document.querySelector("#bankWorkspaceFollowUpSection ul.bank-workspace-activity");
  if (!ul || !text) return;
  const duplicate = [...ul.querySelectorAll("li")].some((li) => li.textContent.includes(text));
  if (duplicate) return;
  if (section) section.hidden = false;
  const li = document.createElement("li");
  const stamp = new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
  li.innerHTML = `<time>${stamp}</time> ${text}`;
  ul.insertBefore(li, ul.firstChild);
}

async function postOpportunityLifecycle(opportunityId, body = {}) {
  const user = authUser();
  if (!user?.getIdToken) {
    throw Object.assign(new Error("auth_required"), { code: "auth_required" });
  }
  const oid = officeId();
  const token = await user.getIdToken();
  const response = await fetch(`${workerBaseUrl()}/opportunity/lifecycle`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Office-Id": oid
    },
    body: JSON.stringify({
      officeId: oid,
      opportunityId,
      ...body
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(payload.message || "lifecycle_failed"),
      { code: payload.error || "lifecycle_failed", payload }
    );
  }
  return payload;
}

function readContactOutcomeFormData(outcome = "") {
  const key = String(outcome || "").toUpperCase();
  const note = String(document.getElementById("bankContactOutcomeNote")?.value || "").trim();
  if (key === "NO_RESPONSE") {
    return { followUpAt: document.getElementById("bankContactRetryAt")?.value || "", note };
  }
  if (key === "FOLLOW_UP") {
    return { followUpAt: document.getElementById("bankContactFollowUpAt")?.value || "", note };
  }
  if (key === "INTERESTED") {
    const panel = document.getElementById("bankContactInterestedFollowUpPanel");
    const followUpAt = panel && !panel.hidden
      ? document.getElementById("bankContactInterestedFollowUpAt")?.value || ""
      : "";
    return { followUpAt, note };
  }
  if (key === "REFUSED") {
    const selected = document.querySelector(".bank-refusal-reason.is-selected");
    return {
      refusalReason: selected?.getAttribute("data-refusal-reason") || "",
      note
    };
  }
  return { note };
}

function updateContactOutcomeSelectionHint(outcome = "") {
  const hintNode = document.getElementById("bankContactOutcomeSelectionHint");
  if (!hintNode) return;
  const text = contactOutcomeSelectionHint(outcome);
  if (!text) {
    hintNode.hidden = true;
    hintNode.textContent = "";
    return;
  }
  hintNode.textContent = text;
  hintNode.hidden = false;
}

function updateContactOutcomeSelectedBadge(outcome = "") {
  const badgeNode = document.getElementById("bankContactOutcomeSelectedBadge");
  const labelNode = document.getElementById("bankContactOutcomeSelectedLabel");
  if (!badgeNode || !labelNode) return;
  const label = contactOutcomeSelectedBadgeLabel(outcome);
  if (!label) {
    badgeNode.hidden = true;
    labelNode.textContent = "";
    return;
  }
  labelNode.textContent = label;
  badgeNode.hidden = false;
}

function selectContactOutcomeButton(outcome = "", { toggle = true } = {}) {
  const normalized = String(outcome || "").toUpperCase();
  const buttons = document.querySelectorAll(".bank-contact-outcome-btn");
  const current = document.querySelector(".bank-contact-outcome-btn.is-selected");
  const currentOutcome = String(current?.getAttribute("data-contact-outcome") || "").toUpperCase();
  let nextOutcome = normalized;
  if (toggle && normalized && currentOutcome === normalized) {
    nextOutcome = "";
  }

  buttons.forEach((btn) => {
    const btnOutcome = String(btn.getAttribute("data-contact-outcome") || "").toUpperCase();
    const active = Boolean(nextOutcome) && btnOutcome === nextOutcome;
    btn.classList.toggle("is-selected", active);
    btn.classList.remove("is-action-done");
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });

  const panel = document.getElementById("bankContactOutcomeActionPanel");
  if (!nextOutcome) {
    if (panel) {
      panel.hidden = true;
      panel.innerHTML = "";
    }
    updateContactOutcomeSelectionHint("");
    updateContactOutcomeSelectedBadge("");
    return;
  }
  updateContactOutcomeSelectionHint(nextOutcome);
  updateContactOutcomeSelectedBadge(nextOutcome);
}

function wireContactScheduleQuickPick(container, inputId) {
  if (!container) return;
  container.querySelectorAll("[data-contact-schedule-days]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const days = Number(btn.getAttribute("data-contact-schedule-days") || 0);
      const input = document.getElementById(inputId);
      if (!input) return;
      input.value = buildQuickFollowUpDateTimeInput(days);
    });
  });
}

function showContactOutcomeActionPanel(outcome = "") {
  const panel = document.getElementById("bankContactOutcomeActionPanel");
  const statusNode = document.getElementById("bankContactOutcomeStatus");
  if (!panel) return;
  if (statusNode) {
    statusNode.textContent = "";
    statusNode.classList.remove("is-done", "is-error");
  }
  panel.innerHTML = buildContactOutcomeActionHtml(outcome);
  panel.hidden = false;
  panel.querySelectorAll(".bank-contact-schedule-quick").forEach((block) => {
    const input = block.querySelector("input[type=\"datetime-local\"]");
    if (input?.id) wireContactScheduleQuickPick(block, input.id);
  });

  document.getElementById("bankContactInterestedFollowUp")?.addEventListener("click", () => {
    const sub = document.getElementById("bankContactInterestedFollowUpPanel");
    if (sub) sub.hidden = false;
  });
  document.getElementById("bankContactInterestedWhatsApp")?.addEventListener("click", () => {
    const phone = readAdvertiserPhoneFromRecord(state.records.get(state.activeId) || {}).phone;
    if (!phone) return toast("أكمل رقم الجوال أولًا");
    openBankAdvertiserWhatsApp(state.records.get(state.activeId) || {}, phone);
  });
  panel.querySelectorAll(".bank-refusal-reason").forEach((btn) => {
    btn.addEventListener("click", () => {
      panel.querySelectorAll(".bank-refusal-reason").forEach((node) => node.classList.remove("is-selected"));
      btn.classList.add("is-selected");
    });
  });
  panel.querySelector(".bank-contact-outcome-save-btn")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function saveContactOutcomeBundle(opportunityId, outcome, bundle = {}) {
  const statusNode = document.getElementById("bankContactOutcomeStatus");
  const formData = readContactOutcomeFormData(outcome);
  const validation = validateContactOutcomeSave(outcome, formData);
  if (!validation.ok) {
    if (statusNode) {
      statusNode.textContent = validation.message || "تعذر حفظ نتيجة التواصل";
      statusNode.classList.add("is-error");
    }
    toast(validation.message || "تعذر حفظ نتيجة التواصل");
    return;
  }
  if (bankContactOutcomeSaveBusy) return;
  bankContactOutcomeSaveBusy = true;
  const saveBtns = document.querySelectorAll(".bank-contact-outcome-save-btn");
  const outcomeButtons = document.querySelectorAll(".bank-contact-outcome-btn");
  saveBtns.forEach((node) => { node.disabled = true; });
  outcomeButtons.forEach((node) => { node.disabled = true; });
  if (statusNode) {
    statusNode.textContent = "جارٍ الحفظ…";
    statusNode.classList.remove("is-done", "is-error");
  }
  try {
    const payload = await postOpportunityLifecycle(opportunityId, {
      action: "contact_outcome",
      contactOutcome: outcome
    });
    let followUpPayload = null;
    if (validation.followUpAt) {
      followUpPayload = await postOpportunityLifecycle(opportunityId, {
        action: "set_followup",
        nextFollowUpAt: validation.followUpAt,
        nextActionAt: validation.followUpAt,
        nextActionType: "follow_up"
      });
    }
    if (validation.note) {
      await patchOpportunity(opportunityId, { contactNotes: validation.note });
    }
    const existing = state.records.get(opportunityId) || {};
    const followUp = followUpPayload?.followUp || existing.followUp;
    const merged = syncBankRecordFromLifecyclePayload(
      opportunityId,
      {
        ...payload,
        ...(followUpPayload || {}),
        lastContactOutcome: outcome,
        lastContactAt: new Date().toISOString(),
        advertiserContactStatus: payload.advertiserContactStatus || existing.advertiserContactStatus,
        lifecycleStatus: payload.lifecycleStatus || existing.lifecycleStatus,
        contactNotes: validation.note || existing.contactNotes,
        followUp: followUpPayload?.followUp || followUp,
        nextFollowUpAt: followUpPayload?.nextFollowUpAt || existing.nextFollowUpAt,
        nextActionAt: followUpPayload?.nextFollowUpAt || existing.nextActionAt
      },
      bankBrokerProgress().contactOutcomeActionKey?.(outcome) || `contact:outcome:${outcome}`
    );
    if (followUpPayload?.followUp) {
      patchWorkspaceFollowUpUi(opportunityId, followUpPayload.followUp);
    }
    const activityText = contactOutcomeActivityText(outcome, {
      followUpLabel: followUpLabelFromIso(validation.followUpAt),
      refusalReasonLabel: refusalReasonLabel(validation.refusalReason),
      note: validation.note
    });
    appendWorkspaceActivityLine(activityText);
    const section = document.getElementById("bankWorkspaceContactSection");
    if (statusNode) {
      statusNode.textContent = `تم الحفظ — ${activityText}`;
      statusNode.classList.add("is-done");
    }
    toast("تم حفظ نتيجة التواصل");
    applyWorkspaceLifecycleFlow(opportunityId, merged, bundle);
    if (outcome === "REFUSED") {
      window.setTimeout(() => {
        if (section) section.hidden = true;
      }, 500);
      void window.IAQAR?.openOpportunityManagement?.(opportunityId, {
        openLifecycleClose: true,
        prefillCloseReason: "not_interested",
        prefillCloseNote: validation.note || ""
      });
    } else if (outcome === "AGREED") {
      window.setTimeout(() => {
        if (section) section.hidden = true;
      }, 500);
      void window.IAQAR?.openOpportunityManagement?.(opportunityId);
    } else {
      window.setTimeout(() => {
        if (section) section.hidden = true;
      }, 1200);
    }
  } catch (error) {
    console.error("[iaqar-bank] contact_outcome_save_failed", {
      code: error?.code,
      message: error?.message,
      opportunityId
    }, error);
    const msg = error?.message || "تعذر تسجيل نتيجة التواصل";
    if (statusNode) {
      statusNode.textContent = msg;
      statusNode.classList.add("is-error");
    }
    toast(msg);
  } finally {
    bankContactOutcomeSaveBusy = false;
    saveBtns.forEach((node) => { node.disabled = false; });
    outcomeButtons.forEach((node) => { node.disabled = false; });
  }
}

function wireContactOutcomeHandlers(id, record, bundle = {}) {
  const section = document.getElementById("bankWorkspaceContactSection");
  if (!section) return;
  section.querySelectorAll(".bank-contact-outcome-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const outcome = btn.getAttribute("data-contact-outcome") || "";
      selectContactOutcomeButton(outcome);
      if (outcome === "AGREED") {
        void saveContactOutcomeBundle(id, outcome, bundle);
        return;
      }
      showContactOutcomeActionPanel(outcome);
    });
  });
  section.addEventListener("click", (event) => {
    const saveBtn = event.target.closest(".bank-contact-outcome-save-btn");
    if (!saveBtn || !section.contains(saveBtn)) return;
    const selected = section.querySelector(".bank-contact-outcome-btn.is-selected");
    const outcome = selected?.getAttribute("data-contact-outcome") || "";
    if (!outcome) return toast("اختر نتيجة التواصل");
    void saveContactOutcomeBundle(id, outcome, bundle);
  });
}

async function saveWorkspaceFollowUp(id, iso) {
  const ids = validateFollowUpSaveIds(officeId(), id);
  if (!ids.ok) {
    console.error("[iaqar-bank] followup_save_missing_ids", { opportunityId: id, officeId: officeId() });
    toast(mapFollowUpSaveError({ code: ids.code }));
    return;
  }
  const parsed = parseFollowUpForSave(iso);
  if (!parsed) {
    toast("موعد المتابعة غير صحيح");
    return;
  }
  const todayCheck = validateTodayRequiresFutureTime(parsed);
  if (!todayCheck.ok) {
    toast(todayCheck.message);
    return;
  }
  const user = authUser();
  if (!user?.getIdToken) {
    console.error("[iaqar-bank] followup_save_auth_required", { opportunityId: id, officeId: ids.officeId });
    toast("سجل دخول المكتب أولًا");
    return;
  }
  if (bankFollowUpSaveBusy) return;
  bankFollowUpSaveBusy = true;
  const buttons = document.querySelectorAll("[data-followup-days], #bankSaveFollowUpCustom");
  buttons.forEach((node) => { node.disabled = true; });
  try {
    const token = await user.getIdToken();
    const atIso = parsed.toISOString();
    const body = buildFollowUpLifecycleBody(ids.officeId, ids.opportunityId, atIso);
    const response = await fetch(`${workerBaseUrl()}/opportunity/lifecycle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Office-Id": ids.officeId
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = Object.assign(
        new Error(payload.message || "followup_failed"),
        { code: payload.error || "followup_failed" }
      );
      throw err;
    }
    const followUp = payload.followUp || {
      at: payload.nextFollowUpAt || atIso,
      status: "scheduled"
    };
    patchWorkspaceFollowUpUi(ids.opportunityId, followUp);
    toast("تم حفظ موعد المتابعة");
  } catch (error) {
    const payload = error?.payload || {};
    console.error("[iaqar-bank] followup_save_failed", {
      code: error?.code || payload.error,
      message: error?.message,
      opportunityId: id,
      officeId: ids.officeId
    }, error);
    toast(mapFollowUpSaveError(error, payload));
  } finally {
    bankFollowUpSaveBusy = false;
    buttons.forEach((node) => { node.disabled = false; });
  }
}

async function openCooperationRoom(opportunityId, cooperationId) {
  const user = authUser();
  if (!user?.getIdToken || !cooperationId) return;
  try {
    const token = await user.getIdToken();
    const response = await fetch(`${workerBaseUrl()}/cooperation/room`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Office-Id": officeId()
      },
      body: JSON.stringify({ officeId: officeId(), cooperationId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "room_failed");
    const panel = document.getElementById("bankCooperationRoomPanel");
    if (!panel) return;
    panel.hidden = false;
    panel.innerHTML = buildCooperationRoomHtml(payload.room || {}, payload.cooperation || {});
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("bankCoopRoomClose")?.addEventListener("click", () => {
      panel.hidden = true;
      panel.innerHTML = "";
    });
  } catch (error) {
    toast(error.message || "تعذر فتح غرفة التعاون");
  }
}

function rowsCountLabel() {
  if (!hasActiveBankQuery(state.queryFilters)) {
    const summary = state.summary || emptyBankSummary();
    if (state.filter === "archived") {
      return `${summary.archived} فرصة مؤرشفة`;
    }
    return `جاهزة ${summary.readyForMatching}${summary.needsCompletion ? ` — ${summary.needsCompletion} للاستكمال في المهام` : ""}`;
  }
  const loadedCount = [...state.records.values()].filter(passesListFilters).length;
  const filteredTotal = state.resultTotal || loadedCount;
  if (state.filter === "archived") {
    return loadedCount < filteredTotal || state.hasMore
      ? `عرض ${loadedCount} من ${filteredTotal} فرصة مؤرشفة`
      : `${filteredTotal} نتيجة مؤرشفة`;
  }
  return loadedCount < filteredTotal || state.hasMore
    ? `عرض ${loadedCount} من ${filteredTotal} فرصة`
    : `${filteredTotal} نتيجة`;
}

function wireBankFormArabicInputs(_record = {}) {
  /* plain text fields — no catalog suggestion lists */
}

function wireDetailHandlers(id, record) {
  $("bankDirectShareBtn")?.addEventListener("click", () => {
    const form = $("bankDirectShareForm");
    const coopForm = $("bankCooperateForm");
    const listing = $("bankListingSharePanel");
    if (form) form.hidden = !form.hidden;
    if (coopForm) coopForm.hidden = true;
    if (listing) listing.hidden = true;
  });

  $("bankCooperateBtn")?.addEventListener("click", async () => {
    const form = $("bankCooperateForm");
    const direct = $("bankDirectShareForm");
    const listing = $("bankListingSharePanel");
    if (direct) direct.hidden = true;
    if (listing) listing.hidden = true;
    if (!form) return;
    form.hidden = !form.hidden;
    const help = $("bankCooperateHelp");
    const mode = await readOfficeCooperationMode();
    if (help) {
      if (mode === "DISABLED") {
        help.textContent = "التعاون معطّل في إعدادات هذا المكتب.";
      } else if (mode === "SMART_AUTOMATIC") {
        help.textContent = "سيُفعَّل التعاون وفق القواعد المعتمدة دون كشف بيانات التواصل تلقائيًا.";
      } else {
        help.textContent = "سيصل طلب التعاون للمكاتب الأخرى بعد موافقتك على كل طلب.";
      }
    }
  });

  $("bankCooperateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const mode = await readOfficeCooperationMode();
    if (!cooperationModeAllowsExplicitRequest(mode)) {
      setShareActionStatus("التعاون معطّل في إعدادات هذا المكتب", "is-error");
      return;
    }
    const current = state.records.get(id) || record;
    const readiness = evaluateMatchingReadiness(current);
    if (!readiness.isReadyForMatching) {
      const names = missingFieldLabelsArabic(readiness.matchingReadinessMissing || []);
      setShareActionStatus(
        names.length ? `أكمل: ${names.join("، ")} قبل إتاحة التعاون.` : "أكمل بيانات الفرصة قبل إتاحة التعاون.",
        "is-error"
      );
      return;
    }
    if (String(current.cooperationListing || "").toUpperCase() === "OPEN") {
      setShareActionStatus("الفرصة متاحة للتعاون مسبقًا", "is-done");
      toast("الفرصة متاحة للتعاون مسبقًا");
      return;
    }
    const user = authUser();
    try {
      await patchOpportunity(id, {
        cooperationListing: "OPEN",
        cooperationListingAt: new Date().toISOString(),
        cooperationEnabled: true,
        cooperationEnabledBy: user?.uid || "",
        cooperationEnabledAt: new Date().toISOString()
      });
      await reloadOpportunityFromBackend(id);
      setShareActionStatus("تمت إتاحة الفرصة للتعاون مع المكاتب الأخرى", "is-done");
      toast("تمت إتاحة الفرصة للتعاون");
      await renderDetail(id);
    } catch (error) {
      console.warn("[iaqar] cooperation listing", error);
      setShareActionStatus(mapClientPatchError(error, "تعذر إتاحة التعاون"), "is-error");
    }
  });

  $("bankListingShareBtn")?.addEventListener("click", () => {
    const panel = $("bankListingSharePanel");
    const direct = $("bankDirectShareForm");
    const coopForm = $("bankCooperateForm");
    if (direct) direct.hidden = true;
    if (coopForm) coopForm.hidden = true;
    if (!panel) return;
    panel.hidden = !panel.hidden;
    const nativeBtn = $("bankShareNativeBtn");
    const message = buildListingShareMessage(record, officeProfileForShare());
    if (nativeBtn) {
      const canShare = Boolean(navigator.share);
      nativeBtn.hidden = !canShare;
      if (canShare) {
        nativeBtn.onclick = async () => {
          try {
            await navigator.share({ text: message, title: record.propertyType || "فرصة عقارية" });
          } catch (_) { /* ignore */ }
        };
      }
    }
    $("bankShareWhatsAppBtn")?.addEventListener("click", () => {
      openWhatsApp({ text: message });
    }, { once: true });
    $("bankShareTelegramBtn")?.addEventListener("click", () => {
      window.open(telegramShareUrl(message), "_blank", "noopener,noreferrer");
    }, { once: true });
  });

  async function saveUnifiedChanges() {
    const form = $("bankUnifiedForm");
    const statusNode = $("bankUnifiedSaveStatus");
    const btn = $("bankUnifiedSaveBtn");
    if (!form || btn?.disabled) return;
    const existing = state.records.get(id) || record;
    const data = Object.fromEntries(new FormData(form).entries());
    const editResult = buildEditPatch(existing, data, { actorUid: authUser()?.uid || "" });
    if (!editResult.ok && editResult.error !== "no_editable_fields") {
      const msg = editResult.error === "ownership_fields_protected"
        ? "لا تملك صلاحية تعديل هذه الفرصة."
        : (editResult.error || "تعذر حفظ التغييرات");
      setStatus(msg, "is-error");
      if (statusNode) statusNode.textContent = msg;
      return;
    }
    const advResult = buildAdvertiserDataPatch(existing, data);
    if (!advResult.ok) {
      const errorEl = document.getElementById("bankAdvertiserPhoneError");
      if (errorEl) {
        errorEl.textContent = advResult.error || "رقم الجوال غير صحيح";
        errorEl.hidden = false;
      }
      if (statusNode) statusNode.textContent = advResult.error || "رقم الجوال غير صحيح";
      return;
    }
    const editPatch = editResult.ok ? editResult.patch : {};
    const hasEditChanges = Object.keys(editPatch).length > 0;
    const hasAdvChanges = Object.keys(advResult.patch).some((key) => {
      return String(advResult.patch[key] ?? "") !== String(existing[key] ?? "");
    });
    if (!hasEditChanges && !hasAdvChanges) {
      setStatus("لا توجد حقول قابلة للحفظ", "is-error");
      if (statusNode) statusNode.textContent = "لا توجد تغييرات للحفظ";
      return;
    }
    btn.disabled = true;
    if (statusNode) statusNode.textContent = "جارٍ الحفظ…";
    const mergedPreview = normalizeOpportunityFinancials({ ...existing, ...editPatch, ...advResult.patch });
    const readiness = evaluateMatchingReadiness(mergedPreview);
    const patch = {
      ...editPatch,
      ...advResult.patch,
      ...readinessFieldsForClient(mergedPreview, readiness),
      updatedBy: authUser()?.uid || ""
    };
    try {
      await patchOpportunity(id, patch);
      await reloadOpportunityFromBackend(id);
      if (statusNode) statusNode.textContent = "تم حفظ التغييرات";
      setStatus("تم حفظ التغييرات", "is-done");
      toast("تم حفظ التغييرات");
      await renderDetail(id);
      renderList();
    } catch (error) {
      console.warn("[iaqar] unified save", error);
      const msg = mapClientPatchError(error, "تعذر حفظ التغييرات");
      if (statusNode) statusNode.textContent = msg;
      setStatus(msg, "is-error");
    } finally {
      btn.disabled = false;
    }
  }

  function readinessFieldsForClient(record, readiness = evaluateMatchingReadiness(record)) {
    return {
      matchingReadiness: readiness.matchingReadiness,
      matchingReadinessMissing: readiness.matchingReadinessMissing || []
    };
  }

  $("bankUnifiedSaveBtn")?.addEventListener("click", () => void saveUnifiedChanges());

  document.querySelectorAll("[data-contact-outcome]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      const outcome = btn.getAttribute("data-contact-outcome");
      const buttons = document.querySelectorAll("[data-contact-outcome]");
      buttons.forEach((node) => { node.disabled = true; });
      try {
        await recordContactOutcome(id, outcome);
        toast("تم تسجيل نتيجة التواصل");
        await renderDetail(id);
      } catch (error) {
        console.warn("[iaqar] contact outcome", error);
        toast(error.message || "تعذر تسجيل نتيجة التواصل");
      } finally {
        buttons.forEach((node) => { node.disabled = false; });
      }
    });
  });

  async function saveFollowUpDays(days) {
    const followUp = new Date(Date.now() + Number(days || 0) * 86400000);
    followUp.setHours(10, 0, 0, 0);
    await saveFollowUpAt(followUp.toISOString());
  }

  async function saveFollowUpAt(iso) {
    const user = authUser();
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch(`${workerBaseUrl()}/opportunity/lifecycle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Office-Id": officeId()
        },
        body: JSON.stringify({
          officeId: officeId(),
          opportunityId: id,
          action: "set_followup",
          nextFollowUpAt: iso,
          nextActionAt: iso,
          nextActionType: "follow_up"
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "followup_failed");
      state.records.set(id, {
        ...state.records.get(id),
        nextFollowUpAt: iso,
        nextActionAt: iso
      });
      toast("تم حفظ موعد المتابعة");
      await renderDetail(id);
    } catch (error) {
      console.warn("[iaqar] followup", error);
      toast("تعذر حفظ موعد المتابعة");
    }
  }

  document.querySelectorAll("[data-followup-days]").forEach((btn) => {
    btn.addEventListener("click", () => void saveFollowUpDays(btn.getAttribute("data-followup-days")));
  });
  $("bankSaveFollowUpCustom")?.addEventListener("click", () => {
    const custom = $("bankCustomFollowUp")?.value || "";
    if (!custom) return toast("اختر موعد المتابعة");
    void saveFollowUpAt(new Date(custom).toISOString());
  });

  function currentAdvertiserPhone() {
    return readAdvertiserPhoneFromRecord(state.records.get(id) || record).phone;
  }

  function currentAdvertiserRecord() {
    return state.records.get(id) || record;
  }

  $("bankAdvertisercall")?.addEventListener("click", () => {
    const phone = currentAdvertiserPhone();
    if (!phone) return;
    const local = formatLocalPhoneDisplay(phone);
    if (!local) return toast("رقم الجوال غير مكتمل");
    window.location.href = `tel:${local}`;
    void recordLifecycleCallOpened(id);
  });
  $("bankAdvertiserwhatsapp")?.addEventListener("click", () => {
    const phone = currentAdvertiserPhone();
    openBankAdvertiserWhatsApp(currentAdvertiserRecord(), phone);
  });
  $("bankAdvertiserAddPhone")?.addEventListener("click", () => {
    const phoneInput = document.querySelector("#bankUnifiedForm input[name=\"advertiserPhoneLocal\"]");
    if (phoneInput) {
      phoneInput.focus();
      phoneInput.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });

  $("bankHideSharedBtn")?.addEventListener("click", () => void hideSharedOpportunity(id));

  $("bankDetailClose")?.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("iaqar:nav-close-request"));
  });

  $("bankOpenReviewBtn")?.addEventListener("click", () => {
    openBankOpportunityReview(id, state.records.get(id) || record);
  });

  $("bankArchiveBtn")?.addEventListener("click", () => void archiveOpportunity(id, record));
  $("bankRestoreBtn")?.addEventListener("click", () => void restoreOpportunity(id, record));
  $("bankDeleteBtn")?.addEventListener("click", () => confirmPermanentDelete(id, record));
  $("bankDirectShareForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const targetOfficeId = String($("bankDetailScopeTarget")?.value || "").trim();
    if (!targetOfficeId) {
      setShareActionStatus("اختر مكتبًا من نتائج البحث", "is-error");
      return;
    }
    await createShareRequest({ opportunityIds: [id], targetOfficeId, scopeType: "single" });
  });
  bindOfficeSearch({
    searchInput: $("bankDetailOfficeSearch"),
    hiddenInput: $("bankDetailScopeTarget"),
    labelNode: $("bankDetailScopeSelectedLabel"),
    resultsNode: $("bankDetailScopeSearchResults")
  });
  $("bankRevokeBtn")?.addEventListener("click", () => void revokeCooperation(id, record));
}

function mapClientPatchError(error, fallback = "تعذر الحفظ؛ حاول مرة أخرى.") {
  const code = String(error?.code || error?.message || "").trim();
  switch (code) {
    case "opportunity_not_found":
      return "لم يتم العثور على الفرصة.";
    case "office_mismatch":
      return "لا تملك صلاحية تعديل هذه الفرصة.";
    case "patch_empty":
      return "لا توجد حقول قابلة للحفظ.";
    case "cooperation_incomplete":
      return error?.message || "أكمل بيانات الفرصة قبل إتاحة التعاون.";
    case "firestore_write_failed":
      return "تعذر الوصول إلى خدمة الحفظ.";
    case "invalid_budget":
    case "قيمة الميزانية غير صالحة.":
      return "قيمة الميزانية غير صالحة.";
    case "auth_required":
      return "سجل دخول المكتب أولًا.";
    default:
      return error?.message && /[^\x00-\x7F]/.test(error.message) ? error.message : fallback;
  }
}

async function reloadOpportunityFromBackend(id) {
  const runtime = officeRuntime();
  if (!runtime?.db || !officeId() || !id) return null;
  const snap = await runtime.db.collection("offices").doc(officeId())
    .collection("opportunities").doc(id).get();
  if (!snap.exists) return null;
  const record = { id, ...(snap.data() || {}) };
  state.records.set(id, record);
  return record;
}

async function patchOpportunity(id, patch) {
  const user = authUser();
  if (!user?.getIdToken) throw Object.assign(new Error("auth_required"), { code: "auth_required" });
  const boundaries = phase3BoundaryGuarantees();
  if (boundaries.createsMatch) {
    throw new Error("phase_boundary_violation");
  }
  const token = await user.getIdToken();
  const response = await fetch(`${workerBaseUrl()}/opportunity/patch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Office-Id": officeId()
    },
    body: JSON.stringify({
      officeId: officeId(),
      opportunityId: id,
      patch
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.message || mapClientPatchError({ code: payload.error });
    throw Object.assign(new Error(message), { code: payload.error || "patch_failed" });
  }
  if (payload.opportunity) {
    state.records.set(id, { ...payload.opportunity, id });
  }
  return payload;
}

async function recordLifecycleCallOpened(opportunityId) {
  const user = authUser();
  if (!user?.getIdToken) return;
  try {
    const payload = await postOpportunityLifecycle(opportunityId, { action: "call_opened" });
    syncBankRecordFromLifecyclePayload(opportunityId, payload, "contact:call");
  } catch (error) {
    console.warn("[iaqar] call opened log", error);
  }
}

async function recordContactOutcome(id, outcome) {
  const user = authUser();
  if (!user?.getIdToken) throw Object.assign(new Error("auth_required"), { code: "auth_required" });
  const token = await user.getIdToken();
  const response = await fetch(`${workerBaseUrl()}/opportunity/lifecycle`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Office-Id": officeId()
    },
    body: JSON.stringify({
      officeId: officeId(),
      opportunityId: id,
      action: "contact_outcome",
      contactOutcome: outcome
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(payload.message || "تعذر تسجيل نتيجة التواصل"),
      { code: payload.error || "contact_outcome_failed" }
    );
  }
  await reloadOpportunityFromBackend(id);
  return payload;
}

function workerBaseUrl() {
  if (window.IAQAR && typeof window.IAQAR.resolveWorkerBase === "function") {
    return window.IAQAR.resolveWorkerBase();
  }
  if (window.IAQAR?.workerBase || window.IAQAR?.office?.workerBase) {
    return String(window.IAQAR.workerBase || window.IAQAR.office.workerBase).replace(/\/$/, "");
  }
  try {
    const host = String(window.location?.hostname || "").toLowerCase();
    if (host.includes("--staging") || host.startsWith("staging.") || window.IAQAR?.deploymentEnvironment === "staging") {
      return "https://iaqar-intake-staging.iaqar-ai.workers.dev";
    }
  } catch (_) { /* ignore */ }
  return "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
}

async function syncCooperationOperation(cooperationId) {
  const user = authUser();
  if (!user?.getIdToken || !officeId() || !cooperationId) return { ok: false };
  try {
    const token = await user.getIdToken();
    return await requestCooperationOperationSync({
      workerBase: workerBaseUrl(),
      idToken: token,
      officeId: officeId(),
      cooperationId
    });
  } catch (error) {
    console.warn("[iaqar] cooperation operation sync", error);
    return { ok: false, error: "cooperation_ops_failed" };
  }
}

async function readOfficeCooperationMode() {
  const runtime = officeRuntime();
  if (!runtime?.db || !officeId()) return DEFAULT_COOPERATION_MODE;
  try {
    const snap = await runtime.db.collection("offices").doc(officeId())
      .collection("officeSettings").doc("cooperation").get();
    if (!snap.exists) return DEFAULT_COOPERATION_MODE;
    return normalizeCooperationMode(snap.data()?.mode);
  } catch (_) {
    return DEFAULT_COOPERATION_MODE;
  }
}

async function runTrustedCooperationLifecycle(cooperationId, action, reason = "") {
  const user = authUser();
  if (!user?.getIdToken || !officeId() || !cooperationId) {
    return { ok: false, error: "auth_required" };
  }
  const token = await user.getIdToken();
  return requestCooperationLifecycle({
    workerBase: workerBaseUrl(),
    idToken: token,
    officeId: officeId(),
    cooperationId,
    action,
    reason
  });
}

async function rematchOpportunity(id, { reason = "edit" } = {}) {
  const user = authUser();
  if (!user?.getIdToken || !officeId()) return { ok: false, skipped: true };
  try {
    const token = await user.getIdToken();
    const workerBase = workerBaseUrl();
    const result = await requestOpportunityRematch({
      workerBase,
      idToken: token,
      officeId: officeId(),
      opportunityId: id,
      notify: true
    });
    const missingData = await requestMissingDataOperationSync({
      workerBase,
      idToken: token,
      officeId: officeId(),
      opportunityId: id
    });
    window.dispatchEvent(new CustomEvent("iaqar:opportunity-rematched", {
      detail: {
        opportunityId: id,
        reason,
        matchCount: Number(result.matchCount || 0),
        createsOperation: Boolean(result.createsOperation || missingData.created),
        ...phase4BoundaryGuarantees(),
        ...phase5BoundaryGuarantees()
      }
    }));
    return result;
  } catch (error) {
    console.warn("[iaqar] bank rematch", error);
    return { ok: false, error: "rematch_failed" };
  }
}

function bankReviewDraft(record = {}) {
  const fields = recordToReviewFields(record);
  const readiness = evaluateMatchingReadiness(record);
  const needsReview = readinessMissingToNeedsReview(readiness.matchingReadinessMissing, record);
  const phoneInfo = readAdvertiserPhoneFromRecord(record);
  const reviewDefaults = buildImportSimplifiedReviewDefaults(fields, record.rawText || "", {
    extended: fields.extended,
    needsReview
  }, { city: record.city || "" });
  reviewDefaults.advertiserRole = record.advertiserRole || "";
  reviewDefaults.advertiserPhoneNormalized = phoneInfo.phone || "";
  reviewDefaults.advertiserContactStatus = record.advertiserContactStatus || "";
  reviewDefaults.marketingConsentStatus = record.marketingConsentStatus || "";
  return {
    fields,
    extended: fields.extended,
    needsReview,
    reviewDefaults,
    sourceText: record.rawText || ""
  };
}

function openBankOpportunityReview(id, record) {
  if (!record || !id) return;
  if (!isOwnedOpportunityRecord(record)) {
    setStatus("لا يمكن تعديل فرصة لا تملكها مكتبك", "is-error");
    return;
  }
  state.bankReviewOpportunityId = id;
  const draft = bankReviewDraft(record);
  draft.prepared = { opportunity: { id, ...record } };
  openOpportunityReview(draft, approveBankOpportunityReview, { importSimplifiedReview: true });
}

async function approveBankOpportunityReview(brokerExtras, review, advertiser = {}) {
  const id = state.bankReviewOpportunityId;
  if (!id) throw new Error("opportunity_missing");
  const existing = state.records.get(id);
  if (!existing) throw new Error("opportunity_missing");
  const user = authUser();
  const editResult = buildReviewCompletionPatch(existing, brokerExtras, { actorUid: user?.uid || "" });
  if (!editResult.ok) {
    throw new Error(editResult.error || "patch_failed");
  }
  const patch = {
    ...editResult.patch,
    ...mergeAdvertiserFieldsIntoOpportunity({}, advertiser)
  };
  const readiness = evaluateMatchingReadiness({ ...existing, ...patch });
  patch.matchingReadiness = readiness.matchingReadiness;
  patch.matchingReadinessMissing = readiness.matchingReadinessMissing;

  await patchOpportunity(id, patch);
  state.records.set(id, { ...existing, ...patch, id });
  state.bankReviewOpportunityId = null;

  await rematchOpportunity(id, { reason: "edit" });
  renderList();
  if (state.activeId === id) {
    await renderDetail(id);
  }
  setStatus(
    readiness.isReadyForMatching ? "الفرصة جاهزة للمطابقة" : "ما زالت تحتاج استكمال",
    "is-done"
  );
  toast(readiness.isReadyForMatching ? "تم استكمال البيانات" : "تم حفظ التعديلات");
}

async function saveEdit(id, existing, input) {
  const user = authUser();
  const result = buildEditPatch(existing, input, { actorUid: user?.uid || "" });
  if (!result.ok) {
    setStatus(result.error === "ownership_fields_protected"
      ? "لا يمكن تعديل حقول الملكية"
      : "لا توجد حقول قابلة للحفظ", "is-error");
    return;
  }
  const readiness = evaluateMatchingReadiness({ ...existing, ...result.patch });
  result.patch.matchingReadiness = readiness.matchingReadiness;
  result.patch.matchingReadinessMissing = readiness.matchingReadinessMissing;
  setStatus("جارٍ الحفظ…");
  try {
    await patchOpportunity(id, result.patch);
    state.records.set(id, { ...existing, ...result.patch, id });
    await rematchOpportunity(id, { reason: "edit" });
    renderList();
    setStatus("تم حفظ التعديلات", "is-done");
    toast("تم حفظ الفرصة");
    await renderDetail(id);
  } catch (error) {
    console.warn("[iaqar] bank edit", error);
    setStatus("تعذر حفظ التعديلات", "is-error");
  }
}

async function archiveOpportunity(id, existing) {
  const user = authUser();
  const result = buildArchivePatch(existing, { actorUid: user?.uid || "" });
  if (!result.ok) {
    setStatus("لا يمكن أرشفة هذه الفرصة", "is-error");
    return;
  }
  if (result.idempotent) {
    setStatus("الفرصة مؤرشفة مسبقًا", "is-done");
    return;
  }
  setStatus("جارٍ الأرشفة…");
  try {
    await patchOpportunity(id, result.patch);
    state.records.set(id, { ...existing, ...result.patch, id });
    renderList();
    await rematchOpportunity(id, { reason: "archive" });
    setStatus("تمت الأرشفة", "is-done");
    toast("تمت أرشفة الفرصة");
  } catch (error) {
    console.warn("[iaqar] bank archive", error);
    setStatus("تعذرت الأرشفة", "is-error");
  }
}

async function restoreOpportunity(id, existing) {
  const user = authUser();
  const result = buildRestorePatch(existing, { actorUid: user?.uid || "" });
  if (!result.ok) {
    setStatus("لا يمكن استعادة هذه الفرصة", "is-error");
    return;
  }
  if (result.idempotent) {
    setStatus("الفرصة نشطة مسبقًا", "is-done");
    return;
  }
  setStatus("جارٍ الاستعادة…");
  try {
    await patchOpportunity(id, result.patch);
    state.records.set(id, { ...existing, ...result.patch, id });
    renderList();
    await rematchOpportunity(id, { reason: "restore" });
    setStatus("تمت الاستعادة", "is-done");
    toast("تمت استعادة الفرصة");
  } catch (error) {
    console.warn("[iaqar] bank restore", error);
    setStatus("تعذرت الاستعادة", "is-error");
  }
}

async function softDeleteOpportunity(id, existing) {
  const user = authUser();
  const result = buildSoftDeletePatch(existing, { actorUid: user?.uid || "", reason: "permanent_delete" });
  if (result.idempotent) {
    setStatus("الفرصة محذوفة مسبقًا", "is-done");
    return;
  }
  setStatus("جارٍ الحذف النهائي…");
  try {
    await patchOpportunity(id, result.patch);
    await rematchOpportunity(id, { reason: "delete" });
    state.records.delete(id);
    state.activeId = null;
    $("opportunityBankDetail").hidden = true;
    renderList();
    setStatus("تم الحذف النهائي", "is-done");
    toast("تم حذف الفرصة نهائيًا");
  } catch (error) {
    console.warn("[iaqar] bank delete", error);
    setStatus("تعذر الحذف", "is-error");
  }
}

function confirmPermanentDelete(id, record) {
  const validation = validatePermanentDelete(record, { officeId: officeId() });
  if (!validation.allowed) {
    setStatus(validation.reason || "لا يمكن حذف هذه الفرصة", "is-error");
    toast(validation.reason || "لا يمكن حذف هذه الفرصة");
    return;
  }
  const modal = document.getElementById("permanentDeleteOverlay");
  const message = document.getElementById("permanentDeleteMessage");
  const cancelBtn = document.getElementById("permanentDeleteCancel");
  const confirmBtn = document.getElementById("permanentDeleteConfirm");
  if (!modal || !confirmBtn || !cancelBtn) {
    setStatus("تعذر فتح تأكيد الحذف", "is-error");
    return;
  }
  if (message) {
    message.textContent = "سيتم حذف هذه الفرصة نهائيًا، ولن يمكن استعادتها. هل أنت متأكد؟";
  }
  modal.hidden = false;
  const close = () => {
    modal.hidden = true;
    cancelBtn.removeEventListener("click", onCancel);
    confirmBtn.removeEventListener("click", onConfirm);
  };
  const onCancel = () => close();
  const onConfirm = () => {
    close();
    void softDeleteOpportunity(id, record);
  };
  cancelBtn.addEventListener("click", onCancel);
  confirmBtn.addEventListener("click", onConfirm);
}

async function hideSharedFromBankPanel(sharedId) {
  const runtime = officeRuntime();
  const user = authUser();
  if (!runtime?.db || !user) {
    setStatus("يلزم تسجيل الدخول", "is-error");
    return;
  }
  try {
    await runtime.db.collection("offices").doc(officeId())
      .collection("sharedOpportunities").doc(sharedId)
      .set({
        officeId: officeId(),
        revokedAt: new Date().toISOString(),
        hiddenFromBankAt: new Date().toISOString(),
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    setStatus("تم إخفاء الفرصة من بنكك", "is-done");
    toast("تم إخفاء الفرصة من بنكك");
    await loadSharedWithUs();
  } catch (error) {
    console.warn("[iaqar] hide shared panel", error);
    setStatus("تعذر إخفاء الفرصة", "is-error");
  }
}

async function hideSharedOpportunity(opportunityId) {
  const runtime = officeRuntime();
  const user = authUser();
  if (!runtime?.db || !user) {
    setStatus("يلزم تسجيل الدخول", "is-error");
    return;
  }
  try {
    await runtime.db.collection("offices").doc(officeId())
      .collection("opportunities").doc(opportunityId)
      .set({
        officeId: officeId(),
        hiddenFromBankAt: new Date().toISOString(),
        lifecycleStatus: LIFECYCLE.DELETED,
        deletedAt: new Date().toISOString(),
        deletionReason: "hidden_from_bank",
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    state.records.delete(opportunityId);
    state.activeId = null;
    $("opportunityBankDetail").hidden = true;
    renderList();
    setStatus("تم إخفاء الفرصة من بنكك", "is-done");
    toast("تم إخفاء الفرصة من بنكك");
    await loadSharedWithUs();
  } catch (error) {
    console.warn("[iaqar] hide shared", error);
    setStatus("تعذر إخفاء الفرصة", "is-error");
  }
}

async function createShareRequest({
  opportunityIds,
  targetOfficeId,
  scopeType,
  cooperationMessage = "",
  peerOpportunityId = "",
  suppressUi = false
}) {
  const user = authUser();
  const runtime = officeRuntime();
  if (!runtime?.db || !user) {
    const errorMessage = "يلزم تسجيل الدخول";
    if (!suppressUi) setShareActionStatus(errorMessage, "is-error");
    return { ok: false, errorMessage };
  }

  const mode = await readOfficeCooperationMode();
  if (!cooperationModeAllowsExplicitRequest(mode)) {
    const errorMessage = "التعاون معطّل في إعدادات هذا المكتب";
    if (!suppressUi) setShareActionStatus(errorMessage, "is-error");
    return { ok: false, errorMessage };
  }

  const ownedCheck = validateOwnedOpportunityIds(
    officeId(),
    state.records,
    opportunityIds
  );
  if (!ownedCheck.ok) {
    const errorMessage = "لا يمكن مشاركة فرص لا تتبع هذا المكتب";
    if (!suppressUi) setShareActionStatus(errorMessage, "is-error");
    return { ok: false, errorMessage };
  }

  const oppId = ownedCheck.accepted[0] || "";
  const shareValidation = validateOfficeShareSend({
    opportunityId: oppId,
    originatingOfficeId: officeId(),
    targetOfficeId
  });
  if (!shareValidation.ok) {
    if (!suppressUi) setShareActionStatus(shareValidation.message, "is-error");
    return { ok: false, errorMessage: shareValidation.message };
  }

  const duplicate = await hasActiveShareWithOffice(targetOfficeId, ownedCheck.accepted);
  if (duplicate) {
    const errorMessage = "يوجد مشاركة نشطة لهذه الفرصة مع هذا المكتب";
    if (!suppressUi) setShareActionStatus(errorMessage, "is-error");
    return { ok: false, duplicate: true, errorMessage };
  }

  const officeName = await resolveOfficeShareLabel(targetOfficeId);
  if (!suppressUi) setShareActionStatus("جاري الإرسال…");
  try {
    const token = await user.getIdToken();
    const response = await fetch(`${workerBaseUrl()}/cooperation/request`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Office-Id": officeId()
      },
      body: JSON.stringify({
        officeId: officeId(),
        targetOfficeId,
        opportunityIds: ownedCheck.accepted,
        scopeType,
        peerOpportunityId: String(peerOpportunityId || "").trim(),
        message: String(cooperationMessage || "").slice(0, 500)
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("[iaqar] cooperation request failed", {
        status: response.status,
        error: payload.error,
        message: payload.message,
        requestId: payload.requestId
      });
      const errMsg = payload.error === "same_office"
        ? "لا يمكن الإرسال إلى المكتب نفسه"
        : (payload.message || "تعذر إرسال الفرصة إلى المكتب");
      throw Object.assign(new Error(errMsg), { payload, status: response.status });
    }
    const successMessage = payload.duplicate
      ? "يوجد مشاركة نشطة لهذه الفرصة مع هذا المكتب"
      : `تم إرسال الفرصة إلى مكتب ${officeName}`;
    if (!suppressUi) setShareActionStatus(successMessage, "is-done");
    if (!payload.duplicate) {
      if (!suppressUi) toast("تم إرسال الفرصة إلى المكتب");
      appendWorkspaceActivityLine(officeShareSentActivityText(officeName));
      if (oppId) {
        void recordBrokerActionDone(oppId, "hub:share_to_office", {
          activeCooperationId: payload.cooperationRequestId || payload.requestId || "",
          cooperationState: "PENDING_APPROVAL",
          cooperationStatus: "PENDING_APPROVAL",
          cooperationTargetOfficeId: targetOfficeId,
          cooperationTargetOfficeName: officeName
        });
        if (!suppressUi) {
          await refreshWorkspaceCoopSection(oppId, {
            activeCooperationId: payload.cooperationRequestId || payload.requestId || "",
            cooperationState: "PENDING_APPROVAL",
            cooperationStatus: "PENDING_APPROVAL",
            cooperationTargetOfficeId: targetOfficeId,
            cooperationTargetOfficeName: officeName
          });
        }
      } else if (!suppressUi) {
        appendCoopRowToWorkspace(
          targetOfficeId,
          officeName,
          "PENDING",
          payload.cooperationRequestId || payload.requestId || ""
        );
      }
    } else if (oppId && !suppressUi) {
      await refreshWorkspaceCoopSection(oppId);
    }
    const requestId = payload.cooperationRequestId || payload.requestId || "";
    if (requestId) await syncCooperationOperation(requestId);
    window.dispatchEvent(new CustomEvent("iaqar:cooperation-request-created", {
      detail: {
        ...phase3BoundaryGuarantees(),
        ...phase5BoundaryGuarantees(),
        ...phase6BoundaryGuarantees(),
        requestId,
        createsAutomaticCooperation: false
      }
    }));
    return {
      ok: true,
      duplicate: Boolean(payload.duplicate),
      requestId,
      officeName
    };
  } catch (error) {
    console.error("[iaqar] cooperation request", error);
    const errorMessage = "تعذر إرسال الفرصة. حاول مرة أخرى.";
    if (!suppressUi) setShareActionStatus(errorMessage, "is-error");
    return { ok: false, errorMessage, technicalError: error };
  }
}

async function resolveOfficeShareLabel(targetOfficeId) {
  const runtime = officeRuntime();
  const target = String(targetOfficeId || "").trim();
  if (!target) return "مكتب";
  if (!runtime?.db) return target;
  try {
    const snap = await runtime.db.collection("publicOffices").doc(target).get();
    if (!snap.exists) return target;
    const data = snap.data() || {};
    return data.officeName || data.brokerName || target;
  } catch {
    return target;
  }
}

function confirmStopOpportunityShare(sharingScopeId, brokerName) {
  const modal = document.getElementById("stopShareOverlay");
  const message = document.getElementById("stopShareMessage");
  const cancelBtn = document.getElementById("stopShareCancel");
  const confirmBtn = document.getElementById("stopShareConfirm");
  if (!modal || !confirmBtn || !cancelBtn) {
    void revokeScopedShare(sharingScopeId);
    return;
  }
  const label = String(brokerName || "الوسيط").trim();
  if (message) {
    message.textContent =
      `هل تريد إيقاف مشاركة الفرصة مع ${label}؟ ستتوقف المشاركة مع هذا الوسيط فقط، ولن تُحذف الفرصة الأصلية من العروض والطلبات.`;
  }
  modal.hidden = false;
  const close = () => {
    modal.hidden = true;
    cancelBtn.removeEventListener("click", onCancel);
    confirmBtn.removeEventListener("click", onConfirm);
  };
  const onCancel = () => close();
  const onConfirm = () => {
    close();
    void revokeScopedShare(sharingScopeId);
  };
  cancelBtn.addEventListener("click", onCancel);
  confirmBtn.addEventListener("click", onConfirm);
}

async function revokeScopedShare(sharingScopeId) {
  const user = authUser();
  if (!user?.getIdToken || !sharingScopeId) {
    setStatus("يلزم تسجيل الدخول", "is-error");
    return;
  }
  setStatus("جارٍ إنهاء المشاركة…");
  try {
    const token = await user.getIdToken();
    const result = await requestScopeRevoke({
      workerBase: workerBaseUrl(),
      idToken: token,
      officeId: officeId(),
      sharingScopeId,
      reason: "broker_revoked_scope"
    });
    if (!result.ok) {
      setStatus(result.message || "تعذر إنهاء المشاركة", "is-error");
      return;
    }
    setStatus("تم إيقاف مشاركة الفرصة", "is-done");
    toast("تم إيقاف مشاركة الفرصة");
    await loadOutgoingScopes();
  } catch (error) {
    console.warn("[iaqar] scope revoke", error);
    setStatus("تعذر إنهاء المشاركة", "is-error");
  }
}

async function hasActiveShareWithOffice(targetOfficeId, opportunityIds = []) {
  const runtime = officeRuntime();
  if (!runtime?.db || !targetOfficeId || !opportunityIds.length) return false;
  const target = String(targetOfficeId).trim();
  const ids = new Set(opportunityIds.map(String));
  try {
    const scopeSnap = await runtime.db.collection("bankSharingScopes")
      .where("originatingOfficeId", "==", officeId())
      .where("targetOfficeId", "==", target)
      .limit(20)
      .get();
    for (const doc of scopeSnap.docs) {
      const data = doc.data() || {};
      if (data.status !== "ACTIVE" || data.enabled === false || data.revokedAt) continue;
      const shared = Array.isArray(data.opportunityIds) ? data.opportunityIds : [];
      if (shared.some((id) => ids.has(String(id)))) return true;
    }
    const coopSnap = await runtime.db.collection("cooperationRequests")
      .where("originatingOfficeId", "==", officeId())
      .where("targetOfficeId", "==", target)
      .limit(20)
      .get();
    for (const doc of coopSnap.docs) {
      const data = doc.data() || {};
      const status = String(data.status || "").toUpperCase();
      if (!["PENDING", "ACCEPTED"].includes(status)) continue;
      const shared = Array.isArray(data.opportunityIds) ? data.opportunityIds
        : (data.opportunityId ? [data.opportunityId] : []);
      if (shared.some((id) => ids.has(String(id)))) return true;
    }
  } catch (error) {
    console.warn("[iaqar] duplicate share check", error);
  }
  return false;
}

async function loadCooperationNearbySuggestions(opportunityId, record) {
  const panel = document.getElementById("bankCooperationNearby");
  if (!panel) return;
  const user = authUser();
  if (!user?.getIdToken) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  panel.innerHTML = `<h4>مكاتب قريبة للتعاون</h4><p class="bank-note">جارٍ البحث…</p>`;
  try {
    const token = await user.getIdToken();
    const response = await fetch(`${workerBaseUrl()}/cooperation/nearby-suggestions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ officeId: officeId(), opportunityId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      panel.innerHTML = `<h4>مكاتب قريبة للتعاون</h4><p class="bank-note">${escapeHtml(nearbyEmptyMessage("load_failed"))}</p>`;
      return;
    }
    if (!Array.isArray(payload.suggestions) || !payload.suggestions.length) {
      panel.innerHTML = `<h4>مكاتب قريبة للتعاون</h4><p class="bank-note">${escapeHtml(nearbyEmptyMessage(payload.emptyReason || {}))}</p>`;
      return;
    }
    panel.innerHTML = `<h4>فرصة تعاون</h4>
      ${payload.suggestions.map((row) => `
        <div class="bank-cooperation-nearby-item">
          <strong>${escapeHtml(row.officeName || row.officeId)}</strong>
          <span>${escapeHtml(row.neighborhoodLabel || "")} — ${escapeHtml(String(row.matchScore || 0))}٪</span>
          <span class="bank-note">${escapeHtml(row.matchReason || "")}</span>
          <button type="button" class="bank-action" data-cooperation-request="${escapeHtml(row.officeId)}"
            data-cooperation-opp="${escapeHtml(opportunityId)}"
            data-cooperation-peer="${escapeHtml(row.opportunityId || "")}">طلب تعاون</button>
        </div>`).join("")}`;
    panel.querySelectorAll("[data-cooperation-request]").forEach((btn) => {
      btn.addEventListener("click", () => {
        void createShareRequest({
          opportunityIds: [opportunityId],
          targetOfficeId: btn.getAttribute("data-cooperation-request"),
          scopeType: "community_pair",
          peerOpportunityId: btn.getAttribute("data-cooperation-peer") || ""
        });
      });
    });
  } catch (error) {
    console.warn("[iaqar] cooperation nearby", error);
    panel.innerHTML = `<h4>مكاتب قريبة للتعاون</h4><p class="bank-note">${escapeHtml(nearbyEmptyMessage("load_failed"))}</p>`;
  }
}

function shareStatusLabel(scope = {}) {
  if (scope.shareKind === "cooperation") {
    return shareRequestStatusLabel(scope.status)
      || cooperationStatusLabel(cooperationStateFromShareStatus(scope.status));
  }
  return shareRequestStatusLabel(scope.status) || "قابلة للإلغاء";
}

function nearbyEmptyMessage(emptyReason = {}) {
  const code = String(emptyReason?.code || emptyReason || "").trim();
  if (code === "incomplete_data") {
    const labels = Array.isArray(emptyReason.missingLabels)
      ? emptyReason.missingLabels
      : missingFieldLabelsArabic(emptyReason.missing || []);
    const fields = labels.length ? labels.join("، ") : "الميزانية، المساحة";
    return `أكمل بيانات الفرصة لتشغيل البحث عن المكاتب القريبة: ${fields}.`;
  }
  if (code === "not_enabled") return "التعاون مع الوسطاء غير مفعّل لهذا المكتب.";
  if (code === "no_same_neighborhood") return "لا توجد عروض مطابقة داخل الحي.";
  if (code === "no_adjacent") return "لا توجد فرصة تعاون متوافقة حاليًا.";
  return "تعذر تحميل اقتراحات التعاون؛ حاول مرة أخرى.";
}

function renderOutgoingShareDetail(scopeKey) {
  const panel = $("bankOutgoingScopes");
  if (!panel) return;
  const scope = outgoingShareRowsCache.find((row) => row.shareKey === scopeKey);
  if (!scope) return;
  activeOutgoingShareKey = scopeKey;
  const officeLabel = scope.officeLabel || scope.targetOfficeId || "";
  const oppIds = Array.isArray(scope.opportunityIds) ? scope.opportunityIds : [];
  const oppCards = oppIds.map((oppId) => {
    const record = state.records.get(oppId) || { id: oppId };
    const card = buildOpportunityCardView({ ...record, id: oppId });
    return `
      <article class="bank-opp-summary">
        <p class="bank-kind-badge">${escapeHtml(card.kindBadge)}</p>
        <h4>${escapeHtml(card.description)}</h4>
        <p>${escapeHtml(card.location)}</p>
        <p>${escapeHtml(card.priceOrBudget)} · ${escapeHtml(card.area)}</p>
      </article>`;
  }).join("");

  const revokeBtn = scope.shareKind === "scope"
    ? `<button type="button" class="bank-action danger" id="bankOutgoingShareRevoke">إيقاف مشاركة الفرصة</button>`
    : "";

  const detailHtml = `
    <div class="bank-share-detail-panel" id="bankOutgoingShareDetail">
      <div class="bank-detail-head">
        <h3>تفاصيل المشاركة</h3>
        <button type="button" class="settings-close" id="bankOutgoingShareClose" aria-label="إغلاق">×</button>
      </div>
      <p><strong>المكتب:</strong> ${escapeHtml(officeLabel)}</p>
      <p><strong>الحالة:</strong> ${escapeHtml(shareStatusLabel(scope))}</p>
      <p><strong>تاريخ المشاركة:</strong> ${escapeHtml(scope.createdAtLabel || "—")}</p>
      <p><strong>آخر إجراء:</strong> ${escapeHtml(scope.lastActionLabel || "—")}</p>
      ${oppCards}
      <p class="bank-note">لا تُعرض بيانات التواصل قبل قبول التعاون.</p>
      ${revokeBtn}
    </div>`;

  const existing = panel.querySelector("#bankOutgoingShareDetail");
  if (existing) existing.remove();
  panel.insertAdjacentHTML("beforeend", detailHtml);
  panel.querySelector("#bankOutgoingShareClose")?.addEventListener("click", () => {
    activeOutgoingShareKey = "";
    panel.querySelector("#bankOutgoingShareDetail")?.remove();
  });
  panel.querySelector("#bankOutgoingShareRevoke")?.addEventListener("click", () => {
    confirmStopOpportunityShare(scope.id, officeLabel);
  });
}

async function loadOutgoingScopes() {
  const runtime = officeRuntime();
  const panel = $("bankOutgoingScopes");
  if (!runtime?.db || !panel) return;
  const hidePanelInDetail = Boolean(state.activeId);
  try {
    const scopeSnap = await runtime.db.collection("bankSharingScopes")
      .where("originatingOfficeId", "==", officeId())
      .limit(20)
      .get();
    const scopeRows = scopeSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data(), shareKind: "scope" }))
      .filter((scope) => scope.status === "ACTIVE" && scope.enabled !== false && !scope.revokedAt)
      .filter((scope) => Array.isArray(scope.opportunityIds) && scope.opportunityIds.length > 0);

    const coopSnap = await runtime.db.collection("cooperationRequests")
      .where("originatingOfficeId", "==", officeId())
      .limit(30)
      .get();
    const coopRows = coopSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data(), shareKind: "cooperation" }))
      .filter((row) => ["PENDING", "ACCEPTED"].includes(String(row.status || "").toUpperCase()))
      .map((row) => ({
        ...row,
        opportunityIds: Array.isArray(row.opportunityIds) && row.opportunityIds.length
          ? row.opportunityIds
          : (row.opportunityId ? [row.opportunityId] : [])
      }))
      .filter((row) => row.opportunityIds.length > 0);

    const active = [...coopRows, ...scopeRows];
    const names = await Promise.all(
      active.map((scope) => resolveOfficeShareLabel(scope.targetOfficeId))
    );
    outgoingShareRowsCache.length = 0;
    for (let index = 0; index < active.length; index += 1) {
      const scope = active[index];
      const officeLabel = names[index] || scope.targetOfficeId || "";
      for (const oppId of scope.opportunityIds) {
        const shareKey = `${scope.shareKind}:${scope.id}:${oppId}`;
        outgoingShareRowsCache.push({
          shareKey,
          id: scope.id,
          shareKind: scope.shareKind,
          targetOfficeId: scope.targetOfficeId,
          officeLabel,
          opportunityIds: [oppId],
          status: scope.status,
          createdAtLabel: formatShareDate(scope.createdAt),
          lastActionLabel: scope.lastActionLabel || scope.status || "—",
          collaborationId: scope.id
        });
      }
    }

    if (!outgoingShareRowsCache.length || hidePanelInDetail) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }
    panel.hidden = false;
    panel.innerHTML = `<h3>مشاركات نشطة مع مكاتب أخرى</h3>
      ${outgoingShareRowsCache.map((scope) => {
        const record = state.records.get(scope.opportunityIds[0]) || {};
        const card = buildOpportunityCardView({ ...record, id: scope.opportunityIds[0] });
        const statusLabel = shareStatusLabel(scope);
        return `
        <button type="button" class="bank-incoming-item is-clickable" data-open-share="${escapeHtml(scope.shareKey)}">
          <strong>${escapeHtml(card.description || scope.opportunityIds[0])}</strong>
          <span>إلى ${escapeHtml(scope.officeLabel)} — ${escapeHtml(statusLabel)}</span>
        </button>`;
      }).join("")}`;
    panel.querySelectorAll("[data-open-share]").forEach((btn) => {
      btn.addEventListener("click", () => {
        renderOutgoingShareDetail(btn.getAttribute("data-open-share") || "");
      });
    });
    if (activeOutgoingShareKey) {
      renderOutgoingShareDetail(activeOutgoingShareKey);
    }
  } catch (error) {
    console.warn("[iaqar] outgoing scopes", error);
  }
}

function formatShareDate(value) {
  if (!value) return "—";
  try {
    const date = value?.toDate ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
  } catch {
    return "—";
  }
}

async function loadSharedWithUs() {
  const runtime = officeRuntime();
  const panel = $("bankSharedWithUs");
  if (!runtime?.db || !panel) return;
  try {
    const snap = await runtime.db.collection("offices").doc(officeId())
      .collection("sharedOpportunities")
      .limit(30)
      .get();
    const rows = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((row) => !row.revokedAt);
    if (!rows.length) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }
    panel.hidden = false;
    panel.innerHTML = `<h3>فرص مشاركة مع مكتبكم</h3>
      <p class="bank-note">قراءة فقط — بدون بيانات تواصل. الملكية تبقى للمكتب الأصلي.</p>
      ${rows.map((row) => `
        <div class="bank-incoming-item" data-shared-id="${escapeHtml(row.id)}">
          <div>
            <strong>${escapeHtml([row.propertyType, row.district, row.city].filter(Boolean).join(" — ") || row.id)}</strong>
            <p>من ${escapeHtml(row.originatingOfficeId || "")} — ${escapeHtml(cooperationStatusLabel(row.cooperationStatus || "ACTIVE"))}</p>
          </div>
          <button type="button" class="bank-action" data-hide-shared="${escapeHtml(row.id)}">إزالة من بنكي</button>
        </div>
      `).join("")}`;
  } catch (error) {
    console.warn("[iaqar] shared with us", error);
  }
}

function bindListClicks() {
  const list = $("opportunityBankList");
  if (!list || list.dataset.bound === "1") return;
  list.dataset.bound = "1";
  list.addEventListener("click", (event) => {
    const row = event.target.closest(".bank-row-card[data-opportunity-id]");
    if (!row) {
      if (event.target.closest("[data-summary-key], #bankLoadMoreBtn, .bank-action, [data-bank-open-tasks]")) return;
      return;
    }
    if (event.target.closest("button, a")) return;
    const openId = resolveBankRowOpportunityId(row);
    if (!openId) return;
    event.preventDefault();
    void openBankDetailFromList(openId);
  });
  list.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest(".bank-row-card[data-opportunity-id]");
    if (!row) return;
    event.preventDefault();
    const openId = resolveBankRowOpportunityId(row);
    if (!openId) return;
    void openBankDetailFromList(openId);
  });
}

async function revokeCooperation(opportunityId, record) {
  const user = authUser();
  const requestId = record.activeCooperationId;
  if (!user || !requestId) {
    setStatus("لا يوجد تعاون نشط لإلغائه", "is-error");
    return;
  }
  setStatus("جارٍ إنهاء التعاون…");
  try {
    // Phase 6 trusted path: revoke + remove target shared projections + audit.
    const result = await runTrustedCooperationLifecycle(requestId, "REVOKE", "broker_revoked");
    if (!result.ok) {
      setStatus(result.message || "تعذر إنهاء التعاون", "is-error");
      return;
    }
    setStatus("انتهى التعاون", "is-done");
    toast("تم إنهاء التعاون");
    window.dispatchEvent(new CustomEvent("iaqar:cooperation-revoked", {
      detail: {
        requestId,
        opportunityId,
        ...phase6BoundaryGuarantees()
      }
    }));
    await loadSharedWithUs();
    if (state.activeId === opportunityId) await renderDetail(opportunityId);
  } catch (error) {
    console.warn("[iaqar] revoke cooperation", error);
    setStatus("تعذر إنهاء التعاون", "is-error");
  }
}

async function syncOpportunityCooperationFromRequests() {
  const runtime = officeRuntime();
  const user = authUser();
  if (!runtime?.db || !user || !officeId()) return;
  const ids = [...state.records.values()]
    .map((record) => record.activeCooperationId)
    .filter(Boolean);
  const unique = [...new Set(ids)];
  for (const requestId of unique) {
    try {
      const snap = await runtime.db.collection("cooperationRequests").doc(requestId).get();
      if (!snap.exists) continue;
      const request = snap.data();
      const mapped = cooperationStateFromShareStatus(request.status);
      for (const [oppId, record] of state.records.entries()) {
        if (record.activeCooperationId !== requestId) continue;
        if (String(record.cooperationState || record.cooperationStatus) === mapped) continue;
        await patchOpportunity(oppId, {
          cooperationState: mapped,
          cooperationStatus: mapped
        });
        state.records.set(oppId, { ...record, cooperationState: mapped, cooperationStatus: mapped });
      }
    } catch (error) {
      console.warn("[iaqar] sync cooperation status", error);
    }
  }
}

async function loadIncomingRequests() {
  const runtime = officeRuntime();
  const user = authUser();
  const panel = $("bankIncomingRequests");
  const list = $("bankIncomingList");
  if (!panel || !list) return;
  if (!runtime?.db || !user || !officeId()) {
    panel.hidden = true;
    return;
  }
  try {
    const snap = await runtime.db.collection("cooperationRequests")
      .where("targetOfficeId", "==", officeId())
      .where("status", "==", SHARE_REQUEST_STATUS.PENDING)
      .limit(20)
      .get();
    if (snap.empty) {
      panel.hidden = true;
      list.innerHTML = "";
      return;
    }
    panel.hidden = false;
    list.innerHTML = snap.docs.map((docSnap) => {
      const request = { id: docSnap.id, ...(docSnap.data() || {}) };
      return buildIncomingCooperationItemHtml(request, docSnap.id);
    }).join("");
  } catch (error) {
    console.warn("[iaqar] incoming cooperation", error);
    panel.hidden = true;
  }
}

async function decideIncomingRequest(requestId, decision) {
  const user = authUser();
  if (!user) {
    setStatus("يلزم تسجيل الدخول", "is-error");
    return;
  }
  const action = decision === "ACCEPT"
    ? "ACCEPT"
    : (decision === "REQUEST_DETAILS" ? "REQUEST_DETAILS" : "REJECT");
  if (action === "ACCEPT") {
    const mode = await readOfficeCooperationMode();
    if (!cooperationModeAllowsAccept(mode)) {
      setStatus("التعاون معطّل في إعدادات هذا المكتب", "is-error");
      return;
    }
  }
  setStatus(action === "ACCEPT" ? "جارٍ قبول الطلب…" : (action === "REQUEST_DETAILS" ? "جارٍ إرسال طلب التفاصيل…" : "جارٍ تسجيل الاعتذار…"));
  try {
    const result = await runTrustedCooperationLifecycle(
      requestId,
      action
    );
    if (!result.ok) {
      setStatus(result.message || "تعذر تحديث الطلب", "is-error");
      return;
    }

    const doneMessage = action === "ACCEPT"
      ? "تم قبول طلب التعاون"
      : (action === "REQUEST_DETAILS" ? "تم إرسال طلب التفاصيل" : "تم تسجيل الاعتذار");
    setStatus(doneMessage, "is-done");
    toast(action === "ACCEPT" ? "تم قبول التعاون" : doneMessage);
    window.dispatchEvent(new CustomEvent("iaqar:cooperation-decided", {
      detail: {
        requestId,
        decision,
        ...phase6BoundaryGuarantees()
      }
    }));
    await loadIncomingRequests();
    await loadSharedWithUs();
    if (state.activeId) await refreshWorkspaceCoopSection(state.activeId);
  } catch (error) {
    console.warn("[iaqar] decide incoming", error);
    setStatus("تعذر تحديث طلب التعاون", "is-error");
  }
}

function baseOpportunityQuery(db) {
  // Strictly scoped to this office path — never collectionGroup.
  return db.collection("offices").doc(officeId())
    .collection("opportunities")
    .orderBy("createdAt", "desc");
}

async function refreshBankFacetMeta(runtime) {
  let snapshot;
  try {
    snapshot = await baseOpportunityQuery(runtime.db)
      .select(
        "city",
        "district",
        "propertyType",
        "purpose",
        "matchingReadiness",
        "lifecycleStatus",
        "archivedAt",
        "deletedAt",
        "contactName",
        "advertiserDisplayName",
        "opportunityKind"
      )
      .get();
  } catch (selectError) {
    console.warn("[iaqar] bank summary select fallback", selectError);
    snapshot = await baseOpportunityQuery(runtime.db).limit(500).get();
  }
  state.facetMeta = snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() || {})
  }));
  state.summary = summarizeBankCounts(state.facetMeta);
}

async function loadBankSummary() {
  const runtime = officeRuntime();
  const user = authUser();
  if (!runtime?.db || !user || !officeId()) {
    setStatus("سجل دخول المكتب لعرض العروض والطلبات", "is-error");
    return;
  }
  await refreshBankFacetMeta(runtime);
  renderList();
  setStatus(rowsCountLabel());
  await loadIncomingRequests();
}

/**
 * Query-driven page load: scan office-scoped pages until BANK_PAGE_SIZE matches
 * the active search/filters (or the cursor is exhausted). Never dumps the full bank into DOM.
 */
async function loadBankPage({ reset = false } = {}) {
  const runtime = officeRuntime();
  const user = authUser();
  const loadMoreBtn = $("bankLoadMoreBtn");

  if (!runtime?.db || !user || !officeId()) {
    setStatus("سجل دخول المكتب لعرض العروض والطلبات", "is-error");
    if (loadMoreBtn) loadMoreBtn.hidden = true;
    return;
  }

  if (state.busy) return;
  state.busy = true;
  setStatus(reset ? "جارٍ تحميل العروض والطلبات…" : "جارٍ تحميل المزيد…");

  try {
    if (reset) {
      await refreshBankFacetMeta(runtime);
      state.records.clear();
      state.lastDoc = null;
      state.hasMore = false;
      state.resultTotal = 0;
      state.scanExhausted = false;
    }

    if (!hasActiveBankQuery(state.queryFilters)) {
      let query = baseOpportunityQuery(runtime.db).limit(BANK_PAGE_SIZE);
      if (state.lastDoc) {
        query = baseOpportunityQuery(runtime.db).startAfter(state.lastDoc).limit(BANK_PAGE_SIZE);
      }
      const snapshot = await query.get();
      if (!snapshot.docs.length) {
        state.scanExhausted = true;
        state.hasMore = false;
      } else {
        state.lastDoc = snapshot.docs[snapshot.docs.length - 1];
        state.scanExhausted = snapshot.docs.length < BANK_PAGE_SIZE;
        state.hasMore = !state.scanExhausted;
        for (const docSnap of snapshot.docs) {
          const record = { id: docSnap.id, ...(docSnap.data() || {}) };
          if (!isVisibleForFilter(record)) continue;
          state.records.set(docSnap.id, record);
        }
      }
      state.resultTotal = state.scanExhausted
        ? [...state.records.values()].filter(passesListFilters).length
        : Math.max(state.records.size, state.summary?.total || 0);
      await syncOpportunityCooperationFromRequests();
      renderList();
      await loadIncomingRequests();
      setStatus(rowsCountLabel());
      return;
    }

    let matchedThisPass = 0;
    let scans = 0;
    const maxScans = 25;

    while (matchedThisPass < BANK_PAGE_SIZE && scans < maxScans && !state.scanExhausted) {
      scans += 1;
      let query = baseOpportunityQuery(runtime.db).limit(BANK_PAGE_SIZE);
      if (state.lastDoc) {
        query = baseOpportunityQuery(runtime.db).startAfter(state.lastDoc).limit(BANK_PAGE_SIZE);
      }
      const snapshot = await query.get();
      if (!snapshot.docs.length) {
        state.scanExhausted = true;
        state.hasMore = false;
        break;
      }
      state.lastDoc = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.docs.length < BANK_PAGE_SIZE) {
        state.scanExhausted = true;
      }

      for (const docSnap of snapshot.docs) {
        const record = { id: docSnap.id, ...(docSnap.data() || {}) };
        if (!isVisibleForFilter(record)) continue;
        if (!matchesBankQueryFilters(record, state.queryFilters)) continue;
        if (state.records.has(docSnap.id)) continue;
        state.records.set(docSnap.id, record);
        matchedThisPass += 1;
        if (matchedThisPass >= BANK_PAGE_SIZE) break;
      }
    }

    state.hasMore = !state.scanExhausted;
    state.resultTotal = state.records.size + (state.hasMore ? 0 : 0);
    // Approximate visible total: exact when exhausted, otherwise "at least N".
    if (state.scanExhausted) {
      state.resultTotal = [...state.records.values()].filter(passesListFilters).length;
    } else {
      state.resultTotal = Math.max(
        [...state.records.values()].filter(passesListFilters).length,
        state.records.size
      );
    }

    await syncOpportunityCooperationFromRequests();
    renderList();
    await loadIncomingRequests();

    const visible = [...state.records.values()].filter(passesListFilters).length;
    setStatus(
      visible
        ? rowsCountLabel()
        : "لا توجد نتائج مطابقة للبحث أو الفلاتر."
    );
  } catch (error) {
    console.warn("[iaqar] opportunity bank", error);
    setStatus("تعذر تحميل العروض والطلبات — أعد المحاولة", "is-error");
    const retry = $("opportunityBankRetry");
    if (retry) retry.hidden = false;
  } finally {
    state.busy = false;
    if (state.pendingQueryRefresh) {
      state.pendingQueryRefresh = false;
      scheduleBankQueryRefresh();
    }
  }
}

function startListener() {
  stopListener();
  state.records.clear();
  state.lastDoc = null;
  state.hasMore = false;
  state.scanExhausted = false;
  void loadBankPage({ reset: true });
  void loadIncomingRequests();
  void loadSharedWithUs();
  void loadOutgoingScopes();
}

function scheduleBankQueryRefresh() {
  if (state.busy) {
    state.pendingQueryRefresh = true;
    return;
  }
  void loadBankPage({ reset: true });
}

function isInlineBankRoot() {
  return $("opportunityBank")?.dataset.inlineBank === "1";
}

function emitBankOpened() {
  window.dispatchEvent(new CustomEvent("iaqar:opportunity-bank-opened", {
    detail: {
      arabicStatuses: [...FIVE_ARABIC_COOPERATION_STATUSES],
      ...phase6BoundaryGuarantees()
    }
  }));
}

export function activateOpportunityBankInline() {
  const retry = $("opportunityBankRetry");
  if (retry) retry.hidden = true;
  startListener();
  emitBankOpened();
}

export function pauseOpportunityBankInline() {
  if (state.activeId) closeBankDetailInternal();
  stopListener();
}

export function openOpportunityBank() {
  const bankRoot = $("opportunityBank");
  if (!bankRoot) return;

  if (isInlineBankRoot()) {
    window.IAQAR?.homeTabs?.switchTo("opportunities", "bank");
    const bankPanel = document.getElementById("oppPanelBank");
    if (bankPanel) bankPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    activateOpportunityBankInline();
    return;
  }

  bankRoot.hidden = false;
  document.body.style.overflow = "hidden";
  const retry = $("opportunityBankRetry");
  if (retry) retry.hidden = true;
  startListener();
  emitBankOpened();
  window.dispatchEvent(new CustomEvent("iaqar:nav-open", { detail: { view: "opportunityBank" } }));
}

export function closeOpportunityBank(options = {}) {
  if (isInlineBankRoot()) {
    let { fromPopstate = false } = options;
    if (!fromPopstate) {
      if (state.activeId) {
        if (window.history?.state?.iaqarOverlay) {
          window.history.back();
          return;
        }
        closeBankDetailInternal();
      }
      return;
    }
    pauseOpportunityBankInline();
    state.lastDoc = null;
    state.hasMore = false;
    window.dispatchEvent(new CustomEvent("iaqar:opportunity-bank-closed"));
    return;
  }

  let { fromPopstate = false } = options;
  if (!fromPopstate) {
    if (state.activeId) {
      if (window.history?.state?.iaqarOverlay) window.history.back();
      else closeBankDetailInternal();
    }
    const overlay = $("opportunityBank");
    if (overlay && !overlay.hidden) {
      if (window.history?.state?.iaqarOverlay) {
        window.history.back();
        return;
      }
      fromPopstate = true;
    } else {
      return;
    }
  }
  stopListener();
  const overlay = $("opportunityBank");
  if (overlay) overlay.hidden = true;
  const detail = $("opportunityBankDetail");
  if (detail) {
    detail.hidden = true;
    detail.innerHTML = "";
  }
  state.activeId = null;
  state.lastDoc = null;
  state.hasMore = false;
  if ($("officeSettings")?.hidden) document.body.style.overflow = "";
  window.dispatchEvent(new CustomEvent("iaqar:opportunity-bank-closed"));
}

function boot() {
  const bankRoot = $("opportunityBank");
  if (!bankRoot) return;
  if (bankRoot.dataset.bound === "1") return;
  bankRoot.dataset.bound = "1";

  if (!isInlineBankRoot()) {
    const closeBtn = $("opportunityBankClose");
    closeBtn?.addEventListener("click", () => closeOpportunityBank());
    bankRoot.addEventListener("click", (event) => {
      if (event.target === bankRoot) closeOpportunityBank();
    });
  }
  $("opportunityBankRetry")?.addEventListener("click", () => {
    const retry = $("opportunityBankRetry");
    if (retry) retry.hidden = true;
    if (hasActiveBankQuery(state.queryFilters)) void loadBankPage({ reset: true });
    else void loadBankSummary();
  });
  $("bankLoadMoreBtn")?.addEventListener("click", () => void loadBankPage({ reset: false }));
  $("bankFilterActive")?.addEventListener("click", () => {
    state.filter = "active";
    state.queryFilters.summaryKey = "ready";
    syncFilterButtons();
    scheduleBankQueryRefresh();
  });
  $("bankFilterArchived")?.addEventListener("click", () => {
    state.filter = "archived";
    state.queryFilters.summaryKey = "archived";
    syncFilterButtons();
    scheduleBankQueryRefresh();
  });
  $("bankFilterSearch")?.addEventListener("input", (event) => {
    state.queryFilters.search = event.currentTarget.value || "";
    if (state.queryFilters.search.trim()) {
      scheduleBankQueryRefresh();
    } else {
      state.queryFilters.summaryKey = state.filter === "archived" ? "archived" : "ready";
      scheduleBankQueryRefresh();
    }
  });
  $("bankIncomingList")?.addEventListener("click", (event) => {
    const acceptId = event.target.closest?.("[data-accept-request]")?.getAttribute("data-accept-request");
    const rejectId = event.target.closest?.("[data-reject-request]")?.getAttribute("data-reject-request");
    const detailsId = event.target.closest?.("[data-details-request]")?.getAttribute("data-details-request");
    if (acceptId) void decideIncomingRequest(acceptId, "ACCEPT");
    if (detailsId) void decideIncomingRequest(detailsId, "REQUEST_DETAILS");
    if (rejectId) void decideIncomingRequest(rejectId, "REJECT");
  });
  $("bankSharedWithUs")?.addEventListener("click", (event) => {
    const sharedId = event.target.closest?.("[data-hide-shared]")?.getAttribute("data-hide-shared");
    if (sharedId) void hideSharedFromBankPanel(sharedId);
  });
  bindListClicks();

  window.addEventListener("iaqar:cooperation-request-created", () => {
    if (state.activeId) void refreshWorkspaceCoopSection(state.activeId);
    void loadOutgoingScopes();
  });
  window.addEventListener("iaqar:cooperation-decided", () => {
    if (state.activeId) void refreshWorkspaceCoopSection(state.activeId);
    void loadOutgoingScopes();
  });
  window.addEventListener("iaqar:cooperation-revoked", () => {
    if (state.activeId) void refreshWorkspaceCoopSection(state.activeId);
    void loadOutgoingScopes();
  });

  window.addEventListener("iaqar:office-settings-closed", () => closeOpportunityBank());
}

async function openOpportunityDetailGlobal(opportunityId) {
  openOpportunityBank();
  if (!opportunityId) return false;
  setDetailRenderContext({ dailyTask: false });
  const runtime = officeRuntime();
  if (!runtime?.db || !officeId()) return false;
  try {
    const snap = await runtime.db.collection("offices").doc(officeId())
      .collection("opportunities").doc(opportunityId).get();
    if (!snap.exists) return false;
    const record = { id: opportunityId, ...(snap.data() || {}) };
    state.records.set(opportunityId, record);
    await renderDetail(opportunityId);
    scrollBankDetailIntoView();
    return true;
  } catch (error) {
    console.warn("[iaqar] open opportunity detail", error);
    return false;
  }
}

async function renderDailyTaskOpportunityGlobal(containerId, opportunityId) {
  const panelId = String(containerId || "operationsTaskPanel").trim();
  const id = String(opportunityId || "").trim();
  const panel = document.getElementById(panelId);
  if (!panel || !id) return false;
  const runtime = officeRuntime();
  if (!runtime?.db || !officeId()) return false;
  try {
    const snap = await runtime.db.collection("offices").doc(officeId())
      .collection("opportunities").doc(id).get();
    if (!snap.exists) {
      toast("لم يتم العثور على الفرصة");
      return false;
    }
    const data = snap.data() || {};
    if (data.officeId && String(data.officeId) !== officeId()) {
      toast("لا يمكن فتح هذه الفرصة من هذا المكتب");
      return false;
    }
    const record = { id, ...data };
    state.records.set(id, record);
    panel.hidden = false;
    await renderDetail(id, { panelId, dailyTask: true });
    scrollBankDetailIntoView();
    return true;
  } catch (error) {
    console.warn("[iaqar] render daily task opportunity", error);
    toast("تعذر فتح الفرصة");
    return false;
  }
}

function registerOpportunityBankGlobals() {
  window.IAQAR = window.IAQAR || {};
  window.IAQAR.openOpportunityBank = openOpportunityBank;
  window.IAQAR.activateOpportunityBankInline = activateOpportunityBankInline;
  window.IAQAR.pauseOpportunityBankInline = pauseOpportunityBankInline;
  window.IAQAR.openOpportunityDetail = openOpportunityDetailGlobal;
  window.IAQAR.renderDailyTaskOpportunity = renderDailyTaskOpportunityGlobal;
  window.IAQAR.closeOpportunityBank = closeOpportunityBank;
  window.IAQAR.isBankDetailOpen = isBankDetailOpen;
  window.IAQAR.closeBankDetailInternal = closeBankDetailInternal;
  window.IAQAR.bankTestHooks = Object.freeze({
    resolveBankRowOpportunityId,
    focusFirstMissingBankField,
    canOpenBankOpportunity,
    bankMissingFieldSelectors: BANK_MISSING_FIELD_SELECTORS
  });
}

registerOpportunityBankGlobals();

function syncFilterButtons() {
  $("bankFilterActive")?.classList.toggle("is-active", state.filter === "active");
  $("bankFilterArchived")?.classList.toggle("is-active", state.filter === "archived");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
