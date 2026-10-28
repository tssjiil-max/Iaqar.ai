// The approved identity in a real browser: the 17 icon places (12 home tiles + 5 bottom-bar tabs) show their 3D icon,
// the 3D logo loads, nothing overflows, and the tiles and tabs still open the same pages. Synthetic data only.
//   node scripts/qa/office-os/design-icons.e2e.mjs
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = process.env.OUT_DIR || '/tmp/iaqar-design-icons';
fs.mkdirSync(OUT, { recursive: true });
const { startOfficeOsHarness, OWNER_A, OFFICE_A } = await import(pathToFileURL(path.join(ROOT, 'scripts/qa/office-os/server.mjs')));
const { seedStates } = await import(pathToFileURL(path.join(ROOT, 'scripts/qa/office-os/seed.mjs')));

// Written out here on purpose: this is the expectation, not a copy of the code under test.
const TILES = { 'tasks': 'calendar', 'repo': 'dashboard', 'scout': 'search', 'tasks?step=0': 'favorite', 'tools/guide': 'help', 'tools/forms': 'document', 'tools/services': 'services', 'tools/calculator': 'calculator', 'agent': 'assistant', 'library': 'upload', 'tools/market': 'reports', 'support': 'chat' };
const NAV = [['public', 'property'], ['search', 'search'], ['office', 'office'], ['tools/market', 'reports'], ['settings', 'user']];
const WIDTHS = [320, 390, 768, 1280];

const h = await startOfficeOsHarness();
await seedStates(h);
const browser = await chromium.launch();
let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks += 1; };
const open = async (width, hash = '/#/office') => {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, locale: 'ar-SA', timezoneId: 'Asia/Riyadh' });
  await ctx.addInitScript(({ uid, officeId }) => { localStorage.setItem('harness.uid', uid); localStorage.setItem('iaqar.officeId', officeId); }, { uid: OWNER_A, officeId: OFFICE_A });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  await page.goto(h.origin + hash);
  await page.locator('.ref-reference-bottom').waitFor({ timeout: 15000 });
  return { ctx, page, errors };
};
const loaded = (page, selector) => page.$$eval(selector, (imgs) => imgs.map((i) => ({ key: i.dataset.icon3d, ok: i.complete && i.naturalWidth > 0, w: Math.round(i.getBoundingClientRect().width) })));

try {
  for (const width of WIDTHS) {
    const { ctx, page, errors } = await open(width);
    await page.locator('.ref-office-tools').waitFor();
    // 12 home tiles
    const tiles = await page.$$eval('[data-reference-tool]', (els) => els.map((e) => ({ route: e.dataset.toolRoute, key: e.querySelector('img.os-ico3d')?.dataset.icon3d, ok: !!e.querySelector('img.os-ico3d')?.complete && e.querySelector('img.os-ico3d')?.naturalWidth > 0, svg: !!e.querySelector('svg.os-ico') })));
    ok(tiles.length === 12, `${width}px: 12 tiles (got ${tiles.length})`);
    for (const t of tiles) { ok(t.key === TILES[t.route], `${width}px tile ${t.route} → ${TILES[t.route]} (got ${t.key})`); ok(t.ok, `${width}px tile ${t.route} image loaded`); ok(!t.svg, `${width}px tile ${t.route} has no leftover line icon`); }
    // 5 bottom-bar tabs
    const tabs = await loaded(page, '.ref-reference-bottom button img.os-ico3d');
    ok(tabs.length === 5, `${width}px: 5 tabs with a 3D icon (got ${tabs.length})`);
    tabs.forEach((t, i) => { ok(t.key === NAV[i][1], `${width}px tab ${NAV[i][0]} → ${NAV[i][1]} (got ${t.key})`); ok(t.ok, `${width}px tab ${NAV[i][0]} image loaded`); });
    // 3D logo: the CSS points at it and the file loads
    const logo = await page.evaluate(async () => {
      const probe = document.querySelector('.ref-reference-header .ref-logo') || document.querySelector('.ref-logo');
      const bg = probe ? getComputedStyle(probe).backgroundImage : '';
      const url = (bg.match(/url\("?([^")]+)"?\)/) || [])[1];
      const res = url ? await fetch(url) : null;
      // The image really decodes (the QA server's mime table is not the hosting's, so the content type is not asserted).
      const decoded = url ? await new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i.naturalWidth); i.onerror = () => resolve(0); i.src = url; }) : 0;
      return { bg, status: res?.status, decoded };
    });
    ok(/iaqar-logo-3d\.webp/.test(logo.bg), `${width}px logo css (${logo.bg.slice(0, 60)})`);
    ok(logo.status === 200 && logo.decoded >= 256, `${width}px logo file is served and decodes (${logo.status}, ${logo.decoded}px)`);
    // no horizontal scroll, and the bar does not cover the page content area width
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(overflow <= 0, `${width}px no horizontal scroll (${overflow})`);
    ok(errors.length === 0, `${width}px no page errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: path.join(OUT, `home-${width}.png`), animations: 'disabled' });
    await ctx.close();
  }

  // The same five tabs on every other page of the bar.
  {
    const { ctx, page, errors } = await open(390);
    for (const hash of ['/#/tasks', '/#/repo', '/#/search', '/#/tools/market', '/#/settings']) {
      await page.goto(h.origin + hash);
      await page.locator('.ref-reference-bottom').waitFor();
      const tabs = await loaded(page, '.ref-reference-bottom button img.os-ico3d');
      ok(tabs.length === 5 && tabs.every((t) => t.ok), `${hash}: 5 tabs with loaded 3D icons`);
    }
    ok(errors.length === 0, `no page errors on the other pages: ${errors.join(' | ')}`);
    await ctx.close();
  }

  // Function is unchanged: a tile opens its page, a tab opens its page, back works.
  {
    const { ctx, page } = await open(390);
    await page.locator('[data-tool-route="tasks"]').click();
    await page.waitForFunction(() => location.hash.startsWith('#/tasks'));
    ok(true, 'tile «المهام اليومية» opens #/tasks');
    await page.locator('.ref-reference-bottom button').nth(1).click();
    await page.waitForFunction(() => location.hash.startsWith('#/search'));
    ok(true, 'tab «البحث» opens #/search');
    await page.locator('.ref-reference-bottom button').nth(2).click();
    await page.waitForFunction(() => location.hash.startsWith('#/office'));
    ok(await page.locator('[data-reference-tool]').count() === 12, 'tab «المكتب» is back on the 12 tiles');
    await ctx.close();
  }

  // An image that does not load never leaves a hole: the line icon takes its place.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-SA' });
    await ctx.addInitScript(({ uid, officeId }) => { localStorage.setItem('harness.uid', uid); localStorage.setItem('iaqar.officeId', officeId); }, { uid: OWNER_A, officeId: OFFICE_A });
    await ctx.route('**/icons/3d/calendar.webp', (route) => route.abort());
    const page = await ctx.newPage();
    await page.goto(h.origin + '/#/office');
    await page.locator('.ref-office-tools').waitFor();
    await page.waitForFunction(() => !!document.querySelector('[data-tool-route="tasks"] svg.os-ico'));
    ok(await page.locator('[data-tool-route="tasks"] img.os-ico3d').count() === 0, 'a failed image is replaced by the line icon');
    ok(await page.locator('[data-reference-tool] img.os-ico3d').count() === 11, 'the other 11 tiles keep their 3D icon');
    await ctx.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => h.server.close(resolve));
}
console.log(`${checks} design checks passed (4 widths × 17 icon places, logo, function, fallback)`);
