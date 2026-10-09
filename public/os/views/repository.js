/**
 * «العروض والطلبات» — one searchable list. Offers and requests sit together; each card
 * carries a clear «عرض» or «طلب» label. Narrowing (kind, unmatched, purpose, type, place,
 * price, state) lives under «خيارات البحث» — never as separate main sections.
 * Requests never show a property photo: they show the need, specs and budget.
 */

import { h, ic, clear, emptyState, append } from "../core/dom.js";
import { go } from "../core/nav.js";
import { state, subscribe } from "../core/state.js";
import { openSheet, closeAllSheets } from "../core/ui.js";
import { PROPERTY_TYPES, PURPOSES, filterRecords, recordView, sortRecords, RECORD_KIND } from "../domain/records-domain.js";
import { photo } from "./reference-layout.js";
import { relativeAgo } from "../domain/format-domain.js";
import { engagedRecordIds } from "../domain/task-domain.js";
import { removeRecordFlow } from "./record-actions.js";

/** Narrowing options inside «خيارات البحث» (ids kept for deep links: ?kind=OFFER|REQUEST|UNMATCHED). */
const KIND_OPTIONS = [
  { id: "", label: "الكل" },
  { id: RECORD_KIND.OFFER, label: "عرض" },
  { id: RECORD_KIND.REQUEST, label: "طلب" }
];

function recordCard(record) {
 const view=recordView(record);const when=record.createdAt?.toDate?record.createdAt.toDate():new Date(record.createdAt||"");
 return h("article",{class:"os-card ref-record-card","data-record":view.id},h("button",{type:"button",class:"ref-record-open",onClick:()=>go(`record/${view.id}`)},photo(record),h("div",{class:"ref-record-copy"},h("h3",{text:view.propertyType||view.title}),h("p",{},ic("pin"),view.location),h("b",{text:view.priceLabel.replace(/^(السعر|الميزانية)\s*/,"")})),h("span",{class:"ref-record-tags"},h("span",{class:"ref-status "+(view.kind==="OFFER"?"step-0":"ref-request"),"data-kind-label":view.kind,text:view.kindLabel}),view.state!=="ACTIVE"?h("span",{class:"ref-status ref-state","data-state-label":view.state,text:view.lifecycleLabel}):null),h("div",{class:"ref-record-meta"},h("span",{text:Number.isNaN(when.getTime())?"":when.toLocaleDateString("en-CA")}),view.rooms?h("span",{},ic("bed"),view.rooms+" غرف"):null,view.areaLabel?h("span",{},ic("area"),view.areaLabel):null)));
}

export function openRecordMenu(record) {
  const view = recordView(record);
  const items = [
    h("button", { type: "button", onClick: () => { sheet.close(); go(`record/${view.id}`); } }, ic("eye"), "عرض التفاصيل والفرص المرتبطة"),
    view.lifecycle !== "DELETED" ? h("button", { type: "button", onClick: () => { sheet.close(); go(`record/${view.id}/edit`); } }, ic("edit"), "تعديل") : null,
    view.lifecycle === "ACTIVE" ? h("button", { type: "button", onClick: () => { sheet.close(); go(`record/${view.id}?search=1`); } }, ic("search"), "بحث عن خيارات مناسبة") : null,
    view.lifecycle === "ACTIVE" ? h("button", { type: "button", onClick: async () => { sheet.close(); await removeRecordFlow(record); } }, ic("trash"), "حذف") : null
  ];
  const sheet = openSheet(view.title, h("nav", { class: "os-menu" }, items));
}

