/**
 * Public reply service — the lightweight page behind /r#<token>.
 *
 * Holding the link is not strong identity: a reply is recorded as the recipient's
 * *initial* answer, the page says so, and nothing here completes a deal. Replies can
 * be changed until the broker acts on them (then they are locked); every change is a
 * new timeline event. Duplicate clicks/reloads with the same submission id are no-ops.
 */

import {
  PROPOSAL_STATUS, RECIPIENT_LABEL, proposalSummaryLines, publicPropertyLine, replyLabel,
  replyOptionsFor, validateReply
} from "../../../public/os/domain/proposal-domain.js";
import { EVENT_SOURCE, STAGE, VIEWING_STATE, effectOfReply, isJourneyOpen } from "../../../public/os/domain/journey-domain.js";
import { cleanText, formatDateTime, toDate } from "../../../public/os/domain/format-domain.js";
import { isReplyTokenShape, linkHashOf } from "./proposal-service.js";
import { applyJourneyChange } from "./journey-service.js";
import { notifyBroker } from "./task-service.js";

const DAY = 86400000;

const STATE_MESSAGES = Object.freeze({
  INVALID: "هذا الرابط غير صالح. تواصل مع المكتب للحصول على رابط جديد.",
  SUPERSEDED: "تم تحديث هذا المقترح. سيصلك الرابط الجديد من الوسيط، ولا يُعتمد الرد على الرابط القديم.",
  EXPIRED: "انتهت صلاحية هذا الرابط. تواصل مع الوسيط إن كنت ما زلت مهتمًا.",
  CLOSED: "أُغلق هذا المقترح ولم يعد يستقبل ردودًا.",
  LOCKED: "تم اعتماد ردك لدى الوسيط. لأي تعديل تواصل معه مباشرة."
});

function rateLimit(ctx, route, ip) {
  const { consumePublicRateLimit, publicRateLimitKey, PUBLIC_RATE_LIMITS } = ctx.deps;
  if (typeof consumePublicRateLimit !== "function") return;
  const limits = PUBLIC_RATE_LIMITS?.PUBLIC_PARTY || { limit: 60, windowMs: 60_000 };
  const result = consumePublicRateLimit(publicRateLimitKey({ route, ip }), limits);
  if (!result.ok) throw ctx.deps.appError("rate_limited", 429, "تم تجاوز حد الطلبات مؤقتًا. حاول بعد قليل.");
}

async function resolveLink(ctx, token) {
  if (!isReplyTokenShape(token)) return { state: "INVALID" };
  const hash = await linkHashOf(ctx.deps, token);
  const link = await ctx.store.get(["replyLinks", hash]);
  if (!link?.officeId || !link.proposalId) return { state: "INVALID" };
  const proposal = await ctx.store.get(["offices", link.officeId, "proposals", link.proposalId]);
  if (!proposal || proposal.linkHash !== hash || proposal.recipientRole !== link.recipientRole) return { state: "INVALID" };
  let state = "ACTIVE";
  if (link.status === "SUPERSEDED" || proposal.status === PROPOSAL_STATUS.SUPERSEDED) state = "SUPERSEDED";
  else if (link.status === "CANCELLED" || proposal.status === PROPOSAL_STATUS.CANCELLED) state = "CLOSED";
  else if ((toDate(proposal.expiresAt)?.getTime() || 0) < ctx.now().getTime()) state = "EXPIRED";
  let journey = null;
  if (state === "ACTIVE" && proposal.journeyId) {
    journey = await ctx.store.get(["offices", link.officeId, "journeys", proposal.journeyId]);
    if (!journey || !isJourneyOpen(journey)) state = "CLOSED";
  }
  if (state === "ACTIVE" && proposal.reply?.lockedAt) state = "LOCKED";
  return { state, link, proposal, journey, hash };
}

async function officeCard(ctx, officeId) {
  const office = (await ctx.store.get(["publicOffices", officeId])) || {};
  return {
    officeName: cleanText(office.officeName, 80),
    brokerName: cleanText(office.brokerName, 80),
    licenseNumber: cleanText(office.licenseNumber, 20),
    logoUrl: /^https:\/\//.test(String(office.logoUrl || "")) ? String(office.logoUrl) : ""
  };
}

function replyView(proposal) {
  if (!proposal?.reply) return null;
  return {
    optionId: proposal.reply.optionId,
    label: replyLabel(proposal.kind, proposal.reply),
    text: proposal.reply.text || "",
    at: proposal.reply.at
  };
}

