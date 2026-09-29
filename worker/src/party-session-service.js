import { ORCHESTRATOR_EVENT, ORCHESTRATOR_OWNER } from "./central-orchestrator-domain.js";
import { buildOrchestratorEventId, dispatchOrchestratorEvent } from "./central-orchestrator-service.js";
import {
  buildPartySnapshot,
  buildShareSnapshot,
  createOpaquePartyToken,
  isAllowedPartyAction,
  isGenericPartyValue,
  isOpaquePartyToken,
  isPartyOfferListing,
  isPrimaryPartyAction,
  linkedOfferIdsFromMatch,
  listingMediaPaths,
  PARTY_INVALID_COPY,
  PARTY_SESSION_STATUS,
  partySessionKey,
  revealedDetailFromSnapshot,
  sanitizePartyPublicView
} from "../../public/js/party-session-domain.js";
import { livingStageAfterPartyAction, appendLivingTimeline, nextActorForLivingStage, partyReplyTimelineLabel, LIVING_TASK_STAGE } from "../../public/js/match-group-domain.js";
import {
  collectBrokerBookedStarts,
  evaluateViewingCandidate,
  VIEWING_APPOINTMENT_STATUS,
  appointmentEndAt
} from "../../public/js/broker-viewing-schedule-domain.js";
import {
  canonicalViewingCandidateAt,
  planViewingConfirmation,
  planViewingCompletion
} from "../../public/js/viewing-domain.js";
import {
  applyCoordinationToMatch,
  ensureCoordinationSession,
  loadCoordinationSession,
  saveCoordinationSession,
  submitCoordinationBundle
} from "./coordination-session-service.js";
import { upsertNotificationDocument } from "./operations-service.js";
import { buildMatchReviewDedupKey, operationDocumentId } from "./operations-domain.js";
import {
  AGREEMENT_FIELDS,
  MATCH_EVENT_ACTOR,
  MATCH_EVENT_SOURCE,
  MATCH_EVENT_TYPE,
  brokerPartyChoices,
  choiceEventType,
  isLifecycleReadOnly,
  lastUpdateLine,
  lifecycleLabel,
  partyEventLabel,
  partyLinkChoices,
  partyVisibleEvents,
  projectMatchEvents,
  parseMatchState
} from "../../public/js/match-event-domain.js";
import {
  appendMatchEventRecord,
  markMatchSeenByBroker,
  markWhatsAppHandoffOpened,
  matchEventId,
  matchLifecycleOf
} from "./match-event-service.js";
import { buildLivingEventNotification } from "./in-app-notification-write.js";

function publicWorkerOrigin(env = {}) {
  const explicit = String(env.PUBLIC_WORKER_ORIGIN || "").replace(/\/$/, "");
  if (explicit) return explicit;
  if (String(env.DEPLOYMENT_ENV || "") === "staging") {
    return "https://iaqar-intake-staging.iaqar-ai.workers.dev";
  }
  return "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
}

function fields(doc) {
  return doc?.fields ? doc.fields : {};
}

function js(doc, helpers) {
  return helpers.firestoreFieldsToJs(fields(doc) || {});
}

export function livingStageAfterPartySessionHandoff(session = {}, party = "client") {
  if (String(session.clientSessionId || "").trim() && String(session.ownerSessionId || "").trim()) {
    return "NEGOTIATION";
  }
  return party === "owner" ? "WAITING_PROPERTY_CONFIRMATION" : "WAITING_CLIENT";
}

async function stampPartySessionHandoff(helpers, {
  projectId, officeId, matchId, accessToken, party, session
}) {
  const livingStage = livingStageAfterPartySessionHandoff(session, party);
  const negotiationActive = livingStage === "NEGOTIATION";
  await stampMatchLiving(helpers, {
    projectId,
    officeId,
    matchId,
    accessToken,
    patch: {
      livingStage,
      activeMatchId: matchId,
      ownerContactNeeded: false,
      hasNewResponse: false,
      nextActor: negotiationActive ? "BROKER" : (party === "owner" ? "OWNER" : "CLIENT"),
      timelineEvent: {
        type: negotiationActive
          ? "negotiation_activated"
          : (party === "owner" ? "whatsapp_owner_opened" : "whatsapp_client_opened"),
        actor: "BROKER",
        label: negotiationActive
          ? "تم إرسال المطابقة للطرفين وبدأ التفاوض"
          : (party === "owner" ? "تم فتح واتساب للمالك" : "تم فتح واتساب للعميل")
      }
    }
  });
  return livingStage;
}

const OFFICE_MEDIA_KEY_PATTERN = /^(?:public-intake|office-library|opportunity-sources)\/[a-z0-9_-]{1,80}\//i;
const PARTY_IMAGE_TYPES = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
});

const CLIENT_FORBIDDEN_BUNDLE_FIELDS = new Set([
  "propertyAvailability", "priceConfirmation", "updatedPrice", "locationShare",
  "mediaPaths", "mediaAdded", "specValues", "detailValues", "detailConfirmations",
  "detailNeedsUpdate", "viewingAllowed", "coordinationRequired", "negotiationDecision",
  "counterPrice", "counterPreference", "ownerStatus", "ownerAccepted", "ownerDecision",
  "agreementStatus"
]);

const OWNER_FORBIDDEN_BUNDLE_FIELDS = new Set([
  "interestStatus", "infoNeeds", "specNeeds", "requestedDetailKeys", "interestAction",
  "rejectionReason", "rejectionDisposition", "proposedPrice", "negotiationPreference",
  "negotiationResponse", "wantsViewing", "nextAction", "clientStatus", "clientAccepted",
  "clientDecision", "agreementStatus"
]);

function assertPartyBundleRole(party, bundle, helpers) {
  const forbidden = party === "owner"
    ? OWNER_FORBIDDEN_BUNDLE_FIELDS
    : CLIENT_FORBIDDEN_BUNDLE_FIELDS;
  const field = Object.keys(bundle || {}).find((key) => forbidden.has(key));
  if (!field) return;
  throw helpers.appError(
    "party_role_field_forbidden",
    403,
    "لا يمكن لهذا الطرف تعديل بيانات الطرف الآخر."
  );
}

async function parseBundleRequest(request) {
  const contentType = String(request.headers?.get?.("content-type") || "").toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const bundleRaw = form.get("bundle");
    const bundle = bundleRaw ? JSON.parse(String(bundleRaw)) : {};
    const photos = [];
    for (const entry of form.getAll("photos")) {
      if (entry && typeof entry === "object" && Number(entry.size || 0) > 0) {
        photos.push(entry);
      }
    }
    return { bundle, photos };
  }
  const body = await request.json().catch(() => ({}));
  const bundle = body.bundle && typeof body.bundle === "object" ? body.bundle : body;
  return { bundle, photos: [] };
}

async function uploadOwnerCoordinationPhoto(helpers, env, { officeId, offerId, file, index = 0 }) {
  const bucket = env.IAQAR_MEDIA;
  if (!bucket?.put) {
    throw helpers.appError("media_storage_unavailable", 503, "تخزين الوسائط غير مفعّل");
  }
  const contentType = String(file.type || "").toLowerCase();
  const ext = PARTY_IMAGE_TYPES[contentType];
  if (!ext) throw helpers.appError("unsupported_media", 415, "نوع الصورة غير مدعوم");
  if (Number(file.size || 0) > 8 * 1024 * 1024) {
    throw helpers.appError("image_too_large", 413, "حجم الصورة يتجاوز 8 ميجابايت");
  }
  const key = `opportunity-sources/${officeId}/${offerId}/coord-party-${Date.now()}-${index}.${ext}`;
  await bucket.put(key, file.stream ? file.stream() : file, {
    httpMetadata: { contentType },
    customMetadata: { officeId, offerId, uploadedAt: new Date().toISOString(), source: "party_coordination" }
  });
  return key;
}

export async function hashPartyToken(token, sha256Hex) {
  return sha256Hex(String(token || "").trim());
}

async function readOfficeDoc(helpers, { projectId, officeId, collection, id, accessToken }) {
  if (!id) return null;
  const doc = await helpers.getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, collection, id],
    accessToken,
    allowMissing: true
  });
  return doc ? { id, ...js(doc, helpers) } : null;
}

function listingIsUsable(record) {
  if (!record || !isPartyOfferListing(record)) return false;
  return !isGenericPartyValue(record.propertyType)
    || Number(record.salePrice || record.price || record.area || 0) > 0;
}

