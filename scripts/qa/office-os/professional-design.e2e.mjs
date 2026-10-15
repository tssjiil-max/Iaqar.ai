import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { startOfficeOsHarness, OFFICE_A, OWNER_A } from "./server.mjs";
import { seedStates } from "./seed.mjs";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, "playwright"))); }
const root = path.resolve(import.meta.dirname, "../../..");
const out = process.env.OUT_DIR || path.join(root, "qa/professional-design");
const base = process.env.BASE_REF || "883a5ce";
fs.mkdirSync(out, { recursive: true });
const beforeCss = execFileSync("git", ["show", `${base}:public/os/mobile-reference-polish.css`], { cwd: root, encoding: "utf8" });
const beforeRepository = execFileSync("git", ["show", `${base}:public/os/views/repository.js`], { cwd: root, encoding: "utf8" });
const harness = await startOfficeOsHarness();
const seed = await seedStates(harness);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const report = { base, fixture: "Local app and Worker with isolated in-memory records; no live writes", checks: [], errors: [] };
try {
  for (const variant of ["before", "after"]) {
    const context = await browser.newContext({ locale: "ar-SA", viewport: { width: 390, height: 844 } });
    await context.addInitScript(([uid, office]) => {
      localStorage.setItem("harness.uid", uid);
      localStorage.setItem("iaqar.officeId", office);
    }, [OWNER_A, OFFICE_A]);
    if (variant === "before") await context.route("**/os/mobile-reference-polish.css", route => route.fulfill({ contentType: "text/css", body: beforeCss }));
    if (variant === "before") await context.route("**/os/views/repository.js", route => route.fulfill({ contentType: "text/javascript", body: beforeRepository }));
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(`${variant}: ${error.message}`));
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width >= 768 ? 1000 : 844 });
      for (const [name, route, selector] of [
        ["office", "office", ".ref-office-tool"], ["records", "repo", "[data-record]"],
        ["tasks", "tasks", "[data-task]"], ["matching", `review/${seed.review.matchId}`, ".os-compare"],
        ["scout", "scout", ".os-page-title"], ["settings", "settings", ".os-set-list"],
        ["marketing", "tools/forms", ".os-page-title"]
      ]) {
        await page.goto(`${harness.origin}/#/${route}`);
        await page.locator(selector).first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        const metrics = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - innerWidth,
          rtl: document.documentElement.dir,
          appWidth: document.querySelector(".os-app").getBoundingClientRect().width
        }));
        assert.equal(metrics.rtl, "rtl");
        assert.ok(metrics.overflow <= 1, `${variant}/${name}/${width}: overflow`);
        if (variant === "after" && width >= 1024 && ["office", "records", "tasks"].includes(name)) assert.ok(metrics.appWidth > 760, `${name}: desktop must use available width`);
        if ([390, 1440].includes(width)) await page.screenshot({ path: path.join(out, `${variant}-${name}-${width}.png`), fullPage: true });
        report.checks.push({ variant, name, width, ...metrics });
      }
    }
    if (variant === "after") {
      await page.goto(`${harness.origin}/#/repo`);
      await page.locator("[data-record]").first().waitFor();
      const colours = await page.locator("[data-record]").evaluateAll(cards => cards.map(card => ({
        kind: card.querySelector("[data-kind-label]").dataset.kindLabel,
        surface: getComputedStyle(card).backgroundColor,
        label: card.querySelector("[data-kind-label]").textContent
      })));
      const offer = colours.find(card => card.kind === "OFFER");
      const request = colours.find(card => card.kind === "REQUEST");
      assert.ok(offer && request, "Both record types must be seeded");
      assert.notEqual(offer.surface, request.surface, "Offers and requests need distinct backgrounds");
      await page.locator('[data-record] .ref-record-open').first().click();
      await page.waitForURL("**/#/record/**");
      await page.goto(`${harness.origin}/#/repo`);
      await page.locator('[data-record]').first().waitFor();
      await page.locator(".ref-filters > summary").click();
      await page.getByRole("button", { name: "طلب", exact: true }).click();
      assert.equal(await page.locator('[data-kind-label="OFFER"]').count(), 0, "Request filter remains functional");
      assert.ok(await page.locator('[data-kind-label="REQUEST"]').count());
      await page.emulateMedia({ reducedMotion: "reduce" });
      const duration = await page.locator(".os-chip").first().evaluate(el => getComputedStyle(el).transitionDuration);
      assert.equal(duration, "0s", "Reduced motion preference is honoured");
      const spinnerAnimation = await page.locator(".os-btn").first().evaluate(el => {
        el.setAttribute("aria-busy", "true");
        return getComputedStyle(el, "::after").animationName;
      });
      assert.equal(spinnerAnimation, "none", "Busy indicators respect reduced motion");
      report.recordColours = colours;
      report.checks.push({ name: "record-open, request-filter, reduced-motion", passed: true });
    }
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  console.log(`PASS ${report.checks.length} visual and interaction checks`);
} finally {
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  harness.server.close();
}
