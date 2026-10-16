// Office OS — system feedback (confirm dialogs + toasts) in their real flows, at every required width.
//   node scripts/qa/office-os/feedback-states.e2e.mjs        (WIDTHS=390,1440 narrows a run)
// Isolated in-memory harness data only. Checks: the shared white/pastel design (no solid slab backgrounds),
// role/ARIA, Escape cancels without deleting, focus starts on «إلغاء» for destructive actions and returns
// afterwards, the toast sits above the bottom navigation, nothing leaves the viewport. Screenshots → OUT_DIR.
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/feedback-states");
fs.mkdirSync(OUT, { recursive: true });
const { startOfficeOsHarness, OWNER_A, OFFICE_A } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const { seedStates } = await import(path.join(ROOT, "scripts/qa/office-os/seed.mjs"));
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(",").map(Number) : [320, 360, 390, 430, 768, 1024, 1440];

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const results = [];
const errors = [];

// Geometry + design facts about the open dialog / toast, measured in the page.
function measure(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const nav = document.querySelector(".ref-bottom");
  const navTop = nav ? nav.getBoundingClientRect().top : null;
  const chip = el.querySelector(".os-feedback-icon");
  return {
    bg: cs.backgroundColor, color: cs.color, font: cs.fontFamily.split(",")[0], role: el.getAttribute("role"),
    left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: document.documentElement.clientWidth, vh: innerHeight,
    overflowX: document.scrollingElement.scrollWidth - document.documentElement.clientWidth,
    navTop, chipBg: chip ? getComputedStyle(chip).backgroundColor : null,
    labelledby: el.getAttribute("aria-labelledby"), describedby: el.getAttribute("aria-describedby"),
    focused: document.activeElement?.textContent?.trim() || "", dir: getComputedStyle(el).direction
  };
}

for (const width of WIDTHS) {
  // Fresh isolated data per width: the flow really deletes its test record.
  const h = await startOfficeOsHarness();
  const s = await seedStates(h);
  const issues = [];
  const ctx = await browser.newContext({ viewport: { width, height: 820 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true, isMobile: width < 768 });
  await ctx.addInitScript(([uid, office]) => { localStorage.setItem("harness.uid", uid); localStorage.setItem("iaqar.officeId", office); }, [OWNER_A, OFFICE_A]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(`${width}: ${e.message}`));
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${width}-${name}.png`) });
  const expect = (cond, msg) => { if (!cond) issues.push(msg); };
  const designOk = (m, what) => {
    expect(m, `${what}: not rendered`);
    if (!m) return;
    expect(m.bg === "rgb(255, 255, 255)", `${what}: background ${m.bg} (expected white surface)`);
    expect(/Tajawal/.test(m.font), `${what}: font ${m.font}`);
    expect(m.chipBg && m.chipBg !== "rgba(0, 0, 0, 0)", `${what}: missing pastel icon chip`);
    expect(m.left >= -1 && m.right <= m.vw + 1, `${what}: outside viewport ${Math.round(m.left)}..${Math.round(m.right)}`);
    expect(m.overflowX <= 1, `${what}: horizontal scroll ${m.overflowX}px`);
    expect(m.dir === "rtl", `${what}: direction ${m.dir}`);
  };
  try {
    const recordId = s.review.offerId;
    await page.goto(`${h.origin}/#/record/${recordId}`);
    await page.locator('[data-record-action="delete"]').waitFor();
    // 1) Confirm dialog — Escape cancels, nothing deleted.
    await page.locator('[data-record-action="delete"]').click();
    await page.getByRole("alertdialog").waitFor();
    await page.waitForTimeout(120);
    const dlg = await page.evaluate(measure, ".os-dialog");
    designOk(dlg, "delete-dialog");
    expect(dlg?.role === "alertdialog" && dlg.labelledby && dlg.describedby, "delete-dialog: missing alertdialog labelling");
    expect(dlg?.focused === "إلغاء", `delete-dialog: initial focus on «${dlg?.focused}» (expected إلغاء)`);
    expect(dlg && dlg.top >= 0 && dlg.bottom <= dlg.vh, "delete-dialog: not fully on screen");
    await shot("delete-confirm");
    await page.keyboard.press("Escape");
    await page.getByRole("alertdialog").waitFor({ state: "detached" });
    const after = await page.evaluate(() => document.activeElement?.getAttribute("data-record-action"));
    expect(after === "delete", `escape: focus returned to «${after}» (expected the delete button)`);
    const removeCalls = h.server.workerCalls.filter((c) => c.path.endsWith("/os/records/remove")).length;
    expect(removeCalls === 0, `escape: ${removeCalls} delete request(s) were sent`);
    expect(page.url().includes(`/record/${recordId}`), "escape: navigated away from the record");
    // 2) Confirm → real delete → success toast.
    await page.locator('[data-record-action="delete"]').click();
    await page.getByRole("alertdialog").getByRole("button", { name: "حذف", exact: true }).click();
    const okToast = page.locator(".os-toast.ok");
    await okToast.waitFor();
    await page.waitForTimeout(250);
    const ok = await page.evaluate(measure, ".os-toast");
    designOk(ok, "success-toast");
    expect(ok?.role === "status", `success-toast: role ${ok?.role}`);
    if (ok?.navTop != null) expect(ok.bottom <= ok.navTop - 4, `success-toast: overlaps bottom navigation (${Math.round(ok.bottom)} > ${Math.round(ok.navTop)})`);
    await shot("delete-success-toast");
    // 3) Error and neutral variants through the same shared function the app uses.
    await page.evaluate(async () => (await import("/os/core/ui.js")).toast("تعذر الحذف — تحقق من الاتصال وحاول مجددًا", "bad"));
    await page.waitForTimeout(250);
    const bad = await page.evaluate(measure, ".os-toast");
    designOk(bad, "error-toast");
    expect(bad?.role === "alert", `error-toast: role ${bad?.role} (expected alert)`);
    await shot("error-toast");
    await page.evaluate(async () => (await import("/os/core/ui.js")).toast("تم نسخ الرابط"));
    await page.waitForTimeout(250);
    designOk(await page.evaluate(measure, ".os-toast"), "info-toast");
    await shot("info-toast");
    // 4) Non-destructive confirm (focus starts on the confirm action).
    const pending = page.evaluate(async () => (await import("/os/core/ui.js")).confirmDialog({ title: "إرسال العرض إلى العميل؟", text: "سيصل الرابط عبر واتساب.", confirmLabel: "إرسال" }));
    await page.getByRole("alertdialog").waitFor();
    const plain = await page.evaluate(measure, ".os-dialog");
    designOk(plain, "plain-dialog");
    expect(plain?.focused === "إرسال", `plain-dialog: initial focus «${plain?.focused}»`);
    await shot("plain-confirm");
    await page.getByRole("alertdialog").getByRole("button", { name: "إلغاء" }).click();
    expect((await pending) === false, "plain-dialog: cancel did not resolve false");
  } catch (error) {
    issues.push(`failed: ${String(error.message).split("\n")[0]}`);
    await shot("failure").catch(() => {});
  }
  results.push({ width, issues });
  console.log(`${issues.length ? "✘" : "✔"} ${width}px${issues.length ? " — " + issues.join(" | ") : ""}`);
  await ctx.close();
  h.server.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, "feedback-report.json"), JSON.stringify({ at: new Date().toISOString(), results, errors }, null, 2));
const failed = results.filter((r) => r.issues.length);
console.log(`\n${results.length - failed.length}/${results.length} widths passed; page errors: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log("  page error:", e);
process.exitCode = failed.length || errors.length ? 1 : 0;
