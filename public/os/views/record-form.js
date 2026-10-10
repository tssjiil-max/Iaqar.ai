/** Add / edit a repository record. Server re-validates with the same domain rules. */

import { h, ic, clear, field, setFieldError, clearFieldErrors, append } from "../core/dom.js";
import { back, go } from "../core/nav.js";
import { api } from "../core/runtime.js";
import { session } from "../core/session.js";
import { recordById, state, subscribe } from "../core/state.js";
import { newRequestKey, runAction, toast } from "../core/ui.js";
import { PROPERTY_TYPES, PURPOSES, RECORD_KIND, kindOf, priceOf, validateRecordInput } from "../domain/records-domain.js";
import { formatNumber } from "../domain/format-domain.js";
import { recordImages } from "../domain/record-media-domain.js";
import { imagePicker } from "./record-images.js";
import { FILL_MODE, INTAKE_CHANNELS, INTAKE_ROLES, notesWithDistricts, splitDistrictInput } from "../domain/smart-fill-domain.js";
import { applyListing, fillModes } from "./smart-fill.js";
import { URGENCY_LABEL } from "../domain/smart-fill-domain.js";
import { DEFAULT_DURATION, DURATION, DURATION_OPTIONS, VALIDITY_HINT, customExpiry } from "../domain/validity-domain.js";

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

/**
 * «مدة العرض أو الطلب»: two quick questions. A new record without a choice gets the announced default (a month);
 * an edit changes the duration only when the broker touches it here.
 */
export function validityField(values = {}, { isNew = true } = {}) {
  const urgent = h("input", { type: "hidden", name: "validityUrgent", value: values.validityUrgent === true ? "yes" : "no" });
  // Empty until a duration is pressed: an edit that only changes the urgency keeps the duration running as it was.
  const duration = h("input", { type: "hidden", name: "validityDuration", value: "" });
  const touched = h("input", { type: "hidden", name: "validityTouched", value: isNew ? "1" : "" });
  const custom = h("input", { class: "os-input", type: "date", name: "validityCustomDate", dir: "ltr", hidden: true, "aria-label": "تاريخ الانتهاء" });
  const current = values.validityDuration || DEFAULT_DURATION;
  const seg = (options, input, selected, onPick) => {
    const box = h("div", { class: "os-seg os-validity-seg", role: "group" });
    for (const option of options) {
      const b = h("button", { type: "button", "aria-pressed": String(option.id === selected), "data-validity-option": option.id, text: option.label });
      b.addEventListener("click", () => { input.value = option.id; box.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); touched.value = "1"; onPick?.(option.id); });
      box.append(b);
    }
    return box;
  };
  // Urgency = priority of the follow-up only; the duration = how long the offer/request stays open. Two separate questions.
  const urgentSeg = seg([{ id: "yes", label: URGENCY_LABEL.yes }, { id: "no", label: URGENCY_LABEL.no }], urgent, urgent.value);
  const durationSeg = seg(DURATION_OPTIONS, duration, current, (id) => { custom.hidden = id !== DURATION.CUSTOM; });
  return h("div", { class: "os-field os-validity", "data-validity": "" },
    h("div", { class: "os-validity-part", "data-urgency": "" },
      h("span", { text: "درجة الاستعجال" }), urgentSeg,
      h("small", { class: "os-field-note", text: "تحدد أولوية المتابعة فقط، ولا تغيّر مدة العرض أو الطلب." })),
    h("div", { class: "os-validity-part", "data-duration": "" },
      h("span", { text: "مدة العرض أو الطلب" }), durationSeg, custom,
      h("small", { class: "os-field-note", text: VALIDITY_HINT })),
    h("span", { class: "os-error", role: "alert", "data-error": "validity" }),
    urgent, duration, touched);
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
      field("الحي", h("input", { class: "os-input", name: "district", value: values.district || "", placeholder: "حي أو أكثر: الملقا، النرجس" }))
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
    field("مواصفات وملاحظات", h("textarea", { class: "os-textarea", name: "notes", maxlength: "1000", placeholder: "المواصفات المطلوبة أو المميزات…", text: values.notes || "" }), { optional: true }),
    validityField(values, { isNew: !values.id })
  );
  drawPurposes();
  return { form, getKind: () => kind };
}

