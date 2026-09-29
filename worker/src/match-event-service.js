/**
 * Match events — the single write path for client, owner and broker activity.
 *
 * appendMatchEventRecord():
 *   1. writes offices/{officeId}/matches/{matchId}/events/{eventId} create-only
 *      (a retried/duplicate event is a no-op: no projection, no notification);
 *   2. projects the history onto the Match and its MATCH_REVIEW operation, so the
 *      broker's live Firestore listeners update immediately;
 *   3. routes notifications once per matchId + eventId + recipient + channel via
 *      create-only offices/{officeId}/notificationDispatches/{key} records:
 *        broker → FCM (existing office push pipeline);
 *        client/owner → WhatsApp handoff payload (wa.me, opened by the broker;
 *        recorded as WHATSAPP_OPENED — never sent/delivered/read).
 */

import {
  MATCH_EVENT_ACTOR,
  MATCH_EVENT_SOURCE,
  MATCH_EVENT_TYPE,
  NOTIFICATION_CHANNEL,
  appendMatchEvent,
  applyMatchEventToState,
  brokerNotificationText,
  buildMatchEvent,
  isLifecycleReadOnly,
  notificationDedupeKey,
  notificationRoutes,
  parseMatchEvents,
  parseMatchState,
  partyWhatsAppText,
  projectMatchEvents
} from "../../public/js/match-event-domain.js";
import { buildPartyReviewUrl, partySessionKey } from "../../public/js/party-session-domain.js";
import { phoneFromTask } from "../../public/js/v2/daily-tasks/party-link-domain.js";

const OUTBOX_LIMIT = 20;

function js(doc, helpers) {
  return doc ? helpers.firestoreFieldsToJs(doc.fields || {}) : null;
}

async function readDoc(helpers, { projectId, segments, accessToken }) {
  const doc = await helpers.getFirestoreDocument({ projectId, segments, accessToken, allowMissing: true });
  return doc ? { id: String(segments[segments.length - 1]), ...js(doc, helpers) } : null;
}

export async function matchEventId(helpers, parts = []) {
  const hex = await helpers.sha256Hex(parts.map((part) => String(part ?? "")).join("|"));
  return `ev_${hex.slice(0, 40)}`;
}

