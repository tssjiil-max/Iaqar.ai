/**
 * Unified opportunity details UI — owner offers and client requests share one layout.
 * PHASE 1: visual structure matches the final reference screenshot only.
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
import {
  buildOpportunitySpecsLine,
  isDetailsRowComplete
} from "./opportunity-field-completion-domain.js";
import {
  ADVERTISER_ROLES,
  formatLocalPhoneDisplay
} from "./advertiser-phone-domain.js";
import { safeText } from "./opportunity-intake-domain.js";
import {
  activeFollowUpFromRecord,
  formatFollowUpAppointmentLine
} from "./opportunity-followup-domain.js";
import { buildWorkspaceActivity } from "./opportunity-workspace-domain.js";

export const OPPORTUNITY_RECORD_KIND = Object.freeze({
  OWNER_OFFER: "owner_offer",
  CLIENT_REQUEST: "client_request"
});

const TZ = "Asia/Riyadh";

function esc(text = "") {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function iconUse(id) {
  return `<svg class="icon" aria-hidden="true"><use href="#${esc(id)}"/></svg>`;
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

function riyadhDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function isSameRiyadhDay(a, b) {
  const left = new Date(a.toLocaleString("en-US", { timeZone: TZ }));
  const right = new Date(b.toLocaleString("en-US", { timeZone: TZ }));
  return left.toDateString() === right.toDateString();
}

export function formatHijriDate(value) {
  const date = riyadhDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  if (!year || !month || !day) return "";
  return `${year}/${month}/${day}`;
}

export function formatClockLabel(value) {
  const date = riyadhDate(value);
  if (!date) return "";
  return date.toLocaleTimeString("ar-SA", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).replace(/\s+/g, " ").trim();
}

function formatAddedAt(record = {}, now = new Date()) {
  const raw = record.createdAt || record.receivedAt || record.updatedAt;
  const date = riyadhDate(raw);
  if (!date) return "";
  const hijri = formatHijriDate(date);
  const time = formatClockLabel(date);
  const dayBit = isSameRiyadhDay(date, now) ? "اليوم " : "";
  if (hijri && time) return `${hijri} | ${dayBit}${time}`.replace(/\s+\|/g, " |");
  return [hijri, `${dayBit}${time}`.trim()].filter(Boolean).join(" | ");
}

export function formatDisplayOpportunityId(id = "") {
  const raw = String(id || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 4) return digits.slice(-4);
  if (raw.length <= 8) return raw;
  return raw.slice(-8);
}

function advertiserRoleLabel(value = "") {
  const id = String(value || "").trim().toUpperCase();
  return ADVERTISER_ROLES.find((row) => row.id === id)?.label || String(value || "").trim();
}

function advertiserSecondaryLabel(value = "") {
  const id = String(value || "").trim().toUpperCase();
  if (id === "OWNER") return "مالك مباشر";
  if (id === "CLIENT") return "عميل مباشر";
  if (id === "DELEGATE") return "مفوض عن الطرف";
  if (id === "BROKER") return "وسيط عقاري";
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

function formatCount(value) {
  return Number(value).toLocaleString("en-US");
}

export function buildOpportunitySpecsParts(record = {}) {
  const area = Number(record.area || 0);
  const primary = area > 0 ? `${formatCount(area)} م²` : "";
  const secondary = [];
  const streetWidth = Number(record.streetWidth || 0);
  if (streetWidth > 0) secondary.push(`شارع ${formatCount(streetWidth)} م`);
  const facing = safeText(record.facing || record.direction || "", 40);
  if (facing) secondary.push(`واجهة ${facing}`);
  const rooms = Number(record.rooms || 0);
  if (rooms > 0) secondary.push(`${formatCount(rooms)} غرف`);
  return { primary, secondary: secondary.join("، ") };
}

export function normalizeOpportunityDetailsRecord(record = {}) {
  return normalizeListingRecord(record);
}

function detailsMissingLabel(key = "", isOwner = true) {
  const id = String(key || "").trim();
  if (id === "priceOrBudget" || id === "salePrice" || id === "annualRent" || id === "budget") {
    return isOwner ? "السعر" : "الميزانية";
  }
  if (id === "contactPhone") return "رقم التواصل";
  return MISSING_FIELD_LABELS[id] || missingFieldLabelsArabic([id])[0] || id;
}

export function buildOpportunityDetailsProgress(readiness = {}, checks = [], options = {}) {
  const total = checks.length || 7;
  const completeCount = checks.filter((row) => row.complete).length;
  const pct = total ? Math.round((completeCount / total) * 100) : 0;
  const isOwner = options.isOwner !== false;
  const missingLabels = (readiness.matchingReadinessMissing || [])
    .map((key) => detailsMissingLabel(key, isOwner))
    .filter(Boolean);
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
  const isOwner = isOwnerRecord(normalized);
  const progress = buildOpportunityDetailsProgress(readiness, checks, { isOwner });
  const byKey = Object.fromEntries(checks.map((row) => [row.key, row]));
  const { cityText, districtText } = normalizeCityDistrict(normalized);
  const specs = buildOpportunitySpecsLine(normalized);
  const specsParts = buildOpportunitySpecsParts(normalized);
  const phone = normalized.contactPhone || normalized.phone || normalized.advertiserPhoneNormalized || "";
  const roleRaw = normalized.advertiserRole || normalized.ownerRole || "";
  const locationPrimary = [cityText, districtText ? `حي ${districtText}` : ""]
    .filter(Boolean)
    .join(" - ");

  return {
    id: String(id || normalized.id || ""),
    displayId: formatDisplayOpportunityId(id || normalized.id || ""),
    rawRecord: normalized,
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
    locationPrimary,
    locationSecondary: districtText ? `الحي: ${districtText}` : "",
    specs,
    specsPrimary: specsParts.primary,
    specsSecondary: specsParts.secondary,
    advertiserRole: advertiserRoleLabel(roleRaw),
    advertiserSecondary: advertiserSecondaryLabel(roleRaw),
    contactPhone: phone,
    contactDisplay: formatLocalPhoneDisplay(phone) || phone,
    propertyPurposeLine: card.title
  };
}

export function buildOpportunityDetailsAppBarHtml() {
  return `
    <header class="opp-details-appbar">
      <button type="button" class="opp-details-menu" id="oppDetailsMenuBtn" aria-label="المزيد" disabled>
        ${iconUse("i-dots")}
      </button>
      <h1 class="opp-details-appbar-title">تفاصيل الفرصة</h1>
      <button type="button" class="opp-details-back" id="bankDetailClose" aria-label="رجوع">
        ${iconUse("i-chevron-right")}
      </button>
    </header>`;
}

export function buildOpportunityDetailsHeaderHtml(vm) {
  return `
    <section class="opp-details-card opp-details-identity-card">
      <div class="opp-details-header">
        <div class="opp-details-header-top">
          <div class="opp-details-header-main">
            <span class="opp-details-avatar" aria-hidden="true">${iconUse("i-user")}</span>
            <div class="opp-details-header-copy">
              <p class="opp-details-kind">${esc(vm.kindLabel)}</p>
              <p class="opp-details-id">#${esc(vm.displayId)}</p>
            </div>
          </div>
          <span class="opp-details-status ${esc(vm.status.cssClass)}">${esc(vm.status.label)}</span>
        </div>
        ${vm.addedAtLabel ? `
          <p class="opp-details-added-at">
            <span class="opp-details-added-icon" aria-hidden="true">${iconUse("i-calendar")}</span>
            <span>تاريخ الإضافة: ${esc(vm.addedAtLabel)}</span>
          </p>` : ""}
      </div>
    </section>`;
}

export function buildCompletionProgressHtml(vm) {
  const { progress, status } = vm;
  return `
    <section class="opp-details-card opp-details-completion-card" aria-label="نسبة اكتمال البيانات">
      <header class="opp-details-card-head">
        ${iconUse("i-chart")}
        <h5>نسبة اكتمال البيانات</h5>
      </header>
      <div class="opp-details-progress">
        <div class="opp-details-progress-copy">
          <p class="opp-details-progress-hint">${status.cssClass === "is-ready"
    ? "الفرصة جاهزة للمطابقة."
    : "استكمل البيانات الناقصة ليتم تحويل الفرصة إلى جاهزة للمطابقة."}</p>
          ${buildMissingFieldsAlertHtml(vm)}
        </div>
        <div class="opp-details-progress-meter">
          <div class="opp-details-progress-ring" style="--opp-progress:${progress.pct}" aria-hidden="true">
            <span class="opp-details-progress-count">${esc(String(progress.completeCount))} من ${esc(String(progress.total))}</span>
          </div>
          <p class="opp-details-progress-pct">${esc(`${progress.pct}% مكتملة`)}</p>
        </div>
      </div>
    </section>`;
}

export function buildMissingFieldsAlertHtml(vm) {
  if (!vm.progress.missingLabels.length) return "";
  const chips = vm.progress.missingLabels.map((label) => `
    <span class="opp-details-missing-chip">${esc(label)}</span>`).join("");
  return `
    <div class="opp-details-missing-alert" aria-label="البيانات الناقصة">
      <p class="opp-details-missing-title">البيانات الناقصة</p>
      <div class="opp-details-missing-list">${chips}</div>
    </div>`;
}

function missingValueHtml() {
  return `
    <span class="opp-details-row-primary is-empty">ناقص</span>
    <span class="opp-details-row-secondary is-empty">غير محدد</span>`;
}

function valueStackHtml(primary, secondary, complete) {
  if (!complete) return missingValueHtml();
  const main = String(primary ?? "").trim();
  const sub = String(secondary ?? "").trim();
  return `
    <span class="opp-details-row-primary">${esc(main || "—")}</span>
    ${sub ? `<span class="opp-details-row-secondary">${esc(sub)}</span>` : ""}`;
}

function dataRow(vm, rowKey, iconId, label, primary, secondary = "") {
  const complete = isDetailsRowComplete(vm, rowKey);
  return `
    <div class="opp-details-row ${complete ? "is-row-complete" : "is-row-missing"}">
      <span class="opp-details-row-key">
        <span class="opp-details-row-icon" aria-hidden="true">${iconUse(iconId)}</span>
        <span class="opp-details-row-label">${esc(label)}</span>
      </span>
      <span class="opp-details-row-value">${valueStackHtml(primary, secondary, complete)}</span>
    </div>`;
}

function locationRow(vm) {
  return dataRow(
    vm,
    "location",
    "i-map-pin",
    "الموقع",
    vm.locationPrimary,
    vm.locationSecondary
  );
}

export function buildOpportunityDetailsRevealFormButtonHtml() {
  return `
    <div class="opp-details-actions">
      <button type="button" class="opp-details-complete-btn" id="oppDetailsRevealFormBtn">
        ${iconUse("i-pencil")}
        <span>أكمل البيانات الناقصة</span>
      </button>
    </div>`;
}

export function buildOpportunityDataTableHtml(vm, options = {}) {
  const showCompleteButton = options.showCompleteButton !== false
    && (vm.progress.missingLabels || []).length > 0;
  return `
    <section class="opp-details-card opp-details-data-table" aria-label="بيانات الفرصة">
      <header class="opp-details-card-head">
        ${iconUse("i-clipboard-list")}
        <h5 class="opp-details-data-title">بيانات الفرصة</h5>
      </header>
      <div class="opp-details-data-rows">
        ${dataRow(vm, "propertyPurpose", "i-house", "العقار والغرض", vm.propertyPurposeLine)}
        ${locationRow(vm)}
        ${dataRow(vm, "price", "i-money", vm.priceLabel, vm.priceValue)}
        ${dataRow(vm, "specs", "i-ruler", "المساحة والمواصفات", vm.specsPrimary || vm.specs, vm.specsSecondary)}
        ${dataRow(vm, "advertiser", "i-user", "المعلن وصفته", vm.advertiserRole, vm.advertiserSecondary)}
        ${dataRow(vm, "contact", "i-phone", "رقم التواصل", vm.contactDisplay)}
      </div>
      ${showCompleteButton ? buildOpportunityDetailsRevealFormButtonHtml() : ""}
    </section>`;
}

function classifyReportEntry(item = {}) {
  const text = String(item.text || "").trim();
  if (/واتساب|تواصل/.test(text)) {
    return { title: "متابعة المالك", result: text };
  }
  if (/موعد|معاينة/.test(text)) {
    return {
      title: "تحديد موعد",
      result: text.replace(/^تم تحديد موعد متابعة:\s*/u, "") || text
    };
  }
  if (/تعاون|إرسال|مكتب/.test(text)) {
    return { title: "إرسال الفرصة", result: text };
  }
  if (/نواقص|إضافة|استيراد|مراجعة/.test(text)) {
    return { title: "مراجعة البيانات", result: text };
  }
  return { title: "نشاط", result: text };
}

