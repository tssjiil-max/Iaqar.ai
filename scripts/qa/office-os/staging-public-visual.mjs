// Read-only browser evidence from the published Staging; never submits a form.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const out = path.resolve("qa/staging-public-visual");
fs.mkdirSync(out, { recursive: true });
const version = await (await fetch(`${origin}/version.json`, { cache: "no-store" })).json();
assert.equal(version.channel, "staging");
if (process.env.GITHUB_SHA) assert.equal(version.fullSha, process.env.GITHUB_SHA);
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [320, 390, 430, 1024]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, locale: "ar-SA" });
    const page = await context.newPage();
    await page.goto(`${origin}/m/sultan`);
    await page.locator('[data-path="owner"]').waitFor();
    const inspect = async (name) => {
      await page.evaluate(() => document.fonts.ready);
      const metrics = await page.evaluate(() => ({
        rtl: document.documentElement.dir === "rtl",
        overflow: document.documentElement.scrollWidth - innerWidth,
        font: getComputedStyle(document.body).fontFamily
      }));
      assert.equal(metrics.rtl, true);
      assert.ok(metrics.overflow <= 1, `${width}/${name}: overflow`);
      assert.ok(metrics.font.includes("Office Tajawal"), "published page must use the shared office font");
      assert.ok(await page.evaluate(() => document.fonts.check('700 18px "Office Tajawal"', "عقار")), "shared font must load");
      await page.screenshot({ path: path.join(out, `${width}-${name}.png`), fullPage: true });
      results.push({ width, name, ...metrics });
    };
    const iconColors = await page.locator('[data-path="owner"] svg').evaluateAll(nodes => nodes.map(n => getComputedStyle(n).color));
    assert.ok(iconColors.length === 2 && iconColors.every(c => c === "rgb(255, 255, 255)"), "primary icons must be white");
    await inspect("public-office");
    await page.locator('[data-path="owner"]').click();
    await page.locator('[data-fill-mode="manual"]').click();
    await page.locator('input[name="contactPhone"]').waitFor();
    await inspect("offer-form");
    await page.getByRole("button", { name: "رجوع", exact: true }).click();
    await page.locator('[data-path="client"]').click();
    // «أبحث عن عقار» is the guest search: the request box first, no phone until a property is chosen.
    await page.locator('[data-guest-search-form] textarea[name="description"]').waitFor();
    assert.equal(await page.locator('input[name="contactPhone"]').count(), 0, "no phone asked before a choice");
    await inspect("request-form");
    await context.close();
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ version, results }, null, 2));
}
console.log(`Published Staging: ${results.length}/12 browser checks passed`);
