// Local QA only (not a Staging/Production job): the Match negotiation workspace
// scenario A–K in real Chromium against the real Worker (in-memory Firestore
// double, no network, no real data) and the real Bank + bridge + workspace UI.
//   node scripts/qa/match-negotiation-e2e/run.mjs [repoRoot] [outDir]
// PLAYWRIGHT_MODULE may point at a playwright entry if @playwright/test is absent.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startHarness, OFFICE } from "./server.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "@playwright/test");
const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../.."));
const outDir = process.argv[3] || path.join(root, "test-results", "match-negotiation-e2e");
fs.mkdirSync(outDir, { recursive: true });
const h = await startHarness({ root });
const matchId = h.match.id;
const results = [];
const step = async (id, title, fn) => {
  try {
    const detail = await fn();
    results.push({ id, title, pass: true, detail });
  } catch (error) {
    results.push({ id, title, pass: false, detail: String(error?.message || error) });
  }
  try { await page.screenshot({ path: `${outDir}/${id}.png`, fullPage: false }); } catch {}
};
const assert = (cond, message) => { if (!cond) throw new Error(message); };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 420, height: 900 }, locale: "ar-SA" });
let page = await context.newPage();
const errors = [];
const watch = (p) => { p.on("pageerror", (e) => errors.push(String(e))); };
watch(page);
page.on("dialog", (d) => d.accept());

const ws = (sel = "") => `.cv2-match-workspace ${sel}`;
const workspaceState = () => page.evaluate(() => {
  const w = document.querySelector(".cv2-match-workspace");
  const card = w?.querySelector("[data-cv2-exec-task]");
  const btn = (party) => w?.querySelector(`[data-party-send="${party}"]`);
  return {
    open: Boolean(w),
    matchId: card?.getAttribute("data-match-id") || "",
    sections: [...(w?.querySelectorAll("[data-match-section]") || [])].map((n) => n.dataset.matchSection),
    clientBtn: btn("client") ? { text: btn("client").textContent.trim(), disabled: btn("client").disabled } : null,
    ownerBtn: btn("owner") ? { text: btn("owner").textContent.trim(), disabled: btn("owner").disabled } : null,
    clientCount: w?.querySelector('[data-party-send-count="client"]')?.textContent.trim() || "",
    ownerCount: w?.querySelector('[data-party-send-count="owner"]')?.textContent.trim() || "",
    clientSelected: [...(w?.querySelectorAll('[data-party-choices="client"] [aria-pressed="true"]') || [])].map((n) => n.getAttribute("data-party-choice")),
    ownerSelected: [...(w?.querySelectorAll('[data-party-choices="owner"] [aria-pressed="true"]') || [])].map((n) => n.getAttribute("data-party-choice")),
    clientChoices: [...(w?.querySelectorAll('[data-party-choices="client"] [data-party-choice]') || [])].map((n) => n.textContent.trim()),
    log: [...(w?.querySelectorAll("[data-negotiation-log] li") || [])].map((li) => ({
      kind: li.getAttribute("data-negotiation-log-kind"),
      title: li.querySelector(".cv2-neg-log-title")?.textContent.trim(),
      message: li.querySelector(".cv2-neg-log-message")?.textContent.trim() || "",
      recipient: li.querySelector("[data-log-recipient]")?.textContent.trim() || "",
      time: li.querySelector("[data-log-time]")?.textContent.trim() || "",
      status: li.querySelector("[data-log-status]")?.textContent.trim() || ""
    })),
    text: w?.textContent || ""
  };
});
const bankCards = () => page.evaluate(() => [...document.querySelectorAll("#opportunityBankList [data-cv2-inbox-item]")].map((c) => ({
  id: c.dataset.opportunityId,
  badge: c.querySelector(".bank-card-action-badge")?.textContent.trim() || "",
  reason: c.querySelector(".bank-card-action-head strong")?.textContent.trim() || "",
  action: c.querySelector("[data-opportunity-primary-action]")?.getAttribute("data-opportunity-primary-action") || "",
  matchId: c.querySelector("[data-opportunity-primary-action]")?.getAttribute("data-match-id") || "",
  undefinedText: c.textContent.includes("غير محدد")
})));
const waitFor = async (fn, label, timeout = 8000) => {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await fn();
    if (last) return last;
    await page.waitForTimeout(150);
  }
  throw new Error(`timeout: ${label}`);
};
const storeMatch = () => h.store.get(`offices/${OFFICE}/matches/${matchId}`);
const storeOp = () => h.store.get(`offices/${OFFICE}/operations/${h.matchOperation.id}`);
const coordination = () => {
  const doc = h.store.get(`offices/${OFFICE}/coordinationSessions/${matchId}`);
  try { return JSON.parse(doc?.coordinationJson || "{}"); } catch { return {}; }
};
const openFromBank = async () => {
  await page.click('[data-bank-action-filter="matches"]');
  const card = page.locator(`#opportunityBankList [data-cv2-inbox-item][data-opportunity-id="opp_request_e2e"]`);
  await card.waitFor({ state: "visible", timeout: 10000 });
  await card.locator("[data-opportunity-primary-action]").click();
  await page.locator(ws("[data-match-negotiation-page]")).waitFor({ state: "visible", timeout: 10000 });
};

