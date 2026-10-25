// «الباحث عن الفرص» — a round that stops half way (the Worker cut off, a write refused) or two rounds of one office
// at once must not alert twice for one ad, and an alert must never open a find that does not exist.
// Seen live on Staging (deploy run 40055697844): 3 finds kept, 2 alerts for the same building, one push left «QUEUED».
// Through the real Worker on the in-memory Firestore double (scripts/qa/office-os/server.mjs). No site is contacted.
import test from "node:test";
import assert from "node:assert/strict";
import { startOfficeOsHarness, idTokenFor, OFFICE_A, OWNER_A } from "../scripts/qa/office-os/server.mjs";

const h = await startOfficeOsHarness();
test.after(() => h.server.close());
h.store.patch(`offices/${OFFICE_A}`, { city: "المدينة المنورة", isTestFixture: true });

// The find writes can be refused on demand, as when a round is cut off before it saves what it found.
let refuseFindWrites = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (refuseFindWrites && method !== "GET" && url.includes("/scoutOpportunities/")) return new Response(JSON.stringify({ error: { code: 503, message: "cut off" } }), { status: 503 });
  return realFetch(input, init);
};
test.after(() => { globalThis.fetch = realFetch; });

async function call(route, body = {}) {
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${idTokenFor(OWNER_A)}` }, body: JSON.stringify({ officeId: OFFICE_A, ...body }) }), h.env, { waitUntil() {} });
  const json = await response.json();
  assert.equal(response.status, 200, `${route} → ${JSON.stringify(json)}`);
  return json;
}
const finds = () => h.store.list(`offices/${OFFICE_A}/scoutOpportunities`);
const alerts = () => h.store.list(`offices/${OFFICE_A}/notifications`).filter((n) => n.type === "SCOUT_OPPORTUNITY");
const health = () => JSON.parse(h.store.get("_system/scoutSchedule")?.healthJson || "{}");
const schedule = () => JSON.parse(h.store.get("_system/scoutSchedule")?.entriesJson || "{}");
function makeDue() {
  const entries = schedule();
  for (const entry of Object.values(entries[OFFICE_A]?.t || {})) entry.n = 1;
  if (entries[OFFICE_A]) entries[OFFICE_A].l = 0;
  h.store.patch("_system/scoutSchedule", { entriesJson: JSON.stringify(entries) });
}
async function beat() {
  const pending = [];
  await h.worker.scheduled({ scheduledTime: Date.now() }, h.env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
}
let clock = Date.now();
function fixture(id, text, phone) {
  clock += 1000;
  h.store.seed(`offices/${OFFICE_A}/scoutFixtures/${id}`, { officeId: OFFICE_A, sourceTag: "one", externalId: id, text, phone, publishedAt: new Date().toISOString(), updatedAt: new Date(clock).toISOString() });
}
/** Every alert opens a find that exists, and no find has more than one alert for the same level. */
function assertOneAlertPerFind() {
  const ids = new Set(finds().map((f) => f.id));
  const notes = alerts();
  for (const n of notes) assert.ok(ids.has(n.entityId), `alert «${n.body}» opens ${n.route}, which does not exist`);
  const perFind = notes.map((n) => n.entityId);
  assert.equal(new Set(perFind).size, perFind.length, `one alert per find: ${JSON.stringify(notes.map((n) => [n.entityId, n.body]))}`);
}

test("setup: the scout on, an offer with no buyer in the office", async () => {
  await call("/os/scout/settings", { settings: { enabled: true, city: "المدينة المنورة" } });
  await call("/os/records/save", { requestKey: "interrupted-offer", record: { kind: "OFFER", purpose: "SALE", propertyType: "عمارة", city: "المدينة المنورة", district: "شوران", price: 3_000_000, contactName: "مالك", contactPhone: "0557100001" } });
});

test("a round cut off after its alert and before saving its find → the next round saves the same find and does not alert again", async () => {
  fixture("buyer-cut", "مطلوب عمارة للشراء في حي شوران بحدود 3 مليون ريال كاش", "0559000111");
  refuseFindWrites = true;
  makeDue();
  await beat();
  refuseFindWrites = false;
  assert.equal(finds().length, 0, "the cut-off round saved no find");
  const first = alerts();
  assert.equal(first.length, 1, "it had already alerted");
  // The cron comes back to the office (its lease is over) and reads the same ad again.
  makeDue();
  await beat();
  const kept = finds().filter((f) => f.phone === "0559000111");
  assert.equal(kept.length, 1, "one find for the ad");
  assert.equal(alerts().length, 1, "still one alert");
  assert.equal(alerts()[0].entityId, kept[0].id, "the alert opens the saved find");
  assertOneAlertPerFind();
});

test("two rounds of the same office at once (a cron beat while another has not finished) → one find and one alert per ad", async () => {
  fixture("buyer-twice", "مطلوب عمارة للشراء بحي شوران الميزانية 3 مليون نقدًا والتواصل واتساب", "0559000333");
  makeDue();
  const roundsBefore = Number(health().rounds || 0);
  // Both beats read the schedule before either has claimed the office.
  await Promise.all([beat(), beat()]);
  assert.equal(Number(health().rounds || 0) - roundsBefore, 1, "only the beat that claimed the office worked on it");
  const kept = finds().filter((f) => f.phone === "0559000333");
  assert.equal(kept.length, 1, `one find, got ${kept.length}`);
  assert.equal(alerts().filter((n) => n.entityId === kept[0].id).length, 1);
  assertOneAlertPerFind();
});
