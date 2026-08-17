/**
 * Canonical Intake Pipeline — Worker orchestration.
 * Stores originals in private R2, creates importJob pending_analysis,
 * dispatches Activepieces with secure refs (adapter-ready when unset).
 */

import {
  ANALYSIS_STATUS,
  buildFileSummary,
  buildImportIdempotencyKey,
  importJobDocumentIdFromFingerprint,
  mergeAnalysisOutputs,
  normalizeCanonicalParts,
  opportunityDocumentIdFromFingerprint,
  resolveFailureStatus,
  sourceDocumentIdFromFingerprint,
  validateCanonicalParts,
  MAX_ANALYSIS_RETRIES
} from "./canonical-intake-domain.js";
import { readinessFieldsForRecord } from "./opportunity-patch-service.js";
import { listMissingOpportunityFields } from "./operations-service.js";
import { mapGeminiToOpportunityFields } from "../../public/js/gemini-voice-intake-domain.js";
import { safeText } from "../../public/js/opportunity-intake-domain.js";
import { extractListingFromAudio } from "./gemini-audio-intake.mjs";
import { extractListingFromImage } from "./listing-image-vision-service.mjs";

const MEDIA_REF_TTL_MS = 15 * 60 * 1000;

function mapParsedToUnifiedFields(parsed = {}, extractedFields = {}) {
  const kind = parsed.kind === "owner_offer" ? "OFFER"
    : (parsed.kind === "client_request" ? "REQUEST" : "");
  const purpose = parsed.transactionType === "rent" ? "RENT"
    : (parsed.transactionType === "sale" ? "SALE" : "");
  const price = Number(parsed.price || 0) || null;
  return {
    opportunityKind: safeText(extractedFields.opportunityKind || kind, 20),
    purpose: safeText(extractedFields.purpose || purpose, 30),
    propertyType: safeText(extractedFields.propertyType || parsed.propertyType, 40),
    city: safeText(extractedFields.city || parsed.city, 80),
    district: safeText(extractedFields.district || parsed.district, 80),
    priceOrBudget: extractedFields.priceOrBudget ?? price,
    area: extractedFields.area ?? (parsed.area ? Number(parsed.area) : null),
    rooms: extractedFields.rooms ?? (parsed.rooms ? Number(parsed.rooms) : null),
    contactPhone: safeText(extractedFields.contactPhone || parsed.phone, 40),
    contactName: safeText(extractedFields.contactName || parsed.senderName, 200),
    advertiserPhoneRaw: safeText(extractedFields.advertiserPhoneRaw || parsed.phone, 40),
    advertiserPhoneNormalized: safeText(extractedFields.advertiserPhoneNormalized || parsed.phone, 20),
    advertiserRole: safeText(extractedFields.advertiserRole || "UNKNOWN", 20)
  };
}

