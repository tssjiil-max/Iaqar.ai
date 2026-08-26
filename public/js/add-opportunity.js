/**
 * Phase 2 — Add Opportunity: تنفيذ → مراجعة → اعتماد وحفظ (مرة واحدة).
 */

import {
  ATTACHMENT_ACCEPT,
  INTAKE_STATE_LABELS,
  createExtractionAdapter,
  detectSourceTypeFromText,
  normalizeUrl,
  prepareOpportunityIntake,
  validateAttachment,
  mapSourceTypeToCanonicalContentType,
  buildOpportunityRecord,
  buildSourceRecord,
  normalizeOpportunityFinancials,
  computeDataCompleteness
} from "./opportunity-intake-domain.js";
import {
  phase4BoundaryGuarantees,
  requestOpportunityRematch,
  shouldRematchAfterOpportunityWrite
} from "./matching-domain.js";
import {
  phase5BoundaryGuarantees,
  requestMissingDataOperationSync
} from "./operations-domain.js";
import { dismissOpportunityReviewIfOpen, openOpportunityReview } from "./opportunity-review.js";
import { buildImportSimplifiedReviewDefaults } from "./import-advert-review-domain.js";
import { mergeAdvertiserFieldsIntoOpportunity } from "./advertiser-phone-domain.js";
import { isEligibleForMatchingRun } from "./opportunity-readiness-domain.js";
import { mountVoiceIntakePanel } from "./gemini-voice-intake-ui.js";
import {
  buildVoiceSummaryText,
  createVoiceExtractionAdapter,
  mapGeminiToOpportunityFields
} from "./gemini-voice-intake-domain.js";

const LOCAL_STATE_LABELS = Object.freeze({
  ready: "راجع البيانات ثم اعتماد وحفظ"
});

const EXTRACTION_TIMEOUT_MS = 40000;
let extractionTimeoutMs = EXTRACTION_TIMEOUT_MS;

function $(id) {
  return document.getElementById(id);
}

function toast(message) {
  const node = $("toast");
  if (!node) return;
  node.textContent = message;
  node.classList.add("show");
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => node.classList.remove("show"), 2600);
}

function currentOffice() {
  return window.IAQAR?.office || null;
}

function currentUser() {
  try {
    return window.firebase?.auth?.()?.currentUser || null;
  } catch {
    return null;
  }
}

const PRODUCTION_WORKER_BASE = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
const STAGING_WORKER_BASE = "https://iaqar-intake-staging.iaqar-ai.workers.dev";

function workerBase() {
  if (window.IAQAR && typeof window.IAQAR.resolveWorkerBase === "function") {
    return window.IAQAR.resolveWorkerBase();
  }
  if (window.IAQAR?.workerBase || window.IAQAR?.office?.workerBase) {
    return String(window.IAQAR.workerBase || window.IAQAR.office.workerBase).replace(/\/$/, "");
  }
  try {
    const host = String(window.location?.hostname || "").toLowerCase();
    if (host.includes("--staging") || host.startsWith("staging.") || window.IAQAR?.deploymentEnvironment === "staging") {
      return STAGING_WORKER_BASE;
    }
  } catch (_) { /* ignore */ }
  return PRODUCTION_WORKER_BASE;
}

async function readOfficeCityDefault() {
  const office = currentOffice();
  if (!office?.db || !office.officeId || office.officeId === "platform") return "";
  try {
    const snap = await office.db.collection("publicOffices").doc(office.officeId).get();
    if (snap.exists) return String(snap.data()?.city || "").trim();
  } catch (_) { /* ignore */ }
  return "";
}

