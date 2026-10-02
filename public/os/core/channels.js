/** «قنوات المكتب» data: read-only status through the Worker (no secrets ever reach the browser). */
import { api } from "./runtime.js";

export function loadChannelStatus(officeId) {
  return api("/office/channels/status", { officeId });
}
