// «باحث الفرص» — the outside sources: web search (a search API), X, Telegram groups, and the live Google search.
// Through the real Worker on the in-memory Firestore double. Every outside service is a double here; no site is contacted.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { MODE_CONFIG, looksLikeAd, looksLikeListingIndex, postsQueryText, webQueryText } from "../public/os/domain/scout-domain.js";
import { SOURCE_ADAPTERS } from "../worker/src/office-os/scout-sources.js";
import { SEARCH_EXCLUDED_DOMAINS, searchConfig } from "../worker/src/office-os/scout-web.js";

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
const doubleFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  hosts.add(url.hostname);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.hostname === "api.tavily.com") { searchCalls.push({ provider: "tavily", auth: init.headers?.Authorization || "", body: JSON.parse(init.body || "{}") }); return json(searchAnswer, searchStatus); }
  if (url.hostname === "api.search.brave.com") { searchCalls.push({ provider: "brave", token: init.headers?.["X-Subscription-Token"] || "", url }); return json({ web: { results: (searchAnswer.results || []).map((r) => ({ title: r.title, url: r.url, description: r.content })) } }, searchStatus); }
  if (url.hostname === "api.x.com") { xCalls.push({ auth: init.headers?.Authorization || "", url }); return json(xAnswer); }
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
  assert.deepEqual([...SEARCH_EXCLUDED_DOMAINS], ["aqar.fm", "haraj.com.sa"]);
  assert.deepEqual(searchConfig({ SCOUT_SEARCH_KEY: "k", SCOUT_SEARCH_EXCLUDE: "example.sa, not a domain, other.com" }).excluded, ["aqar.fm", "haraj.com.sa", "example.sa", "other.com"]);
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
  const pending = Object.fromEntries(overview.pendingSources.map((s) => [s.id, s.reason]));
  assert.deepEqual(Object.keys(pending).sort(), ["aqar", "haraj", "partner_feed", "telegram_groups", "web_search", "x_search"]);
  assert.match(pending.web_search, /مفتاح/); assert.match(pending.aqar, /robots|شروط/); assert.match(pending.haraj, /اتفاقية/);
  assert.equal((await ok("/os/scout/overview", {}, BROKER_A2)).pendingSources.length, 0, "a broker is not shown the platform's setup");
  assert.equal(overview.liveSearch, false);
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
  assert.deepEqual([sent.body.country, sent.body.time_range, sent.body.include_raw_content, sent.body.exclude_domains], ["saudi arabia", "week", false, ["aqar.fm", "haraj.com.sa"]]);
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
  assert.match(sent.url.searchParams.get("q"), /-site:aqar\.fm -site:haraj\.com\.sa$/);
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
  assert.equal((await call("/os/scout/web/live", { taskId }, OWNER_B, OFFICE_B)).status, 404);
  const calls = liveCalls.length;
  forget(taskId);
  await round();
  assert.equal(liveCalls.length, calls, "no background round ever asks Google");
  // The key's plan does not include search: said plainly.
  liveStatus = 400;
  const refused = await call("/os/scout/web/live", { taskId });
  assert.deepEqual([refused.status, /غير مفعّل/.test(refused.body.error || refused.body.message || JSON.stringify(refused.body))], [503, true]);
  liveStatus = 200; liveAnswer = { candidates: [{ content: { parts: [{ text: "x" }] }, groundingMetadata: { groundingChunks: [{ web: { uri: "https://a.example/x", title: "a" } }] } }] };
  let limited = 0;
  for (let i = 0; i < 6; i += 1) limited = (await call("/os/scout/web/live", { taskId })).status;
  assert.equal(limited, 429, "a person cannot hammer it");
  delete h.env.GEMINI_API_KEY;
});

test("isolation and reach: nothing here contacted a listings site or Telegram, and no outside find crossed to another office", () => {
  assert.deepEqual([...hosts].filter((host) => /aqar|haraj|t\.me|telegram|whatsapp|facebook/.test(host)), [], [...hosts].join(", "));
  assert.equal(finds(OFFICE_B).some((f) => /example\.sa|x\.com/.test(String(f.url || ""))), false);
});
