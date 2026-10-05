/**
 * «مستندات الصفقة» — what a deal needs before it is closed, what has arrived, what is still
 * missing, and what the broker has reviewed. Pure rules shared by the workspace and the Worker.
 *
 * The list starts from a fixed template for the deal's purpose (sale or rent); the broker may
 * mark an item not required for this deal, and may add items of his own. The state of each
 * item is kept on the deal (journey.documents) and every change is a timeline event, so the
 * history of the deal stays complete. Files themselves live in the office library.
 */

import { cleanText, toDate } from "./format-domain.js";

export const DOC_STATUS = Object.freeze({
  MISSING: "MISSING",
  RECEIVED: "RECEIVED",
  REVIEWED: "REVIEWED",
  NOT_REQUIRED: "NOT_REQUIRED"
});

export const DOC_STATUS_LABEL = Object.freeze({
  MISSING: "ناقص",
  RECEIVED: "موجود",
  REVIEWED: "تمت المراجعة",
  NOT_REQUIRED: "غير مطلوب"
});

export const DOC_STATUS_ORDER = Object.freeze([DOC_STATUS.MISSING, DOC_STATUS.RECEIVED, DOC_STATUS.REVIEWED, DOC_STATUS.NOT_REQUIRED]);

export const DOC_PARTY_LABEL = Object.freeze({ owner: "المالك", client: "العميل", office: "المكتب" });

const SALE = Object.freeze([
  { id: "title_deed", label: "صك الملكية", party: "owner", required: true },
  { id: "owner_id", label: "هوية المالك", party: "owner", required: true },
  { id: "buyer_id", label: "هوية المشتري", party: "client", required: true },
  { id: "brokerage_contract", label: "عقد الوساطة", party: "office", required: true },
  { id: "sale_contract", label: "عقد البيع (المبايعة)", party: "office", required: true },
  { id: "deposit_receipt", label: "إيصال العربون", party: "client", required: false },
  { id: "building_permit", label: "رخصة البناء أو شهادة الإتمام", party: "owner", required: false }
]);

const RENT = Object.freeze([
  { id: "title_deed", label: "صك الملكية", party: "owner", required: true },
  { id: "owner_id", label: "هوية المالك", party: "owner", required: true },
  { id: "tenant_id", label: "هوية المستأجر", party: "client", required: true },
  { id: "brokerage_contract", label: "عقد الوساطة", party: "office", required: true },
  { id: "lease_contract", label: "عقد الإيجار الموثق", party: "office", required: true },
  { id: "deposit_receipt", label: "إيصال الدفعة الأولى أو التأمين", party: "client", required: false }
]);

export const MAX_CUSTOM_DOCUMENTS = 10;
const CUSTOM_ID = /^custom_[a-z0-9]{6,24}$/;

/** "rent" for RENT / LEASE_REQUEST, otherwise "sale". */
export function dealKindOf(journey = {}) {
  const purpose = String(journey.offerSummary?.purpose || journey.requestSummary?.purpose || journey.purpose || "").toUpperCase();
  return purpose === "RENT" || purpose === "LEASE_REQUEST" ? "rent" : "sale";
}

export function documentTemplate(journey = {}) {
  return dealKindOf(journey) === "rent" ? RENT : SALE;
}

export function isDocStatus(value) {
  return Object.prototype.hasOwnProperty.call(DOC_STATUS, String(value || ""));
}

/**
 * The deal's checklist: template items in order, then the broker's own items.
 * Each row: { id, label, party, partyLabel, required, custom, status, statusLabel, note, updatedAt }.
 * `required` is false when the item is optional or the broker marked it not required.
 */
export function documentChecklist(journey = {}) {
  const saved = journey.documents && typeof journey.documents === "object" ? journey.documents : {};
  const rows = [];
  const seen = new Set();
  const row = (item, entry = {}, custom = false) => {
    const status = isDocStatus(entry.status) ? entry.status : DOC_STATUS.MISSING;
    return {
      id: item.id,
      label: item.label,
      party: item.party || "office",
      partyLabel: DOC_PARTY_LABEL[item.party] || DOC_PARTY_LABEL.office,
      required: status !== DOC_STATUS.NOT_REQUIRED && item.required !== false,
      optional: item.required === false,
      custom,
      status,
      statusLabel: DOC_STATUS_LABEL[status],
      note: cleanText(entry.note, 200),
      updatedAt: toDate(entry.updatedAt),
      updatedBy: String(entry.updatedBy || "")
    };
  };
  for (const item of documentTemplate(journey)) {
    seen.add(item.id);
    rows.push(row(item, saved[item.id]));
  }
  const custom = Object.entries(saved)
    .filter(([id, entry]) => !seen.has(id) && CUSTOM_ID.test(id) && entry && cleanText(entry.label, 80))
    .sort((a, b) => String(a[1].createdAt || "").localeCompare(String(b[1].createdAt || "")) || a[0].localeCompare(b[0]));
  for (const [id, entry] of custom) rows.push(row({ id, label: cleanText(entry.label, 80), party: "office", required: true }, entry, true));
  return rows;
}

