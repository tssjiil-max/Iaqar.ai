import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

function withDom(run) {
  return async () => {
    const dom = new JSDOM("<body></body>", { url: "https://example.test/#/office" });
    const keys = ["window", "document", "Node", "HTMLElement", "KeyboardEvent", "requestAnimationFrame"];
    const old = new Map(keys.map((k) => [k, globalThis[k]]));
    for (const k of keys) globalThis[k] = k === "requestAnimationFrame" ? (fn) => setTimeout(fn, 0) : dom.window[k];
    try { await run(dom); } finally {
      for (const [k, v] of old) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
      dom.window.close();
    }
  };
}

test("toasts share one design: icon chip, polite status for success, assertive alert for errors", withDom(async () => {
  const { toast } = await import("../public/os/core/ui.js");
  toast("تم حذف السجل", "ok");
  let el = document.querySelector(".os-toast");
  assert.equal(el.getAttribute("role"), "status");
  assert.equal(el.getAttribute("aria-live"), "polite");
  assert.ok(el.querySelector(".os-feedback-icon svg"), "tone icon sits in the shared chip");
  assert.equal(el.textContent.trim(), "تم حذف السجل");
  toast("تعذر الحذف", "bad");
  assert.equal(document.querySelectorAll(".os-toast").length, 1, "a new toast replaces the previous one");
  el = document.querySelector(".os-toast");
  assert.equal(el.getAttribute("role"), "alert");
  assert.equal(el.getAttribute("aria-live"), "assertive");
}));

test("confirmDialog: labelled alertdialog, confirm button first, safe focus, Escape cancels, focus returns", withDom(async () => {
  const { confirmDialog } = await import("../public/os/core/ui.js");
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const pending = confirmDialog({ title: "حذف الملف؟", text: "لا يمكن التراجع.", confirmLabel: "حذف", danger: true });
  const dialog = document.querySelector('.os-dialog[role="alertdialog"]');
  assert.ok(dialog.classList.contains("danger"));
  assert.equal(document.getElementById(dialog.getAttribute("aria-labelledby")).textContent, "حذف الملف؟");
  assert.equal(document.getElementById(dialog.getAttribute("aria-describedby")).textContent, "لا يمكن التراجع.");
  const buttons = [...dialog.querySelectorAll("button")];
  assert.deepEqual(buttons.map((b) => b.textContent.trim()), ["حذف", "إلغاء"], "existing button order is kept");
  assert.ok(buttons[0].classList.contains("danger") && buttons[1].classList.contains("secondary"));
  assert.equal(document.activeElement, buttons[1], "a destructive action starts on «إلغاء»");
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(await pending, false);
  assert.equal(document.querySelector(".os-dialog"), null);
  assert.equal(document.activeElement, opener, "focus goes back to where the user was");
}));

test("confirmDialog: non-destructive focuses confirm, custom cancel label, confirm resolves true", withDom(async () => {
  const { confirmDialog } = await import("../public/os/core/ui.js");
  const pending = confirmDialog({ title: "إلغاء موعد المتابعة؟", confirmLabel: "إلغاء الموعد", cancelLabel: "تراجع" });
  const buttons = [...document.querySelectorAll(".os-dialog button")];
  assert.deepEqual(buttons.map((b) => b.textContent.trim()), ["إلغاء الموعد", "تراجع"]);
  assert.equal(document.activeElement, buttons[0]);
  assert.equal(document.querySelector(".os-dialog").getAttribute("aria-describedby"), null);
  buttons[0].click();
  assert.equal(await pending, true);
}));

test("one feedback stylesheet: office pages and legacy load os/feedback.css; no old slab colours or native popups remain", () => {
  for (const page of ["public/index.html", "public/r.html", "public/s.html", "public/scout-inbox.html"]) {
    const html = fs.readFileSync(page, "utf8");
    assert.ok(html.indexOf("/os/feedback.css") > -1 && html.indexOf("/os/feedback.css") < html.indexOf("/os/os.css"), `${page}: feedback.css loads before os.css`);
  }
  assert.ok(fs.readFileSync("public/legacy.html", "utf8").includes('href="/os/feedback.css"'));
  const os = fs.readFileSync("public/os/os.css", "utf8");
  assert.ok(!/\.os-toast[^{]*\{[^}]*background/.test(os) && !/\.os-dialog\s*\{/.test(os), "os.css no longer restyles toasts/dialogs");
  const feedback = fs.readFileSync("public/os/feedback.css", "utf8");
  assert.ok(!/#0f7c4c|#087064/i.test(feedback), "old forest-green toast colours are gone");
  for (const file of ["public/js/opportunity-bank.js", "public/js/workflow-office.js", "public/js/office-library.js", "public/js/opportunity-import-advert-ui.js", "public/js/v2/daily-tasks/controller.js", "public/js/v2/opportunity-details/controller.js"]) {
    const src = fs.readFileSync(file, "utf8");
    assert.ok(!/(^|[^.\w])(window\.)?(alert|confirm)\(/m.test(src), `${file}: no native alert()/confirm() popups`);
  }
});
