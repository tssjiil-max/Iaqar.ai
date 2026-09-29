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
} from "../../../../public/js/cooperation-workflow-domain.js";
import { requestCooperationLifecycle } from "../../../../public/js/cooperation-phase6-domain.js";
import {
  buildListingShareMessage,
  whatsAppShareUrl
} from "../../../../public/js/listing-share-domain.js";
import {
  buildPartyWhatsAppMessage,
  missingPartyPhoneMessage,
  PARTY_SEND_COPY,
  whatsappOpenedMessage
} from "./party-link-domain.js";
import { ensurePartyReviewLink, resolvePartyPhone } from "./party-link.js";
import { resolveDetailsOpportunityId } from "../../../../public/js/opportunity-data-flow-domain.js";
import { topHomeDailyTasks } from "../../../../public/js/daily-tasks-source-policy.js";
import { appendMatchEvent, brokerUnreadCount, matchPartyName } from "../../../../public/js/match-event-domain.js";

const state = {
  root: null,
  tasks: [],
  bound: false,
  openTaskId: null,
  detailsTaskId: null,
  scrollTop: 0,
  focusMatchId: "",
  workspace: null,
  mainRoot: null,
  // Entries the Worker accepted that the live feed has not delivered yet, per matchId.
  localActivity: new Map(),
  // Unsent broker text survives re-renders (feed updates, choices, sends).
  drafts: new Map(),
  // Broker "seen" marks applied locally until the feed carries them, per matchId.
  localSeen: new Map(),
  seenInFlight: new Set(),
  // clientEventId of a failed broker action, replayed when the same action is retried.
  retryEventIds: new Map()
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
  if (state.focusMatchId) return state.tasks.filter((task) => task.matchId === state.focusMatchId);
  return topHomeDailyTasks(state.tasks);
}

function isOperationId(value) {
  return /^op_/i.test(String(value || "").trim());
}

// The exact matchId for every write. Inside the workspace it is the match the
// broker opened; an operation id is never accepted as a matchId.
function exactMatchId(task = {}) {
  const id = String(state.focusMatchId || task.matchId || "").trim();
  return id && !isOperationId(id) ? id : "";
}

function rememberLocalActivity(matchId, entry) {
  if (!matchId || !entry?.eventId) return;
  const pending = state.localActivity.get(matchId) || [];
  state.localActivity.set(matchId, [...pending.filter((item) => item.eventId !== entry.eventId), entry]);
}

function withLocalActivity(tasks = []) {
  if (!state.localActivity.size && !state.localSeen.size) return tasks;
  return tasks.map((task) => {
    let next = task;
    const seen = state.localSeen.get(task.matchId);
    if (seen) {
      if (String(task.brokerSeenAt || "") >= seen) state.localSeen.delete(task.matchId);
      else next = { ...next, brokerSeenAt: seen };
    }
    const pending = state.localActivity.get(task.matchId);
    if (!pending?.length) return next;
    const delivered = new Set((task.negotiationActivity || []).map((entry) => entry.eventId));
    const remaining = pending.filter((entry) => !delivered.has(entry.eventId));
    if (!remaining.length) {
      state.localActivity.delete(task.matchId);
      return next;
    }
    state.localActivity.set(task.matchId, remaining);
    let merged = task.negotiationActivity || [];
    for (const entry of remaining) merged = appendMatchEvent(merged, entry);
    return { ...next, negotiationActivity: merged };
  });
}

function newClientEventId() {
  try { return globalThis.crypto?.randomUUID?.() || `ce_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`; } catch { return `ce_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`; }
}

