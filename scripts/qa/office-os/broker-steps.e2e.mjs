// Fewer steps for the broker — browser check on the local harness (real Worker, in-memory store):
// one card per deal, «متابعة الصفقة», the two contact paths kept, notifications list, search and
// communication-center shortcuts, a library file linked to a deal document, and old links.
//   node scripts/qa/office-os/broker-steps.e2e.mjs   (OUT_DIR for screenshots)
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/office-os/broker-steps");
fs.mkdirSync(OUT, { recursive: true });
const { startOfficeOsHarness, idTokenFor, OWNER_A, OFFICE_A } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const { seedStates, callWorker } = await import(path.join(ROOT, "scripts/qa/office-os/seed.mjs"));

const h = await startOfficeOsHarness();
const s = await seedStates(h);
const jid = s.negotiation.journeyId;
const tok = (url) => String(url).split("#")[1];
const links = (await callWorker(h, "/os/session/links", { officeId: OFFICE_A, journeyId: jid })).links;
await callWorker(h, "/os/session/act", { token: tok(links.client.url), action: "minus5", submissionId: "steps-1" }, "");
await callWorker(h, "/os/session/act", { token: tok(links.client.url), action: "intervention", message: "أحتاج مهلة قصيرة قبل الرد", submissionId: "steps-2" }, "");
await callWorker(h, "/os/session/act", { token: tok(links.owner.url), action: "info_request", topicId: "age", submissionId: "steps-3" }, "");
// A real file in the office library (uploaded through the Worker), to link to a deal document.
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const up = await (await fetch(`${h.origin}/worker/media/office-library`, { method: "POST", headers: { authorization: `Bearer ${idTokenFor(OWNER_A)}`, "x-office-id": OFFICE_A, "x-file-name": encodeURIComponent("deed.pdf"), "content-type": "application/pdf" }, body: pdf })).json();
if (!up.ok) throw new Error(`library upload failed: ${JSON.stringify(up)}`);
h.store.seed(`offices/${OFFICE_A}/library/lib_e2e_deed_01`, { officeId: OFFICE_A, fileName: "deed.pdf", documentTitle: "صك فيلا النرجس", mediaPath: up.mediaPath, category: "other", kind: "manual", createdAt: new Date().toISOString() });

const ops = () => h.store.list(`offices/${OFFICE_A}/operations`).filter((op) => ["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE"].includes(String(op.status)));
const dealOps = () => ops().filter((op) => op.journeyId === jid);
const journey = () => h.store.get(`offices/${OFFICE_A}/journeys/${jid}`);
const snapshot = () => { const j = journey(); return JSON.stringify({ phase: j.phase, stage: j.stage, status: j.status, updatedAt: j.updatedAt, session: j.session, viewing: j.viewing, documents: j.documents, openTasks: j.openTasks, events: h.store.list(`offices/${OFFICE_A}/journeys/${jid}/events`).length, ops: ops().map((op) => `${op.id}:${op.status}:${op.dueAt || ""}`).sort() }); };

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const checks = []; const errors = [];
let step = "start";
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`); };
const until = async (fn, label, timeout = 8000) => { const t = Date.now(); while (Date.now() - t < timeout) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } throw new Error(`timeout: ${label}`); };
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true });
await ctx.addInitScript(([u, o]) => { localStorage.setItem("harness.uid", u); localStorage.setItem("iaqar.officeId", o); }, [OWNER_A, OFFICE_A]);
const page = await ctx.newPage(); page.setDefaultTimeout(10000);
page.on("console", (m) => { if (m.type() === "error") errors.push(`${step}: ${m.text()}`); });
page.on("pageerror", (e) => errors.push(`${step}: ${e.message}`));
const writes = [];
page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/worker/os/") && r.method() === "POST" && !/\/os\/(channels\/status|session\/view|records\/candidates)$/.test(u.pathname)) writes.push(u.pathname.replace("/worker", "")); });
const shot = async (name) => {
  await page.waitForTimeout(350);
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  check(`no horizontal scroll: ${name}`, overflow <= 1, `${overflow}px`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
};
const open = async (hash, wait) => { await page.goto(`${h.origin}/#/${hash}`); await page.reload(); if (wait) await page.locator(wait).first().waitFor(); };

