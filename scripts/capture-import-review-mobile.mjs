#!/usr/bin/env node
/**
 * Capture mobile screenshot of simplified import review — district field without dropdown.
 */
import { chromium } from "playwright";
import { parseFirebaseServiceAccountJson } from "./staging-credentials.mjs";

const STAGING_URL = process.env.STAGING_HOSTING_URL
  || "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const WORKER = "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const OFFICE_ID = "staging-logo-live-20260807";
const PHONE = "0511123456";
const PASSWORD = "StagingLogo9";
const OUT = "/opt/cursor/artifacts/import_simplified_review_district_mobile.png";

async function getCustomToken() {
  const initRes = await fetch(`${STAGING_URL}/__/firebase/init.json`);
  const { apiKey } = await initRes.json();
  const loginRes = await fetch(`${WORKER}/auth/phone-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: PHONE, password: PASSWORD, apiKey })
  });
  const body = await loginRes.json().catch(() => ({}));
  if (!loginRes.ok || !body.customToken) {
    throw new Error(`login failed ${loginRes.status}`);
  }
  return { customToken: body.customToken, apiKey };
}

async function main() {
  parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, "iaqar-ai-staging");
  const { customToken, apiKey } = await getCustomToken();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "ar-SA"
  });
  const page = await context.newPage();
  await page.goto(`${STAGING_URL}/?cachebust=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });

  await page.evaluate(async ({ customToken, apiKey }) => {
    await window.firebase.auth().signInWithCustomToken(customToken);
    window.IAQAR = window.IAQAR || {};
    window.IAQAR.office = {
      officeId: "staging-logo-live-20260807",
      city: "المدينة المنورة",
      brokerName: "وسيط تجريبي",
      officeName: "مكتب تجريبي"
    };
    void apiKey;
  }, { customToken, apiKey });

  await page.waitForTimeout(2000);

  const opened = await page.evaluate(async () => {
    const mod = await import("/js/import-advert-review-domain.js");
    const reviewMod = await import("/js/opportunity-review.js");
    const defaults = mod.buildImportSimplifiedReviewDefaults({
      opportunityKind: "OFFER",
      purpose: "SALE",
      propertyType: "فيلا",
      city: "المدينة المنورة",
      district: "الرانوناء",
      salePrice: 950000,
      area: 300,
      rooms: 5
    }, "فيلا للبيع في المدينة المنورة حي الرانوناء", { extended: { bathrooms: 3 } }, window.IAQAR.office);

    reviewMod.openOpportunityReview({
      fields: {
        opportunityKind: "OFFER",
        purpose: "SALE",
        propertyType: "فيلا",
        city: "المدينة المنورة",
        district: "الرانوناء"
      },
      sourceText: "فيلا للبيع في المدينة المنورة حي الرانوناء",
      reviewDefaults: defaults
    }, async () => {}, {
      title: "فرصة",
      importSimplifiedReview: true,
      importPlainLocationFields: true
    });
    return {
      title: document.getElementById("opportunityReviewTitle")?.textContent || "",
      hasOperationSearch: Boolean(document.querySelector('[data-search-for="operationTypeId"]')),
      hasDistrictPlain: Boolean(document.querySelector('[name="rawNeighborhoodText"]')),
      hasHybridList: Boolean(document.querySelector(".hybrid-suggestions"))
    };
  });

  console.log("review_state", JSON.stringify(opened, null, 2));
  const district = page.locator('[name="rawNeighborhoodText"]');
  await district.click();
  await district.fill("الران");
  await page.waitForTimeout(400);
  const listVisible = await page.locator(".hybrid-suggestions:not([hidden])").count();
  const datalistVisible = await page.locator("datalist").count();
  console.log("dropdown_count", { hybrid: listVisible, datalist: datalistVisible });
  await page.screenshot({ path: OUT, fullPage: false });
  await browser.close();
  if (opened.hasOperationSearch || opened.hasHybridList || listVisible > 0) {
    process.exitCode = 1;
    console.error("FAIL: catalog dropdown still present");
  } else {
    console.log(`PASS screenshot ${OUT}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
