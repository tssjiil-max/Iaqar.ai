/**
 * Unified opportunity details UI — owner offers and client requests share one layout.
 * Display-only; uses existing readiness evaluation and record normalization.
 */

import { buildBankListCardView } from "./bank-list-card-domain.js";
import {
  buildListingFieldChecks,
  normalizeListingRecord
} from "./opportunity-listing-card-ui.js";
import {
  evaluateMatchingReadiness,
  missingFieldLabelsArabic,
  MISSING_FIELD_LABELS
} from "./opportunity-readiness-domain.js";
import { ADVERTISER_ROLES } from "./advertiser-phone-domain.js";

export const OPPORTUNITY_RECORD_KIND = Object.freeze({
  OWNER_OFFER: "owner_offer",
  CLIENT_REQUEST: "client_request"
});

function esc(text = "") {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
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
  const day = date.toLocaleDateString("ar-SA", { timeZone: tz, year: "numeric", month: "short", day: "numeric" });
  const time = date.toLocaleTimeString("ar-SA", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });
  return `${day} · ${time}`;
}

function advertiserRoleLabel(value = "") {
  const id = String(value || "").trim().toUpperCase();
  return ADVERTISER_ROLES.find((row) => row.id === id)?.label || String(value || "").trim();
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
  const specs = [
    card.areaText,
    card.roomsText ? `${card.roomsText} غرف` : ""
  ].filter(Boolean).join(" · ");
  const phone = normalized.contactPhone || normalized.phone || normalized.advertiserPhoneNormalized || "";
  const roleRaw = normalized.advertiserRole || normalized.ownerRole || "";

  return {
    id: String(id || normalized.id || ""),
    recordKind: resolveRecordKind(normalized),
    kindLabel: resolveKindLabel(normalized),
    kindIcon: resolveKindIcon(normalized),
    title: card.title,
    status: resolveOpportunityDetailsStatus(normalized, readiness),
    addedAtLabel: formatAddedAt(normalized),
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
    contactPhone: phone,
    propertyPurposeLine: card.title
  };
}

export function buildOpportunityDetailsHeaderHtml(vm) {
  return `
    <header class="opp-details-header">
      <div class="opp-details-header-top">
        <div class="opp-details-header-main">
          <span class="opp-details-icon" aria-hidden="true">
            <svg class="icon"><use href="#${esc(vm.kindIcon)}"/></svg>
          </span>
          <div class="opp-details-header-copy">
            <p class="opp-details-kind">${esc(vm.kindLabel)}</p>
            <h4 class="opp-details-title">${esc(vm.title)}</h4>
            <p class="opp-details-id">#${esc(String(vm.id).slice(-8))}</p>
          </div>
        </div>
        <span class="opp-details-status ${esc(vm.status.cssClass)}">${esc(vm.status.label)}</span>
      </div>
      ${vm.addedAtLabel ? `<p class="opp-details-added-at">تاريخ الإضافة: ${esc(vm.addedAtLabel)}</p>` : ""}
    </header>`;
}

export function buildCompletionProgressHtml(vm) {
  const { progress, status } = vm;
  return `
    <section class="opp-details-progress" aria-label="نسبة اكتمال البيانات">
      <div class="opp-details-progress-ring" style="--opp-progress:${progress.pct}" aria-hidden="true">
        <span class="opp-details-progress-count">
          <span class="opp-details-progress-top">${esc(String(progress.completeCount))}</span>
          <span class="opp-details-progress-bottom">من ${esc(String(progress.total))}</span>
        </span>
      </div>
      <div class="opp-details-progress-copy">
        <strong>نسبة اكتمال البيانات</strong>
        <p>${esc(`${progress.pct}% مكتملة`)}</p>
        <p class="opp-details-progress-hint">${status.cssClass === "is-ready"
    ? "الفرصة جاهزة للمطابقة."
    : "استكمال البيانات الناقصة ليتم تحويل الفرصة إلى جاهزة للمطابقة."}</p>
      </div>
    </section>`;
}

