#!/usr/bin/env node
/**
 * Staging E2E: office card image size + neighborhood specialization save/display.
 */
import { chromium } from "playwright";
import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const STAGING = process.env.STAGING_HOSTING_URL
  || "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const PHONE = process.env.STAGING_PHONE || "0511123456";
const PASSWORD = process.env.STAGING_PASSWORD || "StagingLogo9";
const OUT = process.env.SCREENSHOT_DIR || "/opt/cursor/artifacts";
const PICKS = ["الرانوناء", "عروة", "العزيزية"];

const COMMIT_SHA = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log("saved", file);
  return file;
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

async function probeCard(page) {
  return page.evaluate(() => {
    const logo = document.getElementById("officeSettingsBtn");
    const img = logo?.querySelector("img");
    const logoCs = logo ? getComputedStyle(logo) : null;
    const imgCs = img ? getComputedStyle(img) : null;
    const rect = logo?.getBoundingClientRect();
    const chips = Array.from(document.querySelectorAll("#officeDisplayNeighborhoods .office-neighborhood-chip"))
      .map((n) => n.textContent?.trim());
    const services = document.getElementById("officeDisplaySpecialtiesWrap");
    const servicesRect = services?.getBoundingClientRect();
    const gap = rect && servicesRect ? servicesRect.top - rect.bottom : null;
    return {
      officeName: document.getElementById("officeDisplayName")?.textContent?.trim(),
      logo: {
        selector: "#officeSettingsBtn.office-logo",
        width: rect?.width,
        height: rect?.height,
        borderRadius: logoCs?.borderRadius,
        objectFit: imgCs?.objectFit
      },
      chips,
      gapLogoToServices: gap,
      bodyOverflow: document.body.scrollWidth > window.innerWidth
    };
  });
}

async function verifyDeployedSha(page) {
  const runtimeSha = await page.evaluate(async () => {
    try {
      const res = await fetch("/js/runtime-config.js", { cache: "no-store" });
      const text = await res.text();
      const m = text.match(/commitSha["']?\s*[:=]\s*["']([a-f0-9]+)/i);
      return m?.[1] || text.slice(0, 120);
    } catch (e) {
      return String(e);
    }
  });
  const indexHash = await page.evaluate(async () => {
    const html = await (await fetch("/", { cache: "no-store" })).text();
    return html.includes("officeNeighborhoodSearch") && html.includes("clamp(112px,29vw,124px)");
  });
  return { runtimeSha, indexHash };
}

async function pickNeighborhood(page, name) {
  const input = page.locator("#officeNeighborhoodSearch");
  await input.click();
  await input.fill("");
  const query = name.length > 4 ? name.slice(0, 4) : name.slice(0, 2);
  await input.fill(query);
  await page.waitForTimeout(600);
  const scoped = page.locator(`[data-suggest-for="officeNeighborhoodSearch"] button[data-pick="${name}"]`).first();
  if (await scoped.count()) {
    await scoped.click({ force: true });
    await page.waitForTimeout(200);
    return true;
  }
  const fuzzy = page.locator('[data-suggest-for="officeNeighborhoodSearch"] button').filter({ hasText: name }).first();
  if (await fuzzy.count()) {
    await fuzzy.click({ force: true });
    await page.waitForTimeout(200);
    return true;
  }
  return false;
}

async function editorChipCount(page) {
  return page.locator("#officeNeighborhoodChips .office-neighborhood-editor-chip").count();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: "ar-SA" });
  const page = await context.newPage();

  await login(page);
  await page.waitForSelector("section.card.license");
  const deploy = await verifyDeployedSha(page);
  console.log("deploy check", deploy, "local commit", COMMIT_SHA);

  const beforeProbe = await probeCard(page);
  console.log("before probe", JSON.stringify(beforeProbe, null, 2));
  await shot(page, "office_neighborhood_card_before_save.png");

  await page.locator("#officeSettingsBtn").click();
  await page.waitForSelector("#officeNeighborhoodSearch", { timeout: 10000 });

  const cityInput = page.locator("#officeCityInput");
  const currentCity = await cityInput.inputValue();
  if (currentCity !== "المدينة المنورة") {
    await cityInput.fill("المدينة المنورة");
    await cityInput.dispatchEvent("change");
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => {
    if (typeof window.IAQAR?.officeSettingsTestHooks?.readNeighborhoodsFromForm === "function") {
      // trigger refresh after city change via DOM
      document.getElementById("officeCityInput")?.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await page.waitForTimeout(400);

  for (const name of PICKS) {
    const ok = await pickNeighborhood(page, name);
    console.log("picked", name, ok, "editor chips", await editorChipCount(page));
    await page.waitForTimeout(300);
  }

  console.log("editor chips before save", await editorChipCount(page));
  await shot(page, "office_neighborhood_settings_selector.png");
  await page.locator("#saveOfficeSettingsBtn").click();
  await page.waitForTimeout(6000);
  const note = await page.locator("#officeSettingsNote").textContent();
  console.log("save note", note);

  const afterProbe = await probeCard(page);
  console.log("after probe", JSON.stringify(afterProbe, null, 2));

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const reloadProbe = await probeCard(page);
  console.log("reload probe", JSON.stringify(reloadProbe, null, 2));

  await shot(page, "office_neighborhood_card_after_reload.png");
  await page.locator("section.card.license").screenshot({
    path: path.join(OUT, "office_neighborhood_card_full_390.png")
  });

  const report = {
    commitSha: COMMIT_SHA,
    stagingUrl: STAGING,
    deploy,
    beforeProbe,
    afterProbe,
    reloadProbe
  };
  writeFileSync(path.join(OUT, "office_neighborhood_staging_report.json"), JSON.stringify(report, null, 2));

  await browser.close();
  console.log("done", report);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