async function authHeader() {
  const user = currentUser();
  if (!user?.getIdToken) return {};
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

async function fileChecksum(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function setState(state, detail = "") {
  const status = $("addOpportunityStatus");
  const retry = $("addOpportunityRetry");
  if (!status) return;
  status.dataset.state = state;
  status.classList.toggle("is-error", state === "failed");
  status.classList.toggle("is-done", state === "saved");
  const label = LOCAL_STATE_LABELS[state] || INTAKE_STATE_LABELS[state] || "";
  status.textContent = detail ? `${label}${label ? " — " : ""}${detail}` : label;
  if (retry) retry.hidden = state !== "failed";
}

function hasValidInputFromValues(text, file) {
  return String(text || "").trim().length > 0 || Boolean(file);
}

export {
  hasValidInputFromValues,
  resolveUrlListingText,
  persistIntake,
  uploadSourceFile,
  resolveMediaListingText,
  resolveAudioListingText,
  fileChecksum,
  workerBase,
  authHeader,
  fetchWithTimeout
};

function hasValidInput() {
  const input = $("addOpportunityInput");
  return hasValidInputFromValues(input?.value || "", selectedFile);
}

function syncExecuteButton() {
  const clearBtn = $("addOpportunityInputClear");
  const executeBtn = $("addOpportunitySubmit");
  const valid = hasValidInput();
  if (clearBtn) clearBtn.hidden = !valid;
  if (!executeBtn) return;
  const disabled = executing || !valid;
  executeBtn.disabled = disabled;
  executeBtn.classList.toggle("is-ready", valid && !executing);
  executeBtn.setAttribute("aria-disabled", String(disabled));
}

function setBusy(busy) {
  const executeBtn = $("addOpportunitySubmit");
  const input = $("addOpportunityInput");
  const paperclip = $("addOpportunityPaperclip");
  const clearBtn = $("addOpportunityInputClear");
  if (executeBtn) {
    executeBtn.classList.toggle("is-busy", busy);
    if (busy && executeBtn.dataset.busyLabel) executeBtn.textContent = executeBtn.dataset.busyLabel;
    else if (!busy && executeBtn.dataset.originalText) executeBtn.textContent = executeBtn.dataset.originalText;
  }
  if (input) input.disabled = busy;
  if (paperclip) paperclip.disabled = busy;
  if (clearBtn) clearBtn.disabled = busy;
  syncExecuteButton();
}

let lastFailure = null;
let selectedFile = null;
let executing = false;
let intakeContext = null;
/** Resume path: same execute session with missing-field completion (not a new intake). */
let resumeIntakeSession = null;

function resetForNewIntake() {
  lastFailure = null;
  intakeContext = null;
  resumeIntakeSession = null;
  dismissOpportunityReviewIfOpen();
}

function intakeIdentity(text, file) {
  const fileIdentity = file
    ? `${file.name || ""}|${file.type || ""}|${file.size || 0}|${file.lastModified || 0}`
    : "";
  return `${String(text || "").trim()}|${fileIdentity}`;
}

function selectedFileMatchesIntakeContext(ctx = intakeContext) {
  if (!ctx?.fileName) return !selectedFile;
  if (!selectedFile) return false;
  return String(selectedFile.name || "") === String(ctx.fileName || "")
    && String(selectedFile.type || "") === String(ctx.contentType || selectedFile.type || "");
}

function currentSourceMaterialIdentity(ctx = intakeContext) {
  if (!ctx) return intakeIdentity($("addOpportunityInput")?.value || "", selectedFile);
  const liveText = String($("addOpportunityInput")?.value || "").trim();
  const boundText = String(ctx.inputText || "").trim();
  if (liveText && boundText && liveText !== boundText) {
    return intakeIdentity(liveText, selectedFile);
  }
  const text = boundText || liveText;
  let file = selectedFile;
  if (ctx.fileName) {
    file = selectedFileMatchesIntakeContext(ctx) ? selectedFile : null;
  } else if (boundText && !liveText) {
    file = null;
  }
  return intakeIdentity(text, file);
}

function sourceMaterialChangedSinceIntake(ctx = intakeContext) {
  if (!ctx?.sourceIdentity) return true;
  return currentSourceMaterialIdentity(ctx) !== ctx.sourceIdentity;
}

function logExtractionTrace(event, meta = {}) {
  console.info("[iaqar:intake-extraction]", event, {
    status: meta.status ?? null,
    durationMs: meta.durationMs ?? null,
    sourceType: meta.sourceType ?? null,
    hasMediaPath: Boolean(meta.hasMediaPath),
    hasFields: Boolean(meta.hasFields),
    extractionMode: meta.extractionMode ?? null
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = extractionTimeoutMs) {
  const controller = new AbortController();
  const boundedTimeout = Math.min(Number(timeoutMs) || EXTRACTION_TIMEOUT_MS, EXTRACTION_TIMEOUT_MS);
  const timer = window.setTimeout(() => controller.abort(), boundedTimeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

function countCoreFields(fields = {}) {
  const keys = ["propertyType", "city", "district", "priceOrBudget", "area", "purpose"];
  return keys.filter((key) => {
    const value = fields[key];
    return value !== null && value !== undefined && String(value).trim() !== "";
  }).length;
}

function hasContradictoryCity(fields = {}) {
  const city = String(fields.city || "").trim();
  const district = String(fields.district || "").trim();
  if (city !== "الرياض") return false;
  if (!district) return false;
  return /رانوناء|قباء|السلام|العزيزية|العقيق|الحرة|الهجرة/i.test(district);
}

function canOpenReview(prepared) {
  if (prepared?.manualUrlContinuation) return true;
  if (prepared?.extraction?.extractionMode === "gemini_voice_adapter") return true;
  if (!prepared?.ok) return false;
  if (!prepared.extraction || prepared.extraction.extractionMode === "simulated_fixture") return false;
  const fields = prepared.fields || {};
  const hasRealFields = Object.values(fields).some((value) =>
    value !== null && value !== undefined && String(value).trim() !== ""
  );
  if (!hasRealFields) return false;
  if (hasContradictoryCity(fields)) return false;
  if (countCoreFields(fields) < 2) return false;
  return true;
}

function buildAddOpportunityReviewDefaults(prepared = {}, sourceText = "") {
  const office = currentOffice();
  return buildImportSimplifiedReviewDefaults(
    prepared.fields || {},
    sourceText || "",
    {
      extended: prepared.extraction?.extended,
      needsReview: prepared.extraction?.needsReview
    },
    { city: office?.city || "" }
  );
}

function openAddOpportunityReview(prepared, onApprove, extra = {}) {
  openOpportunityReview({
    fields: prepared.fields || {},
    extended: prepared.extraction?.extended,
    needsReview: prepared.extraction?.needsReview,
    sourceText: extra.sourceText || intakeContext?.listingText || "",
    prepared,
    reviewDefaults: extra.reviewDefaults || buildAddOpportunityReviewDefaults(prepared, extra.sourceText || "")
  }, onApprove, {
    importSimplifiedReview: true,
    title: extra.title || "مراجعة الفرصة",
    subtitle: extra.subtitle || "راجع البيانات المستخرجة قبل الحفظ النهائي.",
    approveLabel: extra.approveLabel || "اعتماد وحفظ",
    ...extra
  });
}

function clearIntakeForm() {
  resetForNewIntake();
  selectedFile = null;
  const input = $("addOpportunityInput");
  if (input) input.value = "";
  const fileInput = $("addOpportunityFile");
  if (fileInput) fileInput.value = "";
  const missing = $("addOpportunityMissing");
  if (missing) missing.hidden = true;
  const retry = $("addOpportunityRetry");
  if (retry) retry.hidden = true;
  syncExecuteButton();
  updateAttachmentHint();
  setState("idle");
}

function clearDraftInput() {
  resetForNewIntake();
  selectedFile = null;
  const input = $("addOpportunityInput");
  if (input) input.value = "";
  const fileInput = $("addOpportunityFile");
  if (fileInput) fileInput.value = "";
  syncExecuteButton();
  updateAttachmentHint();
  setState("idle");
}

function updateAttachmentHint() {
  const hint = $("addOpportunityAttachmentHint");
  if (!hint) return;
  if (selectedFile) {
    hint.textContent = `مرفق: ${selectedFile.name}`;
    hint.hidden = false;
  } else {
    hint.hidden = true;
    hint.textContent = "";
  }
}


async function uploadSourceFile(officeId, sourceId, file) {
  const base = workerBase();
  if (!base) throw new Error("worker_base_missing");
  const headers = {
    ...(await authHeader()),
    "Content-Type": file.type || "application/octet-stream",
    "X-Office-Id": officeId,
    "X-Source-Id": sourceId,
    "X-Source-Type": validateAttachment(file).sourceType || "image",
    "X-File-Name": encodeURIComponent(file.name || "attachment")
  };
  const response = await fetchWithTimeout(`${base.replace(/\/$/, "")}/media/opportunity-source`, {
    method: "POST",
    headers,
    body: file
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.publicMessage || payload.error || "upload_failed");
  }
  return payload;
}

async function persistIntake(result, reviewMeta = {}, options = {}) {
  const office = currentOffice();
  const db = window.firebase?.firestore?.();
  if (!office?.paths || !db) throw new Error("firestore_unavailable");

  const opportunityId = options.opportunityId || result.opportunity.id;
  const sourceRef = db.collection("offices").doc(office.officeId)
    .collection("opportunitySources").doc(result.source.id);
  const opportunityRef = db.collection("offices").doc(office.officeId)
    .collection("opportunities").doc(opportunityId);

  const existing = await opportunityRef.get();
  if (existing.exists && !options.merge) {
    return { duplicate: true, opportunityId, sourceId: result.source.id };
  }

  const opportunityPayload = sanitizeFirestoreWrite(buildOpportunityPersistPayload({
    opportunity: result.opportunity,
    reviewMeta,
    opportunityId,
    existingData: existing.exists ? (existing.data() || {}) : null,
    serverTimestamp: window.firebase.firestore.FieldValue.serverTimestamp()
  }));

  const batch = db.batch();
  // opportunitySources: members may create but only managers may update.
  // After auto-save, approve must not rewrite the source doc.
  if (!existing.exists) {
    batch.set(sourceRef, sanitizeFirestoreWrite({
      ...result.source,
      opportunityId,
      createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
    }));
  }
  batch.set(opportunityRef, opportunityPayload, { merge: Boolean(existing.exists) });
  await batch.commit();
  return { duplicate: false, opportunityId, sourceId: result.source.id };
}

/** Firestore rejects undefined and NaN; strip them before batch writes. */
export function sanitizeFirestoreWrite(value) {
  if (value === undefined || typeof value === "function") return undefined;
  if (value === null) return null;
  if (typeof value === "number" && Number.isNaN(value)) return null;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeFirestoreWrite(item))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    // Keep Firestore FieldValue / Timestamp / Date / GeoPoint intact.
    if (typeof value.isEqual === "function") return value;
    if (typeof value.toDate === "function") return value;
    if (Object.prototype.toString.call(value) === "[object Date]") return value;
    const ctor = value.constructor;
    if (ctor && ctor !== Object && ctor !== Array) return value;
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      const next = sanitizeFirestoreWrite(entry);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  return value;
}

/**
 * Build opportunity write payload that never mutates immutable create-time fields on merge.
 * createdAt/brokerId/originating* must stay equal to the stored resource for Firestore rules.
 */
export function buildOpportunityPersistPayload({
  opportunity = {},
  reviewMeta = {},
  opportunityId = "",
  existingData = null,
  serverTimestamp = null
} = {}) {
  const payload = {
    ...opportunity,
    id: opportunityId || opportunity.id,
    ...reviewMeta,
    updatedAt: serverTimestamp
  };
  if (!existingData) {
    payload.createdAt = serverTimestamp;
    return payload;
  }
  // Merge/approve path: strip or freeze ownership + create-time fields.
  delete payload.createdAt;
  if (existingData.brokerId != null) payload.brokerId = existingData.brokerId;
  if (existingData.officeId != null) payload.officeId = existingData.officeId;
  if (existingData.originatingOfficeId != null) {
    payload.originatingOfficeId = existingData.originatingOfficeId;
  }
  if (existingData.originatingBrokerId != null) {
    payload.originatingBrokerId = existingData.originatingBrokerId;
  }
  if (existingData.currentOwningOfficeId != null) {
    payload.currentOwningOfficeId = existingData.currentOwningOfficeId;
  }
  if (existingData.deduplicationFingerprint != null) {
    payload.deduplicationFingerprint = existingData.deduplicationFingerprint;
  }
  return payload;
}

async function runCanonicalIntakeRequest(payload) {
  const base = workerBase();
  if (!base) throw new Error("worker_base_missing");
  const headers = {
    ...(await authHeader()),
    "Content-Type": "application/json",
    "X-Office-Id": payload.officeId
  };
  const response = await fetchWithTimeout(`${base.replace(/\/$/, "")}/pipeline/canonical-intake`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  }, extractionTimeoutMs);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) {
    const err = new Error(body.error || body.message || "canonical_intake_failed");
    err.code = body.error || "";
    throw err;
  }
  return body;
}

function mapCanonicalResponseToPrepared(body, officeId, brokerId) {
  const fields = normalizeOpportunityFinancials(body.fields || body.extractedFields || {});
  const completeness = computeDataCompleteness(fields);
  const fingerprint = String(body.idempotencyKey || "").replace(/^ci_/, "");
  const sourceType = body.contentType || "text";
  const extraction = {
    extractionMode: "canonical_intake",
    extractionProvider: "iaqar.canonical_intake",
    productionAi: false,
    extractionConfidence: Number(body.confidence || 0),
    fields
  };
  const source = buildSourceRecord({
    officeId,
    brokerId,
    sourceType,
    fingerprint,
    text: body.rawText || "",
    url: body.sourceUrl || "",
    mediaPath: body.mediaPath || ""
  });
  source.id = body.sourceId || source.id;
  const opportunity = buildOpportunityRecord({
    officeId,
    brokerId,
    sourceType,
    sourceReference: source.id,
    fields,
    extraction,
    deduplicationFingerprint: fingerprint,
    existingId: body.opportunityId
  });
  opportunity.id = body.opportunityId || opportunity.id;
  opportunity.rawText = body.rawText || "";
  opportunity.transcript = body.transcript || "";
  opportunity.analysisStatus = body.analysisStatus || "";
  return {
    ok: true,
    state: completeness.isComplete ? "saved" : "missing_information",
    source,
    opportunity,
    fields,
    missingFields: body.missingFields || completeness.missingFields,
    extraction,
    createsOperation: false,
    runsMatching: false,
    productionAi: false,
    canonicalImportJobId: body.importJobId,
    deduplicationFingerprint: fingerprint
  };
}

async function resolveUrlListingText(url, officeId) {
  const base = workerBase();
  if (!base) return { ok: false, error: "worker_base_missing" };
  const headers = {
    ...(await authHeader()),
    "Content-Type": "application/json",
    "X-Office-Id": officeId
  };
  const response = await fetchWithTimeout(`${base}/pipeline/url-resolve`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url, officeId })
  });
  const body = await response.json().catch(() => ({}));
  const canonicalMeta = {
    diagnostics: body.diagnostics || null,
    originalUrl: body.originalUrl || url,
    resolvedUrl: body.resolvedUrl || body.url || url,
    sourceSite: body.sourceSite || "",
    sourceSiteId: body.sourceSiteId || "",
    adapterId: body.adapterId || "",
    externalListingId: body.externalListingId || "",
    brokerFields: body.brokerFields || null,
    structured: body.structured || null,
    fieldSources: body.fieldSources || {},
    extractionStatus: body.extractionStatus || "extracted",
    classificationStatus: body.classificationStatus || "confirmed",
    listingTitle: body.listingTitle || "",
    contentHash: body.contentHash || ""
  };
  const fallbackRequired = canonicalMeta.extractionStatus === "fallback_required"
    || canonicalMeta.classificationStatus === "fallback_required";
  const text = String(body.text || "").trim();
  if (fallbackRequired) {
    return {
      ok: false,
      fallbackRequired: true,
      error: "fallback_required",
      text: "",
      ...canonicalMeta
    };
  }
  if (!response.ok || !body.ok || !text) {
    return {
      ok: false,
      error: body.error || "url_resolve_failed",
      fallbackRequired: Boolean(canonicalMeta.adapterId || canonicalMeta.externalListingId),
      ...canonicalMeta
    };
  }
  return {
    ok: true,
    text,
    ...canonicalMeta
  };
}

