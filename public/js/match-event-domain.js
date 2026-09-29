/**
 * Match negotiation events — one model for client, owner, broker and system.
 * Pure: shared by the Worker (writes) and the broker/party UIs (reads).
 *
 * Every event belongs to one exact matchId (never an operation id). The full
 * history is append-only; "current state" is derived: the latest choice per
 * party, the current agreement, and the lifecycle (ACTIVE until agreed/closed).
 * Delivery is never assumed: WhatsApp without a gateway is only WHATSAPP_OPENED.
 */

import { postViewingNegotiationTopics } from "./negotiation-management-domain.js";

export const MATCH_EVENT_TYPE = Object.freeze({
  CLIENT_INTERESTED: "CLIENT_INTERESTED",
  CLIENT_NOT_INTERESTED: "CLIENT_NOT_INTERESTED",
  CLIENT_NEEDS_TIME: "CLIENT_NEEDS_TIME",
  CLIENT_VIEWING_REQUESTED: "CLIENT_VIEWING_REQUESTED",
  CLIENT_PRELIMINARY_AGREEMENT: "CLIENT_PRELIMINARY_AGREEMENT",
  CLIENT_CONDITION_CHANGED: "CLIENT_CONDITION_CHANGED",
  OWNER_INTERESTED: "OWNER_INTERESTED",
  OWNER_NOT_INTERESTED: "OWNER_NOT_INTERESTED",
  OWNER_NEEDS_TIME: "OWNER_NEEDS_TIME",
  OWNER_VIEWING_RESPONSE: "OWNER_VIEWING_RESPONSE",
  OWNER_PRELIMINARY_AGREEMENT: "OWNER_PRELIMINARY_AGREEMENT",
  OWNER_CONDITION_CHANGED: "OWNER_CONDITION_CHANGED",
  BROKER_MESSAGE: "BROKER_MESSAGE",
  BROKER_INTERNAL_NOTE: "BROKER_INTERNAL_NOTE",
  WHATSAPP_OPENED: "WHATSAPP_OPENED",
  LINK_OPENED: "LINK_OPENED",
  AGREEMENT_UPDATED: "AGREEMENT_UPDATED",
  MATCH_AGREED: "MATCH_AGREED",
  MATCH_CLOSED_NO_AGREEMENT: "MATCH_CLOSED_NO_AGREEMENT",
  MATCH_CLOSED: "MATCH_CLOSED",
  // Contextual reply to one exact broker message (conversation), not match-level state.
  CLIENT_MESSAGE_RESPONSE: "CLIENT_MESSAGE_RESPONSE",
  OWNER_MESSAGE_RESPONSE: "OWNER_MESSAGE_RESPONSE"
});

/** Kind the broker picks when sending; the reply set follows from it (no guessing). */
export const MESSAGE_KINDS = Object.freeze([
  Object.freeze({ id: "general", label: "عامة" }),
  Object.freeze({ id: "viewing", label: "موعد معاينة" }),
  Object.freeze({ id: "price", label: "سعر" }),
  Object.freeze({ id: "condition", label: "شرط" }),
  Object.freeze({ id: "response_required", label: "طلب رد" })
]);

const REPLY = Object.freeze({
  accept: "موافق",
  reject: "غير موافق",
  time_not_suitable: "الوقت غير مناسب",
  propose_other_time: "اقترح موعدًا آخر",
  will_whatsapp: "سأتواصل واتساب",
  need_time: "أحتاج وقت",
  have_other_offer: "لدي عرض آخر",
  need_clarification: "أحتاج توضيح",
  propose_change: "اقترح تعديلًا"
});

const REPLY_SETS = Object.freeze({
  viewing: ["accept", "time_not_suitable", "propose_other_time", "will_whatsapp"],
  price: ["accept", "reject", "need_time", "have_other_offer"],
  condition: ["accept", "reject", "need_clarification", "propose_change"],
  general: ["accept", "reject", "need_clarification", "will_whatsapp"],
  response_required: ["accept", "reject", "need_clarification", "will_whatsapp"]
});

