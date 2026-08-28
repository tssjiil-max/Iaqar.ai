/**
 * Exposes the Phase 5 operations domain on window.IAQAR for classic scripts
 * such as workflow-office.js.
 */
import * as operationsDomain from "./operations-domain.js";
import * as coordinationBundleDomain from "./coordination-bundle-domain.js";

window.IAQAR = window.IAQAR || {};
window.IAQAR.operationsDomain = operationsDomain;
window.IAQAR.coordinationBundleDomain = coordinationBundleDomain;
window.dispatchEvent(new CustomEvent("iaqar:operations-domain-ready"));
