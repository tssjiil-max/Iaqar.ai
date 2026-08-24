/**
 * Compact task-summary cards. Density only — callers pass a derived view-model.
 * Does not load Firestore or change routing.
 */

import { escapeContentHtml } from "./domain.js";

export const COMPACT_TASK_KINDS = Object.freeze([
  "opportunity",
  "listing",
  "request",
  "alert",
  "followup",
  "appointment",
  "match",
  "missing",
  "negotiation",
  "deal",
  "task"
]);

function iconUse(id) {
  return `<svg class="cv2-icon" aria-hidden="true"><use href="#${escapeContentHtml(id)}"/></svg>`;
}

function fieldRow(field) {
  const missing = Boolean(field?.missing);
  const value = missing
    ? `<span class="cv2-missing-pair"><span class="cv2-missing-badge">ناقص</span><span class="cv2-missing-text">غير محدد</span></span>`
    : `<span class="cv2-value-primary">${escapeContentHtml(field?.primary || "-")}</span>
      ${field?.secondary ? `<span class="cv2-value-secondary">${escapeContentHtml(field.secondary)}</span>` : ""}`;
  return `<div class="cv2-row">
    <span class="cv2-row-key">
      <span class="cv2-row-label">${escapeContentHtml(field?.label || "")}</span>
    </span>
    <span class="cv2-row-split" aria-hidden="true"></span>
    <span class="cv2-row-value">${value}</span>
  </div>`;
}

export function buildCompactTaskCard(task = {}, { expanded = false } = {}) {
  const id = escapeContentHtml(task.id || "");
  const extra = Array.isArray(task.extraFields) ? task.extraFields : [];
  const summary = Array.isArray(task.summaryFields) ? task.summaryFields : [];
  const extraId = `cv2TaskExtra-${id || "x"}`;
  const toggleLabel = expanded ? "إخفاء التفاصيل" : "عرض التفاصيل";
  return `<article class="cv2-card cv2-task-card ${expanded ? "is-expanded" : "is-collapsed"}" data-cv2-task-card data-cv2-task-kind="${escapeContentHtml(task.kind || "task")}" data-cv2-task-id="${id}">
    <header class="cv2-card-head">
      ${iconUse(task.icon || "i-clipboard-list")}
      <div class="cv2-card-head-text">
        <p class="cv2-task-kind">${escapeContentHtml(task.kindLabel || "مهمة")}</p>
        <h2 class="cv2-card-title">${escapeContentHtml(task.title || "")}</h2>
      </div>
    </header>
    <div class="cv2-rows">
      ${summary.map(fieldRow).join("")}
      ${extra.length ? `<div class="cv2-extra" id="${extraId}"><div class="cv2-extra-inner">${extra.map(fieldRow).join("")}</div></div>` : ""}
    </div>
    <p class="cv2-next-action">${escapeContentHtml(task.nextAction || "الإجراء التالي: متابعة المهمة")}</p>
    <button type="button" class="cv2-details-toggle" data-cv2-task-toggle aria-expanded="${expanded ? "true" : "false"}" aria-controls="${extraId}">
      <span data-cv2-toggle-label>${toggleLabel}</span>
      <svg class="cv2-icon cv2-toggle-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </button>
  </article>`;
}

export function buildCompactTaskList(tasks = [], { expandedId = "" } = {}) {
  const cards = tasks.map((task) => buildCompactTaskCard(task, { expanded: task.id === expandedId })).join("");
  return `<div class="cv2-task-list" data-cv2-task-list>${cards}</div>`;
}

export function bindCompactTaskAccordion(root) {
  if (!root) return;
  root.querySelectorAll("[data-cv2-task-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest("[data-cv2-task-card]");
      if (!card) return;
      const opening = card.classList.contains("is-collapsed");
      root.querySelectorAll("[data-cv2-task-card]").forEach((node) => {
        const expanded = opening && node === card;
        node.classList.toggle("is-expanded", expanded);
        node.classList.toggle("is-collapsed", !expanded);
        const toggle = node.querySelector("[data-cv2-task-toggle]");
        const label = toggle?.querySelector("[data-cv2-toggle-label]");
        if (toggle) toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
        if (label) label.textContent = expanded ? "إخفاء التفاصيل" : "عرض التفاصيل";
      });
    });
  });
}
