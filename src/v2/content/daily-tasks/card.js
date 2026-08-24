/**
 * Compact daily-task execution card. Not the opportunity data card.
 */

function escapeContentHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function buttonHtml(action, kind) {
  if (!action?.id || !action?.label) return "";
  const cls = kind === "primary" ? "cv2-exec-primary" : "cv2-exec-secondary";
  const attr = kind === "primary" ? "data-cv2-exec-primary" : "data-cv2-exec-secondary";
  return `<button type="button" class="${cls}" ${attr}="${escapeContentHtml(action.id)}">${escapeContentHtml(action.label)}</button>`;
}

export function buildDailyTaskCardHtml(task = {}) {
  const badge = task.badgeLabel
    ? `<span class="cv2-exec-badge${task.badgeKey === "overdue" ? " is-late" : ""}">${escapeContentHtml(task.badgeLabel)}</span>`
    : "";
  const money = task.moneyLine
    ? `<p class="cv2-exec-money">${escapeContentHtml(task.moneyLine)}</p>`
    : "";
  const next = task.nextActionLine
    ? `<p class="cv2-exec-next">${escapeContentHtml(task.nextActionLine)}</p>`
    : "";
  const primary = buttonHtml(task.primaryAction, "primary");
  const secondary = (task.secondaryActions || []).map((action) => buttonHtml(action, "secondary")).join("");
  return `<article
      class="cv2-exec-card"
      data-cv2-exec-task
      data-task-state="${escapeContentHtml(task.stateKey || "")}"
      data-task-id="${escapeContentHtml(task.id || "")}"
      data-match-id="${escapeContentHtml(task.matchId || "")}"
      data-offer-id="${escapeContentHtml(task.offerId || "")}"
      data-request-id="${escapeContentHtml(task.requestId || "")}"
      data-opportunity-id="${escapeContentHtml(task.opportunityId || "")}"
      data-session-kind="${escapeContentHtml(task.sessionKind || "CLIENT_MATCH_REVIEW")}">
    <header class="cv2-exec-head">
      <p class="cv2-exec-kind">${escapeContentHtml(task.kindLabel || "")}</p>
      ${badge}
    </header>
    <p class="cv2-exec-summary">${escapeContentHtml(task.propertyLine || "")}</p>
    ${money}
    <p class="cv2-exec-status">${escapeContentHtml(task.statusLabel || "")}</p>
    ${next}
    <div class="cv2-exec-actions">${primary}${secondary}</div>
  </article>`;
}

export function buildDailyTaskEmptyHtml() {
  return `<section class="cv2-exec-empty" data-cv2-exec-empty>
    <p class="cv2-exec-empty-title">لا توجد مهام تحتاج إجراء الآن</p>
    <p class="cv2-exec-empty-hint">ستظهر هنا المطابقات والمتابعات التي تحتاج تدخلك.</p>
  </section>`;
}

export function buildDailyTaskListHtml(tasks = []) {
  if (!tasks.length) return buildDailyTaskEmptyHtml();
  return `<div class="cv2-exec-list" data-cv2-exec-list>
    ${tasks.map((task) => buildDailyTaskCardHtml(task)).join("")}
  </div>`;
}
