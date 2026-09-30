/**
 * Building blocks shared by the party session page (/s) and the broker's session
 * view — one look for both, from the Office OS design system.
 */

import { h, ic } from "../core/dom.js";
import { propertyTypeIcon } from "../core/icons.js";
import { formatPrice, relativeAgo } from "../domain/format-domain.js";

const EVENT_ICON = { owner: "owner", client: "client", broker: "broker" };

/** Fixed card: نوع العقار · الحي · السعر الحالي · مرحلة الصفقة. */
export function sessionSummary({ propertyType, district, currentPrice, agreedPrice, stageLabel, intervention }) {
  const cell = (icon, label, value, strong = false) => h("div", { class: "os-session-cell" },
    h("span", { class: "ic" }, ic(icon)),
    h("div", {}, h("small", { text: label }), h(strong ? "b" : "span", { text: value || "—" })));
  return h("section", { class: "os-card os-session-summary", "aria-label": "ملخص الصفقة" },
    h("div", { class: "os-session-grid" },
      cell(propertyTypeIcon(propertyType), "نوع العقار", propertyType),
      cell("pin", "الحي", district),
      cell("coins", agreedPrice ? "السعر المتفق عليه" : "السعر الحالي", formatPrice(agreedPrice || currentPrice), true),
      cell("flag", "مرحلة الصفقة", stageLabel)),
    intervention ? h("div", { class: "os-session-flag", role: "status" }, ic("alert"), "تدخل مطلوب — الوسيط يتابع الجلسة") : null);
}

/** One small card per event: who · what · price · when. */
export function sessionEventList(cards = [], { emptyText = "لا توجد حركات بعد." } = {}) {
  if (!cards.length) return h("p", { class: "os-sub os-session-empty", text: emptyText });
  return h("ol", { class: "os-session-log" }, cards.map((card) => h("li", {
    class: `os-session-event${card.mine ? " mine" : ""}${card.actor === "broker" ? " broker" : ""}${card.private ? " private" : ""}`,
    "data-event": card.id || ""
  },
  h("span", { class: "ic" }, ic(EVENT_ICON[card.actor] || "info")),
  h("div", { class: "body" },
    h("b", { text: card.who }),
    card.text ? h("span", { class: "what", text: card.text }) : null,
    card.detail ? h("span", { class: "price", text: card.detail }) : null,
    card.private ? h("small", { class: "tag", text: "خاص بالوسيط" }) : null),
  h("time", { class: "when", text: relativeAgo(card.at) }))));
}
