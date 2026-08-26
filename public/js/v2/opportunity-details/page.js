import { escapeContentHtml } from "../domain.js";
import { buildCompleteMissingButtonV2, buildOpportunityDataCardV2 } from "./data-card.js";
import { buildDailyReportCardV2 } from "./daily-report.js";
import { buildNextAppointmentCardV2 } from "./next-appointment.js";

function moreActionsHtml(vm = {}) {
  if (vm.archived) {
    return `<div class="opp-v2-more" data-cv2-more>
      <button type="button" class="opp-v2-more-item" data-cv2-restore data-testid="restore-opportunity">استعادة</button>
      <button type="button" class="opp-v2-more-item is-danger" data-cv2-purge data-testid="permanent-delete">حذف نهائي</button>
    </div>`;
  }
  return `<div class="opp-v2-more" data-cv2-more>
    <button type="button" class="opp-v2-more-item" data-cv2-archive data-testid="archive-opportunity">${escapeContentHtml(vm.archiveActionLabel || "نقل إلى الأرشيف")}</button>
  </div>`;
}

export function buildOpportunityDetailsContentV2(vm = {}, ui = {}) {
  return `<div class="cv2-details" dir="rtl" data-opportunity-id="${escapeContentHtml(vm.id || "")}">
    ${buildOpportunityDataCardV2(vm, ui)}
    ${buildCompleteMissingButtonV2(vm)}
    ${buildDailyReportCardV2(vm)}
    ${buildNextAppointmentCardV2(vm)}
    ${moreActionsHtml(vm)}
  </div>`;
}
