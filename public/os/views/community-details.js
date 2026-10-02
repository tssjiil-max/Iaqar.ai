/** تفاصيل التعاون: الوسطاء (وسيط العرض · وسيط الطلب · وسيط مشارك) واتفاق نسب العمولة. */

import { h, ic, append, clear } from "../core/dom.js";
import { session } from "../core/session.js";
import { listMembers } from "../core/live.js";
import { runAction, openSheet } from "../core/ui.js";
import { addParticipatingBroker, saveCommission } from "../core/community.js";
import {
  BROKER_ROLE, HARD_MAX_BROKERS_PER_COOPERATION, MAX_BROKERS_MESSAGE, cooperationBrokerCount, cooperationBrokers,
  defaultCommission, readCommission, resolveCooperationSides, validateCommission
} from "../../js/cooperation-brokers-domain.js";
import { turnLine } from "../domain/community-domain.js";
import { formatDateTime } from "../domain/format-domain.js";

const SHARE_ROWS = [
  ["propertyBrokerShare", "وسيط العرض"],
  ["requestBrokerShare", "وسيط الطلب"],
  ["participatingBrokerShare", "وسيط مشارك"]
];

function officeLabel(view, officeId) {
  return String(officeId).toLowerCase() === String(session.officeId).toLowerCase() ? "مكتبك" : (view.partnerOfficeName || "المكتب الآخر");
}

/** Number inputs for the shares with a live total; calls back with the shares and whether they total 100. */
function sharesEditor(initial, { withThird, onChange }) {
  const inputs = {};
  const total = h("b", { class: "os-share-total" });
  const rows = SHARE_ROWS.filter(([key]) => withThird || key !== "participatingBrokerShare").map(([key, label]) => {
    inputs[key] = h("input", { class: "os-input", type: "number", inputmode: "numeric", min: "0", max: "100", step: "1", name: key, value: String(initial[key] ?? 0), dir: "ltr" });
    inputs[key].addEventListener("input", refresh);
    return h("label", { class: "os-share-row" }, h("span", { text: label }), h("span", { class: "os-share-input" }, inputs[key], h("i", { text: "%" })));
  });
  const read = () => Object.fromEntries(Object.keys(inputs).map((key) => [key, inputs[key].value]));
  function refresh() {
    const result = validateCommission(read(), withThird ? 3 : 2);
    const sum = Object.values(read()).reduce((a, v) => a + (Number(v) || 0), 0);
    total.textContent = `المجموع ${sum}%`;
    total.classList.toggle("is-bad", !result.ok);
    onChange(result.ok ? result.shares : null, result.ok ? "" : result.message);
  }
  const box = h("div", { class: "os-shares" }, rows, h("div", { class: "os-share-row os-share-sum" }, h("span", { text: "المجموع" }), total));
  refresh();
  return { box, read };
}

