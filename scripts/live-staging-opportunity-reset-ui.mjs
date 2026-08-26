#!/usr/bin/env node
/**
 * Live UI verification after staging opportunity reset.
 * Office: staging-logo-live-20260807 only. No deploy.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const STAGING_URL = "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const OFFICE_ID = "staging-logo-live-20260807";
const PHONE = "0511123456";
const PASSWORD = "StagingLogo9";
const OUT = process.env.LIVE_E2E_OUT || "/opt/cursor/artifacts";

mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome"
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const evidence = { officeId: "", taskCards: -1, opportunityCards: -1, cache: {} };

  await page.goto(`${STAGING_URL}/?env=staging&officeId=${encodeURIComponent(OFFICE_ID)}&v=reset1`, {
    waitUntil: "domcontentloaded",
    timeout: 120000
  });
  await page.waitForSelector("#loginForm", { timeout: 120000 });
  await page.locator("#loginForm input[name='phone']").fill(PHONE);
  await page.locator("#loginForm input[name='password']").fill(PASSWORD);
  await page.locator("#loginForm button[type='submit']").click();
  await page.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 120000 });

  evidence.officeId = await page.evaluate(() => window.IAQAR?.office?.officeId || localStorage.getItem("iaqar.officeId") || "");
  if (evidence.officeId && evidence.officeId !== OFFICE_ID) {
    throw new Error(`STOP: UI officeId ${evidence.officeId} does not match ${OFFICE_ID}`);
  }

  await page.evaluate(async () => {
    try { localStorage.removeItem("iaqar.operationsItems"); } catch {}
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => String(key).startsWith("iaqar-")).map((key) => caches.delete(key)));
    } catch {}
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 120000 });
  await page.waitForTimeout(4000);

  const opsTab = page.locator("#mainTabOperations");
  if (await opsTab.count()) await opsTab.click();
  await page.waitForTimeout(1500);
  evidence.taskCards = await page.locator("[data-cv2-exec-task]").count();
  evidence.taskEmpty = await page.locator("[data-cv2-exec-empty]").count();
  evidence.taskText = ((await page.locator("#contentV2, #workspace").first().innerText().catch(() => "")) || "").slice(0, 800);
  const tasksShot = path.join(OUT, "staging_reset_daily_tasks_after_reload.png");
  await page.screenshot({ path: tasksShot, fullPage: false });

  const bankTab = page.locator("#mainTabOpportunities");
  if (await bankTab.count()) await bankTab.click();
  await page.waitForTimeout(2000);
  evidence.opportunityCards = await page.locator("[data-cv2-inbox-item][data-opportunity-id]").count();
  evidence.bankHint = ((await page.locator(".bank-query-hint, .bank-empty, #opportunityBank").first().innerText().catch(() => "")) || "").slice(0, 400);
  evidence.bankText = ((await page.locator("#mainPanelOpportunities, [data-legacy-content]").first().innerText().catch(() => "")) || "").slice(0, 800);
  const bankShot = path.join(OUT, "staging_reset_offers_requests_after_reload.png");
  await page.screenshot({ path: bankShot, fullPage: false });

  evidence.cache = await page.evaluate(async () => {
    const idb = indexedDB.databases ? await indexedDB.databases() : [];
    return {
      officeId: localStorage.getItem("iaqar.officeId") || "",
      cacheKeys: typeof caches !== "undefined" ? await caches.keys() : [],
      indexedDb: (idb || []).map((db) => db.name)
    };
  });

  const stale = evidence.opportunityCards > 0 || evidence.taskCards > 0;
  const report = {
    generatedAt: new Date().toISOString(),
    officeId: evidence.officeId || OFFICE_ID,
    evidence,
    shots: { tasks: tasksShot, bank: bankShot },
    stale,
    verdict: stale ? "RESET FAILED" : "STAGING OPPORTUNITY RESET VERIFIED"
  };
  writeFileSync(path.join(OUT, "staging-opportunity-reset-ui.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  if (stale) process.exit(2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