function parseOutbox(raw) {
  try {
    const list = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function matchLifecycleOf(match = {}) {
  const state = parseMatchState(match.matchStateJson);
  if (state?.lifecycle && state.lifecycle !== "ACTIVE") return state.lifecycle;
  return projectMatchEvents(match.negotiationActivityJson, { matchStatus: match.status }).lifecycle;
}

async function loadMatchWithVersion(helpers, { projectId, officeId, matchId, accessToken }) {
  const doc = await helpers.getFirestoreDocument({ projectId, segments: ["offices", officeId, "matches", matchId], accessToken, allowMissing: true });
  return doc ? { match: { id: matchId, ...js(doc, helpers) }, updateTime: doc.updateTime || "" } : null;
}

/**
 * Read-modify-write of the Match projection with an updateTime precondition, retried
 * on conflict so concurrent client/owner/broker events never overwrite each other.
 * The operation mirrors the committed Match projection.
 */
async function updateMatchProjection(helpers, { projectId, officeId, matchId, accessToken, resolveOperationId, loaded = null }, buildFields) {
  let current = loaded;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (!current || attempt > 0) current = await loadMatchWithVersion(helpers, { projectId, officeId, matchId, accessToken });
    if (!current) throw helpers.appError("match_not_found", 404, "المطابقة غير موجودة.");
    const fields = buildFields(current.match);
    try {
      if (typeof helpers.patchFirestoreDocument === "function" && current.updateTime) {
        await helpers.patchFirestoreDocument({ projectId, segments: ["offices", officeId, "matches", matchId], accessToken, fields, updateTime: current.updateTime });
      } else {
        await helpers.setFirestoreDocument({ projectId, segments: ["offices", officeId, "matches", matchId], accessToken, fields });
      }
    } catch (error) {
      if (error?.status === 409 && attempt < 5) continue;
      throw error;
    }
    const operationId = await resolveOperationId(helpers, { projectId, officeId, matchId, match: current.match, accessToken });
    if (operationId) {
      await helpers.setFirestoreDocument({ projectId, segments: ["offices", officeId, "operations", operationId], accessToken, fields });
    }
    return { operationId, match: current.match, fields };
  }
  throw helpers.appError("match_projection_conflict", 409, "تعذر حفظ التحديث — حاول مجددًا.");
}

async function partyReviewUrl(helpers, { projectId, officeId, matchId, side, accessToken, env }) {
  const key = await readDoc(helpers, { projectId, segments: ["offices", officeId, "partySessionKeys", partySessionKey(matchId, side)], accessToken });
  if (!key?.sessionId) return "";
  const session = await readDoc(helpers, { projectId, segments: ["offices", officeId, "partySessions", key.sessionId], accessToken });
  if (!session?.token) return "";
  const origin = String(env?.APP_ORIGIN || (String(env?.DEPLOYMENT_ENV || "").toLowerCase() === "staging"
    ? "https://iaqar-ai-staging--staging-9c4b0k7h.web.app" : "https://iaqar.ai")).replace(/\/+$/, "");
  return buildPartyReviewUrl({ origin, pathname: "/", token: session.token });
}

async function partyPhone(helpers, { projectId, officeId, match, side, accessToken }) {
  const id = side === "owner" ? (match.ownerOfferId || match.offerId) : (match.clientRequestId || match.requestId);
  if (!id) return "";
  const record = await readDoc(helpers, { projectId, segments: ["offices", officeId, "opportunities", id], accessToken });
  if (!record) return "";
  return phoneFromTask({
    ownerPhone: record.contactPhone || record.advertiserPhoneNormalized || record.advertiserPhone || record.phone,
    clientPhone: record.contactPhone || record.advertiserPhoneNormalized || record.clientPhone || record.phone
  }, "client") || "";
}

// FCM dispatch state machine (one record per matchId|eventId|recipient|channel):
//   PENDING ─claim→ SENDING ─→ DISPATCHED | NO_DEVICES | DISABLED   (terminal)
//                            └→ FAILED ─claim on retry→ SENDING …   (retryable)
// A claim is an updateTime-conditioned write, so two concurrent retries cannot
// both send; a SENDING claim older than the lease can be taken over after a crash.
export const DISPATCH_STATUS = Object.freeze({
  PENDING: "PENDING", SENDING: "SENDING", DISPATCHED: "DISPATCHED",
  NO_DEVICES: "NO_DEVICES", DISABLED: "DISABLED", FAILED: "FAILED"
});
const TERMINAL_FCM = new Set([DISPATCH_STATUS.DISPATCHED, DISPATCH_STATUS.NO_DEVICES, DISPATCH_STATUS.DISABLED]);
const SENDING_LEASE_MS = 60_000;

function stringFields(helpers, values = {}) {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, helpers.firestoreString(String(v ?? ""))]));
}

async function readDispatch(helpers, { projectId, officeId, dispatchId, accessToken }) {
  const doc = await helpers.getFirestoreDocument({ projectId, segments: ["offices", officeId, "notificationDispatches", dispatchId], accessToken, allowMissing: true });
  return doc ? { data: { id: dispatchId, ...js(doc, helpers) }, updateTime: doc.updateTime || "" } : null;
}

async function claimFcmDispatch(helpers, { projectId, officeId, dispatchId, accessToken, now }) {
  const current = await readDispatch(helpers, { projectId, officeId, dispatchId, accessToken });
  if (!current) return null;
  const status = String(current.data.status || "");
  if (TERMINAL_FCM.has(status)) return null;
  if (status === DISPATCH_STATUS.SENDING && now.getTime() - Date.parse(current.data.leaseAt || 0) < SENDING_LEASE_MS) return null;
  if (![DISPATCH_STATUS.PENDING, DISPATCH_STATUS.FAILED, DISPATCH_STATUS.SENDING].includes(status)) return null;
  const attempts = Number(current.data.attempts || 0) + 1;
  try {
    await helpers.patchFirestoreDocument({
      projectId, segments: ["offices", officeId, "notificationDispatches", dispatchId], accessToken,
      updateTime: current.updateTime,
      fields: stringFields(helpers, { status: DISPATCH_STATUS.SENDING, leaseAt: now.toISOString(), attempts })
    });
  } catch (error) {
    if (error?.status === 409) return null; // another request claimed it
    throw error;
  }
  return { ...current.data, attempts };
}

