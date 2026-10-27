// Compare the protected Firebase-source UI with the integration on synthetic data.
// node scripts/qa/office-os/recovery-visual.e2e.mjs /path/to/reference /path/to/output
// Each source runs in its own process because the harness intercepts global fetch.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const self = new URL(import.meta.url).pathname;
const fixed = Date.parse('2026-10-25T09:00:00Z');
if (process.argv[2] !== '--capture') {
  const reference = path.resolve(process.argv[2]);
  const out = path.resolve(process.argv[3] || 'qa/recovery-visual');
  const integration = path.resolve(path.dirname(self), '../../..');
  for (const [name, root] of [['reference', reference], ['integration', integration]]) {
    execFileSync(process.execPath, [self, '--capture', root, path.join(out, name)], { stdio: 'inherit' });
  }
  const files = fs.readdirSync(path.join(out, 'reference')).filter(n => n.endsWith('.png'));
  const comparisons = files.map(file => ({ file, identical: fs.readFileSync(path.join(out, 'reference', file)).equals(fs.readFileSync(path.join(out, 'integration', file))) }));
  fs.writeFileSync(path.join(out, 'comparison.json'), JSON.stringify(comparisons, null, 2) + '\n');
  for (const result of comparisons) console.log(`${result.identical ? 'PASS' : 'FAIL'} protected screenshot: ${result.file}`);
  assert.equal(comparisons.filter(c => !c.identical).length, 0, 'unintended visual difference');
} else {
  const root = path.resolve(process.argv[3]), out = path.resolve(process.argv[4]);
  fs.mkdirSync(out, { recursive: true });
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixed])); }
    static now() { return fixed; }
  };
  const { startOfficeOsHarness, OWNER_A, OFFICE_A } = await import(pathToFileURL(path.join(root, 'scripts/qa/office-os/server.mjs')));
  const { seedStates } = await import(pathToFileURL(path.join(root, 'scripts/qa/office-os/seed.mjs')));
  const h = await startOfficeOsHarness();
  await seedStates(h);
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1280]) {
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
      for (const [name, route, ready] of [
        ['home', '/#/office', '[data-smart-office]'],
        ['tasks', '/#/tasks', '[data-type="MATCH_REVIEW"]'],
        ['records', '/#/repo', '[data-record]'],
        ['guest', '/?view=search', '.os-guest-path'],
        ['office-link', '/o/sultan', '.os-guest-path']
      ]) {
        await page.goto(h.origin + route);
        await page.locator(ready).first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        // The app keeps live polling; networkidle would never be a ready signal.
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(out, `${width}-${name}.png`), fullPage: true, animations: 'disabled' });
      }
      await ctx.close();
    }
  } finally { await browser.close(); await new Promise(resolve => h.server.close(resolve)); }
}
