/**
 * Phase 2 — Add Opportunity card controller.
 * Unified intake row: text/link + paperclip + submit. No per-type buttons.
 */

import {
  ALL_OPPORTUNITY_FIELDS,
  ATTACHMENT_ACCEPT,
  INTAKE_STATE_LABELS,
  completeOpportunityIntake,
  createExtractionAdapter,
  isLandProperty,
  listMissingFields,
  mergeBrokerProvidedFields,
  normalizeOpportunityFields,
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

const FIELD_LABELS = Object.freeze({
  opportunityKind: "نوع الفرصة (عرض / طلب)",
  purpose: "نوع العملية",
  propertyType: "نوع العقار",
  city: "المدينة",
  district: "الحي",
  salePrice: "السعر المطلوب",
  annualRent: "الإيجار السنوي",
  monthlyRent: "الإيجار الشهري",
  optionalMonthlyRentAfterSixMonths: "الإيجار الشهري الاختياري بعد أول 6 أشهر",
  paymentInstallments: "عدد الدفعات",
  budget: "الميزانية",
  area: "المساحة",
  rooms: "عدد الغرف",
  bathrooms: "عدد دورات المياه",
  floorNumber: "رقم الدور",
  advertiserPhoneNormalized: "رقم مسؤول الإعلان"
});

const EXTRACTION_TIMEOUT_MS = 40_000;
const EXTRACTION_FAILURE_MESSAGE = "تعذر إكمال تحليل الإعلان. حاول مرة أخرى.";
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
  const label = INTAKE_STATE_LABELS[state] || "";
  status.textContent = detail ? `${label}${label ? " — " : ""}${detail}` : label;
  if (retry) retry.hidden = state !== "failed";
}

function setBusy(busy) {
  const submit = $("addOpportunitySubmit");
  const input = $("addOpportunityInput");
  const paperclip = $("addOpportunityPaperclip");
  const clearFile = $("addOpportunityClearFile");
  const complete = $("addOpportunityComplete");
  if (submit) submit.disabled = busy;
  if (input) input.disabled = busy;
  if (paperclip) paperclip.disabled = busy;
  if (clearFile) clearFile.disabled = busy;
  if (complete) complete.disabled = busy;
}

function clearMissingForm() {
  const wrap = $("addOpportunityMissing");
  if (!wrap) return;
  wrap.hidden = true;
  wrap.innerHTML = "";
}