async function sendFcmDispatch(helpers, { projectId, officeId, matchId, accessToken, env, match, dispatch, now }) {
  const claimed = await claimFcmDispatch(helpers, { projectId, officeId, dispatchId: dispatch.dispatchId, accessToken, now });
  if (!claimed) return (await readDispatch(helpers, { projectId, officeId, dispatchId: dispatch.dispatchId, accessToken }))?.data || dispatch;
  let status = DISPATCH_STATUS.FAILED;
  let sent = 0;
  let lastError = "";
  try {
    const summary = await helpers.sendBrokerPush({
      projectId, officeId, accessToken, env, title: claimed.title, body: claimed.body,
      matchId, assignedBrokerId: match.assignedBrokerId || ""
    });
    sent = Number(summary?.sent || 0);
    if (summary?.skipped) status = DISPATCH_STATUS.DISABLED;
    else if (sent > 0) status = DISPATCH_STATUS.DISPATCHED;
    else if (Number(summary?.registered || 0) === 0) status = DISPATCH_STATUS.NO_DEVICES;
    else lastError = `all_devices_failed:${Number(summary?.failed || 0)}`;
  } catch (error) {
    lastError = String(error?.message || error || "push_failed").slice(0, 200);
    console.warn("[iaqar-events] broker push failed", lastError);
  }
  const fields = { status, devicesSent: sent, lastError, finishedAt: new Date().toISOString() };
  await helpers.setFirestoreDocument({
    projectId, segments: ["offices", officeId, "notificationDispatches", dispatch.dispatchId], accessToken,
    fields: stringFields(helpers, fields)
  });
  return { ...claimed, ...fields };
}

/**
 * Creates each route's dispatch record once and drives FCM to a terminal state.
 * Safe to call again for the same event: terminal records are left alone, FAILED
 * ones are retried, WhatsApp handoffs are returned as they are.
 */
async function dispatchNotifications(helpers, { projectId, officeId, matchId, accessToken, match, event, env, now = new Date() }) {
  const results = [];
  let office = null;
  for (const route of notificationRoutes(event)) {
    const key = notificationDedupeKey({ matchId, eventId: event.eventId, recipient: route.recipient, channel: route.channel });
    const dispatchId = `nd_${(await helpers.sha256Hex(key)).slice(0, 40)}`;
    const base = {
      dispatchId, dedupeKey: key, matchId, eventId: event.eventId, eventType: event.eventType,
      recipient: route.recipient, channel: route.channel, createdAt: event.createdAt
    };
    const existing = await readDispatch(helpers, { projectId, officeId, dispatchId, accessToken });
    let record = existing?.data || null;
    if (!record) {
      let payload;
      if (route.channel === NOTIFICATION_CHANNEL.FCM) {
        payload = { ...base, title: "تحديث في المطابقة", body: brokerNotificationText(event), status: DISPATCH_STATUS.PENDING, attempts: 0 };
      } else {
        office = office || await readDoc(helpers, { projectId, segments: ["offices", officeId], accessToken }) || {};
        const [phone, reviewUrl] = await Promise.all([
          partyPhone(helpers, { projectId, officeId, match, side: route.recipient, accessToken }),
          partyReviewUrl(helpers, { projectId, officeId, matchId, side: route.recipient, accessToken, env })
        ]);
        payload = {
          ...base, phone, reviewUrl,
          text: partyWhatsAppText(event, route.recipient, { officeName: office.officeName || office.name || "", reviewUrl }),
          status: phone ? "PENDING_BROKER_HANDOFF" : "MISSING_PHONE"
        };
      }
      await helpers.createFirestoreDocumentIfAbsent({
        projectId, segments: ["offices", officeId, "notificationDispatches", dispatchId], accessToken,
        fields: stringFields(helpers, payload)
      });
      record = (await readDispatch(helpers, { projectId, officeId, dispatchId, accessToken }))?.data || payload;
    }
    if (route.channel === NOTIFICATION_CHANNEL.FCM && typeof helpers.sendBrokerPush === "function" && !TERMINAL_FCM.has(String(record.status || ""))) {
      record = await sendFcmDispatch(helpers, { projectId, officeId, matchId, accessToken, env, match, dispatch: { ...base, ...record }, now });
    }
    results.push({ ...base, ...record, dispatchId });
  }
  return results;
}

