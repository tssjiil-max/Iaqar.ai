#!/usr/bin/env node
/**
 * Staging E2E: Bank operational actions stay inside the opportunity workspace.
 * The retired legacy "إدارة الفرصة" overlay must never open.
 */
import { chromium } from "playwright";
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const STAGING = process.env.STAGING_HOSTING_URL
  || "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const PHONE = process.env.STAGING_PHONE || "0511123456";
const PASSWORD = process.env.STAGING_PASSWORD || "StagingLogo9";
const OUT = process.env.SCREENSHOT_DIR || "/opt/cursor/artifacts";
const COMMIT_SHA = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const TARGET_MATCH_ID = "mat_c4f36c3f799dc8f4b159caee5fc2eece8c95";
const TARGETS = [
  { side: "offer", reference: "A-4542", opportunityId: "opp_intake_Pqa99R4ghA54O2zrhmNq" },
  { side: "request", reference: "A-4228", opportunityId: "opp_intake_4dhm2NxhJBblRLR28hKi" }
];
let currentStage = "startup";

function markStage(stage) {
  currentStage = stage;
  console.log(`BANK_CARD_CLICK_VERIFY_STAGE ${stage}`);
}

async function login(page) {
  await page.goto(STAGING, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  const loginBtn = page.locator('button[data-go="login"]');
  if (await loginBtn.count()) await loginBtn.click();
  await page.waitForTimeout(500);
  await page.locator('#loginForm input[name="phone"]').fill(PHONE);
  await page.locator('#loginForm input[name="password"]').fill(PASSWORD);
  await page.locator('#loginForm button[type="submit"]').click();
  await page.waitForTimeout(5000);
}

async function openBankTab(page) {
  const bankTab = page.locator("#mainTabOpportunities:visible, button:visible:has-text('العروض والطلبات')").first();
  if (await bankTab.count()) {
    await bankTab.click();
  } else {
    await page.evaluate(() => {
      if (/^#\/opportunities(?:-v2)?\//.test(String(location.hash || ""))) {
        history.replaceState(history.state, "", `${location.pathname}${location.search}`);
      }
      window.IAQAR?.homeTabs?.switchTo?.("opportunities");
      window.IAQAR?.openOpportunityBank?.();
    });
  }
  await page.waitForTimeout(500);
  const bankSub = page.locator("#oppTabBank:visible, button:visible:has-text('القائمة')").first();
  if (await bankSub.count()) await bankSub.click();
  await page.waitForTimeout(1500);
}

async function installEventBridge(page) {
  await page.evaluate(() => {
    window.__qaBankOperationalBridge = { openRequests: [], workflowActions: [] };
    window.addEventListener("iaqar:open-operation", (event) => {
      window.__qaBankOperationalBridge.openRequests.push({ ...(event.detail || {}) });
    });
    window.addEventListener("iaqar:workflow-action", (event) => {
      window.__qaBankOperationalBridge.workflowActions.push({ ...(event.detail || {}) });
    });
  });
}

async function inspectTargetCard(page, target) {
  const allCards = page.locator(`[data-cv2-inbox-item][data-opportunity-id="${target.opportunityId}"]`);
  await allCards.first().waitFor({ state: "attached", timeout: 30000 });
  const card = page.locator(`[data-cv2-inbox-item][data-opportunity-id="${target.opportunityId}"]:visible`).first();
  if (!await card.count()) {
    const hiddenTrace = await allCards.first().evaluate((node) => {
      const trace = [];
      for (let current = node; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        trace.push({ tag: current.tagName, id: current.id, className: current.className, hidden: current.hidden, display: style.display, visibility: style.visibility });
      }
      return trace;
    });
    throw new Error(`Target Bank card is hidden for ${target.reference}: ${JSON.stringify(hiddenTrace)}`);
  }
  const expectedMatchId = target.matchId || TARGET_MATCH_ID;
  const action = card.locator(`[data-opportunity-primary-action="review_match"][data-match-id="${expectedMatchId}"]`).first();
  await action.waitFor({ state: "visible", timeout: 30000 });
  return action.evaluate((button, expected) => {
    const article = button.closest("[data-cv2-inbox-item][data-opportunity-id]");
    return {
      ...expected,
      statusLine: article?.querySelector(".cv2-card-meta")?.textContent?.trim()
        || article?.textContent?.trim() || "",
      actionCode: button.getAttribute("data-opportunity-primary-action") || "",
      operationId: button.getAttribute("data-operation-id") || "",
      matchId: button.getAttribute("data-match-id") || ""
    };
  }, target);
}

async function clickAndVerify(page, target) {
  const card = page.locator(`[data-cv2-inbox-item][data-opportunity-id="${target.opportunityId}"]:visible`).first();
  const action = card.locator(`[data-opportunity-primary-action="review_match"][data-match-id="${target.matchId}"]`).first();
  await action.click();
  await page.waitForFunction((opportunityId) => {
    const detailsVisible = Boolean(document.querySelector('#contentV2[data-content-view="opportunity"]:not([hidden])'));
    return detailsVisible && String(location.hash || "").includes(opportunityId);
  }, target.opportunityId, { timeout: 15000 });
  await page.waitForTimeout(300);

  const events = await page.evaluate(() => ({
    openRequests: window.__qaBankOperationalBridge?.openRequests || [],
    workflowActions: window.__qaBankOperationalBridge?.workflowActions || [],
    opportunityDetailsVisible: Boolean(document.querySelector('#contentV2[data-content-view="opportunity"]:not([hidden])')),
    workflowVisible: Boolean(document.querySelector("#iaqarWorkflowOverlay:not([hidden])")),
    workflowTitle: document.getElementById("iaqarWorkflowTitle")?.textContent?.trim() || "",
    hash: String(location.hash || "")
  }));
  const ok = events.opportunityDetailsVisible
    && events.hash.includes(target.opportunityId)
    && !events.workflowVisible
    && events.workflowTitle !== "إدارة الفرصة"
    && events.openRequests.length === 0
    && events.workflowActions.length === 0;
  if (!ok) throw new Error(`Legacy opportunity manager opened from ${target.reference}: ${JSON.stringify({ target, events })}`);

  await openBankTab(page);
  await page.locator(`[data-cv2-inbox-item][data-opportunity-id="${target.opportunityId}"]:visible`).first().waitFor({ state: "visible", timeout: 10000 });
  return { ...events, returnedToBank: true };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  markStage("launch-browser");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: "ar-SA" });
  const page = await context.newPage();

  try {
    markStage("login");
    await login(page);
    markStage("open-bank-tab");
    await openBankTab(page);

    markStage("wait-bank-card");
    try {
      await page.waitForSelector("[data-cv2-inbox-item][data-opportunity-id]", { timeout: 30000 });
    } catch {
      markStage("retry-login");
      await login(page);
      await openBankTab(page);
      await page.waitForSelector("[data-cv2-inbox-item][data-opportunity-id]", { timeout: 30000 });
    }

    markStage("inspect-both-cards");
    await installEventBridge(page);
    const beforeRefresh = [];
    const openResults = [];
    for (const expected of TARGETS) {
      const target = await inspectTargetCard(page, expected);
      if (target.matchId !== TARGET_MATCH_ID || !target.operationId || target.statusLine.includes("قيد المطابقة")) {
        throw new Error(`Match not reflected on ${expected.reference}: ${JSON.stringify(target)}`);
      }
      beforeRefresh.push(target);
      markStage(`open-${expected.side}-opportunity`);
      openResults.push({ side: expected.side, ...(await clickAndVerify(page, target)) });
      await installEventBridge(page);
    }

    markStage("open-different-match");
    const differentAction = page.locator(`[data-opportunity-primary-action="review_match"][data-match-id]:not([data-match-id="${TARGET_MATCH_ID}"]):visible`).first();
    await differentAction.waitFor({ state: "visible", timeout: 30000 });
    const differentTarget = await differentAction.evaluate((button) => ({
      side: "different",
      reference: "different-match",
      opportunityId: button.closest("[data-opportunity-id]")?.getAttribute("data-opportunity-id") || "",
      operationId: button.getAttribute("data-operation-id") || "",
      matchId: button.getAttribute("data-match-id") || ""
    }));
    await page.waitForTimeout(1500);
    const differentMatch = await clickAndVerify(page, differentTarget);

    markStage("refresh");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);
    await openBankTab(page);
    await page.locator('[data-bank-action-filter="matches"]').click();
    const afterRefresh = [];
    for (const expected of TARGETS) {
      const target = await inspectTargetCard(page, expected);
      if (target.matchId !== TARGET_MATCH_ID || !target.operationId || target.statusLine.includes("قيد المطابقة")) {
        throw new Error(`Match lost after refresh on ${expected.reference}: ${JSON.stringify(target)}`);
      }
      afterRefresh.push(target);
    }
    await installEventBridge(page);
    const refreshOpen = await clickAndVerify(page, afterRefresh[0]);

    await page.screenshot({ path: path.join(OUT, "bank_match_both_cards_after_refresh.png"), fullPage: true });
    const report = { commitSha: COMMIT_SHA, viewport: { width: 390, height: 900 }, targetMatchId: TARGET_MATCH_ID, beforeRefresh, openResults, differentTarget, differentMatch, afterRefresh, refreshOpen };
    writeFileSync(path.join(OUT, "bank_card_click_staging_report.json"), JSON.stringify(report, null, 2));
    console.log("BANK_OPERATIONAL_ACTION_REPORT", JSON.stringify(report, null, 2));

    markStage("verified");
    console.log("BANK LEGACY OPPORTUNITY MANAGER RETIREMENT VERIFIED");
  } catch (err) {
    const failure = {
      ok: false,
      commitSha: COMMIT_SHA,
      stage: currentStage,
      error: String(err?.message || err),
      stack: err?.stack || null
    };
    writeFileSync(path.join(OUT, "bank_card_click_staging_report.json"), JSON.stringify(failure, null, 2));
    console.error("BANK_CARD_CLICK_VERIFY_FAILED", JSON.stringify(failure, null, 2));
    throw err;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
