// Visual identity (Staging): IBM Plex Sans Arabic self-hosted, light petrol frames, the icon set
// from the approved sheet (+ official WhatsApp / Telegram marks), and the office page order.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BRAND_ICONS, iconMarkup } from "../public/os/core/icons.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("IBM Plex Sans Arabic is the app font, self-hosted with its licence, and preloaded", () => {
  const css = read("public/os/os.css");
  const faces = [...css.matchAll(/@font-face \{ font-family: "IBM Plex Sans Arabic"; src: url\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.equal(faces.length, 4);
  for (const url of faces) {
    const file = path.join(ROOT, "public", url);
    assert.ok(fs.existsSync(file), url);
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", `${url} is a real woff2`);
  }
  assert.match(css, /font-display: swap/);
  assert.match(css, /body \{[^}]*font-family: "IBM Plex Sans Arabic"/);
  assert.doesNotMatch(css, /font-family: "Tajawal"/);
  assert.ok(fs.existsSync(path.join(ROOT, "public/fonts/ibm-plex-sans-arabic/LICENSE.txt")));
  assert.match(read("public/fonts/ibm-plex-sans-arabic/LICENSE.txt"), /SIL Open Font License/);
  assert.match(read("public/index.html"), /rel="preload" href="\/fonts\/ibm-plex-sans-arabic\/ibm-plex-sans-arabic-400\.woff2"/);
});

test("cards share one light petrol frame; tiles inside use the softer one", () => {
  const os = read("public/os/os.css");
  assert.match(os, /--frame: #B4D3DA;/);
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
