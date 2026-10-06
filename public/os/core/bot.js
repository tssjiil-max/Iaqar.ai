/**
 * «بوت المكتب» data. Everything goes through the Worker, which checks office membership (and
 * the manager role for the switch). No token ever reaches the browser.
 */
import { api } from "./runtime.js";

/** Manager only: switch the office's bot on or off. */
export function setBotEnabled(officeId, enabled) {
  return api("/os/bot/enable", { officeId, enabled: enabled === true });
}

/** A broker's own alerts chat: a one-time link he opens from his own Telegram. */
export function startBrokerBotLink(officeId) {
  return api("/os/bot/broker/link", { officeId });
}

export function unlinkBrokerBot(officeId) {
  return api("/os/bot/broker/unlink", { officeId });
}

/** The link the office gives one owner or client so the bot may write to him. */
export function startPartyBotLink(officeId, recordId) {
  return api("/os/bot/party/link", { officeId, recordId });
}

/** { available, state: LINKED | STOPPED | NOT_LINKED | NO_PHONE } for one record's person. */
export function partyBotStatus(officeId, recordId) {
  return api("/os/bot/party/status", { officeId, recordId });
}

/** Take one deal back from the bot (paused = true) or hand it back. */
export function setDealBotPaused(officeId, journeyId, paused) {
  return api("/os/journeys/bot", { officeId, journeyId, paused: paused === true });
}
