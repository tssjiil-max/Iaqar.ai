/**
 * Phase 2 — Add Opportunity: تنفيذ → مراجعة → اعتماد وحفظ (مرة واحدة).
 */

import {
  ATTACHMENT_ACCEPT,
  INTAKE_STATE_LABELS,
  createExtractionAdapter,
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
import { openOpportunityReview } from "./opportunity-review.js";

const LOCAL_STATE_LABELS = Object.freeze({
  reviewing: "جارٍ التحليل…",
  ready: "راجع البيانات ثم اعتماد وحفظ"
});

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

function setBusy(busy) {
  const executeBtn = $("addOpportunitySubmit");
  const input = $("addOpportunityInput");
  const paperclip = $("addOpportunityPaperclip");
  const clearBtn = $("addOpportunityInputClear");
  if (executeBtn) {
    executeBtn.disabled = busy;
    if (busy && executeBtn.dataset.busyLabel) executeBtn.textContent = executeBtn.dataset.busyLabel;
    else if (!busy && executeBtn.dataset.originalText) executeBtn.textContent = executeBtn.dataset.originalText;
  }
  if (input) input.disabled = busy;
  if (paperclip) paperclip.disabled = busy;
  if (clearBtn) clearBtn.disabled = busy;
}

let lastFailure = null;
let selectedFile = null;
let executing = false;
let intakeContext = null;

function clearIntakeForm() {
  lastFailure = null;
  selectedFile = null;
  intakeContext = null;
  const input = $("addOpportunityInput");
  if (input) input.value = "";
  const fileInput = $("addOpportunityFile");
  if (fileInput) fileInput.value = "";
  const missing = $("addOpportunityMissing");
  if (missing) missing.hidden = true;
  const retry = $("addOpportunityRetry");
  if (retry) retry.hidden = true;
  const reviewOverlay = $("opportunityReviewOverlay");
  if (reviewOverlay && !reviewOverlay.hidden) {
    reviewOverlay.hidden = true;
    document.body.style.overflow = "";
    window.dispatchEvent(new CustomEvent("iaqar:opportunity-review-closed"));
  }
  updateClearButtonVisibility();
  setState("idle");
}

function updateClearButtonVisibility() {
  const clearBtn = $("addOpportunityInputClear");
  const input = $("addOpportunityInput");
  const executeBtn = $("addOpportunitySubmit");
  if (!clearBtn) return;
  const hasContent = Boolean((input?.value || "").trim() || selectedFile);
  clearBtn.hidden = !hasContent;
  if (executeBtn && !executing) executeBtn.disabled = !hasContent;
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
  const response = await fetch(`${base.replace(/\/$/, "")}/media/opportunity-source`, {
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

async function runExtractionPipeline() {
  const office = currentOffice();
  const user = currentUser();
  if (!office?.officeId) throw new Error("office_missing");
  if (!user?.uid) throw new Error("auth_required");

  const input = $("addOpportunityInput");
  const text = (input?.value || "").trim();

  let fileChecksumValue = "";
  let mediaPath = "";
  if (selectedFile) {
    setState("uploading");
    fileChecksumValue = await fileChecksum(selectedFile);
    const provisional = `src_${fileChecksumValue.slice(0, 40)}`;
    const uploaded = await uploadSourceFile(office.officeId, provisional, selectedFile);
    mediaPath = uploaded.mediaPath || "";
  }

  setState("analyzing");
  const prepared = await prepareOpportunityIntake({
    officeId: office.officeId,
    brokerId: user.uid,
    text,
    file: selectedFile || undefined,
    fileChecksum: fileChecksumValue,
    mediaPath,
    allowIncomplete: true
  }, createExtractionAdapter());

  if (!prepared.ok) {
    throw new Error(prepared.error || "prepare_failed");
  }

  if (mediaPath) prepared.source.mediaPath = mediaPath;
  if (fileChecksumValue && selectedFile) {
    prepared.source.byteSize = selectedFile.size || prepared.source.byteSize;
  }

  intakeContext = {
    text,
    fileChecksumValue,
    mediaPath,
    fileName: selectedFile?.name || "",
    contentType: selectedFile?.type || ""
  };

  return prepared;
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
  lastFailure = null;

  try {
    const prepared = await runExtractionPipeline();
    setState("reviewing");
    openOpportunityReview({
      fields: prepared.fields || {},
      sourceText: text,
      prepared
    }, approveFromReview);
  } catch (error) {
    console.warn("add-opportunity execute failed", error);
    setState("failed", error?.message === "upload_failed" ? "فشل رفع الملف" : "");
    lastFailure = { text, file: selectedFile };
  } finally {
    executing = false;
    setBusy(false);
  }
}

async function approveFromReview(brokerExtras) {
  if (executing) return;
  executing = true;
  setBusy(true);

  try {
    const office = currentOffice();
    const user = currentUser();
    if (!office?.officeId || !user?.uid) throw new Error("auth_required");
    if (!intakeContext) throw new Error("context_missing");

    const brokerFields = {
      opportunityKind: brokerExtras.opportunityKind,
      purpose: brokerExtras.purpose,
      propertyType: brokerExtras.propertyType,
      city: brokerExtras.city,
      district: brokerExtras.district,
      priceOrBudget: brokerExtras.priceOrBudget,
      area: brokerExtras.area,
      rooms: brokerExtras.rooms
    };

    const prepared = await prepareOpportunityIntake({
      officeId: office.officeId,
      brokerId: user.uid,
      text: intakeContext.text,
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
      extractedSnapshot: brokerExtras.extractedSnapshot || null
    };

    const saved = await persistIntake(prepared, reviewMeta);
    if (window.IAQAR && typeof window.IAQAR.pushSavedOpportunityToWorkspace === "function") {
      window.IAQAR.pushSavedOpportunityToWorkspace({
        opportunityId: saved.opportunityId,
        duplicate: saved.duplicate,
        matchCount: 0
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
    updateClearButtonVisibility();
    return;
  }
  selectedFile = file;
  updateClearButtonVisibility();
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
  $("addOpportunityInputClear")?.addEventListener("click", () => clearIntakeForm());
  $("addOpportunityInput")?.addEventListener("input", () => updateClearButtonVisibility());
  fileInput?.addEventListener("change", onFileChosen);
  $("addOpportunityRetry")?.addEventListener("click", () => void startExecute());
  updateClearButtonVisibility();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}

export const __test = {
  startExecute,
  approveFromReview,
  setSelectedFile(file) { selectedFile = file; },
  getSelectedFile() { return selectedFile; }
};
