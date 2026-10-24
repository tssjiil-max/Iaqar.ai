import { getRecordMandate, setRecordMandate } from "./mandate-service.js";
import { configureWhatsAppAgent, whatsappAgentStatus, drainWhatsAppQueue, listWhatsAppCases, actOnWhatsAppCase, listWhatsAppConversations, getWhatsAppConversation, controlWhatsAppConversation, replyInWhatsAppConversation } from "./whatsapp-agent-service.js";
/**
 * /os/* routes — the office operating system API.
 * Office routes: Firebase ID token → office membership (Worker-verified) → service.
 * Public routes (reply page): token-scoped, rate-limited, no account.
 */

import { searchThroughCentral } from "./central-search-service.js";
import { analyzeGuestSearch, guestSearch, selectGuestResult } from "./public-search-service.js";
import { guestSearchOptions, submitGuestRequest } from "./guest-request-service.js";
import { reserveRecord, releaseReservation } from "./reservation-service.js";
import { createStore } from "./store.js";
import { reviewExternalCooperation } from "./external-broker-service.js";
import { resolveActor } from "./permissions.js";
import { holdRecord, pairRecords, removeRecord, restoreRecord, saveRecord } from "./records-service.js";
import {
  acknowledgeReply, addBrokerNote, closeJourney, completeFollowUp, confirmViewing, decideMatchReview,
  moveStage, pauseJourney, reconcileOffice, recordViewingResult, resumeJourney, updateDealDocument
} from "./journey-service.js";
import { cancelProposal, createProposals, recordHandoff } from "./proposal-service.js";
import { submitReply, viewReply } from "./reply-service.js";
import { suggestForJourney } from "./assist-service.js";
import { arrangeRecordImages } from "./record-media-service.js";
import { channelsStatus, disconnectWhatsapp, startTelegramLink, unlinkTelegram } from "./channels-service.js";
import { convertInboxMessage } from "./inbox-service.js";
import { createOfficeTicket, supportStatus } from "./support-service.js";
import { setMemberAccess } from "./members-service.js";
import { agentChat, agentHistory, agentStatus, agentSuggestions, runApprovedAction, saveAgentSettings } from "./agent-service.js";
import { previewVisitor } from "./visitor-service.js";
import { analyzeOfficeText, analyzePublicText } from "./smart-fill-service.js";
import { applyAvailabilityAnswer, reactivateRecord, setRecordValidity, sweepValidityNow } from "./validity-service.js";
import { announceRoom, partyLinkStatus, setBotEnabled, setJourneyBotPaused, startBrokerLink, startPartyLink, unlinkBroker, linkBrokerWithTelegramLogin } from "./bot-service.js";
import { actOnFind, controlSearch, createSearch, feedScout, findDetail, importScoutLink, liveSearchForTask, parseSearchText, recordSearch, runOfficeCycle, saveScoutSettings, scoutOverview, scoutRecordChanged, searchDetail } from "./scout-service.js";
import { createIngestKey, ingestScoutBatch, listIngestKeys, revokeIngestKey } from "./scout-ingest.js";
import { startScoutChatLink, unlinkScoutChat } from "./scout-telegram.js";
import { decideSessionPrice, handleSessionRequest, sessionImage, recordSessionHandoff, resolveIntervention, sendBrokerMessage, sessionLinks, submitSessionAction, viewSession } from "./session-service.js";

const PUBLIC_ROUTES = Object.freeze({
  "/os/public/search/analyze": (ctx,b,meta) => analyzeGuestSearch(ctx,{officeId:b.officeId,text:typeof b.text === "string"?b.text:"",ip:meta.ip}),
  "/os/public/search": (ctx,b,meta) => guestSearch(ctx,{input:b,ip:meta.ip}),
  "/os/public/search/select": (ctx,b,meta) => selectGuestResult(ctx,{input:b,ip:meta.ip}),
  // Participating offices for «تحديد نطاق البحث», and «أرسل طلبك للمكاتب» (≤3 offices, one reference).
  "/os/public/search/options": (ctx,b,meta) => guestSearchOptions(ctx,{input:b,ip:meta.ip}),
  "/os/public/requests": (ctx,b,meta) => submitGuestRequest(ctx,{input:b,ip:meta.ip}),
  // «تعبئة ذكية» on the office's public page: the text is analysed, nothing is saved.
  "/os/public/smart-fill": (ctx, body, meta) => analyzePublicText(ctx, { officeId: body.officeId, text: typeof body.text === "string" ? body.text : "", ip: meta.ip }),
  "/os/reply/view": (ctx, body, meta) => viewReply(ctx, { token: body.token, ip: meta.ip }),
  "/os/reply/submit": (ctx, body, meta) => submitReply(ctx, { token: body.token, optionId: body.optionId, text: body.text, submissionId: body.submissionId, ip: meta.ip }),
  "/os/session/view": (ctx, body, meta) => viewSession(ctx, { token: body.token, ip: meta.ip }),
  "/os/session/act": (ctx, body, meta) => submitSessionAction(ctx, {
    token: body.token, action: body.action, price: body.price, viewingAt: body.viewingAt, termId: body.termId, optionId: body.optionId,
    topicId: body.topicId, message: body.message, submissionId: body.submissionId, ip: meta.ip
  })
});

