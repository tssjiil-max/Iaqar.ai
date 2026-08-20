/**
 * Unified opportunity details UI — pixel-aligned to approved reference spec.
 * Display-only; uses existing readiness evaluation and record normalization.
 */

import { buildBankListCardView } from "./bank-list-card-domain.js";
import {
  buildListingFieldChecks,
  normalizeListingRecord
} from "./opportunity-listing-normalize.js";
import {
  evaluateMatchingReadiness,
  missingFieldLabelsArabic,
  MISSING_FIELD_LABELS
} from "./opportunity-readiness-domain.js";
import {
  buildOpportunitySpecsLine,
  isDetailsRowComplete
} from "./opportunity-field-completion-domain.js";
import { ADVERTISER_ROLES } from "./advertiser-phone-domain.js";

export const OPPORTUNITY_RECORD_KIND = Object.freeze({
  OWNER_OFFER: "owner_offer",
  CLIENT_REQUEST: "client_request"
});

export const OPPORTUNITY_DETAILS_ROW_ICONS = Object.freeze({
  propertyPurpose: "i-home",
  location: "i-map-pin",
  price: "i-price-tag",
  specs: "i-area",
  advertiser: "i-user",
  contact: "i-phone"
});

const ROW_ICONS = OPPORTUNITY_DETAILS_ROW_ICONS;

