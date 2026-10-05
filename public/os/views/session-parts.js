/**
 * Building blocks shared by the party session page (/s) and the broker's session
 * view — one look for both, from the Office OS design system.
 */

import { h, ic } from "../core/dom.js";
import { propertyTypeIcon } from "../core/icons.js";
import { formatPrice, relativeAgo } from "../domain/format-domain.js";

const ROLE_NAME = { owner: "المالك", client: "العميل", broker: "الوسيط" };

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
    intervention ? h("div", { class: "os-session-flag", role: "status" }, ic("alert"), "تدخل مطلوب — الوسيط يتابع الغرفة") : null);
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
    intervention ? h("div", { class: "os-session-flag", role: "status" }, ic("alert"), "تدخل مطلوب — الوسيط يتابع الغرفة") : null);
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

/* ---------- غرفة التفاوض: the three parts, driven by the room rules of this property ---------- */

/** Part 1 — «بيانات العقار»: main photo and the facts that fit this kind of property. */
export function roomPropertyCard({ facts = [], image = "", propertyType = "", priceStatus = "", priceStatusLabel = "", stageLabel = "", description = "", intervention = false, flagText = "" }) {
  const cell = (fact) => h("div", { class: "os-session-cell", "data-fact": fact.id },
    h("span", { class: "ic" }, ic(fact.id === "type" ? propertyTypeIcon(propertyType) : fact.icon)),
    h("div", {}, h("small", { text: fact.label }), h(fact.strong ? "b" : "span", { text: fact.value })));
  return h("section", { class: "os-card os-session-summary os-room-part os-room-property", "aria-label": "بيانات العقار", "data-room-part": "property" },
    h("h2", { class: "os-h2 os-part-title" }, ic(propertyTypeIcon(propertyType)), "بيانات العقار",
      stageLabel ? h("span", { class: "os-room-stage", "data-room-stage": "", text: stageLabel }) : null),
    image ? h("div", { class: "os-room-photo" }, h("img", { src: image, alt: `صورة ${propertyType || "العقار"}`, loading: "lazy", "data-room-image": "" })) : null,
    h("div", { class: "os-session-grid" }, facts.map(cell)),
    h("div", { class: "os-deal-meta" },
      priceStatusLabel ? h("span", { class: `os-price-chip${priceStatus === "FIXED" ? " fixed" : ""}`, text: priceStatusLabel }) : null,
      description ? h("p", { class: "os-deal-desc", text: description }) : null),
    intervention ? h("div", { class: "os-session-flag", role: "status" }, ic("alert"), flagText || "طلبك لدى الوسيط — سيتابعه معك") : null);
}

/** Part 2 — «ما تم الاتفاق عليه»: only what both sides agreed, with who accepted and when. */
export function roomAgreedCard(items = []) {
  return h("section", { class: "os-card os-room-part os-deal-agreed", "aria-label": "ما تم الاتفاق عليه", "data-room-part": "agreed" },
    h("h2", { class: "os-h2 os-part-title" }, ic("check-circle"), "ما تم الاتفاق عليه"),
    items.length
      ? h("ul", { class: "os-agreed-list" }, items.map((item) => h("li", { "data-agreed": item.id },
        ic("check"),
        h("div", { class: "os-agreed-body" },
          h("span", {}, h("span", { text: `${item.label}: ` }), h("b", { text: item.value })),
          item.meta ? h("small", { class: "os-agreed-meta", text: item.meta }) : null,
          item.changing ? h("small", { class: "os-agreed-changing", "data-agreed-changing": "", text: item.changing }) : null))))
      : h("p", { class: "os-sub os-agreed-empty", text: "لم يتم الاتفاق على بند بعد. الاقتراح لا يُعد اتفاقًا حتى يقبله الطرف الآخر." }));
}

