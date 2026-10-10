/**
 * Proposal service — the broker prepares, the system writes the message and a reply
 * link scoped to one proposal and one recipient, WhatsApp opens with it.
 *
 * Link: `${appOrigin}/r#${token}` — 256-bit random token in the URL fragment (never
 * sent to Hosting or to link-preview crawlers). Lookup is by sha256(token) in the
 * server-only `replyLinks` collection; record ids alone never grant access.
 *
 * Replacing a proposal (same journey + recipient + template) supersedes the previous
 * one and its link: the old page then says the proposal was updated.
 */

import {
  PROPOSAL_STATUS, RECIPIENT, RECIPIENT_LABEL, SEND_STATE, buildProposalMessage, ensureLinkInMessage,
  proposalExpiry, replyOptionsFor, templateOf, validateProposalFields
} from "../../../public/os/domain/proposal-domain.js";
import { STAGE, VIEWING_STATE, isJourneyOpen } from "../../../public/os/domain/journey-domain.js";
import { buildWhatsAppUrl, cleanText, localPhone, whatsappDigits } from "../../../public/os/domain/format-domain.js";
import { applyJourneyChange, journeySegments, loadJourney } from "./journey-service.js";
import { assertCanActOn } from "./permissions.js";
import { finishTasks } from "./task-service.js";
import { assertOfficeMediatedJourney } from "./external-broker-service.js";
import { buildMatchReviewDedupKey, operationDocumentId } from "../operations-domain.js";

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newReplyToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export function isReplyTokenShape(token) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(token || ""));
}

export async function linkHashOf(deps, token) {
  return `rl_${await deps.sha256Hex(`reply-link|${token}`)}`;
}

export function replyUrlFor(origin, token) {
  return `${String(origin || "").replace(/\/+$/, "")}/r#${token}`;
}

async function officeIdentity(ctx, officeId) {
  const office = (await ctx.store.get(["offices", officeId])) || {};
  return {
    officeName: cleanText(office.officeName, 80),
    brokerName: cleanText(office.brokerName, 80)
  };
}

function recipientRecordId(context, role) {
  return role === RECIPIENT.OWNER ? context.offerId : context.requestId;
}

/**
 * Load the communication context: a journey (normal case) or a match under review
 * (review "طلب معلومات" — the match itself is never revealed to the party).
 */
async function loadContext(ctx, { actor, officeId, journeyId, matchId }) {
  if (journeyId) {
    const journey = await loadJourney(ctx, officeId, journeyId);
    assertCanActOn(ctx.deps, actor, journey);
    if (!isJourneyOpen(journey)) throw ctx.deps.appError("journey_closed", 409, "الفرصة مغلقة");
    return { type: "journey", id: journeyId, journey, offerId: journey.offerId, requestId: journey.requestId, matchId: journey.matchId };
  }
  const match = await ctx.store.get(["offices", officeId, "matches", matchId]);
  if (!match) throw ctx.deps.appError("match_not_found", 404, "المطابقة غير موجودة");
  const reviewTaskId = await operationDocumentId(buildMatchReviewDedupKey({ officeId, matchId, dataVersion: match.dataVersion || "" }));
  const reviewTask = await ctx.store.get(["offices", officeId, "operations", reviewTaskId]);
  assertCanActOn(ctx.deps, actor, reviewTask || match);
  return {
    type: "match", id: matchId, match, reviewTaskId, reviewTask,
    offerId: String(match.offerId || match.ownerOfferId || ""), requestId: String(match.requestId || match.clientRequestId || ""), matchId
  };
}

/**
 * Create one proposal per recipient. `messages` optionally carries the broker-edited
 * text per role; the reply link is always (re)attached exactly once.
 */
