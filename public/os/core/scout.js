/**
 * «الباحث عن الفرص» data — through the Worker only (membership is checked there; the scout's collections are closed to
 * the browser by the rules). The overview is fetched once per view and shared for a short while, so the home card
 * and the scout page agree.
 */
import { api } from "./runtime.js";

let cached = null;
let cachedAt = 0;
let cachedOffice = "";

export function loadScout(officeId, { fresh = false } = {}) {
  if (!fresh && cached && cachedOffice === officeId && Date.now() - cachedAt < 30_000) return cached;
  cachedAt = Date.now();
  cachedOffice = officeId;
  cached = api("/os/scout/overview", { officeId }).catch((error) => { cached = null; throw error; });
  return cached;
}

const changed = (promise) => promise.then((result) => { cached = null; return result; });

export const saveScoutSettings = (officeId, settings) => changed(api("/os/scout/settings", { officeId, settings }));
export const parseScoutText = (officeId, text) => api("/os/scout/parse", { officeId, text });
export const createScoutSearch = (officeId, search, requestKey) => changed(api("/os/scout/search", { officeId, search, requestKey }));
export const scoutSearchDetail = (officeId, taskId) => api("/os/scout/search/detail", { officeId, taskId });
export const controlScoutSearch = (officeId, taskId, action, mode = "") => changed(api("/os/scout/search/control", { officeId, taskId, action, mode }));
/** From inside a record: STATUS (what is running for it), START (one press), STOP (this record only). */
export const scoutForRecord = (officeId, recordId, action = "STATUS", mode = "") => (action === "STATUS" ? api("/os/scout/record", { officeId, recordId, action }) : changed(api("/os/scout/record", { officeId, recordId, action, mode })));
export const scoutFind = (officeId, opportunityId) => api("/os/scout/find", { officeId, opportunityId });
export const actOnScoutFind = (officeId, opportunityId, action, recordId = "", extra = {}) => changed(api("/os/scout/find/act", { officeId, opportunityId, action, recordId, ...extra }, { keepalive: action === "CONTACT" }));
export const feedScout = (officeId, text, channel = "") => changed(api("/os/scout/feed", { officeId, text, channel }));
/** «أدخل رابط الإعلان»: the address, with the ad's text when the site does not allow its page to be read. */
export const importScoutLink = (officeId, url, text = "") => changed(api("/os/scout/import", { officeId, url, text }));
/** «ابحث في الويب الآن»: Google's answer for this search, shown once and never stored. */
export const liveWebSearch = (officeId, taskId) => api("/os/scout/web/live", { officeId, taskId });
