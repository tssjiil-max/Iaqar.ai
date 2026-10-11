// «باحث الفرص» — browser check on the local harness (real Worker, real UI, in-memory store, isolated data).
// The manager switches it on; an offer and a request get their searches by themselves; a record starts and stops
// its own search with one press (nothing asked again); a pasted digest becomes the few finds worth a call; a find
// opens with why it fits; a sentence becomes an urgent search; each search has its own controls; switching the
// scout off keeps results and settings; another office sees nothing. No message leaves the machine.
//   node scripts/qa/office-os/scout.e2e.mjs   (OUT_DIR for screenshots)
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "qa/office-os/scout");
fs.mkdirSync(OUT, { recursive: true });

const { startOfficeOsHarness, idTokenFor, OWNER_A, OWNER_B, OFFICE_A, OFFICE_B } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
h.store.patch(`offices/${OFFICE_A}`, { city: "المدينة المنورة" });

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const checks = [];
const errors = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`); };
let step = "start";
const shot = async (page, name) => {
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  check(`no horizontal scroll: ${name}`, overflow <= 1, `${overflow}px`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
};
async function api(route, body, uid = OWNER_A, office = OFFICE_A) {
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${idTokenFor(uid)}` }, body: JSON.stringify({ officeId: office, ...body }) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const tasks = () => h.store.list(`offices/${OFFICE_A}/scoutTasks`);
const finds = () => h.store.list(`offices/${OFFICE_A}/scoutOpportunities`);
const schedule = () => JSON.parse(h.store.get("_system/scoutSchedule")?.entriesJson || "{}");

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true });
await ctx.addInitScript(([u, o]) => {
  localStorage.setItem("harness.uid", u); localStorage.setItem("iaqar.officeId", o);
  window.__opened = []; window.open = (url) => { window.__opened.push(String(url)); return { opener: null }; };
}, [OWNER_A, OFFICE_A]);
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(e.message));

const DIGEST = [
  "مطلوب عمارة للشراء في حي شوران بحدود 3 مليون ريال كاش، للتواصل 0559000111",
  "للبيع أرض سكنية في حي الحمراء مساحة 600 متر السعر مليون و350 الف من المالك مباشرة 0559000222",
  "للبيع أرض في حي الحمراء مساحة 550 متر السعر 1.4 مليون والتواصل على الخاص",
  "للإيجار شقة عزاب في حي قباء 14 الف سنوي 0559000333",
  "السلام عليكم ورحمة الله وبركاته، من يعرف سباك ممتاز؟"
].join("\n\n");