async function resolveMediaListingText(mediaPath, officeId, file = null, canonical = null) {
  const base = workerBase();
  if (!base || !mediaPath) return { ok: false, error: "media_path_missing" };
  const headers = {
    ...(await authHeader()),
    "Content-Type": "application/json",
    "X-Office-Id": officeId
  };
  const response = await fetchWithTimeout(`${base}/pipeline/media-extract`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      officeId,
      mediaPath,
      fileName: file?.name || "",
      contentType: file?.type || "",
      originalUrl: canonical?.originalUrl || "",
      resolvedUrl: canonical?.resolvedUrl || "",
      sourceSiteId: canonical?.sourceSiteId || canonical?.adapterId || "",
      externalListingId: canonical?.externalListingId || ""
    })
  }, extractionTimeoutMs);
  const body = await response.json().catch(() => ({}));
  const text = String(body.text || "").trim();
  const hasStructured = body.brokerFields && typeof body.brokerFields === "object"
    && Object.keys(body.brokerFields).length > 0;
  if (!response.ok || !body.ok || (!text && !hasStructured)) {
    return {
      ok: false,
      error: body.error || "media_extract_failed",
      publicMessage: body.publicMessage || "",
      geminiError: body.geminiError || "",
      workersError: body.workersError || ""
    };
  }
  return {
    ok: true,
    text,
    brokerFields: body.brokerFields || null,
    fieldSources: body.fieldSources || {},
    analyzerProvider: body.analyzerProvider || "",
    extractionMode: body.extractionMode || "",
    extractionStatus: body.extractionStatus || "extracted",
    confidence: Number(body.confidence || 0),
    productionAi: Boolean(body.productionAi),
    screenshotExtraction: body.screenshotExtraction || null,
    mediaPath: body.mediaPath || mediaPath
  };
}

