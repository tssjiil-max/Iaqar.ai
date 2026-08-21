import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildOfficeCooperationPanelHtml,
  buildOfficeSearchResultsHtml
} from "../public/js/suitable-offices-ui.js";

const root = path.dirname(fileURLToPath(import.meta.url));

function readRepo(...parts) {
  return readFileSync(path.join(root, "..", ...parts), "utf8");
}

test("cooperation panel exposes unified search and send flow", () => {
  const html = buildOfficeCooperationPanelHtml();
  assert.ok(html.includes('id="bankCoopOfficesSearch"'));
  assert.ok(html.includes('placeholder="ابحث باسم المكتب"'));
  assert.ok(html.includes('id="bankCoopMessage"'));
  assert.ok(html.includes('placeholder="رسالة للمكاتب المستلمة"'));
  assert.ok(html.includes('id="bankCoopSelectedChips"'));
});

test("search results render only when query exists", () => {
  const rows = buildOfficeSearchResultsHtml([
    { officeId: "x", officeName: "مكتب سلطان", primaryNeighborhoodLabel: "عروة", city: "مكة" }
  ], "سلطان");
  assert.ok(rows.includes("data-pick-office-id=\"x\""));
  assert.ok(rows.includes("مكتب سلطان"));
  const empty = buildOfficeSearchResultsHtml([], "سلطان");
  assert.ok(empty.includes("لا توجد نتائج"));
  assert.equal(buildOfficeSearchResultsHtml([], ""), "");
});

test("shell CSS includes compact cooperation styles", () => {
  const shell = readRepo("public", "index.html");
  assert.ok(shell.includes(".bank-coop-chips"));
  assert.ok(shell.includes(".bank-coop-privacy-note"));
  assert.ok(shell.includes("text-align:center"));
});