export function renderRepository(container, { query } = {}) {
  const filters = {
    query: query?.get("q") || "",
    kind: query?.get("kind") === "UNMATCHED" ? "" : query?.get("kind") || "",
    unmatched: query?.get("kind") === "UNMATCHED",
    purpose: "",
    propertyType: "",
    location: "",
    priceMin: "",
    priceMax: "",
    status: "ACTIVE"
  };
  const kindChips = h("div", { class: "os-chips", role: "group", "aria-label": "نوع السجل" });
  const unmatchedChip = h("button", { type: "button", class: "os-chip", "data-tab": "UNMATCHED", "aria-pressed": "false", text: "بلا مطابقة فقط" });
  const list = h("div", { class: "os-record-list", "aria-live": "polite" });
  const summary = h("span", { class: "os-count" });
  const search = h("input", { class: "os-input", type: "search", name: "q", placeholder: "ابحث في العروض والطلبات ...", value: filters.query, "aria-label": "بحث" });
  search.addEventListener("input", () => { filters.query = search.value; draw(); });

  const purposeSelect = h("select", { class: "os-select", name: "purpose", "aria-label": "الغرض" });
  const typeSelect = h("select", { class: "os-select", name: "propertyType", "aria-label": "نوع العقار" },
    h("option", { value: "", text: "كل الأنواع" }), PROPERTY_TYPES.map((t) => h("option", { value: t, text: t })));
  const locationInput = h("input", { class: "os-input", name: "location", placeholder: "المدينة أو الحي", "aria-label": "الموقع" });
  const minInput = h("input", { class: "os-input", name: "priceMin", inputmode: "numeric", placeholder: "من", "aria-label": "السعر من" });
  const maxInput = h("input", { class: "os-input", name: "priceMax", inputmode: "numeric", placeholder: "إلى", "aria-label": "السعر إلى" });
  const statusSelect = h("select", { class: "os-select", name: "status", "aria-label": "الحالة" },
    h("option", { value: "ACTIVE", text: "النشطة" }), h("option", { value: "PAUSED", text: "الموقوفة مؤقتًا" }), h("option", { value: "ARCHIVED", text: "المؤرشفة" }), h("option", { value: "ALL", text: "كل الحالات" }));
  const fillPurposes = () => {
    clear(purposeSelect);
    purposeSelect.append(h("option", { value: "", text: "كل الأغراض" }));
    const options = filters.kind ? PURPOSES[filters.kind] : [...PURPOSES.OFFER, ...PURPOSES.REQUEST];
    for (const p of options) purposeSelect.append(h("option", { value: p.id, text: p.label }));
    purposeSelect.value = options.some((p) => p.id === filters.purpose) ? filters.purpose : "";
    filters.purpose = purposeSelect.value;
  };
  for (const [el, key] of [[purposeSelect, "purpose"], [typeSelect, "propertyType"], [locationInput, "location"], [minInput, "priceMin"], [maxInput, "priceMax"], [statusSelect, "status"]]) {
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", () => { filters[key] = el.value; draw(); });
  }
  const activeHint = h("span", { class: "ref-filters-on", "data-filters-on": "", hidden: true, text: "مفعّلة" });
  const filterPanel = h("div", { class: "os-form ref-filter-form" },
    h("div", { class: "ref-filter-row" }, kindChips, unmatchedChip),
    h("div", { class: "os-row2" }, purposeSelect, typeSelect),
    locationInput,
    h("div", { class: "os-row2" }, minInput, maxInput),
    statusSelect,
    h("button", { type: "button", class: "os-btn ghost", "data-filters-clear": "", onClick: () => {
      Object.assign(filters, { kind: "", unmatched: false, purpose: "", propertyType: "", location: "", priceMin: "", priceMax: "", status: "ACTIVE" });
      typeSelect.value = ""; locationInput.value = ""; minInput.value = ""; maxInput.value = ""; statusSelect.value = "ACTIVE";
      fillPurposes(); drawKind(); draw();
    } }, ic("refresh"), "مسح الفلاتر")
  );

  const drawKind = () => {
    clear(kindChips);
    for (const option of KIND_OPTIONS) {
      kindChips.append(h("button", { type: "button", class: "os-chip", "aria-pressed": String(filters.kind === option.id), "data-tab": option.id || "ALL", text: option.label,
        onClick: () => { filters.kind = option.id; fillPurposes(); drawKind(); draw(); } }));
    }
    unmatchedChip.setAttribute("aria-pressed", String(filters.unmatched));
  };
  unmatchedChip.addEventListener("click", () => { filters.unmatched = !filters.unmatched; drawKind(); draw(); });

  const draw = () => {
    clear(list);
    if (!state.recordsReady) {
      append(list, h("div", { class: "os-skeleton" }), h("div", { class: "os-skeleton" }));
      return;
    }
    let rows = sortRecords(filterRecords(state.records, filters));
    if (filters.unmatched) { const engaged = engagedRecordIds(state.tasks); rows = rows.filter((r) => !engaged.has(String(r.id))); }
    summary.textContent = rows.length === 1 ? "سجل واحد" : `${rows.length} سجل`;
    activeHint.hidden = !(filters.kind || filters.unmatched || filters.purpose || filters.propertyType || filters.location || filters.priceMin || filters.priceMax || filters.status !== "ACTIVE");
    if (!rows.length) {
      const hasAny = state.records.some((r) => recordView(r).lifecycle !== "DELETED");
      append(list, h("div", { class: "os-card" }, hasAny
        ? emptyState("search", "لا توجد نتائج مطابقة", "جرّب كلمات أخرى أو امسح الفلاتر.")
        : emptyState("database", "المستودع فارغ", "أضف أول عرض أو طلب، أو شارك رابط المكتب ليسجّل العملاء والملاك بياناتهم.")));
      return;
    }
    for (const record of rows.slice(0, 200)) append(list, recordCard(record));
    if (rows.length > 200) append(list, h("p", { class: "os-sub", style: { textAlign: "center" }, text: "تُعرض أحدث 200 نتيجة — استخدم البحث لتضييق النتائج." }));
  };

  fillPurposes();
  drawKind();
  const options = h("details", { class: "ref-filters", "data-repo-filters": "" }, h("summary", {}, ic("search"), "خيارات البحث", activeHint, summary), filterPanel);
  // A deep link that already narrows the list opens the options so the choice is visible.
  if (filters.kind || filters.unmatched) options.open = true;
  append(container,h("div",{class:"ref-repo-tools"},h("div",{class:"os-card tight ref-search-card"},h("div",{class:"os-search"},search,ic("search"))),options),list,h("button",{type:"button",class:"os-btn primary block ref-add-record",onClick:()=>openSheet("إضافة سجل جديد",h("div",{class:"os-btn-row"},h("button",{type:"button",class:"os-btn primary",onClick:()=>{closeAllSheets();go("record/new?kind=OFFER");}},"إضافة عرض"),h("button",{type:"button",class:"os-btn secondary",onClick:()=>{closeAllSheets();go("record/new?kind=REQUEST");}},"إضافة طلب")))},ic("plus-circle"),"إضافة سجل جديد"));
  draw();
  const off = subscribe((kind) => { if (kind === "records" || kind === "tasks") draw(); });
  return () => off();
}