const OFFICE_ROUTES = Object.freeze({
  "/os/whatsapp-agent/status": (ctx, b, actor) => whatsappAgentStatus(ctx, { officeId: ctx.officeId, actor }),
  "/os/whatsapp-agent/settings": (ctx, b, actor) => configureWhatsAppAgent(ctx, { officeId: ctx.officeId, actor, enabled: b.enabled }),
  "/os/whatsapp-agent/run": (ctx, b, actor) => {
    if (!actor.isManager) throw ctx.deps.appError("forbidden", 403, "لمدير المكتب فقط");
    return drainWhatsAppQueue(ctx, { officeId: ctx.officeId });
  },
  // Cases the WhatsApp agent opened (interest, offers, viewings) and the office's decisions on them.
  "/os/whatsapp-agent/cases": (ctx, b, actor) => listWhatsAppCases(ctx, { officeId: ctx.officeId, actor }),
  "/os/whatsapp-agent/case/action": (ctx, b, actor) => actOnWhatsAppCase(ctx, {
    officeId: ctx.officeId, actor, caseId: text(b.caseId), action: text(b.action),
    input: b.input && typeof b.input === "object" ? b.input : {}, requestKey: text(b.requestKey)
  }),
  // «المحادثات»: who answers each WhatsApp conversation, and the broker's take over / reply / hand back.
  "/os/whatsapp-agent/conversations": (ctx, b, actor) => listWhatsAppConversations(ctx, { officeId: ctx.officeId, actor }),
  "/os/whatsapp-agent/conversation": (ctx, b, actor) => getWhatsAppConversation(ctx, { officeId: ctx.officeId, actor, conversationId: text(b.conversationId) }),
  "/os/whatsapp-agent/conversation/control": (ctx, b, actor) => controlWhatsAppConversation(ctx, {
    officeId: ctx.officeId, actor, conversationId: text(b.conversationId), action: text(b.action), expectedVersion: Number(b.expectedVersion), requestKey: text(b.requestKey)
  }),
  "/os/whatsapp-agent/conversation/reply": (ctx, b, actor) => replyInWhatsAppConversation(ctx, {
    officeId: ctx.officeId, actor, conversationId: text(b.conversationId), text: typeof b.text === "string" ? b.text : "", requestKey: text(b.requestKey)
  }),
  // «حد المالك» for one offer: the manager only; Worker-only storage, never on the record.
  "/os/records/mandate": (ctx, b, actor) => getRecordMandate(ctx, { officeId: ctx.officeId, actor, recordId: text(b.recordId) }),
  "/os/records/mandate/set": (ctx, b, actor) => setRecordMandate(ctx, { officeId: ctx.officeId, actor, recordId: text(b.recordId), floor: b.floor, source: b.source }),
  "/os/records/cooperation": (ctx, b, actor) => reviewExternalCooperation(ctx, { actor, officeId: ctx.officeId, recordId: text(b.recordId), input: b }),
  // «تعبئة ذكية» / «إضافة سريعة»: analysis only — the record is saved later through /os/records/save after review.
  "/os/smart-fill": (ctx, b, actor) => analyzeOfficeText(ctx, { officeId: ctx.officeId, text: typeof b.text === "string" ? b.text : "", multi: b.multi !== false, ip: actor.uid }),
  "/os/records/save": (ctx, b, actor) => saveRecord(ctx, { actor, officeId: ctx.officeId, recordId: b.recordId, input: b.record || {}, requestKey: b.requestKey }),
  "/os/records/remove": (ctx, b, actor) => removeRecord(ctx, { actor, officeId: ctx.officeId, recordId: text(b.recordId), reason: b.reason }),
  "/os/records/restore": (ctx, b, actor) => restoreRecord(ctx, { actor, officeId: ctx.officeId, recordId: text(b.recordId) }),
  // Official reservation: a manager's own decision (the AI and the bot cannot call these).
  "/os/records/reserve": (ctx, b, actor) => reserveRecord(ctx, { actor, officeId: ctx.officeId, recordId: text(b.recordId), journeyId: text(b.journeyId), note: typeof b.note === "string" ? b.note : "" }),
  "/os/records/release": (ctx, b, actor) => releaseReservation(ctx, { actor, officeId: ctx.officeId, recordId: text(b.recordId) }),
  "/os/records/pause": (ctx, b, actor) => holdRecord(ctx, { actor, officeId: ctx.officeId, recordId: text(b.recordId), kind: "PAUSED", reason: b.reason }),
  "/os/records/archive": (ctx, b, actor) => holdRecord(ctx, { actor, officeId: ctx.officeId, recordId: text(b.recordId), kind: "ARCHIVED", reason: b.reason }),
  "/os/records/media": (ctx, b, actor) => arrangeRecordImages(ctx, { actor, officeId: ctx.officeId, recordId: text(b.recordId), order: Array.isArray(b.order) ? b.order.slice(0, 40).map(text) : null, remove: Array.isArray(b.remove) ? b.remove.slice(0, 40).map(text) : null }),
  // صلاحية العرض أو الطلب والتأكد من التوفر — the same record, never deleted.
  "/os/records/validity": (ctx, b, actor) => setRecordValidity(ctx, { actor, officeId: ctx.officeId, recordId: text(b.recordId), duration: text(b.duration), customDate: text(b.customDate), urgent: b.urgent === true }),
  "/os/records/availability": (ctx, b, actor) => applyAvailabilityAnswer(ctx, { actor, officeId: ctx.officeId, recordId: text(b.recordId), answer: text(b.answer).toUpperCase() }),
  "/os/records/reactivate": (ctx, b, actor) => reactivateRecord(ctx, { actor, officeId: ctx.officeId, recordId: text(b.recordId), duration: text(b.duration), customDate: text(b.customDate) }),
  "/os/validity/sweep": (ctx, b, actor) => sweepValidityNow(ctx, { actor, officeId: ctx.officeId }),
  "/os/records/candidates": (ctx, b, actor) => searchThroughCentral(ctx, { actor, recordId: text(b.recordId), limit: b.limit }),
  "/os/records/pair": (ctx, b) => pairRecords(ctx, { officeId: ctx.officeId, recordId: text(b.recordId), counterpartId: text(b.counterpartId) }),
  "/os/review/decide": async (ctx, b, actor) => {
    const decided = await decideMatchReview(ctx, { actor, officeId: ctx.officeId, matchId: text(b.matchId), decision: text(b.decision), postponeDays: b.postponeDays, reason: b.reason });
    // With the office's bot on, the sides that are linked to it receive their room link right away.
    if (decided?.journeyId && !decided.duplicate) {
      await announceRoom(ctx, { officeId: ctx.officeId, journeyId: decided.journeyId, by: "broker" }).catch((error) => console.warn("[office-os] bot announce failed", error?.code || error?.message));
    }
    return decided;
  },
  "/os/proposals/create": (ctx, b, actor) => createProposals(ctx, {
    actor, officeId: ctx.officeId, journeyId: text(b.journeyId), matchId: text(b.matchId), kind: text(b.kind),
    recipients: Array.isArray(b.recipients) ? b.recipients : [], fields: b.fields || {}, messages: b.messages || {}, requestKey: text(b.requestKey)
  }).then((proposals) => ({ ok: true, proposals })),
  "/os/proposals/handoff": (ctx, b, actor) => recordHandoff(ctx, { actor, officeId: ctx.officeId, proposalId: text(b.proposalId), channel: text(b.channel) || "WHATSAPP" }),
  "/os/proposals/cancel": (ctx, b, actor) => cancelProposal(ctx, { actor, officeId: ctx.officeId, proposalId: text(b.proposalId) }),
  "/os/journeys/note": (ctx, b, actor) => addBrokerNote(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), text: b.text, party: text(b.party), optionLabel: b.optionLabel, requestKey: text(b.requestKey) }),
  "/os/journeys/ack-reply": (ctx, b, actor) => acknowledgeReply(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), proposalId: text(b.proposalId) }),
  "/os/journeys/viewing/confirm": (ctx, b, actor) => confirmViewing(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId) }),
  "/os/journeys/viewing/result": (ctx, b, actor) => recordViewingResult(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), result: text(b.result), note: b.note }),
  "/os/journeys/documents": (ctx, b, actor) => updateDealDocument(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), documentId: text(b.documentId), status: text(b.status), note: b.note, label: b.label, remove: b.remove === true, libraryItemId: text(b.libraryItemId), unlinkFile: b.unlinkFile === true }),
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
  // «اعتماد السعر»: the manager or the assigned broker approves (or not) the price both sides agreed on.
  "/os/session/price-approval": (ctx, b, actor) => decideSessionPrice(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), decision: text(b.decision), price: b.price, note: b.note, requestKey: text(b.requestKey) }),
  "/os/session/resolve": (ctx, b, actor) => resolveIntervention(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId) }),
  "/os/session/request": (ctx, b, actor) => handleSessionRequest(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), requestId: text(b.requestId), decision: text(b.decision), text: b.text, requestKey: text(b.requestKey) }),
  // Channels: every member sees the state; linking and unlinking are the manager's (checked in the service).
  "/os/channels/status": (ctx, b, actor) => channelsStatus(ctx, { officeId: ctx.officeId, actor }),
  // «بوت المكتب»: the switch is the manager's; a broker links his own alerts; any member may hand a side its link.
  "/os/bot/enable": (ctx, b, actor) => setBotEnabled(ctx, { actor, officeId: ctx.officeId, enabled: b.enabled === true }),
  "/os/bot/broker/link": (ctx, b, actor) => startBrokerLink(ctx, { actor, officeId: ctx.officeId }),
  "/os/bot/broker/unlink": (ctx, b, actor) => unlinkBroker(ctx, { actor, officeId: ctx.officeId }),
  "/os/bot/broker/telegram-login": (ctx, b, actor) => linkBrokerWithTelegramLogin(ctx, { actor, officeId: ctx.officeId, auth: b.auth && typeof b.auth === "object" ? b.auth : null }),
  "/os/bot/party/link": (ctx, b, actor) => startPartyLink(ctx, { actor, officeId: ctx.officeId, recordId: text(b.recordId) }),
  "/os/bot/party/status": (ctx, b) => partyLinkStatus(ctx, { officeId: ctx.officeId, recordId: text(b.recordId) }),
  "/os/journeys/bot": (ctx, b, actor) => setJourneyBotPaused(ctx, { actor, officeId: ctx.officeId, journeyId: text(b.journeyId), paused: b.paused === true }),
  "/os/channels/telegram/link": (ctx, b, actor) => startTelegramLink(ctx, { actor, officeId: ctx.officeId }),
  "/os/channels/telegram/unlink": (ctx, b, actor) => unlinkTelegram(ctx, { actor, officeId: ctx.officeId }),
  "/os/channels/whatsapp/disconnect": (ctx, b, actor) => disconnectWhatsapp(ctx, { actor, officeId: ctx.officeId }),
  "/os/inbox/convert": (ctx, b, actor) => convertInboxMessage(ctx, { actor, officeId: ctx.officeId, inboxId: text(b.inboxId) }),
  // «مركز التواصل والدعم»: platform support (Telegram Business). Any member may read the state and send a question or report.
  // «مدير المكتب الذكي»: every member reads its state and talks to it; switching it and its instructions are the manager's.
  "/os/agent/status": (ctx, b, actor) => agentStatus(ctx, { officeId: ctx.officeId, actor }),
  "/os/agent/settings": (ctx, b, actor) => saveAgentSettings(ctx, { actor, officeId: ctx.officeId, enabled: typeof b.enabled === "boolean" ? b.enabled : undefined, instructions: typeof b.instructions === "string" ? b.instructions : undefined, validity: b.validity && typeof b.validity === "object" ? b.validity : undefined }),
  "/os/agent/chat": (ctx, b, actor) => agentChat(ctx, { actor, officeId: ctx.officeId, message: typeof b.message === "string" ? b.message : "", requestKey: text(b.requestKey) }),
  "/os/agent/history": (ctx, b, actor) => agentHistory(ctx, { officeId: ctx.officeId, actor }),
  "/os/agent/act": (ctx, b, actor) => runApprovedAction(ctx, { actor, officeId: ctx.officeId, tool: text(b.tool), journeyId: text(b.journeyId), askIds: Array.isArray(b.askIds) ? b.askIds.slice(0, 20).map(text) : [] }),
  "/os/agent/suggestions": (ctx, b, actor) => agentSuggestions(ctx, { officeId: ctx.officeId, actor }),
  // «جرّب مدير مكتبك»: the Telegram conversation an owner/broker/client would have — nothing sent, nothing saved.
  "/os/agent/preview": (ctx, b, actor) => previewVisitor(ctx, { actor, officeId: ctx.officeId, input: { action: text(b.action), text: typeof b.text === "string" ? b.text.slice(0, 1500) : "", data: text(b.data), phone: text(b.phone) } }),
  // «الباحث عن الفرص»: every member reads the board and starts or controls his searches; the switches are the manager's.
  "/os/scout/overview": (ctx, b, actor) => scoutOverview(ctx, { officeId: ctx.officeId, actor }),
  "/os/scout/settings": (ctx, b, actor) => saveScoutSettings(ctx, { actor, officeId: ctx.officeId, patch: b.settings && typeof b.settings === "object" ? b.settings : {} }),
  "/os/scout/parse": (ctx, b, actor) => parseSearchText(ctx, { actor, officeId: ctx.officeId, text: typeof b.text === "string" ? b.text : "" }),
  "/os/scout/search": (ctx, b, actor) => createSearch(ctx, { actor, officeId: ctx.officeId, input: b.search && typeof b.search === "object" ? b.search : {}, requestKey: text(b.requestKey) }),
  "/os/scout/search/detail": (ctx, b) => searchDetail(ctx, { officeId: ctx.officeId, taskId: text(b.taskId) }),
  "/os/scout/search/control": (ctx, b, actor) => controlSearch(ctx, { actor, officeId: ctx.officeId, taskId: text(b.taskId), action: text(b.action), mode: text(b.mode) }),
  // From inside an offer or a request: one press, everything read from the record.
  "/os/scout/record": (ctx, b, actor) => recordSearch(ctx, { actor, officeId: ctx.officeId, recordId: text(b.recordId), action: text(b.action).toUpperCase() || "STATUS", mode: text(b.mode) }),
  "/os/scout/find": (ctx, b) => findDetail(ctx, { officeId: ctx.officeId, opportunityId: text(b.opportunityId) }),
  "/os/scout/find/act": (ctx, b, actor) => actOnFind(ctx, { actor, officeId: ctx.officeId, opportunityId: text(b.opportunityId), action: text(b.action), recordId: text(b.recordId), result: text(b.result), note: typeof b.note === "string" ? b.note : "" }),
  "/os/scout/import": (ctx, b, actor) => importScoutLink(ctx, { actor, officeId: ctx.officeId, url: typeof b.url === "string" ? b.url : "", text: typeof b.text === "string" ? b.text : "" }),
  "/os/scout/web/live": (ctx, b, actor) => liveSearchForTask(ctx, { actor, officeId: ctx.officeId, taskId: text(b.taskId) }),
  "/os/scout/telegram/link": (ctx, b, actor) => startScoutChatLink(ctx, { actor, officeId: ctx.officeId }),
  "/os/scout/telegram/unlink": (ctx, b, actor) => unlinkScoutChat(ctx, { actor, officeId: ctx.officeId, chatId: text(b.chatId) }),
  // «الاستقبال التلقائي»: keys an assistant (Claude) uses to send its results straight to the scout — the manager's.
  "/os/scout/ingest/keys": (ctx, b, actor) => listIngestKeys(ctx, { officeId: ctx.officeId, actor }),
  "/os/mcp/key/create": (ctx, b, actor) => createIngestKey(ctx, { officeId: ctx.officeId, actor, label: typeof b.label === "string" ? b.label : "ChatGPT", scope: "mcp:read" }),
  "/os/scout/ingest/key/create": (ctx, b, actor) => createIngestKey(ctx, { officeId: ctx.officeId, actor, label: typeof b.label === "string" ? b.label : "" }),
  "/os/scout/ingest/key/revoke": (ctx, b, actor) => revokeIngestKey(ctx, { officeId: ctx.officeId, actor, keyId: text(b.keyId) }),
  "/os/scout/feed": (ctx, b, actor) => feedScout(ctx, { actor, officeId: ctx.officeId, text: typeof b.text === "string" ? b.text : "", channel: text(b.channel).toUpperCase() }),
  "/os/support/status": (ctx) => supportStatus(ctx),
  "/os/support/ticket": (ctx, b, actor) => createOfficeTicket(ctx, { actor, officeId: ctx.officeId, input: { kind: b.kind, text: typeof b.text === "string" ? b.text.slice(0, 2000) : "", needsAdmin: b.needsAdmin === true } }),
  // Staff access (D-020): the office owner only — checked against offices/{o}.ownerUid inside the service.
  "/os/members/access": (ctx, b, actor) => setMemberAccess(ctx, {
    officeId: ctx.officeId, actor, memberUid: text(b.memberUid),
    role: b.role === undefined ? undefined : String(b.role), active: b.active
  })
});

