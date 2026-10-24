// Automatic matching must look at every record of the office, not at the first page of its collection.
// Before this fix the save path read one page of 60 documents (by document id): an office with 61 records or more
// silently missed a qualifying counterpart whose id sorted after the 60th — the save answered «0 matches».
// Through the real Worker on the in-memory Firestore double (scripts/qa/office-os/server.mjs), which pages like
// Firestore: `pageSize` documents per answer and a `nextPageToken` while more remain.
import test from "node:test";
import assert from "node:assert/strict";
import { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B } from "../scripts/qa/office-os/server.mjs";

const h = await startOfficeOsHarness();
test.after(() => h.server.close());

const NOW = new Date().toISOString();
const base = (officeId) => ({ officeId, lifecycleStatus: "ACTIVE", status: "active", matchingReadiness: "READY_FOR_MATCHING", dataCompleteness: 100, city: "المدينة المنورة", version: 1, createdAt: NOW, updatedAt: NOW });
let phone = 0;
const nextPhone = () => `0501${String(++phone).padStart(6, "0")}`;

/** Offers that can never pair with anything these tests save (another type and district, another operation). */
function seedUnrelated(officeId, count, prefix = "opp_a") {
  for (let i = 0; i < count; i += 1) {
    h.store.seed(`offices/${officeId}/opportunities/${prefix}${String(i).padStart(4, "0")}`, {
      ...base(officeId), opportunityKind: "OFFER", purpose: "RENT", district: "الحرة الشرقية", propertyType: "مستودع", rentPrice: 40_000, priceOrBudget: 40_000, contactPhone: nextPhone()
    });
  }
}
const countIn = (officeId) => h.store.list(`offices/${officeId}/opportunities`).length;

async function call(route, body, owner = OWNER_A, officeId = OFFICE_A) {
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${idTokenFor(owner)}` }, body: JSON.stringify({ officeId, ...body })
  }), h.env, { waitUntil() {} });
  const json = await response.json();
  assert.equal(response.status, 200, `${route} → ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}
const saveOffer = (fields, owner, officeId) => call("/os/records/save", { requestKey: `offer-${nextPhone()}`, record: { kind: "OFFER", purpose: "SALE", city: "المدينة المنورة", contactName: "مالك", contactPhone: nextPhone(), ...fields } }, owner, officeId);
const currentMatchesFor = (officeId, recordId) => h.store.list(`offices/${officeId}/matches`)
  .filter((m) => m.isCurrent !== false && [m.requestId, m.clientRequestId, m.offerId, m.ownerOfferId, m.opportunityId, m.counterpartOpportunityId].includes(recordId));

// Each scale uses its own property type and district, so earlier scales never pair with later ones; the qualifying
// request is seeded with the id that sorts after every other record (the worst place for a one-page read).
for (const [index, { total, type, district }] of [
  { total: 61, type: "شقة", district: "العزيزية" },
  { total: 300, type: "فيلا", district: "شوران" },
  { total: 1000, type: "دور", district: "قباء" }
].entries()) {
  test(`${total} records: the qualifying request whose id sorts last is matched when an offer is saved`, async () => {
    const requestId = `opp_zz${index}_request`;
    seedUnrelated(OFFICE_A, total - countIn(OFFICE_A) - 2, `opp_a${index}_`);
    h.store.seed(`offices/${OFFICE_A}/opportunities/${requestId}`, {
      ...base(OFFICE_A), opportunityKind: "REQUEST", purpose: "PURCHASE", advertiserRole: "CLIENT", district, propertyType: type,
      budget: 900_000, priceOrBudget: 900_000, priceMax: 900_000, contactPhone: nextPhone(), contactName: "عميل"
    });
    assert.equal(countIn(OFFICE_A), total - 1, "the office holds the records of this scale before the save");
    const saved = await saveOffer({ propertyType: type, district, price: 880_000 });
    assert.equal(countIn(OFFICE_A), total);
    assert.equal(saved.matchingPending, false);
    assert.ok(saved.matches >= 1, `the save found the request (answered ${saved.matches} matches)`);
    assert.equal(currentMatchesFor(OFFICE_A, requestId).length, 1, "one current match for the request");
    assert.equal(saved.matchingComplete, true, "every record was looked at");
    assert.equal(saved.matchingScanned, total, "the scan covered the whole office");
  });
}

test("the other direction: a saved request finds the qualifying offer whose id sorts last (61+ records)", async () => {
  h.store.seed(`offices/${OFFICE_A}/opportunities/opp_zz9_offer`, {
    ...base(OFFICE_A), opportunityKind: "OFFER", purpose: "SALE", advertiserRole: "OWNER", district: "العوالي", propertyType: "عمارة",
    salePrice: 3_000_000, priceOrBudget: 3_000_000, contactPhone: nextPhone(), contactName: "مالك"
  });
  const saved = await call("/os/records/save", { requestKey: "request-reverse", record: { kind: "REQUEST", purpose: "PURCHASE", city: "المدينة المنورة", district: "العوالي", propertyType: "عمارة", price: 3_100_000, contactName: "عميل", contactPhone: nextPhone() } });
  assert.ok(saved.matches >= 1, `answered ${saved.matches} matches`);
  assert.equal(currentMatchesFor(OFFICE_A, "opp_zz9_offer").length, 1);
});

