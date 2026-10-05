// غرفة التفاوض — browser check on the local harness (real Worker, in-memory store):
// owner and client pages side by side, broker view, live updates without reload; the three
// parts of the room, the terms of the property, and requests that reach the broker only.
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

// «تعديل العرض» reveals the quick price moves; the log is a collapsed «السجل» section.
async function openAdjust(page) {
  if ((await page.locator('[data-session-action="adjust"]').getAttribute("aria-expanded")) !== "true") await page.locator('[data-session-action="adjust"]').click();
}
const logEvent = (page, hasText) => page.locator(".os-session-event", { hasText }).first();

await step("both party pages open without login and show only role labels", async () => {
  await owner.locator(".os-session-summary").waitFor();
  await client.locator(".os-session-summary").waitFor();
  const text = await owner.locator("body").innerText();
  if (/05\d{8}|الاختباري/.test(text)) throw new Error("personal data visible on the owner page");
  if (!(await owner.getByText("أنت: المالك").count())) throw new Error("role chip missing");
  await owner.screenshot({ path: path.join(OUT, "owner-start.png") });
});

await step("client −5% appears on the owner page live (no reload)", async () => {
  await openAdjust(client);
  await client.locator('[data-session-action="minus5"]').click();
  await client.getByText("بانتظار رد المالك").waitFor();
  await logEvent(owner, "اقترح سعرًا أقل بـ 5%").waitFor({ state: "attached", timeout: 9000 });
  await openAdjust(owner);
  await owner.locator('[data-session-action="plus2"]').waitFor();
  await client.screenshot({ path: path.join(OUT, "client-waiting.png") });
});

await step("owner compromise shows the computed average and updates the client", async () => {
  await openAdjust(owner);
  const label = await owner.locator('[data-session-action="compromise"] small').innerText();
  if (!/ريال/.test(label)) throw new Error(`no computed price on the button: ${label}`);
  await owner.locator('[data-session-action="compromise"]').click();
  await logEvent(client, "اقترح حلًا وسطًا").waitFor({ state: "attached", timeout: 9000 });
});

await step("typed price takes digits only", async () => {
  await openAdjust(client);
  await client.locator('[data-session-action="manual"]').click();
  const input = client.locator('input[name="price"]');
  await input.fill("2,300,000 آخر سعر");
  const value = await input.inputValue();
  if (/[^\d,٠-٩]/.test(value)) throw new Error(`letters kept: ${value}`);
  await client.screenshot({ path: path.join(OUT, "client-typed.png") });
  await client.locator('[data-session-send="manual"]').click();
  await logEvent(owner, "اقترح سعرًا").waitFor({ state: "attached", timeout: 9000 });
});

await step("the room has three parts and the terms of this kind of property (a villa sale)", async () => {
  for (const page of [owner, client]) {
    for (const part of ["property", "agreed", "versus"]) if ((await page.locator(`[data-room-part="${part}"]`).count()) !== 1) throw new Error(`part ${part} missing`);
  }
  const order = await owner.locator("[data-room-part]").evaluateAll((els) => els.map((el) => el.getAttribute("data-room-part")).join(","));
  if (order !== "property,agreed,versus") throw new Error(`order: ${order}`);
  if ((await owner.locator(".os-room").getAttribute("data-room-family")) !== "VILLA" || (await owner.locator(".os-room").getAttribute("data-room-deal")) !== "sale") throw new Error("wrong room rules");
  const terms = await owner.locator("[data-term]").evaluateAll((els) => els.map((el) => el.getAttribute("data-term")));
  if (!terms.includes("payment_method") || !terms.includes("furniture") || terms.includes("rent_payments") || terms.includes("land_pricing")) throw new Error(`terms: ${terms.join(",")}`);
  if ((await owner.locator("[data-room-versus] [data-side]").count()) !== 2) throw new Error("the two sides are not facing each other");
  if (await owner.locator("[data-room-part] textarea, [data-room-part] input[type=text]").count()) throw new Error("free typing is offered to a side before it asks for the broker");
});

