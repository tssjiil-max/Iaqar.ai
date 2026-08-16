/**
 * Exposes daily-tasks category domain for the shell inline script and tests.
 */
import * as operationsCenterDomain from "./operations-center-domain.js";

window.IAQAR = window.IAQAR || {};
window.IAQAR.operationsCenterDomain = operationsCenterDomain;
window.dispatchEvent(new CustomEvent("iaqar:operations-center-domain-ready"));
