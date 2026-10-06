// «بوت المكتب» — browser check on the local harness (real Worker, in-memory store; Telegram is a
// double in this process): the office's switch, a broker's own alerts, the link a side receives,
// the bot asking the two sides, the deal it opens, and taking a deal back from the bot.
//   node scripts/qa/office-os/bot.e2e.mjs   (OUT_DIR for screenshots)
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/office-os/bot");
fs.mkdirSync(OUT, { recursive: true });

const { startOfficeOsHarness, idTokenFor, OWNER_A, BROKER_A2, OFFICE_A } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const { callWorker } = await import(path.join(ROOT, "scripts/qa/office-os/seed.mjs"));
const { callbackData, parseCallback } = await import(path.join(ROOT, "public/os/domain/bot-domain.js"));

const h = await startOfficeOsHarness();
const SECRET = "e2e-bot-secret";
const BOT_TOKEN = "123456789:E2E-TOKEN-never-shown-on-a-screen-0000"; // pragma: allowlist secret
Object.assign(h.env, { TELEGRAM_BOT_TOKEN: BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_BOT_USERNAME: "iaqar_e2e_bot", TELEGRAM_OUTBOUND: "enabled" });

// Telegram double: what the Worker sends to the Bot API is kept here; nothing leaves the machine.
const sent = [];
let messageSeq = 100;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (!String(url).startsWith("https://api.telegram.org/")) return realFetch(input, init);
  const payload = JSON.parse(init.body || "{}");
  const method = String(url).split("/").pop();
  const record = { method, ...payload, message_id: method === "sendMessage" ? ++messageSeq : payload.message_id };
  sent.push(record);
  return new Response(JSON.stringify({ ok: true, result: { message_id: record.message_id } }), { status: 200 });
};
let updateId = 9000;
const webhook = async (update) => (await h.worker.fetch(new Request("https://worker.test/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET }, body: JSON.stringify({ update_id: ++updateId, ...update }) }), h.env, { waitUntil() {} })).json();
const says = (chatId, text) => webhook({ message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: "private" }, from: { id: chatId, first_name: "طرف" }, text } });
const shares = (chatId, phone) => webhook({ message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: "private" }, from: { id: chatId, first_name: "طرف" }, contact: { phone_number: phone, user_id: chatId } } });
const messagesTo = (chatId) => sent.filter((m) => m.method === "sendMessage" && String(m.chat_id) === String(chatId));
const askTo = (chatId) => messagesTo(chatId).filter((m) => m.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data).at(-1);
const presses = (chatId, ask, answer) => webhook({ callback_query: { id: `cq-${updateId}`, from: { id: chatId }, data: callbackData(parseCallback(ask.reply_markup.inline_keyboard[0][0].callback_data).token, answer), message: { message_id: ask.message_id, chat: { id: chatId, type: "private" }, text: ask.text } } });
const codeOf = (link) => new URL(link).searchParams.get("start");

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const checks = []; const errors = [];
let step = "start";
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`); };
const until = async (fn, label, timeout = 10000) => { const t = Date.now(); while (Date.now() - t < timeout) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } throw new Error(`timeout: ${label}`); };
const newPage = async (uid) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true, permissions: ["clipboard-read", "clipboard-write"] });
  await ctx.addInitScript(([u, o]) => { localStorage.setItem("harness.uid", u); localStorage.setItem("iaqar.officeId", o); }, [uid, OFFICE_A]);
  const p = await ctx.newPage(); p.setDefaultTimeout(12000);
  p.on("console", (m) => { if (m.type() === "error") errors.push(`${step}: ${m.text()}`); });
  p.on("pageerror", (e) => errors.push(`${step}: ${e.message}`));
  return p;
};
const page = await newPage(OWNER_A);
const shot = async (name, target = page) => {
  await target.waitForTimeout(350);
  const overflow = await target.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  check(`no horizontal scroll: ${name}`, overflow <= 1, `${overflow}px`);
  await target.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
};
const open = async (hash, wait, target = page) => { await target.goto(`${h.origin}/#/${hash}`); await target.reload(); if (wait) await target.locator(wait).first().waitFor(); };