export async function createProposals(ctx, { actor, officeId, journeyId = "", matchId = "", kind, recipients = [], fields: rawFields = {}, messages = {}, requestKey = "" }) {
  const template = templateOf(kind);
  if (!template) throw ctx.deps.appError("template_invalid", 400, "اختر نوع المقترح");
  const roles = [...new Set(recipients.filter((role) => role === RECIPIENT.CLIENT || role === RECIPIENT.OWNER))];
  if (!roles.length) throw ctx.deps.appError("recipient_required", 400, "اختر المستلم");
  const context = await loadContext(ctx, { actor, officeId, journeyId, matchId });
  await assertOfficeMediatedJourney(ctx, officeId, context);
  if (context.type === "match" && template.kind !== "INFO_REQUEST") {
    throw ctx.deps.appError("template_not_allowed", 409, "قبل الاعتماد يمكن طلب معلومات فقط");
  }
  const now = ctx.now();
  const validation = validateProposalFields(kind, rawFields, { now });
  if (!validation.ok) {
    const error = ctx.deps.appError("proposal_invalid", 400, Object.values(validation.errors)[0]);
    error.details = validation.errors;
    throw error;
  }
  const fields = validation.fields;
  const identity = await officeIdentity(ctx, officeId);
  const origin = ctx.appOrigin;
  const offer = await ctx.store.get(["offices", officeId, "opportunities", context.offerId]);
  const property = {
    propertyType: offer?.propertyType || context.journey?.offerSummary?.propertyType || "",
    district: offer?.district || context.journey?.offerSummary?.district || "",
    city: offer?.city || context.journey?.offerSummary?.city || ""
  };
  const results = [];
  for (const role of roles) {
    const record = await ctx.store.get(["offices", officeId, "opportunities", recipientRecordId(context, role)]);
    const phone = localPhone(record?.contactPhone || record?.advertiserPhoneNormalized || record?.phone);
    const recipientName = cleanText(record?.contactName || record?.advertiserDisplayName || record?.name, 80);
    const proposalHex = await ctx.deps.sha256Hex(`proposal|${officeId}|${context.type}|${context.id}|${role}|${template.kind}|${requestKey || now.toISOString()}`);
    const proposalId = `pr_${proposalHex.slice(0, 40)}`;
    const segments = ["offices", officeId, "proposals", proposalId];
    const existing = await ctx.store.get(segments);
    if (existing) {
      results.push(resultOf(existing));
      continue;
    }
    const token = newReplyToken();
    const linkHash = await linkHashOf(ctx.deps, token);
    const replyUrl = replyUrlFor(origin, token);
    const baseText = cleanText(messages?.[role], 3500)
      ? String(messages[role]).slice(0, 3500)
      : buildProposalMessage({ kind: template.kind, fields, recipientRole: role, recipientName, officeName: identity.officeName, brokerName: identity.brokerName, property, now });
    const messageText = ensureLinkInMessage(baseText, replyUrl);
    const expiresAt = proposalExpiry(template.kind, fields, now);
    const doc = {
      schemaVersion: 1,
      officeId,
      proposalId,
      contextType: context.type,
      journeyId: context.type === "journey" ? context.id : "",
      matchId: context.matchId || "",
      reviewTaskId: context.reviewTaskId || "",
      offerId: context.offerId,
      requestId: context.requestId,
      kind: template.kind,
      label: template.label,
      recipientRole: role,
      recipientName,
      recipientPhone: phone,
      fields,
      publicSummary: { ...property, perspective: role },
      replyOptionsJson: JSON.stringify(replyOptionsFor(template.kind)),
      messageText,
      replyUrl,
      whatsappUrl: buildWhatsAppUrl(phone, messageText),
      linkHash,
      status: PROPOSAL_STATUS.ACTIVE,
      sendState: SEND_STATE.READY,
      handoffCount: 0,
      expiresAt,
      reply: null,
      replyHistoryJson: "[]",
      createdBy: actor.uid,
      assignedBrokerId: context.journey?.assignedBrokerId || context.reviewTask?.assignedBrokerId || actor.uid,
      createdAt: now,
      updatedAt: now
    };
    // Link first (server-only), then the proposal: a proposal never exists without its link.
    await ctx.store.set(["replyLinks", linkHash], {
      officeId, proposalId, recipientRole: role, contextType: context.type, contextId: context.id,
      status: "ACTIVE", expiresAt, createdAt: now, updatedAt: now
    });
    const created = await ctx.store.create(segments, doc);
    const saved = created ? doc : await ctx.store.get(segments);
    results.push(resultOf(saved));
  }

  if (context.type === "journey") {
    const createdIds = Object.fromEntries(results.map((r) => [`${r.recipientRole}:${template.kind}`, r.proposalId]));
    let superseded = [];
    await applyJourneyChange(ctx, {
      officeId, journeyId: context.id, actor,
      mutate: (journey) => {
        const active = { ...(journey.activeProposals || {}) };
        superseded = [];
        let changed = false;
        for (const [key, id] of Object.entries(createdIds)) {
          if (active[key] && active[key] !== id) superseded.push([active[key], id]);
          if (active[key] !== id) changed = true;
          active[key] = id;
        }
        if (!changed) return null;
        const patch = {
          activeProposals: active,
          lastProposal: { kind: template.kind, label: template.label, at: now.toISOString(), recipients: roles, fields },
          lastProposalAt: now
        };
        if (template.kind === "VIEWING") {
          patch.viewing = { state: VIEWING_STATE.PROPOSED, at: fields.viewingAt, acceptedBy: {}, proposedAt: now.toISOString() };
        }
        if (template.kind === "AGREEMENT_STEPS" && journey.stage !== STAGE.AGREEMENT) patch.stage = STAGE.AGREEMENT;
        return patch;
      },
      finish: (task) => task.type === "AWAITING_REPLY" && superseded.some(([oldId]) => oldId === task.proposalId),
      event: {
        type: "PROPOSAL_CREATED", key: [template.kind, ...results.map((r) => r.proposalId)],
        text: `تم تجهيز ${template.label} ${roles.length === 2 ? "للطرفين" : `لـ${RECIPIENT_LABEL[roles[0]]}`}`,
        payload: { kind: template.kind, proposalIds: results.map((r) => r.proposalId) }
      }
    });
    for (const [oldId, newId] of superseded) await supersedeProposal(ctx, officeId, oldId, newId);
  }
  return results;
}

