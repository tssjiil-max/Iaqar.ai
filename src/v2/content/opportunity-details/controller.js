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

const EMPTY_READINESS = Object.freeze({
  matchingReadiness: "NEEDS_COMPLETION",
  matchingReadinessMissing: [],
  isReadyForMatching: false
});

const state = {
  opportunityId: "",
  record: null,
  extras: {},
  root: null,
  loadGen: 0,
  hydrated: false
};

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

function currentViewModel() {
  const extras = state.hydrated
    ? state.extras
    : { ...state.extras, readiness: EMPTY_READINESS };
  return mapOpportunityDetailsV2ViewModel(state.opportunityId, state.record || {}, extras);
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
  const previous = state.record;
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
    state.hydrated = true;
    closeEditor();
    renderPage();
  } catch (error) {
    state.record = previous;
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

async function waitForDb(timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const office = window.IAQAR?.office;
    const user = window.firebase?.auth?.()?.currentUser;
    if (office?.db && office.officeId && office.officeId !== "platform" && user) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return Boolean(window.IAQAR?.office?.db && window.IAQAR?.office?.officeId);
}

async function hydrate(gen) {
  const preview = referencePreview();
  if (preview) {
    if (state.loadGen !== gen) return;
    state.record = preview.record;
    state.extras = preview.extras;
    state.hydrated = true;
    renderPage();
    return;
  }
  await waitForDb();
  if (state.loadGen !== gen) return;
  try {
    const record = await loadOpportunityRecord(state.opportunityId);
    if (state.loadGen !== gen) return;
    if (record) {
      state.record = record;
      state.hydrated = true;
      renderPage();
      return;
    }
    state.record = { id: state.opportunityId };
    state.hydrated = false;
    renderPage();
  } catch (error) {
    console.warn("[content-v2] opportunity load failed", error);
  }
}

export function unmountOpportunityDetailsContentV2() {
  state.loadGen += 1;
  state.opportunityId = "";
  state.record = null;
  state.extras = {};
  state.hydrated = false;
  if (state.root) state.root.innerHTML = "";
  state.root = null;
}

export async function mountOpportunityDetailsContentV2(root, { opportunityId } = {}) {
  if (!root || !opportunityId) return;
  const samePage = state.root === root && state.opportunityId === opportunityId;
  if (samePage && state.hydrated && state.record && Object.keys(state.record).length > 2) return;
  if (samePage && !state.hydrated) {
    await hydrate(state.loadGen);
    return;
  }
  const gen = state.loadGen + 1;
  state.loadGen = gen;
  state.root = root;
  state.opportunityId = opportunityId;
  state.record = { id: opportunityId };
  state.extras = {};
  state.hydrated = false;
  renderPage();
  await hydrate(gen);
}
