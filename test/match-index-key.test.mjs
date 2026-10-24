// The retrieval key of the matching index (worker/src/match-index.js) may only narrow the candidates to those the
// engine could accept: for ANY pair the engine finds eligible, the candidate's key is one of the keys queried for the
// source (or the source asks for a full scan). Checked on every combination of the fields the key is built from —
// including legacy spellings and empty values — and on a large random sample of whole records.
import test from "node:test";
import assert from "node:assert/strict";
import { counterpartsEligible, opportunityToMatchInput, scoreMatch } from "../worker/src/matching-engine.js";
import { MATCH_KEY_VERSION, candidateKeysFor, candidateQueriesFor, matchKeyOf, retrievedBy } from "../worker/src/match-index.js";

const KINDS = [{ opportunityKind: "OFFER" }, { opportunityKind: "REQUEST" }, { kind: "offer" }, { kind: "client" }, { recordType: "OWNER" }, { sourceCollection: "owners" }, { sourceCollection: "clients" }, { opportunityKind: "OTHER" }, {}];
const TXS = [{ purpose: "SALE" }, { purpose: "PURCHASE" }, { purpose: "RENT" }, { transactionType: "LEASE" }, { purpose: "إيجار" }, { purpose: "بيع" }, { transactionType: "rent" }, { transactionType: "sale" }, { transactionType: "Exchange" }, {}];
const CITIES = ["المدينة المنورة", "المدينه المنوره", "  المدينة   المنورة ", "الرياض", "", "   ", undefined, "مكة المكرمة", "مكه المكرمه"];
// Fields the key is not built from, varied so the engine's other rules (district, type, price…) still apply.
// Complete canonical records pass the engine's admission gate; legacy-looking records (no canonical marker) are ungated.
const REST = [
  { district: "العزيزية", propertyType: "شقة", priceOrBudget: 900_000, priceMax: 900_000, budget: 900_000, salePrice: 900_000, annualRent: 900_000, advertiserRole: "CLIENT", contactPhone: "0501112222" },
  { district: "العزيزية", propertyType: "شقة", priceOrBudget: 880_000, budget: 880_000, salePrice: 880_000, annualRent: 880_000, advertiserRole: "OWNER", contactPhone: "0501113333" },
  { district: "شوران", propertyType: "فيلا", priceOrBudget: 2_000_000, salePrice: 2_000_000, budget: 2_000_000, annualRent: 2_000_000, advertiserRole: "BROKER", contactPhone: "0501114444" },
  { district: "", propertyType: "", priceOrBudget: 0 }
];
const active = { lifecycleStatus: "ACTIVE", status: "active", dataCompleteness: 100 };
const engineAccepts = (a, b) => counterpartsEligible(a, b) && scoreMatch(opportunityToMatchInput(a), opportunityToMatchInput(b)).eligible;
const covered = (source, candidate) => retrievedBy(candidateQueriesFor(source), candidate);

test("the key is versioned and carries side, operation and city only", () => {
  const key = matchKeyOf({ opportunityKind: "OFFER", purpose: "SALE", city: "المدينة المنورة" });
  assert.ok(key.startsWith(`${MATCH_KEY_VERSION}|`));
  assert.equal(matchKeyOf({ opportunityKind: "OFFER", purpose: "SALE", city: "المدينه  المنوره", district: "x", price: 5 }), key, "the engine's own normalisation: same city, same key");
});

test("every combination of side × operation × city: an engine-eligible pair is never excluded by the key", () => {
  let pairs = 0, eligible = 0;
  for (const [ka, kb] of KINDS.flatMap((a) => KINDS.map((b) => [a, b]))) {
    for (const [ta, tb] of TXS.flatMap((a) => TXS.map((b) => [a, b]))) {
      for (const [ca, cb] of CITIES.flatMap((a) => CITIES.map((b) => [a, b]))) {
        for (const rest of [REST[1], REST[2], REST[3]]) {
          const a = { ...active, ...ka, ...ta, city: ca, ...(rest === REST[3] ? REST[3] : REST[0]) };
          const b = { ...active, ...kb, ...tb, city: cb, ...rest };
          pairs += 1;
          if (!engineAccepts(a, b)) continue;
          eligible += 1;
          assert.ok(covered(a, b), `excluded an eligible pair: ${JSON.stringify({ a, b, queries: candidateQueriesFor(a) })}`);
        }
      }
    }
  }
  assert.ok(eligible > 1000, `the sweep reached many eligible pairs (${eligible} of ${pairs})`);
});

test("a large random sample of whole records: no eligible pair is excluded", () => {
  let seed = 7;
  const rand = (n) => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n); };
  const pick = (list) => list[rand(list.length)];
  const DISTRICTS = ["العزيزية", "العزيزيه", "شوران", "", undefined, "  "];
  const TYPES = ["شقة", "شقه", "فيلا", "", undefined];
  const record = () => ({ ...active, ...pick(KINDS), ...pick(TXS), city: pick(CITIES), ...pick(REST), district: pick(DISTRICTS), propertyType: pick(TYPES), rooms: rand(6), area: rand(400) });
  let eligible = 0;
  for (let i = 0; i < 40_000; i += 1) {
    const a = record(), b = record();
    if (!engineAccepts(a, b)) continue;
    eligible += 1;
    assert.ok(covered(a, b), JSON.stringify({ a, b }));
  }
  assert.ok(eligible > 500, `eligible pairs in the sample: ${eligible}`);
});

