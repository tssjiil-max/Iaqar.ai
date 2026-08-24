/**
 * Compact inbox card markup for العروض والطلبات. Bank list only — not daily tasks.
 */

import { buildBankInboxCardView } from "./bank-inbox-card-domain.js";

function esc(text = "") {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

export function buildBankInboxCardHtml(record = {}, context = {}) {
  const card = buildBankInboxCardView(record, context);
  const statusClass = card.isNeedsCompletion
    ? " is-incomplete"
    : card.isMatchFound
      ? " is-match-found"
      : " is-matching";
  const missing = card.missingLine
    ? `<p class="bank-inbox-missing">${esc(card.missingLine)}</p>`
    : "";
  const source = card.sourceLabel
    ? `<p class="bank-inbox-source">${esc(card.sourceLabel)}</p>`
    : "";
  return `
    <article
      class="bank-row bank-row-card bank-inbox-card"
      data-opportunity-id="${esc(card.opportunityId)}"
      data-open-id="${esc(card.opportunityId)}"
      data-inbox-status="${esc(card.statusKey)}"
      aria-label="${esc(card.ariaLabel)}">
      <div class="bank-inbox-head">
        <h3 class="bank-inbox-kind">${esc(card.kindTitle)}</h3>
        <span class="bank-readiness-badge${statusClass}">${esc(card.statusLabel)}</span>
      </div>
      <div class="bank-inbox-body">
        ${card.propertyLocation ? `<p class="bank-inbox-property">${esc(card.propertyLocation)}</p>` : ""}
        ${card.moneyLine ? `<p class="bank-inbox-money">${esc(card.moneyLine)}</p>` : ""}
        ${missing}
        ${source}
      </div>
      <button type="button" class="bank-inbox-details" data-bank-open-details="${esc(card.opportunityId)}">
        عرض التفاصيل
      </button>
    </article>`;
}