export function messageKindOf(value = "") {
  const id = String(value ?? "").trim();
  return MESSAGE_KINDS.some((kind) => kind.id === id) ? id : "general";
}

export function messageKindLabel(value = "") {
  return MESSAGE_KINDS.find((kind) => kind.id === messageKindOf(value))?.label || "عامة";
}

/** Stable reply option ids + Arabic labels for one message kind. */
export function replyOptionsFor(kind = "general") {
  return REPLY_SETS[messageKindOf(kind)].map((id) => ({ id, label: REPLY[id] }));
}

export function isMessageResponseEvent(eventType = "") {
  return eventType === "CLIENT_MESSAGE_RESPONSE" || eventType === "OWNER_MESSAGE_RESPONSE";
}

export const MATCH_EVENT_ACTOR = Object.freeze({ CLIENT: "client", OWNER: "owner", BROKER: "broker", SYSTEM: "system" });
export const MATCH_EVENT_SOURCE = Object.freeze({ PARTY_LINK: "party_link", BROKER_WORKSPACE: "broker_workspace", WORKER: "worker" });
export const MATCH_LIFECYCLE = Object.freeze({ ACTIVE: "ACTIVE", AGREED: "AGREED", CLOSED_NO_AGREEMENT: "CLOSED_NO_AGREEMENT", CLOSED: "CLOSED" });
export const NOTIFICATION_CHANNEL = Object.freeze({ FCM: "fcm", WHATSAPP: "whatsapp" });
export const MATCH_EVENT_PROJECTION_LIMIT = 80;
export const MATCH_EVENT_MESSAGE_MAX = 1000;

const PARTY_NAME = Object.freeze({ client: "العميل", owner: "المالك", both: "الطرفان", internal: "داخلي", broker: "الوسيط" });

export const AGREEMENT_FIELDS = Object.freeze([
  Object.freeze({ id: "price", label: "السعر" }),
  Object.freeze({ id: "paymentMethod", label: "طريقة الدفع" }),
  Object.freeze({ id: "viewingAt", label: "موعد المعاينة" }),
  Object.freeze({ id: "responseDuration", label: "مدة الرد" }),
  Object.freeze({ id: "terms", label: "الشروط" })
]);

// Choices a party makes on its own review link.
const PARTY_LINK_CHOICES = Object.freeze({
  client: Object.freeze([
    Object.freeze({ id: "interested", label: "مهتم", eventType: MATCH_EVENT_TYPE.CLIENT_INTERESTED }),
    Object.freeze({ id: "not_interested", label: "غير مهتم", eventType: MATCH_EVENT_TYPE.CLIENT_NOT_INTERESTED }),
    Object.freeze({ id: "needs_time", label: "يحتاج وقت", eventType: MATCH_EVENT_TYPE.CLIENT_NEEDS_TIME }),
    Object.freeze({ id: "viewing", label: "معاينة", eventType: MATCH_EVENT_TYPE.CLIENT_VIEWING_REQUESTED }),
    Object.freeze({ id: "preliminary_agreement", label: "موافق مبدئيًا", eventType: MATCH_EVENT_TYPE.CLIENT_PRELIMINARY_AGREEMENT }),
    Object.freeze({ id: "condition", label: "شرط آخر", eventType: MATCH_EVENT_TYPE.CLIENT_CONDITION_CHANGED })
  ]),
  owner: Object.freeze([
    Object.freeze({ id: "interested", label: "مهتم", eventType: MATCH_EVENT_TYPE.OWNER_INTERESTED }),
    Object.freeze({ id: "not_interested", label: "غير مهتم", eventType: MATCH_EVENT_TYPE.OWNER_NOT_INTERESTED }),
    Object.freeze({ id: "needs_time", label: "يحتاج وقت", eventType: MATCH_EVENT_TYPE.OWNER_NEEDS_TIME }),
    Object.freeze({ id: "viewing", label: "موافق على المعاينة", eventType: MATCH_EVENT_TYPE.OWNER_VIEWING_RESPONSE }),
    Object.freeze({ id: "preliminary_agreement", label: "موافق مبدئيًا", eventType: MATCH_EVENT_TYPE.OWNER_PRELIMINARY_AGREEMENT }),
    Object.freeze({ id: "condition", label: "شرط آخر", eventType: MATCH_EVENT_TYPE.OWNER_CONDITION_CHANGED })
  ])
});

