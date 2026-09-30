// Compare the same seeded data before/after the reference-layout correction.
// BASE_REF defaults to the staging commit this branch was built from.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { startOfficeOsHarness, OFFICE_A, OWNER_A } from "./server.mjs";
import { seedStates } from "./seed.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = path.resolve(import.meta.dirname, "../../..");
const out = process.env.OUT_DIR || path.join(root, "qa/office-os/reference-ui");
const base = process.env.BASE_REF || "e4ef13f76ce4d1da136f5ec719f94c048e16002c";
fs.mkdirSync(out, { recursive: true });
const files = ["os.css", "views/tasks.js", "views/review.js", "views/workspace.js"];
const original = new Map(files.map((file) => [file, execFileSync("git", ["show", `${base}:public/os/${file}`], { cwd: root, encoding: "utf8" })]));
const harness = await startOfficeOsHarness();
const states = await seedStates(harness);
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const results = {};
const errors = [];
try {
  for (const variant of ["before", "after"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true });
    await context.addInitScript(([uid, office]) => { localStorage.setItem("harness.uid", uid); localStorage.setItem("iaqar.officeId", office); }, [OWNER_A, OFFICE_A]);
    if (variant === "before") await context.route("**/os/**", async (route) => {
      const file = new URL(route.request().url()).pathname.slice("/os/".length);
      if (original.has(file)) await route.fulfill({ contentType: file.endsWith("css") ? "text/css" : "text/javascript", body: original.get(file) });
      else await route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    results[variant] = {};
    for (const [screen, url, selector] of [
      ["tasks", "/#/tasks", "[data-task]"],
      ["negotiation", `/#/journey/${states.negotiation.journeyId}`, "#now"],
      ["viewing", `/#/journey/${states.viewingResult.journeyId}`, "#now"],
      ["review", `/#/review/${states.review.matchId}`, ".os-compare"],
      ["repository", "/#/repo", "[data-record]"]
    ]) {
      await page.goto(`${harness.origin}${url}`);
      await page.locator(selector).first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const metrics = await page.evaluate(() => ({
        pageHeight: document.scrollingElement.scrollHeight,
        firstTaskHeight: document.querySelector("[data-task]")?.getBoundingClientRect().height,
        overflow: document.scrollingElement.scrollWidth - document.documentElement.clientWidth
      }));
      assert.ok(metrics.overflow <= 1, `${variant}/${screen}: horizontal overflow`);
      results[variant][screen] = metrics;
      await page.screenshot({ path: path.join(out, `${variant}-${screen}.png`), fullPage: true });
      if (variant === "after") await page.screenshot({ path: path.join(out, `after-${screen}-mobile.png`) });
      if (variant === "after" && screen === "viewing") {
        await page.locator(".os-property-details > summary").click();
        harness.store.patch(`offices/${OFFICE_A}/journeys/${states.viewingResult.journeyId}`, { updatedAt: new Date().toISOString() });
        await page.waitForTimeout(1000);
        assert.equal(await page.locator(".os-property-details").evaluate((n) => n.open), true, "live updates must preserve expanded details");
        await page.setViewportSize({ width: 320, height: 800 });
        const cards = await page.locator(".os-parties .os-party").evaluateAll((nodes) => nodes.map((n) => ({ top: n.getBoundingClientRect().top, width: n.getBoundingClientRect().width })));
        assert.equal(cards.length, 2);
        assert.equal(cards[0].top, cards[1].top, "parties must stay side by side at 320px");
        assert.ok(cards.every((c) => c.width > 100), "party text has usable width");
        await page.setViewportSize({ width: 390, height: 844 });
      }
    }
    await context.close();
  }
  assert.ok(results.after.tasks.firstTaskHeight < results.before.tasks.firstTaskHeight, "task card must be shorter");
  assert.ok(results.after.negotiation.pageHeight < results.before.negotiation.pageHeight, "workspace must require less scrolling");
  assert.equal(errors.length, 0, errors.join("\n"));
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ base, results, errors }, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  harness.server.close();
}
