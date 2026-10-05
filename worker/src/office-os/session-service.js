/**
 * غرفة التفاوض — live negotiation session per deal (journey).
 *
 * Links: `${appOrigin}/s#${token}` — one per role (owner, client), 256-bit random
 * token in the URL fragment. Lookup by sha256(token) in the server-only
 * `sessionLinks` collection; the broker can re-read the current link through
 * `sessionLinkSecrets` (also server-only). A link works for the whole deal, can be
 * replaced (the old one stops at once) and stops when the deal closes.
 *
 * Every party move is validated against availableActions() on the latest journey
 * inside the same read-modify-write, so a stale page can never apply a move that is
 * no longer allowed. Replays with the same submission id are no-ops.
 */

import {
  OTHER_ACTIONS, PRICE_MOVES, ROLE_LABEL, SESSION_ROLE, SESSION_STAGES, availableActions, eventVisibleTo,
  isOpenJourney, moveText, parseTypedPrice, sessionEventCard, sessionPrices, sessionStage, sessionStageLabel
} from "../../../public/os/domain/session-domain.js";
import { EVENT_SOURCE, VIEWING_STATE } from "../../../public/os/domain/journey-domain.js";
import {
  PHASE, PRICE_STATUS_LABEL, VIEWING_MINUTES, availableSlots, brokerBusy, checkBrokerAvailability,
  isOfferedSlot, journeyPhase, priceStatusOf
} from "../../../public/os/domain/deal-flow-domain.js";
import { buildWhatsAppUrl, cleanText, formatDateTime, formatPrice, localPhone, parseRiyadhLocal, toDate } from "../../../public/os/domain/format-domain.js";
import {
  MAX_REQUEST_TEXT, REQUEST_DECISIONS, REQUEST_KIND, ROOM_ACTIONS, awaitingParties, canMarkReady, canSendRequest, infoTopicLabel,
  partyStatus, planTermAction, propertyFacts, readiness, relaySafeText, reminderText, requestView, requestsOf, roomAgreedItems, roomMoveText,
  roomSchema, termRows
} from "../../../public/os/domain/negotiation-room-domain.js";
import { keyBelongsTo, recordImages } from "../../../public/os/domain/record-media-domain.js";
import { newReplyToken, isReplyTokenShape } from "./proposal-service.js";
import { applyJourneyChange, afterJourneyClosed, loadJourney, syncMatchAppointment } from "./journey-service.js";
import { assertCanActOn } from "./permissions.js";

const ROLES = [SESSION_ROLE.OWNER, SESSION_ROLE.CLIENT];

const STATE_MESSAGES = Object.freeze({
  INVALID: "هذا الرابط غير صالح. تواصل مع المكتب للحصول على رابط جديد.",
  REPLACED: "تم استبدال هذا الرابط. استخدم الرابط الجديد الذي أرسله الوسيط.",
  CLOSED: "انتهت غرفة التفاوض لهذه الصفقة."
});

function rateLimit(ctx, route, ip) {
  const { consumePublicRateLimit, publicRateLimitKey, PUBLIC_RATE_LIMITS } = ctx.deps;
  if (typeof consumePublicRateLimit !== "function") return;
  const limits = PUBLIC_RATE_LIMITS?.PUBLIC_PARTY || { limit: 60, windowMs: 60_000 };
  const result = consumePublicRateLimit(publicRateLimitKey({ route, ip }), limits);
  if (!result.ok) throw ctx.deps.appError("rate_limited", 429, "تم تجاوز حد الطلبات مؤقتًا. حاول بعد قليل.");
}

export async function sessionHashOf(deps, token) {
  return `sl_${await deps.sha256Hex(`session-link|${token}`)}`;
}

export function sessionUrlFor(origin, token) {
  return `${String(origin || "").replace(/\/+$/, "")}/s#${token}`;
}

function secretId(officeId, journeyId, role) {
  return `${officeId}__${journeyId}__${role}`;
}

function journeyIdOf(journey) {
  return journey.journeyId || journey.id;
}

function recordIdFor(journey, role) {
  return role === SESSION_ROLE.OWNER ? journey.offerId : journey.requestId;
}

// ---------------------------------------------------------------- broker side

async function loadOwnJourney(ctx, { actor, officeId, journeyId }) {
  const journey = await loadJourney(ctx, officeId, journeyId);
  assertCanActOn(ctx.deps, actor, journey);
  return journey;
}

async function issueLink(ctx, { officeId, journey, role, now }) {
  const journeyId = journeyIdOf(journey);
  const token = newReplyToken();
  const hash = await sessionHashOf(ctx.deps, token);
  await ctx.store.set(["sessionLinks", hash], { officeId, journeyId, role, status: "ACTIVE", createdAt: now, updatedAt: now });
  await ctx.store.set(["sessionLinkSecrets", secretId(officeId, journeyId, role)], { officeId, journeyId, role, token, hash, createdAt: now });
  return { token, hash };
}

/**
 * Current links for the broker; creates the missing ones. `replace` = role whose link
 * is revoked and re-issued.
 */
