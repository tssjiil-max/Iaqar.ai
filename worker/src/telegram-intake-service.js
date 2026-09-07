/**
 * Secure Telegram webhook adapter.
 * Telegram is inbound transport only. It normalizes updates and feeds Canonical Intake.
 * It never mutates Match / Negotiation / Viewing / Deal / Cooperation state directly.
 */

import {
  TELEGRAM_INTAKE_KIND,
  normalizeTelegramInbound,
  telegramIntakeBoundaryGuarantees
} from "./telegram-intake-domain.js";
import { channelCleanupBoundaryGuarantees } from "./channel-boundary-domain.js";

const TELEGRAM_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";
const MAX_TELEGRAM_MEDIA_BYTES = 15 * 1024 * 1024;

function text(value) {
  return String(value ?? "").trim();
}

function constantTimeTextEqual(a, b) {
  const left = new TextEncoder().encode(text(a));
  const right = new TextEncoder().encode(text(b));
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }
  return diff === 0;
}

export function verifyTelegramWebhookSecret(request, expectedSecret = "") {
  const expected = text(expectedSecret);
  if (!expected) return { ok: false, status: 503, error: "telegram_webhook_not_configured" };
  const actual = text(request?.headers?.get?.(TELEGRAM_SECRET_HEADER));
  if (!actual || !constantTimeTextEqual(actual, expected)) {
    return { ok: false, status: 401, error: "telegram_webhook_unauthorized" };
  }
  return { ok: true };
}

export function resolveTelegramOfficeId({ requestUrl = "", env = {}, firestoreOfficeId = (value) => text(value) } = {}) {
  let pathOffice = "";
  try {
    const url = new URL(requestUrl || "https://iaqar.ai/telegram/webhook");
    const match = url.pathname.match(/^\/telegram\/webhook\/([^/]+)$/);
    pathOffice = match ? decodeURIComponent(match[1] || "") : "";
  } catch {
    pathOffice = "";
  }
  const configured = text(env.TELEGRAM_OFFICE_ID);
  const officeId = firestoreOfficeId(pathOffice || configured);
  if (!officeId) return { ok: false, status: 400, error: "telegram_office_required" };
  if (configured && firestoreOfficeId(configured) !== officeId) {
    return { ok: false, status: 403, error: "telegram_office_scope_mismatch" };
  }
  return { ok: true, officeId };
}

function telegramMediaExtension(kind, contentType = "", filePath = "") {
  const fromPath = text(filePath).match(/\.([a-zA-Z0-9]{2,6})$/)?.[1]?.toLowerCase();
  if (fromPath) return fromPath;
  const mime = text(contentType).toLowerCase();
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("pdf")) return "pdf";
  return kind === TELEGRAM_INTAKE_KIND.PHOTO ? "jpg"
    : kind === TELEGRAM_INTAKE_KIND.VOICE ? "ogg"
      : "bin";
}

function canonicalTypeForTelegramKind(kind) {
  if (kind === TELEGRAM_INTAKE_KIND.PHOTO) return "image";
  if (kind === TELEGRAM_INTAKE_KIND.VOICE) return "audio";
  if (kind === TELEGRAM_INTAKE_KIND.DOCUMENT) return "document";
  return "text";
}

