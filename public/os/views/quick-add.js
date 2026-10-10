/**
 * «إضافة سريعة» — the office pastes what reached it (WhatsApp, Telegram, a call…): one ad or several.
 * The central analysis splits them into cards; each card is reviewed in the normal record form and saved
 * through the normal save path (same validation, duplicates, matching). Nothing is saved from here in bulk.
 * Similar records are looked for in THIS office's records only (already on the device; nothing is asked of other offices).
 */

import { h, ic, clear, append, field } from "../core/dom.js";
import { go } from "../core/nav.js";
import { api } from "../core/runtime.js";
import { session } from "../core/session.js";
import { state } from "../core/state.js";
import { runAction } from "../core/ui.js";
import { formatNumber } from "../domain/format-domain.js";
import { INTAKE_CHANNELS, INTAKE_ROLES, SMART_FILL_LIMITS, FIELD_LABEL, listingTitle, similarRecords } from "../domain/smart-fill-domain.js";
import { openDraftInForm } from "./record-form.js";
import { SMART_EXAMPLE } from "./smart-fill.js";

// Kept while the app is open, so «رجوع» from a card's review comes back to the same list.
const memory = { text: "", channel: "", role: "OWNER", cards: [], analyzed: false, aiStatus: "" };

function cardView(card, redraw) {
  const l = card.listing;
  const twins = card.saved ? [] : similarRecords(l, state.records || []);
  const facts = [
    l.price ? `${l.kind === "REQUEST" ? "الميزانية" : "السعر"}: ${formatNumber(l.price)}` : "",
    l.city || "", l.area ? `${formatNumber(l.area)} م²` : "", l.urgent === true ? "مستعجل" : l.urgent === false ? "غير مستعجل" : ""
  ].filter(Boolean);
  return h("article", { class: `os-card os-quick-card${card.saved ? " is-saved" : ""}`, "data-quick-card": String(card.index) },
    h("div", { class: "os-quick-card-head" },
      h("span", { class: "os-quick-num", text: String(card.index + 1) }),
      h("b", { text: listingTitle(l) })),
    facts.length ? h("p", { class: "os-sub", text: facts.join(" · ") }) : null,
    (l.missing.length || !l.phone) ? h("p", { class: "os-quick-missing", "data-card-missing": "" }, ic("info"), ` ناقص: ${[...l.missing.map((m) => FIELD_LABEL[m] || m), l.phone ? "" : "رقم الجوال"].filter(Boolean).join("، ")}`) : null,
    twins.length ? h("div", { class: "os-alert warn", "data-duplicate-warning": "" }, ic("alert"), " يشبه سجلًا موجودًا في مكتبك: ",
      ...twins.map((r) => h("button", { type: "button", class: "os-link-btn", onClick: () => go(`record/${r.id}`), text: listingTitle({ kind: String(r.opportunityKind || "").toUpperCase(), propertyType: r.propertyType, districts: [r.district].filter(Boolean) }) }))) : null,
    h("details", { class: "os-quick-original" }, h("summary", { text: "النص الأصلي" }), h("p", { text: l.original })),
    card.saved
      ? h("p", { class: "os-quick-saved", "data-card-saved": "" }, ic("check-circle"), card.duplicate ? " موجود مسبقًا — فتحنا السجل الحالي" : " تم الحفظ", h("button", { type: "button", class: "os-link-btn", onClick: () => go(`record/${card.recordId}`), text: "فتح السجل" }))
      : h("div", { class: "os-btn-row" },
        h("button", { type: "button", class: "os-btn primary", "data-card-review": "", onClick: () => {
          openDraftInForm({
            listing: l,
            origin: { channel: memory.channel, role: memory.role },
            onSaved: (recordId, duplicate) => { Object.assign(card, { saved: true, recordId, duplicate }); }
          });
          go(`record/new?kind=${l.kind || "OFFER"}`);
        } }, ic("check"), "مراجعة وحفظ"),
        h("button", { type: "button", class: "os-btn secondary", "data-card-drop": "", onClick: () => { memory.cards = memory.cards.filter((c) => c !== card); redraw(); } }, ic("x"), "استبعاد")));
}

