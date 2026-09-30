// Office OS — layout check of the new app (public/index.html, r.html) at phone widths.
//   node scripts/qa/office-os/mobile-widths.e2e.mjs
// For every width × screen: no horizontal scroll, no control outside the viewport,
// no overlapping controls, no clipped button text. Screenshots → OUT_DIR.
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/office-os/widths");
fs.mkdirSync(OUT, { recursive: true });
const { startOfficeOsHarness, OWNER_A, OFFICE_A } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const { seedStates } = await import(path.join(ROOT, "scripts/qa/office-os/seed.mjs"));

const WIDTHS = [320, 360, 375, 390, 412, 430];
const h = await startOfficeOsHarness();
const s = await seedStates(h);

const SCREENS = [
  { name: "public-office", url: "/o/sultan", wait: "text=لدي عقار", auth: false },
  { name: "public-form", url: "/o/sultan", wait: "text=لدي عقار", auth: false, act: async (p) => { await p.getByRole("button", { name: /لدي عقار/ }).click(); await p.locator('input[name="contactPhone"]').waitFor(); } },
  { name: "login", url: "/", wait: 'input[name="phone"]', auth: false },
  { name: "tasks", url: "/#/tasks", wait: "[data-task]" },
  { name: "menu-sheet", url: "/#/tasks", wait: "[data-task]", act: async (p) => { await p.getByRole("button", { name: "القائمة والإعدادات" }).click(); await p.locator(".os-sheet").waitFor(); } },
  { name: "repository", url: "/#/repo", wait: "[data-record]" },
  { name: "repository-filters", url: "/#/repo", wait: "[data-record]", act: async (p) => { await p.locator("details.os-more summary").click(); } },
  { name: "record-detail", url: `/#/record/${s.review.offerId}`, wait: "text=تفاصيل السجل" },
  { name: "record-form", url: `/#/record/${s.review.requestId}/edit`, wait: 'input[name="district"]' },
  { name: "review", url: `/#/review/${s.review.matchId}`, wait: "text=أسباب التوافق" },
  { name: "journey-negotiation", url: `/#/journey/${s.negotiation.journeyId}`, wait: "text=المطلوب الآن" },
  { name: "party-proposal", url: `/#/journey/${s.negotiation.journeyId}`, wait: "text=المطلوب الآن", act: async (p) => { await p.getByRole("button", { name: "إرسال مقترح إلى المالك", exact: true }).click(); await p.locator(".os-sheet").waitFor(); } },
  { name: "composer-sheet", url: `/#/journey/${s.negotiation.journeyId}`, wait: "text=المطلوب الآن", act: async (p) => { await p.locator(".os-communication > summary").click(); await p.locator(".os-communication").getByRole("button", { name: "إرسال مقترح", exact: true }).click(); await p.locator(".os-sheet").waitFor(); } },
  { name: "journey-viewing-confirm", url: `/#/journey/${s.viewingConfirm.journeyId}`, wait: "text=تأكيد موعد المعاينة" },
  { name: "journey-viewing-result", url: `/#/journey/${s.viewingResult.journeyId}`, wait: "text=نتيجة المعاينة" },
  { name: "journey-closed", url: `/#/journey/${s.closed.journeyId}`, wait: "text=تمت الصفقة" },
  { name: "settings", url: "/#/settings", wait: "text=إتمام الصفقات" },
  { name: "reply-page", url: `/r#${s.negotiation.ownerReplyToken}`, wait: "text=اختر ردك", auth: false },
  { name: "reply-counter-field", url: `/r#${s.negotiation.ownerReplyToken}`, wait: "text=اختر ردك", auth: false, act: async (p) => { await p.locator('[data-option="counter"]').click(); await p.locator('input[name="text"]').waitFor(); } },
  { name: "reply-saved-state", url: `/r#${s.negotiation.clientReplyToken}`, wait: "text=عدّل ردك", auth: false }
];

function layoutIssues() {
  const W = document.documentElement.clientWidth;
  const issues = [];
  const overflow = document.scrollingElement.scrollWidth - W;
  if (overflow > 1) issues.push(`horizontal-scroll ${overflow}px`);
  const overlay = document.querySelector(".os-overlay");
  const scope = overlay || document;
  const label = (el) => (el.getAttribute("aria-label") || el.textContent || el.name || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const insideClosedDetails = Boolean(el.closest("details:not([open])")) && !el.closest("summary");
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && el.type !== "hidden" && !el.closest(".os-toast") && !insideClosedDetails;
  };
  const controls = [...scope.querySelectorAll("button, a[href], input, select, textarea")].filter(visible);
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    if (r.left < -1 || r.right > W + 1) issues.push(`outside-viewport "${label(el)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
    if (el.tagName === "BUTTON" && el.scrollWidth > el.clientWidth + 2) issues.push(`clipped-text "${label(el)}"`);
  }
  for (let i = 0; i < controls.length; i += 1) {
    for (let j = i + 1; j < controls.length; j += 1) {
      const a = controls[i]; const b = controls[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const hgt = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 2 && hgt > 2 && w * hgt > 16) issues.push(`overlap "${label(a)}" × "${label(b)}"`);
    }
  }
  return issues;
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const results = [];
const consoleErrors = [];
for (const width of WIDTHS) {
  for (const screen of SCREENS) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true, isMobile: true });
    if (screen.auth !== false) {
      await ctx.addInitScript(([uid, office]) => { localStorage.setItem("harness.uid", uid); localStorage.setItem("iaqar.officeId", office); }, [OWNER_A, OFFICE_A]);
    }
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (e) => consoleErrors.push(`${width}/${screen.name}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${width}/${screen.name}: ${m.text()}`); });
    let issues;
    try {
      await page.goto(`${h.origin}${screen.url}`);
      await page.locator(screen.wait).first().waitFor();
      if (screen.act) await screen.act(page);
      await page.waitForTimeout(400);
      issues = await page.evaluate(layoutIssues);
      await page.screenshot({ path: path.join(OUT, `${width}-${screen.name}.png`), fullPage: true });
    } catch (error) {
      issues = [`failed to render: ${String(error.message).split("\n")[0]}`];
    }
    results.push({ width, screen: screen.name, issues });
    console.log(`${issues.length ? "✘" : "✔"} ${width}px ${screen.name}${issues.length ? ` — ${issues.slice(0, 4).join(" | ")}` : ""}`);
    await ctx.close();
  }
}
await browser.close();
h.server.close();
const failed = results.filter((r) => r.issues.length);
fs.writeFileSync(path.join(OUT, "widths-report.json"), JSON.stringify({ at: new Date().toISOString(), widths: WIDTHS, screens: SCREENS.map((x) => x.name), results, consoleErrors }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} width×screen checks passed; console errors: ${consoleErrors.length}`);
process.exitCode = failed.length || consoleErrors.length ? 1 : 0;
