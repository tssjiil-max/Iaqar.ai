/**
 * OpportunityDetailsV2 — independent HTML builders.
 * Does not import old details UI or CSS class names.
 */

import { V2_DATA_ROWS } from "./opportunity-details-v2-domain.js";
import {
  ADVERTISER_ROLES,
  advertiserRoleLabel,
  isPersistedAdvertiserRole,
  resolveAdvertiserEnumValue
} from "./advertiser-phone-domain.js";

function esc(text = "") {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function iconUse(id) {
  return `<svg class="opp-v2-icon" aria-hidden="true"><use href="#${esc(id)}"/></svg>`;
}

function isBlank(value) {
  return !String(value ?? "").trim();
}

function missingValueHtml() {
  return `
    <span class="opp-v2-missing-pair">
      <span class="opp-v2-missing-badge">ناقص</span>
      <span class="opp-v2-missing-text">غير محدد</span>
    </span>`;
}

function valueStackHtml(primary, secondary, missing) {
  if (missing) return missingValueHtml();
  const main = String(primary ?? "").trim();
  const sub = String(secondary ?? "").trim();
  return `
    <span class="opp-v2-value-primary">${esc(main)}</span>
    ${sub ? `<span class="opp-v2-value-secondary">${esc(sub)}</span>` : `<span class="opp-v2-value-secondary"></span>`}`;
}

export function buildOpportunityHeaderV2() {
  return `
    <header class="opp-v2-header">
      <button type="button" class="opp-v2-header-btn" id="oppV2MoreBtn" aria-label="المزيد">
        ${iconUse("i-dots")}
      </button>
      <h1 class="opp-v2-header-title">تفاصيل الفرصة</h1>
      <button type="button" class="opp-v2-header-btn" id="oppV2BackBtn" aria-label="رجوع">
        ${iconUse("i-chevron-right")}
      </button>
    </header>`;
}

export function buildOpportunityIdentityCardV2(vm) {
  return `
    <section class="opp-v2-card opp-v2-identity" aria-label="تعريف الفرصة">
      <div class="opp-v2-identity-top">
        <div class="opp-v2-identity-main">
          <span class="opp-v2-avatar" aria-hidden="true">${iconUse("i-user")}</span>
          <div class="opp-v2-identity-copy">
            <p class="opp-v2-identity-type">${esc(vm.type ?? "")}</p>
            <p class="opp-v2-identity-id">#${esc(vm.displayNumber ?? "")}</p>
          </div>
        </div>
        <span class="opp-v2-status is-${esc(vm.statusId || "incomplete")}">${esc(vm.status ?? "")}</span>
      </div>
      <p class="opp-v2-added">
        <span>تاريخ الإضافة: ${esc(vm.createdAt || "-")}</span>
        <span class="opp-v2-added-icon" aria-hidden="true">${iconUse("i-calendar")}</span>
      </p>
    </section>`;
}

export function buildMissingFieldsV2(vm) {
  const fields = Array.isArray(vm.missingFields) ? vm.missingFields : [];
  if (!fields.length) return "";
  const chips = fields.map((field) => `
    <button type="button" class="opp-v2-missing-chip" data-v2-editor="${esc(field.editor)}" data-v2-field="${esc(field.key)}">
      <span class="opp-v2-missing-x" aria-hidden="true">✕</span>
      <span>${esc(field.label)}</span>
    </button>`).join("");
  return `
    <section class="opp-v2-missing" aria-label="البيانات الناقصة">
      <p class="opp-v2-missing-title">البيانات الناقصة</p>
      <div class="opp-v2-missing-list">${chips}</div>
    </section>`;
}

function rowValueFor(vm, key) {
  switch (key) {
    case "propertyPurpose":
      return { primary: vm.propertyPurpose ?? "", secondary: "", missing: isBlank(vm.propertyPurpose) };
    case "location":
      return { primary: vm.location ?? "", secondary: vm.locationSecondary ?? "", missing: isBlank(vm.location) };
    case "price":
      return { primary: vm.price ?? "", secondary: "", missing: isBlank(vm.price) };
    case "specs":
      return { primary: vm.area ?? "", secondary: vm.specifications ?? "", missing: isBlank(vm.area) };
    case "advertiser": {
      const name = String(vm.advertiserName ?? "").trim();
      const role = String(vm.advertiserRole ?? "").trim();
      const secondary = String(vm.advertiserSecondary ?? "").trim();
      if (name) return { primary: name, secondary: secondary || role, missing: false };
      return { primary: role, secondary, missing: isBlank(role) };
    }
    case "contact":
      return { primary: vm.contactNumber ?? "", secondary: "", missing: isBlank(vm.contactNumber) };
    default:
      return { primary: "", secondary: "", missing: true };
  }
}

export function buildOpportunityDataCardV2(vm) {
  const rows = V2_DATA_ROWS.map((row) => {
    const value = rowValueFor(vm, row.key);
    const label = row.key === "price" ? (vm.priceLabel || row.label) : row.label;
    return `
      <div class="opp-v2-row" data-v2-row="${esc(row.key)}">
        <span class="opp-v2-row-key">
          <span class="opp-v2-row-icon" aria-hidden="true">${iconUse(row.icon)}</span>
          <span class="opp-v2-row-label">${esc(label)}</span>
        </span>
        <span class="opp-v2-row-value">${valueStackHtml(value.primary, value.secondary, value.missing)}</span>
      </div>`;
  }).join("");

  return `
    <section class="opp-v2-card opp-v2-data" aria-label="بيانات الفرصة">
      <header class="opp-v2-card-head">
        ${iconUse("i-clipboard-list")}
        <h2>بيانات الفرصة</h2>
      </header>
      <div class="opp-v2-rows">${rows}</div>
    </section>`;
}

export function buildCompleteMissingButtonV2(vm) {
  const fields = Array.isArray(vm.missingFields) ? vm.missingFields : [];
  if (!fields.length) return "";
  return `
    <div class="opp-v2-complete-wrap">
      <button type="button" class="opp-v2-complete-btn" id="oppV2CompleteBtn">
        ${iconUse("i-pencil")}
        <span>أكمل البيانات الناقصة</span>
      </button>
    </div>`;
}

export function buildDailyReportCardV2(vm) {
  const activities = Array.isArray(vm.activities) && vm.activities.length
    ? vm.activities
    : [{ time: "-", title: "-", result: "-" }];
  const rows = activities.map((row) => `
    <li class="opp-v2-report-row">
      <time class="opp-v2-report-time">${esc(row.time || "-")}</time>
      <span class="opp-v2-report-action">${esc(row.title || "-")}</span>
      <span class="opp-v2-report-result">
        <span class="opp-v2-report-check" aria-hidden="true">${iconUse("i-check-circle")}</span>
        <span>${esc(row.result || "-")}</span>
      </span>
    </li>`).join("");
  return `
    <section class="opp-v2-card opp-v2-report" aria-label="تقرير اليوم">
      <header class="opp-v2-card-head">
        ${iconUse("i-list")}
        <h2>تقرير اليوم</h2>
      </header>
      <div class="opp-v2-report-head" aria-hidden="true">
        <span>الوقت</span>
        <span>الإجراء</span>
        <span>النتيجة</span>
      </div>
      <ul class="opp-v2-report-list">${rows}</ul>
      <p class="opp-v2-result-bar">
        <span class="opp-v2-info-dot" aria-hidden="true">${iconUse("i-info")}</span>
        <span>${esc(vm.currentResult || "النتيجة الحالية: -")}</span>
      </p>
    </section>`;
}

export function buildNextAppointmentCardV2(vm) {
  const next = vm.nextAppointment || {};
  return `
    <section class="opp-v2-card opp-v2-appointment" aria-label="الموعد القادم">
      <header class="opp-v2-card-head">
        ${iconUse("i-calendar")}
        <h2>الموعد القادم</h2>
      </header>
      <div class="opp-v2-appointment-body">
        <p class="opp-v2-appointment-when">${esc(next.dateTime || "-")}</p>
        <span class="opp-v2-appointment-divider" aria-hidden="true"></span>
        <div class="opp-v2-appointment-copy">
          <strong>${esc(next.type || "-")}</strong>
          <span>${esc(next.confirmationStatus || "-")}</span>
        </div>
      </div>
    </section>`;
}

export function buildOpportunityMoreActionsV2(vm = {}) {
  const archived = Boolean(vm.archived);
  const archiveLabel = vm.archiveActionLabel || "نقل إلى الأرشيف";
  if (archived) {
    return `
    <div class="opp-v2-more" id="oppV2MoreMenu" hidden>
      <button type="button" class="opp-v2-more-item" id="oppV2RestoreBtn" data-testid="restore-opportunity">استعادة</button>
      <button type="button" class="opp-v2-more-item is-danger" id="oppV2DeleteBtn" data-testid="permanent-delete">حذف نهائي</button>
    </div>`;
  }
  return `
    <div class="opp-v2-more" id="oppV2MoreMenu" hidden>
      <button type="button" class="opp-v2-more-item" id="oppV2ArchiveBtn" data-testid="archive-opportunity">${esc(archiveLabel)}</button>
    </div>`;
}

export function buildFieldEditorV2(editorKey, vm = {}, seed = "") {
  const resolvedRole = resolveAdvertiserEnumValue(seed) || resolveAdvertiserEnumValue(vm.advertiserRole);
  const roleValue = isPersistedAdvertiserRole(resolvedRole) ? advertiserRoleLabel(resolvedRole) : "";
  const editors = {
    advertiserRole: {
      title: "صفة المعلن",
      hint: "مالك، عميل، مفوض، وسيط عقاري",
      input: `<input class="opp-v2-editor-input" name="advertiserRole" type="text" maxlength="40" autocomplete="off" value="${esc(roleValue)}" placeholder="اختر أو اكتب صفة المعلن">`
    },
    contactNumber: {
      title: "رقم التواصل",
      hint: "05XXXXXXXX",
      input: `<input class="opp-v2-editor-input" name="contactNumber" type="tel" inputmode="numeric" maxlength="14" autocomplete="off" value="${esc(seed || vm.contactNumber || "")}" placeholder="05XXXXXXXX">`
    },
    price: {
      title: vm.priceLabel || "السعر",
      hint: "أدخل الرقم فقط",
      input: `<input class="opp-v2-editor-input" name="price" type="number" inputmode="numeric" autocomplete="off" value="${esc(seed)}" placeholder="مثال: 850000">`
    },
    area: {
      title: "المساحة",
      hint: "بالمتر المربع",
      input: `<input class="opp-v2-editor-input" name="area" type="number" inputmode="numeric" autocomplete="off" value="${esc(seed || String(vm.area || "").replace(/[^\d.]/g, ""))}" placeholder="0">`
    },
    location: {
      title: "الموقع",
      hint: "المدينة والحي",
      input: `
        <input class="opp-v2-editor-input" name="city" type="text" maxlength="80" autocomplete="off" value="${esc(vm.cityValue || vm.city || seed)}" placeholder="المدينة">
        <input class="opp-v2-editor-input" name="district" type="text" maxlength="80" autocomplete="off" value="${esc(vm.districtValue || vm.district || "")}" placeholder="الحي">`
    },
    propertyPurpose: {
      title: "العقار والغرض",
      hint: "مثال: أرض — بيع",
      input: `
        <input class="opp-v2-editor-input" name="propertyType" type="text" maxlength="80" autocomplete="off" value="${esc(vm.propertyPurpose || "")}" placeholder="نوع العقار">
        <input class="opp-v2-editor-input" name="purpose" type="text" maxlength="40" autocomplete="off" placeholder="بيع / إيجار">`
    }
  };
  const spec = editors[editorKey] || editors.advertiserRole;
  const roleHints = editorKey === "advertiserRole"
    ? `<div class="cv2-role-chips" role="list">${ADVERTISER_ROLES.filter((row) => row.id !== "UNKNOWN").map((row) => `<button type="button" class="cv2-role-chip${roleValue === row.label ? " is-selected" : ""}" role="listitem" data-cv2-role="${esc(row.label)}">${esc(row.label)}</button>`).join("")}</div>`
    : "";
  return `
    <div class="opp-v2-editor" id="oppV2Editor" data-v2-editor="${esc(editorKey)}" role="dialog" aria-modal="true" aria-labelledby="oppV2EditorTitle">
      <div class="opp-v2-editor-sheet">
        <h3 id="oppV2EditorTitle">${esc(spec.title)}</h3>
        <p class="opp-v2-editor-hint">${esc(spec.hint)}</p>
        ${roleHints}
        <form id="oppV2EditorForm" class="opp-v2-editor-form" autocomplete="off">
          ${spec.input}
          <p class="opp-v2-editor-error" id="oppV2EditorError" hidden></p>
          <div class="opp-v2-editor-actions">
            <button type="submit" class="opp-v2-editor-save" id="oppV2EditorSave">حفظ</button>
            <button type="button" class="opp-v2-editor-cancel" id="oppV2EditorCancel">إلغاء</button>
          </div>
        </form>
      </div>
    </div>`;
}

export function buildOpportunityDetailsV2PageHtml(vm) {
  return `
    <div class="opp-v2-page" dir="rtl" data-opportunity-id="${esc(vm.id || "")}">
      ${buildOpportunityHeaderV2()}
      <div class="opp-v2-body">
        ${buildOpportunityIdentityCardV2(vm)}
        ${buildMissingFieldsV2(vm)}
        ${buildOpportunityDataCardV2(vm)}
        ${buildCompleteMissingButtonV2(vm)}
        ${buildDailyReportCardV2(vm)}
        ${buildNextAppointmentCardV2(vm)}
        ${buildOpportunityMoreActionsV2(vm)}
      </div>
    </div>`;
}
