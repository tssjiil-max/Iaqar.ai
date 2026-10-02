/**
 * جلسة التفاوض — live negotiation session per deal (journey).
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
  PHASE, PRICE_STATUS_LABEL, VIEWING_MINUTES, agreedItems, availableSlots, brokerBusy, checkBrokerAvailability,
  isOfferedSlot, journeyPhase, priceStatusOf
} from "../../../public/os/domain/deal-flow-domain.js";
import { buildWhatsAppUrl, cleanText, formatDateTime, formatPrice, localPhone, parseRiyadhLocal, toDate } from "../../../public/os/domain/format-domain.js";
import { newReplyToken, isReplyTokenShape } from "./proposal-service.js";
import { applyJourneyChange, afterJourneyClosed, loadJourney, syncMatchAppointment } from "./journey-service.js";
import { assertCanActOn } from "./permissions.js";

const ROLES = [SESSION_ROLE.OWNER, SESSION_ROLE.CLIENT];

const STATE_MESSAGES = Object.freeze({
  INVALID: "هذا الرابط غير صالح. تواصل مع المكتب للحصول على رابط جديد.",
  REPLACED: "تم استبدال هذا الرابط. استخدم الرابط الجديد الذي أرسله الوسيط.",
  CLOSED: "انتهت جلسة التفاوض لهذه الصفقة."
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
      opened: Boolean(journey.session?.opened?.[role])
    };
  }
  if (changed) {
    await applyJourneyChange(ctx, {
      officeId, journeyId, actor,
      mutate: () => ({ sessionLinks: links }),
      event: replace
        ? { type: "SESSION_LINK", key: ["replace", replace, now.toISOString()], text: `تم استبدال رابط جلسة ${ROLE_LABEL[replace]} — الرابط السابق لم يعد يعمل`, payload: { role: replace, audience: "broker" } }
        : { type: "SESSION_LINK", key: ["issue", Object.keys(links).sort().join(",")], text: "تم إنشاء روابط جلسة التفاوض للمالك والعميل", payload: { audience: "broker" } }
    });
  }
  return { ok: true, links: out };
}

function sessionInviteText({ role, url, journey }) {
  const offer = journey.offerSummary || {};
  const property = [offer.propertyType || "العقار", offer.district ? `في ${String(offer.district).startsWith("حي") ? offer.district : `حي ${offer.district}`}` : ""].filter(Boolean).join(" ");
  return [
    "مرحبًا،",
    role === SESSION_ROLE.OWNER
      ? `هذا رابط جلسة التفاوض الخاصة بعقارك (${property}). يمكنك الرد على الأسعار مباشرة من الرابط.`
      : `هذا رابط جلسة التفاوض على ${property}. يمكنك الرد على الأسعار مباشرة من الرابط.`,
    url
  ].join("\n");
}

export async function recordSessionHandoff(ctx, { actor, officeId, journeyId, role }) {
  if (!ROLES.includes(role)) throw ctx.deps.appError("role_invalid", 400, "حدد الطرف");
  await loadOwnJourney(ctx, { actor, officeId, journeyId });
  const now = ctx.now();
  return applyJourneyChange(ctx, {
    officeId, journeyId, actor,
    mutate: () => ({}),
    event: { type: "WHATSAPP_OPENED", key: ["session-link", role, now.toISOString().slice(0, 16)], text: `تم فتح واتساب لإرسال رابط الجلسة إلى ${ROLE_LABEL[role]} — فتح واتساب لا يعني وصول الرابط`, payload: { role, audience: "broker" } }
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
      ? { session: { ...(j.session || {}), intervention: { ...(j.session.intervention || {}), required: false, resolvedAt: now.toISOString(), resolvedBy: actor.uid } } }
      : null),
    event: { type: "SESSION_RESOLVED", key: ["resolved", j2key(journey)], text: "تابع الوسيط طلب التدخل", payload: { audience: "all" } }
  });
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
  return {
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
    agreed: agreedItems(journey, now),
    sides: { owner: sideOf(journey, SESSION_ROLE.OWNER), client: sideOf(journey, SESSION_ROLE.CLIENT) },
    slots,
    currentPrice: prices.current || null,
    agreedPrice: prices.agreed || null,
    stage: sessionStage(journey),
    stageLabel: sessionStageLabel(journey),
    stages: SESSION_STAGES,
    intervention: Boolean(journey.session?.intervention?.required),
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
      event: { type: "SESSION_OPENED", key: [link.role, "opened"], source: EVENT_SOURCE.REPLY_LINK, actorRole: link.role, text: `فتح ${ROLE_LABEL[link.role]} رابط جلسة التفاوض`, payload: { role: link.role, audience: "broker" } }
    }).catch((error) => console.warn("[office-os] session opened", error?.message));
  }
  return { ok: true, state: resolved.state, message: resolved.state === "CLOSED" ? STATE_MESSAGES.CLOSED : "", office, session: view };
}

function cleanSubmissionId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : "";
}

/** One party action (price move, viewing answer or intervention request). */
export async function submitSessionAction(ctx, { token, action, price = "", viewingAt = "", submissionId = "", ip = "unknown" }) {
  rateLimit(ctx, "os/session/act", ip);
  const resolved = await resolveLink(ctx, token);
  if (resolved.state !== "ACTIVE") return { ok: false, state: resolved.state, message: STATE_MESSAGES[resolved.state] || STATE_MESSAGES.INVALID };
  const { link } = resolved;
  const role = link.role;
  const officeId = link.officeId;
  const journeyId = journeyIdOf(resolved.journey);
  const actionId = String(action || "");
  if (!PRICE_MOVES[actionId] && !OTHER_ACTIONS[actionId]) throw ctx.deps.appError("session_action_invalid", 400, "إجراء غير معروف");
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
  const subId = cleanSubmissionId(submissionId) || (await ctx.deps.sha256Hex(`${role}|${actionId}|${typedPrice}|${ctx.now().toISOString().slice(0, 16)}`)).slice(0, 32);
  const now = ctx.now();
  const who = ROLE_LABEL[role];
  const submissionKey = `${role}:${subId}`;
  if ((resolved.journey.session?.submissions || []).includes(submissionKey)) return { ok: true, state: "SAVED", duplicate: true };

  // Plan on the journey we read; the same plan is recomputed inside the guarded write
  // and must match, otherwise the page was stale (409) — prices never drift silently.
  const plan = planAction(ctx, resolved.journey, { role, actionId, typedPrice, typedViewing, now });
  const { applied } = plan;
  const card = describe(applied, who);
  const add = [];
  if (applied.move === "intervention") {
    add.push({ type: "SESSION_INTERVENTION", ref: `intervention:${now.toISOString()}`, priority: "HIGH", reason: `طلب ${who} تدخل الوسيط في جلسة التفاوض`, actionLabel: "فتح جلسة التفاوض" });
  } else if ((applied.move === "accept" || applied.move === "accept_fixed") && resolved.journey.viewing?.state === VIEWING_STATE.DONE) {
    add.push({ type: "DEAL_ACTION", ref: `agreement:after-viewing:${applied.price}`, reason: `اتفق الطرفان على ${formatPrice(applied.price)} بعد المعاينة — أنهِ الصفقة`, actionLabel: "إنهاء الصفقة" });
  } else if (applied.move === "to_broker") {
    add.push({ type: "SESSION_PRIVATE_PRICE", ref: `private:${role}:${subId}`, priority: "HIGH", reason: `أرسل ${who} سعرًا للوسيط فقط: ${formatPrice(applied.price)}`, actionLabel: "فتح جلسة التفاوض" });
  } else if (applied.move === "viewing_ok") {
    const at = toDate(resolved.journey.viewing?.at);
    add.push({ type: "VIEWING_RESULT", ref: `viewing:${resolved.journey.viewing?.at || ""}`, dueAt: new Date(at.getTime() + VIEWING_MINUTES * 60 * 1000), reason: `معاينة محجوزة ${formatDateTime(at, now)}`, actionLabel: "تسجيل النتيجة" });
  }
  const priceSettled = ["accept", "accept_fixed"].includes(applied.move);
  const closing = applied.move === "decline_fixed";
  const result = await applyJourneyChange(ctx, {
    officeId, journeyId, actor: null,
    // A settled price ends the old proposal/price tasks; a booked viewing ends the scheduling ones;
    // a declined fixed price closes this match only.
    finishStatus: closing ? "DISMISSED" : "COMPLETED",
    finish: (task) => closing
      || (priceSettled && ["SESSION_AGREED", "SEND_PROPOSAL", "AWAITING_REPLY", "PROPOSAL_REPLY", "SESSION_PRIVATE_PRICE"].includes(task.type))
      || (applied.move === "viewing_ok" && ["VIEWING_CONFIRM", "SESSION_VIEWING_COUNTER"].includes(task.type)),
    mutate: (journey) => {
      if ((journey.session?.submissions || []).includes(submissionKey)) return null;
      const fresh = planAction(ctx, journey, { role, actionId, typedPrice, typedViewing, now });
      if (fresh.applied.price !== applied.price || fresh.applied.move !== applied.move) {
        throw ctx.deps.appError("session_changed", 409, "تغيّر وضع الجلسة — حدّث الصفحة لرؤية الأسعار الحالية.");
      }
      const patch = fresh.patch;
      patch.session.submissions = [...(journey.session?.submissions || []), submissionKey].slice(-40);
      return patch;
    },
    add,
    event: {
      type: "SESSION_MOVE", key: [role, subId], source: EVENT_SOURCE.REPLY_LINK, actorRole: role,
      text: `${who} (جلسة التفاوض): ${card.text}${card.detail ? ` — ${card.detail}` : ""}`,
      payload: {
        role, move: applied.move, price: applied.price || null, pct: applied.pct || 0, base: applied.base || null,
        viewingAt: applied.viewingAt || null, viewingAtLabel: applied.viewingAt ? formatDateTime(applied.viewingAt, now) : "",
        audience: applied.move === "to_broker" ? "broker" : "all"
      }
    },
    notify: {
      key: `session|${journeyId}|${role}|${subId}`,
      title: applied.move === "intervention" ? `تدخل مطلوب — ${who}` : `جلسة التفاوض — ${who}`,
      body: `${card.text}${card.detail ? `: ${card.detail}` : ""}`,
      pushType: applied.move.startsWith("viewing") ? "appointment" : "message",
      openSession: true
    }
  });
  if (!result.changed) return { ok: true, state: "SAVED", duplicate: true };
  if (applied.move === "viewing_ok") await syncMatchAppointment(ctx, officeId, result.journey, result.journey?.viewing?.at);
  if (closing) await afterJourneyClosed(ctx, officeId, resolved.journey, { won: false });
  return { ok: true, state: "SAVED" };
}

