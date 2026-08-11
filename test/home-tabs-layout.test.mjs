import test from "node:test";
import assert from "node:assert/strict";
import { loadShell, readRepositoryFile } from "./helpers/shell.mjs";

const shellSource = readRepositoryFile("public", "index.html");

test("main tabs default to Operations with no stacked sections", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document } = context;
    assert.equal(document.getElementById("mainPanelOperations").hasAttribute("hidden"), false);
    assert.equal(document.getElementById("mainPanelOpportunities").hasAttribute("hidden"), true);
    assert.equal(document.getElementById("oppPanelAdd").hasAttribute("hidden"), false);
    assert.equal(document.getElementById("oppPanelBank").hasAttribute("hidden"), true);
    assert.ok(document.getElementById("workspace"));
    assert.ok(document.getElementById("addOpportunity"));
  } finally {
    context.close();
  }
});

test("switching tabs shows one content area at a time", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document } = context;
    document.getElementById("mainTabOpportunities").click();
    assert.equal(document.getElementById("mainPanelOperations").hasAttribute("hidden"), true);
    assert.equal(document.getElementById("mainPanelOpportunities").hasAttribute("hidden"), false);
    assert.equal(document.getElementById("oppPanelAdd").hasAttribute("hidden"), false);

    document.getElementById("oppTabBank").click();
    assert.equal(document.getElementById("oppPanelAdd").hasAttribute("hidden"), true);
    assert.equal(document.getElementById("oppPanelBank").hasAttribute("hidden"), false);

    document.getElementById("mainTabOperations").click();
    assert.equal(document.getElementById("mainPanelOperations").hasAttribute("hidden"), false);
    assert.equal(document.getElementById("mainPanelOpportunities").hasAttribute("hidden"), true);
  } finally {
    context.close();
  }
});

test("shell removes share cover UI and settings bank entry", () => {
  assert.equal(shellSource.includes("ترويسة عريضة للمشاركة"), false);
  assert.equal(shellSource.includes("id=\"openOpportunityBankBtn\""), false);
  assert.equal(shellSource.includes("id=\"opportunityBankSection\""), false);
  assert.ok(shellSource.includes("رابط صفحتك العامة لمشاركته مع العملاء والملاك."));
});
