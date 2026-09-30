/**
 * /os/* routes — the office operating system API.
 * Office routes: Firebase ID token → office membership (Worker-verified) → service.
 * Public routes: token-scoped, rate-limited, no account.
 */

import { createStore } from "./store.js";
import { resolveActor } from "./permissions.js";
import { findCandidates, pairRecords, removeRecord, restoreRecord, saveRecord } from "./records-service.js";
import {
  acknowledgeReply, addBrokerNote, closeJourney, completeFollowUp,
  moveStage, pauseJourney, reconcileOffice, resumeJourney
} from "./journey-service.js";
import { cancelProposal, createProposals, recordHandoff } from "./proposal-service.js";
import { submitReply, viewReply } from "./reply-service.js";
import { suggestForJourney } from "./assist-service.js";
import { recordSessionHandoff, resolveIntervention, sendBrokerMessage, sessionLinks, submitSessionAction } from "./session-service.js";
import { viewSessionSimplified } from "./session-view-service.js";
import {
  acceptNegotiatedPrice, confirmViewingSafe, decideMatchReviewSimplified, fixedPriceDecision,
  recordViewingResultSafe, rejectSession, submitViewingAcceptanceSafe, submitViewingCounterSafe
} from "./simplified-flow-service.js";

const PUBLIC_ROUTES = Object.freeze({
  "/os/reply/view": (ctx, body, meta) => viewReply(ctx, { token: body.token, ip: meta.ip }),
  "/os/reply/submit": (ctx, body, meta) => submitReply(ctx, { token: body.token, optionId: body.optionId, text: body.text, submissionId: body.submissionId, ip: meta.ip }),
  "/os/session/view": (ctx, body, meta) => viewSessionSimplified(ctx, { token: body.token, ip: meta.ip }),
  "/os/session/act": (ctx, body, meta) => submitSessionAction(ctx, { token: body.token, action: body.action, price: body.price, viewingAt: body.viewingAt, submissionId: body.submissionId, ip: meta.ip }),
  "/os/session/accept": (ctx, body, meta) => acceptNegotiatedPrice(ctx, { token: body.token, price: body.price, viewingAt: body.viewingAt, submissionId: body.submissionId, ip: meta.ip }),
  "/os/session/reject": (ctx, body, meta) => rejectSession(ctx, { token: body.token, submissionId: body.submissionId, ip: meta.ip }),
  "/os/session/fixed-decision": (ctx, body, meta) => fixedPriceDecision(ctx, { token: body.token, accepted: Boolean(body.accepted), submissionId: body.submissionId, ip: meta.ip }),
  "/os/session/viewing-accept": (ctx, body, meta) => submitViewingAcceptanceSafe(ctx, { token: body.token, submissionId: body.submissionId, ip: meta.ip }),
  "/os/session/viewing-counter": (ctx, body, meta) => submitViewingCounterSafe(ctx, { token: body.token, viewingAt: body.viewingAt, submissionId: body.submissionId, ip: meta.ip })
});

