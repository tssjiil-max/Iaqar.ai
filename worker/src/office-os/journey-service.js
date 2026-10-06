/**
 * Journey service — one opportunity workspace per approved match pair.
 *
 * Every change goes through applyJourneyChange():
 *   1. journey document updated under an updateTime precondition (retried on conflict);
 *      its `openTasks` map records exactly which tasks should be open afterwards;
 *   2. tasks finished/upserted in `operations` (deterministic ids);
 *   3. one timeline event appended (idempotent key).
 * If step 2 or 3 fails after step 1, reconcileOffice() repairs tasks from `openTasks`,
 * so a saved decision is never lost and never duplicated.
 */

import { buildMatchReviewDedupKey, operationDocumentId } from "../operations-domain.js";
import { compatibilityLevel } from "../../../public/os/domain/match-review-domain.js";
import {
  ACTION, EVENT_SOURCE, JOURNEY_STATUS, STAGE, STAGE_LABEL, VIEWING_STATE,
  effectOfViewingResult, isJourneyOpen, viewingResultOf, canMoveStage
} from "../../../public/os/domain/journey-domain.js";
import { lifecycleOf, priceOf, LIFECYCLE } from "../../../public/os/domain/records-domain.js";
import { PHASE, VIEWING_MINUTES, brokerBusy, checkBrokerAvailability, journeyPhase, phaseInfo } from "../../../public/os/domain/deal-flow-domain.js";
import { cleanText, formatDateTime, toDate } from "../../../public/os/domain/format-domain.js";
import { documentChecklist, documentSummary, prepareDocumentChange, sameDocumentEntry } from "../../../public/os/domain/deal-documents-domain.js";
import { AUDIT_ACTIONS, writeAudit } from "./audit-log.js";
import { appendJourneyEvent } from "./event-log.js";
import { finishTasks, journeyTaskId, journeyTitle, notifyBroker, upsertJourneyTask } from "./task-service.js";
import { assertCanActOn, canCloseDeal, forbidden } from "./permissions.js";

const DAY = 86400000;

/** Priority for "المطلوب الآن" when several tasks are open. */
const ACTION_PRIORITY = ["VIEWING_RESULT", "VIEWING_CONFIRM", "PROPOSAL_REPLY", "DEAL_ACTION", "SEND_PROPOSAL", "JOURNEY_FOLLOW_UP", "AWAITING_REPLY"];
const ACTION_BY_TASK = Object.freeze(Object.fromEntries(Object.values(ACTION).map((a) => [a.taskType, a])));

export async function journeyIdForPair(deps, officeId, pairKey) {
  const hex = await deps.sha256Hex(`journey|${officeId}|${pairKey}`);
  return `jr_${hex.slice(0, 40)}`;
}

export function journeySegments(officeId, journeyId) {
  return ["offices", officeId, "journeys", journeyId];
}

function summaryOf(record = {}) {
  return {
    propertyType: cleanText(record.propertyType, 40),
    purpose: String(record.purpose || "").toUpperCase(),
    city: cleanText(record.city, 60),
    district: cleanText(record.district, 80),
    price: priceOf(record),
    area: Number(record.area || 0) || null,
    rooms: Number(record.rooms || 0) || null,
    priceStatus: String(record.priceStatus || "").toUpperCase() === "FIXED" ? "FIXED" : "NEGOTIABLE",
    notes: cleanText(record.notes || record.details, 160)
  };
}

/** One Daily Tasks card per open deal (type DEAL_JOURNEY), never an "action" itself. */
export const DEAL_CARD_TYPE = "DEAL_JOURNEY";

export function deriveCurrentAction(openTasks = {}) {
  const entries = Object.entries(openTasks || {}).filter(([, spec]) => spec?.type !== DEAL_CARD_TYPE);
  if (!entries.length) return null;
  entries.sort((a, b) => ACTION_PRIORITY.indexOf(a[1].type) - ACTION_PRIORITY.indexOf(b[1].type));
  const [taskId, spec] = entries[0];
  const action = ACTION_BY_TASK[spec.type];
  return {
    taskId,
    type: spec.type,
    code: action?.code || spec.type,
    label: spec.actionLabel || action?.label || spec.type,
    reason: spec.reason || "",
    dueAt: spec.dueAt || null
  };
}

async function loadJourney(ctx, officeId, journeyId) {
  const journey = await ctx.store.get(journeySegments(officeId, journeyId));
  if (!journey || String(journey.officeId || "") !== officeId) {
    throw ctx.deps.appError("journey_not_found", 404, "الفرصة غير موجودة");
  }
  return journey;
}

/**
 * @param spec.finish  (task) => boolean — which open tasks to close
 * @param spec.add     [{ type, ref, status, dueAt, reason, actionLabel, proposalId, priority }]
 * @param spec.mutate  (journey) => patch | null  (null = nothing to do, idempotent no-op)
 */
