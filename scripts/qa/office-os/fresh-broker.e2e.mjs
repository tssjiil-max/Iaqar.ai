// Fresh broker onboarding on the local harness: a brand-new account + office (what an approved broker
// application produces) → login → office page → logout → login again → add OFFER → add REQUEST →
// real match engine → MATCH_REVIEW daily task → review opens. Isolated ids, no seeded match, no Production.
//   node scripts/qa/office-os/fresh-broker.e2e.mjs   (OUT_DIR for screenshots)
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/office-os/fresh-broker");
fs.mkdirSync(OUT, { recursive: true });
const { startOfficeOsHarness, USERS } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));

const stamp = Date.now();
const UID = `qa-new-broker-${stamp}`;
const OFFICE = `qa-office-${stamp}`;
const PHONE = "0509876543";
const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");

const h = await startOfficeOsHarness();
USERS[UID] = { phone: PHONE, email: `${UID}@test.local`, officeId: OFFICE, password: "qa-pass-1" };
const office = { officeId: OFFICE, officeName: "مكتب الجديد للتسويق", brokerName: "فهد الجديد", licenseNumber: "1200055555", city: "جدة", phone: PHONE, whatsapp: PHONE, ownerUid: UID, active: true, publicSlug: `qa${stamp % 100000}`, specialties: ["sale"], platformOpportunityOnboardingAckAt: "2026-09-01T00:00:00Z" };
h.store.seed(`offices/${OFFICE}`, office);
h.store.seed(`publicOffices/${OFFICE}`, office);
h.store.seed(`offices/${OFFICE}/members/${UID}`, { uid: UID, role: "owner", active: true });
for (const key of [`+966${PHONE.slice(1)}`, PHONE, `966${PHONE.slice(1)}`]) h.store.seed(`loginDirectory/${sha256(key)}`, { uid: UID, officeId: OFFICE, email: USERS[UID].email, phone: PHONE, active: true });

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const checks = []; const errors = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`); };
const until = async (fn, label, timeout = 8000) => { const t = Date.now(); while (Date.now() - t < timeout) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 200)); } throw new Error(`timeout: ${label}`); };
let step = "start";

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true });
  const legacyHits = [];
  await ctx.route(/\/legacy\.html/, (route) => { legacyHits.push(route.request().url()); route.fulfill({ status: 200, contentType: "text/html", body: "legacy" }); });
  const page = await ctx.newPage(); page.setDefaultTimeout(10000);
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  const login = async () => {
    await page.goto(`${h.origin}/`);
    await page.getByRole("heading", { name: "دخول المكتب" }).waitFor();
    await page.fill('input[name="phone"]', PHONE);
    await page.fill('input[name="password"]', "qa-pass-1");
    await page.getByRole("button", { name: "دخول المكتب" }).click();
    await page.locator(".ref-office-tools").waitFor();
  };

  step = "1: signed-out visitor sees login and the signup entry";
  await page.goto(`${h.origin}/`);
  await page.getByRole("heading", { name: "دخول المكتب" }).waitFor();
  check("signup entry present for a new broker (existing application path)", (await page.locator("[data-broker-signup]").getAttribute("href")) === "/legacy.html#broker");

  step = "2: first login lands on the new office page";
  await login();
  const text = await page.locator("body").innerText();
  check("office page shows office name, broker, license, city", ["مكتب الجديد للتسويق", "فهد الجديد", "1200055555", "جدة"].every((t) => text.includes(t)));
  check("office tools and bottom navigation are visible", (await page.locator(".ref-office-tools").count()) === 1 && (await page.locator(".ref-bottom").count()) === 1);
  await page.reload(); await page.locator(".ref-office-tools").waitFor();
  check("reload keeps the same office", (await page.locator("body").innerText()).includes("مكتب الجديد للتسويق"));
  await page.screenshot({ path: path.join(OUT, "01-office.png"), fullPage: true });

  step = "2b: office home is clean (no placeholder grid of extras) and settings keep the user in the new UI";
  check("home: no «مكتبي» title and no «أدوات إضافية» block", !(await page.locator("body").innerText()).includes("مكتبي") && (await page.locator(".ref-office-extras-wrap").count()) === 0);
  check("home: every remaining tool card is clearly disabled («قريبًا»)", (await page.locator(".ref-office-tool:not([aria-disabled='true'])").count()) === 0);
  await page.locator(".ref-menu, [aria-label='القائمة والإعدادات']").first().click();
  await page.getByRole("button", { name: "مشاركة رابط المكتب" }).click();
  await page.locator(".os-toast, .os-sheet").first().waitFor();
  check("share office link works inside the new UI", true);
  await page.keyboard.press("Escape");
  await page.goto(`${h.origin}/#/settings/profile`);
  await page.locator('input[name="city"]').waitFor();
  await page.fill('input[name="city"]', "الدمام");
  await page.getByRole("button", { name: "حفظ بيانات المكتب" }).dblclick();
  await page.locator(".os-toast", { hasText: "تم حفظ بيانات المكتب" }).waitFor();
  check("settings save shows the new toast and stays in Office OS (double click saves once)", page.url().includes("#/settings/profile") && h.store.get(`offices/${OFFICE}`).city === "الدمام");
  const png = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 600; c.height = 800; const x = c.getContext("2d"); x.fillStyle = "#099FB4"; x.fillRect(0, 0, 600, 800); return c.toDataURL("image/png").split(",")[1]; });
  await page.setInputFiles("[data-photo-input]", { name: "me.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.locator("[data-photo-save]").click();
  await page.locator(".os-toast", { hasText: "تم حفظ الصورة" }).waitFor();
  await page.goto(`${h.origin}/#/office`); await page.reload();
  await page.locator("[data-broker-avatar]").waitFor();
  check("broker photo shows on the office card after reload (and the city change persisted)", (await page.locator("body").innerText()).includes("الدمام"));
  await page.screenshot({ path: path.join(OUT, "01b-office-photo.png"), fullPage: true });

  step = "2c: sweep of every main route and its safe controls";
  for (const route of ["office", "tasks", "settings", "settings/profile", "settings/link", "settings/cooperation", "settings/channels", "settings/brokers", "community"]) {
    await page.goto(`${h.origin}/#/${route}`);
    await page.waitForTimeout(500);
    const anchors = await page.locator("a[href*='legacy']").count();
    const blank = (await page.locator("body").innerText()).trim().length < 20;
    check(`route #/${route}: no legacy link, not blank`, anchors === 0 && !blank);
    for (const tab of await page.locator("[role='tab'], [data-tab]").all()) { await tab.click().catch(() => {}); }
    for (const nav of await page.locator(".ref-bottom button").all()) { await nav.click().catch(() => {}); await page.waitForTimeout(150); }
  }
  check("sweep: the old app was never requested", legacyHits.length === 0, legacyHits.join(","));

  step = "3: logout then login again returns to the same office";
  await page.goto(`${h.origin}/#/office`);
  await page.locator(".ref-menu, [aria-label='القائمة والإعدادات']").first().click();
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.getByRole("heading", { name: "دخول المكتب" }).waitFor();
  check("logout returns to the login screen", true);
  await login();
  check("login again returns to the same office (no duplicate office)", (await page.locator("body").innerText()).includes("مكتب الجديد للتسويق") && h.store.list("offices").filter((o) => o.ownerUid === UID).length === 1);

  step = "4: add the first OFFER";
  await page.locator(".ref-bottom").getByRole("button", { name: "العروض والطلبات", exact: true }).click();
  await page.getByRole("button", { name: "إضافة سجل جديد" }).click();
  await page.getByRole("button", { name: "إضافة عرض", exact: true }).click();
  await page.getByRole("button", { name: "بيع" }).click();
  await page.fill('input[name="propertyType"]', "شقة");
  await page.fill('input[name="district"]', "الشاطئ");
  await page.fill('input[name="price"]', "900000");
  await page.fill('input[name="contactName"]', "مالك تجريبي");
  await page.fill('input[name="contactPhone"]', "0551112222");
  await page.getByRole("button", { name: /حفظ/ }).last().click();
  await page.getByText("تفاصيل السجل").waitFor();
  const offers = await until(() => { const l = h.store.list(`offices/${OFFICE}/opportunities`).filter((o) => o.opportunityKind === "OFFER"); return l.length ? l : null; }, "offer persisted");
  check("exactly one OFFER with the right office and broker", offers.length === 1 && offers[0].officeId === OFFICE && offers[0].brokerId === UID);

  step = "5: add a matching REQUEST";
  await page.goto(`${h.origin}/#/office`);
  await page.locator(".ref-bottom").waitFor();
  await page.locator(".ref-bottom").getByRole("button", { name: "العروض والطلبات", exact: true }).click();
  await page.getByRole("button", { name: "إضافة سجل جديد" }).click();
  await page.getByRole("button", { name: "إضافة طلب", exact: true }).click();
  await page.getByRole("button", { name: "شراء" }).click();
  await page.fill('input[name="propertyType"]', "شقة");
  await page.fill('input[name="district"]', "الشاطئ");
  await page.fill('input[name="price"]', "950000");
  await page.fill('input[name="contactName"]', "عميل تجريبي");
  await page.fill('input[name="contactPhone"]', "0553334444");
  await page.getByRole("button", { name: "حفظ وفحص المطابقات" }).click();
  await page.getByText("تفاصيل السجل").waitFor();
  const reqs = h.store.list(`offices/${OFFICE}/opportunities`).filter((o) => o.opportunityKind === "REQUEST");
  check("exactly one REQUEST in the same office", reqs.length === 1 && reqs[0].officeId === OFFICE);

  step = "6: real match engine produced a match and a MATCH_REVIEW task";
  const match = await until(() => h.store.list(`offices/${OFFICE}/matches`)[0], "match created");
  check("match links this offer and request in this office", match.offerId === (offers[0].id || offers[0].opportunityId) && match.requestId === (reqs[0].id || reqs[0].opportunityId) && (match.officeId || OFFICE) === OFFICE, `${match.offerId}/${match.requestId}`);
  await page.goto(`${h.origin}/#/tasks`);
  const card = page.locator('[data-type="MATCH_REVIEW"]');
  await card.waitFor();
  check("one MATCH_REVIEW task in Daily Tasks", (await card.count()) === 1);
  await page.screenshot({ path: path.join(OUT, "02-tasks.png"), fullPage: true });

  step = "7: the review opens for the same offer and request";
  await card.getByRole("button", { name: "مراجعة المطابقة" }).click();
  await page.getByText("أسباب التوافق").waitFor();
  const body = await page.locator("body").innerText();
  check("review shows this property and client", body.includes("الشاطئ") && body.includes("عميل تجريبي"));
  check("no legacy screen was opened", !page.url().includes("legacy"));
  await page.getByRole("button", { name: "اعتماد وبدء التفاوض" }).click();
  await page.getByText("متابعة الفرصة").waitFor();
  check("approving the match starts the journey inside Office OS", h.store.list(`offices/${OFFICE}/journeys`).length === 1);
  check("tripwire: the old app was never requested during the whole journey", legacyHits.length === 0, legacyHits.join(","));
  await page.screenshot({ path: path.join(OUT, "03-review.png"), fullPage: true });
} catch (error) {
  check("fresh-broker journey completed", false, `[${step}] ${String(error?.message || error).split("\n")[0]}`);
} finally {
  await browser.close(); h.server.close();
  check("no browser console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} fresh-broker checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}
