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
import { livingStageAfterPartyAction, appendLivingTimeline, nextActorForLivingStage, partyReplyTimelineLabel } from "../../public/js/match-group-domain.js";
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
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "matches", id],
    accessToken,
    fields: {
      livingStage: helpers.firestoreString(livingStage),
      missingInfoKey: helpers.firestoreString(missingInfoKey),
      ownerContactNeeded: helpers.firestoreString(ownerContactNeeded ? "true" : ""),
      rejectedMatchIds: helpers.firestoreString(JSON.stringify(rejected)),
      activeMatchId: helpers.firestoreString(activeMatchId),
      livingUpdatedAt: helpers.firestoreString(livingUpdatedAt),
      livingTimelineJson: helpers.firestoreString(JSON.stringify(timeline)),
      hasNewResponse: helpers.firestoreString(hasNewResponse ? "true" : ""),
      nextActor: helpers.firestoreString(nextActor)
    }
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
      nextActor: helpers.firestoreString(nextActor)
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
    if (session && session.status !== PARTY_SESSION_STATUS.REVOKED && session.token && isOpaquePartyToken(session.token)) {
      return helpers.jsonResponse({
        ok: true,
        token: session.token,
        reused: true,
        requestId
      });
    }
  }

  const offerId = helpers.cleanText(body.offerId || body.ownerOfferId, 180);
  const requestRecordId = helpers.cleanText(body.requestId || body.clientRequestId, 180);
  const liveOffer = await loadCanonicalOfferListing(helpers, {
    projectId,
    officeId,
    accessToken,
    matchId,
    body: { offerId, ownerOfferId: offerId, opportunityId: helpers.cleanText(body.opportunityId, 180) }
  });
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
  const snapshot = session.shareSnapshot?.permitted || session.snapshot || {};
  const revealed = session.revealedDetail || revealedDetailFromSnapshot(snapshot, session.followUpAction || "");
  return {
    session,
    officeId,
    sessionId,
    view: sanitizePartyPublicView({
      party: session.party,
      status: session.status,
      snapshot,
      officeName: office.officeName || office.name || "المكتب العقاري",
      officeLogoUrl: logoUrl,
      replyAction: session.replyAction || "",
      followUpAction: session.followUpAction || "",
      revealedDetail: revealed,
      livingStage: session.livingStage || session.currentStage || ""
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
  if (action !== "CONFIRM_COMPLETION") {
    throw helpers.appError("unknown_action", 400, "إجراء غير معروف.");
  }
  const projectId = env.FIREBASE_PROJECT_ID || helpers.DEFAULT_PROJECT_ID;
  const accessToken = await helpers.getGoogleAccessToken(env);
  await stampMatchLiving(helpers, {
    projectId,
    officeId,
    matchId,
    accessToken,
    patch: {
      livingStage: "COMPLETED",
      activeMatchId: matchId,
      ownerContactNeeded: false,
      hasNewResponse: false,
      nextActor: "NONE",
      timelineEvent: {
        type: "deal_completed",
        actor: "BROKER",
        label: "تم إتمام الصفقة"
      }
    }
  });
  return helpers.jsonResponse({ ok: true, livingStage: "COMPLETED", requestId });
}