async function loadCanonicalOfferListing(helpers, {
  projectId,
  officeId,
  accessToken,
  matchId = "",
  session = {},
  body = {}
}) {
  const match = matchId
    ? await readOfficeDoc(helpers, {
      projectId, officeId, collection: "matches", id: matchId, accessToken
    })
    : null;
  const sessionLike = {
    offerId: session.offerId || body.offerId || body.ownerOfferId || "",
    ownerOfferId: body.ownerOfferId || session.ownerOfferId || "",
    opportunityId: session.opportunityId || body.opportunityId || ""
  };
  const ids = linkedOfferIdsFromMatch(match || {}, sessionLike);
  let fallback = null;
  for (const id of ids) {
    const opportunity = await readOfficeDoc(helpers, {
      projectId, officeId, collection: "opportunities", id, accessToken
    });
    if (listingIsUsable(opportunity)) return opportunity;
    if (opportunity && isPartyOfferListing(opportunity) && !fallback) fallback = opportunity;
    const owner = await readOfficeDoc(helpers, {
      projectId, officeId, collection: "owners", id, accessToken
    });
    if (listingIsUsable(owner)) return owner;
    if (owner && isPartyOfferListing(owner) && !fallback) fallback = owner;
  }
  return fallback;
}

// The MATCH_REVIEW operation id is deterministic (op_ + sha256 of its dedup key),
// so it is resolved directly instead of scanning the first page of operations.
// A page scan silently missed the operation in offices with more than one page of
// operations, leaving the Bank/Daily Tasks projection stuck on "تطابق جديد".
export async function resolveMatchReviewOperationId(helpers, {
  projectId, officeId, matchId, match = {}, accessToken
}) {
  const id = String(matchId || "").trim();
  if (!id) return "";
  const isLinked = (operation = {}) => String(operation.type || operation.operationType || "").toUpperCase() === "MATCH_REVIEW"
    && String(operation.matchId || "") === id;
  const explicit = String(match.operationId || "").trim();
  if (explicit) return explicit;
  const deterministicId = await operationDocumentId(buildMatchReviewDedupKey({
    officeId, matchId: id, dataVersion: String(match.dataVersion || "")
  }));
  const deterministic = await readOfficeDoc(helpers, {
    projectId, officeId, collection: "operations", id: deterministicId, accessToken
  });
  if (deterministic && isLinked(deterministic)) return deterministicId;
  if (typeof helpers.listCollectionDocuments !== "function") return "";
  const operationDocs = await helpers.listCollectionDocuments({
    projectId,
    segments: ["offices", officeId, "operations"],
    accessToken,
    pageSize: 300
  });
  const linkedOperation = operationDocs.find((doc) => isLinked(js(doc, helpers)));
  return decodeURIComponent(String(linkedOperation?.name || "").split("/").pop() || "");
}

function brokerEventFromInput(input = {}, match = {}) {
  const kind = text(input.kind).toLowerCase();
  const side = text(input.party || input.audience).toLowerCase();
  if (kind === "party_send") {
    if (!["client", "owner"].includes(side)) return { error: "party_invalid" };
    return { event: { eventType: MATCH_EVENT_TYPE.WHATSAPP_OPENED, recipient: side, payload: { handoff: "link" } } };
  }
  if (kind === "party_choice") {
    if (!["client", "owner"].includes(side)) return { error: "party_invalid" };
    const choice = brokerPartyChoices({
      propertyType: match.candidatePropertyType || match.propertyType || "",
      purpose: match.candidatePurpose || match.purpose || ""
    }).find((item) => item.id === text(input.choiceId));
    if (!choice) return { error: "choice_invalid" };
    return { event: { eventType: choiceEventType(side, choice.id), recipient: "", payload: { choiceId: choice.id, label: choice.label, onBehalf: true } } };
  }
  if (kind === "broker_message") {
    if (!["client", "owner", "both"].includes(side)) return { error: "audience_invalid" };
    const message = String(input.message || "").trim().slice(0, 1000);
    if (!message) return { error: "message_required" };
    return { event: { eventType: MATCH_EVENT_TYPE.BROKER_MESSAGE, recipient: side, payload: { message } } };
  }
  if (kind === "internal_note") {
    const message = String(input.message || "").trim().slice(0, 1000);
    if (!message) return { error: "message_required" };
    return { event: { eventType: MATCH_EVENT_TYPE.BROKER_INTERNAL_NOTE, recipient: "internal", payload: { message } } };
  }
  if (kind === "agreement_update") {
    const field = AGREEMENT_FIELDS.find((item) => item.id === text(input.field));
    const value = String(input.value || "").trim().slice(0, 300);
    if (!field) return { error: "agreement_field_invalid" };
    if (!value) return { error: "agreement_value_required" };
    return { event: { eventType: MATCH_EVENT_TYPE.AGREEMENT_UPDATED, recipient: "both", payload: { field: field.id, fieldLabel: field.label, value } } };
  }
  return { error: "kind_invalid" };
}

const BROKER_EVENT_ERRORS = Object.freeze({
  party_invalid: "حدد الطرف: العميل أو المالك.",
  audience_invalid: "حدد المستلم: العميل أو المالك أو الطرفان.",
  choice_invalid: "الخيار غير متاح لهذا الطرف.",
  message_required: "اكتب نص الرسالة أو الملاحظة.",
  agreement_field_invalid: "بند الاتفاق غير معروف.",
  agreement_value_required: "اكتب قيمة بند الاتفاق.",
  kind_invalid: "نوع الإجراء غير معروف."
});

/**
 * Broker actions in the Match workspace become real events on the exact matchId.
 * Messages also reach the chosen party's review link; internal notes never do.
 */
export async function recordNegotiationActivity(helpers, {
  projectId, officeId, matchId, accessToken, input = {}, now = new Date(), env = null, actorId = ""
}) {
  const id = String(matchId || "").trim();
  const match = id ? await readOfficeDoc(helpers, { projectId, officeId, collection: "matches", id, accessToken }) : null;
  if (!match) throw helpers.appError("match_not_found", 404, "المطابقة غير موجودة.");
  const mapped = brokerEventFromInput(input, match);
  if (mapped.error) throw helpers.appError(`negotiation_${mapped.error}`, 400, BROKER_EVENT_ERRORS[mapped.error] || "تعذر حفظ الإجراء.");
  const clientEventId = text(input.clientEventId);
  const result = await appendMatchEventRecord(helpers, {
    projectId, officeId, matchId: id, accessToken, env, now, resolveOperationId: resolveMatchReviewOperationId,
    event: {
      ...mapped.event,
      eventId: clientEventId ? await matchEventId(helpers, [id, "broker", clientEventId]) : "",
      actorType: MATCH_EVENT_ACTOR.BROKER,
      actorId,
      source: MATCH_EVENT_SOURCE.BROKER_WORKSPACE
    }
  });
  if (!result.duplicate && result.event.eventType === MATCH_EVENT_TYPE.BROKER_MESSAGE) {
    const session = await loadCoordinationSession(helpers, { projectId, officeId, matchId: id, accessToken });
    const note = { id: result.event.eventId, audience: result.event.recipient, message: result.event.payload.message, actor: "BROKER", createdAt: result.event.createdAt };
    await saveCoordinationSession(helpers, {
      projectId, officeId, matchId: id, accessToken,
      session: { ...session, brokerNotes: [...(session.brokerNotes || []), note].slice(-40) }
    });
  }
  return { entry: result.event, summary: result.state, duplicate: result.duplicate, dispatches: result.dispatches, operationId: result.operationId };
}

export async function recordMatchLifecycleEvent(helpers, { projectId, officeId, matchId, accessToken, eventType, now = new Date(), env = null, actorId = "", payload = {} }) {
  return appendMatchEventRecord(helpers, {
    projectId, officeId, matchId, accessToken, env, now, allowWhenClosed: true, resolveOperationId: resolveMatchReviewOperationId,
    event: {
      eventId: await matchEventId(helpers, [matchId, eventType]),
      actorType: MATCH_EVENT_ACTOR.BROKER, actorId, eventType, recipient: "both",
      source: MATCH_EVENT_SOURCE.BROKER_WORKSPACE, payload
    }
  });
}

export async function markBrokerSeen(helpers, { projectId, officeId, matchId, accessToken, now = new Date() }) {
  return markMatchSeenByBroker(helpers, { projectId, officeId, matchId, accessToken, now, resolveOperationId: resolveMatchReviewOperationId });
}