function projectEventFields(helpers, current, event) {
  const history = parseMatchEvents(current.negotiationActivityJson);
  const already = history.some((item) => item.eventId === event.eventId);
  const previous = parseMatchState(current.matchStateJson) || projectMatchEvents(history, { matchStatus: current.status });
  const state = already ? previous : applyMatchEventToState(previous, event);
  const latest = (value) => (String(current[value] || "") > event.createdAt ? String(current[value]) : event.createdAt);
  const fields = {
    negotiationActivityJson: helpers.firestoreString(JSON.stringify(appendMatchEvent(history, event))),
    matchStateJson: helpers.firestoreString(JSON.stringify({ ...state, lastEvent: null, lastPartyEvent: null })),
    matchLifecycle: helpers.firestoreString(state.lifecycle),
    lastEventAt: helpers.firestoreString(latest("lastEventAt"))
  };
  if (event.actorType === MATCH_EVENT_ACTOR.BROKER) fields.lastBrokerActivityAt = helpers.firestoreString(latest("lastBrokerActivityAt"));
  return { fields, state };
}

export async function readStoredEvent(helpers, { projectId, officeId, matchId, eventId, accessToken }) {
  const doc = await helpers.getFirestoreDocument({ projectId, segments: ["offices", officeId, "matches", matchId, "events", eventId], accessToken, allowMissing: true });
  if (!doc) return null;
  const data = js(doc, helpers);
  let payload = {};
  try { payload = JSON.parse(data.payloadJson || "{}"); } catch { payload = {}; }
  const built = buildMatchEvent({ ...data, payload });
  return built.ok ? built.event : null;
}

/**
 * The one way to record match activity. Idempotent and recoverable on eventId:
 *   1. event document (create-only) — the source of truth;
 *   2. Match + MATCH_REVIEW projection — only then
 *   3. notifications — then the pending WhatsApp handoffs on the projection.
 * Replaying the same eventId re-runs 2 and 3, completing whatever a failed
 * attempt left undone, without applying the event twice or re-sending a
 * notification that already reached a terminal state.
 * Throws 404 for an unknown match and 409 once the match is agreed/closed
 * (unless allowWhenClosed, used for the closing events themselves).
 */
export async function appendMatchEventRecord(helpers, {
  projectId, officeId, matchId, accessToken, env = null, now = new Date(),
  event: input = {}, allowWhenClosed = false, resolveOperationId
}) {
  const id = String(matchId || "").trim();
  const loaded = id ? await loadMatchWithVersion(helpers, { projectId, officeId, matchId: id, accessToken }) : null;
  if (!loaded) throw helpers.appError("match_not_found", 404, "المطابقة غير موجودة.");
  const match = loaded.match;
  const built = buildMatchEvent({ ...input, matchId: id, officeId, createdAt: now.toISOString() });
  if (!built.ok) throw helpers.appError(`event_${built.error}`, 400, "بيانات الحدث غير صحيحة.");
  let event = built.event;
  if (!allowWhenClosed && isLifecycleReadOnly(matchLifecycleOf(match))) {
    // Only a replay of an event stored before the match closed may still complete.
    const stored = await readStoredEvent(helpers, { projectId, officeId, matchId: id, eventId: event.eventId, accessToken });
    if (!stored) throw helpers.appError("match_read_only", 409, "المطابقة مغلقة — لا يمكن إضافة تعديل جديد.");
  }
  const { payload, ...flat } = event;
  const created = await helpers.createFirestoreDocumentIfAbsent({
    projectId,
    segments: ["offices", officeId, "matches", id, "events", event.eventId],
    accessToken,
    fields: { ...stringFields(helpers, flat), payloadJson: helpers.firestoreString(JSON.stringify(payload || {})) }
  });
  const duplicate = !created;
  if (duplicate) {
    // Replay of a stored event: finish its projection/notifications with the stored copy.
    event = await readStoredEvent(helpers, { projectId, officeId, matchId: id, eventId: event.eventId, accessToken }) || event;
  }
  let state = null;
  const projected = await updateMatchProjection(helpers, { projectId, officeId, matchId: id, accessToken, resolveOperationId, loaded }, (current) => {
    const result = projectEventFields(helpers, current, event);
    state = result.state;
    return result.fields;
  });
  const dispatches = await dispatchNotifications(helpers, { projectId, officeId, matchId: id, accessToken, match: projected.match || match, event, env, now });
  const pending = dispatches.filter((d) => d.channel === NOTIFICATION_CHANNEL.WHATSAPP && d.status !== "WHATSAPP_OPENED")
    .map((d) => ({ dispatchId: d.dispatchId, eventId: d.eventId, recipient: d.recipient, phone: d.phone, text: d.text, status: d.status, createdAt: d.createdAt }));
  if (pending.length) {
    await updateMatchProjection(helpers, { projectId, officeId, matchId: id, accessToken, resolveOperationId }, (current) => {
      const outbox = parseOutbox(current.whatsappOutboxJson);
      const known = new Set(outbox.map((item) => item.dispatchId));
      const additions = pending.filter((item) => !known.has(item.dispatchId));
      return { whatsappOutboxJson: helpers.firestoreString(JSON.stringify([...outbox, ...additions].slice(-OUTBOX_LIMIT))) };
    });
  }
  return { event, duplicate, state, dispatches, operationId: projected.operationId };
}

