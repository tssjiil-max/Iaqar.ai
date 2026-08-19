import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildSuitableOfficeDropdownHtml,
  buildSuitableOfficesShareSectionHtml
} from "../public/js/suitable-offices-ui.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function readRepo(...parts) {
  return readFileSync(path.join(root, "..", ...parts), "utf8");
}

test("share section exposes combobox dropdown search by office name", () => {
  const html = buildSuitableOfficesShareSectionHtml();
  assert.ok(html.includes('id="bankSuitableOfficesSearch"'));
  assert.ok(html.includes('id="bankSuitableOfficesDropdown"'));
  assert.ok(html.includes("role=\"combobox\""));
  assert.ok(html.includes("بحث باسم المكتب"));
  assert.ok(html.includes('placeholder="مثال: سلطان"'));
});

test("dropdown renders selectable office rows and empty query hint", () => {
  const rows = buildSuitableOfficeDropdownHtml([
    { officeId: "x", officeName: "مكتب سلطان", primaryNeighborhoodLabel: "عروة", tierLabel: "في الحي نفسه" }
  ], "");
  assert.ok(rows.includes("data-dropdown-office-id=\"x\""));
  assert.ok(rows.includes("مكتب سلطان"));
  const empty = buildSuitableOfficeDropdownHtml([], "سلطان");
  assert.ok(empty.includes("لا توجد نتائج"));
  assert.ok(empty.includes("سلطان"));
});

test("shell CSS centers suitable-office empty states", () => {
  const shell = readRepo("public", "index.html");
  assert.ok(shell.includes(".bank-suitable-empty"));
  assert.ok(shell.includes("text-align:center"));
  assert.ok(shell.includes(".bank-suitable-dropdown"));
});
