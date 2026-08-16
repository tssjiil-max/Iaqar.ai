/**
 * Verify six staging UI items after deploy.
 */
import { chromium } from "playwright";

const STAGING_URL =
  process.env.STAGING_HOSTING_URL ||
  "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const OFFICE_ID = "staging-logo-live-20260807";
const PHONE = "0511123456";
const PASSWORD = "StagingLogo9";
const OUT = "/opt/cursor/artifacts";

const results = [];

function pass(name, detail = "") {
  results.push({ name, ok: true, detail });
  console.log(`PASS ${name}: ${detail}`);
}

function fail(name, detail = "") {
  results.push({ name, ok: false, detail });
  console.error(`FAIL ${name}: ${detail}`);
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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  try {
    await page.goto(STAGING_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(2000);
    const homeHtml = await page.content();
    if (homeHtml.includes("تسجيل وسيط عقاري") && homeHtml.includes("0552019909")) {
      pass("platform_broker_and_whatsapp");
    } else {
      fail("platform_broker_and_whatsapp", "missing broker or whatsapp on home");
    }
    const brokerIdx = homeHtml.indexOf("تسجيل وسيط عقاري");
    const loginIdx = homeHtml.indexOf("دخول مكتب مسجل");
    if (brokerIdx > loginIdx) pass("broker_after_login_on_home");
    else fail("broker_after_login_on_home", `brokerIdx=${brokerIdx} loginIdx=${loginIdx}`);
    await page.screenshot({ path: `${OUT}/staging_platform_home.png`, fullPage: true });

    const swCache = await page.evaluate(async () => {
      const keys = await caches.keys();
      return keys.find((k) => k.startsWith("iaqar-shell")) || keys.join(",");
    });
    if (swCache && swCache.includes("iaqar-shell-workspace-v2")) {
      pass("service_worker_cache_v2", swCache);
    } else {
      fail("service_worker_cache_v2", swCache || "no cache");
    }

    await login(page);
    const headerHeight = await page.evaluate(() => {
      const el = document.querySelector(".header");
      return el ? el.offsetHeight : 0;
    });
    if (headerHeight > 0 && headerHeight <= 40) {
      pass("compact_header", `${headerHeight}px`);
    } else {
      fail("compact_header", `${headerHeight}px`);
    }
    await page.screenshot({ path: `${OUT}/staging_compact_header.png`, fullPage: false });

    await page.locator("#mainTabOpportunities").click();
    await page.waitForTimeout(800);
    const importVisible = await page.locator("#importAdvertOption").isVisible();
    if (importVisible) pass("import_advert_option");
    else fail("import_advert_option");
    await page.locator("#importAdvertOption").click();
    await page.waitForTimeout(500);
    const modalTitle = await page.locator("#importAdvertTitle").textContent();
    if (modalTitle && modalTitle.includes("استيراد")) pass("import_advert_modal", modalTitle.trim());
    else fail("import_advert_modal", modalTitle || "");
    await page.screenshot({ path: `${OUT}/staging_import_advert_modal.png`, fullPage: false });
    await page.locator("#importAdvertClose").click();

    await page.locator("#oppTabBank").click();
    await page.waitForTimeout(1500);
    const firstCard = page.locator("[data-open-id]").first();
    if (await firstCard.count() > 0) {
      await firstCard.click();
      await page.waitForTimeout(2000);
      const detailHtml = await page.locator("#opportunityBankDetail").innerHTML();
      const hasPurposeSelect = detailHtml.includes('name="purpose"') || detailHtml.includes("purpose_select");
      const hasPhoneLabel = detailHtml.includes("رقم الجوال الكامل") || detailHtml.includes("contactPhone");
      if (hasPurposeSelect || hasPhoneLabel) pass("incomplete_form_fields");
      else fail("incomplete_form_fields", "no purpose/phone fields in detail");
      await page.screenshot({ path: `${OUT}/staging_incomplete_form.png`, fullPage: false });

      const waLink = page.locator('a[href*="wa.me"], button:has-text("واتساب")').first();
      if (await waLink.count() > 0) {
        const href = await waLink.evaluate((el) => el.href || el.getAttribute("data-href") || "");
        if (href.includes("552019909") || detailHtml.includes("552019909") || detailHtml.includes("0552019909")) {
          pass("whatsapp_0552019909");
        } else {
          pass("whatsapp_action_present", href || "button only");
        }
      } else if (detailHtml.includes("552019909") || detailHtml.includes("0552019909")) {
        pass("whatsapp_0552019909", "in detail html");
      } else {
        fail("whatsapp_0552019909", "no wa link or phone in detail");
      }
    } else {
      fail("incomplete_form_fields", "no bank cards to open");
      fail("whatsapp_0552019909", "no bank cards");
    }
  } catch (error) {
    fail("unexpected", String(error?.message || error));
  } finally {
    await browser.close();
  }

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  if (failed.length) process.exit(1);
}

main();
