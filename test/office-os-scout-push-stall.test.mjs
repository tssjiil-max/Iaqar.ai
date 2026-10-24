// «الباحث عن الفرص» — a push that never answers must not stop the round.
// Staging deploy run 40115226870: the cron round wrote its alerts (push state left «QUEUED»), then never saved its
// finds nor recorded its beat (lastWorkAt unchanged for 40 minutes); every next beat did the same again.
// Here the alert's push path hangs — the icon probe and the FCM send never answer — and the round must still:
// save its finds, record the beat, alert once per find, and say honestly what happened to the push.
// Through the real Worker on the in-memory Firestore double (scripts/qa/office-os/server.mjs). No site is contacted.
import test from "node:test";
import assert from "node:assert/strict";
import { startOfficeOsHarness, idTokenFor, OFFICE_A, OWNER_A } from "../scripts/qa/office-os/server.mjs";

const h = await startOfficeOsHarness();
test.after(() => h.server.close());
h.store.patch(`offices/${OFFICE_A}`, { city: "المدينة المنورة", isTestFixture: true });

// The push path's outside calls never answer unless they are aborted (as a stuck connection behaves).
const hung = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (/\/icons\/[^/?]+\.png|\/media\/public\/office-covers\/|fcm\.googleapis\.com/.test(url)) {
    hung.push(url);
    return new Promise((_, reject) => {
      const signal = init.signal || (input instanceof Request ? input.signal : null);
      signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  }
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
const scheduleDoc = () => h.store.get("_system/scoutSchedule") || {};
const health = () => JSON.parse(scheduleDoc().healthJson || "{}");
function makeDue() {
  const entries = JSON.parse(scheduleDoc().entriesJson || "{}");
  for (const entry of Object.values(entries[OFFICE_A]?.t || {})) entry.n = 1;
  if (entries[OFFICE_A]) entries[OFFICE_A].l = 0;
  h.store.patch("_system/scoutSchedule", { entriesJson: JSON.stringify(entries) });
}
/** One cron beat of the real Worker, or a failure if it has not finished within `ms`. */
async function beatWithin(ms) {
  const pending = [];
  await h.worker.scheduled({ scheduledTime: Date.now() }, h.env, { waitUntil: (p) => pending.push(p) });
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`the cron beat had not finished after ${ms} ms (hung on: ${[...new Set(hung)].join(", ")})`)), ms); });
  try { await Promise.race([Promise.all(pending), deadline]); } finally { clearTimeout(timer); }
}

test("setup: the scout on, an offer with no buyer, and a device registered for the office", async () => {
  await call("/os/scout/settings", { settings: { enabled: true, city: "المدينة المنورة" } });
  await call("/os/records/save", { requestKey: "stall-offer", record: { kind: "OFFER", purpose: "SALE", propertyType: "عمارة", city: "المدينة المنورة", district: "شوران", price: 3_000_000, contactName: "مالك", contactPhone: "0557100001" } });
  h.store.seed(`offices/${OFFICE_A}/devices/stall-device`, { enabled: true, fcmToken: "stall-test-token", registrationType: "token", userUid: OWNER_A });
  h.store.seed(`offices/${OFFICE_A}/scoutFixtures/buyer-stall`, { officeId: OFFICE_A, sourceTag: "one", externalId: "buyer-stall", text: "مطلوب عمارة للشراء في حي شوران بحدود 3 مليون ريال كاش", phone: "0559000111", publishedAt: new Date().toISOString(), updatedAt: new Date(Date.now() + 1000).toISOString() });
});

test("the alert's push hangs: the round still saves its find, records the beat, alerts once, and says the push failed", async () => {
  const before = health().lastWorkAt || "";
  makeDue();
  await beatWithin(25_000);
  assert.ok(hung.length > 0, "the push path did reach the hanging calls");
  const kept = finds().filter((f) => f.phone === "0559000111");
  assert.equal(kept.length, 1, "the find was saved");
  assert.notEqual(health().lastWorkAt || "", before, "the beat was recorded");
  const notes = alerts().filter((n) => n.entityId === kept[0].id);
  assert.equal(notes.length, 1, "one alert for the find");
  const push = JSON.parse(notes[0].providerStateJson || "{}").push;
  assert.notEqual(push, "QUEUED", "the push outcome is recorded, not left as queued");
  // The next beat finds nothing new to say: no second alert.
  makeDue();
  await beatWithin(25_000);
  assert.equal(alerts().filter((n) => n.entityId === kept[0].id).length, 1, "still one alert");
});
