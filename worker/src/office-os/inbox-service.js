/**
 * «مركز التواصل» — actions on the office inbox (offices/{o}/inbox: member read, Worker-only writes).
 *
 * Messages that were kept out of the records (greeting, short question, deal follow-up) wait
 * here. A broker who sees that one of them is in fact a property can turn it into a record:
 * the message then goes through exactly the same inbound pipeline as any channel message.
 */

import { AUDIT_ACTIONS, writeAudit } from "./audit-log.js";

const CONVERTIBLE = new Set(["kept", "failed", "pending_review"]);

export async function convertInboxMessage(ctx, { actor, officeId, inboxId }) {
  const id = String(inboxId || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw ctx.deps.appError("inbox_message_not_found", 404, "الرسالة غير موجودة");
  const segments = ["offices", officeId, "inbox", id];
  const message = await ctx.store.get(segments);
  if (!message || (message.officeId && !ctx.deps.officeIdsEquivalent(message.officeId, officeId))) {
    throw ctx.deps.appError("inbox_message_not_found", 404, "الرسالة غير موجودة");
  }
  if (message.opportunityId) return { ok: true, duplicate: true, recordId: String(message.opportunityId) };
  const text = String(message.messageText || "").trim();
  if (!text) throw ctx.deps.appError("inbox_message_empty", 409, "لا يوجد نص في هذه الرسالة لتحويله");
  const state = String(message.processingState || message.status || "").toLowerCase();
  if (!CONVERTIBLE.has(state)) throw ctx.deps.appError("inbox_message_in_progress", 409, "هذه الرسالة عولجت أو قيد المعالجة");
  if (typeof ctx.deps.processInbound !== "function") throw ctx.deps.appError("intake_unavailable", 503, "تعذر تشغيل المعالجة الآن");
  const now = ctx.now();
  const channel = String(message.channel || message.sourceChannel || message.source || "").toLowerCase();
  await ctx.store.set(segments, { processingState: "processing", status: "processing", isProcessed: false, convertedBy: actor.uid, convertedAt: now, updatedAt: now });
  try {
    await ctx.deps.processInbound({
      officeId, inboxId: id, messageText: text,
      senderName: String(message.senderName || ""), senderPhone: String(message.senderPhone || ""),
      receivedAt: message.receivedAt ? new Date(message.receivedAt) : now,
      source: channel.includes("telegram") ? "telegram_bot" : "whatsapp_cloud_api"
    });
  } catch (error) {
    await ctx.store.set(segments, { processingState: "failed", status: "failed", processingError: String(error?.code || "processing_failed").slice(0, 120), updatedAt: ctx.now() }).catch(() => {});
    throw ctx.deps.appError("inbox_convert_failed", 502, "تعذر تحويل الرسالة — حاول مجددًا");
  }
  const after = (await ctx.store.get(segments)) || {};
  await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.INBOX_CONVERTED, actorUid: actor.uid, entityType: "inbox", entityId: id, key: "convert", details: { recordId: String(after.opportunityId || ""), messageClass: String(message.messageClass || "") } });
  return { ok: true, recordId: String(after.opportunityId || ""), state: String(after.processingState || "processing") };
}
