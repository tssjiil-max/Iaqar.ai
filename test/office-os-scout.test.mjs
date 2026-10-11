// «الباحث عن الفرص» — rules, sources, scoring, merging, the scheduler and the office isolation.
// Through the real Worker on the in-memory Firestore double (scripts/qa/office-os/server.mjs). No site is contacted.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  ADVERTISER, BAND, MODE_CONFIG, RING, SCOUT_MODE, SEEK, adjacentDistricts, allowedRing, bandOf, candidateFromRaw, classifyAdvertiser, districtRing, mergeSighting,
  parseScoutCommand, planQueries, profileFromRecord, qualityScore, sameEntity, splitDigest, surfaceDecision, taskCadence
} from "../public/os/domain/scout-domain.js";
import { fitFor, evaluateFind } from "../worker/src/office-os/scout-evaluate.js";
import { SOURCE_ADAPTERS, SOURCE_STATE } from "../worker/src/office-os/scout-sources.js";
import { dueOffices } from "../worker/src/office-os/scout-service.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B, BROKER_A2 } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());
// Office A is a QA office here, so the test source (Staging + test-fixture offices only) is usable for it. Office B is not.
h.store.patch(`offices/${OFFICE_A}`, { city: "المدينة المنورة", isTestFixture: true });
h.store.patch(`offices/${OFFICE_B}`, { city: "المدينة المنورة" });

// Every outbound host is recorded: the scout must never reach a listings site.
const hosts = new Set();
const feedCalls = [];
let feedAnswer = null;
const doubleFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  hosts.add(url.hostname);
  if (url.hostname === "feed.partner.test") {
    feedCalls.push({ url, auth: init.headers?.Authorization || "" });
    if (!feedAnswer) return new Response("down", { status: 503 });
    return new Response(JSON.stringify(feedAnswer), { status: 200, headers: { "content-type": "application/json" } });
  }
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
const notes = (office = OFFICE_A) => h.store.list(`offices/${office}/notifications`).filter((n) => String(n.type).startsWith("SCOUT_"));
const schedule = () => JSON.parse(h.store.get("_system/scoutSchedule")?.entriesJson || "{}");
const scheduleHealth = () => JSON.parse(h.store.get("_system/scoutSchedule")?.healthJson || "{}");
const state = (office = OFFICE_A) => { const doc = h.store.get(`offices/${office}/scoutState/main`) || {}; return { index: JSON.parse(doc.indexJson || "[]"), board: JSON.parse(doc.boardJson || "[]"), records: JSON.parse(doc.recordsJson || "[]"), health: JSON.parse(doc.healthJson || "{}"), usage: JSON.parse(doc.usageJson || "{}") }; };
const taskFor = (recordId) => tasks().find((t) => t.recordId === recordId);

