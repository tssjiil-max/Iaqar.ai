/** Manager settings: assignment rule, deal-completion permission, brokers list. */

import { h, ic, clear, append } from "../core/dom.js";
import { go } from "../core/nav.js";
import { session } from "../core/session.js";
import { listMembers, officeSetting, saveOfficeSetting } from "../core/live.js";
import { runAction } from "../core/ui.js";

const ROLE_LABEL = { owner: "مالك المكتب", admin: "مدير", manager: "مدير", broker: "وسيط", agent: "وسيط" };

function memberName(member) {
  if (member.id === session.office?.ownerUid) return session.office?.brokerName || "مالك المكتب";
  return member.displayName || member.name || member.brokerName || `وسيط ${String(member.id).slice(0, 5)}`;
}

export function renderSettings(container) {
  append(container, h("div", { class: "os-page-head" },
    h("button", { type: "button", class: "os-back", onClick: () => go("settings") }, ic("chev-right"), "رجوع"),
    h("h1", { class: "os-page-title", text: "الوسطاء والإسناد والصلاحيات" }), h("span")));
  if (!session.isManager) {
    append(container, h("div", { class: "os-alert warn", text: "هذه الإعدادات لمدير المكتب فقط." }));
    return null;
  }
  const body = h("div", {}, h("div", { class: "os-skeleton" }));
  append(container, body);
  Promise.all([listMembers(session.officeId), officeSetting(session.officeId, "assignment"), officeSetting(session.officeId, "deals")])
    .then(([members, assignment, deals]) => {
      clear(body);
      const active = members.filter((m) => m.active !== false);
      if (!active.some((m) => m.id === session.office?.ownerUid) && session.office?.ownerUid) active.unshift({ id: session.office.ownerUid, role: "owner" });
      const select = h("select", { class: "os-select", name: "defaultBrokerId" },
        h("option", { value: "", text: "مالك المكتب (الافتراضي)" }),
        active.map((m) => h("option", { value: m.id, text: `${memberName(m)} — ${ROLE_LABEL[m.role] || "وسيط"}` })));
      select.value = assignment.defaultBrokerId || "";
      const mayClose = h("input", { type: "checkbox", name: "brokerMayClose" });
      mayClose.checked = deals.brokerMayClose === true;
      const save = h("button", { type: "button", class: "os-btn primary block" }, ic("check"), "حفظ الإعدادات");
      save.addEventListener("click", () => runAction(save, async () => {
        await saveOfficeSetting(session.officeId, "assignment", { defaultBrokerId: select.value, updatedBy: session.user.uid });
        await saveOfficeSetting(session.officeId, "deals", { brokerMayClose: mayClose.checked, updatedBy: session.user.uid });
      }, { success: "تم حفظ الإعدادات" }));
      append(body, 
        h("div", { class: "os-card" },
          h("h2", { class: "os-h2", style: { marginBottom: "8px" } }, ic("inbox"), "إسناد ما يصل من رابط المكتب"),
          h("p", { class: "os-sub", style: { marginBottom: "8px" }, text: "العروض والطلبات المسجلة عبر رابط المكتب تُسند تلقائيًا لهذا الوسيط، وتصله مهامها وتنبيهاتها." }),
          select),
        h("div", { class: "os-card" },
          h("h2", { class: "os-h2", style: { marginBottom: "8px" } }, ic("shield"), "إتمام الصفقات"),
          h("label", { style: { display: "flex", gap: "10px", alignItems: "center" } }, mayClose,
            h("span", { text: "السماح للوسيط المسؤول عن الفرصة بإتمام الصفقة (وإلا يتطلب مدير المكتب)" }))),
        h("div", { class: "os-card" },
          h("h2", { class: "os-h2", style: { marginBottom: "8px" } }, ic("users"), "الوسطاء"),
          h("ul", { class: "os-list" }, active.map((m) => h("li", {}, ic("user"), `${memberName(m)} — ${ROLE_LABEL[m.role] || "وسيط"}`))),
          h("p", { class: "os-sub", style: { marginTop: "8px", fontSize: ".86rem" }, text: "إضافة وسيط جديد تتم من إدارة المنصة." })),
        save
      );
    })
    .catch(() => { clear(body); append(body, h("div", { class: "os-alert bad", text: "تعذر تحميل الإعدادات." })); });
  return null;
}
