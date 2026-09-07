/**
 * Phase 8 — canonical Bot & Channels boundary.
 * Channels are transport adapters only. They may ingest, alert, draft, or hand off.
 * They never own transaction state (matching/negotiation/viewing/deal/cooperation).
 */

export const CHANNEL = Object.freeze({
  WHATSAPP: "whatsapp",
  TELEGRAM: "telegram",
  WEB: "web"
});

export const CHANNEL_CAPABILITY = Object.freeze({
  INTAKE: "INTAKE",
  ALERT: "ALERT",
  DRAFT: "DRAFT",
  HANDOFF: "HANDOFF",
  PROVIDER_SEND: "PROVIDER_SEND",
  PROVIDER_DELIVERY: "PROVIDER_DELIVERY",
  BUSINESS_STATE_MUTATION: "BUSINESS_STATE_MUTATION"
});

export const CHANNEL_BUSINESS_OWNER = Object.freeze({
  MATCHING: "matching",
  NEGOTIATION: "coordinationSessions",
  VIEWING: "matches",
  DEAL: "deals",
  COOPERATION: "cooperationRequests"
});

const TRANSPORT_CAPABILITIES = new Set([
  CHANNEL_CAPABILITY.INTAKE,
  CHANNEL_CAPABILITY.ALERT,
  CHANNEL_CAPABILITY.DRAFT,
  CHANNEL_CAPABILITY.HANDOFF
]);

function text(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

export function normalizeTransportChannel(value = "") {
  const channel = lower(value);
  return Object.values(CHANNEL).includes(channel) ? channel : "";
}

export function channelCapabilityAllowed({
  channel = "",
  capability = "",
  providerConfirmed = false
} = {}) {
  const normalized = normalizeTransportChannel(channel);
  const requested = text(capability).toUpperCase();
  if (!normalized) return { ok: false, reason: "channel_invalid" };
  if (TRANSPORT_CAPABILITIES.has(requested)) return { ok: true, channel: normalized, capability: requested };
  if (requested === CHANNEL_CAPABILITY.PROVIDER_SEND || requested === CHANNEL_CAPABILITY.PROVIDER_DELIVERY) {
    return providerConfirmed === true
      ? { ok: true, channel: normalized, capability: requested }
      : { ok: false, reason: "provider_confirmation_required", channel: normalized, capability: requested };
  }
  if (requested === CHANNEL_CAPABILITY.BUSINESS_STATE_MUTATION) {
    return { ok: false, reason: "channel_cannot_mutate_business_state", channel: normalized, capability: requested };
  }
  return { ok: false, reason: "capability_invalid", channel: normalized, capability: requested };
}

export function channelBusinessMutationGuard({
  channel = "",
  targetOwner = "",
  action = ""
} = {}) {
  const normalized = normalizeTransportChannel(channel);
  if (!normalized) return { ok: false, reason: "channel_invalid" };
  const owner = text(targetOwner);
  return {
    ok: false,
    reason: "channel_cannot_mutate_business_state",
    channel: normalized,
    action: text(action),
    canonicalOwner: owner
  };
}

export function providerEvidenceGuard({
  sendState = "",
  deliveryState = "",
  providerConfirmedSend = false,
  providerConfirmedDelivery = false
} = {}) {
  const send = text(sendState).toUpperCase();
  const delivery = text(deliveryState).toUpperCase();
  if (send === "SENT" && providerConfirmedSend !== true) {
    return { ok: false, reason: "provider_send_confirmation_required" };
  }
  if (["DELIVERED", "READ"].includes(delivery) && providerConfirmedDelivery !== true) {
    return { ok: false, reason: "provider_delivery_confirmation_required" };
  }
  if (providerConfirmedDelivery === true && providerConfirmedSend !== true) {
    return { ok: false, reason: "delivery_requires_confirmed_send" };
  }
  return { ok: true };
}

export function channelCleanupBoundaryGuarantees() {
  return {
    whatsappIsTransportOnly: true,
    telegramIsTransportOnly: true,
    inboundUsesCanonicalIntake: true,
    channelsOwnMatching: false,
    channelsOwnNegotiation: false,
    channelsOwnViewing: false,
    channelsOwnDeals: false,
    channelsOwnCooperation: false,
    automaticNegotiationFromMessage: false,
    automaticDealMutationFromMessage: false,
    automaticCooperationMutationFromMessage: false,
    externalHandoffImpliesSent: false,
    providerEvidenceRequiredForSent: true,
    providerEvidenceRequiredForDelivered: true,
    counterpartyContactExposedByChannelAdapter: false
  };
}