/** Part 3 (top) — «المالك مقابل العميل»: each side facing the other, with what is expected from it now. */
export function roomSidesCard({ sides = {}, status = {}, ready = {}, viewer = "broker", priceLabel = "السعر" } = {}) {
  const col = (role) => {
    const side = sides[role] || {};
    const state = status[role] || {};
    const mine = viewer === role;
    const chip = state.turn === "ACT" ? (mine ? "دورك الآن" : "مطلوب رده") : state.turn === "WAIT" ? "بانتظار الطرف الآخر" : "";
    return h("div", { class: `os-deal-side${mine ? " mine" : ""}`, "data-side": role, "data-side-turn": state.turn || "NONE" },
      h("div", { class: "os-deal-side-head" }, ic(EVENT_ICON[role]), h("b", { text: mine ? `${ROLE_NAME[role]} (أنت)` : ROLE_NAME[role] })),
      h("small", { class: "os-deal-side-label", text: priceLabel }),
      h("strong", { class: "os-deal-side-price", text: formatPrice(side.price) || "—" }),
      side.lastText ? h("small", { text: side.lastText }) : null,
      chip ? h("span", { class: `os-side-chip is-${String(state.turn).toLowerCase()}`, "data-side-chip": "", text: chip }) : null,
      state.items?.length ? h("small", { class: "os-side-items", text: state.items.join("، ") }) : null,
      ready[role] ? h("span", { class: "os-side-chip is-ready", "data-side-ready": "", text: "جاهز للاتفاق" }) : null);
  };
  return h("div", { class: "os-deal-sides-grid os-room-versus", "data-room-versus": "" }, col("owner"), h("span", { class: "os-versus-mark", "aria-hidden": "true", text: "مقابل" }), col("client"));
}

/**
 * «بنود الاتفاق» — one row per term of this property and deal. A side answers with buttons only:
 * قبول الشرط · رفض الشرط · اقتراح / اقتراح آخر / تعديل الاقتراح / طلب تعديل (then one of the fixed options).
 * `onAction(action, row, optionId)`; `openTerm` = id of the row whose options are shown.
 */
export function roomTermsList(rows = [], { viewer = "broker", openTerm = "", onToggle = null, onAction = null } = {}) {
  if (!rows.length) return null;
  const other = (role) => (role === "owner" ? "العميل" : "المالك");
  return h("ul", { class: "os-terms", "data-terms": "" }, rows.map((row) => {
    const pending = row.pending;
    const chip = pending ? (viewer === "broker" ? `بانتظار رد ${other(pending.by)}` : row.mine ? `بانتظار رد ${other(viewer)}` : "بانتظار ردك")
      : row.agreed ? "متفق عليه" : "لم يُتفق عليه بعد";
    const line = pending
      ? (row.mine && viewer !== "broker" ? `اقترحت: ${pending.label}` : `اقترح ${ROLE_NAME[pending.by]}: ${pending.label}`)
      : row.agreed ? `المتفق عليه: ${row.agreed.label}`
        : row.rejected ? `لم يُقبل اقتراح «${row.rejected.label}»` : "";
    const buttons = [];
    if (onAction && row.actions?.includes("accept")) {
      const b = h("button", { type: "button", class: "os-btn primary", "data-term-action": "accept" }, ic("check"), "قبول الشرط");
      // The answer carries the option shown here: if the proposal changed meanwhile the server refuses it.
      b.addEventListener("click", () => onAction("term_accept", row, row.pending?.option || ""));
      buttons.push(b);
    }
    if (onAction && row.actions?.includes("reject")) {
      const b = h("button", { type: "button", class: "os-btn danger", "data-term-action": "reject" }, ic("x"), "رفض الشرط");
      b.addEventListener("click", () => onAction("term_reject", row, row.pending?.option || ""));
      buttons.push(b);
    }
    if (onAction && row.actions?.includes("propose") && row.options?.length) {
      const b = h("button", { type: "button", class: "os-btn secondary", "data-term-action": "propose", "aria-expanded": String(openTerm === row.id) }, ic("edit"), row.proposeLabel || "اقتراح");
      b.addEventListener("click", () => onToggle && onToggle(row.id));
      buttons.push(b);
    }
    const options = onAction && openTerm === row.id && row.actions?.includes("propose")
      ? h("div", { class: "os-term-options", role: "group", "aria-label": `خيارات ${row.label}` }, row.options.map((option) => {
        const b = h("button", { type: "button", class: "os-chip", "data-term-option": option.id, text: option.label });
        b.addEventListener("click", () => onAction("term_propose", row, option.id));
        return b;
      })) : null;
    return h("li", { class: `os-term is-${String(row.state).toLowerCase()}${pending && !row.mine && viewer !== "broker" ? " needs-me" : ""}`, "data-term": row.id, "data-term-state": row.state },
      h("div", { class: "os-term-head" }, h("b", { text: row.label }), h("span", { class: "os-term-chip", "data-term-chip": "", text: chip })),
      line ? h("p", { class: "os-term-line", "data-term-line": "", text: line }) : null,
      pending && row.agreed ? h("small", { class: "os-term-keep", text: `الساري حتى الآن: ${row.agreed.label}` }) : null,
      buttons.length ? h("div", { class: "os-btn-row os-term-actions" }, buttons) : null,
      options);
  }));
}
