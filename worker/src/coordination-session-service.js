/**
 * Coordination session persistence — worker only.
 */

import {
  brokerCoordinationLine,
  clientBundleSummary,
  livingStageForCoordinationOutcome,
  normalizeClientBundle,
  normalizeOwnerBundle,
  ownerBundleSummary,
  ownerContactNeededForCoordination,
  PRICE_CONFIRMATION,
  QUESTION_SET_VERSIONS,
  resolveCoordinationOutcome,
  resolveOwnerContactNeeded,
  resolveViewingWindowStart,
  bundlesEqual,
  ownerMissingSpecGroups
} from "../../public/js/coordination-bundle-domain.js";
import { detailValuesToCanonicalPatch } from "../../public/js/property-detail-schema-domain.js";
import {
  VIEWING_APPOINTMENT_STATUS
} from "../../public/js/broker-viewing-schedule-domain.js";
import {
  appendCoordinationEvent,
  emptyCoordinationSession,
  parseCoordinationSession
} from "../../public/js/coordination-session-domain.js";
import { listingMediaPaths } from "../../public/js/party-session-domain.js";
import { nextActorForLivingStage } from "../../public/js/match-group-domain.js";

function js(doc, helpers) {
  return helpers.firestoreFieldsToJs(doc?.fields ? doc.fields : {});
}

async function readOfficeDoc(helpers, { projectId, officeId, collection, id, accessToken }) {
  if (!id) return null;
  const doc = await helpers.getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, collection, id],
    accessToken,
    allowMissing: true
  });
  return doc ? js(doc, helpers) : null;
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function uniqueList(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((v) => text(v)).filter(Boolean))];
}

export async function loadCoordinationSession(helpers, {
  projectId,
  officeId,
  matchId,
  accessToken,
  canonicalOffer = null
}) {
  const id = String(matchId || "").trim();
  if (!id) return emptyCoordinationSession();
  const doc = await readOfficeDoc(helpers, {
    projectId,
    officeId,
    collection: "coordinationSessions",
    id,
    accessToken
  });
  if (!doc) return emptyCoordinationSession(id, officeId);
  try {
    const raw = doc.coordinationJson
      ? JSON.parse(String(doc.coordinationJson || "{}"))
      : doc;
    const offer = canonicalOffer || {};
    return parseCoordinationSession({ ...raw, matchId: id, officeId }, { canonicalOffer: offer });
  } catch {
    return emptyCoordinationSession(id, officeId);
  }
}

export async function saveCoordinationSession(helpers, {
  projectId,
  officeId,
  matchId,
  accessToken,
  session
}) {
  const id = String(matchId || session?.matchId || "").trim();
  if (!id) return null;
  const now = new Date().toISOString();
  const payload = {
    ...session,
    matchId: id,
    officeId,
    updatedAt: now,
    createdAt: text(session.createdAt) || now
  };
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "coordinationSessions", id],
    accessToken,
    fields: {
      matchId: helpers.firestoreString(id),
      officeId: helpers.firestoreString(officeId),
      coordinationJson: helpers.firestoreString(JSON.stringify(payload)),
      outcome: helpers.firestoreString(payload.outcome || ""),
      brokerLine: helpers.firestoreString(payload.brokerLine || ""),
      updatedAt: helpers.firestoreString(now)
    }
  });
  return payload;
}

export async function ensureCoordinationSession(helpers, {
  projectId,
  officeId,
  matchId,
  accessToken,
  clientSessionId = "",
  ownerSessionId = ""
}) {
  const existing = await loadCoordinationSession(helpers, {
    projectId,
    officeId,
    matchId,
    accessToken
  });
  if (existing.createdAt) {
    const updates = { ...existing };
    if (clientSessionId && !updates.clientSessionId) updates.clientSessionId = clientSessionId;
    if (ownerSessionId && !updates.ownerSessionId) updates.ownerSessionId = ownerSessionId;
    if (updates.clientSessionId !== existing.clientSessionId
      || updates.ownerSessionId !== existing.ownerSessionId) {
      return saveCoordinationSession(helpers, {
        projectId,
        officeId,
        matchId,
        accessToken,
        session: updates
      });
    }
    return existing;
  }
  const now = new Date().toISOString();
  const session = {
    ...emptyCoordinationSession(matchId, officeId),
    clientSessionId: text(clientSessionId),
    ownerSessionId: text(ownerSessionId),
    createdAt: now,
    updatedAt: now,
    eventLog: appendCoordinationEvent([], {
      type: "coordination_session_created",
      actor: "SYSTEM",
      label: "تم إنشاء جلسة التنسيق"
    }, { now: new Date(now) })
  };
  return saveCoordinationSession(helpers, {
    projectId,
    officeId,
    matchId,
    accessToken,
    session
  });
}

