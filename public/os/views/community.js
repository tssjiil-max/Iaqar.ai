/** #/community — «التعاون بين الوسطاء»: direct cooperation between the offer broker and the request broker. */

import { h, ic, clear, append, emptyState } from "../core/dom.js";
import { go } from "../core/nav.js";
import { session } from "../core/session.js";
import { journeyForMatch } from "../core/live.js";
import { confirmDialog, runAction } from "../core/ui.js";
import { watchCooperation, runCooperationAction } from "../core/community.js";
import { COMMUNITY_TABS, cardActions, communityViews, turnLine } from "../domain/community-domain.js";
import { openCooperationDetails } from "./community-details.js";

/** After acceptance the work continues in the deal journey (same match) or, failing that, in Daily Tasks. */
async function openFollowUp(view) {
  const journey = await journeyForMatch(session.officeId, view.matchId).catch(() => null);
  go(journey ? `journey/${journey.id}` : "tasks");
}

function card(view, redraw) {
  const { primary, secondary, followUp } = cardActions(view);
  const run = (button, action, danger) => async () => {
    if (danger && !(await confirmDialog({ title: action.label, text: "سيُبلَّغ المكتب الآخر بقرارك.", confirmLabel: action.label, danger: true }))) return;
    await runAction(button, () => runCooperationAction(session.officeId, view.id, action.action), { success: "تم تحديث التعاون" });
    redraw();
  };
  const actions = h("div", { class: "os-coop-actions" });
  if (primary) {
    const b = h("button", { type: "button", class: "os-btn primary", "data-coop-action": primary.id }, ic("check"), primary.label);
    b.addEventListener("click", run(b, primary, false));
    actions.append(b);
  }
  for (const action of secondary) {
    const b = h("button", { type: "button", class: "os-btn secondary", "data-coop-action": action.id }, action.label);
    b.addEventListener("click", run(b, action, action.id === "reject_cooperation"));
    actions.append(b);
  }
  if (followUp) {
    const b = h("button", { type: "button", class: "os-btn primary", "data-coop-followup": "" }, ic("handshake"), "متابعة الصفقة");
    b.addEventListener("click", () => runAction(b, () => openFollowUp(view)));
    actions.append(b);
  }
  const details = h("button", { type: "button", class: "os-btn ghost", "data-coop-details-open": "" }, "التفاصيل");
  details.addEventListener("click", () => openCooperationDetails(view, { onChanged: redraw }));
  actions.append(details);
  const line = [view.propertyLine, view.priceOrBudget].filter(Boolean).join(" · ");
  const turn = turnLine(view);
  return h("article", { class: "os-card os-coop-card", "data-coop": view.id },
    h("div", { class: "os-coop-icon" }, ic("handshake")),
    h("div", { class: "os-coop-copy" },
      h("h3", { text: view.partnerOfficeName || view.kindLabel }),
      line ? h("p", { text: line }) : null,
      h("span", { class: `os-coop-status${view.requiresAction ? " is-now" : ""}`, text: turn })),
    actions);
}

export function renderCommunity(container) {
  append(container, h("div", { class: "os-page-head" },
    h("button", { type: "button", class: "os-back", onClick: () => go("office") }, ic("chev-right"), "رجوع"),
    h("h1", { class: "os-page-title", text: "التعاون بين الوسطاء" }), h("span")));
  append(container, h("p", { class: "os-sub", text: "تعاون مباشر بين وسيط العرض ووسيط الطلب حتى إتمام الصفقة" }));
  let rows = [];
  let ready = false;
  let tab = "active";
  let touched = false;
  const chips = h("div", { class: "os-chips", role: "group", "aria-label": "حالات التعاون" });
  const list = h("div", { class: "os-task-list", "aria-live": "polite" });
  const draw = () => {
    const tabs = communityViews(rows, session.officeId);
    // Land where something is happening: a request waiting for me beats an empty «نشط».
    if (ready && !touched && !tabs[tab].length) tab = tabs.waiting.length ? "waiting" : tabs.active.length ? "active" : tabs.history.length ? "history" : tab;
    clear(chips);
    for (const t of COMMUNITY_TABS) {
      const n = tabs[t.id].length;
      chips.append(h("button", { type: "button", class: "os-chip", "data-tab": t.id, "aria-pressed": String(tab === t.id), onClick: () => { touched = true; tab = t.id; draw(); } }, t.label, n ? h("span", { class: "n", text: String(n) }) : null));
    }
    clear(list);
    if (!ready) { append(list, h("div", { class: "os-skeleton" })); return; }
    if (!tabs[tab].length) {
      append(list, h("div", { class: "os-card" }, emptyState("handshake", tab === "active" ? "لا يوجد تعاون نشط" : tab === "waiting" ? "لا شيء بانتظار رد" : "السجل فارغ",
        "عند ظهور مطابقة مع مكتب آخر أو وصول طلب تعاون ستجده هنا.")));
      return;
    }
    for (const view of tabs[tab]) append(list, card(view, draw));
  };
  append(container, chips, list);
  draw();
  const off = watchCooperation(session.officeId, (next) => { rows = next; ready = true; draw(); },
    () => { ready = true; clear(list); append(list, h("div", { class: "os-alert bad", text: "تعذر تحميل طلبات التعاون." })); });
  return off;
}
