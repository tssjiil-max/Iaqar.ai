/**
 * «المهام اليومية» — only work that needs doing, ordered by due time and by whether
 * the broker must act. Waiting/overdue items stay until they are resolved.
 */

import { h, ic, clear, emptyState, append } from "../core/dom.js";
import { go } from "../core/nav.js";
import { api } from "../core/runtime.js";
import { session } from "../core/session.js";
import { recordById, state, subscribe } from "../core/state.js";
import { runAction, openWhatsApp, toast } from "../core/ui.js";
import { getDoc } from "../core/live.js";
import { TASK_FILTERS, filterTasks, parseMeta, sortTasks, taskCardModel, visibleToActor } from "../domain/task-domain.js";
import { compatibilityLevel } from "../domain/match-review-domain.js";
import { formatDateTime, relativeAgo } from "../domain/format-domain.js";
import { recordTitle, kindOf } from "../domain/records-domain.js";

export function countLabel(n) {
  if (n === 0) return "لا مهام";
  if (n === 1) return "مهمة واحدة";
  if (n === 2) return "مهمتان";
  if (n <= 10) return `${n} مهام`;
  return `${n} مهمة`;
}

function matchReviewModel(task, model) {
  const meta = parseMeta(task);
  const offer = recordById(task.offerId || meta.ownerOfferId);
  const request = recordById(task.requestId || meta.clientRequestId);
  const requestLabel = request ? (String(request.purpose).toUpperCase() === "LEASE_REQUEST" ? "طلب استئجار" : "طلب شراء") : "طلب";
  const offerTitle = offer ? recordTitle(offer).replace(/ للبيع| للإيجار/, "") : [meta.candidatePropertyType, meta.candidateDistrict && `حي ${meta.candidateDistrict}`].filter(Boolean).join(" في ");
  const level = compatibilityLevel(meta.score || 0);
  const infoWaiting = String(task.status || "").toUpperCase() === "WAITING_EXTERNAL_RESPONSE";
  return {
    ...model,
    title: `${requestLabel} ↔ ${offerTitle || "عرض"}`,
    reason: String(task.summaryText || "").startsWith("وصل رد") || infoWaiting
      ? task.summaryText
      : [meta.reasonPreview, level.label].filter(Boolean).join(" · "),
    lastEvent: `ظهرت المطابقة ${relativeAgo(task.createdAt)}`,
    nextStep: "الخطوة التالية: اعتماد وبدء التفاوض"
  };
}

function recordTaskModel(task, model) {
  const record = recordById(task.opportunityId);
  return {
    ...model,
    title: record ? recordTitle(record) : model.title || "سجل في المستودع",
    reason: task.summaryText || model.reason,
    lastEvent: record ? `${kindOf(record) === "OFFER" ? "عرض" : "طلب"} · ${relativeAgo(record.updatedAt || record.createdAt)}` : ""
  };
}

function modelFor(task, now) {
  const base = taskCardModel(task, now);
  if (base.type === "MATCH_REVIEW") return matchReviewModel(task, base);
  if (["MISSING_DATA", "OPPORTUNITY_REVIEW", "OPPORTUNITY_FOLLOW_UP"].includes(base.type)) return recordTaskModel(task, base);
  return { ...base, title: base.title || task.titleText || "مهمة", lastEvent: base.lastEvent ? `${base.lastEvent} · ${relativeAgo(base.lastEventAt || task.updatedAt)}` : "" };
}

function primaryAction(task, model) {
  if (model.opens === "review") return () => go(`review/${task.matchId}`);
  if (model.opens === "workspace" && model.journeyId) return () => go(`journey/${model.journeyId}?focus=${model.type}`);
  if (model.opens === "record" && task.opportunityId) {
    return () => go(model.type === "MISSING_DATA" ? `record/${task.opportunityId}/edit` : `record/${task.opportunityId}`);
  }
  return () => { location.href = `/legacy.html?officeId=${encodeURIComponent(session.officeId)}&openOperation=${encodeURIComponent(task.id)}`; };
}