export async function applyJourneyChange(ctx, { officeId, journeyId, actor, finish = () => false, add = [], mutate, event = null, finishStatus = "COMPLETED", notify = null }) {
  const now = ctx.now();
  const additions = [];
  for (const task of add) {
    additions.push({ ...task, id: await journeyTaskId({ officeId, journeyId, type: task.type, ref: task.ref || "" }) });
  }
  const cardId = await journeyTaskId({ officeId, journeyId, type: DEAL_CARD_TYPE, ref: "card" });
  let finishedIds = [];
  const result = await ctx.store.update(journeySegments(officeId, journeyId), async (journey) => {
    const patch = mutate ? await mutate(journey) : {};
    if (patch === null) return null;
    const open = { ...(journey.openTasks || {}) };
    finishedIds = Object.entries(open).filter(([id, spec]) => finish(spec, id)).map(([id]) => id);
    for (const id of finishedIds) delete open[id];
    for (const task of additions) {
      open[task.id] = {
        type: task.type, ref: task.ref || "", status: task.status || "OPEN",
        dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null,
        reason: task.reason || "", actionLabel: task.actionLabel || "", proposalId: task.proposalId || "",
        priority: task.priority || "NORMAL"
      };
    }
    const lastEvent = event ? { text: event.text, at: now.toISOString() } : journey.lastEvent || null;
    // The deal's single current phase, and its one Daily Tasks card while the deal is open.
    const merged = { ...journey, ...patch };
    const phase = journeyPhase(merged, now);
    if (phase === PHASE.CLOSED) delete open[cardId];
    else open[cardId] = { type: DEAL_CARD_TYPE, ref: "card", status: "OPEN", dueAt: null, reason: "", actionLabel: phaseInfo(phase).action, proposalId: "", priority: "NORMAL" };
    return { ...patch, openTasks: open, currentAction: deriveCurrentAction(open), lastEvent, phase, updatedAt: now };
  });
  if (!result) throw ctx.deps.appError("journey_not_found", 404, "الفرصة غير موجودة");
  if (!result.patch) return { journey: result.current, changed: false };
  const journey = { ...result.current, ...result.patch };
  delete journey.__updateTime;
  await finishTasks(ctx.store, { officeId, taskIds: finishedIds.filter((id) => !additions.some((t) => t.id === id)), status: finishStatus, now });
  for (const task of additions) {
    await upsertJourneyTask(ctx.store, ctx.deps, {
      officeId, journey, type: task.type, ref: task.ref || "", status: task.status || "OPEN",
      dueAt: task.dueAt || null, priority: task.priority || "NORMAL", reason: task.reason || "",
      lastEvent: event?.text || "", lastEventAt: now, actionLabel: task.actionLabel || "", proposalId: task.proposalId || "", now
    });
  }
  await upsertDealCard(ctx, { officeId, journey, cardId, lastEvent: event?.text || journey.lastEvent?.text || "", now });
  if (event) {
    await appendJourneyEvent(ctx.store, ctx.deps, {
      officeId, journeyId, key: event.key, type: event.type, text: event.text,
      actorUid: actor?.uid || "", actorRole: event.actorRole || (actor ? "broker" : "system"),
      source: event.source || EVENT_SOURCE.BROKER, payload: event.payload || {}, at: now
    });
  }
  if (notify) {
    const taskId = additions[0]?.id || journey.currentAction?.taskId || "";
    await notifyBroker(ctx.store, ctx.deps, { officeId, journey, taskId, dedupKey: notify.key, title: notify.title, body: notify.body, pushType: notify.pushType || "message", openSession: Boolean(notify.openSession), now })
      .catch((error) => console.warn("[office-os] notify failed", error?.message));
  }
  return { journey, changed: true, finishedIds, addedIds: additions.map((t) => t.id) };
}

/** Keep the deal's one card current: phase, stage label, the one action, last movement. */
async function upsertDealCard(ctx, { officeId, journey, cardId, lastEvent = "", now }) {
  const phase = journeyPhase(journey, now);
  if (phase === PHASE.CLOSED) return;
  const info = phaseInfo(phase);
  await upsertJourneyTask(ctx.store, ctx.deps, {
    officeId, journey, type: DEAL_CARD_TYPE, ref: "card", status: "OPEN",
    priority: journey.session?.intervention?.required ? "HIGH" : "NORMAL",
    dueAt: phase === PHASE.VIEWING && journey.viewing?.at ? journey.viewing.at : null,
    reason: `المرحلة الحالية: ${info.stage}`, actionLabel: info.action,
    lastEvent, lastEventAt: now, now, reopenTerminal: true,
    extra: {
      journeyPhase: phase, journeyStage: info.stage, journeyStep: info.step,
      viewingAt: journey.viewing?.at || null,
      intervention: Boolean(journey.session?.intervention?.required)
    }
  }).catch((error) => console.warn("[office-os] deal card", error?.message));
}

async function loadMatchContext(ctx, officeId, matchId) {
  const match = await ctx.store.get(["offices", officeId, "matches", matchId]);
  if (!match || String(match.officeId || officeId) !== officeId) throw ctx.deps.appError("match_not_found", 404, "المطابقة غير موجودة");
  const offerId = String(match.offerId || match.ownerOfferId || "");
  const requestId = String(match.requestId || match.clientRequestId || "");
  if (!offerId || !requestId) throw ctx.deps.appError("match_incomplete", 409, "المطابقة غير مرتبطة بعرض وطلب");
  const [offer, request] = await Promise.all([
    ctx.store.get(["offices", officeId, "opportunities", offerId]),
    ctx.store.get(["offices", officeId, "opportunities", requestId])
  ]);
  if (!offer || !request) throw ctx.deps.appError("match_records_missing", 409, "أحد سجلي المطابقة غير موجود");
  const reviewTaskId = await operationDocumentId(buildMatchReviewDedupKey({ officeId, matchId, dataVersion: match.dataVersion || "" }));
  const reviewTask = await ctx.store.get(["offices", officeId, "operations", reviewTaskId]);
  return { match, offer, request, offerId, requestId, reviewTaskId, reviewTask };
}

/**
 * Match review decision: approve | reject | postpone. (request_info goes through the
 * proposal service with a match context.)
 */
