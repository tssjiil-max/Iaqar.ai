/** «مكتبة المكتب» — contract folders and office files. Any member reads/adds/edits; only managers delete (rules enforce it). */

import { h, ic, clear, append } from "../core/dom.js";
import { back } from "../core/nav.js";
import { session } from "../core/session.js";
import { confirmDialog, openSheet, runAction, toast } from "../core/ui.js";
import { addLibraryItem, deleteLibraryItem, fetchLibraryFile, listLibrary, updateLibraryItem } from "../core/library.js";
import { toDate } from "../domain/format-domain.js";
import { DOCUMENT_STATUS_LABELS, LIBRARY_ACCEPT, LIBRARY_CATEGORY_LABELS, LIBRARY_MAIN_SECTIONS, checkLibraryFile, fileKindLabel } from "../domain/library-domain.js";
import {
  LIBRARY_ITEM_KINDS, countLibraryItemsByCategory, countLibraryItemsByMainSection, filterLibraryItems, formatLibraryFileSize,
  libraryCategoryLabel, libraryDocumentStatusLabel, libraryDocumentTitle, resolveLibraryCategory
} from "../../js/office-library-domain.js";

const dateLabel = (value) => { const d = toDate(value); return d ? d.toLocaleDateString("ar-SA") : "—"; };