export async function openWhatsAppHandoff(helpers, { projectId, officeId, matchId, accessToken, dispatchId, now = new Date(), actorId = "" }) {
  return markWhatsAppHandoffOpened(helpers, { projectId, officeId, matchId, accessToken, dispatchId, now, actorId, resolveOperationId: resolveMatchReviewOperationId });
}

async function stampMatchLiving(helpers, {
  projectId,
  officeId,
  matchId,
  accessToken,
  patch = {}
}) {
  const id = String(matchId || "").trim();
  if (!id) return;
  const match = await readOfficeDoc(helpers, {
    projectId, officeId, collection: "matches", id, accessToken
  });
  if (!match) return;
  const rejected = [...new Set([]
    .concat(Array.isArray(match.rejectedMatchIds) ? match.rejectedMatchIds : [])
    .concat(patch.rejectedMatchIds || [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)
  )];
  const livingStage = String(patch.livingStage || match.livingStage || "MATCH_FOUND");
  const missingInfoKey = String(patch.missingInfoKey || "");
  const ownerContactNeeded = Boolean(patch.ownerContactNeeded);
  const activeMatchId = String(patch.activeMatchId || id);
  const livingUpdatedAt = new Date().toISOString();
  const timeline = appendLivingTimeline(match.livingTimelineJson || match.livingTimeline, patch.timelineEvent, { now: new Date(livingUpdatedAt) });
  const hasNewResponse = patch.hasNewResponse === true;
  const nextActor = String(patch.nextActor || nextActorForLivingStage(livingStage, {
    ownerContactNeeded: Boolean(patch.ownerContactNeeded)
  }));
  const coordinationOutcome = String(patch.coordinationOutcome || "");
  const coordinationBrokerLine = String(patch.coordinationBrokerLine || "");
  const coordinationClientSummary = String(patch.coordinationClientSummary || "");
  const coordinationOwnerSummary = String(patch.coordinationOwnerSummary || "");
  const negotiationStatus = String(patch.negotiationStatus || "");
  const lastNegotiationActivityAt = String(patch.lastNegotiationActivityAt || "");
  const lastNegotiationEvent = String(patch.lastNegotiationEvent || "");
  const fields = {
    livingStage: helpers.firestoreString(livingStage),
    missingInfoKey: helpers.firestoreString(missingInfoKey),
    ownerContactNeeded: helpers.firestoreString(ownerContactNeeded ? "true" : ""),
    rejectedMatchIds: helpers.firestoreString(JSON.stringify(rejected)),
    activeMatchId: helpers.firestoreString(activeMatchId),
    livingUpdatedAt: helpers.firestoreString(livingUpdatedAt),
    livingTimelineJson: helpers.firestoreString(JSON.stringify(timeline)),
    hasNewResponse: helpers.firestoreString(hasNewResponse ? "true" : ""),
    nextActor: helpers.firestoreString(nextActor)
  };
  if (coordinationOutcome) fields.coordinationOutcome = helpers.firestoreString(coordinationOutcome);
  if (coordinationBrokerLine) fields.coordinationBrokerLine = helpers.firestoreString(coordinationBrokerLine);
  if (coordinationClientSummary) fields.coordinationClientSummary = helpers.firestoreString(coordinationClientSummary);
  if (coordinationOwnerSummary) fields.coordinationOwnerSummary = helpers.firestoreString(coordinationOwnerSummary);
  if (negotiationStatus) fields.negotiationStatus = helpers.firestoreString(negotiationStatus);
  if (lastNegotiationActivityAt) fields.lastNegotiationActivityAt = helpers.firestoreString(lastNegotiationActivityAt);
  if (lastNegotiationEvent) fields.lastNegotiationEvent = helpers.firestoreString(lastNegotiationEvent);
  if (patch.viewingCandidateAt) fields.viewingCandidateAt = helpers.firestoreString(String(patch.viewingCandidateAt));
  if (patch.appointmentAt) fields.appointmentAt = helpers.firestoreString(String(patch.appointmentAt));
  if (patch.viewingAt) fields.viewingAt = helpers.firestoreString(String(patch.viewingAt));
  if (patch.appointmentStatus) fields.appointmentStatus = helpers.firestoreString(String(patch.appointmentStatus));
  if (Object.prototype.hasOwnProperty.call(patch, "viewingCompletedAt")) fields.viewingCompletedAt = helpers.firestoreString(String(patch.viewingCompletedAt || ""));
  if (Object.prototype.hasOwnProperty.call(patch, "viewingOutcome")) fields.viewingOutcome = helpers.firestoreString(String(patch.viewingOutcome || ""));
  if (Object.prototype.hasOwnProperty.call(patch, "seriousIntentConfirmed")) fields.seriousIntentConfirmed = helpers.firestoreString(patch.seriousIntentConfirmed ? "true" : "");
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "matches", id],
    accessToken,
    fields
  });
  const operationId = await resolveMatchReviewOperationId(helpers, {
    projectId, officeId, matchId: id, match, accessToken
  });
  if (!operationId) return;
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "operations", operationId],
    accessToken,
    fields: {
      livingStage: helpers.firestoreString(livingStage),
      missingInfoKey: helpers.firestoreString(missingInfoKey),
      ownerContactNeeded: helpers.firestoreString(ownerContactNeeded ? "true" : ""),
      livingUpdatedAt: helpers.firestoreString(livingUpdatedAt),
      livingTimelineJson: helpers.firestoreString(JSON.stringify(timeline)),
      hasNewResponse: helpers.firestoreString(hasNewResponse ? "true" : ""),
      nextActor: helpers.firestoreString(nextActor),
      ...(coordinationOutcome ? { coordinationOutcome: helpers.firestoreString(coordinationOutcome) } : {}),
      ...(coordinationBrokerLine ? { coordinationBrokerLine: helpers.firestoreString(coordinationBrokerLine) } : {}),
      ...(coordinationClientSummary ? { coordinationClientSummary: helpers.firestoreString(coordinationClientSummary) } : {}),
      ...(coordinationOwnerSummary ? { coordinationOwnerSummary: helpers.firestoreString(coordinationOwnerSummary) } : {}),
      ...(negotiationStatus ? { negotiationStatus: helpers.firestoreString(negotiationStatus) } : {}),
      ...(lastNegotiationActivityAt ? { lastNegotiationActivityAt: helpers.firestoreString(lastNegotiationActivityAt) } : {}),
      ...(lastNegotiationEvent ? { lastNegotiationEvent: helpers.firestoreString(lastNegotiationEvent) } : {}),
      ...(patch.appointmentAt ? {
        appointmentAt: helpers.firestoreString(String(patch.appointmentAt)),
        viewingAt: helpers.firestoreString(String(patch.viewingAt || patch.appointmentAt)),
        appointmentStatus: helpers.firestoreString(String(patch.appointmentStatus || "CONFIRMED_BY_BROKER")),
        dueAt: helpers.firestoreTimestamp(new Date(patch.appointmentAt)),
        status: helpers.firestoreString("IN_PROGRESS")
      } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "viewingCompletedAt") ? { viewingCompletedAt: helpers.firestoreString(String(patch.viewingCompletedAt || "")) } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "viewingOutcome") ? { viewingOutcome: helpers.firestoreString(String(patch.viewingOutcome || "")) } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "seriousIntentConfirmed") ? { seriousIntentConfirmed: helpers.firestoreString(patch.seriousIntentConfirmed ? "true" : "") } : {})
    }
  });
}

