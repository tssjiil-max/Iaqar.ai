import { test } from "node:test";
import assert from "node:assert/strict";
import { readRepositoryFile } from "./helpers/shell.mjs";

function hasValidInputFromValues(text, file) {
  return String(text || "").trim().length > 0 || Boolean(file);
}

test("hasValidInput: empty text and no file is invalid", () => {
  assert.equal(hasValidInputFromValues("", null), false);
  assert.equal(hasValidInputFromValues("   ", null), false);
});

test("hasValidInput: trimmed text is valid", () => {
  assert.equal(hasValidInputFromValues("ش", null), true);
  assert.equal(hasValidInputFromValues("  عرض  ", null), true);
});

test("hasValidInput: file alone is valid", () => {
  assert.equal(hasValidInputFromValues("", { name: "a.jpg" }), true);
});

test("add-opportunity.js wires syncExecuteButton on input", () => {
  const source = readRepositoryFile("public", "js", "add-opportunity.js");
  assert.ok(source.includes("function syncExecuteButton"));
  assert.ok(source.includes("addEventListener(\"input\", () => syncExecuteButton())"));
  assert.ok(source.includes("hasValidInputFromValues"));
});

test("index.html uses single-row grid for add opportunity", () => {
  const html = readRepositoryFile("public", "index.html");
  assert.ok(html.includes("grid-template-columns:minmax(0, 1fr) 96px"));
});
