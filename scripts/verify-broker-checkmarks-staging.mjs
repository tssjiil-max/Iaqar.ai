#!/usr/bin/env node
/**
 * Verify broker action checkmarks in opportunity management modal on staging.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const STAGING = process.env.STAGING_HOSTING_URL
  || "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const PHONE = process.env.STAGING_PHONE || "0511123456";
const PASSWORD = process.env.STAGING_PASSWORD || "StagingLogo9";
const OUT = process.env.SCREENSHOT_DIR || "/opt/cursor/artifacts";

async function login(page) {
  await page.goto(STAGING, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  const loginBtn = page.locator('button[data-go="login"]');
  if (await loginBtn.count()) await loginBtn.click();
  await page.waitForTimeout(400);
  await page.locator("#loginForm input[name=\"phone\"]").fill(PHONE);
  await page.locator("#loginForm input[name=\"password\"]").fill(PASSWORD);
  await page.locator("#loginForm button[type=\"submit\"]").click();
  await page.waitForTimeout(4500);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const report = { checks: [], errors: [] };

  await login(page);
  await page.waitForFunction(() => window.IAQAR?.office?.officeId, { timeout: 30000 });

  let opportunityId = "";
  try {
    opportunityId = await page.evaluate(async () => {
      const runtime = window.IAQAR?.office;
      const fb = window.firebase;
      const user = fb?.auth?.()?.currentUser;
      if (!runtime?.officeId || !user) return "";
      const snap = await runtime.db.collection("offices").doc(runtime.officeId)
        .collection("opportunities").limit(20).get();
      const row = snap.docs.find((doc) => {
        const data = doc.data() || {};
        return data.lifecycleStatus === "FOLLOW_UP" || data.followUp?.at;
      }) || snap.docs[0];
      return row?.id || "";
    });
  } catch (error) {
    report.errors.push(String(error?.message || error));
  }

  if (!opportunityId) {
    await browser.close();
    writeFileSync(path.join(OUT, "broker_checkmarks_report.json"), JSON.stringify(report, null, 2));
    throw new Error(`no opportunity available: ${report.errors.join("; ")}`);
  }
  report.opportunityId = opportunityId;

  await page.evaluate((id) => window.IAQAR.openOpportunityManagement(id, { focusFollowUp: true }), opportunityId);
  await page.waitForSelector("#iaqarWorkflowOverlay:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(1200);

  const beforeClick = await page.evaluate(() => {
    const btn = document.querySelector('[data-broker-action="followup:whatsapp:owner"]');
    const confirmed = document.querySelector('[data-broker-action="followup:outcome:confirmed"]');
    return {
      bridgeLoaded: Boolean(window.IAQAR?.brokerActionProgress?.applyBrokerActionMarks),
      ownerDone: btn?.classList.contains("is-action-done") || false,
      confirmedDone: confirmed?.classList.contains("is-action-done") || false,
      ownerExists: Boolean(btn),
      confirmedExists: Boolean(confirmed)
    };
  });
  report.checks.push({ name: "bridge_loaded", ok: beforeClick.bridgeLoaded, value: beforeClick });
  report.checks.push({ name: "persisted_owner_mark_on_open", ok: beforeClick.ownerDone, value: beforeClick.ownerDone });
  report.checks.push({ name: "persisted_confirmed_mark_on_open", ok: beforeClick.confirmedDone, value: beforeClick.confirmedDone });

  await page.screenshot({ path: path.join(OUT, "broker_checkmarks_on_open.png") });

  const noResponseBtn = page.locator('[data-broker-action="followup:outcome:no_response"]');
  if (await noResponseBtn.count()) {
    await noResponseBtn.click();
    await page.waitForTimeout(2500);
    const afterClick = await page.evaluate(() => {
      const btn = document.querySelector('[data-broker-action="followup:outcome:no_response"]');
      return btn?.classList.contains("is-action-done") || false;
    });
    report.checks.push({ name: "no_response_mark_after_click", ok: afterClick, value: afterClick });
    await page.screenshot({ path: path.join(OUT, "broker_checkmarks_after_no_response.png") });
  }

  await page.locator('[data-ui-action="close-overlay"]').click();
  await page.waitForTimeout(800);
  await page.evaluate((id) => window.IAQAR.openOpportunityManagement(id, { focusFollowUp: true }), opportunityId);
  await page.waitForSelector("#iaqarWorkflowOverlay:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(1200);

  const afterReopen = await page.evaluate(() => {
    const owner = document.querySelector('[data-broker-action="followup:whatsapp:owner"]');
    const noResp = document.querySelector('[data-broker-action="followup:outcome:no_response"]');
    return {
      ownerDone: owner?.classList.contains("is-action-done") || false,
      noResponseDone: noResp?.classList.contains("is-action-done") || false
    };
  });
  report.checks.push({ name: "owner_mark_after_reopen", ok: afterReopen.ownerDone, value: afterReopen });
  report.checks.push({ name: "no_response_persisted_after_reopen", ok: afterReopen.noResponseDone, value: afterReopen.noResponseDone });
  await page.screenshot({ path: path.join(OUT, "broker_checkmarks_after_reopen.png") });

  await browser.close();
  writeFileSync(path.join(OUT, "broker_checkmarks_report.json"), JSON.stringify(report, null, 2));
  const failed = report.checks.filter((row) => !row.ok);
  if (failed.length) {
    console.error("FAILED checks:", failed);
    process.exit(1);
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
