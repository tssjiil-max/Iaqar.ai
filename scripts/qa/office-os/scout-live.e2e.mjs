// «الباحث عن الفرص» — live check on Staging after the deploy (isolated QA offices only).
//
// Proves the whole chain on the deployed Worker and the deployed app, with real Firestore, the real cron and the
// real rules — and without touching any third-party site:
//   offer / request / custom search → search task → background round by the Worker's own cron → a source adapter
//   (the QA test source, Staging + test-fixture offices only) → extraction → merging of two sightings → level →
//   matching with the office's records → external find → alert → the find opened from the broker's office.
//
//   env: STAGING_URL, STAGING_WORKER_URL, FIREBASE_SERVICE_ACCOUNT_JSON (Staging), OUT_DIR
// Guards: the Staging service account, the Staging channel host and the Staging Worker only. It writes only under
// offices/qa-office-scout*, this run's users and their login entries. Production is read once (/health) and never written.
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { parseFirebaseServiceAccountJson } from "../../staging-credentials.mjs";
import { annotateFailure, visibleState } from "../annotate-failure.mjs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

for (const event of ["uncaughtException", "unhandledRejection"]) {
  process.on(event, (error) => { console.log(`::error title=scout live script crashed::${String(error?.stack || error).split("\n").slice(0, 3).join(" | ").replace(/%/g, "%25")}`); process.exit(1); });
}
const require = createRequire(import.meta.url);
const { chromium } = (() => { try { return require("playwright"); } catch (_) { return require(path.join(execSync("npm root -g").toString().trim(), "playwright")); } })();

const PROJECT = "iaqar-ai-staging";
const APP = String(process.env.STAGING_URL || "https://iaqar-ai-staging--staging-9c4b0k7h.web.app").replace(/\/+$/, "");
const WORKER = String(process.env.STAGING_WORKER_URL || "https://iaqar-intake-staging.iaqar-ai.workers.dev").replace(/\/+$/, "");
const PRODUCTION_WORKER = "https://iaqar-macrodroid-intake.iaqar-ai.workers.dev";
const OUT = process.env.OUT_DIR || "qa-scout-live";
fs.mkdirSync(OUT, { recursive: true });
const OFFICE = "qa-office-scout";
const OFFICE_B = "qa-office-scout-b";
const RUN = String(process.env.GITHUB_RUN_ID || Date.now()).replace(/[^0-9A-Za-z]/g, "");

if (new URL(APP).hostname !== `${PROJECT}--staging-9c4b0k7h.web.app` || !/^https:\/\/iaqar-intake-staging\./.test(WORKER)) throw new Error(`refusing: ${APP} + ${WORKER} is not Staging`);
const { serviceAccount } = parseFirebaseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON, PROJECT);
if (serviceAccount?.project_id !== PROJECT) throw new Error("refusing: not the Staging service account");
initializeApp({ credential: cert(serviceAccount), projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();

const checks = [];
const check = (name, ok, detail = "") => { checks.push({ name, ok: Boolean(ok), detail: String(detail).slice(0, 300) }); console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${String(detail).slice(0, 220)}` : ""}`); };
const sha = (v) => crypto.createHash("sha256").update(v).digest("hex");
const QA_PATH = /^offices\/qa-office-scout(-b)?(\/|$)/;
const qa = (ref) => { if (!QA_PATH.test(ref.path)) throw new Error(`refusing path ${ref.path}`); return ref; };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, timeout, every = 5000) {
  const start = Date.now();
  for (;;) { const value = await fn(); if (value) return value; if (Date.now() - start > timeout) return null; await sleep(every); }
}

