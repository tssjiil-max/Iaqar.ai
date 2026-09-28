/**
 * Broker negotiation activity on one Match — pure, shared by Worker and UI.
 *
 * One append-only log per matchId records what the broker did in the Match
 * workspace: WhatsApp sends to each party, the option recorded for each party,
 * messages sent to a party's review link, and internal notes that are never sent.
 * Sending never locks: every entry is another row, and counts only change labels.
 */

import { postViewingNegotiationTopics } from "./negotiation-management-domain.js";

export const NEGOTIATION_ACTIVITY_KIND = Object.freeze({
  PARTY_SEND: "party_send",
  PARTY_CHOICE: "party_choice",
  BROKER_MESSAGE: "broker_message",
  INTERNAL_NOTE: "internal_note"
});

export const NEGOTIATION_ACTIVITY_STATUS = Object.freeze({
  WHATSAPP_OPENED: "whatsapp_opened",
  RECORDED: "recorded",
  DELIVERED_TO_LINK: "delivered_to_link",
  INTERNAL: "internal"
});

export const NEGOTIATION_ACTIVITY_LIMIT = 60;
export const NEGOTIATION_MESSAGE_MAX = 1000;

const PARTY_LABELS = Object.freeze({ client: "العميل", owner: "المالك", both: "الطرفان", internal: "داخلي" });
const STATUS_LABELS = Object.freeze({
  whatsapp_opened: "تم فتح واتساب",
  recorded: "تم التسجيل",
  delivered_to_link: "ظاهرة في رابط الطرف",
  internal: "داخلية — لا تُرسل لأي طرف"
});

const INTEREST_CHOICES = Object.freeze([
  Object.freeze({ id: "interested", label: "مهتم" }),
  Object.freeze({ id: "not_interested", label: "غير مهتم" })
]);

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function multiline(value, max = NEGOTIATION_MESSAGE_MAX) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max);
}

export function negotiationPartyLabel(party = "") {
  return PARTY_LABELS[text(party).toLowerCase()] || "";
}

export function negotiationStatusLabel(status = "") {
  return STATUS_LABELS[text(status).toLowerCase()] || "";
}

/** Options the broker can record for a party: interest + property-type topics. */
export function partyNegotiationChoices({ propertyType = "", purpose = "" } = {}) {
  const topics = postViewingNegotiationTopics({ propertyType, purpose })
    .map((topic) => ({ id: text(topic.id), label: text(topic.label) }))
    .filter((topic) => topic.id && topic.label);
  const seen = new Set();
  return [...INTEREST_CHOICES, ...topics].filter((choice) => {
    if (seen.has(choice.id)) return false;
    seen.add(choice.id);
    return true;
  }).map((choice) => ({ ...choice }));
}

export function parseNegotiationActivity(raw) {
  let list = raw;
  if (typeof raw === "string") {
    try { list = JSON.parse(raw || "[]"); } catch { list = []; }
  }
  if (!Array.isArray(list)) return [];
  return list.map(normalizeNegotiationActivityEntry).filter(Boolean);
}

export function normalizeNegotiationActivityEntry(entry = {}) {
  const kind = text(entry?.kind).toLowerCase();
  if (!Object.values(NEGOTIATION_ACTIVITY_KIND).includes(kind)) return null;
  const createdAt = text(entry.createdAt);
  return {
    id: text(entry.id) || `na_${createdAt || "0"}`,
    kind,
    party: text(entry.party).toLowerCase(),
    choiceId: text(entry.choiceId),
    label: text(entry.label),
    message: multiline(entry.message),
    status: text(entry.status).toLowerCase(),
    createdAt
  };
}

/**
 * Validates one broker input and returns the entry to append, or an error code.
 * Labels come from the server-side catalog, never from the request.
 */
