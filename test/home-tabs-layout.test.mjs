import test from "node:test";
import assert from "node:assert/strict";
import { loadShell, readRepositoryFile } from "./helpers/shell.mjs";

const shellSource = readRepositoryFile("public", "index.html");

test("main tabs default to Operations with bank sub-tab ready under Opportunities", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document } = context;
    assert.equal(document.getElementById("mainPanelOperations").hasAttribute("hidden"), false);
    assert.equal(document.getElementById("mainPanelOpportunities").hasAttribute("hidden"), true);
    assert.equal(document.getElementById("oppPanelAdd").hasAttribute("hidden"), true);
    assert.equal(document.getElementById("oppPanelBank").hasAttribute("hidden"), false);
    assert.ok(document.getElementById("workspace"));
    assert.equal(document.getElementById("addOpportunity").hasAttribute("hidden"), true);
    assert.equal(document.getElementById("shellVoice").hasAttribute("hidden"), true);
  } finally {
    context.close();
  }
});

test("switching to daily tasks clears an opportunity hash so the compact list can show", () => {
  const source = readRepositoryFile("public", "js", "home-tabs.js");
  assert.match(source, /mainTabOperations/);
  assert.match(source, /opportunities\(\?:-v2\)\?/);
  assert.match(source, /history\?\.replaceState/);
});

test("switching tabs shows one content area at a time", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document } = context;
    document.getElementById("mainTabOpportunities").click();
    assert.equal(document.getElementById("mainPanelOperations").hasAttribute("hidden"), true);
    assert.equal(document.getElementById("mainPanelOpportunities").hasAttribute("hidden"), false);
    assert.equal(document.getElementById("oppPanelBank").hasAttribute("hidden"), false);

    document.getElementById("oppTabAdd").click();
    assert.equal(document.getElementById("oppPanelAdd").hasAttribute("hidden"), true);
    assert.equal(document.getElementById("oppPanelBank").hasAttribute("hidden"), false);
    assert.equal(document.getElementById("addOpportunity").hasAttribute("hidden"), false);
    assert.equal(document.getElementById("oppTabAdd").textContent.trim(), "استيراد فرصة");
    assert.equal(document.getElementById("oppTabBank").textContent.trim(), "القائمة");
    assert.equal(document.getElementById("shellVoice").hasAttribute("hidden"), true);

    document.getElementById("oppTabAdd").click();
    assert.equal(document.getElementById("addOpportunity").hasAttribute("hidden"), true);
    assert.equal(document.getElementById("oppTabAdd").textContent.trim(), "استيراد فرصة");
    assert.equal(document.getElementById("oppPanelBank").hasAttribute("hidden"), false);

    document.getElementById("mainTabOperations").click();
    assert.equal(document.getElementById("mainPanelOperations").hasAttribute("hidden"), false);
    assert.equal(document.getElementById("mainPanelOpportunities").hasAttribute("hidden"), true);
    assert.equal(document.getElementById("shellVoice").hasAttribute("hidden"), true);
  } finally {
    context.close();
  }
});

test("opportunities main nav and bank sub-tabs use approved labels", () => {
  assert.ok(shellSource.includes('id="mainTabOpportunities"'), "main opportunities tab exists");
  assert.match(shellSource, /id="mainTabOpportunities"[^>]*>العروض والطلبات<\/button>/);
  assert.ok(shellSource.includes('<h2 class="tab-panel-title">العروض والطلبات</h2>'));
  assert.ok(shellSource.includes("كل العروض والطلبات من جميع المصادر في قائمة واحدة"));
  assert.match(shellSource, /id="oppTabBank"[\s\S]*?>القائمة<\/button>/);
  assert.match(shellSource, /id="oppTabAdd"[\s\S]*?>استيراد فرصة<\/button>/);
  assert.equal(shellSource.includes(">+ إضافة فرصة</button>"), false);
  assert.equal(shellSource.includes(">+ إضافة عرض أو طلب</button>"), false);
  assert.match(shellSource, /id="addOpportunityVoicePanel"/);
  assert.ok(shellSource.includes('class="sub-tab is-active" id="oppTabBank"'));
  assert.ok(shellSource.includes('id="oppPanelBank" role="tabpanel"'));
  assert.equal(/id="oppPanelBank"[^>]*\shidden/.test(shellSource), false);
  assert.match(shellSource, /id="addOpportunity"[^>]*\shidden/);
  assert.equal(shellSource.includes('id="addOpportunityTitle"'), false);
  assert.equal(shellSource.includes('>الفرص</button>'), false, "legacy main tab label must be removed");
  assert.equal((shellSource.match(/id="mainTabOperations"/g) || []).length, 1);
  assert.equal((shellSource.match(/id="mainTabOpportunities"/g) || []).length, 1);
  assert.equal(shellSource.includes('id="mainTabIncoming"'), false);
  assert.equal(shellSource.includes(">الوارد</button>"), false);
  assert.equal(shellSource.includes(">التجهيز</button>"), false);
});

test("offers add composer starts closed and does not duplicate the tab label", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const { document } = context;
    document.getElementById("mainTabOpportunities").click();
    const composer = document.getElementById("addOpportunity");
    const addBtn = document.getElementById("oppTabAdd");
    assert.equal(composer.hasAttribute("hidden"), true);
    assert.equal(addBtn.getAttribute("aria-expanded"), "false");
    assert.equal(addBtn.textContent.trim(), "استيراد فرصة");
    assert.equal(composer.querySelector("h2"), null);
    assert.equal(document.getElementById("shellVoice").hasAttribute("hidden"), true);
    assert.ok(document.getElementById("addOpportunityInput"));
    assert.ok(document.getElementById("addOpportunityPaperclip"));
    assert.ok(document.getElementById("addOpportunityMic"));
    assert.ok(document.getElementById("addOpportunitySubmit"));
    assert.ok(document.getElementById("addOpportunityFile"));
  } finally {
    context.close();
  }
});

test("voice recording labels stay in the intake modules", () => {
  const addOpp = readRepositoryFile("public", "js", "add-opportunity.js");
  const voiceUi = readRepositoryFile("public", "js", "gemini-voice-intake-ui.js");
  assert.match(addOpp, /startLabel: "إضافة فرصة بالصوت"/);
  assert.match(voiceUi, /startLabel = "إضافة فرصة بالصوت"/);
});

test("shell removes share cover UI and settings bank entry", () => {
  assert.equal(shellSource.includes("ترويسة عريضة للمشاركة"), false);
  assert.equal(shellSource.includes("id=\"openOpportunityBankBtn\""), false);
  assert.equal(shellSource.includes("id=\"opportunityBankSection\""), false);
  assert.ok(shellSource.includes("shareOfficeLinkCardBtn"));
  assert.equal(shellSource.includes("copyOfficeLinkBtn"), false);
});