export async function sessionLinks(ctx, { actor, officeId, journeyId, replace = "" }) {
  const journey = await loadOwnJourney(ctx, { actor, officeId, journeyId });
  if (!isOpenJourney(journey)) throw ctx.deps.appError("journey_closed", 409, "الصفقة مغلقة — لا يمكن إصدار روابط جديدة");
  const now = ctx.now();
  const links = { ...(journey.sessionLinks || {}) };
  const out = {};
  let changed = false;
  for (const role of ROLES) {
    const secret = await ctx.store.get(["sessionLinkSecrets", secretId(officeId, journeyId, role)]);
    let token = secret?.token || "";
    let hash = secret?.hash || "";
    if (token && replace === role) {
      await ctx.store.set(["sessionLinks", hash], { status: "REPLACED", updatedAt: now });
      token = "";
    }
    if (!token || !isReplyTokenShape(token)) {
      ({ token, hash } = await issueLink(ctx, { officeId, journey, role, now }));
      links[role] = { hash, createdAt: now.toISOString(), replacedAt: replace === role ? now.toISOString() : null };
      changed = true;
    }
    const record = await ctx.store.get(["offices", officeId, "opportunities", recordIdFor(journey, role)]);
    const url = sessionUrlFor(ctx.appOrigin, token);
    const text = sessionInviteText({ role, url, journey });
    out[role] = {
      url,
      whatsappUrl: buildWhatsAppUrl(record?.contactPhone || record?.advertiserPhoneNormalized || record?.phone, text),
      hasPhone: Boolean(localPhone(record?.contactPhone || record?.advertiserPhoneNormalized || record?.phone)),
      text,
      opened: Boolean(journey.session?.opened?.[role]),
      // True when the deal is waiting for this side's answer (reminder: in the app now, WhatsApp API later).
      awaiting: awaitingParties(journey, now).includes(role)
    };
  }
  if (changed) {
    await applyJourneyChange(ctx, {
      officeId, journeyId, actor,
      mutate: () => ({ sessionLinks: links }),
      event: replace
        ? { type: "SESSION_LINK", key: ["replace", replace, now.toISOString()], text: `تم استبدال رابط غرفة ${ROLE_LABEL[replace]} — الرابط السابق لم يعد يعمل`, payload: { role: replace, audience: "broker" } }
        : { type: "SESSION_LINK", key: ["issue", Object.keys(links).sort().join(",")], text: "تم إنشاء روابط غرفة التفاوض للمالك والعميل", payload: { audience: "broker" } }
    });
  }
  return { ok: true, links: out };
}

function sessionInviteText({ role, url, journey }) {
  // Once an answer is expected from this side, the same link goes out as a reminder of what is waiting.
  return reminderText(journey, role, url);
}

export async function recordSessionHandoff(ctx, { actor, officeId, journeyId, role }) {
  if (!ROLES.includes(role)) throw ctx.deps.appError("role_invalid", 400, "حدد الطرف");
  await loadOwnJourney(ctx, { actor, officeId, journeyId });
  const now = ctx.now();
  return applyJourneyChange(ctx, {
    officeId, journeyId, actor,
    mutate: () => ({}),
    event: { type: "WHATSAPP_OPENED", key: ["session-link", role, now.toISOString().slice(0, 16)], text: `تم فتح واتساب لإرسال رابط الغرفة إلى ${ROLE_LABEL[role]} — فتح واتساب لا يعني وصول الرابط`, payload: { role, audience: "broker" } }
  });
}

/** Broker free text: the only free text in the session. One party or both. */
export async function sendBrokerMessage(ctx, { actor, officeId, journeyId, audience, text, requestKey = "" }) {
  const journey = await loadOwnJourney(ctx, { actor, officeId, journeyId });
  if (!isOpenJourney(journey)) throw ctx.deps.appError("journey_closed", 409, "الصفقة مغلقة");
  const target = audience === "both" ? "all" : ROLES.includes(audience) ? audience : "";
  if (!target) throw ctx.deps.appError("audience_required", 400, "اختر: إلى المالك، إلى العميل، أو إلى الطرفين");
  const message = cleanText(text, 500);
  if (message.length < 2) throw ctx.deps.appError("message_required", 400, "اكتب الرسالة");
  const to = target === "all" ? "الطرفين" : ROLE_LABEL[target];
  return applyJourneyChange(ctx, {
    officeId, journeyId, actor,
    mutate: (j) => ({ session: { ...(j.session || {}), lastBrokerMessageAt: ctx.now().toISOString() } }),
    event: {
      type: "SESSION_BROKER_MESSAGE", key: [requestKey || ctx.now().toISOString(), target], source: EVENT_SOURCE.BROKER,
      text: `رسالة الوسيط إلى ${to}: ${message}`, payload: { audience: target, text: message }
    }
  });
}

/** Broker handled the intervention request: the session is no longer flagged. */
export async function resolveIntervention(ctx, { actor, officeId, journeyId }) {
  const journey = await loadOwnJourney(ctx, { actor, officeId, journeyId });
  if (!journey.session?.intervention?.required) return { journey, changed: false };
  const now = ctx.now();
  return applyJourneyChange(ctx, {
    officeId, journeyId, actor,
    finish: (task) => task.type === "SESSION_INTERVENTION",
    mutate: (j) => (j.session?.intervention?.required
      ? { session: {
        ...(j.session || {}),
        intervention: { ...(j.session.intervention || {}), required: false, resolvedAt: now.toISOString(), resolvedBy: actor.uid },
        requests: requestsOf(j).map((item) => (String(item.status || "OPEN") === "OPEN" ? { ...item, status: "HANDLED", decision: "handled", handledAt: now.toISOString(), handledBy: actor.uid } : item))
      } }
      : null),
    // Only the side that asked (and the broker) sees that its request was followed up.
    event: { type: "SESSION_RESOLVED", key: ["resolved", j2key(journey)], text: "تابع الوسيط طلب التدخل", payload: { audience: ROLES.includes(journey.session?.intervention?.by) ? journey.session.intervention.by : "broker" } }
  });
}

