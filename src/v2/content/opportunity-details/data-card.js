import { escapeContentHtml } from "../domain.js";
import { V2_DATA_ROWS, editorForDataRow } from "./view-model.js";

function iconUse(id) {
  return `<svg class="cv2-icon" aria-hidden="true"><use href="#${escapeContentHtml(id)}"/></svg>`;
}

function isBlank(value) {
  return !String(value ?? "").trim();
}

function missingHtml(editor) {
  const editorAttr = editor ? ` data-cv2-editor="${escapeContentHtml(editor)}"` : "";
  const tag = editor ? "button" : "span";
  const type = editor ? ` type="button"` : "";
  return `<${tag} class="cv2-missing-pair"${type}${editorAttr}>
    <span class="cv2-missing-badge">ناقص</span>
    <span class="cv2-missing-text">غير محدد</span>
  </${tag}>`;
}

function valueHtml(primary, secondary) {
  const main = String(primary ?? "").trim();
  const sub = String(secondary ?? "").trim();
  if (!main && !sub) return `<span class="cv2-value-empty"></span>`;
  return `<span class="cv2-value-primary">${escapeContentHtml(main)}</span>
    ${sub ? `<span class="cv2-value-secondary">${escapeContentHtml(sub)}</span>` : ""}`;
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

export function buildOpportunityDataCardV2(vm = {}) {
  const rows = V2_DATA_ROWS.map((row) => {
    const editor = editorForDataRow(row.key, vm.missingFields);
    const value = rowValue(vm, row.key);
    const missing = Boolean(editor) && isBlank(value.primary);
    const label = row.key === "price" ? (vm.priceLabel || row.label) : row.label;
    return `<div class="cv2-row" data-cv2-row="${escapeContentHtml(row.key)}">
      <span class="cv2-row-key">
        <span class="cv2-row-icon" aria-hidden="true">${iconUse(row.icon)}</span>
        <span class="cv2-row-label">${escapeContentHtml(label)}</span>
      </span>
      <span class="cv2-row-value">${missing ? missingHtml(editor) : valueHtml(value.primary, value.secondary)}</span>
    </div>`;
  }).join("");

  return `<section class="cv2-card" aria-label="بيانات الفرصة">
    <header class="cv2-card-head">
      ${iconUse("i-clipboard-list")}
      <h2 class="cv2-card-title">بيانات الفرصة</h2>
    </header>
    <div class="cv2-rows">${rows}</div>
  </section>`;
}

export function buildCompleteMissingButtonV2(vm = {}) {
  if (!vm.missingFields?.length) return "";
  return `<div class="cv2-complete-wrap">
    <button type="button" class="cv2-complete-btn" data-cv2-complete>
      ${iconUse("i-pencil")}
      <span>أكمل البيانات الناقصة</span>
    </button>
  </div>`;
}