await step("A", "فتح Staging (نفس الكود محليًا)", async () => {
  await page.goto(`http://127.0.0.1:${h.port}/`);
  await page.waitForFunction(() => window.__e2e?.ready, null, { timeout: 20000 });
  const cards = await waitFor(async () => { const c = await bankCards(); return c.length >= 2 ? c : null; }, "bank cards");
  return { cards };
});

await step("B", "العروض والطلبات → تطابقات → مراجعة المطابقة", async () => {
  await openFromBank();
  await page.waitForTimeout(1500);
  const s = await workspaceState();
  assert(s.open, "workspace not open");
  assert(s.matchId === matchId, `wrong matchId ${s.matchId}`);
  assert(["property", "agreement", "parties", "broker"].every((x) => s.sections.includes(x)), `sections ${s.sections}`);
  return { matchId: s.matchId, stable: true, sections: s.sections };
});

const sendParty = async (party) => {
  const before = await page.evaluate(() => window.__e2e.whatsapp.length);
  await page.click(ws(`[data-party-send="${party}"]`));
  await waitFor(() => page.evaluate((n) => window.__e2e.whatsapp.length > n, before), "whatsapp opened");
  await waitFor(async () => {
    const calls = h.server.workerCalls.filter((c) => c.path === "/worker/workflow/action" && c.body.includes('"kind":"party_send"') && c.body.includes(`"party":"${party}"`));
    return calls.length > 0 ? calls : null;
  }, "party_send recorded");
  await page.waitForTimeout(400);
  return page.evaluate(() => window.__e2e.whatsapp.at(-1));
};