/** Make searches due now (as if their waiting time had passed) and run one cron beat of the real Worker. */
function makeDue(only = null, office = OFFICE_A) {
  const entries = schedule();
  for (const [id, entry] of Object.entries(entries[office]?.t || {})) if (!only || only.includes(id)) entry.n = 1;
  if (entries[office]) entries[office].l = 0;
  h.store.patch("_system/scoutSchedule", { entriesJson: JSON.stringify(entries) });
}
async function beat() {
  const pending = [];
  await h.worker.scheduled({ scheduledTime: Date.now() }, h.env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
}
async function round(only = null, office = OFFICE_A) { makeDue(only, office); await beat(); }

let seq = 0;
let clock = Date.now();
/** One ad in the test source. `tag` stands for the source it was seen in. */
function fixture(id, { tag = "one", text, phone = "", publishedAt = new Date().toISOString(), office = OFFICE_A, advertiserHint = "" }) {
  clock += 1000;
  h.store.seed(`offices/${office}/scoutFixtures/${id}`, { officeId: office, sourceTag: tag, externalId: id, text, phone, publishedAt, advertiserHint, updatedAt: new Date(clock).toISOString() });
}
async function save(kind, { type = "أرض", district, price, purpose, phone, extra = {}, uid = OWNER_A, office = OFFICE_A }) {
  seq += 1;
  const r = await ok("/os/records/save", { requestKey: `scout-${seq}`, record: {
    kind, purpose: purpose || (kind === "OFFER" ? "SALE" : "PURCHASE"), propertyType: type, city: "المدينة المنورة", district, price,
    contactName: kind === "OFFER" ? "مالك" : "عميل", contactPhone: phone || `0557${String(100000 + seq).slice(-6)}`, ...extra
  } }, uid, office);
  return r.recordId;
}

// ------------------------------------------------------------------ pure rules

test("the three modes are different in priority, pace, depth, lifetime, alerts and model use — in one config", () => {
  const { GENERAL, DEEP, URGENT } = MODE_CONFIG;
  assert.ok(URGENT.priority > DEEP.priority && DEEP.priority > GENERAL.priority, "queue priority");
  assert.ok(URGENT.intervalMinutes < DEEP.intervalMinutes && DEEP.intervalMinutes < GENERAL.intervalMinutes, "pace");
  assert.equal(URGENT.inlineFirstRun, true); assert.equal(DEEP.inlineFirstRun, false); assert.equal(GENERAL.inlineFirstRun, false);
  assert.ok(DEEP.queryVariants > URGENT.queryVariants && URGENT.queryVariants > GENERAL.queryVariants, "query forms per round");
  assert.ok(DEEP.itemsPerCycle > URGENT.itemsPerCycle && URGENT.itemsPerCycle > GENERAL.itemsPerCycle, "depth per round");
  assert.ok(DEEP.backfillDays > URGENT.backfillDays && URGENT.backfillDays > GENERAL.backfillDays, "how far back a new search looks");
  assert.equal(GENERAL.windowHours, 0); assert.equal(DEEP.afterWindow, "COMPLETE"); assert.equal(URGENT.afterWindow, "DOWNGRADE");
  assert.equal(GENERAL.notify.minBand, BAND.VERY_STRONG); assert.equal(URGENT.notify.minBand, BAND.STRONG); assert.equal(DEEP.notify.summaryOnComplete, true);
  assert.equal(GENERAL.ai.allowed, false); assert.ok(DEEP.ai.perDay > URGENT.ai.perDay && URGENT.ai.allowed);
  assert.ok(GENERAL.recheckEvery > DEEP.recheckEvery);
  // The same search asks more in a deep round than in a general one.
  const profile = { tx: "sale", propertyTypes: ["فيلا"], city: "المدينة المنورة", districts: ["شوران", "العزيزية"], priceMax: 2_000_000 };
  assert.equal(planQueries({ mode: "GENERAL", profile }).length, 1);
  assert.deepEqual(planQueries({ mode: "URGENT", profile }).map((f) => f.id), ["exact", "adjacent", "price"]);
  const deep = planQueries({ mode: "DEEP", profile, emptyCycles: 1 }).map((f) => f.id);
  assert.ok(deep.length === 6 && deep.includes("related") && deep.includes("adjacent") && deep.some((id) => id.startsWith("district:")), deep.join(","));
});

test("an urgent search past its three days keeps watching at the general pace; a deep one past its day completes", () => {
  const now = new Date("2026-10-11T10:00:00Z");
  const past = new Date(now.getTime() - 1000).toISOString();
  const future = new Date(now.getTime() + 3_600_000).toISOString();
  assert.deepEqual([taskCadence({ mode: "URGENT", intensiveUntil: future }, now).intervalMinutes, taskCadence({ mode: "URGENT", intensiveUntil: future }, now).priority], [5, 3]);
  const later = taskCadence({ mode: "URGENT", intensiveUntil: past }, now);
  assert.deepEqual([later.intervalMinutes, later.priority, later.complete, later.downgraded], [360, 1, false, true]);
  assert.equal(taskCadence({ mode: "DEEP", intensiveUntil: past }, now).complete, true);
  assert.equal(taskCadence({ mode: "GENERAL" }, now).complete, false);
});

test("the search sentence: mode, what is looked for, operation, type, districts, ceiling and the direct-owner preference", () => {
  const urgent = parseScoutCommand("ابحث لي بشكل مستعجل عن عمارة للبيع في شوران أو الهجرة، بحد أقصى مليونين، ويفضل من المالك مباشرة.");
  assert.deepEqual([urgent.mode, urgent.seek, urgent.tx, urgent.propertyTypes, urgent.districts, urgent.priceMax, urgent.preferDirectOwner], ["URGENT", "OFFER", "sale", ["عمارة"], ["شوران", "الهجرة"], 2_000_000, true]);
  const deep = parseScoutCommand("ابحث بعمق عن أراضٍ للبيع في الحمراء.");
  assert.deepEqual([deep.mode, deep.seek, deep.propertyTypes, deep.districts], ["DEEP", "OFFER", ["أرض"], ["الحمراء"]]);
  const buyers = parseScoutCommand("ابحث عن طلبات شراء عمائر في شوران والهجرة.");
  assert.deepEqual([buyers.seek, buyers.tx, buyers.propertyTypes, buyers.districts], ["REQUEST", "sale", ["عمارة"], ["شوران", "الهجرة"]]);
  assert.equal(parseScoutCommand("ابحث عن أشخاص يبحثون عن عمائر في شوران.").seek, SEEK.REQUEST);
  const owners = parseScoutCommand("ابحث لي عن ملاك أراضٍ في الحمراء.");
  assert.deepEqual([owners.seek, owners.preferDirectOwner, owners.propertyTypes], ["OWNER", true, ["أرض"]]);
  // The office's own client («عميل يريد…») is a search for offers, not for requests.
  const client = parseScoutCommand("عميل جاد يريد عمارة في شوران أو الهجرة حتى 2 مليون ريال");
  assert.deepEqual([client.seek, client.districts, client.priceMax, client.missing], ["OFFER", ["شوران", "الهجرة"], 2_000_000, ["tx"]]);
  assert.equal(parseScoutCommand("السلام عليكم").ok, false, "nothing is guessed from a greeting");
});

test("a record is its own search: an offer looks for buyers, a request for properties — nothing is asked again", () => {
  const offer = profileFromRecord({ opportunityKind: "OFFER", purpose: "SALE", propertyType: "عمارة", city: "المدينة المنورة", district: "شوران", priceOrBudget: 3_000_000, area: 600 });
  assert.deepEqual([offer.seek, offer.recordKind, offer.exactPrice, offer.profile.tx, offer.profile.propertyTypes, offer.profile.districts], ["REQUEST", "OFFER", 3_000_000, "sale", ["عمارة"], ["شوران"]]);
  const request = profileFromRecord({ opportunityKind: "REQUEST", purpose: "PURCHASE", propertyType: "أرض", city: "المدينة المنورة", district: "الحمراء", priceOrBudget: 1_500_000, notes: "أحياء مقبولة أيضًا: العزيزية، قباء — قريب من المسجد" });
  assert.deepEqual([request.seek, request.profile.priceMax, request.profile.districts], ["OFFER", 1_500_000, ["الحمراء", "العزيزية", "قباء"]]);
});

test("districts: the same one, a documented neighbour, or the rest of the city — and a search widens only step by step", () => {
  assert.ok(adjacentDistricts("شوران").includes("العوالي"));
  assert.equal(districtRing(["شوران"], "حي شوران").ring, RING.SAME);
  assert.deepEqual(districtRing(["شوران"], "العوالي"), { ring: RING.ADJACENT, near: "شوران" });
  assert.equal(districtRing(["شوران"], "قباء").ring, RING.CITY);
  assert.equal(districtRing(["الحمراء"], "الحمرا").ring, RING.CITY, "a name that only looks similar is not the same district");
  const profile = { districts: ["شوران"] };
  assert.equal(allowedRing({ mode: "GENERAL", profile, emptyCycles: 0 }), RING.SAME);
  assert.equal(allowedRing({ mode: "GENERAL", profile, emptyCycles: 2 }), RING.SAME);
  assert.equal(allowedRing({ mode: "GENERAL", profile, emptyCycles: 3 }), RING.ADJACENT, "after three empty rounds");
  assert.equal(allowedRing({ mode: "GENERAL", profile, emptyCycles: 30 }), RING.ADJACENT, "never the whole city unless the broker allowed it");
  assert.equal(allowedRing({ mode: "GENERAL", profile: { ...profile, allowCityWide: true }, emptyCycles: 6 }), RING.CITY);
  assert.equal(allowedRing({ mode: "DEEP", profile, emptyCycles: 1 }), RING.ADJACENT, "a deep search widens from its second round");
  assert.equal(allowedRing({ mode: "URGENT", profile, emptyCycles: 0 }), RING.ADJACENT, "an urgent search starts with the neighbours");
});

test("fit comes from the matching engine: same district strong, neighbouring less, another district weakest; a budget is a ceiling", () => {
  const profile = { tx: "sale", propertyTypes: ["أرض"], city: "المدينة المنورة", districts: ["شوران"], priceMax: 1_500_000 };
  const land = (district, price = 1_350_000) => ({ kind: "OFFER", tx: "sale", propertyType: "أرض", city: "المدينة المنورة", district, price, firstSeenAt: new Date().toISOString() });
  const same = fitFor({ profile, seek: "OFFER", entity: land("شوران"), ring: RING.CITY });
  const near = fitFor({ profile, seek: "OFFER", entity: land("العوالي"), ring: RING.CITY });
  const far = fitFor({ profile, seek: "OFFER", entity: land("قباء"), ring: RING.CITY });
  assert.ok(same.fit > near.fit && near.fit > far.fit, `${same.fit} > ${near.fit} > ${far.fit}`);
  assert.ok(same.reasons.includes("نفس الحي") && same.reasons.includes("السعر داخل الميزانية"));
  assert.ok(near.reasons[0].startsWith("حي مجاور"));
  assert.equal(fitFor({ profile, seek: "OFFER", entity: land("العوالي"), ring: RING.SAME }), null, "a neighbouring district is outside a search that has not widened");
  assert.equal(fitFor({ profile, seek: "OFFER", entity: land("قباء"), ring: RING.ADJACENT }), null, "the rest of the city needs the broker's permission");
  assert.ok(fitFor({ profile, seek: "OFFER", entity: land("شوران", 900_000), ring: RING.SAME }).reasons.includes("السعر داخل الميزانية"), "well under the ceiling still fits");
  // The price tolerance is the mode's: 12% over the ceiling passes a deep and an urgent round, not a general one.
  const over = land("شوران", 1_680_000);
  assert.equal(fitFor({ profile, seek: "OFFER", entity: over, mode: "GENERAL" }), null);
  assert.ok(fitFor({ profile, seek: "OFFER", entity: over, mode: "URGENT" }));
  // A close property type is looked at only in a deep search, and said so.
  const villa = { tx: "sale", propertyTypes: ["فيلا"], city: "المدينة المنورة", districts: ["شوران"], priceMax: 2_000_000 };
  const duplex = { kind: "OFFER", tx: "sale", propertyType: "دوبلكس", city: "المدينة المنورة", district: "شوران", price: 1_900_000, firstSeenAt: new Date().toISOString() };
  assert.equal(fitFor({ profile: villa, seek: "OFFER", entity: duplex, mode: "GENERAL" }), null);
  assert.ok(fitFor({ profile: villa, seek: "OFFER", entity: duplex, mode: "DEEP" }).warnings[0].includes("نوع قريب"));
  // Wrong side, wrong operation, wrong city: not this search's.
  assert.equal(fitFor({ profile, seek: "OFFER", entity: { ...land("شوران"), kind: "REQUEST" } }), null);
  assert.equal(fitFor({ profile, seek: "OFFER", entity: { ...land("شوران"), tx: "rent" } }), null);
  assert.equal(fitFor({ profile, seek: "OFFER", entity: { ...land("شوران"), city: "جدة" } }), null);
});

test("the level is explainable: reachable, fresh and complete raise it; old, bare or noisy lowers it; a broker's ad never passes as an owner's", () => {
  const now = new Date();
  const base = { kind: "OFFER", tx: "sale", propertyType: "أرض", district: "شوران", price: 1_300_000, area: 600, phone: "0551234567", text: "للبيع أرض سكنية في حي شوران مساحة 600 متر السعر مليون و300 الف", firstSeenAt: now.toISOString(), confidence: 1 };
  const good = qualityScore(base, { now, sourceQuality: 0.9 });
  const silent = qualityScore({ ...base, phone: "" }, { now, sourceQuality: 0.9 });
  const old = qualityScore({ ...base, publishedAt: new Date(now.getTime() - 60 * 86_400_000).toISOString() }, { now, sourceQuality: 0.9 });
  assert.ok(good.quality > silent.quality && good.quality > old.quality);
  assert.equal(good.parts.contact, 10); assert.equal(silent.parts.contact, 0); assert.equal(old.parts.freshness, 0);
  assert.ok(good.reasons.includes("يوجد رقم تواصل") && old.warnings.includes("الإعلان قديم"));
  assert.equal(bandOf(82), BAND.VERY_STRONG); assert.equal(bandOf(66), BAND.STRONG); assert.equal(bandOf(48), BAND.MEDIUM); assert.equal(bandOf(47), BAND.WEAK);
  // Who wrote it: only what the ad itself says, with a confidence — never «the owner» without a sign.
  assert.equal(classifyAdvertiser({ text: "للبيع أرض من المالك مباشرة بدون وسطاء" }).kind, ADVERTISER.OWNER_HIGH);
  assert.equal(classifyAdvertiser({ text: "للبيع أرض من المالك مباشرة" }, { repeat: 1 }).kind, ADVERTISER.OWNER_MEDIUM);
  assert.equal(classifyAdvertiser({ text: "للبيع أرض في شوران" }).kind, ADVERTISER.UNCLEAR);
  assert.equal(classifyAdvertiser({ text: "مكتب الأفق للعقارات — لدينا عروض أخرى، السعي 2.5%" }).kind, ADVERTISER.BROKER_LIKELY);
  assert.equal(classifyAdvertiser({ text: "للبيع أرض في شوران" }, { repeat: 4 }).kind, ADVERTISER.BROKER_LIKELY, "one number on many ads");
  // What reaches the broker: strong AND reachable; an alert only at the level the mode asks for.
  assert.deepEqual(surfaceDecision({ band: BAND.VERY_STRONG, contactable: false }), { surface: "HIDDEN", notify: false });
  assert.deepEqual(surfaceDecision({ band: BAND.MEDIUM, contactable: true }), { surface: "HIDDEN", notify: false });
  assert.deepEqual(surfaceDecision({ band: BAND.STRONG, contactable: true, mode: "GENERAL" }), { surface: "SHOWN", notify: false });
  assert.deepEqual(surfaceDecision({ band: BAND.STRONG, contactable: true, mode: "URGENT" }), { surface: "SHOWN", notify: true });
  assert.deepEqual(surfaceDecision({ band: BAND.STRONG, contactable: true, minQuality: BAND.VERY_STRONG, mode: "URGENT" }), { surface: "HIDDEN", notify: false });
  // An owners-only search: a broker's ad stays out of sight however well it fits.
  const profile = { tx: "sale", propertyTypes: ["أرض"], city: "المدينة المنورة", districts: ["شوران"], preferDirectOwner: true };
  const entity = { ...base, city: "المدينة المنورة", text: `${base.text} مكتب عقار للتسويق والسعي 2.5%`, sources: [] };
  const judged = evaluateFind({ entity, tasks: [{ id: "t", mode: "GENERAL", seek: "OWNER", origin: "CUSTOM", profile }], now });
  assert.equal(judged.advertiser.kind, ADVERTISER.BROKER_LIKELY);
  assert.ok([BAND.MEDIUM, BAND.WEAK].includes(judged.band), judged.band);
});

test("one property or request seen twice is one find; two properties of one advertiser stay two", () => {
  const a = { kind: "OFFER", tx: "sale", propertyType: "أرض", district: "شوران", price: 1_300_000, area: 600, phone: "0551234567", text: "للبيع أرض سكنية في حي شوران مساحة 600 متر على شارع 20 السعر مليون و300 الف" };
  assert.equal(sameEntity(a, { ...a, text: "أرض للبيع بحي شوران 600م شارع 20، مليون وثلاثمئة" }).same, true, "same number, same place, same price");
  assert.equal(sameEntity(a, { ...a, phone: "", text: a.text }).same, true, "the same ad without its number (another source)");
  assert.equal(sameEntity(a, { ...a, district: "قباء", price: 700_000, text: "للبيع أرض في قباء 400 متر ب700 الف" }).same, false, "another property of the same advertiser");
  assert.equal(sameEntity(a, { ...a, phone: "0559999999", text: "للبيع أرض في شوران 800 متر مليونين" , price: 2_000_000, area: 800 }).same, false, "another advertiser, another property");
  assert.equal(sameEntity(a, { ...a, kind: "REQUEST" }).same, false);
  assert.equal(sameEntity(a, { ...a, phone: "", price: 1_150_000 }).same, true, "the same place with the price reduced");
  // Merging: sources united, the missing contact filled, the price change recorded.
  const kept = { ...a, phone: "", sources: [{ sourceId: "qa_one", ref: "x1", firstSeenAt: "2026-10-01T00:00:00.000Z" }], sourceCount: 1, changes: [] };
  const merged = mergeSighting(kept, { ...a, sourceId: "qa_two", externalId: "y9", price: 1_200_000 }, { now: new Date("2026-10-11T10:00:00Z") });
  assert.equal(merged.next.sourceCount, 2); assert.equal(merged.next.phone, "0551234567"); assert.equal(merged.next.price, 1_200_000); assert.equal(merged.newSource, true);
  assert.deepEqual(merged.changes.map((c) => c.field).sort(), ["contact", "price"]);
  assert.deepEqual(splitDigest("للبيع أرض في شوران 600 متر مليون 0551234567\n\nمطلوب شقة للإيجار في قباء 20 الف\n\nالسلام عليكم").length, 2, "a digest is read ad by ad; a greeting is not an ad");
  const c = candidateFromRaw({ sourceId: "broker_feed", externalId: "d#0", text: "للبيع أرض في حي شوران السعر 123456 للتواصل 0551234567" });
  assert.equal(c.price, 0, "a placeholder price is not a price"); assert.equal(c.phone, "0551234567");
});

test("sources: only what the office may read. عقار، حراج، بيوت and وصلت need a permission (with the reason), and have no access path", () => {
  const ctx = { env: { DEPLOYMENT_ENV: "staging" } };
  const state = (id, office = {}) => SOURCE_ADAPTERS.find((a) => a.id === id).availability(ctx, office);
  assert.equal(state("office_inbox").state, SOURCE_STATE.AVAILABLE);
  assert.equal(state("broker_feed").state, SOURCE_STATE.AVAILABLE);
  assert.equal(state("partner_feed").state, SOURCE_STATE.NOT_CONFIGURED, "a licensed feed does nothing until its key is set");
  assert.equal(state("qa_fixture").state, SOURCE_STATE.UNAVAILABLE, "the test source is not for real offices");
  assert.equal(state("qa_fixture", { isTestFixture: true }).state, SOURCE_STATE.AVAILABLE);
  assert.equal(SOURCE_ADAPTERS.find((a) => a.id === "qa_fixture").availability({ env: { DEPLOYMENT_ENV: "production" } }, { isTestFixture: true }).state, SOURCE_STATE.UNAVAILABLE, "never in production");
  for (const id of ["aqar", "haraj", "bayut", "wasalt"]) {
    const adapter = SOURCE_ADAPTERS.find((a) => a.id === id);
    assert.equal(state(id).state, SOURCE_STATE.NEEDS_PERMISSION, `${id} is read only after a permission`);
    assert.match(state(id).reason, /اتفاقية وصول|ترخيصًا|بتصريح/);
    assert.match(state(id).reason, /أدخل رابط الإعلان مع نصه/, "and the working alternative is named");
    assert.equal(adapter.access.method, "none");
  }
  assert.equal(state("whatsapp_groups").state, SOURCE_STATE.UNAVAILABLE, "private WhatsApp groups have no official way in");
  assert.equal(state("telegram_groups").state, SOURCE_STATE.NOT_CONFIGURED, "Telegram groups wait for the platform's bot");
  assert.equal(SOURCE_ADAPTERS.find((a) => a.id === "telegram_groups").availability({ env: { TELEGRAM_BOT_TOKEN: "1:x", TELEGRAM_WEBHOOK_SECRET: "s", TELEGRAM_BOT_USERNAME: "bot" } }).state, SOURCE_STATE.AVAILABLE);
  for (const adapter of SOURCE_ADAPTERS) assert.ok(adapter.access?.basis, `${adapter.id} documents its basis`);
});

test("the queue: an urgent search always before a deep one, a deep one before a general one; an office being worked on is skipped", () => {
  const now = 1_000_000;
  const due = dueOffices({
    general: { t: { a: { n: 1, p: 1 } }, s: 0, l: 0 },
    urgent: { t: { b: { n: 900_000, p: 3 }, c: { n: 5, p: 1 } }, s: 0, l: 0 },
    deep: { t: { d: { n: 10, p: 2 } }, s: 0, l: 0 },
    busy: { t: { e: { n: 1, p: 3 } }, s: 0, l: now + 1000 },
    later: { t: { f: { n: now + 60_000, p: 3 } }, s: 0, l: 0 },
    syncOnly: { t: {}, s: 500, l: 0 }
  }, now);
  assert.deepEqual(due.map((d) => d.officeId), ["urgent", "deep", "general", "syncOnly"]);
  assert.deepEqual(due[0].taskIds, ["b", "c"], "inside an office too: the urgent search first");
});

// ------------------------------------------------------------------ through the Worker

test("off by default; only the manager switches it on; switching on reads the office once and queues its searches", async () => {
  const before = await ok("/os/scout/overview");
  assert.equal(before.available, true); assert.equal(before.settings.enabled, false);
  assert.equal((await call("/os/scout/settings", { settings: { enabled: true } }, BROKER_A2)).status, 403, "a broker cannot switch the scout");
  assert.equal((await call("/os/scout/search", { search: { tx: "sale", propertyTypes: ["أرض"], districts: "شوران" } })).status, 409, "no search while it is off");
  const on = await ok("/os/scout/settings", { settings: { enabled: true, city: "المدينة المنورة", districts: "العزيزية", propertyTypes: ["أرض", "فيلا"] } });
  assert.equal(on.settings.enabled, true);
  assert.deepEqual(on.settings.districts, ["العزيزية"]);
  assert.ok(tasks().some((t) => t.id === "st_discovery" && t.status === "ACTIVE" && t.seek === "ANY"), "the office's standing radar");
  assert.ok(schedule()[OFFICE_A].t.st_discovery, "queued");
  assert.ok(h.store.list(`offices/${OFFICE_A}/auditLogs`).some((a) => a.action === "SCOUT_ENABLED"));
  // The settings screen offers only sources verified as usable: the office's channels and what it pastes.
  assert.deepEqual((await ok("/os/scout/overview")).sources.map((s) => s.id), ["office_inbox", "broker_feed"]);
});

let offerId = "";
let requestId = "";

test("scenario 1 and 2: an offer with no buyer, a request with no property → the scout opens a search for each by itself", async () => {
  offerId = await save("OFFER", { type: "عمارة", district: "شوران", price: 3_000_000 });
  requestId = await save("REQUEST", { type: "أرض", district: "الحمراء", price: 1_500_000 });
  const forOffer = taskFor(offerId);
  const forRequest = taskFor(requestId);
  assert.deepEqual([forOffer.origin, forOffer.seek, forOffer.mode, forOffer.status, forOffer.recordKind], ["AUTO", "REQUEST", "GENERAL", "ACTIVE", "OFFER"]);
  assert.match(forOffer.title, /مشترٍ محتمل لـ«عمارة للبيع في حي شوران»/);
  assert.deepEqual([forRequest.origin, forRequest.seek, forRequest.profile.priceMax, forRequest.profile.districts], ["AUTO", "OFFER", 1_500_000, ["الحمراء"]]);
  assert.match(forRequest.title, /عقار مناسب لـ«طلب شراء أرض في حي الحمراء»/);
  assert.equal(schedule()[OFFICE_A].t[forOffer.id].p, 1, "general priority");
  // A record whose other side is already in the office needs no outside search.
  const matchedOffer = await save("OFFER", { type: "شقة", district: "قباء", price: 500_000 });
  const matchedRequest = await save("REQUEST", { type: "شقة", district: "قباء", price: 520_000 });
  assert.equal(taskFor(matchedRequest), undefined, "it matched inside the office");
  assert.equal(taskFor(matchedOffer).status, "ACTIVE", "the offer was alone when it was saved…");
  await ok("/os/scout/settings", { settings: { enabled: true } });
  assert.deepEqual([taskFor(matchedOffer).status, taskFor(matchedOffer).statusReason], ["ENDED", "RECORD_MATCHED"], "…and its search ends once the office has its other side");
});

test("scenario 3 and 4: «ابحث عن مشتري» / «ابحث عن عقار» from the record — one press, no data asked", async () => {
  const offer = await save("OFFER", { type: "فيلا", district: "العزيزية", price: 2_400_000, extra: { area: 400, rooms: 5 } });
  await ok("/os/scout/record", { recordId: offer, action: "STOP" });
  assert.deepEqual([taskFor(offer).status, taskFor(offer).stoppedByBroker], ["PAUSED", true]);
  // The whole request is the record id: mode, side, operation, type, district, price and area come from the record.
  const started = await ok("/os/scout/record", { recordId: offer, action: "START" });
  const task = taskFor(offer);
  assert.equal(started.taskId, task.id);
  assert.deepEqual([task.origin, task.status, task.seek, task.exactPrice, task.profile.tx, task.profile.propertyTypes, task.profile.districts, task.profile.areaMin, task.profile.areaMax, task.profile.rooms],
    ["RECORD", "ACTIVE", "REQUEST", 2_400_000, "sale", ["فيلا"], ["العزيزية"], 300, 500, 5]);
  const again = await ok("/os/scout/record", { recordId: offer, action: "START" });
  assert.equal(again.duplicate, true, "a second press does not start a second search");
  const status = await ok("/os/scout/record", { recordId: requestId, action: "STATUS" });
  assert.deepEqual([status.task.status, status.task.recordKind, status.task.modeLabel], ["ACTIVE", "REQUEST", "عام 24/7"]);
  // Another office cannot reach the record at all.
  assert.equal((await call("/os/scout/record", { recordId: offer, action: "START" }, OWNER_B, OFFICE_B)).status, 404);
});

test("scenario 5: the general search runs in the background from the Worker's scheduler, with nobody on the site", async () => {
  fixture("buyer-1", { text: "مطلوب عمارة للشراء في حي شوران بحدود 3 مليون ريال كاش ومستعجل", phone: "0559000111" });
  fixture("land-1", { text: "للبيع أرض سكنية في حي الحمراء مساحة 600 متر السعر مليون و350 الف", phone: "0559000222" });
  await round();
  const buyer = finds().find((f) => f.phone === "0559000111");
  const land = finds().find((f) => f.phone === "0559000222");
  assert.deepEqual([buyer.kind, buyer.band, buyer.surface, buyer.bestRecordId], ["REQUEST", "VERY_STRONG", "SHOWN", offerId], "«مشتري محتمل لهذا العرض»");
  assert.deepEqual([land.kind, land.band, land.surface, land.bestRecordId, land.price], ["OFFER", "VERY_STRONG", "SHOWN", requestId, 1_350_000], "«فرصة قوية — يوجد طلب مطابق في مكتبك»");
  assert.ok(land.reasons.includes("نفس الحي") && land.reasons.includes("السعر داخل الميزانية"));
  const page = await ok("/os/scout/overview");
  assert.deepEqual(page.board.map((c) => c.category).sort(), ["BUYER", "PROPERTY"]);
  assert.deepEqual(page.away.lines, ["مشترٍ محتمل لعرض لديك", "عقار مناسب لطلب عميل"]);
  assert.equal(page.counters.strongToday, 2);
  const alerts = notes();
  assert.equal(alerts.length, 2, "each very strong find alerts once");
  assert.ok(alerts.some((n) => n.title === "فرصة قوية" && /طلب شراء حديثًا مناسبًا لـ«عمارة للبيع في حي شوران»/.test(n.body)));
  assert.ok(alerts.some((n) => n.title === "تطابق جديد" && /وجدنا أرض في الحمراء ضمن ميزانية عميلك/.test(n.body)));
  assert.ok(alerts.every((n) => /^scout\/opp\/so_/.test(n.route) && !/05\d{8}/.test(n.body)), "the alert opens the find; no contact detail on a lock screen");
  // The scheduler recorded its work; the next general round is hours away.
  assert.ok(scheduleHealth().lastWorkAt && scheduleHealth().rounds >= 1);
  const next = schedule()[OFFICE_A].t[taskFor(offerId).id];
  assert.ok(next.n - Date.now() > 5.9 * 3_600_000 && next.c === 1, JSON.stringify(next));
  assert.ok(h.store.list(`offices/${OFFICE_A}/scoutRuns`).length >= 1, "a round that did something leaves counts");
  // The same beat again: nothing is due, nothing is read twice, no second alert.
  await beat();
  await round();
  assert.equal(notes().length, 2);
  assert.equal(finds().length, 2);
});

test("opening a find: what, why, for which record, source, freshness, confidence — and the broker's three decisions", async () => {
  const land = finds().find((f) => f.phone === "0559000222");
  const { find } = await ok("/os/scout/find", { opportunityId: land.id });
  assert.equal(find.headline, "أرض للبيع في حي الحمراء");
  assert.equal(find.categoryLabel, "عقار مناسب لطلب عميلك");
  assert.equal(find.recordId, requestId); assert.match(find.recordTitle, /طلب شراء أرض/);
  assert.ok(find.why.length >= 3 && find.freshness && find.confidence && find.sources.length === 1);
  assert.equal(find.contact.phone, "0559000222");
  assert.ok(!("score" in find) && !JSON.stringify(find).includes("linksJson"), "no engine numbers for the broker");
  // «تواصل» = the broker opened the contact himself. The scout has no way to send anything.
  const opened = await ok("/os/scout/find/act", { opportunityId: land.id, action: "CONTACT" });
  assert.equal(opened.status, "CONTACTED");
  assert.equal(finds().find((f) => f.id === land.id).contactOpenedAt.length > 0, true);
  await ok("/os/scout/find/act", { opportunityId: land.id, action: "SAVE" });
  assert.equal((await ok("/os/scout/overview")).board.find((c) => c.id === land.id).status, "SAVED");
  await ok("/os/scout/find/act", { opportunityId: land.id, action: "IGNORE" });
  assert.equal((await ok("/os/scout/overview")).board.some((c) => c.id === land.id), false, "ignored: off the board");
  // An ignored find does not come back when its source shows it again.
  fixture("land-1", { text: "للبيع أرض سكنية في حي الحمراء مساحة 600 متر السعر مليون و350 الف — فرصة", phone: "0559000222" });
  await round();
  assert.equal(finds().find((f) => f.id === land.id).surface, "HIDDEN");
  await ok("/os/scout/find/act", { opportunityId: land.id, action: "RESTORE" });
  assert.equal((await ok("/os/scout/overview")).board.some((c) => c.id === land.id), true);
  assert.ok(h.store.list(`offices/${OFFICE_A}/auditLogs`).some((a) => a.action === "SCOUT_FIND_ACTION"));
});

test("scenario 8: the same ad from two sources is one find — «وُجدت في مصدرين»", async () => {
  const before = finds().length;
  fixture("dup-a", { tag: "one", text: "للبيع فيلا في حي العزيزية مساحة 400 متر 5 غرف السعر مليونين و300 الف", phone: "0559000444" });
  fixture("dup-b", { tag: "two", text: "فيلا للبيع بحي العزيزية 400م خمس غرف بسعر 2.3 مليون", phone: "0559000444" });
  await round();
  const villa = finds().filter((f) => f.phone === "0559000444");
  assert.equal(villa.length, 1, "one find");
  assert.equal(finds().length, before + 1);
  assert.equal(villa[0].sourceCount, 2);
  assert.equal(JSON.parse(villa[0].sourcesJson).length, 2);
  const { find } = await ok("/os/scout/find", { opportunityId: villa[0].id });
  assert.equal(find.sourceCount, 2);
  assert.ok(find.why.includes("وُجدت في 2 مصادر"));
});

test("scenario 9 and 10: a strong find nobody can be reached for is kept inside, silently — until a source shows it with a number", async () => {
  const before = notes().length;
  fixture("silent-1", { tag: "one", text: "مطلوب عمارة للشراء في حي شوران الميزانية 2.9 مليون والدفع كاش، التواصل على الخاص" });
  await round();
  const silent = finds().find((f) => f.price === 2_900_000);
  assert.ok(silent, "kept for merging");
  assert.deepEqual([silent.phone || "", silent.surface, silent.band], ["", "HIDDEN", "STRONG"], "a strong fit, no way to reach it");
  assert.equal(notes().length, before, "no alert for a find the broker cannot act on");
  assert.equal((await ok("/os/scout/overview")).board.some((c) => c.id === silent.id), false);
  assert.equal((await call("/os/scout/find/act", { opportunityId: silent.id, action: "CONTACT" })).status, 409);
  // Later, the same request appears elsewhere with a number: the two are merged and judged again.
  fixture("silent-2", { tag: "two", text: "مطلوب عمارة للشراء بحي شوران، الميزانية 2.9 مليون كاش", phone: "0559000555" });
  await round();
  const merged = finds().filter((f) => f.price === 2_900_000);
  assert.equal(merged.length, 1, "merged, not duplicated");
  assert.deepEqual([merged[0].id, merged[0].phone, merged[0].surface, merged[0].band, merged[0].sourceCount], [silent.id, "0559000555", "SHOWN", "VERY_STRONG", 2]);
  assert.equal(notes().length, before + 1, "now it is worth the broker's attention");
  assert.ok(JSON.parse(merged[0].changesJson).some((c) => c.field === "contact"));
});

test("a known ad is not new; a reduced price is recorded, the find is judged again and the broker is told", async () => {
  // 1.75M is outside the client's 1.5M ceiling (general tolerance 10%): not this search's, so nothing is kept.
  fixture("drop-1", { text: "للبيع أرض في حي الحمراء مساحة 700 متر السعر مليون و750 الف", phone: "0559000666" });
  await round();
  assert.equal(finds().some((f) => f.phone === "0559000666"), false, "outside the budget: not kept, not shown");
  const alertsBefore = notes().length;
  // The same ad, reduced to 1.45M: now inside the budget.
  fixture("drop-1", { text: "للبيع أرض في حي الحمراء مساحة 700 متر السعر مليون و450 الف", phone: "0559000666" });
  await round();
  const land = finds().find((f) => f.phone === "0559000666");
  assert.deepEqual([land.price, land.surface, land.bestRecordId], [1_450_000, "SHOWN", requestId]);
  assert.equal(notes().length, alertsBefore + 1);
  // Seen again unchanged: not new, no second alert.
  fixture("drop-1", { text: "للبيع أرض في حي الحمراء مساحة 700 متر السعر مليون و450 الف", phone: "0559000666" });
  await round();
  assert.equal(notes().length, alertsBefore + 1);
  // Reduced again while already shown: the change is kept in its history and the broker gets the «انخفض السعر» line.
  fixture("drop-1", { text: "للبيع أرض في حي الحمراء مساحة 700 متر السعر مليون و300 الف", phone: "0559000666" });
  await round();
  const after = finds().find((f) => f.phone === "0559000666");
  assert.equal(after.price, 1_300_000);
  assert.deepEqual(JSON.parse(after.changesJson).filter((c) => c.field === "price").map((c) => [c.from, c.to]), [[1_450_000, 1_300_000]]);
  assert.ok(notes().some((n) => n.title === "انخفض السعر" && /1,300,000 بعد 1,450,000/.test(n.body)), notes().map((n) => n.title).join("|"));
  assert.equal(finds().filter((f) => f.phone === "0559000666").length, 1);
});

test("scenario 11 and 12: nothing suitable → nothing is invented; many weak ads → none is shown to look busy", async () => {
  const boardBefore = (await ok("/os/scout/overview")).board.length;
  const keptBefore = finds().length;
  const alertsBefore = notes().length;
  for (let i = 0; i < 12; i += 1) {
    fixture(`weak-${i}`, { text: `للإيجار شقة عزاب في حي قباء غرفتين وصالة ${14 + i} الف سنوي`, phone: `05591${String(10000 + i)}` });
  }
  fixture("weak-chat", { text: "السلام عليكم، أحد يعرف مقاول ترميم ممتاز في المدينة؟", phone: "0559100999" });
  fixture("weak-other-city", { text: "للبيع أرض في حي النرجس بالرياض 900 متر 3 مليون", phone: "0559100998" });
  await round();
  const after = await ok("/os/scout/overview");
  assert.equal(after.board.length, boardBefore, "the board did not grow");
  assert.equal(finds().length, keptBefore, "weak ads are not even stored");
  assert.equal(notes().length, alertsBefore, "and nobody is disturbed");
  const run = h.store.list(`offices/${OFFICE_A}/scoutRuns`).sort((a, b) => new Date(b.at) - new Date(a.at))[0];
  assert.ok(run.fetched >= 14 && run.discarded >= 13 && run.strong === 0, JSON.stringify({ fetched: run.fetched, discarded: run.discarded, strong: run.strong }));
});

test("an ad that is already one of the office's own records is not a find", async () => {
  const own = h.store.get(`offices/${OFFICE_A}/opportunities/${offerId}`);
  const keptBefore = finds().length;
  fixture("own-1", { text: "للبيع عمارة في حي شوران السعر 3 مليون", phone: own.contactPhone });
  await round();
  assert.equal(finds().length, keptBefore);
});

test("scenario 13: nothing in the district itself → the search widens to the documented neighbours, never straight to the city", async () => {
  const request = await save("REQUEST", { type: "دور", district: "شوران", price: 900_000 });
  const id = taskFor(request).id;
  // A floor in a neighbouring district and one across the city, both inside the budget.
  fixture("near-1", { text: "للبيع دور في حي العوالي مساحة 300 متر السعر 850 الف", phone: "0559000777" });
  fixture("far-1", { text: "للبيع دور في حي قباء مساحة 300 متر السعر 850 الف", phone: "0559000888" });
  await round([id]);
  assert.equal(finds().some((f) => ["0559000777", "0559000888"].includes(f.phone)), false, "round 1: the district itself only");
  assert.deepEqual([schedule()[OFFICE_A].t[id].e, Number(taskFor(request).geoRing || 0)], [1, 0]);
  await round([id]);
  assert.equal(Number(taskFor(request).geoRing || 0), 0, "round 2: still the district itself");
  await round([id]);
  assert.equal(taskFor(request).geoRing, 1, "after three empty rounds the search includes the neighbouring districts");
  assert.equal(schedule()[OFFICE_A].t[id].n <= Date.now(), true, "and looks again on the next beat");
  await beat();
  const near = finds().find((f) => f.phone === "0559000777");
  assert.ok(near && near.surface === "SHOWN", "the neighbouring floor is found…");
  assert.equal(near.band, "STRONG", "…as a strong find, below what the same district would be");
  assert.ok(near.reasons[0].startsWith("حي مجاور لـشوران"));
  assert.equal(finds().some((f) => f.phone === "0559000888"), false, "the other side of the city stays out");
  assert.match((await ok("/os/scout/search/detail", { taskId: id })).task.scope, /الأحياء المجاورة/);
  for (let i = 0; i < 8; i += 1) await round([id]);
  assert.equal(taskFor(request).geoRing, 1, "it never widens to the whole city on its own");
  assert.equal(finds().some((f) => f.phone === "0559000888"), false);
});

test("scenario 6: a deep search really goes deeper than a general one — close types, wider price, older ads, and it ends with a summary", async () => {
  // Three ads a general search would pass over: a duplex for a villa search, 18% over the ceiling, and three weeks old.
  fixture("deep-related", { text: "للبيع دوبلكس في حي السلام مساحة 350 متر السعر مليون و900 الف", phone: "0559001001" });
  fixture("deep-price", { text: "للبيع فيلا في حي السلام مساحة 380 متر السعر 2.35 مليون", phone: "0559001002" });
  fixture("deep-old", { text: "للبيع فيلا في حي السلام مساحة 400 متر السعر مليون و950 الف", phone: "0559001003", publishedAt: new Date(Date.now() - 21 * 86_400_000).toISOString() });
  const search = { seek: "OFFER", tx: "sale", propertyTypes: ["فيلا"], city: "المدينة المنورة", districts: "السلام", priceMax: 2_000_000 };
  const general = await ok("/os/scout/search", { search: { ...search, mode: "GENERAL" }, requestKey: "cmp-general" });
  await round([general.taskId]);
  const seenByGeneral = ["0559001001", "0559001002", "0559001003"].filter((p) => finds().some((f) => f.phone === p && JSON.parse(f.linksJson).some((l) => l.taskId === general.taskId)));
  assert.deepEqual(seenByGeneral, [], "the general search keeps none of the three");
  await ok("/os/scout/search/control", { taskId: general.taskId, action: "END" });
  const deep = await ok("/os/scout/search", { search: { ...search, mode: "DEEP" }, requestKey: "cmp-deep" });
  assert.equal(deep.firstRound, false, "a deep search waits for the scheduler (only an urgent one runs inside the request)");
  assert.equal(schedule()[OFFICE_A].t[deep.taskId].p, 2);
  await round([deep.taskId]);
  const linked = (phone) => JSON.parse(finds().find((f) => f.phone === phone)?.linksJson || "[]").find((l) => l.taskId === deep.taskId);
  assert.ok(linked("0559001001") && linked("0559001001").warnings.some((w) => w.includes("نوع قريب")), "a close type, said so");
  assert.ok(linked("0559001002"), "inside the deep search's wider price");
  assert.ok(linked("0559001003"), "an older ad, inside the deep search's longer look back");
  const next = schedule()[OFFICE_A].t[deep.taskId];
  assert.ok(next.n - Date.now() <= 30 * 60_000 + 2000 && next.n - Date.now() > 25 * 60_000, "its rounds are half an hour apart");
  // Its day is over: it completes by itself and says what it found — it does not run for ever.
  h.store.patch(`offices/${OFFICE_A}/scoutTasks/${deep.taskId}`, { intensiveUntil: new Date(Date.now() - 1000).toISOString() });
  await round([deep.taskId]);
  const done = tasks().find((t) => t.id === deep.taskId);
  assert.deepEqual([done.status, done.statusReason], ["COMPLETED", "DEEP_COMPLETE"]);
  assert.equal(schedule()[OFFICE_A].t[deep.taskId], undefined);
  assert.ok(notes().some((n) => n.type === "SCOUT_SEARCH_DONE" && n.title === "اكتمل البحث العميق" && n.route === `scout/task/${deep.taskId}`));
});

test("scenario 7: an urgent search — first round inside the request, highest priority, every beat, neighbours at once, an alert for every strong find", async () => {
  // Waiting in the source before the search exists: a building next to شوران, inside the budget.
  fixture("urgent-near", { text: "للبيع عمارة في حي العوالي 3 أدوار مساحة 500 متر السعر مليون و800 الف", phone: "0559002001" });
  const alertsBefore = notes().length;
  const parsed = await ok("/os/scout/parse", { text: "عميل جاد مستعجل يريد عمارة في شوران أو الهجرة حتى 2 مليون ريال" });
  assert.deepEqual([parsed.draft.mode, parsed.draft.seek, parsed.draft.tx, parsed.draft.propertyTypes, parsed.draft.districts, parsed.draft.priceMax, parsed.draft.city], ["URGENT", "OFFER", "sale", ["عمارة"], ["شوران", "الهجرة"], 2_000_000, "المدينة المنورة"]);
  assert.deepEqual([parsed.missing, parsed.assumed.sort()], [[], ["city", "tx"]], "nothing asked again: the city is the office's, a two-million budget is a purchase");
  const started = await ok("/os/scout/search", { search: parsed.draft, requestKey: "urgent-1" });
  const task = tasks().find((t) => t.id === started.taskId);
  assert.equal(started.firstRound, true, "the first round ran inside the request");
  assert.equal(started.found, 1);
  const building = finds().find((f) => f.phone === "0559002001");
  assert.deepEqual([building.surface, building.band], ["SHOWN", "STRONG"], "a neighbouring district from the very first round");
  assert.equal(notes().length, alertsBefore + 1, "strong is enough to alert in an urgent search (a general one alerts for very strong only)");
  assert.match(notes().find((n) => n.entityId === building.id).title, /^عاجل — /);
  const entry = schedule()[OFFICE_A].t[task.id];
  assert.deepEqual([entry.p, entry.c], [3, 1]);
  assert.ok(entry.n - Date.now() <= 5 * 60_000 + 2000, "next round on the next beat");
  assert.equal(task.geoRing, 1);
  assert.ok(new Date(task.intensiveUntil) - Date.now() > 71 * 3_600_000, "three days of urgent pace");
  // Its three days pass: it keeps watching, at the general pace and priority.
  h.store.patch(`offices/${OFFICE_A}/scoutTasks/${task.id}`, { intensiveUntil: new Date(Date.now() - 1000).toISOString() });
  await round([task.id]);
  const later = schedule()[OFFICE_A].t[task.id];
  assert.equal(tasks().find((t) => t.id === task.id).status, "ACTIVE");
  assert.ok(later.p === 1 && later.n - Date.now() > 5.9 * 3_600_000, JSON.stringify(later));
  await ok("/os/scout/search/control", { taskId: task.id, action: "END" });
});

test("a search can be made urgent later: it restarts its clock at the urgent pace and looks at once", async () => {
  const id = taskFor(requestId).id;
  const changed = await ok("/os/scout/search/control", { taskId: id, action: "SET_MODE", mode: "URGENT" });
  assert.equal(changed.task.mode, "URGENT");
  assert.equal(schedule()[OFFICE_A].t[id].p, 3);
  assert.equal(taskFor(requestId).stats.strong >= 1, true, "what it had found stays");
  await ok("/os/scout/search/control", { taskId: id, action: "SET_MODE", mode: "GENERAL" });
  assert.equal(schedule()[OFFICE_A].t[id].p, 1);
  assert.equal((await call("/os/scout/search/control", { taskId: "st_discovery", action: "SET_MODE", mode: "URGENT" })).status, 400, "the office's standing radar stays general");
});

test("scenario 15: stopping one search does not touch the others", async () => {
  const mine = taskFor(offerId).id;
  const other = taskFor(requestId).id;
  const paused = await ok("/os/scout/search/control", { taskId: mine, action: "PAUSE" });
  assert.equal(paused.task.status, "PAUSED");
  assert.equal(schedule()[OFFICE_A].t[mine], undefined);
  assert.ok(schedule()[OFFICE_A].t[other] && schedule()[OFFICE_A].t.st_discovery, "the others are still queued");
  assert.equal(taskFor(requestId).status, "ACTIVE");
  // While it is paused its source can show a perfect fit: nothing is found for it.
  fixture("paused-buyer", { text: "مطلوب عمارة للشراء في حي شوران الميزانية 3.1 مليون", phone: "0559003001" });
  await round();
  assert.equal(JSON.parse(finds().find((f) => f.phone === "0559003001")?.linksJson || "[]").some((l) => l.taskId === mine), false);
  await ok("/os/scout/search/control", { taskId: mine, action: "RESUME" });
  assert.ok(schedule()[OFFICE_A].t[mine], "resumed: queued again");
  // A full sync does not bring back a search the broker stopped himself.
  await ok("/os/scout/search/control", { taskId: mine, action: "PAUSE" });
  await ok("/os/scout/settings", { settings: { enabled: true } });
  assert.deepEqual([taskFor(offerId).status, taskFor(offerId).stoppedByBroker], ["PAUSED", true]);
  await ok("/os/scout/search/control", { taskId: mine, action: "RESUME" });
  assert.equal((await call("/os/scout/search/control", { taskId: mine, action: "PAUSE" }, BROKER_A2)).status, 403, "a colleague cannot stop my search");
});

test("no orphan searches: sold, archived, paused or deleted records end or hold their search at once", async () => {
  const sold = await save("OFFER", { type: "أرض", district: "العوالي", price: 800_000 });
  const archived = await save("OFFER", { type: "أرض", district: "الخالدية", price: 810_000 });
  const paused = await save("REQUEST", { type: "مستودع", district: "الجرف", price: 820_000 });
  const deleted = await save("REQUEST", { type: "مكتب", district: "الدويمة", price: 830_000 });
  for (const id of [sold, archived, paused, deleted]) assert.equal(taskFor(id).status, "ACTIVE");
  await ok("/os/records/availability", { recordId: sold, answer: "SOLD" });
  assert.deepEqual([taskFor(sold).status, taskFor(sold).statusReason], ["ENDED", "RECORD_SOLD"]);
  await ok("/os/records/archive", { recordId: archived });
  assert.deepEqual([taskFor(archived).status, taskFor(archived).statusReason], ["ENDED", "RECORD_CLOSED"]);
  await ok("/os/records/pause", { recordId: paused });
  assert.deepEqual([taskFor(paused).status, taskFor(paused).statusReason], ["PAUSED", "RECORD_PAUSED"]);
  await ok("/os/records/remove", { recordId: deleted });
  assert.deepEqual([taskFor(deleted).status, taskFor(deleted).statusReason], ["ENDED", "RECORD_CLOSED"]);
  for (const id of [sold, archived, paused, deleted]) assert.equal(schedule()[OFFICE_A].t[taskFor(id).id], undefined, "nothing left in the queue");
  assert.equal(state().records.some((r) => [sold, archived, paused, deleted].includes(r.id)), false, "and they left the scout's view of the inventory");
  // The paused record comes back: its search resumes by itself. A sold one does not restart on a new search request.
  await ok("/os/records/restore", { recordId: paused });
  assert.equal(taskFor(paused).status, "ACTIVE");
  assert.equal((await call("/os/scout/record", { recordId: sold, action: "START" })).status, 409);
  // A record that closed through a path with no hook (here: written directly) is caught by the search's own check.
  const quiet = await save("OFFER", { type: "أرض", district: "الجمعة", price: 840_000 });
  h.store.patch(`offices/${OFFICE_A}/opportunities/${quiet}`, { availabilityStatus: "SOLD" });
  const entries = schedule(); entries[OFFICE_A].t[taskFor(quiet).id].r = 0; h.store.patch("_system/scoutSchedule", { entriesJson: JSON.stringify(entries) });
  await round([taskFor(quiet).id]);
  assert.deepEqual([taskFor(quiet).status, taskFor(quiet).statusReason], ["ENDED", "RECORD_SOLD"]);
});

test("«زوّد الباحث»: a pasted digest is read at once against every running search — a few finds, no records, no messages", async () => {
  const recordsBefore = h.store.list(`offices/${OFFICE_A}/opportunities`).length;
  const fed = await ok("/os/scout/feed", { text: [
    "مطلوب أرض للشراء في حي الحمراء، الميزانية مليون ونص، جادين 0559004001",
    "للبيع أرض في حي الحمراء مساحة 650 متر السعر مليون و400 الف، من المالك مباشرة بدون وسطاء 0559004002",
    "للايجار محل في حي قباء 40 الف 0559004003",
    "صباح الخير جميعًا"
  ].join("\n\n") });
  assert.deepEqual([fed.ads, fed.strong], [3, 1], "three ads read, one worth a call");
  assert.equal(fed.cards[0].category, "PROPERTY");
  const owner = finds().find((f) => f.phone === "0559004002");
  assert.equal(owner.advertiser, "OWNER_HIGH");
  assert.ok(JSON.parse(owner.sourcesJson)[0].label === "ما يضيفه المكتب (رابط، نص، ملف)");
  assert.ok((await ok("/os/scout/find", { opportunityId: owner.id })).find.freshness.startsWith("رُصدت"), "a pasted ad is «seen», never claimed as «published»");
  assert.equal(h.store.list(`offices/${OFFICE_A}/opportunities`).length, recordsBefore, "no record is created from a digest");
  assert.equal((await call("/os/scout/feed", { text: "قصير" })).status, 400);
  assert.equal((await call("/os/scout/feed", { text: "ا".repeat(12_001) })).status, 413);
});

test("the office's official inbox is a source: a forwarded digest is read ad by ad; a message already turned into a record is not a find", async () => {
  const at = new Date(Date.now() + 5000).toISOString();
  h.store.seed(`offices/${OFFICE_A}/inbox/in-digest`, { officeId: OFFICE_A, channel: "whatsapp", receivedAt: at, processingState: "kept", senderPhone: "+966559005000", senderName: "وسيط",
    messageText: "عروض اليوم:\n\nللبيع أرض في حي الحمراء مساحة 500 متر السعر مليون و200 الف 0559005001\n\nللإيجار محل في حي قباء 40 الف سنوي 0559005002" });
  h.store.seed(`offices/${OFFICE_A}/inbox/in-single`, { officeId: OFFICE_A, channel: "whatsapp", receivedAt: at, processingState: "processed", opportunityId: "opp_x", senderPhone: "+966559005003",
    messageText: "للبيع أرض في حي الحمراء مساحة 520 متر السعر مليون و250 الف" });
  await round();
  const land = finds().find((f) => f.phone === "0559005001");
  assert.ok(land && land.surface === "SHOWN" && JSON.parse(land.sourcesJson)[0].label === "قنوات المكتب الرسمية");
  assert.equal(finds().some((f) => f.phone === "0559005003" || f.price === 1_250_000), false, "already a record of the office");
  assert.equal(finds().some((f) => f.phone === "0559005002"), false, "the weak one is not kept");
});

test("a licensed feed is one more adapter: asked per query form with its key, its finds merge with the rest, and a failure backs off", async () => {
  Object.assign(h.env, { SCOUT_FEED_URL: "https://feed.partner.test/v1/listings", SCOUT_FEED_KEY: "feed-key-not-in-any-response", SCOUT_FEED_NAME: "تغذية الشريك" });
  feedAnswer = { items: [
    { id: "L-100", url: "https://feed.partner.test/l/100", title: "أرض للبيع", text: "أرض سكنية للبيع في حي الحمراء", kind: "OFFER", tx: "sale", propertyType: "أرض", city: "المدينة المنورة", district: "الحمراء", price: 1_380_000, area: 620, publishedAt: new Date().toISOString(), advertiserType: "OWNER", contact: { phone: "0559006001", name: "أبو فهد" } },
    { id: "L-101", text: "شقة للإيجار في قباء", kind: "OFFER", tx: "rent", propertyType: "شقة", city: "المدينة المنورة", district: "قباء", price: 18_000, contact: { phone: "0559006002" } }
  ] };
  assert.ok((await ok("/os/scout/overview")).sources.some((s) => s.id === "partner_feed" && s.label === "تغذية الشريك"));
  await round();
  assert.ok(feedCalls.length >= 1 && feedCalls.every((c) => c.auth === "Bearer feed-key-not-in-any-response"));
  assert.ok(feedCalls.some((c) => c.url.searchParams.get("districts") === "الحمراء" && c.url.searchParams.get("types") === "أرض" && c.url.searchParams.get("tx") === "sale"), "asked for what the searches want");
  const land = finds().find((f) => f.phone === "0559006001");
  assert.deepEqual([land.surface, land.advertiser, land.price, land.area, land.url], ["SHOWN", "OWNER_HIGH", 1_380_000, 620, "https://feed.partner.test/l/100"]);
  assert.equal(finds().some((f) => f.phone === "0559006002"), false);
  // The feed goes down: the round still completes for the other sources, and the feed is left alone for a while.
  feedAnswer = null;
  const calls = feedCalls.length;
  fixture("during-outage", { text: "للبيع أرض في حي الحمراء مساحة 480 متر السعر مليون و150 الف", phone: "0559006003" });
  await round();
  assert.ok(feedCalls.length > calls, "it was tried");
  assert.ok(finds().some((f) => f.phone === "0559006003"), "the other sources were still read");
  const health = state().health.sources.partner_feed;
  assert.ok(health.fails === 1 && health.backoffUntil > Date.now() && health.lastError === "feed_http_503", JSON.stringify(health));
  const afterFail = feedCalls.length;
  await round();
  assert.equal(feedCalls.length, afterFail, "not asked again while backing off");
  assert.equal(JSON.stringify(await ok("/os/scout/overview")).includes("feed-key"), false, "the key is never in an answer");
  delete h.env.SCOUT_FEED_URL; delete h.env.SCOUT_FEED_KEY; delete h.env.SCOUT_FEED_NAME;
});

test("the office's minimum level is the office's: «قوية جدًا فقط» hides the merely strong", async () => {
  const strongOnly = finds().filter((f) => f.band === "STRONG" && f.surface === "SHOWN" && f.status === "NEW");
  assert.ok(strongOnly.length >= 1);
  await ok("/os/scout/settings", { settings: { minQuality: "VERY_STRONG" } });
  fixture("min-1", { text: "للبيع دور في حي العوالي مساحة 280 متر السعر 870 الف", phone: "0559007001" });
  await round();
  const hidden = finds().find((f) => f.phone === "0559007001");
  assert.deepEqual([hidden.band, hidden.surface], ["STRONG", "HIDDEN"], "kept, not shown");
  await ok("/os/scout/settings", { settings: { minQuality: "STRONG" } });
});

test("scenario 14: the master switch off — nothing runs, nothing is lost; on again — the searches continue", async () => {
  const before = { tasks: tasks().length, finds: finds().length, board: state().board.length, settings: h.store.get(`offices/${OFFICE_A}/scoutSettings/main`).districts };
  const running = tasks().filter((t) => t.status === "ACTIVE").length;
  assert.ok(running >= 3);
  await ok("/os/scout/settings", { settings: { enabled: false } });
  assert.equal(schedule()[OFFICE_A], undefined, "the office left the queue");
  fixture("while-off", { text: "مطلوب عمارة للشراء في حي شوران الميزانية 3 مليون", phone: "0559008001" });
  await beat();
  assert.equal(finds().some((f) => f.phone === "0559008001"), false, "no round ran");
  assert.deepEqual({ tasks: tasks().length, finds: finds().length, board: state().board.length, settings: h.store.get(`offices/${OFFICE_A}/scoutSettings/main`).districts }, before, "searches, finds and settings are all still there");
  assert.equal(tasks().filter((t) => t.status === "ACTIVE").length, running, "the searches were not ended");
  assert.equal((await ok("/os/scout/overview")).board.length > 0, true, "what was found can still be read");
  for (const route of ["/os/scout/search", "/os/scout/feed"]) assert.equal((await call(route, { search: { tx: "sale", propertyTypes: ["أرض"] }, text: "للبيع أرض في حي شوران مليون 0551112223" })).status, 409, `${route} while off`);
  assert.equal((await call("/os/scout/record", { recordId: offerId, action: "START" })).status, 409);
  // Even a queue entry left behind would do nothing for an office that is off.
  const entries = schedule(); entries[OFFICE_A] = { t: { st_discovery: { n: 1, p: 1, c: 0, e: 0, r: 0 } }, s: 0, l: 0 };
  h.store.patch("_system/scoutSchedule", { entriesJson: JSON.stringify(entries) });
  await beat();
  assert.equal(schedule()[OFFICE_A], undefined);
  assert.equal(finds().some((f) => f.phone === "0559008001"), false);
  await ok("/os/scout/settings", { settings: { enabled: true } });
  assert.equal(Object.keys(schedule()[OFFICE_A].t).length, running, "every running search is queued again");
  await round();
  assert.ok(finds().some((f) => f.phone === "0559008001"), "and the scout catches up");
});

test("«البحث العام» off: the automatic searches wait, the ones the broker started himself keep running", async () => {
  const manual = tasks().find((t) => t.origin === "RECORD" && t.status === "ACTIVE");
  await ok("/os/scout/settings", { settings: { generalEnabled: false } });
  assert.ok(tasks().filter((t) => ["AUTO", "DISCOVERY"].includes(t.origin) && t.status === "ACTIVE").length === 0);
  assert.ok(tasks().filter((t) => t.statusReason === "GENERAL_OFF").length >= 2);
  assert.equal(tasks().find((t) => t.id === manual.id).status, "ACTIVE");
  const alone = await save("OFFER", { type: "استراحة", district: "العنبرية", price: 600_000 });
  assert.equal(taskFor(alone), undefined, "no automatic search while the general radar is off");
  await ok("/os/scout/settings", { settings: { generalEnabled: true } });
  assert.ok(tasks().filter((t) => t.statusReason === "GENERAL_OFF").length === 0, "they resume");
  assert.equal(taskFor(alone).status, "ACTIVE", "and the record that was waiting gets its search");
});

test("office isolation: another office has its own scout, sees nothing of this one, and its data feeds nobody else", async () => {
  await ok("/os/scout/settings", { settings: { enabled: true } }, OWNER_B, OFFICE_B);
  const theirs = await ok("/os/scout/overview", {}, OWNER_B, OFFICE_B);
  assert.equal(theirs.board.length, 0);
  assert.deepEqual(theirs.tasks.map((t) => t.id), ["st_discovery", ...tasks(OFFICE_B).filter((t) => t.recordId).map((t) => t.id)].filter((id) => tasks(OFFICE_B).some((t) => t.id === id && t.status === "ACTIVE")).slice(0, theirs.tasks.length));
  const find = finds()[0];
  const task = taskFor(requestId);
  for (const [route, body] of [["/os/scout/find", { opportunityId: find.id }], ["/os/scout/find/act", { opportunityId: find.id, action: "IGNORE" }], ["/os/scout/search/detail", { taskId: task.id }], ["/os/scout/search/control", { taskId: task.id, action: "END" }]]) {
    assert.equal((await call(route, body, OWNER_B, OFFICE_B)).status, 404, `${route} by another office`);
  }
  for (const route of ["/os/scout/overview", "/os/scout/feed", "/os/scout/settings"]) assert.equal((await call(route, { text: "x".repeat(30), settings: {} }, OWNER_B, OFFICE_A)).status, 403, `${route} into another office`);
  assert.equal((await call("/os/scout/overview", {}, "")).status, 401);
  // Office B has a request this office's finds would fit perfectly — it gets none of them, and the test source is not its source.
  await save("REQUEST", { type: "أرض", district: "الحمراء", price: 1_500_000, uid: OWNER_B, office: OFFICE_B });
  fixture("b-land", { office: OFFICE_B, text: "للبيع أرض في حي الحمراء 600 متر السعر مليون و300 الف", phone: "0559009001" });
  await round(null, OFFICE_B);
  assert.equal(finds(OFFICE_B).length, 0, "not a QA office: the test source does not exist for it; and nothing leaks from office A");
  assert.equal(state(OFFICE_B).index.length, 0);
  assert.ok(finds().every((f) => f.officeId === OFFICE_A) && tasks().every((t) => t.officeId === OFFICE_A));
  // The schedule holds ids, times and counters only — no office data.
  assert.equal(/05\d{8}|شوران|الحمراء|مليون/.test(h.store.get("_system/scoutSchedule").entriesJson), false);
});

test("resources: an idle beat reads one document; a known ad is not analysed twice; the model is not used by a general search", async () => {
  await ok("/os/scout/settings", { settings: { enabled: false } }, OWNER_B, OFFICE_B);
  await round();
  const reads = [];
  const writes = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.hostname === "firestore.googleapis.com") (String(init.method || "GET").toUpperCase() === "GET" ? reads : writes).push(decodeURIComponent(url.pathname).split("/documents/")[1] || url.pathname);
    return inner(input, init);
  };
  try {
    await beat();
    const scoutReads = reads.filter((p) => /scout/i.test(p));
    assert.deepEqual(scoutReads, ["_system/scoutSchedule"], "nothing due: the schedule is the only scout read");
    assert.equal(writes.filter((p) => /scout/i.test(p)).length, 0);
  } finally { globalThis.fetch = inner; }
  // A round with nothing new: no find is rewritten.
  const stamp = () => finds().map((f) => `${f.id}:${f.updatedAt}`).join("|");
  const before = stamp();
  await round();
  assert.equal(stamp(), before);
  assert.equal(state().usage.aiCalls || 0, 0, "no model call was made by general searches");
});

