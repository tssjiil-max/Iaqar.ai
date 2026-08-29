Warning: truncated output (original token count: 87013)
Total output lines: 7685

import {
  MATCHING_RULE_VERSION,
  MATCH_THRESHOLD,
  MAX_MATCH_CANDIDATES,
  MAX_MATCH_RESULTS,
  DEFAULT_CITY,
  phase4BoundaryGuarantees,
  readinessFromScore as readinessFromScoreEngine,
  normalizeMatchStatus as normalizeMatchStatusEngine,
  calculateClosingReadiness as calculateClosingReadinessEngine,
  opportunityToMatchInput,
  counterpartsEligible,
  isActiveLifecycle,
  canonicalPairKey,
  relevantDataVersion,
  buildMatchId,
  pairRuleKey,
  scoreMatch as scoreMatchEngine,
  rankMatchCandidates as rankMatchCandidatesEngine
} from "./matching-engine.js";
import {
  firestoreOfficeId,
  officeAuthorizationKey,
  officeIdsEquivalent
} from "../../public/js/office-id-domain.js";
import {
  MATCH_INTEGRITY,
  collectCandidateOpportunityIds,
  resolveCanonicalPairFromDocs
} from "./match-integrity-domain.js";
import {
  phase5BoundaryGuarantees,
  OPERATION_TYPES,
  OPERATION_STATUS,
  NOTIFICATION_TYPES,
  NOTIFICATION_STATUS,
  ACTIVE_OPERATION_STATUSES,
  buildMatchReviewDedupKey,
  shouldCreateMatchReview,
  applyOperationLifecycle
} from "./operations-domain.js";
import webpush from "web-push";
import {
  createMatchReviewBundle,
  expireOperationsForMatchIds,
  upsertMissingDataForOpportunity,
  upsertCooperationOperations,
  applyTrustedOperationAction,
  listMissingOpportunityFields,
  pushTypeForOperation
} from "./operations-service.js";
import {
  phase6BoundaryGuarantees,
  cooperationModeAllowsExplicitRequest
} from "./cooperation-phase6-domain.js";
import {
  runCooperationLifecycle,
  revokeBankSharingScope,
  createExplicitCooperationRequest,
  resolveAcceptedCooperationPair
} from "./cooperation-phase6-service.js";
import {
  maybeCreateCrossOfficeCooperation,
  runCooperationWorkflow
} from "./cooperation-workflow-service.js";
import { buildCooperationNearbySuggestions, resolveNearbyEmptyReason } from "./cooperation-nearby-service.js";
import { buildSuitableOfficesResult } from "./suitable-offices-service.mjs";
import {
  loadOpportunityWorkspaceBundle,
  ensureCooperationRoom
} from "./opportunity-workspace-service.mjs";
import {
  sanitizeOpportunityPatch,
  mergeOpportunityFinancialPatch,
  readinessFieldsForRecord,
  validateCooperationListingEnable,
  mapPatchErrorMessage
} from "./opportunity-patch-service.js";
import {
  PERMANENT_DELETE_CONFIRM,
  applyOpportunityPurge,
  collectOfficeWorkflowRows,
  planOpportunityPurge,
  validatePurgeRequest
} from "./opportunity-purge-service.js";
import { markNotificationRead } from "./in-app-notification-write.js";
import { missingFieldLabelsArabic } from "../../public/js/opportunity-readiness-domain.js";
import { formatOfficePushPresentation, officeBrandIconCandidates, toAbsoluteHttpsIcon, PLATFORM_DEFAULT_LOGO } from "../../public/js/platform-brand-domain.js";
import {
  handlePublicOfficePreview,
  handleOfficeShareCardGet,
  handleOfficeShareCardUpload,
  handleSavePublicSlug,
  pickReachableHttpsIcon,
  shareCardGetMatch
} from "./office-public-preview.js";
import {
  afterPublicIntakePersisted,
  acceptPlatformOffer,
  declinePlatformOffer,
  expireDuePlatformOffers,
  submitOfficeRating
} from "./opportunity-router-service.js";
import {
  assertPilotFeatureEnabled,
  assertPilotOfficeAccess,
  assertPilotRegistrationAllowed,
  getPilotAccessStatus,
  loadPilotAccessConfig
} from "./pilot-access-service.js";
import {
  ORIGIN_SOURCE_TYPE,
  originSourceFromIntake,
  livingTaskIdForOpportunity,
  ASSIGNMENT_REASON,
  ROUTING_STATUS,
  routerCompleteness
} from "../../public/js/opportunity-router-domain.js";
import {
  MESSAGE_CHANNELS,
  MESSAGE_SEND_STATE,
  MESSAGE_DELIVERY_STATE,
  TEMPLATE_CODES,
  ADAPTER_STATUS,
  phase7BoundaryGuarantees,
  buildArabicMessageBody,
  buildMessageDraft,
  applyExternalHandoff,
  whatsappAdapterContract,
  telegramWebhookValidationFixture,
  normalizeChannel,
  resolveTemplateCode,
  whatsappDigits
} from "./messaging-domain.js";
import {
  PUBLIC_RATE_LIMITS,
  consumePublicRateLimit,
  evaluatePublicRateLimit,
  publicRateLimitKey,
  resetPublicRateLimitStoreForTests
} from "./public-rate-limit.js";
import {
  handlePartySessionGet,
  handlePartySessionMint,
  handlePartySessionPhoto,
  handlePartySessionReply,
  handlePartySessionBundle,
  handleMatchLivingAction
} from "./party-session-service.js";
import {
  syncCooperationCoordinationForOffice
} from "./coordination-session-service.js";
import {
  analyzeVoiceWithGemini,
  getVoiceTelemetrySnapshot,
  resolveGeminiModel,
  validateVoiceAudio,
  voiceAnalyzeHttpErrorMessage
} from "./gemini-voice-service.js";
import {
  extractListingFromImage,
  mediaExtractPublicMessage
} from "./listing-image-vision-service.mjs";
import {
  extractListingFromAudio,
  AUDIO_TRANSCRIBE_ERROR_AR
} from "./gemini-audio-intake.mjs";
import { resolveCanonicalListingUrl } from "./canonical-listing-intake.mjs";
import { normalizeListingFetchUrl as adapterNormalizeListingFetchUrl } from "./listing-site-adapters.mjs";
import {
  startCanonicalIntake,
  handleCanonicalIntakeCallback,
  retryCanonicalIntake,
  extractAudioFromMediaPath,
  extractImageTextFromMediaPath,
  verifyCanonicalMediaAccessToken
} from "./canonical-intake-service.js";
import {
  createAdminHelpers,
  handleAdminAuditLog,
  handleAdminLicenseUpdate,
  handleAdminNoteAdd,
  handleAdminOfficeActivity,
  handleAdminOfficeDetail,
  handleAdminOffices,
  handleAdminOverview,
  handleAdminReactivate,
  handleAdminSubscriptionUpdate,
  handleAdminSuspend,
  recordAdminActivityEvent,
  recordOfficeLoginActivity
} from "./admin-service.js";
import {
  LIFECYCLE_STATUS,
  LIFECYCLE_STATUS_LABELS,
  OPPORTUNITY_FINAL_CLOSE_REASONS,
  OPPORTUNITY_FINAL_CLOSE_REASON_LABELS,
  OPPORTUNITY_FINAL_OUTCOMES,
  normalizeOpportunitySource,
  getOpportunityLifecycleStatus,
  normalizeSaudiPhoneForWhatsApp,
  buildOpportunitySummary,
  buildOpportunityWhatsAppMessage,
  resolveSelectOption,
  extractDistrictFromVoice,
  parseVoiceOpportunityFields,
  whatsappActionTypeForStatus,
  isArchivedLifecycle,
  isActiveLifecycle as isOpportunityLifecycleActive
} from "./opportunity-lifecycle.mjs";
import { findDuplicateOpportunity, matchesDuplicateCriteria } from "./opportunity-duplicate.mjs";
import {
  ACTIVEPIECES_SOURCE,
  authorizeActivepieces,
  composeActivepiecesMessage,
  isStagingFirebaseEnv,
  validateActivepiecesIntakeBody
} from "./activepieces-intake.mjs";
import {
  mergeBrokerActionProgress,
  normalizeBrokerActionProgress,
  contactOutcomeActionKey,
  followUpOutcomeActionKey,
  followUpWhatsAppActionKey,
  partyActionKey,
  BROKER_ACTION
} from "../../public/js/broker-action-progress-domain.js";
import {
  FOLLOWUP_STATUSES,
  RECIPIENT_MODES,
  RECIPIENT_MODE_LABELS,
  validateFutureFollowUpAt,
  validateTodayRequiresFutureTime,
  buildCanonicalFollowUp,
  computeReminderAt,
  parseFollowUpInstant,
  resolveRecipientContext,
  normalizeRecipientMode,
  deriveFollowUpStatus,
  shouldSendFollowUpReminder,
  followUpReminderDedupKey,
  getDueFollowUpReminder,
  advanceFollowUpAfterReminder,
  followUpReminderTitle,
  isSameScheduledFollowUp,
  formatFollowUpReminderBody,
  formatFollowUpTimeLabel,
  parseRiyadhDateTimeInput,
  isOwnerOpportunity
} from "./opportunity-followup.mjs";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_PROJECT_ID = "aqar-b5d76";
const DEFAULT_APP_ORIGIN = "https://iaqar.ai";
const DEFAULT_STAGING_APP_ORIGIN = "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";

function resolveAppOrigin(env = {}) {
  const configured = cleanText(env.APP_ORIGIN, 200);
  if (configured) return configured.replace(/\/$/, "");
  const deployment = String(env.DEPLOYMENT_ENV || "production").toLowerCase();
  if (deployment === "staging") return DEFAULT_STAGING_APP_ORIGIN;
  return DEFAULT_APP_ORIGIN;
}
const GRAPH_VERSION = "v25.0";
const MAX_RAW_LENGTH = 16000;
const DAILY_FREE_WRITES = 20000;
const WARNING_PERCENT = 80;
const ESTIMATED_WRITES_PER_MESSAGE = 8;

const DEAL_STAGE_ORDER = ["contact","viewing","negotiation","agreement","closing","closed"];
const DEAL_STAGE_LABELS = Object.freeze({
  contact: "التواصل", viewing: "المعاينة", negotiation: "التفاوض",
  agreement: "اتفاقية الوساطة", closing: "جاهزة للإغلاق", closed: "تمت الصفقة", lost: "متوقفة"
});
const DEAL_NEXT_ACTION_LABELS = Object.freeze({
  contact: "تحديد موعد معاينة", viewing: "بدء التفاوض", negotiation: "تجهيز اتفاقية الوساطة",
  agreement: "اعتماد الاتفاقية", closing: "إغلاق الصفقة", closed: "تمت الصفقة", lost: "لا يوجد إجراء"
});
const MATCH_STATUS_ORDER = ["active","waiting_response","viewing","negotiation"];
const MATCH_STATUS_LABELS = Object.freeze({
  new: "نشطة", active: "نشطة", in_progress: "نشطة", waiting_response: "بانتظار رد",
  viewing: "موعد معاينة", negotiation: "تفاوض", converted: "تفاوض",
  completed: "تمت الصفقة", closed: "أُغلقت"
});
const MATCH_NEXT_ACTION_LABELS = Object.freeze({
  new: "بدء التواصل", active: "التواصل مع الطرفين", in_progress: "متابعة التواصل",
  waiting_response: "متابعة الرد", viewing: "تأكيد المعاينة", negotiation: "متابعة التفاوض",
  converted: "متابعة الصفقة", completed: "تمت الصفقة", closed: "لا يوجد إجراء"
});
const READINESS_LABELS = Object.freeze({
  very_high: "عالية جدًا", high: "عالية", medium: "متوسطة", low: "منخفضة"
});
const DEAL_HEALTH_LABELS = Object.freeze({
  excellent: "ممتازة", stable: "مستقرة", needs_intervention: "تحتاج تدخل", at_risk: "معرضة للفشل"
});
function nextDealStage(current){
  const safe=DEAL_STAGE_ORDER.includes(current)?current:"contact";
  return DEAL_STAGE_ORDER[Math.min(DEAL_STAGE_ORDER.indexOf(safe)+1,DEAL_STAGE_ORDER.length-1)];
}
function normalizeMatchStatus(value){
  return normalizeMatchStatusEngine(cleanText(value||"active",40));
}
function readinessFromScore(score){
  return readinessFromScoreEngine(score);
}
function calculateClosingReadiness(args){
  return calculateClosingReadinessEngine(args);
}
function calculateDealHealth({stage="contact",status="open",updatedAt=null,nextFollowUpAt=null}={}){
  if(status==="closed"||stage==="closed") return {score:100,key:"excellent",label:DEAL_HEALTH_LABELS.excellent};
  if(status==="lost"||stage==="lost") return {score:10,key:"at_risk",label:DEAL_HEALTH_LABELS.at_risk};
  const base={contact:66,viewing:76,negotiation:82,agreement:88,closing:95}[stage]||60;
  const now=Date.now();
  const updated=updatedAt?new Date(updatedAt).getTime():now;
  const due=nextFollowUpAt?new Date(nextFollowUpAt).getTime():0;
  let score=base;
  if(Number.isFinite(updated)&&now-updated>7*86400000) score-=25;
  else if(Number.isFinite(updated)&&now-updated>3*86400000) score-=12;
  if(Number.isFinite(due)&&due>0&&due<now) score-=18;
  score=Math.max(0,Math.min(100,Math.round(score)));
  const key=score>=85?"excellent":score>=65?"stable":score>=40?"needs_intervention":"at_risk";
  return {score,key,label:DEAL_HEALTH_LABELS[key]};
}
function defaultNextFollowUp(hours=24){ return new Date(Date.now()+hours*3600000); }
function buildAnalyticsSummary({clients=[],owners=[],matches=[],deals=[]}={}){
  const closed=deals.filter(d=>d.status==="closed"), open=deals.filter(d=>d.status==="open"), lost=deals.filter(d=>d.status==="lost");
  const ranked=[...matches].filter(m=>!["completed","closed"].includes(normalizeMatchStatus(m.status))).sort((a,b)=>Number(b.closingReadinessScore||b.opportunityScore||b.score||0)-Number(a.closingReadinessScore||a.opportunityScore||a.score||0));
  const best=ranked[0]||null;
  const districts={}, propertyTypes={}, stages={};
  [...clients,...owners].forEach(d=>{if(d.district)districts[d.district]=(districts[d.district]||0)+1;if(d.propertyType)propertyTypes[d.propertyType]=(propertyTypes[d.propertyType]||0)+1;});
  deals.forEach(d=>{const st=d.workflowStage||"contact";stages[st]=(stages[st]||0)+1;});
  const topDistrict=Object.entries(districts).sort((a,b)=>b[1]-a[1])[0]?.[0]||"";
  const topPropertyType=Object.entries(propertyTypes).sort((a,b)=>b[1]-a[1])[0]?.[0]||"";
  const commissionActual=closed.reduce((sum,d)=>sum+Number(d.commissionActual||0),0);
  const commissionExpected=open.reduce((sum,d)=>sum+Number(d.commissionExpected||0),0);
  const closeRate=deals.length?Math.round((closed.length/deals.length)*100):0;
  const conversionRate=matches.length?Math.round((deals.length/matches.length)*100):0;
  const averageMatchScore=matches.length?Math.round(matches.reduce((sum,m)=>sum+Number(m.score||0),0)/matches.length):0;
  const now=Date.now();
  const isDue=d=>{
    const due=d.nextFollowUpAt?new Date(d.nextFollowUpAt).getTime():0;
    return Number.isFinite(due)&&due>0&&due<=now;
  };
  const dueMatches=matches.filter(m=>!["completed","closed"].includes(normalizeMatchStatus(m.status))&&isDue(m)).length;
  const dueDeals=deals.filter(d=>!["closed","lost"].includes(d.status)&&isDue(d)).length;
  const veryReady=matches.filter(m=>normalizeMatchStatus(m.status)!=="closed"&&Number(m.closingReadinessScore||0)>=85).length;
  const negotiationDeals=open.filter(d=>["negotiation","agreement","closing"].includes(d.workflowStage)).length;
  return {
    counts:{clients:clients.length,owners:owners.length,matches:matches.length,openDeals:open.length,closedDeals:closed.length,lostDeals:lost.length,dueFollowUps:dueMatches+dueDeals,veryReady,negotiationDeals},
    bestOpportunity:best?{score:Number(best.opportunityScore||best.score||0),matchScore:Number(best.score||0),closingReadinessScore:Number(best.closingReadinessScore||0),closingReadinessLabel:best.closingReadinessLabel||readinessFromScore(best.closingReadinessScore||0).label,district:best.district||"",propertyType:best.propertyType||"",matchId:String(best.matchId||best.id||""),priority:best.priority||"",status:normalizeMatchStatus(best.status),nextAction:best.nextAction||MATCH_NEXT_ACTION_LABELS[normalizeMatchStatus(best.status)],reasons:parseJsonArray(best.reasonsJson||best.reasons)}:null,
    morningSummary:{dueFollowUps:dueMatches+dueDeals,veryReady,negotiationDeals,openDeals:open.length,commissionExpected},
    topDistrict,topPropertyType,commissionActual,commissionExpected,closeRate,conversionRate,averageMatchScore,pipeline:stages
  };
}

