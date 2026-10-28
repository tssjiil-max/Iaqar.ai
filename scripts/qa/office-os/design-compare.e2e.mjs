// Before / after screenshots of the office app on synthetic data (no network, no real data).
//   node scripts/qa/office-os/design-compare.e2e.mjs <repoRoot> <outDir>
// Run it once on the base checkout and once on the changed checkout, then compare the two folders.
// Fixed clock, fixed viewport, animations disabled: two runs of the same code give identical files.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(process.argv[2] || '.');
const out = path.resolve(process.argv[3] || 'qa/design-compare');
fs.mkdirSync(out, { recursive: true });
const fixed = Date.parse('2026-10-25T09:00:00Z');
const WIDTHS = [390, 1280];
// [name, route, selector that proves the screen is drawn]
const SCREENS = [
  ['home', '/#/office', '.ref-office-tools'],
  ['tasks', '/#/tasks', '[data-type="MATCH_REVIEW"]'],
  ['records', '/#/repo', '[data-record]'],
  ['search', '/#/search', '.ref-reference-bottom'],
  ['indicators', '/#/tools/market', '.ref-reference-bottom'],
  ['account', '/#/settings', '.ref-reference-bottom'],
  ['guide', '/#/tools/guide', '.ref-reference-bottom'],
  ['forms', '/#/tools/forms', '.ref-reference-bottom'],
  ['services', '/#/tools/services', '.ref-reference-bottom'],
  ['calculator', '/#/tools/calculator', '.ref-reference-bottom'],
  ['manager', '/#/agent', '.ref-reference-bottom'],
  ['library', '/#/library', '.ref-reference-bottom'],
  ['support', '/#/support', '.ref-reference-bottom'],
  ['guest', '/?view=search', '.os-guest-path'],
  ['office-link', '/o/sultan', '.os-guest-path']
];

const { startOfficeOsHarness, OWNER_A, OFFICE_A } = await import(pathToFileURL(path.join(root, 'scripts/qa/office-os/server.mjs')));
const { seedStates } = await import(pathToFileURL(path.join(root, 'scripts/qa/office-os/seed.mjs')));
const h = await startOfficeOsHarness();
await seedStates(h);
const browser = await chromium.launch();
const report = [];
try {
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, locale: 'ar-SA', timezoneId: 'Asia/Riyadh', deviceScaleFactor: 1 });
    await ctx.addInitScript(({ fixed, uid, officeId }) => {
      const RealDate = Date;
      window.Date = class extends RealDate {
        constructor(...args) { super(...(args.length ? args : [fixed])); }
        static now() { return fixed; }
      };
      localStorage.setItem('harness.uid', uid);
      localStorage.setItem('iaqar.officeId', officeId);
    }, { fixed, uid: OWNER_A, officeId: OFFICE_A });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    for (const [name, route, ready] of SCREENS) {
      const file = `${width}-${name}.png`;
      try {
        await page.goto(h.origin + route);
        await page.locator(ready).first().waitFor({ timeout: 15000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(700); // the app keeps live polling, so networkidle is never a ready signal
        await page.screenshot({ path: path.join(out, file), fullPage: true, animations: 'disabled' });
        report.push({ file, ok: true });
      } catch (error) {
        report.push({ file, ok: false, error: String(error.message || error).split('\n')[0].slice(0, 140) });
      }
    }
    if (errors.length) report.push({ width, pageErrors: errors });
    await ctx.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => h.server.close(resolve));
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const ok = report.filter((r) => r.ok).length, bad = report.filter((r) => r.ok === false);
console.log(`${ok} screenshots written to ${out}`);
for (const b of bad) console.log(`NOT CAPTURED ${b.file}: ${b.error}`);
