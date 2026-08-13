/**
 * Exposes the Phase 5 operations domain on window.IAQAR for classic scripts
 * such as workflow-office.js.
 */
import * as operationsDomain from "./operations-domain.js";

window.IAQAR = window.IAQAR || {};
window.IAQAR.operationsDomain = operationsDomain;
window.dispatchEvent(new CustomEvent("iaqar:operations-domain-ready"));
