// «الباحث عن الفرص» — the outside sources: web search (a search API), X, Telegram groups, and the live Google search.
// Through the real Worker on the in-memory Firestore double. Every outside service is a double here; no site is contacted.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  BUCKET, MODE_CONFIG, bucketOf, completenessLabel, looksLikeAd, looksLikeListingIndex, matchDifferences, missingFacts, normalizeScoutSettings, postsQueryText, surfaceDecision, taskCadence, webQueryText
} from "../public/os/domain/scout-domain.js";
import { taskPathStep, taskTypeOf } from "../public/os/domain/task-domain.js";
import { fitFor } from "../worker/src/office-os/scout-evaluate.js";
import { SOURCE_ADAPTERS } from "../worker/src/office-os/scout-sources.js";
import { SEARCH_EXCLUDED_DOMAINS, publicHttpsUrl, robotsAllows, searchConfig } from "../worker/src/office-os/scout-web.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B, BROKER_A2 } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());
h.store.patch(`offices/${OFFICE_A}`, { city: "المدينة المنورة" });
h.store.patch(`offices/${OFFICE_B}`, { city: "المدينة المنورة" });

const SEARCH_KEY = "tvly-key-never-in-any-response";
const hosts = new Set();
const searchCalls = [];
const xCalls = [];
const liveCalls = [];
let searchAnswer = { results: [] };
let searchStatus = 200;
let xAnswer = { data: [] };
let liveAnswer = null;
let liveStatus = 200;
// Pages of pretend sites (for «أدخل رابط الإعلان»): path → { status, type, body }.
const sitePages = new Map();
const siteCalls = [];
const doubleFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  hosts.add(url.hostname);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.hostname === "api.tavily.com") { searchCalls.push({ provider: "tavily", auth: init.headers?.Authorization || "", body: JSON.parse(init.body || "{}") }); return json(searchAnswer, searchStatus); }
  if (url.hostname === "api.search.brave.com") { searchCalls.push({ provider: "brave", token: init.headers?.["X-Subscription-Token"] || "", url }); return json({ web: { results: (searchAnswer.results || []).map((r) => ({ title: r.title, url: r.url, description: r.content })) } }, searchStatus); }
  if (url.hostname === "api.x.com") { xCalls.push({ auth: init.headers?.Authorization || "", url }); return json(xAnswer); }
  if (url.hostname.endsWith(".example.sa") || /aqar\.fm$|haraj\.com\.sa$/.test(url.hostname)) {
    siteCalls.push({ host: url.hostname, path: url.pathname, agent: init.headers?.["User-Agent"] || "" });
    const page = sitePages.get(`${url.hostname}${url.pathname}`);
    if (!page) return new Response("not found", { status: 404 });
    return new Response(page.body, { status: page.status || 200, headers: { "content-type": page.type || "text/html; charset=utf-8", ...(page.location ? { location: page.location } : {}) } });
  }
  if (url.hostname === "generativelanguage.googleapis.com") { liveCalls.push({ key: init.headers?.["x-goog-api-key"] || "", body: JSON.parse(init.body || "{}") }); return json(liveAnswer || {}, liveStatus); }
  return doubleFetch(input, init);
};
test.after(() => { globalThis.fetch = doubleFetch; });