export async function decideMatchReview(ctx, { actor, officeId, matchId, decision, postponeDays = 1, reason = "" }) {
  const now = ctx.now();
  const { match, offer, request, offerId, requestId, reviewTaskId, reviewTask } = await loadMatchContext(ctx, officeId, matchId);
  assertCanActOn(ctx.deps, actor, reviewTask || match);
  const matchSegments = ["offices", officeId, "matches", matchId];

  if (decision === "reject") {
    if (match.brokerDecision === "REJECTED") return { ok: true, decision, duplicate: true };
    await ctx.store.set(matchSegments, { brokerDecision: "REJECTED", brokerDecisionAt: now, brokerDecisionBy: actor.uid, brokerDecisionReason: cleanText(reason, 200), attentionRequired: false, updatedAt: now });
    await finishTasks(ctx.store, { officeId, taskIds: [reviewTaskId], status: "DISMISSED", reason: cleanText(reason, 200) || "رفض الوسيط المطابقة", now });
    return { ok: true, decision };
  }

  if (decision === "postpone") {
    const days = Math.min(30, Math.max(1, Math.round(Number(postponeDays) || 1)));
    const until = new Date(now.getTime() + days * DAY);
    await ctx.store.set(matchSegments, { brokerDecision: "POSTPONED", brokerDecisionAt: now, brokerDecisionBy: actor.uid, postponedUntil: until, updatedAt: now });
    if (reviewTask) await ctx.store.set(["offices", officeId, "operations", reviewTaskId], { snoozedUntil: until, dueAt: until, updatedAt: now });
    return { ok: true, decision, postponedUntil: until.toISOString() };
  }

  if (decision !== "approve") throw ctx.deps.appError("decision_invalid", 400, "قرار غير معروف");
  if (lifecycleOf(offer) !== LIFECYCLE.ACTIVE || lifecycleOf(request) !== LIFECYCLE.ACTIVE) {
    throw ctx.deps.appError("record_inactive", 409, "أحد السجلين لم يعد نشطًا");
  }
  const pairKey = String(match.canonicalPairKey || matchId);
  const journeyId = await journeyIdForPair(ctx.deps, officeId, pairKey);
  const segments = journeySegments(officeId, journeyId);
  const assignedBrokerId = String(reviewTask?.assignedBrokerId || match.assignedBrokerId || request.brokerId || offer.brokerId || actor.uid || "");
  const level = compatibilityLevel(match.score);
  const created = await ctx.store.create(segments, {
    schemaVersion: 1,
    officeId,
    journeyId,
    matchId,
    pairKey,
    offerId,
    requestId,
    assignedBrokerId,
    stage: STAGE.NEGOTIATION,
    status: JOURNEY_STATUS.ACTIVE,
    offerSummary: summaryOf(offer),
    requestSummary: summaryOf(request),
    compatibility: { score: level.score, label: level.label },
    approvalSnapshotJson: JSON.stringify({ offer: summaryOf(offer), request: summaryOf(request), reasons: match.reasonsJson || "[]", score: match.score || 0 }),
    openTasks: {},
    activeProposals: {},
    lastReplies: {},
    viewing: { state: VIEWING_STATE.NONE },
    approvedBy: actor.uid,
    approvedAt: now,
    createdAt: now,
    updatedAt: now
  });
  let existing = null;
  if (!created) {
    existing = await ctx.store.get(segments);
    if (existing && isJourneyOpen(existing)) {
      await finishTasks(ctx.store, { officeId, taskIds: [reviewTaskId], status: "COMPLETED", now });
      return { ok: true, decision, journeyId, duplicate: true };
    }
  }
  await ctx.store.set(matchSegments, { brokerDecision: "APPROVED", brokerDecisionAt: now, brokerDecisionBy: actor.uid, journeyId, attentionRequired: false, status: "negotiation", updatedAt: now });
  await finishTasks(ctx.store, { officeId, taskIds: [reviewTaskId], status: "COMPLETED", now });
  await applyJourneyChange(ctx, {
    officeId, journeyId, actor,
    mutate: () => existing
      ? { status: JOURNEY_STATUS.ACTIVE, stage: STAGE.NEGOTIATION, matchId, outcome: null, reopenedAt: now, assignedBrokerId }
      : {},
    add: [{ type: "SEND_PROPOSAL", ref: `start:${matchId}`, reason: "تم اعتماد المطابقة — جهّز أول مقترح للطرفين", actionLabel: "تجهيز المقترح" }],
    event: { type: "MATCH_APPROVED", key: [matchId, existing ? "reopen" : "approve"], text: existing ? "أعيد فتح الفرصة باعتماد مطابقة جديدة" : "تم اعتماد المطابقة وبدء التفاوض", payload: { score: match.score || 0 } }
  });
  return { ok: true, decision, journeyId };
}

export async function addBrokerNote(ctx, { actor, officeId, journeyId, text, party = "", optionLabel = "", requestKey }) {
  const journey = await loadJourney(ctx, officeId, journeyId);
  assertCanActOn(ctx.deps, actor, journey);
  const note = cleanText(text, 500);
  if (!note && !optionLabel) throw ctx.deps.appError("note_required", 400, "اكتب الملاحظة");
  const isCall = party === "client" || party === "owner";
  const who = party === "client" ? "العميل" : party === "owner" ? "المالك" : "";
  const eventText = isCall
    ? `رد ${who} بعد اتصال${optionLabel ? `: ${cleanText(optionLabel, 80)}` : ""}${note ? ` — ${note}` : ""}`
    : note;
  return applyJourneyChange(ctx, {
    officeId, journeyId, actor,
    mutate: (j) => (isCall
      ? { lastReplies: { ...(j.lastReplies || {}), [party]: { label: optionLabel || note, text: note, at: ctx.now().toISOString(), source: EVENT_SOURCE.BROKER_NOTE } } }
      : {}),
    event: { type: isCall ? "CALL_OUTCOME" : "BROKER_NOTE", key: [requestKey || ctx.now().toISOString()], text: eventText, source: EVENT_SOURCE.BROKER_NOTE, payload: { party } }
  });
}