export function openCooperationDetails(view, { onChanged } = {}) {
  const record = view.record || {};
  const body = h("div", { class: "os-coop-details", "data-coop-details": view.id });
  const sheetRef = { close: () => {} };
  const redraw = () => { clear(body); fill(); };

  function brokersSection() {
    const list = h("ul", { class: "os-list os-coop-brokers" }, cooperationBrokers(record, { officeId: session.officeId }).map((row) =>
      h("li", { "data-broker-role": row.role },
        ic(row.role === BROKER_ROLE.PARTICIPATING_BROKER ? "user" : "broker"),
        h("span", {}, h("b", { text: row.label }), h("small", { text: [officeLabel(view, row.officeId), row.name].filter(Boolean).join(" · ") })))));
    return h("section", { class: "os-card" }, h("h3", { class: "os-h2", text: `الوسطاء (${cooperationBrokerCount(record)} من ${HARD_MAX_BROKERS_PER_COOPERATION})` }), list);
  }

  function commissionSection() {
    const current = readCommission(record);
    const count = cooperationBrokerCount(record);
    const rows = SHARE_ROWS.filter(([key]) => key !== "participatingBrokerShare" || count >= 3)
      .map(([key, label]) => h("div", { class: "os-share-row", "data-share": key }, h("span", { text: label }), h("b", { text: `${current[key]}%` })));
    const note = current.agreed
      ? `آخر اتفاق: ${record.commissionAgreementUpdatedAt ? formatDateTime(record.commissionAgreementUpdatedAt) : ""}`.trim()
      : "نسب مبدئية قابلة للتعديل والاتفاق بين الطرفين، وليست حكمًا ملزمًا.";
    const section = h("section", { class: "os-card" }, h("h3", { class: "os-h2", text: "اتفاق التعاون" }), h("div", { class: "os-shares" }, rows), h("p", { class: "os-field-note", text: note }));
    if (view.active) {
      const edit = h("button", { type: "button", class: "os-btn secondary", "data-edit-commission": "" }, ic("edit"), "تعديل النسب");
      edit.addEventListener("click", () => {
        let valid = null;
        const save = h("button", { type: "button", class: "os-btn primary block", "data-save-commission": "" }, ic("check"), "حفظ الاتفاق");
        const error = h("div", { class: "os-field-error", role: "alert" });
        const editor = sharesEditor(current, { withThird: count >= 3, onChange: (shares, message) => { valid = shares; save.disabled = !shares; error.textContent = message; } });
        save.addEventListener("click", () => runAction(save, async () => {
          await saveCommission(session.officeId, view.id, valid);
          Object.assign(record, valid, { commissionAgreementUpdatedAt: new Date().toISOString(), commissionAgreementUpdatedBy: session.user?.uid || "" });
          redraw(); onChanged?.();
        }, { success: "تم حفظ اتفاق التعاون" }));
        clear(section); append(section, h("h3", { class: "os-h2", text: "اتفاق التعاون" }), editor.box, error, save);
      });
      section.append(edit);
    }
    return section;
  }

  function participatingSection() {
    if (!view.active) return null;
    const count = cooperationBrokerCount(record);
    if (count >= HARD_MAX_BROKERS_PER_COOPERATION) return h("p", { class: "os-field-note", "data-max-brokers": "", text: MAX_BROKERS_MESSAGE });
    const add = h("button", { type: "button", class: "os-btn secondary block", "data-add-participating": "" }, ic("plus"), "إضافة وسيط مشارك");
    const holder = h("section", { class: "os-card" }, add);
    add.addEventListener("click", async () => {
      clear(holder);
      append(holder, h("h3", { class: "os-h2", text: "إضافة وسيط مشارك" }), h("div", { class: "os-skeleton" }));
      let members = [];
      try { members = await listMembers(session.officeId); } catch (_) { /* shown as empty below */ }
      const sides = resolveCooperationSides(record);
      const taken = new Set([sides.propertyBrokerId, sides.requestBrokerId].filter(Boolean));
      const options = members.filter((m) => m.active !== false && !taken.has(m.id));
      if (session.office?.ownerUid && !taken.has(session.office.ownerUid) && !options.some((m) => m.id === session.office.ownerUid)) options.unshift({ id: session.office.ownerUid, displayName: session.office.brokerName || "مالك المكتب" });
      clear(holder);
      if (!options.length) { append(holder, h("h3", { class: "os-h2", text: "إضافة وسيط مشارك" }), h("p", { class: "os-field-note", text: "لا يوجد وسيط آخر في مكتبك يمكن إضافته." })); return; }
      const select = h("select", { class: "os-select", name: "participatingBroker" }, options.map((m) => h("option", { value: m.id, text: m.displayName || m.name || m.brokerName || `وسيط ${String(m.id).slice(0, 5)}` })));
      let valid = null;
      const save = h("button", { type: "button", class: "os-btn primary block", "data-save-participating": "" }, ic("check"), "إضافة الوسيط");
      const error = h("div", { class: "os-field-error", role: "alert" });
      const editor = sharesEditor(defaultCommission(3), { withThird: true, onChange: (shares, message) => { valid = shares; save.disabled = !shares; error.textContent = message; } });
      save.addEventListener("click", () => runAction(save, async () => {
        await addParticipatingBroker(session.officeId, view.id, select.value, valid);
        const chosen = options.find((m) => m.id === select.value) || {};
        Object.assign(record, valid, { participatingBrokerId: select.value, participatingBrokerOfficeId: session.officeId, participatingBrokerName: chosen.displayName || chosen.name || chosen.brokerName || "" });
        redraw(); onChanged?.();
      }, { success: "تمت إضافة الوسيط المشارك" }));
      append(holder, h("h3", { class: "os-h2", text: "إضافة وسيط مشارك" }),
        h("label", { class: "os-field" }, h("span", { text: "الوسيط" }), select),
        h("p", { class: "os-field-note", text: "وسيط واحد فقط، من وسطاء مكتبك. وزّع النسب بحيث يكون المجموع 100%." }), editor.box, error, save);
    });
    return holder;
  }

  function fill() {
    const line = [view.propertyLine, view.priceOrBudget].filter(Boolean).join(" · ");
    append(body,
      h("div", { class: "os-coop-head" }, h("b", { text: view.partnerOfficeName || "المكتب الآخر" }), line ? h("small", { text: line }) : null, h("small", { text: turnLine(view) })),
      brokersSection(), commissionSection(), participatingSection());
  }
  fill();
  const opened = openSheet("تفاصيل التعاون", body);
  sheetRef.close = opened.close;
  return opened;
}
