/** «نسيت كلمة المرور» and «تسجيل وسيط جديد» inside Office OS (pre-login). */

import { h, ic } from "../core/dom.js";
import { requestPasswordReset, submitBrokerApplication } from "../core/auth-flows.js";
import { APPLY_SUCCESS, resetMessage, validateBrokerApplication } from "../domain/auth-flows-domain.js";
import { runAction } from "../core/ui.js";
import { authField, authShell, fieldGroup, passwordControl, setFieldState, showFieldErrors } from "./auth-shell.js";

function frame(root, { screen, title, intro = "", note = "", body, onBack }) {
  authShell(root, {
    screen, title, intro, note, body,
    after: h("button", { type: "button", class: "os-btn ghost block os-auth-link", "data-auth-back": "", onClick: onBack }, ic("chev-right"), "رجوع إلى دخول المكتب")
  });
}

export function renderForgotPassword(root, { onBack } = {}) {
  const phone = h("input", { class: "os-input", name: "phone", inputmode: "tel", dir: "ltr", autocomplete: "username", placeholder: "05XXXXXXXX", required: true });
  const status = h("div", { class: "os-alert", role: "status", hidden: true });
  const submit = h("button", { type: "submit", class: "os-btn primary block" }, ic("key"), "إرسال رابط الاسترجاع");
  const form = h("form", { class: "os-form os-auth-form", novalidate: true, "data-forgot-form": "" }, authField({ label: "رقم الجوال", input: phone, name: "phone" }), status, submit);
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
  frame(root, { screen: "forgot", title: "نسيت كلمة المرور", intro: "أدخل رقم الجوال، وسنرسل رابط إعادة تعيين كلمة المرور إلى البريد المسجل للحساب.", body: form, onBack: () => onBack?.() });
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
  // Same fields, same order — only grouped for the eye: الوسيط · المكتب · الدخول.
  const form = h("form", { class: "os-form os-auth-form", novalidate: true, "data-broker-form": "" },
    fieldGroup("بيانات الوسيط",
      authField({ label: "اسم الوسيط *", input: fields.brokerName, name: "brokerName" }),
      authField({ label: "رقم الجوال *", input: fields.phone, name: "phone", hint: "مثال: 0512345678" }),
      authField({ label: "البريد الإلكتروني للاسترجاع *", input: fields.email, name: "email" })),
    fieldGroup("بيانات المكتب",
      authField({ label: "رقم رخصة فال *", input: fields.falLicense, name: "falLicense" }),
      authField({ label: "اسم المكتب المقترح *", input: fields.officeName, name: "officeName" })),
    fieldGroup("بيانات الدخول",
      authField({ label: "كلمة مرور الحساب *", input: fields.password, name: "password", hint: "8 أحرف أو أكثر", control: passwordControl(fields.password) })),
    status, submit);
  const values = () => Object.fromEntries(Object.entries(fields).map(([k, el]) => [k, el.value]));
  // Field states while filling, from the same rules the form is checked with on sending (nothing is sent here).
  // «صحيح» means the format is right — never that the licence or the request was verified, so the licence shows no such mark.
  for (const [name, el] of Object.entries(fields)) {
    el.addEventListener("blur", () => {
      if (!el.value.trim()) return setFieldState(form, name, {});
      const error = validateBrokerApplication(values()).errors[name] || "";
      setFieldState(form, name, { error, valid: !error && name !== "falLicense" });
    });
    el.addEventListener("input", () => { if (form.querySelector(`[data-field="${name}"]`)?.classList.contains("invalid")) setFieldState(form, name, {}); });
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const ok = await runAction(submit, async () => {
      status.hidden = true;
      showFieldErrors(form, {});
      await submitBrokerApplication(values());
      return true;
    }, { onError: (error) => {
      showFieldErrors(form, error.details?.errors || {});
      status.className = "os-alert bad"; status.textContent = error.message; status.hidden = false;
      form.querySelector(".os-auth-field.invalid input")?.focus({ preventScroll: false });
    } });
    if (ok) {
      form.reset();
      showFieldErrors(form, {});
      status.className = "os-alert ok"; status.textContent = APPLY_SUCCESS; status.hidden = false;
    }
  });
  frame(root, { screen: "register", title: "تسجيل وسيط عقاري", note: "لن يُنشأ المكتب إلا بعد التحقق من رخصة فال واعتماد إدارة المنصة.", body: form, onBack: () => onBack?.() });
  fields.brokerName.focus({ preventScroll: true });
}
