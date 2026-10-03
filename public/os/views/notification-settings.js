/** «الإشعارات» — which kinds of notifications this office / this account receives. */

import { h, ic, clear, append } from "../core/dom.js";
import { back, go } from "../core/nav.js";
import { session } from "../core/session.js";
import { runAction } from "../core/ui.js";
import { loadNotificationPrefs, saveNotificationPrefs } from "../core/notification-prefs.js";
import { NOTIFICATION_CATEGORIES } from "../../js/office-domain.js";

export function renderNotificationSettings(container) {
  append(container, h("div", { class: "os-page-head" },
    h("button", { type: "button", class: "os-back", onClick: () => (session.isManager ? go("settings") : back("tasks")) }, ic("chev-right"), "رجوع"),
    h("h1", { class: "os-page-title", text: "الإشعارات" }), h("span")));
  const body = h("div", {}, h("div", { class: "os-skeleton" }));
  append(container, body);
  loadNotificationPrefs().then((prefs) => {
    clear(body);
    const boxes = {};
    const rows = NOTIFICATION_CATEGORIES.map((category) => {
      const box = h("input", { type: "checkbox", name: category.key, "data-pref": category.key });
      box.checked = prefs[category.key] !== false;
      boxes[category.key] = box;
      return h("label", { class: "os-pref-row" }, h("span", { text: category.label }), box);
    });
    const status = h("div", { class: "os-alert", role: "status", hidden: true });
    const save = h("button", { type: "button", class: "os-btn primary block", "data-pref-save": "" }, ic("check"), "حفظ تفضيلات الإشعارات");
    save.addEventListener("click", () => runAction(save, async () => {
      const result = await saveNotificationPrefs(Object.fromEntries(Object.entries(boxes).map(([k, el]) => [k, el.checked])));
      status.className = "os-alert ok";
      status.textContent = result.scope === "office" ? "تم حفظ تفضيلات الإشعارات لهذا المكتب" : "تم الحفظ لحسابك فقط. يطبّق مدير المكتب تفضيلات المكتب على الإشعارات.";
      status.hidden = false;
    }, { success: "تم الحفظ", onError: () => { status.className = "os-alert bad"; status.textContent = "تعذر حفظ تفضيلات الإشعارات"; status.hidden = false; } }));
    append(body,
      h("div", { class: "os-card" },
        h("p", { class: "os-sub", text: "تُحفظ لهذا المكتب ولحسابك، ولا تصل إشعارات هذا المكتب إلى أي مكتب آخر. إيقاف نوع هنا يمنع إرساله من الخادم أيضًا." }),
        h("div", { class: "os-pref-list" }, rows)),
      status, save);
  }).catch(() => { clear(body); append(body, h("div", { class: "os-alert bad", text: "تعذر قراءة تفضيلات الإشعارات لهذا المكتب" })); });
  return null;
}
