/** #/community — «مجتمع الوسطاء»: cooperation requests with other offices, in the new look. */

import { h, ic, clear, append, emptyState } from "../core/dom.js";
import { go } from "../core/nav.js";
import { session } from "../core/session.js";
import { confirmDialog, runAction } from "../core/ui.js";
import { watchCooperation, runCooperationAction } from "../core/community.js";
import { COMMUNITY_TABS, cardActions, communityViews } from "../domain/community-domain.js";

function legacyHref(view) {
  return `/legacy.html?officeId=${encodeURIComponent(session.officeId)}&openOperation=${encodeURIComponent(view.id)}`;
}

function card(view, redraw) {
  const { primary, secondary, needsLegacy } = cardActions(view);
  const run = (button, action, success, danger) => async () => {
    if (danger && !(await confirmDialog({ title: action.label, text: "سيُبلَّغ المكتب الآخر بقرارك.", confirmLabel: action.label, danger: true }))) return;
    await runAction(button, () => runCooperationAction(session.officeId, view.id, action.action), { success });
    redraw();
  };
  const actions = h("div", { class: "os-coop-actions" });
  if (primary) {
    const b = h("button", { type: "button", class: "os-btn primary", "data-coop-action": primary.id }, ic("check"), primary.label);
    b.addEventListener("click", () => run(b, primary, "تم تحديث التعاون")());
    actions.append(b);
  }
  for (const action of secondary) {
    const b = h("button", { type: "button", class: "os-btn secondary", "data-coop-action": action.id }, action.label);
    b.addEventListener("click", () => run(b, action, "تم تحديث التعاون", action.id === "reject_cooperation")());
    actions.append(b);
  }
  if (needsLegacy) actions.append(h("a", { class: "os-btn secondary", href: legacyHref(view), "data-coop-legacy": "" }, ic("link"), view.primaryAction?.label || "فتح التعاون"));
  const line = [view.propertyLine, view.priceOrBudget].filter(Boolean).join(" · ");
  return h("article", { class: "os-card os-coop-card", "data-coop": view.id },
    h("div", { class: "os-coop-icon" }, ic("users")),
    h("div", { class: "os-coop-copy" },
      h("h3", { text: view.kindLabel }),
      view.partnerOfficeName ? h("b", { class: "ref-contact" }, ic("office"), view.partnerOfficeName) : null,
      line ? h("p", { text: line }) : null,
      h("span", { class: `os-coop-status${view.requiresAction ? " is-now" : ""}`, text: view.statusLabel || view.yourTurnLine || "" })),
    actions.childElementCount ? actions : null);
}

export function renderCommunity(container) {
  append(container, h("div", { class: "os-page-head" },
    h("button", { type: "button", class: "os-back", onClick: () => go("office") }, ic("chev-right"), "رجوع"),
    h("h1", { class: "os-page-title", text: "مجتمع الوسطاء" }), h("span")));
  append(container, h("p", { class: "os-sub", text: "طلبات التعاون بين مكتبك والمكاتب الأخرى. لا تُشارك بيانات تواصل العملاء والملاك." }));
  let rows = [];
  let ready = false;
  let tab = "needs";
  const chips = h("div", { class: "os-chips", role: "group", "aria-label": "أقسام مجتمع الوسطاء" });
  const list = h("div", { class: "os-task-list", "aria-live": "polite" });
  const draw = () => {
    const tabs = communityViews(rows, session.officeId);
    if (ready && tab === "needs" && !tabs.needs.length && tabs.waiting.length && !draw.touched) tab = "waiting";
    clear(chips);
    for (const t of COMMUNITY_TABS) {
      const n = tabs[t.id].length;
      chips.append(h("button", { type: "button", class: "os-chip", "data-tab": t.id, "aria-pressed": String(tab === t.id), onClick: () => { draw.touched = true; tab = t.id; draw(); } }, t.label, n ? h("span", { class: "n", text: String(n) }) : null));
    }
    clear(list);
    if (!ready) { append(list, h("div", { class: "os-skeleton" })); return; }
    if (!tabs[tab].length) {
      append(list, h("div", { class: "os-card" }, emptyState("users", tab === "needs" ? "لا شيء يحتاج ردك" : tab === "waiting" ? "لا شيء بانتظار رد" : "لا تعاونات منتهية",
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
