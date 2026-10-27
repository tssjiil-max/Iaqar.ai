// Guards the approved visual identity: one blue palette, the 3D logo and 3D icons in their 17 places.
// DESIGN_ROOT=<path> runs the same checks against another checkout (used to show the base fails them).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(process.env.DESIGN_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: ((h * 60) + 360) % 360, s, l };
}
const isTeal = (r, g, b) => { const c = hsl(r, g, b); return c.h >= 165 && c.h <= 205 && c.s >= 0.12; };
function tealColours(text) {
  const found = [];
  for (const m of text.matchAll(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    let x = m[1]; if (x.length === 3) x = [...x].map((c) => c + c).join('');
    if (isTeal(parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16))) found.push(m[0]);
  }
  for (const m of text.matchAll(/rgba?\(\s*(\d+)(?:\s*,\s*|\s+)(\d+)(?:\s*,\s*|\s+)(\d+)/g)) {
    if (isTeal(+m[1], +m[2], +m[3])) found.push(m[0]);
  }
  return found;
}
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const APP_CSS = ['feedback', 'os', 'reference-layout', 'office-desk', 'office-reference', 'site-theme', 'mobile-reference-polish', 'guest-search'].map((n) => `public/os/${n}.css`);

// Official third-party brand colours are not ours to change: Telegram's blue happens to sit in the teal hue range.
const OFFICIAL_BRAND_COLOURS = new Set(['#26a5e4']);

test('the new app uses one blue palette: no teal-family colour is left in its stylesheets or meta tags', () => {
  const files = [...APP_CSS, 'public/index.html', 'public/r.html', 'public/manifest.webmanifest'];
  const left = files.flatMap((f) => tealColours(read(f)).filter((c) => !OFFICIAL_BRAND_COLOURS.has(c.toLowerCase())).map((c) => `${f}: ${c}`));
  assert.deepEqual(left, []);
});

test('the official WhatsApp and Telegram brand colours are untouched by the palette change', () => {
  const css = read('public/os/os.css');
  assert.match(css, /\.os-ico\.os-brand-whatsapp \{ color: #25D366; \}/);
  assert.match(css, /\.os-ico\.os-brand-telegram \{ color: #26A5E4; \}/);
});

test('the brand tokens are the approved blues and keep WCAG AA contrast', () => {
  const css = read('public/os/os.css');
  const token = (name) => css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase();
  assert.equal(token('--brand-primary'), '#1668e3');
  assert.equal(token('--brand-dark'), '#101733');
  assert.ok(contrast(token('--brand-primary'), '#ffffff') >= 4.5, 'white text on the primary blue');
  assert.ok(contrast(token('--brand-dark'), '#ffffff') >= 7, 'headings on white');
  assert.ok(contrast(token('--brand-primary'), token('--brand-tint')) >= 4.5, 'primary text on the tint');
  assert.equal(css.match(/--bg:\s*(#[0-9a-fA-F]{6})/)?.[1]?.toLowerCase(), '#ffffff', 'the page background stays white');
  for (const f of ['public/index.html', 'public/r.html']) assert.match(read(f), /name="theme-color" content="#1668E3"/i);
  assert.match(read('public/manifest.webmanifest'), /"theme_color":\s*"#1668E3"/i);
});

test('the 3D logo replaces the flat one in the three in-app places', () => {
  assert.ok(exists('public/icons/iaqar-logo-3d.webp'), 'logo file');
  for (const f of ['public/os/office-desk.css', 'public/os/office-reference.css', 'public/os/reference-layout.css']) {
    assert.match(read(f), /\/icons\/iaqar-logo-3d\.webp/, f);
    assert.doesNotMatch(read(f), /\/icons\/iaqar-logo\.png/, f);
  }
  assert.ok(exists('public/icons/iaqar-logo.png'), 'the old file stays for the app icons and share cards that still use it');
});

// 12 home tiles + 5 bottom-bar tabs (tools/market is both a tile and a tab) = 17 places.
const tileRoutes = () => [...read('public/os/views/reference-layout.js').match(/const REFERENCE_TOOLS = \[([\s\S]*?)\n\];/)[1].matchAll(/\["[^"]*","[^"]*","([^"]*)"/g)].map((m) => m[1]);
const navRoutes = () => [...read('public/os/views/shell.js').match(/BOTTOM_NAV = Object\.freeze\(\[(.*?)\]\);/s)[1].matchAll(/\["([^"]*)","[^"]*","[^"]*"\]/g)].map((m) => m[1]);

test('every one of the 17 icon places has a 3D icon that exists, is a real WebP and is small', async () => {
  const { ICON_3D } = await import(pathToFileURL(path.join(ROOT, 'public/os/core/icons.js')).href + `?t=${Date.now()}`);
  const tiles = tileRoutes(), nav = navRoutes();
  assert.equal(tiles.length, 12);
  assert.equal(nav.length, 5);
  assert.equal(tiles.length + nav.length, 17);
  for (const route of [...tiles, ...nav]) {
    const key = ICON_3D[route];
    assert.ok(key, `3D icon for ${route}`);
    const file = `public/icons/3d/${key}.webp`;
    assert.ok(exists(file), file);
    const bytes = fs.readFileSync(path.join(ROOT, file));
    assert.equal(bytes.subarray(0, 4).toString('latin1'), 'RIFF', `${file} is RIFF`);
    assert.equal(bytes.subarray(8, 12).toString('latin1'), 'WEBP', `${file} is WebP`);
    assert.ok(bytes.length < 40 * 1024, `${file} is ${bytes.length} bytes`);
  }
});

test('the line icon stays as the fallback and the routes of tiles and tabs did not change', () => {
  const icons = read('public/os/core/icons.js');
  assert.match(icons, /addEventListener\("error", \(\) => img\.replaceWith\(icon\(fallbackName\)\)/);
  assert.deepEqual(tileRoutes(), ['tasks', 'repo', 'scout', 'tasks?step=0', 'tools/guide', 'tools/forms', 'tools/services', 'tools/calculator', 'agent', 'library', 'tools/market', 'support']);
  assert.deepEqual(navRoutes(), ['public', 'search', 'office', 'tools/market', 'settings']);
});

test('blue text on the blue tints and white text on the selected blue keep AA contrast (found by the mobile-widths gate)', () => {
  const theme = read('public/os/site-theme.css');
  const tone = theme.match(/\.tone-teal\{--tool-color:#[0-9a-f]{6};--tool-text:(#[0-9a-f]{6});--tool-bg:(#[0-9a-f]{6})\}/i);
  assert.ok(tone, 'blue tone rule');
  assert.ok(contrast(tone[1], tone[2]) >= 4.5, `tone text ${tone[1]} on ${tone[2]}`);
  const step = theme.match(/\.step-5\{--stage:#[0-9a-f]{6};--stage-ink:(#[0-9a-f]{6});--stage-bg:(#[0-9a-f]{6})\}/i);
  assert.ok(step && contrast(step[1], step[2]) >= 4.5, 'closed-deal status text');
  assert.ok(contrast(step[1], '#eaeff7') >= 4.5, 'record price on the offer surface');
  const os = read('public/os/os.css');
  assert.match(os, /\.os-section-tab\[aria-selected="true"\] \.n \{ opacity: 1; \}/);
  assert.match(os, /\.os-chip\[aria-pressed="true"\] \.n \{ opacity: 1; \}/);
  assert.match(read('public/os/mobile-reference-polish.css'), /\.ref-record-copy b \{ color: #135ccc;/);
});
