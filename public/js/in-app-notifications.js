/**
 * In-app notification center. Realtime listener only — no polling.
 * Tap opens the same Daily Task; does not create a new workflow.
 */

import {
  mapNotificationView,
  notificationTapTarget,
  sortNotifications,
  unreadNotificationCount
} from "./in-app-notification-domain.js";

const state = {
  rows: [],
  unsub: null,
  officeId: "",
  open: false
};

function $(id) {
  return document.getElementById(id);
}

function officeRuntime() {
  return window.IAQAR?.office || {};
}

function officeId() {
  return String(officeRuntime().officeId || "").trim();
}

function workerBase() {
  return String(window.IAQAR?.workerBase || officeRuntime().workerBase || "").replace(/\/+$/, "");
}

function authUser() {
  try {
    return window.firebase?.auth?.()?.currentUser || null;
  } catch {
    return null;
  }
}

function renderBell(count) {
  const badge = $("inAppNotifBadge");
  const bell = $("inAppNotifBell");
  if (badge) {
    badge.hidden = count < 1;
    badge.textContent = count > 99 ? "99+" : String(count);
  }
  if (bell) {
    bell.setAttribute("aria-label", count ? `التنبيهات، ${count} غير مقروء` : "التنبيهات");
  }
}

function renderPanel() {
  const list = $("inAppNotifList");
  if (!list) return;
  const views = sortNotifications(state.rows.map((row) => mapNotificationView(row)));
  if (!views.length) {
    list.innerHTML = `<p class="in-app-notif-empty">لا توجد تنبيهات بعد.</p>`;
    return;
  }
  list.innerHTML = views.map((row) => `
    <button type="button" class="in-app-notif-item${row.unread ? " is-unread" : ""}" data-notif-id="${row.id}" data-task-id="${row.taskId}" data-match-id="${row.matchId}">
      <strong>${escapeHtml(row.title || "تنبيه")}</strong>
      ${row.referenceCode ? `<span class="in-app-notif-ref">${escapeHtml(row.referenceCode)}</span>` : ""}
      <span class="in-app-notif-time">${escapeHtml(row.clockLabel || "")}</span>
    </button>`).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function setOpen(open) {
  state.open = Boolean(open);
  const panel = $("inAppNotifPanel");
  const bell = $("inAppNotifBell");
  if (panel) panel.hidden = !state.open;
  if (bell) bell.setAttribute("aria-expanded", state.open ? "true" : "false");
}

async function markRead(id) {
  const user = authUser();
  const currentOffice = officeId();
  if (!user?.getIdToken || !currentOffice || !id) return;
  const token = await user.getIdToken();
  const response = await fetch(`${workerBase()}/notifications/read`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Office-Id": currentOffice
    },
    body: JSON.stringify({ officeId: currentOffice, notificationId: id })
  });
  if (!response.ok) {
    console.warn("[iaqar] notification read failed", await response.text().catch(() => ""));
  }
}

function openDailyTaskFromNotification(row) {
  const target = notificationTapTarget(row);
  const detail = {
    id: target.taskId || target.operationId || target.matchId,
    taskId: target.taskId,
    matchId: target.matchId,
    matchGroupId: target.taskId,
    opportunityId: target.opportunityId,
    operationId: target.operationId
  };
  window.IAQAR = window.IAQAR || {};
  window.IAQAR.pendingDailyTaskOpen = detail;
  window.IAQAR?.homeTabs?.switchTo?.("operations");
  window.dispatchEvent(new CustomEvent("iaqar:open-operation", { detail }));
  window.dispatchEvent(new CustomEvent("iaqar:open-daily-task", { detail }));
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent("iaqar:open-daily-task", { detail }));
  }, 80);
}

async function onItemClick(event) {
  const button = event.target.closest("[data-notif-id]");
  if (!button) return;
  const id = button.getAttribute("data-notif-id");
  const row = state.rows.find((item) => item.id === id);
  if (!row) return;
  setOpen(false);
  await markRead(id);
  openDailyTaskFromNotification(row);
}

function listen(runtimeOfficeId) {
  const db = officeRuntime().db;
  if (!db || !runtimeOfficeId) return;
  if (state.unsub) state.unsub();
  state.officeId = runtimeOfficeId;
  state.unsub = db.collection("offices").doc(runtimeOfficeId)
    .collection("notifications")
    .orderBy("createdAt", "desc")
    .limit(40)
    .onSnapshot((snap) => {
      state.rows = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
      renderBell(unreadNotificationCount(state.rows));
      if (state.open) renderPanel();
    }, (error) => {
      console.warn("[iaqar] notifications listener", error);
    });
}

function boot() {
  const bell = $("inAppNotifBell");
  const close = $("inAppNotifClose");
  const list = $("inAppNotifList");
  if (!bell) return;
  bell.addEventListener("click", () => {
    setOpen(!state.open);
    if (state.open) renderPanel();
  });
  close?.addEventListener("click", () => setOpen(false));
  list?.addEventListener("click", (event) => void onItemClick(event));
  document.addEventListener("click", (event) => {
    if (!state.open) return;
    if (event.target.closest("#inAppNotifPanel") || event.target.closest("#inAppNotifBell")) return;
    setOpen(false);
  });
  window.addEventListener("iaqar:firebase-ready", () => listen(officeId()));
  if (officeId() && officeId() !== "platform") listen(officeId());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
