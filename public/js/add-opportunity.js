/**
 * Phase 2 — Add Opportunity card controller.
 * Unified intake row: text/link + paperclip + submit. No per-type buttons.
 */

import {
  ATTACHMENT_ACCEPT,
  INTAKE_STATE_LABELS,
  REQUIRED_OPPORTUNITY_FIELDS,
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

const WORKER_BASE = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";

function workerBase() {
  return window.IAQAR?.workerBase || window.IAQAR?.office?.workerBase || WORKER_BASE;
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
    <p class="add-opportunity-note">التحليل الحالي: محاكاة/تحليل نصي حتمي — ليس ذكاءً اصطناعيًا إنتاجيًا.</p>
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
    const prepared = await prepareOpportunityIntake({
      officeId: office.officeId,
      brokerId: user.uid,
      text,
      file: selectedFile || undefined,
      fileChecksum: fileChecksumValue,
      mediaPath,
      brokerFields,
      allowIncomplete: Boolean(brokerFields)
    }, createExtractionAdapter());

    if (!prepared.ok) {
      setState("failed", prepared.error || "");
      lastFailure = { text, file: selectedFile, brokerFields };
      return;
    }

    if (prepared.state === "missing_information") {
      pendingDraft = prepared;
      setState("missing_information");
      renderMissingForm(prepared.missingFields, prepared.fields);
      return;
    }

    // Ensure mediaPath / checksum land on the source record.
    if (mediaPath) prepared.source.mediaPath = mediaPath;
    if (fileChecksumValue) {
      prepared.source.byteSize = selectedFile?.size || prepared.source.byteSize;
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
    if (shouldRematchAfterOpportunityWrite({ duplicate: saved.duplicate })) {
      try {
        const token = await user.getIdToken();
        matching = await requestOpportunityRematch({
          workerBase: workerBase(),
          idToken: token,
          officeId: office.officeId,
          opportunityId: saved.opportunityId,
          notify: false
        });
      } catch (error) {
        console.warn("[iaqar] rematch after intake", error);
        matching = { ok: false, error: "rematch_failed", matchCount: 0 };
      }
    }

    // Phase 4 rematch runs in the Worker; Operations Center items remain Phase 5.
    window.dispatchEvent(new CustomEvent("iaqar:opportunity-ingested", {
      detail: {
        opportunityId: saved.opportunityId,
        duplicate: saved.duplicate,
        createsOperation: false,
        runsMatching: matching.ok === true,
        matchCount: Number(matching.matchCount || 0),
        productionAi: false,
        ...phase4BoundaryGuarantees()
      }
    }));
  } catch (error) {
    console.warn("add-opportunity failed", error);
    setState("failed", error?.message === "upload_failed" ? "فشل رفع الملف" : "");
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
