/**
 * Office library UI — organized contract folders per office.
 */

import {
  buildLibraryItem,
  countLibraryItemsByCategory,
  countLibraryItemsByMainSection,
  DEFAULT_LIBRARY_MAIN_SECTION,
  DOCUMENT_STATUS_LABELS,
  filterLibraryItems,
  formatLibraryFileSize,
  LIBRARY_CATEGORIES,
  LIBRARY_CATEGORY_LABELS,
  LIBRARY_ITEM_KINDS,
  LIBRARY_MAIN_SECTIONS,
  libraryCategoryLabel,
  libraryDocumentStatusLabel,
  libraryDocumentTitle,
  libraryFileTypeLabel,
  resolveLibraryCategory
} from "./office-library-domain.js";

function $(id) {
  return document.getElementById(id);
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

function workerBase() {
  if (window.IAQAR && typeof window.IAQAR.resolveWorkerBase === "function") {
    return window.IAQAR.resolveWorkerBase();
  }
  if (window.IAQAR?.workerBase) {
    return String(window.IAQAR.workerBase).replace(/\/$/, "");
  }
  try {
    const host = String(window.location?.hostname || "").toLowerCase();
    if (host.includes("--staging") || host.startsWith("staging.") || host.includes("iaqar-ai-staging")) {
      return "https://iaqar-intake-staging.iaqar-ai.workers.dev";
    }
  } catch (_) { /* ignore */ }
  return "";
}

function guessLibraryContentType(file) {
  const typed = String(file?.type || "").split(";")[0].trim().toLowerCase();
  if (typed && typed !== "application/octet-stream") return typed;
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".doc")) return "application/msword";
  if (name.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return typed || "application/octet-stream";
}

