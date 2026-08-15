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
  createExplicitCooperationRequest
} from "./cooperation-phase6-service.js";
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
  analyzeVoiceWithGemini,
  getVoiceTelemetrySnapshot,
  resolveGeminiModel,
  validateVoiceAudio
} from "./gemini-voice-service.js";
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

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_PROJECT_ID = "aqar-b5d76";
const DEFAULT_APP_ORIGIN = "https://iaqar.ai";
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
  async fetch(request, env) {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);

    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
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
        const officeId = normalizeOfficeId(url.searchParams.get("officeId"));
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

      if (request.method === "POST" && url.pathname === "/pipeline/voice-analyze") {
        return await handlePipelineVoiceAnalyze(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/pipeline/public-voice-analyze") {
        return await handlePipelineVoiceAnalyze(request, env, requestId, { publicRoute: true });
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

      if (request.method === "POST" && url.pathname === "/cooperation/request") {
        return await handleCooperationRequestCreate(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/cooperation/lifecycle") {
        return await handleCooperationLifecycle(request, env, requestId);
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

      if (request.method === "POST" && url.pathname === "/pipeline/intake") {
        return await handleSharedIntake(request, env, requestId);
      }

      if (request.method === "POST" && url.pathname === "/pipeline/public-intake") {
        return await handlePublicIntakeMatching(request, env, requestId);
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
    // Phase 9A: staging Worker must not run follow-up cron against the shared project.
    if (String(env.DEPLOYMENT_ENV || "").toLowerCase() === "staging") {
      return;
    }
    ctx.waitUntil(processOverdueFollowups(env, event && event.scheduledTime));
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
  const officeId = normalizeOfficeId(request.headers.get("x-office-id"));
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
  const officeId = normalizeOfficeId(request.headers.get("x-office-id"));
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
  const officeId = normalizeOfficeId(request.headers.get("x-office-id"));
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
  const officeId = normalizeOfficeId(url.searchParams.get("officeId") || request.headers.get("x-office-id"));
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
  const officeId = normalizeOfficeId(request.headers.get("x-office-id"));
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
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
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
  const officeId = normalizeOfficeId(body.officeId);
  if (!applicationId || !["approve", "reject"].includes(action)) {
    throw appError("decision_invalid", 400, "قرار الطلب غير صالح");
  }
  if (action === "approve" && (!officeId || officeId === "platform")) {
    throw appError("office_id_invalid", 400, "رمز المكتب غير صالح");
  }
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const applicationDoc = await getFirestoreDocument({
    projectId, segments: ["brokerApplications", applicationId], accessToken
  });
  const application = firestoreFieldsToJs(applicationDoc.fields || {});
  if (application.status !== "pending") throw appError("already_decided", 409, "تم اتخاذ قرار سابق على الطلب");
  const now = new Date();
  if (action === "approve") {
    const normalizedPhone = normalizeLoginPhone(application.phone);
    if (!normalizedPhone) throw appError("phone_invalid", 400, "رقم جوال الوسيط غير صالح");
    const phoneHash = await sha256Hex(normalizedPhone);
    const loginDirectory = await getFirestoreDocument({ projectId, segments: ["loginDirectory", phoneHash], accessToken, allowMissing: true });
    if (loginDirectory) {
      const existingLogin = firestoreFieldsToJs(loginDirectory.fields || {});
      if (existingLogin.uid !== application.applicantUid) throw appError("phone_already_used", 409, "رقم الجوال مرتبط بحساب آخر");
    }
    const existing = await getFirestoreDocument({ projectId, segments: ["offices", officeId], accessToken, allowMissing: true });
    if (existing) throw appError("office_exists", 409, "رمز المكتب مستخدم");
    await setFirestoreDocument({
      projectId, segments: ["offices", officeId], accessToken,
      fields: {
        officeId: firestoreString(officeId),
        officeName: firestoreString(application.officeName),
        officeNameKey: firestoreString(normalizeOfficeId(application.officeName) || officeId),
        brokerName: firestoreString(application.brokerName),
        phone: firestoreString(application.phone),
        licenseNumber: firestoreString(application.falLicense),
        city: firestoreString("المدينة المنورة"),
        specialties: { arrayValue: { values: [] } },
        ownerUid: firestoreString(application.applicantUid),
        approvalStatus: firestoreString("approved"),
        accountStatus: firestoreString("active"),
        subscriptionStatus: firestoreString("trial"),
        approvedAt: firestoreTimestamp(now),
        approvedByUid: firestoreString(admin.sub),
        registeredAt: firestoreTimestamp(now),
        createdAt: firestoreTimestamp(now)
      }
    });
    await setFirestoreDocument({
      projectId, segments: ["publicOffices", officeId], accessToken,
      fields: {
        officeId: firestoreString(officeId),
        officeName: firestoreString(application.officeName),
        brokerName: firestoreString(application.brokerName),
        phone: firestoreString(application.phone),
        licenseNumber: firestoreString(application.falLicense),
        city: firestoreString("المدينة المنورة"),
        specialties: { arrayValue: { values: [] } },
        coverUrl: firestoreString(""),
        updatedAt: firestoreTimestamp(now)
      }
    });
    await setFirestoreDocument({
      projectId, segments: ["offices", officeId, "members", application.applicantUid], accessToken,
      fields: {
        uid: firestoreString(application.applicantUid),
        role: firestoreString("owner"),
        active: firestoreBoolean(true),
        createdAt: firestoreTimestamp(now)
      }
    });
    await setFirestoreDocument({
      projectId, segments: ["loginDirectory", phoneHash], accessToken,
      fields: {
        uid: firestoreString(application.applicantUid),
        officeId: firestoreString(officeId),
        email: firestoreString(application.email),
        phone: firestoreString(normalizedPhone),
        active: firestoreBoolean(true),
        updatedAt: firestoreTimestamp(now)
      }
    });
  }
  await setFirestoreDocument({
    projectId, segments: ["brokerApplications", applicationId], accessToken,
    fields: {
      status: firestoreString(action === "approve" ? "approved" : "rejected"),
      officeId: firestoreOptionalString(action === "approve" ? officeId : ""),
      decidedAt: firestoreTimestamp(now),
      decidedByUid: firestoreString(admin.sub)
    }
  });
  const adminHelpers = getAdminHelpers();
  const auditId = `aud_${Date.now()}_${crypto.randomUUID().slice(0, 10)}`;
  await setFirestoreDocument({
    projectId,
    segments: ["adminAuditLogs", auditId],
    accessToken,
    fields: {
      officeId: firestoreString(action === "approve" ? officeId : ""),
      action: firestoreString(action === "approve" ? "office_approved" : "office_rejected"),
      performedBy: firestoreString(admin.sub),
      performedAt: firestoreTimestamp(now),
      reason: firestoreString(cleanText(body.reason, 500)),
      beforeJson: firestoreString(JSON.stringify(application)),
      afterJson: firestoreString(JSON.stringify({
        applicationId,
        status: action === "approve" ? "approved" : "rejected",
        officeId: action === "approve" ? officeId : ""
      }))
    }
  });
  if (action === "approve") {
    await recordAdminActivityEvent(adminHelpers, {
      projectId,
      accessToken,
      officeId,
      eventType: "office_approved",
      metadata: { applicationId, approvedBy: admin.sub }
    }).catch(() => {});
  }
  return jsonResponse({ ok: true, applicationId, status: action === "approve" ? "approved" : "rejected", officeId, requestId });
}

async function lookupActivePhoneLoginDirectory({ projectId, phone, accessToken, requestId }) {
  const { directoryDoc } = await resolveLoginDirectory({ projectId, phone, accessToken });
  if (!directoryDoc) {
    console.warn("[iaqar-login] directory missing", { phone: maskPhone(phone), requestId });
    return {
      error: jsonResponse({
        ok: false, error: "invalid_login", reason: "directory_missing",
        message: "رقم الجوال أو كلمة المرور غير صحيحة", requestId
      }, 401)
    };
  }
  const directory = firestoreFieldsToJs(directoryDoc.fields || {});
  if (directory.active !== true || !directory.email || !directory.uid || !directory.officeId) {
    console.warn("[iaqar-login] directory inactive or incomplete", {
      phone: maskPhone(phone),
      active: directory.active,
      hasEmail: Boolean(directory.email),
      hasUid: Boolean(directory.uid),
      officeId: directory.officeId || "",
      requestId
    });
    return {
      error: jsonResponse({
        ok: false, error: "invalid_login", reason: "directory_inactive",
        message: "رقم الجوال أو كلمة المرور غير صحيحة", requestId
      }, 401)
    };
  }
  return {
    directory,
    loginEmail: String(directory.email || "").trim().toLowerCase()
  };
}

async function handlePhoneLoginResolve(request, env, requestId) {
  assertFirebaseSecrets(env);
  const body = await request.json().catch(() => ({}));
  const phone = normalizeLoginPhone(body.phone);
  if (!phone) {
    return jsonResponse({
      ok: false, error: "invalid_login", reason: "invalid_input",
      message: "رقم الجوال غير صحيح", requestId
    }, 401);
  }
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const lookup = await lookupActivePhoneLoginDirectory({ projectId, phone, accessToken, requestId });
  if (lookup.error) return lookup.error;
  return jsonResponse({
    ok: true,
    loginEmail: lookup.loginEmail,
    officeId: normalizeOfficeId(lookup.directory.officeId),
    requestId
  });
}

async function handlePhoneLogin(request, env, requestId) {
  assertFirebaseSecrets(env);
  const body = await request.json().catch(() => ({}));
  const phone = normalizeLoginPhone(body.phone);
  const password = cleanText(body.password, 200);
  const apiKey = cleanText(body.apiKey || env.FIREBASE_WEB_API_KEY, 200);
  if (!phone || password.length < 8 || !apiKey) throw appError("invalid_login", 401, "رقم الجوال أو كلمة المرور غير صحيحة");
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const ip = cleanText(request.headers.get("CF-Connecting-IP") || "unknown", 80);
  const rateHash = await sha256Hex(`${phone}|${ip}`);
  const rateSegments = ["loginRateLimits", rateHash];
  const rateDoc = await getFirestoreDocument({ projectId, segments: rateSegments, accessToken, allowMissing: true });
  const rate = rateDoc ? firestoreFieldsToJs(rateDoc.fields || {}) : {};
  const blockedUntil = rate.blockedUntil ? Date.parse(rate.blockedUntil) : 0;
  if (blockedUntil > Date.now()) throw appError("invalid_login", 401, "رقم الجوال أو كلمة المرور غير صحيحة");
  const lookup = await lookupActivePhoneLoginDirectory({ projectId, phone, accessToken, requestId });
  if (lookup.error) {
    const errorResponse = lookup.error;
    if (typeof errorResponse.json === "function") return errorResponse;
    throw appError("invalid_login", 401, "رقم الجوال أو كلمة المرور غير صحيحة");
  }
  const directory = lookup.directory;
  const loginEmail = lookup.loginEmail;
  const signInResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: loginEmail, password, returnSecureToken: true })
  });
  if (!signInResponse.ok) {
    const windowStartedAt = rate.windowStartedAt ? Date.parse(rate.windowStartedAt) : 0;
    const inWindow = windowStartedAt && Date.now() - windowStartedAt < 15 * 60_000;
    const failureCount = inWindow ? Number(rate.failureCount || 0) + 1 : 1;
    const now = new Date();
    await setFirestoreDocument({ projectId, segments: rateSegments, accessToken, fields: {
      failureCount: firestoreInteger(failureCount),
      windowStartedAt: firestoreTimestamp(inWindow ? new Date(windowStartedAt) : now),
      blockedUntil: firestoreTimestamp(failureCount >= 5 ? new Date(Date.now() + 15 * 60_000) : now),
      updatedAt: firestoreTimestamp(now)
    }});
    throw appError("invalid_login", 401, "رقم الجوال أو كلمة المرور غير صحيحة");
  }
  const signedIn = await signInResponse.json();
  if (signedIn.localId !== directory.uid) throw appError("invalid_login", 401, "رقم الجوال أو كلمة المرور غير صحيحة");
  await setFirestoreDocument({ projectId, segments: rateSegments, accessToken, fields: {
    failureCount: firestoreInteger(0), windowStartedAt: firestoreTimestamp(new Date()),
    blockedUntil: firestoreTimestamp(new Date()), updatedAt: firestoreTimestamp(new Date())
  }});
  const customToken = await createFirebaseCustomToken({
    clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY,
    privateKeyId: env.FIREBASE_PRIVATE_KEY_ID,
    uid: directory.uid, officeId: directory.officeId
  });
  await recordOfficeLoginActivity(getAdminHelpers(), {
    projectId,
    accessToken,
    officeId: directory.officeId,
    uid: directory.uid
  }).catch(() => {});
  return jsonResponse({ ok: true, customToken, officeId: directory.officeId, requestId });
}

async function handleForgotPassword(request, env, requestId) {
  assertFirebaseSecrets(env);
  const body = await request.json().catch(() => ({}));
  const phone = normalizeLoginPhone(body.phone);
  const apiKey = cleanText(body.apiKey || env.FIREBASE_WEB_API_KEY, 200);
  const generic = { ok: true, requestId };
  if (!phone || !apiKey) return jsonResponse(generic);
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const phoneHash = await sha256Hex(phone);
  const { directoryDoc } = await resolveLoginDirectory({ projectId, phone, accessToken });
  if (!directoryDoc) return jsonResponse(generic);
  const directory = firestoreFieldsToJs(directoryDoc.fields || {});
  if (directory.active !== true || !directory.email) return jsonResponse(generic);
  const cooldownDoc = await getFirestoreDocument({ projectId, segments: ["passwordResetCooldown", phoneHash], accessToken, allowMissing: true });
  const cooldown = cooldownDoc ? firestoreFieldsToJs(cooldownDoc.fields || {}) : {};
  const previous = cooldown.lastRequestedAt ? Date.parse(cooldown.lastRequestedAt) : 0;
  if (previous && Date.now() - previous < 60_000) return jsonResponse({ ...generic, maskedEmail: maskEmail(directory.email), cooldown: true });
  const resetResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestType: "PASSWORD_RESET", email: directory.email })
  });
  if (!resetResponse.ok) return jsonResponse(generic);
  await setFirestoreDocument({ projectId, segments: ["passwordResetCooldown", phoneHash], accessToken,
    fields: { lastRequestedAt: firestoreTimestamp(new Date()), phoneLast4: firestoreString(phone.slice(-4)) } });
  return jsonResponse({ ...generic, maskedEmail: maskEmail(directory.email) });
}