export function buildTodayReportEntries(record = {}, extras = {}) {
  if (Array.isArray(extras.entries) && extras.entries.length) {
    return extras.entries;
  }
  const activity = Array.isArray(extras.activity) && extras.activity.length
    ? extras.activity
    : buildWorkspaceActivity(record, extras.cooperationRequests || []);
  return activity.map((item) => {
    const classified = classifyReportEntry(item);
    return {
      at: item.at,
      time: item.time || formatClockLabel(item.at),
      title: item.title || classified.title,
      result: item.result || classified.result
    };
  }).filter((row) => row.time && row.result);
}

export function buildTodayReportResultLine(vm) {
  const missing = vm.progress.missingLabels || [];
  if (missing.length) {
    return `النتيجة الحالية: بانتظار استكمال ${missing.join(" و")}`;
  }
  if (vm.status.cssClass === "is-ready") return "النتيجة الحالية: جاهزة للمطابقة";
  if (vm.status.cssClass === "is-matched") return "النتيجة الحالية: تمت المطابقة";
  if (vm.status.cssClass === "is-ended") return "النتيجة الحالية: منتهية";
  return "النتيجة الحالية: بانتظار المتابعة";
}

export function buildTodayReportHtml(vm, extras = {}) {
  const entries = buildTodayReportEntries(vm.rawRecord || {}, extras);
  if (!entries.length) return "";
  const rows = entries.map((row) => `
    <li class="opp-details-log-row">
      <time class="opp-details-log-time">${esc(row.time)}</time>
      <span class="opp-details-log-title">${esc(row.title)}</span>
      <span class="opp-details-log-result">
        <span class="opp-details-log-check" aria-hidden="true">${iconUse("i-check-circle")}</span>
        <span>${esc(row.result)}</span>
      </span>
    </li>`).join("");
  return `
    <section class="opp-details-card opp-details-report-card" aria-label="تقرير اليوم">
      <header class="opp-details-card-head">
        ${iconUse("i-list")}
        <h5>تقرير اليوم</h5>
      </header>
      <ul class="opp-details-log">${rows}</ul>
      <p class="opp-details-result-banner">
        <span class="opp-details-info-icon" aria-hidden="true">${iconUse("i-info")}</span>
        <span>${esc(buildTodayReportResultLine(vm))}</span>
      </p>
    </section>`;
}

