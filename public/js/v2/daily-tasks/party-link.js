/**
 * Mints or reuses a Worker party session. URL JSON is never authority.
 */

import { buildPartyReviewUrl, isOpaquePartyToken, phoneFromTask } from "./party-link-domain.js";

function officeRuntime() {
  return window.IAQAR?.office || null;
}

function currentOfficeId() {
  return String(officeRuntime()?.officeId || "").trim();
}

function workerBase() {
  if (window.IAQAR && typeof window.IAQAR.resolveWorkerBase === "function") {
    return window.IAQAR.resolveWorkerBase();
  }
  return String(window.IAQAR?.workerBase || officeRuntime()?.workerBase || "").replace(/\/+$/, "");
}

export async function ensurePartyReviewLink(task = {}, party = "client") {
  const side = party === "owner" ? "owner" : "client";
  const officeId = currentOfficeId();
  const matchId = String(task.matchId || task.id || "").trim();
  const user = window.firebase?.auth?.()?.currentUser;
  if (!officeId || !matchId || !user?.getIdToken || !workerBase()) return null;
  try {
    const idToken = await user.getIdToken();
    const response = await fetch(`${workerBase()}/party/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        officeId,
        matchId,
        party: side,
        offerId: task.offerId || "",
        requestId: task.requestId || "",
        currentStage: "match_found"
      })
    });
    const payload = await response.json().catch(() => ({}));
    const token = String(payload.token || "").trim();
    if (!response.ok || !payload.ok || !isOpaquePartyToken(token)) return null;
    const url = buildPartyReviewUrl({
      origin: window.location.origin,
      pathname: "/",
      token
    });
    if (!url) return null;
    return { token, url, persisted: payload.reused ? "session" : "worker" };
  } catch {
    return null;
  }
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
  const contact = await loadOfficeDoc(side === "owner" ? "owners" : "clients", recordId);
  if (contact) {
    const digits = contactDigits(contact);
    if (digits) return { digits, name: String(contact.contactName || contact.name || "").trim() };
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