/** «إضافة سريعة» → the record form: one analysed ad waiting to be reviewed (kept in memory only). */
let pendingDraft = null;
export function openDraftInForm(draft) { pendingDraft = draft; }
function takeDraft() { const d = pendingDraft; pendingDraft = null; return d; }

export function readRecordForm(root, kind) {
  const value = (name) => root.querySelector(`[name="${name}"]`)?.value ?? "";
  // Several districts in one box: the first is the record's district; the others stay in the description.
  const districts = splitDistrictInput(value("district"));
  return {
    kind,
    purpose: value("purpose"),
    propertyType: value("propertyType"),
    city: value("city"),
    district: districts.district,
    price: value("price"),
    area: value("area"),
    rooms: value("rooms"),
    contactName: value("contactName"),
    contactPhone: value("contactPhone"),
    notes: notesWithDistricts(value("notes"), districts.others),
    priceStatus: value("priceStatus"),
    // Sent only for a new record or when the broker touched the duration (an edit keeps the current one).
    validity: value("validityTouched") ? { urgent: value("validityUrgent") === "yes", duration: value("validityDuration"), customDate: value("validityCustomDate") } : undefined
  };
}

export function showRecordErrors(root, errors = {}) {
  clearFieldErrors(root);
  const map = { kind: "purpose", validity: "validityCustomDate" };
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
    // Photos belong to offers only; the picker hides when the record is a request.
    const picker = imagePicker({ existing: existing ? recordImages(existing) : [] });
    picker.el.hidden = initialKind !== RECORD_KIND.OFFER;
    const { form, getKind } = recordFormFields({
      kind: initialKind, values, lockKind: Boolean(existing),
      onKindChange: (k) => { titleEl.textContent = k === RECORD_KIND.REQUEST ? "إضافة طلب" : "إضافة عرض"; picker.el.hidden = k !== RECORD_KIND.OFFER; }
    });
    form.append(picker.el);
    // New records: «تعبئة ذكية | تعبئة يدوية» above the same form (smart by default). Edits keep the form only.
    const draft = existing ? null : takeDraft();
    const originBox = h("div", { class: "os-row2 os-intake-origin", hidden: !draft, "data-intake-origin": "" },
      field("مصدر البيانات", h("select", { class: "os-input", name: "intakeChannel" }, h("option", { value: "", text: "اختر" }), INTAKE_CHANNELS.map((c) => h("option", { value: c.id, text: c.label, selected: draft?.origin?.channel === c.id }))), { optional: true }),
      field("صفة صاحب الإعلان", h("select", { class: "os-input", name: "intakeRole" }, INTAKE_ROLES.map((r) => h("option", { value: r.id, text: r.label, selected: (draft?.origin?.role || "OFFICE") === r.id }))), { hint: "إعلان الوسيط المتعاون لا يُعد تفويضًا ولا إثبات ملكية — يراجعه المكتب قبل التعاون." }));
    let smartUsed = false;
    const fill = existing ? null : fillModes({
      formBox: form,
      initialText: draft?.listing?.original || "",
      analyze: (text) => (draft && text === draft.listing.original ? Promise.resolve({ ok: true, listings: [draft.listing] }) : api("/os/smart-fill", { officeId: session.officeId, text, multi: false })),
      several: "النص فيه أكثر من إعلان — رتبنا الأول هنا. استخدم «إضافة سريعة» لإضافتها كلها.",
      onListing: (listing) => {
        smartUsed = true;
        let notice = "";
        if (listing.kind && listing.kind !== getKind()) {
          form.querySelectorAll('[aria-label="نوع السجل"] button')[listing.kind === RECORD_KIND.OFFER ? 0 : 1]?.click();
          notice = listing.kind === RECORD_KIND.REQUEST ? "النص طلب عقار — حوّلنا النموذج إلى «طلب»." : "النص عرض عقار — حوّلنا النموذج إلى «عرض».";
        }
        applyListing(form, listing, { officeCity: session.office?.city || "" });
        const role = INTAKE_ROLES.find((r) => r.id === (formEl.querySelector('[name="intakeRole"]')?.value || ""));
        return { notice, roleLabel: draft ? role?.label || "" : "المكتب", cityFromOffice: !listing.city && Boolean(session.office?.city) };
      }
    });
    if (fill) form.prepend(originBox);
    const saveBtn = h("button", { type: "submit", class: "os-btn primary block" }, ic("check"), existing ? "حفظ التعديلات" : "حفظ وفحص المطابقات");
    const formEl = h("form", { class: "os-card", novalidate: true }, fill ? fill.el : null, form, h("div", { class: "os-form-actions" }, saveBtn));
    const syncSave = () => { saveBtn.closest(".os-form-actions").hidden = form.hidden; };
    if (fill) new MutationObserver(syncSave).observe(form, { attributes: true, attributeFilter: ["hidden"] });
    formEl.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = readRecordForm(formEl, getKind());
      if (fill) {
        const channel = formEl.querySelector('[name="intakeChannel"]')?.value || "";
        const role = draft ? formEl.querySelector('[name="intakeRole"]')?.value || "" : "";
        input.intakeOrigin = { channel: channel || (smartUsed ? "PASTE" : ""), role: role === "OFFICE" ? "" : role, method: smartUsed ? "SMART_FILL" : "MANUAL", text: smartUsed ? fill.text() : "" };
      }
      const local = validateRecordInput(input);
      if (input.validity?.duration === DURATION.CUSTOM && !customExpiry(input.validity.customDate)) local.errors.validity = "اختر تاريخًا صالحًا في المستقبل (خلال سنة)";
      if (!local.ok || local.errors.validity) { showRecordErrors(formEl, local.errors); return; }
      clearFieldErrors(formEl);
      let photos = { uploaded: 0, failed: 0 };
      const result = await runAction(saveBtn, async () => {
        const saved = await api("/os/records/save", { officeId: session.officeId, recordId, record: input, requestKey });
        // The record is saved first; photos follow. A photo that fails never loses the record.
        if (saved?.ok && !saved.duplicate && getKind() === RECORD_KIND.OFFER && picker.changed()) {
          try { photos = await picker.commit(saved.recordId); } catch (_) { photos = { uploaded: 0, failed: Math.max(1, picker.count()) }; }
        }
        return saved;
      }, {
        onError: (error) => { if (error.details) showRecordErrors(formEl, error.details); }
      });
      if (!result?.ok) return;
      if (photos.failed) toast("تم حفظ السجل، وتعذر رفع بعض الصور — أعد إضافتها من «تعديل».", "bad");
      if (result.duplicate && result.duplicateMessage) toast(result.duplicateMessage);
      else if (result.matchingPending) toast("تم الحفظ، وسيُستكمل فحص المطابقة تلقائيًا", "ok");
      else if (result.matches > 0) toast(result.matches === 1 ? "تم الحفظ — ظهرت مطابقة للمراجعة في المهام اليومية" : `تم الحفظ — ظهرت ${result.matches} مطابقات للمراجعة`, "ok");
      else if (!photos.failed) toast(existing ? "تم حفظ التعديلات" : "تم الحفظ — سيُعاد فحص السجل عند وصول بيانات مناسبة", "ok");
      if (draft?.onSaved) { draft.onSaved(result.recordId, result.duplicate === true); go("quick-add"); return; }
      go(`record/${result.recordId}`);
    });
    clear(container);
    append(container, 
      h("div", { class: "os-page-head" },
        h("button", { type: "button", class: "os-back", onClick: () => back(existing ? `record/${recordId}` : draft ? "quick-add" : "repo") }, ic("chev-right"), "رجوع"),
        titleEl, h("span")
      ),
      formEl
    );
  };
  mount();
  // An ad handed over by «إضافة سريعة» is shown already analysed (no second call).
  if (mounted) container.querySelector("[data-smart-box] textarea")?.value && container.querySelector("[data-smart-analyze]")?.click();
  if (!mounted) append(container, h("div", { class: "os-skeleton" }));
  const off = subscribe((k) => { if (k === "records") mount(); });
  return () => off();
}