/**
 * The broker's decision on one request from a side (intervention or information):
 *   forward  → pass its content to the other side, marked as passed on by the broker
 *   rephrase → send the broker's own wording to the other side
 *   reply    → answer the sender only
 *   dismiss  → not passed on
 *   handled  → dealt with inside the deal
 * Nothing reaches the other side unless the broker chooses so. Every decision is logged.
 */
export async function handleSessionRequest(ctx, { actor, officeId, journeyId, requestId, decision, text = "", requestKey = "" }) {
  const journey = await loadOwnJourney(ctx, { actor, officeId, journeyId });
  const choice = Object.hasOwn(REQUEST_DECISIONS, String(decision || "")) ? REQUEST_DECISIONS[String(decision)] : null;
  if (!choice) throw ctx.deps.appError("decision_invalid", 400, "اختر الإجراء على الطلب");
  const request = requestsOf(journey).find((item) => String(item.id) === String(requestId || ""));
  if (!request) throw ctx.deps.appError("request_not_found", 404, "الطلب غير موجود في هذه الصفقة");
  if (String(request.status || "OPEN") !== "OPEN") return { journey, changed: false, duplicate: true };
  const view = requestView(journey, request);
  const now = ctx.now();
  const other = request.role === SESSION_ROLE.OWNER ? SESSION_ROLE.CLIENT : SESSION_ROLE.OWNER;
  let outgoing = "";
  let target = "";
  if (choice.id === "forward") {
    // Passed on without phone numbers or links; the wording stays the sender's.
    outgoing = relaySafeText(view.kind === REQUEST_KIND.INFO ? `يستفسر عن: ${view.topic}` : view.text);
    if (outgoing.length < 2) throw ctx.deps.appError("request_empty", 409, "لا يوجد نص لتمريره — اكتب رسالتك بدلًا من ذلك");
    target = other;
  } else if (choice.needsText) {
    outgoing = cleanText(text, MAX_REQUEST_TEXT);
    if (outgoing.length < 2) throw ctx.deps.appError("message_required", 400, "اكتب الرسالة");
    target = choice.to === "sender" ? request.role : other;
  }
  if (target && !isOpenJourney(journey)) throw ctx.deps.appError("journey_closed", 409, "الصفقة مغلقة");
  // The request is closed first, under a guard: of two presses (or two brokers) only one decides,
  // so a request can never be both passed on and answered.
  const marked = await applyJourneyChange(ctx, {
    officeId, journeyId, actor,
    finish: (task) => task.type === "SESSION_INTERVENTION" && task.ref === `request:${request.id}`,
    mutate: (j) => {
      const list = requestsOf(j);
      const current = list.find((item) => String(item.id) === String(request.id));
      if (!current || String(current.status || "OPEN") !== "OPEN") return null;
      const requests = list.map((item) => (item === current ? { ...item, status: "HANDLED", decision: choice.id, handledAt: now.toISOString(), handledBy: actor.uid } : item));
      const stillAsking = requests.some((item) => item.kind === REQUEST_KIND.INTERVENTION && String(item.status || "OPEN") === "OPEN");
      const intervention = stillAsking ? j.session?.intervention : { ...(j.session?.intervention || {}), required: false, resolvedAt: now.toISOString(), resolvedBy: actor.uid };
      return { session: { ...(j.session || {}), requests, intervention } };
    },
    event: {
      type: "SESSION_REQUEST_HANDLED", key: ["request-handled", request.id], source: EVENT_SOURCE.BROKER,
      text: `قرار الوسيط في ${view.kindLabel} من ${view.roleLabel}: ${choice.label}`,
      // Seen by the broker and the side that asked; the other side learns only what the broker chose to pass on.
      payload: { audience: request.role, requestRole: request.role, requestId: String(request.id), kind: view.kind, decision: choice.id, prev: "OPEN", next: "HANDLED" }
    }
  });
  if (!marked.changed) return { journey: marked.journey, changed: false, duplicate: true };
  if (target) {
    const relayedFrom = choice.id === "forward" ? request.role : "";
    try {
      await applyJourneyChange(ctx, {
        officeId, journeyId, actor,
        mutate: (j) => ({ session: { ...(j.session || {}), lastBrokerMessageAt: now.toISOString() } }),
        event: {
          type: "SESSION_BROKER_MESSAGE", key: ["request", request.id], source: EVENT_SOURCE.BROKER,
          text: relayedFrom ? `نقل الوسيط إلى ${ROLE_LABEL[target]} عن ${ROLE_LABEL[relayedFrom]}: ${outgoing}` : `رسالة الوسيط إلى ${ROLE_LABEL[target]}: ${outgoing}`,
          payload: { audience: target, text: outgoing, relayedFrom, requestId: String(request.id), via: "broker" }
        }
      });
    } catch (error) {
      console.error("[office-os] request message failed", error?.code, error?.message);
      throw ctx.deps.appError("request_message_failed", 502, "سُجّل قرارك لكن تعذر إرسال الرسالة — أرسلها من مربع الرسائل أسفل الصفحة.");
    }
  }
  return marked;
}

function j2key(journey) {
  return String(journey.session?.intervention?.at || "");
}

// ---------------------------------------------------------------- party side

