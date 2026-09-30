/** «دخول المكتب» — office owners and brokers only. Clients/owners never need an account. */

import { h, ic, clear, append } from "../core/dom.js";
import { signInOffice } from "../core/session.js";
import { runAction } from "../core/ui.js";

export function renderLogin(root, { onSignedIn, message = "" } = {}) {
  clear(root);
  const phone = h("input", { class: "os-input", name: "phone", inputmode: "tel", dir: "ltr", autocomplete: "username", placeholder: "05XXXXXXXX", required: true });
  const password = h("input", { class: "os-input", name: "password", type: "password", autocomplete: "current-password", required: true });
  const toggle = h("button", { type: "button", class: "os-btn ghost", onClick: () => { password.type = password.type === "password" ? "text" : "password"; toggle.lastChild.textContent = password.type === "password" ? "إظهار كلمة المرور" : "إخفاء كلمة المرور"; } }, ic("eye"), h("span", { text: "إظهار كلمة المرور" }));
  const status = h("div", { class: `os-alert bad`, role: "alert", hidden: !message, text: message });
  const submit = h("button", { type: "submit", class: "os-btn primary block" }, ic("key"), "دخول المكتب");
  const form = h("form", { class: "os-form", novalidate: true },
    h("label", { class: "os-field" }, h("span", { text: "رقم الجوال" }), phone),
    h("label", { class: "os-field" }, h("span", { text: "كلمة المرور" }), password),
    toggle, status, submit,
    h("a", { href: "/legacy.html#forgot", class: "os-btn ghost", style: { justifySelf: "center" } }, "نسيت كلمة المرور"));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.hidden = true;
    const ok = await runAction(submit, () => signInOffice(phone.value, password.value), {
      onError: (error) => { status.textContent = error.message; status.hidden = false; }
    });
    if (ok) onSignedIn?.();
  });
  append(root, h("main", { class: "os-app", style: { maxWidth: "460px" } },
    h("div", { class: "os-public-hero" },
      h("div", { class: "os-public-logo" }, h("img", { src: "/icons/iaqar-logo.png", alt: "iAqar.ai", class: "os-site-logo" })),
      h("h1", { class: "os-public-title", text: "دخول المكتب" }),
      h("div", { class: "os-public-rule" }),
      h("p", { class: "os-sub", text: "للمكاتب والوسطاء المعتمدين فقط. العملاء والملاك يرسلون بياناتهم من رابط المكتب دون حساب." })),
    h("div", { class: "os-card" }, form)));
  phone.focus({ preventScroll: true });
}
