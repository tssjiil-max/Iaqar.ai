/**
 * «حد المالك» on an offer's page — the office manager only. The lowest price the owner authorised, with how that
 * approval was obtained. Stored by the Worker apart from the record: never shown to clients, other offices or
 * brokers, and the WhatsApp agent only uses it to tell the office «ضمن تفويض المالك» — never to accept anything.
 */
import { h, ic, clear, append, surface, field, feedback } from "../core/dom.js";
import { api } from "../core/runtime.js";
import { session } from "../core/session.js";
import { runAction } from "../core/ui.js";
import { formatNumber } from "../domain/format-domain.js";

export function recordMandatePanel(recordId) {
  const body = h("div", { class: "os-form" });
  const panel = surface("section", { class: "os-card", "data-record-mandate": "" },
    h("div", { class: "os-card-head" }, h("h2", { class: "os-h2" }, ic("shield"), "حد المالك (سري)")),
    h("p", { class: "os-sub", text: "أقل سعر وافق عليه المالك لهذا العرض. لا يظهر لأي عميل أو مكتب آخر. عند وصول عرض سعر من واتساب يُخبرك الموظف الذكي هل هو ضمن التفويض، ولا يقبل أي سعر بنفسه." }),
    body);

  const draw = (mandate) => {
    clear(body);
    const floor = h("input", { class: "os-input", name: "mandateFloor", inputmode: "numeric", dir: "ltr", placeholder: "مثال: 1400000", value: mandate?.floor ? String(mandate.floor) : "", "data-mandate-floor": "" });
    const source = h("input", { class: "os-input", name: "mandateSource", maxlength: 200, placeholder: "مثال: اتصال مع المالك اليوم، تفويض مكتوب", value: mandate?.source || "", "data-mandate-source": "" });
    const save = h("button", { type: "button", class: "os-btn soft", "data-mandate-save": "" }, ic("check"), "حفظ الحد");
    const remove = mandate ? h("button", { type: "button", class: "os-btn secondary", "data-mandate-clear": "" }, ic("x"), "إزالة الحد") : null;
    save.addEventListener("click", () => runAction(save, async () => {
      const r = await api("/os/records/mandate/set", { officeId: session.officeId, recordId, floor: Number(String(floor.value).replace(/[^\d]/g, "")) || 0, source: source.value });
      draw(r.mandate);
    }, { success: "حُفظ حد المالك" }));
    remove?.addEventListener("click", () => runAction(remove, async () => {
      const r = await api("/os/records/mandate/set", { officeId: session.officeId, recordId, floor: 0 });
      draw(r.mandate);
    }, { success: "أُزيل حد المالك — كل عرض سعر يحتاج رد المالك" }));
    append(body,
      mandate ? h("p", { class: "os-sub", "data-mandate-current": String(mandate.floor), text: `الحد الحالي: ${formatNumber(mandate.floor)} ريال · المصدر: ${mandate.source}` }) : h("p", { class: "os-sub", "data-mandate-current": "", text: "لا يوجد حد مسجل: كل عرض سعر يحتاج رد المالك." }),
      field("أقل سعر وافق عليه المالك (ريال)", floor),
      field("مصدر موافقة المالك", source),
      h("div", { class: "os-btn-row" }, save, remove));
  };

  api("/os/records/mandate", { officeId: session.officeId, recordId })
    .then((r) => draw(r.mandate))
    .catch((error) => { clear(body); append(body, feedback({ class: "os-alert bad", text: error?.message || "تعذر تحميل حد المالك." })); });
  return panel;
}