const CHOICE_EVENT_SUFFIX = Object.freeze({
  interested: "INTERESTED", not_interested: "NOT_INTERESTED", needs_time: "NEEDS_TIME",
  preliminary_agreement: "PRELIMINARY_AGREEMENT"
});

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function multiline(value, max = MATCH_EVENT_MESSAGE_MAX) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max);
}

function party(value) {
  const id = text(value).toLowerCase();
  return id === "owner" ? "owner" : id === "client" ? "client" : "";
}

export function isOperationId(value) {
  return /^op_/i.test(text(value));
}

export function matchPartyName(value = "") {
  return PARTY_NAME[text(value).toLowerCase()] || "";
}

export function partyLinkChoices(side = "client") {
  return (PARTY_LINK_CHOICES[party(side) || "client"]).map((choice) => ({ ...choice }));
}

/** Options the broker can record for a party in the workspace (interest + property topics). */
export function brokerPartyChoices({ propertyType = "", purpose = "" } = {}) {
  const topics = postViewingNegotiationTopics({ propertyType, purpose })
    .map((topic) => ({ id: text(topic.id), label: text(topic.label) }))
    .filter((topic) => topic.id && topic.label);
  const seen = new Set();
  return [
    { id: "interested", label: "مهتم" },
    { id: "not_interested", label: "غير مهتم" },
    { id: "needs_time", label: "يحتاج وقت" },
    ...topics
  ].filter((choice) => (seen.has(choice.id) ? false : seen.add(choice.id)));
}

/** Event type for a party choice, whoever records it (the party itself or the broker). */
export function choiceEventType(side, choiceId) {
  const who = party(side);
  const id = text(choiceId);
  if (!who || !id) return "";
  const prefix = who === "owner" ? "OWNER" : "CLIENT";
  if (CHOICE_EVENT_SUFFIX[id]) return `${prefix}_${CHOICE_EVENT_SUFFIX[id]}`;
  if (id === "viewing" || id === "another_viewing") return who === "owner" ? MATCH_EVENT_TYPE.OWNER_VIEWING_RESPONSE : MATCH_EVENT_TYPE.CLIENT_VIEWING_REQUESTED;
  return `${prefix}_CONDITION_CHANGED`;
}

// Match-level party choices only; contextual message replies are conversation events.
export function isPartyChoiceEvent(eventType = "") {
  const type = text(eventType);
  return /^(CLIENT|OWNER)_/.test(type) && !isMessageResponseEvent(type);
}

function eventParty(eventType = "") {
  const type = text(eventType);
  if (isMessageResponseEvent(type)) return "";
  if (type.startsWith("CLIENT_")) return "client";
  if (type.startsWith("OWNER_")) return "owner";
  return "";
}

/**
 * Validates and normalizes one event. Returns { ok, event } or { ok: false, error }.
 * matchId must be a real match id; an operation id is rejected.
 */
export function buildMatchEvent({
  eventId = "", matchId = "", officeId = "", actorType = "", actorId = "", eventType = "",
  recipient = "", payload = {}, createdAt = "", source = ""
} = {}) {
  const match = text(matchId);
  if (!match || isOperationId(match)) return { ok: false, error: "match_id_invalid" };
  const type = text(eventType).toUpperCase();
  if (!Object.values(MATCH_EVENT_TYPE).includes(type)) return { ok: false, error: "event_type_invalid" };
  const actor = text(actorType).toLowerCase();
  if (!Object.values(MATCH_EVENT_ACTOR).includes(actor)) return { ok: false, error: "actor_invalid" };
  const at = text(createdAt) || new Date().toISOString();
  const cleanPayload = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (value == null) continue;
    cleanPayload[key] = typeof value === "string" ? multiline(value) : value;
  }
  return {
    ok: true,
    event: {
      eventId: text(eventId) || `ev_${Date.parse(at) || 0}_${Math.random().toString(36).slice(2, 10)}`,
      matchId: match,
      officeId: text(officeId),
      actorType: actor,
      actorId: text(actorId),
      eventType: type,
      recipient: text(recipient).toLowerCase(),
      payload: cleanPayload,
      createdAt: at,
      source: text(source)
    }
  };
}