export function renderQuickAdd(container) {
  const draw = () => {
    clear(container);
    const textarea = h("textarea", { class: "os-textarea os-smart-text", name: "quickText", rows: "7", maxlength: String(SMART_FILL_LIMITS.maxChars), placeholder: `${SMART_EXAMPLE}\nيمكن لصق أكثر من إعلان — افصل بينها بسطر فارغ.`, text: memory.text });
    textarea.addEventListener("input", () => { memory.text = textarea.value; });
    const channel = h("select", { class: "os-input", name: "quickChannel" }, h("option", { value: "", text: "اختر" }), INTAKE_CHANNELS.map((c) => h("option", { value: c.id, text: c.label, selected: memory.channel === c.id })));
    channel.addEventListener("change", () => { memory.channel = channel.value; });
    const role = h("select", { class: "os-input", name: "quickRole" }, INTAKE_ROLES.map((r) => h("option", { value: r.id, text: r.label, selected: memory.role === r.id })));
    role.addEventListener("change", () => { memory.role = role.value; });
    const analyzeBtn = h("button", { type: "button", class: "os-btn primary block", "data-smart-analyze": "" }, ic("sparkles"), "تحليل وترتيب البيانات");
    const status = h("div", { class: "os-alert", role: "alert", hidden: true });
    analyzeBtn.addEventListener("click", async () => {
      status.hidden = true;
      if (memory.text.trim().length < SMART_FILL_LIMITS.minChars) { status.className = "os-alert bad"; status.textContent = "الصق الإعلان أو اكتب التفاصيل أولًا"; status.hidden = false; return; }
      let failure = "";
      const result = await runAction(analyzeBtn, () => api("/os/smart-fill", { officeId: session.officeId, text: memory.text, multi: true }), { onError: (e) => { failure = e?.message || ""; } });
      if (!result?.ok) { status.className = "os-alert bad"; status.textContent = `${failure || "تعذر التحليل الآن"} — النص محفوظ، ويمكنك الإضافة يدويًا من «إضافة عرض/طلب».`; status.hidden = false; return; }
      memory.analyzed = true;
      memory.aiStatus = result.aiStatus || "";
      memory.cards = result.notRealEstate ? [] : result.listings.map((listing, index) => ({ index, listing, saved: false }));
      if (result.notRealEstate) { status.className = "os-alert warn"; status.textContent = "لم نجد في النص بيانات عقار (النوع، الحي، السعر…)."; status.hidden = false; return; }
      draw();
      // One ad: straight to its review in the form.
      if (memory.cards.length === 1) container.querySelector("[data-quick-cards] [data-card-review]")?.click();
    });
    const pending = memory.cards.filter((c) => !c.saved).length;
    append(container,
      h("div", { class: "os-page-head" },
        h("button", { type: "button", class: "os-back", onClick: () => go("office") }, ic("chev-right"), "رجوع"),
        h("h1", { class: "os-page-title", text: "إضافة سريعة" }), h("span")),
      h("section", { class: "os-card os-form" },
        h("p", { class: "os-sub", text: "الصق إعلانًا وصلك من مالك أو عميل أو وسيط متعاون — أو عدة إعلانات — ثم راجع كل واحد قبل حفظه." }),
        h("label", { class: "os-field" }, h("span", { text: "الصق إعلانك أو اكتب التفاصيل" }), textarea),
        h("div", { class: "os-row2" }, field("مصدر البيانات", channel, { optional: true }), field("صفة صاحب الإعلان", role)),
        analyzeBtn, status),
      memory.cards.length ? h("section", { class: "os-quick-cards", "data-quick-cards": "" },
        h("h2", { class: "os-h2", text: memory.cards.length > 1 ? `وجدنا ${memory.cards.length} إعلانات${pending < memory.cards.length ? ` — باقي ${pending}` : ""}` : "الإعلان" }),
        memory.cards.map((card) => cardView(card, draw)),
        h("small", { class: "os-sub", text: "لا يُحفظ أي إعلان قبل مراجعته وضغط «حفظ» في نموذجه." })) : null);
  };
  draw();
}
