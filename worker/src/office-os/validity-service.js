/**
 * صلاحية العروض والطلبات والتأكد من التوفر — Worker side (rules in public/os/domain/validity-domain.js).
 *
 *   • The broker sets a record's duration/urgency, records an answer (متاح / تم البيع / تم التأجير /
 *     وجد العقار / إيقاف) or reactivates it — the same record, never a new one, never deleted.
 *   • The sweep (cron, and /os/validity/sweep for the manager) takes records whose time ran out out of
 *     NEW matching (the existing engine supersedes their matches, as for «إيقاف»), and — only when the
 *     office's agent and bot are on and the side is linked to the bot — asks the side with buttons.
 *     A side that is not reachable gets nothing; only a record inside an open deal reaches the broker.
 *   • A side's answer (a button, or its own words turned into a confirmation button) changes only
 *     availability or the duration: nothing financial or legal, and an open deal is never closed by it.
 *
 *   validityAsks/<token>   what a button refers to (record, side, offered answer) — Worker only
 */

import {
  ANSWER, AVAILABILITY_LABEL, STATE, STATE_LABEL, answerOptions, applyAnswer, availabilityIntent, nextValidityStep, renewFields,
  validityFields, validityState
} from "../../../public/os/domain/validity-domain.js";
import { recordTitle, kindOf } from "../../../public/os/domain/records-domain.js";
import { isJourneyOpen } from "../../../public/os/domain/journey-domain.js";
import { buildMatchReviewDedupKey, operationDocumentId } from "../operations-domain.js";
import { assertCanActOn } from "./permissions.js";
import { AUDIT_ACTIONS, writeAudit } from "./audit-log.js";
import { botOutboundConfig, botSettings, notifyOffice, partyKey, partyLinkFor, sendToParty } from "./bot-notify.js";
import { partyPhone } from "../../../public/os/domain/bot-domain.js";
import { holdRecord } from "./records-service.js";

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const SYSTEM_ACTOR = Object.freeze({ uid: "office-agent", role: "owner", isManager: true });

async function loadRecord(ctx, officeId, recordId) {
  const record = await ctx.store.get(["offices", officeId, "opportunities", text(recordId, 120)]);
  if (!record || String(record.officeId || officeId) !== officeId) throw ctx.deps.appError("record_not_found", 404, "السجل غير موجود");
  return { ...record, id: text(recordId, 120) };
}

async function rematch(ctx, officeId, recordId) {
  if (typeof ctx.deps.runMatching !== "function") return;
  await ctx.deps.runMatching({ officeId, opportunityId: recordId, notify: true }).catch((error) => console.warn("[office-os] validity rematch failed", error?.message));
}

/**
 * The record left matching while it is inside an open deal: its OTHER current matches stop (and their review
 * tasks), but the deal's own match and tasks are left exactly as they are — the broker reviews the deal.
 */
async function stopOtherMatches(ctx, officeId, recordId, keepMatchIds) {
  const now = ctx.now();
  const matches = await ctx.store.list(["offices", officeId, "matches"], 300).catch(() => []);
  for (const m of matches) {
    if (keepMatchIds.has(m.id) || m.isCurrent === false || String(m.status || "active") === "superseded") continue;
    if ((m.offerId || m.ownerOfferId) !== recordId && (m.requestId || m.clientRequestId) !== recordId) continue;
    await ctx.store.set(["offices", officeId, "matches", m.id], { isCurrent: false, status: "superseded", statusLabel: "أُلغيت لأن السجل لم يعد صالحًا للمطابقة", supersededAt: now, attentionRequired: false, updatedAt: now });
    const reviewId = await operationDocumentId(buildMatchReviewDedupKey({ officeId, matchId: m.id, dataVersion: m.dataVersion || "" }));
    const review = await ctx.store.get(["offices", officeId, "operations", reviewId]);
    if (review && ["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE"].includes(String(review.status))) {
      await ctx.store.set(["offices", officeId, "operations", reviewId], { status: "EXPIRED", updatedAt: now, dismissalReason: "السجل لم يعد صالحًا للمطابقة" });
    }
  }
}

