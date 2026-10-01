import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const shell = fs.readFileSync(new URL("../public/os/views/shell.js", import.meta.url), "utf8");
const office = fs.readFileSync(new URL("../public/os/views/reference-layout.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../public/os/reference-layout.css", import.meta.url), "utf8");

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

test("office tool cards keep a light visual boundary", () => {
  assert.match(css, /\.ref-office-tool\s*\{[^}]*border\s*:\s*1px\s+solid/s, "primary tools need a light one-pixel border");
  assert.match(css, /\.ref-office-extra\s*\{[^}]*border\s*:\s*1px\s+solid/s, "secondary tools need a light one-pixel border");
});