export function buildNegotiationActivityEntry(input = {}, { propertyType = "", purpose = "", now = new Date(), id = "" } = {}) {
  const kind = text(input.kind).toLowerCase();
  const party = text(input.party || input.audience).toLowerCase();
  const createdAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const entryId = text(id) || `na_${Date.parse(createdAt) || 0}_${Math.random().toString(36).slice(2, 8)}`;
  if (kind === NEGOTIATION_ACTIVITY_KIND.PARTY_SEND) {
    if (!["client", "owner"].includes(party)) return { ok: false, error: "party_invalid" };
    return { ok: true, entry: {
      id: entryId, kind, party, choiceId: "",
      label: party === "owner" ? "إرسال واتساب للمالك" : "إرسال واتساب للعميل",
      message: "", status: NEGOTIATION_ACTIVITY_STATUS.WHATSAPP_OPENED, createdAt
    } };
  }
  if (kind === NEGOTIATION_ACTIVITY_KIND.PARTY_CHOICE) {
    if (!["client", "owner"].includes(party)) return { ok: false, error: "party_invalid" };
    const choice = partyNegotiationChoices({ propertyType, purpose }).find((item) => item.id === text(input.choiceId));
    if (!choice) return { ok: false, error: "choice_invalid" };
    return { ok: true, entry: {
      id: entryId, kind, party, choiceId: choice.id, label: choice.label,
      message: "", status: NEGOTIATION_ACTIVITY_STATUS.RECORDED, createdAt
    } };
  }
  if (kind === NEGOTIATION_ACTIVITY_KIND.BROKER_MESSAGE) {
    if (!["client", "owner", "both"].includes(party)) return { ok: false, error: "audience_invalid" };
    const message = multiline(input.message);
    if (!message) return { ok: false, error: "message_required" };
    return { ok: true, entry: {
      id: entryId, kind, party, choiceId: "", label: "رسالة الوسيط",
      message, status: NEGOTIATION_ACTIVITY_STATUS.DELIVERED_TO_LINK, createdAt
    } };
  }
  if (kind === NEGOTIATION_ACTIVITY_KIND.INTERNAL_NOTE) {
    const message = multiline(input.message);
    if (!message) return { ok: false, error: "message_required" };
    return { ok: true, entry: {
      id: entryId, kind, party: "internal", choiceId: "", label: "ملاحظة داخلية",
      message, status: NEGOTIATION_ACTIVITY_STATUS.INTERNAL, createdAt
    } };
  }
  return { ok: false, error: "kind_invalid" };
}

export function appendNegotiationActivity(existing = [], entry = null, { limit = NEGOTIATION_ACTIVITY_LIMIT } = {}) {
  const list = parseNegotiationActivity(existing);
  const normalized = normalizeNegotiationActivityEntry(entry || {});
  if (!normalized) return list;
  return [...list.filter((item) => item.id !== normalized.id), normalized].slice(-Math.max(1, limit));
}

export function summarizeNegotiationActivity(raw = []) {
  const entries = parseNegotiationActivity(raw);
  const summary = {
    clientSendCount: 0,
    ownerSendCount: 0,
    clientChoice: null,
    ownerChoice: null,
    messageCount: 0,
    internalNoteCount: 0,
    lastActivityAt: "",
    started: entries.length > 0
  };
  for (const entry of entries) {
    if (entry.kind === NEGOTIATION_ACTIVITY_KIND.PARTY_SEND) {
      if (entry.party === "owner") summary.ownerSendCount += 1;
      else summary.clientSendCount += 1;
    } else if (entry.kind === NEGOTIATION_ACTIVITY_KIND.PARTY_CHOICE) {
      const choice = { id: entry.choiceId, label: entry.label, createdAt: entry.createdAt };
      if (entry.party === "owner") summary.ownerChoice = choice;
      else summary.clientChoice = choice;
    } else if (entry.kind === NEGOTIATION_ACTIVITY_KIND.BROKER_MESSAGE) {
      summary.messageCount += 1;
    } else if (entry.kind === NEGOTIATION_ACTIVITY_KIND.INTERNAL_NOTE) {
      summary.internalNoteCount += 1;
    }
    if (entry.createdAt > summary.lastActivityAt) summary.lastActivityAt = entry.createdAt;
  }
  return summary;
}

/** One human-readable log row: what, to whom, and its delivery status. */
export function negotiationActivityLogRow(entry = {}) {
  const normalized = normalizeNegotiationActivityEntry(entry);
  if (!normalized) return null;
  const recipient = negotiationPartyLabel(normalized.party);
  let title = normalized.label;
  if (normalized.kind === NEGOTIATION_ACTIVITY_KIND.PARTY_CHOICE) title = `خيار ${recipient}: ${normalized.label}`;
  if (normalized.kind === NEGOTIATION_ACTIVITY_KIND.BROKER_MESSAGE) title = `رسالة الوسيط إلى ${recipient}`;
  return {
    id: normalized.id,
    kind: normalized.kind,
    title,
    message: normalized.message,
    recipient,
    status: normalized.status,
    statusLabel: normalizedStatusLabel(normalized),
    createdAt: normalized.createdAt
  };
}

function normalizedStatusLabel(entry) {
  if (entry.kind === NEGOTIATION_ACTIVITY_KIND.BROKER_MESSAGE) {
    return entry.party === "both" ? "ظاهرة في رابط الطرفين" : `ظاهرة في رابط ${negotiationPartyLabel(entry.party)}`;
  }
  return negotiationStatusLabel(entry.status);
}
