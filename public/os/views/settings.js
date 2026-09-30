/** One-person office settings inside the new Office OS. */

import { h, ic, append, field } from "../core/dom.js";
import { back } from "../core/nav.js";
import { session } from "../core/session.js";
import { saveOfficeProfile } from "../core/live.js";
import { enableNotifications, notificationStatus } from "../core/notifications.js";
import { runAction, toast } from "../core/ui.js";
import { officeProfilePatch, officeProfileValues } from "../domain/office-profile-domain.js";
import { officePublicLink, shareOfficeLink } from "./shell.js";

function input(name, value, options = {}) {
  return h("input", {
    class: "os-input",
    name,
    value: value || "",
    maxlength: options.maxlength || "80",
    inputmode: options.inputmode,
    dir: options.dir,
    placeholder: options.placeholder || "",
    disabled: options.disabled === true
  });
}

export function renderSettings(container) {
  const office = session.office || {};
  const values = officeProfileValues(office);
  const canEdit = session.isManager === true;

  append(container, h("div", { class: "os-page-head" },
    h("button", { type: "button", class: "os-back", onClick: () => back("office") }, ic("chev-right"), "رجوع"),
    h("h1", { class: "os-page-title", text: "إعدادات المكتب" }),
    h("span")));

  if (!canEdit) {
    append(container, h("div", { class: "os-alert warn", text: "يمكنك عرض بيانات المكتب، والتعديل متاح لمالك المكتب أو المدير فقط." }));
  }

  const officeName = input("officeName", values.officeName, { disabled: !canEdit });
  const brokerName = input("brokerName", values.brokerName, { disabled: !canEdit });
  const phone = input("phone", values.phone, { maxlength: "20", inputmode: "tel", dir: "ltr", placeholder: "05XXXXXXXX", disabled: !canEdit });
  const whatsapp = input("whatsapp", values.whatsapp, { maxlength: "20", inputmode: "tel", dir: "ltr", placeholder: "05XXXXXXXX", disabled: !canEdit });
  const licenseNumber = input("licenseNumber", values.licenseNumber, { maxlength: "80", dir: "ltr", disabled: !canEdit });
  const city = input("city", values.city, { maxlength: "60", disabled: !canEdit });

  const publicLink = officePublicLink();
  const linkInput = h("input", { class: "os-input", value: publicLink, readonly: true, dir: "ltr", onFocus: (event) => event.target.select() });
  const share = h("button", { type: "button", class: "os-btn secondary" }, ic("link"), "مشاركة رابط المكتب");
  share.addEventListener("click", () => shareOfficeLink());

  const notifications = h("button", { type: "button", class: "os-btn secondary" }, ic("bell"), `تنبيهات هذا الجهاز (${notificationStatus()})`);
  notifications.addEventListener("click", async () => {
    const result = await enableNotifications();
    notifications.textContent = `تنبيهات هذا الجهاز (${notificationStatus()})`;
    toast(result.message, result.ok ? "ok" : "bad");
  });

  const save = h("button", { type: "button", class: "os-btn primary block", disabled: !canEdit }, ic("check"), "حفظ بيانات المكتب");
  save.addEventListener("click", () => runAction(save, async () => {
    const patch = officeProfilePatch({
      officeName: officeName.value,
      brokerName: brokerName.value,
      phone: phone.value,
      whatsapp: whatsapp.value,
      licenseNumber: licenseNumber.value,
      city: city.value
    });
    await saveOfficeProfile(session.officeId, patch);
    Object.assign(session.office, patch);
    document.title = patch.officeName;
  }, { success: "تم حفظ بيانات المكتب" }));

  append(container,
    h("section", { class: "os-card" },
      h("h2", { class: "os-h2" }, ic("home"), "معلومات المكتب"),
      h("div", { class: "os-form" },
        field("اسم المكتب", officeName),
        field("اسم الوسيط", brokerName),
        field("المدينة", city),
        field("رقم رخصة فال", licenseNumber, { optional: true }))),
    h("section", { class: "os-card" },
      h("h2", { class: "os-h2" }, ic("phone"), "بيانات التواصل"),
      h("div", { class: "os-form" },
        field("رقم الجوال", phone, { optional: true }),
        field("رقم واتساب", whatsapp, { optional: true }))),
    h("section", { class: "os-card" },
      h("h2", { class: "os-h2" }, ic("link"), "رابط المكتب"),
      h("p", { class: "os-sub", text: "هذا هو الرابط الذي ترسله للمالك أو العميل لتسجيل عرض أو طلب بدون حساب." }),
      h("div", { class: "os-form" }, linkInput, share)),
    h("section", { class: "os-card" },
      h("h2", { class: "os-h2" }, ic("bell"), "الإشعارات"),
      h("p", { class: "os-sub", text: "فعّل إشعارات هذا الجهاز حتى تصلك تحديثات المهام والتفاوض." }),
      notifications),
    h("section", { class: "os-card" },
      h("h2", { class: "os-h2" }, ic("shield"), "الحساب والأمان"),
      h("p", { class: "os-sub", text: session.user?.email ? `الحساب الحالي: ${session.user.email}` : "أنت داخل حساب المكتب الحالي." })),
    save);

  return null;
}