const INGEST_PATH = "/os/scout/ingest";

function text(value) {
  return String(value ?? "").trim().slice(0, 200);
}

/** Record actions after which the record's search in «الباحث عن الفرص» is brought in line. */
const SCOUT_RECORD_ROUTES = new Set([
  "/os/records/save", "/os/records/remove", "/os/records/restore", "/os/records/pause", "/os/records/archive",
  "/os/records/validity", "/os/records/availability", "/os/records/reactivate"
]);

function slim(result) {
  if (!result || typeof result !== "object") return { ok: true };
  if ("journey" in result) {
    const { journey, ...rest } = result;
    return { ok: true, ...rest, journeyId: journey?.journeyId || journey?.id || rest.journeyId || "" };
  }
  return { ok: true, ...result };
}

/** The same request context the office routes use, for a server-side caller (Kapso Sandbox). */
export async function officeOsContext(env, deps, officeId) {
  deps.assertFirebaseSecrets(env);
  const projectId = env.FIREBASE_PROJECT_ID || deps.DEFAULT_PROJECT_ID;
  const accessToken = await deps.getGoogleAccessToken(env);
  const boundDeps = deps.bind ? deps.bind({ env, projectId, accessToken }) : deps;
  return { deps: boundDeps, store: createStore(boundDeps, { projectId, accessToken }), officeId, env, appOrigin: deps.resolveAppOrigin(env), now: () => new Date() };
}

