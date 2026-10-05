/**
 * «المهام اليومية» — only work that needs doing, ordered by due time and by whether
 * the broker must act. Waiting/overdue items stay until they are resolved.
 */

import { openGeneralTask } from "./task-fallback.js";
import { h, ic, clear, emptyState, append } from "../core/dom.js";
import { go } from "../core/nav.js";
import { api } from "../core/runtime.js";
import { session } from "../core/session.js";
import { recordById, state, subscribe } from "../core/state.js";
import { runAction, openSheet } from "../core/ui.js";
import { getDoc, listClosedJourneys } from "../core/live.js";
import { CLOSED_STEP, TASK_FILTERS, closedDealModel, closedDealsFor, countTasksByStep, filterTasks, filterTasksByStep, parseMeta, parsePathStep, sortClosedDeals, sortTasks, taskCardModel, visibleToActor, dealRoute } from "../domain/task-domain.js";
import { compatibilityLevel } from "../domain/match-review-domain.js";
import { formatDateTime, formatPrice, relativeAgo } from "../domain/format-domain.js";
import { photo, taskRecord, taskStep, timeChip, stepStrip, STEPS } from "./reference-layout.js";
import { proposalPreparedPanel } from "./composer.js";
import { recordTitle, recordView, kindOf } from "../domain/records-domain.js";

export function countLabel(n) {
  if (n === 0) return "لا مهام";
  if (n === 1) return "مهمة واحدة";
  if (n === 2) return "مهمتان";
  if (n <= 10) return `${n} مهام`;
  return `${n} مهمة`;
}

export function dealCountLabel(n) {
  if (n === 0) return "لا صفقات مغلقة";
  if (n === 1) return "صفقة واحدة";
  if (n === 2) return "صفقتان";
  if (n <= 10) return `${n} صفقات`;
  return `${n} صفقة`;
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
  if (model.opens === "deal") return () => go(dealRoute(task));
  if (model.opens === "community") return () => go("community");
  if (model.opens === "review") return () => go(`review/${task.matchId}`);
  if (model.opens === "workspace" && model.journeyId) return () => go(`journey/${model.journeyId}?focus=${model.type}`);
  if (model.opens === "session" && model.journeyId) return () => go(`session/${model.journeyId}`);
  if (model.opens === "record" && task.opportunityId) {
    return () => go(model.type === "MISSING_DATA" ? `record/${task.opportunityId}/edit` : `record/${task.opportunityId}`);
  }
  return () => openGeneralTask(task);
}

function taskCard(task, now) {
  const model = modelFor(task, now);
  const button = h("button", { type: "button", class: "os-btn primary block", "data-action": model.type },
    h("span", { text: model.button }), ic("chev-left"));
  button.lastChild.classList.add("chev");

  if (model.inline === "CONFIRM_VIEWING" && model.journeyId) {
    button.addEventListener("click", () => runAction(button, () => api("/os/journeys/viewing/confirm", { officeId: session.officeId, journeyId: model.journeyId }), { success: "تم تأكيد موعد المعاينة" }));
  } else if (model.type === "AWAITING_REPLY" && model.proposalId) {
    let proposal;
    getDoc(session.officeId, "proposals", model.proposalId).then((p) => { proposal = p; }).catch(() => {});
    button.addEventListener("click", () => {
      if (!proposal) { go(`journey/${model.journeyId}?focus=AWAITING_REPLY`); return; }
      openSheet("إرسال تذكير", proposalPreparedPanel({ ...proposal, proposalId: model.proposalId }));
    });
  } else {
    button.addEventListener("click", primaryAction(task, model));
  }

  const record=taskRecord(task)||{},view=recordView(record),step=taskStep(task);
  const meta=parseMeta(task),client=recordById(task.requestId||meta.clientRequestId),contactName=client?.contactName||view.contactName;
  const actionTitle=model.type==="MATCH_REVIEW"?"تطابق جديد":model.type==="VIEWING_CONFIRM"?"تأكيد موعد المعاينة":model.type==="SEND_PROPOSAL"?"متابعة عرض سعر":model.button;
  button.classList.remove("block");button.lastChild.remove();button.append(ic(model.icon));
  // One main button per card; tapping the card itself opens «تفاصيل المهمة» (no second arrow).
  const card=h("article",{class:"os-card ref-task-card","data-task":task.id,"data-type":model.type,onClick:(e)=>{if(!e.target.closest("button,a"))go("task/"+task.id);}},photo(record),h("div",{class:"ref-task-copy"},h("h3",{text:actionTitle}),contactName?h("b",{class:"ref-contact"},ic("user"),contactName):null,h("p",{text:[view.propertyType,view.location].filter(Boolean).join(" · ")||model.title})),h("div",{class:"ref-task-actions"},h("div",{class:"ref-task-meta"},h("span",{class:"ref-status step-"+step,text:STEPS[step][0]}),timeChip(task)),h("div",{},button)));
  return card;
}

