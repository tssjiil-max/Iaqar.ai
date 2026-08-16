#!/usr/bin/env node
/**
 * Staging capture: Ready Opportunity Workspace UI.
 */
import { chromium } from "playwright";
import path from "node:path";
import { execSync } from "node:child_process";

const STAGING_URL = process.env.STAGING_HOSTING_URL
  || "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const OFFICE_ID = "staging-logo-live-20260807";
const PHONE = process.env.STAGING_PHONE || "0511123456";
const PASSWORD = process.env.STAGING_PASSWORD || "StagingLogo9";
const OUT = process.env.SCREENSHOT_DIR || "/opt/cursor/artifacts";
const COMMIT_SHA = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

async function getCustomToken() {
  const initRes = await fetch(`${STAGING_URL}/__/firebase/init.json`);
  const { apiKey } = await initRes.json();
  const loginRes = await fetch(`${WORKER}/auth/phone-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: PHONE, password: PASSWORD, apiKey })
  });
  const body = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok || !body.customToken) throw new Error(`login ${loginRes.status}`);
  return { customToken: body.customToken, apiKey };
}

async function login(page) {
  const { customToken } = await getCustomToken();
  await page.goto(`${STAGING_URL}/?office=${encodeURIComponent(OFFICE_ID)}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000
  });
  await page.waitForFunction(() => window.firebase && window.firebase.auth, { timeout: 30000 });
  await page.evaluate(
    async ({ customToken, officeId }) => {
      await window.firebase.auth().signInWithCustomToken(customToken);
      localStorage.setItem("iaqar.officeId", officeId);
    },
    { customToken, officeId: OFFICE_ID }
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 60000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 900 });
  await login(page);

  await page.evaluate(() => window.IAQAR?.openOpportunityBank?.());
  await page.waitForTimeout(1500);
  await page.locator("#mainTabOpportunities").click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator("#oppTabBank").click({ timeout: 10000 });
  await page.waitForTimeout(2000);

  await page.waitForSelector(".bank-row-card[data-opportunity-id]", { timeout: 30000 });
  const cards = page.locator(".bank-row-card[data-opportunity-id]");
  let readyId = "";
  let incompleteId = "";
  for (let i = 0; i < await cards.count(); i++) {
    const card = cards.nth(i);
    const id = await card.getAttribute("data-opportunity-id");
    const badge = await card.locator(".bank-readiness-badge").textContent();
    if (!incompleteId && badge?.includes("تحتاج")) incompleteId = id;
    if (!readyId && badge?.includes("جاهزة")) readyId = id;
  }

  if (incompleteId) {
    await page.locator(`[data-opportunity-id="${incompleteId}"]`).click();
    await page.waitForSelector("#opportunityBankDetail:not([hidden])", { timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, "workspace_needs_completion_mode.png"), fullPage: false });
  }

  if (readyId) {
    await page.evaluate(() => {
      const close = document.getElementById("bankDetailClose");
      if (close) close.click();
    });
    await page.waitForTimeout(500);
    await page.locator(`[data-opportunity-id="${readyId}"]`).click();
    await page.waitForSelector(".bank-workspace-layout", { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, "workspace_ready_mobile.png"), fullPage: false });
    const bestNext = await page.locator("#bankWorkspaceBestNext").textContent();
    console.log("bestNext", bestNext?.slice(0, 80));
    await page.locator('[data-workspace-action="review_matches"]').first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, "workspace_matches_section.png"), fullPage: false });
  }

  await page.setViewportSize({ width: 1366, height: 900 });
  if (readyId) {
    await page.evaluate((id) => window.IAQAR?.openOpportunityDetail?.(id), readyId);
    await page.waitForSelector(".bank-workspace-side", { timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(OUT, "workspace_desktop_actions_left.png"), fullPage: false });
  }

  const overflow390 = await page.setViewportSize({ width: 390, height: 900 });
  const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
  console.log(JSON.stringify({ commitSha: COMMIT_SHA, readyId, incompleteId, overflow }, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
