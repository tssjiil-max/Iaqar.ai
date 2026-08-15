/**
 * Phase 3 — Opportunity Bank UI controller.
 * Accessible only from Office Settings → بنك الفرص.
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
  buildSoftDeletePatch,
  cooperationStateFromShareStatus,
  cooperationStatusLabel,
  shareRequestStatusLabel,
  phase3BoundaryGuarantees,
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
  ADVERTISER_ROLES,
  ADVERTISER_CONTACT_STATUSES,
  MARKETING_CONSENT_STATUSES,
  buildAdvertiserDataPatch,
  buildAdvertiserWhatsAppMessage,
  buildAdvertiserContactActions,
  e164ToLocalInput,
  marketingConsentStatusLabel,
  readAdvertiserDisplayName,
  readAdvertiserPhoneFromRecord,
  setAdvertiserMessageModalContext
} from "./advertiser-phone-domain.js";
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
  buildListingShareMessage,
  telegramShareUrl,
  whatsAppShareUrl
} from "./listing-share-domain.js";
import { isLandProperty } from "./opportunity-intake-domain.js";
import { buildOpportunityCardView, contactLineMarkup } from "./opportunity-card-domain.js";
import { buildBankListCardView } from "./bank-list-card-domain.js";
import { normalizeOpportunityFinancials } from "./opportunity-intake-domain.js";
import { formatLocalPhoneDisplay } from "./advertiser-phone-domain.js";
import { wireArabicSuggestInput } from "./arabic-field-suggest.js";
import { PROPERTY_TYPES, districtsForCity } from "./reference-catalog.js";

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
  sourceCache: new Map(),
  lastDoc: null,
  hasMore: false,
  busy: false,
  pendingQueryRefresh: false,
  resultTotal: 0,
  scanExhausted: false
};

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

function filterPublicOffices(query, offices) {
  const current = officeId();
  const normalized = String(query || "").trim().toLowerCase();
  return offices
    .filter((row) => {
      const id = String(row.officeId || row.id || "").trim().toLowerCase();
      if (!id || id === current) return false;
      const mode = String(row.cooperationMode || "APPROVAL_REQUIRED").toUpperCase();
      if (mode === "DISABLED") return false;
      if (!normalized) return true;
      const name = String(row.officeName || "").toLowerCase();
      const city = String(row.city || "").toLowerCase();
      const district = String(row.district || "").toLowerCase();
      const license = String(row.licenseNumber || "");
      return name.includes(normalized) || city.includes(normalized) || district.includes(normalized) || license.includes(normalized);
    })
    .slice(0, 8);
}

function bindOfficeSearch({ searchInput, hiddenInput, labelNode, resultsNode }) {
  if (!searchInput || !hiddenInput) return;
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
    renderResults(filterPublicOffices(searchInput.value, offices));
  });
  searchInput.addEventListener("focus", async () => {
    const offices = await loadPublicOfficeDirectory();
    renderResults(filterPublicOffices(searchInput.value, offices));
  });
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
    officeId: office.officeId || officeId()
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

function bankStatCell(label, value) {
  if (!value) return "";
  return `<div class="bank-stat"><span class="bank-stat-label">${escapeHtml(label)}</span><strong class="bank-stat-value">${escapeHtml(value)}</strong></div>`;
}

function bankRowHtml(row) {
  const record = state.records.get(row.id) || row;
  const card = buildBankListCardView({ ...record, id: row.id });
  const followupClass = card.nextActionOverdue ? " is-overdue" : "";
  const stats = [
    bankStatCell(isOwnerRecord(record) ? "السعر" : "الميزانية", card.priceText),
    bankStatCell("المساحة", card.areaText),
    bankStatCell("الغرف", card.roomsText)
  ].filter(Boolean).join("");
  const statsRow = stats ? `<div class="bank-row-stats">${stats}</div>` : "";
  const followup = card.nextActionLabel
    ? `<p class="bank-row-followup${followupClass}">${escapeHtml(card.nextActionLabel)}</p>`
    : "";
  const matchLine = card.bestMatchScoreText
    ? `<p class="bank-row-match">أفضل مطابقة: ${escapeHtml(card.bestMatchScoreText)}</p>`
    : "";
  const sourceLine = card.sourceShort
    ? `<p class="bank-row-source">${escapeHtml(card.sourceShort)}</p>`
    : "";
  const readinessClass = card.isReadyForMatching ? " is-ready" : " is-incomplete";
  const statusClass = card.isReadyForMatching ? " is-ready" : " is-incomplete";
  return `
    <article
      class="bank-row bank-row-card"
      role="button"
      tabindex="0"
      data-opportunity-id="${escapeHtml(row.id)}"
      data-open-id="${escapeHtml(row.id)}"
      aria-label="${escapeHtml(card.ariaLabel)}">
      <div class="bank-row-header">
        <span class="bank-kind-badge">${escapeHtml(card.kindBadge)}</span>
        <h3 class="bank-row-title">${escapeHtml(card.title)}</h3>
        <span class="bank-readiness-badge${statusClass}">${escapeHtml(card.headerStatus)}</span>
      </div>
      <div class="bank-row-body">
        ${card.location ? `<p class="bank-row-location">${escapeHtml(card.location)}</p>` : ""}
        ${statsRow}
        <p class="bank-row-readiness${readinessClass}">${escapeHtml(card.readinessLine)}</p>
        <div class="bank-row-footer">
          <p class="bank-row-contact">${card.contactLineMarkup}</p>
          ${followup}
          ${matchLine}
          ${sourceLine}
        </div>
      </div>
    </article>
  `;
}

function isOwnerRecord(record = {}) {
  const kind = String(record.opportunityKind || record.kind || record.recordType || "").toUpperCase();
  return record.contactType === "owner"
    || kind === "OWNER"
    || kind === "OWNER_OFFER"
    || kind === "OFFER";
}

let bankDetailOpenLock = "";

async function openBankDetailFromList(opportunityId) {
  if (!opportunityId || bankDetailOpenLock === opportunityId) return;
  bankDetailOpenLock = opportunityId;
  try {
    await renderDetail(opportunityId);
  } finally {
    window.setTimeout(() => {
      if (bankDetailOpenLock === opportunityId) bankDetailOpenLock = "";
    }, 400);
  }
}

function renderSummaryHtml(summary = emptyBankSummary()) {
  const activeKey = state.queryFilters.summaryKey || "";
  const chip = (key, label, count) => {
    const active = activeKey === key ? " is-active" : "";
    return `<button type="button" class="bank-summary-chip${active}" data-summary-key="${key}">
      <span>${escapeHtml(label)}</span><strong>${escapeHtml(count)}</strong>
    </button>`;
  };
  return `
    <div class="bank-summary-card" id="bankSummaryCard">
      <div class="bank-summary-chips">
        ${chip("total", "إجمالي الفرص", summary.total)}
        ${chip("needs", "تحتاج استكمال", summary.needsCompletion)}
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
    bodyHtml = `<p class="bank-query-hint">لا توجد فرص محفوظة بعد. تُحفظ الفرص هنا تلقائيًا عند إضافتها.</p>`;
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
  root?.querySelectorAll("[data-summary-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-summary-key") || "";
      if (key === "archived") {
        state.filter = "archived";
        syncFilterButtons();
      } else if (key) {
        state.filter = "active";
        syncFilterButtons();
      }
      state.queryFilters.summaryKey = state.queryFilters.summaryKey === key ? "" : key;
      renderList();
    });
  });
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

function renderAdvertiserFields(record) {
  const phoneInfo = readAdvertiserPhoneFromRecord(record);
  const phone = phoneInfo.phone;
  const displayName = readAdvertiserDisplayName(record);
  const roleOpts = ADVERTISER_ROLES.map((r) =>
    `<option value="${r.id}" ${record.advertiserRole === r.id ? "selected" : ""}>${escapeHtml(r.label)}</option>`
  ).join("");
  return `
    <div class="bank-advertiser-edit-form">
      <label>اسم أو وصف المعلن
        <input type="text" name="advertiserDisplayName" maxlength="120"
          placeholder="إضافة اسم أو وصف" value="${escapeHtml(displayName)}">
      </label>
      <label>رقم الجوال
        <input name="advertiserPhoneLocal" type="tel" inputmode="numeric" maxlength="10"
          placeholder="05XXXXXXXX" value="${escapeHtml(formatLocalPhoneDisplay(phone))}"
          aria-label="رقم جوال المعلن">
        <small class="bank-advertiser-phone-error" id="bankAdvertiserPhoneError" hidden></small>
        ${phone ? "" : `<p class="advertiser-message-meta">لا يوجد رقم معلن محفوظ</p>`}
      </label>
      <label>صفة المعلن
        <select name="advertiserRole">${roleOpts}</select>
      </label>
      <button type="button" class="bank-advertiser-add-phone" id="bankAdvertiserAddPhone"
        ${phone ? "hidden" : ""}>إضافة رقم المعلن</button>
    </div>
  `;
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
  const modal = document.getElementById("advertiserMessageOverlay");
  const target = document.getElementById("advertiserMessageTarget");
  const nameEl = document.getElementById("advertiserMessageAdvertiserName");
  const title = document.getElementById("advertiserMessageTitle");
  const textarea = document.getElementById("advertiserMessageText");
  if (!modal || !textarea) return;
  if (title) title.textContent = "رسالة التواصل مع المعلن";
  if (target) target.textContent = formatLocalPhoneDisplay(phone);
  if (nameEl) {
    if (displayName) {
      nameEl.hidden = false;
      nameEl.textContent = `المعلن: ${displayName} — `;
    } else {
      nameEl.hidden = true;
      nameEl.textContent = "";
    }
  }
  textarea.value = message;
  const opportunityId = record.id || state.activeId;
  setAdvertiserMessageModalContext({
    phone,
    opportunityId,
    onWhatsAppOpened: async () => {
      if (!opportunityId) return;
      try {
        await patchOpportunity(opportunityId, {
          lastWhatsAppOpenedAt: new Date().toISOString()
        });
      } catch (error) {
        console.warn("[iaqar] whatsapp opened log", error);
      }
    }
  });
  modal.hidden = false;
}

async function saveAdvertiserData(id, record, form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const result = buildAdvertiserDataPatch(record, data);
  const errorEl = document.getElementById("bankAdvertiserPhoneError");
  if (!result.ok) {
    if (errorEl) {
      errorEl.textContent = result.error || "رقم الجوال غير صحيح";
      errorEl.hidden = false;
    }
    setStatus(result.error || "تعذر حفظ بيانات المعلن", "is-error");
    return false;
  }
  if (errorEl) errorEl.hidden = true;
  const user = authUser();
  const patch = {
    ...result.patch,
    updatedAt: new Date().toISOString(),
    updatedBy: user?.uid || ""
  };
  try {
    await patchOpportunity(id, patch);
    state.records.set(id, { ...record, ...patch, id });
    setStatus("تم حفظ بيانات المعلن", "is-done");
    toast("تم حفظ بيانات المعلن");
    await renderDetail(id);
    return true;
  } catch (error) {
    console.warn("[iaqar] advertiser save", error);
    setStatus("تعذر حفظ بيانات المعلن", "is-error");
    return false;
  }
}

function isBankDetailOpen() {
  return Boolean(state.activeId);
}

async function renderDetail(id) {
  const panel = $("opportunityBankDetail");
  if (!panel) return;
  const record = state.records.get(id);
  if (!record) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }

  setStatus("جارٍ تجهيز التفاصيل…");
  const source = await lazyLoadSource(record);
  const detail = bankDetailView(id, record, { includeSource: true, source });
  const advertiserFields = renderAdvertiserFields(record);
  const readiness = evaluateMatchingReadiness(record);
  const card = buildOpportunityCardView({ ...record, id });
  const missingNames = missingFieldLabelsArabic(readiness.matchingReadinessMissing || []);
  const mediaGallery = renderOpportunityMedia({
    ...record,
    sourceMediaPath: source?.mediaPath || ""
  });
  const landProperty = isLandProperty(record.propertyType);
  state.activeId = id;
  panel.hidden = false;

  const archived = record.lifecycleStatus === LIFECYCLE.ARCHIVED || Boolean(record.archivedAt);
  const owned = isOwnedOpportunityRecord(record);
  const deleteBlock = archived && owned
    ? `<button type="button" class="bank-action danger" id="bankDeleteBtn">حذف نهائي</button>`
    : (!owned && archived
      ? `<button type="button" class="bank-action" id="bankHideSharedBtn">إزالة من بنكي</button>`
      : "");
  const sourceOriginal = detail.sourcePreview?.text || source?.text || record.rawText || "";
  const sourceTypeLabel = detail.sourcePreview?.sourceType || record.sourceType || "";
  panel.innerHTML = `
    <div class="bank-detail-head">
      <h3>تفاصيل الفرصة</h3>
      <button type="button" class="settings-close" id="bankDetailClose" aria-label="إغلاق التفاصيل">×</button>
    </div>

    <section class="bank-opp-summary" aria-label="ملخص الفرصة">
      <p class="bank-kind-badge">${escapeHtml(card.kindBadge)}</p>
      <h4>${escapeHtml(card.description)}</h4>
      <p>${escapeHtml(card.location)}</p>
      <p>${escapeHtml(card.priceOrBudget)} · ${escapeHtml(card.area)}</p>
      <p class="bank-row-contact">${contactLineMarkup({ ...record, id })}</p>
      <p class="bank-status-row">
        <span>${escapeHtml(card.dataCompletenessLabel)}</span>
        <span>${escapeHtml(card.contactStatusLabel)}</span>
        <span>${escapeHtml(card.matchStatusLabel)}</span>
        <span>${escapeHtml(card.outcomeStatusLabel)}</span>
      </p>
      ${card.bestMatchScoreText ? `<p class="bank-row-match">أفضل مطابقة: ${escapeHtml(card.bestMatchScoreText)}</p>` : ""}
    </section>

    <section class="bank-missing-banner ${missingNames.length ? "is-incomplete" : "is-ready"}" aria-live="polite">
      <strong>${escapeHtml(missingNames.length ? `البيانات الناقصة: ${missingNames.join("، ")}` : "البيانات مكتملة — جاهزة للمطابقة")}</strong>
    </section>

    <form id="bankUnifiedForm" class="bank-unified-form" autocomplete="off">
      <details class="bank-section" open>
        <summary>بيانات العقار / الطلب</summary>
        <div class="bank-edit-grid">
          <label>نوع العقار<input name="propertyType" class="arabic-suggest-input" autocomplete="off" value="${escapeHtml(record.propertyType || "")}"></label>
          <label>المدينة<input name="city" value="${escapeHtml(record.city || "")}"></label>
          <label>الحي<input name="district" class="arabic-suggest-input" autocomplete="off" value="${escapeHtml(record.district || "")}"></label>
          <label>السعر / الميزانية<input name="priceOrBudget" type="number" value="${record.priceOrBudget ?? record.price ?? ""}"></label>
          <label>المساحة<input name="area" type="number" value="${record.area ?? ""}"></label>
          ${landProperty ? "" : `<label>الغرف<input name="rooms" type="number" value="${record.rooms ?? ""}"></label>`}
        </div>
      </details>

      <details class="bank-section" open>
        <summary>بيانات المعلن</summary>
        ${advertiserFields}
      </details>
    </form>

    ${mediaGallery}

    <section class="bank-section bank-contact-section" aria-label="التواصل">
      <h4>التواصل</h4>
      <div class="bank-advertiser-actions" id="bankContactActions"></div>
      <div class="bank-contact-outcomes" id="bankContactOutcomes">
        <button type="button" class="bank-action" data-contact-outcome="CONTACTED">تم التواصل</button>
        <button type="button" class="bank-action" data-contact-outcome="NO_RESPONSE">لم يرد</button>
        <button type="button" class="bank-action" data-contact-outcome="FOLLOW_UP">طلب متابعة</button>
        <button type="button" class="bank-action" data-contact-outcome="REFUSED">غير مهتم</button>
        <button type="button" class="bank-action" data-contact-outcome="AGREED">تم الاتفاق</button>
      </div>
    </section>

    <section class="bank-section" aria-label="الإجراء القادم">
      <h4>الإجراء القادم</h4>
      <p id="bankNextActionLabel">${escapeHtml(card.nextActionLabel)}</p>
      <div class="bank-followup-quick">
        <button type="button" class="bank-action" data-followup-days="0">اليوم</button>
        <button type="button" class="bank-action" data-followup-days="1">غدًا</button>
        <button type="button" class="bank-action" data-followup-days="2">بعد غد</button>
        <label>اختيار تاريخ ووقت
          <input type="datetime-local" id="bankCustomFollowUp">
        </label>
        <button type="button" class="bank-action" id="bankSaveFollowUpCustom">حفظ الموعد</button>
      </div>
    </section>

    <details class="bank-section">
      <summary>المصدر الأصلي</summary>
      <p class="bank-source-meta">${escapeHtml(sourceTypeLabel)} — ${escapeHtml(detail.dateAdded)}</p>
      ${sourceOriginal ? `<p class="bank-source-text">${escapeHtml(sourceOriginal)}</p>` : "<p>لا يوجد نص أصلي محفوظ.</p>"}
    </details>

    <div class="bank-unified-save-wrap">
      <button type="button" class="bank-action-primary" id="bankUnifiedSaveBtn">حفظ التغييرات</button>
      <p class="section-status" id="bankUnifiedSaveStatus" role="status"></p>
    </div>

    <div class="bank-actions">
      <button type="button" class="bank-action" id="bankCooperateBtn">
        إتاحة للتعاون
        <small class="bank-action-sub">مع المكاتب الأخرى</small>
      </button>
      <button type="button" class="bank-action" id="bankDirectShareBtn">مشاركة مع مكتب محدد</button>
      <button type="button" class="bank-action" id="bankListingShareBtn">مشاركة العرض</button>
      ${archived
        ? `<button type="button" class="bank-action" id="bankRestoreBtn">استعادة إلى النشطة</button>`
        : `<button type="button" class="bank-action" id="bankArchiveBtn">أرشفة</button>`}
      ${record.activeCooperationId
        ? `<button type="button" class="bank-action" id="bankRevokeBtn">إنهاء التعاون</button>`
        : ""}
      ${deleteBlock}
    </div>
    <form id="bankDirectShareForm" class="bank-share-form" hidden autocomplete="off">
      <label>ابحث عن مكتب
        <input type="search" id="bankDetailOfficeSearch" placeholder="اسم المكتب أو المدينة" autocomplete="off">
      </label>
      <input type="hidden" name="targetOfficeId" id="bankDetailScopeTarget">
      <div class="bank-office-search-results" id="bankDetailScopeSearchResults" hidden></div>
      <p class="bank-share-selected-office" id="bankDetailScopeSelectedLabel" hidden></p>
      <button type="submit" class="bank-action-primary">مشاركة مع المكتب المحدد</button>
      <p class="bank-share-status section-status" id="bankShareStatus" role="status"></p>
      <p class="bank-note">مشاركة مباشرة واحدة — بدون كشف بيانات التواصل تلقائيًا.</p>
    </form>
    <div id="bankListingSharePanel" class="bank-listing-share-panel" hidden>
      <p class="bank-note">مشاركة يدوية — لن يُرسل شيء تلقائيًا.</p>
      <div class="bank-listing-share-actions">
        <button type="button" class="bank-action" id="bankShareWhatsAppBtn">واتساب</button>
        <button type="button" class="bank-action" id="bankShareTelegramBtn">تيليجرام</button>
        <button type="button" class="bank-action" id="bankShareNativeBtn" hidden>مشاركة الجهاز</button>
      </div>
    </div>
    <form id="bankCooperateForm" class="bank-share-form" hidden autocomplete="off">
      <p class="bank-note" id="bankCooperateHelp"></p>
      <button type="submit" class="bank-action-primary">تأكيد إتاحة التعاون</button>
    </form>
    <div class="bank-cooperation-nearby" id="bankCooperationNearby" hidden></div>
  `;

  setStatus(`${rowsCountLabel()} — تم فتح التفاصيل`);
  const contactActions = $("bankContactActions");
  if (contactActions) {
    contactActions.innerHTML = buildAdvertiserContactActions(record).map((action) => {
      const disabled = action.disabled ? "disabled" : "";
      return `<button type="button" class="bank-action" id="bankAdvertiser${action.action}" ${disabled}>${escapeHtml(action.label)}</button>`;
    }).join("");
  }
  wireDetailHandlers(id, record);
  wireBankFormArabicInputs(record);
  void hydrateDetailMediaUrls();
  void loadCooperationNearbySuggestions(id, record);
  window.dispatchEvent(new CustomEvent("iaqar:nav-open", { detail: { view: "bank-detail" } }));
  window.IAQAR?.navigation?.updateBackButton?.();
}

function rowsCountLabel() {
  if (!hasActiveBankQuery(state.queryFilters)) {
    const summary = state.summary || emptyBankSummary();
    return `إجمالي ${summary.total} — جاهزة ${summary.readyForMatching} — استكمال ${summary.needsCompletion} — مؤرشفة ${summary.archived}`;
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

function wireBankFormArabicInputs(record = {}) {
  const form = $("bankUnifiedForm");
  if (!form) return;
  const propertyInput = form.querySelector('input[name="propertyType"]');
  const districtInput = form.querySelector('input[name="district"]');
  const propertyOptions = PROPERTY_TYPES.map((entry) => entry.label);
  const districtOptions = districtsForCity("madinah").map((entry) => entry.officialName);
  if (propertyInput) wireArabicSuggestInput(propertyInput, propertyOptions);
  if (districtInput) wireArabicSuggestInput(districtInput, districtOptions);
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
      window.open(whatsAppShareUrl(message), "_blank", "noopener,noreferrer");
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
    window.location.href = `tel:${phone}`;
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

async function createShareRequest({ opportunityIds, targetOfficeId, scopeType }) {
  const user = authUser();
  const runtime = officeRuntime();
  if (!runtime?.db || !user) {
    setStatus("يلزم تسجيل الدخول", "is-error");
    return;
  }

  const mode = await readOfficeCooperationMode();
  if (!cooperationModeAllowsExplicitRequest(mode)) {
    setShareActionStatus("التعاون معطّل في إعدادات هذا المكتب", "is-error");
    return;
  }

  const ownedCheck = validateOwnedOpportunityIds(
    officeId(),
    state.records,
    opportunityIds
  );
  if (!ownedCheck.ok) {
    setShareActionStatus("لا يمكن مشاركة فرص لا تتبع هذا المكتب", "is-error");
    return;
  }

  const duplicate = await hasActiveShareWithOffice(targetOfficeId, ownedCheck.accepted);
  if (duplicate) {
    setShareActionStatus("يوجد مشاركة نشطة لهذه الفرصة مع هذا المكتب", "is-error");
    return;
  }

  setShareActionStatus("جارٍ إرسال طلب التعاون…");
  try {
    const token = await user.getIdToken();
    const response = await fetch(`${workerBaseUrl()}/cooperation/request`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        officeId: officeId(),
        targetOfficeId,
        opportunityIds: ownedCheck.accepted,
        scopeType
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.message || "تعذر إرسال طلب التعاون");
    }
    const message = payload.message || "تم إرسال طلب التعاون";
    setShareActionStatus(message, payload.duplicate ? "is-done" : "is-done");
    if (!payload.duplicate) toast("تم إرسال طلب التعاون");
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
  } catch (error) {
    console.warn("[iaqar] cooperation request", error);
    const message = String(error?.message || "").includes("permission")
      ? "تعذر إرسال طلب التعاون — صلاحيات غير كافية"
      : (error?.message || "تعذر إرسال طلب التعاون");
    setShareActionStatus(message, "is-error");
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
      `هل تريد إيقاف مشاركة الفرصة مع ${label}؟ ستتوقف المشاركة مع هذا الوسيط فقط، ولن تُحذف الفرصة الأصلية من بنك الفرص.`;
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
    panel.innerHTML = `<h4>مكاتب قريبة للتعاون</h4>
      ${payload.suggestions.map((row) => `
        <div class="bank-cooperation-nearby-item">
          <strong>${escapeHtml(row.officeName || row.officeId)}</strong>
          <span>${escapeHtml(row.neighborhoodLabel || "")} — ${escapeHtml(String(row.matchScore || 0))}%</span>
          <span class="bank-note">${escapeHtml(row.matchReason || "")}</span>
          <button type="button" class="bank-action" data-cooperation-request="${escapeHtml(row.officeId)}"
            data-cooperation-opp="${escapeHtml(row.opportunityId || "")}">طلب تعاون</button>
        </div>`).join("")}`;
    panel.querySelectorAll("[data-cooperation-request]").forEach((btn) => {
      btn.addEventListener("click", () => {
        void createShareRequest({
          opportunityIds: [opportunityId],
          targetOfficeId: btn.getAttribute("data-cooperation-request"),
          scopeType: "single"
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
  if (code === "not_enabled") return "لم تُتح هذه الفرصة للتعاون بعد.";
  if (code === "no_same_neighborhood") return "لا توجد عروض مطابقة داخل الحي.";
  if (code === "no_adjacent") return "لا توجد عروض مطابقة في الأحياء المجاورة.";
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

    if (!outgoingShareRowsCache.length) {
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
    if (event.target.closest("[data-summary-key], #bankLoadMoreBtn")) return;
    const row = event.target.closest(".bank-row[data-open-id]");
    if (!row) return;
    const openId = row.getAttribute("data-open-id");
    if (!openId) return;
    event.preventDefault();
    void openBankDetailFromList(openId);
  });
  list.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest(".bank-row[data-open-id]");
    if (!row) return;
    event.preventDefault();
    void openBankDetailFromList(row.getAttribute("data-open-id"));
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
      const request = docSnap.data() || {};
      const label = request.opportunityId
        ? `فرصة ${escapeHtml(request.opportunityId)}`
        : `${(request.opportunityIds || []).length} فرص محددة`;
      return `
        <div class="bank-incoming-item" data-request-id="${escapeHtml(docSnap.id)}">
          <div>
            <strong>من ${escapeHtml(request.originatingOfficeId)}</strong>
            <p>${label}</p>
          </div>
          <div>
            <button type="button" class="bank-action-primary" data-accept-request="${escapeHtml(docSnap.id)}">قبول</button>
            <button type="button" class="bank-action" data-reject-request="${escapeHtml(docSnap.id)}">رفض</button>
          </div>
        </div>
      `;
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
  if (decision === "ACCEPT") {
    const mode = await readOfficeCooperationMode();
    if (!cooperationModeAllowsAccept(mode)) {
      setStatus("التعاون معطّل في إعدادات هذا المكتب", "is-error");
      return;
    }
  }
  setStatus(decision === "ACCEPT" ? "جارٍ قبول الطلب…" : "جارٍ رفض الطلب…");
  try {
    // Phase 6 Worker path writes real minimum projections, updates origin status, audits.
    const result = await runTrustedCooperationLifecycle(
      requestId,
      decision === "ACCEPT" ? "ACCEPT" : "REJECT"
    );
    if (!result.ok) {
      setStatus(result.message || "تعذر تحديث الطلب", "is-error");
      return;
    }

    setStatus(decision === "ACCEPT" ? "تم قبول طلب التعاون" : "تم رفض طلب التعاون", "is-done");
    toast(decision === "ACCEPT" ? "تم قبول التعاون" : "تم رفض الطلب");
    window.dispatchEvent(new CustomEvent("iaqar:cooperation-decided", {
      detail: {
        requestId,
        decision,
        ...phase6BoundaryGuarantees()
      }
    }));
    await loadIncomingRequests();
    await loadSharedWithUs();
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
    setStatus("سجل دخول المكتب لعرض بنك الفرص", "is-error");
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
    setStatus("سجل دخول المكتب لعرض بنك الفرص", "is-error");
    if (loadMoreBtn) loadMoreBtn.hidden = true;
    return;
  }

  if (state.busy) return;
  state.busy = true;
  setStatus(reset ? "جارٍ تحميل بنك الفرص…" : "جارٍ تحميل المزيد…");

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
    setStatus("تعذر تحميل بنك الفرص — أعد المحاولة", "is-error");
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
    syncFilterButtons();
    scheduleBankQueryRefresh();
  });
  $("bankFilterArchived")?.addEventListener("click", () => {
    state.filter = "archived";
    syncFilterButtons();
    scheduleBankQueryRefresh();
  });
  $("bankFilterSearch")?.addEventListener("input", (event) => {
    state.queryFilters.search = event.currentTarget.value || "";
    if (state.queryFilters.search.trim()) {
      scheduleBankQueryRefresh();
    } else {
      state.queryFilters.summaryKey = state.queryFilters.summaryKey || "";
      scheduleBankQueryRefresh();
    }
  });
  $("bankIncomingList")?.addEventListener("click", (event) => {
    const acceptId = event.target.closest?.("[data-accept-request]")?.getAttribute("data-accept-request");
    const rejectId = event.target.closest?.("[data-reject-request]")?.getAttribute("data-reject-request");
    if (acceptId) void decideIncomingRequest(acceptId, "ACCEPT");
    if (rejectId) void decideIncomingRequest(rejectId, "REJECT");
  });
  $("bankSharedWithUs")?.addEventListener("click", (event) => {
    const sharedId = event.target.closest?.("[data-hide-shared]")?.getAttribute("data-hide-shared");
    if (sharedId) void hideSharedFromBankPanel(sharedId);
  });
  bindListClicks();

  window.addEventListener("iaqar:office-settings-closed", () => closeOpportunityBank());
  window.IAQAR = window.IAQAR || {};
  window.IAQAR.openOpportunityBank = openOpportunityBank;
  window.IAQAR.activateOpportunityBankInline = activateOpportunityBankInline;
  window.IAQAR.pauseOpportunityBankInline = pauseOpportunityBankInline;
  window.IAQAR.openOpportunityDetail = async function openOpportunityDetail(opportunityId) {
    openOpportunityBank();
    if (!opportunityId) return;
    // Detail deep-link loads the single opportunity without dumping the full bank.
    const runtime = officeRuntime();
    if (!runtime?.db || !officeId()) return;
    try {
      const snap = await runtime.db.collection("offices").doc(officeId())
        .collection("opportunities").doc(opportunityId).get();
      if (snap.exists) {
        state.records.set(opportunityId, { id: opportunityId, ...(snap.data() || {}) });
        await renderDetail(opportunityId);
      }
    } catch (error) {
      console.warn("[iaqar] open opportunity detail", error);
    }
  };
  window.IAQAR.closeOpportunityBank = closeOpportunityBank;
  window.IAQAR.isBankDetailOpen = isBankDetailOpen;
  window.IAQAR.closeBankDetailInternal = closeBankDetailInternal;
}

function syncFilterButtons() {
  $("bankFilterActive")?.classList.toggle("is-active", state.filter === "active");
  $("bankFilterArchived")?.classList.toggle("is-active", state.filter === "archived");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