// While the broker is looking at a match, its updates are read: clear unread for
// this match only (the Worker keeps every event).
function markFocusedMatchSeen() {
  const matchId = state.focusMatchId;
  if (!matchId || state.seenInFlight.has(matchId)) return;
  const task = state.tasks.find((item) => item.matchId === matchId);
  if (!task || brokerUnreadCount(task.negotiationActivity || [], task.brokerSeenAt || "") === 0) return;
  const latest = (task.negotiationActivity || []).reduce((max, event) => (event.createdAt > max ? event.createdAt : max), "");
  state.localSeen.set(matchId, latest || new Date().toISOString());
  state.tasks = withLocalActivity(state.tasks);
  state.seenInFlight.add(matchId);
  void (async () => {
    try {
      await fetch(`${workerBase()}/workflow/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
        body: JSON.stringify({ officeId: currentOfficeId(), recordId: matchId, action: "mark_match_seen" })
      });
    } catch {
      /* unread stays until the next successful mark */
    } finally {
      state.seenInFlight.delete(matchId);
    }
  })();
}

function mapTasksFromItems(items = []) {
  return withLocalActivity(mapOperationsItemsToDailyTasks(workspaceItems(items), new Date(), {
    officeId: currentOfficeId(),
    requireOpportunityRecords: !state.focusMatchId
  }));
}

function workspaceItems(items) {
  if (!state.focusMatchId) return items;
  // Match groups choose their highest ranked candidate as the active match.
  // The Bank CTA can target another candidate in that same group. Preserve
  // canonical opportunity records for hydration while isolating that match.
  return items.filter((item) => String(item?.recordType || "").toLowerCase() === "opportunity"
    || String(item?.matchId || item?.recordId || "") === state.focusMatchId);
}

async function sendCompletionRequest(task, button) {
  if (button?.dataset?.cv2ExecState === "working") return;
  setExecState(button, "working");
  try {
    const response = await fetch(`${workerBase()}/completion/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await idToken()}`
      },
      body: JSON.stringify({ officeId: currentOfficeId(), opportunityId: task.opportunityId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.completionUrl) throw new Error(payload.message || "تعذر إنشاء رابط الاستكمال");
    const missing = (task.missingFieldLabels || []).join("، ");
    const body = `بيانات العقار غير مكتملة${missing ? ` (${missing})` : ""}. أكمل البيانات من الرابط التالي:\n${payload.completionUrl}`;
    openWhatsAppHandoff({ phone: payload.recipientPhone || task.contactPhone, text: body });
    setExecState(button, "success");
    notify("تم فتح واتساب برسالة ورابط الاستكمال");
  } catch (error) {
    setExecState(button, "error");
    notify(error.message || "تعذر إنشاء رابط الاستكمال");
  }
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
    matchId: state.focusMatchId || card.getAttribute("data-match-id") || listed.matchId,
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
  const targetId = offerId || requestId || resolveDetailsOpportunityId(task, "auto") || String(task?.opportunityId || "").trim();
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

function openActionableRecord(task = {}) {
  if (task.taskKind !== "deal_action") return openExistingOfferDetails(task);
  const dealId = String(task.dealId || task.recordId || "").trim();
  if (!dealId) {
    notify("تعذر فتح الصفقة — المرجع غير متوفر.");
    return { ok: false, error: PARTY_SEND_COPY.detailsFailed };
  }
  window.dispatchEvent(new window.CustomEvent("iaqar:workflow-action", {
    detail: {
      ...task,
      id: dealId,
      recordId: dealId,
      dealId,
      recordType: "deal",
      actionMode: "primary"
    }
  }));
  return { ok: true, dealId };
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
  const matchId = exactMatchId(task);
  if (matchId) task = { ...task, matchId };
  if (!matchId || !task?.offerId || !task?.requestId || task.dataIntegrity === "INVALID_TASK_DATA") {
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
    // Log every send; sending again later is always allowed.
    if (!useDemoFixtures()) await recordNegotiation(task, { kind: "party_send", party: side }).catch(() => {});
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

async function confirmViewingCompletion(task, button) {
  if (button?.dataset?.cv2ExecState === "working") return { ok: false, error: "busy" };
  setExecState(button, "working");
  try {
    const token = await idToken();
    const officeId = currentOfficeId();
    const response = await fetch(`${workerBase()}/match/living-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ officeId, matchId: task.matchId, action: "CONFIRM_VIEWING_COMPLETED" })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      notify(payload.message || "تعذر تسجيل إتمام المعاينة.");
      setExecState(button, "error");
      return { ok: false };
    }
    notify("تم تسجيل إتمام المعاينة");
    setExecState(button, "success");
    window.dispatchEvent(new CustomEvent("iaqar:operations-refresh"));
    return { ok: true };
  } catch {
    notify("تعذر تسجيل إتمام المعاينة.");
    setExecState(button, "error");
    return { ok: false };
  }
}