/** المطلوب · الموجود · الناقص · تمت مراجعته — counted over required items only. */
export function documentSummary(rows = []) {
  const required = rows.filter((row) => row.required);
  const present = required.filter((row) => row.status === DOC_STATUS.RECEIVED || row.status === DOC_STATUS.REVIEWED);
  const reviewed = required.filter((row) => row.status === DOC_STATUS.REVIEWED);
  const missing = required.filter((row) => row.status === DOC_STATUS.MISSING);
  return {
    required: required.length,
    present: present.length,
    reviewed: reviewed.length,
    missing: missing.length,
    missingLabels: missing.map((row) => row.label),
    complete: required.length > 0 && missing.length === 0,
    allReviewed: required.length > 0 && reviewed.length === required.length
  };
}

export function documentSummaryText(summary) {
  return `المطلوب ${summary.required} · الموجود ${summary.present} · الناقص ${summary.missing} · تمت مراجعته ${summary.reviewed}`;
}

/**
 * Validate one change. Returns { ok, error?, id, remove, entry, label, statusLabel }.
 *   - a template item: status (+ optional note)
 *   - a new own item: no id, a label (2–80 chars); starts as ناقص
 *   - an own item: status / note, or remove: true
 */
export function prepareDocumentChange(journey = {}, input = {}, { now = new Date(), actorUid = "", newId = "" } = {}) {
  const saved = journey.documents && typeof journey.documents === "object" ? journey.documents : {};
  const template = documentTemplate(journey);
  const note = cleanText(input.note, 200);
  let id = String(input.documentId || "").trim();
  const stamp = { updatedAt: now.toISOString(), updatedBy: String(actorUid || "") };

  if (!id) {
    const label = cleanText(input.label, 80);
    if (label.length < 2) return { ok: false, error: "اكتب اسم المستند" };
    if (!CUSTOM_ID.test(String(newId || ""))) return { ok: false, error: "تعذر إضافة المستند" };
    const customCount = Object.keys(saved).filter((key) => CUSTOM_ID.test(key)).length;
    if (customCount >= MAX_CUSTOM_DOCUMENTS) return { ok: false, error: `الحد الأقصى ${MAX_CUSTOM_DOCUMENTS} مستندات إضافية` };
    const all = [...template.map((item) => item.label), ...Object.values(saved).map((entry) => cleanText(entry?.label, 80))].filter(Boolean);
    if (all.includes(label)) return { ok: false, error: "هذا المستند موجود في القائمة" };
    return { ok: true, id: newId, remove: false, label, statusLabel: DOC_STATUS_LABEL.MISSING, entry: { status: DOC_STATUS.MISSING, label, note, custom: true, createdAt: now.toISOString(), ...stamp } };
  }

  const templateItem = template.find((item) => item.id === id);
  const customEntry = !templateItem && CUSTOM_ID.test(id) ? saved[id] : null;
  if (!templateItem && !customEntry) return { ok: false, error: "المستند غير موجود في هذه الصفقة" };
  const label = templateItem ? templateItem.label : cleanText(customEntry.label, 80);
  if (input.remove === true) {
    if (templateItem) return { ok: false, error: "لا يمكن حذف مستند أساسي — اجعله «غير مطلوب» إن لم تحتجه" };
    return { ok: true, id, remove: true, label, statusLabel: "حُذف", entry: null };
  }
  const status = String(input.status || "").toUpperCase();
  if (!isDocStatus(status)) return { ok: false, error: "اختر حالة المستند" };
  const previous = saved[id] || {};
  const entry = { ...(customEntry ? { label, custom: true, createdAt: customEntry.createdAt || now.toISOString() } : {}), status, note: input.note === undefined ? cleanText(previous.note, 200) : note, ...stamp };
  return { ok: true, id, remove: false, label, statusLabel: DOC_STATUS_LABEL[status], entry };
}

/** True when the saved entry already says the same thing (replays change nothing). */
export function sameDocumentEntry(a, b) {
  if (!a || !b) return false;
  return String(a.status || "") === String(b.status || "") && cleanText(a.note, 200) === cleanText(b.note, 200) && cleanText(a.label, 80) === cleanText(b.label, 80);
}