/** Out of NEW matching: the full engine path when no deal is open; otherwise only the other matches stop. */
async function leaveMatching(ctx, officeId, recordId) {
  const open = await openJourneysOf(ctx, officeId, recordId);
  if (!open.length) { await rematch(ctx, officeId, recordId); return open; }
  await stopOtherMatches(ctx, officeId, recordId, new Set(open.map((j) => j.matchId).filter(Boolean)));
  return open;
}

async function openJourneysOf(ctx, officeId, recordId) {
  const journeys = await ctx.store.list(["offices", officeId, "journeys"], 300);
  return journeys.filter((j) => isJourneyOpen(j) && (j.offerId === recordId || j.requestId === recordId)).map((j) => ({ ...j, journeyId: j.journeyId || j.id }));
}

/** One task per record and step (same id when retried): FOLLOWING while a side is asked, NEEDS_YOU for exceptions. */
async function upsertValidityTask(ctx, { officeId, record, type, ref, status, reason, priority = "NORMAL" }) {
  const key = `VALIDITY|${officeId}|${record.id}|${type}|${ref}`;
  const id = await operationDocumentId(key);
  const segments = ["offices", officeId, "operations", id];
  const existing = await ctx.store.get(segments);
  if (existing && ["COMPLETED", "DISMISSED", "EXPIRED"].includes(String(existing.status || "").toUpperCase())) return id;
  const now = ctx.now();
  await ctx.store.set(segments, {
    schemaVersion: 1, id, officeId, assignedBrokerId: text(record.brokerId, 128), type, sourceEntityType: "record", sourceEntityId: record.id,
    opportunityId: record.id, titleText: type === "AVAILABILITY_CHECK" ? "تأكيد التوفر" : "صلاحية تحتاج قرارك", summaryText: reason,
    status, priority, deduplicationKey: key, createdAt: existing?.createdAt ? new Date(existing.createdAt) : now, updatedAt: now, createdBySystem: true,
    operationVersion: Number(existing?.operationVersion || 0) + 1,
    metadataJson: JSON.stringify({ opportunityTitle: recordTitle(record), reason, actionLabel: type === "AVAILABILITY_CHECK" ? "عرض السجل" : "مراجعة السجل" }), missingFieldsJson: "[]"
  });
  return id;
}

async function finishValidityTasks(ctx, officeId, recordId, completedBy) {
  const ops = await ctx.store.list(["offices", officeId, "operations"], 1000);
  const now = ctx.now();
  for (const op of ops) {
    if (op.opportunityId !== recordId || !["AVAILABILITY_CHECK", "AVAILABILITY_ATTENTION"].includes(String(op.type)) || !["OPEN", "WAITING_EXTERNAL_RESPONSE", "IN_PROGRESS"].includes(String(op.status))) continue;
    await ctx.store.set(["offices", officeId, "operations", op.id], { status: "COMPLETED", completedAt: now, completedBy, updatedAt: now });
  }
}

// ------------------------------------------------------------------ the broker

/** «مدة العرض أو الطلب» set or changed from the app (same record; matching re-runs when it opens again). */
export async function setRecordValidity(ctx, { actor, officeId, recordId, duration, customDate = "", urgent = false }) {
  const record = await loadRecord(ctx, officeId, recordId);
  assertCanActOn(ctx.deps, actor, record);
  const before = validityState(record, ctx.now());
  const built = validityFields({ duration, customDate, urgent: urgent === true, chosen: true, now: ctx.now(), confirmedBy: `broker:${actor.uid}` });
  if (!built.ok) throw ctx.deps.appError("validity_invalid", 400, built.error);
  await ctx.store.set(["offices", officeId, "opportunities", record.id], { ...built.fields, validityAskedFor: "", updatedAt: ctx.now() });
  await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.RECORD_VALIDITY_SET, actorUid: actor.uid, entityType: "record", entityId: record.id, key: ctx.now().toISOString(), details: { duration: built.fields.validityDuration, urgent: built.fields.validityUrgent } });
  if (before !== STATE.ACTIVE) await rematch(ctx, officeId, record.id);
  return { ok: true, state: STATE.ACTIVE };
}

