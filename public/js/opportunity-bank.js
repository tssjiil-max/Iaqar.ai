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
  buildReviewCompletionPatch,
  buildSoftDeletePatch,
  cooperationStateFromShareStatus,
  cooperationStatusLabel,
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
  ADVERTISER_ROLES,
  ADVERTISER_CONTACT_STATUSES,
  MARKETING_CONSENT_STATUSES,
  buildAdvertiserDataPatch,
  buildAdvertiserWhatsAppMessage,
  buildAdvertiserContactActions,
  e164ToLocalInput,
  marketingConsentStatusLabel,
  mergeAdvertiserFieldsIntoOpportunity,
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
  MATCHING_READINESS
} from "./opportunity-readiness-domain.js";
import {
  buildListingShareMessage,
  telegramShareUrl,
  whatsAppShareUrl
} from "./listing-share-domain.js";
import { openOpportunityReview } from "./opportunity-review.js";
import { buildReviewDefaults } from "./reference-catalog.js";

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
  bankReviewOpportunityId: null,
  sourceCache: new Map(),
  lastDoc: null,
  hasMore: false,
  busy: false,
  pendingQueryRefresh: false,
  resultTotal: 0,
  scanExhausted: false
};

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
      if (!normalized) return true;
      const name = String(row.officeName || "").toLowerCase();
      const city = String(row.city || "").toLowerCase();
      const license = String(row.licenseNumber || "");
      return name.includes(normalized) || city.includes(normalized) || license.includes(normalized);
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
          labelNode.textContent = `المكتب المحدد: ${btn.querySelector("strong")?.textContent || picked}`;
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
  const options = collectBankFilterOptions(facetSourceRecords());
  const citySelect = $("bankFilterCity");
  const districtSelect = $("bankFilterDistrict");
  const propertySelect = $("bankFilterPropertyType");
  if (citySelect) {
    const current = state.queryFilters.city;
    citySelect.innerHTML = `<option value="">كل المدن</option>${options.cities.map((city) =>
      `<option value="${escapeHtml(city)}" ${city === current ? "selected" : ""}>${escapeHtml(city)}</option>`
    ).join("")}`;
  }
  if (districtSelect) {
    const current = state.queryFilters.district;
    const source = facetSourceRecords();
    const districts = state.queryFilters.city
      ? options.districts.filter((district) => source.some((row) =>
        row.city === state.queryFilters.city && row.district === district))
      : options.districts;
    districtSelect.innerHTML = `<option value="">كل الأحياء</option>${districts.map((district) =>
      `<option value="${escapeHtml(district)}" ${district === current ? "selected" : ""}>${escapeHtml(district)}</option>`
    ).join("")}`;
  }
  if (propertySelect) {
    const current = state.queryFilters.propertyType;
    propertySelect.innerHTML = `<option value="">كل الأنواع</option>${options.propertyTypes.map((type) =>
      `<option value="${escapeHtml(type)}" ${type === current ? "selected" : ""}>${escapeHtml(type)}</option>`
    ).join("")}`;
  }
}

