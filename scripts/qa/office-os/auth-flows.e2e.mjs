// Pre-login flows inside Office OS: «نسيت كلمة المرور» and «تسجيل وسيط جديد» (+ the public-page footer entry).
// Local harness, real Worker handler for /broker/apply, no Production.   node scripts/qa/office-os/auth-flows.e2e.mjs
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/office-os/auth-flows");
fs.mkdirSync(OUT, { recursive: true });
const { startOfficeOsHarness, USERS } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));

const h = await startOfficeOsHarness();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const checks = []; const errors = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`); };
let step = "start";
const noOverflow = async (page, label) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(`no horizontal scroll: ${label} — ${o}px`, o <= 0); };

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true });
  const legacyHits = [];
  await ctx.route(/\/legacy\.html/, (route) => { legacyHits.push(route.request().url()); route.fulfill({ status: 200, contentType: "text/html", body: "legacy" }); });
  const page = await ctx.newPage(); page.setDefaultTimeout(10000);
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));

  step = "forgot password";
  const resetBodies = [];
  await page.route(/\/worker\/auth\/forgot-password/, async (route) => { resetBodies.push(JSON.parse(route.request().postData() || "{}")); await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, maskedEmail: "s***@test.local" }) }); });
  await page.goto(`${h.origin}/`);
  await page.getByRole("heading", { name: "دخول المكتب" }).waitFor();
  await page.locator("[data-forgot]").click();
  await page.getByRole("heading", { name: "نسيت كلمة المرور" }).waitFor();
  check("«نسيت كلمة المرور» opens inside Office OS", (await page.locator("[data-forgot-form]").count()) === 1 && !page.url().includes("legacy"));
  await page.fill('input[name="phone"]', "123");
  await page.getByRole("button", { name: "إرسال رابط الاسترجاع" }).click();
  await page.locator(".os-alert.bad").waitFor();
  check("a wrong phone number is rejected before anything is sent", resetBodies.length === 0 && (await page.locator(".os-alert.bad").innerText()).includes("05"));
  await page.fill('input[name="phone"]', "0501234567");
  await page.evaluate(() => { const f = document.querySelector("[data-forgot-form]"); f.requestSubmit(); f.requestSubmit(); });
  await page.locator(".os-alert.ok").waitFor();
  check("a valid number sends one request (double submit) with the local phone and the public API key", resetBodies.length === 1 && resetBodies[0].phone === "0501234567" && resetBodies[0].apiKey === "harness-api-key", JSON.stringify(resetBodies[0] || {}));
  check("the masked email is shown, never the full one", (await page.locator(".os-alert.ok").innerText()).includes("s***@test.local"));
  await noOverflow(page, "forgot password");
  await page.screenshot({ path: path.join(OUT, "01-forgot.png"), fullPage: true });
  await page.locator("[data-auth-back]").click();
  await page.getByRole("heading", { name: "دخول المكتب" }).waitFor();
  check("back returns to the login screen", true);

  step = "broker application";
  await page.locator("[data-broker-signup]").click();
  await page.getByRole("heading", { name: "تسجيل وسيط عقاري" }).waitFor();
  await page.getByRole("button", { name: "إرسال طلب الاعتماد" }).click();
  await page.locator("[data-field-error]:not([hidden])").first().waitFor();
  const shown = await page.locator("[data-field-error]:not([hidden])").count();
  check("empty form: every required field is marked and no account is created", shown === 6 && Object.keys(USERS).every((u) => !u.startsWith("qa-signup")), `${shown} errors`);
  const fill = async (v) => { for (const [k, val] of Object.entries(v)) await page.fill(`input[name="${k}"]`, val); };
  await fill({ brokerName: "فهد التجريبي", phone: "0507654321", email: "new.broker@test.local", falLicense: "1200099999", officeName: "مكتب الاختبار الجديد", password: "secret-pass-1" });
  await noOverflow(page, "broker application");
  await page.screenshot({ path: path.join(OUT, "02-apply.png"), fullPage: true });
  await page.getByRole("button", { name: "إرسال طلب الاعتماد" }).click();
  await page.locator(".os-alert.ok, .os-alert.bad").first().waitFor();
  const outcome = await page.locator(".os-alert").first().innerText();
  const applications = h.store.list("brokerApplications");
  check("the application is stored as pending approval (admin decides)", /بانتظار الاعتماد/.test(outcome) && applications.length === 1, outcome);
  check("after sending the visitor is signed out (no office session)", await page.evaluate(() => !window.firebase.auth().currentUser));
  check("the form is cleared after success", (await page.inputValue('input[name="brokerName"]')) === "");

  step = "duplicate email is shown on the email field";
  await page.reload(); await page.getByRole("heading", { name: "دخول المكتب" }).waitFor();
  await page.locator("[data-broker-signup]").click();
  await fill({ brokerName: "آخر", phone: "0507654322", email: "new.broker@test.local", falLicense: "1200088888", officeName: "مكتب آخر جديد", password: "secret-pass-2" });
  await page.getByRole("button", { name: "إرسال طلب الاعتماد" }).click();
  await page.locator('[data-field-error="email"]:not([hidden])').waitFor();
  check("a used email is reported on the email field", true);
  { const i = errors.findIndex((e) => /409/.test(e)); if (i >= 0) errors.splice(i, 1); } // the deliberate duplicate-email signup

  step = "deep links";
  await page.goto(`${h.origin}/#/register`);
  await page.getByRole("heading", { name: "تسجيل وسيط عقاري" }).waitFor();
  check("#/register opens the application form directly", true);

  step = "public page footer";
  const slug = (h.store.list("publicOffices")[0] || {}).publicSlug;
  if (slug) {
    await page.goto(`${h.origin}/o/${slug}`);
    await page.locator("[data-create-office]").waitFor();
    check("public page footer link points to the new application form", (await page.locator("[data-create-office]").getAttribute("href")) === "/#/register");
  }
  check("tripwire: the old app was never requested", legacyHits.length === 0, legacyHits.join(","));
} catch (error) {
  check("auth flows completed", false, `[${step}] ${String(error?.message || error).split("\n")[0]}`);
} finally {
  await browser.close(); h.server.close();
  check("no browser console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} auth-flow checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}
