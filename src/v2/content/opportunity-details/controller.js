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
import { saveDeviceContact } from "./save-device-contact.js";

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
  hydrated: false,
  dataCardExpanded: false
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

function currentOfficeName() {
  const office = window.IAQAR?.office || {};
  return String(office.officeName || office.displayName || office.name || "").trim();
}

function showEditorError(message) {
  const node = state.root?.querySelector("#cv2EditorError");
  if (!node) return;
  node.hidden = false;
  node.textContent = message;
}

function showContactSaveStatus(message, ok) {
  const node = state.root?.querySelector("#cv2ContactSaveStatus");
  if (!node) return;
  node.hidden = !message;
  node.textContent = message || "";
  node.classList.toggle("is-ok", Boolean(ok));
  node.classList.toggle("is-fail", Boolean(message) && !ok);
}

function contactSaveInput(fromEditor) {
  if (fromEditor) {
    const typed = state.root?.querySelector('#cv2EditorForm input[name="contactNumber"]')?.value;
    return String(typed || "").trim();
  }
  return String(currentViewModel().contactNumber || "").trim();
}

async function runDeviceContactSave(fromEditor) {
  const phone = contactSaveInput(fromEditor);
  const vm = currentViewModel();
  showContactSaveStatus("", false);
  const result = await saveDeviceContact({
    phone,
    advertiserName: vm.advertiserName,
    officeName: currentOfficeName()
  }, {
    contacts: window.navigator?.contacts
  });
  if (fromEditor) {
    showContactSaveStatus(result.message, result.ok);
    return;
  }
  window.alert(result.message);
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
  state.root.querySelector("#cv2EditorContactSave")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void runDeviceContactSave(true);
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
  root.querySelectorAll(".cv2-details [data-cv2-save-device-contact]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void runDeviceContactSave(false);
    });
  });
  root.querySelector("[data-cv2-toggle-details]")?.addEventListener("click", () => {
    state.dataCardExpanded = !state.dataCardExpanded;
    const card = root.querySelector("[data-cv2-data-card]");
    const btn = root.querySelector("[data-cv2-toggle-details]");
    const label = btn?.querySelector("[data-cv2-toggle-label]");
    if (card) {
      card.classList.toggle("is-expanded", state.dataCardExpanded);
      card.classList.toggle("is-collapsed", !state.dataCardExpanded);
    }
    if (btn) btn.setAttribute("aria-expanded", state.dataCardExpanded ? "true" : "false");
    if (label) label.textContent = state.dataCardExpanded ? "إخفاء التفاصيل" : "عرض التفاصيل";
  });
}

function renderPage() {
  if (!state.root) return;
  state.root.innerHTML = buildOpportunityDetailsContentV2(currentViewModel(), {
    dataCardExpanded: state.dataCardExpanded
  });
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
  state.dataCardExpanded = false;
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
  state.dataCardExpanded = false;
  renderPage();
  await hydrate(gen);
}
