// «المحادثات» in a real browser (real Worker, in-memory Firestore, nothing leaves the machine):
// the manager sees who answers each WhatsApp conversation, takes one over (the other stays with the agent), writes a
// reply that is reported honestly (this harness has no WhatsApp sending), and hands it back; a stale screen gets a
// clear message; a broker never sees a conversation another broker holds. Mobile and desktop, RTL, no overflow.
//   node scripts/qa/office-os/conversations.e2e.mjs   (OUT_DIR for screenshots)
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/office-os/conversations");
fs.mkdirSync(OUT, { recursive: true });
const { startOfficeOsHarness, OWNER_A, BROKER_A2, OFFICE_A } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));

const h = await startOfficeOsHarness();
const idOf = (phone) => crypto.createHash("sha256").update(`phone-a|${phone}`).digest("hex").slice(0, 40);
const A = idOf("966500000001"), B = idOf("966500000002");
const now = Date.now(), at = (ms) => new Date(now - ms).toISOString();
const seedConversation = (id, phone, name, extra = {}) => h.store.seed(`offices/${OFFICE_A}/whatsappConversations/${id}`, {
  officeId: OFFICE_A, phoneNumberId: "phone-a", wabaId: "waba-a", senderPhone: phone, senderName: name, pending: [], stage: "RESULTS",
  draft: { kind: "REQUEST", propertyType: "شقة", district: "الملقا" }, lastInboundAt: at(60_000), updatedAt: at(60_000), controlVersion: 0,
  turns: [{ role: "customer", text: "أبحث عن شقة في الملقا", at: at(120_000) }, { role: "assistant", text: "وجدت لك 3 عروض منشورة.", at: at(110_000) }], ...extra
});
seedConversation(A, "966500000001", "عميل أول");
seedConversation(B, "966500000002", "عميل ثان", { awaiting: "offer_price" });
const conversation = (id) => h.store.get(`offices/${OFFICE_A}/whatsappConversations/${id}`);

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok) }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`); assert.ok(ok, `${name} ${detail}`); };
async function open(uid, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, locale: "ar-SA" });
  await ctx.addInitScript(([u, o]) => { localStorage.setItem("harness.uid", u); localStorage.setItem("iaqar.officeId", o); }, [uid, OFFICE_A]);
  const page = await ctx.newPage(); page.setDefaultTimeout(10000);
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, errors };
}
const noOverflow = (page) => page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth <= 1);

try {
  for (const width of [390, 1280]) {
    const { ctx, page, errors } = await open(OWNER_A, width);
    await page.goto(`${h.origin}/#/inbox`);
    await page.locator("[data-open-conversations]").click();
    await page.locator(`[data-conversation="${A}"]`).waitFor();
    check(`${width}px: both conversations listed with the employee holding each`, (await page.locator("[data-conversation]").count()) === 2
      && (await page.locator(`[data-conversation="${B}"]`).innerText()).includes("موظف التفاوض"));
    check(`${width}px: RTL and no horizontal scroll on the list`, (await page.evaluate(() => document.documentElement.dir)) === "rtl" && await noOverflow(page));
    if (width === 390) await page.screenshot({ path: path.join(OUT, "390-1-list.png"), fullPage: true });
    assert.deepEqual(errors, []);
    await ctx.close();
  }

  // The manager takes conversation A over.
  const { ctx, page, errors } = await open(OWNER_A, 390);
  await page.goto(`${h.origin}/#/conversations/${A}`);
  await page.locator("[data-conversation-thread]").waitFor();
  check("the thread shows the client and the agent turns", (await page.locator('[data-message-role="customer"]').count()) === 1 && (await page.locator('[data-message-role="assistant"]').count()) === 1);
  check("before taking over there is no reply box", (await page.locator("[data-conversation-reply]").count()) === 0);
  await page.locator("[data-conversation-take]").click();
  await page.locator("[data-conversation-reply]").waitFor();
  check("after «استلام المحادثة» the broker answers it", (await page.locator('[data-conversation-mode]').first().getAttribute("data-conversation-mode")) === "HUMAN");
  const heldA = await conversation(A), heldB = await conversation(B);
  check("A is held by the manager, B stays with the agent", heldA.handoff === true && heldA.heldBy === OWNER_A && !heldB.handoff);
  check("the take-over is in the thread and in the audit log", (await page.locator('[data-control-event="TAKEN"]').count()) === 1
    && h.store.list(`offices/${OFFICE_A}/auditLogs`).some((a) => a.action === "WHATSAPP_CONVERSATION_TAKEN"));
  await page.screenshot({ path: path.join(OUT, "390-2-taken.png"), fullPage: true });

  // A reply here: this harness has no WhatsApp sending, and the screen says so instead of «sent».
  await page.locator("[data-conversation-text]").fill("أهلًا، معك الوسيط.");
  await page.locator("[data-conversation-send]").click();
  await page.locator(".os-alert.bad.os-feedback:not([hidden])").waitFor();
  check("an unsent reply is reported as not sent", (await page.locator(".os-alert.bad.os-feedback:not([hidden])").innerText()).includes("لم يُرسل"));
  const outbox = h.store.list(`offices/${OFFICE_A}/whatsappOutbox`);
  check("the attempt is recorded once with its real state", outbox.length === 1 && outbox[0].state === "AUTOMATION_OFF" && outbox[0].by === OWNER_A);

  // Another screen moved first: a stale «إعادة» gets a clear message and the fresh state.
  const fresh = await conversation(A);
  h.store.patch(`offices/${OFFICE_A}/whatsappConversations/${A}`, { controlVersion: Number(fresh.controlVersion) + 1 });
  await page.locator("[data-conversation-release]").click();
  await page.locator(".os-alert.bad.os-feedback:not([hidden])").filter({ hasText: "تغيّرت" }).waitFor();
  check("a stale hand-back is refused, never applied silently", (await conversation(A)).handoff === true);
  await page.locator("[data-conversation-release]").click();
  await page.locator('[data-conversation-mode="AI"]').waitFor();
  const released = await conversation(A);
  check("hand-back returns A to the agent with its request kept", released.handoff === false && released.heldBy === "" && released.draft?.propertyType === "شقة");
  check("RTL and no horizontal scroll on the thread", await noOverflow(page));
  await page.screenshot({ path: path.join(OUT, "390-3-released.png"), fullPage: true });
  assert.deepEqual(errors, []);
  await ctx.close();

  // A broker never sees a conversation another person holds.
  h.store.patch(`offices/${OFFICE_A}/whatsappConversations/${B}`, { handoff: true, heldBy: OWNER_A, controlVersion: 5 });
  const broker = await open(BROKER_A2, 390);
  await broker.page.goto(`${h.origin}/#/conversations`);
  await broker.page.locator(`[data-conversation="${A}"]`).waitFor();
  check("the broker sees the free conversation but not the one the manager holds", (await broker.page.locator(`[data-conversation="${B}"]`).count()) === 0);
  await broker.page.goto(`${h.origin}/#/conversations/${B}`);
  await broker.page.locator(".os-alert.bad").waitFor();
  check("opening it directly is refused", (await broker.page.locator(".os-alert.bad").innerText()).includes("لوسيط آخر"));
  assert.deepEqual(broker.errors, []);
  await broker.ctx.close();
  console.log(`Conversations: ${checks.length} checks passed.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  h.server.close();
}
process.exit(process.exitCode || 0);
