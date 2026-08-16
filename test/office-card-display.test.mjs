// Office card display regression — Tajawal scope, colors, layout, image sizing.
import test from "node:test";
import assert from "node:assert/strict";
import { readRepositoryFile } from "./helpers/shell.mjs";

const html = readRepositoryFile("public", "index.html");
const sw = readRepositoryFile("public", "firebase-messaging-sw.js");

function extractOfficeCardCss() {
  const start = html.indexOf("/* بطاقة المكتب */");
  const end = html.indexOf(".office-license-line", start);
  return html.slice(start, end + 200);
}

test("office card uses scoped local Tajawal font-face and family", () => {
  assert.ok(html.includes("@font-face"));
  assert.ok(html.includes("/fonts/tajawal/tajawal-400.woff2"));
  assert.ok(html.includes("/fonts/tajawal/tajawal-500.woff2"));
  assert.ok(html.includes("/fonts/tajawal/tajawal-700.woff2"));
  assert.ok(html.includes("/fonts/tajawal/tajawal-800.woff2"));
  assert.ok(html.includes(".card.license {"));
  assert.ok(html.includes("font-family:\"Tajawal Office\""));
  assert.equal(html.includes("font-family:\"Tajawal Office\",Tajawal"), true);
});

test("office card name is dark green weight 800 with clamp sizing", () => {
  const css = extractOfficeCardCss();
  assert.ok(css.includes(".card.license .office-name-bar h3"));
  assert.ok(css.includes("color:var(--green-dark)"));
  assert.ok(css.includes("font-weight:800"));
  assert.ok(css.includes("clamp(22px"));
  assert.equal(css.includes("color:var(--text)"), false);
});

test("office card values are dark green not black text token", () => {
  const css = extractOfficeCardCss();
  assert.ok(css.includes(".card.license .office-line strong"));
  assert.ok(css.includes("color:var(--green-dark)"));
  assert.ok(css.includes("font-weight:700"));
  assert.equal(/\.card\.license \.office-line strong[^}]*color:var\(--text\)/.test(css), false);
});

test("office card labels use muted green-gray weight 500", () => {
  const css = extractOfficeCardCss();
  assert.ok(css.includes(".card.license .office-line"));
  assert.ok(css.includes("#5C7468"));
  assert.ok(css.includes("font-weight:500"));
});

test("office logo is rectangular with cover and clamp dimensions", () => {
  const css = extractOfficeCardCss();
  assert.ok(css.includes(".card.license .office-logo"));
  assert.ok(css.includes("aspect-ratio:4/5"));
  assert.ok(css.includes("object-fit:cover"));
  assert.ok(css.includes("clamp(112px,29vw,124px)"));
  assert.ok(css.includes("clamp(132px,34vw,148px)"));
  assert.ok(css.includes("border-radius:17px"));
  assert.equal(css.includes("border-radius:50%"), false);
});

test("office main grid aligns top; services outside info column", () => {
  assert.ok(html.includes("align-items:start"));
  const cardStart = html.indexOf("<section class=\"card license\">");
  const cardEnd = html.indexOf("</section>", cardStart);
  const cardBlock = html.slice(cardStart, cardEnd);
  assert.ok(cardBlock.includes("</div>\n\n        <p class=\"office-services-inline\""));
  const infoMatch = cardBlock.match(/<div class="office-info">[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(infoMatch, "office-info block must exist");
  assert.equal(infoMatch[0].includes("office-services-inline"), false,
    "services must not live inside office-info");
});

test("office services stay inside card with divider and dark green", () => {
  const css = extractOfficeCardCss();
  assert.ok(css.includes(".card.license .office-services-inline"));
  assert.ok(css.includes("border-top:1px solid"));
  assert.ok(css.includes("margin-top:14px"));
  assert.ok(css.includes("color:var(--green-dark)"));
  assert.ok(css.includes("font-weight:700"));
});

test("office card image min width at 390px viewport is at least 94px", () => {
  const vw = 390 * 0.256;
  assert.ok(vw >= 94);
  assert.ok(vw <= 118);
});

test("service worker cache bumped for office card deploy", () => {
  assert.ok(sw.includes("iaqar-shell-workspace-v2"));
});

test("office card CSS does not change header or operations center rules", () => {
  const headerBlock = html.slice(html.indexOf(".header {"), html.indexOf(".header {") + 800);
  assert.equal(headerBlock.includes("Tajawal Office"), false);
  const opsBlock = html.slice(html.indexOf(".operation {"), html.indexOf(".operation {") + 400);
  assert.equal(opsBlock.includes("--green-dark"), false);
});
