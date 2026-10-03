// «مكتبة المكتب» inside Office OS on the local harness: folders, upload through the real Worker handler,
// open/download, search/filters, edit (links preserved), delete (manager only), isolation, mobile.
//   node scripts/qa/office-os/library.e2e.mjs   (OUT_DIR for screenshots)
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/office-os/library");
fs.mkdirSync(OUT, { recursive: true });
const { startOfficeOsHarness, OWNER_A, BROKER_A2, OFFICE_A, OFFICE_B } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));

const h = await startOfficeOsHarness();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const checks = []; const errors = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`); };
let step = "start";
const until = async (fn, label, timeout = 8000) => { const t = Date.now(); while (Date.now() - t < timeout) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } throw new Error(`timeout: ${label}`); };
const libDocs = () => h.store.list(`offices/${OFFICE_A}/library`);

// A document that already exists (older entry linked to an opportunity) and one in another office.
h.store.seed(`offices/${OFFICE_A}/library/lib_seed1`, { officeId: OFFICE_A, fileName: "old.pdf", contentType: "application/pdf", mediaPath: "", kind: "manual", category: "owner_brokerage", documentTitle: "عقد وساطة قديم", referenceNumber: "OLD-1", opportunityId: "opp-keep", cooperationId: "coop-keep", documentStatus: "ACTIVE", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
h.store.seed(`offices/${OFFICE_B}/library/lib_other`, { officeId: OFFICE_B, fileName: "secret.pdf", contentType: "application/pdf", kind: "manual", category: "other", documentTitle: "ملف مكتب آخر", createdAt: "2026-01-02T00:00:00.000Z" });

async function openAs(uid, hash) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true, acceptDownloads: true });
  await ctx.addInitScript(([u, o]) => { localStorage.setItem("harness.uid", u); localStorage.setItem("iaqar.officeId", o); }, [uid, OFFICE_A]);
  const legacy = [];
  await ctx.route(/\/legacy\.html/, (route) => { legacy.push(route.request().url()); route.fulfill({ status: 200, contentType: "text/html", body: "legacy" }); });
  const page = await ctx.newPage(); page.setDefaultTimeout(10000); page.legacy = legacy;
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${h.origin}/#/${hash}`);
  return page;
}
const noOverflow = async (page, label) => { const o = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth); check(`no horizontal scroll: ${label} — ${o}px`, o <= 1); };
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