export async function acknowledgeReply(ctx, { actor, officeId, journeyId, proposalId }) {
  const journey = await loadJourney(ctx, officeId, journeyId);
  assertCanActOn(ctx.deps, actor, journey);
  const now = ctx.now();
  const proposalSegments = ["offices", officeId, "proposals", proposalId];
  const proposal = await ctx.store.get(proposalSegments);
  if (!proposal || proposal.journeyId !== journeyId) throw ctx.deps.appError("proposal_not_found", 404, "المقترح غير موجود");
  if (proposal.reply && !proposal.reply.lockedAt) {
    await ctx.store.set(proposalSegments, { reply: { ...proposal.reply, lockedAt: now.toISOString(), lockedBy: actor.uid }, updatedAt: now });
  }
  return applyJourneyChange(ctx, {
    officeId, journeyId, actor,
    finish: (task) => (task.type === "PROPOSAL_REPLY" && task.proposalId === proposalId),
    mutate: (j) => (Object.values(j.openTasks || {}).some((t) => t.type === "PROPOSAL_REPLY" && t.proposalId === proposalId) ? {} : null),
    event: { type: "BROKER_NOTE", key: ["ack", proposalId], text: "تمت مراجعة الرد" }
  });
}

/**
 * The viewing time is mirrored on the match, where the Worker's scheduled viewing reminders
 * read it (2 hours · 30 minutes · 10 minutes before, and when the time has passed). Reminders
 * fire only for a viewing the broker confirmed, so the confirmation writes the status the
 * reminder job checks and clears any result left from an earlier viewing of the same deal.
 */
export async function syncMatchAppointment(ctx, officeId, journey, at, { confirmed = false } = {}) {
  const when = toDate(at);
  if (!journey?.matchId || !when) return;
  const fields = confirmed
    ? { appointmentAt: when, appointmentStatus: "CONFIRMED_BY_BROKER", viewingOutcome: "", viewingCompletedAt: "" }
    : { appointmentAt: when };
  await ctx.store.set(["offices", officeId, "matches", journey.matchId], fields).catch((error) => console.warn("[office-os] appointment sync", error?.message));
}

/** A recorded result ends the reminders of that viewing (a new confirmed time starts them again). */
async function endMatchViewing(ctx, officeId, journey, result) {
  if (!journey?.matchId) return;
  await ctx.store.set(["offices", officeId, "matches", journey.matchId], { viewingOutcome: String(result || "done"), viewingCompletedAt: ctx.now() })
    .catch((error) => console.warn("[office-os] viewing end sync", error?.message));
}

export async function confirmViewing(ctx, { actor, officeId, journeyId }) {
  const journey = await loadJourney(ctx, officeId, journeyId);
  assertCanActOn(ctx.deps, actor, journey);
  if (!isJourneyOpen(journey)) throw ctx.deps.appError("journey_closed", 409, "الفرصة مغلقة");
  const viewing = journey.viewing || {};
  if (viewing.state === VIEWING_STATE.CONFIRMED) return { journey, changed: false };
  if (viewing.state !== VIEWING_STATE.ACCEPTED || !viewing.at) {
    throw ctx.deps.appError("viewing_not_accepted", 409, "لا يوجد موعد مقبول لتأكيده");
  }
  const at = toDate(viewing.at);
  const journeys = await ctx.store.list(["offices", officeId, "journeys"], 300);
  const busy = brokerBusy(journeys, journey.assignedBrokerId, { exceptJourneyId: journeyId });
  if (!checkBrokerAvailability(busy, at, new Date(at.getTime() + VIEWING_MINUTES * 60 * 1000)).ok) {
    throw ctx.deps.appError("viewing_conflict", 409, "لدى الوسيط معاينة أخرى في هذا الوقت — اختر موعدًا آخر.");
  }
  const confirmed = await applyJourneyChange(ctx, {
    officeId, journeyId, actor,
    finish: (task) => task.type === "VIEWING_CONFIRM",
    mutate: (j) => (j.viewing?.state === VIEWING_STATE.ACCEPTED
      ? { stage: STAGE.VIEWING, viewing: { ...j.viewing, state: VIEWING_STATE.CONFIRMED, confirmedAt: ctx.now().toISOString(), confirmedBy: actor.uid } }
      : null),
    add: [{ type: "VIEWING_RESULT", ref: `viewing:${viewing.at}`, dueAt: at, reason: `معاينة مؤكدة ${formatDateTime(at, ctx.now())}`, actionLabel: "نتيجة المعاينة" }],
    event: { type: "VIEWING_CONFIRMED", key: [viewing.at], text: `تم تأكيد موعد المعاينة ${formatDateTime(at, ctx.now())}` }
  });
  if (confirmed.changed) await syncMatchAppointment(ctx, officeId, confirmed.journey, viewing.at, { confirmed: true });
  return confirmed;
}

