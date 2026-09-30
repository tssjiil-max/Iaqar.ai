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
import { buildWhatsAppUrl, cleanText, formatDateTime, formatPrice, localPhone, parseRiyadhLocal, toDate } from "../../../public/os/domain/format-domain.js";
import { newReplyToken, isReplyTokenShape } from "./proposal-service.js";
import { applyJourneyChange, loadJourney } from "./journey-service.js";
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
  const available = availableActions(journey, role);
  return {
    role,
    roleLabel: ROLE_LABEL[role],
    property: {
      propertyType: cleanText(offer.propertyType, 40) || "العقار",
      district: cleanText(offer.district, 80),
      city: cleanText(offer.city, 60),
      area: Number(offer.area || 0) || null
    },
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
  if (actionId === "viewing_other") {
    typedViewing = parseRiyadhLocal(viewingAt) || toDate(viewingAt);
    if (!typedViewing || typedViewing.getTime() < ctx.now().getTime() + 30 * 60 * 1000) {
      throw ctx.deps.appError("viewing_invalid", 400, "اختر موعدًا قادمًا للمعاينة");
    }
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
  } else if (applied.move === "accept") {
    add.push({ type: "SESSION_AGREED", ref: `agreed:${applied.price}`, priority: "HIGH", reason: `اتفق الطرفان على ${formatPrice(applied.price)} — حدد موعد المعاينة`, actionLabel: "فتح جلسة التفاوض" });
  } else if (applied.move === "to_broker") {
    add.push({ type: "SESSION_PRIVATE_PRICE", ref: `private:${role}:${subId}`, priority: "HIGH", reason: `أرسل ${who} سعرًا للوسيط فقط: ${formatPrice(applied.price)}`, actionLabel: "فتح جلسة التفاوض" });
  } else if (applied.move === "viewing_ok") {
    add.push({ type: "VIEWING_CONFIRM", ref: `viewing:${resolved.journey.viewing?.at || ""}`, dueAt: resolved.journey.viewing?.at || null, reason: `وافق ${who} على موعد المعاينة من جلسة التفاوض — أكّد الموعد`, actionLabel: "تأكيد الموعد" });
  } else if (applied.move === "viewing_other") {
    add.push({ type: "SESSION_VIEWING_COUNTER", ref: `viewing-counter:${applied.viewingAt}`, priority: "HIGH", reason: `اقترح ${who} موعدًا آخر للمعاينة: ${formatDateTime(applied.viewingAt, now)}`, actionLabel: "فتح جلسة التفاوض" });
  }
  const result = await applyJourneyChange(ctx, {
    officeId, journeyId, actor: null,
    // An agreed price supersedes the "waiting for agreement" task; a new price reopens it.
    finish: (task) => (applied.move === "intervention" ? false : applied.move !== "accept" && task.type === "SESSION_AGREED"),
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
  return { ok: true, state: "SAVED" };
}

/** Validate an action against the given journey and build its journey patch. */
function planAction(ctx, journey, { role, actionId, typedPrice, typedViewing, now }) {
  const available = availableActions(journey, role);
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
    if (move.private) {
      session.privatePrices = { ...(session.privatePrices || {}), [role]: { price: value, at: now.toISOString() } };
    } else {
      session.prices = { ...(session.prices || {}), [role]: { price: value, move: actionId, at: now.toISOString() } };
      session.lastMove = { role, move: actionId, price: value, at: now.toISOString() };
      session.agreedPrice = actionId === "accept" ? value : null;
      session.agreedAt = actionId === "accept" ? now.toISOString() : null;
    }
  } else if (actionId === "intervention") {
    applied = { move: "intervention" };
    session.intervention = { required: true, by: role, at: now.toISOString() };
  } else if (actionId === "viewing_ok") {
    applied = { move: "viewing_ok" };
    const viewing = journey.viewing || {};
    patch.viewing = { ...viewing, state: VIEWING_STATE.ACCEPTED, acceptedBy: { ...(viewing.acceptedBy || {}), [role]: true } };
  } else {
    applied = { move: "viewing_other", viewingAt: typedViewing.toISOString() };
    const viewing = journey.viewing || {};
    patch.viewing = { ...viewing, state: VIEWING_STATE.PROPOSED, acceptedBy: {}, counterBy: role, counterAt: typedViewing.toISOString() };
  }
  return { applied, patch };
}

function describe(applied, who) {
  const text = moveText(applied.move, { pct: applied.pct });
  const detail = applied.price ? formatPrice(applied.price) : applied.viewingAt ? formatDateTime(applied.viewingAt) : "";
  return { text, detail, who };
}