function escapeAttribute(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function reviewFieldKeys(fields) {
  const normalized = normalizeOpportunityFields(fields);
  const keys = ["opportunityKind", "purpose", "propertyType", "city", "district"];
  if (normalized.purpose === "SALE") keys.push("salePrice");
  else if (normalized.purpose === "PURCHASE" || normalized.purpose === "LEASE_REQUEST") keys.push("budget");
  else if (normalized.purpose === "RENT") {
    keys.push("annualRent", "paymentInstallments");
    if (normalized.monthlyRent != null) keys.push("monthlyRent");
    if (normalized.optionalMonthlyRentAfterSixMonths != null) {
      keys.push("optionalMonthlyRentAfterSixMonths");
    }
  }
  keys.push("area");
  if (!isLandProperty(normalized.propertyType)) {
    keys.push("rooms", "bathrooms", "floorNumber");
  }
  if (normalized.advertiserPhoneNormalized) keys.push("advertiserPhoneNormalized");
  return keys;
}

function fieldLabel(key, fields) {
  if (key !== "salePrice" && key !== "budget" && key !== "annualRent") return FIELD_LABELS[key] || key;
  if (key === "salePrice") {
    return fields.opportunityKind === "REQUEST" ? "الميزانية" : "السعر المطلوب";
  }
  if (key === "annualRent") {
    return fields.opportunityKind === "REQUEST" ? "حد الإيجار" : "الإيجار السنوي";
  }
  return "الميزانية";
}

function renderReviewField(key, fields, requiredFields) {
  const required = requiredFields.has(key);
  const reviewNote = required && (fields[key] === null || fields[key] === undefined || fields[key] === "")
    ? " — يحتاج مراجعة"
    : "";
  if (key === "opportunityKind") {
    return `<label>${FIELD_LABELS[key]}${reviewNote}
      <select name="${key}" required>
        <option value="">اختر</option>
        <option value="OFFER" ${fields.opportunityKind === "OFFER" ? "selected" : ""}>عرض مالك</option>
        <option value="REQUEST" ${fields.opportunityKind === "REQUEST" ? "selected" : ""}>طلب عميل</option>
      </select>
    </label>`;
  }
  if (key === "purpose") {
    return `<label>${FIELD_LABELS[key]}${reviewNote}
      <select name="${key}" required>
        <option value="">اختر نوع العملية أولًا</option>
        <option value="SALE" ${fields.purpose === "SALE" ? "selected" : ""}>بيع</option>
        <option value="PURCHASE" ${fields.purpose === "PURCHASE" ? "selected" : ""}>شراء</option>
        <option value="RENT" ${fields.purpose === "RENT" ? "selected" : ""}>إيجار</option>
        <option value="LEASE_REQUEST" ${fields.purpose === "LEASE_REQUEST" ? "selected" : ""}>طلب إيجار</option>
      </select>
    </label>`;
  }
  const numericFields = new Set([
    "salePrice",
    "annualRent",
    "monthlyRent",
    "optionalMonthlyRentAfterSixMonths",
    "paymentInstallments",
    "budget",
    "area",
    "rooms",
    "bathrooms",
    "floorNumber"
  ]);
  const requiredAttribute = required ? " required" : "";
  const step = key === "area" ? " step=\"any\"" : "";
  return `<label>${fieldLabel(key, fields)}${reviewNote}
    <input name="${key}" type="${numericFields.has(key) ? "number" : "text"}"${step}
      value="${escapeAttribute(fields[key])}"${requiredAttribute}>
  </label>`;
}

function renderReviewForm(prepared) {
  const wrap = $("addOpportunityMissing");
  if (!wrap) return;
  const fields = normalizeOpportunityFields(prepared?.fields || {});
  const missingFields = listMissingFields(fields);
  const requiredFields = new Set(missingFields.concat(
    reviewFieldKeys(fields).filter((key) => ![
      "monthlyRent",
      "optionalMonthlyRentAfterSixMonths",
      "paymentInstallments",
      "bathrooms",
      "floorNumber",
      "advertiserPhoneNormalized"
    ].includes(key))
  ));
  wrap.hidden = false;
  wrap.innerHTML = `
    <p class="add-opportunity-missing-title">راجع بيانات الفرصة قبل الحفظ</p>
    <div class="add-opportunity-missing-grid">
      ${reviewFieldKeys(fields).map((key) => renderReviewField(key, fields, requiredFields)).join("")}
    </div>
    <button type="submit" class="add-opportunity-complete" id="addOpportunityComplete">حفظ بعد المراجعة</button>
    <p class="add-opportunity-note">البيانات المعروضة من المصدر الحالي فقط. راجع الحقول قبل الحفظ.</p>
  `;
  wrap.onsubmit = (event) => {
    event.preventDefault();
    const brokerFields = readReviewFieldsFromForm();
    void runPipeline({ brokerFields });
  };
  for (const key of ["opportunityKind", "purpose", "propertyType"]) {
    wrap.querySelector(`[name="${key}"]`)?.addEventListener("change", () => {
      if (!pendingDraft) return;
      const updatedFields = mergeBrokerProvidedFields(pendingDraft.fields, readReviewFieldsFromForm());
      pendingDraft = {
        ...pendingDraft,
        fields: updatedFields,
        missingFields: listMissingFields(updatedFields)
      };
      setState("review", pendingDraft.missingFields.length ? "بعض الحقول تحتاج مراجعة" : "");
      renderReviewForm(pendingDraft);
    });
  }
}

function readReviewFieldsFromForm() {
  const wrap = $("addOpportunityMissing");
  const data = {};
  if (!wrap) return data;
  for (const key of ALL_OPPORTUNITY_FIELDS) {
    const node = wrap.querySelector(`[name="${key}"]`);
    if (node) data[key] = node.value;
  }
  return data;
}

let pendingDraft = null;
let pendingIntakeIdentity = "";
let lastFailure = null;
let selectedFile = null;

function intakeIdentity(text, file) {
  const filePart = file
    ? `${file.name || ""}|${file.type || ""}|${file.size || 0}|${file.lastModified || 0}`
    : "";
  return `${String(text || "").trim()}|${filePart}`;
}

function resetForNewIntake({ clearStatus = false } = {}) {
  pendingDraft = null;
  pendingIntakeIdentity = "";
  lastFailure = null;
  clearMissingForm();
  if (clearStatus) setState("idle");
}

function describeAttachment() {
  const chip = $("addOpportunityFileChip");
  const label = $("addOpportunityFileName");
  if (!chip || !label) return;
  if (!selectedFile) {
    chip.hidden = true;
    label.textContent = "";
    return;
  }
  chip.hidden = false;
  label.textContent = selectedFile.name;
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

async function requestOpportunityExtraction(officeId, input) {
  const base = workerBase();
  if (!base) throw new Error("تعذر الوصول إلى خدمة التحليل");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), extractionTimeoutMs);
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/opportunity/extract`, {
      method: "POST",
      headers: {
        ...(await authHeader()),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        officeId,
        sourceType: input.sourceType,
        text: input.text || "",
        url: input.url || "",
        mediaPath: input.mediaPath || "",
        fileName: input.fileName || "",
        contentType: input.contentType || ""
      }),
      signal: controller.signal
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(EXTRACTION_FAILURE_MESSAGE);
    }
    const hasRealFields = payload?.fields
      && typeof payload.fields === "object"
      && !Array.isArray(payload.fields)
      && Object.values(payload.fields).some((value) =>
        value !== null && value !== undefined && String(value).trim() !== ""
      );
    if (!response.ok || !hasRealFields) {
      throw new Error(EXTRACTION_FAILURE_MESSAGE);
    }
    return {
      extractionMode: payload.extractionMode,
      extractionProvider: payload.extractionProvider,
      extractionConfidence: payload.extractionConfidence,
      productionAi: payload.productionAi === true,
      productionExtraction: payload.productionExtraction === true,
      extractedText: payload.extractedText || "",
      fields: payload.fields
    };
  } catch (error) {
    if (error?.message === EXTRACTION_FAILURE_MESSAGE) throw error;
    throw new Error(EXTRACTION_FAILURE_MESSAGE);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function persistIntake(result) {
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

  const batch = db.batch();
  batch.set(sourceRef, {
    ...result.source,
    createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
  });
  batch.set(opportunityRef, {
    ...result.opportunity,
    createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
  });
  await batch.commit();
  return { duplicate: false, opportunityId: result.opportunity.id, sourceId: result.source.id };
}

async function runPipeline({ brokerFields = null, fromRetry = false } = {}) {
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
  const sourceFile = selectedFile;
  const currentIdentity = intakeIdentity(text, sourceFile);
  const resumeIntake = Boolean(
    brokerFields
    && pendingDraft
    && pendingIntakeIdentity
    && pendingIntakeIdentity === currentIdentity
  );
  if (!text && !sourceFile) {
    setState("failed", "أدخل رابطًا أو نصًا أو أرفق ملفًا");
    lastFailure = { text, file: sourceFile };
    return;
  }

  if (brokerFields && !resumeIntake) {
    resetForNewIntake();
    setState("failed", "تغير مصدر الإعلان؛ أعد التحليل قبل الحفظ");
    return;
  }

  if (!resumeIntake) resetForNewIntake();
  setBusy(true);
  if (!resumeIntake) clearMissingForm();

  try {
    let prepared;
    if (resumeIntake) {
      prepared = completeOpportunityIntake(pendingDraft, brokerFields);
    } else {
      let fileChecksumValue = "";
      let mediaPath = "";
      if (sourceFile) {
        setState("uploading");
        fileChecksumValue = await fileChecksum(sourceFile);
        // Provisional source id from checksum so upload path is stable.
        const provisional = `src_${fileChecksumValue.slice(0, 40)}`;
        const uploaded = await uploadSourceFile(office.officeId, provisional, sourceFile);
        mediaPath = uploaded.mediaPath || "";
      }

      setState("analyzing");
      prepared = await prepareOpportunityIntake({
        officeId: office.officeId,
        brokerId: user.uid,
        text,
        file: sourceFile || undefined,
        fileChecksum: fileChecksumValue,
        mediaPath,
        requireReview: true
      }, createExtractionAdapter({
        extract: (input) => requestOpportunityExtraction(office.officeId, input)
      }));

      if (mediaPath && prepared?.source) prepared.source.mediaPath = mediaPath;
      if (fileChecksumValue && prepared.source) {
        prepared.source.byteSize = sourceFile?.size || prepared.source.byteSize;
      }
    }

    if (!prepared?.ok) {
      resetForNewIntake();
      setState("failed", prepared?.error || EXTRACTION_FAILURE_MESSAGE);
      lastFailure = { text, file: sourceFile };
      return;
    }

    if (prepared.state === "review" || prepared.state === "missing_information") {
      pendingDraft = prepared;
      pendingIntakeIdentity = currentIdentity;
      lastFailure = null;
      setState("review", prepared.missingFields.length ? "بعض الحقول تحتاج مراجعة" : "");
      renderReviewForm(prepared);
      return;
    }

    const saved = await persistIntake(prepared);
    setState("saved", saved.duplicate ? "هذه الفرصة محفوظة مسبقًا" : "");
    toast(saved.duplicate ? "الفرصة مكررة — لم يُنشأ سجل جديد" : "تم حفظ الفرصة");
    pendingDraft = null;
    pendingIntakeIdentity = "";
    lastFailure = null;
    selectedFile = null;
    describeAttachment();
    if (input) input.value = "";
    clearMissingForm();

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
        // Explicit missing-data sync covers NEEDS_DATA even when rematch finds no pairs.
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
        productionAi: prepared.productionAi === true,
        productionExtraction: prepared.productionExtraction === true,
        ...phase4BoundaryGuarantees(),
        ...phase5BoundaryGuarantees()
      }
    }));
  } catch (error) {
    console.warn("add-opportunity failed", error);
    pendingDraft = null;
    pendingIntakeIdentity = "";
    clearMissingForm();
    setState(
      "failed",
      error?.message === "upload_failed" ? "فشل رفع الملف" : (error?.message || EXTRACTION_FAILURE_MESSAGE)
    );
    lastFailure = { text, file: sourceFile, fromRetry };
  } finally {
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
    resetForNewIntake();
    describeAttachment();
    return;
  }
  resetForNewIntake();
  selectedFile = file;
  describeAttachment();
  setState("idle");
}

function boot() {
  const form = $("addOpportunityForm");
  if (!form || form.dataset.bound === "1") return;
  form.dataset.bound = "1";

  const fileInput = $("addOpportunityFile");
  if (fileInput) fileInput.setAttribute("accept", ATTACHMENT_ACCEPT);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void runPipeline();
  });

  $("addOpportunityPaperclip")?.addEventListener("click", onPaperclip);
  $("addOpportunityInput")?.addEventListener("input", () => {
    if (pendingDraft || lastFailure) resetForNewIntake({ clearStatus: true });
  });
  fileInput?.addEventListener("change", onFileChosen);
  $("addOpportunityRetry")?.addEventListener("click", () => {
    void runPipeline({ fromRetry: true });
  });
  $("addOpportunityClearFile")?.addEventListener("click", () => {
    selectedFile = null;
    resetForNewIntake({ clearStatus: true });
    describeAttachment();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}

export const __test = {
  runPipeline,
  requestOpportunityExtraction,
  resetForNewIntake,
  setExtractionTimeoutMs(value) {
    extractionTimeoutMs = Number(value) > 0 ? Number(value) : EXTRACTION_TIMEOUT_MS;
  },
  setSelectedFile(file) {
    resetForNewIntake();
    selectedFile = file;
  },
  getSelectedFile() { return selectedFile; },
  getPendingDraft() { return pendingDraft; },
  getLastFailure() { return lastFailure; }
};
