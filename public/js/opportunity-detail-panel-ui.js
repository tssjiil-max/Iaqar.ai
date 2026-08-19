/**
 * Opportunity detail panel — structured ad-style summary + completion progress.
 */

import { buildBankListCardView } from "./bank-list-card-domain.js";
import {
  buildListingFieldChecks,
  normalizeListingRecord
} from "./opportunity-listing-card-ui.js";
import { missingFieldLabelsArabic } from "./opportunity-readiness-domain.js";

function esc(text = "") {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function displayValue(value = "") {
  const text = String(value ?? "").trim();
  return text || "غير محدد";
}

function detailRow(label, value, complete, extraClass = "") {
  const missing = complete === false;
  return `
    <div class="opp-detail-row ${missing ? "is-missing" : "is-complete"} ${extraClass}">
      <span class="opp-detail-row-label">${esc(label)}</span>
      <span class="opp-detail-row-value">
        ${missing ? `<span class="opp-detail-missing-tag">ناقص</span>` : `<span class="opp-detail-ok-mark" aria-hidden="true">✓</span>`}
        <span class="${missing ? "is-empty" : ""}">${esc(displayValue(value))}</span>
      </span>
    </div>`;
}

export function buildOpportunityDetailProgress(readiness = {}, checks = []) {
  const total = checks.length || 7;
  const completeCount = checks.filter((row) => row.complete).length;
  const pct = total ? Math.round((completeCount / total) * 100) : 0;
  const missingLabels = missingFieldLabelsArabic(readiness.matchingReadinessMissing || []);
  return { total, completeCount, pct, missingLabels };
}

export function buildOpportunityDetailSummaryHtml(id, record = {}, readiness = {}) {
  const normalized = normalizeListingRecord(record);
  const card = buildBankListCardView(normalized);
  const checks = buildListingFieldChecks(normalized);
  const progress = buildOpportunityDetailProgress(readiness, checks);
  const byKey = Object.fromEntries(checks.map((row) => [row.key, row]));
  const specs = [record.area ? `${Number(record.area).toLocaleString("ar-SA")} م²` : card.areaText,
    record.rooms ? `${record.rooms} غرف` : (card.roomsText ? `${card.roomsText} غرف` : "")]
    .filter(Boolean)
    .join(" · ");

  const missingTags = progress.missingLabels.map((label) => `
    <span class="opp-detail-missing-chip">✗ ${esc(label)}</span>`).join("");

  return `
    <section class="opp-detail-summary" aria-label="ملخص الفرصة">
      <div class="opp-detail-top">
        <div class="opp-detail-identity">
          <span class="opp-detail-kind">${esc(card.kindBadge)}</span>
          <h4 class="opp-detail-title">${esc(card.title)}</h4>
          <span class="opp-detail-id">#${esc(String(id || normalized.id || "").slice(-8))}</span>
        </div>
        <span class="opp-detail-status-badge ${card.isReadyForMatching ? "is-ready" : "is-incomplete"}">
          ${card.isReadyForMatching ? "جاهزة للمطابقة" : "ناقصة"}
        </span>
      </div>
      <div class="opp-detail-progress-block">
        <div class="opp-detail-progress-ring" style="--opp-progress:${progress.pct}" aria-hidden="true">
          <span class="opp-detail-progress-count">${esc(`${progress.completeCount} من ${progress.total}`)}</span>
        </div>
        <div class="opp-detail-progress-copy">
          <strong>نسبة اكتمال البيانات</strong>
          <p>${progress.pct}% مكتملة — ${card.isReadyForMatching
    ? "الفرصة جاهزة للمطابقة."
    : "أكمل البيانات الناقصة لنقل الفرصة إلى «جاهزة للمطابقة»."}</p>
          ${missingTags ? `<div class="opp-detail-missing-list"><span>الناقص:</span>${missingTags}</div>` : ""}
        </div>
      </div>
      <div class="opp-detail-listing-card">
        <div class="bank-row-header">
          <span class="bank-kind-badge">${esc(card.kindBadge)}</span>
          <h3 class="bank-row-title">${esc(card.title)}</h3>
          <span class="bank-readiness-badge ${card.isReadyForMatching ? "is-ready" : "is-incomplete"}">${esc(card.headerStatus)}</span>
        </div>
        <div class="bank-row-body">
          ${card.location ? `<p class="bank-row-location">${esc(card.location)}</p>` : ""}
          ${card.priceText || card.areaText || card.roomsText ? `
          <div class="bank-row-stats">
            ${card.priceText ? `<div class="bank-stat"><span class="bank-stat-label">${esc(card.kindBadge === "عرض مالك" ? "السعر" : "الميزانية")}</span><strong class="bank-stat-value">${esc(card.priceText)}</strong></div>` : ""}
            ${card.areaText ? `<div class="bank-stat"><span class="bank-stat-label">المساحة</span><strong class="bank-stat-value">${esc(card.areaText)}</strong></div>` : ""}
            ${card.roomsText ? `<div class="bank-stat"><span class="bank-stat-label">الغرف</span><strong class="bank-stat-value">${esc(card.roomsText)}</strong></div>` : ""}
          </div>` : ""}
        </div>
      </div>
      <div class="opp-detail-data-table" aria-label="بيانات الفرصة">
        <h5>بيانات الفرصة</h5>
        ${detailRow("العقار والغرض", card.title, byKey.purpose?.complete !== false && byKey.propertyType?.complete !== false)}
        ${detailRow("الموقع", card.location, byKey.city?.complete !== false && byKey.district?.complete !== false)}
        ${detailRow(card.kindBadge === "عرض مالك" ? "السعر" : "الميزانية", card.priceText, byKey.priceOrBudget?.complete)}
        ${detailRow("المساحة والمواصفات", specs, true)}
        ${detailRow("صفة المعلن", record.advertiserRole || record.ownerRole || "", byKey.advertiserRole?.complete)}
        ${detailRow("رقم التواصل", record.contactPhone || record.phone || record.advertiserPhoneNormalized || "", byKey.contactPhone?.complete)}
      </div>
    </section>`;
}
