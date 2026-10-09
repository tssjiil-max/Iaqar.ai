// «جرّب مدير مكتبك» in a real browser (local harness, real Worker, in-memory store): the client's and the
// owner's try-outs as they happened, with a slow network (each answer takes 1.2 s) and fast presses/typing.
// Nothing leaves the machine; nothing is saved.   node scripts/qa/office-os/agent-try.e2e.mjs
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/office-os/agent-try");
fs.mkdirSync(OUT, { recursive: true });
const { startOfficeOsHarness, OWNER_A, OFFICE_A } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const { callWorker } = await import(path.join(ROOT, "scripts/qa/office-os/seed.mjs"));
const h = await startOfficeOsHarness();
await callWorker(h, "/os/agent/settings", { officeId: OFFICE_A, enabled: true }, OWNER_A);
h.store.patch(`offices/${OFFICE_A}`, { city: "المدينة المنورة" });
const recordsBefore = h.store.list(`offices/${OFFICE_A}/opportunities`).length;

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const checks = [];
const errors = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok) }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`); };
const WELCOME = /هل أنت مالك عقار، أو وسيط عقاري، أو عميل/;
try {
  for (const width of [320, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, locale: "ar-SA", hasTouch: true });
    await ctx.addInitScript(([u, o]) => { localStorage.setItem("harness.uid", u); localStorage.setItem("iaqar.officeId", o); }, [OWNER_A, OFFICE_A]);
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    // Staging-like latency on every answer.
    await page.route("**/os/agent/preview", async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.continue(); });
    await callWorker(h, "/os/agent/preview", { officeId: OFFICE_A, action: "reset" }, OWNER_A);
    await page.goto(`${h.origin}/#/agent/try`);
    const replies = () => page.locator("[data-try-reply]");
    await page.locator('[data-try-button="vp:CLIENT"]').waitFor();
    const before = await replies().count();
    const welcomesAfterPress = async () => (await replies().allInnerTexts()).slice(before).filter((t) => WELCOME.test(t) || /اختر من الأزرار/.test(t)).length;

    // The client: press, then type at once (before the answer arrives) — both are handled, in order.
    await page.locator('[data-try-button="vp:CLIENT"]').click();
    await page.locator("[data-try-input]").fill("أبي شقة 3 غرف للإيجار");
    await page.locator("[data-try-send]").click();
    await page.waitForFunction(() => /في أي حي/.test(document.querySelector("[data-try-thread]").innerText), null, { timeout: 15000 });
    check(`${width}px · client: «عميل يبحث عن عقار» then a message — never asked who he is again`, (await welcomesAfterPress()) === 0, String(await welcomesAfterPress()));
    check(`${width}px · client: the press disabled its buttons (a second press sends nothing)`, await page.locator('[data-try-button="vp:OWNER"]').first().isDisabled());
    const texts = (await replies().allInnerTexts()).join("\n");
    check(`${width}px · client: asked for the request, then the district`, /وش تدور عليه/.test(texts) && /في أي حي/.test(texts));
    const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
    check(`${width}px · no horizontal scroll`, overflow <= 1, `${overflow}px`);
    await page.screenshot({ path: path.join(OUT, `${width}-client.png`), fullPage: true });

    // Reopening the page continues (no welcome, the question again).
    await page.goto(`${h.origin}/#/office`);
    await page.goto(`${h.origin}/#/agent/try`);
    await page.locator("[data-try-reply]").first().waitFor();
    const reopened = (await replies().allInnerTexts()).join("\n");
    check(`${width}px · reopening continues the same conversation`, !WELCOME.test(reopened) && /في أي حي/.test(reopened), reopened.slice(0, 80));

    // The owner, from the start, with the real message.
    await page.locator("[data-try-restart]").click();
    await page.locator('[data-try-button="vp:OWNER"]').last().waitFor();
    await page.locator('[data-try-button="vp:OWNER"]').last().click();
    await page.waitForFunction(() => /وش العقار اللي تبي تعرضه/.test(document.querySelector("[data-try-thread]").innerText));
    const say = async (text, until) => { await page.locator("[data-try-input]").fill(text); await page.locator("[data-try-send]").click(); await page.waitForFunction((re) => new RegExp(re).test(document.querySelector("[data-try-thread]").innerText), until); };
    await say("عندي شقة غرفتين وصالة ومطبخ صغير ودورة مياه للإيجار السنوي في الوبرة", "حي الوبرة في المدينة المنورة؟");
    await say("نعم", "كم السعر المطلوب");
    await say("30 ألف", "مشاركة رقمي");
    await page.locator("[data-try-phone]").fill("0556700099");
    await page.locator("[data-try-share]").click();
    await page.waitForFunction(() => /ملخص عرضك/.test(document.querySelector("[data-try-thread]").innerText));
    const summary = (await replies().allInnerTexts()).at(-1);
    const parts = ["عرض عقار", "شقة للإيجار سنوي", "الوبرة، المدينة المنورة", "السعر: 30,000", "الغرف: 2", "صالة", "مطبخ صغير", "دورة مياه واحدة"];
    check(`${width}px · owner: the summary has every detail`, parts.every((p) => summary.includes(p)), parts.filter((p) => !summary.includes(p)).join("، "));
    await page.locator('[data-try-button="vc:SAVE"]').last().click();
    await page.waitForFunction(() => /معاينة ✅/.test(document.querySelector("[data-try-thread]").innerText));
    await page.screenshot({ path: path.join(OUT, `${width}-owner.png`), fullPage: true });
    check(`${width}px · owner: the try-out ends without saving`, h.store.list(`offices/${OFFICE_A}/opportunities`).length === recordsBefore);
    await ctx.close();
  }
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (error) {
  check("the try-out ran to the end", false, error.message);
} finally {
  await browser.close();
  h.server.close();
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} try-out checks passed`);
process.exit(failed ? 1 : 0);