export async function recordViewingResult(ctx, { actor, officeId, journeyId, result, note = "" }) {
  const journey = await loadJourney(ctx, officeId, journeyId);
  assertCanActOn(ctx.deps, actor, journey);
  if (!isJourneyOpen(journey)) throw ctx.deps.appError("journey_closed", 409, "الفرصة مغلقة");
  const option = viewingResultOf(result);
  if (!option) throw ctx.deps.appError("viewing_result_invalid", 400, "اختر نتيجة المعاينة");
  const effect = effectOfViewingResult(result);
  const cleanNote = cleanText(note, 500);
  const now = ctx.now();
  const viewingKey = String(journey.viewing?.at || "direct");
  const closing = effect.next === "CLOSE_MATCH";
  const add = [];
  if (effect.next === "AGREEMENT_FOLLOW_UP") add.push({ type: "DEAL_ACTION", ref: `agreement:${viewingKey}`, reason: "المعاينة مناسبة — أنهِ الصفقة", actionLabel: "إنهاء الصفقة" });

  // «لا يوجد رد»: nothing is decided. The result task stays open and returns after the follow-up
  // period; the viewing itself is not marked done, so the real result can still be recorded.
  if (effect.next === "FOLLOW_UP_RESULT") {
    const openResult = Object.values(journey.openTasks || {}).find((task) => task.type === "VIEWING_RESULT");
    const due = new Date(now.getTime() + Number(effect.followUpInDays || 2) * 24 * 60 * 60 * 1000);
    return applyJourneyChange(ctx, {
      officeId, journeyId, actor,
      mutate: (j) => {
        const last = j.viewing?.followUp || {};
        if (last.result === result && last.note === cleanNote && toDate(last.at) && now.getTime() - toDate(last.at).getTime() < 60 * 1000) return null;
        return { viewing: { ...(j.viewing || {}), followUp: { result, label: option.label, note: cleanNote, at: now.toISOString(), by: actor.uid, count: Number(last.count || 0) + 1 } } };
      },
      add: [{ type: "VIEWING_RESULT", ref: openResult?.ref || `viewing:${viewingKey}`, dueAt: due, reason: "لا يوجد رد بعد المعاينة — تابع الطرف ثم سجّل النتيجة", actionLabel: "نتيجة المعاينة" }],
      event: { type: "VIEWING_RESULT", key: [viewingKey, result, cleanNote, now.toISOString().slice(0, 16)], text: `بعد المعاينة: ${option.label} — متابعة ${formatDateTime(due, now)}${cleanNote ? ` — ${cleanNote}` : ""}` }
    });
  }

  // «معاينة أخرى» / «لم يحضر»: the deal stays in the viewing stage and needs a new time.
  if (effect.next === "RESCHEDULE_VIEWING") {
    const reason = result === "no_show" ? "لم يحضر أحد الطرفين — حدّد موعد معاينة جديدًا" : "مطلوب معاينة أخرى — حدّد موعدًا جديدًا";
    const rescheduled = await applyJourneyChange(ctx, {
      officeId, journeyId, actor,
      finish: (task) => task.type === "VIEWING_RESULT" || task.type === "VIEWING_CONFIRM" || task.type === "SEND_PROPOSAL",
      mutate: (j) => {
        const v = j.viewing || {};
        // Already waiting for a new time with this same answer: a repeated press changes nothing.
        if (v.rescheduleRequested === true && String(v.state || "") === VIEWING_STATE.NONE && v.previous?.result === result && String(v.previous?.note || "") === cleanNote) return null;
        return {
          stage: STAGE.VIEWING,
          viewing: {
            state: VIEWING_STATE.NONE, rescheduleRequested: true, attempts: Number(v.attempts || 1) + 1,
            previous: { at: v.at || null, result, resultLabel: option.label, note: cleanNote, recordedAt: now.toISOString(), recordedBy: actor.uid }
          }
        };
      },
      add: [{ type: "SEND_PROPOSAL", ref: `reviewing:${viewingKey}:${result}`, reason, actionLabel: "تحديد موعد" }],
      event: { type: "VIEWING_RESULT", key: [viewingKey, result, cleanNote], text: `نتيجة المعاينة: ${option.label}${cleanNote ? ` — ${cleanNote}` : ""} — مطلوب موعد جديد` }
    });
    if (rescheduled.changed) await endMatchViewing(ctx, officeId, journey, result);
    return rescheduled;
  }

  const res = await applyJourneyChange(ctx, {
    officeId, journeyId, actor,
    finishStatus: closing ? "DISMISSED" : "COMPLETED",
    finish: (task) => closing || task.type === "VIEWING_RESULT" || task.type === "VIEWING_CONFIRM",
    mutate: (j) => {
      if (j.viewing?.result === result && j.viewing?.state === VIEWING_STATE.DONE && j.viewing?.resultNote === cleanNote) return null;
      const viewing = { ...(j.viewing || {}), state: VIEWING_STATE.DONE, result, resultLabel: option.label, resultNote: cleanNote, doneAt: now.toISOString(), recordedBy: actor.uid };
      if (closing) {
        return {
          viewing, status: JOURNEY_STATUS.CLOSED_LOST, stage: STAGE.CLOSED, closedAt: now, archivedAt: now, activeProposals: {},
          outcome: { result: "LOST", reason: "غير مناسب بعد المعاينة", finalPrice: null, closedAt: now.toISOString(), closedBy: actor.uid }
        };
      }
      if (effect.next === "REOPEN_PRICE") {
        // The price is open again: nobody is «جاهز للاتفاق» until a new price is agreed.
        const session = { ...(j.session || {}), agreedPrice: null, agreedAt: null, lastMove: null, priceReopened: true, reopenedAt: now.toISOString(), ready: {} };
        return { viewing, stage: STAGE.NEGOTIATION, session };
      }
      return { viewing, stage: effect.stage || j.stage };
    },
    add,
    event: { type: "VIEWING_RESULT", key: [viewingKey, result, cleanNote], text: `نتيجة المعاينة: ${option.label}${cleanNote ? ` — ${cleanNote}` : ""}${closing ? " — أُغلقت هذه المطابقة" : ""}` }
  });
  if (res.changed) await endMatchViewing(ctx, officeId, journey, result);
  if (closing && res.changed) await afterJourneyClosed(ctx, officeId, journey, { won: false });
  return res;
}

