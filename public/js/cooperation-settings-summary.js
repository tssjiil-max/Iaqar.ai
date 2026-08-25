/**
 * Compact current-cooperation summary inside Office Settings.
 * Not a daily operational list.
 */

import {
  cooperationHistorySummaryLine,
  summarizeCooperationHistory
} from "./cooperation-workflow-domain.js";

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function officeRuntime() {
  return window.IAQAR && window.IAQAR.office ? window.IAQAR.office : null;
}

function officeId() {
  return (officeRuntime() && officeRuntime().officeId) || "";
}

function renderSummary(rows) {
  const root = document.getElementById("cooperationHistorySummary");
  if (!root) return;
  if (!rows.length) {
    root.innerHTML = `<p class="section-help">لا يوجد تعاون حالي للعرض.</p>`;
    return;
  }
  root.innerHTML = rows.map((row) => `
    <div class="coop-summary-card">
      <div>
        <strong>${escapeHtml(row.partnerName)}</strong>
        <span>${escapeHtml(cooperationHistorySummaryLine(row))}</span>
      </div>
      <button type="button" data-coop-summary-open="${escapeHtml(row.partnerOfficeId)}">عرض</button>
    </div>
  `).join("");
  root.querySelectorAll("[data-coop-summary-open]").forEach((button) => {
    button.addEventListener("click", () => {
      window.IAQAR?.homeTabs?.switchTo?.("tasks");
    });
  });
}

async function loadSummary() {
  const runtime = officeRuntime();
  const root = document.getElementById("cooperationHistorySummary");
  if (!runtime?.db || !root || !officeId()) return;
  try {
    const [outSnap, inSnap] = await Promise.all([
      runtime.db.collection("cooperationRequests").where("originatingOfficeId", "==", officeId()).limit(30).get(),
      runtime.db.collection("cooperationRequests").where("targetOfficeId", "==", officeId()).limit(30).get()
    ]);
    const rows = [...outSnap.docs, ...inSnap.docs].map((doc) => ({ id: doc.id, ...doc.data() }));
    renderSummary(summarizeCooperationHistory(rows, { officeId: officeId() }));
  } catch (error) {
    console.warn("[iaqar] cooperation summary", error);
  }
}

window.addEventListener("iaqar:office-settings-opened", () => {
  void loadSummary();
});
