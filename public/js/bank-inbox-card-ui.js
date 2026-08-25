/**
 * العروض والطلبات list item — reuses the approved opportunity data card.
 * Daily-task details keep their own mount; this file only binds offer/request records.
 */

import { evaluateMatchingReadiness } from "./opportunity-readiness-domain.js";
import { mapOpportunityDetailsV2ViewModel } from "./opportunity-details-v2-domain.js";
import { completenessLine } from "./v2/opportunity-details/view-model.js";
import {
  buildCompleteMissingButtonV2,
  buildOpportunityDataCardV2
} from "./v2/opportunity-details/data-card.js";
import {
  BANK_INBOX_STATUS,
  bankInboxStatusKey,
  bankInboxStatusLabel
} from "./bank-inbox-card-domain.js";

function esc(text = "") {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function extraIdFor(opportunityId) {
  const safe = String(opportunityId || "x").replace(/[^A-Za-z0-9_-]/g, "");
  return `cv2DataExtra-${safe || "x"}`;
}

function inboxStatusLine(record, context, vm) {
  const key = bankInboxStatusKey(record, context);
  const label = bankInboxStatusLabel(key);
  if (key === BANK_INBOX_STATUS.NEEDS_COMPLETION) {
    const missing = completenessLine(vm);
    if (missing && missing !== label) return `${label} · ${missing}`;
  }
  return label;
}

export function buildBankInboxCardHtml(record = {}, context = {}) {
  const opportunityId = String(record.id || record.opportunityId || "").trim();
  const readiness = evaluateMatchingReadiness(record);
  const vm = mapOpportunityDetailsV2ViewModel(opportunityId, record, { readiness });
  const statusKey = bankInboxStatusKey(record, context);
  const statusLabel = bankInboxStatusLabel(statusKey);
  return `
    <article
      class="cv2-details"
      data-cv2-inbox-item
      data-testid="inbox-row"
      data-opportunity-id="${esc(opportunityId)}"
      data-inbox-status="${esc(statusKey)}"
      aria-label="${esc([vm.propertyPurpose || vm.type, statusLabel].filter(Boolean).join(" — "))}">
      ${buildOpportunityDataCardV2(vm, {
        dataCardExpanded: Boolean(context.dataCardExpanded),
        extraId: extraIdFor(opportunityId),
        statusLine: inboxStatusLine(record, context, vm)
      })}
      ${buildCompleteMissingButtonV2(vm)}
    </article>`;
}
