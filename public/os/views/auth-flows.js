/** «نسيت كلمة المرور» and «تسجيل وسيط جديد» inside Office OS (pre-login). */

import { h, ic, clear, append } from "../core/dom.js";
import { requestPasswordReset, submitBrokerApplication } from "../core/auth-flows.js";
import { APPLY_SUCCESS, resetMessage } from "../domain/auth-flows-domain.js";
import { runAction } from "../core/ui.js";

function frame(root, title, intro, body, onBack) {
  clear(root);
  append(root, h("main", { class: "os-app", style: { maxWidth: "460px" } },
    h("div", { class: "os-public-hero" },
      h("div", { class: "os-public-logo" }, h("img", { src: "/icons/iaqar-logo.png", alt: "iAqar.ai", class: "os-site-logo" })),
      h("h1", { class: "os-public-title", text: title }),
      h("div", { class: "os-public-rule" }),
      h("p", { class: "os-sub", text: intro })),
    h("div", { class: "os-card" }, body,
      h("button", { type: "button", class: "os-btn ghost block", "data-auth-back": "", onClick: onBack }, "رجوع إلى دخول المكتب"))));
}

function field(label, input, name) {
  return h("label", { class: "os-field" }, h("span", { text: label }), input,
    h("span", { class: "os-field-note is-error", "data-field-error": name, hidden: true }));
}

function showErrors(form, errors = {}) {
  form.querySelectorAll("[data-field-error]").forEach((node) => {
    const message = errors[node.dataset.fieldError] || "";
    node.textContent = message;
    node.hidden = !message;
  });
}

export function renderForgotPassword(root, { onBack } = {}) {
  const phone = h("input", { class: "os-input", name: "phone", inputmode: "tel", dir: "ltr", autocomplete: "username", placeholder: "05XXXXXXXX", required: true });
  const status = h("div", { class: "os-alert", role: "status", hidden: true });
  const submit = h("button", { type: "submit", class: "os-btn primary block" }, ic("key"), "إرسال رابط الاسترجاع");
  const form = h("form", { class: "os-form", novalidate: true, "data-forgot-form": "" }, field("رقم الجوال", phone, "phone"), status, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction(submit, async () => {
      status.hidden = true;
      status.className = "os-alert";
      const payload = await requestPasswordReset(phone.value);
      status.className = "os-alert ok";
      status.textContent = resetMessage(payload);
      status.hidden = false;
    }, { onError: (error) => { status.className = "os-alert bad"; status.textContent = error.message; status.hidden = false; } });
  });
  frame(root, "نسيت كلمة المرور", "أدخل رقم الجوال، وسنرسل رابط إعادة تعيين كلمة المرور إلى البريد المسجل للحساب.", form, () => onBack?.());
  phone.focus({ preventScroll: true });
}

export function renderBrokerApplication(root, { onBack } = {}) {
  const input = (name, attrs = {}) => h("input", { class: "os-input", name, required: true, ...attrs });
  const fields = {
    brokerName: input("brokerName", { maxlength: "80", autocomplete: "name" }),
    phone: input("phone", { inputmode: "tel", dir: "ltr", maxlength: "20", autocomplete: "tel", placeholder: "05XXXXXXXX" }),
    email: input("email", { type: "email", dir: "ltr", maxlength: "120", autocomplete: "email" }),
    falLicense: input("falLicense", { inputmode: "numeric", dir: "ltr", maxlength: "20" }),
    officeName: input("officeName", { maxlength: "80" }),
    password: input("password", { type: "password", minlength: "8", autocomplete: "new-password" })
  };
  const status = h("div", { class: "os-alert", role: "status", hidden: true });
  const submit = h("button", { type: "submit", class: "os-btn primary block" }, ic("check"), "إرسال طلب الاعتماد");
  const form = h("form", { class: "os-form", novalidate: true, "data-broker-form": "" },
    field("اسم الوسيط *", fields.brokerName, "brokerName"),
    field("رقم الجوال *", fields.phone, "phone"),
    field("البريد الإلكتروني للاسترجاع *", fields.email, "email"),
    field("رقم رخصة فال *", fields.falLicense, "falLicense"),
    field("اسم المكتب المقترح *", fields.officeName, "officeName"),
    field("كلمة مرور الحساب *", fields.password, "password"),
    status, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const ok = await runAction(submit, async () => {
      status.hidden = true;
      showErrors(form, {});
      await submitBrokerApplication(Object.fromEntries(Object.entries(fields).map(([k, el]) => [k, el.value])));
      return true;
    }, { onError: (error) => {
      showErrors(form, error.details?.errors || {});
      status.className = "os-alert bad"; status.textContent = error.message; status.hidden = false;
    } });
    if (ok) {
      form.reset();
      status.className = "os-alert ok"; status.textContent = APPLY_SUCCESS; status.hidden = false;
    }
  });
  frame(root, "تسجيل وسيط عقاري", "لن يُنشأ المكتب إلا بعد التحقق من رخصة فال واعتماد إدارة المنصة.", form, () => onBack?.());
  fields.brokerName.focus({ preventScroll: true });
}
