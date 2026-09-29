/**
 * UI primitives: toast, bottom sheet, confirm dialog, and runAction() which gives
 * every button one consistent behaviour — blocks repeated presses, shows loading,
 * reports success/failure, and never clears the user's input on failure.
 */

import { h, ic, btn } from "./dom.js";

let toastTimer = null;

export function toast(message, tone = "") {
  document.querySelector(".os-toast")?.remove();
  const el = h("div", { class: `os-toast ${tone}`, role: "status", "aria-live": "polite" },
    ic(tone === "bad" ? "alert" : tone === "ok" ? "check-circle" : "info"), h("span", { text: message }));
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
    h("div", { class: "os-sheet-head" },
      h("h2", { class: "os-h2", text: title }),
      h("button", { type: "button", class: "os-icon-btn", "aria-label": "إغلاق", onClick: close }, ic("x"))
    ),
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
export function confirmDialog({ title, text = "", confirmLabel = "تأكيد", danger = false }) {
  return new Promise((resolve) => {
    const done = (value) => { overlay.remove(); resolve(value); };
    const overlay = h("div", { class: "os-overlay center", onClick: (event) => { if (event.target === overlay) done(false); } },
      h("div", { class: "os-dialog", role: "alertdialog", "aria-modal": "true", "aria-label": title },
        h("h2", { class: "os-h2", text: title }),
        text ? h("p", { class: "os-sub", style: { margin: "8px 0 14px" }, text }) : null,
        h("div", { class: "os-btn-row" },
          btn(confirmLabel, { kind: danger ? "danger" : "primary", onClick: () => done(true) }),
          btn("إلغاء", { kind: "secondary", onClick: () => done(false) })
        )
      )
    );
    document.body.append(overlay);
    overlay.querySelector("button")?.focus();
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
