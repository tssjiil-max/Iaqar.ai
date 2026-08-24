import { escapeContentHtml } from "../domain.js";

function iconUse(id) {
  return `<svg class="cv2-icon" aria-hidden="true"><use href="#${escapeContentHtml(id)}"/></svg>`;
}

export function buildDailyReportCardV2(vm = {}) {
  const activities = Array.isArray(vm.activities) ? vm.activities : [];
  const rows = activities.map((row) => `<li class="cv2-report-row">
    <time class="cv2-report-time">${escapeContentHtml(row.time || "-")}</time>
    <span class="cv2-report-action">${escapeContentHtml(row.title || "-")}</span>
    <span class="cv2-report-result">
      <span class="cv2-report-check" aria-hidden="true">${iconUse("i-check-circle")}</span>
      <span>${escapeContentHtml(row.result || "-")}</span>
    </span>
  </li>`).join("");

  return `<section class="cv2-card" aria-label="تقرير اليوم">
    <header class="cv2-card-head">
      ${iconUse("i-list")}
      <h2 class="cv2-card-title">تقرير اليوم</h2>
    </header>
    <div class="cv2-report-head" aria-hidden="true">
      <span>الوقت</span>
      <span>الإجراء</span>
      <span>النتيجة</span>
    </div>
    <ul class="cv2-report-list">${rows}</ul>
    <p class="cv2-result-bar">
      <span class="cv2-info-dot" aria-hidden="true">${iconUse("i-info")}</span>
      <span>${escapeContentHtml(vm.currentResult || "النتيجة الحالية: -")}</span>
    </p>
  </section>`;
}