async function handleSharedIntake(request, env, requestId) {
  assertFirebaseSecrets(env);
  const body = await request.json().catch(() => ({}));
  const officeId = normalizeOfficeId(body.officeId);
  const messageText = cleanText(body.messageText, 12000);
  const senderName = cleanText(body.senderName || "مشاركة من واتساب", 200);
  const senderPhone = cleanText(body.senderPhone, 60);
  const source = cleanText(body.source || "pwa_share_target", 80);
  const eventId = cleanText(body.eventId || body.id, 200) || crypto.randomUUID();
  if (!officeId) throw appError("office_id_required", 400, "تعذر تحديد المكتب");
  if (!messageText) throw appError("message_required", 400, "نص الرسالة مطلوب");

  const identity = await authorizeOfficeRequest(request, env, officeId, "member");
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const receivedAt = body.receivedAt ? new Date(body.receivedAt) : new Date();
  const safeReceivedAt = Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt;
  const documentId = `share_${(await sha256Hex(`${officeId}|${eventId}`)).slice(0, 40)}`;
  const now = new Date();

  const parent = firestoreDocumentUrl(projectId, ["offices", officeId, "inbox"]);
  const endpoint = `${parent}?documentId=${encodeURIComponent(documentId)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: compactFields({
      schemaVersion: firestoreInteger(2),
      officeId: firestoreString(officeId),
      direction: firestoreString("inbound"),
      source: firestoreString(source),
      channel: firestoreString("shared_to_iaqar"),
      status: firestoreString("pending_review"),
      processingState: firestoreString("received"),
      isProcessed: firestoreBoolean(false),
      outboundEnabled: firestoreBoolean(false),
      messageId: firestoreString(eventId),
      messageType: firestoreString("text"),
      messageText: firestoreString(messageText),
      senderName: firestoreOptionalString(senderName),
      senderPhone: firestoreOptionalString(senderPhone),
      receivedAt: firestoreTimestamp(safeReceivedAt),
      createdAt: firestoreTimestamp(now),
      createdByUid: firestoreOptionalString(identity.uid),
      rawPayload: firestoreString(safeJsonStringify({ source, eventId }).slice(0, MAX_RAW_LENGTH))
    }) })
  });

  if (response.status === 409) {
    return jsonResponse({ ok: true, duplicate: true, documentId, requestId });
  }
  if (!response.ok) throw appError("firestore_write_failed", 502, "تعذر حفظ الرسالة المشتركة");

  const result = await processInboundMessage({
    projectId, officeId, inboxDocumentId: documentId, messageText, senderName, senderPhone,
    receivedAt: safeReceivedAt, source, accessToken, env
  });
  return jsonResponse({
    ok: true, duplicate: false, documentId, officeId, kind: result.kind,
    matches: result.matches, source, requestId
  }, 201);
}


async function handlePublicIntakeMatching(request, env, requestId) {
  const body = await request.json().catch(() => ({}));
  const officeId = normalizeOfficeId(body.officeId);
  const intakeId = cleanText(body.intakeId, 180).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!officeId) throw appError("office_id_required", 400, "تعذر تحديد المكتب");
  if (!intakeId || intakeId.length < 8) throw appError("intake_id_required", 400, "رقم الطلب غير صالح");
  // Rate-limit before secret/Firestore work so abuse is stopped cheaply (Phase 8 / risk 4).
  enforcePublicRouteRateLimit(request, {
    route: "pipeline/public-intake",
    officeId,
    ...PUBLIC_RATE_LIMITS.PUBLIC_INTAKE
  });
  assertFirebaseSecrets(env);

  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const intakeDoc = await getFirestoreDocument({
    projectId, segments: ["offices", officeId, "publicIntake", intakeId], accessToken, allowMissing: true
  });
  if (!intakeDoc) throw appError("intake_not_found", 404, "لم يتم العثور على الطلب");

  const intake = firestoreFieldsToJs(intakeDoc.fields || {});
  if (normalizeOfficeId(intake.officeId) !== officeId) throw appError("office_mismatch", 403, "الطلب لا يتبع هذا المكتب");
  if (!["client", "owner"].includes(intake.kind)) throw appError("invalid_intake_kind", 400, "نوع الطلب غير صالح");
  if (intake.status === "processed" && intake.processedRecordId) {
    return jsonResponse({
      ok: true, duplicate: true, officeId, intakeId,
      recordId: intake.processedRecordId, opportunityId: intake.opportunityId || "",
      matches: Number(intake.matchCount || 0), requestId
    });
  }

  const now = new Date();
  const parsed = structuredPublicIntakeToParsed(intake);
  const readiness = evaluatePublicIntakeReadiness(intake, parsed);

  const opportunityDocs = await listCollectionDocuments({
    projectId, segments: ["offices", officeId, "opportunities"], accessToken, pageSize: 120
  });
  const duplicateHit = findDuplicateOpportunity(
    opportunityDocs.map((doc) => ({
      id: decodeURIComponent(String(doc.name || "").split("/").pop() || ""),
      data: firestoreFieldsToJs(doc.fields || {})
    })),
    {
      officeId,
      phone: parsed.phone || intake.phone,
      contactType: intake.kind === "owner" ? "owner" : "buyer",
      kind: intake.kind,
      propertyType: parsed.propertyType || intake.propertyType,
      city: parsed.city || intake.city,
      district: parsed.district || intake.district
    }
  );

  if (duplicateHit?.opportunityId) {
    const existingId = duplicateHit.opportunityId;
    await setFirestoreDocument({
      projectId, segments: ["offices", officeId, "publicIntake", intakeId], accessToken,
      fields: compactFields({
        status: firestoreString("processed"),
        opportunityId: firestoreString(existingId),
        processedRecordId: firestoreString(existingId),
        duplicateOpportunity: firestoreBoolean(true),
        updatedAt: firestoreTimestamp(now),
        lifecycleStatus: firestoreString(LIFECYCLE_STATUS.NEW)
      })
    });
    await addOpportunityCommunication({
      projectId, officeId, opportunityId: existingId, accessToken, now,
      payload: {
        type: "intake_link",
        action: "duplicate_intake_linked",
        statusBefore: getOpportunityLifecycleStatus(duplicateHit.data),
        statusAfter: getOpportunityLifecycleStatus(duplicateHit.data),
        createdBy: "system_public_intake"
      }
    });
    await setFirestoreDocument({
      projectId, segments: ["offices", officeId, "opportunities", existingId], accessToken,
      fields: compactFields({
        updatedAt: firestoreTimestamp(now),
        sourceIntakeId: firestoreOptionalString(intakeId),
        lastIntakeLinkedAt: firestoreTimestamp(now)
      })
    });
    return jsonResponse({
      ok: true,
      duplicate: true,
      duplicateMessage: "توجد فرصة نشطة لهذا الرقم — تم تحديث الفرصة الحالية بدل إنشاء نسخة مكررة.",
      officeId,
      intakeId,
      opportunityId: existingId,
      recordId: existingId,
      matches: 0,
      requestId
    });
  }

  const mediaPaths = Array.isArray(intake.mediaPaths)
    ? intake.mediaPaths.map((value) => cleanText(value, 500)).filter(Boolean).slice(0, 6)
    : [];
  const targetCollection = parsed.kind === "owner_offer" ? "owners" : "clients";
  const prefix = targetCollection === "owners" ? "own" : "cli";
  const recordId = `${prefix}_intake_${intakeId}`.slice(0, 180);
  const opportunityId = `opp_intake_${intakeId}`.slice(0, 180);
  const commonFields = parsedToFirestoreFields(parsed, {
    officeId, inboxDocumentId: `public_${intakeId}`,
    senderName: parsed.senderName, senderPhone: parsed.phone,
    receivedAt: now, source: intake.source || "office_public_link", now
  });

  await setFirestoreDocument({ projectId, segments: ["offices", officeId, targetCollection, recordId], accessToken, fields: {
    ...commonFields,
    sourceIntakeId: firestoreString(intakeId),
    city: firestoreString(parsed.city || DEFAULT_CITY),
    name: firestoreOptionalString(parsed.senderName),
    phone: firestoreOptionalString(parsed.phone),
    details: firestoreOptionalString(intake.details),
    amount: intake.amount ? firestoreInteger(intake.amount) : null,
    mediaMissing: firestoreBoolean(Boolean(intake.mediaMissing)),
    imageCount: firestoreInteger(Number(intake.imageCount || 0)),
    hasVideo: firestoreBoolean(Boolean(intake.hasVideo))
  }});

  await setFirestoreDocument({ projectId, segments: ["offices", officeId, "opportunities", opportunityId], accessToken, fields: {
    ...commonFields,
    city: firestoreString(parsed.city || DEFAULT_CITY),
    sourceIntakeId: firestoreString(intakeId),
    sourceCollection: firestoreString(targetCollection),
    sourceRecordId: firestoreString(recordId),
    workflowStage: firestoreString("new"),
    priority: firestoreInteger(parsed.completeness >= 80 ? 1 : 2),
    purpose: firestoreString(readiness.purpose),
    advertiserRole: firestoreString(readiness.advertiserRole),
    advertiserDisplayName: firestoreOptionalString(parsed.senderName),
    advertiserPhoneNormalized: firestoreOptionalString(parsed.phone),
    contactPhone: firestoreOptionalString(parsed.phone),
    contactName: firestoreOptionalString(parsed.senderName),
    matchingReadiness: firestoreString(readiness.matchingReadiness),
    matchingReadinessMissingJson: firestoreString(JSON.stringify(readiness.matchingReadinessMissing || [])),
    mediaPaths: mediaPaths.length ? firestoreStringArray(mediaPaths) : null,
    imageCount: firestoreInteger(Number(intake.imageCount || mediaPaths.filter((p) => /image-/i.test(p)).length || 0)),
    hasVideo: firestoreBoolean(Boolean(intake.hasVideo || mediaPaths.some((p) => /video\./i.test(p))))
  }});

  const contactId = String(parsed.phone || "").replace(/\D/g, "");
  if (contactId) {
    await setFirestoreDocument({ projectId, segments: ["offices", officeId, "contacts", contactId], accessToken, fields: {
      officeId: firestoreString(officeId), fullName: firestoreOptionalString(parsed.senderName),
      name: firestoreOptionalString(parsed.senderName), phone: firestoreOptionalString(parsed.phone),
      lastRecordId: firestoreString(recordId), lastRecordType: firestoreString(targetCollection === "owners" ? "owner" : "client"),
      updatedAt: firestoreTimestamp(now)
    }});
  }

  const matches = await findAndSaveMatches({
    projectId, officeId, parsed, sourceCollection: targetCollection,
    sourceRecordId: recordId, opportunityId, accessToken, env
  });

  await setFirestoreDocument({ projectId, segments: ["offices", officeId, "publicIntake", intakeId], accessToken, fields: {
    status: firestoreString("processed"), processingState: firestoreString("processed"),
    processedRecordId: firestoreString(recordId), opportunityId: firestoreString(opportunityId),
    matchCount: firestoreInteger(matches.length), processedAt: firestoreTimestamp(now), updatedAt: firestoreTimestamp(now),
    ...lifecycleFieldsForIntake(intake, now),
    lifecycleStatus: firestoreString(matches.length > 0 ? LIFECYCLE_STATUS.MATCHED : LIFECYCLE_STATUS.NEW)
  }});

  if (matches.length > 0) {
    await sendOfficeMatchNotifications({ projectId, officeId, matches, parsed, accessToken, env });
  }
  return jsonResponse({
    ok: true, duplicate: false, officeId, intakeId, recordId, opportunityId,
    kind: parsed.kind, matches: matches.length, bestMatch: matches[0] || null, requestId
  }, 201);
}

function structuredPublicIntakeToParsed(intake) {
  const detailsParsed = parseRealEstateMessage(cleanText(intake.details, 12000), intake.phone, intake.name);
  const isOwner = intake.kind === "owner";
  const amount = Number(intake.amount || 0);
  const propertyType = cleanText(intake.propertyType || detailsParsed.propertyType, 80);
  const district = cleanText(intake.district || detailsParsed.district, 100);
  const transactionType = cleanText(intake.transactionType || detailsParsed.transactionType || "sale", 20);
  const phone = normalizeSaudiPhone(intake.phone || detailsParsed.phone);
  const senderName = cleanText(intake.name || detailsParsed.senderName, 200);
  const city = cleanText(intake.city || DEFAULT_CITY, 100);
  const rawText = [isOwner ? "عرض مالك" : "طلب عميل", propertyType, district, intake.details].filter(Boolean).join(" — ");
  const extractedCount = [propertyType, district, transactionType, amount, detailsParsed.area, phone, senderName].filter(Boolean).length;
  const completeness = Math.max(Number(intake.completeness || 0), Math.round((extractedCount / 7) * 100));
  return {
    kind: isOwner ? "owner_offer" : "client_request",
    rawText, normalizedText: normalizeArabicText(rawText), city, propertyType, district, transactionType,
    price: isOwner ? amount : (detailsParsed.price || 0),
    priceMin: isOwner ? amount : (detailsParsed.priceMin || 0),
    priceMax: isOwner ? amount : (amount || detailsParsed.priceMax || detailsParsed.price || 0),
    area: Number(intake.area || detailsParsed.area || 0), rooms: Number(intake.rooms || detailsParsed.rooms || 0),
    bathrooms: Number(intake.bathrooms || detailsParsed.bathrooms || 0),
    streetWidth: Number(intake.streetWidth || detailsParsed.streetWidth || 0), phone, senderName,
    urgency: detailsParsed.urgency || "normal", financingReady: Boolean(intake.financingReady || detailsParsed.financingReady),
    directOwner: isOwner || Boolean(detailsParsed.directOwner), furnished: Boolean(detailsParsed.furnished),
    completeness: Math.min(100, completeness), confidence: Math.max(70, Number(detailsParsed.confidence || 0)),
    missing: [!propertyType && "propertyType", !district && "district", !transactionType && "transactionType",
      !amount && "price", !detailsParsed.area && "area", !phone && "phone", !senderName && "senderName"].filter(Boolean)
  };
}

async function handleStatus(request, url, env, requestId) {
  const officeId = normalizeOfficeId(url.searchParams.get("officeId"));
  if (!officeId) throw appError("office_id_required", 400, "officeId مطلوب");

  if (!hasFirebaseSecrets(env)) {
    return jsonResponse({
      ok: true,
      connected: false,
      usage: emptyUsage(),
      configurationPending: true,
      requestId
    });
  }

  await authorizeOfficeRequest(request, env, officeId, "integration");
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const integration = await getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "integrations", "whatsapp"],
    accessToken,
    allowMissing: true
  });

  const dayId = utcDayId(new Date());
  const usageDoc = await getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "usage", `whatsapp_${dayId}`],
    accessToken,
    allowMissing: true
  });

  const integrationData = integration ? firestoreFieldsToJs(integration.fields || {}) : {};
  const usageData = usageDoc ? firestoreFieldsToJs(usageDoc.fields || {}) : {};
  const inboundMessages = Number(usageData.inboundMessages || 0);
  const estimatedWrites = Number(usageData.estimatedWrites || inboundMessages * ESTIMATED_WRITES_PER_MESSAGE);
  const percent = Math.min(100, (estimatedWrites / DAILY_FREE_WRITES) * 100);

  return jsonResponse({
    ok: true,
    connected: integrationData.status === "connected",
    displayPhoneNumber: maskPhone(integrationData.displayPhoneNumber || ""),
    outboundMessaging: false,
    usage: {
      inboundMessages,
      estimatedWrites,
      percent,
      warnAtPercent: WARNING_PERCENT,
      warning: percent >= WARNING_PERCENT,
      isEstimate: true
    },
    requestId
  });
}

function verifyWebhook(url, env) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") || "";

  if (mode === "subscribe" && env.META_WEBHOOK_VERIFY_TOKEN && constantTimeEqual(token || "", env.META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  return new Response("Forbidden", { status: 403 });
}

async function receiveMetaWebhook(request, env, requestId) {
  assertMetaWebhookSecrets(env);
  assertFirebaseSecrets(env);

  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256") || "";
  const valid = await verifyHmacSignature(rawBody, signature, env.META_APP_SECRET);
  if (!valid) throw appError("invalid_signature", 401, "توقيع Meta غير صحيح");

  let payload;
  try { payload = JSON.parse(rawBody); }
  catch (_) { throw appError("invalid_json", 400, "بيانات Webhook غير صالحة"); }

  if (payload.object !== "whatsapp_business_account") {
    return jsonResponse({ ok: true, ignored: true, requestId });
  }

  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  let received = 0;
  let unlinked = 0;

  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    const wabaId = cleanText(entry && entry.id, 100);
    for (const change of Array.isArray(entry && entry.changes) ? entry.changes : []) {
      const value = change && change.value || {};
      const phoneNumberId = cleanText(value.metadata && value.metadata.phone_number_id, 100);
      const messages = Array.isArray(value.messages) ? value.messages : [];
      if (!phoneNumberId || messages.length === 0) continue;

      const mappingDoc = await getFirestoreDocument({
        projectId,
        segments: ["whatsapp_accounts", phoneNumberId],
        accessToken,
        allowMissing: true
      });
      const mapping = mappingDoc ? firestoreFieldsToJs(mappingDoc.fields || {}) : {};
      const officeId = normalizeOfficeId(mapping.officeId);

      if (!officeId || mapping.status !== "connected") {
        unlinked += messages.length;
        console.warn("[iaqar-whatsapp] unlinked phone number", { phoneNumberId, wabaId });
        continue;
      }

      const contactMap = new Map((Array.isArray(value.contacts) ? value.contacts : []).map(contact => [
        String(contact && contact.wa_id || ""),
        cleanText(contact && contact.profile && contact.profile.name, 200)
      ]));

      for (const message of messages) {
        const result = await saveInboundMessage({
          projectId,
          officeId,
          wabaId,
          phoneNumberId,
          displayPhoneNumber: cleanText(value.metadata && value.metadata.display_phone_number, 60),
          message,
          senderName: contactMap.get(String(message && message.from || "")) || "",
          rawPayload: { entryId: wabaId, changeField: change.field, metadata: value.metadata, message },
          accessToken
        });
        if (!result.duplicate) {
          received += 1;
          await incrementUsage({ projectId, officeId, accessToken });
        }
      }
    }
  }

  return jsonResponse({ ok: true, received, unlinked, requestId });
}

async function completeEmbeddedSignup(request, env, requestId) {
  assertFirebaseSecrets(env);
  const required = ["META_APP_ID", "META_CONFIG_ID", "META_APP_SECRET"];
  const missing = required.filter(key => !env[key]);
  if (missing.length) throw appError("meta_not_configured", 503, "إعداد تطبيق Meta غير مكتمل");

  const body = await request.json().catch(() => ({}));
  const officeId = normalizeOfficeId(body.officeId);
  if (!officeId) throw appError("office_id_required", 400, "officeId مطلوب");
  const identity = await authorizeOfficeRequest(request, env, officeId, "integration");

  const code = cleanText(body.code, 2000);
  const wabaId = cleanText(body.wabaId, 120);
  let phoneNumberId = cleanText(body.phoneNumberId, 120);
  if (!code || !wabaId) {
    throw appError("signup_data_missing", 400, "لم تكتمل بيانات الربط من Meta؛ أعد المحاولة");
  }

  const graphVersion = env.META_GRAPH_VERSION || GRAPH_VERSION;
  const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", env.META_APP_ID);
  tokenUrl.searchParams.set("client_secret", env.META_APP_SECRET);
  tokenUrl.searchParams.set("code", code);

  const tokenResponse = await fetch(tokenUrl.toString());
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenPayload.access_token) {
    console.error("[iaqar-whatsapp] token exchange failed", tokenPayload);
    throw appError("meta_token_exchange_failed", 502, "تعذر إكمال الربط مع Meta");
  }
  const accessToken = tokenPayload.access_token;

  const subscribeResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}` }
  });
  if (!subscribeResponse.ok) {
    const detail = await subscribeResponse.text();
    console.error("[iaqar-whatsapp] WABA subscribe failed", detail);
    throw appError("waba_subscribe_failed", 502, "تعذر الاشتراك في رسائل الحساب");
  }

  let displayPhoneNumber = "";
  if (!phoneNumberId) {
    const phonesResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(wabaId)}/phone_numbers`, {
      headers: { "Authorization": `Bearer ${accessToken}` }
    });
    const phones = await phonesResponse.json().catch(() => ({}));
    const first = Array.isArray(phones.data) ? phones.data[0] : null;
    phoneNumberId = cleanText(first && first.id, 120);
    displayPhoneNumber = cleanText(first && first.display_phone_number, 60);
  }

  if (!phoneNumberId) throw appError("phone_number_missing", 502, "لم يتم العثور على رقم واتساب المرتبط");

  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const googleToken = await getGoogleAccessToken(env);
  const now = new Date();

  const existingAccount = await getFirestoreDocument({
    projectId,
    segments: ["whatsapp_accounts", phoneNumberId],
    accessToken: googleToken,
    allowMissing: true
  });
  if (existingAccount) {
    const existing = firestoreFieldsToJs(existingAccount.fields || {});
    if (existing.officeId && normalizeOfficeId(existing.officeId) !== officeId) {
      throw appError("phone_already_linked", 409, "رقم واتساب مرتبط بمكتب آخر");
    }
  }

  await setFirestoreDocument({
    projectId,
    segments: ["whatsapp_accounts", phoneNumberId],
    accessToken: googleToken,
    fields: {
      officeId: firestoreString(officeId),
      wabaId: firestoreString(wabaId),
      phoneNumberId: firestoreString(phoneNumberId),
      displayPhoneNumber: firestoreOptionalString(displayPhoneNumber),
      status: firestoreString("connected"),
      inboundOnly: firestoreBoolean(true),
      outboundEnabled: firestoreBoolean(false),
      connectedAt: firestoreTimestamp(now),
      updatedAt: firestoreTimestamp(now),
      connectedByUid: firestoreOptionalString(identity.uid)
    }
  });

  await setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "integrations", "whatsapp"],
    accessToken: googleToken,
    fields: {
      officeId: firestoreString(officeId),
      wabaId: firestoreString(wabaId),
      phoneNumberId: firestoreString(phoneNumberId),
      displayPhoneNumber: firestoreOptionalString(displayPhoneNumber),
      status: firestoreString("connected"),
      inboundOnly: firestoreBoolean(true),
      outboundEnabled: firestoreBoolean(false),
      connectedAt: firestoreTimestamp(now),
      updatedAt: firestoreTimestamp(now),
      connectedByUid: firestoreOptionalString(identity.uid)
    }
  });

  return jsonResponse({
    ok: true,
    connected: true,
    officeId,
    phoneNumberId,
    displayPhoneNumber: maskPhone(displayPhoneNumber),
    outboundMessaging: false,
    requestId
  });
}

async function saveInboundMessage({ projectId, officeId, wabaId, phoneNumberId, displayPhoneNumber, message, senderName, rawPayload, accessToken }) {
  const messageId = cleanText(message && message.id, 200) || crypto.randomUUID();
  const documentId = `wa_${(await sha256Hex(messageId)).slice(0, 40)}`;
  const receivedAt = parseWhatsAppTimestamp(message && message.timestamp);
  const messageType = cleanText(message && message.type, 50) || "unknown";
  const messageText = extractMessageText(message);
  const senderPhone = cleanText(message && message.from, 60);
  const now = new Date();

  const fields = compactFields({
    schemaVersion: firestoreInteger(2),
    officeId: firestoreString(officeId),
    direction: firestoreString("inbound"),
    source: firestoreString("whatsapp_cloud_api"),
    channel: firestoreString("whatsapp_business"),
    status: firestoreString("pending_review"),
    processingState: firestoreString("received"),
    isProcessed: firestoreBoolean(false),
    outboundEnabled: firestoreBoolean(false),
    messageId: firestoreString(messageId),
    messageType: firestoreString(messageType),
    messageText: firestoreOptionalString(messageText),
    senderName: firestoreOptionalString(senderName),
    senderPhone: firestoreOptionalString(senderPhone),
    wabaId: firestoreString(wabaId),
    phoneNumberId: firestoreString(phoneNumberId),
    displayPhoneNumber: firestoreOptionalString(displayPhoneNumber),
    receivedAt: firestoreTimestamp(receivedAt),
    createdAt: firestoreTimestamp(now),
    rawPayload: firestoreString(safeJsonStringify(rawPayload).slice(0, MAX_RAW_LENGTH))
  });

  const parent = firestoreDocumentUrl(projectId, ["offices", officeId, "inbox"]);
  const endpoint = `${parent}?documentId=${encodeURIComponent(documentId)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });

  if (response.status === 409) return { duplicate: true, documentId };
  if (!response.ok) {
    const detail = await response.text();
    console.error("[iaqar-whatsapp] Firestore write failed", response.status, detail);
    throw appError("firestore_write_failed", 502, "تعذر حفظ رسالة واتساب");
  }

  try {
    await processInboundMessage({
      projectId, officeId, inboxDocumentId: documentId, messageText,
      senderName, senderPhone, receivedAt, accessToken
    });
  } catch (error) {
    console.error("[iaqar-workflow] inbound processing failed", {
      officeId, documentId, code: error && error.code, message: error && error.message
    });
    await setFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "inbox", documentId],
      accessToken,
      fields: {
        processingState: firestoreString("failed"),
        processingError: firestoreString(cleanText(error && error.code || "processing_failed", 120)),
        updatedAt: firestoreTimestamp(new Date())
      }
    }).catch(() => {});
  }
  return { duplicate: false, documentId };
}


