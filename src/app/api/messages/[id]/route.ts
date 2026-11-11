import { NextResponse } from "next/server";
import { makePrintableText } from "@/lib/process-message";
import { bumpCopy, getMessage, markPrinted } from "@/lib/store";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const message = getMessage(id);
  if (!message) {
    return NextResponse.json({ error: "الرسالة غير موجودة" }, { status: 404 });
  }

  return NextResponse.json({
    message,
    printable: makePrintableText(message),
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json()) as { action?: "print" | "copy" };

  if (body.action === "print") {
    const message = markPrinted(id);
    if (!message) {
      return NextResponse.json({ error: "الرسالة غير موجودة" }, { status: 404 });
    }
    return NextResponse.json({
      message,
      printable: makePrintableText(message),
    });
  }

  if (body.action === "copy") {
    const message = bumpCopy(id);
    if (!message) {
      return NextResponse.json({ error: "الرسالة غير موجودة" }, { status: 404 });
    }
    return NextResponse.json({
      message,
      clipboard: makePrintableText(message),
    });
  }

  return NextResponse.json({ error: "إجراء غير معروف" }, { status: 400 });
}
