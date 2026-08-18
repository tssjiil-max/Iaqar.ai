#!/usr/bin/env node
/**
 * Capture office card staging screenshots + computed styles from live DOM.
 */
import { chromium } from "playwright";
import path from "node:path";
import { writeFileSync } from "node:fs";

const STAGING = process.env.STAGING_HOSTING_URL
  || "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const PHONE = process.env.STAGING_PHONE || "0511123456";
const PASSWORD = process.env.STAGING_PASSWORD || "StagingLogo9";
const OUT = process.env.SCREENSHOT_DIR || "/opt/cursor/artifacts";

async function shot(page, name, fullPage = false) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage });
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

async function probeOfficeCard(page) {
  return page.evaluate(() => {
    const card = document.querySelector("section.card.license");
    const name = document.getElementById("officeDisplayName");
    const logoBtn = document.getElementById("officeSettingsBtn");
    const img = logoBtn?.querySelector("img");
    const labelLine = card?.querySelector(".office-line");
    const valueStrong = labelLine?.querySelector("strong");
    const services = document.getElementById("officeDisplaySpecialtiesWrap");
    const cs = (el) => el ? getComputedStyle(el) : null;
    const nameCs = cs(name);
    const labelCs = cs(labelLine);
    const valueCs = cs(valueStrong);
    const logoCs = cs(logoBtn);
    const imgCs = cs(img);
    const servicesCs = cs(services);
    const cardRect = card?.getBoundingClientRect();
    const logoRect = logoBtn?.getBoundingClientRect();
    const servicesRect = services?.getBoundingClientRect();
    const gapToServices = servicesRect && logoRect
      ? servicesRect.top - logoRect.bottom
      : null;
    return {
      card: card ? {
        tagName: card.tagName,
        id: card.id,
        classList: [...card.classList],
        fontFamily: cs(card)?.fontFamily
      } : null,
      name: name ? {
        tagName: name.tagName,
        text: name.textContent?.trim(),
        fontFamily: nameCs?.fontFamily,
        fontSize: nameCs?.fontSize,
        fontWeight: nameCs?.fontWeight,
        color: nameCs?.color,
        lineHeight: nameCs?.lineHeight
      } : null,
      label: labelLine ? {
        fontFamily: labelCs?.fontFamily,
        fontSize: labelCs?.fontSize,
        fontWeight: labelCs?.fontWeight,
        color: labelCs?.color
      } : null,
      value: valueStrong ? {
        text: valueStrong.textContent?.trim(),
        fontFamily: valueCs?.fontFamily,
        fontSize: valueCs?.fontSize,
        fontWeight: valueCs?.fontWeight,
        color: valueCs?.color
      } : null,
      logo: logoBtn ? {
        tagName: logoBtn.tagName,
        classList: [...logoBtn.classList],
        width: logoRect?.width,
        height: logoRect?.height,
        top: logoRect?.top,
        borderRadius: logoCs?.borderRadius
      } : null,
      img: img ? {
        width: imgCs?.width,
        height: imgCs?.height,
        objectFit: imgCs?.objectFit
      } : null,
      services: services ? {
        text: services.textContent?.trim(),
        fontFamily: servicesCs?.fontFamily,
        fontWeight: servicesCs?.fontWeight,
        color: servicesCs?.color,
        borderTop: servicesCs?.borderTopWidth
      } : null,
      layout: {
        cardHeight: cardRect?.height,
        gapLogoToServicesPx: gapToServices,
        servicesInsideCard: card?.contains(services)
      },
      officeNameSearch: document.body.innerText.includes("مكتب الوادي المبارك")
    };
  });
}

async function captureViewport(browser, width, label) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    locale: "ar-SA"
  });
  const page = await context.newPage();
  await login(page);
  await page.waitForSelector("section.card.license", { timeout: 15000 });
  await page.waitForTimeout(1000);
  const probe = await probeOfficeCard(page);
  console.log(`probe ${label}`, JSON.stringify(probe, null, 2));
  await shot(page, `office_card_after_${label}.png`);
  await context.close();
  return probe;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const probes = {};

  probes["390"] = await captureViewport(browser, 390, "390px");
  probes["768"] = await captureViewport(browser, 768, "768px");
  probes["1366"] = await captureViewport(browser, 1366, "1366px");

  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: "ar-SA" });
  const page = await context.newPage();
  await login(page);
  await page.waitForSelector("section.card.license");
  const computedShot = await probeOfficeCard(page);
  writeFileSync(path.join(OUT, "office_card_computed_styles.json"), JSON.stringify(computedShot, null, 2));
  // Highlight card for computed proof screenshot
  await page.evaluate(() => {
    const card = document.querySelector("section.card.license");
    if (card) card.style.outline = "2px solid #E56612";
  });
  await shot(page, "office_card_computed_proof.png");
  await context.close();
  await browser.close();

  writeFileSync(path.join(OUT, "office_card_probes_all.json"), JSON.stringify(probes, null, 2));
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