export async function moveStage(ctx, { actor, officeId, journeyId, stage }) {
  const journey = await loadJourney(ctx, officeId, journeyId);
  assertCanActOn(ctx.deps, actor, journey);
  if (!canMoveStage(journey, stage)) throw ctx.deps.appError("stage_invalid", 409, "لا يمكن الانتقال لهذه المرحلة");
  const add = stage === STAGE.AGREEMENT
    ? [{ type: "DEAL_ACTION", ref: `agreement:stage:${ctx.now().toISOString()}`, reason: "انتقلت الفرصة لمتابعة الاتفاق", actionLabel: "متابعة الاتفاق" }]
    : [{ type: "SEND_PROPOSAL", ref: `stage:${stage}:${ctx.now().toISOString()}`, reason: stage === STAGE.VIEWING ? "اقترح موعد معاينة على الطرفين" : "أعيدت الفرصة للتفاوض — جهّز المقترح التالي", actionLabel: stage === STAGE.VIEWING ? "اقتراح موعد" : "تجهيز المقترح" }];
  return applyJourneyChange(ctx, {
    officeId, journeyId, actor,
    finish: (task) => ["SEND_PROPOSAL", "DEAL_ACTION", "JOURNEY_FOLLOW_UP", "PROPOSAL_REPLY"].includes(task.type),
    mutate: (j) => (j.stage === stage ? null : { stage }),
    add,
    event: { type: "STAGE_CHANGED", key: [stage, ctx.now().toISOString()], text: `انتقلت الفرصة إلى مرحلة ${STAGE_LABEL[stage]}` }
  });
}

export async function pauseJourney(ctx, { actor, officeId, journeyId, resumeInDays = 7, reason = "" }) {
  const journey = await loadJourney(ctx, officeId, journeyId);
  assertCanActOn(ctx.deps, actor, journey);
  if (journey.status !== JOURNEY_STATUS.ACTIVE) return { journey, changed: false };
  const days = Math.min(90, Math.max(1, Math.round(Number(resumeInDays) || 7)));
  const due = new Date(ctx.now().getTime() + days * DAY);
  return applyJourneyChange(ctx, {
    officeId, journeyId, actor,
    finish: (task) => task.type !== "AWAITING_REPLY",
    finishStatus: "DISMISSED",
    mutate: (j) => (j.status === JOURNEY_STATUS.ACTIVE ? { status: JOURNEY_STATUS.PAUSED, pausedAt: ctx.now(), pauseReason: cleanText(reason, 200) } : null),
    add: [{ type: "JOURNEY_FOLLOW_UP", ref: `pause:${ctx.now().toISOString()}`, dueAt: due, reason: `استئناف الفرصة المتوقفة${reason ? ` — ${cleanText(reason, 120)}` : ""}`, actionLabel: "استئناف الفرصة" }],
    event: { type: "PAUSED", key: [ctx.now().toISOString()], text: `تم إيقاف الفرصة مؤقتًا${reason ? ` — ${cleanText(reason, 120)}` : ""}` }
  });
}

export async function resumeJourney(ctx, { actor, officeId, journeyId }) {
  const journey = await loadJourney(ctx, officeId, journeyId);
  assertCanActOn(ctx.deps, actor, journey);
  if (journey.status !== JOURNEY_STATUS.PAUSED) return { journey, changed: false };
  return applyJourneyChange(ctx, {
    officeId, journeyId, actor,
    finish: (task) => task.type === "JOURNEY_FOLLOW_UP",
    mutate: (j) => (j.status === JOURNEY_STATUS.PAUSED ? { status: JOURNEY_STATUS.ACTIVE, resumedAt: ctx.now() } : null),
    add: [{ type: "SEND_PROPOSAL", ref: `resume:${ctx.now().toISOString()}`, reason: "استؤنفت الفرصة — جهّز المقترح التالي", actionLabel: "تجهيز المقترح" }],
    event: { type: "RESUMED", key: [ctx.now().toISOString()], text: "تم استئناف الفرصة" }
  });
}

export async function completeFollowUp(ctx, { actor, officeId, journeyId, taskId, note = "" }) {
  const journey = await loadJourney(ctx, officeId, journeyId);
  assertCanActOn(ctx.deps, actor, journey);
  const spec = (journey.openTasks || {})[taskId];
  if (!spec) return { journey, changed: false };
  if (!["JOURNEY_FOLLOW_UP", "DEAL_ACTION", "SEND_PROPOSAL"].includes(spec.type)) {
    throw ctx.deps.appError("task_not_completable", 409, "هذه المهمة تُنجز بإجرائها");
  }
  const cleanNote = cleanText(note, 300);
  return applyJourneyChange(ctx, {
    officeId, journeyId, actor,
    finish: (_task, id) => id === taskId,
    mutate: (j) => ((j.openTasks || {})[taskId] ? {} : null),
    event: { type: "FOLLOW_UP_DONE", key: [taskId], text: `تمت المتابعة${cleanNote ? ` — ${cleanNote}` : ""}` }
  });
}