function resultOf(proposal) {
  return {
    proposalId: proposal.proposalId || proposal.id,
    recipientRole: proposal.recipientRole,
    recipientName: proposal.recipientName || "",
    phoneMissing: !whatsappDigits(proposal.recipientPhone),
    messageText: proposal.messageText,
    whatsappUrl: proposal.whatsappUrl || "",
    replyUrl: proposal.replyUrl,
    status: proposal.status,
    sendState: proposal.sendState
  };
}

export async function supersedeProposal(ctx, officeId, proposalId, byProposalId = "") {
  const now = ctx.now();
  const segments = ["offices", officeId, "proposals", proposalId];
  const proposal = await ctx.store.get(segments);
  if (!proposal || ![PROPOSAL_STATUS.ACTIVE, PROPOSAL_STATUS.ANSWERED].includes(proposal.status)) return false;
  await ctx.store.set(segments, { status: PROPOSAL_STATUS.SUPERSEDED, supersededBy: byProposalId, supersededAt: now, updatedAt: now });
  if (proposal.linkHash) await ctx.store.set(["replyLinks", proposal.linkHash], { status: "SUPERSEDED", updatedAt: now });
  return true;
}

/**
 * The broker pressed «إرسال عبر واتساب». This proves only that WhatsApp was opened
 * with the prepared message — never that it was sent, delivered or read.
 */