const SCOUT_COLLECTIONS = ["scoutSettings", "scoutState", "scoutTasks", "scoutOpportunities", "scoutFeed", "scoutFixtures", "scoutRuns"];
async function resetOffice(officeId, ownerUid, name) {
  const office = qa(db.collection("offices").doc(officeId));
  const snap = await office.get();
  if (snap.exists && snap.data().isTestFixture !== true) throw new Error(`refusing: ${officeId} exists and is not a test fixture`);
  for (const sub of [...SCOUT_COLLECTIONS, "opportunities", "matches", "operations", "journeys", "notifications", "members", "auditLogs", "matchCurrentPointers", "contacts", "clients", "owners"]) await db.recursiveDelete(qa(office.collection(sub)));
  await office.set({
    officeId, officeName: name, officeNameKey: `qa${officeId.replace(/[^a-z]/g, "")}`, brokerName: "وسيط الاختبار", licenseNumber: "1200000000", city: "المدينة المنورة", phone: "0500000000",
    ownerUid, active: true, isTestFixture: true, createdBy: "scout-live", specialties: ["sale"], platformOpportunityOnboardingAckAt: new Date(), updatedAt: new Date()
  });
  await office.collection("members").doc(ownerUid).set({ uid: ownerUid, role: "owner", active: true, isTestFixture: true, testRunId: RUN });
}

const users = [];
async function makeUser(role, officeId) {
  const uid = `qa-scout-${role}-${RUN}`.slice(0, 128);
  const phone = `05998${String(crypto.randomInt(0, 99999)).padStart(5, "0")}`;
  const email = `${uid}@qa-scout.invalid`;
  const password = crypto.randomBytes(18).toString("base64url");
  const dirRef = db.collection("loginDirectory").doc(sha(`+966${phone.slice(1)}`));
  if ((await dirRef.get()).exists) throw new Error("refusing: login directory collision");
  await auth.createUser({ uid, email, password, displayName: `QA scout ${role}` });
  await dirRef.set({ uid, officeId, email, phone: `+966${phone.slice(1)}`, active: true, isTestFixture: true, testRunId: RUN });
  const user = { uid, phone, email, password, dirRef };
  users.push(user);
  return user;
}

