import {
  FLOW_STAGE, PRICE_STATUS, normalizePriceStatus, brokerHasConflict
} from "../../../public/os/domain/flow-domain.js";
import {
  EVENT_SOURCE, JOURNEY_STATUS, STAGE, VIEWING_STATE, isJourneyOpen
} from "../../../public/os/domain/journey-domain.js";
import { cleanText, formatDateTime, toDate } from "../../../public/os/domain/format-domain.js";
import {
  applyJourneyChange, closeJourney, confirmViewing, decideMatchReview, journeySegments,
  recordViewingResult
} from "./journey-service.js";
import { isReplyTokenShape } from "./proposal-service.js";
import { sessionHashOf, submitSessionAction } from "./session-service.js";

function replaceAgreed(items = [], item) {
  return [...items.filter((x) => x?.key !== item.key), item];
}

function viewingEnd(viewing = {}) {
  const start = toDate(viewing.at);
  if (!start) return null;
  return toDate(viewing.end || viewing.endAt) || new Date(start.getTime() + 60 * 60 * 1000);
}

async function resolveSessionTarget(ctx, token) {
  if (!isReplyTokenShape(token)) throw ctx.deps.appError("session_invalid", 404, "هذا الرابط غير صالح");
  const hash = await sessionHashOf(ctx.deps, token);
  const link = await ctx.store.get(["sessionLinks", hash]);
  if (!link?.officeId || !link?.journeyId || !["owner", "client"].includes(link.role)) {
    throw ctx.deps.appError("session_invalid", 404, "هذا الرابط غير صالح");
  }
  if (["REPLACED", "REVOKED", "CLOSED"].includes(String(link.status || "").toUpperCase())) {
    throw ctx.deps.appError("session_closed", 409, "هذا الرابط لم يعد نشطًا");
  }
  const journey = await ctx.store.get(journeySegments(link.officeId, link.journeyId));
  if (!journey || !isJourneyOpen(journey)) throw ctx.deps.appError("journey_closed", 409, "انتهت هذه الرحلة");
  if (journey.sessionLinks?.[link.role]?.hash && journey.sessionLinks[link.role].hash !== hash) {
    throw ctx.deps.appError("session_replaced", 409, "تم استبدال هذا الرابط");
  }
  return { hash, link, role: link.role, officeId: link.officeId, journeyId: link.journeyId, journey };
}

async function brokerAppointments(ctx, officeId, brokerId, excludeJourneyId = "") {
  if (!brokerId) return [];
  const journeys = await ctx.store.list(["offices", officeId, "journeys"], 300);
  return journeys.flatMap((journey) => {
    if (String(journey.id || journey.journeyId || "") === String(excludeJourneyId || "")) return [];
    if (String(journey.assignedBrokerId || "") !== String(brokerId)) return [];
    const viewing = journey.viewing || {};
    if (String(viewing.state || "") !== VIEWING_STATE.CONFIRMED || !viewing.at) return [];
    const start = toDate(viewing.at);
    const end = viewingEnd(viewing);
    if (!start || !end) return [];
    return [{ brokerId, start: start.toISOString(), end: end.toISOString(), state: "CONFIRMED", journeyId: journey.id || journey.journeyId }];
  });
}

async function assertViewingFree(ctx, { officeId, journey, at, end = null }) {
  const brokerId = String(journey.assignedBrokerId || "");
  if (!brokerId || !at) return;
  const start = toDate(at);
  if (!start) throw ctx.deps.appError("viewing_invalid", 400, "موعد المعاينة غير صالح");
  const finish = toDate(end) || new Date(start.getTime() + 60 * 60 * 1000);
  const existing = await brokerAppointments(ctx, officeId, brokerId, journey.journeyId || journey.id);
  if (brokerHasConflict(existing, { brokerId, start: start.toISOString(), end: finish.toISOString() })) {
    throw ctx.deps.appError("viewing_slot_conflict", 409, "هذا الموعد أصبح مشغولًا للوسيط — اختر موعدًا آخر");
  }
}

