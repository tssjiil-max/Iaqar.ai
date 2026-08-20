/**
 * Broker action progress — persisted keys for completed UI actions (pure, no DOM).
 */

export const BROKER_ACTION = Object.freeze({
  contactWhatsApp: "contact:whatsapp",
  contactCall: "contact:call",
  followUpScheduled: "followup:scheduled",
  followUpComplete: "followup:complete",
  workspaceSearchMatches: "workspace:search_matches",
  workspaceSendShare: "workspace:send_and_share",
  workspaceContactParty: "workspace:contact_party",
  workspaceManage: "workspace:manage_opportunity",
  hubShareWhatsAppListing: "hub:share_whatsapp_listing",
  hubShareToOffice: "hub:share_to_office",
  hubCopyListing: "hub:copy_listing_text",
  partyWhatsApp: "party:whatsapp",
  partyCall: "party:call"
});

const ADVERTISER_STATUS_TO_OUTCOME = Object.freeze({
  NO_RESPONSE: "NO_RESPONSE",
  INTERESTED: "INTERESTED",
  RESPONDED: "INTERESTED",
  REFUSED: "REFUSED",
  CALL_LATER: "FOLLOW_UP",
  PRELIMINARY_YES: "AGREED"
});

export function resolveSavedContactOutcome(record = {}) {
  const rawOutcome = String(record.lastContactOutcome || "").toUpperCase();
  return rawOutcome
    || ADVERTISER_STATUS_TO_OUTCOME[String(record.advertiserContactStatus || "").toUpperCase()]
    || "";
}

export function contactOutcomeActionKey(outcome = "") {
  const key = String(outcome || "").toUpperCase();
  return key ? `contact:outcome:${key}` : "";
}

const CONTACT_OUTCOME_KEY_PREFIX = "contact:outcome:";

export function isContactOutcomeActionKey(actionKey = "") {
  return String(actionKey || "").startsWith(CONTACT_OUTCOME_KEY_PREFIX);
}

function withoutContactOutcomeKeys(progress = {}) {
  const out = {};
  for (const [key, stamp] of Object.entries(normalizeBrokerActionProgress(progress))) {
    if (!isContactOutcomeActionKey(key)) out[key] = stamp;
  }
  return out;
}

export function followUpOutcomeActionKey(outcome = "") {
  const key = String(outcome || "").trim().toLowerCase();
  return key ? `followup:outcome:${key}` : "";
}

export function followUpWhatsAppActionKey(role = "") {
  const key = String(role || "").trim().toLowerCase();
  return key ? `followup:whatsapp:${key}` : "";
}

export function partyActionKey(actionId = "") {
  const id = String(actionId || "").trim();
  if (!id) return "";
  if (id === "party_whatsapp") return BROKER_ACTION.partyWhatsApp;
  if (id === "party_call") return BROKER_ACTION.partyCall;
  return `party:${id}`;
}

export function hubShareOptionActionKey(optionId = "") {
  const id = String(optionId || "").trim();
  if (id === "share_whatsapp_listing") return BROKER_ACTION.hubShareWhatsAppListing;
  if (id === "share_to_office") return BROKER_ACTION.hubShareToOffice;
  if (id === "copy_listing_text") return BROKER_ACTION.hubCopyListing;
  return id ? `hub:${id}` : "";
}

export function workspacePrimaryActionKey(actionId = "") {
  const id = String(actionId || "").trim();
  if (id === "search_matches") return BROKER_ACTION.workspaceSearchMatches;
  if (id === "send_and_share") return BROKER_ACTION.workspaceSendShare;
  if (id === "contact_party") return BROKER_ACTION.workspaceContactParty;
  if (id === "manage_opportunity") return BROKER_ACTION.workspaceManage;
  return id ? `workspace:${id}` : "";
}

export function mergeBrokerActionProgress(record = {}, actionKey = "", atIso = "") {
  const key = String(actionKey || "").trim();
  if (!key) return normalizeBrokerActionProgress(record.brokerActionProgress);
  const stamp = String(atIso || new Date().toISOString());
  let base = normalizeBrokerActionProgress(record.brokerActionProgress);
  if (isContactOutcomeActionKey(key)) {
    base = withoutContactOutcomeKeys(base);
  }
  return {
    ...base,
    [key]: stamp
  };
}

