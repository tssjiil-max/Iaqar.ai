// The matching index (PR-4): candidates are retrieved by `matchKey` instead of scanning the office, with the SAME
// matches and scores as the engine over every record. Through the real Worker on the in-memory Firestore double,
// which answers `matchKey IN […]` queries and counts, and bills reads the way Firestore does.
//
// Reference: the engine itself (counterpartsEligible + scoreMatch, ranked like the save path) over EVERY record of the
// office, computed in the test — not the Worker's scan, which stops at its ceiling.
import test from "node:test";
import assert from "node:assert/strict";
import { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B } from "../scripts/qa/office-os/server.mjs";
import { MATCH_THRESHOLD, MAX_MATCH_RESULTS, counterpartsEligible, opportunityToMatchInput, scoreMatch } from "../worker/src/matching-engine.js";
import { MATCH_KEY_VERSION, matchKeyUpdate, matchKeysOf } from "../worker/src/match-index.js";

const h = await startOfficeOsHarness();
test.after(() => h.server.close());

// ---- a realistic office: offers and requests, sale and rent, several cities (one spelt two ways), legacy records
let seed = 11;
const rand = (n) => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n); };
const pick = (list) => list[rand(list.length)];
const DISTRICTS = ["العزيزية", "شوران", "قباء", "العوالي", "الخالدية", "السلام", "الجرف", "الرانوناء"];
const TYPES = ["شقة", "فيلا", "دور", "أرض", "عمارة"];
const CITIES = ["المدينة المنورة", "المدينة المنورة", "المدينة المنورة", "المدينه المنوره", "الرياض", "مكة المكرمة"];
let phone = 0;
const nextPhone = () => `050${String(++phone).padStart(7, "0")}`;
const NOW = new Date().toISOString();
function randomRecord(officeId, { legacy = rand(10) === 0 } = {}) {
  const offer = rand(2) === 0;
  const rent = rand(5) < 2;
  const price = rent ? 20_000 + rand(60) * 1_000 : 500_000 + rand(40) * 50_000;
  const common = { officeId, lifecycleStatus: "ACTIVE", status: "active", dataCompleteness: 100, version: 1, createdAt: NOW, updatedAt: NOW, district: pick(DISTRICTS), propertyType: pick(TYPES), contactPhone: nextPhone(), contactName: "طرف" };
  if (legacy) return { ...common, kind: offer ? "owner" : "client", transactionType: rent ? "rent" : "sale", city: rand(3) ? pick(CITIES) : "", price, area: 100 + rand(400) };
  return {
    ...common, opportunityKind: offer ? "OFFER" : "REQUEST", purpose: offer ? (rent ? "RENT" : "SALE") : (rent ? "LEASE_REQUEST" : "PURCHASE"),
    advertiserRole: offer ? "OWNER" : "CLIENT", matchingReadiness: "READY_FOR_MATCHING", city: pick(CITIES), priceOrBudget: price,
    ...(offer ? (rent ? { annualRent: price } : { salePrice: price }) : { budget: price, priceMax: price }), area: 100 + rand(400), rooms: rand(6)
  };
}
let serial = 0;
function seedOffice(officeId, count, { indexed = true } = {}) {
  for (let i = 0; i < count; i += 1) {
    const id = `opp_r${String(++serial).padStart(6, "0")}`;
    const record = randomRecord(officeId);
    h.store.seed(`offices/${officeId}/opportunities/${id}`, indexed ? { ...record, ...matchKeysOf(record) } : record);
  }
}

/** The engine over every record of the office, ranked like the save path: the counterparts a save must pair. */
function reference(officeId, sourceId) {
  const rows = h.store.list(`offices/${officeId}/opportunities`);
  const source = rows.find((r) => r.id === sourceId);
  const input = opportunityToMatchInput(source, { id: sourceId });
  const prepared = [];
  for (const row of rows) {
    if (row.id === sourceId || !counterpartsEligible(source, row)) continue;
    const scored = scoreMatch(input, opportunityToMatchInput(row, { id: row.id }));
    if (scored.eligible && scored.score >= MATCH_THRESHOLD) prepared.push({ id: row.id, score: scored.score, rank: scored.opportunityScore });
  }
  prepared.sort((a, b) => b.rank - a.rank || b.score - a.score);
  return prepared.slice(0, MAX_MATCH_RESULTS).map(({ id, score }) => ({ id, score })).sort((a, b) => a.id.localeCompare(b.id));
}
const matchedBy = (officeId, recordId) => h.store.list(`offices/${officeId}/matches`)
  .filter((m) => m.isCurrent !== false && m.opportunityId === recordId)
  .map((m) => ({ id: m.counterpartOpportunityId, score: m.score })).sort((a, b) => a.id.localeCompare(b.id));

