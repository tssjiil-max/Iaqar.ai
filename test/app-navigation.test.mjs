import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import {
  resolveBackAction,
  shouldShowHeaderBack,
  resolveAccessBackTarget,
  topOverlayIdFromSnapshot
} from "../public/js/app-navigation-domain.js";
import { loadShell, readRepositoryFile, repositoryRoot } from "./helpers/shell.mjs";

test("resolveBackAction prioritizes overlays then bank detail then tabs", () => {
  assert.deepEqual(
    resolveBackAction({
      overlays: { opportunityReviewOverlay: true },
      mainTab: "opportunities",
      oppSubTab: "bank"
    }),
    { type: "close-overlay", id: "opportunityReviewOverlay" }
  );

  assert.deepEqual(
    resolveBackAction({
      overlays: {},
      bankDetailOpen: true,
      mainTab: "opportunities",
      oppSubTab: "bank"
    }),
    { type: "close-bank-detail" }
  );

  assert.deepEqual(
    resolveBackAction({
      overlays: {},
      bankDetailOpen: false,
      mainTab: "opportunities",
      oppSubTab: "bank"
    }),
    { type: "switch-opp-sub", sub: "add" }
  );

  assert.deepEqual(
    resolveBackAction({
      overlays: {},
      bankDetailOpen: false,
      mainTab: "opportunities",
      oppSubTab: "add"
    }),
    { type: "switch-main-tab", tab: "operations" }
  );
});

test("shouldShowHeaderBack is true on العروض والطلبات main tab", () => {
  assert.equal(shouldShowHeaderBack({
    overlays: {},
    bankDetailOpen: false,
    mainTab: "opportunities",
    oppSubTab: "add"
  }), true);
});

test("resolveAccessBackTarget keeps public intake on public office landing", () => {
  assert.equal(resolveAccessBackTarget("owner-intake", { publicOffice: true }), "public-office");
  assert.equal(resolveAccessBackTarget("client-intake", { publicOffice: true }), "public-office");
  assert.equal(resolveAccessBackTarget("owner-intake", { publicOffice: false }), "home");
});

test("topOverlayIdFromSnapshot respects overlay order", () => {
  assert.equal(
    topOverlayIdFromSnapshot({
      opportunityReviewOverlay: true,
      iaqarWorkflowOverlay: true,
      officeSettings: true
    }),
    "opportunityReviewOverlay"
  );
});

test("header back on العروض والطلبات returns to المهام اليومية", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const domain = await import(pathToFileURL(path.join(repositoryRoot, "public", "js", "app-navigation-domain.js")).href);
    context.window.IAQAR.navigationDomain = domain;
    const navSource = readFileSync(path.join(repositoryRoot, "public", "js", "app-navigation.js"), "utf8");
    context.window.eval(navSource);
    await new Promise((resolve) => {
      const wait = () => {
        if (context.window.IAQAR?.navigation?.updateBackButton) resolve();
        else setTimeout(wait, 10);
      };
      wait();
    });

    const { document } = context;
    document.getElementById("mainTabOpportunities").click();
    context.window.IAQAR.navigation.updateBackButton();
    const backBtn = document.getElementById("appNavBack");
    assert.equal(backBtn.hidden, false, "back button should show on العروض والطلبات");

    backBtn.click();
    assert.equal(document.getElementById("mainPanelOperations").hasAttribute("hidden"), false);
    assert.equal(document.getElementById("mainPanelOpportunities").hasAttribute("hidden"), true);
    assert.equal(backBtn.hidden, true);
  } finally {
    context.close();
  }
});

test("header back closes bank detail without history", async () => {
  const context = await loadShell({ bootSettingsModule: false });
  try {
    const navSource = readFileSync(path.join(repositoryRoot, "public", "js", "app-navigation.js"), "utf8");
    await import(pathToFileURL(path.join(repositoryRoot, "public", "js", "app-navigation-domain.js")).href);
    context.window.eval(navSource);
    context.window.IAQAR.isBankDetailOpen = () => true;
    context.window.IAQAR.closeBankDetailInternal = () => {
      context.window.__bankDetailClosed = true;
      return true;
    };
    await new Promise((resolve) => setTimeout(resolve, 0));

    const backBtn = context.document.getElementById("appNavBack");
    context.window.IAQAR.navigation.updateBackButton();
    assert.equal(backBtn.hidden, false);
    backBtn.click();
    assert.equal(context.window.__bankDetailClosed, true);
  } finally {
    context.close();
  }
});

test("appNavBack binds only one click handler", async () => {
  const dom = new JSDOM(`<!doctype html><button id="appNavBack" hidden></button>`, {
    url: "https://example.test/",
    runScripts: "dangerously"
  });
  const { window } = dom.window;
  window.IAQAR = { navigationDomain: await import(pathToFileURL(path.join(repositoryRoot, "public", "js", "app-navigation-domain.js")).href) };
  window.eval(readFileSync(path.join(repositoryRoot, "public", "js", "app-navigation.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  window.eval(readFileSync(path.join(repositoryRoot, "public", "js", "app-navigation.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(window.document.getElementById("appNavBack").dataset.boundBack, "1");
  dom.window.close();
});

test("shell includes canonical navigation modules", () => {
  const html = readRepositoryFile("public", "index.html");
  assert.ok(html.includes("js/app-navigation-domain.js"));
  assert.ok(html.includes('id="appNavBack"'));
});