async function resolveLink(ctx, token) {
  if (!isReplyTokenShape(token)) return { state: "INVALID" };
  const hash = await sessionHashOf(ctx.deps, token);
  const link = await ctx.store.get(["sessionLinks", hash]);
  if (!link?.officeId || !link.journeyId || !ROLES.includes(link.role)) return { state: "INVALID" };
  if (link.status === "REPLACED" || link.status === "REVOKED") return { state: "REPLACED", link };
  const journey = await ctx.store.get(["offices", link.officeId, "journeys", link.journeyId]);
  if (!journey || String(journey.officeId || "") !== link.officeId) return { state: "INVALID" };
  if (journey.sessionLinks?.[link.role]?.hash && journey.sessionLinks[link.role].hash !== hash) return { state: "REPLACED", link };
  const state = link.status === "CLOSED" || !isOpenJourney(journey) ? "CLOSED" : "ACTIVE";
  return { state, link, journey: { ...journey, journeyId: journey.journeyId || link.journeyId }, hash };
}

async function officeCard(ctx, officeId) {
  const office = (await ctx.store.get(["publicOffices", officeId])) || {};
  return {
    officeName: cleanText(office.officeName, 80),
    licenseNumber: cleanText(office.licenseNumber, 20),
    logoUrl: /^https:\/\//.test(String(office.logoUrl || "")) ? String(office.logoUrl) : ""
  };
}

/** The assigned broker's booked viewings across the office (other deals only). */
export async function brokerCalendar(ctx, officeId, journey) {
  const journeys = await ctx.store.list(["offices", officeId, "journeys"], 300);
  return brokerBusy(journeys, journey.assignedBrokerId, { exceptJourneyId: journeyIdOf(journey) });
}

/** Short property description for the parties: no phone numbers or links. */
function safeDescription(text) {
  return cleanText(String(text || "").replace(/https?:\/\/\S+/g, "").replace(/[+\d][\d\s-]{6,}\d/g, "").replace(/\s{2,}/g, " "), 160);
}

function sideOf(journey, role) {
  const prices = sessionPrices(journey);
  const entry = journey.session?.prices?.[role];
  const last = journey.session?.lastMove?.role === role ? journey.session.lastMove : entry;
  return {
    price: prices[role] || null,
    lastText: last?.move ? moveText(last.move, { pct: PRICE_MOVES[last.move]?.pct }) : role === SESSION_ROLE.OWNER ? "السعر المطلوب" : "الميزانية",
    lastAt: last?.at || null
  };
}

/** The first photo of this deal's offer, only when it is one of that record's own stored photos. */
async function coverImageOf(ctx, officeId, journey) {
  if (!journey.offerId) return null;
  const record = await ctx.store.get(["offices", officeId, "opportunities", journey.offerId]).catch(() => null);
  const first = record ? recordImages(record)[0] : null;
  return first && keyBelongsTo(first.path, officeId, journey.offerId) ? first : null;
}

/**
 * POST /os/session/image { token } → the main photo of the room's property (bytes).
 * Scoped by the party's own link; works while the link is valid (also after the deal closed).
 */
export async function sessionImage(ctx, { token, ip = "unknown" }) {
  rateLimit(ctx, "os/session/image", ip);
  const resolved = await resolveLink(ctx, token);
  if (resolved.state !== "ACTIVE" && resolved.state !== "CLOSED") return null;
  const cover = await coverImageOf(ctx, resolved.link.officeId, resolved.journey);
  const bucket = ctx.deps.mediaBucket;
  if (!cover || !bucket) return null;
  const object = await bucket.get(cover.path);
  if (!object) return null;
  return { body: object.body, contentType: /^image\/(jpeg|png|webp)$/.test(cover.contentType) ? cover.contentType : "image/jpeg" };
}