test("manual search («بحث عن مطابقة») lists the qualifying counterpart past the 300th record", async () => {
  // The office now holds 1000+ records; the request of the 1000 scale sorts after all of them.
  const offer = h.store.list(`offices/${OFFICE_A}/opportunities`).find((r) => r.propertyType === "دور" && r.opportunityKind !== "REQUEST" && r.id.startsWith("opp_os_"));
  assert.ok(offer, "the offer saved at the 1000 scale");
  const found = await call("/os/records/candidates", { recordId: offer.id });
  assert.ok(found.candidates.some((c) => c.recordId === "opp_zz2_request"), "the request is a candidate");
  assert.equal(found.matchingComplete, true);
});

test("a record that stops being active supersedes its current match even when the office has more than 60 matches", async () => {
  // Matches of other pairs whose ids sort before every real match id.
  for (let i = 0; i < 70; i += 1) h.store.seed(`offices/${OFFICE_A}/matches/mat_000000000${String(i).padStart(3, "0")}`, { officeId: OFFICE_A, requestId: `opp_other_${i}`, offerId: `opp_other_o${i}`, isCurrent: true, status: "new" });
  assert.equal(currentMatchesFor(OFFICE_A, "opp_zz0_request").length, 1, "the 61-scale request has its current match");
  await call("/os/records/archive", { recordId: "opp_zz0_request", reason: "test" });
  assert.equal(currentMatchesFor(OFFICE_A, "opp_zz0_request").length, 0, "its match is no longer current");
});

test("when the scan cannot cover every record, the save says so (no silent partial matching)", async () => {
  h.env.MATCH_CANDIDATES_MAX_DOCS = "100";
  try {
    const saved = await saveOffer({ propertyType: "شقة", district: "العزيزية", price: 870_000 });
    assert.equal(saved.matchingComplete, false, "the answer says the scan was partial");
    assert.equal(saved.matchingScanned, 100);
    assert.match(String(saved.matchingNotice || ""), /لم يشمل/, "a notice the broker can read");
  } finally {
    delete h.env.MATCH_CANDIDATES_MAX_DOCS;
  }
});

test("an office under one page keeps exactly the matches and scores it had (the one-page reader as reference)", async () => {
  // Office B: 20 records, a request and two counterparts of different strength.
  seedUnrelated(OFFICE_B, 17, "opp_b_");
  h.store.seed(`offices/${OFFICE_B}/opportunities/opp_b_request`, { ...base(OFFICE_B), opportunityKind: "REQUEST", purpose: "PURCHASE", advertiserRole: "CLIENT", district: "العزيزية", propertyType: "شقة", budget: 900_000, priceOrBudget: 900_000, priceMax: 900_000, contactPhone: nextPhone(), contactName: "عميل" });
  h.store.seed(`offices/${OFFICE_B}/opportunities/opp_b_request2`, { ...base(OFFICE_B), opportunityKind: "REQUEST", purpose: "PURCHASE", advertiserRole: "CLIENT", district: "العزيزية", propertyType: "فيلا", budget: 1_000_000, priceOrBudget: 1_000_000, priceMax: 1_000_000, contactPhone: nextPhone(), contactName: "عميل" });
  const scored = (saved) => h.store.list(`offices/${OFFICE_B}/matches`).filter((m) => m.isCurrent !== false && (m.offerId === saved.recordId || m.ownerOfferId === saved.recordId || m.opportunityId === saved.recordId))
    .map((m) => ({ request: m.requestId, score: m.score, opportunityScore: m.opportunityScore, closingReadinessScore: m.closingReadinessScore, priority: m.priority }))
    .sort((a, b) => String(a.request).localeCompare(String(b.request)));
  h.env.MATCH_CANDIDATE_READER = "legacy";
  let legacy;
  try { legacy = scored(await saveOffer({ propertyType: "شقة", district: "العزيزية", price: 880_000 }, OWNER_B, OFFICE_B)); } finally { delete h.env.MATCH_CANDIDATE_READER; }
  const paged = scored(await saveOffer({ propertyType: "شقة", district: "العزيزية", price: 880_000 }, OWNER_B, OFFICE_B));
  assert.ok(legacy.length >= 1 && legacy.every((m) => Number.isFinite(m.score) && m.request), `the reference found scored matches: ${JSON.stringify(legacy)}`);
  assert.deepEqual(paged, legacy, "same counterparts, same scores, same level");
});

test("the scout's inventory sync reads every record and says when its summary cannot hold them all", async () => {
  // Office A now holds 1000+ open records; the scout keeps a summary of at most 300 (SCOUT_LIMITS.records).
  await call("/os/scout/settings", { settings: { enabled: true, city: "المدينة المنورة" } });
  const pending = [];
  await h.worker.scheduled({ scheduledTime: Date.now() }, h.env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  const inventory = JSON.parse(h.store.get(`offices/${OFFICE_A}/scoutState/main`)?.healthJson || "{}").inventory || {};
  assert.ok(inventory.open > 300, `the sync saw every open record (${inventory.open})`);
  assert.equal(inventory.kept, 300, "the summary keeps its size");
  assert.equal(inventory.complete, false, "and says it is partial");
});
