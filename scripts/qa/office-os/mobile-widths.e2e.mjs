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
const { callWorker } = await import(path.join(ROOT, "scripts/qa/office-os/seed.mjs"));
const linkToken = (url) => String(url).split("#")[1];
const negLinks = (await callWorker(h, "/os/session/links", { officeId: OFFICE_A, journeyId: s.negotiation.journeyId })).links;
const viewLinks = (await callWorker(h, "/os/session/links", { officeId: OFFICE_A, journeyId: s.viewingConfirm.journeyId })).links;
await callWorker(h, "/os/session/act", { token: linkToken(negLinks.client.url), action: "minus5", submissionId: "widths-client-minus5" }, "");
await callWorker(h, "/os/session/message", { officeId: OFFICE_A, journeyId: s.negotiation.journeyId, audience: "both", text: "يمكنكما الرد على الأسعار مباشرة من هنا.", requestKey: "widths-m1" });

const SCREENS = [
  { name: "public-office", url: "/o/sultan", wait: "text=لدي عقار", auth: false },
  { name: "public-form", url: "/o/sultan", wait: "text=لدي عقار", auth: false, act: async (p) => { await p.getByRole("button", { name: /لدي عقار/ }).click(); await p.locator('input[name="contactPhone"]').waitFor(); } },
  { name: "login", url: "/", wait: 'input[name="phone"]', auth: false },
  { name: "office", url: "/#/office", wait: ".ref-today" },
  { name: "task-detail", url: `/#/task/${s.reviewTaskId}`, wait: ".ref-detail-step" },
  { name: "tasks", url: "/#/tasks", wait: "[data-task]" },
  { name: "menu-sheet", url: "/#/tasks", wait: "[data-task]", act: async (p) => { await p.getByRole("button", { name: "التنبيهات" }).click(); await p.locator(".os-sheet").waitFor(); } },
  { name: "repository", url: "/#/repo", wait: "[data-record]" },
  { name: "repository-filters", url: "/#/repo", wait: "[data-record]", act: async (p) => { await p.locator(".ref-filters > summary").click(); await p.locator("details.os-more summary").click(); } },
  { name: "record-detail", url: `/#/record/${s.review.offerId}`, wait: "text=تفاصيل السجل" },
  { name: "record-form", url: `/#/record/${s.review.requestId}/edit`, wait: 'input[name="district"]' },
  { name: "review", url: `/#/review/${s.review.matchId}`, wait: "text=أسباب التوافق" },
  { name: "journey-negotiation", url: `/#/journey/${s.negotiation.journeyId}`, wait: "text=المطلوب الآن" },
  { name: "party-proposal", url: `/#/journey/${s.negotiation.journeyId}`, wait: "text=المطلوب الآن", act: async (p) => { await p.getByRole("button", { name: "إرسال مقترح إلى المالك", exact: true }).click(); await p.locator(".os-sheet").waitFor(); } },
  { name: "composer-sheet", url: `/#/journey/${s.negotiation.journeyId}`, wait: "text=المطلوب الآن", act: async (p) => { await p.locator(".os-communication > summary").click(); await p.locator(".os-communication").getByRole("button", { name: "إرسال مقترح", exact: true }).click(); await p.locator(".os-sheet").waitFor(); } },
  { name: "journey-viewing-confirm", url: `/#/journey/${s.viewingConfirm.journeyId}`, wait: "text=تأكيد موعد المعاينة" },
  { name: "journey-viewing-result", url: `/#/journey/${s.viewingResult.journeyId}`, wait: "text=نتيجة المعاينة" },
  { name: "journey-closed", url: `/#/journey/${s.closed.journeyId}`, wait: "text=تمت الصفقة" },
  { name: "settings", url: "/#/settings", wait: "text=إعدادات المكتب" },
  { name: "reply-page", url: `/r#${s.negotiation.ownerReplyToken}`, wait: "text=اختر ردك", auth: false },
  { name: "reply-counter-field", url: `/r#${s.negotiation.ownerReplyToken}`, wait: "text=اختر ردك", auth: false, act: async (p) => { await p.locator('[data-option="counter"]').click(); await p.locator('input[name="text"]').waitFor(); } },
  { name: "reply-saved-state", url: `/r#${s.negotiation.clientReplyToken}`, wait: "text=عدّل ردك", auth: false },
  { name: "session-owner-price", url: `/s#${linkToken(negLinks.owner.url)}`, wait: ".os-session-actions", auth: false },
  { name: "session-owner-typed", url: `/s#${linkToken(negLinks.owner.url)}`, wait: ".os-session-actions", auth: false, act: async (p) => { await p.locator('[data-session-action="manual"]').click(); await p.locator('input[name="price"]').waitFor(); } },
  { name: "session-client-waiting", url: `/s#${linkToken(negLinks.client.url)}`, wait: ".os-session-actions", auth: false },
  { name: "session-owner-viewing", url: `/s#${linkToken(viewLinks.owner.url)}`, wait: ".os-session-actions", auth: false, act: async (p) => { await p.locator('[data-session-action="viewing_other"]').click(); await p.locator('input[name="viewingAt"]').waitFor(); } },
  { name: "session-broker", url: `/#/session/${s.negotiation.journeyId}`, wait: ".os-session-summary" }
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
  // Compare visible rectangles inside scroll regions. Offscreen content is not
  // a rendered control and must not be compared to the navigation outside it.
  const clippedRect = (el) => {
    const r = el.getBoundingClientRect();
    const box = {left:r.left,right:r.right,top:r.top,bottom:r.bottom};
    for (let p=el.parentElement; p; p=p.parentElement) {
      const css=getComputedStyle(p), pr=p.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(css.overflowY)) {box.top=Math.max(box.top,pr.top);box.bottom=Math.min(box.bottom,pr.bottom);}
      if (/auto|scroll|hidden|clip/.test(css.overflowX)) {box.left=Math.max(box.left,pr.left);box.right=Math.min(box.right,pr.right);}
    }
    box.top=Math.max(box.top,0);box.bottom=Math.min(box.bottom,innerHeight);
    return box;
  };
  // Page-scroll screens keep only the bottom navigation fixed. Content that scrolls
  // under an opaque fixed bar is hidden, not overlapping; instead every control must be
  // reachable fully above the bar at the end of the scroll (checked below). A bar that
  // is not fully opaque does not hide anything, so overlaps with it still fail.
  const opaque = (el) => { const m = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/); if (!m) return false; const parts = m[1].split(",").map(Number); return parts.length < 4 || parts[3] >= 1; };
  const fixedBar = (el) => { for (let p = el; p && p !== document.body; p = p.parentElement) { if (getComputedStyle(p).position === "fixed") return p; } return null; };
  const bars = overlay ? [] : [...document.querySelectorAll(".ref-bottom")].filter((el) => getComputedStyle(el).position === "fixed");
  for (const bar of bars) if (!opaque(bar)) issues.push(`fixed-bar-not-opaque "${label(bar).slice(0, 20)}" ${getComputedStyle(bar).backgroundColor}`);
  const controls = [...scope.querySelectorAll("button, a[href], input, select, textarea")].filter(visible).filter(el => {const r=clippedRect(el);return r.right>r.left && r.bottom>r.top;});
  if (bars.length) {
    const inFlow = [...scope.querySelectorAll("button, a[href], input, select, textarea")].filter(visible).filter((el) => !fixedBar(el));
    const lowest = inFlow.reduce((best, el) => (!best || el.getBoundingClientRect().bottom + scrollY > best.getBoundingClientRect().bottom + scrollY ? el : best), null);
    const y0 = scrollY;
    window.scrollTo(0, document.scrollingElement.scrollHeight);
    if (lowest) {
      const barTop = Math.min(...bars.map((b) => b.getBoundingClientRect().top));
      const lb = lowest.getBoundingClientRect().bottom;
      if (lb > barTop + 1) issues.push(`unreachable-under-bar "${label(lowest)}" bottom ${Math.round(lb)} > bar ${Math.round(barTop)}`);
    }
    window.scrollTo(0, y0);
  }
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    if (r.left < -1 || r.right > W + 1) issues.push(`outside-viewport "${label(el)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
    if (el.tagName === "BUTTON" && el.scrollWidth > el.clientWidth + 2) issues.push(`clipped-text "${label(el)}"`);
  }
  for (let i = 0; i < controls.length; i += 1) {
    for (let j = i + 1; j < controls.length; j += 1) {
      const a = controls[i]; const b = controls[j];
      if (a.contains(b) || b.contains(a)) continue;
      const fa = fixedBar(a); const fb = fixedBar(b);
      if (fa !== fb && bars.includes(fa || fb) && opaque(fa || fb)) continue;
      const ra = clippedRect(a); const rb = clippedRect(b);
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
// In CI, surface each failure as an annotation (job logs are not always reachable).
if (process.env.GITHUB_ACTIONS) for (const r of failed) console.log(`::error title=widths ${r.width}px ${r.screen}::${r.issues.slice(0, 3).join(" | ").replace(/[\r\n]/g, " ")}`);
if (process.env.GITHUB_ACTIONS) for (const e of consoleErrors.slice(0, 5)) console.log(`::error title=widths console::${String(e).replace(/[\r\n]/g, " ")}`);
fs.writeFileSync(path.join(OUT, "widths-report.json"), JSON.stringify({ at: new Date().toISOString(), widths: WIDTHS, screens: SCREENS.map((x) => x.name), results, consoleErrors }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} width×screen checks passed; console errors: ${consoleErrors.length}`);
process.exitCode = failed.length || consoleErrors.length ? 1 : 0;