/** What the party sees. Nothing about the other party beyond «المالك»/«العميل». */
async function partyView(ctx, { journey, role, officeId }) {
  const offer = journey.offerSummary || {};
  const prices = sessionPrices(journey);
  const events = await ctx.store.list(["offices", officeId, "journeys", journeyIdOf(journey), "events"], 300);
  const cards = events
    .filter((event) => eventVisibleTo(event, role))
    .sort((a, b) => (toDate(b.createdAt || b.at)?.getTime() || 0) - (toDate(a.createdAt || a.at)?.getTime() || 0))
    .slice(0, 60)
    .map((event) => {
      const card = sessionEventCard(event, role);
      return { id: card.id, who: card.who, text: card.text, detail: card.detail, at: toDate(card.at)?.toISOString() || null, mine: card.mine, actor: card.actor };
    });
  const now = ctx.now();
  const available = availableActions(journey, role, { now });
  const needsSlots = available.actions.some((a) => a.typed === "slot");
  const slots = needsSlots ? availableSlots(await brokerCalendar(ctx, officeId, journey), now) : [];
  const schema = roomSchema(journey);
  // The main photo of the offer. The page gets it through its own link (POST /os/session/image),
  // so no office or record id ever appears in the party's page.
  const cover = await coverImageOf(ctx, officeId, journey);
  const image = cover ? `v${(await ctx.deps.sha256Hex(`room-image|${cover.id}`)).slice(0, 12)}` : "";
  const ready = readiness(journey);
  const other = role === SESSION_ROLE.OWNER ? SESSION_ROLE.CLIENT : SESSION_ROLE.OWNER;
  const room = {
    family: schema.family, familyLabel: schema.familyLabel, deal: schema.deal, dealLabel: schema.dealLabel,
    priceLabel: schema.priceLabel, viewingLabel: schema.viewingLabel,
    imageVersion: image,
    facts: propertyFacts(journey),
    agreed: roomAgreedItems(journey, now),
    terms: termRows(journey, role).map((row) => ({
      id: row.id, label: row.label, state: row.state, mine: row.mine, actions: row.actions, proposeLabel: row.proposeLabel,
      options: row.options, agreed: row.agreed ? { label: row.agreed.label } : null,
      // The option id travels with an answer, so a side can only accept or reject what it actually saw.
      pending: row.pending ? { option: row.pending.option, label: row.pending.label, by: row.pending.by } : null,
      rejected: row.rejected ? { label: row.rejected.label, by: row.rejected.by, proposedBy: row.rejected.proposedBy } : null
    })),
    infoTopics: canSendRequest(journey, role) ? schema.infoTopics : [],
    canRequest: canSendRequest(journey, role),
    canReady: canMarkReady(journey, role),
    ready: { mine: Boolean(ready[role]), other: Boolean(ready[other]), both: ready.both },
    status: { owner: partyStatus(journey, SESSION_ROLE.OWNER, { now }), client: partyStatus(journey, SESSION_ROLE.CLIENT, { now }) },
    // Only this side's own requests to the broker — never the other side's.
    requests: requestsOf(journey).filter((item) => item.role === role).slice(-5).map((item) => {
      const view = requestView(journey, item);
      return { id: view.id, kindLabel: view.kindLabel, topic: view.topic, text: view.text, at: view.at, open: view.open, statusLabel: view.open ? "لدى الوسيط" : "تابعه الوسيط" };
    })
  };
  return {
    room,
    role,
    roleLabel: ROLE_LABEL[role],
    property: {
      propertyType: cleanText(offer.propertyType, 40) || "العقار",
      district: cleanText(offer.district, 80),
      city: cleanText(offer.city, 60),
      area: Number(offer.area || 0) || null,
      price: Number(offer.price || 0) || null,
      description: safeDescription(offer.notes),
      priceStatus: priceStatusOf(journey),
      priceStatusLabel: PRICE_STATUS_LABEL[priceStatusOf(journey)]
    },
    dealPhase: available.dealPhase || journeyPhase(journey, now),
    agreed: room.agreed,
    sides: { owner: sideOf(journey, SESSION_ROLE.OWNER), client: sideOf(journey, SESSION_ROLE.CLIENT) },
    slots,
    currentPrice: prices.current || null,
    agreedPrice: prices.agreed || null,
    stage: sessionStage(journey),
    stageLabel: sessionStageLabel(journey),
    stages: SESSION_STAGES,
    // A request to the broker is between its sender and the broker: the other side is not told.
    intervention: Boolean(journey.session?.intervention?.required) && journey.session.intervention.by === role,
    viewingAt: available.viewingAt || null,
    phase: available.phase,
    waiting: Boolean(available.waiting),
    note: available.note || "",
    actions: available.actions,
    events: cards,
    version: String(journey.updatedAt ? toDate(journey.updatedAt)?.toISOString() : "") + String(cards[0]?.id || "")
  };
}

export async function viewSession(ctx, { token, ip = "unknown" }) {
  rateLimit(ctx, "os/session/view", ip);
  const resolved = await resolveLink(ctx, token);
  if (resolved.state === "INVALID" || resolved.state === "REPLACED") {
    return { ok: false, state: resolved.state, message: STATE_MESSAGES[resolved.state] };
  }
  const { link, journey } = resolved;
  const office = await officeCard(ctx, link.officeId);
  const view = await partyView(ctx, { journey, role: link.role, officeId: link.officeId });
  if (resolved.state === "ACTIVE" && !journey.session?.opened?.[link.role]) {
    const now = ctx.now();
    await applyJourneyChange(ctx, {
      officeId: link.officeId, journeyId: journeyIdOf(journey), actor: null,
      mutate: (j) => (j.session?.opened?.[link.role] ? null : { session: { ...(j.session || {}), opened: { ...(j.session?.opened || {}), [link.role]: now.toISOString() } } }),
      event: { type: "SESSION_OPENED", key: [link.role, "opened"], source: EVENT_SOURCE.REPLY_LINK, actorRole: link.role, text: `فتح ${ROLE_LABEL[link.role]} رابط غرفة التفاوض`, payload: { role: link.role, audience: "broker" } }
    }).catch((error) => console.warn("[office-os] session opened", error?.message));
  }
  return { ok: true, state: resolved.state, message: resolved.state === "CLOSED" ? STATE_MESSAGES.CLOSED : "", office, session: view };
}

function cleanSubmissionId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : "";
}