await step("C", "إرسال واتساب للعميل", async () => {
  const msg = await sendParty("client");
  const s = await workspaceState();
  assert(msg.phone.includes("551110001"), `phone ${msg.phone}`);
  return { phone: msg.phone, link: /party=|token|#/.test(msg.text), button: s.clientBtn, count: s.clientCount };
});

await step("D", "زر العميل ما زال يسمح بإعادة الإرسال", async () => {
  const s = await workspaceState();
  assert(s.clientBtn && !s.clientBtn.disabled, "client button disabled");
  assert(s.clientBtn.text === "إعادة الإرسال للعميل", `label ${s.clientBtn.text}`);
  assert(!s.text.includes("بانتظار موافقة العميل") || !s.ownerBtn.disabled, "owner locked");
  return { clientBtn: s.clientBtn };
});

await step("E", "إعادة الإرسال للعميل مرة ثانية", async () => {
  await sendParty("client");
  const s = await waitFor(async () => { const x = await workspaceState(); return x.clientCount.includes("مرتين") ? x : null; }, "client count 2");
  assert(!s.clientBtn.disabled, "client button disabled after resend");
  return { clientBtn: s.clientBtn, count: s.clientCount, whatsappCount: await page.evaluate(() => window.__e2e.whatsapp.filter((w) => w.phone.includes("551110001")).length) };
});

await step("F", "إرسال للمالك ثم إعادة الإرسال", async () => {
  const s0 = await workspaceState();
  assert(s0.ownerBtn && !s0.ownerBtn.disabled, `owner button locked: ${JSON.stringify(s0.ownerBtn)}`);
  await sendParty("owner");
  const s1 = await workspaceState();
  assert(s1.ownerBtn.text === "إعادة الإرسال للمالك" && !s1.ownerBtn.disabled, `owner after send ${JSON.stringify(s1.ownerBtn)}`);
  await sendParty("owner");
  const s2 = await waitFor(async () => { const x = await workspaceState(); return x.ownerCount.includes("مرتين") ? x : null; }, "owner count 2");
  return { ownerBefore: s0.ownerBtn, ownerAfter: s2.ownerBtn, count: s2.ownerCount, ownerWhatsapp: await page.evaluate(() => window.__e2e.whatsapp.filter((w) => w.phone.includes("552220002")).length) };
});

await step("G", "اختيار خيار للطرف ثم تغييره واستمراره", async () => {
  const s0 = await workspaceState();
  for (const label of ["مهتم", "غير مهتم", "التجهيزات", "شرط آخر", "معاينة أخرى"]) assert(s0.clientChoices.some((c) => c.includes(label)), `missing option ${label}`);
  await page.click(ws('[data-party-choices="client"] [data-party-choice="interested"]'));
  await waitFor(async () => (await workspaceState()).clientSelected.includes("interested"), "interested selected");
  await page.click(ws('[data-party-choices="client"] [data-party-choice="not_interested"]'));
  await waitFor(async () => (await workspaceState()).clientSelected.includes("not_interested"), "not_interested selected");
  await page.click(ws('[data-party-choices="owner"] [data-party-choice="equipment"]'));
  await waitFor(async () => (await workspaceState()).ownerSelected.includes("equipment"), "owner equipment selected");
  // Several live feed re-renders must not drop the choice.
  await page.waitForTimeout(2500);
  const afterFeed = await workspaceState();
  assert(afterFeed.clientSelected.join() === "not_interested", `client choice after re-render ${afterFeed.clientSelected}`);
  assert(afterFeed.ownerSelected.join() === "equipment", `owner choice after re-render ${afterFeed.ownerSelected}`);
  // Reload: close, full page reload, reopen from the Bank.
  await page.reload();
  await page.waitForFunction(() => window.__e2e?.ready, null, { timeout: 20000 });
  await openFromBank();
  await page.waitForTimeout(800);
  const afterReload = await workspaceState();
  assert(afterReload.clientSelected.join() === "not_interested", `client choice after reload ${afterReload.clientSelected}`);
  assert(afterReload.ownerSelected.join() === "equipment", `owner choice after reload ${afterReload.ownerSelected}`);
  const clientSendStill = afterReload.clientBtn;
  return { afterFeed: { client: afterFeed.clientSelected, owner: afterFeed.ownerSelected }, afterReload: { client: afterReload.clientSelected, owner: afterReload.ownerSelected }, clientBtnAfterChoices: clientSendStill };
});

const sendMessage = async (audience, message) => {
  await page.fill(ws("[data-broker-message]"), message);
  await page.selectOption(ws("[data-broker-audience]"), audience);
  await page.click(ws('[data-broker-action="send_message"]'));
  await waitFor(async () => (await workspaceState()).log.some((row) => row.message === message), `log has ${message}`);
};

await step("H", "رسائل الوسيط: عميل ×2، مالك، الطرفان", async () => {
  await sendMessage("client", "رسالة أولى للعميل");
  await sendMessage("client", "رسالة ثانية للعميل");
  await sendMessage("owner", "رسالة للمالك");
  await sendMessage("both", "رسالة للطرفين");
  const s = await workspaceState();
  const messages = s.log.filter((r) => r.kind === "broker_message");
  assert(messages.length === 4, `messages ${messages.length}`);
  for (const row of messages) assert(row.recipient && row.time && row.status, `incomplete row ${JSON.stringify(row)}`);
  const notes = coordination().brokerNotes || [];
  assert(notes.length === 4, `brokerNotes ${notes.length}`);
  const draftField = await page.inputValue(ws("[data-broker-message]"));
  return { log: messages.map((r) => `${r.title} | ${r.recipient} | ${r.time} | ${r.status} | ${r.message}`), linkNotes: notes.map((n) => `${n.audience}:${n.message}`), textareaCleared: draftField === "" };
});

await step("I", "ملاحظة داخلية لا تُرسل للطرفين", async () => {
  await page.fill(ws("[data-broker-internal-note]"), "ملاحظة داخلية سرية");
  await page.click(ws('[data-broker-action="save_internal_note"]'));
  await waitFor(async () => (await workspaceState()).log.some((r) => r.kind === "internal_note"), "internal note logged");
  const s = await workspaceState();
  const notes = coordination().brokerNotes || [];
  assert(!notes.some((n) => n.message.includes("ملاحظة داخلية سرية")), "internal note leaked to party notes");
  const internal = s.log.find((r) => r.kind === "internal_note");
  return { row: internal, partyNotes: notes.length, leaked: false };
});

await step("J", "فلتر متابعة: لا غير محدد، لا رجوع لتطابق جديد، يستمر بعد refresh", async () => {
  await page.click(ws("[data-close-match-workspace]"));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.__e2e.frames = [];
    const list = document.getElementById("opportunityBankList");
    const record = () => window.__e2e.frames.push({
      cards: list.querySelectorAll("[data-cv2-inbox-item]").length,
      undefinedText: list.textContent.includes("غير محدد"),
      newMatch: [...list.querySelectorAll(".bank-card-action-badge")].some((b) => b.textContent.includes("تطابق جديد")),
      text: list.textContent.slice(0, 120)
    });
    new MutationObserver(record).observe(list, { childList: true, subtree: true, characterData: true });
  });
  await page.click('[data-bank-action-filter="follow_up"]');
  await page.waitForTimeout(3000);
  const frames = await page.evaluate(() => window.__e2e.frames);
  const cards = await bankCards();
  const request = cards.find((c) => c.id === "opp_request_e2e");
  assert(request, "request card missing under متابعة");
  assert(!request.badge.includes("تطابق جديد"), `badge ${request.badge}`);
  assert(request.matchId === matchId, `card matchId ${request.matchId}`);
  const flashes = frames.filter((f) => f.undefinedText);
  const newMatchFrames = frames.filter((f) => f.newMatch);
  assert(!flashes.length, `غير محدد appeared in ${flashes.length} frames`);
  assert(!newMatchFrames.length, `تطابق جديد appeared in ${newMatchFrames.length} frames`);
  const op = storeOp();
  // Refresh.
  await page.reload();
  await page.waitForFunction(() => window.__e2e?.ready, null, { timeout: 20000 });
  await page.click('[data-bank-action-filter="follow_up"]');
  await page.waitForTimeout(2500);
  const afterRefresh = (await bankCards()).find((c) => c.id === "opp_request_e2e");
  assert(afterRefresh && !afterRefresh.badge.includes("تطابق جديد"), `after refresh ${JSON.stringify(afterRefresh)}`);
  const all = await (async () => { await page.click('[data-bank-action-filter="all"]'); await page.waitForTimeout(1500); return (await bankCards()).find((c) => c.id === "opp_request_e2e"); })();
  assert(all && !all.badge.includes("تطابق جديد"), `under الكل ${JSON.stringify(all)}`);
  return { card: request, framesObserved: frames.length, emptyFrames: frames.filter((f) => f.cards === 0).length, opLivingStage: op.livingStage, afterRefresh, underAll: all };
});