function esc(text = "") {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function formatOpportunityDisplayId(id = "") {
  const digits = String(id || "").replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  const compact = String(id || "").trim();
  return compact.slice(-4) || compact || "—";
}

function lifecycleApi() {
  return typeof window !== "undefined" ? window.IAQAR_LIFECYCLE : null;
}

function resolveLifecycleStatus(record = {}) {
  const lc = lifecycleApi();
  if (lc?.getOpportunityLifecycleStatus) {
    return lc.getOpportunityLifecycleStatus(record);
  }
  return String(record.lifecycleStatus || "NEW").trim().toUpperCase() || "NEW";
}

function isOwnerRecord(record = {}) {
  const kind = String(record.opportunityKind || record.kind || record.recordType || "").toUpperCase();
  return record.contactType === "owner"
    || kind === "OWNER"
    || kind === "OWNER_OFFER"
    || kind === "OFFER";
}

function resolveRecordKind(record = {}) {
  return isOwnerRecord(record)
    ? OPPORTUNITY_RECORD_KIND.OWNER_OFFER
    : OPPORTUNITY_RECORD_KIND.CLIENT_REQUEST;
}

function resolveKindLabel(record = {}) {
  return isOwnerRecord(record) ? "عرض مالك" : "طلب عميل";
}

function resolveKindIcon(record = {}) {
  return isOwnerRecord(record) ? "i-house-check" : "i-user-clock";
}

/** @returns {{ label: string, cssClass: string }} */
export function resolveOpportunityDetailsStatus(record = {}, readiness = {}) {
  const lifecycle = resolveLifecycleStatus(record);
  if (lifecycle === "ARCHIVED" || record.archivedAt) {
    return { label: "منتهية", cssClass: "is-ended" };
  }
  if (lifecycle === "CLOSED_WON" || lifecycle === "CLOSED_LOST") {
    return { label: "منتهية", cssClass: "is-ended" };
  }
  if (lifecycle === "MATCHED") {
    return { label: "تمت المطابقة", cssClass: "is-matched" };
  }
  if (readiness.isReadyForMatching) {
    return { label: "جاهزة للمطابقة", cssClass: "is-ready" };
  }
  return { label: "ناقصة", cssClass: "is-incomplete" };
}

function formatAddedAt(record = {}) {
  const raw = record.createdAt || record.receivedAt || record.updatedAt;
  if (!raw) return "";
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  const tz = "Asia/Riyadh";
  const day = date.toLocaleDateString("ar-SA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const time = date.toLocaleTimeString("ar-SA", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });
  return { day, time, combined: `${day} | ${time}` };
}

function advertiserRoleLabel(value = "") {
  const id = String(value || "").trim().toUpperCase();
  return ADVERTISER_ROLES.find((row) => row.id === id)?.label || String(value || "").trim();
}

function advertiserRoleSubtext(roleRaw = "", isOwner = false) {
  const id = String(roleRaw || "").trim().toUpperCase();
  if (id === "OWNER" && isOwner) return "مالك مباشر";
  if (id === "CLIENT") return "عميل مباشر";
  return "";
}

function normalizeCityDistrict(record = {}) {
  const card = buildBankListCardView(normalizeListingRecord(record));
  const city = String(record.city || "").trim();
  const district = String(record.district || "").trim();
  const locationLine = card.location || "";
  let cityText = city;
  let districtText = district;
  if (!cityText && locationLine.includes("—")) {
    cityText = locationLine.split("—")[0]?.trim() || "";
  }
  if (!districtText && locationLine.includes("—")) {
    districtText = locationLine.split("—")[1]?.trim() || "";
  }
  if (districtText.startsWith("حي ")) districtText = districtText.slice(3).trim();
  return { cityText, districtText };
}

export function normalizeOpportunityDetailsRecord(record = {}) {
  return normalizeListingRecord(record);
}

export function buildOpportunityDetailsProgress(readiness = {}, checks = []) {
  const total = checks.length || 7;
  const completeCount = checks.filter((row) => row.complete).length;
  const pct = total ? Math.round((completeCount / total) * 100) : 0;
  const missingLabels = missingFieldLabelsArabic(readiness.matchingReadinessMissing || []);
  return { total, completeCount, pct, missingLabels };
}

/**
 * Unified view-model for all detail surfaces.
 */
export function buildOpportunityDetailsViewModel(id, record = {}, readinessInput = {}) {
  const normalized = normalizeOpportunityDetailsRecord(record);
  const readiness = readinessInput.matchingReadiness
    ? readinessInput
    : evaluateMatchingReadiness(normalized);
  const card = buildBankListCardView(normalized);
  const checks = buildListingFieldChecks(normalized);
  const progress = buildOpportunityDetailsProgress(readiness, checks);
  const byKey = Object.fromEntries(checks.map((row) => [row.key, row]));
  const { cityText, districtText } = normalizeCityDistrict(normalized);
  const isOwner = isOwnerRecord(normalized);
  const specs = buildOpportunitySpecsLine(normalized);
  const phone = normalized.contactPhone || normalized.phone || normalized.advertiserPhoneNormalized || "";
  const roleRaw = normalized.advertiserRole || normalized.ownerRole || "";
  const addedAt = formatAddedAt(normalized);

  return {
    id: String(id || normalized.id || ""),
    rawRecord: normalized,
    recordKind: resolveRecordKind(normalized),
    kindLabel: resolveKindLabel(normalized),
    kindIcon: resolveKindIcon(normalized),
    title: card.title,
    status: resolveOpportunityDetailsStatus(normalized, readiness),
    addedAtLabel: addedAt.combined || "",
    addedAtDay: addedAt.day || "",
    addedAtTime: addedAt.time || "",
    progress,
    readiness,
    checks,
    byKey,
    isOwner,
    priceLabel: isOwner ? "السعر" : "الميزانية",
    priceValue: card.priceText,
    locationCity: cityText,
    locationDistrict: districtText,
    specs,
    advertiserRole: advertiserRoleLabel(roleRaw),
    advertiserRoleSubtext: advertiserRoleSubtext(roleRaw, isOwner),
    contactPhone: phone,
    propertyPurposeLine: card.title
  };
}

export function buildOpportunityDetailsHeaderHtml(vm) {
  const statusDot = vm.status.cssClass === "is-incomplete" || vm.status.cssClass === "is-ready"
    ? `<span class="opp-details-status-dot" aria-hidden="true"></span>`
    : "";
  return `
    <section class="opp-details-card opp-details-identity-card">
      <div class="opp-details-header">
        <div class="opp-details-header-top">
          <div class="opp-details-header-main">
            <span class="opp-details-icon" aria-hidden="true">
              <svg class="icon"><use href="#${esc(vm.kindIcon)}"/></svg>
            </span>
            <div class="opp-details-header-copy">
              <p class="opp-details-kind">${esc(vm.kindLabel)}</p>
              <p class="opp-details-id">#${esc(formatOpportunityDisplayId(vm.id))}</p>
            </div>
          </div>
          <span class="opp-details-status ${esc(vm.status.cssClass)}">${statusDot}${esc(vm.status.label)}</span>
        </div>
        ${vm.addedAtLabel ? `<p class="opp-details-added-at"><span class="opp-details-added-at-icon" aria-hidden="true">📅</span> تاريخ الإضافة: ${esc(vm.addedAtLabel)}</p>` : ""}
      </div>
    </section>`;
}

function missingInlineHtml(vm) {
  if (!vm.progress.missingLabels.length) return "";
  const chips = vm.progress.missingLabels.map((label) => `
    <span class="opp-details-missing-chip"><span class="opp-details-missing-dot" aria-hidden="true"></span>${esc(label)}</span>`).join("");
  return `
    <div class="opp-details-missing-inline" aria-label="الحقول الناقصة">
      <span class="opp-details-missing-title">الناقص:</span>
      <div class="opp-details-missing-list">${chips}</div>
    </div>`;
}

export function buildCompletionProgressHtml(vm) {
  const { progress, status } = vm;
  return `
    <section class="opp-details-card opp-details-completion-card" aria-label="نسبة اكتمال البيانات">
      <div class="opp-details-progress-layout">
        <div class="opp-details-progress-copy">
          <strong>نسبة اكتمال البيانات</strong>
          <p class="opp-details-progress-hint">${status.cssClass === "is-ready"
    ? "الفرصة جاهزة للمطابقة."
    : "استكمل البيانات الناقصة ليتم تحويل الفرصة إلى جاهزة للمطابقة."}</p>
          ${missingInlineHtml(vm)}
        </div>
        <div class="opp-details-progress-side">
          <div class="opp-details-progress-ring" style="--opp-progress:${progress.pct}" aria-hidden="true">
            <span class="opp-details-progress-count">
              <span class="opp-details-progress-top">${esc(String(progress.completeCount))}</span>
              <span class="opp-details-progress-bottom">من ${esc(String(progress.total))}</span>
            </span>
          </div>
          <p class="opp-details-progress-pct">${esc(`${progress.pct}%`)} مكتملة</p>
        </div>
      </div>
    </section>`;
}

export function buildMissingFieldsAlertHtml(vm) {
  return missingInlineHtml(vm);
}

function rowStatusHtml(complete) {
  const icon = complete ? "✓" : "✕";
  const cssClass = complete ? "is-complete" : "is-missing";
  const label = complete ? "مكتمل" : "ناقص";
  return `<span class="opp-details-row-status ${cssClass}" aria-label="${label}">${icon}</span>`;
}

function rowLabelHtml(rowKey, label) {
  const iconId = ROW_ICONS[rowKey] || "i-clipboard-list";
  return `
    <span class="opp-details-row-label">
      <svg class="opp-details-row-icon" aria-hidden="true"><use href="#${esc(iconId)}"/></svg>
      <span>${esc(label)}</span>
    </span>`;
}

function valueCellHtml(display, complete, subtext = "") {
  const mainClass = complete ? "opp-details-row-main" : "opp-details-row-main is-empty";
  const missingBadge = complete ? "" : `<span class="opp-details-missing-tag">ناقص</span>`;
  const sub = complete && subtext ? `<span class="opp-details-row-sub">${esc(subtext)}</span>` : "";
  return `
    <span class="opp-details-row-value">
      <span class="opp-details-row-value-stack">
        <span class="${mainClass}">${esc(display)}</span>
        ${missingBadge}
      </span>
      ${sub}
    </span>`;
}

function dataRow(vm, rowKey, label, value, subtext = "") {
  const complete = isDetailsRowComplete(vm, rowKey);
  const display = complete
    ? (String(value ?? "").trim() || "—")
    : "غير محدد";
  return `
    <div class="opp-details-row ${complete ? "is-row-complete" : "is-row-missing"}">
      ${rowLabelHtml(rowKey, label)}
      ${valueCellHtml(display, complete, complete ? subtext : "")}
      ${rowStatusHtml(complete)}
    </div>`;
}

function contactSaveButtonHtml(vm) {
  const phone = String(vm.contactPhone || "").trim();
  if (!phone) return "";
  return `<button type="button" class="js-save-phone-contact opp-contact-save-btn"
      data-contact-phone="${esc(phone)}"
      aria-label="حفظ الرقم في سجل الهاتف"
      title="حفظ الرقم في سجل الهاتف">
      <svg class="opp-contact-save-icon" aria-hidden="true"><use href="#i-contact-save"/></svg>
    </button>`;
}

function contactRow(vm) {
  const complete = isDetailsRowComplete(vm, "contact");
  const display = complete
    ? (String(vm.contactPhone ?? "").trim() || "—")
    : "غير محدد";
  const missingBadge = complete ? "" : `<span class="opp-details-missing-tag">ناقص</span>`;
  return `
    <div class="opp-details-row ${complete ? "is-row-complete" : "is-row-missing"}">
      ${rowLabelHtml("contact", "رقم التواصل")}
      <span class="opp-details-row-value opp-contact-value">
        <span class="opp-details-row-value-stack">
          <span class="${complete ? "opp-details-row-main" : "opp-details-row-main is-empty"}">${esc(display)}</span>
          ${missingBadge}
        </span>
        ${complete ? contactSaveButtonHtml(vm) : ""}
      </span>
      ${rowStatusHtml(complete)}
    </div>`;
}

function locationRow(vm) {
  const complete = isDetailsRowComplete(vm, "location");
  const city = vm.locationCity || "";
  const district = vm.locationDistrict || "";
  let valueHtml;
  if (!complete && !city && !district) {
    valueHtml = valueCellHtml("غير محدد", false);
  } else {
    const main = [city, district ? `حي ${district}` : ""].filter(Boolean).join(" – ");
    valueHtml = valueCellHtml(main || "—", complete, district ? `الحي: ${district}` : "");
  }
  return `
    <div class="opp-details-row ${complete ? "is-row-complete" : "is-row-missing"}">
      ${rowLabelHtml("location", "الموقع")}
      ${valueHtml}
      ${rowStatusHtml(complete)}
    </div>`;
}

export function buildOpportunityDataTableHtml(vm, options = {}) {
  const includeRevealButton = options.includeRevealButton !== false;
  const hasMissing = (vm.progress?.missingLabels || []).length > 0;
  const footerHtml = includeRevealButton && hasMissing
    ? `<div class="opp-details-data-footer">${buildOpportunityDetailsRevealFormButtonHtml({ embedded: true })}</div>`
    : "";
  return `
    <section class="opp-details-card opp-details-data-table" aria-label="بيانات الفرصة">
      <header class="opp-details-data-title">
        <svg class="opp-details-data-title-icon" aria-hidden="true"><use href="#i-clipboard-list"/></svg>
        <span class="opp-details-data-title-text">بيانات الفرصة</span>
      </header>
      <div class="opp-details-data-rows">
        ${dataRow(vm, "propertyPurpose", "العقار والغرض", vm.propertyPurposeLine)}
        ${locationRow(vm)}
        ${dataRow(vm, "price", vm.priceLabel, vm.priceValue)}
        ${dataRow(vm, "specs", "المساحة والمواصفات", vm.specs || "—")}
        ${dataRow(vm, "advertiser", "المعلن وصفته", vm.advertiserRole, vm.advertiserRoleSubtext)}
        ${contactRow(vm)}
      </div>
      ${footerHtml}
    </section>`;
}

export function buildOpportunityDetailsCoreHtml(id, record = {}, readiness = {}) {
  const vm = buildOpportunityDetailsViewModel(id, record, readiness);
  return {
    vm,
    html: `
      <div class="opp-details opp-details--unified" data-record-kind="${esc(vm.recordKind)}">
        ${buildOpportunityDataTableHtml(vm, { includeRevealButton: true })}
      </div>`
  };
}

/** @deprecated use buildOpportunityDetailsCoreHtml */
export function buildOpportunityDetailSummaryHtml(id, record = {}, readiness = {}) {
  return buildOpportunityDetailsCoreHtml(id, record, readiness).html;
}

export function buildOpportunityDetailProgress(readiness = {}, checks = []) {
  return buildOpportunityDetailsProgress(readiness, checks);
}

export function buildOpportunityDetailsRevealFormButtonHtml(options = {}) {
  const embedded = Boolean(options.embedded);
  const wrapClass = embedded ? "opp-details-actions opp-details-actions--embedded" : "opp-details-actions";
  return `
    <div class="${wrapClass}">
      <button type="button" class="bank-action iaqar-workflow-btn secondary opp-details-reveal-btn" id="oppDetailsRevealFormBtn">
        <span class="opp-details-btn-icon" aria-hidden="true">
          <svg class="opp-details-btn-svg" viewBox="0 0 24 24" focusable="false"><path fill="currentColor" d="M3 5h18v2H3V5zm0 6h12v2H3v-2zm0 6h8v2H3v-2z"/></svg>
        </span>
        أكمل البيانات الناقصة
      </button>
    </div>`;
}

export function missingFieldLabelForKey(key = "") {
  return MISSING_FIELD_LABELS[key] || key;
}