/** One party action (price move, viewing answer or intervention request). */
export async function submitSessionAction(ctx, { token, action, price = "", viewingAt = "", termId = "", optionId = "", topicId = "", message = "", submissionId = "", ip = "unknown" }) {
  rateLimit(ctx, "os/session/act", ip);
  const resolved = await resolveLink(ctx, token);
  if (resolved.state !== "ACTIVE") return { ok: false, state: resolved.state, message: STATE_MESSAGES[resolved.state] || STATE_MESSAGES.INVALID };
  const { link } = resolved;
  const role = link.role;
  const officeId = link.officeId;
  const journeyId = journeyIdOf(resolved.journey);
  const actionId = String(action || "");
  if (![PRICE_MOVES, OTHER_ACTIONS, ROOM_ACTIONS].some((set) => Object.hasOwn(set, actionId))) throw ctx.deps.appError("session_action_invalid", 400, "إجراء غير معروف");
  // The one place a side may write freely: a note for the broker only, with «طلب تدخل الوسيط».
  const noteToBroker = actionId === "intervention" ? cleanText(message, MAX_REQUEST_TEXT) : "";
  const room = { termId: String(termId || "").slice(0, 40), optionId: String(optionId || "").slice(0, 40), topicId: String(topicId || "").slice(0, 40), note: noteToBroker };
  let typedPrice = 0;
  if (PRICE_MOVES[actionId]?.typed) {
    const parsed = parseTypedPrice(price);
    if (!parsed.ok) throw ctx.deps.appError("price_invalid", 400, parsed.message);
    typedPrice = parsed.price;
  }
  let typedViewing = null;
  if (actionId === "viewing_other" || actionId === "viewing_pick") {
    // Only a slot the broker's calendar offers right now (re-checked at booking too).
    typedViewing = toDate(viewingAt) || parseRiyadhLocal(viewingAt);
    const slots = availableSlots(await brokerCalendar(ctx, link.officeId, resolved.journey), ctx.now());
    if (!typedViewing || !isOfferedSlot(slots, typedViewing.toISOString())) {
      throw ctx.deps.appError("viewing_slot_unavailable", 409, "هذا الموعد غير متاح لدى الوسيط — اختر من الأوقات المتاحة.");
    }
  }
  if (actionId === "viewing_ok") {
    const at = toDate(resolved.journey.viewing?.at);
    const check = at ? checkBrokerAvailability(await brokerCalendar(ctx, link.officeId, resolved.journey), at, new Date(at.getTime() + VIEWING_MINUTES * 60 * 1000)) : { ok: false };
    if (!check.ok) throw ctx.deps.appError("viewing_conflict", 409, "هذا الموعد لم يعد متاحًا لدى الوسيط — اقترح موعدًا آخر.");
  }
  const subId = cleanSubmissionId(submissionId) || (await ctx.deps.sha256Hex(`${role}|${actionId}|${typedPrice}|${room.termId}|${room.optionId}|${room.topicId}|${ctx.now().toISOString().slice(0, 16)}`)).slice(0, 32);
  room.requestId = `rq_${(await ctx.deps.sha256Hex(`${journeyId}|${role}|${subId}`)).slice(0, 20)}`;
  const now = ctx.now();
  const who = ROLE_LABEL[role];
  const submissionKey = `${role}:${subId}`;
  if ((resolved.journey.session?.submissions || []).includes(submissionKey)) return { ok: true, state: "SAVED", duplicate: true };

  // Plan on the journey we read; the same plan is recomputed inside the guarded write
  // and must match, otherwise the page was stale (409) — prices never drift silently.
  const plan = planAction(ctx, resolved.journey, { role, actionId, typedPrice, typedViewing, now, room });
  const { applied } = plan;
  const card = describe(applied, who);
  const phaseBefore = journeyPhase(resolved.journey, now);
  const phaseAfter = journeyPhase({ ...resolved.journey, ...plan.patch }, now);
  const add = [];
  if (applied.move === "intervention") {
    add.push({ type: "SESSION_INTERVENTION", ref: `request:${room.requestId}`, priority: "HIGH", reason: `طلب ${who} تدخل الوسيط في غرفة التفاوض${room.note ? `: ${room.note.slice(0, 80)}` : ""}`, actionLabel: "فتح غرفة التفاوض" });
  } else if (applied.move === "info_request") {
    add.push({ type: "SESSION_INTERVENTION", ref: `request:${room.requestId}`, priority: "HIGH", reason: `طلب ${who} معلومة: ${applied.topicLabel}`, actionLabel: "فتح غرفة التفاوض" });
  } else if (applied.move === "ready" && applied.both) {
    add.push({ type: "DEAL_ACTION", ref: `ready:${now.toISOString().slice(0, 16)}`, priority: "HIGH", reason: "المالك والعميل جاهزان للاتفاق النهائي — أكمل الصفقة", actionLabel: "إكمال الصفقة" });
  } else if ((applied.move === "accept" || applied.move === "accept_fixed") && resolved.journey.viewing?.state === VIEWING_STATE.DONE) {
    add.push({ type: "DEAL_ACTION", ref: `agreement:after-viewing:${applied.price}`, reason: `اتفق الطرفان على ${formatPrice(applied.price)} بعد المعاينة — أنهِ الصفقة`, actionLabel: "إنهاء الصفقة" });
  } else if (applied.move === "to_broker") {
    add.push({ type: "SESSION_PRIVATE_PRICE", ref: `private:${role}:${subId}`, priority: "HIGH", reason: `أرسل ${who} سعرًا للوسيط فقط: ${formatPrice(applied.price)}`, actionLabel: "فتح غرفة التفاوض" });
  } else if (applied.move === "viewing_ok") {
    const at = toDate(resolved.journey.viewing?.at);
    add.push({ type: "VIEWING_RESULT", ref: `viewing:${resolved.journey.viewing?.at || ""}`, dueAt: new Date(at.getTime() + VIEWING_MINUTES * 60 * 1000), reason: `معاينة محجوزة ${formatDateTime(at, now)}`, actionLabel: "تسجيل النتيجة" });
  }
  const priceSettled = ["accept", "accept_fixed"].includes(applied.move);
  const readinessReset = Boolean(plan.patch.session?.ready) && Object.keys(plan.patch.session.ready).length === 0 && Object.keys(resolved.journey.session?.ready || {}).length > 0;
  const closing = applied.move === "decline_fixed";
  const result = await applyJourneyChange(ctx, {
    officeId, journeyId, actor: null,
    // A settled price ends the old proposal/price tasks; a booked viewing ends the scheduling ones;
    // a declined fixed price closes this match only.
    finishStatus: closing ? "DISMISSED" : "COMPLETED",
    finish: (task) => closing
      || (readinessReset && task.type === "DEAL_ACTION" && String(task.ref || "").startsWith("ready:"))
      || (priceSettled && ["SESSION_AGREED", "SEND_PROPOSAL", "AWAITING_REPLY", "PROPOSAL_REPLY", "SESSION_PRIVATE_PRICE"].includes(task.type))
      || (applied.move === "viewing_ok" && ["VIEWING_CONFIRM", "SESSION_VIEWING_COUNTER"].includes(task.type)),
    mutate: (journey) => {
      if ((journey.session?.submissions || []).includes(submissionKey)) return null;
      const fresh = planAction(ctx, journey, { role, actionId, typedPrice, typedViewing, now, room });
      if (fresh.applied.price !== applied.price || fresh.applied.move !== applied.move || fresh.applied.option !== applied.option || fresh.applied.nextState !== applied.nextState) {
        throw ctx.deps.appError("session_changed", 409, "تغيّر وضع الغرفة — حدّث الصفحة لرؤية الأسعار الحالية.");
      }
      const patch = fresh.patch;
      patch.session.submissions = [...(journey.session?.submissions || []), submissionKey].slice(-40);
      return patch;
    },
    add,
    event: {
      type: "SESSION_MOVE", key: [role, subId], source: EVENT_SOURCE.REPLY_LINK, actorRole: role,
      text: `${who} (غرفة التفاوض): ${card.text}${card.detail ? ` — ${card.detail}` : ""}`,
      payload: {
        role, move: applied.move, price: applied.price || null, pct: applied.pct || 0, base: applied.base || null,
        viewingAt: applied.viewingAt || null, viewingAtLabel: applied.viewingAt ? formatDateTime(applied.viewingAt, now) : "",
        // Room moves: the term and option, the request, readiness.
        termId: applied.termId || null, termLabel: applied.termLabel || null, option: applied.option || null, optionLabel: applied.optionLabel || null,
        replaces: applied.replaces || null, termPrev: applied.prevState || null, termNext: applied.nextState || null,
        topicLabel: applied.topicLabel || null, requestId: applied.requestId || null, text: applied.note || null, both: applied.both || false,
        // Audit: the deal's state before and after this move.
        prev: phaseBefore, next: phaseAfter,
        // A price for the broker stays with the broker; a request to the broker is seen by its sender and the broker only.
        audience: applied.move === "to_broker" ? "broker" : applied.move === "intervention" || applied.move === "info_request" ? role : "all"
      }
    },
    // A side changing its own unanswered proposal is logged but does not ring the broker again.
    notify: applied.revision ? null : {
      key: `session|${journeyId}|${role}|${subId}`,
      title: applied.move === "intervention" ? `تدخل مطلوب — ${who}` : applied.move === "info_request" ? `طلب معلومة — ${who}` : `غرفة التفاوض — ${who}`,
      body: `${card.text}${card.detail ? `: ${card.detail}` : ""}`,
      pushType: applied.move.startsWith("viewing") ? "appointment" : "message",
      openSession: true
    }
  });
  if (!result.changed) return { ok: true, state: "SAVED", duplicate: true };
  // Both sides booked a free slot: the viewing is confirmed, so its reminders start.
  if (applied.move === "viewing_ok") await syncMatchAppointment(ctx, officeId, result.journey, result.journey?.viewing?.at, { confirmed: true });
  if (closing) await afterJourneyClosed(ctx, officeId, resolved.journey, { won: false });
  return { ok: true, state: "SAVED" };
}

