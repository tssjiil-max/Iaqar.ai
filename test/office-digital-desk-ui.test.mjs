import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const shell = fs.readFileSync(new URL("../public/os/views/shell.js", import.meta.url), "utf8");
const office = fs.readFileSync(new URL("../public/os/views/reference-layout.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/os/office-desk.css", import.meta.url), "utf8");

test("office page uses the approved digital-office hierarchy", () => {
  assert.match(shell, /مكاتب عقارية ذكية/, "main shell header must carry the platform brand");
  assert.match(office, /ref-office-profile/, "office identity must be a dedicated card below the header");
  assert.doesNotMatch(office, /ref-office-share/, "the reference card has no share button; sharing stays in the settings menu");
  assert.match(shell, /shareOfficeLink\(\); \} \}, ic\("link"\), "مشاركة رابط المكتب"/, "sharing the office link must remain available from the menu");
  assert.match(office, /ref-office-tools/, "primary office tools grid must exist");
  assert.match(office, /ref-office-extras/, "secondary office tools row must exist");
  assert.match(office, /ref-office-heading[^\n]*text:\s*["']مكتبي["']/, "the reference shows the «مكتبي» heading above the main tools");
});

test("office tool labels and order stay exact", () => {
  const expected = [
    "ملفاتي", "النماذج", "الدليل",
    "الخدمات", "الحاسبة", "السوق",
    "جهات الاتصال", "دفتر المكتب", "الأرشيف", "المفضلة"
  ];
  let cursor = -1;
  for (const label of expected) {
    const next = office.indexOf(`"${label}"`, cursor + 1);
    assert.ok(next > cursor, `missing or out-of-order office tool: ${label}`);
    cursor = next;
  }
});

test("office tool cards use the same light boundary token as daily tasks", () => {
  assert.match(css, /\.ref-office-tool\s*\{[^}]*border\s*:\s*1px\s+solid\s+var\(--brand-tint\)/s, "primary tools must use the same task-page boundary token");
  assert.match(css, /\.ref-office-extra\s*\{[^}]*border\s*:\s*1px\s+solid\s+var\(--brand-tint\)/s, "secondary tools must use the same task-page boundary token");
});

test("bare office names are presented as a complete real-estate office title", () => {
  assert.match(office, /officeDisplayName/, "office view should normalize a bare office name");
  assert.match(office, /مكتب\s+\$\{raw\}\s+العقاري/, "a bare name such as سلطان should render as مكتب سلطان العقاري");
});

test("directory uses a directory-style icon, not the contacts icon", () => {
  assert.match(office, /\["الدليل",\s*"clipboard"\]/, "directory must use the existing directory/list glyph");
  assert.doesNotMatch(office, /\["الدليل",\s*"users"\]/, "directory must not reuse the contacts glyph");
});

test("additional-tools heading follows the same title/description row rhythm as daily tasks", () => {
  assert.match(css, /\.ref-office-extras-heading\s*\{[^}]*flex-direction\s*:\s*row[^}]*justify-content\s*:\s*space-between/s, "additional tools title and helper text must share the same row rhythm as the deal-path heading");
  assert.match(css, /\.ref-office-extras-heading h2\s*\{[^}]*color\s*:\s*var\(--brand-dark\)/s, "additional tools title must use the same dark heading color as daily tasks");
  assert.match(css, /\.os-app\[data-view="office"\][^{]*\{[^}]*padding-bottom\s*:\s*(?:1[5-9][0-9]|[2-9][0-9]{2,})px/s, "office view needs extra bottom clearance above the fixed nav");
});

test("office icons match the monochrome offer/request icon treatment", () => {
  // One icon frame for main and extra tools (reference): 44px frame, 23px glyph, tint + brand colour, light border, no shadow.
  assert.match(css, /\.ref-office-tool-icon,\s*\.ref-office-extra-icon\s*\{[^}]*width\s*:\s*44px[^}]*height\s*:\s*44px[^}]*background\s*:\s*var\(--brand-tint\)[^}]*color\s*:\s*var\(--brand-primary\)[^}]*border\s*:\s*1px\s+solid\s+var\(--brand-line\)[^}]*box-shadow\s*:\s*none/s, "main and extra icon frames must be the same size and treatment");
  assert.match(css, /\.ref-office-tool-icon svg,\s*\.ref-office-extra-icon svg\s*\{[^}]*width\s*:\s*23px[^}]*height\s*:\s*23px/s, "main and extra glyphs must be the same 23px");
  assert.doesNotMatch(css, /\.ref-office-tool-icon\s*\{[^}]*width/s, "no separate (larger) size for the main tool icons");
  assert.match(css, /\.ref-office-tool-icon \.t2,\s*\.ref-office-extra-icon \.t2\s*\{[^}]*opacity\s*:\s*1/s, "office-only secondary icon layers must be flattened to one monochrome tone");
});