async function resolveAudioListingText(mediaPath, officeId, file = null) {
  const base = workerBase();
  if (!base || !mediaPath) return { ok: false, error: "media_path_missing" };
  const headers = {
    ...(await authHeader()),
    "Content-Type": "application/json",
    "X-Office-Id": officeId
  };
  const response = await fetchWithTimeout(`${base}/pipeline/audio-extract`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      officeId,
      mediaPath,
      fileName: file?.name || "",
      contentType: file?.type || ""
    })
  }, extractionTimeoutMs);
  const body = await response.json().catch(() => ({}));
  const text = String(body.transcript || body.text || "").trim();
  const hasStructured = body.brokerFields && typeof body.brokerFields === "object"
    && Object.keys(body.brokerFields).length > 0;
  if (!response.ok || !body.ok || (!text && !hasStructured)) {
    return {
      ok: false,
      error: body.error || "audio_extract_failed",
      publicMessage: body.publicMessage || "",
      geminiError: body.geminiError || "",
      workersError: body.workersError || ""
    };
  }
  return {
    ok: true,
    text,
    transcript: text,
    brokerFields: body.brokerFields || null,
    fieldSources: body.fieldSources || {},
    analyzerProvider: body.analyzerProvider || "",
    extractionMode: body.extractionMode || "",
    extractionStatus: body.extractionStatus || "extracted",
    confidence: Number(body.confidence || 0),
    productionAi: Boolean(body.productionAi),
    mediaPath: body.mediaPath || mediaPath
  };
}

