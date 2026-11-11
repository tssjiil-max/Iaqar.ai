import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const viewSource = fs.readFileSync(new URL("../public/os/views/reference-layout.js", import.meta.url), "utf8");
const cssSource = fs.readFileSync(new URL("../public/os/reference-layout.css", import.meta.url), "utf8");

test("office page is a compact office-tools hub, not a daily-tasks dashboard", () => {
  const officeStart = viewSource.indexOf("export function renderOffice");
  const officeEnd = viewSource.indexOf("export function renderTaskDetail");
  assert.ok(officeStart >= 0 && officeEnd > officeStart, "renderOffice must exist");
  const office = viewSource.slice(officeStart, officeEnd);

  assert.match(office, /ref-office-tools/);
  assert.doesNotMatch(office, /مهام اليوم/);
  assert.doesNotMatch(office, /text:\s*["']مكتبي["']/);

  for (const label of ["ملفاتي", "النماذج", "الدليل", "الخدمات", "الحاسبة", "السوق"]) {
    assert.ok(office.includes(label), `missing primary office tool: ${label}`);
  }
  for (const label of ["جهات الاتصال", "دفتر المكتب", "الأرشيف", "المفضلة"]) {
    assert.ok(office.includes(label), `missing additional office tool: ${label}`);
  }
});

test("office tools use explicit compact grids with light card boundaries", () => {
  assert.match(cssSource, /\.ref-office-tool-grid\s*\{/);
  assert.match(cssSource, /\.ref-office-extra-grid\s*\{/);
  assert.match(cssSource, /\.ref-office-tool\s*\{/);
  assert.match(cssSource, /border:\s*1px\s+solid/);
});
