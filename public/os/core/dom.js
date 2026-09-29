/**
 * Minimal DOM builder. Text is always set through textContent, so data from
 * Firestore or visitors can never inject markup.
 */

import { icon } from "./icons.js";

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(el, ...children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === "") continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function ic(name, opts) {
  return icon(name, opts);
}

/** Button with an icon and label. */
export function btn(label, { kind = "primary", iconName = "", chevron = false, block = false, onClick, type = "button", attrs = {} } = {}) {
  const el = h("button", { type, class: `os-btn ${kind}${block ? " block" : ""}`, ...attrs }, iconName ? ic(iconName) : null, h("span", { text: label }), chevron ? ic("chev-left", {}) : null);
  if (chevron) el.lastChild.classList.add("chev");
  if (onClick) el.addEventListener("click", onClick);
  return el;
}

export function field(label, control, { hint = "", error = "", optional = false } = {}) {
  const wrap = h("label", { class: `os-field${error ? " invalid" : ""}` },
    h("span", {}, label, optional ? h("small", { text: " (اختياري)" }) : null),
    control,
    hint ? h("small", { text: hint }) : null,
    h("span", { class: "os-error", role: "alert", text: error || "" })
  );
  return wrap;
}

export function setFieldError(root, name, message) {
  const control = root.querySelector(`[name="${name}"]`);
  const wrap = control?.closest(".os-field");
  if (!wrap) return;
  wrap.classList.toggle("invalid", Boolean(message));
  const slot = wrap.querySelector(".os-error");
  if (slot) slot.textContent = message || "";
}

export function clearFieldErrors(root) {
  root.querySelectorAll(".os-field.invalid").forEach((el) => el.classList.remove("invalid"));
  root.querySelectorAll(".os-error").forEach((el) => { el.textContent = ""; });
}

export function emptyState(iconName, title, text, action = null) {
  return h("div", { class: "os-empty" }, ic(iconName), h("h3", { text: title }), text ? h("p", { class: "os-sub", text }) : null, action);
}