async function runExtractionPipeline() {
  const office = currentOffice();
  const user = currentUser();
  if (!office?.officeId) throw new Error("office_missing");
  if (!user?.uid) throw new Error("auth_required");

  const input = $("addOpportunityInput");
  const inputText = (input?.value || "").trim();
  const sourceIdentity = intakeIdentity(inputText, selectedFile);
  const isUrl = detectSourceTypeFromText(inputText) === "url";
  const normalizedInputUrl = isUrl ? normalizeUrl(inputText) : "";
  let listingText = inputText;
  let urlDiagnostics = null;
  let mediaExtractionMode = "";
  let manualUrlMeta = null;

  if (isUrl) {
    // Canonical intake resolves sourceUrl on the Worker; avoid duplicate client fetch.
    listingText = "";
  }

  let fileChecksumValue = "";
  let mediaPath = "";
  let sourceType = "";
  if (selectedFile) {
    const validated = validateAttachment(selectedFile);
    if (!validated.ok) throw new Error("attachment_invalid");
    sourceType = validated.sourceType;
    setState("uploading");
    fileChecksumValue = await fileChecksum(selectedFile);
    const provisional = `src_${fileChecksumValue.slice(0, 40)}`;
    const uploaded = await uploadSourceFile(office.officeId, provisional, selectedFile);
    mediaPath = uploaded.mediaPath || "";

    if (!listingText && (sourceType === "image" || sourceType === "screenshot")) {
      setState("analyzing");
      const mediaResolved = await resolveMediaListingText(mediaPath, office.officeId, selectedFile);
      if (!mediaResolved.ok) throw new Error("extraction_failed");
      listingText = mediaResolved.text;
      mediaExtractionMode = mediaResolved.extractionMode || "workers_ai_vision_adapter";
    }
  }

  const useTextParser = Boolean(String(listingText || "").trim());
  setState("analyzing");

  const canonicalContentType = isUrl
    ? "sourceUrl"
    : (sourceType ? mapSourceTypeToCanonicalContentType(sourceType) : "text");
  if (canonicalContentType) {
    try {
      const canonical = await runCanonicalIntakeRequest({
        officeId: office.officeId,
        brokerId: user.uid,
        contentType: canonicalContentType,
        text: listingText || inputText,
        sourceUrl: isUrl ? normalizedInputUrl : undefined,
        mediaPath,
        fileChecksum: fileChecksumValue,
        fileName: selectedFile?.name || "",
        mimeType: selectedFile?.type || "",
        byteSize: selectedFile?.size || 0,
        idempotencyKey: sourceIdentity
      });
      if (canonical.analysisStatus === "analysis_complete" || canonical.fields) {
        const prepared = mapCanonicalResponseToPrepared(canonical, office.officeId, user.uid);
        if (manualUrlMeta?.manualUrlContinuation) {
          prepared.manualUrlContinuation = true;
          prepared.urlBlockedMessage = manualUrlMeta.urlBlockedMessage || "";
          prepared.urlBlockedReason = manualUrlMeta.urlBlockedReason || "";
        }
        intakeContext = {
          ...(manualUrlMeta || {}),
          inputText,
          listingText,
          sourceUrl: isUrl ? normalizedInputUrl : "",
          sourceType: prepared.source?.sourceType || canonicalContentType,
          urlDiagnostics,
          fileChecksumValue,
          mediaPath,
          fileName: selectedFile?.name || "",
          contentType: selectedFile?.type || "",
          sourceIdentity,
          canonicalImportJobId: canonical.importJobId
        };
        return prepared;
      }
    } catch (error) {
      console.warn("[iaqar] canonical intake fallback", error?.message || error);
    }
  }

  if (isUrl && !listingText) {
    setState("analyzing");
    const resolved = await resolveUrlListingText(normalizedInputUrl, office.officeId);
    if (!resolved.ok) {
      const hardFailErrors = new Set(["authentication_required", "office_required", "forbidden"]);
      const errorCode = String(resolved.error || "url_resolve_failed");
      if (!hardFailErrors.has(errorCode)) {
        urlDiagnostics = resolved.diagnostics || null;
        manualUrlMeta = {
          manualUrlContinuation: true,
          urlBlockedReason: errorCode,
          urlBlockedMessage: errorCode === "source_blocked"
            && /aqar\.fm|sa\.aqar/i.test(String(normalizedInputUrl || inputText || ""))
            ? "منصة عقار تمنع الجلب التلقائي من الخادم. يمكنك إكمال البيانات يدويًا."
            : "تعذر جلب الإعلان تلقائيًا. يمكنك إكمال البيانات يدويًا."
        };
      } else {
        const err = new Error("url_extraction_failed");
        err.diagnostics = resolved.diagnostics;
        throw err;
      }
    } else {
      listingText = resolved.text;
      urlDiagnostics = resolved.diagnostics;
    }
  }

  const prepared = await prepareOpportunityIntake({
    officeId: office.officeId,
    brokerId: user.uid,
    text: listingText,
    listingText: isUrl || useTextParser ? listingText : undefined,
    url: isUrl ? normalizedInputUrl : undefined,
    sourceType: useTextParser ? "text" : undefined,
    file: useTextParser ? undefined : (selectedFile || undefined),
    fileChecksum: fileChecksumValue,
    mediaPath,
    fileName: selectedFile?.name || "",
    contentType: selectedFile?.type || "",
    byteSize: selectedFile?.size || 0,
    allowIncomplete: true,
    allowUrlWithoutListing: Boolean(manualUrlMeta?.manualUrlContinuation)
  }, createExtractionAdapter());

  if (!prepared.ok) {
    throw new Error(prepared.error || "prepare_failed");
  }

  if (manualUrlMeta?.manualUrlContinuation) {
    prepared.manualUrlContinuation = true;
    prepared.urlBlockedMessage = manualUrlMeta.urlBlockedMessage || "";
    prepared.urlBlockedReason = manualUrlMeta.urlBlockedReason || "";
  }

  if (mediaPath) prepared.source.mediaPath = mediaPath;
  if (sourceType && !useTextParser) prepared.source.sourceType = sourceType;
  if (fileChecksumValue && selectedFile) {
    prepared.source.byteSize = selectedFile.size || prepared.source.byteSize;
  }
  if (mediaExtractionMode && prepared.extraction) {
    prepared.extraction.extractionMode = mediaExtractionMode;
    prepared.extraction.productionAi = false;
  }

  intakeContext = {
    ...(manualUrlMeta || {}),
    inputText,
    listingText,
    sourceUrl: isUrl ? normalizedInputUrl : "",
    sourceType: prepared.source?.sourceType || sourceType || (useTextParser ? "text" : ""),
    urlDiagnostics,
    fileChecksumValue,
    mediaPath,
    fileName: selectedFile?.name || "",
    contentType: selectedFile?.type || "",
    sourceIdentity
  };

  return prepared;
}