export async function buildCanonicalSecureMediaPayload({
  workerOrigin,
  officeId,
  importJobId,
  mediaPath,
  contentType,
  secret,
  now = Date.now()
} = {}) {
  const exp = now + MEDIA_REF_TTL_MS;
  const payload = JSON.stringify({
    officeId: safeText(officeId, 80),
    importJobId: safeText(importJobId, 80),
    mediaPath: safeText(mediaPath, 500),
    contentType: safeText(contentType, 80),
    exp
  });
  const sig = awaitSignPayload(payload, secret);
  const token = bytesToBase64Url(new TextEncoder().encode(payload));
  const refUrl = `${String(workerOrigin || "").replace(/\/$/, "")}/media/canonical-intake-access?token=${token}&sig=${sig}`;
  return { refUrl, expiresAt: new Date(exp).toISOString() };
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function awaitSignPayload(payload, secret) {
  if (!secret) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToBase64Url(new Uint8Array(sig));
}

export async function verifyCanonicalMediaAccessToken(token, sig, secret) {
  if (!token || !sig || !secret) return { ok: false, error: "invalid_token" };
  const payloadBytes = Uint8Array.from(atob(token.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const payload = new TextDecoder().decode(payloadBytes);
  const expected = await awaitSignPayload(payload, secret);
  if (expected !== sig) return { ok: false, error: "invalid_signature" };
  const data = JSON.parse(payload);
  if (!data.exp || Date.now() > Number(data.exp)) return { ok: false, error: "token_expired" };
  return { ok: true, data };
}

export async function startCanonicalIntake(body, ctx) {
  const officeId = ctx.normalizeOfficeId(body.officeId);
  const brokerId = ctx.cleanText(body.brokerId || ctx.identity?.uid, 120);
  if (!officeId) throw ctx.appError("office_id_required", 400, "معرّف المكتب مطلوب");
  if (!brokerId) throw ctx.appError("broker_required", 400, "يلزم تسجيل الدخول");

  const parts = normalizeCanonicalParts(body);
  const validation = validateCanonicalParts(parts);
  if (!validation.ok) throw ctx.appError(validation.error, 400, "محتوى الإدخال غير مكتمل");

  const idempotencyKey = await buildImportIdempotencyKey(
    officeId,
    parts,
    body.idempotencyKey || body.clientIdempotencyKey || ""
  );
  const fingerprint = idempotencyKey.replace(/^ci_/, "");
  const opportunityId = ctx.cleanText(
    body.opportunityId || opportunityDocumentIdFromFingerprint(fingerprint),
    180
  );
  const sourceId = sourceDocumentIdFromFingerprint(fingerprint);
  const importJobId = importJobDocumentIdFromFingerprint(fingerprint);
  const now = new Date();

  const existingJob = await ctx.getFirestoreDocument({
    projectId: ctx.projectId,
    segments: ["offices", officeId, "importJobs", importJobId],
    accessToken: ctx.accessToken,
    allowMissing: true
  });
  if (existingJob) {
    const job = ctx.firestoreFieldsToJs(existingJob.fields || {});
    if (job.analysisStatus === ANALYSIS_STATUS.COMPLETE) {
      return {
        ok: true,
        duplicate: true,
        officeId,
        opportunityId: job.opportunityId || opportunityId,
        importJobId,
        analysisStatus: job.analysisStatus,
        idempotencyKey
      };
    }
    if (job.analysisStatus === ANALYSIS_STATUS.PENDING) {
      return {
        ok: true,
        duplicate: true,
        officeId,
        opportunityId: job.opportunityId || opportunityId,
        importJobId,
        analysisStatus: job.analysisStatus,
        idempotencyKey
      };
    }
  }

  const sourceSummaries = parts.map((part) => buildFileSummary({
    fileChecksum: part.fileChecksum,
    contentType: part.mimeType || part.contentType,
    byteSize: part.byteSize,
    mediaPath: part.mediaPath,
    fileName: part.fileName,
    sourceUrl: part.sourceUrl
  }));

  const opportunityFields = ctx.compactFields({
    schemaVersion: ctx.firestoreInteger(5),
    officeId: ctx.firestoreString(officeId),
    brokerId: ctx.firestoreString(brokerId),
    originatingOfficeId: ctx.firestoreString(officeId),
    originatingBrokerId: ctx.firestoreString(brokerId),
    currentOwningOfficeId: ctx.firestoreString(officeId),
    sourceType: ctx.firestoreString(parts[0]?.contentType || "text"),
    sourceReference: ctx.firestoreString(sourceId),
    deduplicationFingerprint: ctx.firestoreString(fingerprint),
    internalStatus: ctx.firestoreString("ANALYZING"),
    analysisStatus: ctx.firestoreString(ANALYSIS_STATUS.PENDING),
    lifecycleStatus: ctx.firestoreString(ctx.LIFECYCLE_STATUS?.NEW || "ACTIVE"),
    cooperationState: ctx.firestoreString("NOT_SHARED"),
    cooperationStatus: ctx.firestoreString("NOT_SHARED"),
    version: ctx.firestoreInteger(1),
    createdAt: ctx.firestoreTimestamp(now),
    updatedAt: ctx.firestoreTimestamp(now)
  });

  const sourceFields = ctx.compactFields({
    schemaVersion: ctx.firestoreInteger(2),
    officeId: ctx.firestoreString(officeId),
    brokerId: ctx.firestoreString(brokerId),
    opportunityId: ctx.firestoreString(opportunityId),
    sourceType: ctx.firestoreString(parts[0]?.contentType || "text"),
    deduplicationFingerprint: ctx.firestoreString(fingerprint),
    mediaPath: ctx.firestoreOptionalString(parts.find((p) => p.mediaPath)?.mediaPath || ""),
    fileName: ctx.firestoreOptionalString(parts.find((p) => p.fileName)?.fileName || ""),
    contentType: ctx.firestoreOptionalString(parts.find((p) => p.mimeType)?.mimeType || ""),
    text: ctx.firestoreOptionalString(parts.find((p) => p.text)?.text || ""),
    url: ctx.firestoreOptionalString(parts.find((p) => p.sourceUrl)?.sourceUrl || ""),
    privateStorageOnly: ctx.firestoreBoolean(true),
    createdAt: ctx.firestoreTimestamp(now),
    updatedAt: ctx.firestoreTimestamp(now)
  });

  const jobFields = ctx.compactFields({
    schemaVersion: ctx.firestoreInteger(1),
    officeId: ctx.firestoreString(officeId),
    brokerId: ctx.firestoreString(brokerId),
    opportunityId: ctx.firestoreString(opportunityId),
    sourceId: ctx.firestoreString(sourceId),
    idempotencyKey: ctx.firestoreString(idempotencyKey),
    analysisStatus: ctx.firestoreString(ANALYSIS_STATUS.PENDING),
    partsJson: ctx.firestoreString(JSON.stringify(parts)),
    fileSummariesJson: ctx.firestoreString(JSON.stringify(sourceSummaries)),
    retryCount: ctx.firestoreInteger(0),
    activepiecesMode: ctx.firestoreString(ctx.env.ACTIVEPIECES_WEBHOOK_URL ? "activepieces" : "inline_adapter"),
    createdAt: ctx.firestoreTimestamp(now),
    updatedAt: ctx.firestoreTimestamp(now)
  });

  await ctx.setFirestoreDocument({
    projectId: ctx.projectId,
    segments: ["offices", officeId, "opportunitySources", sourceId],
    accessToken: ctx.accessToken,
    fields: sourceFields
  });
  await ctx.setFirestoreDocument({
    projectId: ctx.projectId,
    segments: ["offices", officeId, "opportunities", opportunityId],
    accessToken: ctx.accessToken,
    fields: opportunityFields
  });
  await ctx.setFirestoreDocument({
    projectId: ctx.projectId,
    segments: ["offices", officeId, "importJobs", importJobId],
    accessToken: ctx.accessToken,
    fields: jobFields
  });

  const workerOrigin = new URL(ctx.requestUrl || "https://iaqar-ai.workers.dev").origin;
  const mediaSecret = String(ctx.env.CANONICAL_INTAKE_MEDIA_SECRET || ctx.env.ACTIVEPIECES_CALLBACK_SECRET || "");
  const secureMediaRefs = await Promise.all(
    parts
      .filter((part) => part.mediaPath)
      .map((part) => buildCanonicalSecureMediaPayload({
        workerOrigin,
        officeId,
        importJobId,
        mediaPath: part.mediaPath,
        contentType: part.contentType,
        secret: mediaSecret
      }))
  );

  const dispatchPayload = {
    importJobId,
    officeId,
    opportunityId,
    parts,
    secureMediaRefs,
    callbackUrl: `${workerOrigin}/pipeline/canonical-intake/callback`
  };

  let inlineResult = null;
  if (!ctx.env.ACTIVEPIECES_WEBHOOK_URL) {
    inlineResult = await runInlineCanonicalAnalysis(parts, ctx, officeId);
    return await completeCanonicalAnalysis({
      officeId,
      opportunityId,
      importJobId,
      analysisParts: inlineResult.parts,
      analysisStatus: inlineResult.ok ? ANALYSIS_STATUS.COMPLETE : resolveFailureStatus(0),
      errorMessage: inlineResult.error || "",
      ctx
    });
  }

  try {
    await fetch(String(ctx.env.ACTIVEPIECES_WEBHOOK_URL), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Iaqar-Secret": String(ctx.env.ACTIVEPIECES_OUTBOUND_SECRET || "")
      },
      body: JSON.stringify(dispatchPayload)
    });
  } catch (error) {
    console.warn("[iaqar-canonical-intake] activepieces dispatch failed", error?.message);
    inlineResult = await runInlineCanonicalAnalysis(parts, ctx, officeId);
    return await completeCanonicalAnalysis({
      officeId,
      opportunityId,
      importJobId,
      analysisParts: inlineResult.parts,
      analysisStatus: inlineResult.ok ? ANALYSIS_STATUS.COMPLETE : ANALYSIS_STATUS.PENDING,
      errorMessage: inlineResult.error || "activepieces_dispatch_failed",
      ctx
    });
  }

  return {
    ok: true,
    duplicate: false,
    officeId,
    opportunityId,
    importJobId,
    analysisStatus: ANALYSIS_STATUS.PENDING,
    idempotencyKey,
    activepieces: "dispatched",
    productionAi: false
  };
}

export async function runInlineCanonicalAnalysis(parts, ctx, officeId) {
  const outputs = [];
  let failed = false;
  let lastError = "";
  for (const part of parts) {
    try {
      if (part.contentType === "text") {
        const parsed = ctx.parseRealEstateMessage(part.text);
        outputs.push({
          contentType: part.contentType,
          rawText: part.text,
          transcript: "",
          extractedFields: mapParsedToUnifiedFields(parsed),
          confidence: Number(parsed.confidence || 0),
          extractionMode: "deterministic_text_parser",
          productionAi: false
        });
        continue;
      }
      if (part.contentType === "sourceUrl") {
        const targetUrl = ctx.normalizeListingFetchUrl(part.sourceUrl);
        const fetched = await ctx.fetchListingPage(targetUrl);
        if (!fetched.ok) {
          failed = true;
          lastError = fetched.error || "url_resolve_failed";
          continue;
        }
        const parsed = ctx.parseRealEstateMessage(fetched.text || "");
        outputs.push({
          contentType: part.contentType,
          rawText: fetched.text || "",
          transcript: "",
          extractedFields: mapParsedToUnifiedFields(parsed),
          confidence: Number(parsed.confidence || 0),
          extractionMode: "listing_fetch_parser",
          productionAi: false
        });
        continue;
      }
      if (part.contentType === "image") {
        const vision = await ctx.extractImageTextFromMediaPath(part.mediaPath, officeId);
        if (!vision.ok) {
          failed = true;
          lastError = vision.error || "image_extract_failed";
          continue;
        }
        const parsed = ctx.parseRealEstateMessage(vision.text || "");
        const brokerFields = vision.brokerFields || {};
        outputs.push({
          contentType: part.contentType,
          rawText: vision.text || "",
          transcript: "",
          extractedFields: mapParsedToUnifiedFields(parsed, brokerFields),
          confidence: Math.max(Number(parsed.confidence || 0), Number(vision.confidence || 0), 40),
          extractionMode: vision.extractionMode || "gemini_vision_adapter",
          productionAi: Boolean(vision.productionAi)
        });
        continue;
      }
      if (part.contentType === "audio") {
        const audio = await ctx.extractAudioFromMediaPath(part.mediaPath, officeId);
        if (!audio.ok) {
          failed = true;
          lastError = audio.error || "audio_extract_failed";
          continue;
        }
        const transcript = safeText(audio.transcript || audio.text || "", 12000);
        const parsed = ctx.parseRealEstateMessage(transcript);
        const brokerFields = audio.brokerFields || mapGeminiToOpportunityFields(audio.structured || {});
        outputs.push({
          contentType: part.contentType,
          rawText: transcript,
          transcript,
          extractedFields: mapParsedToUnifiedFields(parsed, brokerFields),
          confidence: Math.max(Number(parsed.confidence || 0), Number(audio.confidence || 0)),
          extractionMode: audio.extractionMode || "gemini_audio_transcribe_adapter",
          productionAi: Boolean(audio.productionAi)
        });
        continue;
      }
      if (part.contentType === "document") {
        outputs.push({
          contentType: part.contentType,
          rawText: safeText(part.fileName, 240),
          transcript: "",
          extractedFields: {
            propertyType: /فيلا|فله/i.test(part.fileName) ? "فيلا" : "",
            opportunityKind: /طلب|مطلوب/i.test(part.fileName) ? "REQUEST" : "OFFER"
          },
          confidence: 25,
          extractionMode: "simulated_document_fixture",
          productionAi: false
        });
      }
    } catch (error) {
      failed = true;
      lastError = String(error?.message || error || "analysis_failed");
    }
  }
  return {
    ok: outputs.length > 0 && !failed,
    parts: outputs,
    error: failed ? lastError : ""
  };
}

export async function completeCanonicalAnalysis({
  officeId,
  opportunityId,
  importJobId,
  analysisParts = [],
  analysisStatus = ANALYSIS_STATUS.COMPLETE,
  errorMessage = "",
  ctx
}) {
  const now = new Date();
  const merged = mergeAnalysisOutputs(analysisParts);
  const parsed = ctx.parseRealEstateMessage(
    [merged.rawText, merged.transcript].filter(Boolean).join("\n")
  );
  const unified = mapParsedToUnifiedFields(parsed, merged.extractedFields);
  const recordForReadiness = { ...unified, ...merged.extractedFields };
  const readiness = readinessFieldsForRecord(recordForReadiness);
  const missingFields = listMissingOpportunityFields(recordForReadiness);
  const internalStatus = analysisStatus === ANALYSIS_STATUS.COMPLETE
    ? (readiness.matchingReadiness === "READY_FOR_MATCHING" ? "READY" : "NEEDS_DATA")
    : "ANALYZING";

  const opportunityPatch = ctx.compactFields({
    ...ctx.opportunityPatchToFirestoreFields({
      ...unified,
      ...readiness,
      rawText: merged.rawText,
      transcript: merged.transcript,
      extractedFieldsJson: JSON.stringify(merged.extractedFields),
      confidence: merged.confidence,
      missingFieldsJson: JSON.stringify(missingFields),
      analysisStatus,
      internalStatus,
      dataCompleteness: Math.max(0, 100 - missingFields.length * 12),
      extractionMode: analysisParts.map((p) => p.extractionMode).filter(Boolean).join("|") || "canonical_intake",
      productionAi: false,
      version: 2,
      updatedAt: now.toISOString()
    }),
    officeId: ctx.firestoreString(officeId),
    updatedAt: ctx.firestoreTimestamp(now)
  });

  await ctx.setFirestoreDocument({
    projectId: ctx.projectId,
    segments: ["offices", officeId, "opportunities", opportunityId],
    accessToken: ctx.accessToken,
    fields: opportunityPatch
  });

  const jobDoc = await ctx.getFirestoreDocument({
    projectId: ctx.projectId,
    segments: ["offices", officeId, "importJobs", importJobId],
    accessToken: ctx.accessToken,
    allowMissing: true
  });
  const retryCount = Number(ctx.firestoreFieldsToJs(jobDoc?.fields || {}).retryCount || 0);

  await ctx.setFirestoreDocument({
    projectId: ctx.projectId,
    segments: ["offices", officeId, "importJobs", importJobId],
    accessToken: ctx.accessToken,
    fields: ctx.compactFields({
      analysisStatus: ctx.firestoreString(analysisStatus),
      rawText: ctx.firestoreOptionalString(merged.rawText),
      transcript: ctx.firestoreOptionalString(merged.transcript),
      extractedFieldsJson: ctx.firestoreString(JSON.stringify(merged.extractedFields)),
      confidence: ctx.firestoreInteger(Math.round(merged.confidence || 0)),
      missingFieldsJson: ctx.firestoreString(JSON.stringify(missingFields)),
      lastError: ctx.firestoreOptionalString(errorMessage || ""),
      retryCount: ctx.firestoreInteger(
        analysisStatus === ANALYSIS_STATUS.FAILED ? retryCount + 1 : retryCount
      ),
      updatedAt: ctx.firestoreTimestamp(now)
    })
  });

  return {
    ok: true,
    duplicate: false,
    officeId,
    opportunityId,
    importJobId,
    analysisStatus,
    rawText: merged.rawText,
    transcript: merged.transcript,
    extractedFields: merged.extractedFields,
    confidence: merged.confidence,
    missingFields,
    fields: unified,
    matchingReadiness: readiness.matchingReadiness,
    productionAi: false,
    retryable: analysisStatus !== ANALYSIS_STATUS.COMPLETE
  };
}

export async function handleCanonicalIntakeCallback(body, ctx) {
  const secret = String(ctx.request.headers.get("X-Iaqar-Callback-Secret") || "");
  const expected = String(ctx.env.ACTIVEPIECES_CALLBACK_SECRET || "");
  if (!expected || secret !== expected) {
    throw ctx.appError("forbidden", 403, "غير مصرح");
  }
  const officeId = ctx.normalizeOfficeId(body.officeId);
  const opportunityId = ctx.cleanText(body.opportunityId, 180);
  const importJobId = ctx.cleanText(body.importJobId, 180);
  if (!officeId || !opportunityId || !importJobId) {
    throw ctx.appError("callback_data_missing", 400, "بيانات الاستدعاء غير مكتملة");
  }
  const analysisStatus = String(body.analysisStatus || ANALYSIS_STATUS.COMPLETE);
  const parts = Array.isArray(body.parts) ? body.parts : [];
  return await completeCanonicalAnalysis({
    officeId,
    opportunityId,
    importJobId,
    analysisParts: parts,
    analysisStatus: analysisStatus === ANALYSIS_STATUS.FAILED
      ? ANALYSIS_STATUS.FAILED
      : ANALYSIS_STATUS.COMPLETE,
    errorMessage: body.error || "",
    ctx
  });
}

export async function retryCanonicalIntake(body, ctx) {
  const officeId = ctx.normalizeOfficeId(body.officeId);
  const importJobId = ctx.cleanText(body.importJobId, 180);
  if (!officeId || !importJobId) throw ctx.appError("import_job_required", 400, "رقم مهمة الاستيراد مطلوب");

  const jobDoc = await ctx.getFirestoreDocument({
    projectId: ctx.projectId,
    segments: ["offices", officeId, "importJobs", importJobId],
    accessToken: ctx.accessToken,
    allowMissing: true
  });
  if (!jobDoc) throw ctx.appError("import_job_not_found", 404, "مهمة الاستيراد غير موجودة");
  const job = ctx.firestoreFieldsToJs(jobDoc.fields || {});
  const retryCount = Number(job.retryCount || 0);
  if (retryCount >= MAX_ANALYSIS_RETRIES) {
    throw ctx.appError("retry_exhausted", 409, "تم استنفاد محاولات التحليل");
  }
  const parts = JSON.parse(String(job.partsJson || "[]"));
  const inlineResult = await runInlineCanonicalAnalysis(parts, ctx, officeId);
  const status = inlineResult.ok
    ? ANALYSIS_STATUS.COMPLETE
    : resolveFailureStatus(retryCount + 1);
  return await completeCanonicalAnalysis({
    officeId,
    opportunityId: job.opportunityId,
    importJobId,
    analysisParts: inlineResult.parts,
    analysisStatus: status,
    errorMessage: inlineResult.error || "",
    ctx
  });
}

export async function extractAudioFromMediaPath(mediaPath, officeId, env, bucket, parseRealEstateMessage) {
  const object = await bucket.get(mediaPath);
  if (!object) return { ok: false, error: "media_not_found" };
  const metadata = object.customMetadata || {};
  if (metadata.officeId && metadata.officeId !== officeId) {
    return { ok: false, error: "media_scope_mismatch" };
  }
  const contentType = String(object.httpMetadata?.contentType || "audio/mp4").split(";")[0].toLowerCase();
  if (!["audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/webm", "audio/x-wav"].includes(contentType)) {
    return { ok: false, error: "unsupported_media" };
  }
  const bytes = await object.arrayBuffer();
  if (!bytes.byteLength) return { ok: false, error: "audio_empty" };
  const result = await extractListingFromAudio({
    env,
    audioBytes: bytes,
    mimeType: contentType,
    parseRealEstateMessage
  });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || "audio_ai_failed",
      publicMessage: result.publicMessage || ""
    };
  }
  const transcript = safeText(result.transcript || result.text || "", 12000);
  return {
    ok: true,
    transcript,
    text: transcript,
    structured: result.brokerFields || {},
    brokerFields: result.brokerFields || null,
    fieldSources: result.fieldSources || {},
    confidence: Number(result.confidence || 0),
    extractionMode: result.extractionMode || "gemini_audio_transcribe_adapter",
    extractionStatus: result.extractionStatus || "extracted",
    productionAi: Boolean(result.productionAi)
  };
}

