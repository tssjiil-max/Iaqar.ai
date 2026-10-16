// Legacy page (public/legacy.html) — the shared feedback design renders on the real page with its real
// stylesheets: the #toast element (info / success / error tones, as legacy writers set it) and the shared
// confirmDialog used by the converted legacy call sites. Legacy cannot fully boot in the local harness
// (no Firebase config), so individual legacy flows are NOT exercised here — rendering only.
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/feedback-states");
fs.mkdirSync(OUT, { recursive: true });
const { startOfficeOsHarness } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(",").map(Number) : [320, 360, 390, 430, 768, 1024, 1440];
const h = await startOfficeOsHarness();
const browser = await chromium.launch();
const results = [];
for (const width of WIDTHS) {
  const issues = [];
  const page = await (await browser.newContext({ viewport: { width, height: 820 }, deviceScaleFactor: 2, locale: "ar-SA" })).newPage();
  const expect = (c, m) => { if (!c) issues.push(m); };
  try {
    await page.goto(`${h.origin}/legacy.html?legacyContent=1`);
    await page.locator("#toast").waitFor({ state: "attached" });
    for (const [tone, text] of [["", "جارٍ تحميل البيانات"], ["ok", "تم حذف الملف"], ["bad", "تعذر الحذف — حاول مجددًا"]]) {
      await page.evaluate((t) => { const el = document.getElementById("toast"); el.hidden = false; el.textContent = t; el.classList.add("show"); }, text);
      await page.waitForTimeout(260);
      const m = await page.evaluate(() => { const el = document.getElementById("toast"); const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); const b = getComputedStyle(el, "::before");
        return { tone: el.dataset.tone || "", bg: cs.backgroundColor, op: cs.opacity, font: cs.fontFamily, chip: b.backgroundColor, img: b.backgroundImage.slice(0, 40), left: r.left, right: r.right, vw: document.documentElement.clientWidth }; });
      expect(m.tone === tone, `toast «${text}»: tone «${m.tone}» expected «${tone}»`);
      expect(m.bg === "rgb(255, 255, 255)", `toast «${text}»: background ${m.bg}`);
      expect(m.op === "1", `toast «${text}»: not visible`);
      expect(/Tajawal/.test(m.font), `toast «${text}»: font ${m.font.slice(0, 30)}`);
      expect(m.chip !== "rgba(0, 0, 0, 0)" && m.img.startsWith("url("), `toast «${text}»: missing icon chip`);
      expect(m.left >= -1 && m.right <= m.vw + 1, `toast «${text}»: outside viewport`);
      await page.screenshot({ path: path.join(OUT, `${width}-legacy-toast-${tone || "info"}.png`), clip: { x: 0, y: 0, width, height: 200 } });
    }
    const pending = page.evaluate(async () => (await import("/os/core/ui.js")).confirmDialog({ title: "حذف هذا الملف من المكتبة؟", text: "لا يمكن التراجع عن الحذف.", confirmLabel: "حذف", danger: true }));
    await page.getByRole("alertdialog").waitFor();
    await page.waitForTimeout(150);
    const d = await page.evaluate(() => { const el = document.querySelector(".os-dialog"); const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); const ov = getComputedStyle(document.querySelector(".os-overlay"));
      const btns = [...el.querySelectorAll(".os-btn")].map((b) => ({ t: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor, h: b.getBoundingClientRect().height }));
      return { bg: cs.backgroundColor, pos: ov.position, font: cs.fontFamily, top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: document.documentElement.clientWidth, vh: innerHeight, focused: document.activeElement?.textContent?.trim(), btns }; });
    expect(d.pos === "fixed", `dialog overlay position ${d.pos} (shared CSS not applied)`);
    expect(d.bg === "rgb(255, 255, 255)" && /Tajawal/.test(d.font), "dialog: not in the shared design");
    expect(d.top >= 0 && d.bottom <= d.vh && d.left >= 0 && d.right <= d.vw, "dialog: off screen");
    expect(d.focused === "إلغاء", `dialog: initial focus ${d.focused}`);
    expect(d.btns.every((b) => b.h >= 44), "dialog: button under 44px tap height");
    await page.screenshot({ path: path.join(OUT, `${width}-legacy-confirm.png`) });
    await page.keyboard.press("Escape");
    expect((await pending) === false, "dialog: Escape did not cancel");
  } catch (e) { issues.push(`failed: ${String(e.message).split("\n")[0]}`); }
  results.push({ width, issues });
  console.log(`${issues.length ? "✘" : "✔"} ${width}px${issues.length ? " — " + issues.join(" | ") : ""}`);
  await page.context().close();
}
await browser.close(); h.server.close();
fs.writeFileSync(path.join(OUT, "legacy-feedback-report.json"), JSON.stringify({ at: new Date().toISOString(), note: "rendering only; legacy flows need Firebase and are not exercised", results }, null, 2));
const failed = results.filter((r) => r.issues.length);
console.log(`\n${results.length - failed.length}/${results.length} widths passed`);
process.exitCode = failed.length ? 1 : 0;