async function processInboundMessage({ projectId, officeId, inboxDocumentId, messageText, senderName, senderPhone, receivedAt, source = "whatsapp_cloud_api", accessToken, env = null }) {
  const parsed = parseRealEstateMessage(messageText, senderPhone, senderName);
  const now = new Date();

  if (parsed.kind === "unknown") {
    await setFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "inbox", inboxDocumentId],
      accessToken,
      fields: {
        processingState: firestoreString("needs_review"),
        status: firestoreString("pending_review"),
        isProcessed: firestoreBoolean(false),
        extractedJson: firestoreString(JSON.stringify(parsed)),
        updatedAt: firestoreTimestamp(now)
      }
    });
    return { kind: "unknown", matches: 0 };
  }

  const targetCollection = parsed.kind === "owner_offer" ? "owners" : "clients";
  const contactType = parsed.kind === "owner_offer" ? "owner" : "buyer";
  const existingOpportunity = await findActiveOpportunityByPhone({
    projectId,
    officeId,
    phone: parsed.phone || senderPhone,
    contactType,
    accessToken,
    criteria: {
      kind: parsed.kind === "owner_offer" ? "owner" : "client",
      propertyType: parsed.propertyType,
      city: parsed.city,
      district: parsed.district
    }
  });
  if (existingOpportunity) {
    await setFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "inbox", inboxDocumentId],
      accessToken,
      fields: {
        processingState: firestoreString("processed"),
        status: firestoreString("processed"),
        isProcessed: firestoreBoolean(true),
        classifiedAs: firestoreString(parsed.kind),
        extractedJson: firestoreString(JSON.stringify(parsed)),
        sourceCollection: firestoreString(targetCollection),
        sourceRecordId: firestoreString(existingOpportunity.data.sourceRecordId || ""),
        opportunityId: firestoreString(existingOpportunity.opportunityId),
        duplicateOpportunity: firestoreBoolean(true),
        processedAt: firestoreTimestamp(now),
        updatedAt: firestoreTimestamp(now)
      }
    });
    return { kind: parsed.kind, matches: 0, duplicateOpportunity: true, opportunityId: existingOpportunity.opportunityId };
  }

  const recordId = `${parsed.kind === "owner_offer" ? "own" : "cli"}_${inboxDocumentId.replace(/^wa_/, "").slice(0, 32)}`;
  const commonFields = parsedToFirestoreFields(parsed, {
    officeId, inboxDocumentId, senderName, senderPhone, receivedAt, source, now
  });

  await setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, targetCollection, recordId],
    accessToken,
    fields: commonFields
  });

  const opportunityId = `opp_${inboxDocumentId.replace(/^wa_/, "").slice(0, 32)}`;
  await setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "opportunities", opportunityId],
    accessToken,
    fields: {
      ...commonFields,
      sourceCollection: firestoreString(targetCollection),
      sourceRecordId: firestoreString(recordId),
      workflowStage: firestoreString("new"),
      priority: firestoreInteger(parsed.completeness >= 80 ? 1 : 2)
    }
  });

  const matches = await findAndSaveMatches({
    projectId, officeId, parsed, sourceCollection: targetCollection,
    sourceRecordId: recordId, opportunityId, accessToken, env
  });

  await setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "inbox", inboxDocumentId],
    accessToken,
    fields: {
      processingState: firestoreString("processed"),
      status: firestoreString("processed"),
      isProcessed: firestoreBoolean(true),
      classifiedAs: firestoreString(parsed.kind),
      extractedJson: firestoreString(JSON.stringify(parsed)),
      sourceCollection: firestoreString(targetCollection),
      sourceRecordId: firestoreString(recordId),
      opportunityId: firestoreString(opportunityId),
      matchCount: firestoreInteger(matches.length),
      processedAt: firestoreTimestamp(now),
      updatedAt: firestoreTimestamp(now)
    }
  });

  if (matches.length > 0) {
    await sendOfficeMatchNotifications({ projectId, officeId, matches, parsed, accessToken, env });
  }
  return { kind: parsed.kind, matches: matches.length };
}

function parseRealEstateMessage(input, fallbackPhone = "", fallbackSenderName = "") {
  const raw = cleanText(input, 12000);
  const text = normalizeArabicText(raw);

  const offerWords = [
    "للبيع", "للإيجار", "للايجار", "معروض", "عرض", "متوفر", "متاح", "مالك", "مباشر",
    "عندي", "لدينا", "يوجد", "للتمليك", "للتنازل"
  ];
  const requestWords = [
    "مطلوب", "ابغى", "أبغى", "احتاج", "أحتاج", "يبحث", "نبحث", "طلب", "نرغب",
    "ارغب", "أرغب", "عميل", "مشتري", "مستأجر"
  ];
  const offerScore = countKeywords(text, offerWords);
  const requestScore = countKeywords(text, requestWords);
  const kind = offerScore === 0 && requestScore === 0
    ? "unknown"
    : (offerScore > requestScore ? "owner_offer" : "client_request");

  // Keep the most-specific types first so "أرض تجارية" is not reduced to "أرض".
  const propertyTypes = [
    ["أرض تجارية", ["ارض تجارية", "أرض تجارية", "ارض تجاري", "أرض تجاري"]],
    ["أرض سكنية", ["ارض سكنية", "أرض سكنية", "ارض سكني", "أرض سكني"]],
    ["شقة", ["شقة", "شقق", "شقه"]],
    ["فيلا", ["فيلا", "فله", "فلل", "فيلة"]],
    ["دور", ["دور", "دور كامل"]],
    ["دوبلكس", ["دوبلكس", "دوبليكس", "دوبلكسات"]],
    ["عمارة", ["عمارة", "عماره", "عماير"]],
    ["أرض", ["ارض", "أرض"]],
    ["محل", ["محل", "معرض", "دكان"]],
    ["مكتب", ["مكتب", "مكاتب"]],
    ["استراحة", ["استراحة", "استراحه"]],
    ["مزرعة", ["مزرعة", "مزرعه"]],
    ["مستودع", ["مستودع", "مخزن"]],
    ["قصر", ["قصر", "قصور"]],
    ["بيت شعبي", ["بيت شعبي", "منزل شعبي"]],
    ["مجمع سكني", ["مجمع سكني"]],
    ["مجمع تجاري", ["مجمع تجاري"]],
    ["فندق", ["فندق"]],
    ["شاليه", ["شاليه", "شاليهات"]]
  ];
  let propertyType = "";
  for (const [label, words] of propertyTypes) {
    if (words.some(word => containsArabicPhrase(text, word))) { propertyType = label; break; }
  }

  const districts = [
    "أبيار علي","أبو بريقاء","أبو سدر","أحد","الإسكان","الأزهري","الأصيفرين","البدراني","البركة","البيداء",
    "الجامعة","الجابرة","الجصة","الجماوات","الجرف","الجمعة","الحرم الشريف","الحساء","الحديقة","الخاتم",
    "الخالدية","الدفاع","الدعيثة","الدويمة","الراية","الربوة","الرانوناء","الرمانة","الروابي","السحمان",
    "السد","السلام","السكب","السيح","الشريبات","الشهباء","الصادقية","الصويدرة","العالية","العريض",
    "العزيزية","العصبة","العهن","العنبرية","العيون","الغراء","الفيصلية","الفريش","الفتح","القصواء",
    "القبلتين","المبعوث","المطار","المصانع","المستراح","المتنزه","المزيين","المغيسلة","المفرحات","المهدية",
    "المناخة","الملك فهد","النخيل","النصر","النقاء","النقمى","النواعم","الهدراء","الهجرة","الوبرة",
    "باقدو","بضاعة","بني بياضة","بني حارثة","بني ظفر","بني النجار","تلعة الهبوب","جبل أحد","جبل عير","جماء أم خالد",
    "جشم","حرة الوبرة","حمراء الأسد","حزرة الجنوب","ذو الحليفة","رهط","سد الغابة","سكة الحديد","سيد الشهداء","شوران",
    "طيبة","عروة","عين الخيف","قربان","نبلاء","وادي العقيق","وادي مذينب","وادي مهزور","ورقان","وعيرة"
  ];
  const district = districts.find(name => containsArabicPhrase(text, name)) || extractDistrictAfterKeyword(raw);

  const rentWords = /ايجار|للايجار|استئجار|مستاجر|مستأجر|اجار/;
  const saleWords = /بيع|شراء|تمليك|للبيع|للتمليك|مشتري/;
  const transactionType = rentWords.test(text) ? "rent" : (saleWords.test(text) ? "sale" : "");

  const priceRange = extractMoneyRange(text);
  const price = priceRange.price || extractMoney(text);
  const priceMin = priceRange.min || price;
  const priceMax = priceRange.max || price;
  const area = extractArea(text);
  const rooms = extractNumberNear(text, ["غرف", "غرفة", "غرفه"], 1, 30);
  const streetWidth = extractNumberNear(text, ["عرض الشارع", "شارع"], 4, 100);
  const phone = normalizeSaudiPhone(extractPhone(raw) || fallbackPhone);
  const senderName = extractSenderName(raw) || cleanText(fallbackSenderName, 200);
  const urgency = /عاجل|مستعجل|اليوم|فورا|فوراً|باسرع وقت|بأسرع وقت/.test(text)
    ? "high"
    : (/قريب|خلال اسبوع|خلال أسبوع|هذا الاسبوع|هذا الأسبوع/.test(text) ? "medium" : "normal");
  const financingReady = /كاش|جاهز|تمويل جاهز|موافقه بنكيه|موافقة بنكية|موافقة تمويل|المبلغ جاهز/.test(text);
  const directOwner = /مالك مباشر|من المالك|مباشر من المالك|صاحب العقار/.test(text);
  const furnished = /مفروش|مؤثث/.test(text);

  const extractedCount = [propertyType, district, transactionType, price, area, phone, senderName].filter(Boolean).length;
  const completeness = Math.round((extractedCount / 7) * 100);
  const confidence = Math.min(100, Math.round((Math.max(offerScore, requestScore) * 18) + (completeness * 0.72)));

  return {
    kind, rawText: raw, normalizedText: text, city: DEFAULT_CITY, propertyType, district, transactionType,
    price: price || 0, priceMin: priceMin || 0, priceMax: priceMax || 0, area: area || 0,
    rooms: rooms || 0, streetWidth: streetWidth || 0, phone, senderName, urgency, financingReady,
    directOwner, furnished, offerScore, requestScore, completeness, confidence,
    missing: [
      !propertyType && "propertyType", !district && "district", !transactionType && "transactionType",
      !price && "price", !area && "area", !phone && "phone", !senderName && "senderName"
    ].filter(Boolean)
  };
}

function normalizeArabicText(value) {
  return String(value || "").toLowerCase()
    .replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[ًٌٍَُِّْـ]/g, "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[,،]/g, " ").replace(/\s+/g, " ").trim();
}
function containsArabicPhrase(text, phrase) {
  const normalized = normalizeArabicText(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${normalized}(?:$|\\s)`).test(` ${text} `);
}
function countKeywords(text, words) { return words.reduce((n, w) => n + (text.includes(normalizeArabicText(w)) ? 1 : 0), 0); }
function extractDistrictAfterKeyword(raw) {
  const m = String(raw || "").match(/(?:حي|حى)\s+([\u0600-\u06FF ]{2,40})/);
  return m ? cleanText(m[1].split(/(?:بسعر|بحدود|ميزانية|الميزانية|مساحة|مطلوب|للبيع|للإيجار|للايجار|شارع|غرف)/)[0], 60) : "";
}
function extractSenderName(raw) {
  const source = String(raw || "");
  const patterns = [
    /(?:الاسم|اسم المرسل|اسم العميل|اسم المالك)\s*[:：-]\s*([\u0600-\u06FFa-zA-Z ]{2,60})/i,
    /(?:تواصل مع|للتواصل مع)\s+([\u0600-\u06FFa-zA-Z ]{2,40})(?=\s+(?:على|جوال|رقم|05|\+966)|$)/i
  ];
  for (const pattern of patterns) {
    const m = source.match(pattern);
    if (m) return cleanText(m[1].split(/\n|،|,/)[0], 80);
  }
  return "";
}
function parseMoneyToken(numberText, unit) {
  const n = Number(String(numberText || "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0;
  if (/مليون|ملايين/.test(unit || "")) return Math.round(n * 1000000);
  if (/الف|ألف|الاف|آلاف/.test(unit || "")) return Math.round(n * 1000);
  return Math.round(n);
}
function extractMoney(text) {
  // Handles forms such as: مليون و200 ألف, 1.2 مليون, 650 ألف.
  const compound = text.match(/(\d+(?:\.\d+)?)?\s*(مليون|ملايين)\s*(?:و\s*)?(\d+(?:\.\d+)?)?\s*(الف|ألف|الاف|آلاف)?/);
  if (compound && (compound[1] || compound[3])) {
    return parseMoneyToken(compound[1] || "1", compound[2]) + parseMoneyToken(compound[3] || "0", compound[4]);
  }
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(مليون|ملايين)/,
    /(\d+(?:\.\d+)?)\s*(الف|ألف|الاف|آلاف)/,
    /(?:بسعر|بحدود|الميزانيه|ميزانيه|السعر)\s*(?:الى|إلى|حدود)?\s*(\d[\d,.]*)/
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (!m) continue;
    return parseMoneyToken(m[1], m[2]);
  }
  const candidates = [...text.matchAll(/\b(\d{5,9})\b/g)].map(m => Number(m[1])).filter(n => n >= 20000 && n <= 100000000);
  return candidates[0] || 0;
}
function extractMoneyRange(text) {
  const m = String(text || "").match(/(\d+(?:\.\d+)?)\s*(الف|ألف|الاف|آلاف|مليون|ملايين)?\s*(?:الى|الي|إلى|-)\s*(\d+(?:\.\d+)?)\s*(الف|ألف|الاف|آلاف|مليون|ملايين)?/);
  if (!m) return { min: 0, max: 0, price: 0 };
  const a = parseMoneyToken(m[1], m[2] || m[4]);
  const b = parseMoneyToken(m[3], m[4] || m[2]);
  const min = Math.min(a, b), max = Math.max(a, b);
  return { min, max, price: Math.round((min + max) / 2) };
}
function extractArea(text) {
  const patterns = [
    /(?:مساحه|المساحه)\s*(\d{2,6})\s*(?:متر|م2|م²)?/,
    /(\d{2,6})\s*(?:متر مربع|متر|م2|م²)/
  ];
  for (const p of patterns) {
    const m = text.match(p); const n = m ? Number(m[1]) : 0;
    if (n >= 20 && n <= 200000) return n;
  }
  return 0;
}
function extractNumberNear(text, keywords, min, max) {
  for (const keyword of keywords) {
    const k = normalizeArabicText(keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [new RegExp(`(\\d{1,6})\\s*${k}`), new RegExp(`${k}\\s*(\\d{1,6})`)];
    for (const p of patterns) { const m = text.match(p); const n = m ? Number(m[1]) : 0; if (n >= min && n <= max) return n; }
  }
  return 0;
}
function extractPhone(raw) {
  const source = String(raw || "").replace(/[\s()-]/g, "");
  const m = source.match(/(?:\+?966|00966|0)?5\d{8}/);
  return m ? m[0] : "";
}
function normalizeSaudiPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^009665\d{8}$/.test(digits)) return `+${digits.slice(2)}`;
  if (/^9665\d{8}$/.test(digits)) return `+${digits}`;
  if (/^05\d{8}$/.test(digits)) return `+966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `+966${digits}`;
  return cleanText(value, 60);
}

function parsedToFirestoreFields(parsed, context) {
  const normalizedSource = normalizeOpportunitySource(context.source || "whatsapp_cloud_api");
  const contactType = parsed.kind === "owner_offer" ? "owner" : (parsed.kind === "client_request" ? "buyer" : "unknown");
  return compactFields({
    schemaVersion: firestoreInteger(3), officeId: firestoreString(context.officeId),
    source: firestoreString(context.source || "whatsapp_cloud_api"),
    normalizedSource: firestoreString(normalizedSource),
    sourceInboxId: firestoreString(context.inboxDocumentId),
    recordType: firestoreString(parsed.kind), status: firestoreString("active"), workflowStage: firestoreString("new"),
    lifecycleStatus: firestoreString(LIFECYCLE_STATUS.NEW),
    contactType: firestoreString(contactType),
    contactName: firestoreOptionalString(parsed.senderName || context.senderName),
    contactPhone: firestoreOptionalString(parsed.phone || context.senderPhone),
    lastContactAt: null,
    nextFollowUpAt: null,
    lastContactMethod: null,
    lastWhatsAppAt: null,
    lastWhatsAppOpenedAt: null,
    closureReason: null,
    closedAt: null,
    archivedAt: null,
    lifecycleUpdatedAt: firestoreTimestamp(context.now),
    lifecycleUpdatedBy: firestoreOptionalString(context.lifecycleUpdatedBy || ""),
    rawText: firestoreString(parsed.rawText), city: firestoreOptionalString(parsed.city || DEFAULT_CITY), propertyType: firestoreOptionalString(parsed.propertyType),
    district: firestoreOptionalString(parsed.district), transactionType: firestoreOptionalString(parsed.transactionType),
    price: parsed.price ? firestoreInteger(parsed.price) : null,
    priceMin: parsed.priceMin ? firestoreInteger(parsed.priceMin) : null,
    priceMax: parsed.priceMax ? firestoreInteger(parsed.priceMax) : null,
    area: parsed.area ? firestoreInteger(parsed.area) : null,
    rooms: parsed.rooms ? firestoreInteger(parsed.rooms) : null,
    streetWidth: parsed.streetWidth ? firestoreInteger(parsed.streetWidth) : null,
    urgency: firestoreString(parsed.urgency || "normal"), financingReady: firestoreBoolean(Boolean(parsed.financingReady)),
    directOwner: firestoreBoolean(Boolean(parsed.directOwner)), furnished: firestoreBoolean(Boolean(parsed.furnished)),
    confidence: firestoreInteger(parsed.confidence || 0), completeness: firestoreInteger(parsed.completeness),
    missingFieldsJson: firestoreString(JSON.stringify(parsed.missing)), receivedAt: firestoreTimestamp(context.receivedAt),
    createdAt: firestoreTimestamp(context.now), updatedAt: firestoreTimestamp(context.now)
  });
}

function lifecycleFieldsForIntake(intake = {}, now = new Date()) {
  const isOwner = intake.kind === "owner";
  const normalizedSource = normalizeOpportunitySource(intake.source || "office_public_link");
  return compactFields({
    lifecycleStatus: firestoreString(LIFECYCLE_STATUS.NEW),
    normalizedSource: firestoreString(normalizedSource),
    contactType: firestoreString(isOwner ? "owner" : "buyer"),
    contactName: firestoreOptionalString(intake.name),
    contactPhone: firestoreOptionalString(intake.phone),
    lifecycleUpdatedAt: firestoreTimestamp(now)
  });
}

async function findActiveOpportunityByPhone({ projectId, officeId, phone, contactType, accessToken, criteria = {} }) {
  const digits = normalizeSaudiPhoneForWhatsApp(phone);
  if (!digits) return null;
  const docs = await listCollectionDocuments({
    projectId, segments: ["offices", officeId, "opportunities"], accessToken, pageSize: 80
  });
  const searchCriteria = {
    officeId,
    phone,
    contactType,
    ...criteria
  };
  for (const doc of docs) {
    const data = firestoreFieldsToJs(doc.fields || {});
    if (normalizeOfficeId(data.officeId) !== officeId) continue;
    const docPhone = normalizeSaudiPhoneForWhatsApp(data.contactPhone || data.phone || data.advertiserPhoneNormalized || "");
    if (docPhone !== digits) continue;
    if (!matchesDuplicateCriteria(data, searchCriteria)) continue;
    const docId = decodeURIComponent(String(doc.name || "").split("/").pop() || "");
    return { opportunityId: docId, data };
  }
  return null;
}

async function addOpportunityCommunication({ projectId, officeId, opportunityId, payload, accessToken, now = new Date() }) {
  const communicationId = `comm_${(await sha256Hex(`${opportunityId}|${now.toISOString()}|${payload.action || "event"}`)).slice(0, 24)}`;
  await setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "opportunities", opportunityId, "communications", communicationId],
    accessToken,
    fields: compactFields({
      officeId: firestoreString(officeId),
      type: firestoreString(payload.type || "whatsapp"),
      action: firestoreString(payload.action || "opened"),
      statusBefore: firestoreOptionalString(payload.statusBefore || ""),
      statusAfter: firestoreOptionalString(payload.statusAfter || ""),
      createdAt: firestoreTimestamp(now),
      createdBy: firestoreOptionalString(payload.createdBy || "")
    })
  });
  return communicationId;
}

async function resolveOpportunityRecord({ projectId, officeId, body, accessToken }) {
  const recordType = cleanText(body.recordType || "opportunity", 30);
  const recordId = cleanText(body.recordId || body.opportunityId, 180);
  if (!recordId) throw appError("record_id_required", 400, "معرّف الفرصة مطلوب");

  if (recordType === "intake") {
    const intakeDoc = await getFirestoreDocument({
      projectId, segments: ["offices", officeId, "publicIntake", recordId], accessToken
    });
    const intake = firestoreFieldsToJs(intakeDoc.fields || {});
    if (normalizeOfficeId(intake.officeId) !== officeId) throw appError("office_mismatch", 403, "الطلب لا يتبع هذا المكتب");
    return {
      collection: "publicIntake",
      recordId,
      data: intake,
      opportunityId: intake.opportunityId || "",
      contactType: intake.kind === "owner" ? "owner" : "buyer"
    };
  }

  const opportunityDoc = await getFirestoreDocument({
    projectId, segments: ["offices", officeId, "opportunities", recordId], accessToken
  });
  const data = firestoreFieldsToJs(opportunityDoc.fields || {});
  if (normalizeOfficeId(data.officeId) !== officeId) throw appError("office_mismatch", 403, "الفرصة لا تتبع هذا المكتب");
  return {
    collection: "opportunities",
    recordId,
    data,
    opportunityId: recordId,
    contactType: data.contactType || (data.recordType === "owner_offer" ? "owner" : "buyer")
  };
}