test("observability for the platform admin only: scheduler beat, queue sizes, sources and why — no office data, no secrets", async () => {
  const anonymous = await h.worker.fetch(new Request("https://worker.test/admin/scout/health"), h.env, { waitUntil() {} });
  assert.ok([401, 403].includes(anonymous.status));
  const owner = await h.worker.fetch(new Request("https://worker.test/admin/scout/health", { headers: { authorization: `Bearer ${idTokenFor(OWNER_A)}` } }), h.env, { waitUntil() {} });
  assert.ok([401, 403].includes(owner.status), "an office owner is not the platform admin");
  const health = scheduleHealth();
  assert.ok(health.lastTickAt && health.lastOkAt && health.rounds > 5 && health.strong >= 5, JSON.stringify(health));
  assert.equal(/05\d{8}/.test(JSON.stringify(h.store.list(`offices/${OFFICE_A}/scoutRuns`))), false, "run logs carry counts only");
});

test("keeping time: a find nobody acted on for a month and a half leaves, a saved one stays; old pasted text leaves; the round log stays short", async () => {
  const old = new Date(Date.now() - 50 * 86_400_000).toISOString();
  const doc = h.store.get(`offices/${OFFICE_A}/scoutState/main`);
  const entry = (id, status) => ({ id, kind: "OFFER", tx: "sale", propertyType: "أرض", city: "المدينة المنورة", district: "السيح", price: 5_000_000, phone: "0559990001", words: "ارض", firstSeenAt: old, lastSeenAt: old, band: "MEDIUM", status, surface: "HIDDEN" });
  h.store.patch(`offices/${OFFICE_A}/scoutState/main`, { indexJson: JSON.stringify([...JSON.parse(doc.indexJson || "[]"), entry("so_old_unused", "NEW"), entry("so_old_saved", "SAVED")]) });
  for (const id of ["so_old_unused", "so_old_saved"]) h.store.seed(`offices/${OFFICE_A}/scoutOpportunities/${id}`, { officeId: OFFICE_A, id, lastSeenAt: old });
  h.store.seed(`offices/${OFFICE_A}/scoutFeed/sf_old`, { officeId: OFFICE_A, text: "نص قديم", createdAt: old });
  const feedBefore = h.store.list(`offices/${OFFICE_A}/scoutFeed`).length;
  const recent = finds().filter((f) => !String(f.id).startsWith("so_old")).length;
  // The office's six-hourly inventory look is due now.
  const entries = schedule(); entries[OFFICE_A].s = 1; entries[OFFICE_A].l = 0; h.store.patch("_system/scoutSchedule", { entriesJson: JSON.stringify(entries) });
  await beat();
  assert.equal(h.store.get(`offices/${OFFICE_A}/scoutOpportunities/so_old_unused`), null, "the unused old find was removed");
  assert.ok(h.store.get(`offices/${OFFICE_A}/scoutOpportunities/so_old_saved`), "what the broker saved stays");
  assert.deepEqual(state().index.filter((e) => String(e.id).startsWith("so_old")).map((e) => e.id), ["so_old_saved"]);
  assert.equal(finds().filter((f) => !String(f.id).startsWith("so_old")).length, recent, "recent finds are untouched");
  assert.equal(h.store.get(`offices/${OFFICE_A}/scoutFeed/sf_old`), null, "old pasted text was removed");
  assert.equal(h.store.list(`offices/${OFFICE_A}/scoutFeed`).length, feedBefore - 1, "recent pasted text stays");
  assert.ok(h.store.list(`offices/${OFFICE_A}/scoutRuns`).length <= 60, "the round log is a short ring, not a growing list");
});

