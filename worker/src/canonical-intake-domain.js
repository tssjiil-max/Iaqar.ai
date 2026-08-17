/**
 * Canonical Intake Pipeline — pure domain (no I/O).
 * Accepts text, audio, image, document, sourceUrl; merges analysis outputs.
 */

import { sha256Hex, safeText } from "../../public/js/opportunity-intake-domain.js";

export const CANONICAL_CONTENT_TYPES = Object.freeze([
  "text",
  "audio",
  "image",
  "document",
  "sourceUrl"
]);

export const ANALYSIS_STATUS = Object.freeze({
  PENDING: "pending_analysis",
  FAILED: "analysis_failed",
  COMPLETE: "analysis_complete"
});

export const MAX_CANONICAL_PARTS = 8;
export const MAX_ANALYSIS_RETRIES = 3;

export function mapSourceTypeToCanonicalContentType(sourceType = "") {
  const type = safeText(sourceType, 20).toLowerCase();
  if (type === "url") return "sourceUrl";
  if (type === "text") return "text";
  if (type === "audio") return "audio";
  if (type === "image" || type === "screenshot") return "image";
  if (type === "pdf" || type === "word" || type === "excel") return "document";
  return "";
}

export function normalizeCanonicalContentType(value = "") {
  const type = safeText(value, 20).toLowerCase();
  return CANONICAL_CONTENT_TYPES.includes(type) ? type : "";
}

export function buildFileSummary({
  fileChecksum = "",
  contentType = "",
  byteSize = 0,
  mediaPath = "",
  fileName = "",
  sourceUrl = ""
} = {}) {
  return {
    checksum: safeText(fileChecksum, 128),
    contentType: safeText(contentType, 120),
    byteSize: Number(byteSize) || 0,
    mediaPath: safeText(mediaPath, 500),
    fileName: safeText(fileName, 240),
    sourceUrl: safeText(sourceUrl, 2000)
  };
}

export function summarizePartsForIdempotency(parts = []) {
  return parts.map((part) => {
    const contentType = normalizeCanonicalContentType(part.contentType) || safeText(part.contentType, 20);
    const summary = buildFileSummary({
      fileChecksum: part.fileChecksum,
      contentType: part.mimeType || part.contentType,
      byteSize: part.byteSize,
      mediaPath: part.mediaPath,
      fileName: part.fileName,
      sourceUrl: part.sourceUrl || part.url
    });
    const textSlice = safeText(part.text, 400).replace(/\s+/g, " ").trim();
    return `${contentType}|${summary.checksum}|${summary.mediaPath}|${summary.sourceUrl}|${textSlice}`;
  }).sort().join("||");
}

export async function buildImportIdempotencyKey(officeId, parts = [], clientKey = "") {
  const office = safeText(officeId, 80).toLowerCase();
  const client = safeText(clientKey, 120);
  const material = client || summarizePartsForIdempotency(parts);
  const hex = await sha256Hex(`canonical-intake|${office}|${material}`);
  return `ci_${hex.slice(0, 40)}`;
}

export function mergeAnalysisOutputs(parts = []) {
  const merged = {
    rawText: "",
    transcript: "",
    extractedFields: {},
    confidence: 0,
    partCount: 0
  };
  const rawChunks = [];
  const transcriptChunks = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    merged.partCount += 1;
    if (part.rawText) rawChunks.push(safeText(part.rawText, 12000));
    if (part.transcript) transcriptChunks.push(safeText(part.transcript, 12000));
    if (part.extractedFields && typeof part.extractedFields === "object") {
      for (const [key, value] of Object.entries(part.extractedFields)) {
        if (value === null || value === undefined || String(value).trim() === "") continue;
        merged.extractedFields[key] = value;
      }
    }
    const partConfidence = Number(part.confidence);
    if (Number.isFinite(partConfidence)) {
      merged.confidence = Math.max(merged.confidence, partConfidence);
    }
  }
  merged.rawText = rawChunks.join("\n").trim();
  merged.transcript = transcriptChunks.join("\n").trim();
  return merged;
}

export function resolveFailureStatus(retryCount = 0, maxRetries = MAX_ANALYSIS_RETRIES) {
  const count = Number(retryCount) || 0;
  return count < maxRetries ? ANALYSIS_STATUS.PENDING : ANALYSIS_STATUS.FAILED;
}

export function normalizeCanonicalParts(input = {}) {
  const parts = [];
  const pushPart = (part) => {
    if (!part || typeof part !== "object") return;
    const contentType = normalizeCanonicalContentType(part.contentType);
    if (!contentType) return;
    parts.push({
      contentType,
      text: safeText(part.text, 12000),
      sourceUrl: safeText(part.sourceUrl || part.url, 2000),
      mediaPath: safeText(part.mediaPath, 500),
      fileName: safeText(part.fileName, 240),
      mimeType: safeText(part.mimeType || part.contentType, 120),
      byteSize: Number(part.byteSize) || 0,
      fileChecksum: safeText(part.fileChecksum, 128)
    });
  };

  if (Array.isArray(input.parts)) {
    for (const part of input.parts.slice(0, MAX_CANONICAL_PARTS)) pushPart(part);
  }

  const singleType = normalizeCanonicalContentType(input.contentType);
  if (singleType && parts.length === 0) {
    pushPart({
      contentType: singleType,
      text: input.text,
      sourceUrl: input.sourceUrl || input.url,
      mediaPath: input.mediaPath,
      fileName: input.fileName,
      mimeType: input.mimeType || input.contentType,
      byteSize: input.byteSize,
      fileChecksum: input.fileChecksum
    });
  }

  return parts.slice(0, MAX_CANONICAL_PARTS);
}

export function validateCanonicalParts(parts = []) {
  if (!parts.length) return { ok: false, error: "content_required" };
  for (const part of parts) {
    if (part.contentType === "text" && !part.text) {
      return { ok: false, error: "text_required" };
    }
    if (part.contentType === "sourceUrl" && !part.sourceUrl) {
      return { ok: false, error: "source_url_required" };
    }
    if (["audio", "image", "document"].includes(part.contentType) && !part.mediaPath) {
      return { ok: false, error: "media_path_required" };
    }
    if (part.mediaPath && !part.mediaPath.startsWith("opportunity-sources/")) {
      return { ok: false, error: "invalid_media_path" };
    }
  }
  return { ok: true };
}

export function opportunityDocumentIdFromFingerprint(fingerprint) {
  return `opp_${String(fingerprint || "").slice(0, 40)}`;
}

export function sourceDocumentIdFromFingerprint(fingerprint) {
  return `src_${String(fingerprint || "").slice(0, 40)}`;
}

export function importJobDocumentIdFromFingerprint(fingerprint) {
  return `job_${String(fingerprint || "").slice(0, 40)}`;
}