try {
  // ---------------- the office's switch
  step = "switch";
  await open("settings/channels", "[data-bot]");
  check("«قنوات المكتب» shows the bot, off by default", (await page.locator("[data-bot-state]").getAttribute("data-bot-state")) === "OFF" && (await page.locator("[data-bot]").innerText()).includes("تبقى مهمة مراجعة عندك"));
  check("it states its rules plainly (Start is required, identities stay hidden, the broker can take a deal back)", (await page.locator(".os-bot-rules").innerText().then((rules) => ["هذا شرط تيليجرام", "لا يرى أي طرف اسم الآخر أو رقمه", "استلام التواصل"].every((text) => rules.includes(text)))));
  await shot("01-bot-off");
  await page.locator('[data-bot-toggle="on"]').click();
  await page.locator(".os-dialog").waitFor();
  const warning = await page.locator(".os-dialog").innerText();
  check("switching on asks first and says exactly what will happen without coming back to the manager", warning.includes("دون الرجوع لك") && warning.includes("إيقافه في أي لحظة"));
  await page.locator(".os-dialog button", { hasText: "إلغاء" }).click();
  check("«إلغاء» changes nothing", (await page.locator("[data-bot-state]").getAttribute("data-bot-state")) === "OFF" && h.store.get(`offices/${OFFICE_A}/botSettings/telegram`) == null);
  await page.locator('[data-bot-toggle="on"]').click();
  await page.locator(".os-dialog button", { hasText: "تشغيل" }).click();
  await page.locator('[data-bot-state="ON"]').waitFor();
  check("the bot is on, and the automation line says so", (await page.locator("[data-automation]").getAttribute("data-automation")) === "BOT_PARTIES" && (await page.locator("[data-automation]").innerText()).includes("لا يُرسل شيء عبر واتساب تلقائيًا"));
  check("no token or secret is anywhere on the screen", !(await page.content()).includes(BOT_TOKEN) && !(await page.content()).includes(SECRET));

  // ---------------- the manager's own alerts
  step = "alerts";
  await page.locator("[data-bot-alerts-link]").click();
  await page.locator("[data-bot-alerts-open]").waitFor();
  const alertsLink = await page.locator("[data-bot-alerts-open]").getAttribute("href");
  check("«ربط تنبيهاتي» gives a one-time link to the platform's bot", /^https:\/\/t\.me\/iaqar_e2e_bot\?start=[A-Za-z0-9_-]{22,64}$/.test(alertsLink));
  await says(7001, `/start ${codeOf(alertsLink)}`);
  await page.locator('[data-bot-alerts-state="LINKED"]').waitFor({ timeout: 12000 });
  check("after «Start» the card turns «مرتبط» by itself", (await page.locator("[data-bot-alerts-pending]").count()) === 0 && messagesTo(7001).at(-1).text.includes("تم ربط تنبيهاتك"));
  await shot("02-bot-on");

  // ---------------- a broker (not a manager) links his own alerts from «الإشعارات»
  step = "broker alerts";
  const brokerPage = await newPage(BROKER_A2);
  await open("settings/notifications", "[data-bot-alerts]", brokerPage);
  await brokerPage.locator("[data-bot-alerts-state]").waitFor();
  check("a broker finds «تنبيهاتي على تيليجرام» in his notification settings, not linked yet", (await brokerPage.locator("[data-bot-alerts-state]").getAttribute("data-bot-alerts-state")) === "NOT_LINKED" && (await brokerPage.locator("[data-bot-toggle]").count()) === 0);
  await shot("03-broker-alerts", brokerPage);
  await brokerPage.close();

  // ---------------- the link a side receives
  step = "party link";
  const request = await callWorker(h, "/os/records/save", { officeId: OFFICE_A, requestKey: "e2e-bot-req", record: { kind: "REQUEST", purpose: "PURCHASE", propertyType: "شقة", city: "الرياض", district: "حي البوت", price: 950000, contactName: "عميل البوت", contactPhone: "0553111101" } });
  await open(`record/${request.recordId}`, "[data-bot-party-state]");
  check("the record page says the client is not on the bot yet", (await page.locator("[data-bot-party-state]").getAttribute("data-bot-party-state")) === "NOT_LINKED");
  await page.locator("[data-bot-party-link]").click();
  await page.locator("[data-bot-party-url]").waitFor();
  const partyLink = (await page.locator("[data-bot-party-url]").innerText()).trim();
  check("«رابط بوت تيليجرام» shows the client's own link with a ready message to send by hand", /^https:\/\/t\.me\/iaqar_e2e_bot\?start=/.test(partyLink) && (await page.locator("[data-bot-party-whatsapp]").getAttribute("href")).startsWith("https://wa.me/966553111101?text=") && (await page.locator("[data-bot-party-pending]").innerText()).includes("لمرة واحدة") && (await page.locator("[data-bot-party-pending]").innerText()).includes("مشاركة رقمي"));
  await page.locator("[data-bot-party-copy]").click();
  const copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  check("«نسخ الرسالة» copies the greeting with the link", copied.includes(partyLink) && copied.includes("عميل البوت"));
  check("making the link sent nothing to anyone", messagesTo(7101).length === 0 && sent.filter((m) => m.method === "sendMessage").length === 1);
  await shot("04-party-link");
  const opened = await says(7101, `/start ${codeOf(partyLink)}`);
  check("«Start» alone does not link: the bot asks the client to share his own number", opened.awaiting === "contact" && messagesTo(7101).at(-1).reply_markup?.keyboard?.[0]?.[0]?.request_contact === true);
  const wrong = await shares(7101, "+966550000000");
  await open(`record/${request.recordId}`, '[data-bot-party-state="NOT_LINKED"]');
  check("a number that is not the one on the record is refused", wrong.reason === "contact_mismatch" && messagesTo(7101).at(-1).text.includes("لا يطابق الرقم المسجل"));
  const partyLink2 = (await callWorker(h, "/os/bot/party/link", { officeId: OFFICE_A, recordId: request.recordId })).deepLink;
  await says(7101, `/start ${codeOf(partyLink2)}`);
  await shares(7101, "+966553111101");
  await open(`record/${request.recordId}`, '[data-bot-party-state="LINKED"]');
  check("after the client shares the number saved on his record, it shows «مرتبط بالبوت»", messagesTo(7101).at(-1).text.includes("أهلًا عميل البوت"));

  // ---------------- the bot asks, the two sides agree, the deal opens
  step = "ask";
  const offer = await callWorker(h, "/os/records/save", { officeId: OFFICE_A, requestKey: "e2e-bot-off", record: { kind: "OFFER", purpose: "SALE", propertyType: "شقة", city: "الرياض", district: "حي البوت", price: 900000, area: 180, rooms: 4, contactName: "مالك البوت", contactPhone: "0554111102" } });
  const match = h.store.list(`offices/${OFFICE_A}/matches`).find((m) => m.offerId === offer.recordId && m.requestId === request.recordId);
  const question = askTo(7101);
  check("the client was asked in Telegram the moment the match was found — without the owner's name or number", Boolean(question) && question.text.includes("هل هذا العقار مناسب لك؟") && !question.text.includes("مالك البوت") && !question.text.includes("0554111102"));
  await open(`review/${match.id}`, "[data-bot-ask]");
  check("the review page says the bot asked the client, and that the broker can still decide", (await page.locator("[data-bot-ask]").getAttribute("data-bot-ask")) === "CLIENT_ASKED" && (await page.locator("[data-bot-ask]").innerText()).includes("يمكنك اتخاذ القرار بنفسك"));
  await shot("05-review-bot-asked");
  const ownerLink = await callWorker(h, "/os/bot/party/link", { officeId: OFFICE_A, recordId: offer.recordId });
  await says(7102, `/start ${codeOf(ownerLink.deepLink)}`);
  await shares(7102, "+966554111102");
  await presses(7101, question, "yes");
  await page.locator('[data-bot-ask="OWNER_ASKED"]').waitFor();
  check("the client's «مناسب» moves the question to the owner — without the client's name, number or budget (the page follows live)", Boolean(askTo(7102)) && !askTo(7102).text.includes("عميل البوت") && !askTo(7102).text.includes("950,000") && !askTo(7102).text.includes("0553111101"));
  await presses(7102, askTo(7102), "yes");
  const journey = await until(() => h.store.list(`offices/${OFFICE_A}/journeys`).find((j) => j.matchId === match.id), "deal opened");
  const journeyId = journey.journeyId || journey.id;
  check("two yeses open the deal and each side receives its own room link", journey.status === "ACTIVE" && journey.approvedBy === "telegram-bot" && messagesTo(7101).at(-1).text.includes("افتح صفحة التفاوض") && messagesTo(7102).at(-1).text.includes("افتح صفحة التفاوض"));
  check("the manager was told on his own Telegram chat", messagesTo(7001).at(-1).text.includes("صفقة جديدة — وافق الطرفان عبر البوت"));

  // ---------------- the deal in the office
  step = "deal";
  await open("tasks", `[data-deal="${journeyId}"]`);
  check("the deal is one card in Daily Tasks, with no «prepare the first proposal» task", (await page.locator(`[data-deal="${journeyId}"]`).count()) === 1 && !(await page.locator(`[data-deal="${journeyId}"]`).innerText()).includes("تجهيز المقترح"));
  await page.locator("[data-header-bell]").click();
  await page.locator("[data-notifications] [data-notification]").first().waitFor();
  const dealNote = page.locator("[data-notification]", { hasText: "وافق الطرفان عبر البوت" }).first();
  check("the notification of the opened deal leads to «متابعة الصفقة»", (await dealNote.getAttribute("data-notification-route")) === `deal/${journeyId}`);
  await dealNote.click();
  await page.locator("[data-deal-bot]").waitFor();
  check("«متابعة الصفقة» shows the bot on this deal", (await page.locator("[data-deal-bot]").getAttribute("data-deal-bot")) === "ACTIVE");
  await page.locator("[data-contact-log] > summary").click();
  const log = await page.locator("[data-contact-event]").evaluateAll((els) => els.map((el) => ({ type: el.dataset.contactEvent, text: el.textContent })));
  check("the contact log says what the bot sent and that reading is unknown", log.some((e) => e.type === "BOT_MESSAGE" && e.text.includes("أرسله البوت") && e.text.includes("لا يُعرف هل قُرئ")), log.map((e) => e.type).join(","));
  await shot("06-deal-bot");

  // ---------------- a move passes to the other side; the broker takes the deal back
  step = "takeover";
  const links = (await callWorker(h, "/os/session/links", { officeId: OFFICE_A, journeyId })).links;
  const token = (url) => String(url).split("#")[1];
  const ownerBefore = messagesTo(7102).length;
  await callWorker(h, "/os/session/act", { token: token(links.client.url), action: "minus5", submissionId: "e2e-bot-1" }, "");
  check("the client's move in the room reaches the owner in Telegram", messagesTo(7102).length === ownerBefore + 1 && messagesTo(7102).at(-1).text.startsWith("العميل: "));
  await page.locator('[data-deal-bot-action="pause"]').click();
  await page.locator('[data-deal-bot="PAUSED"]').waitFor();
  const clientBefore = messagesTo(7101).length;
  await callWorker(h, "/os/session/act", { token: token(links.owner.url), action: "plus2", submissionId: "e2e-bot-2" }, "");
  check("«استلام التواصل من البوت»: the bot stops passing moves for this deal", messagesTo(7101).length === clientBefore && (await page.locator("[data-deal-bot]").innerText()).includes("البوت متوقف عنها"));
  await shot("07-deal-bot-paused");
  await page.locator('[data-deal-bot-action="resume"]').click();
  await page.locator('[data-deal-bot="ACTIVE"]').waitFor();
  check("the deal can be handed back to the bot", true);

  // ---------------- switching off
  step = "switch off";
  await open("settings/channels", '[data-bot-state="ON"]');
  check("the card counts the two linked sides", (await page.locator("[data-bot-parties]").innerText()).trim() === "2");
  await page.locator('[data-bot-toggle="off"]').click();
  await page.locator(".os-dialog button", { hasText: "إيقاف" }).first().click();
  await page.locator('[data-bot-state="OFF"]').waitFor();
  const before = sent.filter((m) => m.method === "sendMessage").length;
  await callWorker(h, "/os/records/save", { officeId: OFFICE_A, requestKey: "e2e-bot-off-2", record: { kind: "OFFER", purpose: "SALE", propertyType: "شقة", city: "الرياض", district: "حي البوت", price: 905000, area: 170, rooms: 4, contactName: "مالك ثانٍ", contactPhone: "0554111103" } });
  check("switched off: a new match sends nothing and stays the broker's review task", sent.filter((m) => m.method === "sendMessage").length === before);
  check("the bot only ever used sendMessage, answerCallbackQuery and editMessageText", sent.every((m) => ["sendMessage", "answerCallbackQuery", "editMessageText"].includes(m.method)));

  check("no browser console errors", errors.length === 0, errors.slice(0, 4).join(" | "));
} catch (error) {
  check(`completed without exception (step ${step})`, false, String(error.message).split("\n")[0]);
  try { await page.screenshot({ path: path.join(OUT, "zz-failure.png"), fullPage: true }); } catch (_) { /* ignore */ }
} finally {
  await browser.close();
  h.server.close();
  globalThis.fetch = realFetch;
}
const failed = checks.filter((c) => !c.ok);
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ at: new Date().toISOString(), passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
// In CI a failed check is also written as an annotation, so it can be read without the raw log.
if (process.env.GITHUB_ACTIONS) for (const c of failed) console.log(`::error title=bot::${`${c.name} — ${c.detail}`.replace(/\r?\n/g, " ").slice(0, 400)}`);
console.log(`\n${checks.length - failed.length}/${checks.length} bot checks passed`);
process.exit(failed.length ? 1 : 0);