async function setViewingOutcome(task, outcome, button) {
  if (button?.dataset?.cv2ExecState === "working") return { ok: false, error: "busy" };
  setExecState(button, "working");
  try {
    const token = await idToken();
    const officeId = currentOfficeId();
    const response = await fetch(`${workerBase()}/match/living-action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ officeId, matchId: task.matchId, action: "SET_VIEWING_OUTCOME", outcome })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      notify(payload.message || "تعذر حفظ نتيجة المعاينة.");
      setExecState(button, "error");
      return { ok: false };
    }
    notify(outcome === "SERIOUS" ? "تم تأكيد الجدية" : outcome === "FOLLOW_UP" ? "تم تسجيل المتابعة" : "تم تسجيل عدم الجدية");
    setExecState(button, "success");
    window.dispatchEvent(new CustomEvent("iaqar:operations-refresh"));
    return { ok: true };
  } catch {
    notify("تعذر حفظ نتيجة المعاينة.");
    setExecState(button, "error");
    return { ok: false };
  }
}

async function createDealFromViewing(task, button) {
  if (button?.dataset?.cv2ExecState === "working") return { ok: false, error: "busy" };
  setExecState(button, "working");
  try {
    const token = await idToken();
    const officeId = currentOfficeId();
    const response = await fetch(`${workerBase()}/workflow/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ officeId, recordId: task.matchId, action: "create_deal" })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false || !payload.dealId) {
      notify(payload.message || "تعذر إنشاء الصفقة.");
      setExecState(button, "error");
      return { ok: false };
    }
    notify("تم إنشاء الصفقة والانتقال للتفاوض");
    setExecState(button, "success");
    window.dispatchEvent(new CustomEvent("iaqar:operations-refresh"));
    return { ok: true, dealId: payload.dealId };
  } catch {
    notify("تعذر إنشاء الصفقة.");
    setExecState(button, "error");
    return { ok: false };
  }
}