export async function viewReply(ctx, { token, ip = "unknown" }) {
  rateLimit(ctx, "os/reply/view", ip);
  const resolved = await resolveLink(ctx, token);
  if (resolved.state === "INVALID") return { ok: false, state: "INVALID", message: STATE_MESSAGES.INVALID };
  const { proposal, link } = resolved;
  const office = await officeCard(ctx, link.officeId);
  const base = { ok: true, state: resolved.state, office };
  if (resolved.state !== "ACTIVE" && resolved.state !== "LOCKED") {
    return { ...base, message: STATE_MESSAGES[resolved.state], reply: replyView(proposal) };
  }
  const now = ctx.now();
  return {
    ...base,
    message: resolved.state === "LOCKED" ? STATE_MESSAGES.LOCKED : "",
    proposal: {
      kind: proposal.kind,
      label: proposal.label,
      recipientRole: proposal.recipientRole,
      recipientLabel: RECIPIENT_LABEL[proposal.recipientRole] || "",
      propertyLine: publicPropertyLine(proposal.publicSummary || {}),
      lines: proposalSummaryLines(proposal.kind, proposal.fields || {}, now),
      options: replyOptionsFor(proposal.kind).map(({ id, label, tone, needsText, textKind, textLabel }) => ({ id, label, tone, needsText: Boolean(needsText), textKind: textKind || "", textLabel: textLabel || "" })),
      expiresAt: toDate(proposal.expiresAt)?.toISOString() || null
    },
    reply: replyView(proposal),
    editable: resolved.state === "ACTIVE"
  };
}

function cleanSubmissionId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : "";
}

export async function submitReply(ctx, { token, optionId, text = "", submissionId = "", ip = "unknown" }) {
  rateLimit(ctx, "os/reply/submit", ip);
  const resolved = await resolveLink(ctx, token);
  if (resolved.state !== "ACTIVE") {
    return {
      ok: false, state: resolved.state, message: STATE_MESSAGES[resolved.state] || STATE_MESSAGES.INVALID,
      reply: resolved.proposal ? replyView(resolved.proposal) : null
    };
  }
  const { proposal, link } = resolved;
  const officeId = link.officeId;
  const check = validateReply(proposal.kind, optionId, text);
  if (!check.ok) throw ctx.deps.appError(check.error, 400, check.message);
  const now = ctx.now();
  const subId = cleanSubmissionId(submissionId) || (await ctx.deps.sha256Hex(`${optionId}|${check.text}`)).slice(0, 32);
  const proposalSegments = ["offices", officeId, "proposals", proposal.proposalId];
  let revision = 0;
  let duplicate = false;
  const updated = await ctx.store.update(proposalSegments, (current) => {
    if (current.status === PROPOSAL_STATUS.SUPERSEDED || current.status === PROPOSAL_STATUS.CANCELLED) {
      throw ctx.deps.appError("proposal_inactive", 410, STATE_MESSAGES.SUPERSEDED);
    }
    if (current.reply?.lockedAt) throw ctx.deps.appError("reply_locked", 409, STATE_MESSAGES.LOCKED);
    const previous = current.reply || null;
    // Same answer again (double click, reload, network retry) → no-op. A different
    // answer is an edit, even from the same page session.
    if (previous && previous.optionId === check.option.id && String(previous.text || "") === check.text) {
      duplicate = true;
      return null;
    }
    revision = Number(previous?.revision || 0) + 1;
    let history = [];
    try { history = JSON.parse(current.replyHistoryJson || "[]"); } catch { history = []; }
    if (previous) history.push(previous);
    return {
      status: PROPOSAL_STATUS.ANSWERED,
      reply: {
        optionId: check.option.id, label: check.option.label, text: check.text, value: check.value,
        effect: check.option.effect, at: now.toISOString(), source: EVENT_SOURCE.REPLY_LINK,
        submissionId: subId, revision
      },
      replyHistoryJson: JSON.stringify(history.slice(-20)),
      updatedAt: now
    };
  });
  const saved = updated?.next || updated?.current || proposal;
  if (duplicate) return { ok: true, state: "SAVED", duplicate: true, reply: replyView(saved), editable: true };

  const who = RECIPIENT_LABEL[proposal.recipientRole] || "الطرف";
  const label = replyLabel(proposal.kind, { optionId: check.option.id, text: check.text });
  const verb = revision > 1 ? "عدّل" : "ردّ";
  if (proposal.contextType === "match") {
    await afterMatchInfoReply(ctx, { officeId, proposal, who, label, now });
  } else {
    await afterJourneyReply(ctx, { officeId, proposal, option: check.option, label, who, verb, subId: `${subId}.${revision}`, now });
  }
  return { ok: true, state: "SAVED", reply: replyView(saved), editable: true };
}

