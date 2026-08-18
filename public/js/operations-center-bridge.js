/**
 * Exposes daily-tasks category domain for the shell inline script and tests.
 */
import * as operationsCenterDomain from "./operations-center-domain.js";
import * as dailyTasksDomain from "./daily-tasks-domain.js";
import * as brokerMatchUxDomain from "./broker-match-ux-domain.js";
import * as brokerAlertsDomain from "./broker-alerts-domain.js";

window.IAQAR = window.IAQAR || {};
window.IAQAR.operationsCenterDomain = operationsCenterDomain;
window.IAQAR.dailyTasksDomain = dailyTasksDomain;
window.IAQAR.brokerMatchUxDomain = brokerMatchUxDomain;
window.IAQAR.brokerAlertsDomain = brokerAlertsDomain;
window.dispatchEvent(new CustomEvent("iaqar:operations-center-domain-ready"));