export async function handlePartySessionMint({
  request,
  env,
  requestId,
  helpers
}) {
  const body = await request.json().catch(() => ({}));
  const officeId = helpers.firestoreOfficeId(body.officeId);
  if (!officeId) throw helpers.appError("office_id_required", 400, "تعذر تحديد المكتب");
  await helpers.authorizeOfficeRequest(request, env, officeId, "member");
  helpers.assertFirebaseSecrets(env);
  const party = String(body.party || "").toLowerCase() === "owner" ? "owner" : "client";
  const matchId = helpers.cleanText(body.matchId, 180);
  if (!matchId) throw helpers.appError("match_id_required", 400, "تعذر تحديد المطابقة");
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const keyId = partySessionKey(matchId, party);
  const existingKey = await helpers.getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "partySessionKeys", keyId],
    accessToken,
    allowMissing: true
  });
  if (existingKey) {
    const keyData = js(existingKey, helpers);
    const existingSession = await helpers.getFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "partySessions", String(keyData.sessionId || "")],
      accessToken,
      allowMissing: true
    });
    const session = existingSession ? js(existingSession, helpers) : null;
    const identityMatches = session
      && session.officeId === officeId
      && session.matchId === matchId
      && session.party === party
      && keyData.party === party
      && keyData.matchId === matchId;
    if (identityMatches && session.status !== PARTY_SESSION_STATUS.REVOKED && session.token && isOpaquePartyToken(session.token)) {
      const coordination = await ensureCoordinationSession(helpers, {
        projectId,
        officeId,
        matchId,
        accessToken,
        clientSessionId: party === "client" ? String(keyData.sessionId || "") : "",
        ownerSessionId: party === "owner" ? String(keyData.sessionId || "") : ""
      });
      await stampPartySessionHandoff(helpers, {
        projectId, officeId, matchId, accessToken, party, session: coordination
      });
      return helpers.jsonResponse({
        ok: true,
        token: session.token,
        reused: true,
        officeName: String((await helpers.getFirestoreDocument({
          projectId,
          segments: ["offices", officeId],
          accessToken,
          allowMissing: true
        }))?.fields?.officeName?.stringValue || ""),
        requestId
      });
    }
  }

  const offerId = helpers.cleanText(body.offerId || body.ownerOfferId, 180);
  const requestRecordId = helpers.cleanText(body.requestId || body.clientRequestId, 180);
  const canonicalMatch = await readOfficeDoc(helpers, {
    projectId, officeId, collection: "matches", id: matchId, accessToken
  });
  if (canonicalMatch) {
    const canonicalOfferIds = linkedOfferIdsFromMatch(canonicalMatch, {});
    if (offerId && canonicalOfferIds.length && !canonicalOfferIds.includes(offerId)) {
      throw helpers.appError("party_match_identity_mismatch", 409, "تعذر التحقق من بيانات المطابقة");
    }
    const canonicalRequestId = helpers.cleanText(
      canonicalMatch.clientRequestId || canonicalMatch.requestId || canonicalMatch.buyerRequestId,
      180
    );
    if (requestRecordId && canonicalRequestId && requestRecordId !== canonicalRequestId) {
      throw helpers.appError("party_match_identity_mismatch", 409, "تعذر التحقق من بيانات المطابقة");
    }
  }
  const liveOffer = await loadCanonicalOfferListing(helpers, {
    projectId,
    officeId,
    accessToken,
    matchId,
    body: { offerId, ownerOfferId: offerId, opportunityId: helpers.cleanText(body.opportunityId, 180) }
  });
  if (canonicalMatch && !liveOffer) {
    throw helpers.appError("party_offer_not_found", 409, "تعذر التحقق من العقار المرتبط بالمطابقة");
  }
  const bodyHints = {
    propertyType: helpers.cleanText(body.propertyType, 40),
    purpose: helpers.cleanText(body.purpose, 40),
    salePrice: body.salePrice,
    annualRent: body.annualRent,
    city: helpers.cleanText(body.city, 80),
    district: helpers.cleanText(body.district, 80),
    area: body.area,
    rooms: body.rooms,
    baths: body.baths,
    bathrooms: body.bathrooms,
    streetWidth: body.streetWidth,
    streetDirection: helpers.cleanText(body.streetDirection, 40),
    facing: helpers.cleanText(body.facing || body.direction, 40),
    depth: body.depth,
    plotNumber: helpers.cleanText(body.plotNumber, 40),
    description: helpers.cleanText(body.description, 600),
    locationUrl: helpers.cleanText(body.locationUrl, 500)
  };
  const snapshotSource = liveOffer || (listingIsUsable(bodyHints) ? bodyHints : {});
  const officeDoc = await helpers.getFirestoreDocument({
    projectId,
    segments: ["offices", officeId],
    accessToken,
    allowMissing: true
  });
  const office = officeDoc ? js(officeDoc, helpers) : {};
  const token = createOpaquePartyToken();
  const tokenHash = await hashPartyToken(token, helpers.sha256Hex);
  const sessionId = `ps_${tokenHash.slice(0, 24)}`;
  const now = new Date();
  const snapshot = buildPartySnapshot(snapshotSource);
  const shareSnapshot = buildShareSnapshot({
    shareId: sessionId,
    matchId,
    partyRole: party,
    opportunityId: liveOffer?.id || offerId,
    createdAt: now.toISOString(),
    snapshotVersion: 1,
    record: snapshotSource
  });
  const session = {
    officeId,
    matchId,
    party,
    recipientRef: party === "owner" ? offerId : requestRecordId,
    offerId,
    requestId: requestRecordId,
    opportunityId: liveOffer?.id || offerId,
    mediaPaths: listingMediaPaths(snapshotSource),
    currentStage: helpers.cleanText(body.currentStage || "match_found", 40) || "match_found",
    status: PARTY_SESSION_STATUS.ACTIVE,
    token,
    tokenHash,
    revoked: false,
    createdAt: now.toISOString(),
    replyAction: "",
    replyAt: "",
    snapshot,
    shareSnapshot,
    snapshotVersion: 1,
    livingStage: party === "owner" ? "WAITING_PROPERTY_CONFIRMATION" : "WAITING_CLIENT"
  };
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "partySessions", sessionId],
    accessToken,
    fields: helpers.jsToFirestoreValue(session).mapValue.fields
  });
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "partySessionKeys", keyId],
    accessToken,
    fields: helpers.jsToFirestoreValue({
      officeId,
      sessionId,
      party,
      matchId,
      tokenHash,
      createdAt: now.toISOString()
    }).mapValue.fields
  });
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["partySessionTokens", tokenHash],
    accessToken,
    fields: helpers.jsToFirestoreValue({
      officeId,
      sessionId,
      party,
      createdAt: now.toISOString()
    }).mapValue.fields
  });
  const coordination = await ensureCoordinationSession(helpers, {
    projectId,
    officeId,
    matchId,
    accessToken,
    clientSessionId: party === "client" ? sessionId : "",
    ownerSessionId: party === "owner" ? sessionId : ""
  });
  await stampPartySessionHandoff(helpers, {
    projectId, officeId, matchId, accessToken, party, session: coordination
  });
  return helpers.jsonResponse({
    ok: true,
    token,
    reused: false,
    officeName: office.officeName || office.name || "",
    requestId
  });
}

export async function loadPartyPublicView({ token, env, helpers }) {
  if (!isOpaquePartyToken(token)) return null;
  helpers.assertFirebaseSecrets(env);
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const tokenHash = await hashPartyToken(token, helpers.sha256Hex);
  const pointer = await helpers.getFirestoreDocument({
    projectId,
    segments: ["partySessionTokens", tokenHash],
    accessToken,
    allowMissing: true
  });
  if (!pointer) return null;
  const pointerData = js(pointer, helpers);
  const officeId = helpers.firestoreOfficeId(pointerData.officeId);
  const sessionId = String(pointerData.sessionId || "").trim();
  if (!officeId || !sessionId) return null;
  const sessionDoc = await helpers.getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "partySessions", sessionId],
    accessToken,
    allowMissing: true
  });
  if (!sessionDoc) return null;
  const session = js(sessionDoc, helpers);
  if (pointerData.officeId !== officeId
    || pointerData.sessionId !== sessionId
    || pointerData.party !== session.party
    || session.officeId !== officeId) return null;
  if (session.revoked === true || session.status === PARTY_SESSION_STATUS.REVOKED) return null;
  if (session.tokenHash && session.tokenHash !== tokenHash) return null;
  const officeDoc = await helpers.getFirestoreDocument({
    projectId,
    segments: ["offices", officeId],
    accessToken,
    allowMissing: true
  });
  const office = officeDoc ? js(officeDoc, helpers) : {};
  const workerHost = publicWorkerOrigin(env);
  const logoUrl = workerHost
    ? `${workerHost}/media/public/office-covers/${encodeURIComponent(officeId)}/logo`
    : "";
  const profileUrl = workerHost
    ? `${workerHost}/media/public/office-covers/${encodeURIComponent(officeId)}/display`
    : "";
  const snapshot = session.shareSnapshot?.permitted || session.snapshot || {};
  const canonicalOffer = await loadCanonicalOfferListing(helpers, {
    projectId,
    officeId,
    accessToken,
    matchId: session.matchId,
    session,
    body: { offerId: session.offerId, ownerOfferId: session.offerId, opportunityId: session.opportunityId }
  }) || {};
  const matchRecord = session.matchId
    ? await readOfficeDoc(helpers, {
      projectId, officeId, collection: "matches", id: session.matchId, accessToken
    })
    : null;
  const revealed = session.revealedDetail || revealedDetailFromSnapshot(snapshot, session.followUpAction || "");
  const coordination = await loadCoordinationSession(helpers, {
    projectId,
    officeId,
    matchId: session.matchId,
    accessToken,
    canonicalOffer
  });
  return {
    session,
    officeId,
    sessionId,
    canonicalOffer,
    view: withPartyNegotiation(sanitizePartyPublicView({
      party: session.party,
      status: session.status,
      snapshot,
      officeName: office.officeName || office.name || "المكتب العقاري",
      officeLogoUrl: logoUrl,
      officeProfileUrl: profileUrl,
      replyAction: session.replyAction || "",
      followUpAction: session.followUpAction || "",
      revealedDetail: revealed,
      livingStage: session.livingStage || session.currentStage || matchRecord?.livingStage || "",
      coordination,
      canonicalOffer,
      matchRecord: matchRecord || {}
    }), matchRecord || {}, session.party)
  };
}

