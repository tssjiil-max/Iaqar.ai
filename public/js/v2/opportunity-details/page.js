import { escapeContentHtml } from "../domain.js";
import { buildCompleteMissingButtonV2, buildOpportunityDataCardV2 } from "./data-card.js";
import { buildDailyReportCardV2 } from "./daily-report.js";
import { buildNextAppointmentCardV2 } from "./next-appointment.js";

export function buildOpportunityDetailsContentV2(vm = {}) {
  return `<div class="cv2-details" dir="rtl" data-opportunity-id="${escapeContentHtml(vm.id || "")}">
    ${buildOpportunityDataCardV2(vm)}
    ${buildCompleteMissingButtonV2(vm)}
    ${buildDailyReportCardV2(vm)}
    ${buildNextAppointmentCardV2(vm)}
  </div>`;
}
