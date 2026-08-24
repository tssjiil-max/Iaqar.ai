#!/usr/bin/env node
/**
 * Staging E2E: full bank card click opens correct opportunity detail.
 */
import { chromium } from "playwright";
import path from "node:path";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const STAGING = process.env.STAGING_HOSTING_URL
  || "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const PHONE = process.env.STAGING_PHONE || "0511123456";
const PASSWORD = process.env.STAGING_PASSWORD || "StagingLogo9";
const OUT = process.env.SCREENSHOT_DIR || "/opt/cursor/artifacts";
const COMMIT_SHA = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

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
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: "ar-SA" });
  const page = await context.newPage();
  await login(page);
  await openBankTab(page);

  await page.waitForSelector("[data-cv2-inbox-item][data-opportunity-id]", { timeout: 30000 });
  const cards = page.locator("[data-cv2-inbox-item][data-opportunity-id]");
  const count = await cards.count();
  console.log("bank cards", count);

  let incompleteId = "";
  let readyId = "";
  for (let i = 0; i < Math.min(count, 20); i++) {
    const card = cards.nth(i);
    const id = await card.getAttribute("data-opportunity-id");
    const badge = await card.locator(".bank-readiness-badge").textContent();
    if (!incompleteId && badge?.includes("تحتاج")) incompleteId = id;
    if (!readyId && badge?.includes("جاهزة")) readyId = id;
  }
  console.log("incompleteId", incompleteId, "readyId", readyId);

  if (incompleteId) {
    const card = page.locator(`[data-opportunity-id="${incompleteId}"]`);
    await card.screenshot({ path: path.join(OUT, "bank_card_incomplete_before_click.png") });
    await card.click({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(2000);
    const detailOpen = await page.locator("#opportunityBankDetail:not([hidden])").count();
    const activeId = await page.evaluate(() => window.IAQAR?.bankTestHooks ? true : true);
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? `${el.tagName}:${el.name || el.id}` : "";
    });
    const missingBanner = await page.locator(".bank-missing-banner").textContent();
    await page.screenshot({ path: path.join(OUT, "bank_incomplete_detail_open.png"), fullPage: false });
    console.log("incomplete detail open", detailOpen, "focus", focused, "banner", missingBanner?.slice(0, 80));
  }

  if (readyId) {
    await page.locator("#bankDetailClose").click().catch(() => {});
    await page.waitForTimeout(500);
    const card = page.locator(`[data-opportunity-id="${readyId}"]`);
    await card.screenshot({ path: path.join(OUT, "bank_card_ready_before_click.png") });
    await card.click({ position: { x: 30, y: 30 } });
    await page.waitForTimeout(2000);
    const lifecycle = await page.locator("#bankContactOutcomes, .bank-contact-section").count();
    await page.screenshot({ path: path.join(OUT, "bank_ready_detail_open.png"), fullPage: false });
    console.log("ready lifecycle sections", lifecycle);
  }

  const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
  const report = { commitSha: COMMIT_SHA, incompleteId, readyId, overflow };
  writeFileSync(path.join(OUT, "bank_card_click_staging_report.json"), JSON.stringify(report, null, 2));
  console.log("report", report);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
