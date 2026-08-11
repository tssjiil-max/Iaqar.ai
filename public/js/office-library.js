/**
 * Office library UI — private per-office file storage.
 */

import {
  buildLibraryItem,
  libraryRowLabel,
  LIBRARY_ITEM_KINDS
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
  return "";
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

function renderRows(items) {
  const list = $("officeLibraryList");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<p class="library-empty">لا توجد ملفات بعد.</p>`;
    return;
  }
  list.innerHTML = items.map((item) => `
    <article class="library-row" role="listitem" data-library-id="${escapeHtml(item.id)}">
      <div class="library-row-main">
        <strong>${escapeHtml(libraryRowLabel(item))}</strong>
        <p>${escapeHtml(item.fileName || "")} — ${escapeHtml(item.contentType || "")}</p>
        <p>تاريخ الإضافة: ${escapeHtml(formatDate(item.createdAt))}</p>
        ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
      </div>
      <div class="library-row-actions">
        ${item.mediaPath ? `<button type="button" class="identity-btn" data-library-open="${escapeHtml(item.id)}">فتح</button>` : ""}
        ${item.mediaPath ? `<button type="button" class="identity-btn" data-library-download="${escapeHtml(item.id)}">تنزيل</button>` : ""}
        ${item.kind === LIBRARY_ITEM_KINDS.MANUAL
    ? `<button type="button" class="identity-btn danger" data-library-delete="${escapeHtml(item.id)}">حذف</button>`
    : ""}
      </div>
    </article>
  `).join("");
}

let cachedItems = [];

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
      .limit(50)
      .get();
    cachedItems = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    renderRows(cachedItems);
    setStatus(cachedItems.length ? `${cachedItems.length} ملف` : "لا توجد ملفات بعد.");
  } catch (error) {
    console.warn("[iaqar] library load", error);
    setStatus("تعذر تحميل المكتبة", "is-error");
  }
}

async function uploadLibraryFile(file) {
  const runtime = officeRuntime();
  const user = authUser();
  const base = workerBase();
  if (!runtime?.db || !user || !base || !officeId()) throw new Error("auth_required");
  const token = await user.getIdToken();
  const response = await fetch(`${base}/media/office-library`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Office-Id": officeId(),
      "X-File-Name": file.name,
      "Content-Type": file.type || "application/octet-stream"
    },
    body: file
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(body.error || "upload_failed");
  const item = buildLibraryItem({
    officeId: officeId(),
    fileName: body.fileName || file.name,
    contentType: file.type || body.contentType || "",
    mediaPath: body.mediaPath,
    note: "",
    createdBy: user.uid
  });
  await runtime.db.collection("offices").doc(officeId())
    .collection("library").doc(item.id).set(item);
  return item;
}

function boot() {
  const section = $("officeLibrarySection");
  if (!section || section.dataset.bound === "1") return;
  section.dataset.bound = "1";

  $("officeLibraryAddBtn")?.addEventListener("click", () => $("officeLibraryFileInput")?.click());
  $("officeLibraryFileInput")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setStatus("جارٍ رفع الملف…");
    try {
      await uploadLibraryFile(file);
      setStatus("تمت إضافة الملف إلى المكتبة", "is-done");
      await loadLibrary();
    } catch (error) {
      console.warn("[iaqar] library upload", error);
      setStatus("تعذر رفع الملف", "is-error");
    }
  });

  $("officeLibraryList")?.addEventListener("click", async (event) => {
    const openId = event.target.closest?.("[data-library-open]")?.getAttribute("data-library-open");
    const downloadId = event.target.closest?.("[data-library-download]")?.getAttribute("data-library-download");
    const deleteId = event.target.closest?.("[data-library-delete]")?.getAttribute("data-library-delete");
    const item = cachedItems.find((row) => row.id === (openId || downloadId || deleteId));
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

  window.addEventListener("iaqar:office-settings-opened", () => void loadLibrary());
  window.IAQAR = window.IAQAR || {};
  window.IAQAR.reloadOfficeLibrary = loadLibrary;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
