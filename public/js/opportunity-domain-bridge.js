/**
 * Bridge opportunity domain modules for non-module scripts (workflow-office.js).
 */
import * as status from "./opportunity-status-domain.js";
import * as card from "./opportunity-card-domain.js";
import * as followup from "./opportunity-followup-domain.js";
import { evaluateMatchingReadiness } from "./opportunity-readiness-domain.js";

window.IAQAR_OPPORTUNITY = Object.freeze({
  status,
  card,
  followup,
  evaluateMatchingReadiness
});