async function requestOpportunityExtraction() {
  const started = performance.now();
  let traceMeta = {
    status: "failed",
    durationMs: 0,
    sourceType: null,
    hasMediaPath: false,
    hasFields: false,
    extractionMode: null
  };
  try {
    const prepared = await runExtractionPipeline();
    traceMeta = {
      status: "ok",
      durationMs: Math.round(performance.now() - started),
      sourceType: intakeContext?.sourceType || prepared.source?.sourceType || null,
      hasMediaPath: Boolean(intakeContext?.mediaPath),
      hasFields: countCoreFields(prepared.fields) >= 2,
      extractionMode: prepared.extraction?.extractionMode || null
    };
    logExtractionTrace("complete", traceMeta);
    return prepared;
  } catch (error) {
    traceMeta.durationMs = Math.round(performance.now() - started);
    if (error?.name === "AbortError") {
      traceMeta.status = "timeout";
      const timeoutError = new Error("extraction_timeout");
      timeoutError.cause = error;
      logExtractionTrace("complete", traceMeta);
      throw timeoutError;
    }
    traceMeta.status = "failed";
    logExtractionTrace("complete", traceMeta);
    throw error;
  }
}

async function startExecute() {
  if (executing) return;
  const office = currentOffice();
  const user = currentUser();
  if (!office?.officeId) {
    setState("failed", "تعذر تحديد المكتب");
    return;
  }
  if (!user?.uid) {
    setState("failed", "يلزم تسجيل الدخول");
    return;
  }

  const input = $("addOpportunityInput");
  const text = (input?.value || "").trim();
  if (!text && !selectedFile) {
    setState("failed", "أدخل رابطًا أو نصًا أو أرفق ملفًا");
    lastFailure = { text, file: selectedFile };
    return;
  }

  executing = true;
  setBusy(true);
  resetForNewIntake();

  try {
    const prepared = await requestOpportunityExtraction();
    if (!prepared.fields?.city) {
      const defaultCity = await readOfficeCityDefault();
      if (defaultCity) prepared.fields.city = defaultCity;
    }
    if (!canOpenReview(prepared)) {
      const inputText = ($("addOpportunityInput")?.value || "").trim();
      const isUrlIntake = detectSourceTypeFromText(inputText) === "url"
        || Boolean(intakeContext?.sourceUrl)
        || prepared?.source?.sourceType === "url"
        || Boolean(prepared?.manualUrlContinuation);
      if (isUrlIntake) {
        // Haraj/AQAR/etc. may return shell HTML with no usable listing fields.
        prepared.manualUrlContinuation = true;
        prepared.urlBlockedReason = prepared.urlBlockedReason || "listing_text_insufficient";
        prepared.urlBlockedMessage = prepared.urlBlockedMessage
          || "تعذر جلب الإعلان تلقائيًا. يمكنك إكمال البيانات يدويًا.";
      } else {
        throw new Error("extraction_failed");
      }
    }
    const draftSaved = await persistIntake(prepared, {
      autoSavedAt: new Date().toISOString(),
      urlBlockedReason: prepared.urlBlockedReason || ""
    }, { merge: true }).catch((error) => {
      console.warn("[iaqar] auto-save draft", error);
      return {
        opportunityId: prepared.opportunity.id,
        sourceId: prepared.source.id,
        duplicate: false,
        draftSaveSkipped: true
      };
    });
    resumeIntakeSession = {
      opportunityId: draftSaved.opportunityId,
      preparedFingerprint: prepared.deduplicationFingerprint || prepared.source?.deduplicationFingerprint
    };
    setState("ready");
    if (prepared.urlBlockedMessage) {
      setState("missing_information", prepared.urlBlockedMessage);
    }
    openAddOpportunityReview(prepared, approveFromReview);
  } catch (error) {
    console.warn("add-opportunity execute failed", error);
    if (error?.message === "extraction_timeout") {
      setState("failed", "تعذر إكمال تحليل الإعلان. حاول مرة أخرى.");
    } else if (error?.message === "url_extraction_failed") {
      setState("failed", "تعذر استخراج بيانات الإعلان من الرابط");
    } else if (error?.message === "extraction_failed") {
      setState("failed", "تعذر استخراج بيانات الإعلان");
    } else {
      setState("failed", error?.message === "upload_failed" ? "فشل رفع الملف" : "");
    }
    resetForNewIntake();
    lastFailure = { text, file: selectedFile };
  } finally {
    executing = false;
    setBusy(false);
  }
}

