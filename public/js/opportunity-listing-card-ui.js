/**
 * Shared opportunity listing card markup — same layout for bank list and daily tasks.
 */

import { buildBankListCardView } from "./bank-list-card-domain.js";
import {
  evaluateMatchingReadiness,
  MISSING_FIELD_LABELS
} from "./opportunity-readiness-domain.js";

export const LISTING_FIELD_ORDER = Object.freeze([
  "purpose",
  "propertyType",
  "city",
  "district",
  "priceOrBudget",
  "advertiserRole",
  "contactPhone"
]);

function esc(text = "") {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

export function normalizeListingRecord(record = {}) {
  return {
    ...record,
    id: record.id || record.recordId || record.opportunityId || "",
    propertyType: record.propertyType || "",
    city: record.city || "",
    district: record.district || "",
    purpose: record.purpose || record.transactionType || "",
    contactPhone: record.contactPhone || record.phone || record.advertiserPhoneNormalized || "",
    advertiserRole: record.advertiserRole || record.ownerRole || "",
    salePrice: record.salePrice ?? record.price ?? record.amount,
    annualRent: record.annualRent,
    budget: record.budget ?? record.priceMax,
    priceOrBudget: record.priceOrBudget ?? record.amount ?? record.price
  };
}

function isOwnerRecord(record = {}) {
  const kind = String(record.opportunityKind || record.kind || record.recordType || "").toUpperCase();
  return record.contactType === "owner"
    || kind === "OWNER"
    || kind === "OWNER_OFFER"
    || kind === "OFFER";
}

export function buildListingFieldChecks(record = {}) {
  const readiness = evaluateMatchingReadiness(normalizeListingRecord(record));
  const missing = new Set(readiness.matchingReadinessMissing || []);
  return LISTING_FIELD_ORDER.map((key) => ({
    key,
    label: MISSING_FIELD_LABELS[key] || key,
    complete: !missing.has(key)
  }));
}

function statCell(label, value) {
  if (!value) return "";
  return `
    <div class="bank-stat">
      <span class="bank-stat-label">${esc(label)}</span>
      <strong class="bank-stat-value">${esc(value)}</strong>
    </div>`;
}

function fieldMarksHtml(checks = []) {
  if (!checks.length) return "";
  const completeCount = checks.filter((row) => row.complete).length;
  const chips = checks.map((row) => `
    <span class="listing-field-mark ${row.complete ? "is-complete" : "is-missing"}">
      <span class="listing-field-mark-icon" aria-hidden="true">${row.complete ? "✓" : "✗"}</span>
      <span class="listing-field-mark-label">${esc(row.label)}</span>
    </span>`).join("");

  return `
    <div class="listing-field-marks" aria-label="اكتمال بيانات الفرصة">${chips}</div>
    <p class="listing-field-summary">${esc(`${completeCount} من ${checks.length} حقول مكتملة`)}</p>`;
}

/**
 * Bank-style listing card body — header, location, stats grid, readiness, field marks.
 * @param {object} record
 * @param {object} [options]
 * @param {string} [options.footerHtml] — extra lines (contact, follow-up, match, source)
 * @param {boolean} [options.showFieldMarks=true]
 */
export function buildOpportunityListingCardInnerHtml(record = {}, options = {}) {
  const normalized = normalizeListingRecord(record);
  const card = buildBankListCardView(normalized);
  const checks = buildListingFieldChecks(normalized);
  const stats = [
    statCell(isOwnerRecord(normalized) ? "السعر" : "الميزانية", card.priceText),
    statCell("المساحة", card.areaText),
    statCell("الغرف", card.roomsText)
  ].filter(Boolean).join("");
  const statsRow = stats ? `<div class="bank-row-stats">${stats}</div>` : "";
  const readinessClass = card.isReadyForMatching ? " is-ready" : " is-incomplete";
  const statusClass = card.isReadyForMatching ? " is-ready" : " is-incomplete";
  const showFieldMarks = options.showFieldMarks !== false;
  const footerHtml = options.footerHtml || "";

  return `
    <div class="listing-card-inner">
      <div class="bank-row-header">
        <span class="bank-kind-badge">${esc(card.kindBadge)}</span>
        <h3 class="bank-row-title">${esc(card.title)}</h3>
        <span class="bank-readiness-badge${statusClass}">${esc(card.headerStatus)}</span>
      </div>
      <div class="bank-row-body">
        ${card.location ? `<p class="bank-row-location">${esc(card.location)}</p>` : ""}
        ${statsRow}
        <p class="bank-row-readiness${readinessClass}">${esc(card.readinessLine)}</p>
        ${showFieldMarks ? fieldMarksHtml(checks) : ""}
        ${footerHtml}
      </div>
    </div>`;
}
