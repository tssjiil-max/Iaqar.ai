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
    });
  }
  await page.waitForTimeout(500);
  const bankSub = page.locator("#oppTabBank:visible, button:visible:has-text('القائمة')").first();
  if (await bankSub.count()) await bankSub.click();
  await page.waitForTimeout(1500);
}

async function installEventBridge(page) {
  await page.evaluate(() => {
    window.__qaBankOperationalBridge = { openRequests: [], opened: [] };
    window.addEventListener("iaqar:open-operation", (event) => {
      window.__qaBankOperationalBridge.openRequests.push({ ...(event.detail || {}) });
    });
    window.addEventListener("iaqar:operation-opened", (event) => {
      window.__qaBankOperationalBridge.opened.push({ ...(event.detail || {}) });
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
  const action = card.locator('[data-opportunity-primary-action="review_match"]').first();
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
  const action = card.locator('[data-opportunity-primary-action="review_match"]').first();
  await action.scrollIntoViewIfNeeded();
  await action.screenshot({ path: path.join(OUT, `bank_${target.side}_match_action.png`) });
  await action.click();
  await page.waitForFunction(() => window.__qaBankOperationalBridge?.openRequests?.length > 0, null, { timeout: 5000 });
  await page.waitForFunction(() => window.__qaBankOperationalBridge?.opened?.length > 0, null, { timeout: 15000 });
  const events = await page.evaluate(() => ({
    openRequest: window.__qaBankOperationalBridge?.openRequests?.at(-1) || {},
    opened: window.__qaBankOperationalBridge?.opened?.at(-1) || {}
  }));
  const expectedId = target.operationId || target.matchId;
  const ok = String(events.openRequest.opportunityId || "") === target.opportunityId
    && String(events.openRequest.matchId || "") === TARGET_MATCH_ID
    && String(events.openRequest.operationId || "") === target.operationId
    && String(events.opened.recordId || "") === expectedId;
  if (!ok) throw new Error(`Wrong Match opened from ${target.reference}: ${JSON.stringify({ target, events })}`);
  return events;
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
    for (const [index, expected] of TARGETS.entries()) {
      const target = await inspectTargetCard(page, expected);
      if (target.matchId !== TARGET_MATCH_ID || !target.operationId || target.statusLine.includes("قيد المطابقة")) {
        throw new Error(`Match not reflected on ${expected.reference}: ${JSON.stringify(target)}`);
      }
      beforeRefresh.push(target);
      markStage(`open-${expected.side}-match`);
      openResults.push({ side: expected.side, ...(await clickAndVerify(page, target)) });
      if (index < TARGETS.length - 1) {
        markStage("return-to-bank");
        await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(5000);
        await openBankTab(page);
        await installEventBridge(page);
      }
    }

    markStage("refresh");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(5000);
    await openBankTab(page);
    const afterRefresh = [];
    for (const expected of TARGETS) {
      const target = await inspectTargetCard(page, expected);
      if (target.matchId !== TARGET_MATCH_ID || !target.operationId || target.statusLine.includes("قيد المطابقة")) {
        throw new Error(`Match lost after refresh on ${expected.reference}: ${JSON.stringify(target)}`);
      }
      afterRefresh.push(target);
    }

    await page.screenshot({ path: path.join(OUT, "bank_match_both_cards_after_refresh.png"), fullPage: true });
    const report = { commitSha: COMMIT_SHA, viewport: { width: 390, height: 900 }, targetMatchId: TARGET_MATCH_ID, beforeRefresh, openResults, afterRefresh };
    writeFileSync(path.join(OUT, "bank_card_click_staging_report.json"), JSON.stringify(report, null, 2));
    console.log("BANK_OPERATIONAL_ACTION_REPORT", JSON.stringify(report, null, 2));

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
