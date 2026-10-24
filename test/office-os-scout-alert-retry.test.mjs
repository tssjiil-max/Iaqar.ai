// «الباحث عن الفرص» — a push nobody answered is tried again on a later round, for the same alert, a bounded number
// of times; a push the provider refused is not. The find and the in-app alert never wait for the phone.
// Through the real Worker on the in-memory Firestore double (scripts/qa/office-os/server.mjs). No site is contacted.
import test from "node:test";
import assert from "node:assert/strict";
import { startOfficeOsHarness, idTokenFor, OFFICE_A, OWNER_A } from "../scripts/qa/office-os/server.mjs";

const h = await startOfficeOsHarness();
test.after(() => h.server.close());
h.store.patch(`offices/${OFFICE_A}`, { city: "المدينة المنورة", isTestFixture: true });

// FCM: "hang" (never answers unless aborted), "ok", or "reject" (the provider refuses the token).
let fcm = "hang";
const sends = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  if (/\/icons\/[^/?]+\.png|\/media\/public\/office-covers\//.test(url)) return new Response("", { status: 200, headers: { "content-type": "image/png" } });
  if (/fcm\.googleapis\.com/.test(url)) {
    sends.push(fcm);
    if (fcm === "ok") return new Response(JSON.stringify({ name: "projects/x/messages/1" }), { status: 200, headers: { "content-type": "application/json" } });
    if (fcm === "reject") return new Response(JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }), { status: 404, headers: { "content-type": "application/json" } });
    return new Promise((_, reject) => { init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))); });
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
const alertsFor = (findId) => h.store.list(`offices/${OFFICE_A}/notifications`).filter((n) => n.type === "SCOUT_OPPORTUNITY" && n.entityId === findId);
const pushOf = (n) => JSON.parse(n.providerStateJson || "{}");
const outbox = () => JSON.parse(h.store.get(`offices/${OFFICE_A}/scoutState/main`)?.outboxJson || "[]");
function makeDue() {
  const entries = JSON.parse(h.store.get("_system/scoutSchedule")?.entriesJson || "{}");
  for (const entry of Object.values(entries[OFFICE_A]?.t || {})) entry.n = 1;
  if (entries[OFFICE_A]) entries[OFFICE_A].l = 0;
  h.store.patch("_system/scoutSchedule", { entriesJson: JSON.stringify(entries) });
}
async function beat() {
  makeDue();
  const pending = [];
  await h.worker.scheduled({ scheduledTime: Date.now() }, h.env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
}
let clock = Date.now();
function ad(id, phone) {
  clock += 1000;
  h.store.seed(`offices/${OFFICE_A}/scoutFixtures/${id}`, { officeId: OFFICE_A, sourceTag: "one", externalId: id, text: "مطلوب عمارة للشراء في حي شوران بحدود 3 مليون ريال كاش", phone, publishedAt: new Date().toISOString(), updatedAt: new Date(clock).toISOString() });
}

test("setup: the scout on, an offer with no buyer, a device registered", async () => {
  await call("/os/scout/settings", { settings: { enabled: true, city: "المدينة المنورة" } });
  await call("/os/records/save", { requestKey: "retry-offer", record: { kind: "OFFER", purpose: "SALE", propertyType: "عمارة", city: "المدينة المنورة", district: "شوران", price: 3_000_000, contactName: "مالك", contactPhone: "0557100001" } });
  h.store.seed(`offices/${OFFICE_A}/devices/retry-device`, { enabled: true, fcmToken: "retry-test-token", registrationType: "token", userUid: OWNER_A });
});

test("the push is not answered: find and alert are saved, the push is FAILED and owed; the next round sends it once for the same alert", async () => {
  ad("buyer-retry", "0559000555");
  fcm = "hang";
  await beat();
  const [find] = finds().filter((f) => f.phone === "0559000555");
  assert.ok(find, "the find was saved");
  assert.equal(alertsFor(find.id).length, 1, "the in-app alert is there");
  assert.equal(pushOf(alertsFor(find.id)[0]).push, "FAILED", "a send nobody answered is FAILED, not refused");
  assert.equal(outbox().filter((i) => i.findId === find.id).length, 1, "its push is still owed");
  fcm = "ok";
  const before = sends.length;
  await beat();
  assert.equal(alertsFor(find.id).length, 1, "still one alert");
  assert.deepEqual([pushOf(alertsFor(find.id)[0]).push, pushOf(alertsFor(find.id)[0]).attempt], ["ACCEPTED_BY_PROVIDER", 2], "the owed push went through on the second try");
  assert.equal(sends.length - before, 1, "sent once");
  assert.equal(outbox().filter((i) => i.findId === find.id).length, 0, "nothing owed any more");
  await beat();
  assert.equal(sends.length - before, 1, "not sent again on a later round");
});

test("the provider refuses the device: recorded once, not tried again", async () => {
  ad("buyer-refused", "0559000666");
  fcm = "reject";
  await beat();
  const [find] = finds().filter((f) => f.phone === "0559000666");
  assert.ok(find);
  assert.equal(pushOf(alertsFor(find.id)[0]).push, "PROVIDER_REJECTED");
  assert.equal(outbox().filter((i) => i.findId === find.id).length, 0, "nothing owed: trying again would fail again");
});

test("a push that keeps failing is tried a bounded number of times, then left as FAILED (the alert stays)", async () => {
  // The general mode sends at most two phone pushes per 6 hours, and the tests above used both: start a new window.
  const main = h.store.get(`offices/${OFFICE_A}/scoutState/main`);
  h.store.patch(`offices/${OFFICE_A}/scoutState/main`, { usageJson: JSON.stringify({ ...JSON.parse(main.usageJson || "{}"), pushAt: [] }) });
  // The refused device was dropped as stale; the office registers its phone again.
  h.store.seed(`offices/${OFFICE_A}/devices/retry-device`, { enabled: true, fcmToken: "retry-test-token-2", registrationType: "token", userUid: OWNER_A });
  ad("buyer-hopeless", "0559000777");
  fcm = "hang";
  for (let i = 0; i < 4; i += 1) await beat();
  const [find] = finds().filter((f) => f.phone === "0559000777");
  assert.ok(find);
  assert.equal(alertsFor(find.id).length, 1, "one alert, whatever happens to its push");
  const state = pushOf(alertsFor(find.id)[0]);
  assert.equal(state.push, "FAILED");
  assert.equal(state.attempt, 3, "three tries");
  assert.equal(outbox().filter((i) => i.findId === find.id).length, 0, "no longer owed");
});
