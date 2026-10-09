/**
 * «مدير المكتب الذكي» data — through the Worker only (membership checked there).
 * The status is fetched once per session view and shared, so the home card and Daily Tasks
 * agree on whether the agent is working.
 */
import { api } from "./runtime.js";

let cached = null;
let cachedAt = 0;
let cachedOffice = "";

export function loadAgentStatus(officeId, { fresh = false } = {}) {
  if (!fresh && cached && cachedOffice === officeId && Date.now() - cachedAt < 60_000) return cached;
  cachedAt = Date.now();
  cachedOffice = officeId;
  cached = api("/os/agent/status", { officeId }).then((s) => ({ ...s, loaded: true })).catch((error) => { cached = null; throw error; });
  return cached;
}

export function saveAgentSettings(officeId, patch) {
  cached = null;
  return api("/os/agent/settings", { officeId, ...patch });
}

export function agentChat(officeId, message, requestKey) {
  return api("/os/agent/chat", { officeId, message, requestKey });
}

export function agentHistory(officeId) {
  return api("/os/agent/history", { officeId });
}

/** The broker's own press on a button the office manager showed (the approval gate). */
export function agentAct(officeId, action = {}) {
  return api("/os/agent/act", { officeId, tool: action.tool, journeyId: action.journeyId || "", askIds: Array.isArray(action.askIds) ? action.askIds : [] });
}

/** What the office manager suggests now (counts only; each opens a command in the chat). */
export function agentSuggestions(officeId) {
  return api("/os/agent/suggestions", { officeId });
}