export async function decideMatchReviewSimplified(ctx, args) {
  const result = await decideMatchReview(ctx, args);
  if (args.decision !== "approve" || !result?.journeyId) return result;
  const journeyId = result.journeyId;
  const journey = await ctx.store.get(journeySegments(args.officeId, journeyId));
  if (!journey) return result;
  const offer = await ctx.store.get(["offices", args.officeId, "opportunities", journey.offerId]);
  const priceStatus = normalizePriceStatus(offer || journey.offerSummary || {});
  const flowStage = priceStatus === PRICE_STATUS.FIXED ? FLOW_STAGE.PRICE_DECISION : FLOW_STAGE.PRICE_NEGOTIATION;
  const add = priceStatus === PRICE_STATUS.FIXED
    ? [{ type: "PRICE_DECISION", ref: `fixed:${journey.matchId || ""}`, reason: "السعر ثابت — بانتظار قرار العميل", actionLabel: "مراجعة السعر" }]
    : [];
  await applyJourneyChange(ctx, {
    officeId: args.officeId, journeyId, actor: args.actor,
    finish: (task) => priceStatus === PRICE_STATUS.FIXED && task.type === "SEND_PROPOSAL",
    add,
    mutate: (j) => ({
      flowStage,
      activeTopics: priceStatus === PRICE_STATUS.FIXED ? [] : ["price"],
      agreedItems: Array.isArray(j.agreedItems) ? j.agreedItems : [],
      offerSummary: { ...(j.offerSummary || {}), priceStatus, priceNegotiable: priceStatus === PRICE_STATUS.NEGOTIABLE }
    }),
    event: { type: "FLOW_STAGE", key: [flowStage, "match-approved"], text: priceStatus === PRICE_STATUS.FIXED ? "السعر ثابت — انتقل القرار للعميل" : "بدأ تفاوض السعر", payload: { flowStage, priceStatus, audience: "broker" } }
  });
  return { ...result, flowStage, priceStatus };
}

async function closePublicJourney(ctx, target, reason = "رفض العرض") {
  const now = ctx.now();
  const result = await applyJourneyChange(ctx, {
    officeId: target.officeId,
    journeyId: target.journeyId,
    actor: null,
    finish: () => true,
    finishStatus: "DISMISSED",
    mutate: (j) => isJourneyOpen(j) ? {
      status: JOURNEY_STATUS.CLOSED_LOST,
      stage: STAGE.CLOSED,
      flowStage: FLOW_STAGE.CLOSED,
      activeTopics: [],
      closedAt: now,
      archivedAt: now,
      outcome: { result: "LOST", reason, finalPrice: null, closedAt: now.toISOString(), closedBy: target.role }
    } : null,
    event: {
      type: "SESSION_MOVE", key: [target.role, "reject", now.toISOString()], source: EVENT_SOURCE.REPLY_LINK, actorRole: target.role,
      text: `${target.role === "owner" ? "المالك" : "العميل"}: رفض العرض`, payload: { role: target.role, move: "reject", audience: "all" }
    },
    notify: { key: `session|${target.journeyId}|reject|${now.toISOString()}`, title: "انتهت المطابقة", body: `${target.role === "owner" ? "المالك" : "العميل"} رفض العرض — أغلقت هذه المطابقة فقط`, pushType: "message", openSession: true }
  });
  await ctx.store.set(["offices", target.officeId, "matches", target.journey.matchId], { status: "closed", updatedAt: now }).catch(() => {});
  return { ok: true, state: "CLOSED", journeyId: target.journeyId, changed: result.changed };
}

export async function rejectSession(ctx, { token, ip = "unknown" }) {
  const target = await resolveSessionTarget(ctx, token);
  return closePublicJourney(ctx, target, "رفض أحد الطرفين العرض");
}

