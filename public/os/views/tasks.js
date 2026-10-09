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
import { CLOSED_STEP, TASK_FILTERS, closedDealModel, closedDealsFor, filterTasks, isActiveTask, parseMeta, parsePathStep, sortClosedDeals, taskCardModel, taskTypeOf, visibleToActor, dealRoute } from "../domain/task-domain.js";
import { cardCountLabel, countGroupsByStep, filterGroupsByStep, groupDealTasks, subtaskCountLabel, taskStateLabel, urgencyOf } from "../domain/deal-card-domain.js";
import { dealToReturnTo, forgetDeal, rememberDeal } from "../core/deal-return.js";
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

function taskTypeLabel(type) {
  return taskTypeOf({ type }).badge || "";
}

/** The button of one task, wired to what that task does today (confirm, remind, or open its screen). */
function taskButton(task, model) {
  const button = h("button", { type: "button", class: "os-btn primary", "data-action": model.type }, h("span", { text: model.button }), ic(model.icon));
  const journeyId = model.journeyId;
  if (model.inline === "CONFIRM_VIEWING" && journeyId) {
    button.addEventListener("click", () => runAction(button, () => api("/os/journeys/viewing/confirm", { officeId: session.officeId, journeyId }), { success: "تم تأكيد موعد المعاينة" }));
  } else if (model.type === "AWAITING_REPLY" && model.proposalId) {
    let proposal;
    getDoc(session.officeId, "proposals", model.proposalId).then((p) => { proposal = p; }).catch(() => {});
    button.addEventListener("click", () => {
      if (!proposal) { rememberDeal(journeyId); go(`journey/${journeyId}?focus=AWAITING_REPLY`); return; }
      openSheet("إرسال تذكير", proposalPreparedPanel({ ...proposal, proposalId: model.proposalId }));
    });
  } else {
    const open = primaryAction(task, model);
    button.addEventListener("click", () => { rememberDeal(journeyId); open(); });
  }
  return button;
}

function actionTitleOf(model) {
  // For tasks whose button only names the page it opens, the heading says what is needed instead.
  if (String(model.type).startsWith("SESSION_")) return taskTypeLabel(model.type) || model.button;
  return model.type === "MATCH_REVIEW" ? "تطابق جديد" : model.type === "VIEWING_CONFIRM" ? "تأكيد موعد المعاينة" : model.type === "SEND_PROPOSAL" ? "متابعة عرض سعر" : model.button;
}

function taskCard(task, now) {
  const model = modelFor(task, now);
  const button = taskButton(task, model);
  const record=taskRecord(task)||{},view=recordView(record),step=taskStep(task);
  const meta=parseMeta(task),client=recordById(task.requestId||meta.clientRequestId),contactName=client?.contactName||view.contactName;
  // One main button per card; tapping the card itself opens «تفاصيل المهمة» (no second arrow).
  const card=h("article",{class:"os-card ref-task-card","data-task":task.id,"data-type":model.type,onClick:(e)=>{if(!e.target.closest("button,a"))go("task/"+task.id);}},photo(record),h("div",{class:"ref-task-copy"},h("h3",{text:actionTitleOf(model)}),contactName?h("b",{class:"ref-contact"},ic("user"),contactName):null,h("p",{text:[view.propertyType,view.location].filter(Boolean).join(" · ")||model.title})),h("div",{class:"ref-task-actions"},h("div",{class:"ref-task-meta"},h("span",{class:"ref-status step-"+step,text:STEPS[step][0]}),timeChip(task)),h("div",{},button)));
  return card;
}

/** The deal's tasks as rows, each with its own button (the same action it has as a card). */
export function dealTaskRows(tasks, primary, now = new Date()) {
  return tasks.map((task) => {
    const sub = modelFor(task, now);
    const act = taskButton(task, sub);
    act.classList.remove("primary"); act.classList.add("secondary");
    const urgency = urgencyOf(task, now);
    return h("li", { class: "ref-deal-sub" + (task === primary ? " is-primary" : ""), "data-subtask": task.id, "data-subtask-type": sub.type },
      h("div", { class: "ref-deal-sub-copy" },
        h("b", { text: taskTypeOf(task).badge }),
        sub.reason ? h("span", { text: sub.reason }) : null,
        h("small", { "data-subtask-state": "", class: urgency.level ? `is-${urgency.level}` : "", text: [taskStateLabel(task, now), urgency.level && urgency.level !== "late" ? urgency.label : ""].filter(Boolean).join(" · ") })),
      act);
  });
}

/** Main button + title of a deal's most pressing task (shared with «متابعة الصفقة»). */
export function dealPrimaryControl(primary, now = new Date()) {
  const model = modelFor(primary, now);
  const button = taskButton(primary, model);
  button.setAttribute("data-deal-primary", "");
  return { model, button, title: actionTitleOf(model) };
}

/**
 * One card for a whole deal: who, what property, which stage, what is needed now, and ONE main
 * button (the most pressing task). Its other tasks stay inside the card, each with its own button.
 */
