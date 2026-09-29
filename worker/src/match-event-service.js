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

async function dispatchNotifications(helpers, { projectId, officeId, matchId, accessToken, match, event, env }) {
  const results = [];
  const office = await readDoc(helpers, { projectId, segments: ["offices", officeId], accessToken }) || {};
  for (const route of notificationRoutes(event)) {
    const key = notificationDedupeKey({ matchId, eventId: event.eventId, recipient: route.recipient, channel: route.channel });
    const dispatchId = `nd_${(await helpers.sha256Hex(key)).slice(0, 40)}`;
    const base = {
      dispatchId, dedupeKey: key, matchId, eventId: event.eventId, eventType: event.eventType,
      recipient: route.recipient, channel: route.channel, createdAt: event.createdAt
    };
    let payload;
    if (route.channel === NOTIFICATION_CHANNEL.FCM) {
      payload = { ...base, title: "تحديث في المطابقة", body: brokerNotificationText(event), status: "CREATED" };
    } else {
      const [phone, reviewUrl] = await Promise.all([
        partyPhone(helpers, { projectId, officeId, match, side: route.recipient, accessToken }),
        partyReviewUrl(helpers, { projectId, officeId, matchId, side: route.recipient, accessToken, env })
      ]);
      payload = {
        ...base,
        phone,
        reviewUrl,
        text: partyWhatsAppText(event, route.recipient, { officeName: office.officeName || office.name || "", reviewUrl }),
        status: phone ? "PENDING_BROKER_HANDOFF" : "MISSING_PHONE"
      };
    }
    const created = await helpers.createFirestoreDocumentIfAbsent({
      projectId,
      segments: ["offices", officeId, "notificationDispatches", dispatchId],
      accessToken,
      fields: Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, helpers.firestoreString(String(v ?? ""))]))
    });
    if (!created) {
      results.push({ ...payload, duplicate: true });
      continue;
    }
    if (route.channel === NOTIFICATION_CHANNEL.FCM && typeof helpers.sendBrokerPush === "function") {
      let status = "FCM_FAILED";
      let sent = 0;
      try {
        const summary = await helpers.sendBrokerPush({
          projectId, officeId, accessToken, env, title: payload.title, body: payload.body,
          matchId, assignedBrokerId: match.assignedBrokerId || ""
        });
        sent = Number(summary?.sent || 0);
        status = summary?.skipped ? "FCM_DISABLED_BY_PREFERENCES" : sent > 0 ? "FCM_DISPATCHED" : "FCM_NO_DEVICES";
      } catch (error) {
        console.warn("[iaqar-events] broker push failed", error?.message || error);
      }
      await helpers.setFirestoreDocument({
        projectId, segments: ["offices", officeId, "notificationDispatches", dispatchId], accessToken,
        fields: { status: helpers.firestoreString(status), devicesSent: helpers.firestoreString(String(sent)) }
      });
      payload.status = status;
    }
    results.push(payload);
  }
  return results;
}

/**
 * The one way to record match activity. Idempotent on eventId.
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
  if (!allowWhenClosed && isLifecycleReadOnly(matchLifecycleOf(match))) {
    throw helpers.appError("match_read_only", 409, "المطابقة مغلقة — لا يمكن إضافة تعديل جديد.");
  }
  const built = buildMatchEvent({ ...input, matchId: id, officeId, createdAt: now.toISOString() });
  if (!built.ok) throw helpers.appError(`event_${built.error}`, 400, "بيانات الحدث غير صحيحة.");
  const event = built.event;
  const { payload, ...flat } = event;
  const created = await helpers.createFirestoreDocumentIfAbsent({
    projectId,
    segments: ["offices", officeId, "matches", id, "events", event.eventId],
    accessToken,
    fields: {
      ...Object.fromEntries(Object.entries(flat).map(([k, v]) => [k, helpers.firestoreString(String(v ?? ""))])),
      payloadJson: helpers.firestoreString(JSON.stringify(payload || {}))
    }
  });
  if (!created) {
    const events = parseMatchEvents(match.negotiationActivityJson);
    return { event: events.find((item) => item.eventId === event.eventId) || event, duplicate: true, state: parseMatchState(match.matchStateJson) || projectMatchEvents(events, { matchStatus: match.status }), dispatches: [] };
  }
  const dispatches = await dispatchNotifications(helpers, { projectId, officeId, matchId: id, accessToken, match, event, env });
  const pending = dispatches.filter((d) => d.channel === NOTIFICATION_CHANNEL.WHATSAPP && !d.duplicate)
    .map((d) => ({ dispatchId: d.dispatchId, eventId: d.eventId, recipient: d.recipient, phone: d.phone, text: d.text, status: d.status, createdAt: d.createdAt }));
  let state = null;
  const projected = await updateMatchProjection(helpers, { projectId, officeId, matchId: id, accessToken, resolveOperationId, loaded }, (current) => {
    const history = parseMatchEvents(current.negotiationActivityJson);
    const already = history.some((item) => item.eventId === event.eventId);
    const previous = parseMatchState(current.matchStateJson) || projectMatchEvents(history, { matchStatus: current.status });
    state = already ? previous : applyMatchEventToState(previous, event);
    const fields = {
      negotiationActivityJson: helpers.firestoreString(JSON.stringify(appendMatchEvent(history, event))),
      matchStateJson: helpers.firestoreString(JSON.stringify({ ...state, lastEvent: null, lastPartyEvent: null })),
      matchLifecycle: helpers.firestoreString(state.lifecycle),
      lastEventAt: helpers.firestoreString(event.createdAt)
    };
    if (event.actorType === MATCH_EVENT_ACTOR.BROKER) fields.lastBrokerActivityAt = helpers.firestoreString(event.createdAt);
    if (pending.length) {
      const outbox = parseOutbox(current.whatsappOutboxJson);
      const known = new Set(outbox.map((item) => item.dispatchId));
      fields.whatsappOutboxJson = helpers.firestoreString(JSON.stringify([...outbox, ...pending.filter((item) => !known.has(item.dispatchId))].slice(-OUTBOX_LIMIT)));
    }
    return fields;
  });
  return { event, duplicate: false, state, dispatches, operationId: projected.operationId };
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