async function afterJourneyReply(ctx, { officeId, proposal, option, label, who, verb, subId, now }) {
  const role = proposal.recipientRole;
  const effect = effectOfReply(option.effect, { proposalKind: proposal.kind, fields: proposal.fields || {}, role });
  const add = [];
  if (effect.next === "CONFIRM_VIEWING") {
    add.push({
      type: "VIEWING_CONFIRM", ref: `viewing:${proposal.fields?.viewingAt || ""}`,
      dueAt: proposal.fields?.viewingAt || null,
      reason: `قبل ${who} موعد المعاينة ${formatDateTime(proposal.fields?.viewingAt, now)} — القبول لا يعني تنفيذ المعاينة`,
      actionLabel: "تأكيد الموعد", proposalId: proposal.proposalId
    });
  } else if (effect.next === "FOLLOW_UP") {
    add.push({
      type: "JOURNEY_FOLLOW_UP", ref: proposal.proposalId,
      dueAt: new Date(now.getTime() + (effect.followUpInDays || 2) * DAY),
      reason: `${who}: ${label}`, actionLabel: "متابعة الآن", proposalId: proposal.proposalId
    });
  } else {
    add.push({ type: "PROPOSAL_REPLY", ref: proposal.proposalId, priority: "HIGH", reason: `${who}: ${label}`, actionLabel: "مراجعة الرد", proposalId: proposal.proposalId });
  }
  await applyJourneyChange(ctx, {
    officeId, journeyId: proposal.journeyId, actor: null,
    finish: (task) => task.proposalId === proposal.proposalId && ["AWAITING_REPLY", "PROPOSAL_REPLY", "JOURNEY_FOLLOW_UP"].includes(task.type),
    mutate: (journey) => {
      const patch = {
        lastReplies: {
          ...(journey.lastReplies || {}),
          [role]: { proposalId: proposal.proposalId, kind: proposal.kind, optionId: option.id, label, effect: option.effect, at: now.toISOString(), source: EVENT_SOURCE.REPLY_LINK }
        }
      };
      if (effect.viewing) {
        const current = journey.viewing || {};
        const sameTime = !current.at || current.at === proposal.fields?.viewingAt;
        if (sameTime) {
          const acceptedBy = { ...(current.acceptedBy || {}) };
          if (effect.viewing.state === VIEWING_STATE.ACCEPTED) acceptedBy[role] = true; else delete acceptedBy[role];
          const nextState = effect.viewing.state === VIEWING_STATE.ACCEPTED ? VIEWING_STATE.ACCEPTED
            : Object.keys(acceptedBy).length ? VIEWING_STATE.ACCEPTED : VIEWING_STATE.PROPOSED;
          if (current.state !== VIEWING_STATE.CONFIRMED && current.state !== VIEWING_STATE.DONE) {
            patch.viewing = { ...current, at: proposal.fields?.viewingAt || current.at, state: nextState, acceptedBy };
          }
        }
      }
      if (effect.stage === STAGE.VIEWING && journey.stage === STAGE.NEGOTIATION) patch.stage = STAGE.VIEWING;
      return patch;
    },
    add,
    event: {
      type: "PARTY_REPLY", key: [proposal.proposalId, subId], source: EVENT_SOURCE.REPLY_LINK, actorRole: role,
      text: `${verb} ${who} عبر الرابط على ${proposal.label}: ${label}`,
      payload: { proposalId: proposal.proposalId, optionId: option.id }
    },
    notify: {
      key: `reply|${proposal.proposalId}|${subId}`,
      title: `وصل رد ${who}`,
      body: `${proposal.label}: ${option.label}`,
      pushType: proposal.kind === "VIEWING" ? "appointment" : "message"
    }
  });
}

async function afterMatchInfoReply(ctx, { officeId, proposal, who, label, now }) {
  if (proposal.reviewTaskId) {
    const task = await ctx.store.get(["offices", officeId, "operations", proposal.reviewTaskId]);
    if (task && ["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE"].includes(String(task.status || "").toUpperCase())) {
      await ctx.store.set(["offices", officeId, "operations", proposal.reviewTaskId], {
        status: "OPEN", summaryText: `وصل رد ${who} على طلب المعلومات: ${label}`, updatedAt: now, snoozedUntil: null
      });
    }
  }
  await ctx.store.set(["offices", officeId, "matches", proposal.matchId], {
    [`infoReply_${proposal.recipientRole}`]: { label, at: now.toISOString(), proposalId: proposal.proposalId },
    updatedAt: now
  });
  await notifyBroker(ctx.store, ctx.deps, {
    officeId,
    journey: { journeyId: proposal.matchId, matchId: proposal.matchId, requestId: proposal.requestId, assignedBrokerId: proposal.assignedBrokerId || "" },
    taskId: proposal.reviewTaskId, dedupKey: `info|${proposal.proposalId}|${now.toISOString()}`,
    title: `وصل رد ${who}`, body: "رد على طلب معلومات لمطابقة قيد المراجعة", now
  }).catch(() => {});
}