function specValuesToPatch(specValues = {}, propertyType = "") {
  const patch = {};
  const values = specValues && typeof specValues === "object" ? specValues : {};
  if (values.area != null && Number(values.area) > 0) patch.area = Number(values.area);
  if (values.rooms != null && Number(values.rooms) > 0) patch.rooms = Number(values.rooms);
  if (values.bathrooms != null && Number(values.bathrooms) > 0) patch.bathrooms = Number(values.bathrooms);
  if (values.floorNumber != null && Number(values.floorNumber) > 0) patch.floorNumber = Number(values.floorNumber);
  if (values.floors != null && Number(values.floors) > 0) patch.floors = Number(values.floors);
  if (values.facade) patch.facing = text(values.facade);
  if (values.streetWidth != null && Number(values.streetWidth) > 0) patch.streetWidth = Number(values.streetWidth);
  if (values.depth != null && Number(values.depth) > 0) patch.depth = Number(values.depth);
  if (values.plotNumber) patch.plotNumber = text(values.plotNumber);
  if (values.usage) patch.description = text(values.usage);
  if (values.parking) patch.parking = text(values.parking);
  return patch;
}

export async function applyOwnerCanonicalFromBundle(helpers, {
  projectId,
  officeId,
  offerId,
  accessToken,
  ownerBundle,
  canonicalOffer = {},
  session = {},
  locationUrl = ""
}) {
  if (!offerId || !ownerBundle) return { patch: {}, newMediaPaths: [] };
  const existing = await readOfficeDoc(helpers, {
    projectId,
    officeId,
    collection: "opportunities",
    id: offerId,
    accessToken
  }) || canonicalOffer;
  const patch = {};
  const events = [];
  if (ownerBundle.priceConfirmation === PRICE_CONFIRMATION.UPDATED && ownerBundle.updatedPrice) {
    patch.salePrice = ownerBundle.updatedPrice;
    patch.price = ownerBundle.updatedPrice;
    patch.priceOrBudget = ownerBundle.updatedPrice;
    events.push({ type: "OWNER_PRICE_UPDATED", label: "تم تحديث السعر" });
  } else if (ownerBundle.priceConfirmation === PRICE_CONFIRMATION.CONFIRMED) {
    events.push({ type: "OWNER_PRICE_CONFIRMED", label: "تم تأكيد السعر" });
  }
  if (ownerBundle.locationShare && locationUrl) {
    patch.locationUrl = locationUrl;
    events.push({ type: "OWNER_LOCATION_SHARED", label: "تم مشاركة موقع العقار" });
  }
  const specPatch = specValuesToPatch(ownerBundle.specValues, existing?.propertyType);
  const detailPatch = detailValuesToCanonicalPatch(ownerBundle.detailValues || {});
  Object.assign(patch, specPatch, detailPatch);
  const existingMedia = listingMediaPaths(existing);
  const bundleMedia = uniqueList(ownerBundle.mediaPaths || []);
  const applied = uniqueList(session.appliedMediaPaths || []);
  const newMedia = bundleMedia.filter((path) =>
    !existingMedia.includes(path) && !applied.includes(path)
  );
  if (newMedia.length) {
    patch.mediaPaths = uniqueList([...existingMedia, ...newMedia]).slice(0, 12);
    patch.imageCount = patch.mediaPaths.filter((p) => /image/i.test(p)).length;
    events.push({ type: "OWNER_MEDIA_ADDED", label: `أضيفت ${newMedia.length} صورة` });
  }
  if (!Object.keys(patch).length) return { patch: {}, newMediaPaths: newMedia, events };
  const fields = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) continue;
    if (key === "mediaPaths") {
      fields.mediaPaths = helpers.firestoreString(JSON.stringify(value));
      continue;
    }
    if (typeof value === "number") {
      fields[key] = helpers.firestoreInteger(value);
    } else {
      fields[key] = helpers.firestoreString(String(value));
    }
  }
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "opportunities", offerId],
    accessToken,
    fields
  });
  return { patch, newMediaPaths: newMedia, events };
}

