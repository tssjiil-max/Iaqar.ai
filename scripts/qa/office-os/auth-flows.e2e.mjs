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
  step = "one look for both screens";
  // Visual checks only: nothing is submitted in this block (requests to the Worker are counted to prove it).
  const sent = [];
  const watch = (p) => p.on("request", (r) => { if (/\/worker\/|identitytoolkit|\/harness\/signup/.test(r.url())) sent.push(r.url()); });
  const measure = async (p) => p.evaluate(() => {
    const card = document.querySelector(".os-auth-card").getBoundingClientRect();
    const logo = document.querySelector(".os-auth-hero img");
    const box = logo.getBoundingClientRect(); const frame = logo.parentElement.getBoundingClientRect();
    const hero = document.querySelector(".os-auth-hero").getBoundingClientRect();
    const style = getComputedStyle(document.querySelector(".os-auth-card"));
    return {
      width: Math.round(card.width), left: Math.round(card.left), right: Math.round(innerWidth - card.right),
      top: Math.round(hero.top), bottom: Math.round(document.documentElement.scrollHeight - card.bottom), tall: document.documentElement.scrollHeight > innerHeight + 1,
      radius: style.borderRadius, padding: style.paddingTop, shadow: style.boxShadow, border: style.borderTopColor,
      logoWhole: logo.complete && logo.naturalWidth > 0 && getComputedStyle(logo).objectFit === "contain" && box.left >= frame.left - 1 && box.right <= frame.right + 1 && box.top >= frame.top - 1 && box.bottom <= frame.bottom + 1,
      rtl: getComputedStyle(document.querySelector(".os-auth")).direction === "rtl",
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      titleFits: (() => { const t = document.querySelector(".os-public-title"); return t.scrollWidth <= t.clientWidth + 1; })(),
      controlsInside: [...document.querySelectorAll(".os-auth-card input, .os-auth-card button")].every((el) => { const r = el.getBoundingClientRect(); return r.left >= card.left - 1 && r.right <= card.right + 1; }),
      smallTargets: [...document.querySelectorAll(".os-auth-card input, .os-auth-card button")].filter((el) => (el.closest(".os-pass") && el.tagName === "INPUT" ? el.closest(".os-pass") : el).getBoundingClientRect().height < 44).length
    };
  });
  for (const [label, viewport] of [["phone 390", { width: 390, height: 844 }], ["phone 320", { width: 320, height: 640 }], ["desktop 1440", { width: 1440, height: 900 }]]) {
    const c = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: "ar-SA" });
    const p = await c.newPage(); p.setDefaultTimeout(10000); watch(p);
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`${h.origin}/`); await p.locator("[data-login-form]").waitFor(); await p.waitForTimeout(300);
    const login = await measure(p);
    await p.locator("[data-broker-signup]").click(); await p.locator("[data-broker-form]").waitFor(); await p.waitForTimeout(200);
    const register = await measure(p);
    check(`${label}: both cards have the same width, corners, padding, border and shadow`, login.width === register.width && login.radius === register.radius && login.padding === register.padding && login.shadow === register.shadow && login.border === register.border, `${login.width}/${register.width}px`);
    check(`${label}: the card is centred and neither narrow nor stretched`, Math.abs(login.left - login.right) <= 1 && Math.abs(register.left - register.right) <= 1 && login.width <= 440 && login.width >= Math.min(440, viewport.width - 40), `${login.width}px`);
    check(`${label}: no horizontal scroll, right-to-left, nothing clipped (logo, title, fields, buttons)`, [login, register].every((m) => m.overflow <= 0 && m.rtl && m.logoWhole && m.titleFits && m.controlsInside), JSON.stringify({ l: login.overflow, r: register.overflow }));
    check(`${label}: every field and button is at least 44px tall`, login.smallTargets === 0 && register.smallTargets === 0, `${login.smallTargets}/${register.smallTargets}`);
    if (!login.tall) check(`${label}: the login card sits in the middle of the screen (balanced space above and below)`, Math.abs(login.top - login.bottom) <= 24, `${login.top}/${login.bottom}`);
    await c.close();
  }

  step = "fields, groups and states";
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true });
  const p2 = await c2.newPage(); p2.setDefaultTimeout(10000); watch(p2);
  p2.on("pageerror", (e) => errors.push(e.message));
  await p2.goto(`${h.origin}/`); await p2.locator("[data-login-form]").waitFor();
  const eye = p2.locator("[data-login-form] [data-pass-toggle]");
  const pass = p2.locator('[data-login-form] input[name="password"]');
  // The field frame holds the input and the eye side by side: the eye is inside the frame and never covers the typed text.
  const inside = await p2.evaluate(() => { const f = document.querySelector("[data-login-form] .os-pass").getBoundingClientRect(); const i = document.querySelector('[data-login-form] input[name="password"]').getBoundingClientRect(); const b = document.querySelector("[data-login-form] [data-pass-toggle]").getBoundingClientRect(); return b.left >= f.left && b.right <= f.right && b.top >= f.top - 1 && b.bottom <= f.bottom + 1 && (b.right <= i.left + 1 || b.left >= i.right - 1) && b.height >= 44; });
  check("login: the eye sits inside the password field and has a spoken name", inside && (await eye.getAttribute("aria-label")) === "إظهار كلمة المرور");
  await pass.fill("not-a-real-password");
  await eye.click();
  const shownType = await pass.getAttribute("type");
  const shownLabel = await eye.getAttribute("aria-label");
  await eye.click();
  check("login: the eye shows and hides the password as the old button did", shownType === "text" && shownLabel === "إخفاء كلمة المرور" && (await pass.getAttribute("type")) === "password" && (await eye.getAttribute("aria-pressed")) === "false");
  check("login: «دخول المكتب», «نسيت كلمة المرور» and «تسجيل وسيط جديد» are all there", (await p2.getByRole("button", { name: "دخول المكتب" }).count()) === 1 && (await p2.locator("[data-forgot]").innerText()) === "نسيت كلمة المرور" && (await p2.locator("[data-broker-signup]").innerText()) === "تسجيل وسيط جديد");
  check("login: required fields carry the same mark as the registration form", (await p2.locator("[data-login-form] .os-req").count()) === 2);
  await p2.locator("[data-broker-signup]").click(); await p2.locator("[data-broker-form]").waitFor();
  const layout = await p2.evaluate(() => ({
    order: [...document.querySelectorAll("[data-broker-form] input")].map((i) => i.name),
    groups: [...document.querySelectorAll("[data-broker-form] [data-auth-group]")].map((g) => [g.querySelector("legend").textContent, [...g.querySelectorAll("input")].map((i) => i.name)]),
    labels: [...document.querySelectorAll("[data-broker-form] .os-auth-label")].map((l) => l.textContent),
    stars: document.querySelectorAll("[data-broker-form] .os-req").length,
    note: document.querySelector("[data-auth-note]")?.textContent || "",
    phoneHint: document.querySelector('[data-field-hint="phone"]')?.textContent || "",
    passHint: document.querySelector('[data-field-hint="password"]')?.textContent || "",
    links: [...document.querySelectorAll(".os-auth-page a[href]")].map((a) => a.getAttribute("href"))
  }));
  check("registration: same six fields in the same order", layout.order.join(",") === "brokerName,phone,email,falLicense,officeName,password", layout.order.join(","));
  check("registration: grouped as الوسيط · المكتب · الدخول without adding or removing a field", JSON.stringify(layout.groups) === JSON.stringify([["بيانات الوسيط", ["brokerName", "phone", "email"]], ["بيانات المكتب", ["falLicense", "officeName"]], ["بيانات الدخول", ["password"]]]));
  check("registration: the labels keep their wording and all six are marked required the same way", layout.labels.join("|") === "اسم الوسيط*|رقم الجوال*|البريد الإلكتروني للاسترجاع*|رقم رخصة فال*|اسم المكتب المقترح*|كلمة مرور الحساب*" && layout.stars === 6, layout.labels.join("|"));
  check("registration: the licence notice is kept and readable", layout.note === "لن يُنشأ المكتب إلا بعد التحقق من رخصة فال واعتماد إدارة المنصة." && await p2.locator("[data-auth-note]").isVisible());
  check("registration: a phone example and the real password rule are shown next to their fields", layout.phoneHint === "مثال: 0512345678" && layout.passHint === "8 أحرف أو أكثر", `${layout.phoneHint} | ${layout.passHint}`);
  check("no invented links: the screens link nowhere that does not exist", layout.links.length === 0, layout.links.join(","));
  const state = (name) => p2.evaluate((n) => { const f = document.querySelector(`[data-field="${n}"]`); const e = f.querySelector("[data-field-error]"); return { invalid: f.classList.contains("invalid"), valid: f.classList.contains("is-valid"), error: e.hidden ? "" : e.textContent, aria: f.querySelector("input").getAttribute("aria-invalid") }; }, name);
  await p2.fill('input[name="email"]', "not-an-email"); await p2.locator('input[name="phone"]').focus();
  const badEmail = await state("email");
  check("a wrong value is marked on its own field with a plain Arabic message", badEmail.invalid && badEmail.aria === "true" && badEmail.error === "أدخل بريدًا إلكترونيًا صحيحًا", JSON.stringify(badEmail));
  await p2.fill('input[name="email"]', "visual.check@test.local"); await p2.locator('input[name="phone"]').focus();
  await p2.fill('input[name="phone"]', "0512345678"); await p2.fill('input[name="falLicense"]', "1200012345"); await p2.fill('input[name="password"]', "short"); await p2.locator('input[name="brokerName"]').focus();
  const [okEmail, okPhone, fal, shortPass] = [await state("email"), await state("phone"), await state("falLicense"), await state("password")];
  check("a right format gets a quiet «valid» state, and the error clears", okEmail.valid && !okEmail.invalid && okPhone.valid);
  check("the licence number never shows a «valid» mark (only the platform can verify it)", !fal.valid && !fal.invalid);
  check("the password rule is the system's own: fewer than 8 characters is refused on the field", shortPass.invalid && shortPass.error === "كلمة المرور 8 أحرف أو أكثر");
  check("registration: the password field has the same eye", (await p2.locator('[data-broker-form] [data-pass-toggle]').count()) === 1);
  await p2.screenshot({ path: path.join(OUT, "03-apply-states.png"), fullPage: true });
  await p2.locator("[data-auth-back]").click(); await p2.locator("[data-login-form]").waitFor();
  check("«رجوع إلى دخول المكتب» still returns to the login screen", true);
  check("nothing was sent while looking, typing or leaving fields (no account, no application)", sent.length === 0 && h.store.list("brokerApplications").length === 1, sent.slice(0, 2).join(","));
  await c2.close();

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