export function renderLibrary(container) {
  let items = [];
  let folder = "";
  let open = "brokerage";
  const filters = { search: "", documentStatus: "", activeFilter: "" };
  const add = h("button", { type: "button", class: "os-btn primary", "data-lib-add": "" }, ic("plus"), "إضافة ملف");
  const search = h("input", { class: "os-input", type: "search", name: "search", placeholder: "ابحث بالاسم أو رقم المرجع", "aria-label": "بحث في المكتبة" });
  const status = h("select", { class: "os-select", name: "statusFilter", "aria-label": "الحالة" }, h("option", { value: "", text: "كل الحالات" }),
    Object.entries(DOCUMENT_STATUS_LABELS).map(([k, label]) => h("option", { value: k, text: label })));
  const validity = h("select", { class: "os-select", name: "activeFilter", "aria-label": "السريان" }, h("option", { value: "", text: "الكل" }), h("option", { value: "active", text: "ساري" }), h("option", { value: "expired", text: "منتهي" }));
  const info = h("p", { class: "os-sub", role: "status", "data-lib-status": "" });
  const content = h("div", { "data-lib-content": "" }, h("div", { class: "os-skeleton" }));
  append(container,
    h("div", { class: "os-page-head" },
      h("button", { type: "button", class: "os-back", onClick: () => back("tasks") }, ic("chev-right"), "رجوع"),
      h("h1", { class: "os-page-title", text: "مكتبة المكتب" }), h("span")),
    h("div", { class: "os-card" }, h("div", { class: "os-lib-filters" }, search, status, validity), info),
    add, content);

  const visible = () => filterLibraryItems(items, { officeId: session.officeId, ...filters });

  function formSheet(title, item) {
    const editing = Boolean(item);
    const file = h("input", { type: "file", accept: LIBRARY_ACCEPT, class: "os-file-hidden", "data-lib-file": "", "aria-label": "اختيار الملف" });
    const chosen = h("small", { class: "os-sub", "data-lib-chosen": "", text: "لم يتم اختيار ملف" });
    const pick = h("button", { type: "button", class: "os-btn secondary", "data-lib-choose": "" }, ic("plus"), "اختيار ملف");
    file.addEventListener("change", () => { chosen.textContent = file.files[0]?.name || "لم يتم اختيار ملف"; });
    pick.addEventListener("click", () => file.click());
    const category = h("select", { class: "os-select", name: "category" }, LIBRARY_MAIN_SECTIONS.map((s) => h("optgroup", { label: s.label }, s.categories.map((k) => h("option", { value: k, text: LIBRARY_CATEGORY_LABELS[k] })))));
    category.value = item ? resolveLibraryCategory(item) : (folder || "other");
    const docStatus = h("select", { class: "os-select", name: "documentStatus" }, Object.entries(DOCUMENT_STATUS_LABELS).map(([k, l]) => h("option", { value: k, text: l })));
    docStatus.value = item?.documentStatus || "ACTIVE";
    const input = (name, value = "", attrs = {}) => h("input", { class: "os-input", name, value, ...attrs });
    const title_ = input("documentTitle", item?.documentTitle || "", { maxlength: "240" });
    const ref = input("referenceNumber", item?.referenceNumber || "", { maxlength: "120", dir: "ltr" });
    const start = input("startDate", item?.startDate || "", { type: "date", dir: "ltr" });
    const expiry = input("expiryDate", item?.expiryDate || "", { type: "date", dir: "ltr" });
    const wrap = (label, control, name) => h("label", { class: "os-field" }, h("span", { text: label }), control, h("span", { class: "os-field-note is-error", "data-field-error": name, hidden: true }));
    const message = h("div", { class: "os-alert bad", role: "alert", hidden: true });
    const save = h("button", { type: "button", class: "os-btn primary block", "data-lib-save": "" }, ic("check"), editing ? "حفظ التعديلات" : "رفع وحفظ");
    const body = h("div", { class: "os-form" },
      editing ? null : h("div", {}, pick, " ", chosen, file),
      wrap("نوع الملف", category, "category"), wrap("اسم المستند", title_, "documentTitle"), wrap("رقم المرجع", ref, "referenceNumber"),
      wrap("تاريخ البدء", start, "startDate"), wrap("تاريخ الانتهاء", expiry, "expiryDate"), wrap("الحالة", docStatus, "documentStatus"), message, save);
    const sheet = openSheet(title, body);
    save.addEventListener("click", () => runAction(save, async () => {
      message.hidden = true;
      body.querySelectorAll("[data-field-error]").forEach((n) => { n.hidden = true; n.textContent = ""; });
      const meta = { category: category.value, documentTitle: title_.value, referenceNumber: ref.value, startDate: start.value, expiryDate: expiry.value, documentStatus: docStatus.value };
      if (editing) await updateLibraryItem(item.id, meta);
      else {
        const checked = checkLibraryFile(file.files[0]);
        if (!checked.ok) throw Object.assign(new Error(checked.message), {});
        await addLibraryItem(file.files[0], meta);
        folder = meta.category;
      }
      sheet.close();
      await load();
    }, { success: editing ? "تم تحديث بيانات الملف" : "تمت إضافة الملف إلى المكتبة", onError: (error) => {
      const errors = error.details?.errors || {};
      for (const [name, text] of Object.entries(errors)) { const n = body.querySelector(`[data-field-error="${name}"]`); if (n) { n.textContent = text; n.hidden = false; } }
      message.textContent = error.message; message.hidden = false;
    } }));
  }

  async function openFile(item, download) {
    await runAction(null, async () => {
      const url = await fetchLibraryFile(item);
      if (download) { const a = h("a", { href: url, download: item.fileName || "file" }); document.body.append(a); a.click(); a.remove(); }
      else window.open(url, "_blank", "noopener,noreferrer");
    });
  }

  function fileCard(item) {
    const manual = item.kind === LIBRARY_ITEM_KINDS.MANUAL || !item.kind;
    const meta = (text) => h("p", { class: "os-lib-meta", text });
    const actions = [
      item.mediaPath ? h("button", { type: "button", class: "os-btn secondary", "data-lib-open": item.id, onClick: () => openFile(item, false) }, ic("eye"), "فتح") : null,
      item.mediaPath ? h("button", { type: "button", class: "os-btn secondary", "data-lib-download": item.id, onClick: () => openFile(item, true) }, ic("archive"), "تنزيل") : null,
      manual ? h("button", { type: "button", class: "os-btn ghost", "data-lib-edit": item.id, onClick: () => formSheet("تعديل بيانات الملف", item) }, ic("edit"), "تعديل") : null,
      manual && session.isManager ? h("button", { type: "button", class: "os-btn ghost danger", "data-lib-delete": item.id, onClick: async () => {
        if (!(await confirmDialog({ title: "حذف هذا الملف من المكتبة؟", text: "لا يمكن التراجع عن الحذف.", confirmLabel: "حذف", danger: true }))) return;
        await runAction(null, async () => { await deleteLibraryItem(item.id); await load(); }, { success: "تم حذف الملف" });
      } }, ic("trash"), "حذف") : null
    ];
    return h("article", { class: "os-card os-lib-file", "data-lib-id": item.id },
      h("strong", { text: libraryDocumentTitle(item) }),
      meta(`${libraryDocumentStatusLabel(item)} · ${fileKindLabel(item)} · ${formatLibraryFileSize(item.fileSizeBytes)}`),
      item.referenceNumber ? meta(`المرجع: ${item.referenceNumber}`) : null,
      meta(`أُضيف: ${dateLabel(item.createdAt)}`),
      item.expiryDate ? meta(`ينتهي: ${dateLabel(item.expiryDate)}`) : null,
      h("div", { class: "os-btn-row" }, actions));
  }

  function draw() {
    clear(content);
    const rows = visible();
    if (folder) {
      const inFolder = rows.filter((item) => resolveLibraryCategory(item) === folder);
      append(content,
        h("button", { type: "button", class: "os-btn ghost", "data-lib-folders": "", onClick: () => { folder = ""; draw(); } }, ic("chev-right"), "كل المجلدات"),
        h("h2", { class: "os-h2", "data-lib-folder-title": "", text: libraryCategoryLabel(folder) }),
        inFolder.length ? inFolder.map(fileCard) : h("p", { class: "os-sub", text: "لا توجد ملفات في هذا المجلد." }));
      return;
    }
    const byCategory = countLibraryItemsByCategory(rows);
    const bySection = countLibraryItemsByMainSection(rows);
    append(content, LIBRARY_MAIN_SECTIONS.map((section) => {
      const expanded = open === section.id;
      return h("section", { class: "os-card os-lib-section", "data-lib-section": section.id },
        h("button", { type: "button", class: "os-lib-toggle", "aria-expanded": String(expanded), "data-lib-toggle": section.id, onClick: () => { open = expanded ? "" : section.id; draw(); } },
          h("span", { text: section.label }), h("span", { class: "os-badge", text: String(bySection[section.id] || 0) })),
        expanded ? h("div", { class: "os-lib-folders" }, section.categories.map((key) =>
          h("button", { type: "button", class: "os-lib-folder", "data-lib-category": key, onClick: () => { folder = key; draw(); } },
            h("span", { text: LIBRARY_CATEGORY_LABELS[key] }), h("span", { class: "os-badge", text: String(byCategory[key] || 0) })))) : null);
    }));
  }

  async function load() {
    info.textContent = "جارٍ تحميل المكتبة…";
    try {
      items = await listLibrary();
      info.textContent = items.length ? `${items.length} ملف` : "لا توجد ملفات بعد.";
      draw();
    } catch (_) {
      info.textContent = "تعذر تحميل المكتبة";
      clear(content);
      append(content, h("div", { class: "os-alert bad", text: "تعذر تحميل المكتبة — تحقق من الاتصال وأعد المحاولة." }));
    }
  }

  search.addEventListener("input", () => { filters.search = search.value; draw(); });
  status.addEventListener("change", () => { filters.documentStatus = status.value; draw(); });
  validity.addEventListener("change", () => { filters.activeFilter = validity.value; draw(); });
  add.addEventListener("click", () => formSheet("إضافة ملف إلى المكتبة", null));
  load();
  return null;
}
