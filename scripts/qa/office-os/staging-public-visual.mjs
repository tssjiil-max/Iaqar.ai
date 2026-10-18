// Read-only browser evidence from the published Staging; never submits a form.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";

// PUBLIC_VISUAL_ORIGIN lets the same checks run on the local harness before a deploy (no version gate there).
const origin = process.env.PUBLIC_VISUAL_ORIGIN || "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const local = Boolean(process.env.PUBLIC_VISUAL_ORIGIN);
const out = path.resolve("qa/staging-public-visual");
fs.mkdirSync(out, { recursive: true });
const version = await (await fetch(`${origin}/version.json`, { cache: "no-store" })).json();
if (!local) assert.equal(version.channel, "staging");
if (!local && process.env.GITHUB_SHA) assert.equal(version.fullSha, process.env.GITHUB_SHA);
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
    // «اعرض عقارك» is one of the three guest-desk tiles («أدوات المكتب» language): its icon carries the tile's own tone.
    const tile = await page.locator('[data-guest-desk] [data-path="owner"]').evaluate(n => ({ tone: getComputedStyle(n).getPropertyValue("--tool-color").trim(), icons: [...n.querySelectorAll("svg")].map(s => getComputedStyle(s).color) }));
    assert.equal(await page.locator('[data-guest-desk] [data-guest-path]').count(), 3, "three guest paths");
    assert.ok(tile.icons.length === 1 && tile.tone && tile.icons[0] === (await page.evaluate(c => { const d = document.createElement("i"); d.style.color = c; document.body.append(d); const v = getComputedStyle(d).color; d.remove(); return v; }, tile.tone)), `owner tile icon uses its tone (${JSON.stringify(tile)})`);
    await inspect("public-office");
    await page.locator('[data-path="owner"]').click();
    await page.locator('[data-fill-mode="manual"]').click();
    await page.locator('input[name="contactPhone"]').waitFor();
    await inspect("offer-form");
    await page.getByRole("button", { name: "رجوع", exact: true }).click();
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