export function normalizeBrokerActionProgress(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [key, stamp] of Object.entries(value)) {
    if (typeof key === "string" && key && stamp) out[key] = String(stamp);
  }
  return out;
}

export function resolveCompletedBrokerActionKeys(record = {}) {
  const keys = new Set(Object.keys(withoutContactOutcomeKeys(record.brokerActionProgress)));

  if (record.lastWhatsAppOpenedAt) keys.add(BROKER_ACTION.contactWhatsApp);
  if (record.lastCallOpenedAt) keys.add(BROKER_ACTION.contactCall);

  const rawOutcome = String(record.lastContactOutcome || "").toUpperCase();
  const mappedOutcome = rawOutcome
    || ADVERTISER_STATUS_TO_OUTCOME[String(record.advertiserContactStatus || "").toUpperCase()]
    || "";
  if (mappedOutcome) keys.add(contactOutcomeActionKey(mappedOutcome));

  const follow = record.followUp && typeof record.followUp === "object" ? record.followUp : null;
  if (follow?.at) keys.add(BROKER_ACTION.followUpScheduled);
  if (String(follow?.status || "").toLowerCase() === "completed") keys.add(BROKER_ACTION.followUpComplete);
  if (follow?.confirmationOutcome) {
    keys.add(followUpOutcomeActionKey(follow.confirmationOutcome));
  }
  const whatsappRoles = Array.isArray(follow?.whatsappRolesOpened) ? follow.whatsappRolesOpened : [];
  for (const role of whatsappRoles) {
    const actionKey = followUpWhatsAppActionKey(role);
    if (actionKey) keys.add(actionKey);
  }

  return keys;
}

export function isBrokerActionDone(record = {}, actionKey = "") {
  const key = String(actionKey || "").trim();
  if (!key) return false;
  return resolveCompletedBrokerActionKeys(record).has(key);
}

export function brokerActionDoneClass(record = {}, actionKey = "") {
  return isBrokerActionDone(record, actionKey) ? " is-action-done" : "";
}

export function brokerActionAriaPressed(record = {}, actionKey = "") {
  return isBrokerActionDone(record, actionKey) ? "true" : "false";
}

/** How long the listing-card “acted on this one” mark stays visible. */
export const RECENT_BROKER_ACTION_WINDOW_MS = 12 * 60 * 60 * 1000;
export const RECENT_BROKER_ACTION_LABEL = "تم الإجراء";

export function parseActionStampMs(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  if (typeof value === "object") {
    if (typeof value.toDate === "function") {
      try {
        const time = value.toDate().getTime();
        return Number.isNaN(time) ? 0 : time;
      } catch (_) {
        return 0;
      }
    }
    if (typeof value.seconds === "number") {
      return (value.seconds * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1e6);
    }
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function collectBrokerActionTimestamps(record = {}) {
  const stamps = [];
  const progress = normalizeBrokerActionProgress(record.brokerActionProgress);
  for (const stamp of Object.values(progress)) {
    const ms = parseActionStampMs(stamp);
    if (ms) stamps.push(ms);
  }
  for (const field of ["lastWhatsAppOpenedAt", "lastCallOpenedAt", "lastContactAt", "lastBrokerActionAt"]) {
    const ms = parseActionStampMs(record[field]);
    if (ms) stamps.push(ms);
  }
  return stamps;
}

export function latestBrokerActionAtMs(record = {}) {
  const stamps = collectBrokerActionTimestamps(record);
  return stamps.length ? Math.max(...stamps) : 0;
}

export function hasRecentBrokerAction(
  record = {},
  nowMs = Date.now(),
  windowMs = RECENT_BROKER_ACTION_WINDOW_MS
) {
  const latest = latestBrokerActionAtMs(record);
  if (!latest) return false;
  const age = Number(nowMs) - latest;
  return age >= 0 && age < Number(windowMs);
}

export function recentBrokerActionMarkHtml(record = {}, options = {}) {
  if (!hasRecentBrokerAction(record, options.nowMs, options.windowMs)) return "";
  return `<span class="listing-recent-action-mark" data-recent-action="1" title="اتخذت إجراءً على هذا العرض خلال ١٢ ساعة">
    <span class="listing-recent-action-mark-icon" aria-hidden="true">✓</span>
    ${RECENT_BROKER_ACTION_LABEL}
  </span>`;
}
