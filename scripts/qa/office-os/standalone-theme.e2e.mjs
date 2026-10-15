// CSS coverage for the standalone HTML entries; business flows are tested separately.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { startOfficeOsHarness } from './server.mjs';

const h = await startOfficeOsHarness();
const browser = await chromium.launch();
const entries = ['index.html', 'admin/index.html', 'legacy.html', 'complete.html',
  'opportunity-details-v2-preview.html', 'scout-inbox.html', 'share-target.html', 'r.html', 's.html'];
const results = [];
try {
  for (const width of [320, 390, 768, 1280]) {
    // Disable scripts to measure each HTML entry's own CSS independently of auth,
    // redirects, third-party services and missing one-time link tokens.
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 844 } });
    const page = await context.newPage();
    await page.route('https://**/*', route => route.abort());
    for (const entry of entries) {
      await page.goto(`${h.origin}/${entry}`);
      await page.evaluate(async () => {
        await document.fonts.load('16px "Office Tajawal"', 'عقار');
        await document.fonts.ready;
      });
      const metrics = await page.evaluate(() => ({
        rtl: document.documentElement.dir,
        font: getComputedStyle(document.body).fontFamily,
        primary: getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim(),
        legacyPrimary: getComputedStyle(document.documentElement).getPropertyValue('--green').trim(),
        controls: [...document.querySelectorAll('button,input,select,textarea')].every(
          el => getComputedStyle(el).fontFamily.includes('Office Tajawal')),
        stylesheet: !!document.querySelector('link[href="/os/site-theme.css"]'),
        fontLoaded: document.fonts.check('16px "Office Tajawal"')
      }));
      assert.equal(metrics.rtl, 'rtl', entry);
      assert.match(metrics.font, /Office Tajawal/, entry);
      assert.equal(metrics.primary, '#03677a', entry);
      assert.equal(metrics.legacyPrimary, '#03677a', entry);
      assert.ok(metrics.controls && metrics.stylesheet && metrics.fontLoaded, `${entry}: ${JSON.stringify(metrics)}`);
      results.push({ entry, width, ...metrics });
      console.log(`checked CSS ${entry}/${width}`);
    }
    await context.close();
  }
  fs.mkdirSync('qa/site-theme', { recursive: true });
  fs.writeFileSync('qa/site-theme/standalone-results.json', JSON.stringify({ results }, null, 2));
  console.log(`PASS ${results.length} standalone CSS checks`);
} finally {
  await browser.close();
  h.server.close();
}
