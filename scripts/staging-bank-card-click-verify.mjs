#!/usr/bin/env node
/**
 * Staging E2E: a Bank operational action must open the same linked item
 * in Operations Center. This intentionally tests the operational button,
 * not the card detail modal.
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
  const bankTab = page.locator("#mainTabOpportunities, button:has-text('العروض والطلبات')").first();
  if (await bankTab.count()) await bankTab.click();
  await page.waitForTimeout(500);
  const bankSub = page.locator("#oppTabBank, button:has-text('القائمة')").first();
  if (await bankSub.count()) await bankSub.click();
  await page.waitForTimeout(1500);
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
    await page.waitForSelector("[data-cv2-inbox-item][data-opportunity-id]", { timeout: 30000 });

    markStage("install-event-bridge");
    await page.evaluate(() => {
      window.__qaBankOperationalBridge = { openRequests: [], opened: [] };
      window.addEventListener("iaqar:open-operation", (event) => {
        window.__qaBankOperationalBridge.openRequests.push({ ...(event.detail || {}) });
      });
      window.addEventListener("iaqar:operation-opened", (event) => {
        window.__qaBankOperationalBridge.opened.push({ ...(event.detail || {}) });
      });
    });

    markStage("find-linked-action");
    const linkedActions = page.locator(
      '[data-opportunity-primary-action][data-operation-id]:not([data-operation-id=""]), '
      + '[data-opportunity-primary-action][data-match-id]:not([data-match-id=""])'
    );
    const actionCount = await linkedActions.count();
    if (!actionCount) {
      const diagnostics = await page.locator("[data-opportunity-primary-action]").evaluateAll((buttons) => buttons.map((button) => ({
        actionCode: button.getAttribute("data-opportunity-primary-action") || "",
        operationId: button.getAttribute("data-operation-id") || "",
        matchId: button.getAttribute("data-match-id") || "",
        opportunityId: button.closest("[data-opportunity-id]")?.getAttribute("data-opportunity-id") || ""
      })));
      throw new Error(`No linked Bank operational action found on Staging: ${JSON.stringify(diagnostics)}`);
    }

    let action = linkedActions.first();
    const reviewMatch = page.locator(
      '[data-opportunity-primary-action="review_match"][data-operation-id]:not([data-operation-id=""]), '
      + '[data-opportunity-primary-action="review_match"][data-match-id]:not([data-match-id=""])'
    ).first();
    if (await reviewMatch.count()) action = reviewMatch;

    const target = await action.evaluate((button) => {
      const card = button.closest("[data-cv2-inbox-item][data-opportunity-id]");
      return {
        actionCode: button.getAttribute("data-opportunity-primary-action") || "",
        operationId: button.getAttribute("data-operation-id") || "",
        matchId: button.getAttribute("data-match-id") || "",
        opportunityId: card?.getAttribute("data-opportunity-id") || ""
      };
    });

    markStage("resolve-expected-operation");
    const expected = await page.evaluate(({ operationId, matchId }) => {
      const items = Array.isArray(window.IAQAR?.operationsItems) ? window.IAQAR.operationsItems : [];
      const item = items.find((entry) =>
        (operationId && (entry?.id === operationId || entry?.recordId === operationId))
        || (matchId && entry?.matchId === matchId)
      );
      return item ? {
        id: String(item.id || ""),
        recordId: String(item.recordId || item.id || ""),
        recordType: String(item.recordType || ""),
        matchId: String(item.matchId || "")
      } : null;
    }, target);

    markStage("click-linked-action");
    await action.scrollIntoViewIfNeeded();
    await action.screenshot({ path: path.join(OUT, "bank_operational_action_before_click.png") });
    await action.click();

    markStage("wait-open-operation-event");
    await page.waitForFunction(() => window.__qaBankOperationalBridge?.openRequests?.length > 0, null, { timeout: 5000 });
    markStage("wait-operation-opened-event");
    await page.waitForFunction(() => window.__qaBankOperationalBridge?.opened?.length > 0, null, { timeout: 15000 });

    markStage("validate-result");
    const events = await page.evaluate(() => ({
      openRequests: window.__qaBankOperationalBridge?.openRequests || [],
      opened: window.__qaBankOperationalBridge?.opened || []
    }));
    const openRequest = events.openRequests.at(-1) || {};
    const opened = events.opened.at(-1) || {};

    const requestMatches = (
      String(openRequest.operationId || "") === target.operationId
      && String(openRequest.matchId || "") === target.matchId
      && String(openRequest.opportunityId || "") === target.opportunityId
      && String(openRequest.id || "") === target.operationId
    );

    const expectedOpenedId = String(expected?.recordId || target.operationId || target.matchId || "");
    const openedMatches = Boolean(expectedOpenedId)
      && String(opened.recordId || "") === expectedOpenedId;

    const operationsVisible = await page.evaluate(() => {
      const panel = document.getElementById("mainPanelOperations");
      if (!panel) return false;
      const style = window.getComputedStyle(panel);
      return !panel.hidden && style.display !== "none" && style.visibility !== "hidden";
    });

    await page.screenshot({ path: path.join(OUT, "bank_operational_action_after_click.png"), fullPage: false });

    const report = {
      commitSha: COMMIT_SHA,
      target,
      expected,
      openRequest,
      opened,
      requestMatches,
      openedMatches,
      operationsVisible
    };
    writeFileSync(path.join(OUT, "bank_card_click_staging_report.json"), JSON.stringify(report, null, 2));
    console.log("BANK_OPERATIONAL_ACTION_REPORT", JSON.stringify(report, null, 2));

    if (!requestMatches) {
      throw new Error(`Bank action emitted the wrong open-operation payload: ${JSON.stringify(report)}`);
    }
    if (!openedMatches) {
      throw new Error(`Operations Center did not open the linked operation: ${JSON.stringify(report)}`);
    }
    if (!operationsVisible) {
      throw new Error(`Operations Center did not become visible: ${JSON.stringify(report)}`);
    }

    markStage("verified");
    console.log("BANK OPERATIONAL ACTION VERIFIED");
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