function taskCard(task, now) {
  const model = modelFor(task, now);
  const button = h("button", { type: "button", class: "os-btn primary block", "data-action": model.type },
    h("span", { text: model.button }), ic("chev-left"));
  button.lastChild.classList.add("chev");

  if (model.inline === "CONFIRM_VIEWING" && model.journeyId) {
    button.addEventListener("click", () => runAction(button, () => api("/os/journeys/viewing/confirm", { officeId: session.officeId, journeyId: model.journeyId }), { success: "تم تأكيد موعد المعاينة" }));
  } else if (model.type === "AWAITING_REPLY" && model.proposalId) {
    // Pre-load the prepared message so the click opens WhatsApp synchronously.
    let url = "";
    getDoc(session.officeId, "proposals", model.proposalId).then((p) => { url = p?.whatsappUrl || ""; }).catch(() => {});
    button.addEventListener("click", () => {
      if (!url) { go(`journey/${model.journeyId}?focus=AWAITING_REPLY`); return; }
      openWhatsApp(url);
      api("/os/proposals/handoff", { officeId: session.officeId, proposalId: model.proposalId }, { keepalive: true })
        .then(() => toast("تم فتح واتساب — تأكد من إرسال الرسالة", "ok"))
        .catch((error) => toast(error.message, "bad"));
    });
  } else {
    button.addEventListener("click", primaryAction(task, model));
  }

  const dueRow = model.due ? h("div", { class: "os-meta-row" }, ic("calendar"), h("span", {}, model.overdue ? "كان مستحقًا " : "الموعد ", h("b", { text: formatDateTime(model.due, now) }))) : null;
  const lastRow = model.lastEvent ? h("div", { class: "os-meta-row" }, ic("clock"), h("span", { text: model.lastEvent })) : null;
  const nextRow = model.nextStep ? h("div", { class: "os-meta-row" }, ic("chev-left"), h("span", { text: model.nextStep })) : null;
  const secondary = model.opens === "workspace" && model.journeyId && (model.inline || model.type === "AWAITING_REPLY")
    ? h("button", { type: "button", class: "os-btn ghost", onClick: () => go(`journey/${model.journeyId}`) }, "فتح مساحة الفرصة")
    : null;

  return h("article", { class: "os-card", "data-task": task.id, "data-type": model.type },
    h("div", { class: "os-task" },
      h("div", { class: "os-task-body" },
        h("span", { class: `os-badge${model.overdue ? " late" : model.waiting ? " muted" : ""}`, text: model.badge }),
        h("h3", { class: "os-task-title", text: model.title }),
        model.reason ? h("p", { class: "os-task-reason", text: model.reason }) : null
      ),
      h("div", { class: "os-task-icon", "aria-hidden": "true" }, ic(model.icon)),
      h("div", { class: "os-task-foot" }, button, dueRow, lastRow, nextRow, secondary)
    )
  );
}

export function renderTasks(container, { filter = "all" } = {}) {
  let active = TASK_FILTERS.some((f) => f.id === filter) ? filter : "all";
  const countPill = h("span", { class: "os-count" });
  const chipsRow = h("div", { class: "os-chips", role: "group", "aria-label": "تصفية المهام" });
  const list = h("div", { class: "os-task-list", "aria-live": "polite" });

  const draw = () => {
    const now = new Date();
    const mine = state.tasks.filter((task) => visibleToActor(task, { uid: session.user?.uid, isManager: session.isManager }));
    clear(chipsRow);
    for (const f of TASK_FILTERS) {
      const n = filterTasks(mine, f.id, now).length;
      chipsRow.append(h("button", {
        type: "button", class: "os-chip", "aria-pressed": String(active === f.id),
        onClick: () => { active = f.id; history.replaceState(null, "", `#/tasks?filter=${f.id}`); draw(); }
      }, f.label, n ? h("span", { class: "n", text: String(n) }) : null));
    }
    const shown = sortTasks(filterTasks(mine, active, now), now);
    countPill.textContent = countLabel(shown.length);
    clear(list);
    if (!state.tasksReady) {
      append(list, h("div", { class: "os-skeleton" }), h("div", { class: "os-skeleton" }));
      return;
    }
    if (!shown.length) {
      append(list, h("div", { class: "os-card" }, emptyState("check-circle",
        active === "waiting" ? "لا شيء بانتظار رد" : "لا توجد مهام الآن",
        active === "waiting" ? "المقترحات المرسلة تظهر هنا حتى يصل الرد." : "أضف عروضًا وطلبات، وعند ظهور مطابقة ستصلك مهمة المراجعة هنا.",
        h("button", { type: "button", class: "os-btn secondary", onClick: () => go("repo") }, ic("plus"), "إضافة عرض أو طلب"))));
      return;
    }
    for (const task of shown) append(list, taskCard(task, now));
  };

  append(container, 
    h("div", { class: "os-title-row" }, h("h2", { class: "os-h1", text: "شغلك اليوم" }), countPill),
    chipsRow,
    list,
    h("div", { class: "os-note" }, ic("database"), h("div", {}, h("b", { text: "العروض والطلبات محفوظة في المستودع" }), h("p", { text: "عند وجود مطابقة، تظهر مهمة جديدة هنا." })))
  );
  draw();
  const off = subscribe((kind) => { if (kind === "tasks" || kind === "records") draw(); });
  const timer = setInterval(draw, 60_000);
  return () => { off(); clearInterval(timer); };
}
