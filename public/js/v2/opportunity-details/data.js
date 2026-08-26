import { saveV2FieldWithAdapter } from "../../opportunity-details-v2.js";
import { canonicalFirestoreOfficeId, isOwnedByOffice, projectOpportunityFlowStatuses } from "../../opportunity-data-flow-domain.js";

function officeRuntime() {
  return window.IAQAR?.office || null;
}

function officeId() {
  return canonicalFirestoreOfficeId(officeRuntime()?.officeId || "");
}

function workerBase() {
  return String(window.IAQAR?.workerBase || officeRuntime()?.workerBase || "").replace(/\/+$/, "");
}

function authUser() {
  try {
    return window.firebase?.auth?.()?.currentUser || null;
  } catch {
    return null;
  }
}

export async function loadOpportunityRecord(id) {
  const office = officeRuntime();
  const db = office?.db;
  const currentOfficeId = officeId();
  if (!db || !currentOfficeId || !id) return null;
  const snap = await db.collection("offices").doc(currentOfficeId).collection("opportunities").doc(id).get();
  if (!snap.exists) return null;
  return { id, ...(snap.data() || {}) };
}

async function persistPatch(id, patch) {
  const user = authUser();
  const currentOfficeId = officeId();
  const worker = workerBase();
  if (!user?.getIdToken || !currentOfficeId || !worker || !id) {
    throw Object.assign(new Error("تعذر حفظ التعديل."), { code: "persist_unavailable" });
  }
  const token = await user.getIdToken();
  const response = await fetch(`${worker}/opportunity/patch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Office-Id": currentOfficeId
    },
    body: JSON.stringify({
      officeId: currentOfficeId,
      opportunityId: id,
      patch
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(payload.message || payload.error || "تعذر حفظ التعديل."), {
      code: payload.error || "patch_failed"
    });
  }
  return payload;
}

export async function persistOpportunityField(existing, editorKey, formData = {}) {
  if (!isOwnedByOffice(existing, officeId())) {
    throw Object.assign(new Error("لا يمكن تعديل سجل يخص مكتبًا آخر."), { code: "office_forbidden" });
  }
  return saveV2FieldWithAdapter(existing, editorKey, formData, async (patch) => {
    const writeResult = await persistPatch(existing.id, {
      ...patch,
      ...projectOpportunityFlowStatuses({ ...existing, ...patch })
    });
    const reloaded = await loadOpportunityRecord(existing.id);
    if (!reloaded) {
      throw Object.assign(new Error("تعذر التحقق من حفظ الفرصة بعد الكتابة"), { code: "reload_failed" });
    }
    return { writeResult, reloaded };
  });
}