export function normalizeMatchEvent(raw = {}) {
  if (!raw || typeof raw !== "object") return null;
  const built = buildMatchEvent({ ...raw, eventId: raw.eventId || raw.id });
  return built.ok ? built.event : null;
}

export function parseMatchEvents(raw) {
  let list = raw;
  if (typeof raw === "string") {
    try { list = JSON.parse(raw || "[]"); } catch { list = []; }
  }
  if (!Array.isArray(list)) return [];
  return list.map(normalizeMatchEvent).filter(Boolean);
}

export function appendMatchEvent(list = [], event = null, { limit = MATCH_EVENT_PROJECTION_LIMIT } = {}) {
  const events = parseMatchEvents(list);
  const next = normalizeMatchEvent(event || {});
  if (!next) return events;
  return [...events.filter((item) => item.eventId !== next.eventId), next]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-Math.max(1, limit));
}

export function lifecycleForEvents(events = [], matchStatus = "") {
  let lifecycle = MATCH_LIFECYCLE.ACTIVE;
  for (const event of parseMatchEvents(events)) {
    if (event.eventType === MATCH_EVENT_TYPE.MATCH_AGREED) lifecycle = MATCH_LIFECYCLE.AGREED;
    if (event.eventType === MATCH_EVENT_TYPE.MATCH_CLOSED_NO_AGREEMENT) lifecycle = MATCH_LIFECYCLE.CLOSED_NO_AGREEMENT;
    if (event.eventType === MATCH_EVENT_TYPE.MATCH_CLOSED) lifecycle = MATCH_LIFECYCLE.CLOSED;
  }
  const status = text(matchStatus).toLowerCase();
  if (lifecycle === MATCH_LIFECYCLE.ACTIVE && (status === "closed" || status === "completed")) return MATCH_LIFECYCLE.CLOSED;
  return lifecycle;
}

export function lifecycleLabel(lifecycle = MATCH_LIFECYCLE.ACTIVE) {
  return {
    ACTIVE: "التفاوض مفتوح",
    AGREED: "تم الاتفاق وانتقلت المطابقة للمرحلة التالية",
    CLOSED_NO_AGREEMENT: "أُغلقت المطابقة دون اتفاق",
    CLOSED: "أُغلقت المطابقة"
  }[lifecycle] || "";
}

export function isLifecycleReadOnly(lifecycle = "") {
  return text(lifecycle) !== "" && text(lifecycle) !== MATCH_LIFECYCLE.ACTIVE;
}