async function handleOpportunityLifecycle(request, env, requestId) {
  assertFirebaseSecrets(env);
  const body = await request.json().catch(() => ({}));
  const officeId = normalizeOfficeId(body.officeId);
  const action = cleanText(body.action, 60);
  if (!officeId || !action) throw appError("lifecycle_data_missing", 400, "بيانات دورة الفرصة غير مكتملة");
  const identity = await authorizeOfficeRequest(request, env, officeId, "member");
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const now = new Date();
  const resolved = await resolveOpportunityRecord({ projectId, officeId, body, accessToken });
  const statusBefore = getOpportunityLifecycleStatus(resolved.data);
  const collection = resolved.collection;
  const recordId = resolved.recordId;
  const opportunityId = resolved.opportunityId || recordId;
  const fields = { officeId: firestoreString(officeId), updatedAt: firestoreTimestamp(now), lifecycleUpdatedAt: firestoreTimestamp(now), lifecycleUpdatedBy: firestoreString(identity.uid) };

  if (action === "update_status") {
    const next = cleanText(body.lifecycleStatus, 40);
    if (!LIFECYCLE_STATUS_LABELS[next]) throw appError("lifecycle_status_invalid", 400, "حالة الفرصة غير صحيحة");
    fields.lifecycleStatus = firestoreString(next);
    if (next === LIFECYCLE_STATUS.CONTACTED) {
      fields.lastContactAt = firestoreTimestamp(now);
      fields.lastContactMethod = firestoreOptionalString(body.lastContactMethod || "manual");
    }
    if (next === LIFECYCLE_STATUS.FOLLOW_UP && body.nextFollowUpAt) {
      const followUp = new Date(body.nextFollowUpAt);
      if (!Number.isNaN(followUp.getTime())) fields.nextFollowUpAt = firestoreTimestamp(followUp);
    }
  } else if (action === "confirm_contact") {
    fields.lifecycleStatus = firestoreString(LIFECYCLE_STATUS.CONTACTED);
    fields.lastContactAt = firestoreTimestamp(now);
    fields.lastContactMethod = firestoreString(cleanText(body.lastContactMethod || "whatsapp", 30));
  } else if (action === "set_followup") {
    const followUp = body.nextFollowUpAt || body.nextActionAt
      ? new Date(body.nextFollowUpAt || body.nextActionAt)
      : defaultNextFollowUp(Number(body.followUpDays || 1) * 24);
    if (Number.isNaN(followUp.getTime())) throw appError("followup_invalid", 400, "موعد المتابعة غير صحيح");
    fields.lifecycleStatus = firestoreString(LIFECYCLE_STATUS.FOLLOW_UP);
    fields.nextFollowUpAt = firestoreTimestamp(followUp);
    fields.nextActionAt = firestoreTimestamp(followUp);
    fields.nextActionType = firestoreOptionalString(cleanText(body.nextActionType || "follow_up", 40));
    fields.nextActionNote = firestoreOptionalString(cleanText(body.nextActionNote || body.note || "", 300));
  } else if (action === "close_won") {
    fields.lifecycleStatus = firestoreString(LIFECYCLE_STATUS.CLOSED_WON);
    fields.closedAt = firestoreTimestamp(now);
    fields.closureReason = firestoreOptionalString(cleanText(body.closureReason || "تمت بنجاح", 200));
  } else if (action === "close_lost") {
    fields.lifecycleStatus = firestoreString(LIFECYCLE_STATUS.CLOSED_LOST);
    fields.closedAt = firestoreTimestamp(now);
    fields.closureReason = firestoreOptionalString(cleanText(body.closureReason || body.reason || "لم تتم", 200));
  } else if (action === "archive") {
    fields.lifecycleStatus = firestoreString(LIFECYCLE_STATUS.ARCHIVED);
    fields.archivedAt = firestoreTimestamp(now);
  } else if (action === "whatsapp_opened") {
    fields.lastWhatsAppOpenedAt = firestoreTimestamp(now);
    fields.lastWhatsAppAt = firestoreTimestamp(now);
    await setFirestoreDocument({ projectId, segments: ["offices", officeId, collection, recordId], accessToken, fields });
    await addOpportunityCommunication({
      projectId, officeId, opportunityId, accessToken, now,
      payload: { type: "whatsapp", action: "opened", statusBefore, statusAfter: statusBefore, createdBy: identity.uid }
    });
    return jsonResponse({ ok: true, lifecycleStatus: statusBefore, opportunityId, requestId });
  } else {
    throw appError("lifecycle_action_invalid", 400, "إجراء دورة الفرصة غير معروف");
  }

  await setFirestoreDocument({ projectId, segments: ["offices", officeId, collection, recordId], accessToken, fields });
  const finalStatus = action === "update_status" ? cleanText(body.lifecycleStatus, 40)
    : action === "confirm_contact" ? LIFECYCLE_STATUS.CONTACTED
    : action === "set_followup" ? LIFECYCLE_STATUS.FOLLOW_UP
    : action === "close_won" ? LIFECYCLE_STATUS.CLOSED_WON
    : action === "close_lost" ? LIFECYCLE_STATUS.CLOSED_LOST
    : action === "archive" ? LIFECYCLE_STATUS.ARCHIVED
    : statusBefore;

  await addOpportunityCommunication({
    projectId, officeId, opportunityId, accessToken, now,
    payload: {
      type: cleanText(body.communicationType || "lifecycle", 30),
      action: cleanText(body.communicationAction || action, 40),
      statusBefore,
      statusAfter: finalStatus,
      createdBy: identity.uid
    }
  });

  if (resolved.data.sourceRecordId && collection === "opportunities") {
    const sourceCollection = cleanText(resolved.data.sourceCollection || "", 30);
    if (["clients", "owners"].includes(sourceCollection)) {
      await setFirestoreDocument({
        projectId, segments: ["offices", officeId, sourceCollection, resolved.data.sourceRecordId], accessToken,
        fields: { lifecycleStatus: fields.lifecycleStatus, updatedAt: firestoreTimestamp(now) }
      }).catch(() => {});
    }
  }

  return jsonResponse({
    ok: true,
    opportunityId,
    recordType: collection === "publicIntake" ? "intake" : "opportunity",
    recordId,
    lifecycleStatus: finalStatus,
    lifecycleStatusLabel: LIFECYCLE_STATUS_LABELS[finalStatus] || finalStatus,
    requestId
  });
}

function rankMatchCandidates(source, candidates) {
  return rankMatchCandidatesEngine(source, candidates);
}

function scoreMatch(source, candidate) {
  return scoreMatchEngine(source, candidate);
}

function operationsFirestoreHelpers() {
  return {
    firestoreString,
    firestoreBoolean,
    firestoreInteger,
    firestoreTimestamp,
    firestoreOptionalString,
    firestoreFieldsToJs
  };
}

function operationsDeps(env = null) {
  return {
    setFirestoreDocument,
    getFirestoreDocument,
    listCollectionDocuments,
    sendOfficePush: (args) => sendOfficePush({ ...args, env }),
    firestoreHelpers: operationsFirestoreHelpers()
  };
}

async function supersedeMatchesForPairKey({
  projectId, officeId, pairRule, keepMatchId, accessToken, now = new Date()
}) {
  const docs = await listCollectionDocuments({
    projectId, segments: ["offices", officeId, "matches"], accessToken, pageSize: MAX_MATCH_CANDIDATES
  });
  let superseded = 0;
  const supersededMatchIds = [];
  for (const doc of docs) {
    const match = firestoreFieldsToJs(doc.fields || {});
    const matchId = decodeURIComponent(String(doc.name || "").split("/").pop() || "");
    if (!matchId || matchId === keepMatchId) continue;
    if (String(match.pairRuleKey || "") !== String(pairRule || "")) continue;
    if (match.isCurrent === false || match.status === "superseded") continue;
    await setFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "matches", matchId],
      accessToken,
      fields: {
        isCurrent: firestoreBoolean(false),
        status: firestoreString("superseded"),
        statusLabel: firestoreString("أُلغيت بنسخة أحدث"),
        supersededAt: firestoreTimestamp(now),
        supersededByMatchId: firestoreString(keepMatchId || ""),
        attentionRequired: firestoreBoolean(false),
        updatedAt: firestoreTimestamp(now)
      }
    });
    superseded += 1;
    supersededMatchIds.push(matchId);
  }
  if (supersededMatchIds.length) {
    await expireOperationsForMatchIds({
      projectId,
      officeId,
      matchIds: supersededMatchIds,
      accessToken,
      listCollectionDocuments,
      setFirestoreDocument,
      firestoreHelpers: operationsFirestoreHelpers()
    }).catch((error) => console.warn("[iaqar-ops] expire superseded match ops", error && error.message));
  }
  return superseded;
}

async function persistScoredMatch({
  projectId, officeId, source, candidate, sourceRef, counterpartRef,
  sourceCollection, sourceRecordId, counterpartCollection, counterpartRecordId,
  opportunityId, counterpartOpportunityId, scored, rank, accessToken,
  notifyOperation = false, assignedBrokerId = "", env = null
}) {
  const pairKey = canonicalPairKey(sourceRef, counterpartRef);
  const dataVersion = await relevantDataVersion(source, candidate);
  const matchId = await buildMatchId({
    officeId, pairKey, matchingRuleVersion: MATCHING_RULE_VERSION, dataVersion
  });
  const pairRule = await pairRuleKey({ officeId, pairKey, matchingRuleVersion: MATCHING_RULE_VERSION });
  const existingMatch = await getFirestoreDocument({
    projectId, segments: ["offices", officeId, "matches", matchId], accessToken, allowMissing: true
  });
  if (existingMatch) {
    const existing = firestoreFieldsToJs(existingMatch.fields || {});
    if (existing.isCurrent !== false && existing.status !== "superseded") {
      return {
        matchId, duplicate: true, score: scored.score, opportunityScore: scored.opportunityScore,
        priority: scored.priority, closingReadiness: scored.readiness, status: "active",
        statusLabel: MATCH_STATUS_LABELS.active, nextAction: MATCH_NEXT_ACTION_LABELS.active,
        rank, isBestOpportunity: rank === 1, reasons: scored.reasons, warnings: scored.warnings,
        metrics: scored.metrics, breakdown: scored.breakdown,
        city: source.city || candidate.city || DEFAULT_CITY,
        district: source.district || candidate.district || "",
        propertyType: source.propertyType || candidate.propertyType || "",
        matchingRuleVersion: MATCHING_RULE_VERSION, dataVersion, pairKey
      };
    }
  }

  await supersedeMatchesForPairKey({
    projectId, officeId, pairRule, keepMatchId: matchId, accessToken
  });

  const now = new Date();
  const clientRequestId = sourceCollection === "clients"
    ? sourceRecordId
    : (counterpartCollection === "clients" ? counterpartRecordId : "");
  const ownerOfferId = sourceCollection === "owners"
    ? sourceRecordId
    : (counterpartCollection === "owners" ? counterpartRecordId : "");
  const readiness = scored.readiness;

  await setFirestoreDocument({ projectId, segments: ["offices", officeId, "matches", matchId], accessToken, fields: {
    schemaVersion: firestoreInteger(6),
    officeId: firestoreString(officeId),
    matchId: firestoreString(matchId),
    status: firestoreString("active"),
    statusLabel: firestoreString(MATCH_STATUS_LABELS.active),
    workflowStage: firestoreString("contact"),
    nextAction: firestoreString(MATCH_NEXT_ACTION_LABELS.active),
    attentionRequired: firestoreBoolean(true),
    isCurrent: firestoreBoolean(true),
    matchingRuleVersion: firestoreString(MATCHING_RULE_VERSION),
    dataVersion: firestoreString(dataVersion),
    canonicalPairKey: firestoreString(pairKey),
    pairRuleKey: firestoreString(pairRule),
    score: firestoreInteger(scored.score),
    opportunityScore: firestoreInteger(scored.opportunityScore),
    closingReadinessScore: firestoreInteger(readiness.score),
    closingReadinessKey: firestoreString(readiness.key),
    closingReadinessLabel: firestoreString(readiness.label),
    priority: firestoreString(scored.priority),
    rank: firestoreInteger(rank),
    isBestOpportunity: firestoreBoolean(rank === 1),
    reasonsJson: firestoreString(JSON.stringify(scored.reasons)),
    breakdownJson: firestoreString(JSON.stringify(scored.breakdown)),
    warningsJson: firestoreString(JSON.stringify(scored.warnings)),
    rejectionChecksJson: firestoreString(JSON.stringify(scored.rejectionChecks || [])),
    sourceCollection: firestoreString(sourceCollection),
    sourceRecordId: firestoreString(sourceRecordId),
    counterpartCollection: firestoreString(counterpartCollection),
    counterpartRecordId: firestoreString(counterpartRecordId),
    clientRequestId: firestoreString(clientRequestId),
    ownerOfferId: firestoreString(ownerOfferId),
    matchGroupId: firestoreString(clientRequestId || pairKey),
    opportunityId: firestoreString(opportunityId || ""),
    counterpartOpportunityId: firestoreString(counterpartOpportunityId || ""),
    city: firestoreOptionalString(source.city || candidate.city || DEFAULT_CITY),
    district: firestoreOptionalString(source.district || candidate.district),
    propertyType: firestoreOptionalString(source.propertyType || candidate.propertyType),
    transactionType: firestoreOptionalString(source.transactionType || candidate.transactionType),
    priceDifferencePercent: firestoreInteger(Number(scored.metrics.priceDifferencePercent || 0)),
    areaDifferencePercent: firestoreInteger(Number(scored.metrics.areaDifferencePercent || 0)),
    contactPhone: firestoreOptionalString(source.phone || candidate.contactPhone || candidate.phone),
    contactName: firestoreOptionalString(source.senderName || candidate.contactName || candidate.senderName),
    nextFollowUpAt: firestoreTimestamp(defaultNextFollowUp(24)),
    followUpCount: firestoreInteger(0),
    createdAt: firestoreTimestamp(now),
    lastMatchedAt: firestoreTimestamp(now),
    updatedAt: firestoreTimestamp(now)
  }});
  await setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "matches", matchId, "timeline", "evt_match_created"],
    accessToken,
    fields: {
      officeId: firestoreString(officeId),
      recordType: firestoreString("match"),
      recordId: firestoreString(matchId),
      eventType: firestoreString("match_created"),
      stage: firestoreString("active"),
      note: firestoreString(`تم إنشاء المطابقة بنسبة ${scored.score}% — جاهزية الإغلاق ${readiness.label}`),
      createdAt: firestoreTimestamp(now)
    }
  });

  const persisted = {
    matchId, duplicate: false, score: scored.score, opportunityScore: scored.opportunityScore,
    priority: scored.priority, closingReadiness: readiness, status: "active",
    statusLabel: MATCH_STATUS_LABELS.active, nextAction: MATCH_NEXT_ACTION_LABELS.active,
    rank, isBestOpportunity: rank === 1, reasons: scored.reasons, warnings: scored.warnings,
    metrics: scored.metrics, breakdown: scored.breakdown,
    city: source.city || candidate.city || DEFAULT_CITY,
    district: source.district || candidate.district || "",
    propertyType: source.propertyType || candidate.propertyType || "",
    matchingRuleVersion: MATCHING_RULE_VERSION, dataVersion, pairKey,
    opportunityId: opportunityId || "",
    counterpartOpportunityId: counterpartOpportunityId || "",
    isCurrent: true,
    assignedBrokerId: assignedBrokerId || ""
  };

  // Phase 5: actionable Match → exactly one MATCH_REVIEW Operation (+ in-app Notification).
  try {
    const bundle = await createMatchReviewBundle({
      projectId,
      officeId,
      match: persisted,
      threshold: MATCH_THRESHOLD,
      assignedBrokerId,
      notifyPush: notifyOperation === true,
      accessToken,
      deps: operationsDeps(env)
    });
    persisted.operationId = bundle.operation?.id || "";
    persisted.operationCreated = Boolean(bundle.created);
  } catch (error) {
    console.warn("[iaqar-ops] match review upsert failed", error && error.message);
    persisted.operationCreated = false;
  }

  return persisted;
}

async function findAndSaveMatches({ projectId, officeId, parsed, sourceCollection, sourceRecordId, opportunityId, accessToken, env = null }) {
  const counterpart = sourceCollection === "owners" ? "clients" : "owners";
  const docs = await listCollectionDocuments({
    projectId, segments: ["offices", officeId, counterpart], accessToken, pageSize: MAX_MATCH_CANDIDATES
  });
  const prepared = [];
  for (const doc of docs) {
    const candidate = firestoreFieldsToJs(doc.fields || {});
    if (candidate.status && !["active", "new", "open"].includes(candidate.status)) continue;
    const scored = scoreMatch(parsed, candidate);
    if (!scored.eligible || scored.score < MATCH_THRESHOLD) continue;
    const candidateId = decodeURIComponent(String(doc.name || "").split("/").pop() || "");
    prepared.push({ candidate, candidateId, scored });
  }
  prepared.sort((a, b) => b.scored.opportunityScore - a.scored.opportunityScore || b.scored.score - a.scored.score);

  const results = [];
  const topPrepared = prepared.slice(0, MAX_MATCH_RESULTS);
  for (let index = 0; index < topPrepared.length; index += 1) {
    const { candidate, candidateId, scored } = topPrepared[index];
    const sourceRef = `${sourceCollection}:${sourceRecordId}`;
    const counterpartRef = `${counterpart}:${candidateId}`;
    const persisted = await persistScoredMatch({
      projectId, officeId,
      source: parsed, candidate,
      sourceRef, counterpartRef,
      sourceCollection, sourceRecordId,
      counterpartCollection: counterpart, counterpartRecordId: candidateId,
      opportunityId, counterpartOpportunityId: "",
      scored, rank: index + 1, accessToken,
      // Create MATCH_REVIEW Operation (+ in-app notification). Push is deferred to
      // sendOfficeMatchNotifications only when operationId exists (no orphan pushes).
      notifyOperation: false,
      env
    });
    results.push(persisted);
  }
  return results;
}

