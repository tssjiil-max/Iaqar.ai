// Current Office OS forms + real Worker, using only the existing local in-memory test harness.
// Browser requests are restricted to loopback; no real Firebase or third-party calls are allowed.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startOfficeOsHarness, OFFICE_A } from "./server.mjs";

const out = process.env.OUT_DIR || "/tmp/iaqar-office-os-amounts";
await fs.mkdir(out, { recursive: true });
const h = await startOfficeOsHarness();
const browser = await chromium.launch();
const results = [];
try {
  for (const surface of ["broker", "public-owner"]) {
    for (const rent of [false, true]) {
      for (const raw of ["٦٠٠٬٠٠٠٫٥٠", "600,000.50", "600ريال000"]) {
        const valid = raw !== "600ريال000";
        const label = `${surface}-${rent ? "rent" : surface === "broker" ? "purchase" : "sale"}-${results.length}`;
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar-SA", serviceWorkers: "block" });
        const blocked = [];
        await context.route("**/*", route => {
          const url = new URL(route.request().url());
          if (url.hostname === "127.0.0.1") return route.continue();
          blocked.push(url.origin);
          return route.abort("blockedbyclient");
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        let observed;
        try {
          if (surface === "broker") {
            await page.goto(h.origin);
            await page.locator('[name="phone"]').fill("0501111111");
            await page.locator('[name="password"]').fill("pass-a");
            await page.getByRole("button", { name: "دخول المكتب", exact: true }).click();
            await page.locator('.ref-bottom button[data-tool-route="repo"]').click();
            await page.getByRole("button", { name: "إضافة سجل جديد" }).click();
            await page.getByRole("button", { name: "إضافة طلب", exact: true }).click();
          } else {
            await page.goto(`${h.origin}/m/sultan`);
            await page.locator('[data-path="owner"]').click();
          }
          await page.locator('[data-fill-mode="manual"]').click();
          const purpose = surface === "broker" ? (rent ? "استئجار" : "شراء") : (rent ? "إيجار" : "بيع");
          await page.getByRole("button", { name: purpose, exact: true }).click();
          await page.locator('[name="propertyType"]').fill("شقة");
          await page.locator('[name="district"]').fill(`حي اختباري ${results.length}`);
          await page.locator('[name="contactName"]').fill("عميل اختباري");
          await page.locator('[name="contactPhone"]').fill("0500000000");
          if (surface !== "broker") await page.locator('[data-consent-processing]').check();
          await page.locator('[name="price"]').fill(raw);
          await page.locator('[name="contactName"]').focus(); // actual blur must not round or sanitize invalid text
          const afterBlur = await page.locator('[name="price"]').inputValue();
          const collection = `offices/${OFFICE_A}/${surface === "broker" ? "opportunities" : "publicIntake"}`;
          const before = h.store.list(collection);
          const opportunitiesBefore = h.store.list(`offices/${OFFICE_A}/opportunities`);
          await page.getByRole("button", { name: surface === "broker" ? "حفظ وفحص المطابقات" : "إرسال", exact: true }).click();
          await page.waitForFunction(() => document.querySelector('.os-field.invalid [name="price"]') || [...document.querySelectorAll("h1,h2,h3,p,div")].some(el => ["تفاصيل السجل", "تم استلام بياناتك"].includes(el.textContent.trim())), null, { timeout: 10000 });
          const after = h.store.list(collection);
          const added = after.find(row => !before.some(old => old.id === row.id));
          const downstream = h.store.list(`offices/${OFFICE_A}/opportunities`).filter(row => !opportunitiesBefore.some(old => old.id === row.id));
          observed = { input: raw, afterBlur, before: before.length, after: after.length, persisted: added || null, downstream };
          await fs.writeFile(path.join(out, `${label}-observation.json`), JSON.stringify(observed, null, 2));
          assert.equal(after.length, before.length + (valid ? 1 : 0), "invalid amount must not save");
          assert.equal(afterBlur, valid ? "600,000.5" : raw, "blur must preserve the exact amount or the invalid text");
          if (valid) {
            assert.ok(added);
            if (surface === "broker") {
              assert.equal(added.priceOrBudget, 600000.5);
              assert.equal(added.budget, 600000.5);
              if (rent) assert.equal(added.annualRent, 600000.5);
            } else {
              assert.equal(added.amount, 600000.5);
              assert.equal(downstream.length, 1, "public intake must become one canonical opportunity");
              // Public pipeline records use `price`; broker-direct records use `priceOrBudget`.
              assert.equal(downstream[0].price, 600000.5);
              assert.equal(downstream[0].purpose, rent ? "RENT" : "SALE");
              assert.equal(downstream[0].transactionType, rent ? "rent" : "sale");
            }
          } else {
            assert.equal(downstream.length, 0, "rejected amounts must not reach matching records");
          }
          assert.deepEqual(errors, []);
          assert.deepEqual(blocked, [], "No attempted external browser connections");
          results.push({ label, passed: true, ...observed, errors, blocked });
          console.log(`PASS ${label}: ${raw}`);
        } catch (error) {
          results.push({ label, passed: false, error: error.message, observed, errors, blocked });
          console.error(`FAIL ${label}: ${error.message}`);
          await page.screenshot({ path: path.join(out, `${label}-failure.png`), fullPage: true });
        } finally { await context.close(); }
      }
    }
  }
} finally {
  await browser.close();
  await new Promise(resolve => h.server.close(resolve));
  await fs.writeFile(path.join(out, "results.json"), JSON.stringify({ results }, null, 2));
}
assert.equal(results.length, 12, "Both surfaces and transaction types must be exercised");
assert.equal(results.filter(row => !row.passed).length, 0, "Every current-form amount journey must pass");