export async function submitCoordinationBundle(helpers, {
  projectId,
  officeId,
  matchId,
  party,
  bundleRaw = {},
  accessToken,
  canonicalOffer = {},
  offerId = "",
  locationUrl = ""
}) {
  const side = party === "owner" ? "owner" : "client";
  const session = await loadCoordinationSession(helpers, {
    projectId,
    officeId,
    matchId,
    accessToken,
    canonicalOffer
  });
  const priorSideBundle = side === "owner" ? session.ownerBundle : session.clientBundle;
  const mergedBundleRaw = priorSideBundle ? { ...priorSideBundle, ...bundleRaw } : { ...bundleRaw };
  if (side === "owner" && priorSideBundle) {
    if (bundleRaw.detailConfirmations) {
      mergedBundleRaw.detailConfirmations = uniqueList([
        ...(priorSideBundle.detailConfirmations || []),
        ...bundleRaw.detailConfirmations
      ]);
    }
    if (bundleRaw.detailNeedsUpdate) {
      mergedBundleRaw.detailNeedsUpdate = uniqueList([
        ...(priorSideBundle.detailNeedsUpdate || []),
        ...bundleRaw.detailNeedsUpdate
      ]);
    }
  }
  const canonicalPrice = Number(canonicalOffer.salePrice || canonicalOffer.price || 0);
  const normalized = side === "owner"
    ? normalizeOwnerBundle({
      ...mergedBundleRaw,
      canonicalPrice,
      clientProposedPrice: session.clientBundle?.proposedPrice || 0
    })
    : normalizeClientBundle({
      ...mergedBundleRaw,
      propertyType: canonicalOffer.propertyType || mergedBundleRaw.propertyType,
      canonicalPrice
    });
  if (!normalized) {
    throw helpers.appError("invalid_coordination_bundle", 400, "تعذر قبول الرد. أكمل جميع الحقول المطلوبة.");
  }
  normalized.submittedAt = new Date().toISOString();
  const priorBundle = side === "owner" ? session.ownerBundle : session.clientBundle;
  if (priorBundle && bundlesEqual(priorBundle, normalized)) {
    return session;
  }
  const next = { ...session };
  let canonicalEvents = [];
  let newMediaPaths = [];
  if (side === "owner") {
    const canonicalResult = await applyOwnerCanonicalFromBundle(helpers, {
      projectId,
      officeId,
      offerId,
      accessToken,
      ownerBundle: normalized,
      canonicalOffer,
      session,
      locationUrl
    });
    canonicalEvents = canonicalResult.events || [];
    newMediaPaths = canonicalResult.newMediaPaths || [];
    if (newMediaPaths.length) {
      next.appliedMediaPaths = uniqueList([...(next.appliedMediaPaths || []), ...newMediaPaths]);
    }
    next.ownerBundle = normalized;
  } else {
    next.clientBundle = normalized;
  }
  const resolved = resolveCoordinationOutcome({
    clientBundle: next.clientBundle,
    ownerBundle: next.ownerBundle,
    canonicalOffer
  });
  next.outcome = resolved.outcome;
  next.brokerLine = resolved.brokerLine;
  next.conflictField = resolved.conflictField;
  const summary = side === "owner" ? ownerBundleSummary(normalized) : clientBundleSummary(normalized);
  next.eventLog = appendCoordinationEvent(next.eventLog || [], {
    type: side === "owner" ? "OWNER_PACKAGE_SUBMITTED" : "CLIENT_PACKAGE_SUBMITTED",
    actor: side === "owner" ? "OWNER" : "CLIENT",
    label: summary || "تم تسجيل الحزمة"
  });
  for (const event of canonicalEvents) {
    next.eventLog = appendCoordinationEvent(next.eventLog || [], event, { actor: "OWNER" });
  }
  if (next.clientBundle && next.ownerBundle) {
    next.eventLog = appendCoordinationEvent(next.eventLog || [], {
      type: "COORDINATION_RESOLVED",
      actor: "SYSTEM",
      label: resolved.brokerLine || resolved.outcome
    });
  }
  return saveCoordinationSession(helpers, {
    projectId,
    officeId,
    matchId,
    accessToken,
    session: next
  });
}