export function buildNextAppointmentView(record = {}, followUpInput) {
  const followUp = followUpInput === undefined
    ? activeFollowUpFromRecord(record)
    : followUpInput;
  if (!followUp?.at) return null;
  const whenLabel = formatFollowUpAppointmentLine(followUp.at)
    || formatClockLabel(followUp.at);
  const purpose = String(followUp.purpose || followUp.title || followUp.kind || "متابعة").trim();
  const party = isOwnerRecord(record) ? "المالك" : "العميل";
  const confirmed = String(followUp.confirmationOutcome || "").toLowerCase() === "confirmed";
  return {
    whenLabel: whenLabel.replace("غدًا", "غداً"),
    purpose: purpose === "inspection" || purpose === "viewing" ? "معاينة العقار" : purpose,
    partyLine: `${party}: ${confirmed ? "تم التأكيد" : "بانتظار التأكيد"}`
  };
}

export function buildNextAppointmentHtml(record = {}, followUp, override) {
  const view = override || buildNextAppointmentView(record, followUp);
  if (!view) return "";
  return `
    <section class="opp-details-card opp-details-appointment-card" aria-label="الموعد القادم">
      <header class="opp-details-card-head">
        ${iconUse("i-calendar")}
        <h5>الموعد القادم</h5>
      </header>
      <div class="opp-details-appointment">
        <p class="opp-details-appointment-when">${esc(view.whenLabel)}</p>
        <div class="opp-details-appointment-copy">
          <strong>${esc(view.purpose)}</strong>
          <span>${esc(view.partyLine)}</span>
        </div>
      </div>
    </section>`;
}

