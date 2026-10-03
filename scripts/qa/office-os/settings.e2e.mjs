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
const jpegInfo = (b) => { if (b[0] !== 0xff || b[1] !== 0xd8) return { ok: false }; let i = 2; while (i < b.length) { if (b[i] !== 0xff) { i++; continue; } const m = b[i + 1]; if (m >= 0xc0 && m <= 0xc3) return { ok: true, h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; i += 2 + b.readUInt16BE(i + 2); } return { ok: false }; };
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
h.env.IAQAR_MEDIA = { put: async (key, bytes, meta) => { bucket.set(key, { bytes: Buffer.from(bytes), meta }); }, get: async (key) => (bucket.has(key) ? { body: bucket.get(key).bytes, writeHttpMetadata(h) { const t = bucket.get(key).meta?.httpMetadata?.contentType; if (t) h.set("content-type", t); } } : null) };
try {
  const page = await openAs(OWNER_A, "settings");
  await page.route("**/worker/office/channels/status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, automationMode: "ASSISTED", outboundEnabled: false, channels: [{ id: "whatsapp", status: "connected", displayPhoneNumber: "••••••1234", inboundMessagesToday: 3, inboundOnly: true }, { id: "telegram", status: "disconnected", inboundOnly: true }] }) }));
  await page.locator(".os-set-row").first().waitFor();
  check("hub lists the seven settings pages", (await page.locator(".os-set-row").count()) === 7);
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
  const previewShareUrl = await page.locator("[data-share-link]").getAttribute("data-preview-url");
  check("WhatsApp share uses the immutable versioned /s link", /\/s\/sultan-new\/[a-z0-9_-]+$/i.test(previewShareUrl || "") && !(previewShareUrl || "").includes("?v="), previewShareUrl || "");
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
  // صورة معاينة الرابط (what WhatsApp shows) — immutable page + immutable JPEG.
  const slugNow = h.store.get(`offices/${OFFICE_A}`).publicSlug;
  await page.goto(`${h.origin}/#/settings/link`);
  const published = await until(() => {
    const row = h.store.get(`publicOffices/${OFFICE_A}`);
    return row?.sharePreviewFormat === "immutable-v2" && row?.shareCardNonce ? row : null;
  }, "immutable preview metadata saved");
  const nonceBefore = published.shareCardNonce;
  const keyBefore = `office-share/${OFFICE_A.toLowerCase()}/${nonceBefore.toLowerCase()}.jpg`;
  const card = await until(() => bucket.get(keyBefore)?.bytes, "photo uploaded as immutable preview image");
  check("preview image is a 1200×630 rectangular JPEG under 300KB at the immutable office/version key",
    jpegInfo(card).ok && jpegInfo(card).w === 1200 && jpegInfo(card).h === 630 && card.length < 300000,
    `${card.length} bytes · ${keyBefore}`);
  fs.writeFileSync(path.join(OUT, "share-photo.jpg"), card);
  await page.locator("[data-share-card-preview]:not([hidden])").waitFor();
  check("link page shows the current preview image", !(await page.locator("[data-share-card-preview]").isHidden()));
  await until(() => h.store.get(`publicOffices/${OFFICE_A}`)?.sharePhoto === true, "public mirror flags the photo");

  const shareBefore = await page.locator("[data-share-link]").getAttribute("data-preview-url");
  check("published share URL is /s/<slug>/<version>", shareBefore?.endsWith(`/s/${slugNow}/${nonceBefore}`), shareBefore || "");

  await page.locator("[data-share-card-refresh]").click();
  const nonceAfter = await until(() => {
    const value = h.store.get(`publicOffices/${OFFICE_A}`)?.shareCardNonce;
    return value && value !== nonceBefore ? value : null;
  }, "forced refresh gives a new version");
  const keyAfter = `office-share/${OFFICE_A.toLowerCase()}/${nonceAfter.toLowerCase()}.jpg`;
  await until(() => bucket.get(keyAfter)?.bytes, "new immutable JPEG stored");
  check("forced refresh creates a new share URL and a new image while preserving the old image",
    bucket.has(keyBefore) && bucket.has(keyAfter) && keyBefore !== keyAfter);
  const savedMedia = h.env.IAQAR_MEDIA;
  h.env.IAQAR_MEDIA = undefined;
  await page.locator("[data-share-card-refresh]").click();
  await page.locator("[data-share-card-status].is-error").waitFor();
  check("when the upload fails the page says why (status code), not silence", (await page.locator("[data-share-card-status]").innerText()).includes("503"));
  h.env.IAQAR_MEDIA = savedMedia;
  { const i = errors.findIndex((e) => /503/.test(e)); if (i >= 0) errors.splice(i, 1); } // the deliberate failure above
  const crawl = async () => (await (await fetch(`${h.origin}/worker/m/${slugNow}`, { headers: { "user-agent": "WhatsApp/2.23" } })).text());
  let og = await crawl();
  check("crawler gets this office's title, description (مرخص), type and url", og.includes('og:title" content="مكتب سلطان للتسويق العقاري"') && og.includes('og:description" content="مكتب عقاري مرخص في الرياض"') && og.includes('og:type" content="website"') && og.includes(`/m/${slugNow}"`));
  check("og:image points to this office/version immutable JPEG",
    new RegExp(`og:image" content="[^"]*/share/office/${OFFICE_A}/${nonceAfter}\\.jpg`).test(og));
  const imageUrl = og.match(/og:image" content="([^"]+)"/)[1];
  const imageResponse = await fetch(imageUrl.replace(/^https?:\/\/[^/]+/, `${h.origin}/worker`));
  check("the image opens directly without login (200 image/jpeg)", imageResponse.status === 200 && /image\/jpeg/.test(imageResponse.headers.get("content-type") || ""), `${imageResponse.status}`);
  const redirect = await fetch(`${h.origin}/worker/m/${slugNow}`, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (Android)" } });
  check("a person is sent on to the office page", redirect.status === 302);
  // public office page footer
  const visitor = await openAs(OWNER_A, "");
  await visitor.goto(`${h.origin}/o/${slugNow}`);
  await visitor.locator("[data-powered-by]").waitFor();
  const footerText = await visitor.locator("[data-powered-by]").innerText();
  check("public page footer: «مدعوم بواسطة مكاتب عقارية ذكية» + «أنشئ مكتبك العقاري» (no domain name)", footerText.includes("مدعوم بواسطة مكاتب عقارية ذكية") && footerText.includes("أنشئ مكتبك العقاري") && !/iaqar/i.test(footerText) && (await visitor.locator("[data-create-office]").getAttribute("href")) === "/#/register");
  check("the office name stays the main element (title above footer)", await visitor.evaluate(() => { const t = document.querySelector(".os-public-title"), f = document.querySelector("[data-powered-by]"); return parseFloat(getComputedStyle(t).fontSize) > parseFloat(getComputedStyle(f).fontSize) * 1.8; }));
  await visitor.screenshot({ path: path.join(OUT, "09-public-office-footer.png"), fullPage: true });
  await page.goto(`${h.origin}/#/settings/profile`);
  await page.locator("[data-photo-remove]").click();
  await page.locator(".os-toast", { hasText: "تم حذف الصورة" }).waitFor();
  await until(() => h.store.get(`offices/${OFFICE_A}`).brokerPhotoUrl === "", "photo removed");
  await page.goto(`${h.origin}/#/office`);
  await page.locator(".ref-office-logo-mark").first().waitFor();
  await page.goto(`${h.origin}/#/settings/link`);
  await until(() => h.store.get(`publicOffices/${OFFICE_A}`)?.sharePhoto === false, "photo removed from the preview");
  const fallbackVersion = await until(() => {
    const row = h.store.get(`publicOffices/${OFFICE_A}`);
    return row?.sharePreviewFormat === "immutable-v2" && row?.shareCardNonce && row.shareCardNonce !== nonceAfter ? row.shareCardNonce : null;
  }, "photo removal publishes a new fallback version");
  check("without a photo the link page still has a generated preview card", !(await page.locator("[data-share-card-preview]").isHidden()));
  og = await (await fetch(`${h.origin}/worker/m/${slugNow}`, { headers: { "user-agent": "WhatsApp/2.23" } })).text();
  const fbUrl = (og.match(/og:image" content="([^"]+)"/) || [])[1] || "";
  const fbRes = fbUrl ? await fetch(fbUrl.replace(/^https?:\/\/[^/]+/, `${h.origin}/worker`)) : null;
  const fallbackKey = `office-share/${OFFICE_A.toLowerCase()}/${fallbackVersion.toLowerCase()}.jpg`;
  check("without a photo og:image is a new immutable JPEG fallback, never the removed-photo version",
    fbUrl.endsWith(`/share/office/${OFFICE_A}/${fallbackVersion}.jpg`)
      && fallbackVersion !== nonceAfter
      && bucket.has(fallbackKey)
      && fbRes?.status === 200
      && /image\/jpeg/.test(fbRes.headers.get("content-type") || ""));
  await page.goto(`${h.origin}/#/office`);
  await page.locator(".ref-office-logo-mark").first().waitFor();
  check("after removal the default mark returns (no avatar)", (await page.locator("[data-broker-avatar]").count()) === 0);

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

  // الإشعارات (moved from the old settings screen; same storage)
  await page.goto(`${h.origin}/#/settings`);
  await page.locator(".os-set-row").first().waitFor();
  check("the settings hub has the «الإشعارات» row", (await page.locator('[data-settings="notifications"]').count()) === 1);
  await page.locator('[data-settings="notifications"]').click();
  await page.locator("[data-pref]").first().waitFor();
  check("six notification kinds, all on by default", (await page.locator("[data-pref]").count()) === 6 && (await page.locator("[data-pref]:checked").count()) === 6);
  await page.locator('[data-pref="matchNotifications"]').uncheck();
  await page.locator("[data-pref-save]").click();
  await page.locator(".os-alert.ok").waitFor();
  const officePrefs = h.store.get(`offices/${OFFICE_A}/officeSettings/notifications`) || {};
  const ownPrefs = h.store.get(`offices/${OFFICE_A}/brokerSettings/${OWNER_A}`) || {};
  check("a manager saves the office default and their own preference", officePrefs.matchNotifications === false && officePrefs.messageNotifications === true && ownPrefs.matchNotifications === false && officePrefs.officeId === OFFICE_A);
  check("the saved state says it applies to the office", (await page.locator(".os-alert.ok").innerText()).includes("لهذا المكتب"));
  await page.reload();
  await page.locator("[data-pref]").first().waitFor();
  check("after reload the switch stays off", !(await page.locator('[data-pref="matchNotifications"]').isChecked()) && (await page.locator("[data-pref]:checked").count()) === 5);
  await shot(page, "07-notifications");
  const memberPage = await openAs(BROKER_A2, "settings/notifications");
  await memberPage.locator("[data-pref]").first().waitFor();
  await memberPage.locator('[data-pref="messageNotifications"]').uncheck();
  await memberPage.locator("[data-pref-save]").click();
  await memberPage.locator(".os-alert.ok").waitFor();
  check("a non-manager saves only their own preference and is told so", (h.store.get(`offices/${OFFICE_A}/brokerSettings/${BROKER_A2}`) || {}).messageNotifications === false && (h.store.get(`offices/${OFFICE_A}/officeSettings/notifications`) || {}).messageNotifications === true && (await memberPage.locator(".os-alert.ok").innerText()).includes("لحسابك فقط"));

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
