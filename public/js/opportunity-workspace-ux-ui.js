/**
 * Opportunity workspace UX — presentation only (reads existing domain data).
 */

import {
  buildBestNextAction,
  sortMatchesForWorkspace,
  activeWorkspaceCooperationRequests,
  buildWorkspaceActivity
} from "./opportunity-workspace-domain.js";
import { formatFollowUpAppointmentLine } from "./opportunity-followup-domain.js";
import { missingDisplayLabels } from "./opportunity-details-report-ui.js";
import { buildOpportunityDetailsViewModel } from "./opportunity-details-ui.js";

function esc(text = "") {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

export function buildWorkspaceSummaryStripHtml(id, record = {}, readiness = {}) {
  const vm = buildOpportunityDetailsViewModel(id, record, readiness);
  const location = [vm.locationCity, vm.locationDistrict ? `حي ${vm.locationDistrict}` : ""]
    .filter(Boolean)
    .join(" — ");
  const completion = vm.progress?.total
    ? `مكتمل ${vm.progress.completeCount} من ${vm.progress.total}`
    : "";
  const pills = [
    vm.kindLabel,
    vm.propertyType || vm.propertyPurposeLine,
    location,
    vm.priceValue,
    vm.status?.label,
    completion
  ].filter(Boolean);

  const missingKeys = readiness.matchingReadinessMissing || vm.readiness?.matchingReadinessMissing || [];
  const missingLabels = missingDisplayLabels(record, vm.readiness || readiness);
  const missingHtml = missingLabels.length
    ? `<div class="bank-workspace-ux-missing" aria-label="الحقول الناقصة">
        <span class="bank-workspace-ux-missing-label">${missingLabels.length === 1 ? "ينقص:" : `ينقص ${missingLabels.length}:`}</span>
        ${missingLabels.map((label, index) => {
      const key = missingKeys[index] || "";
      const attr = key ? ` data-missing-field="${esc(key)}"` : "";
      return `<button type="button" class="bank-workspace-ux-missing-chip"${attr}>${esc(label)}</button>`;
    }).join("")}
      </div>`
    : "";

  return `
    <section class="bank-workspace-ux-summary" id="bankWorkspaceUxSummary" aria-label="ملخص الفرصة">
      <div class="bank-workspace-ux-summary-grid">
        ${pills.map((pill) => `<span class="bank-workspace-ux-pill">${esc(pill)}</span>`).join("")}
      </div>
      ${missingHtml}
    </section>`;
}

export function buildWorkspaceNextStepHtml(nextAction = {}) {
  const label = String(nextAction.label || "").trim();
  if (!label) return "";
  return `
    <section class="bank-workspace-ux-next" id="bankWorkspaceUxNext">
      <p class="bank-workspace-ux-next-label">الخطوة التالية</p>
      <button type="button" class="bank-action-primary iaqar-workflow-btn success bank-workspace-ux-next-btn"
        id="bankWorkspaceNextActionBtn" data-next-action="${esc(nextAction.action || "")}">
        ${esc(label)}
      </button>
    </section>`;
}

export function resolveWorkspaceNextAction(record = {}, bundle = {}) {
  return buildBestNextAction({
    record,
    matches: bundle.matches || [],
    suggestions: bundle.suggestions || [],
    followUp: bundle.followUp || null
  });
}

export function buildWorkspaceSectionPreviews(id, record = {}, bundle = {}) {
  const matches = sortMatchesForWorkspace(bundle.matches || [], id);
  const coopRows = activeWorkspaceCooperationRequests(bundle.cooperationRequests || []);
  const followUp = bundle.followUp || null;
  const activity = buildWorkspaceActivity(record, bundle.cooperationRequests || []);

  let matchesPreview = "لا توجد مطابقات";
  if (matches.length) {
    matchesPreview = `${matches.length} نتائج — أعلى تطابق ${matches[0].score}%`;
  }

  let coopPreview = "لا توجد مشاركات";
  if (coopRows.length === 1) coopPreview = "مشاركة مع مكتب واحد";
  else if (coopRows.length > 1) coopPreview = `مشاركة مع ${coopRows.length} مكاتب`;

  let followPreview = "لا يوجد موعد";
  if (followUp?.at) {
    const line = formatFollowUpAppointmentLine(followUp.at);
    followPreview = line ? `المتابعة القادمة: ${line}` : "موعد متابعة محدد";
  }

  let activityPreview = "لا نشاط بعد";
  if (activity.length) {
    const stamp = new Date(activity[0].at).toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh" });
    const today = new Date().toLocaleDateString("ar-SA", { timeZone: "Asia/Riyadh" });
    activityPreview = stamp === today ? "آخر نشاط: اليوم" : `آخر نشاط: ${stamp}`;
  }

  return {
    matches: matchesPreview,
    coop: coopPreview,
    followUp: followPreview,
    activity: activityPreview,
    close: "إنهاء وأرشفة عند الجاهزية"
  };
}

export function wrapWorkspaceCollapsibleSection({
  id = "",
  title = "",
  preview = "",
  body = "",
  hidden = false,
  collapsed = true,
  extraClass = ""
} = {}) {
  const hiddenAttr = hidden ? " hidden" : "";
  const stateClass = collapsed ? " is-collapsed" : " is-open";
  return `
    <section class="bank-workspace-section iaqar-workflow-step bank-workspace-collapsible${stateClass}${extraClass ? ` ${extraClass}` : ""}" id="${esc(id)}"${hiddenAttr}>
      <button type="button" class="bank-workspace-collapsible-toggle" aria-expanded="${collapsed ? "false" : "true"}">
        <span class="bank-workspace-collapsible-head">
          <strong class="bank-workspace-collapsible-title">${esc(title)}</strong>
          <span class="bank-workspace-collapsible-preview">${esc(preview)}</span>
        </span>
        <span class="bank-workspace-collapsible-chevron" aria-hidden="true">▾</span>
      </button>
      <div class="bank-workspace-collapsible-body">
        ${body}
      </div>
    </section>`;
}

export function buildWorkspaceSecondaryActionsHtml(actions = []) {
  if (!actions.length) return "";
  return `
    <details class="bank-workspace-ux-more-actions">
      <summary class="bank-workspace-ux-more-summary">المزيد</summary>
      <div class="bank-workspace-actions iaqar-workflow-actions bank-workspace-ux-secondary-actions">
        ${actions.map((action) => {
    const key = {
      send_and_share: "workspace:send_and_share",
      contact_party: "workspace:contact_party",
      manage_opportunity: "workspace:manage_opportunity"
    }[action.id] || "";
    const brokerAttr = key ? ` data-broker-action="${esc(key)}"` : "";
    return `<button type="button" class="bank-workspace-action iaqar-workflow-btn secondary" data-workspace-action="${esc(action.id)}"${brokerAttr}>${esc(action.label)}</button>`;
  }).join("")}
      </div>
    </details>`;
}