/**
 * «مستندات الصفقة»: mark one document ناقص / موجود / تمت المراجعة / غير مطلوب, add an own item,
 * or remove an own item. Each change is a timeline event of the deal and an audit entry.
 */
export async function updateDealDocument(ctx, { actor, officeId, journeyId, documentId = "", status = "", note, label = "", remove = false, libraryItemId = "", unlinkFile = false }) {
  const journey = await loadJourney(ctx, officeId, journeyId);
  assertCanActOn(ctx.deps, actor, journey);
  if (!isJourneyOpen(journey)) throw ctx.deps.appError("journey_closed", 409, "الصفقة مغلقة — مستنداتها للعرض فقط");
  const now = ctx.now();
  // «إرفاق من المكتبة»: only a reference is saved. The file stays in the office library with its own access rules.
  let file;
  if (libraryItemId) {
    if (!/^[A-Za-z0-9_-]{6,160}$/.test(String(libraryItemId))) throw ctx.deps.appError("library_item_invalid", 400, "اختر ملفًا من مكتبة المكتب");
    const item = await ctx.store.get(["offices", officeId, "library", String(libraryItemId)]);
    if (!item || (item.officeId && !ctx.deps.officeIdsEquivalent(item.officeId, officeId))) throw ctx.deps.appError("library_item_not_found", 404, "الملف غير موجود في مكتبة المكتب");
    file = { libraryId: String(libraryItemId), title: cleanText(item.documentTitle || item.fileName, 120) };
  }
  const linkInput = file ? { file } : unlinkFile ? { unlinkFile: true } : {};
  const newId = documentId ? "" : `custom_${(await ctx.deps.sha256Hex(`doc|${officeId}|${journeyId}|${cleanText(label, 80)}`)).slice(0, 16)}`;
  const change = prepareDocumentChange(journey, { documentId, status, note, label, remove, ...linkInput }, { now, actorUid: actor.uid, newId });
  if (!change.ok) throw ctx.deps.appError("document_invalid", 400, change.error);
  const result = await applyJourneyChange(ctx, {
    officeId, journeyId, actor,
    mutate: (j) => {
      const documents = { ...(j.documents || {}) };
      if (change.remove) {
        if (!documents[change.id]) return null;
        delete documents[change.id];
        return { documents };
      }
      // Re-validate against the live document so two brokers never overwrite each other's item.
      const live = prepareDocumentChange(j, { documentId, status, note, label, remove, ...linkInput }, { now, actorUid: actor.uid, newId });
      if (!live.ok || sameDocumentEntry(documents[live.id], live.entry)) return null;
      documents[live.id] = live.entry;
      return { documents };
    },
    event: {
      type: "DOCUMENT_UPDATED", key: [change.id, change.remove ? "remove" : change.entry.status, change.remove ? "" : change.entry.note, change.fileChange ? `${change.fileChange}:${change.entry.file?.libraryId || ""}` : "", now.toISOString().slice(0, 16)],
      text: `مستند «${change.label}»: ${change.statusLabel}${!change.remove && change.entry.note ? ` — ${change.entry.note}` : ""}`
    }
  });
  if (result.changed) {
    await writeAudit(ctx, {
      officeId, action: AUDIT_ACTIONS.DEAL_DOCUMENT_UPDATED, actorUid: actor.uid, entityType: "deal", entityId: journeyId,
      key: `${change.id}:${change.remove ? "remove" : change.entry.status}:${now.toISOString()}`,
      details: { documentId: change.id, label: change.label, status: change.remove ? "REMOVED" : change.entry.status, file: change.fileChange || undefined }
    });
  }
  const summary = documentSummary(documentChecklist(result.journey));
  return { ...result, documentId: change.id, summary: { required: summary.required, present: summary.present, missing: summary.missing, reviewed: summary.reviewed, complete: summary.complete } };
}

/** Explicit completion: WON needs the permission holder; LOST closes without a deal. */
export async function closeJourney(ctx, { actor, officeId, journeyId, outcome, reason = "", finalPrice = 0 }) {
  const journey = await loadJourney(ctx, officeId, journeyId);
  assertCanActOn(ctx.deps, actor, journey);
  if (!isJourneyOpen(journey)) return { journey, changed: false };
  const won = outcome === "WON";
  if (!won && outcome !== "LOST") throw ctx.deps.appError("outcome_invalid", 400, "حدد نتيجة الإغلاق");
  if (won) {
    const dealSettings = (await ctx.store.get(["offices", officeId, "officeSettings", "deals"])) || {};
    if (!canCloseDeal(actor, journey, dealSettings)) throw forbidden(ctx.deps, "إتمام الصفقة يتطلب صلاحية مدير المكتب");
  }
  const now = ctx.now();
  const cleanReason = cleanText(reason, 200);
  const price = Math.max(0, Math.round(Number(finalPrice) || 0));
  // The state of the documents at closing is kept with the outcome (the broker decides; nothing is hidden).
  const docs = documentSummary(documentChecklist(journey));
  const documentsAtClose = { required: docs.required, present: docs.present, missing: docs.missing, reviewed: docs.reviewed, missingLabels: docs.missingLabels.slice(0, 12) };
  const res = await applyJourneyChange(ctx, {
    officeId, journeyId, actor,
    finish: () => true,
    finishStatus: "DISMISSED",
    mutate: (j) => (isJourneyOpen(j)
      ? {
        status: won ? JOURNEY_STATUS.CLOSED_WON : JOURNEY_STATUS.CLOSED_LOST,
        stage: STAGE.CLOSED,
        closedAt: now,
        archivedAt: now,
        activeProposals: {},
        outcome: { result: won ? "WON" : "LOST", reason: cleanReason, finalPrice: price || null, closedAt: now.toISOString(), closedBy: actor.uid, ...(won ? { documents: documentsAtClose } : {}) }
      }
      : null),
    event: {
      type: won ? "CLOSED_WON" : "CLOSED_LOST", key: ["close"],
      text: won
        ? `تم إتمام الصفقة${price ? ` بسعر ${price.toLocaleString("en-US")} ريال` : ""}${docs.missing ? ` — مستندات ناقصة عند الإتمام: ${docs.missing}` : ""}`
        : `أغلقت الفرصة دون صفقة${cleanReason ? ` — ${cleanReason}` : ""}`
    }
  });
  await afterJourneyClosed(ctx, officeId, journey, { won });
  if (res.changed) {
    await writeAudit(ctx, {
      officeId, action: AUDIT_ACTIONS.DEAL_CLOSED, actorUid: actor.uid, entityType: "deal", entityId: journeyId, key: "close",
      details: { result: won ? "WON" : "LOST", finalPrice: price || null, reason: cleanReason, documentsMissing: won ? docs.missing : undefined }
    });
  }
  return res;
}

