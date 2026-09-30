// جلسة التفاوض — browser check on the local harness (real Worker, in-memory store):
// owner and client pages side by side, broker view, live updates without reload.
//   node scripts/qa/office-os/session.e2e.mjs   (OUT_DIR for screenshots)
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/office-os/session");
fs.mkdirSync(OUT, { recursive: true });
const { startOfficeOsHarness, OWNER_A, OFFICE_A } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const { seedStates, callWorker } = await import(path.join(ROOT, "scripts/qa/office-os/seed.mjs"));

const h = await startOfficeOsHarness();
const s = await seedStates(h);
const jid = s.negotiation.journeyId;
const token = (url) => String(url).split("#")[1];
const links = (await callWorker(h, "/os/session/links", { officeId: OFFICE_A, journeyId: jid })).links;

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const device = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true, isMobile: true };
const results = [];
const errors = [];
async function step(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: String(error.message).split("\n")[0] }); console.log(`FAIL ${name} — ${String(error.message).split("\n")[0]}`); }
}
async function pageFor(url, auth = false) {
  const ctx = await browser.newContext(device);
  if (auth) await ctx.addInitScript(([uid, office]) => { localStorage.setItem("harness.uid", uid); localStorage.setItem("iaqar.officeId", office); }, [OWNER_A, OFFICE_A]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(`${url}: ${e.message}`));
  await page.goto(`${h.origin}${url}`);
  return page;
}

const owner = await pageFor(`/s#${token(links.owner.url)}`);
const client = await pageFor(`/s#${token(links.client.url)}`);
const broker = await pageFor(`/#/session/${jid}`, true);

await step("both party pages open without login and show only role labels", async () => {
  await owner.locator(".os-session-summary").waitFor();
  await client.locator(".os-session-summary").waitFor();
  const text = await owner.locator("body").innerText();
  if (/05\d{8}|الاختباري/.test(text)) throw new Error("personal data visible on the owner page");
  if (!(await owner.getByText("أنت: المالك").count())) throw new Error("role chip missing");
  await owner.screenshot({ path: path.join(OUT, "owner-start.png") });
});

await step("client −5% appears on the owner page live (no reload)", async () => {
  await client.locator('[data-session-action="minus5"]').click();
  await client.getByText("بانتظار رد المالك").waitFor();
  await owner.locator(".os-session-event", { hasText: "اقترح سعرًا أقل بـ 5%" }).waitFor({ timeout: 9000 });
  await owner.locator('[data-session-action="plus2"]').waitFor();
  await client.screenshot({ path: path.join(OUT, "client-waiting.png") });
});

await step("owner compromise shows the computed average and updates the client", async () => {
  const label = await owner.locator('[data-session-action="compromise"] small').innerText();
  if (!/ريال/.test(label)) throw new Error(`no computed price on the button: ${label}`);
  await owner.locator('[data-session-action="compromise"]').click();
  await client.locator(".os-session-event", { hasText: "اقترح حلًا وسطًا" }).waitFor({ timeout: 9000 });
});

await step("typed price takes digits only", async () => {
  await client.locator('[data-session-action="manual"]').click();
  const input = client.locator('input[name="price"]');
  await input.fill("2,300,000 آخر سعر");
  const value = await input.inputValue();
  if (/[^\d,٠-٩]/.test(value)) throw new Error(`letters kept: ${value}`);
  await client.screenshot({ path: path.join(OUT, "client-typed.png") });
  await client.locator('[data-session-send="manual"]').click();
  await owner.locator(".os-session-event", { hasText: "اقترح سعرًا" }).first().waitFor({ timeout: 9000 });
});

await step("intervention → broker view flags it live and resolves it", async () => {
  await owner.locator('[data-session-action="intervention"]').click();
  await broker.getByText("طلب المالك تدخل الوسيط").waitFor({ timeout: 9000 });
  const task = h.store.list(`offices/${OFFICE_A}/operations`).find((op) => op.type === "SESSION_INTERVENTION" && op.status === "OPEN");
  if (!task) throw new Error("no SESSION_INTERVENTION task");
  await broker.screenshot({ path: path.join(OUT, "broker-intervention.png") });
  await broker.getByRole("button", { name: "تم التدخل" }).click();
  await broker.getByText("طلب المالك تدخل الوسيط").waitFor({ state: "detached" });
});

await step("broker message to the owner only", async () => {
  await broker.getByRole("button", { name: "إلى المالك" }).click();
  await broker.locator(".os-session-composer textarea").fill("رسالة للمالك فقط من الاختبار");
  await broker.locator(".os-session-composer").getByRole("button", { name: "إرسال" }).click();
  await owner.locator(".os-session-event", { hasText: "رسالة للمالك فقط من الاختبار" }).waitFor({ timeout: 9000 });
  await client.waitForTimeout(6000);
  if (await client.getByText("رسالة للمالك فقط من الاختبار").count()) throw new Error("client saw the owner-only message");
});

await step("task and deep link open the same session", async () => {
  await callWorker(h, "/os/session/act", { token: token(links.client.url), action: "intervention", submissionId: "e2e-client-intervention" }, "");
  const task = h.store.list(`offices/${OFFICE_A}/operations`).find((op) => op.type === "SESSION_INTERVENTION" && op.status === "OPEN" && op.journeyId === jid);
  if (!task) throw new Error("no session task");
  const page = await pageFor(`/?openOperation=${encodeURIComponent(task.id)}`, true);
  await page.waitForURL(new RegExp(`#/session/${jid}`), { timeout: 12000 });
  await page.locator(".os-session-summary").waitFor();
});

await browser.close();
h.server.close();
fs.writeFileSync(path.join(OUT, "session-report.json"), JSON.stringify({ at: new Date().toISOString(), results, errors }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} session checks passed; page errors: ${errors.length}`);
process.exitCode = failed.length || errors.length ? 1 : 0;
