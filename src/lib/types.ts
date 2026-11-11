export type PartyRole = "owner" | "customer" | "agent";

export type MessageChannel = "whatsapp" | "website" | "instagram" | "sms";

export type MediaKind = "text" | "image" | "audio" | "document" | "location";

export type MessageStatus =
  | "new"
  | "listed"
  | "routed"
  | "duplicate_closed"
  | "printed"
  | "archived";

export type ListingIntent = "sale" | "rent" | "buy" | "inquiry" | "other";

export interface Contact {
  id: string;
  name: string;
  phone: string;
  role: PartyRole;
}

export interface ListingSignal {
  neighborhood: string;
  city: string;
  intent: ListingIntent;
  propertyType?: string;
  priceHint?: string;
  roomsHint?: string;
}

export interface IncomingMessage {
  id: string;
  channel: MessageChannel;
  mediaKind: MediaKind;
  from: Contact;
  body: string;
  receivedAt: string;
  listing?: ListingSignal;
  mediaUrl?: string;
  status: MessageStatus;
  routedTo?: PartyRole;
  routedContactId?: string;
  duplicateOfId?: string;
  autoReply?: string;
  copyCount: number;
  printedAt?: string;
  notes?: string;
}

export interface ProcessResult {
  message: IncomingMessage;
  action:
    | "listed"
    | "routed"
    | "duplicate_closed"
    | "media_handoff";
  summary: string;
  handoffChannel?: MessageChannel;
}