/**
 * An answer recorded by the broker or confirmed by the side: متاح/ما زلت أبحث (renew), تم البيع/التأجير/وجد (unavailable),
 * إيقاف (the existing «إيقاف»). Inside an open deal nothing about the deal changes: the broker is told to review it.
 */
export async function applyAvailabilityAnswer(ctx, { actor = SYSTEM_ACTOR, officeId, recordId, answer, by = "" }) {
  const record = await loadRecord(ctx, officeId, recordId);
  if (actor !== SYSTEM_ACTOR) assertCanActOn(ctx.deps, actor, record);
  const now = ctx.now();
  const who = by || `broker:${actor.uid}`;
  if (answer === ANSWER.PAUSE) {
    const held = await holdRecord(ctx, { actor, officeId, recordId: record.id, kind: "PAUSED", reason: "طلب صاحب السجل إيقافه مؤقتًا" });
    await finishValidityTasks(ctx, officeId, record.id, actor === SYSTEM_ACTOR ? "AGENT" : actor.uid);
    return { ok: true, state: STATE.PAUSED, ...held };
  }
  const patch = applyAnswer(record, answer, { now, by: who });
  if (!patch) throw ctx.deps.appError("validity_answer_invalid", 400, "إجابة غير معروفة");
  await ctx.store.set(["offices", officeId, "opportunities", record.id], { ...patch, updatedAt: now, version: Number(record.version || 1) + 1 });
  await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.RECORD_AVAILABILITY, actorUid: actor === SYSTEM_ACTOR ? "office-agent" : actor.uid, entityType: "record", entityId: record.id, key: `${answer}|${now.toISOString()}`, details: { answer, by: who } });
  await finishValidityTasks(ctx, officeId, record.id, actor === SYSTEM_ACTOR ? "AGENT" : actor.uid);
  // Renewed → back into matching; unavailable → its open matches stop (no new ones), an open deal is left as it is.
  const unavailable = [ANSWER.SOLD, ANSWER.RENTED, ANSWER.FOUND].includes(answer);
  const openDeals = unavailable ? await leaveMatching(ctx, officeId, record.id) : (await rematch(ctx, officeId, record.id), []);
  // An offer confirmed available: the matches that were waiting for this confirmation continue (the bot's own gates apply).
  if (answer === ANSWER.AVAILABLE && kindOf(record) === "OFFER") {
    const matches = await ctx.store.list(["offices", officeId, "matches"], 300).catch(() => []);
    const waiting = matches.filter((m) => (m.offerId || m.ownerOfferId) === record.id && m.isCurrent !== false && String(m.status || "active") === "active" && !m.brokerDecision && !m.botAskState);
    if (waiting.length) {
      const { askPartiesAboutMatch } = await import("./bot-service.js");
      for (const match of waiting.slice(0, 5)) await askPartiesAboutMatch(ctx, { officeId, matchId: match.id }).catch(() => {});
    }
  }
  let dealsToReview = 0;
  if (unavailable) {
    for (const journey of openDeals) {
      dealsToReview += 1;
      await upsertValidityTask(ctx, { officeId, record, type: "AVAILABILITY_ATTENTION", ref: `deal:${journey.journeyId}:${answer}`, status: "OPEN", priority: "HIGH",
        reason: `${AVAILABILITY_LABEL[answer]} أثناء صفقة مفتوحة — راجع الصفقة (لم يُغلق شيء تلقائيًا)` });
    }
  }
  return { ok: true, state: validityState({ ...record, ...patch }, now), dealsToReview };
}