/**
 * After a deal closes (by the broker, a declined fixed price or «غير مناسب»): stop reply
 * and session links and mark this match closed. The offer and the request are NOT touched,
 * so both stay available for other matches.
 */
export async function afterJourneyClosed(ctx, officeId, journey, { won = false } = {}) {
  const now = ctx.now();
  // Close the remaining active reply links so nobody can answer a closed opportunity.
  for (const proposalId of Object.values(journey.activeProposals || {})) {
    const proposal = await ctx.store.get(["offices", officeId, "proposals", proposalId]);
    if (!proposal || !["ACTIVE", "ANSWERED"].includes(proposal.status)) continue;
    await ctx.store.set(["offices", officeId, "proposals", proposalId], { status: "CANCELLED", cancelledAt: now, updatedAt: now });
    if (proposal.linkHash) await ctx.store.set(["replyLinks", proposal.linkHash], { status: "CANCELLED", updatedAt: now });
  }
  await ctx.store.set(["offices", officeId, "matches", journey.matchId], { status: won ? "completed" : "closed", updatedAt: now }).catch(() => {});
  // Negotiation session links stop with the deal.
  for (const role of ["owner", "client"]) {
    const hash = journey.sessionLinks?.[role]?.hash;
    if (hash) await ctx.store.set(["sessionLinks", hash], { status: "CLOSED", updatedAt: now }).catch(() => {});
  }
}

/**
 * Repair pass (idempotent, bounded):
 *  - current, valid matches with no broker decision whose MATCH_REVIEW task is missing
 *    get it re-created through the existing matching pipeline;
 *  - open journeys whose `openTasks` entries are missing in `operations` get them back.
 */
export async function reconcileOffice(ctx, { officeId, limit = 25 }) {
  let reviews = 0;
  let tasks = 0;
  const matches = await ctx.store.list(["offices", officeId, "matches"], 300);
  const operations = await ctx.store.list(["offices", officeId, "operations"], 300);
  const opIds = new Set(operations.map((op) => op.id));
  for (const match of matches) {
    if (reviews >= limit) break;
    if (match.isCurrent === false || String(match.status || "active") !== "active" || match.brokerDecision) continue;
    if (match.integrityStatus && match.integrityStatus !== "valid") continue;
    if (Number(match.score || 0) < 55) continue;
    const reviewId = await operationDocumentId(buildMatchReviewDedupKey({ officeId, matchId: match.id, dataVersion: match.dataVersion || "" }));
    if (opIds.has(reviewId)) continue;
    if (typeof ctx.deps.ensureMatchReview !== "function") break;
    try {
      await ctx.deps.ensureMatchReview({ officeId, match });
      reviews += 1;
    } catch (error) {
      await recordFailure(ctx, officeId, "MATCH_REVIEW_RECONCILE", match.id, error);
    }
  }
  const journeys = await ctx.store.list(["offices", officeId, "journeys"], 300);
  for (const journey of journeys) {
    if (!isJourneyOpen(journey)) continue;
    for (const [taskId, spec] of Object.entries(journey.openTasks || {})) {
      if (opIds.has(taskId)) continue;
      await upsertJourneyTask(ctx.store, ctx.deps, {
        officeId, journey: { ...journey, journeyId: journey.journeyId || journey.id }, type: spec.type, ref: spec.ref, status: spec.status,
        dueAt: spec.dueAt, priority: spec.priority, reason: spec.reason, actionLabel: spec.actionLabel,
        proposalId: spec.proposalId, lastEvent: journey.lastEvent?.text || "", lastEventAt: journey.lastEvent?.at || null, now: ctx.now()
      });
      tasks += 1;
    }
  }
  return { reviews, tasks };
}

export async function recordFailure(ctx, officeId, kind, ref, error) {
  const now = ctx.now();
  const hex = await ctx.deps.sha256Hex(`${kind}|${ref}|${now.toISOString().slice(0, 13)}`);
  await ctx.store.set(["offices", officeId, "osFailures", `fl_${hex.slice(0, 32)}`], {
    officeId, kind, ref: String(ref || ""), message: String(error?.message || error).slice(0, 300),
    code: String(error?.code || ""), at: now, resolved: false
  }).catch(() => {});
}

export { loadJourney, journeyTitle };
