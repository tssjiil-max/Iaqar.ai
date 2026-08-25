/**
 * Creates or reuses a client/owner review link for one match.
 * Tokens are distinct per (officeId, matchId, party). No dummy URLs.
 */

import {
  buildPartyReviewUrl,
  encodePartyLinkToken,
  existingPartyToken,
  PARTY_LINK_STORAGE_KEY,
  parsePartyLinkToken,
  partyLinkStorageKey,
  phoneFromTask,
  readPartyLinkStore,
  rememberPartyLink
} from "./party-link-domain.js";

function officeRuntime() {
  return window.IAQAR?.office || null;
}

function currentOfficeId() {
  return String(officeRuntime()?.officeId || "").trim();
}

function readLocalStore() {
  try {
    return readPartyLinkStore(window.localStorage?.getItem(PARTY_LINK_STORAGE_KEY));
  } catch {
    return readPartyLinkStore(null);
  }
}

function writeLocalStore(store) {
  try {
    window.localStorage?.setItem(PARTY_LINK_STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* private mode */
  }
}

function payloadFromTask(task, party) {
  return {
    officeId: currentOfficeId(),
    matchId: String(task.matchId || task.id || "").trim(),
    party: party === "owner" ? "owner" : "client",
    offerId: String(task.offerId || "").trim(),
    requestId: String(task.requestId || "").trim(),
    opportunityId: String(task.opportunityId || "").trim(),
    propertyLine: String(task.propertyLine || "").trim(),
    moneyLine: String(task.moneyLine || "").trim()
  };
}

function linkFromToken(token) {
  const record = parsePartyLinkToken(token);
  if (!record) return null;
  const url = buildPartyReviewUrl({
    origin: window.location.origin,
    pathname: window.location.pathname || "/",
    token
  });
  if (!url) return null;
  return { token, url, record, persisted: "local" };
}

async function readFirestoreToken(task, party) {
  const office = officeRuntime();
  const matchId = String(task.matchId || "").trim();
  const officeId = currentOfficeId();
  if (!office?.refs?.office || !matchId || !officeId) return "";
  try {
    const snap = await office.refs.office.collection("partyLinks").doc(`${matchId}__${party}`).get();
    if (!snap.exists) return "";
    const data = snap.data() || {};
    const token = String(data.token || "").trim();
    return parsePartyLinkToken(token) ? token : "";
  } catch {
    return "";
  }
}

async function writeFirestoreToken(task, party, token, record) {
  const office = officeRuntime();
  const matchId = String(task.matchId || "").trim();
  const officeId = currentOfficeId();
  if (!office?.refs?.office || !matchId || !officeId) return false;
  try {
    await office.refs.office.collection("partyLinks").doc(`${matchId}__${party}`).set({
      officeId,
      matchId,
      party,
      sessionKind: record.sessionKind,
      token,
      offerId: record.offerId || "",
      requestId: record.requestId || "",
      opportunityId: record.opportunityId || "",
      propertyLine: record.propertyLine || "",
      moneyLine: record.moneyLine || "",
      createdAt: Date.now()
    }, { merge: true });
    return true;
  } catch {
    return false;
  }
}

export async function ensurePartyReviewLink(task = {}, party = "client") {
  const side = party === "owner" ? "owner" : "client";
  const payload = payloadFromTask(task, side);
  if (!payload.matchId) return null;
  const key = partyLinkStorageKey({
    officeId: payload.officeId,
    matchId: payload.matchId,
    party: side
  });
  const local = readLocalStore();
  const localToken = existingPartyToken(local, key);
  if (localToken) return linkFromToken(localToken);

  const remoteToken = await readFirestoreToken(task, side);
  if (remoteToken) {
    writeLocalStore(rememberPartyLink(local, {
      key,
      token: remoteToken,
      record: parsePartyLinkToken(remoteToken)
    }));
    const link = linkFromToken(remoteToken);
    if (link) link.persisted = "match";
    return link;
  }

  const token = encodePartyLinkToken(payload);
  const record = parsePartyLinkToken(token);
  if (!token || !record) return null;
  writeLocalStore(rememberPartyLink(local, { key, token, record }));
  const persisted = await writeFirestoreToken(task, side, token, record);
  const link = linkFromToken(token);
  if (link) link.persisted = persisted ? "match" : "local";
  return link;
}

export function resolveStoredPartyLink(token) {
  const parsed = parsePartyLinkToken(token);
  if (parsed) return parsed;
  const stored = readLocalStore().byToken?.[String(token || "").trim()];
  return stored && stored.matchId ? stored : null;
}

function contactDigits(record = {}) {
  return phoneFromTask({
    ownerPhone: record.contactPhone || record.phone || record.advertiserPhoneNormalized || record.advertiserPhone,
    clientPhone: record.contactPhone || record.phone || record.advertiserPhoneNormalized || record.clientPhone || record.buyerPhone
  }, "client");
}

async function loadOfficeDoc(collectionName, id) {
  const office = officeRuntime();
  if (!office?.refs || !id) return null;
  const collection = office.refs[collectionName];
  if (!collection) return null;
  try {
    const snap = await collection.doc(id).get();
    if (!snap.exists) return null;
    return { id, ...(snap.data() || {}) };
  } catch {
    return null;
  }
}

async function enrichMatchIds(task) {
  const next = {
    offerId: String(task.offerId || task.ownerOfferId || "").trim(),
    requestId: String(task.requestId || task.clientRequestId || "").trim()
  };
  if (next.offerId && next.requestId) return next;
  const matchId = String(task.matchId || "").trim();
  if (!matchId) return next;
  const match = await loadOfficeDoc("matches", matchId);
  if (!match) return next;
  return {
    offerId: next.offerId || String(match.ownerOfferId || match.offerId || "").trim(),
    requestId: next.requestId || String(match.clientRequestId || match.requestId || "").trim()
  };
}

export async function resolvePartyPhone(task = {}, party = "client") {
  const side = party === "owner" ? "owner" : "client";
  const fromTask = phoneFromTask(task, side);
  if (fromTask) {
    return {
      digits: fromTask,
      name: String(side === "owner" ? task.ownerName || "" : task.clientName || "").trim()
    };
  }

  const ids = await enrichMatchIds(task);
  const recordId = side === "owner" ? ids.offerId : ids.requestId;
  const contactCol = side === "owner" ? "owners" : "clients";
  const contact = await loadOfficeDoc(contactCol, recordId);
  if (contact) {
    const digits = contactDigits(contact);
    if (digits) {
      return { digits, name: String(contact.contactName || contact.name || "").trim() };
    }
  }

  const opportunity = await loadOfficeDoc("opportunities", recordId || String(task.opportunityId || "").trim());
  if (opportunity) {
    const digits = contactDigits(opportunity);
    if (digits) {
      return {
        digits,
        name: String(opportunity.advertiserDisplayName || opportunity.contactName || "").trim()
      };
    }
  }

  return null;
}
