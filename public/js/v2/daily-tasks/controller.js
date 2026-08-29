/**
 * Mounts compact daily-task accordion cards into #contentV2.
 * Wires send/open actions only. Does not claim WhatsApp delivery.
 */

import { buildDailyTaskListHtml } from "./card.js";
import {
  dailyTasksDemoFixtures,
  mapOperationsItemsToDailyTasks,
  consumeDailyTaskDiagnostics
} from "./domain.js";
import {
  COOPERATION_ACTION,
  requestCooperationWorkflow,
  workflowActionFromButton
} from "../../cooperation-workflow-domain.js";
import { requestCooperationLifecycle } from "../../cooperation-phase6-domain.js";
import {
  buildListingShareMessage,
  whatsAppShareUrl
} from "../../listing-share-domain.js";
import {
  buildPartyWhatsAppMessage,
  missingPartyPhoneMessage,
  PARTY_SEND_COPY,
  whatsappOpenedMessage
} from "./party-link-domain.js";
import { ensurePartyReviewLink, resolvePartyPhone } from "./party-link.js";
import { resolveDetailsOpportunityId } from "../../opportunity-data-flow-domain.js";

const state = {
  root: null,
  tasks: [],
  bound: false,
  openTaskId: null,
  detailsTaskId: null,
  scrollTop: 0
};

function useDemoFixtures() {
  try {
    return new URLSearchParams(window.location.search).get("cv2Tasks") === "1";
  } catch {
    return false;
  }
}

function currentTasks() {
  if (useDemoFixtures()) return dailyTasksDemoFixtures();
  return state.tasks;
}

function notify(message) {
  const toast = document.getElementById("toast");
  if (toast) {
    toast.textContent = message;
    toast.classList.add("show");
    toast.hidden = false;
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => {
      toast.classList.remove("show");
    }, 3200);
    return;
  }
  window.alert(message);
}

function setExecState(button, next) {
  if (!button) return;
  button.dataset.cv2ExecState = next;
  button.disabled = next === "working";
  button.setAttribute("aria-busy", next === "working" ? "true" : "false");
}

function openWhatsAppHandoff({ phone, text }) {
  const handoff = window.IAQAR?.whatsappHandoff;
  if (handoff?.openWhatsApp) return handoff.openWhatsApp({ phone, text });
  const digits = String(phone || "").replace(/\D/g, "");
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(String(text || ""))}`;
  if (typeof window !== "undefined") {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) window.location.href = url;
  }
  return { ok: true, url };
}

function officeDisplayName() {
  const office = window.IAQAR?.office || {};
  return String(office.officeName || office.displayName || office.name || "المكتب العقاري").trim()
    || "المكتب العقاري";
}

async function runPlatformOpportunityAction(task, actionId, button) {
  if (button?.dataset?.cv2ExecState === "working") return { ok: false, error: "busy" };
  setExecState(button, "working");
  try {
    const token = await idToken();
    const officeId = currentOfficeId();
    const path = actionId === "decline_platform_opportunity"
      ? "/opportunity-router/decline"
      : "/opportunity-router/accept";
    const response = await fetch(`${workerBase()}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        officeId,
        opportunityId: task.opportunityId,
        reason: actionId === "decline_platform_opportunity" ? "OTHER" : undefined
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      notify(payload.message || (actionId === "decline_platform_opportunity" ? "تعذر تسجيل الاعتذار." : "تعذر استلام الفرصة."));
      setExecState(button, "error");
      return { ok: false };
    }
    notify(actionId === "decline_platform_opportunity" ? "تم الاعتذار وستنقل الفرصة للمكتب التالي." : "تم استلام الفرصة.");
    setExecState(button, "success");
    window.dispatchEvent(new CustomEvent("iaqar:operations-refresh"));
    return { ok: true };
  } catch {
    notify("تعذر إتمام الإجراء.");
    setExecState(button, "error");
    return { ok: false };
  }
}

async function tickPlatformOpportunityExpiry() {
  const officeId = currentOfficeId();
  const token = await idToken();
  if (!officeId || !token) return;
  try {
    await fetch(`${workerBase()}/opportunity-router/tick`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ officeId })
    });
    await fetch(`${workerBase()}/cooperation/sync-coordination`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ officeId })
    });
  } catch {
    /* expiry is retried on the next load / action */
  }
}

function officeRuntime() {
  return window.IAQAR?.office || null;
}

function currentOfficeId() {
  return String(officeRuntime()?.officeId || "").trim();
}

