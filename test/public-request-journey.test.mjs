/**
 * «أرسل طلبي للمكتب العقاري» and «لدي عقار وأريد عرضه» end to end on the Worker: the intake the page saves becomes
 * the office's own request or offer (record, contact, opportunity), in that office only, once, and an offer from the
 * public link is never published by itself.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { startOfficeOsHarness, OFFICE_A, OFFICE_B } from "../scripts/qa/office-os/server.mjs";

const h = await startOfficeOsHarness();
test.after(() => h.server.close());
async function call(route, body) {
  const r = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
  return { status: r.status, body: await r.json() };
}
const request = {
  officeId: OFFICE_A, kind: "client", submitterRole: "CLIENT", submitterCapacity: "BUYER", name: "ريم الحربي", phone: "0557000444",
  contactPreference: "call", propertyType: "شقة", district: "الملقا", city: "الرياض", purpose: "PURCHASE", transactionType: "sale",
  amount: 550000, area: 0, rooms: 4, details: "مطلوب شقة تمليك في حي الملقا بالرياض ميزانيتي 550 ألف 4 غرف",
  searchReferences: [`${OFFICE_A}:pub-1`, "not a reference"], searchResultCount: 1, mediaPaths: [], imageCount: 0, hasVideo: false,
  source: "office_public_link", fillMethod: "GUEST_SEARCH", consentProcessing: true, consentWhatsapp: false,
  publicReference: "IQ-GUESTREQ", status: "new", createdAt: new Date().toISOString(), consentAt: new Date().toISOString()
};

test("a sent search request becomes the office's own request, with the client's channel, reference and words", async () => {
  h.store.seed(`offices/${OFFICE_A}/publicIntake/guestreq0001`, request);
  const r = await call("/pipeline/public-intake", { officeId: OFFICE_A, intakeId: "guestreq0001" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.kind, "client_request");
  const opportunity = h.store.get(`offices/${OFFICE_A}/opportunities/${r.body.opportunityId}`);
  assert.equal(opportunity.opportunityKind, "REQUEST");
  assert.equal(opportunity.officeId, OFFICE_A);
  assert.equal(opportunity.contactName, "ريم الحربي");
  assert.match(String(opportunity.contactPhone), /557000444$/);
  assert.equal(opportunity.contactPreference, "call");
  assert.equal(opportunity.publicReference, "IQ-GUESTREQ");
  assert.equal(opportunity.fillMethod, "GUEST_SEARCH");
  assert.deepEqual(JSON.parse(opportunity.guestSearchReferencesJson), [`${OFFICE_A}:pub-1`], "only well-formed references are kept");
  assert.equal(opportunity.assignedOfficeId, OFFICE_A, "assigned to the office of the link");
  assert.ok(h.store.get(`offices/${OFFICE_A}/clients/${r.body.recordId}`), "a client record in the office");
  assert.ok(h.store.get(`offices/${OFFICE_A}/contacts/966557000444`) || h.store.get(`offices/${OFFICE_A}/contacts/0557000444`) || h.store.list(`offices/${OFFICE_A}/contacts`).length, "a contact in the office");
  assert.equal(h.store.get(`offices/${OFFICE_A}/publicIntake/guestreq0001`).status, "processed");
  assert.equal(h.store.list(`offices/${OFFICE_B}/opportunities`).some((row) => row.publicReference === "IQ-GUESTREQ"), false, "never in another office");
});

test("pressing send again never creates a second request", async () => {
  const again = await call("/pipeline/public-intake", { officeId: OFFICE_A, intakeId: "guestreq0001" });
  assert.equal(again.body.duplicate, true);
  // A second intake for the same client and the same request is linked to the first one.
  h.store.seed(`offices/${OFFICE_A}/publicIntake/guestreq0002`, { ...request, publicReference: "IQ-GUESTRE2" });
  const second = await call("/pipeline/public-intake", { officeId: OFFICE_A, intakeId: "guestreq0002" });
  assert.equal(second.body.duplicate, true, JSON.stringify(second.body));
  assert.equal(h.store.list(`offices/${OFFICE_A}/opportunities`).filter((row) => row.contactPreference === "call" && /557000444$/.test(String(row.contactPhone))).length, 1);
});

test("an intake cannot be processed for another office through the link", async () => {
  h.store.seed(`offices/${OFFICE_A}/publicIntake/guestreq0003`, { ...request, phone: "0557000555", publicReference: "IQ-GUESTRE3" });
  const r = await call("/pipeline/public-intake", { officeId: OFFICE_B, intakeId: "guestreq0003" });
  assert.ok([403, 404].includes(r.status), JSON.stringify(r.body));
});

test("an owner's offer from the public link is saved for review and is not published", async () => {
  h.store.seed(`offices/${OFFICE_A}/publicIntake/owneroffer01`, {
    officeId: OFFICE_A, kind: "owner", submitterRole: "OWNER", submitterCapacity: "OWNER", name: "فهد العتيبي", phone: "0557000666",
    propertyType: "فيلا", district: "النرجس", city: "الرياض", purpose: "SALE", transactionType: "sale", amount: 2100000, area: 400, rooms: 5,
    details: "فيلا درج داخلي", mediaPaths: [], imageCount: 0, hasVideo: false, source: "office_public_link", consentProcessing: true,
    consentWhatsapp: false, publicReference: "IQ-OWNEROFF", status: "new"
  });
  const r = await call("/pipeline/public-intake", { officeId: OFFICE_A, intakeId: "owneroffer01" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const offer = h.store.get(`offices/${OFFICE_A}/opportunities/${r.body.opportunityId}`);
  assert.equal(offer.opportunityKind, "OFFER");
  assert.notEqual(offer.publicSearchVisible, true, "not shown to the public before the office publishes it");
  assert.notEqual(offer.lifecycleStatus, "ACTIVE", "waits for the office");
  assert.equal(offer.publicReference, "IQ-OWNEROFF");
  assert.equal(offer.submitterCapacity, "OWNER", "the capacity the person chose, kept as chosen");
  const search = await call("/os/public/search", { officeId: OFFICE_A, scope: "office", requestKey: "owner-offer-not-public-01", criteria: { purpose: "PURCHASE", propertyType: "فيلا", city: "الرياض", district: "النرجس", price: 2500000 } });
  assert.equal(search.status, 200, JSON.stringify(search.body));
  assert.equal(search.body.results.length, 0, "a guest search never shows an unreviewed offer");
});

test("guest search reads the request with the free rules only, even when the Worker holds a Gemini key", async () => {
  const external = [], original = globalThis.fetch;
  globalThis.fetch = async (url, init) => { if (!String(url).startsWith("https://worker.test")) external.push(String(url)); return original(url, init); };
  const previous = h.env.GEMINI_API_KEY;
  h.env.GEMINI_API_KEY = "present-but-never-used";
  try {
    const r = await call("/os/public/search/analyze", { officeId: OFFICE_A, text: "أبحث عن شقة تمليك في حي الملقا بالرياض أربع غرف بحدود 500 ألف ريال" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.aiStatus, "not_used");
    assert.equal(r.body.listings[0].propertyType, "شقة");
    assert.equal(r.body.listings[0].price, 500000);
    assert.deepEqual(external.filter((u) => /generativelanguage|googleapis\.com\/v1beta|anthropic|openai/.test(u)), [], "no paid AI request");
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete h.env.GEMINI_API_KEY; else h.env.GEMINI_API_KEY = previous;
  }
});
