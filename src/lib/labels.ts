import type {
  ListingIntent,
  MediaKind,
  MessageChannel,
  MessageStatus,
  PartyRole,
} from "./types";

export const roleLabels: Record<PartyRole, string> = {
  owner: "المالك",
  customer: "العميل",
  agent: "الوسيط",
};

export const channelLabels: Record<MessageChannel, string> = {
  whatsapp: "واتساب",
  website: "الموقع",
  instagram: "إنستغرام",
  sms: "رسالة نصية",
};

export const mediaLabels: Record<MediaKind, string> = {
  text: "نص",
  image: "صورة",
  audio: "صوت",
  document: "مستند",
  location: "موقع",
};

export const statusLabels: Record<MessageStatus, string> = {
  new: "جديدة",
  listed: "مدرجة",
  routed: "مُحوَّلة",
  duplicate_closed: "مكررة — أُغلقت",
  printed: "مطبوعة",
  archived: "مؤرشفة",
};

export const intentLabels: Record<ListingIntent, string> = {
  sale: "بيع",
  rent: "إيجار",
  buy: "شراء",
  inquiry: "استفسار",
  other: "أخرى",
};