function workerBase() {
  if (window.IAQAR && typeof window.IAQAR.resolveWorkerBase === "function") {
    return window.IAQAR.resolveWorkerBase();
  }
  return String(window.IAQAR?.workerBase || officeRuntime()?.workerBase || "").replace(/\/+$/, "");
}

async function idToken() {
  const user = window.firebase?.auth?.()?.currentUser;
  if (!user?.getIdToken) return "";
  return user.getIdToken();
}

async function runCooperationTaskAction(task, actionId, button) {
  if (button?.dataset?.cv2ExecState === "working") return { ok: false, error: "busy" };
  if (actionId === "open_details") {
    return toggleTaskDetails(task.id);
  }
  setExecState(button, "working");
  const token = await idToken();
  const officeId = currentOfficeId();
  const cooperationId = task.cooperationId || task.cooperationTaskId || task.id;
  try {
    let result;
    if (actionId === "request_cooperation") {
      const response = await fetch(`${workerBase()}/cooperation/request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          officeId,
          targetOfficeId: task.targetOfficeId,
          opportunityIds: [task.opportunityId].filter(Boolean),
          scopeType: "single"
        })
      });
      result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        result = { ok: false, message: result.message || "تعذر إرسال طلب التعاون." };
      } else {
        result = { ok: true, ...result };
      }
    } else if (actionId === "accept_cooperation" || actionId === "reject_cooperation") {
      result = await requestCooperationLifecycle({
        workerBase: workerBase(),
        idToken: token,
        officeId,
        cooperationId,
        action: actionId === "accept_cooperation" ? "ACCEPT" : "REJECT"
      });
    } else {
      const workflowAction = workflowActionFromButton(actionId) || COOPERATION_ACTION.REQUEST;
      result = await requestCooperationWorkflow({
        workerBase: workerBase(),
        idToken: token,
        officeId,
        cooperationId,
        action: workflowAction
      });
    }
    if (!result?.ok) {
      notify(result?.message || "تعذر حفظ حالة التعاون. أبقينا الحالة السابقة.");
      setExecState(button, "error");
      return { ok: false, error: result?.error || "persist_failed" };
    }
    notify(result.message || "تم حفظ حالة التعاون.");
    setExecState(button, "success");
    window.dispatchEvent(new CustomEvent("iaqar:operations-refresh"));
    return { ok: true, result };
  } catch {
    notify("تعذر حفظ حالة التعاون. أبقينا الحالة السابقة.");
    setExecState(button, "error");
    return { ok: false, error: "persist_failed" };
  }
}

function taskFromCard(card) {
  const id = card.getAttribute("data-task-id");
  const listed = currentTasks().find((item) => item.id === id) || {};
  return {
    ...listed,
    id,
    opportunityId: card.getAttribute("data-opportunity-id") || listed.opportunityId,
    offerId: card.getAttribute("data-offer-id") || listed.offerId,
    requestId: card.getAttribute("data-request-id") || listed.requestId,
    matchId: card.getAttribute("data-match-id") || listed.matchId,
    cooperationId: card.getAttribute("data-cooperation-id") || listed.cooperationId,
    counterpartOpportunityId: card.getAttribute("data-counterpart-id") || listed.counterpartOpportunityId,
    targetOfficeId: card.getAttribute("data-target-office") || listed.targetOfficeId,
    originatingOfficeId: card.getAttribute("data-origin-office") || listed.originatingOfficeId,
    taskKind: card.getAttribute("data-task-kind") || listed.taskKind
  };
}

export function toggleTaskDetails(taskId) {
  if (!taskId) return { ok: false, error: PARTY_SEND_COPY.detailsFailed };
  captureScroll();
  if (state.detailsTaskId === taskId) {
    state.detailsTaskId = null;
  } else {
    state.openTaskId = taskId;
    state.detailsTaskId = taskId;
  }
  renderList();
  return { ok: true, detailsOpen: state.detailsTaskId === taskId };
}

function detailsHost() {
  return document.querySelector("[data-cv2-exec-details-host]");
}

async function closeOfferDetailsSheet() {
  const sheet = document.querySelector("[data-cv2-exec-details-sheet]");
  if (detailsHost()) {
    try {
      const mod = await import("../opportunity-details/controller.js");
      mod.unmountOpportunityDetailsContentV2();
    } catch {
      /* unit tests do not load opportunity-details */
    }
  }
  sheet?.remove();
  restoreScroll();
}

function ensureOfferDetailsSheet() {
  let sheet = document.querySelector("[data-cv2-exec-details-sheet]");
  if (sheet) return sheet.querySelector("[data-cv2-exec-details-host]");
  document.body.insertAdjacentHTML("beforeend", `<div class="cv2-exec-details-sheet" data-cv2-exec-details-sheet data-testid="offer-details-sheet">
    <div class="cv2-exec-details-panel">
      <button type="button" class="cv2-exec-details-close" data-cv2-exec-close-sheet data-testid="close-offer-details">إغلاق التفاصيل</button>
      <div data-cv2-exec-details-host></div>
    </div>
  </div>`);
  document.querySelector("[data-cv2-exec-details-sheet]")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-cv2-exec-close-sheet]") || event.target.hasAttribute("data-cv2-exec-details-sheet")) {
      event.preventDefault();
      closeOfferDetailsSheet();
    }
  });
  return detailsHost();
}

export async function openExistingOfferDetails(task) {
  const offerId = resolveDetailsOpportunityId(task, "offer");
  const requestId = resolveDetailsOpportunityId(task, "request");
  const targetId = offerId || requestId;
  const taskId = String(task?.id || "").trim();
  if (useDemoFixtures()) return toggleTaskDetails(taskId);
  if (!targetId) {
    console.warn("[iaqar] INVALID_TASK_DATA", {
      taskId,
      matchId: task?.matchId || "",
      requestId: task?.requestId || "",
      offerId: task?.offerId || "",
      reason: "missing_offer_or_request_id"
    });
    notify("تعذر فتح التفاصيل — المرجع غير متوفر.");
    return { ok: false, error: PARTY_SEND_COPY.detailsFailed, integrity: "INVALID_TASK_DATA" };
  }
  captureScroll();
  if (taskId) state.openTaskId = taskId;
  const [{ loadOpportunityRecord }, details] = await Promise.all([
    import("../opportunity-details/data.js"),
    import("../opportunity-details/controller.js")
  ]);
  const record = await loadOpportunityRecord(targetId);
  if (!record) {
    console.warn("[iaqar] INVALID_TASK_DATA", {
      taskId,
      matchId: task?.matchId || "",
      requestId,
      offerId,
      targetId,
      reason: offerId ? "unresolved_offer" : "unresolved_request"
    });
    closeOfferDetailsSheet();
    notify(offerId ? "تعذر فتح تفاصيل العرض — السجل غير موجود." : "تعذر فتح تفاصيل الطلب — السجل غير موجود.");
    return { ok: false, error: PARTY_SEND_COPY.detailsFailed, integrity: "INVALID_TASK_DATA" };
  }
  const host = ensureOfferDetailsSheet();
  if (!host) {
    notify("تعذر فتح التفاصيل — الواجهة غير جاهزة.");
    return { ok: false, error: PARTY_SEND_COPY.detailsFailed, integrity: "INVALID_TASK_DATA" };
  }
  await details.mountOpportunityDetailsContentV2(host, { opportunityId: targetId });
  return { ok: true, offerId: targetId, detailsOpen: true };
}

function captureScroll() {
  const scroller = document.scrollingElement || document.documentElement;
  state.scrollTop = Number(scroller?.scrollTop || window.scrollY || 0);
}

function restoreScroll() {
  const scroller = document.scrollingElement || document.documentElement;
  if (scroller && Number.isFinite(state.scrollTop)) {
    scroller.scrollTop = state.scrollTop;
  }
}

async function recordOpenedExternal(task, party, phone, body) {
  const domain = window.IAQAR?.messagingDomain;
  const office = window.IAQAR?.office;
  const user = window.firebase?.auth?.()?.currentUser;
  if (!domain?.requestCreateMessageDraft || !office?.officeId || !user?.getIdToken) return;
  try {
    const idToken = await user.getIdToken();
    const created = await domain.requestCreateMessageDraft({
      workerBase: window.IAQAR?.workerBase || office.workerBase,
      idToken,
      officeId: office.officeId,
      channel: "whatsapp",
      role: party,
      contactPhone: phone,
      matchId: task.matchId || "",
      opportunityId: task.opportunityId || "",
      body,
      stage: "match_review"
    });
    const messageId = created?.messageId || created?.id;
    if (messageId && domain.requestMessageHandoff) {
      await domain.requestMessageHandoff({
        workerBase: window.IAQAR?.workerBase || office.workerBase,
        idToken,
        officeId: office.officeId,
        messageId,
        outcome: "OPENED_EXTERNAL"
      });
    }
  } catch {
    /* handoff is optional; WhatsApp already opened */
  }
}

export async function runDailyTaskPartySend(task, party, button) {
  if (button?.dataset?.cv2ExecState === "working") return { ok: false, error: "busy" };
  if (!task?.matchId || !task?.offerId || !task?.requestId || task.dataIntegrity === "INVALID_TASK_DATA") {
    notify(PARTY_SEND_COPY.detailsFailed);
    return { ok: false, integrity: "INVALID_TASK_DATA" };
  }
  setExecState(button, "working");
  const side = party === "owner" ? "owner" : "client";
  try {
    const contact = await resolvePartyPhone(task, side);
    if (!contact?.digits) {
      notify(missingPartyPhoneMessage(side));
      setExecState(button, "error");
      return { ok: false, error: "missing_phone" };
    }
    const link = await ensurePartyReviewLink(task, side);
    if (!link?.url) {
      notify(PARTY_SEND_COPY.linkFailed);
      setExecState(button, "error");
      return { ok: false, error: "link_failed" };
    }
    const text = buildPartyWhatsAppMessage({
      party: side,
      officeName: link.officeName || officeDisplayName(),
      contactName: contact.name || (side === "owner" ? task.ownerName : task.clientName) || "",
      propertyLine: task.propertyLine || "",
      reviewUrl: link.url
    });
    const opened = openWhatsAppHandoff({ phone: contact.digits, text });
    if (!opened?.ok) {
      notify(PARTY_SEND_COPY.whatsappFailed);
      setExecState(button, "error");
      return { ok: false, error: "whatsapp_failed" };
    }
    void recordOpenedExternal(task, side, contact.digits, text);
    notify(whatsappOpenedMessage(side));
    setExecState(button, "success");
    return { ok: true, phone: contact.digits, url: link.url, text, opened };
  } catch {
    notify(PARTY_SEND_COPY.sendFailed);
    setExecState(button, "error");
    return { ok: false, error: "send_failed" };
  }
}

function toggleOpenTask(taskId) {
  if (!taskId) return;
  captureScroll();
  if (state.openTaskId === taskId) {
    state.openTaskId = null;
    state.detailsTaskId = null;
  } else {
    state.openTaskId = taskId;
  }
  renderList();
}

function shareTaskDetails(task) {
  const record = {
    opportunityKind: task.opportunityKind,
    propertyType: task.propertyType,
    city: task.city,
    district: task.district,
    priceOrBudget: String(task.priceOrBudget || task.moneyLine || "").replace(/[^\d.]/g, ""),
    area: String(task.sourceListing?.area || task.proposedListing?.area || "").replace(/[^\d.]/g, "")
  };
  const office = window.IAQAR?.office || {};
  const text = buildListingShareMessage(record, {
    officeName: office.officeName || office.displayName || office.name || "",
    brokerName: office.brokerName || "",
    licenseNumber: office.licenseNumber || "",
    publicSlug: office.publicSlug || "",
    officeId: office.officeId || ""
  }, { includeContactPhone: false });
  const url = whatsAppShareUrl(text);
  if (typeof window !== "undefined") {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) window.location.href = url;
  }
  notify("تم فتح واتساب");
  return { ok: true };
}

async function confirmViewingAppointment(task, button) {
  if (button?.dataset?.cv2ExecState === "working") return { ok: false, error: "busy" };
  setExecState(button, "working");
  try {
    const token = await idToken();
    const officeId = currentOfficeId();
    const response = await fetch(`${workerBase()}/match/living-action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        officeId,
        matchId: task.matchId,
        action: "CONFIRM_VIEWING"
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      notify(payload.message || "تعذر تأكيد المعاينة.");
      setExecState(button, "error");
      return { ok: false };
    }
    notify("تم تأكيد المعاينة");
    setExecState(button, "success");
    window.dispatchEvent(new CustomEvent("iaqar:operations-refresh"));
    return { ok: true };
  } catch {
    notify("تعذر تأكيد المعاينة.");
    setExecState(button, "error");
    return { ok: false };
  }
}

async function confirmDealCompletion(task, button) {
  if (button?.dataset?.cv2ExecState === "working") return { ok: false, error: "busy" };
  setExecState(button, "working");
  try {
    const token = await idToken();
    const officeId = currentOfficeId();
    const response = await fetch(`${workerBase()}/match/living-action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        officeId,
        matchId: task.matchId,
        action: "CONFIRM_COMPLETION"
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      notify(payload.message || "تعذر تأكيد إتمام الصفقة.");
      setExecState(button, "error");
      return { ok: false };
    }
    notify("تم إتمام الصفقة");
    setExecState(button, "success");
    window.dispatchEvent(new CustomEvent("iaqar:operations-refresh"));
    return { ok: true };
  } catch {
    notify("تعذر تأكيد إتمام الصفقة.");
    setExecState(button, "error");
    return { ok: false };
  }
}

function handleReviewNextCandidate(task, button) {
  if (state.openTaskId !== task.id) {
    toggleOpenTask(task.id);
    return;
  }
  if (task.hasRejectedCandidate && task.hasNextCandidate) {
    toggleTaskDetails(task.id);
    return;
  }
  if (task.canSendToClient && task.matchId && task.offerId && task.requestId) {
    void runDailyTaskPartySend(task, "client", button);
    return;
  }
  const result = openExistingOfferDetails(task);
  if (result && typeof result.then === "function") {
    void result.then((done) => {
      if (!done?.ok && done?.error) notify(done.error);
    });
  } else if (result && result.ok === false) {
    notify(result.error || PARTY_SEND_COPY.detailsFailed);
  }
}

function onListClick(event) {
  const root = state.root;
  if (!root) return;
  const closeSheet = event.target.closest("[data-cv2-exec-close-sheet]");
  if (closeSheet) {
    event.preventDefault();
    event.stopPropagation();
    closeOfferDetailsSheet();
    return;
  }
  const closeDetails = event.target.closest("[data-cv2-exec-close-details]");
  if (closeDetails) {
    event.preventDefault();
    event.stopPropagation();
    captureScroll();
    state.detailsTaskId = null;
    renderList();
    return;
  }
  const card = event.target.closest("[data-cv2-exec-task]");
  if (!card || !root.contains(card)) return;
  const task = taskFromCard(card);
  const secondary = event.target.closest("[data-cv2-exec-secondary]");
  if (secondary) {
    event.preventDefault();
    event.stopPropagation();
    const action = secondary.getAttribute("data-cv2-exec-secondary");
    if (action === "open_offer" || action === "open_details") {
      const result = openExistingOfferDetails(task);
      if (result && typeof result.then === "function") {
        void result.then((done) => {
          if (!done?.ok && done?.error) notify(done.error);
        });
      } else if (result && result.ok === false) {
        notify(result.error || PARTY_SEND_COPY.detailsFailed);
      }
      return;
    }
    if (action === "complete_info") {
      toggleTaskDetails(task.id);
      return;
    }
    if (action === "share_details") {
      shareTaskDetails(task);
      return;
    }
    if (action === "review_next_candidate") {
      handleReviewNextCandidate(task, secondary);
      return;
    }
    if (task.taskKind === "platform_opportunity") {
      void runPlatformOpportunityAction(task, action, secondary);
      return;
    }
    if (task.taskKind === "cooperation") {
      if (action === "send_to_owner") {
        void runDailyTaskPartySend(task, "owner", secondary);
        return;
      }
      void runCooperationTaskAction(task, action, secondary);
      return;
    }
    if (action === "send_to_owner") {
      void runDailyTaskPartySend(task, "owner", secondary);
      return;
    }
    if (action === "resend_to_client") {
      void runDailyTaskPartySend(task, "client", secondary);
    }
    return;
  }
  const primary = event.target.closest("[data-cv2-exec-primary]");
  if (primary) {
    event.preventDefault();
    event.stopPropagation();
    const action = primary.getAttribute("data-cv2-exec-primary");
    if (task.taskKind === "platform_opportunity") {
      void runPlatformOpportunityAction(task, action, primary);
      return;
    }
    if (task.taskKind === "cooperation") {
      if (action === "send_to_owner") {
        void runDailyTaskPartySend(task, "owner", primary);
        return;
      }
      void runCooperationTaskAction(task, action, primary);
      return;
    }
    if (action === "send_to_client" || action === "resend_to_client") {
      void runDailyTaskPartySend(task, "client", primary);
      return;
    }
    if (action === "confirm_deal") {
      void confirmDealCompletion(task, primary);
      return;
    }
    if (action === "confirm_viewing") {
      void confirmViewingAppointment(task, primary);
      return;
    }
    if (action === "complete_info") {
      toggleTaskDetails(task.id);
      return;
    }
    if (action === "review_next_candidate") {
      handleReviewNextCandidate(task, primary);
      return;
    }
    if (action === "send_to_owner") {
      void runDailyTaskPartySend(task, "owner", primary);
    }
    return;
  }
  const reveal = event.target.closest("[data-cv2-exec-reveal]");
  if (!reveal) return;
  event.preventDefault();
  toggleOpenTask(card.getAttribute("data-task-id"));
}

function consumePendingDailyTaskOpen() {
  const pending = typeof window !== "undefined" ? window.IAQAR?.pendingDailyTaskOpen : null;
  if (!pending) return;
  const task = findTaskForNotification(pending);
  if (!task) return;
  window.IAQAR.pendingDailyTaskOpen = null;
  if (state.openTaskId !== task.id) toggleOpenTask(task.id);
  else {
    window.requestAnimationFrame(() => {
      state.root?.querySelector(`[data-task-id="${task.id}"]`)?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    });
  }
}

function renderList() {
  if (!state.root) return;
  state.root.innerHTML = buildDailyTaskListHtml(currentTasks(), {
    openTaskId: state.openTaskId,
    detailsTaskId: state.detailsTaskId
  });
  restoreScroll();
  consumePendingDailyTaskOpen();
}

function onOperationsData(event) {
  if (useDemoFixtures()) return;
  const items = Array.isArray(event.detail?.items) ? event.detail.items : [];
  state.tasks = mapOperationsItemsToDailyTasks(items, new Date(), { officeId: currentOfficeId() });
  const invalid = consumeDailyTaskDiagnostics();
  if (invalid.length && typeof window !== "undefined") window.__IAQAR_INVALID_DAILY_TASKS__ = invalid;
  if (state.openTaskId && !state.tasks.some((task) => task.id === state.openTaskId)) {
    state.openTaskId = null;
    state.detailsTaskId = null;
    closeOfferDetailsSheet();
  }
  renderList();
}

function findTaskForNotification(detail = {}) {
  const taskId = String(detail.taskId || detail.id || "").trim();
  const matchId = String(detail.matchId || "").trim();
  const opportunityId = String(detail.opportunityId || "").trim();
  const operationId = String(detail.operationId || "").trim();
  return currentTasks().find((task) =>
    task.id === taskId
    || (matchId && (task.matchId === matchId || task.id === `mg_${matchId}` || task.id === matchId))
    || (operationId && task.id === operationId)
    || (opportunityId && (task.opportunityId === opportunityId || task.requestId === opportunityId || task.offerId === opportunityId))
  ) || null;
}

function onOpenDailyTask(event) {
  const task = findTaskForNotification(event.detail || {});
  if (!task) return;
  if (state.openTaskId !== task.id) toggleOpenTask(task.id);
  window.requestAnimationFrame(() => {
    state.root?.querySelector(`[data-task-id="${task.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

export function unmountDailyTasksContentV2() {
  window.removeEventListener("iaqar:operations-data", onOperationsData);
  window.removeEventListener("iaqar:open-daily-task", onOpenDailyTask);
  closeOfferDetailsSheet();
  if (state.root) {
    state.root.removeEventListener("click", onListClick);
    state.root.innerHTML = "";
  }
  state.root = null;
  state.bound = false;
  state.openTaskId = null;
  state.detailsTaskId = null;
}

export function mountDailyTasksContentV2(root) {
  if (!root) return;
  if (state.root && state.root !== root) unmountDailyTasksContentV2();
  const alreadyMounted = state.root === root && state.bound;
  state.root = root;
  window.removeEventListener("iaqar:operations-data", onOperationsData);
  window.removeEventListener("iaqar:open-daily-task", onOpenDailyTask);
  window.addEventListener("iaqar:operations-data", onOperationsData);
  window.addEventListener("iaqar:open-daily-task", onOpenDailyTask);
  if (!alreadyMounted) {
    root.addEventListener("click", onListClick);
    state.bound = true;
  }
  if (!useDemoFixtures()) {
    const existing = window.IAQAR?.operationsItems;
    if (Array.isArray(existing)) {
      state.tasks = mapOperationsItemsToDailyTasks(existing, new Date(), { officeId: currentOfficeId() });
      const invalid = consumeDailyTaskDiagnostics();
      if (invalid.length) window.__IAQAR_INVALID_DAILY_TASKS__ = invalid;
    }
    void tickPlatformOpportunityExpiry();
  }
  renderList();
}