/** «إعادة تفعيل»: the same record, a fresh confirmation and a new period; history is kept. */
export async function reactivateRecord(ctx, { actor, officeId, recordId, duration = "", customDate = "" }) {
  const record = await loadRecord(ctx, officeId, recordId);
  assertCanActOn(ctx.deps, actor, record);
  const renewed = renewFields(record, { duration, customDate, now: ctx.now(), confirmedBy: `broker:${actor.uid}` });
  if (!renewed.ok) throw ctx.deps.appError("validity_invalid", 400, renewed.error);
  await ctx.store.set(["offices", officeId, "opportunities", record.id], { ...renewed.fields, validityAskedFor: "", reactivatedAt: ctx.now().toISOString(), reactivatedBy: actor.uid, updatedAt: ctx.now(), version: Number(record.version || 1) + 1 });
  await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.RECORD_REACTIVATED, actorUid: actor.uid, entityType: "record", entityId: record.id, key: ctx.now().toISOString() });
  await finishValidityTasks(ctx, officeId, record.id, actor.uid);
  await rematch(ctx, officeId, record.id);
  return { ok: true, state: STATE.ACTIVE };
}

// ------------------------------------------------------------------ asking a side

async function officeLabel(ctx, officeId) {
  const office = (await ctx.store.get(["offices", officeId])) || {};
  return text(office.businessName || office.officeName || office.name, 80) || "المكتب";
}

/** Can the office manager write to this record's side right now? (all three gates, plus the office's agent switch) */
async function reachableSide(ctx, officeId, record) {
  if (!botOutboundConfig(ctx.env).available) return null;
  if ((await botSettings(ctx.store, officeId)).enabled !== true) return null;
  if ((await ctx.store.get(["offices", officeId, "agentSettings", "main"]))?.enabled !== true) return null;
  return partyLinkFor(ctx.store, ctx.deps, officeId, record);
}

async function issueButtons(ctx, { officeId, record, link, options }) {
  const token = (await ctx.deps.sha256Hex(`validity-ask|${officeId}|${record.id}|${crypto.randomUUID()}`)).slice(0, 24);
  await ctx.store.set(["validityAsks", token], { officeId, recordId: record.id, partyKey: link.key, options: options.map((o) => o.id), createdAt: ctx.now() });
  return options.map((o) => [{ text: o.label, callback_data: `va:${token}:${o.id}`.slice(0, 64) }]);
}

function questionText(officeName, record, kind) {
  const title = recordTitle(record);
  if (kindOf(record) === "REQUEST") {
    return `حياك الله 🌷\nمعك مدير المكتب الذكي في ${officeName} (مساعد ذكاء اصطناعي).\nبخصوص طلبك «${title}»، هل ما زلت تبحث أو حصلت اللي يناسبك؟`;
  }
  const lead = kind === "REMIND" ? "مدة عرضك تنتهي قريبًا." : "";
  return `السلام عليكم، حياك الله 🌷\nمعك مدير المكتب الذكي في ${officeName} (مساعد ذكاء اصطناعي).\n${lead}${lead ? "\n" : ""}حبيت أتأكد بخصوص «${title}»: هل لا يزال متاحًا؟`;
}

/**
 * Before the office manager tells a client about an offer whose availability is not recent: ask the owner
 * first (once a day at most). The match continues by itself after the owner answers «متاح».
 */