try {
  // ---------------- Phase 1: one card per deal
  step = "deal card";
  await open("tasks", "[data-task]");
  const taskCount = dealOps().length;
  const card = page.locator(`[data-deal="${jid}"]`);
  check("the deal has several open tasks and exactly one card", taskCount >= 4 && (await card.count()) === 1, `${taskCount} tasks`);
  const cardsPerDeal = await page.locator("[data-deal]").evaluateAll((els) => { const seen = {}; for (const el of els) seen[el.dataset.deal] = (seen[el.dataset.deal] || 0) + 1; return Object.values(seen); });
  check("no deal appears twice in the list", cardsPerDeal.every((n) => n === 1), cardsPerDeal.join(","));
  const allTaskIds = ops().map((op) => op.id);
  const shownIds = await page.evaluate(() => [...new Set([...document.querySelectorAll("[data-task]")].map((el) => el.dataset.task).concat([...document.querySelectorAll("[data-subtask]")].map((el) => el.dataset.subtask)))]);
  check("every open task is still reachable from the list (as a card, a main button or a row inside its deal)", allTaskIds.every((id) => shownIds.includes(id)), `${allTaskIds.filter((id) => !shownIds.includes(id)).length} missing`);
  const text = await card.innerText();
  check("the card shows the sides, the property and place, the stage and «المطلوب الآن»", text.includes("المالك:") && text.includes("العميل:") && text.includes("فيلا") && text.includes("النرجس") && (await card.locator("[data-deal-stage]").innerText()) === "تفاوض" && text.includes("المطلوب الآن:"), text.replace(/\n/g, " ").slice(0, 120));
  check("priority is visible on the card", (await card.locator("[data-deal-urgency]").count()) === 1);
  check("one main button on the card", (await card.locator("[data-deal-primary]").count()) === 1);
  const subCount = Number(await card.locator("[data-deal-subtasks]").getAttribute("data-deal-subtasks"));
  check("the card says how many tasks the deal has (all of them, the deal's own task included)", subCount === taskCount, `${subCount}/${taskCount}`);
  await card.locator("[data-deal-subtasks] > summary").click();
  const rows = await card.locator("[data-subtask]").evaluateAll((els) => els.map((el) => ({ id: el.dataset.subtask, state: el.querySelector("[data-subtask-state]").textContent, hasButton: Boolean(el.querySelector("button")) })));
  check("each task inside the card shows its state and keeps its own button", rows.length === subCount && rows.every((row) => row.state && row.hasButton) && dealOps().every((op) => rows.some((row) => row.id === op.id)), rows.map((r) => r.state).join(" | "));
  // A stage of the deal path never hides a task: the deal's waiting reply sits in «تواصل», so the deal is listed there too.
  const waiting = dealOps().some((op) => op.type === "AWAITING_REPLY");
  await page.locator('[data-path-strip] [data-step="1"]').click();
  await page.locator("[data-stage-head]:not([hidden])").waitFor();
  check("the stage «تواصل» lists the deal that waits for a reply, and its count matches", waiting && (await page.locator(`[data-deal="${jid}"]`).count()) === 1 && Number(await page.locator('[data-step-count="1"]').innerText()) === (await page.locator(".os-task-list > [data-task]").count()), `count ${await page.locator('[data-step-count="1"]').innerText()}, cards ${await page.locator(".os-task-list > [data-task]").count()}`);
  await page.locator("[data-stage-all]").click();
  await card.waitFor();
  await card.locator("[data-deal-subtasks] > summary").click();
  await shot("01-deal-card");
  const before = snapshot();
  const whatsappOpened = () => h.store.list(`offices/${OFFICE_A}/journeys/${jid}/events`).filter((e) => e.type === "WHATSAPP_OPENED").length;
  const openedBefore = whatsappOpened();
  const primaryType = await card.getAttribute("data-type");
  await card.locator("[data-deal-primary]").click();
  await page.waitForURL(/#\/session\//);
  await page.locator("[data-request]").first().waitFor();
  check("the main button opens the screen of the most pressing task directly (a request from a side → the room)", primaryType === "SESSION_INTERVENTION" && page.url().includes(`#/session/${jid}`));

  // ---------------- back to the same card
  step = "back to card";
  await page.setViewportSize({ width: 390, height: 520 });
  await page.locator(".os-back").click();
  await page.locator(`[data-deal="${jid}"]`).waitFor();
  const returned = await until(() => page.evaluate((id) => { const el = document.querySelector(`[data-deal="${id}"]`); if (!el || !el.classList.contains("is-returned") || scrollY < 50) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), scrollY: Math.round(scrollY), fromTop: Math.round(r.top + scrollY), height: innerHeight }; }, jid), "returned to the card");
  check("«رجوع» lands on the deal's own card in the tasks list (the list scrolled to it; the card is below the first screen)", page.url().includes("#/tasks") && returned.fromTop > returned.height && returned.top < returned.height && returned.bottom > 0, JSON.stringify(returned));
  await page.setViewportSize({ width: 390, height: 844 });

  // ---------------- Phase 2: متابعة الصفقة
  step = "follow hub";
  await page.locator(`[data-deal="${jid}"] [data-deal-follow]`).click();
  await page.locator("[data-follow-summary]").waitFor();
  check("«متابعة الصفقة» opens from the card", page.url().includes(`#/deal/${jid}`));
  const sections = await page.locator("[data-follow-section]").evaluateAll((els) => els.map((el) => `${el.dataset.followSection}:${el.querySelector("b").textContent}`));
  check("it gathers the five parts: التفاوض · المعاينة · المستندات · السجل · الإغلاق", sections.join("|") === "negotiation:التفاوض|viewing:المعاينة|documents:المستندات|timeline:السجل|close:الإغلاق", sections.join("|"));
  const pin = await page.evaluate(() => { const el = document.querySelector("[data-follow-summary]"); return { position: getComputedStyle(el).position, height: Math.round(el.getBoundingClientRect().height), screen: innerHeight }; });
  check("stage and next action sit in a fixed, clear place that stays in view and leaves the screen free", (await page.locator("[data-follow-summary] [data-follow-stage]").innerText()).includes("تفاوض") && (await page.locator("[data-follow-now]").innerText()).includes("المطلوب الآن") && pin.position === "sticky" && pin.height < pin.screen * 0.25, JSON.stringify(pin));
  check("the main button of the deal is right under it", (await page.locator("[data-follow-next] [data-deal-primary]").count()) === 1);
  check("all of the deal's tasks are listed here too", Number(await page.locator("[data-follow-tasks]").getAttribute("data-follow-tasks")) === subCount && (await page.locator("[data-follow-tasks] [data-subtask]").count()) === subCount);
  const options = await page.locator("[data-contact-option]").evaluateAll((els) => els.map((el) => ({ id: el.dataset.contactOption, name: el.querySelector("b").textContent, what: el.querySelector("small").textContent.length, state: el.querySelector("[data-contact-state]").textContent })));
  check("both existing contact paths are shown, named and explained: «غرفة التفاوض» and «إرسال مقترح»", options.map((o) => o.name).join("|") === "غرفة التفاوض|إرسال مقترح" && options.every((o) => o.what > 30 && o.state), JSON.stringify(options.map((o) => o.state)));
  await page.locator("[data-contact-log] > summary").click();
  const log = await page.locator("[data-contact-event]").evaluateAll((els) => els.map((el) => ({ type: el.dataset.contactEvent, certain: el.dataset.contactCertain, text: el.textContent })));
  check("the contact log says what was created or opened", log.some((e) => e.type === "SESSION_LINK") && log.length >= 2, log.map((e) => e.type).join(","));
  check("it never claims a WhatsApp message was sent or delivered", !log.some((e) => /تم الإرسال|أُرسلت عبر واتساب|وصلت الرسالة/.test(e.text)) && (await page.locator(".os-follow-honest").innerText()).includes("لا يستطيع التأكد"));
  await shot("02-follow-hub");
  // Two calls existed before this work and are not caused by the new screens: the app's own start-up
  // «/os/reconcile» and the room page asking for the two party links it shows. Neither sends anything.
  const caused = writes.filter((w) => !/\/os\/(reconcile|session\/links)$/.test(w));
  check("opening the card, the room and «متابعة الصفقة» changed nothing in the deal (stage, session, viewing, documents, tasks, log)", snapshot() === before, snapshot() === before ? "" : `before ${before.length} after ${snapshot().length}`);
  check("…and no action was sent by merely opening them", caused.length === 0, caused.join(","));

  step = "sections";
  const expectAt = async (section, urlPart, selector, label) => {
    await page.goto(`${h.origin}/#/deal/${jid}`); await page.locator(`[data-follow-section="${section}"]`).click();
    await page.waitForURL(new RegExp(urlPart)); await page.locator(selector).first().waitFor();
    check(label, true);
  };
  await expectAt("negotiation", `#/session/${jid}`, '[data-room-part="versus"]', "«التفاوض» opens the negotiation room");
  check("the room carries the same section bar, with «التفاوض» marked", (await page.locator('[data-follow-bar] [data-follow-tab="negotiation"]').getAttribute("aria-current")) === "page");
  await expectAt("viewing", `#/journey/${jid}\\?focus=viewing`, "#now", "«المعاينة» opens the deal page at «المطلوب الآن»");
  await expectAt("documents", `#/journey/${jid}\\?focus=documents`, 'details[data-panel="documents"][open]', "«المستندات» opens the documents of the deal");
  await expectAt("timeline", `#/journey/${jid}\\?focus=timeline`, 'details[data-panel="history"][open]', "«السجل» opens the deal's log");
  await expectAt("close", `#/journey/${jid}\\?focus=close`, ".os-sheet .os-menu", "«الإغلاق» shows the existing actions menu");
  const closeMenu = await page.locator(".os-sheet .os-menu").innerText();
  check("closing still needs the broker's own choice and confirmation (nothing happened by opening)", closeMenu.includes("إتمام الصفقة") && closeMenu.includes("إغلاق دون صفقة") && journey().status === "ACTIVE" && snapshot() === before);
  await page.keyboard.press("Escape");
  await page.goto(`${h.origin}/#/journey/${jid}?focus=documents`); await page.locator("[data-follow-bar]").waitFor();
  await page.locator("[data-follow-hub]").click();
  await page.locator("[data-follow-summary]").waitFor();
  check("the section bar on the deal page leads back to «متابعة الصفقة»", page.url().includes(`#/deal/${jid}`));
  // «رجوع» after moving between sections: one press leaves the page, and the actions menu never opens by itself.
  await page.locator('[data-follow-section="close"]').click();
  await page.locator(".os-sheet .os-menu").waitFor();
  check("the address drops «focus=close» as soon as the menu is shown", !page.url().includes("focus=close"), page.url().split("#")[1]);
  await page.keyboard.press("Escape");
  await page.locator(".os-sheet").waitFor({ state: "detached" });
  await page.locator('[data-follow-tab="timeline"]').click();
  await page.locator('details[data-panel="history"][open]').waitFor();
  await page.locator('[data-follow-tab="documents"]').click();
  await page.locator('details[data-panel="documents"][open]').waitFor();
  await page.locator(".os-back").click();
  await page.locator("[data-follow-summary]").waitFor();
  await page.waitForTimeout(400);
  check("after moving between sections, one «رجوع» leaves the deal page and no actions menu opens by itself", page.url().includes(`#/deal/${jid}`) && (await page.locator(".os-sheet").count()) === 0 && snapshot() === before, page.url().split("#")[1]);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`${h.origin}/#/journey/${jid}?focus=documents`); await page.locator("[data-follow-bar]").waitFor();
  const clippedTabs = await page.locator("[data-follow-tab] span").evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().width > el.parentElement.getBoundingClientRect().width + 1).map((el) => el.textContent));
  check("the five section names are fully readable on the narrowest phone (320px)", clippedTabs.length === 0, clippedTabs.join(","));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${h.origin}/#/deal/${jid}`); await page.locator("[data-follow-summary]").waitFor();
  await page.locator("[data-back-to-card]").click();
  await page.locator(`[data-deal="${jid}"]`).waitFor();
  check("«بطاقة الصفقة» returns to this deal's card, not to the start of the app", page.url().includes("#/tasks") && await until(() => page.evaluate((id) => { const el = document.querySelector(`[data-deal="${id}"]`); const r = el.getBoundingClientRect(); return el.classList.contains("is-returned") && scrollY > 50 && r.top < innerHeight && r.bottom > 0; }, jid), "card in view"));
  // The list comes back as the broker left it (its stage filter), not as the plain list.
  await page.goto(`${h.origin}/#/tasks?step=2`); await page.locator(`[data-deal="${jid}"] [data-deal-follow]`).click();
  await page.locator("[data-back-to-card]").click();
  await page.locator(`[data-deal="${jid}"]`).waitFor();
  check("…and the list keeps the stage the broker was looking at", page.url().includes("#/tasks?step=2"), page.url().split("#")[1]);

  // ---------------- the two contact paths still work
  step = "contact paths";
  await page.goto(`${h.origin}/#/deal/${jid}`); await page.locator('[data-contact-open="proposal"]').click();
  await page.locator('details[data-panel="communication"][open]').waitFor();
  await page.locator('details[data-panel="communication"]').getByRole("button", { name: "إرسال مقترح", exact: true }).click();
  await page.locator(".os-sheet").waitFor();
  check("«إرسال مقترح» still opens the existing composer (nothing is created until the broker prepares it)", (await page.locator(".os-sheet").count()) === 1 && snapshot() === before);
  await page.keyboard.press("Escape");
  await page.goto(`${h.origin}/#/deal/${jid}`); await page.locator('[data-contact-open="room"]').click();
  await page.locator(".os-session-link").first().waitFor();
  check("«غرفة التفاوض» still offers each side's link; sending stays a button the broker presses", (await page.locator(".os-session-link").count()) === 2 && whatsappOpened() === openedBefore, `${await page.locator(".os-session-link").count()} links, opened ${openedBefore}→${whatsappOpened()}`);

  // ---------------- daily access
  step = "daily access";
  await open("office", ".ref-office-tools");
  check("the office home has a direct entry to «مركز التواصل»", (await page.locator("[data-inbox-entry]").count()) === 1);
  check("the header has search, the bell and the menu", (await page.locator("[data-header-search]").count()) === 1 && (await page.locator("[data-header-bell]").count()) === 1 && (await page.locator(".ref-menu").count()) === 1);
  await shot("03-office-home");
  await page.locator("[data-inbox-entry]").click();
  await page.locator("[data-inbox]").waitFor();
  check("the entry opens the same communication center", page.url().includes("#/inbox"));
  await open("tasks", "[data-task]");
  await page.locator("[data-header-search]").click();
  await page.locator("[data-search-input]").waitFor();
  check("the search shortcut opens the existing search", page.url().includes("#/search"));
  // An older notification of a reviewed match (its task is finished): «workflowId» holds a match group, not a deal.
  const oldMatchId = s.review.matchId;
  h.store.seed(`offices/${OFFICE_A}/notifications/nt_e2e_old_review`, { id: "nt_e2e_old_review", officeId: OFFICE_A, brokerId: "", operationId: "op_finished_long_ago", taskId: "mg_opp_e2e", workflowId: "mg_opp_e2e", matchId: oldMatchId, opportunityId: s.review.requestId, entityType: "match", entityId: oldMatchId, title: "مطابقة جديدة — #E2E", body: "مطابقة جديدة — #E2E", createdAt: new Date().toISOString() });
  await open("tasks", "[data-task]");
  const notifications = h.store.list(`offices/${OFFICE_A}/notifications`);
  await page.locator("[data-header-bell]").click();
  await page.locator("[data-notifications] [data-notification]").first().waitFor();
  const shown = await page.locator("[data-notification]").evaluateAll((els) => els.map((el) => ({ id: el.dataset.notification, route: el.dataset.notificationRoute, title: el.querySelector("b").textContent })));
  check("the bell opens the notifications list (not the menu)", (await page.locator(".os-sheet").innerText()).includes("التنبيهات") && shown.length === Math.min(notifications.length, 40) && (await page.locator(".os-menu").count()) === 0, `${shown.length}/${notifications.length}`);
  const journeyIds = new Set(h.store.list(`offices/${OFFICE_A}/journeys`).map((j) => j.journeyId || j.id));
  const matchIds = new Set(h.store.list(`offices/${OFFICE_A}/matches`).map((m) => m.id));
  const recordIds = new Set(h.store.list(`offices/${OFFICE_A}/opportunities`).map((r) => r.id));
  const dead = shown.filter((n) => { const [kind, id] = n.route.split("?")[0].split("/"); return kind === "journey" || kind === "session" ? !journeyIds.has(id) : kind === "review" ? !matchIds.has(id) : kind === "record" ? !recordIds.has(id) : n.route !== "tasks"; });
  check("every notification leads to something that exists (a deal, a room, a review, a record — never a missing page)", dead.length === 0 && shown.some((n) => n.route.startsWith("session/")), dead.map((n) => n.route).join(",") || shown.map((n) => n.route.split("/")[0]).join(","));
  check("an older «مطابقة جديدة» notification opens the review of its match", shown.find((n) => n.id === "nt_e2e_old_review")?.route === `review/${oldMatchId}`, shown.find((n) => n.id === "nt_e2e_old_review")?.route);
  await shot("04-notifications");
  const roomNote = shown.find((n) => n.route === `session/${jid}`);
  await page.locator(`[data-notification="${roomNote.id}"]`).click();
  await page.waitForURL(new RegExp(`#/session/${jid}`));
  check("a notification opens the place its push link opens (a request from a side → the room)", true);
  await open("tasks", "[data-task]");
  await page.locator(".ref-menu").click();
  await page.locator(".os-menu").waitFor();
  const menu = await page.locator(".os-menu").innerText();
  check("the menu and its pages are all still there", ["البحث الشامل", "مركز التواصل", "مكتبة المكتب", "إعدادات الإشعارات", "التعاون بين الوسطاء", "سجل النشاط", "إعدادات المكتب", "تسجيل الخروج"].every((item) => menu.includes(item)));
  await page.keyboard.press("Escape");

  // ---------------- documents: a library file linked to the deal
  step = "documents";
  await page.goto(`${h.origin}/#/journey/${jid}?focus=documents`); await page.locator('[data-doc="title_deed"] [data-doc-attach]').waitFor();
  await page.locator('[data-doc="title_deed"] [data-doc-attach]').click();
  await page.locator('[data-library-item="lib_e2e_deed_01"]').waitFor();
  await shot("05-library-picker");
  await page.locator('[data-library-item="lib_e2e_deed_01"]').click();
  await page.locator('[data-doc="title_deed"] [data-doc-file="lib_e2e_deed_01"]').waitFor();
  const linkedDoc = journey().documents.title_deed;
  check("a library file is linked to the deal document (reference only)", linkedDoc.file.libraryId === "lib_e2e_deed_01" && (await page.locator('[data-doc="title_deed"] [data-doc-file]').innerText()).includes("صك فيلا النرجس"));
  check("the file stays in the library: no copy, no move, the item unchanged", h.store.list(`offices/${OFFICE_A}/library`).length === 1 && h.store.get(`offices/${OFFICE_A}/library/lib_e2e_deed_01`).mediaPath === up.mediaPath);
  check("linking did not change the item's status or the deal's phase", linkedDoc.status === "MISSING" && journey().phase === JSON.parse(before).phase);
  const fileResponse = page.waitForResponse((r) => r.url().includes("/worker/media/office?") && r.request().method() === "GET");
  const popup = page.waitForEvent("popup").catch(() => null);
  await page.locator('[data-doc="title_deed"] [data-doc-file-open]').click();
  const fetched = await fileResponse;
  check("«فتح الملف» reads it from the library with the member's own access", fetched.status() === 200);
  await (await popup)?.close().catch(() => {});
  await shot("06-document-linked");
  await page.locator('[data-doc="title_deed"] [data-doc-file-unlink]').click();
  await page.locator('[data-doc="title_deed"] [data-doc-attach]').waitFor();
  check("«إزالة الربط» removes only the link; the file is still in the library", journey().documents.title_deed.file === null && Boolean(h.store.get(`offices/${OFFICE_A}/library/lib_e2e_deed_01`)));
  await page.locator("[data-docs-library]").click();
  await page.waitForURL(/#\/library/);
  check("a clear link opens the office library", true);

  // ---------------- old links and notifications keep working
  step = "old links";
  const subTask = dealOps().find((op) => op.type === "PROPOSAL_REPLY") || dealOps().find((op) => op.type !== "DEAL_JOURNEY");
  await page.goto(`${h.origin}/#/task/${subTask.id}`); await page.reload();
  await page.locator(".ref-detail-step").waitFor();
  check("the old «تفاصيل المهمة» page of a task inside a deal still opens", true);
  await page.goto(`${h.origin}/?openOperation=${encodeURIComponent(subTask.id)}`);
  await page.waitForURL(new RegExp(`#/journey/${jid}`), { timeout: 12000 });
  check("a push link to that task still opens its screen", true);
  await page.goto(`${h.origin}/?openOperation=${encodeURIComponent(`session:${jid}`)}`);
  await page.waitForURL(new RegExp(`#/session/${jid}`), { timeout: 12000 });
  check("a push link to the negotiation room still opens the room", true);
  await page.goto(`${h.origin}/#/tasks?step=2`); await page.reload(); await page.locator(`[data-deal="${jid}"]`).waitFor();
  check("the deal-path stage link still filters the list, and the deal sits in its own stage once", (await page.locator(`[data-deal="${jid}"]`).count()) === 1 && (await page.locator('[data-step="2"] [data-step-count]').innerText()) === String(await page.locator("[data-task]").count()));
  check("no task was created, removed or rescheduled by any of this", JSON.stringify(ops().map((op) => `${op.id}:${op.status}:${op.dueAt || ""}`).sort()) === JSON.stringify(JSON.parse(before).ops));

  // ---------------- phone widths
  step = "widths";
  for (const width of [320, 390]) {
    const c = await browser.newContext({ viewport: { width, height: 720 }, deviceScaleFactor: 1, locale: "ar-SA", hasTouch: true });
    await c.addInitScript(([u, o]) => { localStorage.setItem("harness.uid", u); localStorage.setItem("iaqar.officeId", o); }, [OWNER_A, OFFICE_A]);
    const p = await c.newPage(); p.setDefaultTimeout(10000);
    for (const [name, hash, wait, act] of [["tasks", "tasks", `[data-deal="${jid}"]`, async () => { await p.locator(`[data-deal="${jid}"] [data-deal-subtasks] > summary`).click(); }], ["hub", `deal/${jid}`, "[data-follow-summary]", null], ["deal page", `journey/${jid}?focus=documents`, "[data-follow-bar]", null]]) {
      await p.goto(`${h.origin}/#/${hash}`); await p.reload(); await p.locator(wait).first().waitFor(); if (act) await act(); await p.waitForTimeout(250);
      const res = await p.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const outside = [...document.querySelectorAll("main button, main a, main summary")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && !el.closest("details:not([open])") || el.matches("summary") ? (r.left < -1 || r.right > W + 1) : false; }).length;
        const clipped = [...document.querySelectorAll("main button")].filter((el) => el.getBoundingClientRect().width > 0 && el.scrollWidth > el.clientWidth + 2).length;
        return { overflow: document.scrollingElement.scrollWidth - W, outside, clipped };
      });
      check(`${width}px ${name}: no horizontal scroll, no control outside the screen, no clipped button text`, res.overflow <= 1 && res.outside === 0 && res.clipped === 0, JSON.stringify(res));
    }
    await c.close();
  }

  check("no browser console errors", errors.length === 0, errors.slice(0, 4).join(" | "));
} catch (error) {
  check(`completed without exception (step ${step})`, false, String(error.message).split("\n")[0]);
  try { await page.screenshot({ path: path.join(OUT, "zz-failure.png"), fullPage: true }); } catch (_) { /* ignore */ }
} finally {
  await browser.close();
  h.server.close();
}
const failed = checks.filter((c) => !c.ok);
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ at: new Date().toISOString(), passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
// In CI a failed check is also written as an annotation, so it can be read without the raw log.
if (process.env.GITHUB_ACTIONS) for (const c of failed) console.log(`::error title=broker-steps::${`${c.name} — ${c.detail}`.replace(/\r?\n/g, " ").slice(0, 400)}`);
console.log(`\n${checks.length - failed.length}/${checks.length} broker-steps checks passed`);
process.exit(failed.length ? 1 : 0);