/** Arabic one-liner for an event, from the broker's point of view. */
export function matchEventLabel(event = {}) {
  const e = normalizeMatchEvent(event);
  if (!e) return "";
  const byBroker = e.actorType === MATCH_EVENT_ACTOR.BROKER;
  const who = matchPartyName(eventParty(e.eventType));
  const choice = text(e.payload.label);
  switch (e.eventType) {
    case MATCH_EVENT_TYPE.LINK_OPENED: return `${matchPartyName(e.actorType)} فتح رابط المطابقة`;
    case MATCH_EVENT_TYPE.BROKER_MESSAGE: return `رسالة الوسيط إلى ${matchPartyName(e.recipient)}`;
    case MATCH_EVENT_TYPE.BROKER_INTERNAL_NOTE: return "ملاحظة داخلية";
    case MATCH_EVENT_TYPE.WHATSAPP_OPENED: return `تم فتح واتساب ل${e.recipient === "owner" ? "لمالك" : "لعميل"}`;
    case MATCH_EVENT_TYPE.AGREEMENT_UPDATED: return `تحديث الاتفاق: ${text(e.payload.fieldLabel)}`;
    case MATCH_EVENT_TYPE.MATCH_AGREED: return "تم الاتفاق";
    case MATCH_EVENT_TYPE.MATCH_CLOSED_NO_AGREEMENT: return "أُغلقت المطابقة دون اتفاق";
    case MATCH_EVENT_TYPE.MATCH_CLOSED: return "أُغلقت المطابقة";
    case MATCH_EVENT_TYPE.CLIENT_MESSAGE_RESPONSE:
    case MATCH_EVENT_TYPE.OWNER_MESSAGE_RESPONSE:
      return `ردّ ${matchPartyName(e.actorType)} على رسالة الوسيط: ${text(e.payload.responseLabel)}`;
    default: break;
  }
  if (!isPartyChoiceEvent(e.eventType)) return "";
  if (byBroker) return `سجّل الوسيط خيار ${who}: ${choice}`;
  if (e.eventType === MATCH_EVENT_TYPE.OWNER_NEEDS_TIME) return "المالك طلب وقتًا للرد";
  if (e.eventType === MATCH_EVENT_TYPE.CLIENT_NEEDS_TIME) return "العميل طلب وقتًا للرد";
  if (e.eventType === MATCH_EVENT_TYPE.CLIENT_VIEWING_REQUESTED) return "العميل طلب معاينة";
  if (e.eventType === MATCH_EVENT_TYPE.OWNER_VIEWING_RESPONSE) return "المالك وافق على المعاينة";
  return `${who} اختار: ${choice}`;
}

/** Status of an event: what actually happened, never an assumed delivery. */
export function matchEventStatusLabel(event = {}) {
  const e = normalizeMatchEvent(event);
  if (!e) return "";
  if (e.eventType === MATCH_EVENT_TYPE.BROKER_MESSAGE) return e.recipient === "both" ? "ظاهرة في رابط الطرفين" : `ظاهرة في رابط ${matchPartyName(e.recipient)}`;
  if (e.eventType === MATCH_EVENT_TYPE.BROKER_INTERNAL_NOTE) return "داخلية — لا تُرسل لأي طرف";
  if (e.eventType === MATCH_EVENT_TYPE.WHATSAPP_OPENED) return "تم فتح واتساب";
  if (e.eventType === MATCH_EVENT_TYPE.LINK_OPENED) return "فُتح الرابط — لا يعني القراءة أو الموافقة";
  if (e.actorType === MATCH_EVENT_ACTOR.BROKER) return "سجّله الوسيط";
  if (e.actorType === MATCH_EVENT_ACTOR.CLIENT || e.actorType === MATCH_EVENT_ACTOR.OWNER) return `من رابط ${matchPartyName(e.actorType)}`;
  return "تم التسجيل";
}

export function matchEventLogRow(event = {}) {
  const e = normalizeMatchEvent(event);
  if (!e) return null;
  const recipient = e.eventType === MATCH_EVENT_TYPE.BROKER_INTERNAL_NOTE ? "داخلي"
    : e.recipient ? matchPartyName(e.recipient)
      : isPartyChoiceEvent(e.eventType) ? "الوسيط" : "";
  return {
    eventId: e.eventId,
    eventType: e.eventType,
    actorType: e.actorType,
    title: matchEventLabel(e),
    message: text(e.payload.message || e.payload.condition || e.payload.responseText || (e.eventType === MATCH_EVENT_TYPE.AGREEMENT_UPDATED ? e.payload.value : "")),
    messageKind: e.eventType === MATCH_EVENT_TYPE.BROKER_MESSAGE ? messageKindOf(e.payload.messageKind) : "",
    requiresReply: e.eventType === MATCH_EVENT_TYPE.BROKER_MESSAGE && e.payload.requiresReply === true,
    replyToEventId: text(e.payload.replyToEventId),
    recipient,
    statusLabel: matchEventStatusLabel(e),
    createdAt: e.createdAt
  };
}

export function emptyMatchState() {
  return {
    client: null,
    owner: null,
    agreement: {},
    lifecycle: MATCH_LIFECYCLE.ACTIVE,
    clientSendCount: 0,
    ownerSendCount: 0,
    messageCount: 0,
    internalNoteCount: 0,
    eventCount: 0,
    lastEvent: null,
    lastPartyEvent: null
  };
}