async function findAndSaveMatchesForOpportunity({
  projectId, officeId, opportunityId, accessToken, notify = false, env = null
}) {
  const oppDoc = await getFirestoreDocument({
    projectId, segments: ["offices", officeId, "opportunities", opportunityId], accessToken, allowMissing: true
  });
  if (!oppDoc) throw appError("opportunity_not_found", 404, "الفرصة غير موجودة");
  const opportunity = {
    id: opportunityId,
    ...firestoreFieldsToJs(oppDoc.fields || {})
  };

  if (!isActiveLifecycle(opportunity)) {
    const docs = await listCollectionDocuments({
      projectId, segments: ["offices", officeId, "matches"], accessToken, pageSize: MAX_MATCH_CANDIDATES
    });
    const now = new Date();
    let superseded = 0;
    const supersededMatchIds = [];
    for (const doc of docs) {
      const match = firestoreFieldsToJs(doc.fields || {});
      const matchId = decodeURIComponent(String(doc.name || "").split("/").pop() || "");
      const relates = match.opportunityId === opportunityId
        || match.counterpartOpportunityId === opportunityId
        || match.sourceRecordId === opportunityId
        || match.counterpartRecordId === opportunityId;
      if (!relates || match.isCurrent === false || match.status === "superseded") continue;
      await setFirestoreDocument({
        projectId, segments: ["offices", officeId, "matches", matchId], accessToken, fields: {
          isCurrent: firestoreBoolean(false),
          status: firestoreString("superseded"),
          statusLabel: firestoreString("أُلغيت لأن الفرصة غير نشطة"),
          supersededAt: firestoreTimestamp(now),
          attentionRequired: firestoreBoolean(false),
          updatedAt: firestoreTimestamp(now)
        }
      });
      superseded += 1;
      supersededMatchIds.push(matchId);
    }
    if (supersededMatchIds.length) {
      await expireOperationsForMatchIds({
        projectId, officeId, matchIds: supersededMatchIds, accessToken,
        listCollectionDocuments, setFirestoreDocument, firestoreHelpers: operationsFirestoreHelpers()
      }).catch((error) => console.warn("[iaqar-ops] expire inactive match ops", error && error.message));
    }
    return {
      matches: [], superseded, inactive: true,
      boundaries: { ...phase4BoundaryGuarantees(), ...phase5BoundaryGuarantees() }
    };
  }

  const source = opportunityToMatchInput(opportunity, { id: opportunityId });
  const docs = await listCollectionDocuments({
    projectId, segments: ["offices", officeId, "opportunities"], accessToken, pageSize: MAX_MATCH_CANDIDATES
  });
  const prepared = [];
  for (const doc of docs) {
    const candidateId = decodeURIComponent(String(doc.name || "").split("/").pop() || "");
    if (!candidateId || candidateId === opportunityId) continue;
    const candidateRaw = { id: candidateId, ...firestoreFieldsToJs(doc.fields || {}) };
    if (!counterpartsEligible(opportunity, candidateRaw)) continue;
    const candidate = opportunityToMatchInput(candidateRaw, { id: candidateId });
    const scored = scoreMatch(source, candidate);
    if (!scored.eligible || scored.score < MATCH_THRESHOLD) continue;
    prepared.push({ candidate, candidateRaw, candidateId, scored });
  }
  prepared.sort((a, b) => b.scored.opportunityScore - a.scored.opportunityScore || b.scored.score - a.scored.score);

  const results = [];
  const topPrepared = prepared.slice(0, MAX_MATCH_RESULTS);
  for (let index = 0; index < topPrepared.length; index += 1) {
    const { candidate, candidateId, scored } = topPrepared[index];
    const sourceRef = `opportunities:${opportunityId}`;
    const counterpartRef = `opportunities:${candidateId}`;
    const persisted = await persistScoredMatch({
      projectId, officeId,
      source, candidate,
      sourceRef, counterpartRef,
      sourceCollection: "opportunities", sourceRecordId: opportunityId,
      counterpartCollection: "opportunities", counterpartRecordId: candidateId,
      opportunityId, counterpartOpportunityId: candidateId,
      scored, rank: index + 1, accessToken,
      notifyOperation: notify === true,
      assignedBrokerId: String(opportunity.brokerId || opportunity.originatingBrokerId || ""),
      env
    });
    results.push(persisted);
  }

  // Missing required fields → MISSING_DATA Operation; complete fields close it.
  let missingData = { created: false };
  try {
    missingData = await upsertMissingDataForOpportunity({
      projectId,
      officeId,
      opportunity,
      opportunityId,
      accessToken,
      deps: operationsDeps(env)
    });
  } catch (error) {
    console.warn("[iaqar-ops] missing-data upsert failed", error && error.message);
  }

  // Legacy alerts retained for older clients; Phase 5 push is lock-screen-safe via Operation bundle.
  if (notify && results.length > 0) {
    const fresh = results.filter((item) => !item.duplicate && item.operationCreated);
    if (fresh.length > 0) {
      await sendOfficeMatchNotifications({
        projectId, officeId, matches: fresh, parsed: source, accessToken, skipPush: true, env
      }).catch((error) => console.warn("[iaqar-ops] legacy alert write", error && error.message));
    }
  }

  const operationsCreated = results.filter((item) => item.operationCreated).length
    + (missingData.created ? 1 : 0);

  return {
    matches: results,
    matchingRuleVersion: MATCHING_RULE_VERSION,
    threshold: MATCH_THRESHOLD,
    createsOperation: operationsCreated > 0,
    operationsCreated,
    missingData,
    boundaries: { ...phase4BoundaryGuarantees(), ...phase5BoundaryGuarantees(), createsOperation: operationsCreated > 0 }
  };
}

async function handleMatchingRun(request, env, requestId) {
  const body = await request.json().catch(() => ({}));
  const officeId = normalizeOfficeId(body.officeId);
  const opportunityId = cleanText(body.opportunityId, 180);
  if (!officeId) throw appError("office_id_required", 400, "تعذر تحديد المكتب");
  if (!opportunityId) throw appError("opportunity_id_required", 400, "معرّف الفرصة مطلوب");
  // Auth before Firestore work — missing Bearer token fails closed at 401.
  await authorizeOfficeRequest(request, env, officeId, "member");
  assertFirebaseSecrets(env);
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const notify = body.notify === true;
  const result = await findAndSaveMatchesForOpportunity({
    projectId, officeId, opportunityId, accessToken, notify, env
  });
  return jsonResponse({
    ok: true,
    officeId,
    opportunityId,
    matchCount: result.matches.length,
    matches: result.matches,
    matchingRuleVersion: MATCHING_RULE_VERSION,
    threshold: MATCH_THRESHOLD,
    superseded: result.superseded || 0,
    inactive: Boolean(result.inactive),
    boundaries: result.boundaries || { ...phase4BoundaryGuarantees(), ...phase5BoundaryGuarantees() },
    createsOperation: Boolean(result.createsOperation),
    operationsCreated: Number(result.operationsCreated || 0),
    missingData: result.missingData || null,
    requestId
  });
}

async function handleOperationsAction(request, env, requestId) {
  const body = await request.json().catch(() => ({}));
  const officeId = normalizeOfficeId(body.officeId);
  const operationId = cleanText(body.operationId, 180);
  const action = cleanText(body.action, 40);
  const reason = cleanText(body.reason, 200);
  if (!officeId) throw appError("office_id_required", 400, "تعذر تحديد المكتب");
  if (!operationId) throw appError("operation_id_required", 400, "معرّف العملية مطلوب");
  if (!action) throw appError("action_required", 400, "الإجراء مطلوب");
  await authorizeOfficeRequest(request, env, officeId, "member");
  assertFirebaseSecrets(env);
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const result = await applyTrustedOperationAction({
    projectId,
    officeId,
    operationId,
    action,
    reason,
    accessToken,
    getFirestoreDocument,
    setFirestoreDocument,
    firestoreHelpers: operationsFirestoreHelpers()
  });
  if (!result.ok) {
    throw appError(result.error || "operation_action_failed", result.status || 400, "تعذر تحديث العملية");
  }
  return jsonResponse({
    ok: true,
    officeId,
    operationId,
    status: result.status,
    idempotent: Boolean(result.idempotent),
    boundaries: phase5BoundaryGuarantees(),
    requestId
  });
}

async function handleOperationsFromCooperation(request, env, requestId) {
  const body = await request.json().catch(() => ({}));
  const officeId = normalizeOfficeId(body.officeId);
  const cooperationId = cleanText(body.cooperationId, 180);
  if (!officeId) throw appError("office_id_required", 400, "تعذر تحديد المكتب");
  if (!cooperationId) throw appError("cooperation_id_required", 400, "معرّف التعاون مطلوب");
  await authorizeOfficeRequest(request, env, officeId, "member");
  assertFirebaseSecrets(env);
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const coopDoc = await getFirestoreDocument({
    projectId,
    segments: ["cooperationRequests", cooperationId],
    accessToken,
    allowMissing: true
  });
  if (!coopDoc) throw appError("cooperation_not_found", 404, "طلب التعاون غير موجود");
  const cooperation = { id: cooperationId, ...firestoreFieldsToJs(coopDoc.fields || {}) };
  const origin = String(cooperation.originatingOfficeId || "");
  const target = String(cooperation.targetOfficeId || "");
  if (officeId !== origin && officeId !== target) {
    throw appError("cooperation_forbidden", 403, "لا يمكن إنشاء عملية تعاون لمكتب غير طرف");
  }
  // Never invent cooperation — only sync Operations from an explicit Phase 3 record.
  const result = await upsertCooperationOperations({
    projectId,
    cooperation,
    accessToken,
    deps: operationsDeps(env)
  });
  return jsonResponse({
    ok: true,
    officeId,
    cooperationId,
    results: result.results,
    boundaries: phase5BoundaryGuarantees(),
    requestId
  });
}

async function handleOperationsMissingData(request, env, requestId) {
  const body = await request.json().catch(() => ({}));
  const officeId = normalizeOfficeId(body.officeId);
  const opportunityId = cleanText(body.opportunityId, 180);
  if (!officeId) throw appError("office_id_required", 400, "تعذر تحديد المكتب");
  if (!opportunityId) throw appError("opportunity_id_required", 400, "معرّف الفرصة مطلوب");
  await authorizeOfficeRequest(request, env, officeId, "member");
  assertFirebaseSecrets(env);
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const oppDoc = await getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "opportunities", opportunityId],
    accessToken,
    allowMissing: true
  });
  if (!oppDoc) throw appError("opportunity_not_found", 404, "الفرصة غير موجودة");
  const opportunity = { id: opportunityId, ...firestoreFieldsToJs(oppDoc.fields || {}) };
  const result = await upsertMissingDataForOpportunity({
    projectId,
    officeId,
    opportunity,
    opportunityId,
    accessToken,
    deps: operationsDeps(env)
  });
  return jsonResponse({
    ok: true,
    officeId,
    opportunityId,
    created: Boolean(result.created),
    closed: Number(result.closed || 0),
    operationId: result.operation?.id || "",
    missingFields: listMissingOpportunityFields(opportunity),
    boundaries: phase5BoundaryGuarantees(),
    requestId
  });
}

async function handleCooperationRequestCreate(request, env, requestId) {
  const body = await request.json().catch(() => ({}));
  const officeId = normalizeOfficeId(body.officeId);
  const targetOfficeId = normalizeOfficeId(body.targetOfficeId);
  const scopeType = cleanText(body.scopeType || "single", 20);
  const opportunityIds = Array.isArray(body.opportunityIds)
    ? body.opportunityIds.map((id) => cleanText(id, 180)).filter(Boolean)
    : [];
  if (!officeId) throw appError("office_id_required", 400, "تعذر تحديد المكتب");
  if (!targetOfficeId) throw appError("target_office_required", 400, "معرّف المكتب المستهدف مطلوب");
  if (!opportunityIds.length) throw appError("opportunity_ids_required", 400, "معرّف الفرصة مطلوب");
  const identity = await authorizeOfficeRequest(request, env, officeId, "member");
  assertFirebaseSecrets(env);
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const result = await createExplicitCooperationRequest({
    projectId,
    originatingOfficeId: officeId,
    originatingBrokerId: identity.uid || "",
    targetOfficeId,
    opportunityIds,
    scopeType,
    accessToken,
    deps: {
      getFirestoreDocument,
      setFirestoreDocument,
      firestoreFieldsToJs,
      firestoreHelpers: operationsFirestoreHelpers()
    }
  });
  if (!result.ok) {
    throw appError(
      result.error || "cooperation_request_failed",
      result.status || 400,
      result.message || "تعذر إرسال طلب التعاون"
    );
  }
  return jsonResponse({
    ok: true,
    officeId,
    targetOfficeId,
    cooperationRequestId: result.requestId,
    duplicate: Boolean(result.duplicate),
    message: result.message || "تم إرسال طلب التعاون",
    boundaries: result.boundaries || phase6BoundaryGuarantees(),
    requestId
  }, result.duplicate ? 200 : 201);
}

async function handleCooperationLifecycle(request, env, requestId) {
  const body = await request.json().catch(() => ({}));
  const officeId = normalizeOfficeId(body.officeId);
  const cooperationId = cleanText(body.cooperationId, 180);
  const action = cleanText(body.action, 40).toUpperCase();
  const reason = cleanText(body.reason, 200);
  if (!officeId) throw appError("office_id_required", 400, "تعذر تحديد المكتب");
  if (!cooperationId) throw appError("cooperation_id_required", 400, "معرّف التعاون مطلوب");
  if (!action) throw appError("action_required", 400, "الإجراء مطلوب");
  const identity = await authorizeOfficeRequest(request, env, officeId, "member");
  assertFirebaseSecrets(env);
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const result = await runCooperationLifecycle({
    projectId,
    actorOfficeId: officeId,
    actorUid: identity.uid || "",
    cooperationId,
    action,
    reason,
    accessToken,
    deps: {
      ...operationsDeps(env),
      deleteFirestoreDocument,
      firestoreFieldsToJs,
      upsertCooperationOperations
    }
  });
  if (!result.ok) {
    throw appError(result.error || "cooperation_lifecycle_failed", result.status || 400, "تعذر تحديث التعاون");
  }
  return jsonResponse({
    ok: true,
    officeId,
    cooperationId,
    status: result.status,
    projectionsWritten: result.projectionsWritten,
    projectionsRemoved: result.projectionsRemoved,
    opportunityIds: result.opportunityIds,
    boundaries: { ...phase6BoundaryGuarantees(), ...phase5BoundaryGuarantees() },
    requestId
  });
}

async function handleCooperationScopeRevoke(request, env, requestId) {
  const body = await request.json().catch(() => ({}));
  const officeId = normalizeOfficeId(body.officeId);
  const sharingScopeId = cleanText(body.sharingScopeId, 180);
  const reason = cleanText(body.reason, 200);
  if (!officeId) throw appError("office_id_required", 400, "تعذر تحديد المكتب");
  if (!sharingScopeId) throw appError("scope_id_required", 400, "معرّف نطاق المشاركة مطلوب");
  const identity = await authorizeOfficeRequest(request, env, officeId, "member");
  assertFirebaseSecrets(env);
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const result = await revokeBankSharingScope({
    projectId,
    actorOfficeId: officeId,
    actorUid: identity.uid || "",
    sharingScopeId,
    reason,
    accessToken,
    deps: {
      getFirestoreDocument,
      setFirestoreDocument,
      firestoreFieldsToJs,
      firestoreHelpers: operationsFirestoreHelpers()
    }
  });
  if (!result.ok) {
    throw appError(result.error || "scope_revoke_failed", result.status || 400, "تعذر إنهاء نطاق المشاركة");
  }
  return jsonResponse({
    ok: true,
    officeId,
    sharingScopeId,
    status: result.status,
    boundaries: phase6BoundaryGuarantees(),
    requestId
  });
}

function messageDraftToFirestoreFields(draft) {
  const h = operationsFirestoreHelpers();
  return {
    schemaVersion: h.firestoreInteger(draft.schemaVersion || 1),
    id: h.firestoreString(draft.id),
    officeId: h.firestoreString(draft.officeId),
    brokerId: h.firestoreString(draft.brokerId || ""),
    channel: h.firestoreString(draft.channel),
    templateCode: h.firestoreString(draft.templateCode || ""),
    body: h.firestoreString(draft.body || ""),
    recipientRole: h.firestoreString(draft.recipientRole || ""),
    recipientName: h.firestoreString(draft.recipientName || ""),
    recipientPhone: h.firestoreString(draft.recipientPhone || ""),
    operationId: h.firestoreString(draft.operationId || ""),
    matchId: h.firestoreString(draft.matchId || ""),
    opportunityId: h.firestoreString(draft.opportunityId || ""),
    sendState: h.firestoreString(draft.sendState || MESSAGE_SEND_STATE.DRAFT),
    deliveryState: h.firestoreString(draft.deliveryState || MESSAGE_DELIVERY_STATE.NOT_APPLICABLE),
    failureReason: h.firestoreString(draft.failureReason || ""),
    handoffUrl: h.firestoreString(draft.handoffUrl || ""),
    adapterStatus: h.firestoreString(draft.adapterStatus || ""),
    openedExternalAt: draft.openedExternalAt
      ? h.firestoreTimestamp(new Date(draft.openedExternalAt))
      : null,
    sentAt: draft.sentAt ? h.firestoreTimestamp(new Date(draft.sentAt)) : null,
    deliveredAt: draft.deliveredAt ? h.firestoreTimestamp(new Date(draft.deliveredAt)) : null,
    createdAt: h.firestoreTimestamp(new Date(draft.createdAt)),
    updatedAt: h.firestoreTimestamp(new Date(draft.updatedAt)),
    createdBySystem: h.firestoreBoolean(Boolean(draft.createdBySystem)),
    autoSend: h.firestoreBoolean(false),
    providerConfirmedSend: h.firestoreBoolean(Boolean(draft.providerConfirmedSend)),
    providerConfirmedDelivery: h.firestoreBoolean(false)
  };
}

async function handleMessagesDraft(request, env, requestId) {
  const body = await request.json().catch(() => ({}));
  const officeId = normalizeOfficeId(body.officeId);
  if (!officeId) throw appError("office_id_required", 400, "تعذر تحديد المكتب");
  const identity = await authorizeOfficeRequest(request, env, officeId, "member");
  assertFirebaseSecrets(env);
  const channel = normalizeChannel(body.channel);
  const role = cleanText(body.role || "client", 20) === "owner" ? "owner" : "client";
  const stage = cleanText(body.stage, 40) || "contact";
  const messageMode = cleanText(body.messageMode, 40);
  const templateCode = resolveTemplateCode({
    templateCode: cleanText(body.templateCode, 40),
    role,
    stage,
    messageMode,
    ownerMediaMissing: body.ownerMediaMissing === true
  });
  const officeName = cleanText(body.officeName, 80) || "المكتب العقاري";
  const contactPhone = cleanText(body.contactPhone, 40);
  if (channel === MESSAGE_CHANNELS.WHATSAPP && !whatsappDigits(contactPhone)) {
    throw appError("phone_required", 400, "رقم المستلم غير موجود أو غير صحيح");
  }
  const text = cleanText(body.body, 4000) || buildArabicMessageBody({
    templateCode,
    role,
    officeName,
    contactName: cleanText(body.contactName, 120),
    propertyType: cleanText(body.propertyType, 40),
    district: cleanText(body.district, 80),
    appointmentLabel: cleanText(body.appointmentLabel, 80),
    requestedItems: Array.isArray(body.requestedItems) ? body.requestedItems : [],
    requestNote: cleanText(body.requestNote, 400),
    stage
  });

  const built = await buildMessageDraft({
    officeId,
    brokerId: identity.uid || "",
    channel,
    templateCode,
    body: text,
    recipientRole: role,
    recipientName: cleanText(body.contactName, 120),
    recipientPhone: contactPhone,
    operationId: cleanText(body.operationId, 180),
    matchId: cleanText(body.matchId, 180),
    opportunityId: cleanText(body.opportunityId, 180)
  });
  if (!built.ok) throw appError(built.error || "draft_failed", 400, "تعذر إنشاء مسودة الرسالة");

  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  await setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "messages", built.draft.id],
    accessToken,
    fields: messageDraftToFirestoreFields(built.draft)
  });

  return jsonResponse({
    ok: true,
    officeId,
    messageId: built.draft.id,
    draft: {
      ...built.draft,
      // Never claim send/delivery from draft creation.
      sendState: MESSAGE_SEND_STATE.DRAFT,
      deliveryState: MESSAGE_DELIVERY_STATE.NOT_APPLICABLE,
      providerConfirmedSend: false,
      providerConfirmedDelivery: false
    },
    boundaries: phase7BoundaryGuarantees(),
    requestId
  });
}

async function handleMessagesHandoff(request, env, requestId) {
  const body = await request.json().catch(() => ({}));
  const officeId = normalizeOfficeId(body.officeId);
  const messageId = cleanText(body.messageId, 180);
  if (!officeId) throw appError("office_id_required", 400, "تعذر تحديد المكتب");
  if (!messageId) throw appError("message_id_required", 400, "معرّف الرسالة مطلوب");
  await authorizeOfficeRequest(request, env, officeId, "member");
  assertFirebaseSecrets(env);
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
  const doc = await getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "messages", messageId],
    accessToken,
    allowMissing: true
  });
  if (!doc) throw appError("message_not_found", 404, "المسودة غير موجودة");
  const draft = { id: messageId, ...firestoreFieldsToJs(doc.fields || {}) };
  const applied = applyExternalHandoff(draft);
  if (!applied.ok) throw appError(applied.error || "handoff_failed", 400, "تعذر تسجيل الفتح الخارجي");

  const h = operationsFirestoreHelpers();
  const fields = {
    sendState: h.firestoreString(applied.patch.sendState),
    deliveryState: h.firestoreString(applied.patch.deliveryState),
    openedExternalAt: h.firestoreTimestamp(new Date(applied.patch.openedExternalAt)),
    updatedAt: h.firestoreTimestamp(new Date(applied.patch.updatedAt)),
    providerConfirmedSend: h.firestoreBoolean(false),
    providerConfirmedDelivery: h.firestoreBoolean(false)
  };
  await setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "messages", messageId],
    accessToken,
    fields
  });

  return jsonResponse({
    ok: true,
    officeId,
    messageId,
    sendState: MESSAGE_SEND_STATE.OPENED_EXTERNAL,
    deliveryState: MESSAGE_DELIVERY_STATE.NOT_APPLICABLE,
    handoffUrl: draft.handoffUrl || "",
    // Explicit honesty: external handoff is not Cloud API send and not delivery.
    providerConfirmedSend: false,
    providerConfirmedDelivery: false,
    boundaries: phase7BoundaryGuarantees(),
    requestId
  });
}