/**
 * The live negotiation panel for a party link: its current choice, what it may see
 * of the history, the agreement, and whether the link is still ACTIVE.
 */
export function buildPartyNegotiationView(matchRecord = {}, side = "client", now = new Date()) {
  const party = side === "owner" ? "owner" : "client";
  const history = matchRecord.negotiationActivityJson || "[]";
  const state = parseMatchState(matchRecord.matchStateJson) || projectMatchEvents(history, { matchStatus: matchRecord.status });
  const lifecycle = matchLifecycleOf(matchRecord);
  const visible = partyVisibleEvents(history, party);
  return {
    party,
    lifecycle,
    lifecycleLabel: lifecycleLabel(lifecycle),
    readOnly: isLifecycleReadOnly(lifecycle),
    choices: partyLinkChoices(party).map(({ id, label }) => ({ id, label })),
    current: state[party] ? { choiceId: state[party].choiceId, label: state[party].label, createdAt: state[party].createdAt } : null,
    agreementFields: AGREEMENT_FIELDS.map(({ id, label }) => ({ id, label })),
    agreement: state.agreement || {},
    events: visible.slice(-30).reverse().map((event) => ({
      eventId: event.eventId,
      eventType: event.eventType,
      label: partyEventLabel(event, party),
      message: String(event.payload?.message || event.payload?.condition || (event.eventType === MATCH_EVENT_TYPE.AGREEMENT_UPDATED ? event.payload?.value : "") || ""),
      createdAt: event.createdAt
    })),
    lastUpdate: lastUpdateLine(visible, now),
    stateVersion: `${matchRecord.lastEventAt || ""}|${lifecycle}`
  };
}

function withPartyNegotiation(view = {}, matchRecord = {}, side = "client") {
  const negotiation = buildPartyNegotiationView(matchRecord, side);
  if (!negotiation.readOnly) return { ...view, negotiation };
  // Final state: no legacy reply/decision actions either.
  return { ...view, negotiation, actions: [], followUpActions: [], decisionPackage: null, coordinationForm: null };
}

async function resolvePartyContext({ token, env, helpers }) {
  if (!isOpaquePartyToken(token)) return null;
  helpers.assertFirebaseSecrets(env);
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const tokenHash = await hashPartyToken(token, helpers.sha256Hex);
  const pointer = await helpers.getFirestoreDocument({ projectId, segments: ["partySessionTokens", tokenHash], accessToken, allowMissing: true });
  if (!pointer) return null;
  const pointerData = js(pointer, helpers);
  const officeId = helpers.firestoreOfficeId(pointerData.officeId);
  const sessionId = String(pointerData.sessionId || "").trim();
  if (!officeId || !sessionId) return null;
  const sessionDoc = await helpers.getFirestoreDocument({ projectId, segments: ["offices", officeId, "partySessions", sessionId], accessToken, allowMissing: true });
  if (!sessionDoc) return null;
  const session = js(sessionDoc, helpers);
  if (pointerData.officeId !== officeId || pointerData.sessionId !== sessionId || pointerData.party !== session.party || session.officeId !== officeId) return null;
  if (session.revoked === true || session.status === PARTY_SESSION_STATUS.REVOKED) return null;
  if (session.tokenHash && session.tokenHash !== tokenHash) return null;
  if (!String(session.matchId || "").trim()) return null;
  return { projectId, accessToken, officeId, sessionId, session, party: session.party === "owner" ? "owner" : "client", matchId: String(session.matchId).trim() };
}

function partyRateLimited(helpers, route, ip) {
  const limited = helpers.consumePublicRateLimit(helpers.publicRateLimitKey({ route, ip }), helpers.PUBLIC_RATE_LIMITS.PUBLIC_PARTY);
  return !limited.ok;
}

function partyInvalid(helpers, requestId) {
  return helpers.jsonResponse({ ok: false, error: "invalid_party_link", message: PARTY_INVALID_COPY, requestId }, 404);
}

function partyEventError(helpers, error, requestId) {
  const status = Number(error?.status || 500);
  if (status === 409 || status === 400) {
    return helpers.jsonResponse({ ok: false, error: error.code || "invalid_party_event", message: error.message, requestId }, status);
  }
  throw error;
}

/** A party's own choice / condition / agreement change from its link: actor = that party. */
export async function handlePartySessionEvent({ token, env, request, requestId, helpers, ip }) {
  if (partyRateLimited(helpers, "party-event", ip)) throw helpers.appError("rate_limited", 429, "محاولات كثيرة. حاول بعد قليل.");
  const ctx = await resolvePartyContext({ token, env, helpers }).catch(() => null);
  if (!ctx) return partyInvalid(helpers, requestId);
  const body = await request.json().catch(() => ({}));
  let event;
  if (body.agreement && typeof body.agreement === "object") {
    const field = AGREEMENT_FIELDS.find((item) => item.id === String(body.agreement.field || "").trim());
    const value = String(body.agreement.value || "").trim().slice(0, 300);
    if (!field || !value) return helpers.jsonResponse({ ok: false, error: "agreement_invalid", message: "اختر بند الاتفاق واكتب قيمته.", requestId }, 400);
    event = { eventType: MATCH_EVENT_TYPE.AGREEMENT_UPDATED, payload: { field: field.id, fieldLabel: field.label, value } };
  } else {
    const choice = partyLinkChoices(ctx.party).find((item) => item.id === String(body.choiceId || "").trim());
    if (!choice) return helpers.jsonResponse({ ok: false, error: "choice_invalid", message: "هذا الخيار غير متاح.", requestId }, 400);
    const condition = String(body.condition || "").trim().slice(0, 500);
    event = { eventType: choice.eventType, payload: { choiceId: choice.id, label: choice.label, ...(condition ? { condition } : {}) } };
  }
  const clientEventId = String(body.clientEventId || "").trim().slice(0, 80);
  try {
    const result = await appendMatchEventRecord(helpers, {
      projectId: ctx.projectId, officeId: ctx.officeId, matchId: ctx.matchId, accessToken: ctx.accessToken, env,
      resolveOperationId: resolveMatchReviewOperationId,
      event: {
        ...event,
        eventId: clientEventId ? await matchEventId(helpers, [ctx.matchId, ctx.party, ctx.sessionId, clientEventId]) : "",
        actorType: ctx.party === "owner" ? MATCH_EVENT_ACTOR.OWNER : MATCH_EVENT_ACTOR.CLIENT,
        actorId: ctx.sessionId,
        source: MATCH_EVENT_SOURCE.PARTY_LINK
      }
    });
    return helpers.jsonResponse({ ok: true, event: result.event, duplicate: result.duplicate, requestId });
  } catch (error) {
    return partyEventError(helpers, error, requestId);
  }
}

/** LINK_OPENED: the link was opened. Not read, not approved, not delivered. */
export async function handlePartySessionOpened({ token, env, request, requestId, helpers, ip }) {
  if (partyRateLimited(helpers, "party-opened", ip)) throw helpers.appError("rate_limited", 429, "محاولات كثيرة. حاول بعد قليل.");
  const ctx = await resolvePartyContext({ token, env, helpers }).catch(() => null);
  if (!ctx) return partyInvalid(helpers, requestId);
  const body = await request.json().catch(() => ({}));
  const openId = String(body.openId || "").trim().slice(0, 80) || new Date().toISOString().slice(0, 16);
  const result = await appendMatchEventRecord(helpers, {
    projectId: ctx.projectId, officeId: ctx.officeId, matchId: ctx.matchId, accessToken: ctx.accessToken, env,
    allowWhenClosed: true, resolveOperationId: resolveMatchReviewOperationId,
    event: {
      eventId: await matchEventId(helpers, [ctx.matchId, ctx.party, "LINK_OPENED", ctx.sessionId, openId]),
      eventType: MATCH_EVENT_TYPE.LINK_OPENED,
      actorType: ctx.party === "owner" ? MATCH_EVENT_ACTOR.OWNER : MATCH_EVENT_ACTOR.CLIENT,
      actorId: ctx.sessionId,
      source: MATCH_EVENT_SOURCE.PARTY_LINK,
      payload: { partyType: ctx.party }
    }
  });
  return helpers.jsonResponse({ ok: true, eventId: result.event.eventId, duplicate: result.duplicate, requestId });
}