/** Folds one event into the current state (used incrementally by the Worker). */
export function applyMatchEventToState(previous = null, event = {}) {
  const e = normalizeMatchEvent(event);
  const state = { ...emptyMatchState(), ...(previous || {}) };
  state.agreement = { ...(state.agreement || {}) };
  if (!e) return state;
  const side = eventParty(e.eventType);
  if (side) {
    state[side] = { choiceId: text(e.payload.choiceId), label: text(e.payload.label), eventType: e.eventType, actorType: e.actorType, createdAt: e.createdAt };
  }
  if (e.eventType === MATCH_EVENT_TYPE.WHATSAPP_OPENED && e.payload.handoff !== "notification") {
    if (e.recipient === "owner") state.ownerSendCount += 1;
    if (e.recipient === "client") state.clientSendCount += 1;
  }
  if (e.eventType === MATCH_EVENT_TYPE.BROKER_MESSAGE) state.messageCount += 1;
  if (e.eventType === MATCH_EVENT_TYPE.BROKER_INTERNAL_NOTE) state.internalNoteCount += 1;
  if (e.eventType === MATCH_EVENT_TYPE.AGREEMENT_UPDATED && text(e.payload.field)) {
    state.agreement[text(e.payload.field)] = { value: text(e.payload.value), label: text(e.payload.fieldLabel), updatedAt: e.createdAt, actorType: e.actorType };
  }
  if (e.eventType === MATCH_EVENT_TYPE.MATCH_AGREED) state.lifecycle = MATCH_LIFECYCLE.AGREED;
  if (e.eventType === MATCH_EVENT_TYPE.MATCH_CLOSED_NO_AGREEMENT) state.lifecycle = MATCH_LIFECYCLE.CLOSED_NO_AGREEMENT;
  if (e.eventType === MATCH_EVENT_TYPE.MATCH_CLOSED) state.lifecycle = MATCH_LIFECYCLE.CLOSED;
  if (e.eventType !== MATCH_EVENT_TYPE.BROKER_INTERNAL_NOTE) state.lastEvent = e;
  if (e.actorType === MATCH_EVENT_ACTOR.CLIENT || e.actorType === MATCH_EVENT_ACTOR.OWNER) state.lastPartyEvent = e;
  state.eventCount += 1;
  return state;
}

/** Current state derived from the history: latest choice per party, agreement, lifecycle, sends. */
export function projectMatchEvents(raw = [], { matchStatus = "" } = {}) {
  const state = parseMatchEvents(raw).reduce((acc, event) => applyMatchEventToState(acc, event), emptyMatchState());
  const status = text(matchStatus).toLowerCase();
  if (state.lifecycle === MATCH_LIFECYCLE.ACTIVE && (status === "closed" || status === "completed")) state.lifecycle = MATCH_LIFECYCLE.CLOSED;
  return state;
}

export function parseMatchState(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return { ...emptyMatchState(), ...raw };
  try { return { ...emptyMatchState(), ...JSON.parse(String(raw)) }; } catch { return null; }
}

/** Party-side events that count as unread for the broker. */
export function brokerUnreadCount(raw = [], seenAt = "") {
  const since = text(seenAt);
  return parseMatchEvents(raw).filter((e) => (e.actorType === MATCH_EVENT_ACTOR.CLIENT || e.actorType === MATCH_EVENT_ACTOR.OWNER)
    && (!since || e.createdAt > since)).length;
}

export function unreadUpdatesLabel(count = 0) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  return n === 1 ? "1 تحديث جديد" : `${n} تحديثات جديدة`;
}

export function relativeTimeLabel(iso = "", now = new Date()) {
  const at = Date.parse(text(iso));
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.floor(((now instanceof Date ? now : new Date(now)).getTime() - at) / 60000));
  if (minutes < 1) return "الآن";
  if (minutes === 1) return "قبل دقيقة";
  if (minutes === 2) return "قبل دقيقتين";
  if (minutes < 11) return `قبل ${minutes} دقائق`;
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "قبل ساعة";
  if (hours === 2) return "قبل ساعتين";
  if (hours < 24) return `قبل ${hours} ساعات`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "قبل يوم" : `قبل ${days} أيام`;
}