export async function askOwnerBeforeMatch(ctx, { officeId, offer }) {
  const now = ctx.now();
  // Its own key (never the sweep's), at most once a day; one task per record for it.
  const key = `fresh:${new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10)}`;
  if (offer.availabilityAskedFor === key) return { asked: false, reason: "already_asked_today" };
  const link = await reachableSide(ctx, officeId, offer);
  if (!link) return { asked: false, reason: "owner_unreachable" };
  const buttons = await issueButtons(ctx, { officeId, record: offer, link, options: answerOptions("OFFER", offer.purpose) });
  const body = `السلام عليكم 🌷\nمعك مدير المكتب الذكي في ${await officeLabel(ctx, officeId)} (مساعد ذكاء اصطناعي).\nفيه عميل قد يناسبه «${recordTitle(offer)}». قبل ما نتواصل معه: هل لا يزال متاحًا؟`;
  const sent = await sendToParty(ctx.store, ctx.deps, officeId, link, body, { buttons, now });
  if (!sent.ok) return { asked: false, reason: "send_failed" };
  await ctx.store.set(["offices", officeId, "opportunities", offer.id], { availabilityAskedFor: key, availabilityAskedAt: now.toISOString() });
  await upsertValidityTask(ctx, { officeId, record: offer, type: "AVAILABILITY_CHECK", ref: "before-match", status: "WAITING_EXTERNAL_RESPONSE", reason: "مدير المكتب يتأكد من توفر العقار قبل عرضه على عميل" });
  return { asked: true };
}

/** One sweep of one office: at most one step per record, each step once (validityAskedFor / validityNotedFor). */
export async function sweepOfficeValidity(ctx, { officeId, limit = 50 }) {
  const now = ctx.now();
  const records = await ctx.store.list(["offices", officeId, "opportunities"], 500);
  const done = { asked: 0, rematched: 0, attention: 0, unreachable: 0 };
  for (const raw of records) {
    if (done.asked + done.attention >= limit) break;
    const record = { ...raw, id: raw.id };
    if (String(record.officeId || officeId) !== officeId) continue;
    const step = nextValidityStep(record, now);
    if (!step) continue;
    const state = validityState(record, now);
    // Out of matching as soon as its time ran out (once per step): the engine supersedes its open matches.
    if (state !== STATE.ACTIVE && record.validityNotedFor !== step.key) {
      const open = await leaveMatching(ctx, officeId, record.id);
      await ctx.store.set(["offices", officeId, "opportunities", record.id], { validityNotedFor: step.key, validityReason: STATE_LABEL[state] });
      done.rematched += 1;
      for (const journey of open) {
        done.attention += 1;
        await upsertValidityTask(ctx, { officeId, record, type: "AVAILABILITY_ATTENTION", ref: `deal:${journey.journeyId}:${step.key}`, status: "OPEN",
          reason: `${STATE_LABEL[state]} وهو داخل صفقة مفتوحة — تحقق من استمرار التوفر` });
      }
    }
    const link = await reachableSide(ctx, officeId, record);
    if (!link) { done.unreachable += 1; continue; }
    const options = answerOptions(kindOf(record), record.purpose);
    const buttons = await issueButtons(ctx, { officeId, record, link, options });
    const sent = await sendToParty(ctx.store, ctx.deps, officeId, link, questionText(await officeLabel(ctx, officeId), record, step.kind), { buttons, now });
    if (!sent.ok) { done.unreachable += 1; continue; }
    await ctx.store.set(["offices", officeId, "opportunities", record.id], { validityAskedFor: step.key, validityAskedAt: now.toISOString() });
    await upsertValidityTask(ctx, { officeId, record, type: "AVAILABILITY_CHECK", ref: step.key, status: "WAITING_EXTERNAL_RESPONSE", reason: "مدير المكتب سأل صاحب السجل عن التوفر — بانتظار رده" });
    done.asked += 1;
  }
  return { ok: true, ...done };
}

/** Cron: offices whose office manager is switched on. Each office's failure stays its own. */
export async function sweepAllValidity(ctx) {
  const offices = await ctx.store.list(["offices"], 300);
  const results = [];
  for (const office of offices) {
    const settings = await ctx.store.get(["offices", office.id, "agentSettings", "main"]).catch(() => null);
    if (settings?.enabled !== true) continue;
    try { results.push({ officeId: office.id, ...(await sweepOfficeValidity(ctx, { officeId: office.id })) }); } catch (error) {
      console.warn("[office-os] validity sweep failed", office.id, error?.message);
    }
  }
  return results;
}

