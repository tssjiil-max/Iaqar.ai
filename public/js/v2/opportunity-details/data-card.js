import { escapeContentHtml } from "../domain.js";
import { isDisplayValueComplete } from "../../opportunity-field-completion-domain.js";
import { V2_DATA_ROWS, completenessLine, displayedMissingRows, editorForDisplayedRow, isDisplayedRowComplete } from "./view-model.js";

function iconUse(id) {
  return `<svg class="cv2-icon" aria-hidden="true"><use href="#${escapeContentHtml(id)}"/></svg>`;
}

function isBlank(value) {
  return !isDisplayValueComplete(value);
}

function missingHtml(editor) {
  const editorAttr = editor ? ` data-cv2-editor="${escapeContentHtml(editor)}"` : "";
  const tag = editor ? "button" : "span";
  const type = editor ? ` type="button"` : "";
  return `<${tag} class="cv2-missing-pair"${type}${editorAttr}>
    <span class="cv2-missing-dot" aria-hidden="true"></span>
    <span class="cv2-missing-text">غير محدد</span>
  </${tag}>`;
}

function contactSaveButton() {
  return `<button type="button" class="cv2-contact-add" data-cv2-save-device-contact aria-label="حفظ في جهات الاتصال" title="حفظ في جهات الاتصال">
    <svg class="cv2-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4.5h8a2 2 0 0 1 2 2v13l-6-3.2-6 3.2v-13a2 2 0 0 1 2-2z"/><path d="M10 9h4M10 12h4"/></svg>
  </button>`;
}

function valueHtml(primary, secondary, { contactAction = false } = {}) {
  const main = String(primary ?? "").trim();
  const sub = String(secondary ?? "").trim();
  if (!main && !sub) return `<span class="cv2-value-empty"></span>`;
  const body = `<span class="cv2-value-primary">${escapeContentHtml(main)}</span>
    ${sub ? `<span class="cv2-value-secondary">${escapeContentHtml(sub)}</span>` : ""}`;
  if (!contactAction) return body;
  return `<span class="cv2-contact-value">${body}${contactSaveButton()}</span>`;
}

const EXTRA_ROW_KEYS = new Set(["specs", "advertiser"]);

function rowMarkup(row, vm) {
  const value = rowValue(vm, row.key);
  const missing = !isDisplayedRowComplete(vm, row.key);
  const editor = missing ? editorForDisplayedRow(row.key, vm) : "";
  const label = row.key === "price" ? (vm.priceLabel || row.label) : row.label;
  return `<div class="cv2-row" data-cv2-row="${escapeContentHtml(row.key)}">
      <span class="cv2-row-key">
        <span class="cv2-row-icon" aria-hidden="true">${iconUse(row.icon)}</span>
        <span class="cv2-row-label">${escapeContentHtml(label)}</span>
      </span>
      <span class="cv2-row-split" aria-hidden="true"></span>
      <span class="cv2-row-value">${missing ? missingHtml(editor) : valueHtml(value.primary, value.secondary, { contactAction: row.key === "contact" && !isBlank(value.primary) })}</span>
    </div>`;
}

function extraNodeId(ui = {}) {
  const raw = String(ui.extraId || "cv2DataExtra").trim() || "cv2DataExtra";
  return raw.replace(/[^A-Za-z0-9_-]/g, "") || "cv2DataExtra";
}

function rowsHtml(vm, extraId = "cv2DataExtra") {
  let html = "";
  let extra = [];
  const flushExtra = () => {
    if (!extra.length) return;
    html += `<div class="cv2-extra" id="${escapeContentHtml(extraId)}">
      <div class="cv2-extra-inner">${extra.join("")}</div>
    </div>`;
    extra = [];
  };
  V2_DATA_ROWS.forEach((row) => {
    const markup = rowMarkup(row, vm);
    if (EXTRA_ROW_KEYS.has(row.key)) extra.push(markup);
    else {
      flushExtra();
      html += markup;
    }
  });
  flushExtra();
  return html;
}

function rowValue(vm, key) {
  switch (key) {
    case "propertyPurpose":
      return { primary: vm.propertyPurpose, secondary: "" };
    case "location":
      return { primary: vm.location, secondary: vm.locationSecondary };
    case "price":
      return { primary: vm.price, secondary: "" };
    case "specs":
      return { primary: vm.area, secondary: vm.specifications };
    case "advertiser": {
      const name = String(vm.advertiserName ?? "").trim();
      const role = String(vm.advertiserRole ?? "").trim();
      const secondary = String(vm.advertiserSecondary ?? "").trim();
      if (name) return { primary: name, secondary: secondary || role };
      return { primary: role, secondary };
    }
    case "contact":
      return { primary: vm.contactNumber, secondary: "" };
    default:
      return { primary: "", secondary: "" };
  }
}

export function buildOpportunityDataCardV2(vm = {}, ui = {}) {
  const expanded = Boolean(ui.dataCardExpanded);
  const toggleLabel = expanded ? "إخفاء التفاصيل" : "عرض التفاصيل";
  const extraId = extraNodeId(ui);
  const meta = String(ui.statusLine || completenessLine(vm));
  return `<section class="cv2-card ${expanded ? "is-expanded" : "is-collapsed"}" data-cv2-data-card aria-label="بيانات الفرصة">
    <header class="cv2-card-head">
      ${iconUse("i-clipboard-list")}
      <div class="cv2-card-head-text">
        <h2 class="cv2-card-title">بيانات الفرصة${vm.referenceCode ? ` <span class="cv2-exec-ref">${escapeContentHtml(vm.referenceCode)}</span>` : ""}</h2>
        <p class="cv2-card-meta">${escapeContentHtml(meta)}</p>
      </div>
    </header>
    <div class="cv2-rows">${rowsHtml(vm, extraId)}</div>
    <button type="button" class="cv2-details-toggle" data-cv2-toggle-details aria-expanded="${expanded ? "true" : "false"}" aria-controls="${escapeContentHtml(extraId)}">
      <span data-cv2-toggle-label>${toggleLabel}</span>
      <svg class="cv2-icon cv2-toggle-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </button>
  </section>`;
}

export function buildCompleteMissingButtonV2(vm = {}) {
  if (!displayedMissingRows(vm).length) return "";
  return `<div class="cv2-complete-wrap">
    <button type="button" class="cv2-complete-btn" data-cv2-complete data-testid="complete-missing">
      ${iconUse("i-pencil")}
      <span>أكمل البيانات الناقصة</span>
    </button>
  </div>`;
}