/** Cheap poll for an open party page: changes whenever a new event or lifecycle lands. */
export async function handlePartySessionState({ token, env, requestId, helpers, ip }) {
  if (partyRateLimited(helpers, "party-state", ip)) throw helpers.appError("rate_limited", 429, "محاولات كثيرة. حاول بعد قليل.");
  const ctx = await resolvePartyContext({ token, env, helpers }).catch(() => null);
  if (!ctx) return partyInvalid(helpers, requestId);
  const match = await readOfficeDoc(helpers, { projectId: ctx.projectId, officeId: ctx.officeId, collection: "matches", id: ctx.matchId, accessToken: ctx.accessToken });
  if (!match) return partyInvalid(helpers, requestId);
  const lifecycle = matchLifecycleOf(match);
  return helpers.jsonResponse({ ok: true, stateVersion: `${match.lastEventAt || ""}|${lifecycle}`, lifecycle, requestId });
}

export async function handlePartySessionGet({ token, env, requestId, helpers, ip }) {
  try {
    return await getPartySessionPublic({ token, env, requestId, helpers, ip });
  } catch (error) {
    if (error && error.status === 429) throw error;
    return helpers.jsonResponse({ ok: false, error: "invalid_party_link", message: PARTY_INVALID_COPY, requestId }, 404);
  }
}

async function getPartySessionPublic({ token, env, requestId, helpers, ip }) {
  const limited = helpers.consumePublicRateLimit(
    helpers.publicRateLimitKey({ route: "party-get", ip }),
    helpers.PUBLIC_RATE_LIMITS.PUBLIC_PARTY
  );
  if (!limited.ok) {
    throw helpers.appError("rate_limited", 429, "محاولات كثيرة. حاول بعد قليل.");
  }
  const loaded = await loadPartyPublicView({ token, env, helpers });
  if (!loaded) {
    return helpers.jsonResponse({ ok: false, error: "invalid_party_link", message: PARTY_INVALID_COPY, requestId }, 404);
  }
  if (!loaded.session.openedAt) {
    const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
    const accessToken = await helpers.getGoogleAccessToken(env);
    const now = new Date().toISOString();
    await helpers.setFirestoreDocument({
      projectId,
      segments: ["offices", loaded.officeId, "partySessions", loaded.sessionId],
      accessToken,
      fields: { openedAt: helpers.firestoreString(now) }
    });
    await stampMatchLiving(helpers, {
      projectId,
      officeId: loaded.officeId,
      matchId: loaded.session.matchId,
      accessToken,
      patch: {
        livingStage: loaded.session.livingStage || loaded.session.currentStage || "",
        activeMatchId: loaded.session.matchId,
        hasNewResponse: false,
        timelineEvent: {
          type: "party_opened",
          actor: loaded.session.party === "owner" ? "OWNER" : "CLIENT",
          label: partyReplyTimelineLabel(loaded.session.party, "opened")
        }
      }
    });
  }
  return helpers.jsonResponse({ ok: true, view: loaded.view, requestId });
}

export async function handlePartySessionReply({ token, env, request, requestId, helpers, ip }) {
  try {
    return await replyPartySession({ token, env, request, requestId, helpers, ip });
  } catch (error) {
    if (error && (error.status === 429 || error.status === 400)) throw error;
    return helpers.jsonResponse({ ok: false, error: "invalid_party_link", message: PARTY_INVALID_COPY, requestId }, 404);
  }
}

async function replyPartySession({ token, env, request, requestId, helpers, ip }) {
  const limited = helpers.consumePublicRateLimit(
    helpers.publicRateLimitKey({ route: "party-reply", ip }),
    helpers.PUBLIC_RATE_LIMITS.PUBLIC_PARTY
  );
  if (!limited.ok) {
    throw helpers.appError("rate_limited", 429, "محاولات كثيرة. حاول بعد قليل.");
  }
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "").trim();
  const loaded = await loadPartyPublicView({ token, env, helpers });
  if (!loaded) {
    return helpers.jsonResponse({ ok: false, error: "invalid_party_link", message: PARTY_INVALID_COPY, requestId }, 404);
  }
  if (loaded.view?.negotiation?.readOnly) {
    return helpers.jsonResponse({ ok: false, error: "match_read_only", message: "المطابقة مغلقة — لا يمكن إضافة تعديل جديد.", view: loaded.view, requestId }, 409);
  }
  if (!isAllowedPartyAction(loaded.session.party, action, loaded.session.replyAction || "")) {
    throw helpers.appError("invalid_party_action", 400, "هذا الرد غير متاح.");
  }
  const alreadyPrimary = loaded.session.status === PARTY_SESSION_STATUS.REPLIED && loaded.session.replyAction;
  const isFollowUp = alreadyPrimary && !isPrimaryPartyAction(loaded.session.party, action);
  if (alreadyPrimary && !isFollowUp) {
    return helpers.jsonResponse({ ok: true, view: loaded.view, requestId });
  }
  if (alreadyPrimary && loaded.session.followUpAction) {
    return helpers.jsonResponse({ ok: true, view: loaded.view, requestId });
  }
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const now = new Date();
  const snapshot = loaded.session.shareSnapshot?.permitted || loaded.session.snapshot || {};
  const living = livingStageAfterPartyAction({
    party: loaded.session.party,
    action,
    followUp: isFollowUp,
    snapshot,
    hasNextCandidate: false
  });
  const fields = isFollowUp
    ? {
      followUpAction: helpers.firestoreString(action),
      followUpAt: helpers.firestoreString(now.toISOString()),
      livingStage: helpers.firestoreString(living.stage)
    }
    : {
      status: helpers.firestoreString(PARTY_SESSION_STATUS.REPLIED),
      replyAction: helpers.firestoreString(action),
      replyAt: helpers.firestoreString(now.toISOString()),
      livingStage: helpers.firestoreString(living.stage)
    };
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["offices", loaded.officeId, "partySessions", loaded.sessionId],
    accessToken,
    fields
  });
  await stampMatchLiving(helpers, {
    projectId,
    officeId: loaded.officeId,
    matchId: loaded.session.matchId,
    accessToken,
    patch: {
      livingStage: living.stage,
      missingInfoKey: living.missingInfoKey || "",
      ownerContactNeeded: Boolean(living.ownerContactNeeded),
      rejectedMatchIds: living.rejectCandidate ? [loaded.session.matchId] : [],
      activeMatchId: loaded.session.matchId,
      hasNewResponse: true,
      nextActor: nextActorForLivingStage(living.stage, { ownerContactNeeded: Boolean(living.ownerContactNeeded) }),
      timelineEvent: {
        type: `party_reply_${action}`,
        actor: loaded.session.party === "owner" ? "OWNER" : "CLIENT",
        label: partyReplyTimelineLabel(loaded.session.party, action)
      }
    }
  });
  const opportunityId = String(
    loaded.session.requestId
    || loaded.session.opportunityId
    || loaded.session.offerId
    || loaded.session.shareSnapshot?.permitted?.opportunityId
    || ""
  );
  const livingNotification = await buildLivingEventNotification({
    officeId: loaded.officeId,
    matchId: loaded.session.matchId || "",
    opportunityId,
    taskId: loaded.session.matchId ? `mg_${loaded.session.matchId}` : opportunityId,
    party: loaded.session.party,
    action,
    livingStage: living.stage,
    now
  });
  await upsertNotificationDocument({
    projectId,
    officeId: loaded.officeId,
    notification: livingNotification,
    accessToken,
    setFirestoreDocument: helpers.setFirestoreDocument,
    getFirestoreDocument: helpers.getFirestoreDocument,
    firestoreHelpers: helpers
  });
  const next = await loadPartyPublicView({ token, env, helpers });
  return helpers.jsonResponse({ ok: true, view: next?.view || loaded.view, requestId });
}