async function listCollectionDocuments({projectId,segments,accessToken,pageSize=50}) {
  const url=new URL(firestoreDocumentUrl(projectId,segments)); url.searchParams.set("pageSize",String(pageSize));
  const response=await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`}});
  if(response.status===404)return[]; if(!response.ok)throw appError("firestore_read_failed",502,"تعذر قراءة بيانات المطابقة");
  const payload=await response.json(); return Array.isArray(payload.documents)?payload.documents:[];
}

async function sendOfficeMatchNotifications({projectId,officeId,matches,parsed,accessToken,skipPush=false,env=null}) {
  // Notification without a real Operations Center action is a product failure.
  // Prefer a match that already has a MATCH_REVIEW operation id.
  const actionable = (Array.isArray(matches) ? matches : []).filter((row) =>
    row && row.matchId && String(row.operationId || "").trim()
  );
  const top = actionable[0] || null;
  if (!top) {
    console.warn("[iaqar-ops] match notification skipped — no MATCH_REVIEW operationId");
    return { sent: false, reason: "missing_operation" };
  }
  const now=new Date();
  const alertId=`alt_${top.matchId}`;
  // Lock-screen-safe / preference-safe copy — no district, phone, or full opportunity text.
  const title = "لديك مطابقة جديدة تحتاج مراجعتك.";
  const body = "لديك مطابقة جديدة تحتاج مراجعتك.";
  const operationId = String(top.operationId || "").trim();
  await setFirestoreDocument({projectId,segments:["offices",officeId,"alerts",alertId],accessToken,fields:{
    officeId:firestoreString(officeId),type:firestoreString("match"),status:firestoreString("unread"),
    title:firestoreString(title),body:firestoreString(body),
    matchId:firestoreString(top.matchId),
    operationId:firestoreString(operationId),
    score:firestoreInteger(top.score),
    opportunityScore:firestoreInteger(Number(top.opportunityScore || top.score || 0)),
    isBestOpportunity:firestoreBoolean(Boolean(top.isBestOpportunity)),
    createdAt:firestoreTimestamp(now),updatedAt:firestoreTimestamp(now)
  }});
  if (!skipPush) {
    await sendOfficePush({
      projectId,
      officeId,
      title,
      body,
      // Deep-link as operation so Operations Center can open the actionable item.
      type: "operation",
      recordId: operationId,
      assignedBrokerId: top.assignedBrokerId || "",
      accessToken,
      env
    });
  }
  return { sent: !skipPush, reason: "ok", operationId, matchId: top.matchId };
}

function buildNotificationLink({officeId,type="match",recordId=""}) {
  const safeOfficeId=normalizeOfficeId(officeId)||"platform";
  const safeRecordId=cleanText(recordId,200);
  const params=new URLSearchParams();
  if(safeOfficeId==="platform")params.set("office","platform"); else params.set("officeId",safeOfficeId);
  if(type==="notification_test"){
    // اختبار التفعيل يفتح المكتب فقط دون محاولة فتح سجل وهمي.
  } else if(type==="deal")params.set("openDeal",safeRecordId);
  else if(type==="broker_application"){
    params.set("adminApplications","1");
    if(safeRecordId)params.set("openBrokerApplication",safeRecordId);
  } else if(type==="message"||type==="conversation"){
    if(safeRecordId)params.set("openMessage",safeRecordId);
    else params.set("openNotifications","1");
  } else if(safeRecordId.startsWith("opp_")){
    params.set("openOpportunity",safeRecordId);
  } else if(
    safeRecordId.startsWith("coop_")
    || type==="cooperation_request"
    || type==="cooperation_response"
  ){
    if(safeRecordId)params.set("openCooperation",safeRecordId);
    else params.set("openNotifications","1");
  } else if(
    type==="client_request"
    || type==="owner_offer"
    || type==="missing_data"
    || type==="operation"
    || type==="system"
    || String(safeRecordId).startsWith("op_")
  ){
    params.set("openOperation",safeRecordId);
  } else params.set("openMatch",safeRecordId);
  return `/?${params.toString()}`;
}

function parseFcmFailure(payload,status) {
  const error=payload&&payload.error||{};
  const details=Array.isArray(error.details)?error.details:[];
  const fcmDetail=details.find(item=>String(item&&item["@type"]||"").includes("FcmError"))||{};
  const code=cleanText(fcmDetail.errorCode||error.status||"",80);
  const staleToken=code==="UNREGISTERED"||code==="INVALID_ARGUMENT"||status===404;
  return {code:code||`HTTP_${status}`,message:cleanText(error.message||`FCM HTTP ${status}`,300),staleToken};
}

async function disableStaleFcmDevice({projectId,officeId,deviceId,accessToken,reason}) {
  const now=new Date();
  await setFirestoreDocument({projectId,segments:["offices",officeId,"devices",deviceId],accessToken,fields:{
    enabled:firestoreBoolean(false),disabledReason:firestoreString(cleanText(reason,120)||"invalid_fcm_token"),
    lastErrorAt:firestoreTimestamp(now),updatedAt:firestoreTimestamp(now)
  }}).catch(error=>console.warn("[iaqar-fcm] stale token cleanup failed",error&&error.message));
}

// خريطة نوع الإشعار إلى فئة التفضيلات. نسخة مطابقة موجودة في
// public/js/office-domain.js، والاختباران يتحققان من الجدول نفسه فأي اختلاف يفشل البناء.
// لا يمكن للعامل أن يستورد من public/ دون إضافة خطوة بناء.
export const PUSH_TYPE_NOTIFICATION_CATEGORIES = Object.freeze({
  match: "matchNotifications",
  deal: "matchNotifications",
  client_request: "ownerCustomerNotifications",
  owner_offer: "ownerCustomerNotifications",
  intake: "ownerCustomerNotifications",
  missing_data: "ownerCustomerNotifications",
  cooperation: "cooperationNotifications",
  cooperation_request: "cooperationNotifications",
  cooperation_response: "cooperationNotifications",
  message: "messageNotifications",
  conversation: "messageNotifications",
  appointment: "appointmentNotifications",
  followup: "appointmentNotifications",
  viewing: "appointmentNotifications",
  operation: "systemNotifications",
  system: "systemNotifications"
});

// أنواع طلبها الوسيط بنفسه، فلا تُحجب بأي تفضيل.
export const ALWAYS_ALLOWED_PUSH_TYPES = Object.freeze(["notification_test"]);

export function notificationCategoryForPushType(type) {
  const key=String(type||"").trim().toLowerCase();
  return PUSH_TYPE_NOTIFICATION_CATEGORIES[key]||"systemNotifications";
}

/** غياب المستند يعني "كل الفئات مفعّلة"، فلا تتغير سلوك المكاتب القائمة. */
export function notificationCategoryAllowed(type,preferences) {
  if(ALWAYS_ALLOWED_PUSH_TYPES.includes(String(type||"").trim().toLowerCase()))return true;
  const source=preferences&&typeof preferences==="object"?preferences:{};
  const value=source[notificationCategoryForPushType(type)];
  return value!==false;
}

async function readOfficeNotificationPreferences({projectId,officeId,accessToken}) {
  try{
    const document=await getFirestoreDocument({
      projectId,segments:["offices",officeId,"officeSettings","notifications"],accessToken,allowMissing:true
    });
    return document?firestoreFieldsToJs(document.fields||{}):{};
  }catch(error){
    // تعذر قراءة التفضيل لا يجوز أن يُسكت إشعارًا مطلوبًا.
    console.warn("[iaqar-fcm] notification preferences read failed",error&&error.message);
    return {};
  }
}

async function sendOfficePush({projectId,officeId,title,body,type="match",recordId="",assignedBrokerId="",accessToken,env=null}) {
  const preferences=await readOfficeNotificationPreferences({projectId,officeId,accessToken});
  if(!notificationCategoryAllowed(type,preferences)){
    return {registered:0,sent:0,failed:0,disabled:0,skipped:true,reason:"notifications_disabled",category:notificationCategoryForPushType(type)};
  }
  const devices=await listCollectionDocuments({projectId,segments:["offices",officeId,"devices"],accessToken,pageSize:100});
  const brokerFilter=String(assignedBrokerId||"").trim();
  const activeDevices=devices.map(doc=>{
    const value=firestoreFieldsToJs(doc.fields||{});
    return {
      deviceId:decodeURIComponent(String(doc.name||"").split("/").pop()||""),
      ...value,
      registrationId:value.fcmRegistrationId||value.fcmToken||"",
      registrationType:value.registrationType==="fid"?"fid":value.registrationType==="webpush"?"webpush":"token"
    };
  }).filter(device=>{
    if(device.enabled===false||!device.registrationId)return false;
    // Assigned broker: prefer devices owned by that uid; if none match, fall back to office queue.
    return true;
  });
  const brokerDevices=brokerFilter
    ? activeDevices.filter(device=>String(device.userUid||"")===brokerFilter)
    : [];
  const targetDevices=brokerDevices.length?brokerDevices:activeDevices;
  const summary={registered:targetDevices.length,sent:0,failed:0,disabled:0,brokerFiltered:Boolean(brokerFilter&&brokerDevices.length)};
  for(const device of targetDevices){
    try{
      await sendFcmMessage({projectId,registrationId:device.registrationId,registrationType:device.registrationType,title,body,type,recordId,officeId,accessToken,env});
      summary.sent+=1;
    }catch(error){
      summary.failed+=1;
      console.warn("[iaqar-fcm] send failed",error&&error.message);
      if(error&&error.staleToken&&device.deviceId){
        summary.disabled+=1;
        await disableStaleFcmDevice({projectId,officeId,deviceId:device.deviceId,accessToken,reason:error.fcmCode||"invalid_fcm_token"});
      }
    }
  }
  return summary;
}

function configureWebPushVapid(env) {
  const publicKey = cleanText(env.FCM_WEB_PUSH_VAPID_KEY, 200);
  const privateKey = cleanText(env.FCM_VAPID_PRIVATE_KEY, 200);
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(`mailto:staging@${env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID}.web`, publicKey, privateKey);
  return true;
}

async function sendWebPushNotification({ env, subscriptionJson, title, body, type = "match", recordId = "", officeId = "" }) {
  if (!configureWebPushVapid(env)) throw new Error("Web Push VAPID keys are not configured");
  const subscription = JSON.parse(String(subscriptionJson || ""));
  const relativeLink = buildNotificationLink({ officeId, type, recordId });
  const link = new URL(relativeLink, DEFAULT_APP_ORIGIN).href;
  await webpush.sendNotification(subscription, JSON.stringify({
    notification: { title: String(title || "مكاتب عقارية ذكية"), body: String(body || "لديك تنبيه جديد") },
    data: { type: String(type), recordId: String(recordId || ""), officeId: String(officeId), url: link }
  }));
  return { ok: true };
}

function buildFcmTarget(registrationId,registrationType="fid") {
  const id=cleanText(registrationId,4096);
  if(!id)throw new Error("FCM registration ID is required");
  if(registrationType==="webpush")return { webpush: {} };
  return registrationType==="fid"?{fid:id}:{token:id};
}

function buildFcmHttpMessage({registrationId,registrationType="fid",title,body,type="match",recordId="",officeId,deliveryId=""}) {
  const relativeLink=buildNotificationLink({officeId,type,recordId});
  const link=new URL(relativeLink,DEFAULT_APP_ORIGIN).href;
  const finalDeliveryId=deliveryId||`push_${Date.now()}_${crypto.randomUUID().slice(0,8)}`;
  const target=buildFcmTarget(registrationId,registrationType);
  return {message:{
    ...target,
    notification:{title:String(title||"مكاتب عقارية ذكية"),body:String(body||"لديك تنبيه جديد")},
    data:{type:String(type),recordId:String(recordId||""),matchId:type==="match"?String(recordId||""):"",dealId:type==="deal"?String(recordId||""):"",officeId:String(officeId),url:link,deliveryId:finalDeliveryId},
    webpush:{
      headers:{Urgency:type==="match"?"high":"normal"},
      notification:{icon:`${DEFAULT_APP_ORIGIN}/icons/icon-192.png`,badge:`${DEFAULT_APP_ORIGIN}/icons/icon-192.png`,dir:"rtl",lang:"ar",tag:String(recordId||finalDeliveryId),renotify:true},
      fcm_options:{link}
    }
  }};
}

async function sendFcmMessage({projectId,registrationId,registrationType="fid",title,body,type="match",recordId="",officeId,accessToken,env=null}) {
  if(registrationType==="webpush"){
    await sendWebPushNotification({env,subscriptionJson:registrationId,title,body,type,recordId,officeId});
    return { name: "webpush" };
  }
  const response=await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,{
    method:"POST",
    headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},
    body:JSON.stringify(buildFcmHttpMessage({registrationId,registrationType,title,body,type,recordId,officeId}))
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok){
    const failure=parseFcmFailure(payload,response.status);
    const error=new Error(failure.message);
    error.fcmCode=failure.code;
    error.staleToken=failure.staleToken;
    throw error;
  }
  return payload;
}

async function getFcmStatus(request,url,env,requestId) {
  assertFirebaseSecrets(env);
  const officeId=normalizeOfficeId(url.searchParams.get("officeId"));
  if(!officeId)throw appError("office_id_required",400,"officeId مطلوب");
  await authorizeOfficeRequest(request,env,officeId,"member");
  const projectId=env.FIREBASE_PROJECT_ID||DEFAULT_PROJECT_ID,accessToken=await getGoogleAccessToken(env);
  const devices=await listCollectionDocuments({projectId,segments:["offices",officeId,"devices"],accessToken,pageSize:100});
  const parsed=devices.map(doc=>firestoreFieldsToJs(doc.fields||{}));
  return jsonResponse({ok:true,officeId,registeredDevices:parsed.length,activeDevices:parsed.filter(item=>item.enabled!==false&&(item.fcmRegistrationId||item.fcmToken)).length,requestId});
}

async function registerFcmDevice(request,env,requestId) {
  assertFirebaseSecrets(env); const body=await request.json().catch(()=>({}));
  const officeId=normalizeOfficeId(body.officeId);
  let registrationType=body.registrationType==="fid"?"fid":body.registrationType==="webpush"?"webpush":"token";
  let registrationId=cleanText(body.fcmRegistrationId||body.fcmToken,4096);
  if(body.pushSubscription&&typeof body.pushSubscription==="object"&&body.pushSubscription.endpoint){
    registrationType="webpush";
    registrationId=cleanText(JSON.stringify(body.pushSubscription),4096);
  }
  if(!officeId||!registrationId)throw appError("device_data_missing",400,"بيانات الجهاز غير مكتملة");
  const identity=await authorizeOfficeRequest(request,env,officeId,"member");
  const projectId=env.FIREBASE_PROJECT_ID||DEFAULT_PROJECT_ID,accessToken=await getGoogleAccessToken(env),installationId=cleanText(body.installationId,160),deviceSeed=installationId?`${officeId}|${installationId}`:registrationId,deviceId=`web_${(await sha256Hex(deviceSeed)).slice(0,36)}`,now=new Date();
  const existing=await getFirestoreDocument({projectId,segments:["offices",officeId,"devices",deviceId],accessToken,allowMissing:true});
  const fields={
    officeId:firestoreString(officeId),fcmRegistrationId:firestoreString(registrationId),registrationType:firestoreString(registrationType),fcmToken:firestoreString(registrationType==="token"?registrationId:""),platform:firestoreString("web"),enabled:firestoreBoolean(true),
    userUid:firestoreOptionalString(identity.uid),userAgent:firestoreOptionalString(cleanText(body.userAgent,500)),
    deviceName:firestoreOptionalString(cleanText(body.deviceName,120)),installationId:firestoreOptionalString(installationId),language:firestoreOptionalString(cleanText(body.language,40)),
    notificationPermission:firestoreOptionalString(cleanText(body.notificationPermission,30)),appVersion:firestoreOptionalString(cleanText(body.appVersion,60)),
    lastSeenAt:firestoreTimestamp(now),updatedAt:firestoreTimestamp(now),updatedByUid:firestoreOptionalString(identity.uid),disabledReason:firestoreString("")
  };
  if(!existing)fields.createdAt=firestoreTimestamp(now);
  await setFirestoreDocument({projectId,segments:["offices",officeId,"devices",deviceId],accessToken,fields});
  return jsonResponse({ok:true,deviceId,enabled:true,requestId});
}

async function unregisterFcmDevice(request,env,requestId) {
  assertFirebaseSecrets(env); const body=await request.json().catch(()=>({}));
  const officeId=normalizeOfficeId(body.officeId);
  let registrationType=body.registrationType==="fid"?"fid":body.registrationType==="webpush"?"webpush":"token";
  let registrationId=cleanText(body.fcmRegistrationId||body.fcmToken,4096);
  if(body.pushSubscription&&typeof body.pushSubscription==="object"&&body.pushSubscription.endpoint){
    registrationType="webpush";
    registrationId=cleanText(JSON.stringify(body.pushSubscription),4096);
  }
  if(!officeId||!registrationId)throw appError("device_data_missing",400,"بيانات الجهاز غير مكتملة");
  const identity=await authorizeOfficeRequest(request,env,officeId,"member");
  const projectId=env.FIREBASE_PROJECT_ID||DEFAULT_PROJECT_ID,accessToken=await getGoogleAccessToken(env),installationId=cleanText(body.installationId,160),deviceSeed=installationId?`${officeId}|${installationId}`:registrationId,deviceId=`web_${(await sha256Hex(deviceSeed)).slice(0,36)}`,now=new Date();
  await setFirestoreDocument({projectId,segments:["offices",officeId,"devices",deviceId],accessToken,fields:{officeId:firestoreString(officeId),fcmRegistrationId:firestoreString(registrationId),registrationType:firestoreString(registrationType),fcmToken:firestoreString(registrationType==="token"?registrationId:""),platform:firestoreString("web"),enabled:firestoreBoolean(false),disabledReason:firestoreString("disabled_by_user"),installationId:firestoreOptionalString(installationId),userUid:firestoreOptionalString(identity.uid),updatedAt:firestoreTimestamp(now),updatedByUid:firestoreOptionalString(identity.uid)}});
  return jsonResponse({ok:true,deviceId,enabled:false,requestId});
}

async function sendFcmTestNotification(request,env,requestId) {
  assertFirebaseSecrets(env); const body=await request.json().catch(()=>({}));
  const officeId=normalizeOfficeId(body.officeId);
  let registrationType=body.registrationType==="fid"?"fid":body.registrationType==="webpush"?"webpush":"token";
  let registrationId=cleanText(body.fcmRegistrationId||body.fcmToken,4096);
  if(body.pushSubscription&&typeof body.pushSubscription==="object"&&body.pushSubscription.endpoint){
    registrationType="webpush";
    registrationId=cleanText(JSON.stringify(body.pushSubscription),4096);
  }
  const installationId=cleanText(body.installationId,160);
  if(!officeId||!registrationId)throw appError("device_data_missing",400,"بيانات الجهاز غير مكتملة");
  await authorizeOfficeRequest(request,env,officeId,"member");
  const projectId=env.FIREBASE_PROJECT_ID||DEFAULT_PROJECT_ID,accessToken=await getGoogleAccessToken(env),deviceSeed=installationId?`${officeId}|${installationId}`:registrationId,deviceId=`web_${(await sha256Hex(deviceSeed)).slice(0,36)}`;
  const deviceDoc=await getFirestoreDocument({projectId,segments:["offices",officeId,"devices",deviceId],accessToken,allowMissing:true});
  const device=deviceDoc?firestoreFieldsToJs(deviceDoc.fields||{}):null;
  const savedRegistration=device&&(device.fcmRegistrationId||device.fcmToken||"");
  if(!device||device.enabled===false||savedRegistration!==registrationId)throw appError("device_not_registered",409,"الجهاز غير مسجل للإشعارات");
  try{
    await sendFcmMessage({projectId,registrationId,registrationType,title:"تم تفعيل إشعارات المكتب",body:"سيصلك تنبيه عند وجود مطابقة أو متابعة جديدة.",type:"notification_test",recordId:`test_${Date.now()}`,officeId,accessToken,env});
  }catch(error){
    if(error&&error.staleToken)await disableStaleFcmDevice({projectId,officeId,deviceId,accessToken,reason:error.fcmCode||"invalid_fcm_token"});
    throw appError("fcm_test_failed",502,"تم تسجيل الجهاز لكن تعذر وصول الإشعار التجريبي");
  }
  return jsonResponse({ok:true,officeId,registered:1,sent:1,failed:0,disabled:0,requestId});
}

function workflowCollection(recordType) {
  return recordType === "deal" ? "deals" : "matches";
}

async function addWorkflowTimeline({projectId,officeId,recordType,recordId,eventType,stage,note="",identity={},accessToken,createdAt=new Date()}) {
  const eventId=`evt_${createdAt.getTime()}_${crypto.randomUUID().slice(0,8)}`;
  const collection=workflowCollection(recordType);
  await setFirestoreDocument({projectId,segments:["offices",officeId,collection,recordId,"timeline",eventId],accessToken,fields:{
    officeId:firestoreString(officeId),recordType:firestoreString(recordType),recordId:firestoreString(recordId),
    eventType:firestoreString(eventType),stage:firestoreString(stage),note:firestoreOptionalString(cleanText(note,1000)),
    createdAt:firestoreTimestamp(createdAt),createdByUid:firestoreOptionalString(identity.uid)
  }});
  return eventId;
}

async function createDealFromMatch({projectId,officeId,matchId,matchData,identity,accessToken,now,commissionExpected=0,startStage="negotiation"}) {
  const dealId=matchData.dealId || `deal_${matchId.replace(/^mat_/,"")}`;
  const stage=DEAL_STAGE_ORDER.includes(startStage)?startStage:"contact";
  const health=calculateDealHealth({stage,status:"open",updatedAt:now});
  await setFirestoreDocument({projectId,segments:["offices",officeId,"deals",dealId],accessToken,fields:{
    schemaVersion:firestoreInteger(5),officeId:firestoreString(officeId),dealId:firestoreString(dealId),matchId:firestoreString(matchId),
    clientRequestId:firestoreOptionalString(matchData.clientRequestId),ownerOfferId:firestoreOptionalString(matchData.ownerOfferId),matchGroupId:firestoreOptionalString(matchData.matchGroupId||matchData.clientRequestId),
    status:firestoreString("open"),workflowStage:firestoreString(stage),stageLabel:firestoreString(DEAL_STAGE_LABELS[stage]),
    nextAction:firestoreString(DEAL_NEXT_ACTION_LABELS[stage]),healthScore:firestoreInteger(health.score),healthKey:firestoreString(health.key),healthLabel:firestoreString(health.label),
    score:matchData.score?firestoreInteger(matchData.score):null,closingReadinessScore:matchData.closingReadinessScore?firestoreInteger(matchData.closingReadinessScore):null,
    priority:firestoreOptionalString(matchData.priority),district:firestoreOptionalString(matchData.district),propertyType:firestoreOptionalString(matchData.propertyType),
    assignedToUid:firestoreOptionalString(identity.uid),commissionExpected:commissionExpected?firestoreInteger(Number(commissionExpected)):null,
    nextFollowUpAt:firestoreTimestamp(defaultNextFollowUp(stage==="closing"?8:24)),followUpCount:firestoreInteger(0),
    createdAt:firestoreTimestamp(now),updatedAt:firestoreTimestamp(now)
  }});
  await setFirestoreDocument({projectId,segments:["offices",officeId,"matches",matchId],accessToken,fields:{
    status:firestoreString("negotiation"),statusLabel:firestoreString(MATCH_STATUS_LABELS.negotiation),workflowStage:firestoreString("negotiation"),
    nextAction:firestoreString(MATCH_NEXT_ACTION_LABELS.negotiation),dealId:firestoreString(dealId),updatedAt:firestoreTimestamp(now)
  }});
  await addWorkflowTimeline({projectId,officeId,recordType:"deal",recordId:dealId,eventType:"deal_created",stage,note:"تم إنشاء الصفقة من المطابقة",identity,accessToken,createdAt:now});
  return dealId;
}

async function finalizeDealAndCloseSiblings({projectId,officeId,dealId,dealData,identity,accessToken,now,note="",commissionActual=0}) {
  const matchId=dealData.matchId || "";
  let matchData={};
  if(matchId){
    const matchDoc=await getFirestoreDocument({projectId,segments:["offices",officeId,"matches",matchId],accessToken,allowMissing:true});
    matchData=matchDoc?firestoreFieldsToJs(matchDoc.fields||{}):{};
  }
  await setFirestoreDocument({projectId,segments:["offices",officeId,"deals",dealId],accessToken,fields:{
    status:firestoreString("closed"),workflowStage:firestoreString("closed"),stageLabel:firestoreString(DEAL_STAGE_LABELS.closed),
    nextAction:firestoreString(DEAL_NEXT_ACTION_LABELS.closed),healthScore:firestoreInteger(100),healthKey:firestoreString("excellent"),healthLabel:firestoreString(DEAL_HEALTH_LABELS.excellent),
    commissionActual:commissionActual?firestoreInteger(Number(commissionActual)):null,closedAt:firestoreTimestamp(now),updatedAt:firestoreTimestamp(now),lastNote:firestoreOptionalString(note),attentionRequired:firestoreBoolean(false)
  }});
  await addWorkflowTimeline({projectId,officeId,recordType:"deal",recordId:dealId,eventType:"deal_closed",stage:"closed",note:note||"تمت الصفقة",identity,accessToken,createdAt:now});

  if(matchId){
    await setFirestoreDocument({projectId,segments:["offices",officeId,"matches",matchId],accessToken,fields:{
      status:firestoreString("completed"),statusLabel:firestoreString(MATCH_STATUS_LABELS.completed),workflowStage:firestoreString("completed"),
      nextAction:firestoreString(MATCH_NEXT_ACTION_LABELS.completed),closingReadinessScore:firestoreInteger(100),closingReadinessKey:firestoreString("very_high"),closingReadinessLabel:firestoreString(READINESS_LABELS.very_high),
      completedAt:firestoreTimestamp(now),updatedAt:firestoreTimestamp(now),closeReason:firestoreString("تمت الصفقة مع هذا العقار"),attentionRequired:firestoreBoolean(false)
    }});
    await addWorkflowTimeline({projectId,officeId,recordType:"match",recordId:matchId,eventType:"match_completed",stage:"completed",note:"تمت الصفقة مع هذا العقار",identity,accessToken,createdAt:now});
  }

  const groupId=dealData.matchGroupId||dealData.clientRequestId||matchData.matchGroupId||matchData.clientRequestId||"";
  let closedSiblings=0;
  if(groupId){
    const docs=await listCollectionDocuments({projectId,segments:["offices",officeId,"matches"],accessToken,pageSize:300});
    for(const doc of docs){
      const siblingId=decodeURIComponent(String(doc.name||"").split("/").pop()||"");
      if(!siblingId||siblingId===matchId) continue;
      const sibling=firestoreFieldsToJs(doc.fields||{});
      const siblingGroup=sibling.matchGroupId||sibling.clientRequestId||"";
      if(siblingGroup!==groupId) continue;
      const siblingStatus=normalizeMatchStatus(sibling.status);
      if(["completed","closed"].includes(siblingStatus)) continue;
      closedSiblings+=1;
      const reason="تمت الصفقة مع عقار آخر";
      await setFirestoreDocument({projectId,segments:["offices",officeId,"matches",siblingId],accessToken,fields:{
        status:firestoreString("closed"),statusLabel:firestoreString(MATCH_STATUS_LABELS.closed),workflowStage:firestoreString("closed"),
        nextAction:firestoreString(MATCH_NEXT_ACTION_LABELS.closed),closingReadinessScore:firestoreInteger(0),closingReadinessKey:firestoreString("low"),closingReadinessLabel:firestoreString(READINESS_LABELS.low),
        closeReason:firestoreString(reason),closedAt:firestoreTimestamp(now),closedByMatchId:firestoreString(matchId),updatedAt:firestoreTimestamp(now),attentionRequired:firestoreBoolean(false)
      }});
      await addWorkflowTimeline({projectId,officeId,recordType:"match",recordId:siblingId,eventType:"match_auto_closed",stage:"closed",note:reason,identity,accessToken,createdAt:now});
      if(sibling.dealId){
        await setFirestoreDocument({projectId,segments:["offices",officeId,"deals",sibling.dealId],accessToken,fields:{
          status:firestoreString("lost"),workflowStage:firestoreString("lost"),stageLabel:firestoreString(DEAL_STAGE_LABELS.lost),
          nextAction:firestoreString(DEAL_NEXT_ACTION_LABELS.lost),healthScore:firestoreInteger(10),healthKey:firestoreString("at_risk"),healthLabel:firestoreString(DEAL_HEALTH_LABELS.at_risk),
          lostReason:firestoreString(reason),updatedAt:firestoreTimestamp(now),attentionRequired:firestoreBoolean(false)
        }});
        await addWorkflowTimeline({projectId,officeId,recordType:"deal",recordId:sibling.dealId,eventType:"deal_auto_closed",stage:"lost",note:reason,identity,accessToken,createdAt:now});
      }
    }
  }

  const clientRequestId=dealData.clientRequestId||matchData.clientRequestId||"";
  const ownerOfferId=dealData.ownerOfferId||matchData.ownerOfferId||"";
  if(clientRequestId){
    await setFirestoreDocument({projectId,segments:["offices",officeId,"clients",clientRequestId],accessToken,fields:{status:firestoreString("fulfilled"),workflowStage:firestoreString("closed"),fulfilledAt:firestoreTimestamp(now),updatedAt:firestoreTimestamp(now)}}).catch(()=>{});
  }
  if(ownerOfferId){
    await setFirestoreDocument({projectId,segments:["offices",officeId,"owners",ownerOfferId],accessToken,fields:{status:firestoreString("closed"),workflowStage:firestoreString("sold"),closedAt:firestoreTimestamp(now),updatedAt:firestoreTimestamp(now)}}).catch(()=>{});
  }
  return {closedSiblings,matchId};
}

async function handleWorkflowAction(request,env,requestId) {
  assertFirebaseSecrets(env);
  const body=await request.json().catch(()=>({}));
  const officeId=normalizeOfficeId(body.officeId),action=cleanText(body.action,50),recordId=cleanText(body.recordId,160);
  if(!officeId||!action||!recordId)throw appError("workflow_data_missing",400,"بيانات الإجراء غير مكتملة");
  const identity=await authorizeOfficeRequest(request,env,officeId,"member");
  const projectId=env.FIREBASE_PROJECT_ID||DEFAULT_PROJECT_ID,accessToken=await getGoogleAccessToken(env),now=new Date();
  const note=cleanText(body.note,1000);
  const requestedNext=body.nextFollowUpAt?new Date(body.nextFollowUpAt):null;
  const nextFollowUpAt=requestedNext&&!Number.isNaN(requestedNext.getTime())?requestedNext:defaultNextFollowUp(24);

  if(action==="start_match"||action==="advance_match"){
    const matchDoc=await getFirestoreDocument({projectId,segments:["offices",officeId,"matches",recordId],accessToken});
    const m=firestoreFieldsToJs(matchDoc.fields||{});
    const current=normalizeMatchStatus(m.status);
    if(current==="completed"||current==="closed") return jsonResponse({ok:true,status:current,statusLabel:MATCH_STATUS_LABELS[current],requestId});
    let next=current;
    if(action==="start_match"&&["active","new"].includes(current)) next="active";
    else if(current==="active") next="waiting_response";
    else if(current==="waiting_response") next="viewing";
    else if(current==="viewing") next="negotiation";
    else if(current==="negotiation") next="negotiation";
    const readiness=calculateClosingReadiness({matchScore:m.score,status:next});
    const followUpCount=Number(m.followUpCount||0)+1;
    const fields={
      status:firestoreString(next),statusLabel:firestoreString(MATCH_STATUS_LABELS[next]),workflowStage:firestoreString(next),
      nextAction:firestoreString(MATCH_NEXT_ACTION_LABELS[next]),closingReadinessScore:firestoreInteger(readiness.score),closingReadinessKey:firestoreString(readiness.key),closingReadinessLabel:firestoreString(readiness.label),
      lastFollowUpAt:firestoreTimestamp(now),nextFollowUpAt:firestoreTimestamp(nextFollowUpAt),followUpCount:firestoreInteger(followUpCount),
      lastNote:firestoreOptionalString(note),updatedAt:firestoreTimestamp(now),assignedToUid:firestoreOptionalString(identity.uid),attentionRequired:firestoreBoolean(false)
    };
    if(next==="viewing") fields.viewingAt=firestoreTimestamp(nextFollowUpAt);
    await setFirestoreDocument({projectId,segments:["offices",officeId,"matches",recordId],accessToken,fields});
    await addWorkflowTimeline({projectId,officeId,recordType:"match",recordId,eventType:current===next?"follow_up":"status_changed",stage:next,note:note||`انتقلت المطابقة إلى ${MATCH_STATUS_LABELS[next]}`,identity,accessToken,createdAt:now});
    let dealId=m.dealId||"";
    if(next==="negotiation"&&!dealId){
      dealId=await createDealFromMatch({projectId,officeId,matchId:recordId,matchData:{...m,status:next,closingReadinessScore:readiness.score},identity,accessToken,now,commissionExpected:Number(body.commissionExpected||0),startStage:"negotiation"});
    }
    return jsonResponse({ok:true,status:next,statusLabel:MATCH_STATUS_LABELS[next],nextAction:MATCH_NEXT_ACTION_LABELS[next],readiness,dealId,requestId});
  }

  if(action==="add_match_followup"){
    if(!note&&!body.nextFollowUpAt)throw appError("followup_data_required",400,"اكتب ملاحظة أو حدد موعد المتابعة");
    const matchDoc=await getFirestoreDocument({projectId,segments:["offices",officeId,"matches",recordId],accessToken});
    const m=firestoreFieldsToJs(matchDoc.fields||{});
    const status=normalizeMatchStatus(m.status);
    const count=Number(m.followUpCount||0)+1;
    await setFirestoreDocument({projectId,segments:["offices",officeId,"matches",recordId],accessToken,fields:{
      lastFollowUpAt:firestoreTimestamp(now),nextFollowUpAt:firestoreTimestamp(nextFollowUpAt),followUpCount:firestoreInteger(count),
      lastNote:firestoreOptionalString(note),updatedAt:firestoreTimestamp(now),attentionRequired:firestoreBoolean(false),assignedToUid:firestoreOptionalString(identity.uid)
    }});
    await addWorkflowTimeline({projectId,officeId,recordType:"match",recordId,eventType:"follow_up_added",stage:status,note:note||"تم تحديد موعد متابعة",identity,accessToken,createdAt:now});
    return jsonResponse({ok:true,status,nextFollowUpAt:nextFollowUpAt.toISOString(),followUpCount:count,requestId});
  }

  if(action==="close_match"){
    const matchDoc=await getFirestoreDocument({projectId,segments:["offices",officeId,"matches",recordId],accessToken});
    const m=firestoreFieldsToJs(matchDoc.fields||{});
    const current=normalizeMatchStatus(m.status);
    if(current==="completed") return jsonResponse({ok:true,status:"completed",statusLabel:MATCH_STATUS_LABELS.completed,requestId});
    if(current==="closed") return jsonResponse({ok:true,status:"closed",statusLabel:MATCH_STATUS_LABELS.closed,requestId});
    const reason=note||"أُغلقت المطابقة يدويًا";
    await setFirestoreDocument({projectId,segments:["offices",officeId,"matches",recordId],accessToken,fields:{
      status:firestoreString("closed"),statusLabel:firestoreString(MATCH_STATUS_LABELS.closed),workflowStage:firestoreString("closed"),
      nextAction:firestoreString(MATCH_NEXT_ACTION_LABELS.closed),closingReadinessScore:firestoreInteger(0),closingReadinessKey:firestoreString("low"),closingReadinessLabel:firestoreString(READINESS_LABELS.low),
      closeReason:firestoreString(reason),closedAt:firestoreTimestamp(now),updatedAt:firestoreTimestamp(now),attentionRequired:firestoreBoolean(false)
    }});
    await addWorkflowTimeline({projectId,officeId,recordType:"match",recordId,eventType:"match_closed",stage:"closed",note:reason,identity,accessToken,createdAt:now});
    if(m.dealId){
      const linkedDeal=await getFirestoreDocument({projectId,segments:["offices",officeId,"deals",m.dealId],accessToken,allowMissing:true});
      const linked=linkedDeal?firestoreFieldsToJs(linkedDeal.fields||{}):{};
      if(linkedDeal&&!['closed','lost'].includes(linked.status)){
        await setFirestoreDocument({projectId,segments:["offices",officeId,"deals",m.dealId],accessToken,fields:{
          status:firestoreString("lost"),workflowStage:firestoreString("lost"),stageLabel:firestoreString(DEAL_STAGE_LABELS.lost),nextAction:firestoreString(DEAL_NEXT_ACTION_LABELS.lost),
          healthScore:firestoreInteger(10),healthKey:firestoreString("at_risk"),healthLabel:firestoreString(DEAL_HEALTH_LABELS.at_risk),lostReason:firestoreString(reason),updatedAt:firestoreTimestamp(now),attentionRequired:firestoreBoolean(false)
        }});
        await addWorkflowTimeline({projectId,officeId,recordType:"deal",recordId:m.dealId,eventType:"deal_lost",stage:"lost",note:reason,identity,accessToken,createdAt:now});
      }
    }
    return jsonResponse({ok:true,status:"closed",statusLabel:MATCH_STATUS_LABELS.closed,requestId});
  }

  if(action==="create_deal"){
    const match=await getFirestoreDocument({projectId,segments:["offices",officeId,"matches",recordId],accessToken});
    const m=firestoreFieldsToJs(match.fields||{});
    const matchStatus=normalizeMatchStatus(m.status);
    if(["completed","closed"].includes(matchStatus)) throw appError("match_not_open",409,"لا يمكن إنشاء صفقة من مطابقة مغلقة");
    if(m.dealId) return jsonResponse({ok:true,dealId:m.dealId,status:"open",workflowStage:matchStatus==="negotiation"?"negotiation":"contact",requestId});
    const dealId=await createDealFromMatch({projectId,officeId,matchId:recordId,matchData:m,identity,accessToken,now,commissionExpected:Number(body.commissionExpected||0),startStage:matchStatus==="negotiation"?"negotiation":"contact"});
    return jsonResponse({ok:true,dealId,status:"open",workflowStage:matchStatus==="negotiation"?"negotiation":"contact",requestId});
  }

  if(action==="advance_deal"||action==="set_deal_stage"){
    const deal=await getFirestoreDocument({projectId,segments:["offices",officeId,"deals",recordId],accessToken});
    const d=firestoreFieldsToJs(deal.fields||{});
    if(d.status==="closed"||d.workflowStage==="closed") return jsonResponse({ok:true,status:"closed",workflowStage:"closed",stageLabel:DEAL_STAGE_LABELS.closed,nextAction:DEAL_NEXT_ACTION_LABELS.closed,closedSiblings:0,requestId});
    if(d.status==="lost"||d.workflowStage==="lost") return jsonResponse({ok:true,status:"lost",workflowStage:"lost",stageLabel:DEAL_STAGE_LABELS.lost,nextAction:DEAL_NEXT_ACTION_LABELS.lost,requestId});
    const current=DEAL_STAGE_ORDER.includes(d.workflowStage)?d.workflowStage:"contact";
    const requested=action==="set_deal_stage"?cleanText(body.stage,40):nextDealStage(current);
    if(!DEAL_STAGE_ORDER.includes(requested))throw appError("deal_stage_invalid",400,"مرحلة الصفقة غير صحيحة");
    if(requested==="closed"){
      const closed=await finalizeDealAndCloseSiblings({projectId,officeId,dealId:recordId,dealData:d,identity,accessToken,now,note,commissionActual:Number(body.commissionActual||0)});
      return jsonResponse({ok:true,status:"closed",workflowStage:"closed",stageLabel:DEAL_STAGE_LABELS.closed,nextAction:DEAL_NEXT_ACTION_LABELS.closed,closedSiblings:closed.closedSiblings,requestId});
    }
    const health=calculateDealHealth({stage:requested,status:"open",updatedAt:now,nextFollowUpAt});
    const count=Number(d.followUpCount||0)+1;
    await setFirestoreDocument({projectId,segments:["offices",officeId,"deals",recordId],accessToken,fields:{
      status:firestoreString("open"),workflowStage:firestoreString(requested),stageLabel:firestoreString(DEAL_STAGE_LABELS[requested]),nextAction:firestoreString(DEAL_NEXT_ACTION_LABELS[requested]),
      healthScore:firestoreInteger(health.score),healthKey:firestoreString(health.key),healthLabel:firestoreString(health.label),
      lastFollowUpAt:firestoreTimestamp(now),nextFollowUpAt:firestoreTimestamp(nextFollowUpAt),followUpCount:firestoreInteger(count),
      lastNote:firestoreOptionalString(note),updatedAt:firestoreTimestamp(now),assignedToUid:firestoreOptionalString(identity.uid),attentionRequired:firestoreBoolean(false)
    }});
    await addWorkflowTimeline({projectId,officeId,recordType:"deal",recordId,eventType:"stage_changed",stage:requested,note:note||`انتقلت الصفقة إلى ${DEAL_STAGE_LABELS[requested]}`,identity,accessToken,createdAt:now});
    return jsonResponse({ok:true,status:"open",workflowStage:requested,stageLabel:DEAL_STAGE_LABELS[requested],nextAction:DEAL_NEXT_ACTION_LABELS[requested],health,requestId});
  }

  if(action==="add_deal_note"||action==="add_deal_followup"){
    if(!note&&!body.nextFollowUpAt)throw appError("deal_note_required",400,"اكتب ملاحظة أو حدد موعد المتابعة");
    const deal=await getFirestoreDocument({projectId,segments:["offices",officeId,"deals",recordId],accessToken});
    const d=firestoreFieldsToJs(deal.fields||{});
    const count=Number(d.followUpCount||0)+1;
    const health=calculateDealHealth({stage:d.workflowStage||"contact",status:d.status||"open",updatedAt:now,nextFollowUpAt});
    await setFirestoreDocument({projectId,segments:["offices",officeId,"deals",recordId],accessToken,fields:{
      lastNote:firestoreOptionalString(note),lastFollowUpAt:firestoreTimestamp(now),nextFollowUpAt:firestoreTimestamp(nextFollowUpAt),followUpCount:firestoreInteger(count),
      healthScore:firestoreInteger(health.score),healthKey:firestoreString(health.key),healthLabel:firestoreString(health.label),updatedAt:firestoreTimestamp(now),attentionRequired:firestoreBoolean(false)
    }});
    await addWorkflowTimeline({projectId,officeId,recordType:"deal",recordId,eventType:"follow_up_added",stage:d.workflowStage||"follow_up",note:note||"تم تحديد موعد متابعة",identity,accessToken,createdAt:now});
    return jsonResponse({ok:true,status:"noted",nextFollowUpAt:nextFollowUpAt.toISOString(),followUpCount:count,health,requestId});
  }

  if(action==="mark_lost"){
    const reason=note||"تعذّر إكمال الصفقة";
    const deal=await getFirestoreDocument({projectId,segments:["offices",officeId,"deals",recordId],accessToken});
    const d=firestoreFieldsToJs(deal.fields||{});
    if(d.status==="closed"||d.workflowStage==="closed") return jsonResponse({ok:true,status:"closed",requestId});
    if(d.status==="lost"||d.workflowStage==="lost") return jsonResponse({ok:true,status:"lost",requestId});
    await setFirestoreDocument({projectId,segments:["offices",officeId,"deals",recordId],accessToken,fields:{
      status:firestoreString("lost"),workflowStage:firestoreString("lost"),stageLabel:firestoreString(DEAL_STAGE_LABELS.lost),nextAction:firestoreString(DEAL_NEXT_ACTION_LABELS.lost),
      healthScore:firestoreInteger(10),healthKey:firestoreString("at_risk"),healthLabel:firestoreString(DEAL_HEALTH_LABELS.at_risk),lostReason:firestoreString(reason),updatedAt:firestoreTimestamp(now),attentionRequired:firestoreBoolean(false)
    }});
    await addWorkflowTimeline({projectId,officeId,recordType:"deal",recordId,eventType:"deal_lost",stage:"lost",note:reason,identity,accessToken,createdAt:now});
    if(d.matchId){
      const linkedMatch=await getFirestoreDocument({projectId,segments:["offices",officeId,"matches",d.matchId],accessToken,allowMissing:true});
      const linked=linkedMatch?firestoreFieldsToJs(linkedMatch.fields||{}):{};
      const linkedStatus=normalizeMatchStatus(linked.status);
      if(linkedMatch&&!['completed','closed'].includes(linkedStatus)){
        await setFirestoreDocument({projectId,segments:["offices",officeId,"matches",d.matchId],accessToken,fields:{
          status:firestoreString("closed"),statusLabel:firestoreString(MATCH_STATUS_LABELS.closed),workflowStage:firestoreString("closed"),nextAction:firestoreString(MATCH_NEXT_ACTION_LABELS.closed),
          closingReadinessScore:firestoreInteger(0),closingReadinessKey:firestoreString("low"),closingReadinessLabel:firestoreString(READINESS_LABELS.low),closeReason:firestoreString(reason),closedAt:firestoreTimestamp(now),updatedAt:firestoreTimestamp(now),attentionRequired:firestoreBoolean(false)
        }});
        await addWorkflowTimeline({projectId,officeId,recordType:"match",recordId:d.matchId,eventType:"match_closed_after_deal_lost",stage:"closed",note:reason,identity,accessToken,createdAt:now});
      }
    }
    return jsonResponse({ok:true,status:"lost",matchId:d.matchId||"",requestId});
  }

  if(action==="close_deal"){
    const deal=await getFirestoreDocument({projectId,segments:["offices",officeId,"deals",recordId],accessToken});
    const d=firestoreFieldsToJs(deal.fields||{});
    if(d.status==="closed"||d.workflowStage==="closed") return jsonResponse({ok:true,status:"closed",workflowStage:"closed",closedSiblings:0,requestId});
    if(d.status==="lost"||d.workflowStage==="lost") throw appError("deal_not_open",409,"لا يمكن إغلاق صفقة متوقفة");
    const closed=await finalizeDealAndCloseSiblings({projectId,officeId,dealId:recordId,dealData:d,identity,accessToken,now,note,commissionActual:Number(body.commissionActual||0)});
    return jsonResponse({ok:true,status:"closed",workflowStage:"closed",closedSiblings:closed.closedSiblings,requestId});
  }

  // Phase 8: broker-entered financial/note fields — Worker-trusted only (no client deal writes).
  if(action==="update_deal_fields"){
    const deal=await getFirestoreDocument({projectId,segments:["offices",officeId,"deals",recordId],accessToken,allowMissing:true});
    if(!deal) throw appError("deal_not_found",404,"الصفقة غير موجودة");
    const fields={ updatedAt:firestoreTimestamp(now) };
    const finalPrice=Number(body.finalPrice);
    const commissionActual=Number(body.commissionActual);
    const internalNote=cleanText(body.internalNote,1000);
    if(Number.isFinite(finalPrice) && finalPrice >= 0) fields.finalPrice=firestoreInteger(Math.round(finalPrice));
    if(Number.isFinite(commissionActual) && commissionActual >= 0) fields.commissionActual=firestoreInteger(Math.round(commissionActual));
    if(internalNote) fields.internalNote=firestoreString(internalNote);
    if(Object.keys(fields).length <= 1) throw appError("deal_fields_required",400,"لا توجد حقول لتحديثها");
    await setFirestoreDocument({projectId,segments:["offices",officeId,"deals",recordId],accessToken,fields});
    return jsonResponse({ok:true,dealId:recordId,updated:true,requestId});
  }

  throw appError("workflow_action_invalid",400,"الإجراء غير معروف");
}

async function handleWorkflowTimeline(request,url,env,requestId){
  assertFirebaseSecrets(env);
  const officeId=normalizeOfficeId(url.searchParams.get("officeId"));
  const recordType=cleanText(url.searchParams.get("recordType")||"match",20)==="deal"?"deal":"match";
  const recordId=cleanText(url.searchParams.get("recordId"),160);
  if(!officeId||!recordId)throw appError("timeline_data_missing",400,"بيانات سجل النشاط غير مكتملة");
  await authorizeOfficeRequest(request,env,officeId,"member");
  const projectId=env.FIREBASE_PROJECT_ID||DEFAULT_PROJECT_ID,accessToken=await getGoogleAccessToken(env);
  const docs=await listCollectionDocuments({projectId,segments:["offices",officeId,workflowCollection(recordType),recordId,"timeline"],accessToken,pageSize:100});
  const events=docs.map(doc=>{
    const value=firestoreFieldsToJs(doc.fields||{});
    return {id:decodeURIComponent(String(doc.name||"").split("/").pop()||""),eventType:value.eventType||"",stage:value.stage||"",note:value.note||"",createdAt:value.createdAt||""};
  }).sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).slice(0,20);
  return jsonResponse({ok:true,recordType,recordId,events,requestId});
}

async function runFirestoreQuery({projectId,accessToken,structuredQuery}){
  const response=await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`,{
    method:"POST",headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json"},body:JSON.stringify({structuredQuery})
  });
  if(!response.ok){
    const detail=await response.text();
    console.warn("[iaqar-followups] Firestore query failed",response.status,detail);
    throw appError("firestore_query_failed",502,"تعذر فحص المتابعات المستحقة");
  }
  const payload=await response.json();
  return (Array.isArray(payload)?payload:[]).map(row=>row.document).filter(Boolean);
}

