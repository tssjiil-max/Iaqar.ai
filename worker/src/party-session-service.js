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
  submitCoordinationBundle
} from "./coordination-session-service.js";
import { upsertNotificationDocument } from "./operations-service.js";
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

const OFFICE_MEDIA_KEY_PATTERN = /^(?:public-intake|office-library|opportunity-sources)\/[a-z0-9_-]{1,80}\//i;
const PARTY_IMAGE_TYPES = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
});

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
  const operationId = String(match.operationId || "").trim();
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
  await stampMatchLiving(helpers, {
    projectId,
    officeId,
    matchId,
    accessToken,
    patch: {
      livingStage: party === "owner" ? "WAITING_PROPERTY_CONFIRMATION" : "WAITING_CLIENT",
      activeMatchId: matchId,
      ownerContactNeeded: false,
      hasNewResponse: false,
      nextActor: party === "owner" ? "OWNER" : "CLIENT",
      timelineEvent: {
        type: party === "owner" ? "whatsapp_owner_opened" : "whatsapp_client_opened",
        actor: "BROKER",
        label: party === "owner" ? "تم فتح واتساب للمالك" : "تم فتح واتساب للعميل"
      }
    }
  });
  await ensureCoordinationSession(helpers, {
    projectId,
    officeId,
    matchId,
    accessToken,
    clientSessionId: party === "client" ? sessionId : "",
    ownerSessionId: party === "owner" ? sessionId : ""
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
    view: sanitizePartyPublicView({
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
    })
  };
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
    if (error && (error.status === 429 || error.status === 400)) throw error;
    const coordinationOrchestration = await dispatchOrchestratorEvent({
    event: ORCHESTRATOR_EVENT.COORDINATION_UPDATED,
    eventId: buildOrchestratorEventId({
      event: ORCHESTRATOR_EVENT.COORDINATION_UPDATED,
      officeId: loaded.officeId,
      entityId: matchId,
      occurrenceId: `${party}:${coordinationSession.outcome || "updated"}`
    }),
    context: { officeId: loaded.officeId, entityId: matchId, party, outcome: coordinationSession.outcome || "" },
    adapters: {
      [ORCHESTRATOR_OWNER.TASKS]: async () => ({ ok: Boolean(coordinationSession) })
    },
    deferredTargets: [ORCHESTRATOR_OWNER.VIEWING]
  });
  if (!coordinationOrchestration.ok) {
    throw helpers.appError("orchestrator_dispatch_failed", 500, `فشل تنسيق التفاوض: ${coordinationOrchestration.error || "unknown"}`);
  }

  return helpers.jsonResponse({ ok: false, error: "invalid_party_link", message: PARTY_INVALID_COPY, requestId }, 404);
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
  const { bundle, photos } = await parseBundleRequest(request);
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  const matchId = String(loaded.session.matchId || "").trim();
  const party = loaded.session.party === "owner" ? "owner" : "client";
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