export async function handlePartySessionPhoto({ token, index, env, helpers, ip }) {
  const limited = helpers.consumePublicRateLimit(
    helpers.publicRateLimitKey({ route: "party-photo", ip }),
    helpers.PUBLIC_RATE_LIMITS.PUBLIC_PARTY
  );
  if (!limited.ok) {
    throw helpers.appError("rate_limited", 429, "محاولات كثيرة. حاول بعد قليل.");
  }
  const loaded = await loadPartyPublicView({ token, env, helpers });
  if (!loaded) {
    return helpers.jsonResponse({ ok: false, error: "invalid_party_link", message: PARTY_INVALID_COPY }, 404);
  }
  const paths = listingMediaPaths({
    mediaPaths: loaded.session.mediaPaths || loaded.session.snapshot?.mediaPaths || []
  });
  const mediaPath = paths[Number(index)];
  if (!mediaPath || !OFFICE_MEDIA_KEY_PATTERN.test(mediaPath) || !mediaPath.includes(`/${loaded.officeId}/`)) {
    return helpers.jsonResponse({ ok: false, error: "media_not_found" }, 404);
  }
  const bucket = env.IAQAR_MEDIA;
  if (!bucket?.get) {
    return helpers.jsonResponse({ ok: false, error: "media_not_found" }, 404);
  }
  const object = await bucket.get(mediaPath);
  if (!object) {
    return helpers.jsonResponse({ ok: false, error: "media_not_found" }, 404);
  }
  const headers = new Headers();
  if (object.writeHttpMetadata) object.writeHttpMetadata(headers);
  headers.set("cache-control", "private, max-age=300");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}

export async function handlePartySessionBundle({ token, env, request, requestId, helpers, ip, executionContext }) {
  try {
    return await submitPartyBundle({ token, env, request, requestId, helpers, ip, executionContext });
  } catch (error) {
    if (error && (error.status === 429 || error.status === 403 || error.status === 400)) throw error;
    console.error("[iaqar] owner/client bundle submit failed", {
      requestId,
      code: String(error?.code || "party_bundle_failed")
    });
    return helpers.jsonResponse({
      ok: false,
      error: String(error?.code || "party_bundle_failed"),
      message: "تعذر تسجيل الرد. تحقق من الاتصال ثم حاول مرة أخرى.",
      requestId
    }, 500);
  }
}