await step("a term: the owner proposes, the client sees it live and accepts → «ما تم الاتفاق عليه»", async () => {
  await owner.locator('[data-term="payment_method"] [data-term-action="propose"]').click();
  await owner.locator('[data-term="payment_method"] [data-term-option="bank"]').click();
  await owner.locator('[data-term="payment_method"][data-term-state="PENDING"]').waitFor();
  if (!(await owner.locator('[data-term="payment_method"] [data-term-chip]').innerText()).includes("بانتظار رد العميل")) throw new Error("owner is not told he is waiting");
  await client.locator('[data-term="payment_method"] [data-term-action="accept"]').waitFor({ timeout: 9000 });
  if (await client.locator('[data-agreed="term:payment_method"]').count()) throw new Error("a proposal was shown as an agreement");
  if ((await client.locator('[data-side="client"]').getAttribute("data-side-turn")) !== "ACT") throw new Error("the client is not told an answer is expected");
  await client.screenshot({ path: path.join(OUT, "client-term-pending.png"), fullPage: true });
  await client.locator('[data-term="payment_method"] [data-term-action="accept"]').click();
  await client.locator('[data-agreed="term:payment_method"]').waitFor();
  await owner.locator('[data-agreed="term:payment_method"]').waitFor({ timeout: 9000 });
  const meta = await owner.locator('[data-agreed="term:payment_method"]').innerText();
  if (!meta.includes("تمويل بنكي") || !meta.includes("وافق العميل")) throw new Error(`agreed row: ${meta}`);
  await logEvent(owner, "تم الاتفاق").waitFor({ state: "attached" });
});

await step("«طلب تدخل الوسيط»: the note reaches the broker only; he passes it on as passed on by the broker", async () => {
  await owner.locator('[data-room-extra="broker"]').click();
  await owner.locator('textarea[name="brokerNote"]').fill("أريد إتمام البيع قبل نهاية الشهر 0559998877");
  await owner.locator('[data-room-send="broker"]').click();
  await owner.locator('[data-room-request][data-request-open="true"]').waitFor();
  await broker.locator('[data-request][data-request-role="owner"]').waitFor({ timeout: 9000 });
  const text = await broker.locator('[data-request] [data-request-text]').innerText();
  if (!text.includes("قبل نهاية الشهر")) throw new Error(`broker did not get the note: ${text}`);
  const task = h.store.list(`offices/${OFFICE_A}/operations`).find((op) => op.type === "SESSION_INTERVENTION" && op.status === "OPEN");
  if (!task) throw new Error("no SESSION_INTERVENTION task");
  await broker.screenshot({ path: path.join(OUT, "broker-request.png"), fullPage: true });
  await client.waitForTimeout(5500);
  if ((await client.locator("body").innerText()).includes("نهاية الشهر")) throw new Error("the client saw the owner's note before the broker decided");
  await broker.locator('[data-request-action="forward"]').click();
  const dialog = await broker.locator(".os-dialog").innerText();
  if (dialog.includes("0559998877") || !dialog.includes("منقولة عن طريق الوسيط")) throw new Error(`forward dialog: ${dialog}`);
  await broker.locator(".os-dialog .os-btn.primary").click();
  await broker.locator("[data-request]").waitFor({ state: "detached" });
  await logEvent(client, "نقل الوسيط عن المالك").waitFor({ state: "attached", timeout: 9000 });
  const passed = await logEvent(client, "نقل الوسيط عن المالك").textContent();
  if (passed.includes("0559998877") || !passed.includes("قبل نهاية الشهر")) throw new Error(`passed text: ${passed}`);
  if (!(await broker.locator("[data-broker-log]").count())) throw new Error("the broker's intervention log is missing");
  await owner.locator('[data-room-request][data-request-open="false"]').waitFor({ timeout: 9000 });
});

