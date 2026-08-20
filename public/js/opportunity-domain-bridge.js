/**
 * Bridge opportunity domain modules for non-module scripts (workflow-office.js).
 */
import * as status from "./opportunity-status-domain.js";
import * as card from "./opportunity-card-domain.js";
import * as followup from "./opportunity-followup-domain.js";
import { evaluateMatchingReadiness } from "./opportunity-readiness-domain.js";
import { buildOpportunityDetailsCoreHtml } from "./opportunity-details-ui.js";
import * as brokerProgress from "./broker-action-progress-domain.js";
import {
  applyBrokerActionMarks,
  markBrokerActionDoneLocally,
  markFollowUpProgressLocally
} from "./broker-action-progress-ui.js";
import { bindPhoneContactSave } from "./phone-contact-save-ui.js";

window.IAQAR_OPPORTUNITY = Object.freeze({
  status,
  card,
  followup,
  evaluateMatchingReadiness,
  buildOpportunityDetailsCoreHtml
});

window.IAQAR = window.IAQAR || {};
window.IAQAR.brokerActionProgress = Object.freeze({
  ...brokerProgress,
  applyBrokerActionMarks,
  markBrokerActionDoneLocally,
  markFollowUpProgressLocally
});

bindPhoneContactSave(document);