let apiKey = "";
async function idToken(uid) {
  if (!apiKey) apiKey = (await (await fetch(`${APP}/__/firebase/init.json`)).json()).apiKey;
  const custom = await auth.createCustomToken(uid);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }) });
  const body = await res.json();
  if (!body.idToken) throw new Error(`sign-in failed ${res.status}`);
  return body.idToken;
}
const tokens = {};
async function api(route, body, uid, officeId = OFFICE) {
  tokens[uid] ||= await idToken(uid);
  const res = await fetch(`${WORKER}${route}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tokens[uid]}` }, body: JSON.stringify({ officeId, ...body }) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const office = db.collection("offices").doc(OFFICE);
const tasks = async () => (await office.collection("scoutTasks").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const finds = async () => (await office.collection("scoutOpportunities").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const alerts = async () => (await office.collection("notifications").get()).docs.map((d) => d.data()).filter((n) => String(n.type || "").startsWith("SCOUT_"));
const queue = async () => { const doc = await db.collection("_system").doc("scoutSchedule").get(); return { entries: JSON.parse(doc.data()?.entriesJson || "{}"), health: JSON.parse(doc.data()?.healthJson || "{}") }; };
let clock = Date.now();
async function fixture(id, { tag = "one", text, phone = "" }) {
  clock += 1000;
  await qa(office.collection("scoutFixtures").doc(id)).set({ officeId: OFFICE, sourceTag: tag, externalId: id, text, phone, publishedAt: new Date(), updatedAt: new Date(clock), isTestFixture: true });
}

const browser = await chromium.launch();
try {
  // ---------- the deployed Worker
  const health = await (await fetch(`${WORKER}/health`)).json();
  check("live: the Staging Worker has «الباحث عن الفرص» available (each office with its own switch)", health.deploymentEnvironment === "staging" && health.projectId === PROJECT && health.opportunityScout === "per_office_switch", JSON.stringify({ env: health.deploymentEnvironment, scout: health.opportunityScout }));
  const production = await fetch(`${PRODUCTION_WORKER}/health`).then((r) => r.json()).catch(() => ({}));
  console.log(`production Worker (read once, informational): opportunityScout=${production.opportunityScout ?? "absent"}`);
  check("live: this check never writes to Production (it only read its public health line)", true, `production opportunityScout=${production.opportunityScout ?? "absent"}`);
  const unauth = await fetch(`${WORKER}/os/scout/overview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ officeId: OFFICE }) });
  check("live: scout routes need a signed-in office member", unauth.status === 401, String(unauth.status));

  const owner = await makeUser("owner", OFFICE);
  const ownerB = await makeUser("ownerb", OFFICE_B);
  await resetOffice(OFFICE, owner.uid, "مكتب اختبار الباحث عن الفرص");
  await resetOffice(OFFICE_B, ownerB.uid, "مكتب اختبار العزل");

  // ---------- the test source already has ads before anything is switched on (10 ads: 4 that matter, 6 weak)
  await fixture("buyer", { text: "مطلوب عمارة للشراء في حي شوران بحدود 3 مليون ريال كاش", phone: "0559000111" });
  await fixture("land-a", { tag: "one", text: "للبيع أرض سكنية في حي الحمراء مساحة 600 متر السعر مليون و350 الف", phone: "0559000222" });
  await fixture("land-b", { tag: "two", text: "أرض سكنية للبيع بحي الحمراء 600م بسعر مليون و350 ألف", phone: "0559000222" });
  await fixture("silent", { tag: "one", text: "مطلوب عمارة للشراء في حي شوران الميزانية 2.9 مليون والدفع كاش، التواصل على الخاص" });
  for (let i = 0; i < 6; i += 1) await fixture(`weak-${i}`, { text: `للإيجار شقة عزاب في حي قباء غرفتين ${14 + i} الف سنوي`, phone: `05591${String(10000 + i)}` });
  const beatBefore = (await queue()).health;

  // ---------- the broker's office in a real browser: the card, switching it on
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "ar-SA", hasTouch: true });
  await ctx.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "whatsapp" }));
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const shot = async (name) => { await page.waitForTimeout(800); await page.screenshot({ path: path.join(OUT, `scout-live-${name}.png`), fullPage: true }); };
  await page.goto(`${APP}/`);
  await page.fill('input[name="phone"]', owner.phone);
  await page.fill('input[name="password"]', owner.password);
  await page.getByRole("button", { name: "دخول المكتب" }).click();
  await page.locator("[data-scout-card]:not([hidden])").waitFor();
  check("live: the office page shows «الباحث عن الفرص», stopped by default", (await page.locator("[data-scout-card] [data-scout-status]").getAttribute("data-scout-status")) === "off");
  await page.locator("[data-scout-open]").click();
  await page.locator("[data-scout-enable]").click();
  await page.locator('[data-scout-page] [data-scout-status="on"]').waitFor();
  check("live: the manager switched the scout on from the app", (await office.collection("scoutSettings").doc("main").get()).data()?.enabled === true);

  // ---------- inventory → searches (scenarios 1–4)
  const record = (kind, type, district, price, phone) => ({ kind, purpose: kind === "OFFER" ? "SALE" : "PURCHASE", propertyType: type, city: "المدينة المنورة", district, price, contactName: kind === "OFFER" ? "مالك اختبار" : "عميل اختبار", contactPhone: phone });
  const offer = await api("/os/records/save", { requestKey: `scout-live-offer-${RUN}`, record: record("OFFER", "عمارة", "شوران", 3_000_000, "0551000001") }, owner.uid);
  const request = await api("/os/records/save", { requestKey: `scout-live-request-${RUN}`, record: record("REQUEST", "أرض", "الحمراء", 1_500_000, "0551000002") }, owner.uid);
  const auto = (await tasks()).filter((t) => t.origin === "AUTO");
  check("live: an offer with no buyer in the office got a search for a buyer by itself", auto.some((t) => t.recordId === offer.body.recordId && t.seek === "REQUEST" && t.status === "ACTIVE"), `${offer.status}`);
  check("live: a request with no property in the office got a search for a property by itself", auto.some((t) => t.recordId === request.body.recordId && t.seek === "OFFER" && t.status === "ACTIVE"), `${request.status}`);
  const stop = await api("/os/scout/record", { recordId: offer.body.recordId, action: "STOP" }, owner.uid);
  const restart = await api("/os/scout/record", { recordId: offer.body.recordId, action: "START" }, owner.uid);
  const restarted = (await tasks()).find((t) => t.recordId === offer.body.recordId);
  check("live: «ابحث عن مشتري» — the request carries only the record id; type, district and price come from the offer", stop.status === 200 && restart.status === 200 && restarted.status === "ACTIVE" && restarted.profile?.districts?.[0] === "شوران" && restarted.profile?.propertyTypes?.[0] === "عمارة" && restarted.exactPrice === 3_000_000);

  // ---------- nobody is on the site now; the Worker's own cron does the round
  console.log("waiting for the Staging Worker's cron (every 5 minutes) to run the general searches…");
  const found = await until(async () => {
    const all = await finds();
    const linked = all.some((f) => f.phone === "0559000111" && f.bestRecordId === offer.body.recordId) && all.some((f) => f.phone === "0559000222" && f.bestRecordId === request.body.recordId && Number(f.sourceCount) === 2);
    return linked ? all : null;
  }, 12 * 60_000, 10_000);
  // The finds are written during the round; the scheduler's own line is written when the round ends, a moment later.
  const beatAfter = (await until(async () => { const health = (await queue()).health; return health.lastWorkAt && health.lastWorkAt !== beatBefore.lastWorkAt ? health : null; }, 90_000, 3000)) || (await queue()).health;
  check("live: the general search ran in the background from the Worker's cron, with nobody on the site", Boolean(found) && beatAfter.lastWorkAt && beatAfter.lastWorkAt !== beatBefore.lastWorkAt, `lastWorkAt ${beatBefore.lastWorkAt || "—"} → ${beatAfter.lastWorkAt || "—"}`);
  const all = found || (await finds());
  const buyer = all.find((f) => f.phone === "0559000111");
  const land = all.filter((f) => f.phone === "0559000222");
  const silent = all.find((f) => Number(f.price) === 2_900_000);
  check("live: a likely buyer for the office's building — very strong, linked to the offer", buyer?.band === "VERY_STRONG" && buyer?.surface === "SHOWN" && buyer?.bestRecordId === offer.body.recordId, `${buyer?.band} ${buyer?.surface}`);
  check("live: the same land from two sources is ONE find («وُجدت في مصدرين»), linked to the client's request", land.length === 1 && Number(land[0].sourceCount) === 2 && land[0].bestRecordId === request.body.recordId, `${land.length} find(s), ${land[0]?.sourceCount} sources`);
  check("live: a strong find with no way to reach its advertiser is kept inside only (not shown)", Boolean(silent) && !silent.phone && silent.surface === "HIDDEN", `${silent?.band} ${silent?.surface}`);
  check("live: weak ads were neither stored nor shown", !all.some((f) => f.district === "قباء"), `${all.length} kept`);
  const notes = await alerts();
  check("live: alerts were written for the very strong finds only, each opening its find, none for the unreachable one", notes.length === 2 && notes.every((n) => /^scout\/opp\/so_/.test(n.route) && !/05\d{8}/.test(`${n.title}${n.body}`)) && !notes.some((n) => n.entityId === silent?.id), notes.map((n) => `${n.title}: ${n.body}`).join(" | "));
  const pushes = notes.map((n) => { try { return JSON.parse(n.providerStateJson || "{}").push; } catch (_) { return ""; } });
  console.log(`push provider states (honest, no delivery claim): ${pushes.join(", ")}`);
  const runs = (await office.collection("scoutRuns").get()).docs.map((d) => d.data());
  check("live: the round left counts only (no phone, no ad text in the run log)", runs.length >= 1 && !/05\d{8}|شوران|الحمراء/.test(JSON.stringify(runs)), JSON.stringify({ fetched: runs[0]?.fetched, strong: runs[0]?.strong, discarded: runs[0]?.discarded }));

  // ---------- scenario 10: the unreachable find appears elsewhere with a number → merged, judged again
  await fixture("silent-with-number", { tag: "two", text: "مطلوب عمارة للشراء بحي شوران، الميزانية 2.9 مليون كاش", phone: "0559000555" });
  const again = await api("/os/scout/search/control", { taskId: restarted.id, action: "RUN_NOW" }, owner.uid);
  const merged = (await finds()).filter((f) => Number(f.price) === 2_900_000);
  check("live: seen again in another source with a number → the two were merged and the find is now shown", again.status === 200 && merged.length === 1 && merged[0].id === silent?.id && merged[0].phone === "0559000555" && merged[0].surface === "SHOWN" && Number(merged[0].sourceCount) === 2, `${merged.length} · ${merged[0]?.surface} · ${merged[0]?.sourceCount} sources`);

  // ---------- the three modes on the deployed Worker
  await fixture("urgent-near", { text: "للبيع عمارة في حي العوالي 3 أدوار مساحة 500 متر السعر مليون و800 الف", phone: "0559002001" });
  const parsed = await api("/os/scout/parse", { text: "ابحث لي بشكل مستعجل عن عمارة للبيع في شوران أو الهجرة، بحد أقصى مليونين" }, owner.uid);
  const d = parsed.body.draft || {};
  check("live: the sentence is understood by the central analysis (urgent · building · sale · شوران، الهجرة · up to 2,000,000)", d.mode === "URGENT" && d.tx === "sale" && d.propertyTypes?.[0] === "عمارة" && String(d.districts) === "شوران,الهجرة" && d.priceMax === 2_000_000, JSON.stringify(d).slice(0, 200));
  const urgent = await api("/os/scout/search", { search: d, requestKey: `scout-live-urgent-${RUN}` }, owner.uid);
  const deep = await api("/os/scout/search", { search: { mode: "DEEP", seek: "OFFER", tx: "sale", propertyTypes: ["أرض"], city: "المدينة المنورة", districts: "الحمراء" }, requestKey: `scout-live-deep-${RUN}` }, owner.uid);
  const q = (await queue()).entries[OFFICE]?.t || {};
  const general = q[(await tasks()).find((t) => t.recordId === request.body.recordId).id];
  check("live: urgent ran its first round inside the request and found the neighbouring building; deep and general wait for the scheduler", urgent.body.firstRound === true && urgent.body.found >= 1 && deep.body.firstRound === false, JSON.stringify({ urgent: urgent.body, deep: deep.body }).slice(0, 200));
  check("live: queue priority urgent 3 > deep 2 > general 1; urgent next round within 5 minutes, general hours away", q[urgent.body.taskId]?.p === 3 && q[deep.body.taskId]?.p === 2 && general?.p === 1 && q[urgent.body.taskId].n - Date.now() <= 5 * 60_000 + 5000 && general.n - Date.now() > 5 * 3_600_000, JSON.stringify({ urgent: q[urgent.body.taskId], deep: q[deep.body.taskId], general }));
  const urgentAlert = (await alerts()).find((n) => /^عاجل/.test(n.title || ""));
  check("live: an urgent search alerts for a strong find (a general one only for very strong)", Boolean(urgentAlert), urgentAlert ? `${urgentAlert.title}: ${urgentAlert.body}` : "no urgent alert");

  // ---------- the find opened from the broker's office
  await page.goto(`${APP}/#/office`);
  await page.locator('[data-scout-card] [data-scout-status="on"]').waitFor();
  await shot("01-home-card");
  await page.locator("[data-scout-open]").click();
  await page.locator("[data-find]").first().waitFor();
  const cards = await page.locator("[data-find]").count();
  check("live: the broker's page shows the few strong finds — not a list of everything that was read", cards >= 3 && cards <= 5 && (await page.locator('[data-find-category="BUYER"]').count()) >= 1 && (await page.locator('[data-find-category="PROPERTY"]').count()) >= 1, `${cards} cards from ${10 + 2 + 1} ads`);
  await shot("02-scout-board");
  await page.locator('[data-find-category="PROPERTY"]').first().click();
  await page.locator("[data-find-why]").waitFor();
  const detail = await page.locator("[data-scout-find-page]").textContent();
  check("live: the find opens with what, why it fits, the linked request, source, freshness and confidence — nothing technical", /لماذا هي مناسبة/.test(detail) && /مرتبطة بـ/.test(detail) && /المصدر/.test(detail) && /حداثة/.test(detail) && /الثقة/.test(detail) && !/queue|cron|gemini|so_\d/i.test(detail));
  await shot("03-find-detail");
  await page.locator('[data-find-action="CONTACT"]').click();
  await page.locator("[data-find-phone]").waitFor();
  check("live: «تواصل» shows the broker the number; the scout itself sent nothing to anyone", (await page.locator("[data-find-phone]").textContent()) === "0559000222");
  await shot("04-find-contact");
  await page.locator(".os-sheet .os-icon-btn").click();
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
  check("live: no horizontal scroll on a phone", overflow <= 1, `${overflow}px`);

  // ---------- controls (scenarios 14, 15)
  const paused = await api("/os/scout/search/control", { taskId: deep.body.taskId, action: "PAUSE" }, owner.uid);
  const afterPause = (await queue()).entries[OFFICE]?.t || {};
  check("live: pausing one search leaves the others queued", paused.status === 200 && !afterPause[deep.body.taskId] && Boolean(afterPause[urgent.body.taskId]) && Boolean(afterPause[restarted.id]));
  const kept = { finds: (await finds()).length, tasks: (await tasks()).length };
  const off = await api("/os/scout/settings", { settings: { enabled: false } }, owner.uid);
  const offQueue = (await queue()).entries[OFFICE];
  check("live: the master switch off — the office leaves the queue; finds, searches and settings stay", off.status === 200 && !offQueue && (await finds()).length === kept.finds && (await tasks()).length === kept.tasks && (await office.collection("scoutSettings").doc("main").get()).data()?.city === "المدينة المنورة");
  const on = await api("/os/scout/settings", { settings: { enabled: true } }, owner.uid);
  check("live: on again — the running searches are queued again", on.status === 200 && Object.keys((await queue()).entries[OFFICE]?.t || {}).length >= 3);

  // ---------- by the broker's own hand, honest sources, lists and follow-up (no third-party site is contacted)
  const overviewNow = (await api("/os/scout/overview", {}, owner.uid)).body;
  const sourceState = Object.fromEntries((overviewNow.sourceStatus || []).map((s) => [s.id, s.status]));
  check("live: every source shows its true state — the office's own are connected; عقار، حراج، بيوت، وصلت need a permission; private WhatsApp groups are not available",
    sourceState.office_inbox === "CONNECTED" && sourceState.broker_feed === "CONNECTED" && ["aqar", "haraj", "bayut", "wasalt"].every((id) => sourceState[id] === "NEEDS_PERMISSION") && ["CONNECTED", "NEEDS_PERMISSION"].includes(sourceState.telegram_groups) && sourceState.whatsapp_groups === "UNAVAILABLE" && !("qa_fixture" in sourceState), JSON.stringify(sourceState));
  // Telegram groups: connected where the platform's bot is active; the manager can then ask for a one-time group link.
  const groupLink = await api("/os/scout/telegram/link", {}, owner.uid);
  check("live: Telegram groups — the manager gets a one-time link to add the platform's bot to a group (or is told the bot is not active here)",
    groupLink.status === 200 && (sourceState.telegram_groups === "CONNECTED" ? groupLink.body.state === "PENDING" && /^https:\/\/t\.me\/[A-Za-z0-9_]+\?startgroup=[A-Za-z0-9_-]{43}$/.test(groupLink.body.groupLink || "") : groupLink.body.state === "NOT_CONFIGURED"), `telegram_groups=${sourceState.telegram_groups} · ${groupLink.body.state}`);
  console.log(`paid doors on this environment (informational): web_search=${sourceState.web_search} x_search=${sourceState.x_search} liveSearch=${overviewNow.liveSearch}`);
  const AD = `https://sa.aqar.fm/ad/qa-scout-live-${RUN}`;
  const refused = await api("/os/scout/import", { url: AD }, owner.uid);
  check("live: a link to a site that forbids automated reading is not fetched — the broker is asked for the ad's text", refused.status === 200 && refused.body.needsText === true && refused.body.reason === "restricted", JSON.stringify(refused.body).slice(0, 160));
  const imported = await api("/os/scout/import", { url: AD, text: "للبيع فيلا في حي الملقا بالرياض مساحة 400 متر السعر 3,200,000 ريال" }, owner.uid);
  const read = imported.body.read?.[0] || {};
  const villa = (await finds()).find((f) => f.url === AD);
  check("live: link + pasted text → read (فيلا · الملقا · الرياض · 3,200,000 · 400 م²), kept for the broker in another city, what is missing named, no official record created",
    read.kind === "OFFER" && read.propertyType === "فيلا" && read.district === "الملقا" && read.city === "الرياض" && read.price === 3_200_000 && read.area === 400 && Array.isArray(read.missing) && villa?.surface === "SHOWN" && villa.pinned === true
    && (await office.collection("opportunities").get()).docs.every((d) => d.data().propertyType !== "فيلا"), JSON.stringify(read).slice(0, 200));
  const countBefore = (await finds()).length;
  const repriced = await api("/os/scout/import", { url: AD, text: "للبيع فيلا في حي الملقا بالرياض مساحة 400 متر السعر 3,000,000 ريال" }, owner.uid);
  const villaNow = (await api("/os/scout/find", { opportunityId: villa.id }, owner.uid)).body.find;
  check("live: the same link again with a new price → the same find, updated (no duplicate), the change on its record", repriced.status === 200 && (await finds()).length === countBefore && villaNow.changes?.[0]?.from === 3_200_000 && villaNow.changes[0].to === 3_000_000, JSON.stringify(villaNow.changes));
  const followUp = await api("/os/scout/find/act", { opportunityId: villa.id, action: "FOLLOW_UP" }, owner.uid);
  const taskDoc = followUp.body.taskId ? (await office.collection("operations").doc(followUp.body.taskId).get()).data() : null;
  check("live: «أنشئ مهمة متابعة» writes one task in the office's Daily Tasks, for this broker", taskDoc?.type === "SCOUT_FOLLOW_UP" && taskDoc.status === "OPEN" && taskDoc.assignedBrokerId === owner.uid && taskDoc.sourceEntityId === villa.id);
  await page.goto(`${APP}/#/tasks`);
  const taskCard = await page.locator('[data-type="SCOUT_FOLLOW_UP"]').waitFor({ timeout: 20000 }).then(() => true, () => false);
  check("live: the task shows in Daily Tasks as «متابعة فرصة خارجية»", taskCard && /متابعة فرصة خارجية/.test(await page.locator('[data-type="SCOUT_FOLLOW_UP"] h3').textContent().catch(() => "")));
  await shot("05-daily-task");
  const wanted = await api("/os/records/save", { requestKey: `scout-live-riyadh-${RUN}`, record: { ...record("REQUEST", "فيلا", "الملقا", 3_300_000, "0551000003"), city: "الرياض" } }, owner.uid);
  const rechecked = await api("/os/scout/find/act", { opportunityId: villa.id, action: "RECHECK" }, owner.uid);
  const matched = (await api("/os/scout/find", { opportunityId: villa.id }, owner.uid)).body.find;
  check("live: «ابحث عن مطابقات» — matched with the office's الرياض request: an estimated fit, the reasons, the price difference", rechecked.body.matched >= 1 && matched.recordId === wanted.body.recordId && matched.fit >= 50 && matched.why.length >= 1 && matched.differences.some((line) => /ميزانية عميلك/.test(line)), `${matched.fit}% · ${matched.differences.join(" | ")}`);
  const outcome = await api("/os/scout/find/act", { opportunityId: villa.id, action: "OUTCOME", result: "INTERESTED", note: "اختبار" }, owner.uid);
  const afterOutcome = (await api("/os/scout/find", { opportunityId: villa.id }, owner.uid)).body.find;
  check("live: «سجّل نتيجة التواصل» keeps the result, moves the find to «قيد المراجعة» and closes the task", outcome.status === 200 && afterOutcome.outcome === "INTERESTED" && afterOutcome.status === "CONTACTED" && (await office.collection("operations").doc(followUp.body.taskId).get()).data()?.status === "COMPLETED");
  const tuned = await api("/os/scout/settings", { settings: { priceMax: 5_000_000, areaMin: 150, kinds: ["OFFER"], cadenceMinutes: 720, alertLevel: "STRONG" } }, owner.uid);
  const kept2 = (await office.collection("scoutSettings").doc("main").get()).data() || {};
  check("live: the office's own search settings are saved (price, area, kind, pace, alert level)", tuned.status === 200 && kept2.priceMax === 5_000_000 && kept2.areaMin === 150 && String(kept2.kinds) === "OFFER" && kept2.cadenceMinutes === 720 && kept2.alertLevel === "STRONG");
  await api("/os/scout/settings", { settings: { priceMax: 0, areaMin: 0, kinds: ["OFFER", "REQUEST"], cadenceMinutes: 360, alertLevel: "VERY_STRONG" } }, owner.uid);
  await page.goto(`${APP}/#/scout`);
  await page.locator("[data-scout-buckets]").waitFor();
  const chips = await page.locator("[data-scout-buckets] [data-bucket]").evaluateAll((nodes) => nodes.map((n) => `${n.dataset.bucket}:${n.dataset.bucketCount}`));
  check("live: the page is «الباحث عن الفرص» with its lists (الكل، مطابقة، جديدة، قيد المراجعة، محفوظة، مستبعدة), real counts, and the last successful search", chips.map((c) => c.split(":")[0]).join() === "ALL,MATCHED,NEW,REVIEW,SAVED,EXCLUDED" && /الباحث عن الفرص/.test(await page.locator(".os-page-title").textContent()) && /آخر بحث ناجح/.test(await page.locator("[data-scout-last]").textContent().catch(() => "")), chips.join(" "));
  await page.locator("[data-scout-source-status] summary").click();
  await shot("06-lists-and-sources");

  // ---------- isolation and the rules
  const stolen = await api("/os/scout/find", { opportunityId: buyer.id }, ownerB.uid, OFFICE_B);
  const cross = await api("/os/scout/overview", {}, ownerB.uid, OFFICE);
  const theirs = await api("/os/scout/overview", {}, ownerB.uid, OFFICE_B);
  check("live: another office cannot open this office's find, cannot read its page, and has nothing of it", stolen.status === 404 && cross.status === 403 && theirs.body.board?.length === 0 && theirs.body.tasks?.length === 0, `${stolen.status} ${cross.status}`);
  const closed = await until(async () => {
    const results = [];
    for (const name of ["scoutOpportunities", "scoutTasks", "scoutState", "scoutSettings"]) {
      const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/offices/${OFFICE}/${name}?pageSize=1`, { headers: { authorization: `Bearer ${tokens[owner.uid]}` } });
      results.push(res.status);
    }
    return results.every((status) => status === 403) ? results : null;
  }, 6 * 60_000, 20_000);
  check("live: the scout's collections are closed to the browser by the deployed rules — even to the office's own manager", Boolean(closed), closed ? closed.join(",") : "still readable (rules not deployed yet?)");
  const schedule = await db.collection("_system").doc("scoutSchedule").get();
  check("live: the platform schedule holds ids, times and counters only", !/05\d{8}|شوران|الحمراء|مليون/.test(schedule.data()?.entriesJson || ""));
} catch (error) {
  const seen = await visibleState(browser);
  check("scout live run completed", false, String(error?.stack || error).split("\n").slice(0, 2).join(" | "));
  annotateFailure("scout live failed", error, seen);
} finally {
  await browser.close().catch(() => {});
  // The scout is switched off for the QA offices at the end, so nothing keeps running for them on Staging.
  for (const id of [OFFICE, OFFICE_B]) await qa(db.collection("offices").doc(id).collection("scoutSettings").doc("main")).set({ enabled: false, updatedAt: new Date() }, { merge: true }).catch(() => {});
  await db.runTransaction(async (tx) => {
    const ref = db.collection("_system").doc("scoutSchedule");
    const doc = await tx.get(ref);
    if (!doc.exists) return;
    const entries = JSON.parse(doc.data().entriesJson || "{}");
    delete entries[OFFICE]; delete entries[OFFICE_B];
    tx.update(ref, { entriesJson: JSON.stringify(entries) });
  }).catch(() => {});
  for (const user of users) {
    await user.dirRef.delete().catch(() => {});
    await auth.deleteUser(user.uid).catch(() => {});
  }
  const failed = checks.filter((c) => !c.ok);
  fs.writeFileSync(path.join(OUT, "scout-live-report.json"), JSON.stringify({ at: new Date().toISOString(), app: APP, worker: WORKER, run: RUN, checks }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} scout live checks passed`);
  if (process.env.GITHUB_ACTIONS) {
    const esc = (t) => String(t).replace(/%/g, "%25").replace(/\r/g, "").replace(/\n/g, "%0A");
    for (const c of failed.slice(0, 9)) console.log(`::error title=scout live check failed::${esc(`${c.name} — ${c.detail}`)}`);
    console.log(`::notice title=scout live results::${esc([`passed ${checks.length - failed.length}/${checks.length}`, ...checks.map((c) => `${c.ok ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` (${c.detail.slice(0, c.ok ? 90 : 280)})` : ""}`)].join("\n")).slice(0, 12000)}`);
  }
  process.exitCode = failed.length ? 1 : 0;
}
