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

const bucket = new Map();
h.env.IAQAR_MEDIA = { put: async (key, bytes, meta) => { bucket.set(key, { bytes: Buffer.from(bytes), meta }); }, get: async (key) => (bucket.has(key) ? { body: bucket.get(key).bytes, writeHttpMetadata() {} } : null) };
try {
  const page = await openAs(OWNER_A, "settings");
  await page.route("**/worker/office/channels/status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, automationMode: "ASSISTED", outboundEnabled: false, channels: [{ id: "whatsapp", status: "connected", displayPhoneNumber: "••••••1234", inboundMessagesToday: 3, inboundOnly: true }, { id: "telegram", status: "disconnected", inboundOnly: true }] }) }));
  await page.locator(".os-set-row").first().waitFor();
  check("hub lists the five settings pages", (await page.locator(".os-set-row").count()) === 5);
  check("settings hub has no link to the old app", (await page.locator("a[href*='legacy']").count()) === 0);
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

  // صورة الوسيط
  await page.goto(`${h.origin}/#/settings/profile`);
  await page.locator("[data-photo-card]").waitFor();
  check("no photo yet → default mark, no remove button", (await page.locator("[data-photo-img]").count()) === 0 && await page.locator("[data-photo-remove]").isHidden());
  const bad = path.join(OUT, "bad.exe.txt"); fs.writeFileSync(bad, "MZ");
  await page.setInputFiles("[data-photo-input]", { name: "x.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") });
  await page.locator('[data-error="photo"]').filter({ hasText: "JPG" }).waitFor();
  check("a non-image file is refused with a clear message", (await page.locator("[data-photo-img]").count()) === 0);
  const png = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 900; c.height = 500; const x = c.getContext("2d"); x.fillStyle = "#03677A"; x.fillRect(0, 0, 900, 500); x.fillStyle = "#fff"; x.fillRect(300, 100, 300, 300); return c.toDataURL("image/png").split(",")[1]; });
  await page.setInputFiles("[data-photo-input]", { name: "me.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.locator("[data-photo-img]").waitFor();
  check("preview shows before saving; nothing stored yet", !h.store.get(`offices/${OFFICE_A}`).brokerPhotoUrl);
  await page.locator("[data-photo-save]").click();
  await page.locator(".os-toast", { hasText: "تم حفظ الصورة" }).waitFor();
  const stored = (await until(() => h.store.get(`offices/${OFFICE_A}`).brokerPhotoUrl || null, "photo saved"));
  check("photo stored as a small square JPEG on the office", /^data:image\/jpeg;base64,/.test(stored) && stored.length < 70000, `${stored.length} chars`);
  await shot(page, "07-photo");
  await page.reload(); await page.locator("[data-photo-img]").waitFor();
  check("photo survives reload in settings", true);
  await page.goto(`${h.origin}/#/office`);
  await page.locator("[data-broker-avatar]").waitFor();
  check("avatar shows in the office card and the image is loaded (not broken)", await page.evaluate(() => { const i = document.querySelector("[data-broker-avatar]"); return i.complete && i.naturalWidth > 0; }));
  await shot(page, "08-office-avatar");
  const slugPhoto = h.store.get(`offices/${OFFICE_A}`).publicSlug;
  const beforeCard = bucket.get(`office-share/${slugPhoto}/card.png`)?.bytes;
  await page.goto(`${h.origin}/#/settings/link`);
  const withPhoto = await until(() => { const b = bucket.get(`office-share/${slugPhoto}/card.png`)?.bytes; return b && (!beforeCard || !b.equals(beforeCard)) ? b : null; }, "share card regenerated with the broker photo");
  fs.writeFileSync(path.join(OUT, "share-card-photo.png"), withPhoto);
  check("changing the broker photo regenerates the share card under a new version", true);
  await page.goto(`${h.origin}/#/settings/profile`);
  await page.locator("[data-photo-remove]").click();
  await page.locator(".os-toast", { hasText: "تم حذف الصورة" }).waitFor();
  await until(() => h.store.get(`offices/${OFFICE_A}`).brokerPhotoUrl === "", "photo removed");
  await page.goto(`${h.origin}/#/office`);
  await page.locator(".ref-office-logo-mark").first().waitFor();
  check("after removal the default mark returns (no avatar)", (await page.locator("[data-broker-avatar]").count()) === 0);

  // بطاقة المشاركة (preview image behind the shared link)
  await page.goto(`${h.origin}/#/settings/link`);
  const slugNow = h.store.get(`offices/${OFFICE_A}`).publicSlug;
  await until(() => h.store.get(`publicOffices/${OFFICE_A}`)?.shareCardNonce && bucket.get(`office-share/${slugNow}/card.png`), "share card uploaded for the current slug");
  const card = bucket.get(`office-share/${OFFICE_A}/card.png`).bytes;
  check("share card is a 1200×630 PNG stored for the office and its slug", card.subarray(1, 4).toString() === "PNG" && card.readUInt32BE(16) === 1200 && card.readUInt32BE(20) === 630 && bucket.has(`office-share/${slugNow}/card.png`), `${card.length} bytes ${card.readUInt32BE(16)}x${card.readUInt32BE(20)} keys=${[...bucket.keys()].join(",")} slug=${slugNow}`);
  fs.writeFileSync(path.join(OUT, "share-card.png"), card);
  await page.locator("[data-share-card-preview]:not([hidden])").waitFor();
  check("link page shows the card preview and says it was updated", (await page.locator("[data-share-card-status]").innerText()).includes("بطاقة المعاينة"));
  const nonceBefore = h.store.get(`publicOffices/${OFFICE_A}`).shareCardNonce;
  await page.locator("[data-share-card-refresh]").click();
  await until(() => h.store.get(`publicOffices/${OFFICE_A}`).shareCardNonce !== nonceBefore, "forced refresh gives a new version");
  check("«تحديث بطاقة المعاينة» uploads again under a new version (busts WhatsApp's cache)", true);
  const savedMedia = h.env.IAQAR_MEDIA;
  h.env.IAQAR_MEDIA = undefined;
  await page.locator("[data-share-card-refresh]").click();
  await page.locator("[data-share-card-status].is-error").waitFor();
  check("when the upload fails the page says why (status code), not silence", (await page.locator("[data-share-card-status]").innerText()).includes("503"));
  h.env.IAQAR_MEDIA = savedMedia;
  { const i = errors.findIndex((e) => /503/.test(e)); if (i >= 0) errors.splice(i, 1); } // the deliberate failure above
  const nonce = await until(() => h.store.get(`publicOffices/${OFFICE_A}`)?.shareCardNonce, "nonce on public office");
  check("card version is stored on the office and its public mirror", h.store.get(`offices/${OFFICE_A}`).shareCardNonce === nonce);
  const og = await (await fetch(`${h.origin}/worker/m/${slugNow}`, { headers: { "user-agent": "WhatsApp/2.23" } })).text();
  check("crawler gets the office preview: title, description and the card image", og.includes('og:title" content="مكتب سلطان للتسويق العقاري"') && new RegExp(`og:image" content="[^"]*/share/office/${slugNow}/card-v`).test(og), og.slice(0, 0));
  const redirect = await fetch(`${h.origin}/worker/m/${slugNow}`, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (Android)" } });
  check("a person is sent on to the office page", redirect.status === 302);
  const first = bucket.get(`office-share/${OFFICE_A}/card.png`).meta.customMetadata.officeId;
  check("the card is stored for this office only", first === OFFICE_A);

  // قنوات المكتب
  await page.goto(`${h.origin}/#/settings/channels`);
  await page.locator("[data-channel]").first().waitFor();
  check("channels page shows WhatsApp connected and Telegram not connected", (await page.locator('[data-channel="whatsapp"] [data-channel-status]').getAttribute("data-channel-status")) === "connected" && (await page.locator('[data-channel="telegram"] [data-channel-status]').getAttribute("data-channel-status")) === "disconnected");
  check("channels page states ASSISTED mode and no automatic sending", (await page.locator("[data-automation]").getAttribute("data-automation")) === "ASSISTED" && (await page.locator("[data-automation]").innerText()).includes("غير مفعّل"));
  check("channels page has no legacy link", (await page.locator("a[href*='legacy']").count()) === 0);
  check("channels page never shows a full phone number or secret", !/(token|secret|\d{8,})/i.test(await page.locator(".os-main, main, body").first().innerText()));
  await shot(page, "06-channels");

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