await step("K", "Back وإغلاق workspace وإصلاحات PR #124", async () => {
  await openFromBank();
  const bankBefore = (await bankCards()).length;
  await page.goBack();
  await page.waitForTimeout(400);
  const afterBack = await workspaceState();
  assert(!afterBack.open, "Back did not close workspace");
  assert(page.url().startsWith(`http://127.0.0.1:${h.port}/`), `Back left the page: ${page.url()}`);
  const bankAfterBack = (await bankCards()).length;
  assert(bankAfterBack === bankBefore && bankAfterBack > 0, "bank not intact after back");
  await openFromBank();
  await page.click(ws("[data-close-match-workspace]"));
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.body.style.overflow);
  assert(!(await workspaceState()).open && overflow === "", "close failed");
  // Re-render while open must not blank the workspace.
  await openFromBank();
  await page.evaluate(async () => {
    const c = await import("/public/js/v2/daily-tasks/controller.js");
    const host = document.createElement("div"); document.body.append(host);
    c.unmountDailyTasksContentV2(); c.mountDailyTasksContentV2(host);
    window.dispatchEvent(new CustomEvent("iaqar:operations-data", { detail: { items: window.IAQAR.operationsItems } }));
  });
  const afterRerender = await workspaceState();
  assert(afterRerender.open && afterRerender.matchId === matchId && afterRerender.sections.length === 4, "re-render blanked workspace");
  await page.click(ws("[data-close-match-workspace]"));
  // Missing match: loading then explicit error after 10s.
  await page.evaluate(() => window.IAQAR.openMatchWorkspace("mat_missing_e2e"));
  const loading = (await workspaceState()).text;
  await page.waitForTimeout(10500);
  const error = (await workspaceState()).text;
  assert(loading.includes("جارٍ تحميل") && error.includes("تعذر تحميل بيانات المطابقة"), `loading=${loading} error=${error}`);
  await page.click(ws("[data-close-match-workspace]"));
  return { back: "closed, page kept", close: "overflow restored", rerender: "workspace kept", timeout: "error shown after 10s" };
});

const matchDoc = storeMatch();
fs.writeFileSync(`${outDir}/results.json`, JSON.stringify({ matchId, results, errors, workerCalls: h.server.workerCalls.length, matchLivingStage: matchDoc?.livingStage, opLivingStage: storeOp()?.livingStage }, null, 2));
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} ${r.title}${r.pass ? "" : ` — ${r.detail}`}`);
console.log("page errors:", errors.length ? errors.slice(0, 5) : "none");
await browser.close();
h.server.close();
process.exit(results.every((r) => r.pass) && !errors.length ? 0 : 1);