async function downloadTelegramMedia({ envelope, officeId, env, fetchImpl = fetch, bucket }) {
  if (!envelope.mediaFileId) return { ok: false, error: "telegram_media_file_missing" };
  const token = text(env.TELEGRAM_BOT_TOKEN);
  if (!token || !bucket) return { ok: false, error: "telegram_media_adapter_not_configured" };

  const metaResponse = await fetchImpl(
    `https://api.telegram.org/bot${encodeURIComponent(token)}/getFile?file_id=${encodeURIComponent(envelope.mediaFileId)}`
  );
  const meta = await metaResponse.json().catch(() => ({}));
  const filePath = text(meta?.result?.file_path);
  if (!metaResponse.ok || meta?.ok !== true || !filePath) {
    return { ok: false, error: "telegram_get_file_failed" };
  }

  const mediaResponse = await fetchImpl(`https://api.telegram.org/file/bot${encodeURIComponent(token)}/${filePath}`);
  if (!mediaResponse.ok) return { ok: false, error: "telegram_media_download_failed" };
  const bytes = await mediaResponse.arrayBuffer();
  if (!bytes.byteLength) return { ok: false, error: "telegram_media_empty" };
  if (bytes.byteLength > MAX_TELEGRAM_MEDIA_BYTES) return { ok: false, error: "telegram_media_too_large" };

  const contentType = text(mediaResponse.headers?.get?.("content-type")) || (
    envelope.kind === TELEGRAM_INTAKE_KIND.PHOTO ? "image/jpeg"
      : envelope.kind === TELEGRAM_INTAKE_KIND.VOICE ? "audio/ogg"
        : "application/octet-stream"
  );
  const extension = telegramMediaExtension(envelope.kind, contentType, filePath);
  const safeUpdate = text(envelope.externalUpdateId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "unknown";
  const safeMessage = text(envelope.externalMessageId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "message";
  const mediaPath = `opportunity-sources/${officeId}/telegram/${safeUpdate}_${safeMessage}.${extension}`;
  await bucket.put(mediaPath, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      officeId,
      sourceType: canonicalTypeForTelegramKind(envelope.kind),
      sourceChannel: "telegram",
      externalUpdateId: text(envelope.externalUpdateId),
      externalMessageId: text(envelope.externalMessageId)
    }
  });
  return {
    ok: true,
    mediaPath,
    contentType,
    byteSize: bytes.byteLength,
    fileName: filePath.split("/").pop() || `telegram.${extension}`
  };
}

