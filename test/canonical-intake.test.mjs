/**
 * Canonical Intake Pipeline — domain and service tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_STATUS,
  buildFileSummary,
  buildImportIdempotencyKey,
  mergeAnalysisOutputs,
  normalizeCanonicalParts,
  validateCanonicalParts,
  resolveFailureStatus
} from "../worker/src/canonical-intake-domain.js";
import { mapSourceTypeToCanonicalContentType } from "../public/js/opportunity-intake-domain.js";

test("canonical content types map from legacy source types", () => {
  assert.equal(mapSourceTypeToCanonicalContentType("url"), "sourceUrl");
  assert.equal(mapSourceTypeToCanonicalContentType("text"), "text");
  assert.equal(mapSourceTypeToCanonicalContentType("audio"), "audio");
  assert.equal(mapSourceTypeToCanonicalContentType("image"), "image");
  assert.equal(mapSourceTypeToCanonicalContentType("screenshot"), "image");
  assert.equal(mapSourceTypeToCanonicalContentType("pdf"), "document");
});

test("normalizeCanonicalParts accepts single content payload", () => {
  const parts = normalizeCanonicalParts({
    contentType: "text",
    text: "مطلوب شقة في الرياض"
  });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].contentType, "text");
  assert.equal(parts[0].text, "مطلوب شقة في الرياض");
});

test("validateCanonicalParts requires private storage path for media", () => {
  const bad = validateCanonicalParts([{
    contentType: "image",
    mediaPath: "public-intake/office-a/file.jpg"
  }]);
  assert.equal(bad.ok, false);
  const good = validateCanonicalParts([{
    contentType: "image",
    mediaPath: "opportunity-sources/office-a/src_abc/photo.jpg"
  }]);
  assert.equal(good.ok, true);
});

test("mergeAnalysisOutputs merges text transcript and extracted fields", () => {
  const merged = mergeAnalysisOutputs([
    { rawText: "عرض شقة", transcript: "", extractedFields: { city: "الرياض" }, confidence: 40 },
    { rawText: "", transcript: "حي النرجس", extractedFields: { district: "النرجس" }, confidence: 55 }
  ]);
  assert.ok(merged.rawText.includes("عرض شقة"));
  assert.equal(merged.transcript, "حي النرجس");
  assert.equal(merged.extractedFields.city, "الرياض");
  assert.equal(merged.extractedFields.district, "النرجس");
  assert.equal(merged.confidence, 55);
});

test("idempotency key is stable for identical office content summaries", async () => {
  const parts = [{
    contentType: "text",
    text: "مطلوب  شقة   في النرجس"
  }];
  const a = await buildImportIdempotencyKey("office-a", parts);
  const b = await buildImportIdempotencyKey("office-a", [{
    contentType: "text",
    text: "مطلوب شقة في النرجس"
  }]);
  assert.equal(a, b);
  const other = await buildImportIdempotencyKey("office-b", parts);
  assert.notEqual(a, other);
});

test("failure status keeps pending until retry budget exhausted", () => {
  assert.equal(resolveFailureStatus(0), ANALYSIS_STATUS.PENDING);
  assert.equal(resolveFailureStatus(2), ANALYSIS_STATUS.PENDING);
  assert.equal(resolveFailureStatus(3), ANALYSIS_STATUS.FAILED);
});

test("file summary captures checksum and private media path", () => {
  const summary = buildFileSummary({
    fileChecksum: "abc",
    contentType: "image/jpeg",
    byteSize: 1200,
    mediaPath: "opportunity-sources/office-a/src_x/photo.jpg",
    fileName: "photo.jpg"
  });
  assert.equal(summary.checksum, "abc");
  assert.equal(summary.mediaPath, "opportunity-sources/office-a/src_x/photo.jpg");
  assert.equal(summary.byteSize, 1200);
});
