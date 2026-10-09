/**
 * «مركز التواصل والدعم» data — through the Worker only (membership checked there).
 * No token or secret reaches the browser: only the public support username and whether the
 * assistant is connected right now.
 */
import { api } from "./runtime.js";

export function loadSupportStatus(officeId) {
  return api("/os/support/status", { officeId });
}

export function sendSupportTicket(officeId, { kind, text, needsAdmin }) {
  return api("/os/support/ticket", { officeId, kind, text, needsAdmin: needsAdmin === true });
}