test("the key narrows: a different operation or a different known city is not queried", () => {
  const source = { opportunityKind: "OFFER", purpose: "SALE", city: "المدينة المنورة" };
  const keys = candidateKeysFor(source);
  assert.ok(Array.isArray(keys) && keys.length <= 4, `a bounded list of keys: ${JSON.stringify(keys)}`);
  assert.ok(!keys.includes(matchKeyOf({ opportunityKind: "REQUEST", purpose: "RENT", city: "المدينة المنورة" })), "another operation");
  assert.ok(!keys.includes(matchKeyOf({ opportunityKind: "REQUEST", purpose: "PURCHASE", city: "الرياض" })), "another city");
  assert.ok(!keys.includes(matchKeyOf({ opportunityKind: "OFFER", purpose: "SALE", city: "المدينة المنورة" })), "the same side");
  assert.ok(keys.includes(matchKeyOf({ opportunityKind: "REQUEST", purpose: "PURCHASE", city: "" })), "a counterpart with no city is still queried");
});

test("district and type narrow further: a counterpart with another district AND another type is not queried", () => {
  const source = { opportunityKind: "OFFER", purpose: "SALE", city: "المدينة المنورة", district: "العزيزية", propertyType: "شقة" };
  const queries = candidateQueriesFor(source);
  assert.deepEqual(queries.map((q) => q.field), ["matchKeyDistrict", "matchKeyType"]);
  assert.ok(queries.every((q) => q.values.length <= 30), "within Firestore's IN limit");
  const base = { opportunityKind: "REQUEST", purpose: "PURCHASE", city: "المدينة المنورة" };
  assert.ok(retrievedBy(queries, { ...base, district: "العزيزية", propertyType: "فيلا" }), "same district");
  assert.ok(retrievedBy(queries, { ...base, district: "شوران", propertyType: "شقة" }), "same type");
  assert.ok(retrievedBy(queries, { ...base, district: "", propertyType: "فيلا" }), "no district");
  assert.ok(!retrievedBy(queries, { ...base, district: "شوران", propertyType: "فيلا" }), "another district and another type");
  assert.deepEqual(candidateQueriesFor({ ...source, district: "" }).map((q) => q.field), ["matchKey"], "without a district: the coarse key");
});

test("a source without a city cannot be narrowed by city: it asks for a full scan", () => {
  assert.equal(candidateKeysFor({ opportunityKind: "OFFER", purpose: "SALE", city: "" }), null);
  assert.equal(candidateQueriesFor({ opportunityKind: "OFFER", purpose: "SALE", city: "", district: "x", propertyType: "y" }), null);
  assert.equal(candidateKeysFor({ opportunityKind: "OFFER", purpose: "SALE" }), null);
});

// ---- the write guard (used by every Firestore write helper of the Worker)
import { guardCommitWrites, guardPatchMask } from "../worker/src/match-index.js";

test("write guard: a record write that changes a key field without the key also removes the key", () => {
  const record = ["offices", "o1", "opportunities", "r1"];
  const KEYS = ["matchKey", "matchKeyDistrict", "matchKeyType", "matchKeyVersion"];
  assert.deepEqual(guardPatchMask(record, ["city", "updatedAt"]), ["city", "updatedAt", ...KEYS]);
  assert.deepEqual(guardPatchMask(record, ["purpose"]), ["purpose", ...KEYS]);
  assert.deepEqual(guardPatchMask(record, ["district"]), ["district", ...KEYS]);
  assert.deepEqual(guardPatchMask(record, ["propertyType"]), ["propertyType", ...KEYS]);
  assert.deepEqual(guardPatchMask(record, ["lifecycleStatus", "updatedAt"]), ["lifecycleStatus", "updatedAt"], "a write that does not touch the key fields keeps the key");
  assert.deepEqual(guardPatchMask(record, ["city", "matchKey", "matchKeyVersion"]), ["city", "matchKey", "matchKeyVersion"], "a write that sets the key keeps it");
  assert.deepEqual(guardPatchMask(["offices", "o1", "matches", "m1"], ["city"]), ["city"], "other collections are untouched");
  assert.deepEqual(guardPatchMask(["offices", "o1", "opportunities", "r1", "communications", "c1"], ["city"]), ["city"], "nor sub-collections of a record");
});

test("write guard on batched commits: masked record updates gain the key paths; full replaces and other docs are left alone", () => {
  const name = "projects/p/databases/(default)/documents/offices/o1/opportunities/r1";
  const writes = guardCommitWrites([
    { update: { name, fields: { city: { stringValue: "الرياض" } } }, updateMask: { fieldPaths: ["city"] } },
    { update: { name, fields: { status: { stringValue: "x" } } }, updateMask: { fieldPaths: ["status"] } },
    { update: { name: "projects/p/databases/(default)/documents/offices/o1/matches/m1", fields: {} }, updateMask: { fieldPaths: ["city"] } },
    { update: { name, fields: { city: { stringValue: "مكة" } } } },
    { delete: name }
  ]);
  assert.deepEqual(writes[0].updateMask.fieldPaths, ["city", "matchKey", "matchKeyDistrict", "matchKeyType", "matchKeyVersion"]);
  assert.deepEqual(writes[1].updateMask.fieldPaths, ["status"]);
  assert.deepEqual(writes[2].updateMask.fieldPaths, ["city"]);
  assert.equal(writes[3].updateMask, undefined, "a full replace without the key already drops it");
  assert.deepEqual(writes[4], { delete: name });
});
