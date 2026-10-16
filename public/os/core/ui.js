/**
 * UI primitives: toast, bottom sheet, confirm dialog, and runAction() which gives
 * every button one consistent behaviour — blocks repeated presses, shows loading,
 * reports success/failure, and never clears the user's input on failure.
 */

import { h, ic, btn, dialogHeading } from "./dom.js";

let toastTimer = null;

export function toast(message, tone = "") {
  document.querySelector(".os-toast")?.remove();
  // Errors interrupt (role=alert); confirmations and info wait politely (role=status).
  const urgent = tone === "bad";
  const el = h("div", { class: `os-toast ${tone}`.trim(), role: urgent ? "alert" : "status", "aria-live": urgent ? "assertive" : "polite" },
    h("span", { class: "os-feedback-icon", "aria-hidden": "true" }, ic(urgent ? "alert" : tone === "ok" ? "check-circle" : "info")),
    h("span", { text: message }));
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), tone === "bad" ? 6000 : 3200);
}

const inFlight = new WeakSet();

/**
 * @param {HTMLButtonElement|null} button
 * @param {() => Promise<any>} work
 * @param {{ success?: string, onError?: (e) => void }} opts
 */
export async function runAction(button, work, { success = "", onError } = {}) {
  if (button && inFlight.has(button)) return undefined;
  if (button) {
    inFlight.add(button);
    button.setAttribute("aria-busy", "true");
  }
  try {
    const result = await work();
    if (success) toast(success, "ok");
    return result;
  } catch (error) {
    if (onError) onError(error);
    toast(error?.message || "تعذر تنفيذ الإجراء — حاول مجددًا", "bad");
    return undefined;
  } finally {
    if (button) {
      inFlight.delete(button);
      button.removeAttribute("aria-busy");
    }
  }
}

const openSheets = [];

export function openSheet(title, body, { onClose, wide = false } = {}) {
  const close = () => {
    overlay.remove();
    const i = openSheets.indexOf(close);
    if (i >= 0) openSheets.splice(i, 1);
    document.removeEventListener("keydown", onKey);
    if (onClose) onClose();
  };
  const onKey = (event) => { if (event.key === "Escape" && openSheets.at(-1) === close) close(); };
  const sheet = h("div", { class: "os-sheet", role: "dialog", "aria-modal": "true", "aria-label": title, style: wide ? { maxWidth: "900px" } : null },
    h("div", { class: "os-sheet-grip" }),
    dialogHeading(title, close),
    body
  );
  const overlay = h("div", { class: "os-overlay", onClick: (event) => { if (event.target === overlay) close(); } }, sheet);
  document.body.append(overlay);
  document.addEventListener("keydown", onKey);
  openSheets.push(close);
  // Move focus into the sheet only if the user has not already focused something in it.
  requestAnimationFrame(() => {
    if (!sheet.contains(document.activeElement)) sheet.querySelector("input, textarea, select, button:not(.os-icon-btn)")?.focus({ preventScroll: true });
  });
  return { close, sheet };
}

export function closeAllSheets() {
  while (openSheets.length) openSheets.at(-1)();
}

/** Short confirmation for deletions and important actions only. */
export function confirmDialog({ title, text = "", confirmLabel = "تأكيد", cancelLabel = "إلغاء", danger = false }) {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement;
    const id = `os-dlg-${Math.random().toString(36).slice(2, 9)}`;
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      if (returnFocus?.isConnected) returnFocus.focus?.({ preventScroll: true });
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === "Escape") { event.stopPropagation(); done(false); return; }
      if (event.key !== "Tab") return;
      // Keep keyboard focus inside the dialog while it is open.
      const buttons = [...overlay.querySelectorAll("button")];
      const i = buttons.indexOf(document.activeElement);
      const next = event.shiftKey ? (i <= 0 ? buttons.length - 1 : i - 1) : (i === buttons.length - 1 ? 0 : i + 1);
      event.preventDefault();
      buttons[next]?.focus();
    };
    const confirmBtn = btn(confirmLabel, { kind: danger ? "danger" : "primary", onClick: () => done(true) });
    const cancelBtn = btn(cancelLabel, { kind: "secondary", onClick: () => done(false) });
    const overlay = h("div", { class: "os-overlay center", onClick: (event) => { if (event.target === overlay) done(false); } },
      h("div", { class: `os-dialog${danger ? " danger" : ""}`, role: "alertdialog", "aria-modal": "true", "aria-labelledby": `${id}-t`, "aria-describedby": text ? `${id}-d` : null },
        h("div", { class: "os-dialog-head" },
          h("span", { class: "os-feedback-icon", "aria-hidden": "true" }, ic(danger ? "alert" : "info")),
          h("div", {},
            h("h2", { class: "os-h2", id: `${id}-t`, text: title }),
            text ? h("p", { class: "os-dialog-text", id: `${id}-d`, text }) : null)),
        h("div", { class: "os-btn-row" }, confirmBtn, cancelBtn)
      )
    );
    document.body.append(overlay);
    document.addEventListener("keydown", onKey, true);
    // A destructive action never starts with focus on the destructive button.
    (danger ? cancelBtn : confirmBtn).focus();
  });
}

export function newRequestKey() {
  if (crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Open WhatsApp synchronously inside the click (popup blockers allow only this). */
export function openWhatsApp(url) {
  if (!url) return false;
  // `noopener` makes window.open return null, so detach the opener manually instead.
  const win = window.open(url, "_blank");
  if (win) {
    try { win.opener = null; } catch (_) { /* cross-origin */ }
  } else {
    window.location.href = url;
  }
  return true;
}