let cachedGoogleToken = null;

export default {
  async fetch(request, env, executionContext) {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);

    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      if (request.method === "GET" && (url.pathname.startsWith("/m/") || url.pathname.startsWith("/o/"))) {
        assertFirebaseSecrets(env);
        const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
        const accessToken = await getGoogleAccessToken(env);
        return await handlePublicOfficePreview(request, env, publicPreviewDeps(env, requestId, projectId, accessToken));
      }

      if (request.method === "GET" && shareCardGetMatch(url.pathname)) {
        return await handleOfficeShareCardGet(request, env, publicPreviewDeps(env, requestId));
      }

      if (request.method === "POST" && url.pathname === "/media/office-share-card") {
        return await handleOfficeShareCardUpload(request, env, publicPreviewDeps(env, requestId));
      }

      if (request.method === "POST" && url.pathname === "/office/public-slug") {
        assertFirebaseSecrets(env);
        const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
        const accessToken = await getGoogleAccessToken(env);
        return await handleSavePublicSlug(request, env, publicPreviewDeps(env, requestId, projectId, accessToken));
      }

      if (request.method === "GET" && url.pathname === "/platform/pilot-status") {
        assertFirebaseSecrets(env);
        const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
        const accessToken = await getGoogleAccessToken(env);
        const officeId = firestoreOfficeId(url.searchParams.get("officeId"));
        let isPlatformAdmin = false;
        const authHeader = cleanText(request.headers.get("Authorization"), 5000);
        const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
        if (bearer) {
          try {
            const claims = await verifyFirebaseIdToken(bearer, projectId);
            isPlatformAdmin = claims.platformAdmin === true || claims.admin === true;
          } catch (_) { /* public summary without auth */ }
        }
        const status = await getPilotAccessStatus(pilotAccessDeps(projectId, accessToken), {
          officeId,
          isPlatformAdmin
        });
        return jsonResponse({ ok: true, ...status, requestId });
      }

      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        const deploymentEnvironment = String(env.DEPLOYMENT_ENV || "production").toLowerCase() === "staging"
          ? "staging"
          : "production";
        const firebaseConfigured = hasFirebaseSecrets(env);
        // backendReady = phone login, matching, ops, messages, auth-gated media work.
        // UI-only staging Worker is rejected by deploy-staging smoke when this is false.
        const backendReady = firebaseConfigured;
        const cronEnabled = deploymentEnvironment !== "staging";
        return jsonResponse({
          ok: true,
          service: "iaqar-whatsapp-official-intake",
          mode: "inbound-only",
          outboundMessaging: false,
          deploymentEnvironment,
          firebaseConfigured,
          backendReady,
          cronEnabled,
          pushNotifications: Boolean(env.FCM_WEB_PUSH_VAPID_KEY && firebaseConfigured),
          projectId: env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
          webhook: "/meta/webhook",
          requestId,
          time: new Date().toISOString()
        });
      }

      if (request.method === "GET" && url.pathname === "/meta/config") {
        const officeId = firestoreOfficeId(url.searchParams.get("officeId"));
        const enabled = Boolean(env.META_APP_ID && env.META_CONFIG_ID && env.META_APP_SECRET);
        return jsonResponse({
          ok: true,
          enabled,
          appId: enabled ? env.META_APP_ID : "",
          configId: enabled ? env.META_CONFIG_ID : "",
          graphVersion: env.META_GRAPH_VERSION || GRAPH_VERSION,
          trialAllowed: Boolean(officeId),
          multiOffice: true,
          inboundOnly: true,
          outboundMessaging: false,
          requestId
        });
      }

      if (request.method === "GET" && url.pathname === "/meta/status") {
        return handleStatus(request, url, env, requestId);
      }

      if (request.method === "GET" && url.pathname === "/meta/webhook") {
        return verifyWebhook(url, env);
      }

      if (request.method === "POST" && url.pathname === "/meta/webhook") {
        return receiveMetaWebhook(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/meta/signup/complete") {
        return completeEmbeddedSignup(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/pipeline/preview") {
        const body = await request.json().catch(() => ({}));
        return jsonResponse({ ok: true, parsed: parseRealEstateMessage(cleanText(body.messageText, 12000), cleanText(body.senderPhone, 60), cleanText(body.senderName, 200)), requestId });
      }

      if (request.method === "POST" && url.pathname === "/pipeline/url-resolve") {
        return await handlePipelineUrlResolve(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/pipeline/media-extract") {
        return await handlePipelineMediaExtract(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/pipeline/audio-extract") {
        return await handlePipelineAudioExtract(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/pipeline/voice-analyze") {
        return await handlePipelineVoiceAnalyze(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/pipeline/public-voice-analyze") {
        return await handlePipelineVoiceAnalyze(request, env, requestId, { publicRoute: true });
      }

      if (request.method === "POST" && url.pathname === "/pipeline/canonical-intake") {
        return await handleCanonicalIntakeStart(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/pipeline/canonical-intake/callback") {
        return await handleCanonicalIntakeCallbackRoute(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/pipeline/canonical-intake/retry") {
        return await handleCanonicalIntakeRetryRoute(request, env, requestId);
      }

      if (request.method === "GET" && url.pathname === "/media/canonical-intake-access") {
        return await handleCanonicalIntakeMediaAccess(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/matching/preview") {
        const body = await request.json().catch(() => ({}));
        const source = body.source || parseRealEstateMessage(cleanText(body.sourceText, 12000), "", "");
        const candidates = Array.isArray(body.candidates) ? body.candidates : [];
        const ranked = rankMatchCandidates(source, candidates);
        return jsonResponse({
          ok: true,
          source,
          matches: ranked,
          bestOpportunity: ranked[0] || null,
          matchingRuleVersion: MATCHING_RULE_VERSION,
          threshold: MATCH_THRESHOLD,
          boundaries: phase4BoundaryGuarantees(),
          requestId
        });
      }

      if (request.method === "POST" && url.pathname === "/matching/run") {
        return await handleMatchingRun(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/operations/action") {
        return await handleOperationsAction(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/operations/from-cooperation") {
        return await handleOperationsFromCooperation(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/operations/missing-data") {
        return await handleOperationsMissingData(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/cooperation/nearby-suggestions") {
        return await handleCooperationNearbySuggestions(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/cooperation/suitable-offices") {
        return await handleCooperationSuitableOffices(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/cooperation/workflow") {
        return await handleCooperationWorkflow(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/cooperation/request") {
        return await handleCooperationRequestCreate(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/cooperation/lifecycle") {
        return await handleCooperationLifecycle(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/cooperation/sync-coordination") {
        return await handleCooperationSyncCoordination(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/cooperation/scope-revoke") {
        return await handleCooperationScopeRevoke(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/messages/draft") {
        return await handleMessagesDraft(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/messages/handoff") {
        return await handleMessagesHandoff(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/party/sessions") {
        return await handlePartySessionMint({
          request,
          env,
          requestId,
          helpers: partySessionHelpers()
        });
      }

      if (request.method === "POST" && url.pathname === "/match/living-action") {
        return await handleMatchLivingAction({
          request,
          env,
          requestId,
          helpers: partySessionHelpers()
        });
      }

      const partyGet = url.pathname.match(/^\/party\/sessions\/([^/]+)$/);
      if (request.method === "GET" && partyGet) {
        return await handlePartySessionGet({
          token: decodeURIComponent(partyGet[1] || ""),
          env,
          requestId,
          helpers: partySessionHelpers(),
          ip: request.headers.get("CF-Connecting-IP") || "unknown"
        });
      }

      const partyPhoto = url.pathname.match(/^\/party\/sessions\/([^/]+)\/photos\/(\d+)$/);
      if (request.method === "GET" && partyPhoto) {
        return await handlePartySessionPhoto({
          token: decodeURIComponent(partyPhoto[1] || ""),
          index: Number(partyPhoto[2] || 0),
          env,
          helpers: partySessionHelpers(),
          ip: request.headers.get("CF-Connecting-IP") || "unknown"
        });
      }

      const partyReply = url.pathname.match(/^\/party\/sessions\/([^/]+)\/reply$/);
      if (request.method === "POST" && partyReply) {
        return await handlePartySessionReply({
          token: decodeURIComponent(partyReply[1] || ""),
          env,
          request,
          requestId,
          helpers: partySessionHelpers(),
          ip: request.headers.get("CF-Connecting-IP") || "unknown"
        });
      }

      const partyBundle = url.pathname.match(/^\/party\/sessions\/([^/]+)\/bundle$/);
      if (request.method === "POST" && partyBundle) {
        return await handlePartySessionBundle({
          token: decodeURIComponent(partyBundle[1] || ""),
          env,
          request,
          requestId,
          helpers: partySessionHelpers(),
          ip: request.headers.get("CF-Connecting-IP") || "unknown",
          executionContext
        });
      }

      if (request.method === "GET" && url.pathname === "/messages/adapters") {
        return jsonResponse({
          ok: true,
          whatsapp: whatsappAdapterContract(),
          telegram: telegramWebhookValidationFixture(),
          boundaries: phase7BoundaryGuarantees(),
          requestId
        });
      }

      if (request.method === "POST" && url.pathname === "/workflow/preview") {
        const body = await request.json().catch(() => ({}));
        const current = cleanText(body.currentStage || "contact", 40);
        const next = nextDealStage(current);
        const health = calculateDealHealth({ stage: next, status: next === "closed" ? "closed" : "open" });
        return jsonResponse({ok:true,currentStage:current,nextStage:next,currentLabel:DEAL_STAGE_LABELS[current]||current,nextLabel:DEAL_STAGE_LABELS[next]||next,nextAction:DEAL_NEXT_ACTION_LABELS[next]||"متابعة الصفقة",health,closed:next==="closed",requestId});
      }

      if (request.method === "POST" && url.pathname === "/workflow/readiness/preview") {
        const body = await request.json().catch(() => ({}));
        const readiness = calculateClosingReadiness({
          matchScore: Number(body.matchScore || body.score || 0),
          source: body.source || {},
          candidate: body.candidate || {},
          status: body.status || "active"
        });
        return jsonResponse({ok:true,readiness,status:normalizeMatchStatus(body.status),statusLabel:MATCH_STATUS_LABELS[normalizeMatchStatus(body.status)],nextAction:MATCH_NEXT_ACTION_LABELS[normalizeMatchStatus(body.status)],requestId});
      }

      if (request.method === "POST" && url.pathname === "/office/analytics/preview") {
        const body = await request.json().catch(() => ({}));
        const summary = buildAnalyticsSummary({clients:Array.isArray(body.clients)?body.clients:[],owners:Array.isArray(body.owners)?body.owners:[],matches:Array.isArray(body.matches)?body.matches:[],deals:Array.isArray(body.deals)?body.deals:[]});
        return jsonResponse({ok:true,...summary,requestId});
      }

      if (url.pathname === "/activepieces/intake") {
        if (request.method === "POST") {
          return await handleActivepiecesIntake(request, env, requestId);
        }
        return jsonResponse({
          success: false,
          duplicate: false,
          opportunityId: "",
          missingFields: [],
          error: "method_not_allowed",
          message: "الطريقة غير مسموحة",
          requestId
        }, 405);
      }

      if (request.method === "POST" && url.pathname === "/pipeline/intake") {
        return await handleSharedIntake(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/pipeline/public-intake") {
        return await handlePublicIntakeMatching(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/opportunity-router/accept") {
        return await handleOpportunityRouterAccept(request, env, requestId);
      }
      if (request.method === "POST" && url.pathname === "/opportunity-router/decline") {
        return await handleOpportunityRouterDecline(request, env, requestId);
      }
      if (request.method === "POST" && url.pathname === "/opportunity-router/tick") {
        return await handleOpportunityRouterTick(request, env, requestId);
      }
      if (request.method === "POST" && url.pathname === "/opportunity-router/rate") {
        return await handleOpportunityRouterRate(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/broker/apply") {
        return await handleBrokerApplication(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/auth/phone-login-resolve") {
        return await handlePhoneLoginResolve(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/auth/phone-login") {
        return await handlePhoneLogin(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/auth/forgot-password") {
        return await handleForgotPassword(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/media/public-intake") {
        return await uploadPublicIntakeMedia(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/media/opportunity-source") {
        return await uploadOpportunitySourceMedia(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/media/office-cover") {
        return await uploadOfficeImage(request, env, requestId);
      }

      if (request.method === "DELETE" && url.pathname === "/media/office-cover") {
        return await deleteOfficeImage(request, env, requestId);
      }

      if (request.method === "GET" && url.pathname.startsWith("/media/public/office-covers/")) {
        return await servePublicOfficeCover(url, env);
      }

      if (request.method === "GET" && url.pathname === "/media/office") {
        return await serveOfficeMedia(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/media/office-library") {
        return await uploadOfficeLibraryMedia(request, env, requestId);
      }

      if (request.method === "GET" && url.pathname === "/admin/broker-applications") {
        return await listBrokerApplications(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/admin/broker-applications/action") {
        return await decideBrokerApplication(request, env, requestId);
      }

      if (request.method === "GET" && url.pathname === "/admin/overview") {
        return await handleAdminOverview(request, env, requestId, getAdminHelpers());
      }

      if (request.method === "GET" && url.pathname === "/admin/offices") {
        return await handleAdminOffices(request, url, env, requestId, getAdminHelpers());
      }

      if (request.method === "GET" && url.pathname === "/admin/office") {
        return await handleAdminOfficeDetail(request, url, env, requestId, getAdminHelpers());
      }

      if (request.method === "GET" && url.pathname === "/admin/office/activity") {
        return await handleAdminOfficeActivity(request, url, env, requestId, getAdminHelpers());
      }

      if (request.method === "GET" && url.pathname === "/admin/audit-log") {
        return await handleAdminAuditLog(request, url, env, requestId, getAdminHelpers());
      }

      if (request.method === "POST" && url.pathname === "/admin/office/suspend") {
        return await handleAdminSuspend(request, env, requestId, getAdminHelpers());
      }

      if (request.method === "POST" && url.pathname === "/admin/office/reactivate") {
        return await handleAdminReactivate(request, env, requestId, getAdminHelpers());
      }

      if (request.method === "POST" && url.pathname === "/admin/office/subscription") {
        return await handleAdminSubscriptionUpdate(request, env, requestId, getAdminHelpers());
      }

      if (request.method === "POST" && url.pathname === "/admin/office/license") {
        return await handleAdminLicenseUpdate(request, env, requestId, getAdminHelpers());
      }

      if (request.method === "POST" && url.pathname === "/admin/office/note") {
        return await handleAdminNoteAdd(request, env, requestId, getAdminHelpers());
      }

      if (request.method === "GET" && url.pathname === "/fcm/config") {
        const vapidConfigured = Boolean(env.FCM_WEB_PUSH_VAPID_KEY);
        const serverReady = hasFirebaseSecrets(env);
        return jsonResponse({
          ok: true,
          enabled: vapidConfigured && serverReady,
          vapidConfigured,
          serverReady,
          vapidKey: vapidConfigured ? env.FCM_WEB_PUSH_VAPID_KEY : "",
          projectId: env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID,
          requestId
        });
      }

      if (request.method === "GET" && url.pathname === "/fcm/status") {
        return getFcmStatus(request, url, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/fcm/register") {
        return registerFcmDevice(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/fcm/unregister") {
        return unregisterFcmDevice(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/fcm/test") {
        return sendFcmTestNotification(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/workflow/action") {
        return handleWorkflowAction(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/opportunity/lifecycle") {
        return handleOpportunityLifecycle(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/internal/followup-reminders/process") {
        return handleProcessFollowupReminders(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/opportunity/patch") {
        return handleOpportunityPatch(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/opportunity/purge") {
        return handleOpportunityPurge(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/notifications/read") {
        return handleNotificationRead(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/opportunity/workspace") {
        return handleOpportunityWorkspace(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/cooperation/room") {
        return handleCooperationRoom(request, env, requestId);
      }

      if (request.method === "GET" && url.pathname === "/workflow/timeline") {
        return handleWorkflowTimeline(request, url, env, requestId);
      }

      if (request.method === "GET" && url.pathname === "/office/analytics") {
        return await handleOfficeAnalytics(request, url, env, requestId);
      }

      if (url.pathname === "/ingest") {
        return jsonResponse({
          ok: false,
          error: "macrodroid_disabled",
          message: "تم إيقاف مسار MacroDroid. استخدم الربط الرسمي مع واتساب أعمال.",
          requestId
        }, 410);
      }

      // Cloud API / legacy outbound remains blocked. Phase 7 draft/handoff APIs are
      // registered above and never auto-send via Meta or Telegram Bot API.
      const draftApi = url.pathname === "/messages/draft"
        || url.pathname === "/messages/handoff"
        || url.pathname === "/messages/adapters";
      if (!draftApi && (url.pathname.includes("messages") || url.pathname.includes("send"))) {
        return jsonResponse({
          ok: false,
          error: "outbound_disabled",
          message: "إرسال رسائل واتساب التلقائي متوقف برمجيًا في النسخة الأولى.",
          requestId
        }, 403);
      }

      return jsonResponse({ ok: false, error: "not_found", requestId }, 404);
    } catch (error) {
      console.error("[iaqar-whatsapp] request failed", {
        requestId,
        code: error && error.code,
        message: error && error.message
      });
      return jsonResponse({
        ok: false,
        error: error && error.code || "internal_error",
        message: error && error.publicMessage || "تعذر تنفيذ الطلب",
        requestId
      }, Number(error && error.status) || 500);
    }
  },
  async scheduled(event, env, ctx) {
    const isStaging = String(env.DEPLOYMENT_ENV || "").toLowerCase() === "staging";
    const scheduledTime = event && event.scheduledTime;
    if (!isStaging) {
      ctx.waitUntil(processOverdueFollowups(env, scheduledTime));
    }
    ctx.waitUntil(processOpportunityFollowupReminders(env, scheduledTime));
  }
};

const PUBLIC_IMAGE_TYPES = Object.freeze({
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"
});
const PUBLIC_VIDEO_TYPES = Object.freeze({
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov"
});

function requireMediaBucket(env) {
  if (!env.IAQAR_MEDIA) throw appError("media_storage_unavailable", 503, "تخزين الوسائط غير مفعّل");
  return env.IAQAR_MEDIA;
}

function requestBodyLength(request) {
  const value = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(value) || value <= 0) throw appError("file_length_required", 411, "تعذر تحديد حجم الملف");
  return value;
}

function enforcePublicRouteRateLimit(request, { route, officeId = "", limit, windowMs }) {
  const ip = cleanText(request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown", 80);
  const key = publicRateLimitKey({ route, ip, officeId });
  const result = consumePublicRateLimit(key, { limit, windowMs });
  if (!result.ok) {
    throw appError(
      "rate_limited",
      429,
      "تم تجاوز حد الطلبات مؤقتًا. حاول مرة أخرى بعد قليل."
    );
  }
  return result;
}

async function uploadPublicIntakeMedia(request, env, requestId) {
  const bucket = requireMediaBucket(env);
  const officeId = firestoreOfficeId(request.headers.get("x-office-id"));
  const intakeId = cleanText(request.headers.get("x-intake-id"), 80).replace(/[^a-zA-Z0-9_-]/g, "");
  const mediaKind = cleanText(request.headers.get("x-media-kind"), 12).toLowerCase();
  const index = Number(request.headers.get("x-media-index") || 0);
  const contentType = cleanText(request.headers.get("content-type"), 80).toLowerCase();
  const size = requestBodyLength(request);
  if (!officeId || intakeId.length < 8) throw appError("invalid_media_target", 400, "وجهة الملف غير صالحة");
  enforcePublicRouteRateLimit(request, {
    route: "media/public-intake",
    officeId,
    ...PUBLIC_RATE_LIMITS.PUBLIC_MEDIA
  });

  let filename;
  if (mediaKind === "image" && PUBLIC_IMAGE_TYPES[contentType] && Number.isInteger(index) && index >= 1 && index <= 5) {
    if (size > 8 * 1024 * 1024) throw appError("image_too_large", 413, "حجم الصورة يتجاوز 8 ميجابايت");
    filename = `image-${index}.${PUBLIC_IMAGE_TYPES[contentType]}`;
  } else if (mediaKind === "video" && PUBLIC_VIDEO_TYPES[contentType]) {
    if (size > 90 * 1024 * 1024) throw appError("video_too_large", 413, "حجم الفيديو يتجاوز 90 ميجابايت");
    filename = `video.${PUBLIC_VIDEO_TYPES[contentType]}`;
  } else {
    throw appError("unsupported_media", 415, "نوع الملف غير مدعوم");
  }

  const key = `public-intake/${officeId}/${intakeId}/${filename}`;
  await bucket.put(key, request.body, {
    httpMetadata: { contentType },
    customMetadata: { officeId, intakeId, mediaKind, uploadedAt: new Date().toISOString() }
  });
  return jsonResponse({ ok: true, mediaPath: key, requestId }, 201);
}

const OPPORTUNITY_SOURCE_TYPES = Object.freeze({
  "image/jpeg": { sourceTypes: ["image", "screenshot"], ext: "jpg", max: 15 * 1024 * 1024 },
  "image/png": { sourceTypes: ["image", "screenshot"], ext: "png", max: 15 * 1024 * 1024 },
  "image/webp": { sourceTypes: ["image", "screenshot"], ext: "webp", max: 15 * 1024 * 1024 },
  "application/pdf": { sourceTypes: ["pdf"], ext: "pdf", max: 15 * 1024 * 1024 },
  "application/msword": { sourceTypes: ["word"], ext: "doc", max: 15 * 1024 * 1024 },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { sourceTypes: ["word"], ext: "docx", max: 15 * 1024 * 1024 },
  "application/vnd.ms-excel": { sourceTypes: ["excel"], ext: "xls", max: 15 * 1024 * 1024 },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { sourceTypes: ["excel"], ext: "xlsx", max: 15 * 1024 * 1024 },
  "audio/mpeg": { sourceTypes: ["audio"], ext: "mp3", max: 15 * 1024 * 1024 },
  "audio/mp4": { sourceTypes: ["audio"], ext: "m4a", max: 15 * 1024 * 1024 },
  "audio/wav": { sourceTypes: ["audio"], ext: "wav", max: 15 * 1024 * 1024 },
  "audio/ogg": { sourceTypes: ["audio"], ext: "ogg", max: 15 * 1024 * 1024 },
  "audio/webm": { sourceTypes: ["audio"], ext: "webm", max: 15 * 1024 * 1024 }
});

export function normalizeOpportunitySourceType(value) {
  const sourceType = cleanText(value, 20).toLowerCase();
  return ["image", "screenshot", "pdf", "word", "excel", "audio"].includes(sourceType) ? sourceType : "";
}

async function uploadOpportunitySourceMedia(request, env, requestId) {
  const bucket = requireMediaBucket(env);
  const officeId = firestoreOfficeId(request.headers.get("x-office-id"));
  const sourceId = cleanText(request.headers.get("x-source-id"), 80).replace(/[^a-zA-Z0-9_-]/g, "");
  const sourceType = normalizeOpportunitySourceType(request.headers.get("x-source-type"));
  const fileNameHeader = cleanText(decodeURIComponent(request.headers.get("x-file-name") || ""), 240);
  const contentType = cleanText(request.headers.get("content-type"), 120).toLowerCase();
  const size = requestBodyLength(request);

  if (!officeId || sourceId.length < 8) throw appError("invalid_media_target", 400, "وجهة الملف غير صالحة");
  if (!sourceType) throw appError("unsupported_source_type", 400, "نوع مصدر المرفق غير مدعوم");

  await authorizeOfficeRequest(request, env, officeId, "member");

  const rule = OPPORTUNITY_SOURCE_TYPES[contentType];
  if (!rule || !rule.sourceTypes.includes(sourceType)) {
    throw appError("unsupported_media", 415, "نوع الملف غير مدعوم لمصدر الفرصة");
  }
  if (size > rule.max) throw appError("file_too_large", 413, "حجم الملف يتجاوز الحد المسموح");

  const safeName = fileNameHeader.replace(/[^a-zA-Z0-9._\u0600-\u06FF-]+/g, "_").slice(0, 80) || `source.${rule.ext}`;
  const key = `opportunity-sources/${officeId}/${sourceId}/${safeName}`;
  await bucket.put(key, request.body, {
    httpMetadata: { contentType },
    customMetadata: {
      officeId,
      sourceId,
      sourceType,
      uploadedAt: new Date().toISOString(),
      extractionMode: "simulated_fixture"
    }
  });
  return jsonResponse({
    ok: true,
    mediaPath: key,
    sourceType,
    extractionMode: "simulated_fixture",
    productionAi: false,
    requestId
  }, 201);
}

// متغيّرات هوية المكتب البصرية. الترويسة تبقى "cover" لتوافق الروابط المنشورة سابقًا.
export const OFFICE_IMAGE_VARIANTS = Object.freeze(["cover", "logo", "display"]);

export function normalizeOfficeImageVariant(value) {
  const variant = cleanText(value, 20).toLowerCase();
  if (!variant) return "cover";
  return OFFICE_IMAGE_VARIANTS.includes(variant) ? variant : "";
}

function officeImageKey(officeId, variant) {
  return `office-covers/${officeId}/${variant}`;
}

async function resolveOfficeImageTarget(request, env) {
  const officeId = firestoreOfficeId(request.headers.get("x-office-id"));
  if (!officeId) throw appError("office_id_required", 400, "officeId مطلوب");
  const variant = normalizeOfficeImageVariant(request.headers.get("x-office-image-variant"));
  if (!variant) throw appError("unsupported_image_variant", 400, "نوع صورة المكتب غير مدعوم");
  await authorizeOfficeRequest(request, env, officeId, "manage");
  return { officeId, variant, key: officeImageKey(officeId, variant) };
}

async function uploadOfficeImage(request, env, requestId) {
  const bucket = requireMediaBucket(env);
  const { officeId, variant, key } = await resolveOfficeImageTarget(request, env);
  const contentType = cleanText(request.headers.get("content-type"), 80).toLowerCase();
  const size = requestBodyLength(request);
  if (!PUBLIC_IMAGE_TYPES[contentType]) throw appError("unsupported_media", 415, "اختر صورة JPG أو PNG أو WebP");
  if (size > 10 * 1024 * 1024) throw appError("image_too_large", 413, "حجم صورة المكتب يتجاوز 10 ميجابايت");
  await bucket.put(key, request.body, {
    httpMetadata: { contentType, cacheControl: "public, max-age=3600" },
    customMetadata: { officeId, variant, uploadedAt: new Date().toISOString() }
  });
  const origin = new URL(request.url).origin;
  const imageUrl = `${origin}/media/public/${key}?v=${Date.now()}`;
  // coverUrl محفوظ للتوافق مع أي عميل قديم يقرأ الاسم السابق.
  return jsonResponse({ ok: true, variant, imageUrl, coverUrl: imageUrl, requestId }, 201);
}

async function deleteOfficeImage(request, env, requestId) {
  const bucket = requireMediaBucket(env);
  const { variant, key } = await resolveOfficeImageTarget(request, env);
  if (variant === "cover") {
    throw appError("image_not_removable", 400, "الترويسة مطلوبة لبطاقة المكتب ولا يمكن إزالتها");
  }
  await bucket.delete(key);
  return jsonResponse({ ok: true, variant, removed: true, requestId });
}

async function servePublicOfficeCover(url, env) {
  const bucket = requireMediaBucket(env);
  const key = decodeURIComponent(url.pathname.slice("/media/public/".length));
  if (!/^office-covers\/[a-z0-9_-]{1,80}\/(cover|logo|display)$/.test(key)) {
    throw appError("media_not_found", 404, "الصورة غير موجودة");
  }
  const object = await bucket.get(key);
  if (!object) throw appError("media_not_found", 404, "الصورة غير موجودة");
  const headers = new Headers(corsHeaders());
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=3600");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}

const OFFICE_MEDIA_KEY_PATTERN = /^(?:public-intake|office-library|opportunity-sources)\/[a-z0-9_-]{1,80}\//i;

async function serveOfficeMedia(request, env, requestId) {
  const bucket = requireMediaBucket(env);
  const url = new URL(request.url);
  const officeId = firestoreOfficeId(url.searchParams.get("officeId") || request.headers.get("x-office-id"));
  const mediaPath = cleanText(url.searchParams.get("path"), 500);
  if (!officeId || !mediaPath) throw appError("media_path_required", 400, "مسار الوسائط مطلوب");
  if (!OFFICE_MEDIA_KEY_PATTERN.test(mediaPath) || !mediaPath.includes(`/${officeId}/`)) {
    throw appError("media_forbidden", 403, "مسار الوسائط غير مسموح");
  }
  await authorizeOfficeRequest(request, env, officeId, "member");
  const object = await bucket.get(mediaPath);
  if (!object) throw appError("media_not_found", 404, "الملف غير موجود");
  const headers = new Headers(corsHeaders());
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=300");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}

const OFFICE_LIBRARY_TYPES = Object.freeze({
  "application/pdf": { ext: "pdf", max: 15 * 1024 * 1024 },
  "image/jpeg": { ext: "jpg", max: 8 * 1024 * 1024 },
  "image/png": { ext: "png", max: 8 * 1024 * 1024 },
  "image/webp": { ext: "webp", max: 8 * 1024 * 1024 },
  "application/msword": { ext: "doc", max: 15 * 1024 * 1024 },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", max: 15 * 1024 * 1024 }
});

async function uploadOfficeLibraryMedia(request, env, requestId) {
  const bucket = requireMediaBucket(env);
  const officeId = firestoreOfficeId(request.headers.get("x-office-id"));
  let fileNameRaw = cleanText(request.headers.get("x-file-name"), 240) || "file";
  try {
    fileNameRaw = decodeURIComponent(fileNameRaw);
  } catch (_) { /* keep raw */ }
  const fileName = cleanText(fileNameRaw, 240) || "file";
  let contentType = cleanText(request.headers.get("content-type"), 80).toLowerCase().split(";")[0].trim();
  if (!contentType || contentType === "application/octet-stream") {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".pdf")) contentType = "application/pdf";
    else if (lower.endsWith(".png")) contentType = "image/png";
    else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) contentType = "image/jpeg";
    else if (lower.endsWith(".webp")) contentType = "image/webp";
    else if (lower.endsWith(".doc")) contentType = "application/msword";
    else if (lower.endsWith(".docx")) {
      contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
  }
  const size = requestBodyLength(request);
  if (!officeId) throw appError("office_id_required", 400, "تعذر تحديد المكتب");
  await authorizeOfficeRequest(request, env, officeId, "member");
  const spec = OFFICE_LIBRARY_TYPES[contentType];
  if (!spec) throw appError("unsupported_media", 415, "نوع الملف غير مدعوم في المكتبة");
  if (size > spec.max) throw appError("file_too_large", 413, "حجم الملف يتجاوز الحد المسموح");
  const safeName = fileName.replace(/[^a-zA-Z0-9._\u0600-\u06FF-]+/g, "-").slice(0, 80) || `file.${spec.ext}`;
  const itemId = `lib_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const key = `office-library/${officeId}/${itemId}/${safeName}`;
  await bucket.put(key, request.body, {
    httpMetadata: { contentType },
    customMetadata: { officeId, itemId, uploadedAt: new Date().toISOString() }
  });
  return jsonResponse({ ok: true, mediaPath: key, itemId, fileName: safeName, contentType, requestId }, 201);
}

function evaluatePublicIntakeReadiness(intake = {}, parsed = {}) {
  const missing = [];
  const isOwner = intake.kind === "owner";
  const purpose = isOwner
    ? (String(parsed.transactionType || intake.transactionType || "sale").toLowerCase() === "rent" ? "RENT" : "SALE")
    : (String(parsed.transactionType || intake.transactionType || "").toLowerCase() === "rent" ? "LEASE_REQUEST" : "PURCHASE");
  if (!purpose) missing.push("purpose");
  if (!cleanText(intake.propertyType || parsed.propertyType, 80)) missing.push("propertyType");
  if (!cleanText(intake.city || parsed.city, 80)) missing.push("city");
  if (!cleanText(intake.district || parsed.district, 80)) missing.push("district");
  const amount = Number(intake.amount || parsed.price || parsed.priceMax || 0);
  if (!(amount > 0)) missing.push("priceOrBudget");
  if (!isOwner && intake.kind !== "client") missing.push("advertiserRole");
  const phone = normalizeSaudiPhone(intake.phone || parsed.phone);
  if (!phone) missing.push("contactPhone");
  const roleOk = isOwner ? "OWNER" : "CLIENT";
  if (!roleOk) missing.push("advertiserRole");
  return {
    matchingReadiness: missing.length === 0 ? "READY_FOR_MATCHING" : "NEEDS_COMPLETION",
    matchingReadinessMissing: missing,
    advertiserRole: roleOk,
    purpose
  };
}

function firestoreStringArray(values = []) {
  const items = (Array.isArray(values) ? values : []).map((value) => cleanText(value, 500)).filter(Boolean).slice(0, 12);
  return { arrayValue: { values: items.map((value) => ({ stringValue: value })) } };
}

async function handleBrokerApplication(request, env, requestId) {
  assertFirebaseSecrets(env);
  const identity = await requirePlatformIdentity(request, env, false);
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  try {
    await assertPilotRegistrationAllowed(pilotAccessDeps(projectId, accessToken));
  } catch (error) {
    throw appError(error.code || "pilot_registration_closed", error.status || 403, error.message);
  }
  const body = await request.json().catch(() => ({}));
  const brokerName = cleanText(body.brokerName, 80);
  const phone = normalizeLoginPhone(body.phone);
  const email = cleanText(body.email, 120).toLowerCase();
  const falLicense = cleanText(body.falLicense, 20).replace(/\D/g, "");
  const officeName = cleanText(body.officeName, 80);
  if (brokerName.length < 4 || !phone ||
      !email.includes("@") || falLicense.length < 6 || officeName.length < 4) {
    throw appError("invalid_broker_application", 400, "بيانات طلب الوسيط غير مكتملة");
  }
  if (!/^\d{6,20}$/.test(falLicense)) {
    throw appError("fal_invalid", 400, "رقم رخصة فال غير صالح");
  }
  const phoneHash = await sha256Hex(phone);
  const loginDirectory = await getFirestoreDocument({
    projectId,
    segments: ["loginDirectory", phoneHash],
    accessToken,
    allowMissing: true
  });
  if (loginDirectory) {
    const existingLogin = firestoreFieldsToJs(loginDirectory.fields || {});
    if (existingLogin.uid && existingLogin.uid !== identity.sub) {
      throw appError("phone_already_used", 409, "رقم الجوال مستخدم مسبقًا");
    }
  }
  const pendingApps = await listCollectionDocuments({
    projectId,
    segments: ["brokerApplications"],
    accessToken,
    pageSize: 200
  });
  for (const doc of pendingApps) {
    const row = firestoreFieldsToJs(doc.fields || {});
    if (row.status !== "pending") continue;
    if (String(row.email || "").toLowerCase() === email) {
      throw appError("email_already_used", 409, "البريد مستخدم في طلب قائم");
    }
    if (String(row.falLicense || "").replace(/\D/g, "") === falLicense) {
      throw appError("fal_already_used", 409, "رقم فال مستخدم في طلب قائم");
    }
    if (normalizeLoginPhone(row.phone) === phone) {
      throw appError("phone_already_used", 409, "رقم الجوال مستخدم في طلب قائم");
    }
  }
  const applicationId = `broker_${Date.now()}_${crypto.randomUUID().slice(0, 10)}`;
  const now = new Date();
  await setFirestoreDocument({
    projectId,
    segments: ["brokerApplications", applicationId],
    accessToken,
    fields: {
      brokerName: firestoreString(brokerName),
      phone: firestoreString(phone),
      email: firestoreString(email),
      falLicense: firestoreString(falLicense),
      officeName: firestoreString(officeName),
      status: firestoreString("pending"),
      source: firestoreString("platform_broker_registration"),
      applicantUid: firestoreString(identity.sub),
      createdAt: firestoreTimestamp(now),
      updatedAt: firestoreTimestamp(now)
    }
  });
  await setFirestoreDocument({
    projectId,
    segments: ["offices", "platform", "alerts", applicationId],
    accessToken,
    fields: {
      officeId: firestoreString("platform"),
      type: firestoreString("broker_application"),
      status: firestoreString("unread"),
      title: firestoreString("طلب تسجيل وسيط جديد"),
      body: firestoreString(`${brokerName} — رخصة فال ${falLicense}`),
      recordId: firestoreString(applicationId),
      createdAt: firestoreTimestamp(now),
      updatedAt: firestoreTimestamp(now)
    }
  });
  await sendOfficePush({
    projectId,
    officeId: "platform",
    title: "طلب تسجيل وسيط جديد",
    body: `${brokerName} — رخصة فال ${falLicense}`,
    type: "broker_application",
    recordId: applicationId,
    accessToken,
    env
  }).catch(error => console.warn("[iaqar-broker] admin push failed", error && error.message));
  return jsonResponse({ ok: true, applicationId, status: "pending", requestId }, 201);
}

async function requirePlatformIdentity(request, env, requireAdmin = true) {
  const header = cleanText(request.headers.get("Authorization"), 5000);
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw appError("auth_required", 401, "يلزم تسجيل الدخول");
  const claims = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID);
  if (requireAdmin && claims.platformAdmin !== true && claims.admin !== true) {
    throw appError("admin_required", 403, "هذه العملية خاصة بإدارة المنصة");
  }
  return claims;
}

async function listBrokerApplications(request, env, requestId) {
  assertFirebaseSecrets(env);
  await requirePlatformIdentity(request, env, true);
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const docs = await listCollectionDocuments({ projectId, segments: ["brokerApplications"], accessToken, pageSize: 100 });
  const applications = docs.map(doc => {
    const data = firestoreFieldsToJs(doc.fields || {});
    return { id: String(doc.name || "").split("/").pop(), ...data };
  }).filter(item => item.status === "pending");
  return jsonResponse({ ok: true, applications, requestId });
}

async function decideBrokerApplication(request, env, requestId) {
  assertFirebaseSecrets(env);
  const admin = await requirePlatformIdentity(request, env, true);
  const body = await request.json().catch(() => ({}));
  const applicationId = cleanText(body.applicationId, 120);
  const action = cleanText(body.action, 20);
  const officeId = firestoreOfficeId(body.officeId);
  if (!applicationId || !["approve", "reject"].includes(action)) {
    throw appError("decision_invalid", 400, "قرار الطلب غير صالح");
  }
  if (action === "approve" && (!officeId || officeId === "platform")) {
    throw appError("office_id_invalid", 400, "رمز المكتب غير صالح");
  }
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const applicationDoc = await getFirestoreDocument({
    projectId, segments: ["brokerApp…57013 tokens truncated…n, env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID);
  const isPlatformAdmin = claims.platformAdmin === true || claims.admin === true;
  if (isPlatformAdmin) {
    return { uid: claims.sub, claims, role: "platformAdmin", permission };
  }
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  try {
    await assertPilotOfficeAccess(pilotAccessDeps(projectId, accessToken), { officeId, isPlatformAdmin: false });
  } catch (error) {
    throw appError(error.code || "pilot_access_denied", error.status || 403, error.message);
  }
  const officeDoc = await getFirestoreDocument({ projectId, segments:["offices",officeId], accessToken, allowMissing:true });
  if (!officeDoc) throw appError("office_not_found",404,"المكتب غير موجود");
  const office = firestoreFieldsToJs(officeDoc.fields || {});
  const isOwner = office.ownerUid === claims.sub;
  const memberDoc = await getFirestoreDocument({ projectId, segments:["offices",officeId,"members",claims.sub], accessToken, allowMissing:true });
  const member = memberDoc ? firestoreFieldsToJs(memberDoc.fields || {}) : {};
  const isActiveMember = Boolean(memberDoc) && member.active !== false;
  const role = String(member.role || "");
  const isManager = isOwner || (isActiveMember && ["owner","admin","manager"].includes(role));
  const canUseOffice = isOwner || isActiveMember;
  const canManageIntegration = isManager || (isActiveMember && member.canManageIntegrations === true);
  const allowed = permission === "member" ? canUseOffice : permission === "integration" ? canManageIntegration : isManager;
  if (!allowed) {
    const message = permission === "member" ? "حسابك غير مرتبط بهذا المكتب" : "ليس لديك الصلاحية المطلوبة في هذا المكتب";
    throw appError("office_forbidden",403,message);
  }
  return { uid: claims.sub, claims, role: isOwner ? "owner" : role, permission };
}

let googleJwksCache = { expiresAt:0, keys:[] };
async function verifyFirebaseIdToken(token, projectId) {
  const parts=String(token||"").split(".");
  if(parts.length!==3) throw appError("invalid_auth_token",401,"جلسة الدخول غير صالحة");
  const header=JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
  const claims=JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
  const now=Math.floor(Date.now()/1000);
  if(claims.aud!==projectId || claims.iss!==`https://securetoken.google.com/${projectId}` || !claims.sub || claims.exp<=now) throw appError("invalid_auth_token",401,"جلسة الدخول منتهية أو غير صالحة");
  if(googleJwksCache.expiresAt<now){
    const r=await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
    if(!r.ok) throw appError("auth_verification_failed",502,"تعذر التحقق من جلسة المكتب");
    googleJwksCache={expiresAt:now+3600,keys:(await r.json()).keys||[]};
  }
  const jwk=googleJwksCache.keys.find(k=>k.kid===header.kid);
  if(!jwk) throw appError("invalid_auth_token",401,"تعذر التحقق من جلسة المكتب");
  const key=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const ok=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,base64UrlDecode(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if(!ok) throw appError("invalid_auth_token",401,"توقيع جلسة المكتب غير صحيح");
  return claims;
}
function base64UrlDecode(value){ const s=value.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((value.length+3)%4); const b=atob(s); return Uint8Array.from(b,c=>c.charCodeAt(0)); }

async function incrementUsage({ projectId, officeId, accessToken }) {
  const dayId = utcDayId(new Date());
  const document = `projects/${projectId}/databases/(default)/documents/offices/${officeId}/usage/whatsapp_${dayId}`;
  const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:commit`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      writes: [{
        transform: {
          document,
          fieldTransforms: [
            { fieldPath: "inboundMessages", increment: { integerValue: "1" } },
            { fieldPath: "estimatedWrites", increment: { integerValue: String(ESTIMATED_WRITES_PER_MESSAGE) } },
            { fieldPath: "updatedAt", setToServerValue: "REQUEST_TIME" }
          ]
        }
      }]
    })
  });
  if (!response.ok) console.warn("[iaqar-whatsapp] usage counter failed", response.status);
}

async function getFirestoreDocument({ projectId, segments, accessToken, allowMissing = false }) {
  const url = firestoreDocumentUrl(projectId, segments);
  const headers = { Authorization: `Bearer ${accessToken}` };
  const response = await fetch(url, { headers });
  if (response.status === 404 && allowMissing) return null;
  if (response.ok) return response.json();
  // Staging Spark GetDocument quota can exhaust while writes still succeed.
  // A masked no-op PATCH returns the current document without creating missing ones.
  if (response.status === 429) {
    const echoed = await echoFirestoreDocument({ url, headers, allowMissing });
    if (echoed !== undefined) return echoed;
  }
  throw appError("firestore_read_failed", 502, "تعذر قراءة حالة الربط");
}

async function echoFirestoreDocument({ url, headers, allowMissing }) {
  const echoUrl = new URL(url);
  echoUrl.searchParams.set("currentDocument.exists", "true");
  echoUrl.searchParams.append("updateMask.fieldPaths", "iaqarReadEcho");
  const echo = await fetch(echoUrl.toString(), {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { iaqarReadEcho: { integerValue: "1" } } })
  });
  if (echo.ok) return echo.json();
  const detail = await echo.text().catch(() => "");
  const missing = echo.status === 404
    || echo.status === 400
    || echo.status === 409
    || /NOT_FOUND|FAILED_PRECONDITION/.test(detail);
  if (allowMissing && missing) return null;
  return undefined;
}

async function setFirestoreDocument({ projectId, segments, accessToken, fields }) {
  const compacted = compactFields(fields);
  const endpoint = new URL(firestoreDocumentUrl(projectId, segments));
  for (const fieldPath of Object.keys(compacted)) {
    endpoint.searchParams.append("updateMask.fieldPaths", fieldPath);
  }
  const response = await fetch(endpoint.toString(), {
    method: "PATCH",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: compacted })
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error("[iaqar-whatsapp] Firestore set failed", response.status, detail);
    throw appError("firestore_write_failed", 502, "تعذر حفظ ربط واتساب");
  }
  return response.json();
}

async function patchFirestoreDocument({ projectId, segments, accessToken, fields, updateTime = "" }) {
  const compacted = compactFields(fields);
  const endpoint = new URL(firestoreDocumentUrl(projectId, segments));
  for (const fieldPath of Object.keys(compacted)) {
    endpoint.searchParams.append("updateMask.fieldPaths", fieldPath);
  }
  if (updateTime) endpoint.searchParams.set("currentDocument.updateTime", updateTime);
  const response = await fetch(endpoint.toString(), {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: compacted })
  });
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 400 || response.status === 409) {
      throw appError("firestore_precondition_failed", 409, detail || "تعذر تثبيت الاستلام");
    }
    console.error("[iaqar-whatsapp] Firestore patch failed", response.status, detail);
    throw appError("firestore_write_failed", 502, "تعذر حفظ الحالة");
  }
  return response.json();
}

function partySessionHelpers() {
  return {
    authorizeOfficeRequest,
    assertFirebaseSecrets,
    getGoogleAccessToken,
    getFirestoreDocument,
    setFirestoreDocument,
    listCollectionDocuments,
    firestoreFieldsToJs,
    firestoreString,
    firestoreTimestamp,
    firestoreBoolean,
    firestoreInteger,
    jsToFirestoreValue,
    firestoreOfficeId,
    officeAuthorizationKey,
    officeIdsEquivalent,
    cleanText,
    appError,
    jsonResponse,
    DEFAULT_PROJECT_ID,
    sha256Hex,
    consumePublicRateLimit,
    publicRateLimitKey,
    PUBLIC_RATE_LIMITS
  };
}

function getAdminHelpers() {
  return createAdminHelpers({
    assertFirebaseSecrets,
    requirePlatformIdentity,
    getGoogleAccessToken,
    getFirestoreDocument,
    setFirestoreDocument,
    firestoreFieldsToJs,
    firestoreString,
    firestoreTimestamp,
    firestoreDocumentUrl,
    cleanText,
    firestoreOfficeId,
    officeAuthorizationKey,
    officeIdsEquivalent,
    appError,
    jsonResponse,
    DEFAULT_PROJECT_ID
  });
}

function firestoreDocumentUrl(projectId, segments) {
  const path = segments.map(segment => encodeURIComponent(String(segment))).join("/");
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${path}`;
}

function firestoreValueToJs(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) {
    const values = Array.isArray(value.arrayValue?.values) ? value.arrayValue.values : [];
    return values.map((item) => firestoreValueToJs(item));
  }
  if ("mapValue" in value) {
    return firestoreFieldsToJs(value.mapValue?.fields || {});
  }
  return null;
}

function firestoreFieldsToJs(fields) {
  const output = {};
  for (const [key, value] of Object.entries(fields || {})) {
    output[key] = firestoreValueToJs(value);
  }
  return output;
}

async function deleteFirestoreDocument({ projectId, segments, accessToken }) {
  const response = await fetch(firestoreDocumentUrl(projectId, segments), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (response.status === 404) return false;
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw appError("firestore_delete_failed", 502, detail || "تعذر حذف المستند");
  }
  return true;
}


function extractMessageText(message) {
  if (!message || typeof message !== "object") return "";
  if (message.text && message.text.body) return cleanText(message.text.body, 12000);
  if (message.image && message.image.caption) return cleanText(message.image.caption, 12000);
  if (message.video && message.video.caption) return cleanText(message.video.caption, 12000);
  if (message.document && message.document.caption) return cleanText(message.document.caption, 12000);
  if (message.button && message.button.text) return cleanText(message.button.text, 12000);
  if (message.interactive && message.interactive.button_reply) return cleanText(message.interactive.button_reply.title, 12000);
  if (message.interactive && message.interactive.list_reply) return cleanText(message.interactive.list_reply.title, 12000);
  if (message.location) return `موقع: ${message.location.latitude}, ${message.location.longitude}`;
  return `[رسالة ${cleanText(message.type, 50) || "غير نصية"}]`;
}

function parseWhatsAppTimestamp(value) {
  const seconds = Number(value || 0);
  const date = seconds > 0 ? new Date(seconds * 1000) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function verifyHmacSignature(rawBody, suppliedSignature, secret) {
  if (!suppliedSignature.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = `sha256=${bytesToHex(new Uint8Array(signature))}`;
  return constantTimeEqual(expected, suppliedSignature);
}

function firebaseServiceAccount(env = {}) {
  return {
    clientEmail: String(env.FIREBASE_CLIENT_EMAIL || "").replace(/\u0000/g, "").trim(),
    privateKey: String(env.FIREBASE_PRIVATE_KEY || "").replace(/\u0000/g, "").trim(),
    privateKeyId: String(env.FIREBASE_PRIVATE_KEY_ID || "").replace(/\u0000/g, "").trim()
  };
}

function hasFirebaseSecrets(env) {
  const { clientEmail, privateKey } = firebaseServiceAccount(env);
  return Boolean(clientEmail && privateKey);
}

function assertFirebaseSecrets(env) {
  if (!hasFirebaseSecrets(env)) throw appError("firebase_not_configured", 500, "إعداد Firebase في الخادم غير مكتمل");
}

function assertMetaWebhookSecrets(env) {
  if (!env.META_APP_SECRET || !env.META_WEBHOOK_VERIFY_TOKEN) {
    throw appError("meta_not_configured", 503, "إعداد Webhook الخاص بـMeta غير مكتمل");
  }
}

async function getGoogleAccessToken(env) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (cachedGoogleToken && cachedGoogleToken.expiresAt > nowSeconds + 90) return cachedGoogleToken.accessToken;

  const { clientEmail, privateKey, privateKeyId } = firebaseServiceAccount(env);
  const assertion = await createServiceAccountJwt({
    clientEmail,
    privateKey,
    privateKeyId,
    nowSeconds
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  const responseText = await response.text();
  if (!response.ok) {
    let googleError = {};
    try { googleError = JSON.parse(responseText); } catch (_) { googleError = {}; }
    console.error("[iaqar-firebase] Google token request rejected", {
      status: response.status,
      error: cleanText(googleError.error, 80),
      description: cleanText(googleError.error_description, 240)
    });
    throw appError("google_auth_failed", 502, "تعذر مصادقة الخادم مع Firebase");
  }
  const token = JSON.parse(responseText);
  cachedGoogleToken = { accessToken: token.access_token, expiresAt: nowSeconds + Number(token.expires_in || 3600) };
  return cachedGoogleToken.accessToken;
}

async function createServiceAccountJwt({ clientEmail, privateKey, privateKeyId, nowSeconds }) {
  clientEmail = String(clientEmail || "").replace(/\u0000/g, "").trim();
  privateKey = String(privateKey || "").replace(/\u0000/g, "").trim();
  privateKeyId = String(privateKeyId || "").replace(/\u0000/g, "").trim();
  if (!clientEmail || !privateKey) throw appError("firebase_not_configured", 500, "إعداد Firebase في الخادم غير مكتمل");
  const header = privateKeyId
    ? { alg: "RS256", typ: "JWT", kid: privateKeyId }
    : { alg: "RS256", typ: "JWT" };
  const claims = { iss: clientEmail, scope: GOOGLE_SCOPE, aud: GOOGLE_TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64UrlBytes(new Uint8Array(signature))}`;
}

async function createFirebaseCustomToken({ clientEmail, privateKey, privateKeyId, uid, officeId }) {
  clientEmail = String(clientEmail || "").replace(/\u0000/g, "").trim();
  privateKey = String(privateKey || "").replace(/\u0000/g, "").trim();
  privateKeyId = String(privateKeyId || "").replace(/\u0000/g, "").trim();
  if (!clientEmail || !privateKey) throw appError("firebase_not_configured", 500, "إعداد Firebase في الخادم غير مكتمل");
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = privateKeyId
    ? { alg: "RS256", typ: "JWT", kid: privateKeyId }
    : { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: clientEmail,
    sub: clientEmail,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: nowSeconds,
    exp: nowSeconds + 3600,
    uid: cleanText(uid, 128),
    claims: { officeId: firestoreOfficeId(officeId), officeMember: true }
  };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToArrayBuffer(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64UrlBytes(new Uint8Array(signature))}`;
}

function pemToArrayBuffer(pem) {
  const base64 = String(pem || "").replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!base64) throw appError("configuration_error", 500, "مفتاح Firebase غير صالح");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return bytesToHex(new Uint8Array(digest));
}

function base64UrlJson(value) { return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value))); }
function base64UrlBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function bytesToHex(bytes) { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }

function normalizeLoginPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = digits.slice(2);
  if (digits.startsWith("966")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return /^5\d{8}$/.test(digits) ? `+966${digits}` : "";
}
function legacyLocalLoginPhone(value) {
  const phone = normalizeLoginPhone(value);
  return phone ? `0${phone.slice(4)}` : "";
}
async function resolveLoginDirectory({ projectId, phone, accessToken }) {
  const canonicalHash = await sha256Hex(phone);
  const canonicalDoc = await getFirestoreDocument({
    projectId, segments: ["loginDirectory", canonicalHash], accessToken, allowMissing: true
  });
  if (canonicalDoc) return { directoryDoc: canonicalDoc, phoneHash: canonicalHash, migratedLegacy: false };

  const legacyPhone = legacyLocalLoginPhone(phone);
  const legacyHash = legacyPhone ? await sha256Hex(legacyPhone) : "";
  if (!legacyHash || legacyHash === canonicalHash) {
    return { directoryDoc: null, phoneHash: canonicalHash, migratedLegacy: false };
  }
  const legacyDoc = await getFirestoreDocument({
    projectId, segments: ["loginDirectory", legacyHash], accessToken, allowMissing: true
  });
  if (!legacyDoc) return { directoryDoc: null, phoneHash: canonicalHash, migratedLegacy: false };

  const legacyDirectory = firestoreFieldsToJs(legacyDoc.fields || {});
  if (legacyDirectory.uid && legacyDirectory.officeId && legacyDirectory.email) {
    try {
      await setFirestoreDocument({
        projectId, segments: ["loginDirectory", canonicalHash], accessToken,
        fields: {
          uid: firestoreString(legacyDirectory.uid),
          officeId: firestoreString(legacyDirectory.officeId),
          email: firestoreString(String(legacyDirectory.email).toLowerCase()),
          phone: firestoreString(phone),
          active: firestoreBoolean(legacyDirectory.active === true),
          migratedFromLegacy: firestoreBoolean(true),
          updatedAt: firestoreTimestamp(new Date())
        }
      });
    } catch (error) {
      console.warn("[iaqar] legacy phone directory migration deferred", error && error.message);
    }
  }
  return { directoryDoc: legacyDoc, phoneHash: canonicalHash, migratedLegacy: true };
}
function maskEmail(value) {
  const email = String(value || "");
  const at = email.indexOf("@");
  if (at < 1) return "البريد المسجل";
  const name = email.slice(0, at);
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${"*".repeat(Math.max(3, name.length - visible.length))}${email.slice(at)}`;
}
function cleanText(value, maxLength) { return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, maxLength); }

const LISTING_FETCH_MAX_BYTES = 2 * 1024 * 1024;
const LISTING_FETCH_TIMEOUT_MS = 15000;
const LISTING_FETCH_MAX_REDIRECTS = 4;

function isPrivateOrLocalHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "0.0.0.0") return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const parts = ipv4.slice(1).map((n) => Number(n));
  if (parts.some((n) => n > 255)) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

function normalizeListingFetchUrl(raw) {
  const text = cleanText(raw, 2000);
  if (!text) return "";
  if (/^file:/i.test(text)) return "";
  try {
    const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    if (isPrivateOrLocalHost(parsed.hostname)) return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
}

const LISTING_JSON_LD_TYPES = new Set([
  "product",
  "offer",
  "residence",
  "realestatelisting",
  "house",
  "apartment",
  "singlefamilyresidence",
  "accommodation"
]);

function collectJsonLdNodes(parsed) {
  if (!parsed || typeof parsed !== "object") return [];
  if (Array.isArray(parsed)) return parsed.flatMap((item) => collectJsonLdNodes(item));
  if (Array.isArray(parsed["@graph"])) return parsed["@graph"].flatMap((item) => collectJsonLdNodes(item));
  return [parsed];
}

function jsonLdNodeTypes(node = {}) {
  const raw = node["@type"];
  if (Array.isArray(raw)) return raw.map((value) => String(value || "").toLowerCase());
  return [String(raw || "").toLowerCase()];
}

function isListingJsonLdNode(node = {}) {
  const types = jsonLdNodeTypes(node);
  return types.some((type) => LISTING_JSON_LD_TYPES.has(type.replace(/\s+/g, "")));
}

function extractJsonLdAddressChunks(address) {
  const chunks = [];
  if (!address) return chunks;
  if (typeof address === "string") {
    const value = cleanText(address, 12000);
    if (value) chunks.push(value);
    return chunks;
  }
  if (Array.isArray(address)) {
    for (const item of address) chunks.push(...extractJsonLdAddressChunks(item));
    return chunks;
  }
  if (typeof address === "object") {
    for (const key of ["streetAddress", "addressLocality", "addressRegion", "postalCode"]) {
      const value = cleanText(address[key], 12000);
      if (value) chunks.push(value);
    }
  }
  return chunks;
}

function extractJsonLdListingText(html) {
  const chunks = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const nodes = collectJsonLdNodes(parsed);
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const listingNode = isListingJsonLdNode(node);
        const keys = listingNode
          ? ["description", "name", "headline", "articleBody", "numberOfRooms", "floorSize"]
          : ["description", "name", "headline"];
        for (const key of keys) {
          const value = cleanText(node[key], 12000);
          if (value) chunks.push(value);
        }
        chunks.push(...extractJsonLdAddressChunks(node.address));
        const offers = node.offers;
        if (offers) {
          const offerList = Array.isArray(offers) ? offers : [offers];
          for (const offer of offerList) {
            if (!offer || typeof offer !== "object") continue;
            const price = offer.price ?? offer.lowPrice ?? offer.highPrice;
            if (price != null && String(price).trim()) chunks.push(String(price));
            const offerDesc = cleanText(offer.description || offer.name, 12000);
            if (offerDesc) chunks.push(offerDesc);
          }
        }
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  return chunks.join("\n").trim();
}

function resolveListingSourceSite(url = "") {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const labels = {
      "haraj.com.sa": "حراج",
      "sa.aqar.fm": "عقار",
      "aqar.fm": "عقار",
      "bayut.sa": "بيوت",
      "propertyfinder.sa": "بروبرتي فايندر"
    };
    if (labels[host]) return labels[host];
    if (host.includes("haraj")) return "حراج";
    if (host.includes("aqar")) return "عقار";
    if (host.includes("bayut")) return "بيوت";
    if (host.includes("propertyfinder")) return "بروبرتي فايندر";
    return "الموقع";
  } catch {
    return "الموقع";
  }
}

function extractListingTextFromHtml(html) {
  let source = String(html || "");
  const jsonLd = extractJsonLdListingText(source);
  source = source.replace(/<script[\s\S]*?<\/script>/gi, " ");
  source = source.replace(/<style[\s\S]*?<\/style>/gi, " ");
  source = source.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const titleMatch = source.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, " ")) : "";
  const metaChunks = [];
  for (const re of [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/gi
  ]) {
    let m;
    while ((m = re.exec(source))) metaChunks.push(decodeHtmlEntities(m[1]));
  }
  const bodyText = decodeHtmlEntities(source.replace(/<[^>]+>/g, " "));
  const combined = [jsonLd, title, metaChunks.join("\n"), bodyText]
    .map((part) => cleanText(part, 12000))
    .filter(Boolean)
    .join("\n");
  return cleanText(combined.replace(/\s+/g, " "), 12000);
}

function isListingFetchBlockedText(text) {
  const sample = cleanText(text, 4000);
  if (/You have been blocked|تم حظرك|لا يمكنك الوصول للموقع|حمايتها من الهجمات/i.test(sample)) {
    return true;
  }
  // Haraj (and similar) login/shell pages without a concrete listing body.
  if (/حراج|haraj/i.test(sample)
    && /دخــــول|تسجيل حساب|اتفاقية الاستخدام|سياسة الخصوصية/i.test(sample)
    && !/(للبيع|للإيجار|السعر|المساحة|حي\s+\S+)/i.test(sample)) {
    return true;
  }
  return false;
}

async function fetchListingPage(url, redirectCount = 0) {
  if (redirectCount > LISTING_FETCH_MAX_REDIRECTS) {
    return { ok: false, error: "too_many_redirects" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LISTING_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "IAQAR-ListingResolver/1.0 (+https://iaqar.ai)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ar,en;q=0.8"
      }
    });
    clearTimeout(timer);
    const status = response.status;
    if (status >= 300 && status < 400) {
      const location = response.headers.get("location") || "";
      const nextUrl = normalizeListingFetchUrl(new URL(location, url).toString());
      if (!nextUrl) return { ok: false, error: "redirect_blocked", diagnostics: { status, redirect: location } };
      return await fetchListingPage(nextUrl, redirectCount + 1);
    }
    if (!response.ok) {
      return { ok: false, error: "fetch_failed", diagnostics: { status, redirect: null } };
    }
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > LISTING_FETCH_MAX_BYTES) {
      return {
        ok: false,
        error: "response_too_large",
        diagnostics: { status, contentType, byteLength: buffer.byteLength }
      };
    }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    const text = extractListingTextFromHtml(html);
    if (isListingFetchBlockedText(text)) {
      return {
        ok: false,
        error: "source_blocked",
        diagnostics: { status, contentType, byteLength: buffer.byteLength, textLength: text.length, blocked: true }
      };
    }
    if (!text) {
      return {
        ok: false,
        error: "empty_listing_text",
        diagnostics: { status, contentType, byteLength: buffer.byteLength, textLength: 0 }
      };
    }
    return {
      ok: true,
      text,
      diagnostics: {
        status,
        contentType,
        byteLength: buffer.byteLength,
        textLength: text.length,
        redirectCount
      }
    };
  } catch (error) {
    clearTimeout(timer);
    const message = String(error?.cause?.message || error?.message || error);
    const errorCode = error?.name === "AbortError"
      ? "fetch_timeout"
      : /ENOTFOUND|EAI_AGAIN|getaddrinfo|dns/i.test(message)
        ? "dns_failed"
        : "fetch_failed";
    return {
      ok: false,
      error: errorCode,
      diagnostics: { message }
    };
  }
}

const LLAMA_VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";
let llamaVisionLicenseAccepted = false;

async function ensureLlamaVisionLicenseAccepted(env) {
  if (llamaVisionLicenseAccepted || !env.AI) return;
  await env.AI.run(LLAMA_VISION_MODEL, { prompt: "agree" });
  llamaVisionLicenseAccepted = true;
}

async function runLlamaVisionExtract(env, input) {
  await ensureLlamaVisionLicenseAccepted(env);
  try {
    return await env.AI.run(LLAMA_VISION_MODEL, input);
  } catch (error) {
    if (String(error?.message || "").includes("agree")) {
      llamaVisionLicenseAccepted = false;
      await ensureLlamaVisionLicenseAccepted(env);
      return await env.AI.run(LLAMA_VISION_MODEL, input);
    }
    throw error;
  }
}

async function handleCanonicalIntakeStart(request, env, requestId) {
  assertFirebaseSecrets(env);
  const body = await request.json().catch(() => ({}));
  const officeId = firestoreOfficeId(body.officeId);
  const identity = await authorizeOfficeRequest(request, env, officeId, "member");
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const bucket = requireMediaBucket(env);
  const ctx = buildCanonicalIntakeCtx({
    env, request, identity, projectId, accessToken, bucket
  });
  const result = await startCanonicalIntake({
    ...body,
    officeId,
    brokerId: cleanText(body.brokerId || identity.uid, 120)
  }, ctx);
  return jsonResponse({ ...result, requestId }, result.duplicate ? 200 : 201);
}

async function handleCanonicalIntakeCallbackRoute(request, env, requestId) {
  assertFirebaseSecrets(env);
  const body = await request.json().catch(() => ({}));
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const ctx = buildCanonicalIntakeCtx({
    env, request, identity: null, projectId, accessToken, bucket: null
  });
  const result = await handleCanonicalIntakeCallback(body, ctx);
  return jsonResponse({ ...result, requestId });
}

async function handleCanonicalIntakeRetryRoute(request, env, requestId) {
  assertFirebaseSecrets(env);
  const body = await request.json().catch(() => ({}));
  const officeId = firestoreOfficeId(body.officeId);
  const identity = await authorizeOfficeRequest(request, env, officeId, "member");
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const bucket = requireMediaBucket(env);
  const ctx = buildCanonicalIntakeCtx({
    env, request, identity, projectId, accessToken, bucket
  });
  const result = await retryCanonicalIntake(body, ctx);
  return jsonResponse({ ...result, requestId });
}

async function handleCanonicalIntakeMediaAccess(request, env, requestId) {
  const url = new URL(request.url);
  const token = cleanText(url.searchParams.get("token"), 4000);
  const sig = cleanText(url.searchParams.get("sig"), 200);
  const secret = String(env.CANONICAL_INTAKE_MEDIA_SECRET || env.ACTIVEPIECES_CALLBACK_SECRET || "");
  const verified = await verifyCanonicalMediaAccessToken(token, sig, secret);
  if (!verified.ok) {
    return jsonResponse({ ok: false, error: verified.error, requestId }, 403);
  }
  const { officeId, mediaPath } = verified.data;
  const bucket = requireMediaBucket(env);
  const object = await bucket.get(mediaPath);
  if (!object) return jsonResponse({ ok: false, error: "media_not_found", requestId }, 404);
  const metadata = object.customMetadata || {};
  if (metadata.officeId && metadata.officeId !== officeId) {
    return jsonResponse({ ok: false, error: "media_scope_mismatch", requestId }, 403);
  }
  const headers = new Headers();
  if (object.httpMetadata?.contentType) headers.set("Content-Type", object.httpMetadata.contentType);
  headers.set("Cache-Control", "private, no-store");
  return new Response(object.body, { status: 200, headers });
}

function buildCanonicalIntakeCtx({ env, request, identity, projectId, accessToken, bucket }) {
  return {
    env,
    request,
    identity,
    projectId,
    accessToken,
    requestUrl: request.url,
    firestoreOfficeId,
    officeAuthorizationKey,
    officeIdsEquivalent,
    cleanText,
    appError,
    getFirestoreDocument,
    setFirestoreDocument,
    firestoreFieldsToJs,
    compactFields,
    firestoreString,
    firestoreOptionalString,
    firestoreInteger,
    firestoreBoolean,
    firestoreTimestamp,
    parseRealEstateMessage,
    normalizeListingFetchUrl,
    fetchListingPage,
    opportunityPatchToFirestoreFields,
    LIFECYCLE_STATUS,
    extractImageTextFromMediaPath: (mediaPath, officeId) =>
      extractImageTextFromMediaPath(mediaPath, officeId, env, bucket, runLlamaVisionExtract, parseRealEstateMessage),
    extractAudioFromMediaPath: (mediaPath, officeId) =>
      extractAudioFromMediaPath(mediaPath, officeId, env, bucket, parseRealEstateMessage)
  };
}

async function handlePipelineVoiceAnalyze(request, env, requestId, { publicRoute = false } = {}) {
  const officeId = firestoreOfficeId(request.headers.get("X-Office-Id"));
  const context = cleanText(request.headers.get("X-Voice-Context"), 20).toLowerCase();
  const durationHeader = Number(request.headers.get("X-Voice-Duration-Sec") || 0);
  const durationSec = Number.isFinite(durationHeader) && durationHeader > 0 ? durationHeader : null;
  const contentType = cleanText(request.headers.get("Content-Type"), 120).toLowerCase();
  const size = requestBodyLength(request);

  if (!officeId) throw appError("office_id_required", 400, "officeId مطلوب");
  if (!["office", "owner", "client"].includes(context)) {
    throw appError("invalid_voice_context", 400, "سياق التسجيل غير صالح");
  }

  if (publicRoute) {
    enforcePublicRouteRateLimit(request, {
      route: "pipeline/public-voice-analyze",
      officeId,
      ...PUBLIC_RATE_LIMITS.PUBLIC_VOICE
    });
  } else {
    await authorizeOfficeRequest(request, env, officeId, "member");
  }

  const validation = validateVoiceAudio({ byteSize: size, mimeType: contentType, durationSec });
  if (!validation.ok) {
    return jsonResponse({ ok: false, error: validation.error, requestId }, 422);
  }

  const audioBytes = await request.arrayBuffer();
  if (audioBytes.byteLength !== size) {
    return jsonResponse({ ok: false, error: "AUDIO_UPLOAD_FAILED", requestId }, 400);
  }

  const result = await analyzeVoiceWithGemini({
    env,
    audioBytes,
    mimeType: validation.mimeType,
    context,
    parseRealEstateMessage,
    requestId
  });

  if (!result.ok) {
    const status = result.error === "GEMINI_QUOTA_EXCEEDED" ? 429 : 422;
    return jsonResponse({
      ok: false,
      error: result.error,
      publicMessage: result.publicMessage || voiceAnalyzeHttpErrorMessage(result.error),
      retryable: Boolean(result.retryable),
      model: result.model || resolveGeminiModel(env),
      telemetry: getVoiceTelemetrySnapshot(),
      requestId
    }, status);
  }

  return jsonResponse({
    ok: true,
    structured: result.structured,
    transcript: result.transcript || "",
    brokerFields: result.brokerFields || null,
    fieldSources: result.fieldSources || {},
    provider: result.provider || "gemini",
    extractionMode: result.extractionMode,
    productionAi: result.productionAi,
    model: result.model,
    latencyMs: result.latencyMs,
    confidence: result.confidence || 0,
    telemetry: getVoiceTelemetrySnapshot(),
    requestId
  });
}

async function handlePipelineMediaExtract(request, env, requestId) {
  const body = await request.json().catch(() => ({}));
  const officeId = firestoreOfficeId(body.officeId || request.headers.get("X-Office-Id"));
  const mediaPath = cleanText(body.mediaPath, 500);
  const fileName = cleanText(body.fileName, 240);
  const requestedContentType = cleanText(body.contentType, 120).toLowerCase();
  if (!officeId || !mediaPath) throw appError("invalid_media_target", 400, "وجهة الملف غير صالحة");
  if (!mediaPath.startsWith(`opportunity-sources/${officeId}/`)) {
    throw appError("invalid_media_target", 400, "وجهة الملف غير صالحة");
  }
  await authorizeOfficeRequest(request, env, officeId, "member");
  if (!env.AI && !String(env.GEMINI_API_KEY || "").trim()) {
    return jsonResponse({
      ok: false,
      error: "media_extraction_unavailable",
      publicMessage: mediaExtractPublicMessage("media_extraction_unavailable"),
      requestId
    }, 503);
  }

  const bucket = requireMediaBucket(env);
  const object = await bucket.get(mediaPath);
  if (!object) {
    return jsonResponse({
      ok: false,
      error: "media_not_found",
      publicMessage: mediaExtractPublicMessage("media_not_found"),
      requestId
    }, 404);
  }
  const metadata = object.customMetadata || {};
  if (metadata.officeId && metadata.officeId !== officeId) {
    return jsonResponse({
      ok: false,
      error: "media_scope_mismatch",
      publicMessage: mediaExtractPublicMessage("media_scope_mismatch"),
      requestId
    }, 403);
  }
  if (metadata.sourceType && !["image", "screenshot"].includes(metadata.sourceType)) {
    throw appError("unsupported_media", 415, "هذا المسار مخصص لاستخراج الصور");
  }
  const storedContentType = cleanText(object.httpMetadata?.contentType, 120).toLowerCase();
  if (requestedContentType && storedContentType && requestedContentType !== storedContentType) {
    return jsonResponse({
      ok: false,
      error: "media_type_mismatch",
      publicMessage: mediaExtractPublicMessage("media_type_mismatch"),
      requestId
    }, 400);
  }
  const contentType = storedContentType || requestedContentType;
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    throw appError("unsupported_media", 415, "نوع الصورة غير مدعوم");
  }

  const bytes = await object.arrayBuffer();
  if (bytes.byteLength > LISTING_FETCH_MAX_BYTES) {
    return jsonResponse({
      ok: false,
      error: "response_too_large",
      publicMessage: mediaExtractPublicMessage("response_too_large"),
      requestId
    }, 422);
  }

  const vision = await extractListingFromImage({
    env,
    imageBytes: new Uint8Array(bytes),
    mimeType: contentType,
    runLlamaVisionExtract,
    parseRealEstateMessage
  });
  if (!vision.ok) {
    console.warn("[iaqar-media-extract] vision failed", {
      error: vision.error,
      geminiError: vision.geminiError,
      workersError: vision.workersError
    });
    return jsonResponse({
      ok: false,
      error: vision.error || "media_ai_failed",
      publicMessage: mediaExtractPublicMessage(vision.error, vision),
      geminiError: vision.geminiError || "",
      workersError: vision.workersError || "",
      requestId
    }, 422);
  }

  const text = cleanText(vision.text, 12000);
  if (!text && !vision.brokerFields) {
    return jsonResponse({
      ok: false,
      error: "empty_listing_text",
      publicMessage: mediaExtractPublicMessage("empty_listing_text"),
      requestId
    }, 422);
  }

  return jsonResponse({
    ok: true,
    text,
    textLength: text.length,
    brokerFields: vision.brokerFields || null,
    fieldSources: vision.fieldSources || {},
    analyzerProvider: vision.analyzerProvider || "",
    extractionMode: vision.extractionMode || "workers_ai_vision_adapter",
    extractionStatus: vision.extractionStatus || "extracted",
    confidence: Number(vision.confidence || 0),
    productionAi: Boolean(vision.productionAi),
    geminiAttempted: Boolean(vision.geminiAttempted),
    geminiError: vision.geminiError || "",
    screenshotExtraction: vision.screenshotExtraction || null,
    mediaPath,
    originalUrl: cleanText(body.originalUrl, 2000),
    resolvedUrl: cleanText(body.resolvedUrl, 2000),
    sourceSiteId: cleanText(body.sourceSiteId, 40),
    externalListingId: cleanText(body.externalListingId, 120),
    fileName,
    contentType,
    requestId
  });
}

async function handlePipelineAudioExtract(request, env, requestId) {
  const body = await request.json().catch(() => ({}));
  const officeId = firestoreOfficeId(body.officeId || request.headers.get("X-Office-Id"));
  const mediaPath = cleanText(body.mediaPath, 500);
  const fileName = cleanText(body.fileName, 240);
  const requestedContentType = cleanText(body.contentType, 120).toLowerCase();
  if (!officeId || !mediaPath) throw appError("invalid_media_target", 400, "وجهة الملف غير صالحة");
  if (!mediaPath.startsWith(`opportunity-sources/${officeId}/`)) {
    throw appError("invalid_media_target", 400, "وجهة الملف غير صالحة");
  }
  await authorizeOfficeRequest(request, env, officeId, "member");
  if (!env.AI && !String(env.GEMINI_API_KEY || "").trim()) {
    return jsonResponse({
      ok: false,
      error: "media_extraction_unavailable",
      publicMessage: AUDIO_TRANSCRIBE_ERROR_AR,
      requestId
    }, 503);
  }

  const bucket = requireMediaBucket(env);
  const object = await bucket.get(mediaPath);
  if (!object) {
    return jsonResponse({ ok: false, error: "media_not_found", publicMessage: AUDIO_TRANSCRIBE_ERROR_AR, requestId }, 404);
  }
  const metadata = object.customMetadata || {};
  if (metadata.officeId && metadata.officeId !== officeId) {
    return jsonResponse({ ok: false, error: "media_scope_mismatch", publicMessage: AUDIO_TRANSCRIBE_ERROR_AR, requestId }, 403);
  }
  if (metadata.sourceType && metadata.sourceType !== "audio") {
    throw appError("unsupported_media", 415, "هذا المسار مخصص لاستخراج الصوت");
  }
  const storedContentType = cleanText(object.httpMetadata?.contentType, 120).toLowerCase();
  const contentType = storedContentType || requestedContentType;
  const validation = validateVoiceAudio({
    byteSize: object.size || 0,
    mimeType: contentType
  });
  if (!validation.ok) {
    return jsonResponse({
      ok: false,
      error: validation.error,
      publicMessage: voiceAnalyzeHttpErrorMessage(validation.error),
      requestId
    }, 422);
  }

  const bytes = await object.arrayBuffer();
  const audio = await extractListingFromAudio({
    env,
    audioBytes: bytes,
    mimeType: validation.mimeType,
    parseRealEstateMessage,
    requestId
  });
  if (!audio.ok) {
    return jsonResponse({
      ok: false,
      error: audio.error || "audio_transcribe_failed",
      publicMessage: audio.publicMessage || AUDIO_TRANSCRIBE_ERROR_AR,
      geminiError: audio.geminiError || "",
      workersError: audio.workersError || "",
      requestId
    }, 422);
  }

  const transcript = cleanText(audio.transcript || audio.text, 12000);
  return jsonResponse({
    ok: true,
    text: transcript,
    transcript,
    textLength: transcript.length,
    brokerFields: audio.brokerFields || null,
    fieldSources: audio.fieldSources || {},
    analyzerProvider: audio.analyzerProvider || "",
    extractionMode: audio.extractionMode || "gemini_audio_transcribe_adapter",
    extractionStatus: audio.extractionStatus || "extracted",
    confidence: Number(audio.confidence || 0),
    productionAi: Boolean(audio.productionAi),
    mediaPath,
    fileName,
    contentType: validation.mimeType,
    requestId
  });
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function handlePipelineUrlResolve(request, env, requestId) {
  const body = await request.json().catch(() => ({}));
  const officeId = firestoreOfficeId(body.officeId || request.headers.get("X-Office-Id"));
  if (!officeId) throw appError("office_id_required", 400, "معرّف المكتب مطلوب");
  await authorizeOfficeRequest(request, env, officeId, "member");
  const resolved = await resolveCanonicalListingUrl({
    originalUrl: body.url,
    isPrivateOrLocalHost
  });
  if (!resolved.ok) {
    return jsonResponse({
      ok: false,
      error: resolved.error || "url_resolve_failed",
      url: resolved.originalUrl || adapterNormalizeListingFetchUrl(body.url, isPrivateOrLocalHost),
      originalUrl: resolved.originalUrl || "",
      resolvedUrl: resolved.resolvedUrl || "",
      extractionStatus: "fallback_required",
      diagnostics: resolved.diagnostics || null,
      requestId
    }, 422);
  }
  return jsonResponse({
    ok: true,
    url: resolved.resolvedUrl,
    originalUrl: resolved.originalUrl,
    resolvedUrl: resolved.resolvedUrl,
    text: resolved.text,
    textLength: resolved.textLength,
    sourceSite: resolved.sourceSite,
    sourceSiteId: resolved.sourceSiteId,
    adapterId: resolved.adapterId,
    externalListingId: resolved.externalListingId,
    structured: resolved.structured,
    brokerFields: resolved.brokerFields,
    fieldSources: resolved.fieldSources,
    extractionStatus: resolved.extractionStatus,
    classificationStatus: resolved.classificationStatus,
    listingTitle: resolved.listingTitle,
    contentHash: resolved.contentHash,
    diagnostics: resolved.diagnostics,
    requestId
  });
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left));
  const b = new TextEncoder().encode(String(right));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) difference |= (a[i % (a.length || 1)] || 0) ^ (b[i % (b.length || 1)] || 0);
  return difference === 0;
}
function firestoreNull() { return { nullValue: null }; }

function jsToFirestoreValue(value) {
  if (value === null || value === undefined) return firestoreNull();
  if (value instanceof Date) return firestoreTimestamp(value);
  if (typeof value === "boolean") return firestoreBoolean(value);
  if (typeof value === "number" && Number.isInteger(value)) return firestoreInteger(value);
  if (typeof value === "number") return { doubleValue: value };
  if (typeof value === "string") return firestoreString(value);
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => jsToFirestoreValue(item)).filter((item) => item != null) } };
  }
  if (typeof value === "object") {
    const fields = {};
    for (const [key, nested] of Object.entries(value)) {
      const encoded = jsToFirestoreValue(nested);
      if (encoded != null) fields[key] = encoded;
    }
    return { mapValue: { fields } };
  }
  return firestoreString(String(value));
}

function brokerProgressFirestoreFields(record = {}, actionKey = "", now = new Date()) {
  const progress = mergeBrokerActionProgress(record, actionKey, now.toISOString());
  return { brokerActionProgress: jsToFirestoreValue(progress) };
}

function mergeFollowUpWhatsappRole(existingFollowUp = null, role = "", now = new Date()) {
  const follow = existingFollowUp && typeof existingFollowUp === "object" ? { ...existingFollowUp } : {};
  const roles = new Set(Array.isArray(follow.whatsappRolesOpened) ? follow.whatsappRolesOpened : []);
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized) roles.add(normalized);
  follow.whatsappRolesOpened = [...roles];
  follow.updatedAt = now.toISOString();
  return follow;
}

function followUpFirestoreFields(followUp) {
  const reminderInstant = parseFollowUpInstant(followUp.reminderAt)
    || parseFollowUpInstant(followUp.reminderAt1h)
    || parseFollowUpInstant(followUp.reminderAt24h);
  const reminderAt = reminderInstant || new Date("2099-01-01T00:00:00.000Z");
  return compactFields({
    followUp: jsToFirestoreValue(followUp),
    followUpAt: firestoreTimestamp(new Date(followUp.at)),
    followUpReminderAt: firestoreTimestamp(reminderAt),
    nextFollowUpAt: firestoreTimestamp(new Date(followUp.at)),
    nextActionAt: firestoreTimestamp(new Date(followUp.at))
  });
}

function clearFollowUpFirestoreFields(now) {
  const farFuture = new Date("2099-01-01T00:00:00.000Z");
  return compactFields({
    followUp: jsToFirestoreValue({
      status: FOLLOWUP_STATUSES.cancelled,
      updatedAt: now.toISOString()
    }),
    followUpReminderAt: firestoreTimestamp(farFuture),
    nextFollowUpAt: firestoreNull(),
    nextActionAt: firestoreNull()
  });
}

async function resolveMatchForOpportunity({ projectId, officeId, opportunityId, opportunity, accessToken }) {
  const bestMatchId = cleanText(opportunity.bestMatchId || "", 180);
  if (bestMatchId) {
    const matchDoc = await getFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "matches", bestMatchId],
      accessToken,
      allowMissing: true
    });
    if (matchDoc) return firestoreFieldsToJs(matchDoc.fields || {});
  }
  const matches = await listCollectionDocuments({
    projectId, segments: ["offices", officeId, "matches"], accessToken, pageSize: 80
  });
  for (const doc of matches) {
    const match = firestoreFieldsToJs(doc.fields || {});
    if (!officeIdsEquivalent(match.officeId, officeId)) continue;
    if (match.ownerOfferId && match.clientRequestId
      && (match.opportunityId === opportunityId || match.counterpartOpportunityId === opportunityId)) {
      return match;
    }
  }
  return null;
}

async function scheduleOpportunityFollowUp({
  projectId, officeId, opportunityId, collection, recordId, opportunity, body, identity, accessToken, now, statusBefore, requestId
}) {
  const rawAt = body.nextFollowUpAt || body.followUpAt || body.nextActionAt || "";
  const parsedAt = rawAt.includes("T") && !rawAt.endsWith("Z") && !rawAt.includes("+")
    ? parseRiyadhDateTimeInput(rawAt)
    : new Date(rawAt);
  const futureCheck = validateFutureFollowUpAt(parsedAt, now);
  if (!futureCheck.ok) throw appError(futureCheck.code, 400, futureCheck.message);
  const todayCheck = validateTodayRequiresFutureTime(parsedAt, now);
  if (!todayCheck.ok) throw appError("followup_today_past", 400, todayCheck.message);

  const match = await resolveMatchForOpportunity({
    projectId, officeId, opportunityId, opportunity, accessToken
  }).catch(() => null);

  const recipientContext = resolveRecipientContext(opportunity, match);
  const recipientMode = normalizeRecipientMode(body.recipientMode, recipientContext);
  const existingFollowUp = opportunity.followUp && typeof opportunity.followUp === "object" ? opportunity.followUp : null;
  const isReschedule = existingFollowUp
    && ACTIVE_FOLLOWUP_STATUSES.has(String(existingFollowUp.status || ""))
    && !isSameScheduledFollowUp(existingFollowUp, parsedAt, recipientMode);

  if (isSameScheduledFollowUp(existingFollowUp, parsedAt, recipientMode)) {
    return jsonResponse({
      ok: true,
      opportunityId,
      lifecycleStatus: LIFECYCLE_STATUS.FOLLOW_UP,
      followUp: existingFollowUp,
      idempotent: true,
      requestId
    });
  }

  const followUp = buildCanonicalFollowUp({
    at: parsedAt,
    recipientMode,
    ownerContactId: recipientContext.ownerContactId,
    clientContactId: recipientContext.clientContactId,
    createdBy: identity.uid,
    existing: isReschedule ? existingFollowUp : null,
    now
  });

  const fields = {
    officeId: firestoreString(officeId),
    updatedAt: firestoreTimestamp(now),
    lifecycleUpdatedAt: firestoreTimestamp(now),
    lifecycleUpdatedBy: firestoreString(identity.uid),
    lifecycleStatus: firestoreString(LIFECYCLE_STATUS.FOLLOW_UP),
    nextActionType: firestoreOptionalString(cleanText(body.nextActionType || "follow_up", 40)),
    nextActionNote: firestoreOptionalString(cleanText(body.nextActionNote || body.note || "", 300)),
    ...followUpFirestoreFields(followUp),
    ...brokerProgressFirestoreFields(opportunity, BROKER_ACTION.followUpScheduled, now)
  };

  await setFirestoreDocument({ projectId, segments: ["offices", officeId, collection, recordId], accessToken, fields });
  const activityAction = isReschedule ? "followup_rescheduled" : "followup_scheduled";
  await addOpportunityCommunication({
    projectId, officeId, opportunityId, accessToken, now,
    payload: {
      type: "followup",
      action: activityAction,
      statusBefore,
      statusAfter: LIFECYCLE_STATUS.FOLLOW_UP,
      createdBy: identity.uid,
      result: recipientMode
    }
  });

  return jsonResponse({
    ok: true,
    opportunityId,
    lifecycleStatus: LIFECYCLE_STATUS.FOLLOW_UP,
    lifecycleStatusLabel: LIFECYCLE_STATUS_LABELS[LIFECYCLE_STATUS.FOLLOW_UP],
    followUp,
    nextFollowUpAt: followUp.at,
    brokerActionProgress: mergeBrokerActionProgress(opportunity, BROKER_ACTION.followUpScheduled, now.toISOString()),
    requestId
  });
}

const ACTIVE_FOLLOWUP_STATUSES = new Set([
  FOLLOWUP_STATUSES.scheduled,
  FOLLOWUP_STATUSES.reminder_due,
  FOLLOWUP_STATUSES.reminder_sent
]);

async function handleProcessFollowupReminders(request, env, requestId) {
  assertFirebaseSecrets(env);
  const body = await request.json().catch(() => ({}));
  const officeId = firestoreOfficeId(body.officeId || "");
  if (officeId) await authorizeOfficeRequest(request, env, officeId, "member");
  else if (String(env.DEPLOYMENT_ENV || "").toLowerCase() !== "staging") {
    throw appError("office_id_required", 400, "officeId مطلوب");
  }
  const scheduledTime = Number(body.scheduledTime || Date.now());
  const result = await processOpportunityFollowupReminders(env, scheduledTime);
  return jsonResponse({ ok: true, ...result, requestId });
}

function compactFields(fields) { return Object.fromEntries(Object.entries(fields).filter(([, value]) => value != null)); }
function firestoreString(value) { return { stringValue: String(value) }; }
function firestoreOptionalString(value) { return value ? firestoreString(value) : null; }
function firestoreBoolean(value) { return { booleanValue: Boolean(value) }; }
function firestoreInteger(value) { return { integerValue: String(value) }; }
function firestoreTimestamp(value) { return { timestampValue: value.toISOString() }; }
function safeJsonStringify(value) { try { return JSON.stringify(value); } catch (_) { return "{}"; } }
function utcDayId(date) { return date.toISOString().slice(0, 10).replace(/-/g, ""); }
function emptyUsage() { return { inboundMessages: 0, estimatedWrites: 0, percent: 0, warnAtPercent: WARNING_PERCENT, warning: false, isEstimate: true }; }
function maskPhone(value) {
  const phone = String(value || "");
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 4)}****${phone.slice(-3)}`;
}
function appError(code, status, publicMessage) { const error = new Error(publicMessage); error.code = code; error.status = status; error.publicMessage = publicMessage; return error; }
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Hub-Signature-256,X-Office-Id,X-Intake-Id,X-Media-Kind,X-Media-Index,X-Office-Image-Variant,X-Source-Id,X-Source-Type,X-File-Name,X-Voice-Context,X-Voice-Duration-Sec,X-Share-Card-Version",
    "Access-Control-Max-Age": "86400"
  };
}
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export {
  normalizeLoginPhone, legacyLocalLoginPhone, resolveLoginDirectory, firebaseServiceAccount,
  createServiceAccountJwt, buildNotificationLink, buildFcmTarget, buildFcmHttpMessage, parseFcmFailure,
  MATCHING_RULE_VERSION, MATCH_THRESHOLD, scoreMatch, rankMatchCandidates,
  buildMatchId, relevantDataVersion, canonicalPairKey, opportunityToMatchInput,
  counterpartsEligible, phase4BoundaryGuarantees, findAndSaveMatchesForOpportunity,
  phase5BoundaryGuarantees, OPERATION_TYPES, OPERATION_STATUS, NOTIFICATION_TYPES,
  NOTIFICATION_STATUS, ACTIVE_OPERATION_STATUSES, shouldCreateMatchReview,
  applyOperationLifecycle, listMissingOpportunityFields, pushTypeForOperation,
  phase6BoundaryGuarantees, cooperationModeAllowsExplicitRequest,
  phase7BoundaryGuarantees, MESSAGE_CHANNELS, MESSAGE_SEND_STATE, MESSAGE_DELIVERY_STATE,
  TEMPLATE_CODES, ADAPTER_STATUS, buildArabicMessageBody, buildMessageDraft,
  applyExternalHandoff, whatsappAdapterContract, telegramWebhookValidationFixture,
  resolveTemplateCode, whatsappDigits,
  evaluatePublicRateLimit, consumePublicRateLimit, publicRateLimitKey,
  resetPublicRateLimitStoreForTests, PUBLIC_RATE_LIMITS,
  extractListingTextFromHtml,
  isPrivateOrLocalHost,
  resolveListingSourceSite,
  normalizeOpportunitySource, getOpportunityLifecycleStatus, normalizeSaudiPhoneForWhatsApp,
  buildOpportunitySummary, buildOpportunityWhatsAppMessage, resolveSelectOption,
  extractDistrictFromVoice, parseVoiceOpportunityFields, whatsappActionTypeForStatus,
  isArchivedLifecycle, isOpportunityLifecycleActive
};