try {
  const page = await openAs(OWNER_A, "tasks");
  step = "entry from the menu";
  await page.locator(".ref-menu, [aria-label='القائمة والإعدادات']").first().click();
  await page.getByRole("button", { name: "مكتبة المكتب" }).click();
  await page.getByRole("heading", { name: "مكتبة المكتب" }).waitFor();
  check("the menu opens the library inside Office OS", page.url().includes("#/library"));
  await page.locator('[data-lib-section="brokerage"]').waitFor();
  check("three sections with the old folder names", (await page.locator("[data-lib-section]").count()) === 3 && (await page.locator('[data-lib-section="deals"]').innerText()).includes("عقود الصفقات"));
  const brokerageCount = await page.locator('[data-lib-toggle="brokerage"] .os-badge').innerText();
  check("an existing entry is counted, another office's entry is not", brokerageCount === "1" && !(await page.locator("body").innerText()).includes("ملف مكتب آخر"), brokerageCount);
  await page.locator('[data-lib-toggle="deals"]').click();
  check("a section opens to its folders (sale, lease, addendum)", (await page.locator('[data-lib-section="deals"] [data-lib-category]').count()) === 3);
  await noOverflow(page, "library folders");
  await page.screenshot({ path: path.join(OUT, "01-folders.png"), fullPage: true });

  step = "upload validation";
  await page.locator("[data-lib-add]").click();
  await page.locator("[data-lib-save]").click();
  await page.locator(".os-alert.bad").waitFor();
  check("saving without a file is refused with a message and nothing is stored", (await page.locator(".os-alert.bad").innerText()).includes("اختر ملفًا") && libDocs().length === 1);
  await page.setInputFiles("[data-lib-file]", { name: "virus.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") });
  await page.locator("[data-lib-save]").click();
  await page.waitForTimeout(300);
  check("an unsupported type is refused before upload", (await page.locator(".os-alert.bad").innerText()).includes("غير مدعوم") && libDocs().length === 1);
  await page.setInputFiles("[data-lib-file]", { name: "contract.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.selectOption('select[name="category"]', "sale_contract");
  await page.fill('input[name="documentTitle"]', "عقد بيع فيلا الياسمين");
  await page.fill('input[name="referenceNumber"]', "SALE-2026-77");
  await page.fill('input[name="startDate"]', "2026-05-10");
  await page.fill('input[name="expiryDate"]', "2026-05-01");
  await page.locator("[data-lib-save]").click();
  await page.locator('[data-field-error="expiryDate"]:not([hidden])').waitFor();
  check("an expiry before the start date is flagged on its field", libDocs().length === 1);

  step = "upload";
  await page.fill('input[name="expiryDate"]', "2027-05-10");
  await page.locator("[data-lib-save]").click();
  await until(() => libDocs().length === 2, "library doc stored");
  const added = libDocs().find((d) => d.id !== "lib_seed1");
  check("the file is stored with the same fields the old screen wrote", added.officeId === OFFICE_A && added.category === "sale_contract" && added.documentTitle === "عقد بيع فيلا الياسمين" && added.referenceNumber === "SALE-2026-77" && added.startDate === "2026-05-10" && added.expiryDate === "2027-05-10" && added.contentType === "application/pdf" && added.fileSizeBytes === PDF.length && added.createdBy === OWNER_A && /^office-library\/office-alpha\//.test(added.mediaPath), JSON.stringify({ c: added.category, m: added.mediaPath }));
  await page.locator('[data-lib-folder-title]').waitFor();
  check("after upload the folder of that type opens with the new file", (await page.locator("[data-lib-folder-title]").innerText()).includes("عقود البيع") && (await page.locator(`[data-lib-id="${added.id}"]`).count()) === 1);
  await noOverflow(page, "library folder");
  await page.screenshot({ path: path.join(OUT, "02-folder.png"), fullPage: true });

  step = "download";
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator(`[data-lib-download="${added.id}"]`).click()]);
  const bytes = fs.readFileSync(await download.path());
  check("download returns exactly the uploaded bytes (private file served through the Worker)", Buffer.compare(bytes, PDF) === 0 && download.suggestedFilename() === added.fileName, download.suggestedFilename());

  step = "search and filters";
  await page.locator("[data-lib-folders]").click();
  await page.fill('input[name="search"]', "SALE-2026");
  await page.locator('[data-lib-toggle="deals"] .os-badge').waitFor();
  const dealsBadge = await page.locator('[data-lib-toggle="deals"] .os-badge').innerText();
  const brokerageBadge = await page.locator('[data-lib-toggle="brokerage"] .os-badge').innerText();
  check("search by reference number narrows the counts", dealsBadge === "1" && brokerageBadge === "0", `${dealsBadge}/${brokerageBadge}`);
  await page.fill('input[name="search"]', "");
  await page.selectOption('select[name="activeFilter"]', "expired");
  check("the «منتهي» filter hides valid files", (await page.locator('[data-lib-toggle="deals"] .os-badge').innerText()) === "0");
  await page.selectOption('select[name="activeFilter"]', "");

  step = "edit keeps links";
  await page.locator('[data-lib-toggle="brokerage"]').click().catch(() => {});
  await page.locator('[data-lib-category="owner_brokerage"]').click();
  await page.locator('[data-lib-edit="lib_seed1"]').click();
  await page.fill('input[name="documentTitle"]', "عقد وساطة — محدّث");
  await page.selectOption('select[name="documentStatus"]', "PENDING");
  await page.locator("[data-lib-save]").click();
  await until(() => h.store.get(`offices/${OFFICE_A}/library/lib_seed1`)?.documentTitle === "عقد وساطة — محدّث", "edit stored");
  const edited = h.store.get(`offices/${OFFICE_A}/library/lib_seed1`);
  check("editing updates the descriptive fields only; opportunity and cooperation links are untouched", edited.documentStatus === "PENDING" && edited.opportunityId === "opp-keep" && edited.cooperationId === "coop-keep" && edited.fileName === "old.pdf");
  const cardText = await until(async () => { const t = await page.locator('[data-lib-id="lib_seed1"]').innerText().catch(() => ""); return t.includes("عقد وساطة — محدّث") && t.includes("قيد المراجعة") ? t : ""; }, "card redrawn");
  check("the card shows the new title and status", Boolean(cardText));

  step = "delete (manager)";
  await page.locator(`[data-lib-delete="lib_seed1"]`).click();
  await page.getByRole("alertdialog").waitFor();
  await page.getByRole("button", { name: "إلغاء" }).click();
  check("cancelling the delete keeps the file", !!h.store.get(`offices/${OFFICE_A}/library/lib_seed1`));
  await page.locator(`[data-lib-delete="lib_seed1"]`).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "حذف" }).click();
  await until(() => !h.store.get(`offices/${OFFICE_A}/library/lib_seed1`), "deleted");
  check("a manager can delete after confirming", true);

  step = "non-manager";
  const broker = await openAs(BROKER_A2, "library");
  await broker.locator('[data-lib-section="deals"]').waitFor();
  await broker.locator('[data-lib-toggle="deals"]').click();
  await broker.locator('[data-lib-category="sale_contract"]').click();
  await broker.locator(`[data-lib-id="${added.id}"]`).waitFor();
  check("a member sees the office files and can open/edit them", (await broker.locator(`[data-lib-open="${added.id}"]`).count()) === 1 && (await broker.locator(`[data-lib-edit="${added.id}"]`).count()) === 1);
  check("a member has no delete button (managers only)", (await broker.locator("[data-lib-delete]").count()) === 0);
  await noOverflow(broker, "library (member)");
  check("tripwire: the old app was never requested", page.legacy.length === 0 && broker.legacy.length === 0);
} catch (error) {
  check("library journey completed", false, `[${step}] ${String(error?.message || error).split("\n")[0]}`);
} finally {
  await browser.close(); h.server.close();
  check("no browser console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} library checks passed`);
  process.exitCode = failed.length ? 1 : 0;
}
