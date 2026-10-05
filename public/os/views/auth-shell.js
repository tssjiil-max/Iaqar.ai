/**
 * One look for the pre-login screens («دخول المكتب» · «تسجيل وسيط عقاري» · «نسيت كلمة المرور»):
 * the same centred card, hero, field layout, password eye and field states.
 * Presentation only — what is sent and how it is checked stays in core/ and domain/.
 */

import { h, ic, clear, append } from "../core/dom.js";

let fieldSeq = 0;

/** The page: calm background, logo + title + intro, then the card. `note` = an important notice under the title. */
export function authShell(root, { screen, title, intro = "", note = "", body, after = null }) {
  clear(root);
  append(root, h("div", { class: "os-auth-page", "data-auth-screen": screen },
    h("main", { class: "os-app os-auth" },
      h("div", { class: "os-public-hero os-auth-hero" },
        h("div", { class: "os-public-logo" }, h("img", { src: "/icons/iaqar-logo.png", alt: "iAqar.ai", class: "os-site-logo" })),
        h("h1", { class: "os-public-title", text: title }),
        h("div", { class: "os-public-rule" }),
        intro ? h("p", { class: "os-sub os-auth-intro", text: intro }) : null,
        note ? h("p", { class: "os-auth-note", "data-auth-note": "", role: "note" }, ic("shield"), h("span", { text: note })) : null),
      h("div", { class: "os-card os-auth-card" }, body, after))));
}

/**
 * A labelled field with its hint and its own error line.
 * `label` may end with « *»: the star is shown as the required mark, the same way on every screen.
 */
export function authField({ label, input, name, hint = "", control = null }) {
  fieldSeq += 1;
  const id = `auth-${name}-${fieldSeq}`;
  const required = /\s\*$/.test(label) || input.required;
  const text = label.replace(/\s\*$/, "");
  input.id = id;
  if (required) input.setAttribute("aria-required", "true");
  const hintNode = hint ? h("span", { class: "os-field-hint", id: `${id}-hint`, "data-field-hint": name, text: hint }) : null;
  const errorNode = h("span", { class: "os-field-note is-error", id: `${id}-error`, "data-field-error": name, role: "alert", hidden: true });
  input.setAttribute("aria-describedby", [hintNode ? `${id}-hint` : "", `${id}-error`].filter(Boolean).join(" "));
  return h("div", { class: "os-field os-auth-field", "data-field": name },
    h("label", { class: "os-auth-label", for: id }, h("span", { text }), required ? h("span", { class: "os-req", "aria-hidden": "true", text: "*" }) : null),
    control || input, hintNode, errorNode);
}

/** Password input with the eye inside the field. Same behaviour as the old text button: show / hide. */
export function passwordControl(input) {
  const eye = h("button", { type: "button", class: "os-pass-toggle", "data-pass-toggle": "", "aria-label": "إظهار كلمة المرور", "aria-pressed": "false", title: "إظهار كلمة المرور" }, ic("eye"));
  eye.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    const label = show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور";
    eye.setAttribute("aria-label", label);
    eye.setAttribute("aria-pressed", String(show));
    eye.title = label;
    eye.classList.toggle("is-on", show);
    input.focus({ preventScroll: true });
  });
  return h("div", { class: "os-pass" }, input, eye);
}

/** Error / valid state of one field. An empty message clears the error. */
export function setFieldState(form, name, { error = "", valid = false } = {}) {
  const field = form.querySelector(`[data-field="${name}"]`);
  if (!field) return;
  const note = field.querySelector("[data-field-error]");
  const input = field.querySelector("input");
  field.classList.toggle("invalid", Boolean(error));
  field.classList.toggle("is-valid", !error && valid);
  if (input) { if (error) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid"); }
  if (note) { note.textContent = error; note.hidden = !error; }
}

export function showFieldErrors(form, errors = {}) {
  form.querySelectorAll("[data-field]").forEach((field) => setFieldState(form, field.dataset.field, { error: errors[field.dataset.field] || "" }));
}

/** A group of fields with a light heading (no new fields, only visual grouping). */
export function fieldGroup(title, ...fields) {
  return h("fieldset", { class: "os-auth-group", "data-auth-group": "" }, h("legend", { text: title }), ...fields);
}
