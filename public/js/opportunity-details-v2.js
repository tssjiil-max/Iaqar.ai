/**
 * OpportunityDetailsV2 controller — feature-flagged page + single-field editors.
 * Reuses existing persist adapter; does not change save/lifecycle/matching engines.
 */

import {
  isOpportunityDetailsV2Enabled,
  mapOpportunityDetailsV2ViewModel,
  parseOpportunityV2IdFromHash,
  v2ReferenceActivities,
  v2ReferenceAppointment,
  v2ReferenceFixture
} from "./opportunity-details-v2-domain.js";
import {
  buildFieldEditorV2,
  buildOpportunityDetailsV2PageHtml
} from "./opportunity-details-v2-ui.js";
import { buildEditPatch } from "./opportunity-bank-domain.js";
import {
  buildAdvertiserDataPatch,
  formatLocalPhoneDisplay,
  isPersistedAdvertiserRole,
  resolveAdvertiserEnumValue
} from "./advertiser-phone-domain.js";
import { evaluateMatchingReadiness } from "./opportunity-readiness-domain.js";
import { normalizePurpose } from "./opportunity-intake-domain.js";
import { dismissFieldEditor, wireFieldEditorSheet } from "./v2/opportunity-details/editor.js";

function editorKeyFromTarget(target) {
  return String(target?.getAttribute?.("data-v2-editor") || "").trim();
}

function firstMissingEditor(vm) {
  return vm.missingFields?.[0]?.editor || "";
}

const ADVERTISER_ROLE_VALIDATION = "اختر: مالك، عميل، مفوض، أو وسيط عقاري.";
const ADVERTISER_ROLE_SAVE_FAILED = "تعذر حفظ صفة المعلن، حاول مرة أخرى.";

export function buildV2FieldPatch(existing, editorKey, formData = {}) {
  if (editorKey === "advertiserRole") {
    const resolved = resolveAdvertiserEnumValue(formData.advertiserRole);
    if (!isPersistedAdvertiserRole(resolved)) {
      return { ok: false, error: ADVERTISER_ROLE_VALIDATION };
    }
    return buildAdvertiserDataPatch(existing, {
      advertiserRole: resolved,
      advertiserPhoneLocal: formatLocalPhoneDisplay(existing.advertiserPhoneNormalized || existing.contactPhone || "")
    });
  }
  if (editorKey === "contactNumber") {
    return buildAdvertiserDataPatch(existing, {
      advertiserRole: existing.advertiserRole,
      advertiserPhoneLocal: formData.contactNumber
    });
  }
  if (editorKey === "price") {
    return buildEditPatch(existing, { priceOrBudget: formData.price }, { actorUid: formData.actorUid || "" });
  }
  if (editorKey === "area") {
    return buildEditPatch(existing, { area: formData.area }, { actorUid: formData.actorUid || "" });
  }
  if (editorKey === "location") {
    return buildEditPatch(existing, {
      city: formData.city,
      district: formData.district
    }, { actorUid: formData.actorUid || "" });
  }
  if (editorKey === "propertyPurpose") {
    return buildEditPatch(existing, {
      propertyType: formData.propertyType,
      purpose: normalizePurpose(formData.purpose)
    }, { actorUid: formData.actorUid || "" });
  }
  return { ok: false, error: "unknown_editor" };
}

function closeEditor(root, options = {}) {
  dismissFieldEditor(root.querySelector("#oppV2Editor") || root.querySelector("[data-cv2-editor-root]"), options);
}

function readEditorForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function showEditorError(root, message) {
  const node = root.querySelector("#oppV2EditorError");
  if (!node) return;
  node.hidden = false;
  node.textContent = message;
}

export function renderOpportunityDetailsV2(container, vm) {
  if (!container) return null;
  container.hidden = false;
  container.innerHTML = buildOpportunityDetailsV2PageHtml(vm);
  return container.querySelector(".opp-v2-page");
}

