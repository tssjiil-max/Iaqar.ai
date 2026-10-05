/** The «متابعة الصفقة» section bar for the deal's existing pages (kept apart from the hub to avoid import cycles). */

import { h, ic } from "../core/dom.js";
import { go, replace } from "../core/nav.js";
import { FOLLOW_SECTIONS, activeSection, followRoute, followSummary } from "../domain/deal-follow-domain.js";

/**
 * The section bar shown on the deal's existing pages (صفحة الفرصة · غرفة التفاوض): the same five
 * sections one tap away, the current stage, and the way back to «متابعة الصفقة».
 */
export function dealFollowBar(journey, { page = "journey", focus = "" } = {}) {
  const id = journey?.journeyId || journey?.id || "";
  if (!id) return null;
  const summary = followSummary(journey);
  const active = activeSection(page, focus);
  const hub = h("button", { type: "button", class: "os-follow-hub", "data-follow-hub": "" }, ic("flag"), h("span", { text: "متابعة الصفقة" }));
  hub.addEventListener("click", () => go(followRoute(id, "hub")));
  return h("nav", { class: "os-follow-bar", "aria-label": "أقسام متابعة الصفقة", "data-follow-bar": "" },
    h("div", { class: "os-follow-top" }, hub, h("span", { class: "ref-status step-" + summary.step, "data-follow-stage": "", text: summary.stage })),
    h("div", { class: "os-follow-tabs", role: "group" }, FOLLOW_SECTIONS.map((section) => {
      const b = h("button", { type: "button", class: "os-follow-tab", "aria-current": active === section.id ? "page" : null, "data-follow-tab": section.id }, ic(section.icon), h("span", { text: section.label }));
      // A part of the page already open is shown in place (no new history entry); another page is opened normally.
      b.addEventListener("click", () => { const route = followRoute(id, section.id); (route.startsWith(`${page}/`) ? replace : go)(route); });
      return b;
    })));
}

