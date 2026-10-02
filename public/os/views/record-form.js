/** Add / edit a repository record. Server re-validates with the same domain rules. */

import { h, ic, clear, field, setFieldError, clearFieldErrors, append } from "../core/dom.js";
import { back, go } from "../core/nav.js";
import { api } from "../core/runtime.js";
import { session } from "../core/session.js";
import { recordById, state, subscribe } from "../core/state.js";
import { newRequestKey, runAction, toast } from "../core/ui.js";
import { PROPERTY_TYPES, PURPOSES, RECORD_KIND, kindOf, priceOf, validateRecordInput } from "../domain/records-domain.js";
import { formatNumber } from "../domain/format-domain.js";

/** «حالة السعر» for offers: the owner's decision, asked once here (default: قابل للتفاوض). */
export function priceStatusField(value = "NEGOTIABLE") {
  const hidden = h("input", { type: "hidden", name: "priceStatus", value: String(value || "").toUpperCase() === "FIXED" ? "FIXED" : "NEGOTIABLE" });
  const seg = h("div", { class: "os-seg", role: "radiogroup", "aria-label": "حالة السعر" });
  for (const [id, label] of [["NEGOTIABLE", "قابل للتفاوض"], ["FIXED", "السعر ثابت"]]) {
    const b = h("button", { type: "button", role: "radio", "aria-checked": String(hidden.value === id), "aria-pressed": String(hidden.value === id), "data-price-status": id, text: label });
    b.addEventListener("click", () => {
      hidden.value = id;
      seg.querySelectorAll("button").forEach((x) => { const on = x === b; x.setAttribute("aria-pressed", String(on)); x.setAttribute("aria-checked", String(on)); });
    });
    seg.append(b);
  }
  return h("div", { class: "os-field os-price-status" }, h("span", { text: "حالة السعر" }), seg, hidden);
}

export function recordFormFields({ kind, values = {}, lockKind = false, onKindChange }) {
  const form = h("div", { class: "os-form" });
  const purposeWrap = h("div", { class: "os-seg", role: "group", "aria-label": "الغرض" });
  const hiddenPurpose = h("input", { type: "hidden", name: "purpose", value: values.purpose || "" });
  const drawPurposes = () => {
    clear(purposeWrap);
    for (const p of PURPOSES[kind] || []) {
      purposeWrap.append(h("button", {
        type: "button", "aria-pressed": String(hiddenPurpose.value === p.id),
        onClick: () => { hiddenPurpose.value = p.id; drawPurposes(); setFieldError(form, "purpose", ""); }
      }, p.label));
    }
  };
  const kindSeg = h("div", { class: "os-seg", role: "group", "aria-label": "نوع السجل" },
    [RECORD_KIND.OFFER, RECORD_KIND.REQUEST].map((k) => h("button", {
      type: "button", "aria-pressed": String(kind === k), disabled: lockKind && kind !== k,
      onClick: () => { if (lockKind || kind === k) return; kind = k; hiddenPurpose.value = ""; priceStatusBox.hidden = k !== RECORD_KIND.OFFER; onKindChange?.(k); kindSeg.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String([RECORD_KIND.OFFER, RECORD_KIND.REQUEST][i] === k))); drawPurposes(); priceLabel.firstChild.textContent = k === RECORD_KIND.REQUEST ? "الميزانية (ريال)" : "السعر (ريال)"; }
    }, k === RECORD_KIND.OFFER ? "عرض (لدي عقار)" : "طلب (أبحث عن عقار)"))
  );
  const typeInput = h("input", { class: "os-input", name: "propertyType", list: "os-types", value: values.propertyType || "", placeholder: "شقة، فيلا، أرض…", autocomplete: "off" });
  const types = h("datalist", { id: "os-types" }, PROPERTY_TYPES.map((t) => h("option", { value: t })));
  const priceInput = h("input", { class: "os-input", name: "price", inputmode: "numeric", value: values.price ? formatNumber(values.price) : "", placeholder: "مثال: 850,000" });
  priceInput.addEventListener("blur", () => { if (priceInput.value) priceInput.value = formatNumber(priceInput.value) || priceInput.value; });
  const priceLabel = field(kind === RECORD_KIND.REQUEST ? "الميزانية (ريال)" : "السعر (ريال)", priceInput);
  priceLabel.firstChild.textContent = kind === RECORD_KIND.REQUEST ? "الميزانية (ريال)" : "السعر (ريال)";

  const priceStatusBox = priceStatusField(values.priceStatus);
  priceStatusBox.hidden = kind !== RECORD_KIND.OFFER;
  form.append(
    field("نوع السجل", kindSeg),
    h("div", { class: "os-field" }, h("span", { text: "الغرض" }), purposeWrap, hiddenPurpose, h("span", { class: "os-error", role: "alert" })),
    field("نوع العقار", h("div", {}, typeInput, types)),
    h("div", { class: "os-row2" },
      field("المدينة", h("input", { class: "os-input", name: "city", value: values.city || session.office?.city || "", autocomplete: "address-level2" })),
      field("الحي", h("input", { class: "os-input", name: "district", value: values.district || "", placeholder: "اسم الحي" }))
    ),
    priceLabel,
    priceStatusBox,
    h("div", { class: "os-row2" },
      field("المساحة (م²)", h("input", { class: "os-input", name: "area", inputmode: "numeric", value: values.area || "" }), { optional: true }),
      field("عدد الغرف", h("input", { class: "os-input", name: "rooms", inputmode: "numeric", value: values.rooms || "" }), { optional: true })
    ),
    h("div", { class: "os-row2" },
      field(kind === RECORD_KIND.REQUEST ? "اسم العميل" : "اسم المالك", h("input", { class: "os-input", name: "contactName", value: values.contactName || "", autocomplete: "name" }), { optional: true }),
      field("رقم الجوال", h("input", { class: "os-input", name: "contactPhone", inputmode: "tel", dir: "ltr", value: values.contactPhone || "", placeholder: "05XXXXXXXX", autocomplete: "tel" }))
    ),
    field("مواصفات وملاحظات", h("textarea", { class: "os-textarea", name: "notes", maxlength: "1000", placeholder: "المواصفات المطلوبة أو المميزات…", text: values.notes || "" }), { optional: true })
  );
  drawPurposes();
  return { form, getKind: () => kind };
}