export function wireOpportunityDetailsV2(container, options = {}) {
  const root = container?.querySelector(".opp-v2-page") || container;
  if (!root) return;

  const openEditor = (editorKey, opener) => {
    if (!editorKey) return;
    closeEditor(root, { restoreFocus: false });
    root.insertAdjacentHTML("beforeend", buildFieldEditorV2(editorKey, options.vm || {}));
    const overlay = root.querySelector("#oppV2Editor");
    const form = overlay?.querySelector("#oppV2EditorForm");
    wireFieldEditorSheet(overlay, { opener });
    form?.querySelector("input")?.focus();
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitEditor(editorKey, readEditorForm(form));
    });
  };

  async function submitEditor(editorKey, formData) {
    const save = options.saveField;
    if (typeof save !== "function") {
      showEditorError(root, "تعذر الحفظ");
      return;
    }
    const btn = root.querySelector("#oppV2EditorSave");
    if (btn) btn.disabled = true;
    try {
      const result = await save(editorKey, formData);
      if (!result?.ok) {
        showEditorError(root, result?.error || "تعذر حفظ الحقل");
        return;
      }
      closeEditor(root, { restoreFocus: false });
      if (typeof options.onSaved === "function") await options.onSaved(result);
    } catch (error) {
      showEditorError(root, error?.message || "تعذر حفظ الحقل");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  root.querySelector("#oppV2BackBtn")?.addEventListener("click", () => {
    options.onClose?.();
  });
  root.querySelector("#oppV2MoreBtn")?.addEventListener("click", () => {
    const menu = root.querySelector("#oppV2MoreMenu");
    if (menu) menu.hidden = !menu.hidden;
  });
  root.querySelector("#oppV2CompleteBtn")?.addEventListener("click", () => {
    openEditor(firstMissingEditor(options.vm || {}), root.querySelector("#oppV2CompleteBtn"));
  });
  root.querySelectorAll("[data-v2-editor]").forEach((chip) => {
    chip.addEventListener("click", () => openEditor(editorKeyFromTarget(chip), chip));
  });
}

export async function saveV2FieldWithAdapter(existing, editorKey, formData, persist) {
  const built = buildV2FieldPatch(existing, editorKey, formData);
  if (!built.ok) return { ok: false, error: built.error || "تعذر تجهيز الحقل" };
  const patch = { ...(built.patch || {}) };
  if (patch.advertiserPhoneNormalized) {
    patch.contactPhone = patch.advertiserPhoneNormalized;
    patch.phone = patch.advertiserPhoneRaw || patch.advertiserPhoneNormalized;
  }
  const persisted = await persist(patch);
  const reloaded = persisted?.reloaded || { ...existing, ...patch };
  const readiness = evaluateMatchingReadiness(reloaded);
  const stillMissing = (readiness.matchingReadinessMissing || []);
  const editorStillOpen = {
    advertiserRole: stillMissing.includes("advertiserRole"),
    contactNumber: stillMissing.includes("contactPhone"),
    price: stillMissing.includes("priceOrBudget"),
    area: false,
    location: stillMissing.includes("city") || stillMissing.includes("district"),
    propertyPurpose: stillMissing.includes("purpose") || stillMissing.includes("propertyType")
  }[editorKey];
  if (editorStillOpen) {
    return {
      ok: false,
      error: editorKey === "advertiserRole" ? ADVERTISER_ROLE_SAVE_FAILED : "لم يُحفظ الحقل",
      readiness,
      reloaded
    };
  }
  return { ok: true, reloaded, readiness };
}

export function buildReferenceOpportunityDetailsV2ViewModel() {
  return mapOpportunityDetailsV2ViewModel(
    "opp_v2_ref_1258",
    v2ReferenceFixture(),
    {
      now: new Date("2026-08-22T07:40:00.000Z"),
      activities: v2ReferenceActivities(),
      nextAppointment: v2ReferenceAppointment()
    }
  );
}

export function mountOpportunityDetailsV2(container, record, extras = {}) {
  const vm = extras.reference
    ? buildReferenceOpportunityDetailsV2ViewModel()
    : mapOpportunityDetailsV2ViewModel(extras.id || record.id, record, extras);
  renderOpportunityDetailsV2(container, vm);
  wireOpportunityDetailsV2(container, {
    vm,
    onClose: extras.onClose,
    saveField: extras.saveField,
    onSaved: extras.onSaved
  });
  return vm;
}

if (typeof window !== "undefined") {
  window.IAQAR = window.IAQAR || {};
  window.IAQAR.opportunityDetailsV2 = Object.freeze({
    isEnabled: isOpportunityDetailsV2Enabled,
    parseId: parseOpportunityV2IdFromHash,
    mapViewModel: mapOpportunityDetailsV2ViewModel,
    mount: mountOpportunityDetailsV2,
    render: renderOpportunityDetailsV2,
    buildReference: buildReferenceOpportunityDetailsV2ViewModel
  });
}
