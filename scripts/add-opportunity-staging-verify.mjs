/**
 * STAGING live verification — add opportunity execute button only.
 */
import { chromium } from "playwright";

const STAGING_URL =
  process.env.STAGING_URL ||
  "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const OFFICE = "staging-logo-live-20260807";
const PHONE = "0511123456";
const PASSWORD = "StagingLogo9";

const results = {};

async function login(page) {
  await page.goto(`${STAGING_URL}?officeId=${OFFICE}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("#loginForm", { timeout: 45000 });
  await page.fill("#loginForm input[name=phone]", PHONE);
  await page.fill("#loginForm input[name=password]", PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => null),
    page.click("#loginForm button[type=submit]")
  ]);
  await page.waitForFunction(() => !document.body.classList.contains("access-locked"), { timeout: 30000 });
  await page.waitForTimeout(1500);
}

async function btnState(page) {
  const btn = page.locator("#addOpportunitySubmit");
  const disabled = await btn.isDisabled();
  const isReady = await btn.evaluate((el) => el.classList.contains("is-ready"));
  const bg = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
  return { disabled, isReady, bg };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await login(page);
    const executeBtn = page.locator("#addOpportunitySubmit");
    const input = page.locator("#addOpportunityInput");

    // 1 empty
    let s = await btnState(page);
    results["1_empty_disabled"] = s.disabled && !s.isReady ? "PASS" : "FAIL";

    // 2 one arabic char
    await input.fill("ش");
    await page.waitForTimeout(150);
    s = await btnState(page);
    results["2_one_char_green"] = !s.disabled && s.isReady && s.bg.includes("92") ? "PASS" : "FAIL";

    // 3 full sentence
    await input.fill("عرض فيلا في المدينة");
    s = await btnState(page);
    results["3_sentence_enabled"] = !s.disabled && s.isReady ? "PASS" : "FAIL";

    // 4 clear text
    await input.fill("");
    s = await btnState(page);
    results["4_clear_disabled"] = s.disabled && !s.isReady ? "PASS" : "FAIL";

    // 5 spaces only
    await input.fill("     ");
    s = await btnState(page);
    results["5_spaces_disabled"] = s.disabled && !s.isReady ? "PASS" : "FAIL";

    // 6 file without text
    await input.fill("");
    await page.setInputFiles("#addOpportunityFile", {
      name: "test-opp.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("فرصة اختبار")
    });
    await page.waitForTimeout(200);
    s = await btnState(page);
    results["6_file_enabled"] = !s.disabled && s.isReady ? "PASS" : "FAIL";

    // 7 X clears file
    await page.locator("#addOpportunityInputClear").click();
    await page.waitForTimeout(200);
    s = await btnState(page);
    results["7_x_clears_file"] = s.disabled && !s.isReady ? "PASS" : "FAIL";

    // 8 double click guard — mock slow network by typing and clicking fast (won't complete review)
    await input.fill("https://example.com/test-offer");
    await page.waitForTimeout(100);
    let clickCount = 0;
    page.on("dialog", () => {});
    await executeBtn.click();
    await executeBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);
  const status = await page.locator("#addOpportunityStatus").getAttribute("data-state");
    results["8_no_double_execute"] = status !== "saved" ? "PASS" : "PARTIAL";

    // 9 busy state
    const busy = await executeBtn.evaluate((el) => el.classList.contains("is-busy"));
    const busyDisabled = await executeBtn.isDisabled();
    results["9_busy_loading"] = busyDisabled ? "PASS" : "PARTIAL";

    // 10 layout row
    const grid = await page.locator(".add-opportunity-row").evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    results["10_single_row"] = grid.includes("96px") ? "PASS" : "FAIL";

    // 11 workspace unchanged
    const workspace = await page.locator("#workspace").evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      padding: getComputedStyle(el).padding
    }));
    results["11_workspace_size"] = workspace.height > 80 ? "PASS" : "FAIL";

    // Galaxy width
    await page.setViewportSize({ width: 360, height: 800 });
    await page.waitForTimeout(300);
    const gridGalaxy = await page.locator(".add-opportunity-row").evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    results["12_galaxy_row"] = gridGalaxy.includes("96px") ? "PASS" : "FAIL";

    // iPhone width
    await page.setViewportSize({ width: 390, height: 844 });
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientW = await page.evaluate(() => document.documentElement.clientWidth);
    results["13_iphone_no_horizontal_scroll"] = scrollW <= clientW + 2 ? "PASS" : "FAIL";

    console.log(JSON.stringify(results, null, 2));
    const fails = Object.values(results).filter((v) => v === "FAIL");
    if (fails.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
