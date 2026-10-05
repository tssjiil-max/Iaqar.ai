// Office OS — browser check of the office-completion work on the local harness:
// one header, whole logo, the six office tools, the clickable deal path, the unified
// «العروض والطلبات» list, record management (pause/archive/delete) and property photos.
//   node scripts/qa/office-os/completion.e2e.mjs   (OUT_DIR for screenshots)
import path from "node:path";
import fs from "node:fs";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/office-os/completion");
fs.mkdirSync(OUT, { recursive: true });
const { startOfficeOsHarness, OWNER_A, OFFICE_A, OFFICE_B } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));

const h = await startOfficeOsHarness();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const checks = [];
const errors = [];
let step = "start";
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`); };
const until = async (fn, label, timeout = 8000) => { const t = Date.now(); while (Date.now() - t < timeout) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } throw new Error(`timeout: ${label}`); };

/** A real PNG (solid colour) so the browser can decode, resize and re-encode it. */
function png(width, height, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3).map((_, i) => [r, g, b][i % 3])]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const now = Date.now();
const iso = (minutesAgo) => new Date(now - minutesAgo * 60000).toISOString();
const base = { officeId: OFFICE_A, lifecycleStatus: "ACTIVE", brokerId: OWNER_A, assignedBrokerId: OWNER_A, version: 1, city: "الرياض", brokerConfirmed: true, matchingReadiness: "READY_FOR_MATCHING" };
const record = (id, data) => h.store.seed(`offices/${OFFICE_A}/opportunities/${id}`, { ...base, ...data });
record("opp_seed_offer", { opportunityKind: "OFFER", purpose: "RENT", transactionType: "rent", propertyType: "شقة", district: "الملقا", priceOrBudget: 65000, annualRent: 65000, price: 65000, area: 140, rooms: 3, contactName: "سارة المالكة", contactPhone: "0555556666", advertiserRole: "OWNER", createdAt: iso(90), updatedAt: iso(60) });
record("opp_seed_request", { opportunityKind: "REQUEST", purpose: "PURCHASE", transactionType: "sale", propertyType: "شقة", district: "الياسمين", priceOrBudget: 800000, budget: 800000, price: 800000, rooms: 3, contactName: "فهد العميل", contactPhone: "0557778888", advertiserRole: "CLIENT", createdAt: iso(80), updatedAt: iso(70) });
const task = (id, data) => h.store.seed(`offices/${OFFICE_A}/operations/${id}`, { officeId: OFFICE_A, status: "OPEN", assignedBrokerId: OWNER_A, createdAt: iso(30), updatedAt: iso(30), ...data });
task("op_follow", { type: "OPPORTUNITY_FOLLOW_UP", opportunityId: "opp_seed_offer", titleText: "متابعة عرض", summaryText: "تواصل مع المالكة" });
task("op_deal_view", { type: "DEAL_JOURNEY", journeyId: "jr_seed_view", journeyStep: 3, journeyPhase: "VIEWING", opportunityId: "opp_seed_offer", offerId: "opp_seed_offer", titleText: "صفقة", metadataJson: JSON.stringify({ actionLabel: "تفاصيل المعاينة" }) });
h.store.seed(`offices/${OFFICE_A}/journeys/jr_seed_won`, { officeId: OFFICE_A, journeyId: "jr_seed_won", assignedBrokerId: OWNER_A, status: "CLOSED_WON", stage: "CLOSED", offerSummary: { propertyType: "فيلا", city: "الرياض", district: "العارض", price: 3100000 }, outcome: { result: "WON", finalPrice: 3000000, closedAt: iso(60 * 24 * 3) }, closedAt: iso(60 * 24 * 3) });
h.store.seed(`offices/${OFFICE_B}/journeys/jr_other_office`, { officeId: OFFICE_B, journeyId: "jr_other_office", status: "CLOSED_WON", stage: "CLOSED", offerSummary: { propertyType: "قصر", city: "جدة", district: "الشاطئ" }, outcome: { result: "WON", closedAt: iso(10) } });

async function openAs(uid, hash, width = 390) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true });
  await ctx.addInitScript(([u, o]) => { localStorage.setItem("harness.uid", u); localStorage.setItem("iaqar.officeId", o); }, [uid, OFFICE_A]);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: h.origin }).catch(() => {});
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${step}: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`${step}: ${e.message}`));
  await page.goto(`${h.origin}/#/${hash}`);
  return page;
}
async function shot(page, name) {
  await page.waitForTimeout(350);
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  check(`no horizontal scroll: ${name}`, overflow <= 1, `${overflow}px`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}
const go = async (page, hash, wait) => { await page.goto(`${h.origin}/#/${hash}`); await page.reload(); if (wait) await page.locator(wait).first().waitFor(); };

try {
  // 1 — one header on the three main screens
  step = "1: unified header";
  const page = await openAs(OWNER_A, "office");
  await page.locator(".ref-office-tools").waitFor();
  const headerShape = async () => page.evaluate(() => {
    const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return [Math.round(r.width), Math.round(r.height), s.backgroundColor, s.borderRadius].join("|"); };
    return { bell: box(".ref-shell-header .ref-bell"), menu: box(".ref-shell-header .ref-menu"), title: document.querySelector(".ref-shell-title h1")?.textContent };
  });
  const officeHeader = await headerShape();
  await go(page, "tasks", ".ref-path");
  const tasksHeader = await headerShape();
  await go(page, "repo", "[data-record]");
  const repoHeader = await headerShape();
  check("bell and settings have the same shape on المكتب / المهام اليومية / العروض والطلبات", Boolean(officeHeader.bell) && JSON.stringify(officeHeader) === JSON.stringify(tasksHeader) && JSON.stringify(officeHeader) === JSON.stringify(repoHeader), JSON.stringify([officeHeader, tasksHeader, repoHeader]));

  // 2 — office card: long name shown whole, logo never cropped
  step = "2: office card";
  h.store.patch(`offices/${OFFICE_A}`, { officeName: "مكتب سلطان الصاعدي للخدمات والاستشارات العقارية" });
  const narrow = await openAs(OWNER_A, "office", 320);
  await narrow.locator(".ref-office-profile-head h2").waitFor();
  const name = await narrow.evaluate(() => { const el = document.querySelector(".ref-office-profile-head h2"); const s = getComputedStyle(el); return { text: el.textContent, clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1, overflow: s.textOverflow, wrap: s.whiteSpace }; });
  check("a long office name shows in full at 320px (wraps, never «…»)", name.text === "مكتب سلطان الصاعدي للخدمات والاستشارات العقارية" && !name.clipped && name.overflow !== "ellipsis" && name.wrap === "normal", JSON.stringify(name));
  await shot(narrow, "01-office-long-name-320");
  await narrow.context().close();
  h.store.patch(`offices/${OFFICE_A}`, { officeName: "مكتب سلطان العقاري" });

  await go(page, "settings/profile", "[data-photo-card]");
  await page.locator("[data-photo-input]").setInputFiles({ name: "wide-logo.png", mimeType: "image/png", buffer: png(600, 200, [3, 103, 122]) });
  await page.locator("[data-photo-save]").click();
  await page.locator(".os-toast", { hasText: "تم حفظ الصورة" }).waitFor();
  const stored = await until(() => h.store.get(`offices/${OFFICE_A}`).brokerPhotoUrl, "photo stored");
  const corners = await page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    const px = (u, v) => [...x.getImageData(u, v, 1, 1).data].slice(0, 3);
    return { w: img.width, h: img.height, top: px(128, 4), midLeft: px(4, 128), midRight: px(251, 128), bottom: px(128, 251) };
  }, stored);
  const isLogo = (p) => Math.abs(p[0] - 3) < 14 && Math.abs(p[1] - 103) < 14 && Math.abs(p[2] - 122) < 14;
  const isWhite = (p) => p.every((v) => v > 240);
  check("a wide logo is stored whole: both side edges kept, letterboxed top and bottom (no crop)", corners.w === 256 && corners.h === 256 && isLogo(corners.midLeft) && isLogo(corners.midRight) && isWhite(corners.top) && isWhite(corners.bottom), JSON.stringify(corners));
  await go(page, "office", ".ref-office-avatar");
  const fit = await page.evaluate(() => { const s = getComputedStyle(document.querySelector(".ref-office-avatar")); return { fit: s.objectFit, radius: s.borderTopLeftRadius }; });
  check("the office card shows the image with contain fit and no circular mask", fit.fit === "contain" && fit.radius !== "50%", JSON.stringify(fit));
  await shot(page, "02-office-card-logo");

  // 3 — the six office tools all work
  step = "3: office tools";
  check("six tool buttons, none marked «قريبًا» or disabled", (await page.locator("button.ref-office-tool").count()) === 6 && (await page.locator(".ref-office-soon, .ref-office-tool[aria-disabled='true']").count()) === 0);
  const openTool = async (label, wait) => { await go(page, "office", ".ref-office-tools"); await page.locator(`button.ref-office-tool[data-office-tool="${label}"]`).click(); await page.locator(wait).first().waitFor(); };
  await openTool("ملفاتي", "[data-lib-content]");
  check("«ملفاتي» opens the office library", page.url().endsWith("#/library"));
  await openTool("النماذج", "[data-template]");
  const firstTemplate = await page.locator("[data-template-text]").first().inputValue();
  check("«النماذج»: drafts are filled with the office name and link, no raw placeholders", firstTemplate.includes("مكتب سلطان العقاري") && /https?:\/\/\S*sultan/.test(firstTemplate) && !/\{\w+\}/.test(firstTemplate), firstTemplate.replace(/\n/g, " ⏎ ").slice(-90));
  await page.locator("[data-template-copy]").first().click();
  check("«النماذج»: copy puts the draft on the clipboard", (await page.evaluate(() => navigator.clipboard.readText())) === firstTemplate.trim());
  await page.locator('[data-template-group="client"]').click();
  check("«النماذج»: groups switch (للعميل)", (await page.locator('[data-template="client-received"]').count()) === 1);
  await shot(page, "03-tool-forms");
  await openTool("الدليل", "[data-guide-step]");
  check("«الدليل»: seven working steps for a manager", (await page.locator("[data-guide-step]").count()) === 7);
  await page.locator('[data-guide-step="match"] button').click();
  await page.locator('.ref-step[data-step="0"][aria-pressed="true"]').waitFor();
  check("«الدليل»: a step opens its screen (مرحلة التطابق)", page.url().includes("#/tasks?step=0"));
  await openTool("الخدمات", "[data-service]");
  const services = await page.locator("[data-service]").evaluateAll((els) => els.map((a) => [a.href, a.target, a.rel]));
  check("«الخدمات»: official https links that open outside the app", services.length === 6 && services.every(([href, target, rel]) => /^https:\/\/[a-z0-9.-]+\.sa\/?$/.test(href) && target === "_blank" && rel.includes("noopener")), JSON.stringify(services.map((s) => s[0])));
  await shot(page, "04-tool-services");
  await openTool("الحاسبة", "[data-calc-result]");
  await page.fill('input[name="amount"]', "1000000");
  await page.locator('[data-calc-row="buyerTotal"]').waitFor();
  const row = async (id) => (await page.locator(`[data-calc-row="${id}"] b`).innerText()).replace(/[^\d.]/g, "");
  check("«الحاسبة»: sale of 1,000,000 → 25,000 commission, 3,750 VAT, 50,000 tax, 1,078,750 total", (await row("commission")) === "25000" && (await row("commissionVat")) === "3750" && (await row("transferTax")) === "50000" && (await row("buyerTotal")) === "1078750");
  await page.locator('[data-calc-kind="rent"]').click();
  check("«الحاسبة»: rent has no transaction tax row", (await page.locator('[data-calc-row="transferTax"]').count()) === 0 && (await row("commission")) === "25000");
  await shot(page, "05-tool-calculator");
  await openTool("السوق", "[data-market-stat]");
  const stats = await page.locator("[data-market-stat] b").allInnerTexts();
  check("«السوق»: counts come from this office's own active records", stats.join("|") === "2|1|1", stats.join("|"));
  check("«السوق»: a request with no matching offer is listed as a gap", (await page.locator("[data-market-gap]").count()) === 1);
  await shot(page, "06-tool-market");
  await page.goto(`${h.origin}/#/tools/unknown`); await page.locator(".ref-office-tools").waitFor();
  check("an unknown tool address returns to the office page (no blank screen)", page.url().endsWith("#/office"));

  // 4 — the deal path is interactive
  step = "4: deal path";
  await go(page, "tasks", ".ref-step");
  check("six stage buttons", (await page.locator(".ref-step").count()) === 6);
  const counts = await page.locator(".ref-step").evaluateAll((els) => els.map((el) => el.querySelector(".ref-step-count")?.textContent || "0"));
  check("stage badges count the tasks in each stage and the closed deals of this office only", counts.join("|") === "0|0|1|1|0|1", counts.join("|"));
  await page.locator('.ref-step[data-step="3"]').click();
  await page.locator("[data-stage-head]").waitFor();
  check("pressing «معاينة» lists only viewing-stage tasks", (await page.locator("[data-task]").count()) === 1 && (await page.locator('[data-task="op_deal_view"]').count()) === 1 && page.url().includes("step=3"));
  await shot(page, "07-path-viewing");
  await page.locator('.ref-step[data-step="1"]').click();
  check("an empty stage says so instead of showing other tasks", (await page.locator("[data-task]").count()) === 0 && (await page.locator(".os-empty").count()) === 1);
  await page.locator('.ref-step[data-step="5"]').click();
  await page.locator("[data-closed-deal]").first().waitFor();
  check("«إغلاق» lists the office's closed deals — never another office's", (await page.locator("[data-closed-deal]").count()) === 1 && (await page.locator('[data-closed-deal="jr_other_office"]').count()) === 0 && (await page.locator("body").innerText()).includes("تمت الصفقة"));
  await shot(page, "08-path-closed");
  await page.locator("[data-stage-all]").click();
  check("«عرض كل المهام» clears the stage", (await page.locator("[data-task]").count()) === 2 && !page.url().includes("step="));
  await page.goto(`${h.origin}/#/tasks?step=5`); await page.reload();
  await page.locator('.ref-step[data-step="5"][aria-pressed="true"]').waitFor();
  check("a stage survives reload (deep link ?step=5)", (await page.locator("[data-closed-deal]").count()) === 1);

  // 6 — one list for offers and requests
  step = "6: unified repository";
  await go(page, "repo", "[data-record]");
  check("one list: no section tabs", (await page.locator(".ref-repo-tools .os-seg").count()) === 0 && !(await page.locator("body").innerText()).includes("جميع السجلات"));
  const labels = await page.locator("[data-record] [data-kind-label]").allInnerTexts();
  check("offers and requests are listed together, each labelled «عرض» or «طلب»", labels.includes("عرض") && labels.includes("طلب") && labels.every((t) => t === "عرض" || t === "طلب"), labels.join("|"));
  await page.locator("[data-repo-filters] > summary").click();
  await page.locator('[data-tab="REQUEST"]').click();
  check("kind filter under «خيارات البحث» narrows to requests", (await page.locator("[data-record] [data-kind-label]").allInnerTexts()).every((t) => t === "طلب") && (await page.locator("[data-filters-on]").isVisible()));
  await page.locator("[data-filters-clear]").click();
  check("«مسح الفلاتر» restores the full list", (await page.locator("[data-record]").count()) === 2);
  await page.fill('input[name="q"]', "الياسمين");
  check("search works across offers and requests", (await page.locator("[data-record]").count()) === 1 && (await page.locator('[data-record="opp_seed_request"]').count()) === 1);
  await page.fill('input[name="q"]', "");
  await shot(page, "09-repository-unified");

  // 8 — a new offer with photos
  step = "8: property photos";
  await page.locator(".ref-add-record").click();
  await page.getByRole("button", { name: "إضافة عرض" }).click();
  await page.locator("[data-photo-picker]").waitFor();
  await page.locator(".os-seg[aria-label='الغرض'] button", { hasText: "بيع" }).click();
  await page.fill('input[name="propertyType"]', "فيلا");
  await page.fill('input[name="district"]', "حطين");
  await page.fill('input[name="price"]', "3100000");
  await page.fill('input[name="contactName"]', "مالك الصور");
  await page.fill('input[name="contactPhone"]', "0554440000");
  await page.locator("[data-photo-files]").setInputFiles([
    { name: "front.png", mimeType: "image/png", buffer: png(2400, 1600, [200, 40, 40]) },
    { name: "hall.png", mimeType: "image/png", buffer: png(800, 600, [40, 160, 60]) },
    { name: "garden.png", mimeType: "image/png", buffer: png(640, 480, [40, 60, 200]) }
  ]);
  await until(async () => (await page.locator("[data-photo]").count()) === 3, "three previews");
  check("three photos preview before saving; nothing is uploaded yet", h.server.workerCalls.filter((c) => c.path.includes("/media/record-image")).length === 0 && (await page.locator("[data-photo-new]").count()) === 3);
  await page.locator("[data-photo]").nth(2).locator('[data-photo-action="main"]').click();
  await page.locator("[data-photo]").nth(2).locator('[data-photo-action="remove"]').click();
  check("choose the main photo and remove one before saving", (await page.locator("[data-photo]").count()) === 2 && (await page.locator("[data-photo].is-main").count()) === 1);
  await shot(page, "10-offer-form-photos");
  await page.locator("[data-photo-files]").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") });
  await page.locator("[data-photo-error]").filter({ hasText: "JPG" }).waitFor();
  check("a non-image file is refused with a clear message", (await page.locator("[data-photo]").count()) === 2);
  await page.getByRole("button", { name: "حفظ وفحص المطابقات" }).click();
  await page.locator("[data-gallery]").waitFor();
  const newId = decodeURIComponent(page.url().split("#/record/")[1]);
  const savedRecord = h.store.get(`offices/${OFFICE_A}/opportunities/${newId}`);
  check("the offer is saved with two photos linked to the record and the office", savedRecord.imageCount === 2 && savedRecord.images.every((i) => i.path.startsWith(`record-media/${OFFICE_A}/${newId}/`)) && savedRecord.coverUrl === savedRecord.images[0].url);
  const mainPixel = await page.evaluate(async () => {
    const img = document.querySelector("[data-gallery-main] img"); await img.decode();
    const c = document.createElement("canvas"); c.width = 4; c.height = 4; const x = c.getContext("2d"); x.drawImage(img, 0, 0, 4, 4);
    return { rgb: [...x.getImageData(1, 1, 1, 1).data].slice(0, 3), w: img.naturalWidth, h: img.naturalHeight };
  });
  check("the chosen main photo is the cover, and it loads from the Worker", mainPixel.rgb[2] > 150 && mainPixel.rgb[0] < 90 && mainPixel.w === 640, JSON.stringify(mainPixel));
  const bigKey = savedRecord.images.find((i) => i.id !== savedRecord.images[0].id);
  const bigSize = await page.evaluate(async (src) => { const img = new Image(); img.src = src; await img.decode(); return [img.naturalWidth, img.naturalHeight]; }, bigKey.url);
  check("a 2400×1600 photo is resized to 1600 on its long edge and stored as a light JPEG", bigSize[0] === 1600 && bigSize[1] === 1067 && bigKey.contentType === "image/jpeg" && bigKey.bytes < 450 * 1024, `${bigSize.join("x")} ${bigKey.bytes}B`);
  await shot(page, "11-offer-with-photos");
  await go(page, "repo", `[data-record="${newId}"]`);
  check("the repository card shows the cover photo", (await page.locator(`[data-record="${newId}"] .ref-photo img`).count()) === 1);

  // edit: reorder + remove a photo
  await go(page, `record/${newId}/edit`, "[data-photo]");
  check("editing shows the saved photos", (await page.locator("[data-photo]").count()) === 2 && (await page.locator("[data-photo-new]").count()) === 0);
  await page.locator("[data-photo]").nth(0).locator('[data-photo-action="remove"]').click();
  await page.getByRole("button", { name: "حفظ التعديلات" }).click();
  await page.locator("[data-gallery]").waitFor();
  const afterEdit = await until(() => { const r = h.store.get(`offices/${OFFICE_A}/opportunities/${newId}`); return r.imageCount === 1 ? r : null; }, "photo removed");
  check("removing a photo on edit updates the record and deletes the file", afterEdit.images[0].id === bigKey.id && afterEdit.coverUrl === bigKey.url && !h.env.IAQAR_MEDIA.keys().includes(savedRecord.images[0].path));
  check("a request form has no photo picker", await (async () => { await go(page, "record/new?kind=REQUEST", 'input[name="price"]'); return page.locator("[data-photo-picker]").isHidden(); })());

  // 7 — manage a record
  step = "7: record management";
  await go(page, "record/opp_seed_request", "[data-record-actions]");
  const actionsFor = async () => page.locator("[data-record-action]").evaluateAll((els) => els.map((el) => el.dataset.recordAction).join(","));
  check("an active record offers تعديل · إيقاف · أرشفة · حذف", (await actionsFor()) === "edit,pause,archive,delete");
  await page.locator('[data-record-action="pause"]').click();
  await page.locator(".os-dialog").waitFor();
  await page.locator(".os-dialog .os-btn.secondary").click();
  check("cancelling the confirmation changes nothing", h.store.get(`offices/${OFFICE_A}/opportunities/opp_seed_request`).lifecycleStatus === "ACTIVE");
  await page.locator('[data-record-action="pause"]').click();
  await page.locator(".os-dialog .os-btn.primary").click();
  await page.locator('[data-record-state="PAUSED"]').waitFor();
  check("pause: the record is «موقوف مؤقتًا» and offers استئناف", (await actionsFor()) === "edit,resume,archive,delete" && h.store.get(`offices/${OFFICE_A}/opportunities/opp_seed_request`).archiveKind === "PAUSED");
  await shot(page, "12-record-paused");
  await go(page, "repo", "[data-record]");
  check("a paused record leaves the active list", (await page.locator('[data-record="opp_seed_request"]').count()) === 0);
  await page.locator("[data-repo-filters] > summary").click();
  await page.selectOption('select[name="status"]', "PAUSED");
  await page.locator('[data-record="opp_seed_request"] [data-state-label="PAUSED"]').waitFor();
  check("…and is found under «الموقوفة مؤقتًا» with a state label", (await page.locator("[data-record]").count()) === 1);
  await go(page, "record/opp_seed_request", "[data-record-actions]");
  await page.locator('[data-record-action="resume"]').click();
  await page.locator('[data-record-state="ACTIVE"]').waitFor();
  check("resume returns it to the active list", h.store.get(`offices/${OFFICE_A}/opportunities/opp_seed_request`).lifecycleStatus === "ACTIVE");
  await page.locator('[data-record-action="archive"]').click();
  await page.locator(".os-dialog .os-btn.primary").click();
  await page.locator('[data-record-state="ARCHIVED"]').waitFor();
  check("archive: «مؤرشف», with إعادة للنشطة and حذف", (await actionsFor()) === "edit,restore,delete");
  await page.locator('[data-record-action="delete"]').click();
  await page.locator(".os-dialog .os-btn.danger").click();
  await until(() => h.store.get(`offices/${OFFICE_A}/opportunities/opp_seed_request`).lifecycleStatus === "DELETED", "soft delete");
  const gone = h.store.get(`offices/${OFFICE_A}/opportunities/opp_seed_request`);
  check("delete asks first and is a soft delete (the document and its data stay)", Boolean(gone.deletedAt) && gone.contactName === "فهد العميل");
  const audit = h.store.list(`offices/${OFFICE_A}/auditLogs`).map((e) => e.action);
  check("the audit trail has pause, restore, archive, delete and photo changes", ["RECORD_PAUSED", "RECORD_RESTORED", "RECORD_ARCHIVED", "RECORD_DELETED", "RECORD_MEDIA_UPDATED", "RECORD_CREATED"].every((a) => audit.includes(a)), [...new Set(audit)].join(","));

  check("no browser console errors", errors.length === 0, errors.slice(0, 4).join(" | "));
} catch (error) {
  check(`completed without exception (step ${step})`, false, error.message.split("\n")[0]);
  try { const pages = browser.contexts().flatMap((c) => c.pages()); if (pages.length) await pages.at(-1).screenshot({ path: path.join(OUT, "zz-failure.png"), fullPage: true }); } catch (_) { /* ignore */ }
} finally {
  await browser.close();
  h.server.close();
}
const failed = checks.filter((c) => !c.ok);
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ at: new Date().toISOString(), passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