export function readRecordForm(root, kind) {
  const value = (name) => root.querySelector(`[name="${name}"]`)?.value ?? "";
  return {
    kind,
    purpose: value("purpose"),
    propertyType: value("propertyType"),
    city: value("city"),
    district: value("district"),
    price: value("price"),
    area: value("area"),
    rooms: value("rooms"),
    contactName: value("contactName"),
    contactPhone: value("contactPhone"),
    notes: value("notes"),
    priceStatus: value("priceStatus")
  };
}

export function showRecordErrors(root, errors = {}) {
  clearFieldErrors(root);
  const map = { kind: "purpose" };
  let first = null;
  for (const [key, message] of Object.entries(errors)) {
    const name = map[key] || key;
    setFieldError(root, name, message);
    if (!first) first = root.querySelector(`[name="${name}"]`);
  }
  first?.closest(".os-field")?.scrollIntoView({ block: "center", behavior: "smooth" });
}

export function renderRecordForm(container, { recordId = "", kind = RECORD_KIND.OFFER } = {}) {
  const requestKey = newRequestKey();
  let mounted = false;
  const mount = () => {
    if (mounted) return;
    const existing = recordId ? recordById(recordId) : null;
    if (recordId && !existing) {
      if (!state.recordsReady) return;
      clear(container);
      append(container, h("div", { class: "os-alert bad", text: "السجل غير موجود." }));
      mounted = true;
      return;
    }
    mounted = true;
    const initialKind = existing ? kindOf(existing) || kind : (kind === RECORD_KIND.REQUEST ? RECORD_KIND.REQUEST : RECORD_KIND.OFFER);
    const values = existing ? { ...existing, price: priceOf(existing) } : {};
    const titleEl = h("h1", { class: "os-page-title", text: existing ? "تعديل السجل" : initialKind === RECORD_KIND.REQUEST ? "إضافة طلب" : "إضافة عرض" });
    const { form, getKind } = recordFormFields({
      kind: initialKind, values, lockKind: Boolean(existing),
      onKindChange: (k) => { titleEl.textContent = k === RECORD_KIND.REQUEST ? "إضافة طلب" : "إضافة عرض"; }
    });
    const saveBtn = h("button", { type: "submit", class: "os-btn primary block" }, ic("check"), existing ? "حفظ التعديلات" : "حفظ وفحص المطابقات");
    const formEl = h("form", { class: "os-card", novalidate: true }, form, h("div", { style: { marginTop: "14px" } }, saveBtn));
    formEl.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = readRecordForm(formEl, getKind());
      const local = validateRecordInput(input);
      if (!local.ok) { showRecordErrors(formEl, local.errors); return; }
      clearFieldErrors(formEl);
      const result = await runAction(saveBtn, () => api("/os/records/save", { officeId: session.officeId, recordId, record: input, requestKey }), {
        onError: (error) => { if (error.details) showRecordErrors(formEl, error.details); }
      });
      if (!result?.ok) return;
      if (result.duplicate && result.duplicateMessage) toast(result.duplicateMessage);
      else if (result.matchingPending) toast("تم الحفظ، وسيُستكمل فحص المطابقة تلقائيًا", "ok");
      else if (result.matches > 0) toast(result.matches === 1 ? "تم الحفظ — ظهرت مطابقة للمراجعة في المهام اليومية" : `تم الحفظ — ظهرت ${result.matches} مطابقات للمراجعة`, "ok");
      else toast(existing ? "تم حفظ التعديلات" : "تم الحفظ — سيُعاد فحص السجل عند وصول بيانات مناسبة", "ok");
      go(`record/${result.recordId}`);
    });
    clear(container);
    append(container, 
      h("div", { class: "os-page-head" },
        h("button", { type: "button", class: "os-back", onClick: () => back(existing ? `record/${recordId}` : "repo") }, ic("chev-right"), "رجوع"),
        titleEl, h("span")
      ),
      formEl
    );
  };
  mount();
  if (!mounted) append(container, h("div", { class: "os-skeleton" }));
  const off = subscribe((k) => { if (k === "records") mount(); });
  return () => off();
}
