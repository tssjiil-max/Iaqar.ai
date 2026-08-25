/**
 * Mounts compact daily-task accordion cards into #contentV2.
 * Wires send/open actions only. Does not claim WhatsApp delivery.
 */

import { buildDailyTaskListHtml } from "./card.js";
import {
  dailyTaskDetailsHash,
  dailyTasksDemoFixtures,
  mapOperationsItemsToDailyTasks
} from "./domain.js";
import {
  COOPERATION_ACTION,
  requestCooperationWorkflow,
  workflowActionFromButton
} from "../../../../public/js/cooperation-workflow-domain.js";
import { requestCooperationLifecycle } from "../../../../public/js/cooperation-phase6-domain.js";
import {
  buildPartyWhatsAppMessage,
  detailsOpportunityId,
  missingPartyPhoneMessage,
  PARTY_SEND_COPY,
  whatsappOpenedMessage
} from "./party-link-domain.js";
import { ensurePartyReviewLink, resolvePartyPhone } from "./party-link.js";

const state = {
  root: null,
  tasks: [],
  bound: false,
  openTaskId: null
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

function workerBase() {
  if (typeof window.IAQAR?.resolveWorkerBase === "function") return window.IAQAR.resolveWorkerBase();
  return window.IAQAR?.workerBase || "";
}

function currentOfficeId() {
  return String(window.IAQAR?.office?.officeId || "").trim();
}

async function idToken() {
  const user = window.firebase?.auth?.()?.currentUser;
  if (!user?.getIdToken) return "";
  return user.getIdToken();
}

async function runCooperationTaskAction(task, actionId, button) {
  if (button?.dataset?.cv2ExecState === "working") return { ok: false, error: "busy" };
  if (actionId === "open_details") {
    return openExistingOfferDetails(task);
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

export function openExistingOfferDetails(task) {
  const hash = dailyTaskDetailsHash({
    ...task,
    opportunityId: detailsOpportunityId(task)
  });
  if (!hash) return { ok: false, error: PARTY_SEND_COPY.detailsFailed };
  const href = `${window.location.pathname}${window.location.search}${hash}`;
  if (window.history?.replaceState) window.history.replaceState(window.history.state, "", href);
  else window.location.hash = hash;
  window.IAQAR?.homeTabs?.switchTo?.("opportunities");
  window.IAQAR?.contentV2?.render?.();
  return { ok: true, hash };
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
      officeName: officeDisplayName(),
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
  state.openTaskId = state.openTaskId === taskId ? null : taskId;
  renderList();
}

function onListClick(event) {
  const root = state.root;
  if (!root) return;
  const card = event.target.closest("[data-cv2-exec-task]");
  if (!card || !root.contains(card)) return;
  const task = taskFromCard(card);
  const secondary = event.target.closest("[data-cv2-exec-secondary]");
  if (secondary) {
    event.preventDefault();
    event.stopPropagation();
    const action = secondary.getAttribute("data-cv2-exec-secondary");
    if (action === "open_offer") {
      if (secondary.dataset.cv2ExecState === "working") return;
      setExecState(secondary, "working");
      const opened = openExistingOfferDetails(task);
      if (!opened.ok) {
        notify(opened.error || PARTY_SEND_COPY.detailsFailed);
        setExecState(secondary, "error");
        return;
      }
      setExecState(secondary, "success");
      return;
    }
    if (task.taskKind === "cooperation") {
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
    if (task.taskKind === "cooperation") {
      void runCooperationTaskAction(task, action, primary);
      return;
    }
    if (action === "send_to_client" || action === "resend_to_client") {
      void runDailyTaskPartySend(task, "client", primary);
    }
    return;
  }
  const reveal = event.target.closest("[data-cv2-exec-reveal]");
  if (!reveal) return;
  event.preventDefault();
  toggleOpenTask(card.getAttribute("data-task-id"));
}

function renderList() {
  if (!state.root) return;
  state.root.innerHTML = buildDailyTaskListHtml(currentTasks(), { openTaskId: state.openTaskId });
}

function onOperationsData(event) {
  if (useDemoFixtures()) return;
  const items = Array.isArray(event.detail?.items) ? event.detail.items : [];
  state.tasks = mapOperationsItemsToDailyTasks(items, new Date(), { officeId: currentOfficeId() });
  if (state.openTaskId && !state.tasks.some((task) => task.id === state.openTaskId)) {
    state.openTaskId = null;
  }
  renderList();
}

export function unmountDailyTasksContentV2() {
  window.removeEventListener("iaqar:operations-data", onOperationsData);
  if (state.root) {
    state.root.removeEventListener("click", onListClick);
    state.root.innerHTML = "";
  }
  state.root = null;
  state.bound = false;
  state.openTaskId = null;
}

export function mountDailyTasksContentV2(root) {
  if (!root) return;
  if (state.root && state.root !== root) unmountDailyTasksContentV2();
  const alreadyMounted = state.root === root && state.bound;
  state.root = root;
  window.removeEventListener("iaqar:operations-data", onOperationsData);
  window.addEventListener("iaqar:operations-data", onOperationsData);
  if (!alreadyMounted) {
    root.addEventListener("click", onListClick);
    state.bound = true;
  }
  if (!useDemoFixtures()) {
    const existing = window.IAQAR?.operationsItems;
    if (Array.isArray(existing)) state.tasks = mapOperationsItemsToDailyTasks(existing, new Date(), { officeId: currentOfficeId() });
  }
  renderList();
}