export async function applyCoordinationToMatch(helpers, {
  projectId,
  officeId,
  matchId,
  accessToken,
  coordinationSession,
  stampMatchLiving
}) {
  const session = parseCoordinationSession(coordinationSession);
  const living = livingStageForCoordinationOutcome(session.outcome, session);
  const ownerContactNeeded = resolveOwnerContactNeeded(session, session.outcome);
  const clientSummary = session.clientBundle ? clientBundleSummary(session.clientBundle) : "";
  const ownerSummary = session.ownerBundle ? ownerBundleSummary(session.ownerBundle) : "";
  const brokerLine = brokerCoordinationLine(session);
  const patch = {
    livingStage: living.stage,
    ownerContactNeeded: Boolean(ownerContactNeeded),
    activeMatchId: matchId,
    hasNewResponse: true,
    coordinationOutcome: session.outcome,
    coordinationBrokerLine: brokerLine,
    coordinationClientSummary: clientSummary,
    coordinationOwnerSummary: ownerSummary,
    nextActor: nextActorForLivingStage(living.stage, {
      ownerContactNeeded: Boolean(ownerContactNeeded)
    }),
    timelineEvent: {
      type: `coordination_${String(session.outcome || "").toLowerCase()}`,
      actor: "SYSTEM",
      label: session.brokerLine || session.outcome
    }
  };
  if (session.outcome === "VIEWING_READY" && session.clientBundle && session.ownerBundle) {
    const clientWindows = session.clientBundle.viewingWindows
      || [];
    const ownerWindows = session.ownerBundle.viewingWindows || [];
    const overlapStart = clientWindows.find((id) => ownerWindows.includes(id));
    if (overlapStart) {
      const candidateStart = resolveViewingWindowStart(overlapStart);
      patch.viewingCandidateAt = candidateStart;
      patch.appointmentStatus = VIEWING_APPOINTMENT_STATUS.CANDIDATE;
    }
  }
  await stampMatchLiving(helpers, {
    projectId,
    officeId,
    matchId,
    accessToken,
    patch
  });
  await stampSharedCooperationCoordinationState(helpers, {
    projectId,
    clientOfficeId: officeId,
    matchId,
    accessToken,
    coordinationOutcome: String(session.outcome || ""),
    coordinationBrokerLine: brokerLine,
    coordinationClientSummary: clientSummary,
    coordinationOwnerSummary: ownerSummary,
    ownerContactNeeded: Boolean(ownerContactNeeded)
  });
  return living;
}

function decodeFirestoreDocId(doc = {}) {
  return decodeURIComponent(String(doc.name || "").split("/").pop() || "");
}

async function findAcceptedCooperationByMatchId(helpers, { projectId, matchId, accessToken }) {
  const id = text(matchId);
  if (!id || typeof helpers.listCollectionDocuments !== "function") return null;
  const docs = await helpers.listCollectionDocuments({
    projectId,
    segments: ["cooperationRequests"],
    accessToken,
    pageSize: 200
  });
  for (const doc of docs) {
    const record = js(doc, helpers);
    if (text(record.matchId) !== id) continue;
    const status = String(record.status || "").toUpperCase();
    if (status !== "ACCEPTED") continue;
    return { id: decodeFirestoreDocId(doc), ...record };
  }
  return null;
}

