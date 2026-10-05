/** «دخول المكتب» — office owners and brokers only. Clients/owners never need an account. */

import { h, ic } from "../core/dom.js";
import { signInOffice } from "../core/session.js";
import { runAction } from "../core/ui.js";
import { renderBrokerApplication, renderForgotPassword } from "./auth-flows.js";
import { authField, authShell, passwordControl } from "./auth-shell.js";

export function renderLogin(root, { onSignedIn, message = "", entry = "" } = {}) {
  const back = () => renderLogin(root, { onSignedIn });
  if (entry === "register") return renderBrokerApplication(root, { onBack: back });
  if (entry === "forgot") return renderForgotPassword(root, { onBack: back });
  const phone = h("input", { class: "os-input", name: "phone", inputmode: "tel", dir: "ltr", autocomplete: "username", placeholder: "05XXXXXXXX", required: true });
  const password = h("input", { class: "os-input", name: "password", type: "password", autocomplete: "current-password", required: true });
  const status = h("div", { class: `os-alert bad`, role: "alert", hidden: !message, text: message });
  const submit = h("button", { type: "submit", class: "os-btn primary block" }, ic("key"), "دخول المكتب");
  const form = h("form", { class: "os-form os-auth-form", novalidate: true, "data-login-form": "" },
    authField({ label: "رقم الجوال", input: phone, name: "phone" }),
    authField({ label: "كلمة المرور", input: password, name: "password", control: passwordControl(password) }),
    status, submit,
    h("button", { type: "button", class: "os-btn ghost os-auth-link", "data-forgot": "", onClick: () => renderForgotPassword(root, { onBack: back }) }, "نسيت كلمة المرور"),
    h("div", { class: "os-auth-divider", "aria-hidden": "true" }),
    h("button", { type: "button", class: "os-btn secondary block", "data-broker-signup": "", onClick: () => renderBrokerApplication(root, { onBack: back }) }, "تسجيل وسيط جديد"));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.hidden = true;
    const ok = await runAction(submit, () => signInOffice(phone.value, password.value), {
      onError: (error) => { status.textContent = error.message; status.hidden = false; }
    });
    if (ok) onSignedIn?.();
  });
  authShell(root, {
    screen: "login", title: "دخول المكتب",
    intro: "للمكاتب والوسطاء المعتمدين فقط. العملاء والملاك يرسلون بياناتهم من رابط المكتب دون حساب.",
    body: form
  });
  phone.focus({ preventScroll: true });
}