export async function extractImageTextFromMediaPath(mediaPath, officeId, env, bucket, runLlamaVisionExtract, parseRealEstateMessage) {
  const object = await bucket.get(mediaPath);
  if (!object) return { ok: false, error: "media_not_found" };
  const metadata = object.customMetadata || {};
  if (metadata.officeId && metadata.officeId !== officeId) {
    return { ok: false, error: "media_scope_mismatch" };
  }
  const contentType = String(object.httpMetadata?.contentType || "").toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    return { ok: false, error: "unsupported_media" };
  }
  if (!env.AI && !String(env.GEMINI_API_KEY || "").trim()) {
    return { ok: false, error: "media_extraction_unavailable" };
  }
  const bytes = await object.arrayBuffer();
  const vision = await extractListingFromImage({
    env,
    imageBytes: new Uint8Array(bytes),
    mimeType: contentType,
    runLlamaVisionExtract,
    parseRealEstateMessage
  });
  if (!vision.ok) {
    return {
      ok: false,
      error: vision.error || "media_ai_failed",
      publicMessage: vision.publicMessage || ""
    };
  }
  const text = safeText(vision.text || "", 12000);
  if (!text && !vision.brokerFields) return { ok: false, error: "empty_listing_text" };
  return {
    ok: true,
    text,
    brokerFields: vision.brokerFields || null,
    fieldSources: vision.fieldSources || {},
    analyzerProvider: vision.analyzerProvider || "",
    confidence: Number(vision.confidence || 0),
    extractionMode: vision.extractionMode || "gemini_vision_adapter",
    extractionStatus: vision.extractionStatus || "extracted",
    productionAi: Boolean(vision.productionAi)
  };
}
