/**
 * Journey event log — append-only timeline under offices/{o}/journeys/{j}/events.
 * Event ids are derived from a caller-supplied idempotency key, so a retried request
 * never produces a second entry.
 */

import { EVENT_SOURCE, EVENT_TEXT } from "../../../public/os/domain/journey-domain.js";

export async function eventId(deps, parts) {
  const hex = await deps.sha256Hex(parts.map((part) => String(part ?? "")).join("|"));
  return `ev_${hex.slice(0, 40)}`;
}

/**
 * @returns {Promise<{ id: string, created: boolean }>}
 */
export async function appendJourneyEvent(store, deps, {
  officeId, journeyId, key, type, text = "", actorUid = "", actorRole = "", source = EVENT_SOURCE.SYSTEM,
  payload = {}, at = new Date()
}) {
  const id = await eventId(deps, [officeId, journeyId, type, ...(Array.isArray(key) ? key : [key])]);
  const created = await store.create(["offices", officeId, "journeys", journeyId, "events", id], {
    officeId,
    journeyId,
    eventId: id,
    type,
    text: String(text || EVENT_TEXT[type] || type).slice(0, 400),
    actorUid: String(actorUid || ""),
    actorRole: String(actorRole || ""),
    source,
    payloadJson: JSON.stringify(payload || {}).slice(0, 4000),
    at,
    createdAt: at
  });
  return { id, created };
}
