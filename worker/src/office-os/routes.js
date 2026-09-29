/**
 * /os/* routes — the office operating system API.
 * Office routes: Firebase ID token → office membership (Worker-verified) → service.
 * Public routes (reply page): token-scoped, rate-limited, no account.
 */

import { createStore } from "./store.js";
import { resolveActor } from "./permissions.js";
import { findCandidates, pairRecords, removeRecord, restoreRecord, saveRecord } from "./records-service.js";
import {
  acknowledgeReply, addBrokerNote, closeJourney, completeFollowUp, confirmViewing, decideMatchReview,
  moveStage, pauseJourney, reconcileOffice, recordViewingResult, resumeJourney
} from "./journey-service.js";
import { cancelProposal, createProposals, recordHandoff } from "./proposal-service.js";
import { submitReply, viewReply } from "./reply-service.js";
import { suggestForJourney } from "./assist-service.js";

const PUBLIC_ROUTES = Object.freeze({
  "/os/reply/view": (ctx, body, meta) => viewReply(ctx, { token: body.token, ip: meta.ip }),
  "/os/reply/submit": (ctx, body, meta) => submitReply(ctx, { token: body.token, optionId: body.optionId, text: body.text, submissionId: body.submissionId, ip: meta.ip })
});

const OFFICE_ROUTES = Object.freeze({
  "/os/records/save": (ctx, b, actor) => saveRecord(ctx, { actor, officeId: ctx.officeId, recordId: b.recordId, input: b.record || {}, requestKey: b.requestKey }),
  "/os/records/remove": (ctx, b, actor) => removeRecord(ctx, { actor, officeId: ctx.officeId, recordId: text(b.recordId), reason: b.reason }),
  "/os/records/restore": (ctx, b, actor) => restoreRecord(ctx, { actor, officeId: ctx.officeId, recordId: text(b.recordId) }),
  "/os/records/candidates": (ctx, b) => findCandidates(ctx, { officeId: ctx.officeId, recordId: text(b.recordId), limit: b.limit }),
  "/os/records/pair": (ctx, b) => pairRecords(ctx, { officeId: ctx.officeId, recordId: text(b.recordId), counterpartId: text(b.counterpartId) }),
  "/os/review/decide": (ctx, b, actor) => decideMatchReview(ctx, { actor, officeId: ctx.officeId, matchId: text(b.matchId), decision: text(b.decision), postponeDays: b.postponeDays, reason: b.reason }),
  "/os/proposals/create": (ctx, b, actor) => createProposals(ctx, {
    actor, officeId: ctx.officeId, journeyId: text(b.journeyId), matchId: text(b.matchId), kind: text(b.kind),
    recipients: Array.isArray(b.recipients) ? b.recipients : [], fields: b.fields || {}, messages: b.messages || {}, requestKey: text(b.requestKey)
  }).then((proposals) => ({ ok: true, proposals })),
  "/os/proposals/handoff": (ctx, b, actor) => recordHandoff(ctx, { actor, officeId: ctx.officeId, proposalId: text(b.proposalId) }),
  "/os/proposals/cancel": (ctx, b, actor) => cancelProposal(ctx, { actor, officeId: ctx.officeId, proposalId: text(b.proposalId) }),
  "/os/journeys/note": (ctx, b, actor) => addBrokerNote(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), text: b.text, party: text(b.party), optionLabel: b.optionLabel, requestKey: text(b.requestKey) }),
  "/os/journeys/ack-reply": (ctx, b, actor) => acknowledgeReply(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), proposalId: text(b.proposalId) }),
  "/os/journeys/viewing/confirm": (ctx, b, actor) => confirmViewing(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId) }),
  "/os/journeys/viewing/result": (ctx, b, actor) => recordViewingResult(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), result: text(b.result), note: b.note }),
  "/os/journeys/stage": (ctx, b, actor) => moveStage(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), stage: text(b.stage) }),
  "/os/journeys/pause": (ctx, b, actor) => pauseJourney(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), resumeInDays: b.resumeInDays, reason: b.reason }),
  "/os/journeys/resume": (ctx, b, actor) => resumeJourney(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId) }),
  "/os/journeys/close": (ctx, b, actor) => closeJourney(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), outcome: text(b.outcome), reason: b.reason, finalPrice: b.finalPrice }),
  "/os/tasks/done": (ctx, b, actor) => completeFollowUp(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), taskId: text(b.taskId), note: b.note }),
  "/os/assist/suggest": (ctx, b, actor) => suggestForJourney(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId) }),
  "/os/reconcile": (ctx) => reconcileOffice(ctx, { officeId: ctx.officeId })
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
    // Membership is verified before any office data is read.
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