export function buildMissingFieldsAlertHtml(vm) {
  if (!vm.progress.missingLabels.length) return "";
  const chips = vm.progress.missingLabels.map((label) => `
    <span class="opp-details-missing-chip"><span class="opp-details-missing-dot" aria-hidden="true"></span>${esc(label)}</span>`).join("");
  return `
    <section class="opp-details-missing-alert" aria-label="الحقول الناقصة">
      <p class="opp-details-missing-title">الناقص:</p>
      <div class="opp-details-missing-list">${chips}</div>
    </section>`;
}

function dataRow(label, value, complete) {
  const missing = complete === false;
  const display = missing ? "غير محدد" : (String(value ?? "").trim() || "—");
  return `
    <div class="opp-details-row ${missing ? "is-missing" : ""}">
      <span class="opp-details-row-label">${esc(label)}</span>
      <span class="opp-details-row-value">
        ${missing ? `<span class="opp-details-missing-tag">ناقص</span>` : ""}
        <span class="${missing ? "is-empty" : ""}">${esc(display)}</span>
      </span>
    </div>`;
}

function locationRow(vm) {
  const cityMissing = vm.byKey.city?.complete === false;
  const districtMissing = vm.byKey.district?.complete === false;
  const missing = cityMissing || districtMissing;
  const city = vm.locationCity || "";
  const district = vm.locationDistrict || "";
  const valueHtml = missing && !city && !district
    ? `<span class="is-empty">غير محدد</span>`
    : `
      ${city ? `<span class="opp-details-location-city">${esc(city)}</span>` : ""}
      ${district ? `<span class="opp-details-location-district">الحي: ${esc(district)}</span>` : ""}`;
  return `
    <div class="opp-details-row ${missing ? "is-missing" : ""}">
      <span class="opp-details-row-label">الموقع</span>
      <span class="opp-details-row-value opp-details-location-value">
        ${missing ? `<span class="opp-details-missing-tag">ناقص</span>` : ""}
        ${valueHtml}
      </span>
    </div>`;
}

export function buildOpportunityDataTableHtml(vm) {
  const propertyMissing = vm.byKey.propertyType?.complete === false;
  const purposeMissing = vm.byKey.purpose?.complete === false;
  const propertyPurposeMissing = propertyMissing || purposeMissing;
  const specsMissing = !vm.specs;
  return `
    <section class="opp-details-data-table" aria-label="بيانات الفرصة">
      <h5 class="opp-details-data-title">بيانات الفرصة</h5>
      <div class="opp-details-data-rows">
        ${dataRow("العقار والغرض", vm.propertyPurposeLine, propertyPurposeMissing ? false : undefined)}
        ${locationRow(vm)}
        ${dataRow(vm.priceLabel, vm.priceValue, vm.byKey.priceOrBudget?.complete)}
        ${dataRow("المساحة والمواصفات", vm.specs || "—", specsMissing ? false : undefined)}
        ${dataRow("المعلن وصفته", vm.advertiserRole, vm.byKey.advertiserRole?.complete)}
        ${dataRow("رقم التواصل", vm.contactPhone, vm.byKey.contactPhone?.complete)}
      </div>
    </section>`;
}

export function buildOpportunityDetailsCoreHtml(id, record = {}, readiness = {}) {
  const vm = buildOpportunityDetailsViewModel(id, record, readiness);
  return {
    vm,
    html: `
      <div class="opp-details" data-record-kind="${esc(vm.recordKind)}">
        ${buildOpportunityDetailsHeaderHtml(vm)}
        ${buildCompletionProgressHtml(vm)}
        ${buildMissingFieldsAlertHtml(vm)}
        ${buildOpportunityDataTableHtml(vm)}
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

export function buildOpportunityDetailsRevealFormButtonHtml() {
  return `
    <div class="opp-details-actions">
      <button type="button" class="bank-action iaqar-workflow-btn secondary" id="oppDetailsRevealFormBtn">
        أكمل البيانات الناقصة
      </button>
    </div>`;
}

export function missingFieldLabelForKey(key = "") {
  return MISSING_FIELD_LABELS[key] || key;
}