const OFFICE_ROUTES = Object.freeze({
  "/os/records/save": (ctx, b, actor) => saveRecord(ctx, { actor, officeId: ctx.officeId, recordId: b.recordId, input: b.record || {}, requestKey: b.requestKey }),
  "/os/records/remove": (ctx, b, actor) => removeRecord(ctx, { actor, officeId: ctx.officeId, recordId: text(b.recordId), reason: b.reason }),
  "/os/records/restore": (ctx, b, actor) => restoreRecord(ctx, { actor, officeId: ctx.officeId, recordId: text(b.recordId) }),
  "/os/records/candidates": (ctx, b) => findCandidates(ctx, { officeId: ctx.officeId, recordId: text(b.recordId), limit: b.limit }),
  "/os/records/pair": (ctx, b) => pairRecords(ctx, { officeId: ctx.officeId, recordId: text(b.recordId), counterpartId: text(b.counterpartId) }),
  "/os/review/decide": (ctx, b, actor) => decideMatchReviewSimplified(ctx, { actor, officeId: ctx.officeId, matchId: text(b.matchId), decision: text(b.decision), postponeDays: b.postponeDays, reason: b.reason }),
  "/os/proposals/create": (ctx, b, actor) => createProposals(ctx, {
    actor, officeId: ctx.officeId, journeyId: text(b.journeyId), matchId: text(b.matchId), kind: text(b.kind),
    recipients: Array.isArray(b.recipients) ? b.recipients : [], fields: b.fields || {}, messages: b.messages || {}, requestKey: text(b.requestKey)
  }).then((proposals) => ({ ok: true, proposals })),
  "/os/proposals/handoff": (ctx, b, actor) => recordHandoff(ctx, { actor, officeId: ctx.officeId, proposalId: text(b.proposalId), channel: text(b.channel) || "WHATSAPP" }),
  "/os/proposals/cancel": (ctx, b, actor) => cancelProposal(ctx, { actor, officeId: ctx.officeId, proposalId: text(b.proposalId) }),
  "/os/journeys/note": (ctx, b, actor) => addBrokerNote(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), text: b.text, party: text(b.party), optionLabel: b.optionLabel, requestKey: text(b.requestKey) }),
  "/os/journeys/ack-reply": (ctx, b, actor) => acknowledgeReply(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), proposalId: text(b.proposalId) }),
  "/os/journeys/viewing/confirm": (ctx, b, actor) => confirmViewingSafe(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId) }),
  "/os/journeys/viewing/result": (ctx, b, actor) => recordViewingResultSafe(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), result: text(b.result), note: b.note }),
  "/os/journeys/stage": (ctx, b, actor) => moveStage(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), stage: text(b.stage) }),
  "/os/journeys/pause": (ctx, b, actor) => pauseJourney(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), resumeInDays: b.resumeInDays, reason: b.reason }),
  "/os/journeys/resume": (ctx, b, actor) => resumeJourney(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId) }),
  "/os/journeys/close": (ctx, b, actor) => closeJourney(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), outcome: text(b.outcome), reason: b.reason, finalPrice: b.finalPrice }),
  "/os/tasks/done": (ctx, b, actor) => completeFollowUp(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), taskId: text(b.taskId), note: b.note }),
  "/os/assist/suggest": (ctx, b, actor) => suggestForJourney(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId) }),
  "/os/reconcile": (ctx) => reconcileOffice(ctx, { officeId: ctx.officeId }),
  "/os/session/links": (ctx, b, actor) => sessionLinks(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), replace: text(b.replace) }),
  "/os/session/handoff": (ctx, b, actor) => recordSessionHandoff(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), role: text(b.role) }),
  "/os/session/message": (ctx, b, actor) => sendBrokerMessage(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), audience: text(b.audience), text: b.text, requestKey: text(b.requestKey) }),
  "/os/session/resolve": (ctx, b, actor) => resolveIntervention(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId) })
});

function text(value) {
  return String(value ?? "").trim().slice(0, 200);
}

function slim(result) {
  if (!result || typeof result !== "object") return { ok: true };
  if ("journey" in result) {
    const { journey, ...rest } = result;
    return { ok: true, ...rest, journeyId: journey?.journeyId || journey?.id || rest.journeyId || "" };
  }
  return { ok: true, ...result };
}

export function isOfficeOsPath(pathname) {
  return pathname === "/os" || String(pathname || "").startsWith("/os/");
}

export async function handleOfficeOs(request, env, deps, { requestId = "" } = {}) {
  const url = new URL(request.url);
  if (request.method !== "POST") {
    return deps.jsonResponse({ ok: false, error: "method_not_allowed", requestId }, 405);
  }
  const body = await request.json().catch(() => ({}));
  const meta = { ip: String(request.headers.get("CF-Connecting-IP") || "unknown").slice(0, 80) };
  const makeCtx = async (officeId) => {
    deps.assertFirebaseSecrets(env);
    const projectId = env.FIREBASE_PROJECT_ID || deps.DEFAULT_PROJECT_ID;
    const accessToken = await deps.getGoogleAccessToken(env);
    const boundDeps = deps.bind ? deps.bind({ env, projectId, accessToken }) : deps;
    return {
      deps: boundDeps,
      store: createStore(boundDeps, { projectId, accessToken }),
      officeId,
      appOrigin: deps.resolveAppOrigin(env),
      now: () => new Date()
    };
  };
  try {
    const publicHandler = PUBLIC_ROUTES[url.pathname];
    if (publicHandler) {
      const ctx = await makeCtx("");
      const result = await publicHandler(ctx, body, meta);
      return deps.jsonResponse({ ...result, requestId }, result?.ok === false && result.state === "INVALID" ? 404 : 200);
    }
    const handler = OFFICE_ROUTES[url.pathname];
    if (!handler) return deps.jsonResponse({ ok: false, error: "not_found", requestId }, 404);
    const officeId = deps.firestoreOfficeId(body.officeId);
    if (!officeId || officeId === "platform") throw deps.appError("office_id_required", 400, "تعذر تحديد المكتب");
    const actor = await resolveActor(deps, request, env, officeId);
    const ctx = await makeCtx(officeId);
    const result = await handler(ctx, body, actor);
    return deps.jsonResponse({ ...slim(result), requestId });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error("[office-os] failed", url.pathname, error?.code, error?.message);
    return deps.jsonResponse({
      ok: false,
      error: error?.code || "internal_error",
      message: error?.publicMessage || "تعذر تنفيذ الطلب — حاول مجددًا",
      details: error?.details || undefined,
      requestId
    }, status);
  }
}