async function queryDueWorkflowRecords({projectId,accessToken,collectionId,now}){
  return runFirestoreQuery({projectId,accessToken,structuredQuery:{
    from:[{collectionId,allDescendants:true}],
    where:{fieldFilter:{field:{fieldPath:"nextFollowUpAt"},op:"LESS_THAN_OR_EQUAL",value:{timestampValue:now.toISOString()}}},
    orderBy:[{field:{fieldPath:"nextFollowUpAt"},direction:"ASCENDING"}],
    limit:200
  }});
}

async function processOverdueFollowups(env,scheduledTime=Date.now()){
  if(!hasFirebaseSecrets(env)){
    console.warn("[iaqar-followups] Firebase server secrets are not configured");
    return {ok:false,reason:"firebase_not_configured"};
  }
  const projectId=env.FIREBASE_PROJECT_ID||DEFAULT_PROJECT_ID;
  const accessToken=await getGoogleAccessToken(env);
  const now=new Date(Number(scheduledTime)||Date.now());
  const [matchDocs,dealDocs]=await Promise.all([
    queryDueWorkflowRecords({projectId,accessToken,collectionId:"matches",now}),
    queryDueWorkflowRecords({projectId,accessToken,collectionId:"deals",now})
  ]);
  const records=[...matchDocs.map(document=>({recordType:"match",document})),...dealDocs.map(document=>({recordType:"deal",document}))];
  let notified=0;
  for(const entry of records){
    const value=firestoreFieldsToJs(entry.document.fields||{});
    const status=cleanText(value.status,40);
    if(entry.recordType==="match"&&["completed","closed"].includes(normalizeMatchStatus(status))) continue;
    if(entry.recordType==="deal"&&["closed","lost"].includes(status)) continue;
    const lastNotified=value.followUpNotifiedAt?new Date(value.followUpNotifiedAt).getTime():0;
    if(Number.isFinite(lastNotified)&&now.getTime()-lastNotified<12*3600000) continue;
    const officeId=normalizeOfficeId(value.officeId);
    const recordId=decodeURIComponent(String(entry.document.name||"").split("/").pop()||"");
    if(!officeId||!recordId) continue;
    const collection=workflowCollection(entry.recordType);
    const title=entry.recordType==="match"?"متابعة مطابقة مستحقة":"متابعة صفقة مستحقة";
    const stageText=entry.recordType==="match"?(value.statusLabel||MATCH_STATUS_LABELS[normalizeMatchStatus(status)]):(value.stageLabel||DEAL_STAGE_LABELS[value.workflowStage]||"المتابعة");
    const actionText=value.nextAction||(entry.recordType==="match"?MATCH_NEXT_ACTION_LABELS[normalizeMatchStatus(status)]:DEAL_NEXT_ACTION_LABELS[value.workflowStage])||"اتخاذ الإجراء التالي";
    const body=[value.propertyType,value.district,stageText,actionText].filter(Boolean).join(" — ");
    const bucket=now.toISOString().slice(0,13).replace(/[-T]/g,"");
    const alertId=`follow_${entry.recordType}_${recordId}_${bucket}`;
    await setFirestoreDocument({projectId,segments:["offices",officeId,"alerts",alertId],accessToken,fields:{
      officeId:firestoreString(officeId),type:firestoreString("follow_up"),recordType:firestoreString(entry.recordType),recordId:firestoreString(recordId),
      status:firestoreString("unread"),title:firestoreString(title),body:firestoreString(body||"لديك متابعة مستحقة الآن"),
      createdAt:firestoreTimestamp(now),updatedAt:firestoreTimestamp(now)
    }});
    await setFirestoreDocument({projectId,segments:["offices",officeId,collection,recordId],accessToken,fields:{
      attentionRequired:firestoreBoolean(true),followUpNotifiedAt:firestoreTimestamp(now),updatedAt:firestoreTimestamp(now)
    }});
    await sendOfficePush({projectId,officeId,title,body:body||"لديك متابعة مستحقة الآن",type:entry.recordType,recordId,accessToken,env});
    notified+=1;
  }
  console.info("[iaqar-followups] completed",{checked:records.length,notified});
  return {ok:true,checked:records.length,notified};
}

