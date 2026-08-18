#!/usr/bin/env node
/**
 * Staging UI capture: follow-up editor, appointment card, ops center, toast.
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const STAGING = process.env.STAGING_HOSTING_URL
  || "https://iaqar-ai-staging--staging-9c4b0k7h.web.app";
const WORKER = process.env.STAGING_WORKER_URL
  || "https://iaqar-intake-staging.iaqar-ai.workers.dev";
const PHONE = process.env.STAGING_PHONE || "0511123456";
const PASSWORD = process.env.STAGING_PASSWORD || "StagingLogo9";
const OUT = process.env.SCREENSHOT_DIR || "/opt/cursor/artifacts";
const COMMIT_SHA = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

async function login(page) {
  await page.goto(STAGING, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  const loginBtn = page.locator('button[data-go="login"]');
  if (await loginBtn.count()) await loginBtn.click();
  await page.waitForTimeout(500);
  await page.locator("#loginForm input[name=\"phone\"]").fill(PHONE);
  await page.locator("#loginForm input[name=\"password\"]").fill(PASSWORD);
  await page.locator("#loginForm button[type=\"submit\"]").click();
  await page.waitForTimeout(5000);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const report = { commitSha: COMMIT_SHA, checks: [], screenshots: [] };

  await login(page);
  await page.waitForFunction(() => window.IAQAR?.office?.officeId, { timeout: 30000 });

  const swCache = await page.evaluate(async () => {
    const keys = await caches.keys();
    return keys.find((k) => k.startsWith("iaqar-shell")) || "";
  });
  report.checks.push({ name: "sw_cache", ok: swCache === "iaqar-shell-followup-v1", value: swCache });

  await page.evaluate(() => {
    const workspace = document.getElementById("workspace");
    if (workspace) workspace.scrollIntoView({ behavior: "instant", block: "start" });
  });
  await page.waitForTimeout(1500);
  const opsPath = path.join(OUT, "staging_ops_center_390px.png");
  await page.screenshot({ path: opsPath, fullPage: false });
  report.screenshots.push(opsPath);

  const opportunityId = await page.evaluate(async () => {
    const runtime = window.IAQAR?.office;
    const fb = window.firebase;
    const user = fb?.auth?.()?.currentUser;
    if (!runtime?.officeId || !user) return "";
    const id = `staging-followup-${Date.now()}`;
    await runtime.db.collection("offices").doc(runtime.officeId).collection("opportunities").doc(id).set({
      officeId: runtime.officeId,
      contactName: "اختبار المتابعة",
      contactPhone: "0551234567",
      advertiserPhoneNormalized: "+966551234567",
      propertyType: "شقة",
      district: "الرانوناء",
      recordType: "owner_offer",
      contactType: "owner",
      lifecycleStatus: "INTERESTED",
      lastContactOutcome: "INTERESTED",
      lastWhatsAppOpenedAt: new Date().toISOString(),
      createdAt: fb.firestore.FieldValue.serverTimestamp(),
      updatedAt: fb.firestore.FieldValue.serverTimestamp()
    });
    return id;
  });
  report.opportunityId = opportunityId;

  await page.evaluate((id) => window.IAQAR.openOpportunityManagement(id), opportunityId);
  await page.waitForSelector("#iaqarWorkflowOverlay:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(1000);

  const editorPath = path.join(OUT, "staging_followup_editor.png");
  await page.screenshot({ path: editorPath });
  report.screenshots.push(editorPath);

  await page.waitForSelector("#iaqarCustomFollowUp", { timeout: 15000 });
  const future = new Date(Date.now() + 4 * 3600000);
  const pad = (n) => String(n).padStart(2, "0");
  const local = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`;
  await page.locator("#iaqarCustomFollowUp").fill(local);
  const recipient = page.locator("#iaqarFollowUpRecipient");
  if (await recipient.count()) {
    await recipient.selectOption({ value: "owner" });
    report.checks.push({ name: "recipient_select", ok: true });
  }
  await page.locator('[data-ui-action="save-followup-custom"]').click();
  await page.waitForTimeout(3000);

  const savedPath = path.join(OUT, "staging_followup_saved_populated.png");
  await page.screenshot({ path: savedPath });
  report.screenshots.push(savedPath);

  const inputValue = await page.locator("#iaqarCustomFollowUp").inputValue();
  report.checks.push({ name: "input_populated_after_save", ok: Boolean(inputValue), value: inputValue });

  const cardVisible = await page.locator("#iaqarFollowUpCard").count() > 0;
  report.checks.push({ name: "appointment_card_visible", ok: cardVisible });

  const toastPath = path.join(OUT, "staging_compact_toast.png");
  await page.screenshot({ path: toastPath });
  report.screenshots.push(toastPath);

  const idToken = await page.evaluate(async () => {
    const user = window.firebase?.auth?.()?.currentUser;
    return user ? await user.getIdToken(true) : "";
  });
  const officeId = await page.evaluate(() => window.IAQAR?.office?.officeId || "");
  if (idToken && officeId && opportunityId) {
    const reminderAt = new Date(future.getTime() - 60 * 60 * 1000).toISOString();
    await page.evaluate(async ({ worker, officeId, opportunityId, idToken, reminderAt, followUpAt }) => {
      await fetch(`${worker}/internal/followup-reminders/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ officeId, scheduledTime: Date.parse(reminderAt) + 1000 })
      });
    }, { worker: WORKER, officeId, opportunityId, idToken, reminderAt, followUpAt: future.toISOString() });
    report.checks.push({ name: "reminder_trigger_called", ok: true });
  }

  report.pass = report.checks.filter((c) => c.name !== "reminder_trigger_called").every((c) => c.ok);
  writeFileSync(path.join(OUT, "staging_followup_ui_report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(report.pass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
