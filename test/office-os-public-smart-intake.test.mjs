// «رابط أو نص الإعلان» on the office's public page: one box for a link or an ad's text, the source link kept (never as
// proof of ownership), the person's capacity and consents stored, and matching right after the server-side save.
// Through the real Worker on the in-memory Firestore double; pretend sites only.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { splitLinkAndText } from "../worker/src/office-os/smart-fill-service.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const { startOfficeOsHarness, idTokenFor, OFFICE_A, OWNER_A } = await import(path.join(ROOT, "scripts/qa/office-os/server.mjs"));
const h = await startOfficeOsHarness();
test.after(() => h.server.close());

const siteCalls = [];
const doubleFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (/aqar\.fm$|haraj\.com\.sa$|\.example\.sa$/.test(url.hostname)) {
    siteCalls.push(`${url.hostname}${url.pathname}`);
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /", { status: 200, headers: { "content-type": "text/plain" } });
    if (url.hostname === "ads.example.sa" && url.pathname === "/ad/77") {
      return new Response('<html><head><title>شقة للإيجار في حي الملقا بالرياض</title><meta name="description" content="شقة 3 غرف للإيجار في الملقا الرياض الإيجار السنوي 65 الف ريال مساحة 140 متر"></head></html>', { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("not found", { status: 404 });
  }
  return doubleFetch(input, init);
};
test.after(() => { globalThis.fetch = doubleFetch; });

async function call(route, body = {}, uid = null) {
  const headers = { "content-type": "application/json" };
  if (uid) headers.authorization = `Bearer ${idTokenFor(uid)}`;
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: response.status, body: await response.json() };
}

test("one box: a link, an ad's text, or both — the link is cleaned and kept apart from the text", () => {
  assert.deepEqual(splitLinkAndText("https://sa.aqar.fm/ad/6639575?utm_source=x"), { link: "https://sa.aqar.fm/ad/6639575", invalidLink: false, rest: "" });
  assert.deepEqual(splitLinkAndText("عمارة للبيع 360 متر بمليون https://sa.aqar.fm/ad/1"), { link: "https://sa.aqar.fm/ad/1", invalidLink: false, rest: "عمارة للبيع 360 متر بمليون" });
  assert.equal(splitLinkAndText("http://example.com/x").invalidLink, true);
  assert.deepEqual(splitLinkAndText("مطلوب شقة للإيجار في الملقا"), { link: "", invalidLink: false, rest: "مطلوب شقة للإيجار في الملقا" });
});

test("a link to a site whose terms forbid reading it is not fetched — the visitor is asked for the text in the same box", async () => {
  const r = await call("/os/public/smart-fill", { officeId: OFFICE_A, text: "https://sa.aqar.fm/ad/6639575" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.needsText, true);
  assert.match(r.body.message, /في الخانة نفسها/);
  assert.equal(r.body.sourceUrl, "https://sa.aqar.fm/ad/6639575");
  assert.deepEqual(siteCalls, [], "nothing was fetched from the listing platform");
});

test("the same link with the ad's text: the text is understood and the link kept as its source", async () => {
  const r = await call("/os/public/smart-fill", { officeId: OFFICE_A, text: "للبيع شقة في حي الملقا بالرياض 3 غرف مساحة 120 متر السعر مليون و250 الف https://sa.aqar.fm/ad/6639575?utm_source=wa" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sourceUrl, "https://sa.aqar.fm/ad/6639575");
  const listing = r.body.listings[0];
  assert.equal(listing.kind, "OFFER");
  assert.equal(listing.purpose, "SALE");
  assert.equal(listing.propertyType, "شقة");
  assert.equal(listing.price, 1250000);
  assert.deepEqual(siteCalls, []);
});

test("a link to a site that allows it is read once (robots.txt first) and understood; a bad link asks for the text", async () => {
  const r = await call("/os/public/smart-fill", { officeId: OFFICE_A, text: "https://ads.example.sa/ad/77" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.readFrom, "page");
  assert.equal(r.body.listings[0].purpose, "RENT");
  assert.equal(r.body.listings[0].price, 65000);
  assert.deepEqual(siteCalls, ["ads.example.sa/robots.txt", "ads.example.sa/ad/77"]);
  const bad = await call("/os/public/smart-fill", { officeId: OFFICE_A, text: "http://ads.example.sa/ad/77" });
  assert.equal(bad.body.needsText, true);
});

test("the server save keeps the source link (unverified), the capacity and both consents; matching runs right after", async () => {
  const request = await call("/os/records/save", {
    officeId: OFFICE_A, requestKey: "smart-req-1",
    record: { kind: "REQUEST", purpose: "LEASE_REQUEST", propertyType: "شقة", city: "الرياض", district: "الملقا", price: "70,000", contactName: "سعد العتيبي", contactPhone: "0551230001" }
  }, OWNER_A);
  assert.ok([200].includes(request.status), JSON.stringify(request.body));
  h.store.seed(`offices/${OFFICE_A}/publicIntake/smartintake01`, {
    officeId: OFFICE_A, kind: "owner", submitterRole: "OWNER", submitterCapacity: "OWNER", name: "فهد القحطاني", phone: "0557000111", propertyType: "شقة", district: "الملقا", city: "الرياض",
    purpose: "RENT", transactionType: "rent", amount: 65000, area: 140, rooms: 3, details: "شقة 3 غرف", mediaPaths: [], imageCount: 0, hasVideo: false,
    source: "office_public_link", fillMethod: "SMART_FILL", sourceUrl: "https://ads.example.sa/ad/77", consentProcessing: true, consentWhatsapp: true, consentAt: new Date().toISOString(), status: "new"
  });
  const r = await call("/pipeline/public-intake", { officeId: OFFICE_A, intakeId: "smartintake01" });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
  const record = h.store.get(`offices/${OFFICE_A}/opportunities/${r.body.opportunityId}`);
  assert.equal(record.sourceUrl, "https://ads.example.sa/ad/77");
  assert.equal(record.sourceHost, "ads.example.sa");
  assert.equal(record.sourceUrlVerified, false, "a link is never proof of ownership");
  assert.equal(record.submitterCapacity, "OWNER");
  assert.equal(record.consentProcessing, true);
  assert.equal(record.consentWhatsapp, true);
  assert.equal(record.officeId, OFFICE_A);
  assert.ok(Number(r.body.matches) >= 1, `the office's open request matches at once (${r.body.matches})`);
  const replay = await call("/pipeline/public-intake", { officeId: OFFICE_A, intakeId: "smartintake01" });
  assert.equal(replay.body.duplicate, true, "a retry never creates a second record");
});

test("an ad relayed by someone who is not the owner waits for the broker before active matching", async () => {
  h.store.seed(`offices/${OFFICE_A}/publicIntake/smartintake02`, {
    officeId: OFFICE_A, kind: "owner", submitterRole: "OWNER", submitterCapacity: "AD_RELAY", name: "ناقل الإعلان", phone: "0557000222", propertyType: "شقة", district: "الملقا", city: "الرياض",
    purpose: "RENT", transactionType: "rent", amount: 66000, area: 140, rooms: 3, details: "إعلان منقول", mediaPaths: [], imageCount: 0, hasVideo: false,
    source: "office_public_link", fillMethod: "SMART_FILL", sourceUrl: "https://ads.example.sa/ad/78", consentProcessing: true, consentWhatsapp: false, status: "new"
  });
  const r = await call("/pipeline/public-intake", { officeId: OFFICE_A, intakeId: "smartintake02" });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
  const record = h.store.get(`offices/${OFFICE_A}/opportunities/${r.body.opportunityId}`);
  assert.equal(record.submitterCapacity, "AD_RELAY");
  assert.equal(record.matchingReadiness, "NEEDS_COMPLETION");
  assert.equal(record.consentWhatsapp, false);
});