function parseJsonArray(value){
  try { const parsed=JSON.parse(String(value||"[]")); return Array.isArray(parsed)?parsed:[]; } catch (_) { return []; }
}

async function handleOfficeAnalytics(request,url,env,requestId){
  assertFirebaseSecrets(env); const officeId=normalizeOfficeId(url.searchParams.get("officeId")); if(!officeId)throw appError("office_id_required",400,"officeId مطلوب");
  await authorizeOfficeRequest(request,env,officeId,"member"); const projectId=env.FIREBASE_PROJECT_ID||DEFAULT_PROJECT_ID,accessToken=await getGoogleAccessToken(env);
  const [clients,owners,matches,deals]=await Promise.all([
    listCollectionDocuments({projectId,segments:["offices",officeId,"clients"],accessToken,pageSize:200}),
    listCollectionDocuments({projectId,segments:["offices",officeId,"owners"],accessToken,pageSize:200}),
    listCollectionDocuments({projectId,segments:["offices",officeId,"matches"],accessToken,pageSize:200}),
    listCollectionDocuments({projectId,segments:["offices",officeId,"deals"],accessToken,pageSize:200})
  ]);
  const cs=clients.map(d=>firestoreFieldsToJs(d.fields||{})), os=owners.map(d=>firestoreFieldsToJs(d.fields||{})), ms=matches.map(d=>firestoreFieldsToJs(d.fields||{})), ds=deals.map(d=>firestoreFieldsToJs(d.fields||{}));
  return jsonResponse({ok:true,officeId,...buildAnalyticsSummary({clients:cs,owners:os,matches:ms,deals:ds}),requestId});
}


async function authorizeOfficeRequest(request, env, officeId, permission = "manage") {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const trialOffice = normalizeOfficeId(env.META_TRIAL_OFFICE_ID);
  if (!token && officeId === trialOffice && String(env.ALLOW_TRIAL_NO_AUTH || "").toLowerCase() === "true") {
    return { uid: "trial-admin", trial: true, permission };
  }
  if (!token) throw appError("authentication_required", 401, "سجل دخول المكتب أولاً");
  const claims = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID);
  if (claims.platformAdmin === true || claims.admin === true) {
    return { uid: claims.sub, claims, role: "platformAdmin", permission };
  }
  const projectId = env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID;
  const accessToken = await getGoogleAccessToken(env);
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
  const response = await fetch(firestoreDocumentUrl(projectId, segments), {
    headers: { "Authorization": `Bearer ${accessToken}` }
  });
  if (response.status === 404 && allowMissing) return null;
  if (!response.ok) throw appError("firestore_read_failed", 502, "تعذر قراءة حالة الربط");
  return response.json();
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
    normalizeOfficeId,
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
    claims: { officeId: normalizeOfficeId(officeId), officeMember: true }
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

function normalizeOfficeId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}
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

function extractJsonLdListingText(html) {
  const chunks = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html))) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        for (const key of ["description", "name", "headline"]) {
          const value = cleanText(node[key], 12000);
          if (value) chunks.push(value);
        }
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  return chunks.join("\n").trim();
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

async function handlePipelineVoiceAnalyze(request, env, requestId, { publicRoute = false } = {}) {
  const officeId = normalizeOfficeId(request.headers.get("X-Office-Id"));
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
    context
  });

  if (!result.ok) {
    const status = result.error === "GEMINI_QUOTA_EXCEEDED" ? 429 : 422;
    return jsonResponse({
      ok: false,
      error: result.error,
      retryable: Boolean(result.retryable),
      model: result.model || resolveGeminiModel(env),
      telemetry: getVoiceTelemetrySnapshot(),
      requestId
    }, status);
  }

  return jsonResponse({
    ok: true,
    structured: result.structured,
    extractionMode: result.extractionMode,
    productionAi: result.productionAi,
    model: result.model,
    latencyMs: result.latencyMs,
    telemetry: getVoiceTelemetrySnapshot(),
    requestId
  });
}

async function handlePipelineMediaExtract(request, env, requestId) {
  const body = await request.json().catch(() => ({}));
  const officeId = normalizeOfficeId(body.officeId || request.headers.get("X-Office-Id"));
  const mediaPath = cleanText(body.mediaPath, 500);
  const fileName = cleanText(body.fileName, 240);
  const requestedContentType = cleanText(body.contentType, 120).toLowerCase();
  if (!officeId || !mediaPath) throw appError("invalid_media_target", 400, "وجهة الملف غير صالحة");
  if (!mediaPath.startsWith(`opportunity-sources/${officeId}/`)) {
    throw appError("invalid_media_target", 400, "وجهة الملف غير صالحة");
  }
  await authorizeOfficeRequest(request, env, officeId, "member");
  if (!env.AI) {
    return jsonResponse({ ok: false, error: "media_extraction_unavailable", requestId }, 503);
  }

  const bucket = requireMediaBucket(env);
  const object = await bucket.get(mediaPath);
  if (!object) throw appError("media_not_found", 404, "الملف غير موجود");
  const metadata = object.customMetadata || {};
  if (metadata.officeId && metadata.officeId !== officeId) {
    throw appError("media_scope_mismatch", 403, "الملف لا يتبع هذا المكتب");
  }
  if (metadata.sourceType && !["image", "screenshot"].includes(metadata.sourceType)) {
    throw appError("unsupported_media", 415, "هذا المسار مخصص لاستخراج الصور");
  }
  const storedContentType = cleanText(object.httpMetadata?.contentType, 120).toLowerCase();
  if (requestedContentType && storedContentType && requestedContentType !== storedContentType) {
    throw appError("media_type_mismatch", 400, "نوع الملف لا يطابق الملف المرفوع");
  }
  const contentType = storedContentType || requestedContentType;
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    throw appError("unsupported_media", 415, "نوع الصورة غير مدعوم");
  }

  const bytes = await object.arrayBuffer();
  if (bytes.byteLength > LISTING_FETCH_MAX_BYTES) {
    return jsonResponse({ ok: false, error: "response_too_large", requestId }, 422);
  }

  const visionPrompt = "اقرأ النص العربي الظاهر في الصورة حرفياً فقط. لا تخترع ولا تكرر. أعد النص المقروء فقط.";
  const imageBytes = new Uint8Array(bytes);
  const dataUrl = `data:${contentType};base64,${bytesToBase64(imageBytes)}`;
  const visionInput = {
    messages: [{
      role: "user",
      content: [
        { type: "text", text: visionPrompt },
        { type: "image_url", image_url: { url: dataUrl } }
      ]
    }],
    max_tokens: 1024
  };
  let aiResult;
  try {
    aiResult = await runLlamaVisionExtract(env, visionInput);
  } catch (error) {
    console.warn("[iaqar-media-extract] vision adapter failed", error && error.message);
    return jsonResponse({ ok: false, error: "media_ai_failed", requestId }, 422);
  }

  const rawText = typeof aiResult === "string"
    ? aiResult
    : String(aiResult?.response || aiResult?.result?.response || aiResult?.result || "");
  const text = cleanText(rawText, 12000);
  if (!text) {
    return jsonResponse({ ok: false, error: "empty_listing_text", requestId }, 422);
  }
  return jsonResponse({
    ok: true,
    text,
    textLength: text.length,
    extractionMode: "workers_ai_vision_adapter",
    productionAi: false,
    fileName,
    contentType,
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
  const officeId = normalizeOfficeId(body.officeId || request.headers.get("X-Office-Id"));
  if (!officeId) throw appError("office_id_required", 400, "معرّف المكتب مطلوب");
  await authorizeOfficeRequest(request, env, officeId, "member");
  const targetUrl = normalizeListingFetchUrl(body.url);
  if (!targetUrl) throw appError("invalid_url", 400, "الرابط غير صالح");
  const fetched = await fetchListingPage(targetUrl);
  if (!fetched.ok) {
    return jsonResponse({
      ok: false,
      error: fetched.error || "url_resolve_failed",
      url: targetUrl,
      diagnostics: fetched.diagnostics || null,
      requestId
    }, 422);
  }
  return jsonResponse({
    ok: true,
    url: targetUrl,
    text: fetched.text,
    textLength: fetched.text.length,
    diagnostics: fetched.diagnostics,
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
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Hub-Signature-256,X-Office-Id,X-Intake-Id,X-Media-Kind,X-Media-Index,X-Office-Image-Variant,X-Source-Id,X-Source-Type,X-File-Name,X-Voice-Context,X-Voice-Duration-Sec",
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
  normalizeOpportunitySource, getOpportunityLifecycleStatus, normalizeSaudiPhoneForWhatsApp,
  buildOpportunitySummary, buildOpportunityWhatsAppMessage, resolveSelectOption,
  extractDistrictFromVoice, parseVoiceOpportunityFields, whatsappActionTypeForStatus,
  isArchivedLifecycle, isOpportunityLifecycleActive
};