function setStatus(message, tone = "") {
  const node = $("officeLibraryStatus");
  if (!node) return;
  node.textContent = message || "";
  node.classList.remove("is-error", "is-done");
  if (tone) node.classList.add(tone);
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function formatDate(value) {
  if (!value) return "—";
  try {
    const date = value.toDate ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("ar-SA");
  } catch {
    return "—";
  }
}

function settingsSheet() {
  return document.querySelector("#officeSettings .settings-sheet");
}

let cachedItems = [];
let opportunityTitles = {};
let viewMode = "browse";
let activeCategory = "";
let expandedMainSection = DEFAULT_LIBRARY_MAIN_SECTION;
let pendingUploadFile = null;
let editingItemId = "";

const uiState = {
  search: "",
  mainSection: "",
  category: "",
  documentStatus: "",
  activeFilter: ""
};

async function mediaUrl(mediaPath) {
  const user = authUser();
  const base = workerBase();
  if (!user?.getIdToken || !base || !mediaPath) return "";
  const token = await user.getIdToken();
  const response = await fetch(
    `${base}/media/office?officeId=${encodeURIComponent(officeId())}&path=${encodeURIComponent(mediaPath)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!response.ok) return "";
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

async function loadOpportunityTitles(ids = []) {
  const runtime = officeRuntime();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!runtime?.db || !unique.length) return;
  const next = { ...opportunityTitles };
  for (const id of unique) {
    if (next[id]) continue;
    try {
      const snap = await runtime.db.collection("offices").doc(officeId())
        .collection("opportunities").doc(id).get();
      if (snap.exists) {
        const data = snap.data() || {};
        next[id] = data.title || data.headline || data.propertyTitle || id;
      }
    } catch (_) { /* ignore */ }
  }
  opportunityTitles = next;
}

function filteredItems() {
  return filterLibraryItems(cachedItems, {
    officeId: officeId(),
    search: uiState.search,
    mainSection: uiState.mainSection,
    category: uiState.category,
    documentStatus: uiState.documentStatus,
    activeFilter: uiState.activeFilter
  });
}

function openLibraryPanel() {
  const panel = $("officeLibraryPanel");
  const sheet = settingsSheet();
  if (!panel || !sheet) return;
  panel.hidden = false;
  sheet.classList.add("is-library-open");
  document.getElementById("officeSettings")?.classList.add("is-library-open");
  viewMode = "browse";
  activeCategory = "";
  void loadLibrary();
}

function closeLibraryPanel() {
  const panel = $("officeLibraryPanel");
  const sheet = settingsSheet();
  if (!panel || !sheet) return;
  panel.hidden = true;
  sheet.classList.remove("is-library-open");
  document.getElementById("officeSettings")?.classList.remove("is-library-open");
  viewMode = "browse";
  activeCategory = "";
  pendingUploadFile = null;
  editingItemId = "";
  hideModal("officeLibraryUploadModal");
  hideModal("officeLibraryEditModal");
}

function hideModal(id) {
  const node = $(id);
  if (node) node.hidden = true;
}

function showModal(id) {
  const node = $(id);
  if (node) node.hidden = false;
}

function renderFilters() {
  const search = $("officeLibrarySearch");
  if (search && search.value !== uiState.search) search.value = uiState.search;
  const main = $("officeLibraryFilterMain");
  if (main) main.value = uiState.mainSection;
  const category = $("officeLibraryFilterCategory");
  if (category) category.value = uiState.category;
  const status = $("officeLibraryFilterStatus");
  if (status) status.value = uiState.documentStatus;
  const active = $("officeLibraryFilterActive");
  if (active) active.value = uiState.activeFilter;
}

function renderBrowseView() {
  const browse = $("officeLibraryBrowse");
  const folder = $("officeLibraryFolderView");
  if (browse) browse.hidden = false;
  if (folder) folder.hidden = true;

  const items = filteredItems();
  const byCategory = countLibraryItemsByCategory(items);
  const bySection = countLibraryItemsByMainSection(items);
  const sectionsHost = $("officeLibrarySections");
  if (!sectionsHost) return;

  sectionsHost.innerHTML = LIBRARY_MAIN_SECTIONS.map((section) => {
    const expanded = expandedMainSection === section.id;
    return `
      <section class="library-main-section" data-library-main="${escapeHtml(section.id)}">
        <button type="button" class="library-main-section-toggle"
          data-library-section-toggle="${escapeHtml(section.id)}"
          aria-expanded="${expanded ? "true" : "false"}">
          <span class="library-main-section-label">${escapeHtml(section.label)}</span>
          <span class="library-count-badge">${bySection[section.id] || 0}</span>
        </button>
        <div class="library-subfolder-grid" ${expanded ? "" : "hidden"}>
          ${section.categories.map((categoryKey) => `
            <button type="button" class="library-subfolder-card"
              data-library-category="${escapeHtml(categoryKey)}">
              <span class="library-subfolder-name">${escapeHtml(LIBRARY_CATEGORY_LABELS[categoryKey])}</span>
              <span class="library-count-badge">${byCategory[categoryKey] || 0}</span>
            </button>
          `).join("")}
        </div>
      </section>
    `;
  }).join("");
}

function renderFolderView() {
  const browse = $("officeLibraryBrowse");
  const folder = $("officeLibraryFolderView");
  if (browse) browse.hidden = true;
  if (folder) folder.hidden = false;

  const title = $("officeLibraryFolderTitle");
  const list = $("officeLibraryFolderList");
  if (!title || !list) return;

  const items = filteredItems().filter((item) => resolveLibraryCategory(item) === activeCategory);
  title.textContent = libraryCategoryLabel(activeCategory);
  if (!items.length) {
    list.innerHTML = `<p class="library-empty">لا توجد ملفات في هذا المجلد.</p>`;
    return;
  }

  list.innerHTML = items.map((item) => {
    const titleText = libraryDocumentTitle(item);
    const opp = item.opportunityId
      ? (opportunityTitles[item.opportunityId] || "فرصة مرتبطة")
      : "";
    return `
      <article class="library-file-card" role="listitem" data-library-id="${escapeHtml(item.id)}">
        <div class="library-file-main">
          <strong class="library-file-title">${escapeHtml(titleText)}</strong>
          <p class="library-file-meta">${escapeHtml(libraryCategoryLabel(resolveLibraryCategory(item)))}</p>
          ${opp ? `<p class="library-file-meta">الفرصة: ${escapeHtml(opp)}</p>` : ""}
          <p class="library-file-meta">الحالة: ${escapeHtml(libraryDocumentStatusLabel(item))}</p>
          <p class="library-file-meta">تاريخ الإضافة: ${escapeHtml(formatDate(item.createdAt))}</p>
          ${item.expiryDate ? `<p class="library-file-meta">تاريخ الانتهاء: ${escapeHtml(formatDate(item.expiryDate))}</p>` : ""}
          <p class="library-file-meta">${escapeHtml(libraryFileTypeLabel(item.contentType))} — ${escapeHtml(formatLibraryFileSize(item.fileSizeBytes))}</p>
        </div>
        <div class="library-row-actions">
          ${item.mediaPath ? `<button type="button" class="identity-btn" data-library-open="${escapeHtml(item.id)}">فتح</button>` : ""}
          ${item.mediaPath ? `<button type="button" class="identity-btn" data-library-download="${escapeHtml(item.id)}">تنزيل</button>` : ""}
          ${item.kind === LIBRARY_ITEM_KINDS.MANUAL
            ? `<button type="button" class="identity-btn" data-library-edit="${escapeHtml(item.id)}">تعديل البيانات</button>`
            : ""}
          ${item.kind === LIBRARY_ITEM_KINDS.MANUAL
            ? `<button type="button" class="identity-btn danger" data-library-delete="${escapeHtml(item.id)}">حذف</button>`
            : ""}
        </div>
      </article>
    `;
  }).join("");
}

function renderLibrary() {
  renderFilters();
  if (viewMode === "folder" && activeCategory) {
    renderFolderView();
  } else {
    renderBrowseView();
  }
}

async function loadLibrary() {
  const runtime = officeRuntime();
  const user = authUser();
  if (!runtime?.db || !user || !officeId()) {
    setStatus("سجل دخول المكتب لعرض المكتبة", "is-error");
    return;
  }
  setStatus("جارٍ تحميل المكتبة…");
  try {
    const snap = await runtime.db.collection("offices").doc(officeId())
      .collection("library")
      .orderBy("createdAt", "desc")
      .limit(200)
      .get();
    cachedItems = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    await loadOpportunityTitles(cachedItems.map((row) => row.opportunityId));
    renderLibrary();
    setStatus(cachedItems.length ? `${cachedItems.length} ملف` : "لا توجد ملفات بعد.");
  } catch (error) {
    console.warn("[iaqar] library load", error);
    setStatus("تعذر تحميل المكتبة", "is-error");
  }
}

function populateCategorySelects(selected = LIBRARY_CATEGORIES.OTHER) {
  for (const selectId of ["officeLibraryUploadCategory", "officeLibraryEditCategory"]) {
    const select = $(selectId);
    if (!select) continue;
    select.innerHTML = LIBRARY_MAIN_SECTIONS.flatMap((section) => section.categories.map((key) => `
      <option value="${escapeHtml(key)}" ${key === selected ? "selected" : ""}>
        ${escapeHtml(LIBRARY_CATEGORY_LABELS[key])}
      </option>
    `)).join("");
  }
}

function populateStatusSelects(selected = "ACTIVE") {
  for (const selectId of ["officeLibraryUploadStatus", "officeLibraryEditStatus"]) {
    const select = $(selectId);
    if (!select) continue;
    select.innerHTML = Object.entries(DOCUMENT_STATUS_LABELS).map(([key, label]) => `
      <option value="${escapeHtml(key)}" ${key === selected ? "selected" : ""}>${escapeHtml(label)}</option>
    `).join("");
  }
}

function openUploadModal() {
  pendingUploadFile = null;
  const fileInput = $("officeLibraryUploadFile");
  if (fileInput) fileInput.value = "";
  $("officeLibraryUploadDocTitle").value = "";
  $("officeLibraryUploadReference").value = "";
  $("officeLibraryUploadOpportunity").value = "";
  $("officeLibraryUploadCooperation").value = "";
  $("officeLibraryUploadStartDate").value = "";
  $("officeLibraryUploadExpiryDate").value = "";
  populateCategorySelects(LIBRARY_CATEGORIES.OTHER);
  populateStatusSelects("ACTIVE");
  $("officeLibraryUploadFileName").textContent = "لم يتم اختيار ملف";
  showModal("officeLibraryUploadModal");
}

function openEditModal(item) {
  editingItemId = item.id;
  $("officeLibraryEditTitle").value = item.documentTitle || "";
  $("officeLibraryEditReference").value = item.referenceNumber || "";
  $("officeLibraryEditOpportunity").value = item.opportunityId || "";
  $("officeLibraryEditCooperation").value = item.cooperationId || "";
  $("officeLibraryEditStartDate").value = item.startDate || "";
  $("officeLibraryEditExpiryDate").value = item.expiryDate || "";
  populateCategorySelects(resolveLibraryCategory(item));
  populateStatusSelects(item.documentStatus || "ACTIVE");
  showModal("officeLibraryEditModal");
}

async function uploadLibraryFile(file, metadata) {
  const runtime = officeRuntime();
  const user = authUser();
  const base = workerBase();
  if (!runtime?.db || !user || !base || !officeId()) throw new Error("auth_required");
  const token = await user.getIdToken();
  const contentType = guessLibraryContentType(file);
  const response = await fetch(`${base}/media/office-library`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Office-Id": officeId(),
      "X-File-Name": encodeURIComponent(file.name || "file"),
      "Content-Type": contentType
    },
    body: file
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(body.error || body.message || "upload_failed");
  const item = buildLibraryItem({
    officeId: officeId(),
    fileName: body.fileName || file.name,
    contentType: contentType || body.contentType || "",
    mediaPath: body.mediaPath,
    note: metadata.note || "",
    category: metadata.category,
    documentTitle: metadata.documentTitle,
    referenceNumber: metadata.referenceNumber,
    opportunityId: metadata.opportunityId,
    cooperationId: metadata.cooperationId,
    startDate: metadata.startDate,
    expiryDate: metadata.expiryDate,
    documentStatus: metadata.documentStatus,
    fileSizeBytes: file.size,
    createdBy: user.uid
  });
  await runtime.db.collection("offices").doc(officeId())
    .collection("library").doc(item.id).set(item);
  return item;
}

async function saveUploadForm() {
  if (!pendingUploadFile) {
    setStatus("اختر ملفًا قبل الحفظ", "is-error");
    return;
  }
  const metadata = {
    category: $("officeLibraryUploadCategory")?.value || LIBRARY_CATEGORIES.OTHER,
    documentTitle: $("officeLibraryUploadDocTitle")?.value || "",
    referenceNumber: $("officeLibraryUploadReference")?.value || "",
    opportunityId: $("officeLibraryUploadOpportunity")?.value || "",
    cooperationId: $("officeLibraryUploadCooperation")?.value || "",
    startDate: $("officeLibraryUploadStartDate")?.value || "",
    expiryDate: $("officeLibraryUploadExpiryDate")?.value || "",
    documentStatus: $("officeLibraryUploadStatus")?.value || "ACTIVE"
  };
  setStatus("جارٍ رفع الملف…");
  try {
    const item = await uploadLibraryFile(pendingUploadFile, metadata);
    pendingUploadFile = null;
    hideModal("officeLibraryUploadModal");
    setStatus("تمت إضافة الملف إلى المكتبة", "is-done");
    activeCategory = item.category;
    viewMode = "folder";
    await loadLibrary();
  } catch (error) {
    console.warn("[iaqar] library upload", error);
    setStatus("تعذر رفع الملف", "is-error");
  }
}

async function saveEditForm() {
  const runtime = officeRuntime();
  const item = cachedItems.find((row) => row.id === editingItemId);
  if (!runtime?.db || !item) return;
  const patch = {
    category: $("officeLibraryEditCategory")?.value || resolveLibraryCategory(item),
    documentTitle: $("officeLibraryEditTitle")?.value || "",
    referenceNumber: $("officeLibraryEditReference")?.value || "",
    opportunityId: $("officeLibraryEditOpportunity")?.value || "",
    cooperationId: $("officeLibraryEditCooperation")?.value || "",
    startDate: $("officeLibraryEditStartDate")?.value || "",
    expiryDate: $("officeLibraryEditExpiryDate")?.value || "",
    documentStatus: $("officeLibraryEditStatus")?.value || "ACTIVE",
    updatedAt: new Date().toISOString()
  };
  try {
    await runtime.db.collection("offices").doc(officeId())
      .collection("library").doc(item.id).update(patch);
    hideModal("officeLibraryEditModal");
    editingItemId = "";
    setStatus("تم تحديث بيانات الملف", "is-done");
    await loadLibrary();
  } catch (error) {
    console.warn("[iaqar] library edit", error);
    setStatus("تعذر تحديث البيانات", "is-error");
  }
}

function bindLibraryActions(root) {
  if (!root || root.dataset.libraryActionsBound === "1") return;
  root.dataset.libraryActionsBound = "1";

  root.addEventListener("click", async (event) => {
    const sectionToggle = event.target.closest?.("[data-library-section-toggle]");
    if (sectionToggle) {
      const id = sectionToggle.getAttribute("data-library-section-toggle");
      expandedMainSection = expandedMainSection === id ? "" : id;
      renderBrowseView();
      return;
    }

    const categoryBtn = event.target.closest?.("[data-library-category]");
    if (categoryBtn) {
      activeCategory = categoryBtn.getAttribute("data-library-category") || "";
      viewMode = "folder";
      renderFolderView();
      return;
    }

    const openId = event.target.closest?.("[data-library-open]")?.getAttribute("data-library-open");
    const downloadId = event.target.closest?.("[data-library-download]")?.getAttribute("data-library-download");
    const deleteId = event.target.closest?.("[data-library-delete]")?.getAttribute("data-library-delete");
    const editId = event.target.closest?.("[data-library-edit]")?.getAttribute("data-library-edit");
    const item = cachedItems.find((row) => row.id === (openId || downloadId || deleteId || editId));
    if (!item) return;

    if (openId && item.mediaPath) {
      const url = await mediaUrl(item.mediaPath);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    if (downloadId && item.mediaPath) {
      const url = await mediaUrl(item.mediaPath);
      if (!url) return;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.fileName || "file";
      anchor.click();
      return;
    }
    if (editId) {
      openEditModal(item);
      return;
    }
    if (deleteId) {
      const runtime = officeRuntime();
      if (!runtime?.db) return;
      if (!window.confirm("حذف هذا الملف من المكتبة؟")) return;
      await runtime.db.collection("offices").doc(officeId())
        .collection("library").doc(deleteId).delete();
      setStatus("تم حذف الملف", "is-done");
      await loadLibrary();
    }
  });
}

function bindFilterInputs() {
  $("officeLibrarySearch")?.addEventListener("input", (event) => {
    uiState.search = event.target.value || "";
    renderLibrary();
  });
  $("officeLibraryFilterMain")?.addEventListener("change", (event) => {
    uiState.mainSection = event.target.value || "";
    renderLibrary();
  });
  $("officeLibraryFilterCategory")?.addEventListener("change", (event) => {
    uiState.category = event.target.value || "";
    renderLibrary();
  });
  $("officeLibraryFilterStatus")?.addEventListener("change", (event) => {
    uiState.documentStatus = event.target.value || "";
    renderLibrary();
  });
  $("officeLibraryFilterActive")?.addEventListener("change", (event) => {
    uiState.activeFilter = event.target.value || "";
    renderLibrary();
  });
}

function populateFilterCategorySelect() {
  const select = $("officeLibraryFilterCategory");
  if (!select) return;
  const options = [`<option value="">نوع العقد: كل الأنواع</option>`];
  for (const section of LIBRARY_MAIN_SECTIONS) {
    for (const key of section.categories) {
      options.push(`<option value="${escapeHtml(key)}">${escapeHtml(LIBRARY_CATEGORY_LABELS[key])}</option>`);
    }
  }
  select.innerHTML = options.join("");
}

function boot() {
  const section = $("officeLibrarySection");
  if (!section || section.dataset.bound === "1") return;
  section.dataset.bound = "1";

  populateCategorySelects();
  populateStatusSelects();
  populateFilterCategorySelect();

  $("officeLibraryOpenBtn")?.addEventListener("click", () => openLibraryPanel());
  $("officeLibraryBackBtn")?.addEventListener("click", () => {
    if (viewMode === "folder") {
      viewMode = "browse";
      activeCategory = "";
      renderLibrary();
      return;
    }
    closeLibraryPanel();
  });
  $("officeLibraryFolderBackBtn")?.addEventListener("click", () => {
    viewMode = "browse";
    activeCategory = "";
    renderLibrary();
  });

  $("officeLibraryAddBtn")?.addEventListener("click", () => openUploadModal());
  $("officeLibraryUploadChoose")?.addEventListener("click", () => $("officeLibraryUploadFile")?.click());
  $("officeLibraryUploadFile")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    pendingUploadFile = file || null;
    $("officeLibraryUploadFileName").textContent = file?.name || "لم يتم اختيار ملف";
  });
  $("officeLibraryUploadCancel")?.addEventListener("click", () => {
    pendingUploadFile = null;
    hideModal("officeLibraryUploadModal");
  });
  $("officeLibraryUploadSave")?.addEventListener("click", () => void saveUploadForm());

  $("officeLibraryEditCancel")?.addEventListener("click", () => {
    editingItemId = "";
    hideModal("officeLibraryEditModal");
  });
  $("officeLibraryEditSave")?.addEventListener("click", () => void saveEditForm());

  bindFilterInputs();
  bindLibraryActions($("officeLibraryPanel"));
  bindLibraryActions($("officeLibraryFolderList"));

  $("officeLibraryCloseBtn")?.addEventListener("click", () => closeLibraryPanel());
  window.addEventListener("iaqar:office-settings-opened", () => {
    if (!$("officeLibraryPanel")?.hidden) void loadLibrary();
  });
  window.addEventListener("iaqar:office-settings-closed", () => closeLibraryPanel());
  window.IAQAR = window.IAQAR || {};
  window.IAQAR.reloadOfficeLibrary = loadLibrary;
  window.IAQAR.openOfficeLibrary = openLibraryPanel;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