async function patchOfficeCooperationOperations(helpers, {
  projectId,
  officeId,
  cooperationId,
  accessToken,
  patch = {}
}) {
  if (!officeId || !cooperationId || typeof helpers.listCollectionDocuments !== "function") return;
  const docs = await helpers.listCollectionDocuments({
    projectId,
    segments: ["offices", officeId, "operations"],
    accessToken,
    pageSize: 100
  });
  const now = new Date();
  const fields = {
    matchId: helpers.firestoreString(text(patch.matchId)),
    coordinationOutcome: helpers.firestoreString(text(patch.coordinationOutcome)),
    coordinationBrokerLine: helpers.firestoreString(text(patch.coordinationBrokerLine)),
    coordinationClientSummary: helpers.firestoreString(text(patch.coordinationClientSummary)),
    coordinationOwnerSummary: helpers.firestoreString(text(patch.coordinationOwnerSummary)),
    ownerContactNeeded: helpers.firestoreString(patch.ownerContactNeeded ? "true" : ""),
    updatedAt: helpers.firestoreTimestamp(now)
  };
  for (const doc of docs) {
    const op = js(doc, helpers);
    const opId = decodeFirestoreDocId(doc);
    if (!opId) continue;
    if (String(op.cooperationId || "") !== String(cooperationId)) continue;
    if (String(op.type || "").toUpperCase() !== "COOPERATION_MATCH") continue;
    await helpers.setFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "operations", opId],
      accessToken,
      fields
    });
  }
}

export async function stampSharedCooperationCoordinationState(helpers, {
  projectId,
  clientOfficeId,
  matchId,
  accessToken,
  coordinationOutcome = "",
  coordinationBrokerLine = "",
  coordinationClientSummary = "",
  coordinationOwnerSummary = "",
  ownerContactNeeded = false
}) {
  const cooperation = await findAcceptedCooperationByMatchId(helpers, {
    projectId,
    matchId,
    accessToken
  });
  if (!cooperation) return { ok: true, skipped: true, reason: "no_accepted_cooperation" };

  const clientOffice = text(cooperation.clientOfficeId || "");
  const propertyOffice = text(cooperation.propertyOfficeId || "");
  if (!clientOffice || !propertyOffice || clientOffice === propertyOffice) {
    return { ok: true, skipped: true, reason: "not_cross_office" };
  }
  if (text(clientOfficeId) && text(clientOfficeId) !== clientOffice) {
    return { ok: true, skipped: true, reason: "client_office_mismatch" };
  }

  const cooperationId = text(cooperation.id);
  const patch = {
    matchId: text(matchId),
    coordinationOutcome: text(coordinationOutcome),
    coordinationBrokerLine: text(coordinationBrokerLine),
    coordinationClientSummary: text(coordinationClientSummary),
    coordinationOwnerSummary: text(coordinationOwnerSummary),
    ownerContactNeeded: Boolean(ownerContactNeeded)
  };
  const now = new Date();
  await helpers.setFirestoreDocument({
    projectId,
    segments: ["cooperationRequests", cooperationId],
    accessToken,
    fields: {
      matchId: helpers.firestoreString(patch.matchId),
      coordinationOutcome: helpers.firestoreString(patch.coordinationOutcome),
      coordinationBrokerLine: helpers.firestoreString(patch.coordinationBrokerLine),
      coordinationClientSummary: helpers.firestoreString(patch.coordinationClientSummary),
      coordinationOwnerSummary: helpers.firestoreString(patch.coordinationOwnerSummary),
      ownerContactNeeded: helpers.firestoreString(patch.ownerContactNeeded ? "true" : ""),
      updatedAt: helpers.firestoreTimestamp(now)
    }
  });

  const stampedOffices = [...new Set([clientOffice, propertyOffice])];
  for (const officeId of stampedOffices) {
    await patchOfficeCooperationOperations(helpers, {
      projectId,
      officeId,
      cooperationId,
      accessToken,
      patch
    });
  }

  return {
    ok: true,
    cooperationId,
    matchId: patch.matchId,
    ownerContactNeeded: patch.ownerContactNeeded,
    offices: stampedOffices
  };
}