export function isOfficeOsPath(pathname) {
  return pathname === "/os" || String(pathname || "").startsWith("/os/");
}

export async function handleOfficeOs(request, env, deps, { requestId = "", waitUntil = null } = {}) {
  const url = new URL(request.url);
  if (request.method !== "POST") {
    return deps.jsonResponse({ ok: false, error: "method_not_allowed", requestId }, 405);
  }
  const raw = await request.text().catch(() => "");
  let body = {};
  try { const parsed = JSON.parse(raw || "{}"); body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch (_) { body = {}; }
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
      // Server-side configuration only (which integrations are set up); never returned to a client as is.
      env,
      appOrigin: deps.resolveAppOrigin(env),
      // Work that may finish after the response (office push/Telegram alerts). Absent → callers await.
      waitUntil: typeof waitUntil === "function" ? waitUntil : null,
      now: () => new Date()
    };
  };
  try {
    // The room's main photo, by the party's own link (bytes, not JSON).
    if (url.pathname === "/os/session/image") {
      const picture = await sessionImage(await makeCtx(""), { token: body.token, ip: meta.ip });
      if (!picture) return deps.jsonResponse({ ok: false, error: "not_found", requestId }, 404);
      const response = deps.jsonResponse({}, 200);
      const headers = new Headers(response.headers);
      headers.set("content-type", picture.contentType);
      headers.set("cache-control", "private, max-age=300");
      headers.set("x-content-type-options", "nosniff");
      return new Response(picture.body, { status: 200, headers });
    }
    // An assistant's results, by the office's own revocable key (no user session; the office comes from the key).
    if (url.pathname === INGEST_PATH) {
      const ctx = await makeCtx("");
      const result = await ingestScoutBatch(ctx, { authorization: request.headers.get("authorization") || "", body, rawLength: raw.length, runCycle: runOfficeCycle });
      return deps.jsonResponse({ ...result, requestId }, 200);
    }
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
    // «الباحث عن الفرص» follows the record at once (its search starts, waits or ends); a failure here never undoes the action.
    if (SCOUT_RECORD_ROUTES.has(url.pathname)) {
      const recordId = text(result?.recordId || body.recordId);
      const matches = url.pathname === "/os/records/save" && result?.matchingPending === false && !result?.duplicate ? Number(result.matches || 0) : null;
      if (recordId) await scoutRecordChanged(ctx, { officeId, recordId, matches }).catch((error) => console.warn("[office-os] scout follow failed", error?.code || error?.message));
    }
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
