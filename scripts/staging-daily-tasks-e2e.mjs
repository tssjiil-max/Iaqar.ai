/**
 * Staging E2E — المهام اليومية category drill-down and inline task panel.
 */
import { chromium } from "playwright";

const STAGING_URL =
  process.env.STAGING_HOSTING_URL ||
  "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const OFFICE_ID = "staging-logo-live-20260807";
const PHONE = "0511123456";
const PASSWORD = "StagingLogo9";
const OUT = "/opt/cursor/artifacts";

const CATEGORY_KEYS = [
  "incomplete",
  "ready",
  "follow_up",
  "matched",
  "responded",
  "archived"
];

const results = [];

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`PASS ${name}: ${detail}`);
}

function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.error(`FAIL ${name}: ${detail}`);
}

async function isDomHidden(page, selector) {
  return page.locator(selector).evaluate((el) => el.hidden);
}

async function login(page) {
  await page.goto(`${STAGING_URL}/?office=${encodeURIComponent(OFFICE_ID)}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000
  });
  await page.waitForSelector("#loginForm", { timeout: 120000 });
  await page.locator("#loginForm input[name='phone']").fill(PHONE);
  await page.locator("#loginForm input[name='password']").fill(PASSWORD);
  await page.locator("#loginForm button[type='submit']").click();
  await page.waitForFunction(() => !document.body.classList.contains("access-locked"), {
    timeout: 120000
  });
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome"
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  try {
    await login(page);
    await page.waitForSelector("[data-ops-category]", { timeout: 120000 });
    await page.waitForTimeout(1500);

    const version = await page.evaluate(async () => {
      const res = await fetch("/version.json", { cache: "no-store" });
      return res.json();
    });
    pass("staging_version", version?.shortSha || "");

    const tabText = await page.locator("#mainTabOperations").textContent();
    if (tabText?.includes("المهام اليومية")) pass("daily_tasks_tab");
    else fail("daily_tasks_tab", tabText || "");

    const listHidden = await isDomHidden(page, "#operationList");
    const taskPanelHidden = await isDomHidden(page, "#operationsTaskPanel");
    if (listHidden && taskPanelHidden) pass("no_list_before_category");
    else fail("no_list_before_category", `list=${listHidden} panel=${taskPanelHidden}`);

    const oldOps = await page.locator("#workspace .operation").count();
    if (oldOps === 0) pass("no_old_operation_accordion");
    else fail("no_old_operation_accordion", String(oldOps));

    const cardCount = await page.locator("[data-ops-category]").count();
    if (cardCount === 6) pass("six_category_cards", String(cardCount));
    else fail("six_category_cards", String(cardCount));

    await page.screenshot({ path: `${OUT}/staging_daily_tasks_categories.png`, fullPage: true });

    await page.locator("[data-ops-category=\"incomplete\"]").click();
    await page.waitForTimeout(800);
    const incompleteCount = await page.locator(".ops-task-card").count();
    pass("incomplete_has_tasks", String(incompleteCount));
    await page.locator("#operationsCategoryClose").click();
    await page.waitForTimeout(400);

    for (const key of CATEGORY_KEYS) {
      const btn = page.locator(`[data-ops-category="${key}"]`);
      if (!(await btn.count())) {
        fail(`category_open_${key}`, "missing button");
        continue;
      }
      await btn.click();
      await page.waitForTimeout(800);
      const gridHidden = await isDomHidden(page, "#operationsCategoryGrid");
      const closeVisible = await page.locator("#operationsCategoryClose").isVisible();
      if (gridHidden && closeVisible) pass(`category_drill_${key}`);
      else fail(`category_drill_${key}`, `gridHidden=${gridHidden} close=${closeVisible}`);

      const title = await page.locator("#operationsCategoryTitle").textContent();
      if (title && title.length > 0) pass(`category_title_${key}`, title.trim());
      else fail(`category_title_${key}`);

      await page.locator("#operationsCategoryClose").click();
      await page.waitForTimeout(400);
      const gridBack = await page.locator("#operationsCategoryGrid").isVisible();
      if (gridBack) pass(`category_close_${key}`);
      else fail(`category_close_${key}`);
    }

    const incompleteBtn = page.locator("[data-ops-category=\"ready\"]");
    if (await incompleteBtn.count()) {
      await incompleteBtn.click();
      await page.waitForTimeout(1000);
      const taskCards = await page.locator(".ops-task-card").count();
      if (taskCards > 0) {
        pass("ready_has_tasks", String(taskCards));
        const openBtn = page.locator("[data-ops-open-task]").first();
        await openBtn.click();
        try {
          await page.waitForSelector(
            "#operationsTaskPanel #bankUnifiedForm, #operationsTaskPanel .bank-workspace-section",
            { timeout: 20000 }
          );
          const panelVisible = await page.locator("#operationsTaskPanel").isVisible();
          pass("inline_task_panel_opens", `visible=${panelVisible}`);
          await page.screenshot({ path: `${OUT}/staging_daily_tasks_inline_panel.png`, fullPage: true });
        } catch (error) {
          fail("inline_task_panel_opens", String(error?.message || error));
        }
      } else {
        fail("ready_has_tasks", "no ready tasks for inline panel test");
      }
    }

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth > doc.clientWidth + 2;
    });
    if (!overflow) pass("no_horizontal_overflow");
    else fail("no_horizontal_overflow");
  } catch (error) {
    fail("unexpected", String(error?.message || error));
  } finally {
    await browser.close();
  }

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`TOTAL: ${results.length} PASS: ${passed} FAIL: ${failed}`);
  if (failed > 0) process.exit(1);
}

main();