export async function syncCooperationCoordinationFromCanonicalMatch(helpers, {
  projectId,
  matchId,
  accessToken
}) {
  const cooperation = await findAcceptedCooperationByMatchId(helpers, {
    projectId,
    matchId,
    accessToken
  });
  if (!cooperation) return { ok: true, skipped: true, reason: "no_accepted_cooperation" };

  const clientOffice = text(cooperation.clientOfficeId || "");
  if (!clientOffice) return { ok: true, skipped: true, reason: "no_client_office" };

  const match = await readOfficeDoc(helpers, {
    projectId,
    officeId: clientOffice,
    collection: "matches",
    id: text(matchId),
    accessToken
  });
  if (!match) return { ok: true, skipped: true, reason: "no_canonical_match" };

  const coordinationOutcome = text(match.coordinationOutcome);
  const coordinationClientSummary = text(match.coordinationClientSummary);
  const coordinationOwnerSummary = text(match.coordinationOwnerSummary);
  const coordinationBrokerLine = text(match.coordinationBrokerLine);
  const storedOwnerNeeded = match.ownerContactNeeded === true
    || String(match.ownerContactNeeded || "").toLowerCase() === "true";
  const ownerContactNeeded = storedOwnerNeeded || (
    coordinationOutcome
      ? ownerContactNeededForCoordination({
        outcome: coordinationOutcome,
        clientSummary: coordinationClientSummary,
        ownerSummary: coordinationOwnerSummary
      })
      : false
  );

  if (!coordinationOutcome && !ownerContactNeeded) {
    return { ok: true, skipped: true, reason: "no_coordination_state" };
  }

  return stampSharedCooperationCoordinationState(helpers, {
    projectId,
    clientOfficeId: clientOffice,
    matchId: text(matchId),
    accessToken,
    coordinationOutcome,
    coordinationBrokerLine,
    coordinationClientSummary,
    coordinationOwnerSummary,
    ownerContactNeeded
  });
}

export async function syncCooperationCoordinationForOffice(helpers, {
  projectId,
  officeId,
  accessToken
}) {
  if (!officeId || typeof helpers.listCollectionDocuments !== "function") {
    return { ok: true, synced: 0 };
  }
  const docs = await helpers.listCollectionDocuments({
    projectId,
    segments: ["cooperationRequests"],
    accessToken,
    pageSize: 200
  });
  let synced = 0;
  for (const doc of docs) {
    const record = js(doc, helpers);
    const status = String(record.status || "").toUpperCase();
    if (status !== "ACCEPTED") continue;
    const matchId = text(record.matchId);
    if (!matchId) continue;
    const clientOffice = text(record.clientOfficeId);
    const propertyOffice = text(record.propertyOfficeId);
    if (!clientOffice || !propertyOffice || clientOffice === propertyOffice) continue;
    if (text(officeId) !== clientOffice && text(officeId) !== propertyOffice) continue;
    const result = await syncCooperationCoordinationFromCanonicalMatch(helpers, {
      projectId,
      matchId,
      accessToken
    });
    if (result?.ok && !result.skipped) synced += 1;
  }
  return { ok: true, synced };
}

export function coordinationSessionForBrokerView(session = {}) {
  const parsed = parseCoordinationSession(session);
  return {
    outcome: parsed.outcome,
    brokerLine: parsed.brokerLine,
    conflictField: parsed.conflictField,
    clientSubmitted: Boolean(parsed.clientBundle),
    ownerSubmitted: Boolean(parsed.ownerBundle),
    clientSummary: parsed.clientBundle ? clientBundleSummary(parsed.clientBundle) : "",
    ownerSummary: parsed.ownerBundle ? ownerBundleSummary(parsed.ownerBundle) : "",
    eventLog: parsed.eventLog.slice(-8)
  };
}

export function ownerPackageMissingSpecs(clientBundle, canonicalOffer, propertyType) {
  return ownerMissingSpecGroups(clientBundle, canonicalOffer, propertyType);
}