export async function fixedPriceDecision(ctx, { token, accepted, submissionId = "", ip = "unknown" }) {
  const target = await resolveSessionTarget(ctx, token);
  const priceStatus = normalizePriceStatus(target.journey.offerSummary || {});
  if (priceStatus !== PRICE_STATUS.FIXED) throw ctx.deps.appError("price_not_fixed", 409, "هذا السعر قابل للتفاوض");
  if (target.role !== "client") throw ctx.deps.appError("fixed_price_client_only", 409, "السعر الثابت ينتظر قرار العميل");
  if (!accepted) return closePublicJourney(ctx, target, "العميل لم يوافق على السعر الثابت");
  const price = Number(target.journey.offerSummary?.price || 0);
  if (!(price > 0)) throw ctx.deps.appError("price_unavailable", 409, "السعر غير متاح");
  const now = ctx.now();
  const result = await applyJourneyChange(ctx, {
    officeId: target.officeId,
    journeyId: target.journeyId,
    actor: null,
    finish: (task) => ["PRICE_DECISION", "SEND_PROPOSAL", "SESSION_AGREED"].includes(task.type),
    add: [{ type: "VIEWING_SCHEDULE", ref: `price:${price}`, reason: "تمت الموافقة على السعر — حدد موعد المعاينة", actionLabel: "تحديد موعد" }],
    mutate: (j) => ({
      stage: STAGE.VIEWING,
      flowStage: FLOW_STAGE.VIEWING_SCHEDULING,
      agreedPrice: price,
      activeTopics: [],
      agreedItems: replaceAgreed(j.agreedItems || [], { key: "price", label: "السعر المتفق عليه", value: price }),
      session: { ...(j.session || {}), agreedPrice: price, agreedAt: now.toISOString(), lastMove: { role: "client", move: "accept", price, at: now.toISOString() } }
    }),
    event: { type: "SESSION_MOVE", key: ["client", submissionId || now.toISOString(), "fixed"], source: EVENT_SOURCE.REPLY_LINK, actorRole: "client", text: "العميل وافق على السعر الثابت", payload: { role: "client", move: "accept", price, audience: "all" } },
    notify: { key: `session|${target.journeyId}|fixed-accepted|${price}`, title: "تم الاتفاق على السعر", body: "وافق العميل على السعر الثابت — الخطوة التالية تحديد موعد المعاينة", pushType: "message", openSession: true }
  });
  return { ok: true, state: "SAVED", changed: result.changed };
}

export async function acceptNegotiatedPrice(ctx, args) {
  const before = await resolveSessionTarget(ctx, args.token);
  if (normalizePriceStatus(before.journey.offerSummary || {}) === PRICE_STATUS.FIXED) {
    return fixedPriceDecision(ctx, { ...args, accepted: true });
  }
  const saved = await submitSessionAction(ctx, { ...args, action: "accept" });
  if (!saved?.ok) return saved;
  const target = await resolveSessionTarget(ctx, args.token);
  const latest = target.journey;
  const price = Number(latest.session?.agreedPrice || 0);
  if (!(price > 0)) return saved;
  const now = ctx.now();
  await applyJourneyChange(ctx, {
    officeId: target.officeId, journeyId: target.journeyId, actor: null,
    finish: (task) => ["SESSION_AGREED", "SEND_PROPOSAL", "PROPOSAL_REPLY", "AWAITING_REPLY"].includes(task.type),
    add: [{ type: "VIEWING_SCHEDULE", ref: `price:${price}`, reason: "تم الاتفاق على السعر — حدد موعد المعاينة", actionLabel: "تحديد موعد" }],
    mutate: (j) => ({
      stage: STAGE.VIEWING,
      flowStage: FLOW_STAGE.VIEWING_SCHEDULING,
      agreedPrice: price,
      activeTopics: [],
      agreedItems: replaceAgreed(j.agreedItems || [], { key: "price", label: "السعر المتفق عليه", value: price })
    }),
    event: { type: "FLOW_STAGE", key: ["price-agreed", price], text: `تم الاتفاق على السعر — ${price.toLocaleString("en-US")} ريال`, payload: { flowStage: FLOW_STAGE.VIEWING_SCHEDULING, audience: "broker" } }
  });
  return saved;
}

export async function submitViewingCounterSafe(ctx, args) {
  const target = await resolveSessionTarget(ctx, args.token);
  const at = toDate(args.viewingAt);
  if (!at || at.getTime() < ctx.now().getTime() + 30 * 60 * 1000) throw ctx.deps.appError("viewing_invalid", 400, "اختر موعدًا قادمًا للمعاينة");
  await assertViewingFree(ctx, { officeId: target.officeId, journey: target.journey, at });
  return submitSessionAction(ctx, { ...args, action: "viewing_other" });
}