test("production is untouched: without the environment switch every scout route answers «غير متاح» and no round runs", async () => {
  const saved = h.env.OPPORTUNITY_SCOUT;
  delete h.env.OPPORTUNITY_SCOUT;
  try {
    assert.deepEqual((await ok("/os/scout/overview")).available, false);
    assert.equal((await ok("/os/scout/record", { recordId: offerId, action: "STATUS" })).available, false);
    for (const [route, body] of [["/os/scout/settings", { settings: { enabled: true } }], ["/os/scout/search", { search: { tx: "sale", propertyTypes: ["أرض"] } }], ["/os/scout/feed", { text: "للبيع أرض في حي شوران مليون 0551112223" }], ["/os/scout/parse", { text: "ابحث عن أرض في شوران" }], ["/os/scout/find", { opportunityId: finds()[0].id }]]) {
      const r = await call(route, body);
      assert.deepEqual([r.status, r.body.error], [503, "scout_unavailable"], route);
    }
    makeDue();
    const before = h.store.get("_system/scoutSchedule").entriesJson;
    fixture("prod-1", { text: "مطلوب عمارة للشراء في حي شوران الميزانية 3 مليون", phone: "0559010001" });
    await beat();
    assert.equal(h.store.get("_system/scoutSchedule").entriesJson, before, "the scheduler did not touch the queue");
    assert.equal(finds().some((f) => f.phone === "0559010001"), false);
    // Saving a record still works exactly as before, with no scout side effect.
    const tasksBefore = tasks().length;
    await save("OFFER", { type: "أرض", district: "الوبرة", price: 700_000 });
    assert.equal(tasks().length, tasksBefore);
  } finally { h.env.OPPORTUNITY_SCOUT = saved; }
  const toml = (await import("node:fs")).readFileSync(path.join(ROOT, "worker/wrangler.toml"), "utf8");
  const [production, rest] = toml.split("[env.staging]");
  assert.equal(/OPPORTUNITY_SCOUT/.test(production), false, "not set for production");
  assert.match(rest.split("[env.preview]")[0], /OPPORTUNITY_SCOUT = "enabled"/, "set for Staging");
});

test("the scout never reached a listings site, and never sent a message", () => {
  const allowed = new Set(["firestore.googleapis.com", "oauth2.googleapis.com", "www.googleapis.com", "fcm.googleapis.com", "feed.partner.test", "127.0.0.1"]);
  const others = [...hosts].filter((host) => !allowed.has(host) && !/gstatic|iaqar/.test(host));
  assert.deepEqual(others.filter((host) => /aqar|haraj|t\.me|telegram|whatsapp|facebook|kapso/.test(host)), [], [...hosts].join(", "));
  const rules = (async () => (await import("node:fs")).readFileSync(path.join(ROOT, "firestore.rules"), "utf8"));
  return rules().then((text) => {
    for (const name of ["scoutSettings", "scoutState", "scoutTasks", "scoutOpportunities", "scoutFeed", "scoutFixtures", "scoutRuns"]) assert.ok(text.includes(`'${name}'`), `${name} is closed to browsers by the rules`);
  });
});
