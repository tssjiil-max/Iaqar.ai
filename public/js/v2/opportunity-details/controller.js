import {
  mapOpportunityDetailsV2ViewModel,
  v2ReferenceActivities,
  v2ReferenceAppointment,
  v2ReferenceFixture
} from "../../opportunity-details-v2-domain.js";
import { firstMissingEditor } from "./view-model.js";
import { buildOpportunityDetailsContentV2 } from "./page.js";
import { buildFieldEditorV2 } from "./editor.js";
import { loadOpportunityRecord, persistOpportunityField } from "./data.js";

function referencePreview() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("cv2Ref") !== "1") return null;
    return {
      record: v2ReferenceFixture(),
      extras: {
        now: new Date("2026-08-22T07:40:00.000Z"),
        activities: v2ReferenceActivities(),
        nextAppointment: v2ReferenceAppointment()
      }
    };
  } catch {
    return null;
  }
}

const state = {
  opportunityId: "",
  record: null,
  extras: {},
  root: null,
  loadGen: 0
};

function currentViewModel() {
  return mapOpportunityDetailsV2ViewModel(state.opportunityId, state.record || {}, state.extras);
}

function showEditorError(message) {
  const node = state.root?.querySelector("#cv2EditorError");
  if (!node) return;
  node.hidden = false;
  node.textContent = message;
}

function closeEditor() {
  state.root?.querySelector("[data-cv2-editor-root]")?.remove();
}

function readEditorForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function submitEditor(editorKey, formData) {
  const btn = state.root?.querySelector("#cv2EditorSave");
  if (btn) btn.disabled = true;
  try {
    const result = await persistOpportunityField(state.record || { id: state.opportunityId }, editorKey, {
      ...formData,
      actorUid: window.firebase?.auth?.()?.currentUser?.uid || ""
    });
    if (!result?.ok) {
      showEditorError(result?.error || "تعذر حفظ الحقل");
      return;
    }
    state.record = result.reloaded || state.record;
    closeEditor();
    renderPage();
  } catch (error) {
    showEditorError(error?.message || "تعذر حفظ الحقل");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function openEditor(field) {
  if (!field || !state.root) return;
  closeEditor();
  state.root.insertAdjacentHTML("beforeend", buildFieldEditorV2(field, currentViewModel()));
  const form = state.root.querySelector("#cv2EditorForm");
  form?.querySelector("input")?.focus();
  state.root.querySelector("#cv2EditorCancel")?.addEventListener("click", closeEditor);
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitEditor(field, readEditorForm(form));
  });
}

function bindPage(root) {
  root.querySelector("[data-cv2-complete]")?.addEventListener("click", () => {
    const field = firstMissingEditor(currentViewModel());
    if (field) openEditor(field);
  });
  root.querySelectorAll(".cv2-details [data-cv2-editor]").forEach((node) => {
    node.addEventListener("click", () => openEditor(node.getAttribute("data-cv2-editor") || ""));
  });
}

function renderPage() {
  if (!state.root) return;
  state.root.innerHTML = buildOpportunityDetailsContentV2(currentViewModel());
  bindPage(state.root);
}

export function unmountOpportunityDetailsContentV2() {
  state.loadGen += 1;
  state.opportunityId = "";
  state.record = null;
  state.extras = {};
  if (state.root) state.root.innerHTML = "";
  state.root = null;
}

export async function mountOpportunityDetailsContentV2(root, { opportunityId } = {}) {
  const gen = state.loadGen + 1;
  state.loadGen = gen;
  if (!root || !opportunityId) return;
  state.root = root;
  state.opportunityId = opportunityId;
  const preview = referencePreview();
  if (preview) {
    state.record = preview.record;
    state.extras = preview.extras;
    renderPage();
    return;
  }
  state.record = { id: opportunityId };
  state.extras = {};
  renderPage();
  const record = await loadOpportunityRecord(opportunityId);
  if (state.loadGen !== gen) return;
  state.record = record || { id: opportunityId };
  renderPage();
}