/** Validate an action against the given journey and build its journey patch. */
function planAction(ctx, journey, { role, actionId, typedPrice, typedViewing, now, room = {} }) {
  if (Object.hasOwn(ROOM_ACTIONS, actionId)) return planRoomAction(ctx, journey, { role, actionId, now, room });
  const available = availableActions(journey, role, { now });
  const option = available.actions.find((item) => item.id === actionId);
  if (!option) throw ctx.deps.appError("session_action_unavailable", 409, "تغيّر وضع الغرفة — حدّث الصفحة لرؤية الخيارات الحالية.");
  const session = { ...(journey.session || {}) };
  const prices = sessionPrices(journey);
  const patch = { session };
  let applied;
  if (PRICE_MOVES[actionId]) {
    const move = PRICE_MOVES[actionId];
    const value = move.typed ? typedPrice : move.price(prices, role);
    if (!(value > 0)) throw ctx.deps.appError("price_unavailable", 409, "لا يوجد سعر لحساب هذا الخيار");
    applied = { move: actionId, price: value, pct: move.pct || 0, base: actionId === "compromise" ? null : prices[role === "owner" ? "client" : "owner"] || null };
    if (!move.private && actionId === "accept") {
      patch.stage = journey.viewing?.state === VIEWING_STATE.DONE ? "AGREEMENT" : "VIEWING";
    }
    if (move.private) {
      session.privatePrices = { ...(session.privatePrices || {}), [role]: { price: value, at: now.toISOString() } };
    } else {
      session.prices = { ...(session.prices || {}), [role]: { price: value, move: actionId, at: now.toISOString() } };
      session.lastMove = { role, move: actionId, price: value, at: now.toISOString() };
      session.agreedPrice = actionId === "accept" ? value : null;
      session.agreedAt = actionId === "accept" ? now.toISOString() : null;
      // Any price move resets «جاهز للاتفاق»: readiness is given for the price agreed now.
      session.ready = {};
    }
  } else if (actionId === "reject") {
    applied = { move: "reject" };
    session.lastMove = { role, move: "reject", price: null, at: now.toISOString() };
    session.agreedPrice = null;
    session.agreedAt = null;
    session.ready = {};
  } else if (actionId === "accept_fixed") {
    const value = prices.owner;
    if (!(value > 0)) throw ctx.deps.appError("price_unavailable", 409, "لا يوجد سعر ثابت لهذا العرض");
    applied = { move: "accept_fixed", price: value };
    session.prices = { ...(session.prices || {}), [role]: { price: value, move: "accept_fixed", at: now.toISOString() } };
    session.lastMove = { role, move: "accept_fixed", price: value, at: now.toISOString() };
    session.agreedPrice = value;
    session.agreedAt = now.toISOString();
    session.ready = {};
    patch.stage = journey.viewing?.state === VIEWING_STATE.DONE ? "AGREEMENT" : "VIEWING";
  } else if (actionId === "decline_fixed") {
    applied = { move: "decline_fixed" };
    session.lastMove = { role, move: "decline_fixed", price: null, at: now.toISOString() };
    Object.assign(patch, {
      status: "CLOSED_LOST", stage: "CLOSED", closedAt: now, archivedAt: now, activeProposals: {},
      outcome: { result: "LOST", reason: "السعر ثابت ولم يوافق العميل", finalPrice: null, closedAt: now.toISOString(), closedBy: role }
    });
  } else if (actionId === "intervention") {
    if (!canSendRequest(journey, role)) throw ctx.deps.appError("requests_limit", 409, "لديك طلبات سابقة لدى الوسيط لم تُعالج بعد — انتظر رده.");
    applied = { move: "intervention", note: room.note || "", requestId: room.requestId };
    session.intervention = { required: true, by: role, at: now.toISOString() };
    session.requests = [...requestsOf(journey), { id: room.requestId, role, kind: REQUEST_KIND.INTERVENTION, text: room.note || "", at: now.toISOString(), status: "OPEN" }].slice(-30);
  } else if (actionId === "viewing_ok") {
    // Both sides agreed on a free slot → the viewing is booked on the broker's calendar.
    applied = { move: "viewing_ok", viewingAt: journey.viewing?.at || null };
    const viewing = journey.viewing || {};
    patch.viewing = { ...viewing, state: VIEWING_STATE.CONFIRMED, acceptedBy: { ...(viewing.acceptedBy || {}), [role]: true }, confirmedAt: now.toISOString(), confirmedBy: "parties" };
    patch.stage = "VIEWING";
  } else {
    applied = { move: actionId, viewingAt: typedViewing.toISOString() };
    patch.viewing = { state: VIEWING_STATE.PROPOSED, at: typedViewing.toISOString(), proposedBy: role, counterBy: role, proposedAt: now.toISOString(), acceptedBy: { [role]: true } };
  }
  return { applied, patch };
}

