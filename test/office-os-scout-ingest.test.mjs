// «الاستقبال التلقائي»: an assistant (Claude) sends its results straight to the scout with the office's own key.
// Through the real Worker on the in-memory Firestore double. No site is contacted.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { canonicalAdUrl, prepareItem } from "../worker/src/office-os/scout-ingest.js";
import { batchIdFor, chunkBatches, parseInboxPaste } from "../public/os/domain/scout-ingest-domain.js";
import { cleanPlans, parseScoutCommand, planMentioned, plansFrom, profileSummary, validateCustomSearch } from "../public/os/domain/scout-domain.js";
import { fitFor } from "../worker/src/office-os/scout-evaluate.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B, BROKER_A2 } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());
h.store.patch(`offices/${OFFICE_A}`, { city: "المدينة المنورة" });
const outside = [];
const doubleFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (!/googleapis\.com$|^127\.0\.0\.1$|^localhost$/.test(url.hostname)) outside.push(url.hostname);
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
async function ingest(token, body) {
  const headers = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const response = await h.worker.fetch(new Request("https://worker.test/os/scout/ingest", { method: "POST", headers, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}
const feed = (office = OFFICE_A) => h.store.list(`offices/${office}/scoutFeed`).filter((d) => d.channel === "AGENT");
const finds = (office = OFFICE_A) => h.store.list(`offices/${office}/scoutOpportunities`);

// Ten results as Claude would return them from a site that allows reuse (a pretend licensed listings site).
const TEN = [
  { url: "https://listings.example.sa/ad/1001?utm_source=claude", title: "شقة للإيجار في حي العزيزية", text: "شقة للإيجار 3 غرف وصالة ومطبخ راكب في حي العزيزية بالمدينة المنورة، الإيجار السنوي 32 الف ريال، للتواصل 0551000001", tx: "rent", propertyType: "شقة", city: "المدينة المنورة", district: "العزيزية", price: 32000, area: 140, rooms: 3 },
  { url: "https://listings.example.sa/ad/1002", title: "عمارة للبيع مخطط الحمراء هـ4", text: "عمارة دورين جديدة للبيع، كل دور شقة، مساحة 360 متر، السعر مليون ريال. 0551000002", tx: "sale", propertyType: "عمارة", city: "المدينة المنورة", district: "الصناعية", plan: "الحمراء هـ4", price: 1000000, area: 360 },
  { url: "https://listings.example.sa/ad/1003", title: "أرض للبيع في السكب", text: "أرض سكنية للبيع حي السكب مساحة 800 متر على شارع 25 السعر 800 الف قابل للتفاوض 0551000003", tx: "sale", propertyType: "أرض", city: "المدينة المنورة", district: "السكب", price: 800000, area: 800 },
  { url: "https://listings.example.sa/ad/1004", title: "فيلا للبيع في الخضراء", text: "فيلا دورين وملحق في العوينة الخضراء، 6 غرف و8 دورات مياه ومصعد، السعر مليون و150 الف 0551000004", tx: "sale", propertyType: "فيلا", city: "المدينة المنورة", district: "الخضراء", plan: "العوينة", price: 1150000, area: 304, rooms: 6 },
  { url: "https://listings.example.sa/ad/1005", title: "عمارة للإيجار في شوران", text: "عمارة كاملة للإيجار في شوران 8 شقق، الإيجار السنوي 240 الف ريال 0551000005", tx: "rent", propertyType: "عمارة", city: "المدينة المنورة", district: "شوران", price: 240000 },
  { url: "https://listings.example.sa/ad/1006", title: "شقة للبيع في بني بياضة", text: "شقة للبيع في حي بني بياضة مساحة 178 متر 5 غرف السعر 600 الف ريال 0551000006", tx: "sale", propertyType: "شقة", city: "المدينة المنورة", district: "بني بياضة", price: 600000, area: 178, rooms: 5 },
  { url: "https://listings.example.sa/ad/1007", title: "أرض في طيبة مخطط السلام", text: "أرض سكنية للبيع مخطط السلام حي طيبة واجهة غربية 600 متر السعر مليون و100 الف 0551000007", tx: "sale", propertyType: "أرض", city: "المدينة المنورة", district: "طيبة", plan: "السلام", price: 1100000, area: 600 },
  { url: "https://listings.example.sa/ad/1008", title: "محل للإيجار في الخضراء", text: "محل تجاري للإيجار على شارع 30 في العوينة الخضراء مساحة 34 متر الإيجار السنوي 20 الف 0551000008", tx: "rent", propertyType: "محل تجاري", city: "المدينة المنورة", district: "الخضراء", price: 20000, area: 34 },
  { url: "https://listings.example.sa/ad/1009", title: "مطلوب شقة للإيجار في العزيزية", text: "مطلوب شقة للإيجار في حي العزيزية 3 غرف بحدود 30 الف سنوي للتواصل 0551000009", kind: "REQUEST", tx: "rent", propertyType: "شقة", city: "المدينة المنورة", district: "العزيزية", price: 30000 },
  { url: "https://listings.example.sa/ad/1010", title: "مطلوب عمارة للشراء في شوران", text: "مطلوب عمارة للشراء في شوران أو الهجرة الميزانية مليونين كاش 0551000010", kind: "REQUEST", tx: "sale", propertyType: "عمارة", city: "المدينة المنورة", district: "شوران", price: 2000000 }
];

// ------------------------------------------------------------------ pure rules

test("an ad's link is one identity: tracking parameters, fragments and the www. prefix do not make a second ad", () => {
  assert.equal(canonicalAdUrl("https://www.Listings.example.sa/ad/1001/?utm_source=claude&utm_medium=x#photos"), "https://listings.example.sa/ad/1001");
  assert.equal(canonicalAdUrl("https://listings.example.sa/ad?id=7&fbclid=abc"), "https://listings.example.sa/ad?id=7");
  for (const bad of ["http://listings.example.sa/ad/1", "https://127.0.0.1/ad", "https://localhost/ad", "https://user:pw@example.sa/a", "javascript:alert(1)", "https://intranet.local/a"]) assert.equal(canonicalAdUrl(bad), "", bad);
});

test("an item is prepared from what it says; sites whose terms forbid collecting are refused unless licensed", () => {
  const ready = prepareItem(TEN[1]);
  assert.equal(ready.ok, true);
  assert.match(ready.doc.text, /المخطط: مخطط الحمراء هـ4/);
  assert.deepEqual(ready.doc.structured, { tx: "sale", propertyType: "عمارة", city: "المدينة المنورة", district: "الصناعية", price: 1000000, area: 360 });
  for (const host of ["haraj.com.sa", "sa.aqar.fm", "www.bayut.sa", "wasalt.sa"]) {
    assert.deepEqual(prepareItem({ url: `https://${host}/123`, text: "شقة للإيجار في العزيزية 3 غرف 30 الف سنوي" }).reason, "source_restricted", host);
  }
  assert.equal(prepareItem({ url: "https://haraj.com.sa/123", text: "شقة للإيجار في العزيزية 3 غرف 30 الف سنوي" }, { env: { SCOUT_INGEST_LICENSED_HOSTS: "haraj.com.sa" } }).ok, true, "a data agreement opens that one site");
  assert.equal(prepareItem({ text: "قصير" }).reason, "text_too_short");
  assert.equal(prepareItem("نص").reason, "not_an_object");
  assert.equal(prepareItem({ url: "ftp://x.example.sa/1", text: "شقة للإيجار في العزيزية 3 غرف 30 الف سنوي" }).reason, "link_invalid");
  // The body cannot set an approval, a licence or a status: unknown keys are simply not read.
  const sneaky = prepareItem({ ...TEN[0], status: "APPROVED", licensed: true, officeId: OFFICE_B, reviewStatus: "APPROVED" });
  assert.equal(JSON.stringify(sneaky.doc).includes("APPROVED"), false);
  assert.equal(JSON.stringify(sneaky.doc).includes(OFFICE_B), false);
});

test("«المخطط» is part of a search: parsed from a sentence, shown in the summary, and a filter on the ad's words", () => {
  assert.deepEqual(plansFrom("أبغى أرض للبيع في مخطط الحمراء هـ4 بالمدينة بحد أقصى مليون"), ["الحمراء هـ4"]);
  assert.deepEqual(plansFrom("عمارة دورين – مخطط الحمراء (هـ4) كل دور شقة"), ["الحمراء هـ4"]);
  assert.deepEqual(cleanPlans("مخطط العوينة، العوينة، مخطط السلام"), ["العوينة", "السلام"]);
  const parsed = parseScoutCommand("عمارة للإيجار في مخطط العوينة الخضراء حي المطار المدينة المنورة");
  assert.equal(parsed.tx, "rent");
  assert.deepEqual(parsed.propertyTypes, ["عمارة"]);
  assert.deepEqual(parsed.plans, ["العوينة الخضراء"]);
  assert.equal(profileSummary({ tx: "rent", propertyTypes: ["شقة"], districts: ["العزيزية"], plans: ["الحمراء هـ4"], city: "المدينة المنورة" }), "شقق للإيجار في العزيزية مخطط الحمراء هـ4");
  assert.equal(validateCustomSearch({ tx: "sale", plans: "الحمراء هـ4", city: "المدينة المنورة" }).ok, true, "a plan alone is a place to search");
  assert.equal(planMentioned(["الحمراء هـ4"], "عمارة دورين – مخطط الحمراء (هـ4)"), true, "brackets around part of the name do not hide it");
  assert.equal(planMentioned(["الحمراء هـ4"], "عمارة دورين في مخطط الحمراء هـ2"), false, "another phase of the plan is another plan");
  assert.equal(planMentioned(["الحمراء هـ4"], "عمارة في مخطط الحمراء هـ4"), true);
  assert.equal(planMentioned([], "أي نص"), true);
  const entity = { kind: "OFFER", tx: "sale", propertyType: "أرض", city: "المدينة المنورة", district: "طيبة", price: 1_100_000, text: "أرض سكنية للبيع مخطط السلام حي طيبة" };
  const profile = { tx: "sale", propertyTypes: ["أرض"], city: "المدينة المنورة", districts: ["طيبة"], priceMax: 1_200_000 };
  assert.ok(fitFor({ profile: { ...profile, plans: ["السلام"] }, seek: "OFFER", entity }), "the plan the ad names");
  assert.equal(fitFor({ profile: { ...profile, plans: ["الحمراء"] }, seek: "OFFER", entity }), null, "another plan is not this search");
  assert.ok(fitFor({ profile, seek: "OFFER", entity }), "no plan asked → not filtered");
});

test("the inbox page reads a batch, a list or plain paragraphs, and splits long lists into accepted batches", () => {
  const batch = parseInboxPaste(JSON.stringify({ batchId: "claude-2026-10-13", search: { tx: "rent" }, items: TEN.slice(0, 2) }));
  assert.equal(batch.ok, true); assert.equal(batch.batchId, "claude-2026-10-13"); assert.equal(batch.items.length, 2); assert.deepEqual(batch.search, { tx: "rent" });
  const list = parseInboxPaste(JSON.stringify(TEN));
  assert.equal(list.items.length, 10); assert.equal(list.batchId, parseInboxPaste(JSON.stringify(TEN)).batchId, "the same paste is the same batch");
  const plain = parseInboxPaste("شقة للإيجار في العزيزية 3 غرف 30 الف سنوي https://listings.example.sa/ad/9\n\nأرض للبيع في السكب 800 متر بسعر 800 الف");
  assert.equal(plain.items.length, 2); assert.equal(plain.items[0].url, "https://listings.example.sa/ad/9"); assert.equal(plain.items[0].text.includes("https://"), false);
  assert.equal(parseInboxPaste("{bad json").ok, false);
  assert.equal(parseInboxPaste("").ok, false);
  const long = { ok: true, items: Array.from({ length: 45 }, (_, i) => ({ text: `إعلان رقم ${i} شقة للإيجار في العزيزية` })), search: {}, batchId: batchIdFor([{ a: 1 }]) };
  const chunks = chunkBatches(long);
  assert.deepEqual(chunks.map((c) => c.items.length), [20, 20, 5]);
  assert.equal(new Set(chunks.map((c) => c.batchId)).size, 3);
});

// ------------------------------------------------------------------ through the Worker

let token = "";
let keyId = "";

test("the door is closed unless the Worker opens it (SCOUT_INGEST) — Production does not set it", async () => {
  const listing = await ok("/os/scout/ingest/keys");
  assert.equal(listing.available, false);
  const refused = await ingest("iqk.x.y.z", { batchId: "abcdef", items: [TEN[0]] });
  assert.equal(refused.status, 503);
});

test("only the manager creates and revokes keys; the key is shown once and stored as a hash", async () => {
  h.env.SCOUT_INGEST = "enabled";
  const denied = await call("/os/scout/ingest/key/create", { label: "Claude" }, BROKER_A2);
  assert.equal(denied.status, 403);
  const made = await ok("/os/scout/ingest/key/create", { label: "Claude" });
  token = made.token; keyId = made.key.keyId;
  assert.match(token, new RegExp(`^iqk\\.${OFFICE_A}\\.[a-z0-9]{12}\\.[A-Za-z0-9_-]{43}$`));
  const stored = h.store.get(`offices/${OFFICE_A}/scoutIngestKeys/${keyId}`);
  assert.equal(JSON.stringify(stored).includes(token.split(".")[3]), false, "the secret itself is never stored");
  assert.equal(stored.secretHash.length, 64);
  const listing = await ok("/os/scout/ingest/keys");
  assert.equal(listing.keys.length, 1);
  assert.equal(JSON.stringify(listing).includes(token.split(".")[3]), false, "the listing never shows the secret");
});

test("no key, a wrong key, or a key bent to another office is refused the same way", async () => {
  assert.equal((await ingest(null, { batchId: "abcdef", items: [TEN[0]] })).status, 401);
  assert.equal((await ingest(`${token}x`, { batchId: "abcdef", items: [TEN[0]] })).status, 401);
  const [, , kid, secret] = token.split(".");
  assert.equal((await ingest(`iqk.${OFFICE_B}.${kid}.${secret}`, { batchId: "abcdef", items: [TEN[0]] })).status, 401, "the office is read from the key's own record");
  const mismatch = await ingest(token, { batchId: "abcdef", officeId: OFFICE_B, items: [TEN[0]] });
  assert.equal(mismatch.status, 403);
});

test("with the office's scout off nothing is stored", async () => {
  const off = await ingest(token, { batchId: "batch-off-1", items: [TEN[0]] });
  assert.equal(off.status, 409);
  assert.equal(feed().length, 0);
});

let firstReport = null;
test("ten results arrive with one request: saved, understood, matched, shown with their links — no CSV", async () => {
  await ok("/os/scout/settings", { settings: { enabled: true } });
  const batch = { batchId: "claude-madinah-2026-10-13", agent: "claude-in-chrome", search: { tx: "rent", propertyTypes: ["شقة", "عمارة"], city: "المدينة المنورة", districts: ["العزيزية"], plans: ["الحمراء هـ4"] },
    items: [...TEN, { url: "https://haraj.com.sa/11223344", text: "شقة للإيجار في العزيزية 3 غرف 30 الف سنوي 0551000099" }, { url: "http://bad.example.sa/x", text: "شقة للإيجار في العزيزية 3 غرف 30 الف سنوي" }] };
  const r = await ingest(token, batch);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  firstReport = r.body;
  assert.equal(r.body.received, 12);
  assert.equal(r.body.saved, 10);
  assert.equal(r.body.duplicates, 0);
  assert.deepEqual(r.body.rejected.map((x) => [x.index, x.reason]), [[10, "source_restricted"], [11, "link_invalid"]]);
  assert.equal(r.body.replay, false);
  const docs = feed();
  assert.equal(docs.length, 10);
  for (const doc of docs) {
    assert.equal(doc.reviewStatus, "PENDING_REVIEW");
    assert.equal(doc.pinned, true);
    assert.match(doc.link, /^https:\/\/listings\.example\.sa\/ad\/10\d\d$/);
  }
  assert.equal(docs.some((d) => d.link.includes("utm_")), false, "tracking parameters are not kept");
  // Every result becomes an outside find on the broker's scout page, with its source link — not an office record.
  const found = finds();
  assert.ok(found.length >= 10, `finds: ${found.length}`);
  const overview = await ok("/os/scout/overview");
  assert.ok(overview.board.length >= 1);
  const opp = found.find((f) => String(f.url || "").includes("/ad/1002"));
  assert.ok(opp, "the building ad is a find");
  const detail = await ok("/os/scout/find", { opportunityId: opp.id });
  assert.equal(JSON.stringify(detail).includes("listings.example.sa/ad/1002"), true, "the broker sees the original link");
  assert.equal(h.store.list(`offices/${OFFICE_A}/opportunities`).filter((o) => String(o.sourceUrl || o.url || "").includes("listings.example.sa")).length, 0, "nothing became an office record by itself");
  assert.equal(h.store.list(`offices/${OFFICE_B}/scoutFeed`).length, 0, "nothing reached another office");
  // Audit + key usage.
  const audit = h.store.list(`offices/${OFFICE_A}/auditLogs`).filter((a) => a.action === "SCOUT_INGEST_BATCH");
  assert.equal(audit.length, 1);
  assert.equal(JSON.stringify(audit).includes("0551000001"), false, "no phone in the audit trail");
  assert.equal(h.store.get(`offices/${OFFICE_A}/scoutIngestKeys/${keyId}`).uses, 1);
  assert.deepEqual(outside, [], "no outside site was contacted");
});

test("the same batch again (a retry) answers its first report and writes nothing", async () => {
  const before = finds().length;
  const r = await ingest(token, { batchId: "claude-madinah-2026-10-13", items: TEN });
  assert.equal(r.status, 200);
  assert.equal(r.body.replay, true);
  assert.equal(r.body.saved, firstReport.saved);
  assert.equal(feed().length, 10);
  assert.equal(finds().length, before);
});

test("the same ads in a new batch are duplicates; a changed price is an update of the same find, never a second one", async () => {
  const before = finds().length;
  const again = await ingest(token, { batchId: "claude-madinah-2026-10-14", items: TEN });
  assert.equal(again.body.saved, 0);
  assert.equal(again.body.duplicates, 10);
  assert.equal(feed().length, 10);
  const cheaper = TEN.map((item, i) => (i === 2 ? { ...item, url: `${item.url}?utm_campaign=z`, price: 750000, text: item.text.replace("800 الف", "750 الف") } : item));
  const changed = await ingest(token, { batchId: "claude-madinah-2026-10-15", items: cheaper });
  assert.equal(changed.body.updated, 1);
  assert.equal(changed.body.duplicates, 9);
  assert.equal(feed().length, 10);
  assert.equal(finds().length, before, "the price drop is a change on the same find");
  const land = finds().find((f) => String(f.url || "").includes("/ad/1003"));
  assert.equal(Number(land.price), 750000);
});

test("a revoked key stops at once; limits are enforced", async () => {
  const many = await ingest(token, { batchId: "too-many-1", items: Array.from({ length: 21 }, (_, i) => ({ text: `شقة للإيجار في العزيزية رقم ${i} بسعر 30 الف` })) });
  assert.equal(many.status, 413);
  assert.equal((await ingest(token, { batchId: "x", items: [TEN[0]] })).status, 400, "a batch id is required for safe retries");
  assert.equal((await ingest(token, { batchId: "no-items-1", items: [] })).status, 400);
  await ok("/os/scout/ingest/key/revoke", { keyId });
  assert.equal((await ingest(token, { batchId: "after-revoke-1", items: [TEN[0]] })).status, 401);
  const listing = await ok("/os/scout/ingest/keys");
  assert.equal(listing.keys[0].revoked, true);
});

test("a key of office B never writes into office A", async () => {
  await ok("/os/scout/settings", { settings: { enabled: true } }, OWNER_B, OFFICE_B);
  const made = await ok("/os/scout/ingest/key/create", { label: "Claude" }, OWNER_B, OFFICE_B);
  const r = await ingest(made.token, { batchId: "office-b-batch-1", items: [TEN[4]] });
  assert.equal(r.status, 200);
  assert.equal(r.body.officeId, OFFICE_B);
  assert.equal(feed(OFFICE_B).length, 1);
  assert.equal(feed(OFFICE_A).length, 10);
});
