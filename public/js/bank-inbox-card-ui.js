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
import { formatDailyTaskClock } from "./v2/daily-tasks/domain.js";
import { archiveActionLabel } from "./opportunity-delete-plan-domain.js";

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

export function buildArchiveInboxRowHtml(record = {}, now = new Date()) {
  const opportunityId = String(record.id || record.opportunityId || "").trim();
  const vm = mapOpportunityDetailsV2ViewModel(opportunityId, record, {});
  const archivedAt = record.archivedAt || "";
  return `
    <article
      class="cv2-details archive-row"
      data-cv2-inbox-item
      data-archive-row
      data-testid="archive-row"
      data-opportunity-id="${esc(opportunityId)}"
      aria-label="${esc(["أرشيف", vm.referenceCode, vm.propertyPurpose].filter(Boolean).join(" — "))}">
      <div class="archive-row-main">
        <strong class="archive-row-ref">${esc(vm.referenceCode || "—")}</strong>
        <span>${esc(vm.propertyPurpose || record.propertyType || "—")}</span>
        <span>${esc(vm.district || record.district || "—")}</span>
        <span class="archive-row-date">أُرشِف ${esc(formatDailyTaskClock(archivedAt, now) || "—")}</span>
      </div>
      <div class="archive-row-actions">
        <button type="button" class="bank-action" data-archive-restore="${esc(opportunityId)}">استعادة</button>
        <button type="button" class="bank-action danger" data-archive-purge="${esc(opportunityId)}">حذف نهائي</button>
      </div>
    </article>`;
}

export function buildBankInboxCardHtml(record = {}, context = {}) {
  const opportunityId = String(record.id || record.opportunityId || "").trim();
  const readiness = evaluateMatchingReadiness(record);
  const vm = mapOpportunityDetailsV2ViewModel(opportunityId, record, { readiness });
  const statusKey = bankInboxStatusKey(record, context);
  const statusLabel = bankInboxStatusLabel(statusKey);
  const archived = Boolean(vm.archived);
  if (archived) return buildArchiveInboxRowHtml(record, context.now);
  const archiveLabel = archiveActionLabel(record);
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
      <div class="opp-archive-actions">
        <button type="button" class="opp-archive-link" data-inbox-archive="${esc(opportunityId)}">${esc(archiveLabel)}</button>
      </div>
    </article>`;
}
