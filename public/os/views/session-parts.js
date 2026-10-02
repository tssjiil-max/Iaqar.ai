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

/* ---------- The negotiation page in three parts (party page and broker view) ---------- */

/** Part 1 — «بيانات العقار»: the known facts only (not negotiated). */
export function propertyCard({ propertyType, district, price, description, priceStatus, priceStatusLabel, stageLabel, intervention }) {
  const cell = (icon, label, value, strong = false) => h("div", { class: "os-session-cell" },
    h("span", { class: "ic" }, ic(icon)),
    h("div", {}, h("small", { text: label }), h(strong ? "b" : "span", { text: value || "—" })));
  return h("section", { class: "os-card os-session-summary os-deal-property", "aria-label": "بيانات العقار" },
    h("h2", { class: "os-h2 os-part-title" }, ic(propertyTypeIcon(propertyType)), "بيانات العقار"),
    h("div", { class: "os-session-grid" },
      cell(propertyTypeIcon(propertyType), "نوع العقار", propertyType),
      cell("pin", "الحي", district),
      cell("coins", "السعر", formatPrice(price), true),
      cell("flag", "مرحلة الصفقة", stageLabel)),
    h("div", { class: "os-deal-meta" },
      h("span", { class: `os-price-chip${priceStatus === "FIXED" ? " fixed" : ""}`, text: priceStatusLabel || "قابل للتفاوض" }),
      description ? h("p", { class: "os-deal-desc", text: description }) : null),
    intervention ? h("div", { class: "os-session-flag", role: "status" }, ic("alert"), "تدخل مطلوب — الوسيط يتابع الجلسة") : null);
}

/** Part 2 — «تم الاتفاق عليه»: only what was actually agreed. */
export function agreedCard(items = []) {
  return h("section", { class: "os-card os-deal-agreed", "aria-label": "تم الاتفاق عليه" },
    h("h2", { class: "os-h2 os-part-title" }, ic("check-circle"), "تم الاتفاق عليه"),
    items.length
      ? h("ul", { class: "os-agreed-list" }, items.map((item) => h("li", { "data-agreed": item.id },
        ic("check"), h("span", { text: `${item.label}: ` }), h("b", { text: item.value }))))
      : h("p", { class: "os-sub os-agreed-empty", text: "لم يتم الاتفاق على بند بعد." }));
}

/** Part 3 — المالك | العميل: each side's current position only. */
export function sidesCard(sides = {}, { viewer = "broker" } = {}) {
  const col = (role, label) => {
    const side = sides[role] || {};
    return h("div", { class: `os-deal-side${viewer === role ? " mine" : ""}`, "data-side": role },
      h("div", { class: "os-deal-side-head" }, ic(EVENT_ICON[role]), h("b", { text: viewer === role ? `${label} (أنت)` : label })),
      h("strong", { class: "os-deal-side-price", text: formatPrice(side.price) || "—" }),
      h("small", { text: side.lastText || "" }));
  };
  return h("section", { class: "os-card os-deal-sides", "aria-label": "المالك والعميل" },
    h("div", { class: "os-deal-sides-grid" }, col("owner", "المالك"), col("client", "العميل")));
}

/** «السجل» — secondary, collapsed: every move is kept automatically. */
export function historyDetails(cards = [], { emptyText = "لا توجد حركات بعد.", note = "" } = {}) {
  return h("details", { class: "os-card os-session-history os-deal-history" },
    h("summary", {}, ic("clock"), h("span", { text: "السجل" }), cards.length ? h("span", { class: "os-count", text: String(cards.length) }) : null),
    sessionEventList(cards, { emptyText }),
    note ? h("p", { class: "os-sub os-session-privacy", text: note }) : null);
}
