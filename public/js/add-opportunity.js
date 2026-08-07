/**
 * Phase 2 — Add Opportunity card controller.
 * Unified intake row: text/link + paperclip + submit. No per-type buttons.
 */

import {
  ATTACHMENT_ACCEPT,
  INTAKE_STATE_LABELS,
  REQUIRED_OPPORTUNITY_FIELDS,
  completeOpportunityIntake,
  createExtractionAdapter,
  prepareOpportunityIntake,
  sha256Hex,
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
  purpose: "الغرض",
  propertyType: "نوع العقار",
  city: "المدينة",
  district: "الحي",
  priceOrBudget: "السعر أو الميزانية",
  area: "المساحة",
  rooms: "عدد الغرف"
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
  const label = INTAKE_STATE_LABELS[state] || "";
  status.textContent = detail ? `${label}${label ? " — " : ""}${detail}` : label;
  if (retry) retry.hidden = state !== "failed";
}

function setBusy(busy) {
  const submit = $("addOpportunitySubmit");
  const input = $("addOpportunityInput");
  const paperclip = $("addOpportunityPaperclip");
  if (submit) submit.disabled = busy;
  if (input) input.disabled = busy;
  if (paperclip) paperclip.disabled = busy;
}

function clearMissingForm() {
  const wrap = $("addOpportunityMissing");
  if (!wrap) return;
  wrap.hidden = true;
  wrap.innerHTML = "";
}

function renderMissingForm(missingFields, fields) {
  const wrap = $("addOpportunityMissing");
  if (!wrap) return;
  wrap.hidden = false;
  wrap.innerHTML = `
    <p class="add-opportunity-missing-title">أكمل الحقول الناقصة فقط</p>
    <div class="add-opportunity-missing-grid">
      ${missingFields.map((key) => {
        if (key === "opportunityKind") {
          return `<label>${FIELD_LABELS[key]}
            <select name="${key}" required>
              <option value="">اختر</option>
              <option value="OFFER" ${fields.opportunityKind === "OFFER" ? "selected" : ""}>عرض</option>
              <option value="REQUEST" ${fields.opportunityKind === "REQUEST" ? "selected" : ""}>طلب</option>
            </select>
          </label>`;
        }
        if (key === "purpose") {
          return `<label>${FIELD_LABELS[key]}
            <select name="${key}" required>
              <option value="">اختر</option>
              <option value="SALE">بيع</option>
              <option value="PURCHASE">شراء</option>
              <option value="RENT">إيجار</option>
              <option value="LEASE_REQUEST">طلب إيجار</option>
            </select>
          </label>`;
        }
        const inputType = ["priceOrBudget", "area", "rooms"].includes(key) ? "number" : "text";
        const value = fields[key] == null ? "" : fields[key];
        return `<label>${FIELD_LABELS[key]}
          <input name="${key}" type="${inputType}" value="${String(value).replace(/"/g, "&quot;")}" required>
        </label>`;
      }).join("")}
    </div>
    <button type="submit" class="add-opportunity-complete" id="addOpportunityComplete">حفظ بعد الاستكمال</button>
    <p class="add-opportunity-note">تم استخراج البيانات الموجودة فعليًا؛ أكمل الحقول الناقصة فقط.</p>
  `;
  wrap.onsubmit = (event) => {
    event.preventDefault();
    const brokerFields = readMissingFieldsFromForm();
    void runPipeline({ brokerFields });
  };
}

function readMissingFieldsFromForm() {
  const wrap = $("addOpportunityMissing");
  const data = {};
  if (!wrap) return data;
  for (const key of REQUIRED_OPPORTUNITY_FIELDS) {
    const node = wrap.querySelector(`[name="${key}"]`);
    if (node) data[key] = node.value;
  }
  return data;
}

let pendingDraft = null;
let lastFailure = null;
let selectedFile = null;

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
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.fields) {
    throw new Error(payload.message || "تعذر استخراج بيانات الفرصة");
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
  if (!text && !selectedFile) {
    setState("failed", "أدخل رابطًا أو نصًا أو أرفق ملفًا");
    lastFailure = { text, file: selectedFile, brokerFields };
    return;
  }

  setBusy(true);
  clearMissingForm();

  try {
    let prepared;
    if (brokerFields && pendingDraft) {
      prepared = completeOpportunityIntake(pendingDraft, brokerFields);
    } else {
      let fileChecksumValue = "";
      let mediaPath = "";
      if (selectedFile) {
        setState("uploading");
        fileChecksumValue = await fileChecksum(selectedFile);
        // Provisional source id from checksum so upload path is stable.
        const provisional = `src_${fileChecksumValue.slice(0, 40)}`;
        const uploaded = await uploadSourceFile(office.officeId, provisional, selectedFile);
        mediaPath = uploaded.mediaPath || "";
      }

      setState("analyzing");
      prepared = await prepareOpportunityIntake({
        officeId: office.officeId,
        brokerId: user.uid,
        text,
        file: selectedFile || undefined,
        fileChecksum: fileChecksumValue,
        mediaPath
      }, createExtractionAdapter({
        extract: (input) => requestOpportunityExtraction(office.officeId, input)
      }));

      if (mediaPath && prepared?.source) prepared.source.mediaPath = mediaPath;
      if (fileChecksumValue && prepared.source) {
        prepared.source.byteSize = selectedFile?.size || prepared.source.byteSize;
      }
    }

    if (!prepared?.ok) {
      setState("failed", prepared?.error || "تعذر تحليل المصدر");
      lastFailure = { text, file: selectedFile, brokerFields };
      return;
    }

    if (prepared.state === "missing_information") {
      pendingDraft = prepared;
      setState("missing_information");
      renderMissingForm(prepared.missingFields, prepared.fields);
      return;
    }

    const saved = await persistIntake(prepared);
    setState("saved", saved.duplicate ? "هذه الفرصة محفوظة مسبقًا" : "");
    toast(saved.duplicate ? "الفرصة مكررة — لم يُنشأ سجل جديد" : "تم حفظ الفرصة");
    pendingDraft = null;
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
    setState("failed", error?.message === "upload_failed" ? "فشل رفع الملف" : (error?.message || "تعذر تحليل المصدر"));
    lastFailure = { text, file: selectedFile, brokerFields, fromRetry };
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
    pendingDraft = null;
    lastFailure = null;
    describeAttachment();
    return;
  }
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
  fileInput?.addEventListener("change", onFileChosen);
  $("addOpportunityRetry")?.addEventListener("click", () => {
    if (lastFailure?.brokerFields) {
      void runPipeline({ brokerFields: lastFailure.brokerFields, fromRetry: true });
    } else {
      void runPipeline({ fromRetry: true });
    }
  });
  $("addOpportunityClearFile")?.addEventListener("click", () => {
    selectedFile = null;
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
  setSelectedFile(file) { selectedFile = file; },
  getSelectedFile() { return selectedFile; }
};
