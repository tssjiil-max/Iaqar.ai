// Visual identity (Staging): Noto Naskh Arabic self-hosted («خط النسخ»), light petrol frames, the icon set
// from the approved sheet (+ official WhatsApp / Telegram marks), and the office page order.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BRAND_ICONS, iconMarkup } from "../public/os/core/icons.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("Noto Naskh Arabic is the app font: one self-hosted variable file with its licence, preloaded on every entry page", () => {
  const css = read("public/os/os.css");
  const faces = [...css.matchAll(/@font-face \{ font-family: "Noto Naskh Arabic"; src: url\("([^"]+)"\) format\("woff2"\); font-weight: 400 700;/g)].map((m) => m[1]);
  assert.deepEqual(faces, ["/fonts/noto-naskh-arabic/noto-naskh-arabic-var.woff2"]);
  const bytes = fs.readFileSync(path.join(ROOT, "public", faces[0]));
  assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", "a real woff2");
  assert.ok(bytes.length < 140 * 1024, `one file under 140 KB (${bytes.length})`);
  assert.match(css, /font-display: swap/);
  assert.match(css, /--font: "Noto Naskh Arabic", "Geeza Pro", system-ui,/);
  assert.match(css, /body \{[^}]*font-family: var\(--font\)/);
  assert.doesNotMatch(css, /font-family: "(Tajawal|IBM Plex Sans Arabic)"/);
  assert.match(read("public/fonts/noto-naskh-arabic/LICENSE.txt"), /SIL Open Font License/);
  assert.match(read("public/fonts/noto-naskh-arabic/LICENSE.txt"), /The Noto Project Authors/);
  for (const page of ["public/index.html", "public/r.html", "public/s.html"]) {
    assert.match(read(page), /rel="preload" href="\/fonts\/noto-naskh-arabic\/noto-naskh-arabic-var\.woff2" as="font" type="font\/woff2" crossorigin/, page);
    assert.doesNotMatch(read(page), /ibm-plex/, page);
  }
});

test("type scale for Naskh: real weights only, a named size scale off the root, and line heights that fit the face", () => {
  const sheets = ["public/os/os.css", "public/os/reference-layout.css", "public/os/office-desk.css"].map((p) => [p, read(p)]);
  for (const [name, css] of sheets) {
    // The face has four cuts (400–700): nothing asks for a weight it does not have.
    assert.doesNotMatch(css, /font-weight:\s*(800|900)\b/, `${name}: heaviest weight is 700`);
    // Nothing is set under 13px, and no line of text is tighter than the face allows (digits-only badges set px line heights).
    for (const m of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) assert.ok(Number(m[1]) >= 13 || /mono/.test(css.slice(m.index - 120, m.index)), `${name}: ${m[0]}`);
    for (const m of css.matchAll(/line-height:\s*(\d\.\d+)\b/g)) assert.ok(Number(m[1]) >= 1.45 || Number(m[1]) <= 1.2, `${name}: ${m[0]}`);
  }
  const os = sheets[0][1];
  assert.match(os, /html \{[^}]*font-size: 112\.5%/, "root 18px, so the reader's own text size still applies");
  for (const token of ["--fs-name: 1.6rem", "--fs-h1: 1.33rem", "--fs-h2: 1.2rem", "--fs-btn: 1.03rem", "--fs-body: 1rem", "--fs-label: .97rem", "--fs-desc: .875rem", "--fs-meta: .82rem", "--fs-2xs: .75rem", "--lh-body: 1.75", "--lh-title: 1.5", "--lh-ui: 1.45"]) assert.ok(os.includes(`${token};`), token);
  // Sizes come from the scale: after :root, no raw rem size is left outside clamp().
  const rules = os.slice(os.indexOf("color-scheme: light;"));
  assert.deepEqual([...rules.matchAll(/font-size:\s*[\d.]+rem/g)].map((m) => m[0]), []);
  // Secondary, success, warning and error text pass WCAG AA on white and on the tinted surfaces.
  // Blue palette (approved 2026-10-26): the values moved off the old teal greys; the AA claim is now computed, not only pinned.
  for (const colour of ["--muted: #576176", "--faint: #5c6578", "--ok: #23764B", "--warn: #96571A", "--bad: #B03A3A"]) assert.ok(os.includes(`${colour};`), colour);
  const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((m, n) => n - m); return (hi + 0.05) / (lo + 0.05); };
  const token = (name) => os.match(new RegExp(`(?<![\\w-])${name}:\\s*(#[0-9a-fA-F]{6})`))[1];
  for (const name of ["--muted", "--faint", "--ok", "--warn", "--bad"]) for (const surface of ["#FFFFFF", token("--brand-tint"), token("--brand-tint-2")]) assert.ok(ratio(token(name), surface) >= 4.5, `${name} on ${surface}`);
});