export async function submitPartyBundle({ token, env, request, requestId, helpers, ip, executionContext }) {
  const limited = helpers.consumePublicRateLimit(
    helpers.publicRateLimitKey({ route: "party-bundle", ip }),
    helpers.PUBLIC_RATE_LIMITS.PUBLIC_PARTY
  );
  if (!limited.ok) {
    throw helpers.appError("rate_limited", 429, "محاولات كثيرة. حاول بعد قليل.");
  }
  const loaded = await loadPartyPublicView({ token, env, helpers });
  if (!loaded) {
    return helpers.jsonResponse({ ok: false, error: "invalid_party_link", message: PARTY_INVALID_COPY, requestId }, 404);
  }
  if (loaded.view?.negotiation?.readOnly) {
    return helpers.jsonResponse({ ok: false, error: "match_read_only", message: "المطابقة مغلقة — لا يمكن إضافة تعديل جديد.", view: loaded.view, requestId }, 409);
  }
  const { bundle, photos } = await parseBundleRequest(request);
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const matchId = String(loaded.session.matchId || "").trim();
  const party = loaded.session.party === "owner" ? "owner" : "client";
  assertPartyBundleRole(party, bundle, helpers);
  const offerId = String(loaded.session.offerId || loaded.canonicalOffer?.id || "").trim();
  const canonicalOffer = loaded.canonicalOffer || {};
  if (party === "owner" && photos.length) {
    const mediaPaths = Array.isArray(bundle.mediaPaths) ? [...bundle.mediaPaths] : [];
    for (let index = 0; index < photos.length; index += 1) {
      const key = await uploadOwnerCoordinationPhoto(helpers, env, {
        officeId: loaded.officeId,
        offerId: offerId || matchId,
        file: photos[index],
        index
      });
      mediaPaths.push(key);
    }
    bundle.mediaPaths = [...new Set(mediaPaths)];
  }
  const locationUrl = text(canonicalOffer.locationUrl || canonicalOffer.mapUrl || loaded.view?.property?.locationUrl);
  const coordinationSession = await submitCoordinationBundle(helpers, {
    projectId,
    officeId: loaded.officeId,
    matchId,
    party,
    bundleRaw: bundle,
    accessToken,
    canonicalOffer,
    offerId,
    locationUrl
  });
  const now = new Date();
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["offices", loaded.officeId, "partySessions", loaded.sessionId],
    accessToken,
    fields: {
      status: helpers.firestoreString(PARTY_SESSION_STATUS.REPLIED),
      replyAction: helpers.firestoreString("coordination_bundle"),
      replyAt: helpers.firestoreString(now.toISOString()),
      livingStage: helpers.firestoreString(coordinationSession.outcome || "")
    }
  });
  const finalizeBrokerState = async () => {
    await applyCoordinationToMatch(helpers, {
      projectId,
      officeId: loaded.officeId,
      matchId,
      accessToken,
      coordinationSession,
      stampMatchLiving
    });
    const livingNotification = await buildLivingEventNotification({
      officeId: loaded.officeId,
      matchId,
      opportunityId: String(loaded.session.requestId || loaded.session.opportunityId || loaded.session.offerId || ""),
      taskId: matchId ? `mg_${matchId}` : "",
      party,
      action: "coordination_bundle",
      livingStage: coordinationSession.outcome || "",
      now
    });
    await upsertNotificationDocument({
      projectId,
      officeId: loaded.officeId,
      notification: livingNotification,
      accessToken,
      setFirestoreDocument: helpers.setFirestoreDocument,
      getFirestoreDocument: helpers.getFirestoreDocument,
      firestoreHelpers: helpers
    });
  };
  await finalizeBrokerState();
  const coordinationOrchestration = await dispatchOrchestratorEvent({
    event: ORCHESTRATOR_EVENT.COORDINATION_UPDATED,
    eventId: buildOrchestratorEventId({
      event: ORCHESTRATOR_EVENT.COORDINATION_UPDATED,
      officeId: loaded.officeId,
      entityId: matchId,
      occurrenceId: `${party}:${coordinationSession.outcome || "updated"}`
    }),
    context: {
      officeId: loaded.officeId,
      entityId: matchId,
      party,
      outcome: coordinationSession.outcome || ""
    },
    adapters: {
      [ORCHESTRATOR_OWNER.TASKS]: async () => ({ ok: true })
    },
    deferredTargets: [ORCHESTRATOR_OWNER.VIEWING]
  });
  if (!coordinationOrchestration.ok) {
    throw helpers.appError("orchestrator_dispatch_failed", 500, "تعذر تحديث حالة التفاوض.");
  }
  const next = await loadPartyPublicView({ token, env, helpers });
  return helpers.jsonResponse({ ok: true, view: next?.view || loaded.view, requestId });
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export async function handleMatchLivingAction({
  request,
  env,
  requestId,
  helpers
}) {
  const body = await request.json().catch(() => ({}));
  const officeId = helpers.firestoreOfficeId(body.officeId);
  if (!officeId) throw helpers.appError("office_id_required", 400, "تعذر تحديد المكتب");
  await helpers.authorizeOfficeRequest(request, env, officeId, "member");
  helpers.assertFirebaseSecrets(env);
  const matchId = helpers.cleanText(body.matchId, 180);
  if (!matchId) throw helpers.appError("match_id_required", 400, "تعذر تحديد المطابقة");
  const action = String(body.action || "").toUpperCase();
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  if (action === "CONFIRM_VIEWING") {
    const match = await readOfficeDoc(helpers, {
      projectId, officeId, collection: "matches", id: matchId, accessToken
    });
    if (!match) throw helpers.appError("match_not_found", 404, "المطابقة غير موجودة.");
    const currentPlan = planViewingConfirmation({ match, evaluation: null });
    if (currentPlan.ok && currentPlan.idempotent) {
      return helpers.jsonResponse({
        ok: true,
        idempotent: true,
        livingStage: LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED,
        appointmentStatus: currentPlan.appointmentStatus,
        appointmentAt: currentPlan.appointmentAt,
        requestId
      });
    }
    if (currentPlan.error === "viewing_already_confirmed") {
      throw helpers.appError(
        "viewing_already_confirmed",
        409,
        "المعاينة مؤكدة مسبقًا. استخدم إعادة الجدولة لتغيير الموعد."
      );
    }
    const candidateStart = canonicalViewingCandidateAt(match);
    if (!candidateStart) {
      throw helpers.appError("viewing_candidate_missing", 400, "لا يوجد موعد معاينة جاهز للتأكيد.");
    }
    let officeMatches = [];
    if (typeof helpers.listCollectionDocuments === "function") {
      const docs = await helpers.listCollectionDocuments({
        projectId,
        segments: ["offices", officeId, "matches"],
        accessToken,
        pageSize: 200
      });
      officeMatches = (docs || []).map((doc) => {
        const id = decodeURIComponent(String(doc.name || "").split("/").pop() || "");
        return { id, ...js(doc, helpers) };
      });
    }
    const bookedStarts = collectBrokerBookedStarts(officeMatches, {
      brokerId: match.assignedBrokerId || match.brokerId,
      excludeMatchId: matchId,
      now: new Date()
    });
    const evaluation = evaluateViewingCandidate({
      candidateStart,
      bookedStarts,
      candidateRecord: match
    });
    const confirmation = planViewingConfirmation({ match, evaluation });
    if (!confirmation.ok) {
      const code = confirmation.error === "viewing_candidate_missing"
        ? "viewing_candidate_missing"
        : "viewing_schedule_conflict";
      const status = code === "viewing_candidate_missing" ? 400 : 409;
      const message = code === "viewing_candidate_missing"
        ? "لا يوجد موعد معاينة جاهز للتأكيد."
        : "تعارض في مواعيد المعاينة — اختر وقتًا آخر.";
      throw helpers.appError(code, status, message);
    }
    const appointmentStatus = confirmation.appointmentStatus;
    await stampMatchLiving(helpers, {
      projectId,
      officeId,
      matchId,
      accessToken,
      patch: {
        livingStage: LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED,
        activeMatchId: matchId,
        ownerContactNeeded: false,
        hasNewResponse: true,
        ...confirmation.patch,
        nextActor: "NONE",
        timelineEvent: {
          type: "viewing_confirmed_by_broker",
          actor: "BROKER",
          label: confirmation.travelConfirmationRequired
            ? "تم تأكيد المعاينة (مع مراجعة وقت السفر)"
            : "تم تأكيد المعاينة"
        }
      }
    });
    const viewingOrchestration = await dispatchOrchestratorEvent({
      event: ORCHESTRATOR_EVENT.VIEWING_CONFIRMED,
      eventId: buildOrchestratorEventId({
        event: ORCHESTRATOR_EVENT.VIEWING_CONFIRMED, officeId, entityId: matchId, occurrenceId: confirmation.appointmentAt
      }),
      context: { officeId, entityId: matchId, appointmentAt: confirmation.appointmentAt },
      adapters: {
        [ORCHESTRATOR_OWNER.TASKS]: async () => ({ ok: true })
      }
    });
    if (!viewingOrchestration.ok) {
      throw helpers.appError("orchestrator_dispatch_failed", 500, `فشل تنسيق المعاينة: ${viewingOrchestration.error || "unknown"}`);
    }
    if (typeof helpers.sendViewingConfirmation === "function") {
      await helpers.sendViewingConfirmation({
        projectId, officeId, matchId, match,
        appointmentAt: confirmation.appointmentAt,
        accessToken, env
      }).catch((error) => console.warn("[iaqar-viewing] confirmation push failed", error?.message || error));
    }

    return helpers.jsonResponse({
      ok: true,
      idempotent: false,
      livingStage: LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED,
      appointmentStatus,
      appointmentAt: confirmation.appointmentAt,
      requestId
    });
  }
  if (action === "CONFIRM_VIEWING_COMPLETED") {
    const match = await readOfficeDoc(helpers, {
      projectId, officeId, collection: "matches", id: matchId, accessToken
    });
    if (!match) throw helpers.appError("match_not_found", 404, "المطابقة غير موجودة.");
    const completion = planViewingCompletion({ match, now: new Date() });
    if (!completion.ok) {
      if (completion.error === "viewing_not_confirmed") {
        throw helpers.appError("viewing_not_confirmed", 409, "يجب تأكيد موعد المعاينة أولًا.");
      }
      if (completion.error === "viewing_not_started_yet") {
        throw helpers.appError("viewing_not_started_yet", 409, "لا يمكن تسجيل إتمام المعاينة قبل موعدها.");
      }
      throw helpers.appError("viewing_completion_invalid", 400, "تعذر تسجيل إتمام المعاينة.");
    }
    if (!completion.idempotent) {
      await stampMatchLiving(helpers, {
        projectId, officeId, matchId, accessToken,
        patch: {
          livingStage: LIVING_TASK_STAGE.VIEWING_COMPLETED,
          activeMatchId: matchId,
          ownerContactNeeded: false,
          hasNewResponse: false,
          ...completion.patch,
          nextActor: "BROKER",
          timelineEvent: {
            type: "viewing_completed_by_broker",
            actor: "BROKER",
            label: "تمت المعاينة"
          }
        }
      });
      const viewingCompletionOrchestration = await dispatchOrchestratorEvent({
        event: ORCHESTRATOR_EVENT.VIEWING_COMPLETED,
        eventId: buildOrchestratorEventId({
          event: ORCHESTRATOR_EVENT.VIEWING_COMPLETED, officeId, entityId: matchId, occurrenceId: completion.completedAt
        }),
        context: { officeId, entityId: matchId, appointmentAt: completion.appointmentAt, completedAt: completion.completedAt },
        adapters: {
          [ORCHESTRATOR_OWNER.TASKS]: async () => ({ ok: true })
        }
      });
      if (!viewingCompletionOrchestration.ok) {
        throw helpers.appError("orchestrator_dispatch_failed", 500, `فشل تنسيق إتمام المعاينة: ${viewingCompletionOrchestration.error || "unknown"}`);
      }
    }
    return helpers.jsonResponse({
      ok: true,
      idempotent: Boolean(completion.idempotent),
      livingStage: LIVING_TASK_STAGE.VIEWING_COMPLETED,
      appointmentAt: completion.appointmentAt,
      viewingCompletedAt: completion.completedAt,
      requestId
    });
  }
  if (action === "SET_VIEWING_OUTCOME") {
    const outcome = String(body.outcome || "").toUpperCase();
    const allowedOutcomes = new Set(["SERIOUS", "FOLLOW_UP", "NOT_SERIOUS"]);
    if (!allowedOutcomes.has(outcome)) {
      throw helpers.appError("viewing_outcome_invalid", 400, "نتيجة المعاينة غير صحيحة.");
    }
    const match = await readOfficeDoc(helpers, {
      projectId, officeId, collection: "matches", id: matchId, accessToken
    });
    if (!match) throw helpers.appError("match_not_found", 404, "المطابقة غير موجودة.");
    if (!String(match.viewingCompletedAt || "").trim() && String(match.livingStage || "").toUpperCase() !== LIVING_TASK_STAGE.VIEWING_COMPLETED) {
      throw helpers.appError("viewing_not_completed", 409, "سجّل إتمام المعاينة قبل تقييم الجدية.");
    }
    const serious = outcome === "SERIOUS";
    await stampMatchLiving(helpers, {
      projectId, officeId, matchId, accessToken,
      patch: {
        livingStage: LIVING_TASK_STAGE.VIEWING_COMPLETED,
        activeMatchId: matchId,
        ownerContactNeeded: false,
        hasNewResponse: false,
        viewingOutcome: outcome,
        seriousIntentConfirmed: serious,
        nextActor: serious ? "BROKER" : "NONE",
        timelineEvent: {
          type: "viewing_outcome_recorded",
          actor: "BROKER",
          label: serious
            ? "تم تأكيد الجدية بعد المعاينة"
            : outcome === "FOLLOW_UP"
              ? "تم اختيار المتابعة بعد المعاينة"
              : "لا توجد جدية بعد المعاينة"
        }
      }
    });
    return helpers.jsonResponse({
      ok: true, livingStage: LIVING_TASK_STAGE.VIEWING_COMPLETED, viewingOutcome: outcome, seriousIntentConfirmed: serious, requestId
    });
  }
  if (action === "CONFIRM_COMPLETION") {
    throw helpers.appError(
      "legacy_match_completion_removed",
      409,
      "إتمام الصفقة يتم من مسار الصفقة بعد الجدية وعقد الوساطة، وليس من المطابقة."
    );
  }
  throw helpers.appError("unknown_action", 400, "إجراء غير معروف.");
}
