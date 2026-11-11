import { NextResponse } from "next/server";
import { directory } from "@/lib/seed";
import { ingestMessage, listMessages, resetStore } from "@/lib/store";
import type {
  Contact,
  ListingSignal,
  MediaKind,
  MessageChannel,
  PartyRole,
} from "@/lib/types";

export async function GET() {
  return NextResponse.json({ messages: listMessages() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    reset?: boolean;
    channel?: MessageChannel;
    mediaKind?: MediaKind;
    fromRole?: PartyRole;
    fromName?: string;
    fromPhone?: string;
    text?: string;
    listing?: ListingSignal;
  };

  if (body.reset) {
    return NextResponse.json({ messages: resetStore() });
  }

  const role = body.fromRole ?? "customer";
  const known =
    directory.find((contact) => contact.role === role) ?? directory[2];

  const from: Contact = {
    id: `c-live-${Date.now()}`,
    name: body.fromName?.trim() || known.name,
    phone: body.fromPhone?.trim() || known.phone,
    role,
  };

  const result = ingestMessage({
    channel: body.channel ?? "whatsapp",
    mediaKind: body.mediaKind ?? "text",
    from,
    body: body.text?.trim() || "رسالة واردة بدون نص",
    receivedAt: new Date().toISOString(),
    listing: body.listing,
  });

  return NextResponse.json(result, { status: 201 });
}