test("cards share one light blue frame; tiles inside use the softer one", () => {
  const os = read("public/os/os.css");
  assert.match(os, /--frame: #b5c2d9;/); // was the petrol #B4D3DA before the blue identity
  assert.match(os, /\.os-card \{[^}]*border: 1px solid var\(--frame\)/);
  assert.match(read("public/os/reference-layout.css"), /\.os-app \.os-card\{[^}]*border:1px solid var\(--frame\)/);
  assert.match(read("public/os/office-desk.css"), /\.ref-office-tool \{\n  border: 1px solid var\(--frame-soft\)/);
});

test("the sheet's icons exist, are well-formed and drawn in one language (24px, currentColor, no ids or masks)", () => {
  const names = ["home", "dashboard", "tasks-check", "offers", "match", "handshake", "chart-up", "owner", "client", "broker",
    "apartment", "villa", "land", "tower", "office", "warehouse", "shop", "search", "filter", "pin", "calendar", "clock",
    "bell", "contract", "license", "coins", "mail", "plus-circle", "photos", "gear", "support", "robot", "whatsapp", "telegram"];
  for (const name of names) {
    const markup = iconMarkup(name);
    assert.notEqual(markup, iconMarkup("__missing__"), `${name} has its own drawing`);
    assert.doesNotMatch(markup, /\sid=|<mask|<image|url\(#/, `${name}: no ids, masks or images`);
    const opens = (markup.match(/<(path|rect|circle|ellipse)\b/g) || []).length;
    const closes = (markup.match(/\/>/g) || []).length;
    assert.equal(opens, closes, `${name}: every shape is closed`);
  }
});

test("WhatsApp and Telegram use their official glyphs and brand colours (white inside filled buttons)", () => {
  assert.ok(BRAND_ICONS.has("whatsapp") && BRAND_ICONS.has("telegram"));
  // The official WhatsApp glyph (simple-icons, CC0) starts and ends with these exact segments.
  assert.ok(iconMarkup("whatsapp").startsWith('<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967'));
  assert.ok(iconMarkup("whatsapp").includes("a11.821 11.821 0 00-3.48-8.413Z"));
  assert.ok(iconMarkup("telegram").startsWith('<path d="M11.944 0A12 12 0 0 0 0 12'));
  const css = read("public/os/os.css");
  assert.match(css, /\.os-ico\.os-brand-whatsapp \{ color: #25D366; \}/);
  assert.match(css, /\.os-ico\.os-brand-telegram \{ color: #26A5E4; \}/);
  assert.match(css, /\.os-btn\.primary \.os-ico\.os-brand[^{]*\{ color: inherit; \}/);
});

test("office page order: office card → office tools → التعاون → مركز التواصل والدعم", () => {
  const src = read("public/os/views/reference-layout.js");
  const body = src.slice(src.indexOf("export function renderOffice"));
  const at = (needle) => { const i = body.indexOf(needle); assert.ok(i > 0, needle); return i; };
  const profile = at("ref-office-profile");
  const tools = at('{ text: "أدوات المكتب" }');
  const coop = at('"data-community-entry"');
  const support = at("supportCard()");
  assert.ok(profile < tools && tools < coop && coop < support, `${profile} ${tools} ${coop} ${support}`);
  assert.equal((body.match(/data-community-entry/g) || []).length, 1, "التعاون appears once");
  assert.match(src, /b", \{ text: "مركز التواصل والدعم" \}/);
});