/** One closed deal in the «إغلاق» stage: what closed, how, when — opens the deal with its full history. */
function closedDealCard(journey) {
  const model = closedDealModel(journey);
  const open = h("button", { type: "button", class: "os-btn secondary", "data-open-deal": model.id }, h("span", { text: "فتح الصفقة" }), ic("chev-left"));
  open.addEventListener("click", () => go(`journey/${model.id}`));
  return h("article", { class: "os-card ref-task-card ref-closed-card", "data-closed-deal": model.id, "data-won": String(model.won), onClick: (e) => { if (!e.target.closest("button,a")) go(`journey/${model.id}`); } },
    photo({ propertyType: model.propertyType }),
    h("div", { class: "ref-task-copy" },
      h("h3", { text: model.statusLabel }),
      h("p", { text: [model.propertyType, model.location].filter(Boolean).join(" · ") }),
      model.finalPrice ? h("b", { class: "ref-contact" }, ic("coins"), formatPrice(model.finalPrice)) : model.reason ? h("p", { text: model.reason }) : null),
    h("div", { class: "ref-task-actions" },
      h("div", { class: "ref-task-meta" }, h("span", { class: "ref-status step-5" + (model.won ? " is-won" : " is-lost"), text: STEPS[CLOSED_STEP][0] }),
        model.closedAt ? h("span", { class: "ref-time" }, ic("clock"), formatDateTime(model.closedAt).split(" · ")[0]) : null),
      h("div", {}, open)));
}