/** Room moves: a term (propose / accept / reject), an information request, or «جاهز للاتفاق». */
function planRoomAction(ctx, journey, { role, actionId, now, room }) {
  const session = { ...(journey.session || {}) };
  const patch = { session };
  if (actionId === ROOM_ACTIONS.info_request) {
    const topicLabel = infoTopicLabel(journey, room.topicId);
    if (!topicLabel) throw ctx.deps.appError("topic_unknown", 400, "اختر المعلومة المطلوبة من القائمة");
    if (!canSendRequest(journey, role)) throw ctx.deps.appError("requests_limit", 409, "لديك طلبات سابقة لدى الوسيط لم تُعالج بعد — انتظر رده.");
    session.requests = [...requestsOf(journey), { id: room.requestId, role, kind: REQUEST_KIND.INFO, topic: room.topicId, topicLabel, text: "", at: now.toISOString(), status: "OPEN" }].slice(-30);
    return { applied: { move: actionId, topicLabel, requestId: room.requestId }, patch };
  }
  if (actionId === ROOM_ACTIONS.ready) {
    if (!canMarkReady(journey, role)) throw ctx.deps.appError("not_ready", 409, "يظهر «جاهز للاتفاق» بعد الاتفاق على السعر وعدم وجود اقتراح بانتظار الرد.");
    session.ready = { ...(session.ready || {}), [role]: now.toISOString() };
    const both = Boolean(session.ready.owner && session.ready.client);
    return { applied: { move: actionId, both, nextState: both ? "BOTH" : "ONE" }, patch };
  }
  const planned = planTermAction(journey, { role, action: actionId, termId: room.termId, optionId: room.optionId, now });
  if (!planned.ok) throw ctx.deps.appError(planned.code, planned.code === "option_unknown" || planned.code === "term_unknown" ? 400 : 409, planned.message);
  session.terms = planned.terms;
  // A new proposal on a term reopens the agreement: nobody is «جاهز للاتفاق» until it is answered.
  if (actionId === ROOM_ACTIONS.term_propose) session.ready = {};
  return { applied: planned.applied, patch };
}

function describe(applied, who) {
  const room = roomMoveText(applied);
  if (room) return { text: room, detail: "", who };
  const text = moveText(applied.move, { pct: applied.pct });
  const detail = applied.price ? formatPrice(applied.price) : applied.viewingAt ? formatDateTime(applied.viewingAt) : "";
  return { text, detail, who };
}
