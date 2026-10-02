// مجتمع الوسطاء — browser check on the local harness: entry points, incoming/outgoing/finished tabs,
// accept / not-suitable through /cooperation/workflow (intercepted: the harness has no Google credentials),
// hand-off to the old screen for steps that need extra input.
//   node scripts/qa/office-os/community.e2e.mjs   (OUT_DIR for screenshots)
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/office-os/community");
fs.mkdirSync(OUT, { recursive: true });
const { startOfficeOsHarness, OWNER_A, BROKER_A2, OFFICE_A, OFFICE_B } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));

const h = await startOfficeOsHarness();

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

const coop = (id, over) => ({ id, originatingOfficeId: OFFICE_B, originatingOfficeName: "مكتب الأفق للعقار", targetOfficeId: OFFICE_A, targetOfficeName: "مكتب سلطان العقاري",
  status: "PENDING", currentStage: "WAITING_PARTNER", originListing: { propertyType: "شقة", purpose: "sale", district: "الوبرة", city: "المدينة المنورة", priceOrBudget: 900000 },
  updatedAt: "2026-10-01T10:00:00.000Z", ...over });
h.store.seed("cooperationRequests/c-in", coop("c-in", {}));
h.store.seed("cooperationRequests/c-in2", coop("c-in2", { updatedAt: "2026-10-01T09:00:00.000Z" }));
h.store.seed("cooperationRequests/c-out", coop("c-out", { originatingOfficeId: OFFICE_A, originatingOfficeName: "مكتب سلطان العقاري", targetOfficeId: OFFICE_B, targetOfficeName: "مكتب الأفق للعقار" }));
h.store.seed("cooperationRequests/c-done", coop("c-done", { status: "ACCEPTED", currentStage: "COMPLETED" }));
h.store.seed("cooperationRequests/c-appt", coop("c-appt", { status: "ACCEPTED", currentStage: "APPOINTMENT" }));
const calls = [];

let page;
try {
  const ctxPage = await openAs(OWNER_A, "office");
  page = ctxPage;
  await page.route("**/worker/cooperation/workflow", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    calls.push(body);
    const row = h.store.get(`cooperationRequests/${body.cooperationId}`);
    h.store.patch(`cooperationRequests/${body.cooperationId}`, body.action === "ACCEPT" ? { status: "ACCEPTED", currentStage: "ACCEPTED" } : { status: "REJECTED", currentStage: "REJECTED" });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, cooperationId: body.cooperationId, previous: row?.currentStage }) });
  });
  await page.locator("[data-community-entry]").waitFor();
  check("office home has the «مجتمع الوسطاء» entry", (await page.locator("[data-community-entry]").innerText()).includes("مجتمع الوسطاء"));
  await shot(page, "01-office-entry");
  await page.locator("[data-community-entry]").click();
  await page.locator("[data-coop]").first().waitFor();
  check("opens #/community", page.url().endsWith("#/community"));
  check("incoming requests need my answer (2)", (await page.locator('[data-tab="needs"] .n').innerText()) === "3" || (await page.locator("[data-coop]").count()) >= 2, `${await page.locator("[data-coop]").count()} cards`);
  check("tab counts: needs 3 (2 incoming + appointment), waiting 1, done 1",
    (await page.locator('[data-tab="needs"] .n').innerText()) === "3" && (await page.locator('[data-tab="waiting"] .n').innerText()) === "1" && (await page.locator('[data-tab="done"] .n').innerText()) === "1");
  check("card shows the partner office and the property", (await page.locator('[data-coop="c-in"]').innerText()).includes("مكتب الأفق للعقار") && (await page.locator('[data-coop="c-in"]').innerText()).includes("شقة"));
  check("no contact data on cards", !/05\d{8}/.test(await page.locator(".os-task-list").innerText()));
  check("step needing extra input hands off to the old screen", (await page.locator('[data-coop="c-appt"] [data-coop-legacy]').getAttribute("href")).includes("openOperation=c-appt"));
  await shot(page, "02-community-needs");

  await page.locator('[data-coop="c-in"] [data-coop-action="accept_cooperation"]').click();
  await until(() => calls.length === 1, "accept call");
  check("accept goes through /cooperation/workflow with ACCEPT", calls[0].action === "ACCEPT" && calls[0].cooperationId === "c-in" && calls[0].officeId === OFFICE_A);
  await until(() => h.store.get("cooperationRequests/c-in").status === "ACCEPTED", "accepted");

  await page.locator('[data-coop="c-in2"] [data-coop-action="reject_cooperation"]').click();
  await page.locator(".os-dialog").getByRole("button", { name: "غير مناسب" }).click();
  await until(() => calls.length === 2, "reject call");
  check("not suitable sends REJECT after confirmation", calls[1].action === "REJECT" && calls[1].cooperationId === "c-in2");

  await page.locator('[data-tab="waiting"]').click();
  check("my outgoing request waits and has no buttons", (await page.locator('[data-coop="c-out"]').count()) === 1 && (await page.locator('[data-coop="c-out"] [data-coop-action]').count()) === 0);
  await page.locator('[data-tab="done"]').click();
  check("finished cooperation is under المنتهية", (await page.locator('[data-coop="c-done"]').count()) === 1);
  await shot(page, "03-community-done");

  await page.goto(`${h.origin}/#/tasks`);
  await page.locator('.ref-bell').waitFor();
  await page.locator('.ref-bell').click();
  await page.getByRole("button", { name: "مجتمع الوسطاء" }).click();
  await page.waitForURL(/#\/community$/);
  check("menu has «مجتمع الوسطاء»", true);

} catch (error) {
  check("community journey completed", false, String(error?.message || error).split("\n")[0]);
  console.log(await page?.locator(".os-view").innerText().catch(() => "n/a"));
} finally {
  await browser.close();
  h.server.close();
  check("no browser console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} community checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}