/** "العميل مهتم — الآن" style line for the latest meaningful update. */
export function lastUpdateLine(raw = [], now = new Date()) {
  const { lastEvent } = projectMatchEvents(raw);
  if (!lastEvent) return "";
  const time = relativeTimeLabel(lastEvent.createdAt, now);
  return [matchEventLabel(lastEvent), time].filter(Boolean).join(" — ");
}

/** What a party may see on its own link: never internal notes or the other party's link activity. */
export function partyVisibleEvents(raw = [], side = "client") {
  const who = party(side) || "client";
  const events = parseMatchEvents(raw);
  const messages = new Map(events.filter((e) => e.eventType === MATCH_EVENT_TYPE.BROKER_MESSAGE).map((e) => [e.eventId, e]));
  const messageVisible = (message) => Boolean(message) && (message.recipient === who || message.recipient === "both");
  return events.filter((e) => {
    if (e.eventType === MATCH_EVENT_TYPE.BROKER_INTERNAL_NOTE) return false;
    if (e.eventType === MATCH_EVENT_TYPE.WHATSAPP_OPENED || e.eventType === MATCH_EVENT_TYPE.LINK_OPENED) return false;
    if (e.eventType === MATCH_EVENT_TYPE.BROKER_MESSAGE) return messageVisible(e);
    // A reply is visible to its author and to whoever can see the message it answers.
    if (isMessageResponseEvent(e.eventType)) return e.actorType === who || messageVisible(messages.get(text(e.payload.replyToEventId)));
    return true;
  });
}

/**
 * Broker messages as a conversation: each message with its reply options and the
 * replies attached to it (latest reply per party is that party's current answer).
 */
export function messageThreads(raw = [], { viewer = "broker" } = {}) {
  const events = parseMatchEvents(raw);
  const who = viewer === "client" || viewer === "owner" ? viewer : "broker";
  const threads = events.filter((e) => e.eventType === MATCH_EVENT_TYPE.BROKER_MESSAGE)
    .filter((e) => who === "broker" || e.recipient === who || e.recipient === "both")
    .map((e) => {
      const recipients = e.recipient === "both" ? ["client", "owner"] : [e.recipient];
      const responses = events.filter((r) => isMessageResponseEvent(r.eventType) && text(r.payload.replyToEventId) === e.eventId)
        .map((r) => ({ eventId: r.eventId, party: r.actorType, responseId: text(r.payload.responseId), responseLabel: text(r.payload.responseLabel), responseText: text(r.payload.responseText), createdAt: r.createdAt }));
      const latest = {};
      for (const response of responses) latest[response.party] = response;
      const requiresReply = e.payload.requiresReply === true;
      return {
        eventId: e.eventId,
        message: text(e.payload.message),
        messageKind: messageKindOf(e.payload.messageKind),
        kindLabel: messageKindLabel(e.payload.messageKind),
        recipient: e.recipient,
        recipients,
        requiresReply,
        replyOptions: requiresReply ? replyOptionsFor(e.payload.messageKind) : [],
        createdAt: e.createdAt,
        responses,
        latestByParty: latest,
        canReply: requiresReply && who !== "broker" && recipients.includes(who),
        myResponse: who !== "broker" ? latest[who] || null : null
      };
    });
  return threads;
}

export function partyEventLabel(event = {}, side = "client") {
  const e = normalizeMatchEvent(event);
  if (!e) return "";
  const who = party(side) || "client";
  const other = eventParty(e.eventType);
  if (e.eventType === MATCH_EVENT_TYPE.BROKER_MESSAGE) return "رسالة من الوسيط";
  if (isMessageResponseEvent(e.eventType)) return e.actorType === who ? `ردك: ${text(e.payload.responseLabel)}` : matchEventLabel(e);
  if (isPartyChoiceEvent(e.eventType) && other === who && e.actorType === who) return `اخترت: ${text(e.payload.label)}`;
  return matchEventLabel(e);
}