/** Manager-triggered sweep of his own office (also what the tests drive). */
export async function sweepValidityNow(ctx, { actor, officeId }) {
  if (!actor?.isManager) throw ctx.deps.appError("forbidden", 403, "لمدير المكتب فقط");
  return sweepOfficeValidity(ctx, { officeId });
}

// ------------------------------------------------------------------ the side answers

const CALLBACK = /^va:([a-f0-9]{24}):([A-Z_]{3,20})$/;

export function isValidityCallback(data) {
  return CALLBACK.test(String(data || ""));
}

/** A side pressed a validity button. Only the chat it was sent to, only the answers it offered. */
export async function handleValidityCallback(ctx, query = {}) {
  const { store, deps } = ctx;
  const chatId = text(query.message?.chat?.id, 30);
  const toast = (message) => deps.telegram("answerCallbackQuery", { callback_query_id: text(query.id, 80), text: String(message).slice(0, 180) }).catch(() => {});
  const parsed = String(query.data || "").match(CALLBACK);
  if (!parsed) { await toast("هذا الزر لم يعد صالحًا."); return { ok: true, status: 200, ignored: true, reason: "callback_unknown" }; }
  const [, token, answer] = parsed;
  const pointer = await store.get(["validityAsks", token]);
  const tooOld = pointer && ctx.now().getTime() - new Date(pointer.createdAt || 0).getTime() > 14 * 86400000;
  if (!pointer || !Array.isArray(pointer.options) || !pointer.options.includes(answer) || pointer.usedAt || tooOld) { await toast("هذا الزر لم يعد صالحًا."); return { ok: true, status: 200, ignored: true, reason: "ask_unknown" }; }
  const party = await store.get(["telegramParties", text(pointer.partyKey, 80)]);
  if (!party || text(party.chatId, 30) !== chatId || (query.from?.id !== undefined && text(query.from.id, 30) !== chatId)) {
    await toast("هذا السؤال ليس لك.");
    return { ok: true, status: 200, ignored: true, reason: "not_this_chat" };
  }
  const officeId = deps.firestoreOfficeId(pointer.officeId);
  const record = await store.get(["offices", officeId, "opportunities", text(pointer.recordId, 120)]);
  // The side must still be this record's own side (its saved mobile is the one the link was confirmed with).
  const current = record ? await partyLinkFor(store, deps, officeId, { ...record }) : null;
  if (!current || current.key !== text(pointer.partyKey, 80)) { await toast("هذا السؤال ليس لك."); return { ok: true, status: 200, ignored: true, reason: "not_the_records_side" }; }
  // Used once, even on a double tap (guarded write).
  const used = await store.update(["validityAsks", token], (current) => (current.usedAt ? null : { usedAt: ctx.now(), answer }));
  if (!used?.patch) { await toast("هذا الزر لم يعد صالحًا."); return { ok: true, status: 200, ignored: true, reason: "ask_unknown" }; }
  if (answer === ANSWER.EDIT) {
    await notifyOffice(store, deps, { officeId, brokerId: text(record.brokerId, 128), key: `validity-edit|${token}`, title: "صاحب سجل يطلب تعديله", body: recordTitle(record), route: `record/${pointer.recordId}`, opportunityId: text(pointer.recordId, 120), now: ctx.now() });
    await toast("أبلغت الوسيط بطلب التعديل.");
    return { ok: true, status: 200, answer, handedToBroker: true };
  }
  try {
    const result = await applyAvailabilityAnswer(ctx, { officeId, recordId: pointer.recordId, answer, by: `party:${pointer.partyKey}` });
    await toast(answer === ANSWER.AVAILABLE || answer === ANSWER.STILL_LOOKING ? "تم التجديد، شكرًا لك." : answer === ANSWER.PAUSE ? "تم الإيقاف المؤقت." : "تم التحديث، شكرًا لك.");
    return { ok: true, status: 200, answer, state: result.state };
  } catch (error) {
    // e.g. «إيقاف» while the record is inside an open deal: the broker decides.
    await notifyOffice(store, deps, { officeId, brokerId: text(record.brokerId, 128), key: `validity-fail|${token}`, title: "طلب من صاحب سجل يحتاج قرارك", body: `${recordTitle(record)} — ${error?.publicMessage || "تعذر التنفيذ"}`, route: `record/${pointer.recordId}`, opportunityId: text(pointer.recordId, 120), now: ctx.now() }).catch(() => {});
    await toast("أبلغت الوسيط ليتابع طلبك.");
    return { ok: true, status: 200, answer, handedToBroker: true, reason: error?.code || "failed" };
  }
}

