import type {
  IncomingMessage,
  MediaKind,
  MessageChannel,
  PartyRole,
  ProcessResult,
} from "./types";
import { channelLabels, roleLabels } from "./labels";

const DUPLICATE_REPLY =
  "شكراً لتواصلك. يوجد لدينا عرض مشابه في نفس الحي، وسنوافيك بالتفاصيل قريباً.";

function normalizeNeighborhood(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function listingFingerprint(message: IncomingMessage): string | null {
  if (!message.listing?.neighborhood) return null;
  const neighborhood = normalizeNeighborhood(message.listing.neighborhood);
  const intent = message.listing.intent;
  const propertyType = (message.listing.propertyType ?? "").trim().toLowerCase();
  return `${neighborhood}|${intent}|${propertyType}`;
}

/** Find an existing listing in the same neighborhood with the same intent/type. */
export function findNeighborhoodDuplicate(
  message: IncomingMessage,
  catalog: IncomingMessage[],
): IncomingMessage | undefined {
  const fingerprint = listingFingerprint(message);
  if (!fingerprint) return undefined;

  return catalog.find((existing) => {
    if (existing.id === message.id) return false;
    if (existing.status === "duplicate_closed") return false;
    const existingFingerprint = listingFingerprint(existing);
    return existingFingerprint === fingerprint;
  });
}

/** Route by sender role examples: owner → agent desk, customer → matching agent, agent → owner/ops. */
export function suggestRoute(message: IncomingMessage): PartyRole {
  switch (message.from.role) {
    case "owner":
      return "agent";
    case "customer":
      return "agent";
    case "agent":
      return "owner";
    default:
      return "agent";
  }
}

/**
 * Media cooperation: choose the best follow-up channel from what the media contains.
 * Image/location → website listing desk; audio → WhatsApp callback; document → agent SMS.
 */
export function cooperateMedia(
  mediaKind: MediaKind,
  current: MessageChannel,
): MessageChannel {
  switch (mediaKind) {
    case "image":
    case "location":
      return current === "website" ? "whatsapp" : "website";
    case "audio":
      return "whatsapp";
    case "document":
      return "sms";
    case "text":
    default:
      return current;
  }
}

export function processIncomingMessage(
  message: IncomingMessage,
  catalog: IncomingMessage[],
): ProcessResult {
  const duplicate = findNeighborhoodDuplicate(message, catalog);

  if (duplicate) {
    const closed: IncomingMessage = {
      ...message,
      status: "duplicate_closed",
      duplicateOfId: duplicate.id,
      autoReply: DUPLICATE_REPLY,
      copyCount: message.copyCount + 1,
    };

    return {
      message: closed,
      action: "duplicate_closed",
      summary: `نسخة في نفس الحي (${message.listing?.neighborhood}). أُرسل رد بسيط وانتهت الرسالة.`,
    };
  }

  const routedTo = suggestRoute(message);
  const handoffChannel = cooperateMedia(message.mediaKind, message.channel);

  const routed: IncomingMessage = {
    ...message,
    status: "routed",
    routedTo,
    copyCount: Math.max(1, message.copyCount),
  };

  if (handoffChannel !== message.channel) {
    return {
      message: routed,
      action: "media_handoff",
      handoffChannel,
      summary: `حُوِّلت إلى ${roleLabels[routedTo]} مع تعاون وسائط: من ${channelLabels[message.channel]} إلى ${channelLabels[handoffChannel]} بحسب نوع الوسائط.`,
    };
  }

  return {
    message: routed,
    action: "routed",
    summary: `أُدرجت وحُوِّلت إلى ${roleLabels[routedTo]}.`,
  };
}

export function makePrintableText(message: IncomingMessage): string {
  const lines = [
    "— Iaqar.ai — نسخة مطبوعة —",
    `المعرّف: ${message.id}`,
    `القناة: ${channelLabels[message.channel]}`,
    `من: ${message.from.name} (${roleLabels[message.from.role]})`,
    `الجوال: ${message.from.phone}`,
    `الوقت: ${new Date(message.receivedAt).toLocaleString("ar-SA")}`,
    message.listing
      ? `الحي: ${message.listing.neighborhood} — ${message.listing.city}`
      : "الحي: غير محدد",
    "",
    message.body,
    "",
    message.autoReply ? `الرد التلقائي: ${message.autoReply}` : "",
  ];

  return lines.filter(Boolean).join("\n");
}