export async function handleTelegramCanonicalWebhook({ request, env, requestId = "", helpers }) {
  const secret = verifyTelegramWebhookSecret(request, env.TELEGRAM_WEBHOOK_SECRET);
  if (!secret.ok) return { ...secret, requestId };

  const office = resolveTelegramOfficeId({
    requestUrl: request.url,
    env,
    firestoreOfficeId: helpers.firestoreOfficeId
  });
  if (!office.ok) return { ...office, requestId };
  const officeId = office.officeId;

  const update = await request.json().catch(() => null);
  if (!update || typeof update !== "object") {
    return { ok: false, status: 400, error: "telegram_update_invalid", requestId };
  }
  const envelope = normalizeTelegramInbound(update, { officeId });
  if (!envelope.externalUpdateId) {
    return { ok: false, status: 400, error: "telegram_update_id_required", requestId };
  }

  const inboxId = `tg_${text(envelope.externalUpdateId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120)}`;
  const existing = await helpers.getFirestoreDocument({
    projectId: helpers.projectId,
    segments: ["offices", officeId, "inbox", inboxId],
    accessToken: helpers.accessToken,
    allowMissing: true
  });
  if (existing) {
    const data = helpers.firestoreFieldsToJs(existing.fields || {});
    return {
      ok: true,
      duplicate: true,
      status: 200,
      officeId,
      inboxId,
      opportunityId: text(data.opportunityId),
      requestId,
      boundaries: { ...telegramIntakeBoundaryGuarantees(), ...channelCleanupBoundaryGuarantees() }
    };
  }

  const now = new Date();
  await helpers.setFirestoreDocument({
    projectId: helpers.projectId,
    segments: ["offices", officeId, "inbox", inboxId],
    accessToken: helpers.accessToken,
    fields: helpers.compactFields({
      schemaVersion: helpers.firestoreInteger(3),
      officeId: helpers.firestoreString(officeId),
      direction: helpers.firestoreString("inbound"),
      source: helpers.firestoreString("telegram_bot"),
      channel: helpers.firestoreString("telegram"),
      status: helpers.firestoreString("received"),
      processingState: helpers.firestoreString("received"),
      isProcessed: helpers.firestoreBoolean(false),
      outboundEnabled: helpers.firestoreBoolean(false),
      messageId: helpers.firestoreString(envelope.externalMessageId || envelope.externalUpdateId),
      externalUpdateId: helpers.firestoreString(envelope.externalUpdateId),
      messageType: helpers.firestoreString(envelope.kind),
      messageText: helpers.firestoreOptionalString(envelope.text),
      senderName: helpers.firestoreOptionalString(envelope.senderName),
      senderExternalId: helpers.firestoreOptionalString(envelope.senderId),
      chatExternalId: helpers.firestoreOptionalString(envelope.chatId),
      receivedAt: helpers.firestoreTimestamp(new Date(envelope.receivedAt)),
      createdAt: helpers.firestoreTimestamp(now),
      rawPayload: helpers.firestoreString(JSON.stringify({
        update_id: update.update_id,
        message_id: envelope.externalMessageId,
        kind: envelope.kind
      }))
    })
  });

  if (envelope.kind === TELEGRAM_INTAKE_KIND.UNSUPPORTED) {
    await helpers.setFirestoreDocument({
      projectId: helpers.projectId,
      segments: ["offices", officeId, "inbox", inboxId],
      accessToken: helpers.accessToken,
      fields: {
        processingState: helpers.firestoreString("ignored"),
        status: helpers.firestoreString("ignored"),
        isProcessed: helpers.firestoreBoolean(true),
        updatedAt: helpers.firestoreTimestamp(new Date())
      }
    });
    return { ok: true, ignored: true, status: 200, officeId, inboxId, requestId };
  }

  const parts = [];
  if (envelope.text) parts.push({ contentType: "text", text: envelope.text });
  if (envelope.kind !== TELEGRAM_INTAKE_KIND.TEXT) {
    const media = await downloadTelegramMedia({
      envelope,
      officeId,
      env,
      fetchImpl: helpers.fetchImpl || fetch,
      bucket: helpers.bucket
    });
    if (!media.ok) {
      await helpers.setFirestoreDocument({
        projectId: helpers.projectId,
        segments: ["offices", officeId, "inbox", inboxId],
        accessToken: helpers.accessToken,
        fields: {
          processingState: helpers.firestoreString("needs_media_adapter"),
          status: helpers.firestoreString("pending_review"),
          processingError: helpers.firestoreString(media.error),
          updatedAt: helpers.firestoreTimestamp(new Date())
        }
      });
      // Return 200 so Telegram does not retry the same unsupported/config-missing media forever.
      return {
        ok: true,
        accepted: true,
        deferred: true,
        reason: media.error,
        status: 200,
        officeId,
        inboxId,
        requestId,
        boundaries: { ...telegramIntakeBoundaryGuarantees(), ...channelCleanupBoundaryGuarantees() }
      };
    }
    parts.push({
      contentType: canonicalTypeForTelegramKind(envelope.kind),
      mediaPath: media.mediaPath,
      fileName: media.fileName,
      mimeType: media.contentType,
      byteSize: media.byteSize
    });
  }

  if (!parts.length) {
    return { ok: true, ignored: true, status: 200, officeId, inboxId, requestId };
  }

  const result = await helpers.ingestCanonical({
    officeId,
    brokerId: text(env.TELEGRAM_BROKER_ID) || `telegram_bot_${officeId}`,
    parts,
    idempotencyKey: `telegram:${officeId}:${envelope.externalUpdateId}`,
    sourceChannel: "telegram",
    externalEventId: envelope.externalUpdateId,
    externalMessageId: envelope.externalMessageId,
    senderExternalId: envelope.senderId,
    senderName: envelope.senderName
  });

  await helpers.setFirestoreDocument({
    projectId: helpers.projectId,
    segments: ["offices", officeId, "inbox", inboxId],
    accessToken: helpers.accessToken,
    fields: {
      processingState: helpers.firestoreString(result.analysisStatus === "analysis_complete" ? "processed" : "processing"),
      status: helpers.firestoreString(result.analysisStatus === "analysis_complete" ? "processed" : "processing"),
      isProcessed: helpers.firestoreBoolean(result.analysisStatus === "analysis_complete"),
      opportunityId: helpers.firestoreOptionalString(result.opportunityId || ""),
      importJobId: helpers.firestoreOptionalString(result.importJobId || ""),
      updatedAt: helpers.firestoreTimestamp(new Date())
    }
  });

  return {
    ok: true,
    duplicate: Boolean(result.duplicate),
    status: 200,
    officeId,
    inboxId,
    opportunityId: result.opportunityId || "",
    importJobId: result.importJobId || "",
    analysisStatus: result.analysisStatus || "",
    requestId,
    boundaries: { ...telegramIntakeBoundaryGuarantees(), ...channelCleanupBoundaryGuarantees() }
  };
}

export function telegramWebhookRuntimeContract() {
  return {
    route: "/telegram/webhook/:officeId",
    method: "POST",
    secretHeader: TELEGRAM_SECRET_HEADER,
    inboundEnabledWhenConfigured: true,
    outboundBotApiEnabled: false,
    canonicalIntakeOnly: true,
    directBusinessStateMutation: false,
    mediaDownloadRequiresBotTokenAndR2: true
  };
}