async function call(route, body = {}, uid = OWNER_A, office = OFFICE_A) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers, body: JSON.stringify({ officeId: office, ...body }) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const ok = async (route, body, uid, office) => { const r = await call(route, body, uid, office); assert.equal(r.status, 200, `${route} → ${JSON.stringify(r.body)}`); return r.body; };
const tasks = (office = OFFICE_A) => h.store.list(`offices/${office}/scoutTasks`);
const finds = (office = OFFICE_A) => h.store.list(`offices/${office}/scoutOpportunities`);
const schedule = () => JSON.parse(h.store.get("_system/scoutSchedule")?.entriesJson || "{}");
const state = (office = OFFICE_A) => { const doc = h.store.get(`offices/${office}/scoutState/main`) || {}; return { usage: JSON.parse(doc.usageJson || "{}"), health: JSON.parse(doc.healthJson || "{}") }; };
async function round(office = OFFICE_A) {
  const entries = schedule();
  for (const entry of Object.values(entries[office]?.t || {})) entry.n = 1;
  if (entries[office]) entries[office].l = 0;
  h.store.patch("_system/scoutSchedule", { entriesJson: JSON.stringify(entries) });
  const pending = [];
  await h.worker.scheduled({ scheduledTime: Date.now() }, h.env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
}
/** As if this search last asked the outside sources long ago. */
const forget = (taskId, office = OFFICE_A) => h.store.patch(`offices/${office}/scoutTasks/${taskId}`, { metered: {} });
let seq = 0;
async function save(kind, { type = "أرض", district, price, office = OFFICE_A, uid = OWNER_A }) {
  seq += 1;
  const r = await ok("/os/records/save", { requestKey: `src-${seq}`, record: { kind, purpose: kind === "OFFER" ? "SALE" : "PURCHASE", propertyType: type, city: "المدينة المنورة", district, price, contactName: "اختبار", contactPhone: `0557${String(200000 + seq).slice(-6)}` } }, uid, office);
  return r.recordId;
}
const taskFor = (recordId) => tasks().find((t) => t.recordId === recordId);

// ------------------------------------------------------------------ pure rules

test("a search is put in the words ads are written with; the price is judged afterwards, not searched", () => {
  assert.equal(webQueryText({ seek: "OFFER", tx: "sale", propertyTypes: ["أرض"], districts: ["الحمراء", "شوران"], city: "المدينة المنورة", priceMax: 1_500_000 }), "أرض للبيع حي الحمراء أو حي شوران المدينة المنورة");
  assert.equal(webQueryText({ seek: "REQUEST", tx: "sale", propertyTypes: ["عمارة"], districts: ["شوران"], city: "المدينة المنورة" }), "مطلوب عمارة للشراء حي شوران المدينة المنورة");
  assert.equal(webQueryText({ seek: "OWNER", tx: "rent", propertyTypes: ["شقة"], districts: [], city: "جدة" }), "شقة للإيجار جدة من المالك مباشرة");
  assert.equal(postsQueryText({ seek: "OFFER", tx: "sale", propertyTypes: ["أرض"], districts: ["الحمراء"], city: "المدينة المنورة" }), '"أرض" "الحمراء" للبيع lang:ar -is:retweet -is:reply');
});

test("a results page is not an ad, and group chatter is not an ad", () => {
  for (const title of ["أراضي للبيع في حي الحمراء - 250 إعلان", "شقق للإيجار في جدة", "عقار | 34 إعلان متاح"]) assert.equal(looksLikeListingIndex(title), true, title);
  for (const title of ["أرض للبيع في حي الحمراء 600 متر", "للبيع أرض سكنية 600م"]) assert.equal(looksLikeListingIndex(title), false, title);
  assert.equal(looksLikeAd("السلام عليكم أحد يعرف مقاول ترميم ممتاز في المدينة؟"), false);
  assert.equal(looksLikeAd("للبيع أرض سكنية في حي الحمراء مساحة 600 متر السعر مليون و350 الف"), true);
  assert.equal(looksLikeAd("مطلوب شقة للإيجار في حي العزيزية بحدود 30 الف"), true);
});

test("paid outside searches are paced by the mode: general once a day, deep every two hours with more forms, urgent hourly", () => {
  assert.deepEqual([MODE_CONFIG.GENERAL.metered, MODE_CONFIG.DEEP.metered, MODE_CONFIG.URGENT.metered], [{ everyMinutes: 1440, queries: 1 }, { everyMinutes: 120, queries: 3 }, { everyMinutes: 60, queries: 2 }]);
  const paid = SOURCE_ADAPTERS.filter((a) => a.metered).map((a) => a.id);
  assert.deepEqual(paid, ["web_search", "x_search"]);
  assert.deepEqual([...SEARCH_EXCLUDED_DOMAINS], ["aqar.fm", "haraj.com.sa", "bayut.sa", "wasalt.sa"]);
  assert.deepEqual(searchConfig({ SCOUT_SEARCH_KEY: "k", SCOUT_SEARCH_EXCLUDE: "example.sa, not a domain, other.com" }).excluded, ["aqar.fm", "haraj.com.sa", "bayut.sa", "wasalt.sa", "example.sa", "other.com"]);
  assert.equal(searchConfig({ SCOUT_SEARCH_KEY: "k", SCOUT_SEARCH_PROVIDER: "someone-else" }).ready, false, "an unknown provider is not used");
});

// ------------------------------------------------------------------ before a key exists

let requestId = "";
test("with no key the web is not searched — and the manager is told so, with the reason for every source that is off", async () => {
  await ok("/os/scout/settings", { settings: { enabled: true } });
  requestId = await save("REQUEST", { type: "أرض", district: "الحمراء", price: 1_500_000 });
  await round();
  assert.equal(searchCalls.length + xCalls.length, 0);
  const overview = await ok("/os/scout/overview");
  assert.deepEqual(overview.sources.map((s) => s.id).sort(), ["broker_feed", "office_inbox"]);
  // Every source with its true state — for every member of the office, not only the manager.
  const status = Object.fromEntries((await ok("/os/scout/overview", {}, BROKER_A2)).sourceStatus.map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(status).sort(), ["aqar", "bayut", "broker_feed", "haraj", "office_inbox", "partner_feed", "telegram_groups", "wasalt", "web_search", "whatsapp_groups", "x_search"]);
  assert.deepEqual([status.office_inbox.status, status.broker_feed.status], ["CONNECTED", "CONNECTED"]);
  for (const id of ["web_search", "x_search", "partner_feed", "aqar", "haraj", "bayut", "wasalt", "telegram_groups"]) assert.equal(status[id].status, "NEEDS_PERMISSION", id);
  assert.equal(status.whatsapp_groups.status, "UNAVAILABLE");
  assert.match(status.web_search.reason, /مدفوعة/); assert.match(status.x_search.reason, /مدفوعة/); assert.match(status.aqar.reason, /شروط/); assert.equal(/robots|API|webhook/i.test(JSON.stringify(Object.values(status).map((x) => x.reason))), false, "said in the office's words, nothing technical"); assert.match(status.haraj.reason, /اتفاقية/); assert.match(status.bayut.reason, /ترخيصًا/);
  assert.equal(JSON.stringify(overview).includes("qa_fixture"), false, "the test source is never listed to an office");
  assert.equal(overview.liveSearch, false, "the live Google search is off until it is switched on (it is a paid request)");
});

// ------------------------------------------------------------------ web search

const SITE = "https://dar-alhamra.example.sa";
test("web search: the scout asks in the search's own words, keeps a link to each real ad, and leaves out results pages, vague excerpts and forbidden sites", async () => {
  h.env.SCOUT_SEARCH_KEY = SEARCH_KEY;
  searchAnswer = { results: [
    { title: "أرض للبيع في حي الحمراء 600 متر", url: `${SITE}/listing/123?ref=home`, content: "أرض سكنية للبيع في حي الحمراء بالمدينة المنورة مساحة 600 متر السعر 1,350,000 ريال للتواصل 0559011111", published_date: new Date().toISOString() },
    { title: "أرض سكنية للبيع حي الحمراء", url: "https://maktab-alnoor.example.sa/ads/88", content: "للبيع أرض في حي الحمراء مساحة 550 متر بسعر مليون و400 الف — التواصل عبر الموقع" },
    { title: "أراضي للبيع في حي الحمراء - 250 إعلان", url: `${SITE}/search/lands`, content: "تصفح 250 إعلان أراضي للبيع في حي الحمراء أسعار تبدأ من 900,000 ريال" },
    { title: "أرض للبيع في حي الحمراء", url: `${SITE}/listing/124`, content: "أرض مميزة للبيع في حي الحمراء قريبة من الخدمات" },
    { title: "أرض للبيع في حي الحمراء 600 متر 1,300,000 ريال", url: "https://sa.aqar.fm/ad/999", content: "أرض للبيع في حي الحمراء 600 متر السعر 1,300,000 ريال 0559012222" },
    { title: "أرض للبيع حي الحمراء 700 متر مليون و450 الف", url: "https://haraj.com.sa/1199", content: "للبيع أرض حي الحمراء 700 متر مليون و450 الف 0559013333" }
  ] };
  await round();
  assert.equal(searchCalls.length, 1, "one search of the office → one request (the discovery search has nothing specific to ask)");
  const sent = searchCalls[0];
  assert.equal(sent.auth, `Bearer ${SEARCH_KEY}`);
  assert.equal(sent.body.query, "أرض للبيع حي الحمراء المدينة المنورة");
  assert.deepEqual([sent.body.country, sent.body.time_range, sent.body.include_raw_content, sent.body.exclude_domains], ["saudi arabia", "week", false, ["aqar.fm", "haraj.com.sa", "bayut.sa", "wasalt.sa"]]);
  const web = finds().filter((f) => String(f.url || "").includes("example.sa"));
  assert.equal(web.length, 2, JSON.stringify(finds().map((f) => f.url)));
  const withNumber = web.find((f) => f.phone === "0559011111");
  assert.deepEqual([withNumber.surface, withNumber.bestRecordId, withNumber.price, withNumber.area, withNumber.url], ["SHOWN", requestId, 1_350_000, 600, `${SITE}/listing/123?ref=home`]);
  const viaSite = web.find((f) => !f.phone);
  assert.equal(viaSite.surface, "SHOWN", "a link to the ad is a way to reach its advertiser");
  const detail = await ok("/os/scout/find", { opportunityId: viaSite.id });
  assert.deepEqual([detail.find.contact.route, detail.find.sources], ["https://maktab-alnoor.example.sa/ads/88", ["الويب · maktab-alnoor.example.sa"]]);
  assert.equal(finds().some((f) => /aqar\.fm|haraj/.test(String(f.url || "")) || ["0559012222", "0559013333"].includes(f.phone)), false, "a site that forbids collecting its ads is left out, even if the search service returns it");
  assert.equal(state().usage.webCalls, 1);
  assert.ok((await ok("/os/scout/overview")).sources.some((s) => s.id === "web_search" && s.label === "بحث الويب"));
});

test("pace and budget: a general search asks the web once a day; the same ad seen again is not a new find; the office never passes its daily allowance", async () => {
  const before = { calls: searchCalls.length, finds: finds().length };
  await round(); await round();
  assert.equal(searchCalls.length, before.calls, "not asked again the same day");
  forget(taskFor(requestId).id);
  await round();
  assert.equal(searchCalls.length, before.calls + 1, "asked again when its day has passed");
  assert.equal(finds().length, before.finds, "the same results are known, not duplicated");
  // A deep search asks three forms at a time — but only what is left of the office's allowance.
  h.env.SCOUT_SEARCH_DAILY_PER_OFFICE = "4";
  const deep = await ok("/os/scout/search", { search: { mode: "DEEP", seek: "OFFER", tx: "sale", propertyTypes: ["فيلا"], city: "المدينة المنورة", districts: "العزيزية، شوران", priceMax: 2_000_000 }, requestKey: "src-deep" });
  await round();
  assert.equal(searchCalls.length, before.calls + 3, "two were used; the deep search got the two that were left, not three");
  assert.equal(state().usage.webCalls, 4);
  const deepTask = tasks().find((t) => t.id === deep.taskId);
  assert.ok(deepTask.metered?.web_search, "when it last asked is kept on the search");
  forget(deepTask.id); forget(taskFor(requestId).id);
  await round();
  assert.equal(searchCalls.length, before.calls + 3, "the allowance is spent: nothing more today");
  delete h.env.SCOUT_SEARCH_DAILY_PER_OFFICE;
});

test("an urgent search asks the web inside the request itself (its first round), ahead of the others", async () => {
  searchAnswer = { results: [{ title: "عمارة للبيع في حي العوالي 3 أدوار", url: `${SITE}/listing/500`, content: "للبيع عمارة في حي العوالي 3 أدوار مساحة 500 متر السعر مليون و800 الف 0559014444" }] };
  const before = searchCalls.length;
  const urgent = await ok("/os/scout/search", { search: { mode: "URGENT", seek: "OFFER", tx: "sale", propertyTypes: ["عمارة"], city: "المدينة المنورة", districts: "شوران", priceMax: 2_000_000 }, requestKey: "src-urgent" });
  assert.equal(urgent.firstRound, true);
  assert.ok(searchCalls.length > before && searchCalls.length <= before + 2, "urgent: up to two forms, at once");
  assert.equal(searchCalls[before].body.query, "عمارة للبيع حي شوران المدينة المنورة");
  assert.ok(finds().some((f) => f.phone === "0559014444" && f.surface === "SHOWN"), "the neighbouring building was found in the same request");
});

test("the search service fails: the round still completes, the source is left alone for a while, and the key never appears", async () => {
  searchStatus = 500;
  for (const task of tasks()) forget(task.id);
  const before = searchCalls.length;
  await round();
  assert.ok(searchCalls.length > before);
  const health = state().health.sources.web_search;
  assert.ok(health.fails === 1 && health.backoffUntil > Date.now() && health.lastError === "search_http_500", JSON.stringify(health));
  const after = searchCalls.length;
  for (const task of tasks()) forget(task.id);
  await round();
  assert.equal(searchCalls.length, after, "not asked while backing off");
  searchStatus = 200;
  assert.equal(JSON.stringify(await ok("/os/scout/overview")).includes(SEARCH_KEY), false);
  assert.equal(JSON.stringify([...h.store.docs.values()]).includes(SEARCH_KEY), false, "the key is stored nowhere");
});

test("Brave is the same adapter with another driver: its own header, Saudi Arabic results, the forbidden sites excluded in the query", async () => {
  h.env.SCOUT_SEARCH_PROVIDER = "brave";
  const doc = h.store.get(`offices/${OFFICE_A}/scoutState/main`);
  h.store.patch(`offices/${OFFICE_A}/scoutState/main`, { healthJson: JSON.stringify({ ...JSON.parse(doc.healthJson || "{}"), sources: {} }), usageJson: "{}" });
  forget(taskFor(requestId).id);
  await round();
  const sent = searchCalls.findLast((c) => c.provider === "brave");
  assert.ok(sent, "brave was asked");
  assert.equal(sent.token, SEARCH_KEY);
  assert.deepEqual([sent.url.searchParams.get("country"), sent.url.searchParams.get("search_lang"), sent.url.searchParams.get("freshness")], ["SA", "ar", "pw"]);
  assert.match(sent.url.searchParams.get("q"), /-site:aqar\.fm -site:haraj\.com\.sa -site:bayut\.sa -site:wasalt\.sa$/);
  delete h.env.SCOUT_SEARCH_PROVIDER; delete h.env.SCOUT_SEARCH_KEY;
});

// ------------------------------------------------------------------ X

test("X: recent posts through X's own API — the post's text is the ad, its link is the way back to it", async () => {
  h.env.SCOUT_X_BEARER = "x-bearer-never-in-any-response";
  xAnswer = { data: [
    { id: "1890000000000000001", text: "للبيع أرض سكنية في حي الحمراء بالمدينة المنورة مساحة 620 متر السعر مليون و380 الف للتواصل 0559015555", created_at: new Date().toISOString(), lang: "ar" },
    { id: "1890000000000000002", text: "صباح الخير", created_at: new Date().toISOString(), lang: "ar" }
  ] };
  forget(taskFor(requestId).id);
  await round();
  const sent = xCalls.at(-1);
  assert.equal(sent.auth, "Bearer x-bearer-never-in-any-response");
  assert.deepEqual([sent.url.pathname, sent.url.searchParams.get("query"), sent.url.searchParams.get("max_results")], ["/2/tweets/search/recent", '"أرض" "الحمراء" للبيع lang:ar -is:retweet -is:reply', "10"]);
  assert.ok(Date.now() - Date.parse(sent.url.searchParams.get("start_time")) < 7 * 86_400_000, "never beyond the seven-day window");
  const post = finds().find((f) => f.phone === "0559015555");
  assert.deepEqual([post.surface, post.url, post.bestRecordId], ["SHOWN", "https://x.com/i/web/status/1890000000000000001", requestId]);
  assert.ok(state().usage.xCalls >= 1);
  delete h.env.SCOUT_X_BEARER;
});

// ------------------------------------------------------------------ Telegram groups and channels

const TG_SECRET = "tg-secret-for-tests";
let updateId = 9000;
async function telegram(update) {
  const response = await h.worker.fetch(new Request("https://worker.test/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": TG_SECRET }, body: JSON.stringify({ update_id: ++updateId, ...update }) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const GROUP = { id: -1001234567890, type: "supergroup", title: "عقارات المدينة" };
const inGroup = (text, chat = GROUP, id = updateId + 1) => ({ message: { message_id: id, date: Math.floor(Date.now() / 1000), chat, from: { id: 777, first_name: "عضو" }, text } });
const posts = (office = OFFICE_A) => h.store.list(`offices/${office}/scoutPosts`);

test("Telegram groups: the manager links a group with a one-time code; only ads are kept; each office keeps its own copy; unlinking stops it", async () => {
  Object.assign(h.env, { TELEGRAM_BOT_TOKEN: "123456:TEST-TOKEN-never-in-a-response", TELEGRAM_WEBHOOK_SECRET: TG_SECRET, TELEGRAM_BOT_USERNAME: "iaqar_test_bot" });
  assert.equal((await call("/os/scout/telegram/link", {}, BROKER_A2)).status, 403, "linking is the manager's");
  const link = await ok("/os/scout/telegram/link");
  assert.equal(link.state, "PENDING");
  assert.match(link.groupLink, /^https:\/\/t\.me\/iaqar_test_bot\?startgroup=[A-Za-z0-9_-]{43}$/);
  assert.match(link.command, /^\/start [A-Za-z0-9_-]{43}$/);
  // Sent in a private chat it links nothing — and it is never taken for an office-intake link.
  const privately = await telegram({ message: { message_id: 1, date: 1, chat: { id: 555, type: "private" }, from: { id: 555 }, text: link.command } });
  assert.deepEqual([privately.body.linked, privately.body.kind, privately.body.reason], [false, "scout_chat", "group_required"]);
  assert.equal(h.store.get("telegramChats/555"), null);
  // Before the link, the group's messages are nobody's.
  assert.equal((await telegram(inGroup("للبيع أرض في حي الحمراء مساحة 500 متر السعر مليون و200 الف 0559016000"))).body.reason, "chat_not_linked");
  const linked = await telegram(inGroup(`/start@iaqar_test_bot ${link.command.slice(7)}`));
  assert.deepEqual([linked.body.linked, linked.body.kind], [true, "scout_chat"]);
  assert.equal((await telegram(inGroup(link.command))).body.linked, false, "the code works once");
  const overview = await ok("/os/scout/overview");
  assert.deepEqual(overview.telegram.chats.map((c) => [c.chatId, c.title, c.type]), [["-1001234567890", "عقارات المدينة", "supergroup"]]);
  assert.ok(overview.sources.some((s) => s.id === "telegram_groups"));

  const inboxBefore = h.store.list(`offices/${OFFICE_A}/inbox`).length;
  const chatter = await telegram(inGroup("السلام عليكم، أحد يعرف مقاول ترميم ممتاز؟"));
  assert.equal(chatter.body.reason, "not_an_ad");
  const ad = await telegram(inGroup("للبيع أرض سكنية في حي الحمراء مساحة 640 متر السعر مليون و420 الف للتواصل 0559016666", GROUP, 4321));
  assert.deepEqual([ad.status, ad.body.scout, ad.body.kept], [200, true, 1]);
  assert.equal(posts().length, 1, "chatter was not stored");
  assert.deepEqual([posts()[0].link, posts()[0].messageId, posts()[0].chatTitle], ["https://t.me/c/1234567890/4321", 4321, "عقارات المدينة"]);
  assert.equal(JSON.stringify(posts()[0]).includes("عضو"), false, "the sender's name is not kept");
  assert.equal(h.store.list(`offices/${OFFICE_A}/inbox`).length, inboxBefore, "a group's ads do not fill the office's inbox");
  assert.equal(posts(OFFICE_B).length, 0);

  await round();
  const find = finds().find((f) => f.phone === "0559016666");
  assert.deepEqual([find.surface, find.bestRecordId, find.url], ["SHOWN", requestId, "https://t.me/c/1234567890/4321"]);
  assert.deepEqual((await ok("/os/scout/find", { opportunityId: find.id })).find.sources, ["قروبات وقنوات تيليجرام"]);

  // A second office links the same public group: each gets its own copy, neither sees the other's.
  await ok("/os/scout/settings", { settings: { enabled: true } }, OWNER_B, OFFICE_B);
  const linkB = await ok("/os/scout/telegram/link", {}, OWNER_B, OFFICE_B);
  assert.equal((await telegram(inGroup(linkB.command))).body.linked, true);
  const both = await telegram(inGroup("مطلوب فيلا للشراء في حي العزيزية بحدود مليونين 0559017777", GROUP, 4400));
  assert.equal(both.body.kept, 2);
  assert.deepEqual([posts().length, posts(OFFICE_B).length], [2, 1]);
  assert.equal((await call("/os/scout/telegram/unlink", { chatId: "-1001234567890" }, OWNER_B, OFFICE_A)).status, 403, "another office cannot unlink this office's group");

  assert.equal((await call("/os/scout/telegram/unlink", { chatId: "-1001234567890" }, BROKER_A2)).status, 403);
  assert.equal((await ok("/os/scout/telegram/unlink", { chatId: "-1001234567890" })).changed, true);
  const after = await telegram(inGroup("للبيع شقة في حي قباء 3 غرف السعر 450 الف 0559018888", GROUP, 4500));
  assert.equal(after.body.kept, 1, "only the office still linked receives it");
  assert.deepEqual([posts().length, posts(OFFICE_B).length], [2, 2]);
  assert.deepEqual((await ok("/os/scout/overview")).telegram.chats, []);
});

test("a channel is linked by posting the line in it; a public one gives a public link to each ad", async () => {
  const link = await ok("/os/scout/telegram/link");
  const channel = { id: -1009876543210, type: "channel", title: "عروض المدينة", username: "madinah_offers" };
  const linked = await telegram({ channel_post: { message_id: 10, date: Math.floor(Date.now() / 1000), chat: channel, text: link.command } });
  assert.equal(linked.body.linked, true);
  await telegram({ channel_post: { message_id: 11, date: Math.floor(Date.now() / 1000), chat: channel, text: "للبيع دور في حي شوران مساحة 300 متر السعر 900 الف 0559019999" } });
  assert.ok(posts().some((p) => p.link === "https://t.me/madinah_offers/11"));
});

// ------------------------------------------------------------------ live search (Google, display only)

test("«ابحث في الويب الآن»: Google's answer is shown as it came, with its sources and its suggestions — and nothing of it is kept", async () => {
  h.env.GEMINI_API_KEY = "gemini-key-never-in-any-response";
  const taskId = taskFor(requestId).id;
  assert.equal((await ok("/os/scout/search/detail", { taskId })).liveSearch, false, "a key alone does not switch it on");
  assert.equal((await call("/os/scout/web/live", { taskId })).status, 503);
  h.env.SCOUT_LIVE_SEARCH = "enabled";
  assert.equal((await ok("/os/scout/search/detail", { taskId })).liveSearch, true);
  const marker = "نتيجة-بحث-مباشر-فريدة";
  liveAnswer = { candidates: [{ content: { parts: [{ text: `أرض في حي الحمراء 600 متر بسعر 1,350,000 ريال — ${marker}` }] }, groundingMetadata: {
    webSearchQueries: ["أرض للبيع حي الحمراء المدينة المنورة"],
    searchEntryPoint: { renderedContent: "<style>.c{}</style><div class=\"c\"><a href=\"https://www.google.com/search?q=x\">أرض للبيع حي الحمراء</a></div>" },
    groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "sa.aqar.fm" } }, { web: { uri: "http://insecure.example/x", title: "x" } }]
  } }] };
  const docsBefore = h.store.docs.size;
  const findsBefore = finds().length;
  const live = await ok("/os/scout/web/live", { taskId });
  assert.deepEqual([live.grounded, live.sources.length, live.sources[0].title], [true, 1, "sa.aqar.fm"]);
  assert.match(live.answer, new RegExp(marker)); assert.match(live.suggestions, /google\.com\/search/);
  assert.equal(live.question, "أرض للبيع حي الحمراء المدينة المنورة بسعر حتى 1,500,000 ريال — إعلانات حديثة");
  const sent = liveCalls.at(-1);
  assert.equal(sent.key, "gemini-key-never-in-any-response");
  assert.deepEqual(sent.body.tools, [{ google_search: {} }]);
  assert.equal(/05\d{8}|اختبار/.test(JSON.stringify(sent.body.contents)), false, "the question carries no client's name or number");
  // Display only: no find, no stored answer (the one new document is the audit line, which holds no result).
  assert.equal(finds().length, findsBefore);
  assert.equal(h.store.docs.size, docsBefore + 1);
  assert.equal(JSON.stringify([...h.store.docs.values()]).includes(marker), false, "the answer is stored nowhere");
  assert.equal(JSON.stringify([...h.store.docs.values()]).includes("grounding-api-redirect"), false, "nor its links");
  assert.equal(JSON.stringify(live).includes("gemini-key"), false);

  // An answer with no search sources is not shown as a web result.
  liveAnswer = { candidates: [{ content: { parts: [{ text: "أعتقد أن هناك أراضي كثيرة" }] } }] };
  const ungrounded = await ok("/os/scout/web/live", { taskId });
  assert.deepEqual([ungrounded.grounded, ungrounded.answer, ungrounded.sources], [false, "", []]);
  // Another office cannot run it on this office's search; a round never uses this door.
  await ok("/os/scout/settings", { settings: { enabled: true } }, OWNER_B, OFFICE_B);
  assert.equal((await call("/os/scout/web/live", { taskId }, OWNER_B, OFFICE_B)).status, 404);
  // (A deep or urgent round may ask the model to fill an ad's gaps — that is the central analysis, never a web search.)
  const searches = () => liveCalls.filter((c) => Array.isArray(c.body.tools)).length;
  const calls = searches();
  forget(taskId);
  await round();
  assert.equal(searches(), calls, "no background round ever asks Google Search");
  // The key's plan does not include search: said plainly.
  liveStatus = 400;
  const refused = await call("/os/scout/web/live", { taskId });
  assert.deepEqual([refused.status, /غير مفعّل/.test(JSON.stringify(refused.body))], [503, true]);
  liveStatus = 200; liveAnswer = { candidates: [{ content: { parts: [{ text: "x" }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://a.example/x", title: "a" } }] } }] };
  let limited = 0;
  for (let i = 0; i < 6; i += 1) limited = (await call("/os/scout/web/live", { taskId })).status;
  assert.equal(limited, 429, "a person cannot hammer it");
  delete h.env.GEMINI_API_KEY; delete h.env.SCOUT_LIVE_SEARCH;
});

// ------------------------------------------------------------------ by the broker's own hand: a link, a text, a file

const page = (title, description) => `<!doctype html><html><head><title>${title}</title><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"></head><body>…</body></html>`;
const VILLA = "https://villas.example.sa/riyadh/almalqa/7781";
let villaId = "";

test("the link reader asks only for a public https page, obeys robots.txt (longest rule wins), and names itself", () => {
  for (const bad of ["http://example.sa/a", "https://127.0.0.1/a", "https://localhost/a", "https://example.sa:8443/a", "https://u:p@example.sa/", "https://x.internal/a", "https://[::1]/a", "notaurl"]) assert.equal(publicHttpsUrl(bad), null, bad);
  assert.ok(publicHttpsUrl("https://villas.example.sa/a?b=1"));
  const robots = "User-agent: *\nDisallow: /search\nDisallow: /private/*\nAllow: /private/open\n\nUser-agent: badbot\nDisallow: /\n";
  assert.deepEqual(["/listing/1", "/search?q=1", "/private/x", "/private/open"].map((path) => robotsAllows(robots, path)), [true, false, false, true]);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /", "/a"), false);
  assert.equal(robotsAllows("User-agent: *\nDisallow:", "/a"), true, "an empty rule forbids nothing");
  assert.equal(robotsAllows("User-agent: iaqarlinkreader\nDisallow: /\nUser-agent: *\nAllow: /", "/a"), false, "a rule that names this reader is the one that counts");
});

test("«أدخل رابط الإعلان»: a page the site lets be read is read once — and the ad is kept for the broker whatever its level, in any city of the Kingdom", async () => {
  sitePages.set("villas.example.sa/robots.txt", { type: "text/plain", body: "User-agent: *\nDisallow: /search\n" });
  sitePages.set("villas.example.sa/riyadh/almalqa/7781", { body: page("فيلا للبيع في حي الملقا بالرياض", "فيلا للبيع في حي الملقا في الرياض مساحة 400 متر السعر 3,200,000 ريال للتواصل 0559020001") });
  const before = { finds: finds().length, records: h.store.list(`offices/${OFFICE_A}/opportunities`).length };
  const added = await ok("/os/scout/import", { url: VILLA });
  assert.deepEqual([added.readFrom, added.ads, added.kept], ["page", 1, 1]);
  assert.deepEqual([added.read[0].understood, added.read[0].kind, added.read[0].propertyType, added.read[0].city, added.read[0].district, added.read[0].price, added.read[0].area], [true, "OFFER", "فيلا", "الرياض", "الملقا", 3_200_000, 400]);
  assert.deepEqual(added.read[0].missing, ["تاريخ النشر"], "what the ad did not say is listed, not guessed");
  assert.deepEqual(siteCalls.filter((c) => c.host === "villas.example.sa").map((c) => c.path), ["/robots.txt", "/riyadh/almalqa/7781"]);
  assert.match(siteCalls.at(-1).agent, /^iAqarLinkReader\//);
  const villa = finds().find((f) => f.phone === "0559020001");
  villaId = villa.id;
  assert.deepEqual([villa.surface, villa.pinned, villa.city, villa.url, villa.bestRecordId], ["SHOWN", true, "الرياض", VILLA, ""], "an office in المدينة keeps a الرياض ad it brought itself");
  const detail = (await ok("/os/scout/find", { opportunityId: villa.id })).find;
  assert.deepEqual([detail.sources, detail.fit, detail.url, detail.advertiser !== "", detail.completeness], [["رابط أدخله المكتب · villas.example.sa"], 0, VILLA, true, "البيانات مكتملة"]);
  const card = (await ok("/os/scout/overview")).board.find((c) => c.id === villa.id);
  assert.equal(bucketOf(card), BUCKET.NEW, "not matched to anything of the office yet → «جديدة»");
  assert.equal(finds().length, before.finds + 1);
  assert.equal(h.store.list(`offices/${OFFICE_A}/opportunities`).length, before.records, "an outside ad never becomes an official record by itself");

  // The same address again, with a new price: the same find, updated — never a second one.
  sitePages.set("villas.example.sa/riyadh/almalqa/7781", { body: page("فيلا للبيع في حي الملقا بالرياض", "فيلا للبيع في حي الملقا في الرياض مساحة 400 متر السعر 3,000,000 ريال للتواصل 0559020001") });
  const again = await ok("/os/scout/import", { url: VILLA });
  assert.equal(finds().length, before.finds + 1, "no duplicate");
  assert.ok(again.merged >= 1);
  const updated = (await ok("/os/scout/find", { opportunityId: villa.id })).find;
  assert.deepEqual(updated.changes.map((c) => [c.from, c.to]), [[3_200_000, 3_000_000]], "the price change is on the find's record");
});

test("a site that does not allow reading: nothing is fetched from it — the broker pastes the text and the link is kept as the source", async () => {
  sitePages.set("closed.example.sa/robots.txt", { type: "text/plain", body: "User-agent: *\nDisallow: /\n" });
  sitePages.set("closed.example.sa/ad/1", { body: page("أرض للبيع", "أرض للبيع في حي الياسمين 500 متر 2,000,000 ريال") });
  const refused = await ok("/os/scout/import", { url: "https://closed.example.sa/ad/1" });
  assert.deepEqual([refused.needsText, refused.reason], [true, "robots"]);
  assert.deepEqual(siteCalls.filter((c) => c.host === "closed.example.sa").map((c) => c.path), ["/robots.txt"], "the page itself was not requested");
  // عقار: its terms forbid automated reading — not even its robots file is asked.
  const calls = siteCalls.length;
  const aqar = await ok("/os/scout/import", { url: "https://sa.aqar.fm/ad/5550001" });
  assert.deepEqual([aqar.needsText, aqar.reason, siteCalls.length], [true, "restricted", calls]);
  assert.match(aqar.message, /الصق نص الإعلان/);
  const pasted = await ok("/os/scout/import", { url: "https://sa.aqar.fm/ad/5550001", text: "للبيع شقة في حي النرجس بالرياض 3 غرف مساحة 140 متر السعر 850 الف" });
  assert.deepEqual([pasted.readFrom, pasted.kept, siteCalls.length], ["text", 1, calls], "the text he pasted is what is read");
  const flat = finds().find((f) => f.url === "https://sa.aqar.fm/ad/5550001");
  assert.deepEqual([flat.surface, flat.pinned, flat.propertyType, flat.price], ["SHOWN", true, "شقة", 850_000]);
  assert.equal((await ok("/os/scout/find", { opportunityId: flat.id })).find.contact.route, "https://sa.aqar.fm/ad/5550001", "the original ad is one press away");
  // A page with nothing to read, an address that is not a public https page, another office.
  sitePages.set("thin.example.sa/x", { body: "<html><head><title>x</title></head></html>" });
  assert.equal((await ok("/os/scout/import", { url: "https://thin.example.sa/x" })).reason, "unreadable");
  for (const bad of ["http://villas.example.sa/a", "https://127.0.0.1/a", "ftp://x"]) assert.equal((await call("/os/scout/import", { url: bad })).status, bad.startsWith("https://127") ? 200 : 400, bad);
  assert.equal((await ok("/os/scout/import", { url: "https://127.0.0.1/a" })).needsText, true, "an address literal is never fetched");
  assert.equal((await call("/os/scout/import", { url: VILLA }, OWNER_B, OFFICE_A)).status, 403);
});

test("one pasted ad is kept even when weak; a digest (or a file of many) is filtered as before", async () => {
  const one = await ok("/os/scout/feed", { text: "للإيجار غرفة في حي السلام بجدة 900 ريال شهريًا 0559020777" });
  assert.deepEqual([one.ads, one.kept], [1, 1]);
  assert.equal(finds().find((f) => f.phone === "0559020777").surface, "SHOWN");
  const many = await ok("/os/scout/feed", { channel: "FILE", text: ["للإيجار غرفة في حي السلام بجدة 950 ريال شهريًا 0559020778", "للإيجار غرفة في حي الصفا بجدة 800 ريال شهريًا 0559020779", "صباح الخير"].join("\n\n") });
  assert.deepEqual([many.ads, many.kept, many.strong], [2, 0, 0]);
  assert.equal(finds().some((f) => ["0559020778", "0559020779"].includes(f.phone)), false, "weak ads from a digest are not stored");
  assert.equal((await ok("/os/scout/feed", { text: "السلام عليكم ورحمة الله وبركاته جميعًا" })).read[0].understood, false, "not an ad → said so, nothing kept");
});

// ------------------------------------------------------------------ the office's search settings

test("search settings are the office's: price and area range, kinds, pace and alerts — and its radar obeys them", async () => {
  const saved = (await ok("/os/scout/settings", { settings: { priceMin: "900000", priceMax: "500000", areaMin: 200, areaMax: 900, kinds: ["OFFER"], cadenceMinutes: 720, notify: false, alertLevel: "STRONG" } })).settings;
  assert.deepEqual([saved.priceMin, saved.priceMax, saved.areaMin, saved.areaMax, saved.kinds, saved.cadenceMinutes, saved.notify, saved.alertLevel], [500_000, 900_000, 200, 900, ["OFFER"], 720, false, "STRONG"]);
  assert.equal((await call("/os/scout/settings", { settings: { cadenceMinutes: 720 } }, BROKER_A2)).status, 403);
  assert.equal(normalizeScoutSettings({ cadenceMinutes: 7 }).cadenceMinutes, 360, "an unknown pace falls back");
  assert.deepEqual([taskCadence({ mode: "GENERAL" }, new Date(), saved).intervalMinutes, taskCadence({ mode: "DEEP" }, new Date(), saved).intervalMinutes], [720, 30], "the pace is for the general searches only");
  // The radar (no record behind it): only the chosen kind, inside the range.
  const profile = h.store.get(`offices/${OFFICE_A}/scoutTasks/st_discovery`).profile;
  assert.deepEqual([profile.kinds, profile.priceMin, profile.priceMax, profile.areaMax], [["OFFER"], 500_000, 900_000, 900]);
  const ad = (extra) => ({ kind: "OFFER", tx: "sale", propertyType: "أرض", city: "المدينة المنورة", district: "الحمراء", price: 700_000, area: 400, firstSeenAt: new Date().toISOString(), ...extra });
  assert.ok(fitFor({ profile, seek: "ANY", entity: ad({}) }));
  assert.equal(fitFor({ profile, seek: "ANY", entity: ad({ kind: "REQUEST" }) }), null, "requests are not wanted");
  assert.equal(fitFor({ profile, seek: "ANY", entity: ad({ price: 950_000 }) }), null, "above the range");
  assert.equal(fitFor({ profile, seek: "ANY", entity: ad({ area: 1200 }) }), null, "outside the area");
  // The next general round is scheduled at the office's own pace.
  forget(taskFor(requestId).id);
  await round();
  const next = schedule()[OFFICE_A].t[taskFor(requestId).id].n - Date.now();
  assert.ok(next > 11.5 * 3_600_000 && next < 12.5 * 3_600_000, `next general round in ${Math.round(next / 3_600_000)}h`);
  // Alerts off: a very strong find is shown, and nobody is alerted. A level of «قوية» alerts for a merely strong one.
  assert.deepEqual(surfaceDecision({ band: "VERY_STRONG", contactable: true, alerts: false }), { surface: "SHOWN", notify: false });
  assert.deepEqual([surfaceDecision({ band: "STRONG", contactable: true }).notify, surfaceDecision({ band: "STRONG", contactable: true, alertLevel: "STRONG" }).notify], [false, true]);
  const alertsBefore = h.store.list(`offices/${OFFICE_A}/notifications`).length;
  await ok("/os/scout/feed", { text: ["للبيع أرض سكنية في حي الحمراء مساحة 610 متر السعر مليون و390 الف من المالك مباشرة 0559021001", "للبيع أرض في حي الحمراء مساحة 600 متر السعر مليون و410 الف 0559021002"].join("\n\n") });
  assert.ok(finds().some((f) => f.phone === "0559021001" && f.surface === "SHOWN"));
  assert.equal(h.store.list(`offices/${OFFICE_A}/notifications`).length, alertsBefore, "alerts are off");
  await ok("/os/scout/settings", { settings: { priceMin: 0, priceMax: 0, areaMin: 0, areaMax: 0, kinds: ["OFFER", "REQUEST"], cadenceMinutes: 360, notify: true, alertLevel: "VERY_STRONG" } });
});

// ------------------------------------------------------------------ what the broker reads and does

test("a matched find says how well it fits (an estimate), why, where it differs, and what the ad left out", async () => {
  const land = finds().find((f) => f.phone === "0559011111");
  const detail = (await ok("/os/scout/find", { opportunityId: land.id })).find;
  assert.ok(detail.fit >= 60 && detail.fit <= 100, `estimated fit ${detail.fit}`);
  assert.ok(detail.why.length >= 1);
  assert.ok(detail.differences.includes("السعر أقل من ميزانية عميلك بـ10%"), JSON.stringify(detail.differences));
  assert.equal(detail.recordId, requestId);
  assert.deepEqual(matchDifferences({ kind: "REQUEST", price: 2_700_000, area: 700 }, { priceOrBudget: 3_000_000, area: 600 }), ["ميزانيته أقل من سعر عرضك بـ10%", "المساحة أكبر بـ17% (700 م² مقابل 600 م²)"]);
  assert.deepEqual(missingFacts({ propertyType: "أرض", district: "الحمراء" }), ["المدينة", "السعر", "المساحة", "وسيلة التواصل", "تاريخ النشر"]);
  assert.equal(completenessLabel({ propertyType: "أرض" }), "البيانات ناقصة");
  assert.match((await ok("/os/scout/find", { opportunityId: villaId })).find.advertiser, /غير واضحة|مالك|وسيط/, "the advertiser's capacity is stated as read, never assumed");
});

test("the five lists: new, matched, under review, saved, excluded — and an excluded find can be taken back", async () => {
  const land = finds().find((f) => f.phone === "0559011111");
  const start = (await ok("/os/scout/overview")).buckets;
  assert.ok(start.MATCHED >= 1 && start.NEW >= 1, JSON.stringify(start));
  await ok("/os/scout/find/act", { opportunityId: villaId, action: "SAVE" });
  await ok("/os/scout/find/act", { opportunityId: land.id, action: "CONTACT" });
  const moved = await ok("/os/scout/overview");
  assert.deepEqual([moved.buckets.SAVED, moved.buckets.REVIEW], [start.SAVED + 1, start.REVIEW + 1]);
  assert.deepEqual([bucketOf(moved.board.find((c) => c.id === villaId)), bucketOf(moved.board.find((c) => c.id === land.id))], [BUCKET.SAVED, BUCKET.REVIEW]);
  const flat = finds().find((f) => f.url === "https://sa.aqar.fm/ad/5550001");
  await ok("/os/scout/find/act", { opportunityId: flat.id, action: "IGNORE" });
  const after = await ok("/os/scout/overview");
  assert.equal(after.board.some((c) => c.id === flat.id), false, "off the page");
  assert.deepEqual(after.excluded.filter((c) => c.id === flat.id).map((c) => [c.status, c.headline !== ""]), [["IGNORED", true]], "and listed under «مستبعدة»");
  assert.equal(after.buckets.EXCLUDED, after.excluded.length);
  await ok("/os/scout/find/act", { opportunityId: flat.id, action: "RESTORE" });
  const back = await ok("/os/scout/overview");
  assert.deepEqual([back.board.some((c) => c.id === flat.id), back.excluded.some((c) => c.id === flat.id)], [true, false]);
  assert.ok(back.health.lastSuccessAt, "the time of the last successful search is shown");
});

test("«ابحث عن مطابقات»: a find the office brought is matched the moment the office has the request for it", async () => {
  assert.equal((await ok("/os/scout/find/act", { opportunityId: villaId, action: "RECHECK" })).matched, 0);
  seq += 1;
  const wanted = (await ok("/os/records/save", { requestKey: `src-riyadh-${seq}`, record: { kind: "REQUEST", purpose: "PURCHASE", propertyType: "فيلا", city: "الرياض", district: "الملقا", price: 3_300_000, contactName: "عميل الرياض", contactPhone: "0557300001" } })).recordId;
  const checked = await ok("/os/scout/find/act", { opportunityId: villaId, action: "RECHECK" });
  assert.ok(checked.matched >= 1);
  const detail = (await ok("/os/scout/find", { opportunityId: villaId })).find;
  assert.deepEqual([detail.recordId, detail.fit > 0, detail.category], [wanted, true, "PROPERTY"]);
  assert.ok(detail.differences.some((line) => /أقل من ميزانية عميلك/.test(line)), JSON.stringify(detail.differences));
  assert.equal((await call("/os/scout/find/act", { opportunityId: villaId, action: "RECHECK" }, OWNER_B, OFFICE_B)).status, 404, "another office cannot touch it");
});

test("«أنشئ مهمة متابعة» puts one task in Daily Tasks; «سجّل نتيجة التواصل» closes it and keeps the result on the find", async () => {
  const made = await ok("/os/scout/find/act", { opportunityId: villaId, action: "FOLLOW_UP" });
  assert.equal(made.taskCreated, true);
  const task = h.store.get(`offices/${OFFICE_A}/operations/${made.taskId}`);
  assert.deepEqual([task.type, task.status, task.assignedBrokerId, task.sourceEntityType, task.sourceEntityId, task.titleText], ["SCOUT_FOLLOW_UP", "OPEN", OWNER_A, "scout", villaId, "متابعة فرصة خارجية"]);
  assert.match(JSON.parse(task.metadataJson).opportunityTitle, /فيلا/);
  assert.deepEqual([taskTypeOf(task).badge, taskTypeOf(task).opens, taskPathStep(task)], ["متابعة فرصة خارجية", "scout", 1], "Daily Tasks knows it: a «تواصل» step that opens the find");
  const twice = await ok("/os/scout/find/act", { opportunityId: villaId, action: "FOLLOW_UP" });
  assert.deepEqual([twice.taskId, twice.taskCreated], [made.taskId, false], "pressed again → the same task");
  assert.equal((await ok("/os/scout/find", { opportunityId: villaId })).find.followUpOpen, true);
  assert.equal((await call("/os/scout/find/act", { opportunityId: villaId, action: "OUTCOME", result: "MAYBE" })).status, 400);
  await ok("/os/scout/find/act", { opportunityId: villaId, action: "OUTCOME", result: "INTERESTED", note: "طلب معاينة يوم السبت" });
  const detail = (await ok("/os/scout/find", { opportunityId: villaId })).find;
  assert.deepEqual([detail.outcome, detail.outcomeLabel, detail.outcomeNote, detail.status, detail.followUpOpen], ["INTERESTED", "مهتم — نكمل معه", "طلب معاينة يوم السبت", "CONTACTED", false]);
  const done = h.store.get(`offices/${OFFICE_A}/operations/${made.taskId}`);
  assert.deepEqual([done.status, done.completedBy], ["COMPLETED", OWNER_A]);
  assert.equal(h.store.list(`offices/${OFFICE_B}/operations`).some((t) => t.type === "SCOUT_FOLLOW_UP"), false);
});

test("isolation and reach: nothing here contacted a listings site or Telegram, and no outside find crossed to another office", () => {
  assert.deepEqual([...hosts].filter((host) => !/iaqar/.test(host) && /aqar|haraj|bayut|wasalt|t\.me|telegram|whatsapp|facebook/.test(host)), [], [...hosts].join(", "));
  assert.equal(finds(OFFICE_B).some((f) => /example\.sa|x\.com/.test(String(f.url || ""))), false);
});
