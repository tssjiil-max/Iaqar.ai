/**
 * Phase 2 — Add Opportunity: تنفيذ → مراجعة → اعتماد وحفظ (مرة واحدة).
 */

import {
  ATTACHMENT_ACCEPT,
  INTAKE_STATE_LABELS,
  createExtractionAdapter,
  detectSourceTypeFromText,
  prepareOpportunityIntake,
  validateAttachment
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
import { mergeAdvertiserFieldsIntoOpportunity } from "./advertiser-phone-domain.js";

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

export { hasValidInputFromValues };

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

async function resolveMediaListingText(mediaPath, officeId) {
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
    body: JSON.stringify({ officeId, mediaPath })
  }, extractionTimeoutMs);
  const body = await response.json().catch(() => ({}));
  const text = String(body.text || "").trim();
  if (!response.ok || !body.ok || !text) {
    return { ok: false, error: body.error || "media_extract_failed" };
  }
  return { ok: true, text, extractionMode: body.extractionMode || "" };
}

async function persistIntake(result, reviewMeta = {}) {
  const office = currentOffice();
  const db = window.firebase?.firestore?.();
  if (!office?.paths || !db) throw new Error("firestore_unavailable");

  const sourceRef = db.collection("offices").doc(office.officeId)
    .collection("opportunitySources").doc(result.source.id);
  const opportunityRef = db.collection("offices").doc(office.officeId)
    .collection("opportunities").doc(result.opportunity.id);

  const existing = await opportunityRef.get();
  if (existing.exists) {
    return { duplicate: true, opportunityId: result.opportunity.id, sourceId: result.source.id };
  }

  const opportunityPayload = {
    ...result.opportunity,
    ...reviewMeta,
    createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
  };

  const batch = db.batch();
  batch.set(sourceRef, {
    ...result.source,
    createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
  });
  batch.set(opportunityRef, opportunityPayload);
  await batch.commit();
  return { duplicate: false, opportunityId: result.opportunity.id, sourceId: result.source.id };
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
  const text = String(body.text || "").trim();
  if (!response.ok || !body.ok || !text) {
    return {
      ok: false,
      error: body.error || "url_resolve_failed",
      diagnostics: body.diagnostics || null
    };
  }
  return { ok: true, text, diagnostics: body.diagnostics || null };
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
  let listingText = inputText;
  let urlDiagnostics = null;
  let mediaExtractionMode = "";

  if (isUrl) {
    setState("analyzing");
    const resolved = await resolveUrlListingText(inputText, office.officeId);
    if (!resolved.ok) {
      const err = new Error("url_extraction_failed");
      err.diagnostics = resolved.diagnostics;
      throw err;
    }
    listingText = resolved.text;
    urlDiagnostics = resolved.diagnostics;
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
      const mediaResolved = await resolveMediaListingText(mediaPath, office.officeId);
      if (!mediaResolved.ok) throw new Error("extraction_failed");
      listingText = mediaResolved.text;
      mediaExtractionMode = mediaResolved.extractionMode || "workers_ai_vision_adapter";
    }
  }

  const useTextParser = Boolean(String(listingText || "").trim());
  setState("analyzing");
  const prepared = await prepareOpportunityIntake({
    officeId: office.officeId,
    brokerId: user.uid,
    text: listingText,
    listingText: isUrl || useTextParser ? listingText : undefined,
    url: isUrl ? inputText : undefined,
    sourceType: useTextParser ? "text" : undefined,
    file: useTextParser ? undefined : (selectedFile || undefined),
    fileChecksum: fileChecksumValue,
    mediaPath,
    fileName: selectedFile?.name || "",
    contentType: selectedFile?.type || "",
    byteSize: selectedFile?.size || 0,
    allowIncomplete: true
  }, createExtractionAdapter());

  if (!prepared.ok) {
    throw new Error(prepared.error || "prepare_failed");
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
    inputText,
    listingText,
    sourceUrl: isUrl ? inputText : "",
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
    if (!canOpenReview(prepared)) {
      throw new Error("extraction_failed");
    }
    setState("ready");
    resumeIntakeSession = {
      preparedFingerprint: prepared.deduplicationFingerprint || prepared.source?.deduplicationFingerprint
    };
    openOpportunityReview({
      fields: prepared.fields || {},
      extended: prepared.extraction?.extended,
      needsReview: prepared.extraction?.needsReview,
      sourceText: intakeContext?.listingText || "",
      prepared
    }, approveFromReview);
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

async function approveFromReview(brokerExtras, review, advertiser = {}) {
  if (executing) return;
  executing = true;
  setBusy(true);

  try {
    const office = currentOffice();
    const user = currentUser();
    if (!office?.officeId || !user?.uid) throw new Error("auth_required");
    if (!intakeContext) throw new Error("context_missing");
    const currentIdentity = intakeIdentity($("addOpportunityInput")?.value || "", selectedFile);
    if (currentIdentity !== intakeContext.sourceIdentity) throw new Error("context_changed");

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

    const saved = await persistIntake(prepared, reviewMeta);
    if (window.IAQAR && typeof window.IAQAR.pushSavedOpportunityToWorkspace === "function") {
      window.IAQAR.pushSavedOpportunityToWorkspace({
        opportunityId: saved.opportunityId,
        duplicate: saved.duplicate,
        matchCount: 0,
        advertiserPhone: reviewMeta.advertiserPhoneNormalized || "",
        propertyType: brokerExtras.propertyType || "",
        district: brokerExtras.district || "",
        marketingConsentStatus: reviewMeta.marketingConsentStatus || ""
      });
    }
    setState("saved", saved.duplicate ? "هذه الفرصة محفوظة مسبقًا" : "");
    toast(saved.duplicate ? "الفرصة مكررة — لم يُنشأ سجل جديد" : "تم حفظ الفرصة");
    clearIntakeForm();

    let matching = { ok: false, matchCount: 0, skipped: true };
    let missingDataSync = { ok: false, created: false };
    if (shouldRematchAfterOpportunityWrite({ duplicate: saved.duplicate })) {
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
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}

export const __test = {
  startExecute,
  approveFromReview,
  hasValidInputFromValues,
  hasValidInput,
  syncExecuteButton,
  canOpenReview,
  countCoreFields,
  fetchWithTimeout,
  intakeIdentity,
  requestOpportunityExtraction,
  resetForNewIntake,
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
  getLastFailure() { return lastFailure; }
};