function syncFilterInputsFromState() {
  const search = $("bankFilterSearch");
  const city = $("bankFilterCity");
  const district = $("bankFilterDistrict");
  const purpose = $("bankFilterPurpose");
  const propertyType = $("bankFilterPropertyType");
  const status = $("bankFilterStatus");
  if (search) search.value = state.queryFilters.search || "";
  if (city) city.value = state.queryFilters.city || "";
  if (district) district.value = state.queryFilters.district || "";
  if (purpose) purpose.value = state.queryFilters.purpose || "";
  if (propertyType) propertyType.value = state.queryFilters.propertyType || "";
  if (status) status.value = state.queryFilters.matchingReadiness || "";
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

function renderList() {
  const list = $("opportunityBankList");
  const loadMoreBtn = $("bankLoadMoreBtn");
  if (!list) return;
  syncFilterControls();

  if (!hasActiveBankQuery(state.queryFilters)) {
    const summary = state.summary || emptyBankSummary();
    const emptyNote = summary.total === 0
      ? "لا توجد فرص محفوظة بعد. تُحفظ الفرص هنا تلقائيًا عند إضافتها."
      : "حدد بحثًا أو فلترًا لعرض الفرص";
    list.innerHTML = `
      <div class="bank-summary-card" id="bankSummaryCard">
        <h3 class="bank-summary-title">ملخص بنك الفرص</h3>
        <ul class="bank-summary-stats">
          <li><span>إجمالي الفرص</span><strong>${escapeHtml(summary.total)}</strong></li>
          <li><span>جاهزة للمطابقة</span><strong>${escapeHtml(summary.readyForMatching)}</strong></li>
          <li><span>تحتاج استكمال</span><strong>${escapeHtml(summary.needsCompletion)}</strong></li>
          <li><span>المؤرشفة</span><strong>${escapeHtml(summary.archived)}</strong></li>
        </ul>
        <p class="bank-query-hint">${escapeHtml(emptyNote)}</p>
      </div>
    `;
    if (loadMoreBtn) loadMoreBtn.hidden = true;
    return;
  }

  const rows = [...state.records.entries()]
    .filter(([, record]) => passesListFilters(record))
    .map(([id, record]) => ({
      ...bankListItem(id, record),
      matchingReadiness: evaluateMatchingReadiness(record).matchingReadiness
    }));

  if (!rows.length) {
    list.innerHTML = `<p class="bank-query-hint">لا توجد نتائج مطابقة. عدّل البحث أو الفلاتر.</p>`;
    if (loadMoreBtn) loadMoreBtn.hidden = !state.hasMore;
    return;
  }

  const totalLabel = (state.resultTotal > 0 ? String(state.resultTotal) : String(rows.length)) + " نتيجة";

  const rowsHtml = rows.map((row) => {
    const readinessKey = row.matchingReadiness || evaluateMatchingReadiness(row).matchingReadiness;
    const readiness = matchingReadinessLabel(readinessKey);
    const needsCompletion = readinessKey === MATCHING_READINESS.NEEDS_COMPLETION;
    const incompleteBadge = needsCompletion ? " is-incomplete" : "";
    const completeBtn = needsCompletion
      ? `<button type="button" class="bank-action bank-row-complete" data-complete-id="${escapeHtml(row.id)}">استكمال البيانات</button>`
      : "";
    return `
    <article class="bank-row" data-opportunity-id="${escapeHtml(row.id)}">
      <button type="button" class="bank-row-main bank-row-clickable" data-open-id="${escapeHtml(row.id)}">
        <div class="bank-row-head">
          <h3>${escapeHtml(row.kindLabel)} — ${escapeHtml(row.propertyType)}</h3>
          <span class="bank-readiness-badge` + incompleteBadge + `">${escapeHtml(readiness)}</span>
        </div>
        <dl>
          <dt>الموقع</dt><dd>${escapeHtml(row.location)}</dd>
          <dt>${escapeHtml(row.amountLabel)}</dt><dd>${escapeHtml(row.amountText)}</dd>
          <dt>تاريخ الإضافة</dt><dd>${escapeHtml(row.dateAdded)}</dd>
        </dl>
      </button>
    ` + completeBtn + `
    </article>
  `;
  }).join("");

  list.innerHTML = `
    <p class="bank-results-count" id="bankResultsCount">${escapeHtml(totalLabel)}</p>
    ${rowsHtml}
  `;
  if (loadMoreBtn) loadMoreBtn.hidden = !state.hasMore;
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

function renderAdvertiserBankCard(record) {
  const phoneInfo = readAdvertiserPhoneFromRecord(record);
  const phone = phoneInfo.phone;
  const displayName = readAdvertiserDisplayName(record);
  const localPhone = e164ToLocalInput(phone);
  const roleOpts = ADVERTISER_ROLES.map((r) =>
    `<option value="${r.id}" ${record.advertiserRole === r.id ? "selected" : ""}>${escapeHtml(r.label)}</option>`
  ).join("");
  const contactOpts = ADVERTISER_CONTACT_STATUSES.map((r) =>
    `<option value="${r.id}" ${record.advertiserContactStatus === r.id ? "selected" : ""}>${escapeHtml(r.label)}</option>`
  ).join("");
  const marketingOpts = MARKETING_CONSENT_STATUSES.map((r) =>
    `<option value="${r.id}" ${record.marketingConsentStatus === r.id ? "selected" : ""}>${escapeHtml(r.label)}</option>`
  ).join("");
  const lastContact = record.lastContactAt
    ? escapeHtml(String(record.lastContactAt))
    : "—";
  const actionButtons = buildAdvertiserContactActions(record).map((action) => {
    const disabled = action.disabled ? "disabled" : "";
    const idAttr = `bankAdvertiser${action.action}`;
    return `<button type="button" class="bank-action" id="${idAttr}" ${disabled}>${escapeHtml(action.label)}</button>`;
  }).join("");
  return `
    <section class="bank-advertiser-card" aria-labelledby="bankAdvertiserTitle" id="bankAdvertiserCard">
      <h4 id="bankAdvertiserTitle">بيانات المعلن</h4>
      <form id="bankAdvertiserEditForm" class="bank-advertiser-edit-form" autocomplete="off">
        <label>اسم أو وصف المعلن
          <input type="text" name="advertiserDisplayName" maxlength="120"
            placeholder="إضافة اسم أو وصف" value="${escapeHtml(displayName)}">
        </label>
        <label>رقم الجوال
          <div class="bank-advertiser-phone-row">
            <span class="bank-advertiser-phone-prefix" aria-hidden="true">+966</span>
            <input name="advertiserPhoneLocal" type="tel" inputmode="numeric" maxlength="9"
              placeholder="${phone ? "" : "5XXXXXXXX"}" value="${escapeHtml(localPhone)}"
              aria-label="رقم جوال المعلن">
          </div>
          <small class="bank-advertiser-phone-error" id="bankAdvertiserPhoneError" hidden></small>
          ${phone ? "" : `<p class="advertiser-message-meta">لا يوجد رقم معلن محفوظ</p>`}
        </label>
        <label>صفة المعلن
          <select name="advertiserRole">${roleOpts}</select>
        </label>
        <button type="submit" class="bank-advertiser-save">حفظ بيانات المعلن</button>
      </form>
      <button type="button" class="bank-advertiser-add-phone" id="bankAdvertiserAddPhone"
        ${phone ? "hidden" : ""}>إضافة رقم المعلن</button>
      <div class="bank-advertiser-actions">
        ${actionButtons}
        <button type="button" class="bank-action" id="bankAdvertiserStatusBtn">تحديث الحالة</button>
      </div>
      <form id="bankAdvertiserStatusForm" class="bank-advertiser-status-form" hidden>
        <label>حالة التواصل<select name="advertiserContactStatus">${contactOpts}</select></label>
        <label>استكمال الإجراءات<select name="marketingConsentStatus">${marketingOpts}</select></label>
        <button type="submit" class="bank-action-primary">حفظ الحالة</button>
      </form>
      <dl class="bank-detail-grid" style="margin-top:8px">
        <dt>استكمال الإجراءات</dt><dd>${escapeHtml(marketingConsentStatusLabel(record.marketingConsentStatus))}</dd>
        <dt>آخر متابعة</dt><dd>${lastContact}</dd>
      </dl>
    </section>
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
  if (target) target.textContent = phone;
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
          advertiserContactStatus: "OPENED_WHATSAPP",
          lastContactAt: new Date().toISOString()
        });
        const existing = state.records.get(opportunityId);
        if (existing) {
          state.records.set(opportunityId, {
            ...existing,
            advertiserContactStatus: "OPENED_WHATSAPP",
            lastContactAt: new Date().toISOString()
          });
        }
      } catch (error) {
        console.warn("[iaqar] advertiser whatsapp status", error);
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
  const advertiserCard = renderAdvertiserBankCard(record);
  const readiness = evaluateMatchingReadiness(record);
  const readinessLabel = matchingReadinessLabel(readiness.matchingReadiness);
  const mediaGallery = renderOpportunityMedia({
    ...record,
    sourceMediaPath: source?.mediaPath || ""
  });
  const needsCompletion = readiness.matchingReadiness === MATCHING_READINESS.NEEDS_COMPLETION;
  state.activeId = id;
  panel.hidden = false;

  const archived = record.lifecycleStatus === LIFECYCLE.ARCHIVED || Boolean(record.archivedAt);
  const owned = isOwnedOpportunityRecord(record);
  const deleteBlock = archived && owned
    ? `<button type="button" class="bank-action danger" id="bankDeleteBtn">حذف نهائي</button>`
    : (!owned && archived
      ? `<button type="button" class="bank-action" id="bankHideSharedBtn">إزالة من بنكي</button>`
      : "");
  panel.innerHTML = `
    <div class="bank-detail-head">
      <h3>تفاصيل الفرصة</h3>
      <button type="button" class="settings-close" id="bankDetailClose" aria-label="إغلاق التفاصيل">×</button>
    </div>
    <p class="bank-readiness-line">
      <strong>حالة اكتمال البيانات:</strong>
      <span class="bank-readiness-badge ${needsCompletion ? "is-incomplete" : "is-ready"}">${escapeHtml(readinessLabel)}</span>
    </p>
    <dl class="bank-detail-grid">
      <dt>النوع</dt><dd>${escapeHtml(detail.opportunityKind)}</dd>
      <dt>الغرض</dt><dd>${escapeHtml(detail.purpose)}</dd>
      <dt>نوع العقار</dt><dd>${escapeHtml(detail.propertyType)}</dd>
      <dt>المدينة</dt><dd>${escapeHtml(detail.city)}</dd>
      <dt>الحي</dt><dd>${escapeHtml(detail.district)}</dd>
      <dt>السعر / الميزانية</dt><dd>${escapeHtml(detail.priceOrBudget)}</dd>
      <dt>المساحة</dt><dd>${detail.area == null ? "—" : escapeHtml(detail.area)}</dd>
      ${landProperty ? "" : `<dt>الغرف</dt><dd>${detail.rooms == null ? "—" : escapeHtml(detail.rooms)}</dd>`}
      <dt>تاريخ الإضافة</dt><dd>${escapeHtml(detail.dateAdded)}</dd>
      <dt>حالة التعاون</dt><dd>${escapeHtml(detail.cooperationStatus)}</dd>
      ${detail.contactName ? `<dt>الاسم</dt><dd>${escapeHtml(detail.contactName)}</dd>` : ""}
    </dl>
    ${mediaGallery}
    ${advertiserCard}
    ${detail.sourcePreview ? `
      <div class="bank-source-preview">
        <strong>المصدر</strong>
        <p>${escapeHtml(detail.sourcePreview.sourceType)} ${detail.sourcePreview.fileName ? "— " + escapeHtml(detail.sourcePreview.fileName) : ""}</p>
        ${detail.sourcePreview.url ? `<p><a href="${escapeHtml(detail.sourcePreview.url)}" target="_blank" rel="noopener">فتح الرابط</a></p>` : ""}
        ${detail.sourcePreview.text ? `<p class="bank-source-text">${escapeHtml(detail.sourcePreview.text)}</p>` : ""}
      </div>` : ""}

    ${owned && !archived ? `
    <div class="bank-edit-actions">
      <button type="button" class="bank-action-primary" id="bankOpenReviewBtn">
        ${needsCompletion ? "استكمال البيانات" : "تعديل البيانات"}
      </button>
    </div>` : ""}

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
  `;

  setStatus(`${rowsCountLabel()} — تم فتح التفاصيل`);
  wireDetailHandlers(id, record);
  void hydrateDetailMediaUrls();
  window.dispatchEvent(new CustomEvent("iaqar:nav-open", { detail: { view: "bank-detail" } }));
  window.IAQAR?.navigation?.updateBackButton?.();
}

function rowsCountLabel() {
  if (!hasActiveBankQuery(state.queryFilters)) {
    const summary = state.summary || emptyBankSummary();
    return `إجمالي ${summary.total} — جاهزة ${summary.readyForMatching} — استكمال ${summary.needsCompletion} — مؤرشفة ${summary.archived}`;
  }
  const count = state.resultTotal || [...state.records.values()].filter(passesListFilters).length;
  return state.filter === "archived"
    ? `${count} نتيجة مؤرشفة`
    : `${count} نتيجة`;
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
    try {
      await patchOpportunity(id, {
        cooperationListing: "OPEN",
        cooperationListingAt: new Date().toISOString()
      });
      state.records.set(id, { ...state.records.get(id), cooperationListing: "OPEN" });
      setShareActionStatus("تمت إتاحة الفرصة للتعاون مع المكاتب الأخرى", "is-done");
      toast("تمت إتاحة الفرصة للتعاون");
    } catch (error) {
      console.warn("[iaqar] cooperation listing", error);
      setShareActionStatus("تعذر إتاحة التعاون", "is-error");
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

  $("bankAdvertiserStatusBtn")?.addEventListener("click", () => {
    const form = $("bankAdvertiserStatusForm");
    if (form) form.hidden = !form.hidden;
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
  $("bankAdvertisercopy")?.addEventListener("click", async () => {
    const phone = currentAdvertiserPhone();
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone);
      toast("تم نسخ الرقم");
    } catch {
      toast("تعذر نسخ الرقم");
    }
  });
  $("bankAdvertiseredit")?.addEventListener("click", () => {
    const form = document.getElementById("bankAdvertiserEditForm");
    const phoneInput = form?.querySelector('input[name="advertiserPhoneLocal"]');
    if (phoneInput) {
      phoneInput.focus();
      phoneInput.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
  $("bankAdvertiserAddPhone")?.addEventListener("click", () => {
    const form = document.getElementById("bankAdvertiserEditForm");
    const phoneInput = form?.querySelector('input[name="advertiserPhoneLocal"]');
    if (phoneInput) {
      phoneInput.focus();
      phoneInput.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });
  $("bankAdvertiserEditForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveAdvertiserData(id, currentAdvertiserRecord(), event.currentTarget);
  });

  $("bankHideSharedBtn")?.addEventListener("click", () => void hideSharedOpportunity(id));

  $("bankAdvertiserStatusForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const user = authUser();
    const existing = state.records.get(id) || record;
    const patch = {
      advertiserContactStatus: data.advertiserContactStatus,
      marketingConsentStatus: data.marketingConsentStatus,
      lastContactAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: user?.uid || ""
    };
    try {
      await patchOpportunity(id, patch);
      state.records.set(id, { ...existing, ...patch, id });
      setStatus("تم تحديث حالة المعلن", "is-done");
      await renderDetail(id);
    } catch (error) {
      console.warn("[iaqar] advertiser status", error);
      setStatus("تعذر تحديث الحالة", "is-error");
    }
  });

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

async function patchOpportunity(id, patch) {
  const runtime = officeRuntime();
  const user = authUser();
  if (!runtime?.db || !user) throw new Error("auth_required");
  // Phase 3 bank domain itself never creates matches; Phase 4 rematch is a separate Worker call.
  const boundaries = phase3BoundaryGuarantees();
  if (boundaries.createsMatch) {
    throw new Error("phase_boundary_violation");
  }
  await runtime.db.collection("offices").doc(officeId())
    .collection("opportunities").doc(id)
    .set({
      ...patch,
      officeId: officeId(),
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
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
  const reviewDefaults = buildReviewDefaults(fields, "", {
    extended: fields.extended,
    needsReview
  });
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
  openOpportunityReview(draft, approveBankOpportunityReview);
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
    if (!active.length) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }
    panel.hidden = false;
    panel.innerHTML = `<h3>مشاركات نشطة مع مكاتب أخرى</h3>${active.map((scope, index) => {
      const officeLabel = names[index] || scope.targetOfficeId || "";
      const statusLabel = scope.shareKind === "cooperation"
        ? cooperationStatusLabel(cooperationStateFromShareStatus(scope.status))
        : "قابل للإلغاء";
      const revokeAttrs = scope.shareKind === "scope"
        ? `data-revoke-scope="${escapeHtml(scope.id)}" data-broker-name="${escapeHtml(officeLabel)}"`
        : "";
      const revokeBtn = scope.shareKind === "scope"
        ? `<button type="button" class="bank-action" data-revoke-scope="${escapeHtml(scope.id)}"
          data-broker-name="${escapeHtml(officeLabel)}">إيقاف مشاركة الفرصة</button>`
        : "";
      return `
      <div class="bank-incoming-item">
        <div>
          <strong>إلى مكتب ${escapeHtml(officeLabel)}</strong>
          <p>${Number(scope.opportunityIds?.length || 0)} فرصة — ${escapeHtml(statusLabel)}</p>
        </div>
        ${revokeBtn}
      </div>`;
    }).join("")}`;
    panel.querySelectorAll("[data-revoke-scope]").forEach((btn) => {
      btn.addEventListener("click", () => {
        confirmStopOpportunityShare(
          btn.getAttribute("data-revoke-scope"),
          btn.getAttribute("data-broker-name")
        );
      });
    });
  } catch (error) {
    console.warn("[iaqar] outgoing scopes", error);
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
    const completeId = event.target.closest?.("[data-complete-id]")?.getAttribute("data-complete-id");
    if (completeId) {
      const record = state.records.get(completeId);
      if (record) openBankOpportunityReview(completeId, record);
      return;
    }
    const openId = event.target.closest?.("[data-open-id]")?.getAttribute("data-open-id");
    if (openId) {
      void renderDetail(openId);
    }
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

async function loadBankSummary() {
  const runtime = officeRuntime();
  const user = authUser();
  if (!runtime?.db || !user || !officeId()) {
    setStatus("سجل دخول المكتب لعرض بنك الفرص", "is-error");
    return;
  }
  setStatus("جارٍ تحميل ملخص بنك الفرص…");
  try {
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
    renderList();
    setStatus(rowsCountLabel());
    await loadIncomingRequests();
  } catch (error) {
    console.warn("[iaqar] opportunity bank summary", error);
    setStatus("تعذر تحميل ملخص بنك الفرص — أعد المحاولة", "is-error");
    const retry = $("opportunityBankRetry");
    if (retry) retry.hidden = false;
  }
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

  if (!hasActiveBankQuery(state.queryFilters)) {
    if (reset) {
      state.records.clear();
      state.lastDoc = null;
      state.hasMore = false;
      state.resultTotal = 0;
      state.scanExhausted = false;
    }
    await loadBankSummary();
    return;
  }

  if (state.busy) return;
  state.busy = true;
  setStatus(reset ? "جارٍ البحث في بنك الفرص…" : "جارٍ تحميل المزيد…");

  try {
    if (reset) {
      state.records.clear();
      state.lastDoc = null;
      state.hasMore = false;
      state.resultTotal = 0;
      state.scanExhausted = false;
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
  state.resultTotal = 0;
  state.scanExhausted = false;
  void loadBankSummary();
  void loadIncomingRequests();
  void loadSharedWithUs();
  void loadOutgoingScopes();
}

function scheduleBankQueryRefresh() {
  if (!hasActiveBankQuery(state.queryFilters)) {
    state.records.clear();
    state.lastDoc = null;
    state.hasMore = false;
    state.resultTotal = 0;
    state.scanExhausted = false;
    state.pendingQueryRefresh = false;
    void loadBankSummary();
    return;
  }
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
    scheduleBankQueryRefresh();
  });
  $("bankFilterCity")?.addEventListener("change", (event) => {
    state.queryFilters.city = event.currentTarget.value || "";
    state.queryFilters.district = "";
    scheduleBankQueryRefresh();
  });
  $("bankFilterDistrict")?.addEventListener("change", (event) => {
    state.queryFilters.district = event.currentTarget.value || "";
    scheduleBankQueryRefresh();
  });
  $("bankFilterPurpose")?.addEventListener("change", (event) => {
    state.queryFilters.purpose = event.currentTarget.value || "";
    scheduleBankQueryRefresh();
  });
  $("bankFilterPropertyType")?.addEventListener("change", (event) => {
    state.queryFilters.propertyType = event.currentTarget.value || "";
    scheduleBankQueryRefresh();
  });
  $("bankFilterStatus")?.addEventListener("change", (event) => {
    state.queryFilters.matchingReadiness = event.currentTarget.value || "";
    scheduleBankQueryRefresh();
  });
  $("bankFilterClearBtn")?.addEventListener("click", () => {
    state.queryFilters = emptyBankFilters();
    syncFilterInputsFromState();
    scheduleBankQueryRefresh();
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
        const record = { id: opportunityId, ...(snap.data() || {}) };
        state.records.set(opportunityId, record);
        await renderDetail(opportunityId);
        const readiness = evaluateMatchingReadiness(record);
        if (readiness.matchingReadiness === MATCHING_READINESS.NEEDS_COMPLETION) {
          openBankOpportunityReview(opportunityId, record);
        }
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