async function startVoiceIntake(structured) {
  if (executing) return;
  const office = currentOffice();
  const user = currentUser();
  if (!office?.officeId) {
    setState("failed", "تعذر تحديد المكتب");
    return;
  }
  if (!user?.uid) {
    setState("failed", "يلزم تسجيل الدخول");
    return;
  }

  executing = true;
  setBusy(true);
  resetForNewIntake();
  setState("analyzing");

  try {
    const summary = buildVoiceSummaryText(structured);
    const brokerFields = mapGeminiToOpportunityFields(structured, { context: "office" });
    const prepared = await prepareOpportunityIntake({
      officeId: office.officeId,
      brokerId: user.uid,
      text: summary,
      sourceType: "text",
      brokerFields,
      allowIncomplete: true
    }, createVoiceExtractionAdapter(structured, { context: "office" }));

    if (!prepared.ok) throw new Error(prepared.error || "prepare_failed");
    if (!canOpenReview(prepared)) throw new Error("extraction_failed");

    intakeContext = {
      sourceIdentity: intakeIdentity(summary, null),
      inputText: summary,
      listingText: summary,
      sourceType: "text",
      voiceStructured: structured
    };

    const draftSaved = await persistIntake(prepared, {
      autoSavedAt: new Date().toISOString(),
      voiceIntake: true
    }, { merge: true }).catch((error) => {
      console.warn("[iaqar] voice auto-save draft", error);
      return {
        opportunityId: prepared.opportunity.id,
        sourceId: prepared.source.id,
        duplicate: false,
        draftSaveSkipped: true
      };
    });
    resumeIntakeSession = {
      opportunityId: draftSaved.opportunityId,
      preparedFingerprint: prepared.deduplicationFingerprint || prepared.source?.deduplicationFingerprint
    };

    setState("ready");
    openAddOpportunityReview(prepared, approveFromReview, {
      sourceText: summary,
      reviewDefaults: buildImportSimplifiedReviewDefaults(
        { ...prepared.fields, ...mapGeminiToOpportunityFields(structured, { context: "office" }) },
        summary,
        {
          extended: prepared.extraction?.extended,
          needsReview: prepared.extraction?.needsReview || structured.needsReview
        },
        { city: currentOffice()?.city || "" }
      )
    });
  } catch (error) {
    console.warn("[iaqar] voice intake failed", error);
    setState("failed", "تعذر تحليل التسجيل. يمكنك إكمال البيانات يدويًا.");
  } finally {
    executing = false;
    setBusy(false);
  }
}

async function approveFromReview(brokerExtras, review, advertiser = {}) {
  if (executing) throw new Error("save_in_progress");
  executing = true;
  setBusy(true);

  try {
    const office = currentOffice();
    const user = currentUser();
    if (!office?.officeId || !user?.uid) throw new Error("auth_required");
    if (!intakeContext) throw new Error("context_missing");
    if (sourceMaterialChangedSinceIntake()) throw new Error("context_changed");

    const brokerFields = {
      opportunityKind: brokerExtras.opportunityKind,
      purpose: brokerExtras.purpose,
      propertyType: brokerExtras.propertyType,
      city: brokerExtras.city,
      district: brokerExtras.district,
      priceOrBudget: brokerExtras.priceOrBudget,
      salePrice: brokerExtras.salePrice,
      budget: brokerExtras.budget,
      area: brokerExtras.area,
      rooms: brokerExtras.rooms,
      bathrooms: brokerExtras.bathrooms,
      floorNumber: brokerExtras.floorNumber,
      annualRent: brokerExtras.annualRent,
      monthlyRent: brokerExtras.monthlyRent,
      paymentInstallments: brokerExtras.paymentInstallments,
      optionalMonthlyRentAfterSixMonths: brokerExtras.optionalMonthlyRentAfterSixMonths
    };

    const prepared = await prepareOpportunityIntake({
      officeId: office.officeId,
      brokerId: user.uid,
      text: intakeContext.listingText || intakeContext.inputText,
      listingText: intakeContext.listingText,
      url: intakeContext.sourceUrl || undefined,
      sourceType: intakeContext.sourceType || undefined,
      fileChecksum: intakeContext.fileChecksumValue,
      mediaPath: intakeContext.mediaPath,
      fileName: intakeContext.fileName,
      contentType: intakeContext.contentType,
      brokerFields,
      allowIncomplete: true
    }, createExtractionAdapter());

    if (!prepared.ok) throw new Error(prepared.error || "prepare_failed");
    if (intakeContext.mediaPath) prepared.source.mediaPath = intakeContext.mediaPath;

    const reviewMeta = {
      reviewOperationTypeId: brokerExtras.reviewOperationTypeId || "",
      reviewPropertyTypeId: brokerExtras.reviewPropertyTypeId || "",
      reviewCityId: brokerExtras.reviewCityId || "",
      reviewDistrictId: brokerExtras.reviewDistrictId || "",
      extractedSnapshot: brokerExtras.extractedSnapshot || null,
      ...mergeAdvertiserFieldsIntoOpportunity({}, advertiser)
    };

    const saved = await persistIntake(prepared, reviewMeta, {
      merge: true,
      opportunityId: resumeIntakeSession?.opportunityId || prepared.opportunity.id
    });
    if (window.IAQAR && typeof window.IAQAR.pushSavedOpportunityToWorkspace === "function") {
      window.IAQAR.pushSavedOpportunityToWorkspace({
        opportunityId: saved.opportunityId,
        duplicate: false,
        matchCount: 0,
        advertiserPhone: reviewMeta.advertiserPhoneNormalized || "",
        propertyType: brokerExtras.propertyType || "",
        district: brokerExtras.district || "",
        marketingConsentStatus: reviewMeta.marketingConsentStatus || ""
      });
    }
    setState("saved", "");
    toast("تم تحديث الفرصة في العروض والطلبات");
    clearIntakeForm();

    // Rematch/ops must not block the review approve UI (can hang on slow Worker).
    void (async () => {
      let matching = { ok: false, matchCount: 0, skipped: true };
      let missingDataSync = { ok: false, created: false };
      const readyForMatching = isEligibleForMatchingRun({ ...prepared.opportunity, ...reviewMeta });
      if (readyForMatching && shouldRematchAfterOpportunityWrite({ duplicate: false })) {
        try {
          const token = await user.getIdToken();
          matching = await requestOpportunityRematch({
            workerBase: workerBase(),
            idToken: token,
            officeId: office.officeId,
            opportunityId: saved.opportunityId,
            notify: true
          });
          missingDataSync = await requestMissingDataOperationSync({
            workerBase: workerBase(),
            idToken: token,
            officeId: office.officeId,
            opportunityId: saved.opportunityId
          });
        } catch (error) {
          console.warn("[iaqar] rematch/ops after intake", error);
          matching = { ok: false, error: "rematch_failed", matchCount: 0 };
        }
      }
      window.dispatchEvent(new CustomEvent("iaqar:opportunity-ingested", {
        detail: {
          opportunityId: saved.opportunityId,
          duplicate: saved.duplicate,
          createsOperation: Boolean(matching.createsOperation || missingDataSync.created),
          runsMatching: matching.ok === true,
          matchCount: Number(matching.matchCount || 0),
          productionAi: false,
          ...phase4BoundaryGuarantees(),
          ...phase5BoundaryGuarantees()
        }
      }));
      if (window.IAQAR && typeof window.IAQAR.pushSavedOpportunityToWorkspace === "function") {
        window.IAQAR.pushSavedOpportunityToWorkspace({
          opportunityId: saved.opportunityId,
          duplicate: saved.duplicate,
          matchCount: Number(matching.matchCount || 0)
        });
      }
    })();
  } finally {
    executing = false;
    setBusy(false);
  }
}

