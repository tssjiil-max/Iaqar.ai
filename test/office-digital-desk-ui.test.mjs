import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const shell = fs.readFileSync(new URL("../public/os/views/shell.js", import.meta.url), "utf8");
const office = fs.readFileSync(new URL("../public/os/views/reference-layout.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/os/office-desk.css", import.meta.url), "utf8");

test("office page uses the approved digital-office hierarchy", () => {
  assert.match(shell, /مكاتب عقارية ذكية/, "main shell header must carry the platform brand");
  assert.match(office, /ref-office-profile/, "office identity must be a dedicated card below the header");
  assert.match(office, /shareOfficeLink/, "office identity card must expose the small share-link action");
  assert.match(office, /ref-office-tools/, "primary office tools grid must exist");
  assert.match(office, /ref-office-extras/, "secondary office tools row must exist");
  assert.doesNotMatch(office, /text:\s*["']مكتبي["']/, "the removed مكتبي heading must not return");
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
  assert.match(css, /\.ref-office-tool-icon\s*\{[^}]*width\s*:\s*52px[^}]*height\s*:\s*52px[^}]*background\s*:\s*var\(--brand-tint\)[^}]*color\s*:\s*var\(--brand-primary\)/s, "primary office icon container must match the reference tint and brand color");
  assert.match(css, /\.ref-office-tool-icon svg\s*\{[^}]*width\s*:\s*26px[^}]*height\s*:\s*26px/s, "primary office glyph should be reduced to 26px");
  assert.match(css, /\.ref-office-extra-icon\s*\{[^}]*background\s*:\s*var\(--brand-tint\)[^}]*color\s*:\s*var\(--brand-primary\)/s, "secondary office icons must use the same reference tint and brand color");
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
    /\.ref-office-profile\s*\{[^}]*grid-template-columns\s*:\s*minmax\(0,1fr\)\s+minmax\(92px,28%\)[^}]*gap\s*:\s*10px[^}]*padding\s*:\s*12px/s,
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
  assert.match(shell, /active === "tasks" \? "المهام اليومية" : active === "repo" \? "العروض والطلبات" : "المكتب"/, "office header must show المكتب as the local context line");
});

test("office identity card uses the same soft card treatment as the daily task path", () => {
  assert.match(css, /\.ref-office-profile\s*\{[^}]*border\s*:\s*0[^}]*box-shadow\s*:\s*var\(--shadow\)/s, "office identity card must use the shared soft-card treatment");
});


test("office profile keeps the full name and right-aligns all values", () => {
  assert.match(css, /\.ref-office-profile-head h2\s*\{[^}]*white-space\s*:\s*normal[^}]*text-overflow\s*:\s*clip/s, "office name must not be truncated with ellipsis");
  assert.match(css, /\.ref-office-profile-row b\s*\{[^}]*text-align\s*:\s*right/s, "all office values must align to the right");
  assert.match(css, /\.ref-office-profile-row b\[dir="ltr"\]\s*\{[^}]*text-align\s*:\s*right/s, "numeric license value must stay visually right-aligned even when LTR");
});

test("primary and secondary office icon frames are the same size with a light outline", () => {
  assert.match(css, /\.ref-office-tool-icon\s*\{[^}]*width\s*:\s*43px[^}]*height\s*:\s*43px[^}]*border\s*:\s*1px\s+solid\s+var\(--brand-line\)/s, "primary icon frame must match secondary icon frame size and use a light outline");
  assert.match(css, /\.ref-office-extra-icon\s*\{[^}]*width\s*:\s*43px[^}]*height\s*:\s*43px[^}]*border\s*:\s*1px\s+solid\s+var\(--brand-line\)/s, "secondary icon frame must use the same light outline");
  assert.match(css, /\.ref-office-tool-icon svg\s*\{[^}]*width\s*:\s*24px[^}]*height\s*:\s*24px/s, "primary glyph must match secondary glyph size");
});