export async function recordHandoff(ctx, { actor, officeId, proposalId, channel = "WHATSAPP" }) {
  if (!["WHATSAPP", "SHARE"].includes(channel)) throw ctx.deps.appError("invalid_channel", 400, "قناة المشاركة غير صالحة");
  const segments = ["offices", officeId, "proposals", proposalId];
  const proposal = await ctx.store.get(segments);
  if (!proposal || proposal.officeId !== officeId) throw ctx.deps.appError("proposal_not_found", 404, "المقترح غير موجود");
  if (![PROPOSAL_STATUS.ACTIVE, PROPOSAL_STATUS.ANSWERED].includes(proposal.status)) {
    throw ctx.deps.appError("proposal_inactive", 409, "هذا المقترح لم يعد نشطًا");
  }
  const now = ctx.now();
  const first = proposal.sendState !== SEND_STATE.OPENED_EXTERNAL;
  const count = Number(proposal.handoffCount || 0) + 1;
  await ctx.store.set(segments, {
    sendState: SEND_STATE.OPENED_EXTERNAL,
    handoffChannel: channel,
    handoffCount: count,
    firstOpenedAt: first ? now : proposal.firstOpenedAt || now,
    lastOpenedAt: now,
    lastOpenedBy: actor.uid,
    updatedAt: now
  });
  const who = RECIPIENT_LABEL[proposal.recipientRole] || "";
  if (proposal.contextType === "match") {
    if (proposal.reviewTaskId) {
      await ctx.store.set(["offices", officeId, "operations", proposal.reviewTaskId], {
        status: "WAITING_EXTERNAL_RESPONSE", updatedAt: now,
        summaryText: `طُلبت معلومات من ${who} — بانتظار الرد`
      });
    }
    return { ok: true, first, handoffCount: count };
  }
  if (proposal.status === PROPOSAL_STATUS.ANSWERED) return { ok: true, first, handoffCount: count };
  const followUpAt = new Date(now.getTime() + 24 * 3600 * 1000);
  await applyJourneyChange(ctx, {
    officeId, journeyId: proposal.journeyId, actor,
    finish: (task) => first && ["SEND_PROPOSAL", "PROPOSAL_REPLY", "JOURNEY_FOLLOW_UP"].includes(task.type),
    mutate: () => ({}),
    add: [{
      type: "AWAITING_REPLY", ref: proposalId, status: "WAITING_EXTERNAL_RESPONSE", dueAt: followUpAt,
      reason: `${proposal.label} — بانتظار رد ${who}`, actionLabel: "إرسال تذكير", proposalId
    }],
    event: {
      type: channel === "SHARE" ? "MESSAGE_SHARED" : "WHATSAPP_OPENED", key: [proposalId, count],
      text: channel === "SHARE" ? `تم فتح مشاركة المقترح لـ${who} عبر تطبيق آخر` : first ? `تم فتح واتساب لـ${who} بالمقترح` : `أعيد فتح واتساب لـ${who} للمتابعة`,
      payload: { proposalId, handoffCount: count, channel }
    }
  });
  // The broker acted on earlier replies by sending the next proposal: lock those replies.
  if (first) await lockAnsweredReplies(ctx, officeId, proposal.journeyId, proposalId, actor);
  return { ok: true, first, handoffCount: count };
}

async function lockAnsweredReplies(ctx, officeId, journeyId, exceptProposalId, actor) {
  const journey = await ctx.store.get(journeySegments(officeId, journeyId));
  const now = ctx.now();
  for (const id of Object.values(journey?.activeProposals || {})) {
    if (id === exceptProposalId) continue;
    const proposal = await ctx.store.get(["offices", officeId, "proposals", id]);
    if (proposal?.reply && !proposal.reply.lockedAt) {
      await ctx.store.set(["offices", officeId, "proposals", id], { reply: { ...proposal.reply, lockedAt: now.toISOString(), lockedBy: actor.uid }, updatedAt: now });
    }
  }
}

export async function cancelProposal(ctx, { actor, officeId, proposalId }) {
  const segments = ["offices", officeId, "proposals", proposalId];
  const proposal = await ctx.store.get(segments);
  if (!proposal) throw ctx.deps.appError("proposal_not_found", 404, "المقترح غير موجود");
  if (proposal.journeyId) assertCanActOn(ctx.deps, actor, await loadJourney(ctx, officeId, proposal.journeyId));
  if (![PROPOSAL_STATUS.ACTIVE, PROPOSAL_STATUS.ANSWERED].includes(proposal.status)) return { ok: true, duplicate: true };
  const now = ctx.now();
  await ctx.store.set(segments, { status: PROPOSAL_STATUS.CANCELLED, cancelledAt: now, cancelledBy: actor.uid, updatedAt: now });
  if (proposal.linkHash) await ctx.store.set(["replyLinks", proposal.linkHash], { status: "CANCELLED", updatedAt: now });
  if (proposal.journeyId) {
    await applyJourneyChange(ctx, {
      officeId, journeyId: proposal.journeyId, actor,
      finish: (task) => task.proposalId === proposalId,
      finishStatus: "DISMISSED",
      mutate: (journey) => {
        const active = { ...(journey.activeProposals || {}) };
        for (const [key, id] of Object.entries(active)) if (id === proposalId) delete active[key];
        return { activeProposals: active };
      },
      event: { type: "PROPOSAL_SUPERSEDED", key: ["cancel", proposalId], text: `أُلغي ${proposal.label}` }
    });
  }
  return { ok: true };
}

export { finishTasks };
