/**
 * Bridge opportunity domain modules for non-module scripts (workflow-office.js).
 */
import * as status from "./opportunity-status-domain.js";
import * as card from "./opportunity-card-domain.js";

window.IAQAR_OPPORTUNITY = Object.freeze({
  status,
  card
});