async function recordNegotiation(task, input = {}) {
  const matchId = exactMatchId(task);
  if (!matchId) throw new Error("تعذر تحديد المطابقة — حدّث الصفحة وحاول مجددًا");
  const retryKey = `${matchId}|${JSON.stringify(input)}`;
  const clientEventId = state.retryEventIds.get(retryKey) || newClientEventId();
  let response;
  try {
    response = await fetch(`${workerBase()}/workflow/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
      body: JSON.stringify({ officeId: currentOfficeId(), recordId: matchId, action: "record_negotiation_activity", clientEventId, ...input })
    });
  } catch (error) {
    state.retryEventIds.set(retryKey, clientEventId);
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (response.status >= 500) state.retryEventIds.set(retryKey, clientEventId);
  if (!response.ok || payload.ok === false || !payload.entry) throw new Error(payload.message || "تعذر حفظ الإجراء");
  state.retryEventIds.delete(retryKey);
  rememberLocalActivity(matchId, payload.entry);
  state.tasks = withLocalActivity(state.tasks);
  renderList();
  return payload;
}

async function recordPartyChoice(task, button) {
  if (button?.dataset?.cv2ExecState === "working") return;
  const party = button.getAttribute("data-party") === "owner" ? "owner" : "client";
  setExecState(button, "working");
  try {
    const payload = await recordNegotiation(task, { kind: "party_choice", party, choiceId: button.getAttribute("data-party-choice") });
    notify(`تم تسجيل خيار ${matchPartyName(party)}: ${payload.entry.payload?.label || ""}`);
  } catch (error) {
    setExecState(button, "error");
    notify(error.message || "تعذر حفظ الخيار");
  }
}

async function sendBrokerMessageOrNote(task, panel, action, button) {
  const isMessage = action === "send_message";
  const field = panel?.querySelector(isMessage ? "[data-broker-message]" : "[data-broker-internal-note]");
  const message = String(field?.value || "").trim();
  if (!message) {
    notify(isMessage ? "اكتب نص الرسالة أولًا" : "اكتب الملاحظة أولًا");
    return;
  }
  const audience = isMessage ? String(panel?.querySelector("[data-broker-audience]")?.value || "client") : "internal";
  const messageKind = isMessage ? String(panel?.querySelector("[data-broker-message-kind]")?.value || "general") : "";
  const requiresReply = isMessage ? Boolean(panel?.querySelector("[data-broker-requires-reply]")?.checked) : false;
  setExecState(button, "working");
  try {
    if (field) field.value = "";
    await recordNegotiation(task, isMessage
      ? { kind: "broker_message", party: audience, message, messageKind, requiresReply }
      : { kind: "internal_note", party: audience, message });
    notify(isMessage ? `أُضيفت رسالتك إلى رابط ${matchPartyName(audience)}` : "تم حفظ الملاحظة الداخلية — لم تُرسل لأي طرف");
  } catch (error) {
    if (field && !field.value) field.value = message;
    setExecState(button, "error");
    notify(error.message || (isMessage ? "تعذر إرسال الرسالة" : "تعذر حفظ الملاحظة"));
  }
}

async function updateAgreement(task, card, button) {
  const field = String(card?.querySelector("[data-agreement-field]")?.value || "").trim();
  const input = card?.querySelector("[data-agreement-value]");
  const value = String(input?.value || "").trim();
  if (!field || !value) {
    notify("اختر البند واكتب القيمة");
    return;
  }
  setExecState(button, "working");
  try {
    if (input) input.value = "";
    await recordNegotiation(task, { kind: "agreement_update", field, value });
    notify("تم تحديث الاتفاق");
  } catch (error) {
    if (input && !input.value) input.value = value;
    setExecState(button, "error");
    notify(error.message || "تعذر تحديث الاتفاق");
  }
}

// WhatsApp for a party notification is a wa.me handoff: record WHATSAPP_OPENED only.
async function openPartyNotificationWhatsApp(task, button) {
  const dispatchId = String(button.getAttribute("data-whatsapp-handoff") || "").trim();
  const item = (task.whatsappOutbox || []).find((entry) => entry.dispatchId === dispatchId);
  if (!item?.phone) {
    notify("رقم التواصل غير متوفر");
    return;
  }
  const opened = openWhatsAppHandoff({ phone: item.phone, text: item.text || "" });
  if (!opened?.ok) {
    notify(PARTY_SEND_COPY.whatsappFailed);
    return;
  }
  setExecState(button, "working");
  try {
    const response = await fetch(`${workerBase()}/workflow/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
      body: JSON.stringify({ officeId: currentOfficeId(), recordId: exactMatchId(task), action: "whatsapp_handoff_opened", dispatchId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.message || "تعذر تسجيل فتح واتساب");
    if (payload.entry) rememberLocalActivity(exactMatchId(task), payload.entry);
    state.tasks = withLocalActivity(state.tasks).map((entry) => (entry.matchId === exactMatchId(task)
      ? { ...entry, whatsappOutbox: (entry.whatsappOutbox || []).filter((outbox) => outbox.dispatchId !== dispatchId) }
      : entry));
    notify(`تم فتح واتساب ل${item.recipient === "owner" ? "لمالك" : "لعميل"}`);
    renderList();
  } catch (error) {
    setExecState(button, "error");
    notify(error.message || "تعذر تسجيل فتح واتساب");
  }
}

async function runBrokerNegotiationAction(task, panel, action, button) {
  if (button?.dataset?.cv2ExecState === "working") return;
  if (action === "send_message" || action === "save_internal_note") {
    await sendBrokerMessageOrNote(task, panel, action, button);
    return;
  }
  if (action === "agreement_update") {
    await updateAgreement(task, button.closest("[data-cv2-exec-task]"), button);
    return;
  }
  if (action === "no_agreement" && !window.confirm("إنهاء هذه المطابقة دون اتفاق؟ سيبقى العرض والطلب متاحين لمطابقات أخرى.")) return;
  setExecState(button, "working");
  const preset = String(panel?.querySelector("[data-broker-preset]")?.value || "").trim();
  const note = String(panel?.querySelector("[data-broker-note]")?.value || "").trim();
  const audience = String(panel?.querySelector("[data-broker-audience]")?.value || "both");
  const workflowAction = action === "continue" ? "create_deal" : action === "no_agreement" ? "close_match" : "add_negotiation_note";
  try {
    const response = await fetch(`${workerBase()}/workflow/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
      body: JSON.stringify({ officeId: currentOfficeId(), recordId: task.matchId, action: workflowAction, note: note || preset, preset, audience })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.message || "تعذر حفظ تدخل الوسيط");
    notify(action === "continue" ? "تم فتح دورة الصفقة" : action === "no_agreement" ? "أُغلقت هذه المطابقة فقط" : "تم حفظ ملاحظة الوسيط");
    setExecState(button, "success");
    window.dispatchEvent(new CustomEvent("iaqar:operations-refresh"));
  } catch (error) {
    setExecState(button, "error");
    notify(error.message || "تعذر حفظ تدخل الوسيط");
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
  const partyChoice = event.target.closest("[data-party-choice]");
  if (partyChoice) {
    event.preventDefault(); event.stopPropagation();
    void recordPartyChoice(task, partyChoice);
    return;
  }
  const handoff = event.target.closest("[data-whatsapp-handoff]");
  if (handoff) {
    event.preventDefault(); event.stopPropagation();
    void openPartyNotificationWhatsApp(task, handoff);
    return;
  }
  const brokerAction = event.target.closest("[data-broker-action]");
  if (brokerAction) {
    event.preventDefault(); event.stopPropagation();
    void runBrokerNegotiationAction(task, brokerAction.closest("[data-broker-panel]"), brokerAction.dataset.brokerAction, brokerAction);
    return;
  }
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
    if (action === "mark_viewing_follow_up") {
      void setViewingOutcome(task, "FOLLOW_UP", secondary);
      return;
    }
    if (action === "mark_viewing_not_serious") {
      void setViewingOutcome(task, "NOT_SERIOUS", secondary);
      return;
    }
    if (action === "complete_info") {
      toggleTaskDetails(task.id);
      return;
    }
    if (action === "open_record") {
      void openActionableRecord(task);
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
    if (action === "confirm_viewing_completed") {
      void confirmViewingCompletion(task, primary);
      return;
    }
    if (action === "mark_viewing_serious") {
      void setViewingOutcome(task, "SERIOUS", primary);
      return;
    }
    if (action === "mark_viewing_follow_up") {
      void setViewingOutcome(task, "FOLLOW_UP", primary);
      return;
    }
    if (action === "mark_viewing_not_serious") {
      void setViewingOutcome(task, "NOT_SERIOUS", primary);
      return;
    }
    if (action === "create_deal") {
      void createDealFromViewing(task, primary);
      return;
    }
    if (action === "complete_info") {
      toggleTaskDetails(task.id);
      return;
    }
    if (action === "open_record") {
      void openActionableRecord(task);
      return;
    }
    if (action === "send_completion_request") {
      void sendCompletionRequest(task, primary);
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

const DRAFT_FIELDS = ["data-broker-message", "data-broker-audience", "data-broker-message-kind", "data-broker-requires-reply", "data-broker-internal-note", "data-agreement-field", "data-agreement-value"];

function captureDrafts() {
  state.root?.querySelectorAll("[data-cv2-exec-task]").forEach((card) => {
    const taskId = card.getAttribute("data-task-id");
    if (!taskId) return;
    const values = {};
    for (const attr of DRAFT_FIELDS) {
      const field = card.querySelector(`[${attr}]`);
      if (field) values[attr] = field.type === "checkbox" ? field.checked : field.value;
    }
    if (Object.keys(values).length) state.drafts.set(taskId, values);
  });
}

function restoreDrafts() {
  state.root?.querySelectorAll("[data-cv2-exec-task]").forEach((card) => {
    const values = state.drafts.get(card.getAttribute("data-task-id"));
    if (!values) return;
    for (const attr of DRAFT_FIELDS) {
      const field = card.querySelector(`[${attr}]`);
      if (field && values[attr] != null) {
        if (field.type === "checkbox") field.checked = Boolean(values[attr]);
        else field.value = values[attr];
      }
    }
  });
}

function renderList() {
  if (!state.root) return;
  captureDrafts();
  if (state.focusMatchId && !currentTasks().length) {
    state.root.innerHTML = '<p class="cv2-exec-empty">تعذر تحميل بيانات المطابقة. حدّث الصفحة وحاول مجددًا.</p>';
    return;
  }
  state.root.innerHTML = buildDailyTaskListHtml(currentTasks(), {
    openTaskId: state.openTaskId,
    detailsTaskId: state.detailsTaskId
  });
  restoreDrafts();
  restoreScroll();
  markFocusedMatchSeen();
  consumePendingDailyTaskOpen();
}

function onOperationsData(event) {
  if (useDemoFixtures()) return;
  const eventOfficeId = String(event.detail?.officeId || "").trim();
  if (eventOfficeId && currentOfficeId() && eventOfficeId !== currentOfficeId()) return;
  const items = Array.isArray(event.detail?.items) ? event.detail.items : [];
  state.tasks = mapTasksFromItems(items);
  const invalid = consumeDailyTaskDiagnostics();
  if (invalid.length && typeof window !== "undefined") window.__IAQAR_INVALID_DAILY_TASKS__ = invalid;
  if (state.focusMatchId && !state.openTaskId) {
    state.openTaskId = state.tasks.find((task) => task.matchId === state.focusMatchId)?.id || null;
  }
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

function detachDailyTasksRoot() {
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

function attachDailyTasksRoot(root) {
  if (state.root && state.root !== root) detachDailyTasksRoot();
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
      state.tasks = mapTasksFromItems(existing);
      const invalid = consumeDailyTaskDiagnostics();
      if (invalid.length) window.__IAQAR_INVALID_DAILY_TASKS__ = invalid;
    }
    void tickPlatformOpportunityExpiry();
  }
  renderList();
}

// While the Match workspace is open it owns the shared list state. Content V2
// re-renders (hashchange, navigation-changed, firebase-status) must not empty it;
// the main Daily Tasks root they ask for is remembered and restored on close.
export function unmountDailyTasksContentV2() {
  if (state.workspace) {
    state.mainRoot = null;
    return;
  }
  detachDailyTasksRoot();
}

const MATCH_WORKSPACE_LOAD_TIMEOUT_MS = 10000;

export function closeMatchWorkspace({ popHistory = true } = {}) {
  const workspace = state.workspace;
  if (!workspace) return;
  document.removeEventListener("keydown", workspace.closeOnEscape);
  window.removeEventListener("popstate", workspace.closeOnPop);
  clearTimeout(workspace.loadTimer);
  detachDailyTasksRoot();
  workspace.remove();
  state.workspace = null;
  state.focusMatchId = "";
  document.body.style.overflow = workspace.dataset.previousOverflow || "";
  if (popHistory && window.history?.state?.iaqarMatchWorkspace) {
    try { window.history.back(); } catch (_) { /* ignore */ }
  }
  const mainRoot = state.mainRoot;
  state.mainRoot = null;
  if (mainRoot?.isConnected) attachDailyTasksRoot(mainRoot);
}

export function openMatchWorkspace(matchId) {
  const id = String(matchId || "").trim();
  if (!id) return false;
  if (state.workspace) closeMatchWorkspace();
  const mainRoot = state.root;
  if (mainRoot) detachDailyTasksRoot();
  const workspace = document.createElement("section");
  workspace.className = "cv2-match-workspace";
  workspace.dataset.previousOverflow = document.body.style.overflow;
  workspace.setAttribute("role", "dialog");
  workspace.setAttribute("aria-modal", "true");
  workspace.setAttribute("aria-label", "مسار المطابقة والتفاوض");
  workspace.innerHTML = '<div class="cv2-match-workspace-shell"><header><h2>مسار المطابقة والتفاوض</h2><button type="button" data-close-match-workspace aria-label="إغلاق">إغلاق</button></header><div data-match-workspace-content></div></div>';
  workspace.querySelector("[data-close-match-workspace]").addEventListener("click", () => closeMatchWorkspace());
  workspace.closeOnEscape = (event) => {
    if (event.key === "Escape") closeMatchWorkspace();
  };
  workspace.closeOnPop = () => closeMatchWorkspace({ popHistory: false });
  document.addEventListener("keydown", workspace.closeOnEscape);
  workspace.addEventListener("click", (event) => {
    if (event.target === workspace) closeMatchWorkspace();
  });
  document.body.append(workspace);
  document.body.style.overflow = "hidden";
  state.workspace = workspace;
  state.mainRoot = mainRoot;
  state.focusMatchId = id;
  try {
    window.history.pushState({ ...(window.history.state || {}), iaqarMatchWorkspace: 1 }, "", window.location.href);
    window.addEventListener("popstate", workspace.closeOnPop);
  } catch (_) { /* ignore */ }
  attachDailyTasksRoot(workspace.querySelector("[data-match-workspace-content]"));
  const task = state.tasks.find((item) => item.matchId === id);
  if (task) {
    state.openTaskId = task.id;
    renderList();
  } else {
    state.root.innerHTML = '<p class="cv2-exec-empty">جارٍ تحميل بيانات المطابقة…</p>';
    // Operations arrive from a live listener; if no item for this match shows up,
    // stop the spinner and show the explicit load error instead of waiting forever.
    workspace.loadTimer = setTimeout(() => {
      if (state.workspace === workspace && !state.tasks.some((item) => item.matchId === id)) renderList();
    }, MATCH_WORKSPACE_LOAD_TIMEOUT_MS);
    window.dispatchEvent(new CustomEvent("iaqar:operations-refresh"));
  }
  workspace.querySelector("[data-close-match-workspace]").focus();
  return true;
}

export function mountDailyTasksContentV2(root) {
  if (!root) return;
  if (state.workspace && !state.workspace.contains(root)) {
    state.mainRoot = root;
    return;
  }
  attachDailyTasksRoot(root);
}

if (typeof window !== "undefined") {
  window.IAQAR = window.IAQAR || {};
  window.IAQAR.openMatchWorkspace = openMatchWorkspace;
}