function dealCard(group, now) {
  const primary = group.primary;
  const model = modelFor(primary, now);
  const button = taskButton(primary, model);
  button.setAttribute("data-deal-primary", "");
  const source = group.card || primary;
  const meta = parseMeta(source);
  const offer = recordById(source.offerId || meta.ownerOfferId) || recordById(primary.offerId) || taskRecord(primary) || {};
  const request = recordById(source.requestId || meta.clientRequestId) || recordById(primary.requestId) || null;
  const view = recordView(offer);
  const owner = String(offer.contactName || "").trim();
  const client = String(request?.contactName || "").trim();
  const parties = [owner ? `المالك: ${owner}` : "", client ? `العميل: ${client}` : ""].filter(Boolean).join(" · ");
  const open = () => { rememberDeal(group.id); go(`deal/${group.id}`); };
  const now_ = [actionTitleOf(model), model.reason && model.reason !== actionTitleOf(model) ? model.reason : ""].filter(Boolean).join(" — ");
  const follow = h("button", { type: "button", class: "ref-deal-follow", "data-deal-follow": group.id }, ic("flag"), h("span", { text: "متابعة الصفقة" }), ic("chev-left"));
  follow.addEventListener("click", open);
  // Every open task of the deal (its own deal task included) is listed whenever there is more than the one on the main button.
  const rows = dealTaskRows(group.tasks, primary, now);
  const more = group.tasks.length > 1
    ? h("details", { class: "ref-deal-more", "data-deal-subtasks": String(group.tasks.length) },
      h("summary", {}, ic("clipboard"), h("span", { text: `مهام الصفقة: ${subtaskCountLabel(group.tasks.length)}` }), ic("chev-down")),
      h("ul", { class: "ref-deal-subs" }, rows))
    : null;
  return h("article", { class: "os-card ref-task-card ref-deal-card", "data-task": primary.id, "data-deal": group.id, "data-type": model.type, "data-deal-tasks": String(group.tasks.length), onClick: (e) => { if (!e.target.closest("button,a,summary,details")) open(); } },
    photo(offer),
    h("div", { class: "ref-task-copy" },
      h("h3", { text: [view.propertyType, view.location].filter(Boolean).join(" · ") || model.title || "صفقة" })),
    h("div", { class: "ref-task-actions" },
      h("div", { class: "ref-task-meta" }, h("span", { class: "ref-status step-" + group.step, "data-deal-stage": "", text: STEPS[group.step][0] }), timeChip(group.dueTask || primary)),
      h("div", {}, button)),
    h("div", { class: "ref-deal-foot" },
      parties ? h("p", { class: "ref-deal-parties", "data-deal-parties": "" }, ic("users"), h("span", { text: parties })) : null,
      h("p", { class: "ref-deal-now", "data-deal-now": "" },
        group.urgency.label ? h("span", { class: `ref-urgency is-${group.urgency.level}`, "data-deal-urgency": group.urgency.level, text: group.urgency.label }) : null,
        h("b", { text: "المطلوب الآن: " }), h("span", { text: now_ })),
      h("div", { class: "ref-deal-links" }, more, follow)));
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
  let returned = null;      // the deal card the broker just came back to (briefly marked)
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
    // One card per deal: a deal is listed when any of its tasks passes the filter, and its card always carries all of its open tasks.
    const allGroups = groupDealTasks(mine.filter(isActiveTask), now);
    const groupsFor = (filterId) => {
      const pass = new Set(filterTasks(mine, filterId, now).map((task) => task.id));
      return allGroups.filter((group) => (group.kind === "deal" ? group.tasks.some((task) => pass.has(task.id)) : pass.has(group.task.id)));
    };
    const inFilter = groupsFor(active);
    const counts = [...countGroupsByStep(inFilter), closed ? closed.length : 0];
    clear(strip);
    strip.append(stepStrip({ active: activeStep, counts, onSelect: selectStep }));

    clear(chipsRow);
    for (const f of TASK_FILTERS) {
      const n = groupsFor(f.id).length;
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

    const shown = filterGroupsByStep(inFilter, activeStep);
    countPill.textContent = cardCountLabel(shown.length);
    if (activeStep !== null) {
      append(stageHead, h("b", { text: `مرحلة «${STEPS[activeStep][0]}» — ${cardCountLabel(shown.length)}` }),
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
        h("button", { type: "button", class: "os-btn secondary", onClick: () => go("repo") }, ic("plus-circle"), "إضافة عرض أو طلب"))));
      return;
    }
    for (const group of shown) append(list, group.kind === "deal" ? dealCard(group, now) : taskCard(group.task, now));
    // Coming back from a deal: land on its card, not at the top of the list.
    const returning = dealToReturnTo();
    const cardOf = (id) => [...list.querySelectorAll("[data-deal]")].find((el) => el.dataset.deal === id);
    if (returning) {
      if (cardOf(returning)) {
        forgetDeal();
        returned = { id: returning, until: Date.now() + 2400, settled: false };
        // Once the broker moves the list himself, it is never pulled back.
        const settle = () => { if (returned) returned.settled = true; };
        window.addEventListener("touchstart", settle, { once: true, passive: true });
        window.addEventListener("wheel", settle, { once: true, passive: true });
        setTimeout(() => list.querySelectorAll(".is-returned").forEach((el) => el.classList.remove("is-returned")), 2400);
      } else if (state.tasksReady) forgetDeal(); // the deal has no open card any more
    }
    // The landing survives a live redraw of the list during those first moments.
    if (returned && Date.now() < returned.until) {
      cardOf(returned.id)?.classList.add("is-returned");
      if (!returned.settled) requestAnimationFrame(() => { if (returned && !returned.settled) cardOf(returned.id)?.scrollIntoView({ block: "center" }); });
    }
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
