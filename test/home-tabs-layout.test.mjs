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

test("opportunities main nav and bank sub-tabs use approved labels", () => {
  assert.ok(shellSource.includes('id="mainTabOpportunities"'), "main opportunities tab exists");
  assert.match(shellSource, /id="mainTabOpportunities"[^>]*>بنك الفرص<\/button>/);
  assert.ok(shellSource.includes('<h2 class="tab-panel-title">بنك الفرص</h2>'));
  assert.match(shellSource, /id="oppTabAdd"[^>]*>\+ إضافة فرصة<\/button>/);
  assert.match(shellSource, /id="oppTabBank"[^>]*>البنك<\/button>/);
  assert.equal(shellSource.includes('>الفرص</button>'), false, "legacy main tab label must be removed");
});

test("shell removes share cover UI and settings bank entry", () => {
  assert.equal(shellSource.includes("ترويسة عريضة للمشاركة"), false);
  assert.equal(shellSource.includes("id=\"openOpportunityBankBtn\""), false);
  assert.equal(shellSource.includes("id=\"opportunityBankSection\""), false);
  assert.ok(shellSource.includes("shareOfficeLinkCardBtn"));
  assert.equal(shellSource.includes("copyOfficeLinkBtn"), false);
});