/** Broker opened WhatsApp for one pending handoff: WHATSAPP_OPENED, never "sent". */
export async function markWhatsAppHandoffOpened(helpers, { projectId, officeId, matchId, accessToken, dispatchId, now = new Date(), resolveOperationId, actorId = "" }) {
  const match = await readDoc(helpers, { projectId, segments: ["offices", officeId, "matches", matchId], accessToken });
  if (!match) throw helpers.appError("match_not_found", 404, "المطابقة غير موجودة.");
  const dispatch = await readDoc(helpers, { projectId, segments: ["offices", officeId, "notificationDispatches", String(dispatchId || "")], accessToken });
  if (!dispatch || dispatch.matchId !== matchId || dispatch.channel !== NOTIFICATION_CHANNEL.WHATSAPP) {
    throw helpers.appError("dispatch_not_found", 404, "الإشعار غير موجود لهذه المطابقة.");
  }
  await helpers.setFirestoreDocument({
    projectId, segments: ["offices", officeId, "notificationDispatches", dispatch.id], accessToken,
    fields: { status: helpers.firestoreString("WHATSAPP_OPENED"), openedAt: helpers.firestoreString(now.toISOString()) }
  });
  const result = await appendMatchEventRecord(helpers, {
    projectId, officeId, matchId, accessToken, now, resolveOperationId, allowWhenClosed: true,
    event: {
      eventId: await matchEventId(helpers, [matchId, "WHATSAPP_OPENED", dispatch.id]),
      actorType: MATCH_EVENT_ACTOR.BROKER, actorId, eventType: MATCH_EVENT_TYPE.WHATSAPP_OPENED,
      recipient: dispatch.recipient, source: MATCH_EVENT_SOURCE.BROKER_WORKSPACE,
      payload: { handoff: "notification", dispatchId: dispatch.id, forEventId: dispatch.eventId }
    }
  });
  await updateMatchProjection(helpers, { projectId, officeId, matchId, accessToken, resolveOperationId }, (current) => ({
    whatsappOutboxJson: helpers.firestoreString(JSON.stringify(parseOutbox(current.whatsappOutboxJson).filter((item) => item.dispatchId !== dispatch.id)))
  }));
  return { ...result, dispatch: { ...dispatch, status: "WHATSAPP_OPENED" } };
}

/** Clears unread for this match only. Events are never deleted. */
export async function markMatchSeenByBroker(helpers, { projectId, officeId, matchId, accessToken, now = new Date(), resolveOperationId }) {
  const seenAt = now.toISOString();
  await updateMatchProjection(helpers, { projectId, officeId, matchId, accessToken, resolveOperationId }, () => ({
    brokerSeenAt: helpers.firestoreString(seenAt)
  }));
  return { seenAt };
}