function detailsCardsHtml(vm, extras = {}) {
  const showCompleteButton = extras.showCompleteButton;
  return `
    ${buildOpportunityDetailsHeaderHtml(vm)}
    ${buildCompletionProgressHtml(vm)}
    ${buildOpportunityDataTableHtml(vm, { showCompleteButton })}
    ${buildTodayReportHtml(vm, extras)}
    ${buildNextAppointmentHtml(vm.rawRecord || {}, extras.followUp, extras.nextAppointment)}`;
}

export function buildOpportunityDetailsCoreHtml(id, record = {}, readiness = {}, extras = {}) {
  const vm = buildOpportunityDetailsViewModel(id, record, readiness);
  return {
    vm,
    html: `
      <div class="opp-details" data-record-kind="${esc(vm.recordKind)}">
        ${detailsCardsHtml(vm, extras)}
      </div>`
  };
}

export function buildOpportunityDetailsPageHtml(id, record = {}, readiness = {}, extras = {}) {
  const built = buildOpportunityDetailsCoreHtml(id, record, readiness, extras);
  return {
    vm: built.vm,
    html: `
      <div class="opp-details-page" data-record-kind="${esc(built.vm.recordKind)}">
        ${buildOpportunityDetailsAppBarHtml()}
        <div class="opp-details-body">
          ${built.html}
          ${extras.footerHtml || ""}
        </div>
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

export function missingFieldLabelForKey(key = "") {
  return MISSING_FIELD_LABELS[key] || key;
}
