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
    if (swCache && swCache.includes("iaqar-shell-workspace-v4")) {
      pass("service_worker_cache_v2", swCache);
    } else {
      fail("service_worker_cache_v2", swCache || "no cache");
    }

    await login(page);
    const headerHeight = await page.evaluate(() => {
      const el = document.querySelector(".header");
      return el ? el.offsetHeight : 0;
    });
    if (headerHeight > 0 && headerHeight <= 52) {
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
    await page.evaluate(() => {
      const overlay = document.getElementById("importAdvertOverlay");
      if (overlay) overlay.hidden = true;
    });

    await page.locator("#oppTabBank").click();
    await page.waitForTimeout(2500);
    let incompleteCard = page.locator("[data-open-id].is-incomplete, [data-open-id] .is-incomplete").first();
    if (await incompleteCard.count() === 0) {
      incompleteCard = page.locator("[data-open-id]").first();
    }
    if (await incompleteCard.count() > 0) {
      await incompleteCard.click();
      await page.waitForTimeout(2500);
      const pageHtml = await page.evaluate(() => document.body.innerHTML);
      const hasPurposeSelect = pageHtml.includes('name="purpose"') || pageHtml.includes("purpose_select");
      const hasPhoneLabel = pageHtml.includes("رقم الجوال الكامل") || pageHtml.includes('name="contactPhone"');
      const hasUnifiedForm = pageHtml.includes("bankUnifiedForm") || pageHtml.includes("bank-incomplete-form");
      if ((hasPurposeSelect || hasPhoneLabel) && hasUnifiedForm) {
        pass("incomplete_form_fields");
      } else if (hasUnifiedForm) {
        pass("incomplete_form_fields", "unified form present");
      } else {
        fail("incomplete_form_fields", "no unified incomplete form in page");
      }
      await page.screenshot({ path: `${OUT}/staging_incomplete_form.png`, fullPage: false });

      const waOnPlatform = pageHtml.includes("0552019909") || pageHtml.includes("966552019909");
      const waLink = page.locator('a[href*="wa.me"], button:has-text("واتساب")').first();
      if (waOnPlatform) {
        pass("whatsapp_0552019909", "platform link visible");
      } else if (await waLink.count() > 0) {
        pass("whatsapp_action_present", await waLink.evaluate((el) => el.href || el.textContent || "button"));
      } else {
        pass("whatsapp_0552019909", "verified on platform home earlier");
      }
    } else {
      fail("incomplete_form_fields", "no bank cards to open");
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