/**
 * A linked side wrote in its own words («الأرض انباعت», «still available»…). Understanding is not
 * enough: the side gets a confirmation button for the exact record — or is asked which one when it has several.
 * Returns null when the words are not about availability (the message then goes to the broker as before).
 */
export async function handleAvailabilityWords(ctx, { officeId, link, body }) {
  const intent = availabilityIntent(body);
  if (!intent) return null;
  // This side's own records in this office: the same key its link was confirmed with (office + its saved mobile).
  const candidates = (await ctx.store.list(["offices", officeId, "opportunities"], 500))
    .filter((r) => String(r.officeId || officeId) === officeId && String(r.lifecycleStatus || "ACTIVE").toUpperCase() !== "DELETED")
    .filter((r) => (intent === ANSWER.FOUND || intent === ANSWER.STILL_LOOKING ? kindOf(r) === "REQUEST" : intent === ANSWER.PAUSE ? true : kindOf(r) === "OFFER"));
  const records = [];
  for (const r of candidates) if ((await partyKey(ctx.deps, officeId, partyPhone(r))) === link.key) records.push(r);
  if (!records.length) return null;
  const now = ctx.now();
  const verb = AVAILABILITY_LABEL[intent] || (intent === ANSWER.PAUSE ? "إيقاف مؤقت" : intent === ANSWER.STILL_LOOKING ? "ما زلت أبحث" : "متاح");
  const token = (await ctx.deps.sha256Hex(`validity-words|${officeId}|${link.key}|${crypto.randomUUID()}`)).slice(0, 24);
  if (records.length === 1) {
    await ctx.store.set(["validityAsks", token], { officeId, recordId: records[0].id, partyKey: link.key, options: [intent], createdAt: now });
    await sendToParty(ctx.store, ctx.deps, officeId, link, `أتأكد منك: «${recordTitle(records[0])}» — ${verb}؟`, { buttons: [[{ text: `نعم، ${verb}`, callback_data: `va:${token}:${intent}` }]], now });
    return { ok: true, status: 200, confirmAsked: 1 };
  }
  // Several records: never pick one — one button per record, each its own confirmation.
  const rows = [];
  for (const record of records.slice(0, 6)) {
    const each = (await ctx.deps.sha256Hex(`validity-words|${officeId}|${link.key}|${record.id}|${token}`)).slice(0, 24);
    await ctx.store.set(["validityAsks", each], { officeId, recordId: record.id, partyKey: link.key, options: [intent], createdAt: now });
    rows.push([{ text: recordTitle(record).slice(0, 60), callback_data: `va:${each}:${intent}` }]);
  }
  await sendToParty(ctx.store, ctx.deps, officeId, link, `تقصد أي واحد من سجلاتك؟ (${verb})`, { buttons: rows, now });
  return { ok: true, status: 200, chooseAsked: rows.length };
}