await step("the broker rewrites a request for the other side, in his own name", async () => {
  await client.locator('[data-room-extra="info"]').click();
  await client.locator('[data-info-topic="age"]').click();
  await broker.locator('[data-request][data-request-kind="info"]').waitFor({ timeout: 9000 });
  await broker.locator('[data-request-action="rephrase"]').click();
  await broker.locator('textarea[name="requestText"]').fill("العميل يسأل عن عمر الفيلا، هل تزودنا به؟");
  await broker.locator('[data-request-send="rephrase"]').click();
  await broker.locator("[data-request]").waitFor({ state: "detached" });
  await logEvent(owner, "العميل يسأل عن عمر الفيلا").waitFor({ state: "attached", timeout: 9000 });
  if ((await logEvent(owner, "العميل يسأل عن عمر الفيلا").textContent()).includes("نقل الوسيط عن")) throw new Error("the broker's own wording was shown as the client's words");
});

await step("broker message to the owner only", async () => {
  await broker.getByRole("button", { name: "إلى المالك" }).click();
  await broker.locator(".os-session-composer textarea").fill("رسالة للمالك فقط من الاختبار");
  await broker.locator(".os-session-composer").getByRole("button", { name: "إرسال" }).click();
  await logEvent(owner, "رسالة للمالك فقط من الاختبار").waitFor({ state: "attached", timeout: 9000 });
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
  await page.locator('[data-request][data-request-role="client"]').waitFor();
  await callWorker(h, "/os/session/resolve", { officeId: OFFICE_A, journeyId: jid });
});


await step("price accepted → both pages show the slot picker; picking a free slot books it", async () => {
  // the owner accepts the client's last price (one tap from «قبول»)
  await owner.locator('[data-session-action="accept"]').click();
  await owner.locator(".os-session-note", { hasText: "تم الاتفاق على السعر" }).waitFor({ timeout: 9000 });
  await client.locator('[data-session-action="viewing_pick"]').waitFor({ timeout: 9000 });
  await client.locator('[data-session-action="viewing_pick"]').click();
  await client.locator(".os-slot-picker").waitFor();
  if (await client.locator('input[type="datetime-local"]').count()) throw new Error("free typing of the date must not exist");
  await client.screenshot({ path: path.join(OUT, "client-slots.png") });
  await client.locator("[data-slot]").first().click();
  await client.locator(".os-session-note", { hasText: "بانتظار موافقة المالك" }).waitFor({ timeout: 9000 });
  await owner.locator('[data-session-action="viewing_ok"]').waitFor({ timeout: 9000 });
  await owner.screenshot({ path: path.join(OUT, "owner-viewing-ok.png") });
  await owner.locator('[data-session-action="viewing_ok"]').click();
  // both sides agreed on a free slot → booked on the broker's calendar
  await owner.locator(".os-session-note", { hasText: "موعد المعاينة" }).waitFor({ timeout: 9000 });
  await client.locator(".os-session-note", { hasText: "موعد المعاينة" }).waitFor({ timeout: 9000 });
});

await step("screens of the room (sides and broker) without horizontal scroll", async () => {
  for (const [name, page] of [["room-owner", owner], ["room-client", client], ["room-broker", broker]]) {
    const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
    if (overflow > 1) throw new Error(`${name}: horizontal scroll ${overflow}px`);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  }
});

await step("deal stays one card in Daily Tasks while the deal is open", async () => {
  const cards = h.store.list(`offices/${OFFICE_A}/operations`).filter((op) => op.type === "DEAL_JOURNEY" && op.journeyId === jid && op.status === "OPEN");
  if (cards.length !== 1) throw new Error(`expected one DEAL_JOURNEY card, got ${cards.length}`);
});

await browser.close();
h.server.close();
fs.writeFileSync(path.join(OUT, "session-report.json"), JSON.stringify({ at: new Date().toISOString(), results, errors }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} session checks passed; page errors: ${errors.length}`);
process.exitCode = failed.length || errors.length ? 1 : 0;