/**
 * Who is notified, on which channel, for one event. WhatsApp is a handoff for the
 * broker to open (wa.me); the platform has no outbound gateway.
 */
export function notificationRoutes(event = {}) {
  const e = normalizeMatchEvent(event);
  if (!e) return [];
  const routes = [];
  const fromParty = e.actorType === MATCH_EVENT_ACTOR.CLIENT || e.actorType === MATCH_EVENT_ACTOR.OWNER;
  const otherParty = e.actorType === MATCH_EVENT_ACTOR.CLIENT ? "owner" : e.actorType === MATCH_EVENT_ACTOR.OWNER ? "client" : "";
  const notifyOther = new Set([
    MATCH_EVENT_TYPE.CLIENT_INTERESTED, MATCH_EVENT_TYPE.CLIENT_VIEWING_REQUESTED, MATCH_EVENT_TYPE.CLIENT_PRELIMINARY_AGREEMENT, MATCH_EVENT_TYPE.CLIENT_CONDITION_CHANGED,
    MATCH_EVENT_TYPE.OWNER_INTERESTED, MATCH_EVENT_TYPE.OWNER_NEEDS_TIME, MATCH_EVENT_TYPE.OWNER_VIEWING_RESPONSE, MATCH_EVENT_TYPE.OWNER_PRELIMINARY_AGREEMENT, MATCH_EVENT_TYPE.OWNER_CONDITION_CHANGED,
    MATCH_EVENT_TYPE.AGREEMENT_UPDATED
  ]);
  if (fromParty && e.eventType !== MATCH_EVENT_TYPE.LINK_OPENED) {
    routes.push({ recipient: "broker", channel: NOTIFICATION_CHANNEL.FCM });
    if (otherParty && notifyOther.has(e.eventType)) routes.push({ recipient: otherParty, channel: NOTIFICATION_CHANNEL.WHATSAPP });
  }
  if (e.actorType === MATCH_EVENT_ACTOR.BROKER && e.eventType === MATCH_EVENT_TYPE.BROKER_MESSAGE) {
    if (e.recipient === "client" || e.recipient === "both") routes.push({ recipient: "client", channel: NOTIFICATION_CHANNEL.WHATSAPP });
    if (e.recipient === "owner" || e.recipient === "both") routes.push({ recipient: "owner", channel: NOTIFICATION_CHANNEL.WHATSAPP });
  }
  if (e.actorType === MATCH_EVENT_ACTOR.BROKER && e.eventType === MATCH_EVENT_TYPE.AGREEMENT_UPDATED) {
    routes.push({ recipient: "client", channel: NOTIFICATION_CHANNEL.WHATSAPP }, { recipient: "owner", channel: NOTIFICATION_CHANNEL.WHATSAPP });
  }
  return routes;
}

/** Idempotency key: one notification per matchId + eventId + recipient + channel. */
export function notificationDedupeKey({ matchId = "", eventId = "", recipient = "", channel = "" } = {}) {
  return [text(matchId), text(eventId), text(recipient).toLowerCase(), text(channel).toLowerCase()].join("|");
}

export function brokerNotificationText(event = {}) {
  const e = normalizeMatchEvent(event);
  if (!e) return "";
  return matchEventLabel(e);
}

export function partyWhatsAppText(event = {}, recipient = "client", { officeName = "", reviewUrl = "" } = {}) {
  const e = normalizeMatchEvent(event);
  if (!e) return "";
  const head = officeName ? `${text(officeName)}:` : "";
  let body = "";
  if (e.eventType === MATCH_EVENT_TYPE.BROKER_MESSAGE) body = `رسالة من الوسيط بخصوص العقار:\n${text(e.payload.message)}`;
  else if (e.eventType === MATCH_EVENT_TYPE.AGREEMENT_UPDATED) body = `تم تحديث الاتفاق (${text(e.payload.fieldLabel)}): ${text(e.payload.value)}`;
  else body = `تحديث من ${matchPartyName(e.actorType)}: ${text(e.payload.label) || matchEventLabel(e)}`;
  return [head, body, reviewUrl ? `رابط المتابعة: ${reviewUrl}` : ""].filter(Boolean).join("\n");
}