export async function submitViewingAcceptanceSafe(ctx, args) {
  const target = await resolveSessionTarget(ctx, args.token);
  const viewing = target.journey.viewing || {};
  const other = target.role === "owner" ? "client" : "owner";
  if (viewing.acceptedBy?.[other] && viewing.at) {
    await assertViewingFree(ctx, { officeId: target.officeId, journey: target.journey, at: viewing.at, end: viewing.end || viewing.endAt });
  }
  const saved = await submitSessionAction(ctx, { ...args, action: "viewing_ok" });
  if (!saved?.ok) return saved;
  const latestTarget = await resolveSessionTarget(ctx, args.token);
  const latest = latestTarget.journey;
  const accepted = latest.viewing?.acceptedBy || {};
  if (!(accepted.owner && accepted.client) || !latest.viewing?.at) return saved;
  await assertViewingFree(ctx, { officeId: latestTarget.officeId, journey: latest, at: latest.viewing.at, end: latest.viewing.end || latest.viewing.endAt });
  const at = toDate(latest.viewing.at);
  const now = ctx.now();
  await applyJourneyChange(ctx, {
    officeId: latestTarget.officeId, journeyId: latestTarget.journeyId, actor: null,
    finish: (task) => ["VIEWING_CONFIRM", "VIEWING_SCHEDULE", "SESSION_VIEWING_COUNTER"].includes(task.type),
    add: [{ type: "VIEWING_RESULT", ref: `viewing:${latest.viewing.at}`, dueAt: at, reason: `معاينة مؤكدة ${formatDateTime(at, now)}`, actionLabel: "تسجيل النتيجة" }],
    mutate: (j) => ({
      stage: STAGE.VIEWING,
      flowStage: FLOW_STAGE.VIEWING_SCHEDULING,
      viewing: { ...(j.viewing || {}), state: VIEWING_STATE.CONFIRMED, confirmedAt: now.toISOString(), confirmedBy: "PARTIES" },
      agreedItems: replaceAgreed(j.agreedItems || [], { key: "viewing", label: "موعد المعاينة", value: latest.viewing.at })
    }),
    event: { type: "VIEWING_CONFIRMED", key: [latest.viewing.at, "parties"], text: `اعتمد الطرفان موعد المعاينة ${formatDateTime(at, now)}` },
    notify: { key: `viewing|${latestTarget.journeyId}|confirmed|${latest.viewing.at}`, title: "تم اعتماد موعد المعاينة", body: formatDateTime(at, now), pushType: "appointment", openSession: true }
  });
  return saved;
}

export async function confirmViewingSafe(ctx, args) {
  const journey = await ctx.store.get(journeySegments(args.officeId, args.journeyId));
  if (journey?.viewing?.at) await assertViewingFree(ctx, { officeId: args.officeId, journey, at: journey.viewing.at, end: journey.viewing.end || journey.viewing.endAt });
  const result = await confirmViewing(ctx, args);
  const current = result?.journey || await ctx.store.get(journeySegments(args.officeId, args.journeyId));
  if (current?.viewing?.at) {
    await ctx.store.set(journeySegments(args.officeId, args.journeyId), {
      flowStage: FLOW_STAGE.VIEWING_SCHEDULING,
      agreedItems: replaceAgreed(current.agreedItems || [], { key: "viewing", label: "موعد المعاينة", value: current.viewing.at })
    });
  }
  return result;
}

export async function recordViewingResultSafe(ctx, args) {
  const normalized = args.result === "interested" ? "suitable" : args.result;
  const result = await recordViewingResult(ctx, { ...args, result: normalized });
  if (normalized === "not_suitable") {
    return closeJourney(ctx, { actor: args.actor, officeId: args.officeId, journeyId: args.journeyId, outcome: "LOST", reason: cleanText(args.note, 200) || "العقار غير مناسب بعد المعاينة", finalPrice: 0 });
  }
  const patch = normalized === "needs_negotiation"
    ? { flowStage: FLOW_STAGE.PRICE_NEGOTIATION, activeTopics: ["price"] }
    : { flowStage: FLOW_STAGE.FINAL_AGREEMENT, activeTopics: [] };
  await ctx.store.set(journeySegments(args.officeId, args.journeyId), patch);
  return result;
}