try {
  step = "home card (off)";
  await page.goto(`${h.origin}/#/office`);
  await page.locator("[data-scout-card]:not([hidden])").waitFor();
  check("office page shows «باحث الفرص» under the office tools, stopped until the manager switches it on", (await page.locator("[data-scout-card] [data-scout-status]").getAttribute("data-scout-status")) === "off");
  await shot(page, "01-home-card-off");

  step = "switch on";
  await page.locator("[data-scout-open]").click();
  await page.locator("[data-scout-enable]").waitFor();
  await shot(page, "02-scout-off");
  await page.locator("[data-scout-enable]").click();
  await page.locator('[data-scout-page] [data-scout-status="on"]').waitFor();
  check("the manager switches the scout on from its page; the state reads «يعمل الآن»", true);

  step = "inventory → searches";
  const offer = await api("/os/records/save", { requestKey: "e2e-offer", record: { kind: "OFFER", purpose: "SALE", propertyType: "عمارة", city: "المدينة المنورة", district: "شوران", price: 3000000, contactName: "مالك العمارة", contactPhone: "0551000001" } });
  const request = await api("/os/records/save", { requestKey: "e2e-request", record: { kind: "REQUEST", purpose: "PURCHASE", propertyType: "أرض", city: "المدينة المنورة", district: "الحمراء", price: 1500000, contactName: "عميل الأرض", contactPhone: "0551000002" } });
  const auto = tasks().filter((t) => t.origin === "AUTO");
  check("an offer with no buyer in the office gets a search for a buyer by itself", auto.some((t) => t.recordId === offer.body.recordId && t.seek === "REQUEST" && t.status === "ACTIVE"));
  check("a request with no property in the office gets a search for a property by itself", auto.some((t) => t.recordId === request.body.recordId && t.seek === "OFFER" && t.status === "ACTIVE"));
  await page.reload();
  await page.locator('[data-scout-stat="forOffers"]').waitFor();
  check("the page counts real searches: one offer looking for buyers, one request looking for properties", (await page.locator('[data-scout-stat="forOffers"] strong').textContent()) === "1" && (await page.locator('[data-scout-stat="forRequests"] strong').textContent()) === "1");
  await shot(page, "03-scout-on-searches");

  step = "from inside the record";
  await page.goto(`${h.origin}/#/record/${offer.body.recordId}`);
  await page.locator('[data-scout-record-state="running"]').waitFor();
  await shot(page, "04-record-searching");
  await page.locator('[data-scout-record-action="STOP"]').click();
  await page.locator('[data-scout-record-action="START"]').waitFor();
  const stopped = tasks().find((t) => t.recordId === offer.body.recordId);
  check("«إيقاف البحث لهذا السجل» stops this record only; the scout and the other searches keep running", stopped.status === "PAUSED" && stopped.stoppedByBroker === true && tasks().some((t) => t.recordId === request.body.recordId && t.status === "ACTIVE") && !schedule()[OFFICE_A].t[stopped.id] && Boolean(schedule()[OFFICE_A].t[tasks().find((t) => t.recordId === request.body.recordId).id]));
  check("inside an offer the button is «ابحث عن مشتري»", (await page.locator('[data-scout-record-action="START"]').textContent()).includes("ابحث عن مشتري"));
  await shot(page, "05-record-start-button");
  const inputsBefore = await page.locator("input:visible, select:visible, textarea:visible").count();
  await page.locator('[data-scout-record-action="START"]').click();
  await page.locator('[data-scout-record-state="running"]').waitFor();
  const restarted = tasks().find((t) => t.recordId === offer.body.recordId);
  check("one press starts the search from the record itself: nothing is asked again (type, district, price read from the offer)", inputsBefore === 0 && restarted.status === "ACTIVE" && restarted.profile.districts[0] === "شوران" && restarted.profile.propertyTypes[0] === "عمارة" && restarted.exactPrice === 3000000 && restarted.profile.tx === "sale");
  await page.goto(`${h.origin}/#/record/${request.body.recordId}`);
  await page.locator('[data-scout-record-state="running"]').waitFor();
  check("inside a request the search is for a property", (await page.locator('[data-scout-record-state="running"]').textContent()).includes("عن عقار لهذا الطلب"));

  step = "feed the scout";
  await page.goto(`${h.origin}/#/scout`);
  await page.locator("[data-scout-feed]").click();
  await page.locator("[data-feed-text]").fill(DIGEST);
  await shot(page, "06-feed-sheet");
  await page.locator("[data-feed-send]").click();
  await page.locator("[data-feed-result]:not([hidden])").waitFor();
  const feedLine = await page.locator("[data-feed-result]").textContent();
  await page.locator("[data-find]").first().waitFor();
  const cards = await page.locator("[data-find]").count();
  check("five pasted messages become exactly the two finds worth a call (the rest are not shown)", cards === 2 && /فرص|فرصتان|2/.test(feedLine), `${cards} cards · ${feedLine}`);
  check("one is a likely buyer for the office's building, the other a property for the office's client", (await page.locator('[data-find-category="BUYER"]').count()) === 1 && (await page.locator('[data-find-category="PROPERTY"]').count()) === 1);
  const kept = finds();
  check("the strong land with no way to reach its advertiser is kept inside only: not shown, no alert", kept.some((f) => f.district === "الحمراء" && !f.phone && f.surface === "HIDDEN") && !h.store.list(`offices/${OFFICE_A}/notifications`).some((n) => n.type === "SCOUT_OPPORTUNITY" && kept.find((f) => f.id === n.entityId && !f.phone)));
  check("the weak and the unrelated messages were not stored as finds", !kept.some((f) => f.district === "قباء") && kept.length === 3, `${kept.length} kept`);
  check("no record was created from the digest (the office's records are the two the broker added)", h.store.list(`offices/${OFFICE_A}/opportunities`).length === 2);
  await page.locator(".os-sheet .os-icon-btn").click().catch(() => {});
  await page.waitForTimeout(1600);
  await page.locator('[data-scout-away]').waitFor();
  await shot(page, "07-scout-board");
  const notes = h.store.list(`offices/${OFFICE_A}/notifications`).filter((n) => n.type === "SCOUT_OPPORTUNITY");
  check("an alert was written for the very strong finds, saying the point without a contact detail", notes.length >= 1 && notes.every((n) => /^scout\/opp\/so_/.test(n.route) && !/05\d{8}/.test(`${n.title}${n.body}`)), `${notes.length} · ${notes[0]?.title} — ${notes[0]?.body}`);

  step = "one find";
  await page.locator('[data-find-category="BUYER"]').click();
  await page.locator("[data-find-why]").waitFor();
  const facts = await page.locator("[data-find-facts]").textContent();
  check("the find says what, why it fits, which record it is for, its source, freshness and confidence", (await page.locator("[data-find-why] li").count()) >= 3 && (await page.locator("[data-find-record]").count()) === 1 && /المصدر/.test(facts) && /حداثة/.test(facts) && /الثقة/.test(facts));
  check("nothing technical is shown (no score, no queue, no model, no ids)", !/\b\d{2} من 100\b|queue|cron|gemini|token|so_\d/i.test(await page.locator("[data-scout-find-page]").textContent()));
  await shot(page, "08-find-detail");
  await page.locator('[data-find-action="CONTACT"]').click();
  await page.locator("[data-find-phone]").waitFor();
  check("«تواصل» shows the advertiser's number to the broker (the scout itself sends nothing)", (await page.locator("[data-find-phone]").textContent()) === "0559000111");
  await shot(page, "09-find-contact");
  await page.locator("[data-find-whatsapp]").click();
  await page.waitForFunction(() => window.__opened.length === 1);
  const opened = await page.evaluate(() => window.__opened[0]);
  await page.waitForTimeout(500);
  const contacted = finds().find((f) => f.phone === "0559000111");
  check("WhatsApp is opened by the broker's own press, with no text prepared; the find records «فُتح التواصل» only", opened.startsWith("https://wa.me/966559000111") && contacted.status === "CONTACTED" && !("sentAt" in contacted));
  await page.locator(".os-sheet .os-icon-btn").click();

  step = "ignore";
  await page.goto(`${h.origin}/#/scout`);
  await page.locator('[data-find-category="PROPERTY"]').click();
  await page.locator('[data-find-action="SAVE"]').click();
  await page.locator('[data-find-status="SAVED"]').waitFor();
  check("«حفظ لوقت لاحق» keeps the find on the board as saved", finds().find((f) => f.phone === "0559000222").status === "SAVED");
  await page.locator('[data-find-action="IGNORE"]').click();
  await page.locator("[data-scout-page]").waitFor();
  await page.waitForTimeout(400);
  check("«تجاهل» takes the find off the board", (await page.locator('[data-find-category="PROPERTY"]').count()) === 0 && finds().find((f) => f.phone === "0559000222").surface === "HIDDEN");

  step = "new search from a sentence";
  await page.locator("[data-scout-new]").click();
  await page.locator("[data-scout-sentence]").fill("ابحث لي بشكل مستعجل عن عمارة للبيع في شوران أو الهجرة، بحد أقصى مليونين، ويفضل من المالك مباشرة.");
  await page.locator("[data-scout-understand]").click();
  await page.locator("[data-scout-understood]:not([hidden])").waitFor();
  const form = await page.evaluate(() => ({
    mode: document.querySelector('[data-seg="mode"] [aria-pressed="true"]').dataset.segValue, tx: document.querySelector('[data-seg="tx"] [aria-pressed="true"]').dataset.segValue,
    seek: document.querySelector('[name="seek"]').value, type: document.querySelector('[name="propertyType"]').value, districts: document.querySelector('[name="districts"]').value,
    max: document.querySelector('[name="priceMax"]').value, owner: document.querySelector('[name="preferDirectOwner"]').checked, city: document.querySelector('[name="city"]').value
  }));
  check("the sentence is understood: urgent, a building for sale, شوران or الهجرة, up to two million, direct owner preferred — nothing typed twice",
    form.mode === "URGENT" && form.tx === "sale" && form.seek === "OFFER" && form.type === "عمارة" && form.districts === "شوران، الهجرة" && form.max === "2000000" && form.owner && form.city === "المدينة المنورة", JSON.stringify(form));
  await shot(page, "10-new-search-understood");
  await page.locator("[data-scout-start]").click();
  await page.locator("[data-scout-task-page] [data-task-state]").waitFor();
  const urgent = tasks().find((t) => t.origin === "CUSTOM");
  const entry = schedule()[OFFICE_A].t[urgent.id];
  check("the urgent search ran its first round at once and is queued at the highest priority, every scheduler beat", urgent.mode === "URGENT" && Boolean(urgent.lastRunAt) && entry.p === 3 && entry.c === 1 && entry.n - Date.now() <= 5 * 60_000 + 2000, JSON.stringify(entry));
  await shot(page, "11-task-urgent");

  step = "one search's own controls";
  await page.locator('[data-task-control="PAUSE"]').click();
  await page.locator('[data-task-state="PAUSED"]').waitFor();
  check("pausing one search leaves the others running", tasks().find((t) => t.id === urgent.id).status === "PAUSED" && tasks().filter((t) => t.status === "ACTIVE").length >= 3 && !schedule()[OFFICE_A].t[urgent.id]);
  await page.locator('[data-task-control="RESUME"]').click();
  await page.locator('[data-task-state="ACTIVE"]').waitFor();
  await page.locator('[data-task-control="END"]').click();
  await page.locator(".os-dialog button").first().click();
  await page.locator('[data-task-state="ENDED"]').waitFor();
  check("ending a search keeps what it found and removes it from the schedule", tasks().find((t) => t.id === urgent.id).status === "ENDED" && !schedule()[OFFICE_A].t[urgent.id]);
  await shot(page, "12-task-ended");

  step = "settings";
  await page.goto(`${h.origin}/#/settings`);
  await page.locator('[data-settings="scout"]').click();
  await page.locator("[data-scout-settings] [data-scout-toggle]").waitFor();
  check("the settings list only the sources verified as usable (no عقار, no حراج, no test source)", (await page.locator("[data-scout-source]").count()) === 2 && !/عقار|حراج|اختبار/.test(await page.locator("[data-scout-sources]").textContent()));
  await shot(page, "13-settings");
  const findsBefore = finds().length;
  await page.locator('[data-scout-toggle="off"]').click();
  await page.locator('[data-scout-toggle="on"]').waitFor();
  check("switching the scout off stops every automatic search safely: nothing is scheduled, and the finds, searches and settings are all still there",
    !schedule()[OFFICE_A] && finds().length === findsBefore && tasks().length >= 3 && h.store.get(`offices/${OFFICE_A}/scoutSettings/main`).city === "المدينة المنورة");
  await page.locator('[data-scout-toggle="on"]').click();
  await page.locator('[data-scout-toggle="off"]').waitFor();
  check("switching it on again queues the running searches", Object.keys(schedule()[OFFICE_A]?.t || {}).length >= 3);

  step = "another office";
  const other = await api("/os/scout/overview", {}, OWNER_B, OFFICE_B);
  const stolen = await api("/os/scout/find", { opportunityId: finds()[0].id }, OWNER_B, OFFICE_B);
  const cross = await api("/os/scout/overview", {}, OWNER_B, OFFICE_A);
  check("another office sees none of this office's finds or searches, and cannot open them by id", other.body.board.length === 0 && other.body.tasks.length === 0 && stolen.status === 404 && cross.status === 403, `${stolen.status} ${cross.status}`);

  step = "phone widths";
  for (const width of [320, 360, 430]) {
    await page.setViewportSize({ width, height: 800 });
    for (const route of ["scout", "scout/new", "settings/scout"]) {
      await page.goto(`${h.origin}/#/${route}`);
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
      check(`no horizontal scroll at ${width}px: ${route}`, overflow <= 1, `${overflow}px`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${h.origin}/#/office`);
  await page.locator('[data-scout-card] [data-scout-status="on"]').waitFor();
  await shot(page, "14-home-card-on");
} catch (error) {
  check(`step failed: ${step}`, false, String(error?.message || error).split("\n")[0]);
  await page.screenshot({ path: path.join(OUT, "failure.png"), fullPage: true }).catch(() => {});
}

check("no page errors", errors.filter((e) => !/favicon|firebase-messaging|manifest/i.test(e)).length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
h.server.close();
const failed = checks.filter((c) => !c.ok);
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ at: new Date().toISOString(), checks }, null, 2));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
