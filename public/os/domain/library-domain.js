/** Pure rules for the office library screen. Types and limits mirror the Worker (OFFICE_LIBRARY_TYPES) — the Worker re-checks. */

import { DOCUMENT_STATUS_LABELS, LIBRARY_CATEGORIES, LIBRARY_CATEGORY_LABELS, LIBRARY_MAIN_SECTIONS, isLibraryCategory } from "../../js/office-library-domain.js";

export { DOCUMENT_STATUS_LABELS, LIBRARY_CATEGORIES, LIBRARY_CATEGORY_LABELS, LIBRARY_MAIN_SECTIONS };

const MB = 1024 * 1024;
export const LIBRARY_TYPES = Object.freeze({
  "application/pdf": { label: "PDF", max: 15 * MB },
  "image/jpeg": { label: "JPG", max: 8 * MB },
  "image/png": { label: "PNG", max: 8 * MB },
  "image/webp": { label: "WEBP", max: 8 * MB },
  "application/msword": { label: "DOC", max: 15 * MB },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { label: "DOCX", max: 15 * MB }
});
export const LIBRARY_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx";
const BY_EXTENSION = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };

export function guessContentType(file = {}) {
  const typed = String(file.type || "").split(";")[0].trim().toLowerCase();
  if (typed && typed !== "application/octet-stream") return typed;
  const ext = String(file.name || "").toLowerCase().split(".").pop();
  return BY_EXTENSION[ext] || typed || "";
}

/** { ok, contentType, message } — checked before anything is uploaded. */
export function checkLibraryFile(file) {
  if (!file) return { ok: false, message: "اختر ملفًا قبل الحفظ" };
  const contentType = guessContentType(file);
  const spec = LIBRARY_TYPES[contentType];
  if (!spec) return { ok: false, message: "نوع الملف غير مدعوم — المسموح: PDF أو صورة أو Word" };
  if (!(file.size > 0)) return { ok: false, message: "الملف فارغ" };
  if (file.size > spec.max) return { ok: false, message: `حجم الملف يتجاوز ${Math.round(spec.max / MB)} ميغابايت` };
  return { ok: true, contentType, message: "" };
}

/** Clean metadata for create/edit. Dates are YYYY-MM-DD; expiry may not precede start. */
export function normalizeLibraryMeta(raw = {}) {
  const text = (v, n) => String(v ?? "").trim().slice(0, n);
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
  const category = isLibraryCategory(raw.category) ? raw.category : LIBRARY_CATEGORIES.OTHER;
  const documentStatus = Object.keys(DOCUMENT_STATUS_LABELS).includes(raw.documentStatus) ? raw.documentStatus : "ACTIVE";
  const meta = { category, documentTitle: text(raw.documentTitle, 240), referenceNumber: text(raw.referenceNumber, 120), startDate: date(raw.startDate), expiryDate: date(raw.expiryDate), documentStatus };
  const errors = {};
  if (meta.startDate && meta.expiryDate && meta.expiryDate < meta.startDate) errors.expiryDate = "تاريخ الانتهاء قبل تاريخ البدء";
  return { ok: Object.keys(errors).length === 0, meta, errors };
}

export function fileKindLabel(item = {}) {
  const spec = LIBRARY_TYPES[String(item.contentType || "").split(";")[0].trim().toLowerCase()];
  return spec ? spec.label : "ملف";
}
