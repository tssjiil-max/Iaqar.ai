/**
 * Telegram bot intake contract.
 * Inbound only: normalize Telegram updates into the same canonical intake
 * envelope used by the rest of the platform. No negotiation takes place here.
 */

export const TELEGRAM_INTAKE_KIND = Object.freeze({
  TEXT: "text",
  PHOTO: "photo",
  VOICE: "voice",
  DOCUMENT: "document",
  UNSUPPORTED: "unsupported"
});

function text(value) {
  return String(value ?? "").trim();
}

export function telegramUpdateKind(update = {}) {
  const message = update.message || update.channel_post || update.edited_message || {};
  if (text(message.text) || text(message.caption)) return TELEGRAM_INTAKE_KIND.TEXT;
  if (Array.isArray(message.photo) && message.photo.length) return TELEGRAM_INTAKE_KIND.PHOTO;
  if (message.voice?.file_id || message.audio?.file_id) return TELEGRAM_INTAKE_KIND.VOICE;
  if (message.document?.file_id) return TELEGRAM_INTAKE_KIND.DOCUMENT;
  return TELEGRAM_INTAKE_KIND.UNSUPPORTED;
}

export function normalizeTelegramInbound(update = {}, { officeId = "" } = {}) {
  const message = update.message || update.channel_post || update.edited_message || {};
  const chat = message.chat || {};
  const from = message.from || {};
  const kind = telegramUpdateKind(update);
  const largestPhoto = Array.isArray(message.photo) && message.photo.length
    ? message.photo[message.photo.length - 1]
    : null;
  const mediaFileId = largestPhoto?.file_id
    || message.voice?.file_id
    || message.audio?.file_id
    || message.document?.file_id
    || "";
  return {
    source: "telegram",
    officeId: text(officeId),
    externalUpdateId: text(update.update_id),
    externalMessageId: text(message.message_id),
    chatId: text(chat.id),
    senderId: text(from.id),
    senderName: text([from.first_name, from.last_name].filter(Boolean).join(" ")),
    username: text(from.username),
    kind,
    text: text(message.text || message.caption),
    mediaFileId: text(mediaFileId),
    receivedAt: new Date(Number(message.date || 0) * 1000 || Date.now()).toISOString(),
    createCanonicalOpportunityDirectly: false,
    negotiationAllowed: false,
    autoSendAllowed: false
  };
}

export function telegramIntakeBoundaryGuarantees() {
  return {
    inboundOnly: true,
    canonicalIntakeRequired: true,
    createsMatchDirectly: false,
    negotiatesInTelegram: false,
    sendsOutboundAutomatically: false,
    exposesCounterpartyContact: false
  };
}
