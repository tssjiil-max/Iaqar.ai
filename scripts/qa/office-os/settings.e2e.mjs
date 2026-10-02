// إعدادات المكتب — browser check on the local harness: hub, بيانات المكتب, رابط المكتب, التعاون,
// الوسطاء. Saves go to the same documents the old settings screen writes (offices, publicOffices,
// officeNameClaims, officeSettings/cooperation) and the real Worker (/office/public-slug).
//   node scripts/qa/office-os/settings.e2e.mjs   (OUT_DIR for screenshots)
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/office-os/settings");
fs.mkdirSync(OUT, { recursive: true });
const { startOfficeOsHarness, OWNER_A, BROKER_A2, OFFICE_A, OFFICE_B } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const { normalizeOfficeNameKey } = await import(path.join(ROOT, "public/js/office-domain.js"));

const h = await startOfficeOsHarness();
const takenName = "مكتب الأفق للعقار";
h.store.seed(`officeNameClaims/${normalizeOfficeNameKey(takenName)}`, { officeId: OFFICE_B, officeName: takenName });

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const checks = [];
const errors = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`); };
const until = async (fn, label, timeout = 6000) => { const t = Date.now(); while (Date.now() - t < timeout) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } throw new Error(`timeout: ${label}`); };

async function openAs(uid, hash) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true });
  await ctx.addInitScript(([u, o]) => { localStorage.setItem("harness.uid", u); localStorage.setItem("iaqar.officeId", o); }, [uid, OFFICE_A]);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: h.origin }).catch(() => {});
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${h.origin}/#/${hash}`);
  return page;
}
async function shot(page, name) {
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  check(`no horizontal scroll: ${name}`, overflow <= 1, `${overflow}px`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

try {
  const page = await openAs(OWNER_A, "settings");
  await page.locator(".os-set-row").first().waitFor();
  check("hub lists the four settings pages", (await page.locator(".os-set-row").count()) === 4);
  check("advanced settings still reach the old app (labelled)", (await page.locator("[data-legacy-settings]").getAttribute("href")).startsWith("/legacy.html?officeId="));
  await shot(page, "01-hub");

  // بيانات المكتب
  await page.locator('[data-settings="profile"]').click();
  await page.locator('input[name="officeName"]').waitFor();
  check("profile form is pre-filled from the office", (await page.inputValue('input[name="officeName"]')) === "مكتب سلطان العقاري" && (await page.inputValue('input[name="licenseNumber"]')) === "1200012345");
  await page.fill('input[name="phone"]', "123");
  await page.getByRole("button", { name: "حفظ بيانات المكتب" }).click();
  await page.locator('[data-error="phone"]').filter({ hasText: "05" }).waitFor();
  check("invalid phone is refused and nothing is written", h.store.get(`offices/${OFFICE_A}`).phone === "0501111111");
  await page.fill('input[name="officeName"]', takenName);
  await page.fill('input[name="phone"]', "0508888888");
  await page.getByRole("button", { name: "حفظ بيانات المكتب" }).click();
  await page.locator('[data-error="officeName"]').filter({ hasText: "مستخدم أو محجوز" }).waitFor();
  check("a name held by another office is refused", h.store.get(`offices/${OFFICE_A}`).officeName === "مكتب سلطان العقاري");
  await shot(page, "02-profile-name-taken");
  await page.fill('input[name="officeName"]', "مكتب سلطان للتسويق العقاري");
  await page.locator('[data-specialty="purchase"]').click();
  await page.getByRole("button", { name: "حفظ بيانات المكتب" }).click();
  await page.locator(".os-toast", { hasText: "تم حفظ بيانات المكتب" }).waitFor();
  const office = await until(() => { const o = h.store.get(`offices/${OFFICE_A}`); return o.officeName === "مكتب سلطان للتسويق العقاري" ? o : null; }, "office saved");
  check("office profile saved (name, key, phone, whatsapp, specialties)", office.phone === "0508888888" && office.whatsapp === "0508888888" && office.officeNameKey === normalizeOfficeNameKey("مكتب سلطان للتسويق العقاري") && office.specialties.includes("purchase"), JSON.stringify(office.specialties));
  check("other office fields are untouched (slug, owner)", office.publicSlug === "sultan" && office.ownerUid === OWNER_A);
  const mirror = h.store.get(`publicOffices/${OFFICE_A}`);
  check("public office mirror updated", mirror.officeName === "مكتب سلطان للتسويق العقاري" && mirror.phone === "0508888888");
  const claim = h.store.get(`officeNameClaims/${office.officeNameKey}`);
  check("the new name is claimed by this office", claim && claim.officeId === OFFICE_A);
  await shot(page, "03-profile-saved");

  // رابط المكتب
  await page.goto(`${h.origin}/#/settings/link`);
  await page.locator("[data-office-link]").waitFor();
  check("office link shows /m/<slug>", (await page.inputValue("[data-office-link]")).endsWith("/m/sultan"));
  await page.fill('input[name="publicSlug"]', "Bad Slug!!");
  await page.fill('input[name="publicSlug"]', "sultan-new");
  await page.getByRole("button", { name: "حفظ معرّف الرابط" }).click();
  await until(() => h.store.get(`offices/${OFFICE_A}`).publicSlug === "sultan-new", "slug saved by the Worker");
  check("short link saved through the Worker", (await page.inputValue("[data-office-link]")).endsWith("/m/sultan-new"));
  check("WhatsApp share link carries the office link", decodeURIComponent(await page.locator("[data-share-link]").getAttribute("href")).includes("/m/sultan-new"));
  await shot(page, "04-link");

  // التعاون
  await page.goto(`${h.origin}/#/settings/cooperation`);
  await page.locator("[data-mode]").first().waitFor();
  check("cooperation shows the three modes, approval-per-request by default", (await page.locator("[data-mode]").count()) === 3 && (await page.locator('[data-mode="APPROVAL_REQUIRED"][aria-checked="true"]').count()) === 1);
  await page.locator('[data-mode="DISABLED"]').click();
  await page.getByRole("button", { name: "حفظ إعداد التعاون" }).click();
  await until(() => h.store.get(`offices/${OFFICE_A}/officeSettings/cooperation`)?.mode === "DISABLED", "cooperation saved");
  const coop = h.store.get(`offices/${OFFICE_A}/officeSettings/cooperation`);
  check("cooperation mode saved; contact never exposed automatically", coop.mode === "DISABLED" && coop.exposeContactAutomatically === false);
  await until(() => h.store.get(`publicOffices/${OFFICE_A}`)?.cooperationMode === "DISABLED", "public mirror").catch(() => {});
  check("public mirror carries the cooperation mode", h.store.get(`publicOffices/${OFFICE_A}`)?.cooperationMode === "DISABLED");
  await shot(page, "05-cooperation");

  // الوسطاء (existing page, now under the hub)
  await page.goto(`${h.origin}/#/settings/brokers`);
  await page.getByText("إتمام الصفقات").waitFor();
  await page.getByRole("button", { name: "رجوع" }).click();
  await page.locator(".os-set-row").first().waitFor();
  check("brokers page is reachable and returns to the hub", true);

  // a broker without manager rights
  const broker = await openAs(BROKER_A2, "settings/profile");
  await broker.getByText("لمدير المكتب فقط").waitFor();
  check("a non-manager broker sees «لمدير المكتب فقط» and no form", (await broker.locator('input[name="officeName"]').count()) === 0);
} catch (error) {
  check("settings journey completed", false, String(error?.message || error).split("\n")[0]);
} finally {
  await browser.close();
  h.server.close();
  check("no browser console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} settings checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}