/** Validate an action against the given journey and build its journey patch. */
function planAction(ctx, journey, { role, actionId, typedPrice, typedViewing, now }) {
  const available = availableActions(journey, role, { now });
  const option = available.actions.find((item) => item.id === actionId);
  if (!option) throw ctx.deps.appError("session_action_unavailable", 409, "تغيّر وضع الجلسة — حدّث الصفحة لرؤية الخيارات الحالية.");
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
    }
  } else if (actionId === "reject") {
    applied = { move: "reject" };
    session.lastMove = { role, move: "reject", price: null, at: now.toISOString() };
    session.agreedPrice = null;
    session.agreedAt = null;
  } else if (actionId === "accept_fixed") {
    const value = prices.owner;
    if (!(value > 0)) throw ctx.deps.appError("price_unavailable", 409, "لا يوجد سعر ثابت لهذا العرض");
    applied = { move: "accept_fixed", price: value };
    session.prices = { ...(session.prices || {}), [role]: { price: value, move: "accept_fixed", at: now.toISOString() } };
    session.lastMove = { role, move: "accept_fixed", price: value, at: now.toISOString() };
    session.agreedPrice = value;
    session.agreedAt = now.toISOString();
    patch.stage = journey.viewing?.state === VIEWING_STATE.DONE ? "AGREEMENT" : "VIEWING";
  } else if (actionId === "decline_fixed") {
    applied = { move: "decline_fixed" };
    session.lastMove = { role, move: "decline_fixed", price: null, at: now.toISOString() };
    Object.assign(patch, {
      status: "CLOSED_LOST", stage: "CLOSED", closedAt: now, archivedAt: now, activeProposals: {},
      outcome: { result: "LOST", reason: "السعر ثابت ولم يوافق العميل", finalPrice: null, closedAt: now.toISOString(), closedBy: role }
    });
  } else if (actionId === "intervention") {
    applied = { move: "intervention" };
    session.intervention = { required: true, by: role, at: now.toISOString() };
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

function describe(applied, who) {
  const text = moveText(applied.move, { pct: applied.pct });
  const detail = applied.price ? formatPrice(applied.price) : applied.viewingAt ? formatDateTime(applied.viewingAt) : "";
  return { text, detail, who };
}