function onPaperclip() {
  $("addOpportunityFile")?.click();
}

function onFileChosen(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  const validated = validateAttachment(file);
  if (!validated.ok) {
    setState("failed", validated.error);
    selectedFile = null;
    syncExecuteButton();
    return;
  }
  resetForNewIntake();
  selectedFile = file;
  syncExecuteButton();
  updateAttachmentHint();
  setState("idle");
}

function boot() {
  const form = $("addOpportunityForm");
  if (!form || form.dataset.bound === "1") return;
  form.dataset.bound = "1";

  const fileInput = $("addOpportunityFile");
  if (fileInput) fileInput.setAttribute("accept", ATTACHMENT_ACCEPT);

  const executeBtn = $("addOpportunitySubmit");
  if (executeBtn) {
    executeBtn.dataset.originalText = executeBtn.textContent;
    executeBtn.dataset.busyLabel = "جارٍ التنفيذ…";
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void startExecute();
  });

  executeBtn?.addEventListener("click", () => void startExecute());
  $("addOpportunityPaperclip")?.addEventListener("click", onPaperclip);
  $("addOpportunityInputClear")?.addEventListener("click", () => clearDraftInput());
  $("addOpportunityInput")?.addEventListener("input", () => {
    if (intakeContext || resumeIntakeSession || lastFailure) resetForNewIntake();
    syncExecuteButton();
  });
  $("addOpportunityInput")?.addEventListener("change", () => syncExecuteButton());
  fileInput?.addEventListener("change", onFileChosen);
  $("addOpportunityRetry")?.addEventListener("click", () => void startExecute());
  syncExecuteButton();

  const voiceRoot = $("addOpportunityVoicePanel");
  if (voiceRoot) {
    mountVoiceIntakePanel(voiceRoot, {
      context: "office",
      startLabel: "إضافة فرصة بالصوت",
      recordingLabel: "جاري الاستماع…",
      analyzingLabel: "جارٍ استخراج البيانات…",
      completedLabel: "تم استخراج البيانات — راجعها قبل الحفظ",
      failureLabel: "تعذر فهم التسجيل — حاول مرة أخرى",
      getOfficeId: () => currentOffice()?.officeId || "",
      workerBase: workerBase(),
      getAuthToken: async () => {
        const user = currentUser();
        return user?.getIdToken ? user.getIdToken() : "";
      },
      onStructured: (structured) => void startVoiceIntake(structured),
      onManualContinue: () => setState("idle")
    });
  }

  const composerVoice = $("addOpportunityComposerVoice");
  if (composerVoice && composerVoice.dataset.bound !== "1") {
    composerVoice.dataset.bound = "1";
    mountVoiceIntakePanel(composerVoice, {
      context: "office",
      startLabel: "تسجيل صوتي",
      recordingLabel: "جاري الاستماع…",
      analyzingLabel: "جارٍ استخراج البيانات…",
      completedLabel: "تم استخراج البيانات — راجعها قبل الحفظ",
      failureLabel: "تعذر فهم التسجيل — حاول مرة أخرى",
      getOfficeId: () => currentOffice()?.officeId || "",
      workerBase: workerBase(),
      getAuthToken: async () => {
        const user = currentUser();
        return user?.getIdToken ? user.getIdToken() : "";
      },
      onStructured: (structured) => void startVoiceIntake(structured),
      onManualContinue: () => setState("idle")
    });
  }
  $("addOpportunityMic")?.addEventListener("click", () => {
    const panel = $("addOpportunityComposerVoice");
    if (panel) panel.hidden = false;
    panel?.querySelector("[data-voice-start]")?.click();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}

export const __test = {
  startExecute,
  startVoiceIntake,
  approveFromReview,
  hasValidInputFromValues,
  hasValidInput,
  syncExecuteButton,
  canOpenReview,
  countCoreFields,
  fetchWithTimeout,
  intakeIdentity,
  currentSourceMaterialIdentity,
  sourceMaterialChangedSinceIntake,
  selectedFileMatchesIntakeContext,
  requestOpportunityExtraction,
  resetForNewIntake,
  buildOpportunityPersistPayload,
  sanitizeFirestoreWrite,
  setExtractionTimeoutMs(value) {
    extractionTimeoutMs = Number(value) > 0
      ? Math.min(Number(value), EXTRACTION_TIMEOUT_MS)
      : EXTRACTION_TIMEOUT_MS;
  },
  setSelectedFile(file) {
    resetForNewIntake();
    selectedFile = file;
  },
  getSelectedFile() { return selectedFile; },
  getIntakeContext() { return intakeContext; },
  setIntakeContextForTest(ctx) { intakeContext = ctx; },
  getLastFailure() { return lastFailure; }
};
