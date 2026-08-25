/**
 * QA harness boot. Mounts production daily-task / inbox / editor modules
 * against the local in-memory worker. Not loaded by production index.html.
 */

import { mountDailyTasksContentV2 } from "../v2/daily-tasks/controller.js";
import { buildBankInboxCardHtml } from "../bank-inbox-card-ui.js";
import { evaluateMatchingReadiness } from "../opportunity-readiness-domain.js";
import { mapOpportunityDetailsV2ViewModel } from "../opportunity-details-v2-domain.js";
import { buildFieldEditorV2, wireFieldEditorSheet } from "../v2/opportunity-details/editor.js";
import { saveV2FieldWithAdapter } from "../opportunity-details-v2.js";
import { firstMissingEditor } from "../v2/opportunity-details/view-model.js";

const params = new URLSearchParams(location.search);
const officeId = params.get("officeId") || "qa-office-client";
const officeName = officeId === "qa-office-wadi" ? "مكتب الوادي العقاري" : "مكتب النور العقاري";

window.__QA_OPENED__ = "";
window.open = (url) => {
  window.__QA_OPENED__ = String(url || "");
  return { closed: false };
};

window.firebase = {
  auth: () => ({
    currentUser: {
      uid: `qa-broker-${officeId}`,
      getIdToken: async () => "qa-token"
    }
  })
};

window.IAQAR = window.IAQAR || {};
window.IAQAR.office = {
  officeId,
  officeName,
  name: officeName,
  workerBase: location.origin
};
window.IAQAR.workerBase = location.origin;
window.IAQAR.resolveWorkerBase = () => location.origin;
window.IAQAR.whatsappHandoff = {
  openWhatsApp({ phone, text }) {
    const digits = String(phone || "").replace(/\D/g, "");
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(String(text || ""))}`;
    window.__QA_OPENED__ = url;
    return { ok: true, url };
  }
};

const records = new Map();
const toastNode = document.getElementById("toast");

function toast(message) {
  if (!toastNode) return;
  toastNode.textContent = message;
  toastNode.classList.add("show");
  toastNode.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastNode.classList.remove("show"), 2800);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.message || payload.error || "request_failed");
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function loadOperations() {
  const payload = await fetchJson(`/qa/operations?officeId=${encodeURIComponent(officeId)}`);
  window.IAQAR.operationsItems = payload.items || [];
  window.dispatchEvent(new CustomEvent("iaqar:operations-data", { detail: { items: payload.items || [] } }));
}

async function loadInbox() {
  const payload = await fetchJson(`/qa/opportunities?officeId=${encodeURIComponent(officeId)}`);
  records.clear();
  for (const row of payload.records || []) records.set(row.id, row);
  renderInbox();
}

function renderInbox() {
  const root = document.getElementById("inboxRoot");
  if (!root) return;
  const rows = [...records.values()];
  const needs = rows.filter((row) => evaluateMatchingReadiness(row).isReadyForMatching === false);
  const ready = rows.filter((row) => !needs.includes(row));
  const section = (title, items) => {
    if (!items.length) return "";
    return `<p class="cv2-inbox-section">${title}</p><div class="cv2-inbox-section-rule"></div>${items.map((row) => buildBankInboxCardHtml(row)).join("")}`;
  };
  root.innerHTML = `${section("يحتاج استكمال", needs)}${section("قيد المطابقة", ready)}`;
}

function showEditorError(article, message) {
  const node = article.querySelector("#cv2EditorError");
  if (!node) return;
  node.hidden = false;
  node.textContent = message;
}

async function submitInboxEditor(article, editorKey, formData) {
  const id = article.getAttribute("data-opportunity-id");
  const existing = records.get(id);
  if (!existing) return;
  try {
    const result = await saveV2FieldWithAdapter(existing, editorKey, formData, async (patch) => {
      const persisted = await fetch("/opportunity/patch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Office-Id": officeId },
        body: JSON.stringify({ officeId, opportunityId: id, editorKey, formData, patch })
      });
      const payload = await persisted.json().catch(() => ({}));
      if (!persisted.ok || payload.ok === false) {
        throw Object.assign(new Error(payload.message || payload.error || "تعذر حفظ الحقل، حاول مرة أخرى"), payload);
      }
      return { reloaded: payload.reloaded, readiness: payload.readiness };
    });
    if (!result?.ok) {
      showEditorError(article, result?.error || "تعذر حفظ الحقل، حاول مرة أخرى");
      return { ok: false };
    }
    records.set(id, { ...result.reloaded, id });
    toast("تم الحفظ");
    const wasIncomplete = evaluateMatchingReadiness(existing).isReadyForMatching === false;
    const nowReady = Boolean(result.readiness?.isReadyForMatching);
    if (wasIncomplete && nowReady) toast("تم استكمال البيانات وانتقل العرض إلى قيد المطابقة");
    article.querySelector("[data-cv2-editor-root]")?.remove();
    renderInbox();
    return { ok: true };
  } catch (error) {
    showEditorError(article, error?.message || "تعذر حفظ الحقل، حاول مرة أخرى");
    return { ok: false };
  }
}

function openInboxEditor(article, editorKey, opener) {
  const id = article.getAttribute("data-opportunity-id");
  const record = records.get(id);
  if (!article || !editorKey || !record) return;
  article.querySelector("[data-cv2-editor-root]")?.remove();
  const vm = mapOpportunityDetailsV2ViewModel(id, record);
  article.insertAdjacentHTML("beforeend", buildFieldEditorV2(editorKey, vm));
  const overlay = article.querySelector("[data-cv2-editor-root]");
  const form = overlay?.querySelector("#cv2EditorForm");
  wireFieldEditorSheet(overlay, { opener });
  form?.querySelector("input")?.focus();
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitInboxEditor(article, editorKey, Object.fromEntries(new FormData(form).entries()));
  });
}

function switchTab(name) {
  const tasks = document.getElementById("contentV2");
  const offers = document.getElementById("inboxRoot");
  const settings = document.getElementById("settingsRoot");
  tasks.hidden = name !== "tasks";
  offers.hidden = name !== "offers";
  settings.hidden = name !== "settings";
  document.querySelectorAll("[data-qa-tab]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-qa-tab") === name);
  });
}

function bind() {
  document.querySelectorAll("[data-qa-tab]").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.getAttribute("data-qa-tab")));
  });
  document.getElementById("inboxRoot")?.addEventListener("click", (event) => {
    const complete = event.target.closest("[data-cv2-complete]");
    const editor = event.target.closest("[data-cv2-editor]");
    const article = event.target.closest("[data-cv2-inbox-item]");
    if (!article) return;
    if (complete) {
      const record = records.get(article.getAttribute("data-opportunity-id"));
      const vm = mapOpportunityDetailsV2ViewModel(record.id, record);
      openInboxEditor(article, firstMissingEditor(vm) || "location", complete);
      return;
    }
    if (editor) {
      openInboxEditor(article, editor.getAttribute("data-cv2-editor"), editor);
    }
  });
}

async function boot() {
  bind();
  mountDailyTasksContentV2(document.getElementById("contentV2"));
  await loadOperations();
  await loadInbox();
  window.addEventListener("iaqar:operations-refresh", () => { void loadOperations(); });
  const tab = params.get("tab") || "tasks";
  switchTab(tab);
}

void boot();