async function call(route, body, owner = OWNER_A, officeId = OFFICE_A) {
  const response = await h.worker.fetch(new Request(`https://worker.test${route}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${idTokenFor(owner)}` }, body: JSON.stringify({ officeId, ...body }) }), h.env, { waitUntil() {} });
  const json = await response.json();
  assert.equal(response.status, 200, `${route} → ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}
/** Saves a record that is likely to have counterparts (Madinah, a common type), through the office's normal path. */
function saveLikely(officeId = OFFICE_A, owner = OWNER_A) {
  const offer = rand(2) === 0;
  return call("/os/records/save", { requestKey: `idx-${nextPhone()}`, record: {
    kind: offer ? "OFFER" : "REQUEST", purpose: offer ? "SALE" : "PURCHASE", city: "المدينة المنورة", district: pick(DISTRICTS), propertyType: pick(TYPES),
    price: 500_000 + rand(40) * 50_000, contactName: "طرف", contactPhone: nextPhone()
  } }, owner, officeId);
}
const withFlags = async (flags, run) => {
  Object.assign(h.env, flags);
  try { return await run(); } finally { for (const key of Object.keys(flags)) delete h.env[key]; }
};
const ON = { MATCH_INDEX_RETRIEVAL: "on", MATCH_INDEX_OFFICES: "*" };
const readsOf = async (run) => { const before = { ...h.store.reads.byKind }; const at = h.store.reads.documents; const result = await run(); return { result, reads: h.store.reads.documents - at, byKind: Object.fromEntries(Object.entries(h.store.reads.byKind).map(([k, v]) => [k, v - (before[k] || 0)]).filter(([, v]) => v)) }; };

// ---- equivalence with the engine over the whole office, at each size

for (const total of [400, 1000, 4999, 10_000]) {
  test(`${total} records, index on: every save pairs exactly what the engine pairs over the whole office`, async () => {
    seedOffice(OFFICE_A, total - h.store.list(`offices/${OFFICE_A}/opportunities`).length);
    let compared = 0, withMatches = 0;
    await withFlags(ON, async () => {
      for (let i = 0; i < 6; i += 1) {
        const saved = await saveLikely();
        assert.equal(saved.matchingMode, "index", `the save used the index (${saved.matchingMode}, ${saved.matchingReason || ""})`);
        assert.equal(saved.matchingComplete, true);
        assert.deepEqual(matchedBy(OFFICE_A, saved.recordId), reference(OFFICE_A, saved.recordId), `save ${i}: the same counterparts and scores as the engine over every record`);
        compared += 1;
        if (saved.matches > 0) withMatches += 1;
      }
    });
    assert.equal(compared, 6);
    assert.ok(withMatches >= 2, `the saves found real matches (${withMatches}/6)`);
  });
}

test("reads per save: the index reads the narrowed candidates, the scan reads the office (10k+ records)", async () => {
  const office = h.store.list(`offices/${OFFICE_A}/opportunities`).length;
  const indexed = await withFlags(ON, () => readsOf(() => saveLikely()));
  const scanned = await readsOf(() => saveLikely());
  assert.equal(indexed.result.matchingMode, "index");
  assert.equal(scanned.result.matchingMode, "scan");
  // The save path also reads one page of the office for its duplicate check (records-service, before PR-4; PR-1b).
  assert.ok(indexed.byKind["query:opportunities"] > 0 && (indexed.byKind["list:opportunities"] || 0) <= 300, `the index save queried and did not scan the office: ${JSON.stringify(indexed.byKind)}`);
  assert.ok(scanned.byKind["list:opportunities"] >= 5000, `the scan listed the office up to its ceiling: ${JSON.stringify(scanned.byKind)}`);
  const office_reads = (r) => (r.byKind["query:opportunities"] || 0) + Math.max(0, (r.byKind["list:opportunities"] || 0) - 300) + (r.byKind["count:opportunities"] || 0);
  console.log(`[reads] office of ${office}: index ${office_reads(indexed)} record reads (${indexed.reads} in all), scan ${office_reads(scanned)} (${scanned.reads} in all)`);
  assert.ok(office_reads(indexed) * 5 < office_reads(scanned), `index ${office_reads(indexed)} record reads vs scan ${office_reads(scanned)}`);
});

// ---- the index can never hide a record

test("a record written without a key (an import, an old browser) sends matching back to a full scan, said in the answer, and is indexed after", async () => {
  // Office B: indexed records, then one that fits and has no key — as a browser or a script would leave it.
  seedOffice(OFFICE_B, 300);
  h.store.seed(`offices/${OFFICE_B}/opportunities/opp_zz_unkeyed`, { ...randomRecord(OFFICE_B, { legacy: false }), opportunityKind: "REQUEST", purpose: "PURCHASE", advertiserRole: "CLIENT", city: "المدينة المنورة", district: "الجرف", propertyType: "شقة", priceOrBudget: 900_000, budget: 900_000, priceMax: 900_000 });
  await withFlags(ON, async () => {
    const saved = await call("/os/records/save", { requestKey: "unkeyed-offer", record: { kind: "OFFER", purpose: "SALE", city: "المدينة المنورة", district: "الجرف", propertyType: "شقة", price: 880_000, contactName: "مالك", contactPhone: nextPhone() } }, OWNER_B, OFFICE_B);
    assert.equal(saved.matchingMode, "scan", "an incomplete index is not used");
    assert.equal(saved.matchingReason, "index_incomplete");
    assert.ok(matchedBy(OFFICE_B, saved.recordId).some((m) => m.id === "opp_zz_unkeyed"), "the unkeyed record is still matched");
    assert.equal(matchKeyUpdate(h.store.get(`offices/${OFFICE_B}/opportunities/opp_zz_unkeyed`)), null, "and it is indexed now (all its keys current)");
    const next = await saveLikely(OFFICE_B, OWNER_B);
    assert.equal(next.matchingMode, "index", "once complete, the index is used again");
  });
});

test("editing a record through the office (its city changes): its key follows the record, never stale", async () => {
  await withFlags(ON, async () => {
    const saved = await saveLikely(OFFICE_B, OWNER_B);
    const before = h.store.get(`offices/${OFFICE_B}/opportunities/${saved.recordId}`);
    assert.equal(matchKeyUpdate(before), null, "a record saved by the office is indexed at once");
    await call("/os/records/save", { recordId: saved.recordId, requestKey: "edit-city", record: { kind: before.opportunityKind === "OFFER" ? "OFFER" : "REQUEST", purpose: before.purpose, city: "الرياض", district: before.district, propertyType: before.propertyType, price: Number(before.priceOrBudget), contactName: "طرف", contactPhone: before.contactPhone } }, OWNER_B, OFFICE_B);
    const after = h.store.get(`offices/${OFFICE_B}/opportunities/${saved.recordId}`);
    assert.equal(after.city, "الرياض");
    assert.equal(matchKeyUpdate(after), null, "the keys are the edited record's");
    assert.notEqual(after.matchKey, before.matchKey);
  });
});

test("the index answering with an error: matching falls back to a full scan, says so, and stays exact", async () => {
  await withFlags(ON, async () => {
    h.store.faults.queries = true;
    try {
      const saved = await saveLikely(OFFICE_B, OWNER_B);
      assert.equal(saved.matchingMode, "scan");
      assert.equal(saved.matchingReason, "index_unavailable");
      assert.equal(saved.matchingComplete, true, "the scan itself covered the office");
      assert.deepEqual(matchedBy(OFFICE_B, saved.recordId), reference(OFFICE_B, saved.recordId));
    } finally {
      h.store.faults.queries = false;
    }
  });
});

test("shadow mode: the scan decides, the index is compared with it, and a disagreement is reported", async () => {
  await withFlags({ MATCH_INDEX_RETRIEVAL: "shadow", MATCH_INDEX_OFFICES: "*" }, async () => {
    const same = await saveLikely(OFFICE_B, OWNER_B);
    assert.equal(same.matchingMode, "scan");
    assert.equal(same.matchingShadow, "same");
    // A record whose stored key is wrong (written around every guard, as only a broken migration could).
    const wrong = h.store.list(`offices/${OFFICE_B}/opportunities`).find((r) => r.opportunityKind === "REQUEST" && r.purpose === "PURCHASE" && r.city === "المدينة المنورة" && r.matchKey);
    h.store.patch(`offices/${OFFICE_B}/opportunities/${wrong.id}`, { matchKey: `${MATCH_KEY_VERSION}|x`, matchKeyDistrict: `${MATCH_KEY_VERSION}|x`, matchKeyType: `${MATCH_KEY_VERSION}|x` });
    const saved = await call("/os/records/save", { requestKey: "shadow-offer", record: { kind: "OFFER", purpose: "SALE", city: "المدينة المنورة", district: wrong.district, propertyType: wrong.propertyType, price: Number(wrong.priceOrBudget || wrong.price), contactName: "مالك", contactPhone: nextPhone() } }, OWNER_B, OFFICE_B);
    assert.equal(saved.matchingMode, "scan", "the scan's answer is the one used");
    assert.ok(["different", "same"].includes(saved.matchingShadow));
    if (reference(OFFICE_B, saved.recordId).some((m) => m.id === wrong.id)) assert.equal(saved.matchingShadow, "different", "the hidden record is reported");
    assert.deepEqual(matchedBy(OFFICE_B, saved.recordId), reference(OFFICE_B, saved.recordId));
  });
});

// ---- off by default, isolation, offices not in the rollout

test("off (the default): no index read, no count, and the answer is the full scan's", async () => {
  const { result, byKind } = await readsOf(() => saveLikely(OFFICE_B, OWNER_B));
  assert.equal(result.matchingMode, "scan");
  assert.ok(!byKind["query:opportunities"] && !byKind["count:opportunities"], `no index query or count: ${JSON.stringify(byKind)}`);
});

test("an office outside MATCH_INDEX_OFFICES keeps the full scan", async () => {
  await withFlags({ MATCH_INDEX_RETRIEVAL: "on", MATCH_INDEX_OFFICES: OFFICE_A }, async () => {
    const saved = await saveLikely(OFFICE_B, OWNER_B);
    assert.equal(saved.matchingMode, "scan");
  });
});

test("isolation and concurrency: saves in two offices at once only ever pair records of their own office", async () => {
  await withFlags(ON, async () => {
    const saves = await Promise.all([saveLikely(), saveLikely(OFFICE_B, OWNER_B), saveLikely(), saveLikely(OFFICE_B, OWNER_B)]);
    assert.ok(saves.some((s) => s.matches > 0), `the concurrent saves found real matches: ${saves.map((s) => s.matches)}`);
    for (const [i, saved] of saves.entries()) {
      const officeId = i % 2 ? OFFICE_B : OFFICE_A;
      const own = new Set(h.store.list(`offices/${officeId}/opportunities`).map((r) => r.id));
      for (const m of matchedBy(officeId, saved.recordId)) assert.ok(own.has(m.id), `office ${officeId} paired a record of its own (${m.id})`);
      assert.deepEqual(matchedBy(officeId, saved.recordId), reference(officeId, saved.recordId));
    }
  });
});

test("manual search uses the same retrieval and lists the same counterparts as the engine over the office", async () => {
  await withFlags(ON, async () => {
    const saved = await saveLikely();
    const found = await call("/os/records/candidates", { recordId: saved.recordId });
    assert.equal(found.matchingMode, "index");
    const expected = reference(OFFICE_A, saved.recordId).map((m) => m.id);
    for (const id of expected) assert.ok(found.candidates.some((c) => c.recordId === id), `manual search lists ${id}`);
  });
});

test("the index read stopping at its ceiling is reported as partial, never as complete", async () => {
  await withFlags({ ...ON, MATCH_CANDIDATES_MAX_DOCS: "20" }, async () => {
    const saved = await saveLikely();
    assert.equal(saved.matchingMode, "index");
    assert.equal(saved.matchingComplete, false, "more candidates than the ceiling: partial");
    assert.match(String(saved.matchingNotice || ""), /لم يشمل/);
  });
});
