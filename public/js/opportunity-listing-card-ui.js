/**
 * Shared opportunity listing card — same بيانات الفرصة table as every offer/request.
 */

import {
  buildListingFieldChecks,
  LISTING_FIELD_ORDER,
  normalizeListingRecord
} from "./opportunity-listing-normalize.js";
import {
  buildOpportunityDataTableHtml,
  buildOpportunityDetailsViewModel
} from "./opportunity-details-ui.js";

export {
  buildListingFieldChecks,
  LISTING_FIELD_ORDER,
  normalizeListingRecord
};

/**
 * Unified listing card body — identical data table for bank list and daily tasks.
 * @param {object} record
 * @param {object} [options]
 * @param {string} [options.footerHtml]
 * @param {string} [options.actionsHtml]
 * @param {boolean} [options.includeRevealButton=false]
 */
export function buildOpportunityListingCardInnerHtml(record = {}, options = {}) {
  const normalized = normalizeListingRecord(record);
  const vm = buildOpportunityDetailsViewModel(normalized.id, normalized);
  const tableHtml = buildOpportunityDataTableHtml(vm, {
    includeRevealButton: options.includeRevealButton === true
  });
  const extra = [options.footerHtml, options.actionsHtml].filter(Boolean).join("");
  const opportunityId = String(normalized.id || record.id || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
  const opportunityKind = String(normalized.opportunityKind || record.opportunityKind || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
  return `
    <div class="listing-card-inner listing-card-inner--unified" data-community-host data-opportunity-id="${opportunityId}" data-opportunity-kind="${opportunityKind}">
      ${tableHtml}
      <div class="js-broker-community-slot" data-community-slot="${opportunityId}" hidden></div>
      ${extra ? `<div class="listing-card-extra">${extra}</div>` : ""}
    </div>`;
}