export function renderTasks(container, { filter = "all", step = null } = {}) {
  let active = TASK_FILTERS.some((f) => f.id === filter) ? filter : "all";
  let activeStep = parsePathStep(step);
  let closed = null;        // null = not loaded yet, [] = none
  let closedError = "";
  const countPill = h("span", { class: "os-count" });
  const chipsRow = h("div", { class: "os-chips", role: "group", "aria-label": "تصفية المهام" });
  const list = h("div", { class: "os-task-list", "aria-live": "polite" });
  const strip = h("div", { "data-path-strip": "" });
  const stageHead = h("div", { class: "ref-stage-head", "data-stage-head": "", hidden: true });

  const writeRoute = () => {
    const params = new URLSearchParams();
    if (active !== "all") params.set("filter", active);
    if (activeStep !== null) params.set("step", String(activeStep));
    const query = params.toString();
    history.replaceState(null, "", `#/tasks${query ? `?${query}` : ""}`);
  };
  const selectStep = (next) => { activeStep = next; writeRoute(); draw(); };

  const loadClosed = () => {
    listClosedJourneys(session.officeId).then((rows) => { closed = sortClosedDeals(closedDealsFor(rows, { uid: session.user?.uid, isManager: session.isManager })); closedError = ""; draw(); })
      .catch(() => { closed = closed || []; closedError = "تعذر تحميل الصفقات المغلقة"; draw(); });
  };

  const draw = () => {
    const now = new Date();
    const mine = state.tasks.filter((task) => visibleToActor(task, { uid: session.user?.uid, isManager: session.isManager, officeId: session.officeId }));
    const inFilter = filterTasks(mine, active, now);
    const counts = [...countTasksByStep(inFilter), closed ? closed.length : 0];
    clear(strip);
    strip.append(stepStrip({ active: activeStep, counts, onSelect: selectStep }));

    clear(chipsRow);
    for (const f of TASK_FILTERS) {
      const n = filterTasks(mine, f.id, now).length;
      chipsRow.append(h("button", {
        type: "button", class: "os-chip", "aria-pressed": String(active === f.id),
        onClick: () => { active = f.id; writeRoute(); draw(); }
      }, f.label, n ? h("span", { class: "n", text: String(n) }) : null));
    }

    clear(stageHead);
    stageHead.hidden = activeStep === null;
    clear(list);

    if (activeStep === CLOSED_STEP) {
      const n = closed ? closed.length : 0;
      countPill.textContent = dealCountLabel(n);
      append(stageHead, h("b", { text: `مرحلة «${STEPS[CLOSED_STEP][0]}» — ${dealCountLabel(n)}` }),
        h("button", { type: "button", class: "ref-stage-all", "data-stage-all": "", onClick: () => selectStep(null) }, "عرض كل المهام"));
      if (closed === null) { append(list, h("div", { class: "os-skeleton" }), h("div", { class: "os-skeleton" })); return; }
      if (closedError) append(list, h("div", { class: "os-alert bad", text: closedError }));
      if (!closed.length && !closedError) {
        append(list, h("div", { class: "os-card" }, emptyState("check-circle", "لا توجد صفقات مغلقة بعد", "عند إتمام صفقة أو إغلاقها تظهر هنا مع تاريخها الكامل.")));
        return;
      }
      for (const journey of closed) append(list, closedDealCard(journey));
      return;
    }

    const shown = sortTasks(filterTasksByStep(inFilter, activeStep), now);
    countPill.textContent = countLabel(shown.length);
    if (activeStep !== null) {
      append(stageHead, h("b", { text: `مرحلة «${STEPS[activeStep][0]}» — ${countLabel(shown.length)}` }),
        h("button", { type: "button", class: "ref-stage-all", "data-stage-all": "", onClick: () => selectStep(null) }, "عرض كل المهام"));
    }
    if (!state.tasksReady) {
      append(list, h("div", { class: "os-skeleton" }), h("div", { class: "os-skeleton" }));
      return;
    }
    if (!shown.length) {
      if (activeStep !== null) {
        append(list, h("div", { class: "os-card" }, emptyState("check-circle", `لا شيء في مرحلة «${STEPS[activeStep][0]}» الآن`, STEPS[activeStep][2])));
        return;
      }
      append(list, h("div", { class: "os-card" }, emptyState("check-circle",
        active === "waiting" ? "لا شيء بانتظار رد" : "لا توجد مهام الآن",
        active === "waiting" ? "المقترحات المرسلة تظهر هنا حتى يصل الرد." : "أضف عروضًا وطلبات، وعند ظهور مطابقة ستصلك مهمة المراجعة هنا.",
        h("button", { type: "button", class: "os-btn secondary", onClick: () => go("repo") }, ic("plus"), "إضافة عرض أو طلب"))));
      return;
    }
    for (const task of shown) append(list, taskCard(task, now));
  };

  append(container, strip, h("details",{class:"ref-filters"},h("summary",{},"تصفية المهام",countPill),chipsRow), stageHead, list);
  draw();
  loadClosed();
  // A deal that closes while this page is open leaves the task list; refresh the closed list then.
  let openDeals = state.tasks.length;
  const off = subscribe((kind) => {
    if (kind !== "tasks" && kind !== "records") return;
    if (kind === "tasks" && state.tasks.length < openDeals) loadClosed();
    openDeals = state.tasks.length;
    draw();
  });
  const timer = setInterval(draw, 60_000);
  return () => { off(); clearInterval(timer); };
}
