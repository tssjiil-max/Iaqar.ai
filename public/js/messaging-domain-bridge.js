/**
 * Exposes the Phase 7 messaging domain on window.IAQAR for classic scripts
 * such as workflow-office.js.
 */
import * as messagingDomain from "./messaging-domain.js";

window.IAQAR = window.IAQAR || {};
window.IAQAR.messagingDomain = messagingDomain;
window.dispatchEvent(new CustomEvent("iaqar:messaging-domain-ready"));
