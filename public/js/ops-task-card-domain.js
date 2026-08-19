/**
 * Operations task card — ad-style listing body with per-field completion marks.
 */

import { buildBankListCardView } from "./bank-list-card-domain.js";
import {
  evaluateMatchingReadiness,
  MISSING_FIELD_LABELS
} from "./opportunity-readiness-domain.js";

export const OPS_TASK_FIELD_ORDER = Object.freeze([
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

export function opsTaskItemAsRecord(item = {}) {
  return {
    ...item,
    id: item.recordId || item.opportunityId || item.id || "",
    propertyType: item.propertyType || "",
    city: item.city || "",
    district: item.district || "",
    purpose: item.purpose || item.transactionType || "",
    contactPhone: item.contactPhone || item.phone || item.advertiserPhoneNormalized || "",
    advertiserRole: item.advertiserRole || item.ownerRole || "",
    salePrice: item.salePrice ?? item.price ?? item.amount,
    annualRent: item.annualRent,
    budget: item.budget ?? item.priceMax,
    priceOrBudget: item.priceOrBudget ?? item.amount ?? item.price
  };
}

export function buildOpsTaskFieldChecks(record = {}) {
  const readiness = evaluateMatchingReadiness(opsTaskItemAsRecord(record));
  const missing = new Set(readiness.matchingReadinessMissing || []);
  return OPS_TASK_FIELD_ORDER.map((key) => ({
    key,
    label: MISSING_FIELD_LABELS[key] || key,
    complete: !missing.has(key)
  }));
}

export function buildOpsTaskAdSummary(record = {}) {
  const card = buildBankListCardView(opsTaskItemAsRecord(record));
  const specs = [card.priceText, card.areaText, card.roomsText ? `${card.roomsText} غرف` : ""]
    .filter(Boolean)
    .join(" · ");
  return {
    headline: card.title,
    location: card.location,
    specs,
    kindBadge: card.kindBadge,
    isReadyForMatching: card.isReadyForMatching
  };
}

export function isOpsOpportunityTaskItem(item = {}) {
  const type = String(item.recordType || "").toLowerCase();
  return type === "opportunity" || type === "intake";
}

/**
 * @returns {string} safe HTML for task card body (ad listing + field checks)
 */
export function buildOpsTaskListingBodyHtml(item = {}) {
  if (!isOpsOpportunityTaskItem(item)) return "";
  const ad = buildOpsTaskAdSummary(item);
  const checks = buildOpsTaskFieldChecks(item);
  const completeCount = checks.filter((row) => row.complete).length;
  const checkRows = checks.map((row) => `
    <div class="ops-task-field-check ${row.complete ? "is-complete" : "is-missing"}">
      <span class="ops-task-field-mark" aria-hidden="true">${row.complete ? "✓" : "✗"}</span>
      <span class="ops-task-field-label">${esc(row.label)}</span>
    </div>`).join("");

  return `
    <div class="ops-task-ad" dir="rtl">
      ${ad.headline ? `<p class="ops-task-ad-headline">${esc(ad.headline)}</p>` : ""}
      ${ad.location ? `<p class="ops-task-ad-location">${esc(ad.location)}</p>` : ""}
      ${ad.specs ? `<p class="ops-task-ad-specs">${esc(ad.specs)}</p>` : ""}
    </div>
    <div class="ops-task-field-checks" aria-label="اكتمال بيانات الفرصة">
      ${checkRows}
    </div>
    <p class="ops-task-field-summary">${esc(`${completeCount} من ${checks.length} حقول مكتملة`)}</p>`;
}