test("office visual weight follows the daily-tasks page without redesign", () => {
  assert.doesNotMatch(
    css,
    /\.os-app\[data-view="office"\]\s+\.ref-shell-platform\s*\{/,
    "office must inherit the exact shared platform header used by daily tasks"
  );
  assert.match(
    css,
    /\.ref-office-profile\s*\{[^}]*grid-template-columns\s*:\s*minmax\(0,1fr\)\s+minmax\(92px,31%\)[^}]*gap\s*:\s*10px[^}]*padding\s*:\s*12px/s,
    "office identity card must stay compact without changing its structure"
  );
  assert.match(
    css,
    /\.ref-office-profile-row\s*\{[^}]*min-height\s*:\s*39px/s,
    "office identity rows should use the tighter shared vertical rhythm"
  );
  assert.match(
    css,
    /\.ref-office-logo-mark\s*\{[^}]*width\s*:\s*min\(98px,70%\)/s,
    "office logo mark should be reduced by roughly 10–15%"
  );
  assert.match(
    css,
    /\.ref-office-tool\s*\{[^}]*border\s*:\s*1px\s+solid\s+var\(--brand-tint\)[^}]*box-shadow\s*:\s*none/s,
    "primary tool cards must use the exact task-page light boundary token"
  );
  assert.match(
    css,
    /\.ref-office-extra\s*\{[^}]*border\s*:\s*1px\s+solid\s+var\(--brand-tint\)[^}]*box-shadow\s*:\s*none/s,
    "secondary tool cards must use the exact task-page light boundary token"
  );
});


test("office header has the same two-line platform hierarchy as daily tasks", () => {
  // The office reference header shows the platform name only; the other screens keep their context line.
  assert.match(shell, /active === "tasks" \? "المهام اليومية" : active === "repo" \? "العروض والطلبات" : ""/, "office header must not add a line that is not in the reference");
});

test("office identity card uses the same soft card treatment as the daily task path", () => {
  assert.match(css, /\.ref-office-profile\s*\{[^}]*border\s*:\s*0[^}]*box-shadow\s*:\s*var\(--shadow\)/s, "office identity card must use the shared soft-card treatment");
});

test("office identity rows follow the reference: icon, then label and value together, name never clipped", () => {
  assert.match(css, /\.ref-office-profile-row\s*\{[^}]*grid-template-columns\s*:\s*34px\s+minmax\(0,1fr\)[^}]*direction\s*:\s*rtl/s, "rows are icon + text, RTL");
  assert.match(css, /\.ref-office-row-icon\s*\{[^}]*background\s*:\s*var\(--brand-tint\)[^}]*color\s*:\s*var\(--brand-primary\)[^}]*border\s*:\s*1px\s+solid\s+var\(--brand-line\)[^}]*box-shadow\s*:\s*none/s, "row icons sit in a small tinted square without shadow");
  assert.match(css, /\.ref-office-row-text b\.ref-office-ltr\s*\{[^}]*direction\s*:\s*ltr[^}]*unicode-bidi\s*:\s*isolate/s, "the licence number is LTR but isolated so it stays beside its label");
  const name = css.match(/\.ref-office-profile-head h2\s*\{[^}]*\}/s)?.[0] || "";
  assert.match(name, /white-space\s*:\s*normal/, "the office name may wrap");
  assert.doesNotMatch(name, /ellipsis|nowrap|line-clamp/, "the office name is never clipped");
  assert.match(office, /profileRow\("user", "الوسيط", broker\)/);
  assert.match(office, /profileRow\("note", "ترخيص فال", license, \{ ltr: true \}\)/);
  assert.match(office, /profileRow\("pin", "", city\)/);
});

test("office tools that are not built yet are marked «قريبًا» and are not clickable", () => {
  const count = (office.match(/class: "ref-office-(tool|extra) is-soon"/g) || []).length;
  assert.equal(count, 2, "both tool card builders must mark the card as inactive");
  assert.equal((office.match(/text: "قريبًا"/g) || []).length, 2, "each card builder must show the «قريبًا» label");
  assert.doesNotMatch(office, /officeTool[^\n]*addEventListener|ref-office-tool[^\n]*onClick/, "inactive tools must not pretend to open something");
  assert.match(css, /\.ref-office-soon/, "the label needs its own style");
});
