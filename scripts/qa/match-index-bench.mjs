// Matching index (PR-4) — local benchmark: the full scan (PR #265) against the index, on the SAME data.
//   node scripts/qa/match-index-bench.mjs [sizes…]        (default 400 1000 4999 10000 50000; OUT_DIR for the report)
// The real Worker on the in-memory Firestore double (scripts/qa/office-os/server.mjs). Correctness is checked against
// the engine over EVERY record of the office. Reads and Firestore calls are counted by the double the way Firestore
// bills them. Times are this machine's, in memory — they show the shape, NOT Staging or production latency.
import fs from "node:fs";
import path from "node:path";
import { startOfficeOsHarness, idTokenFor, OFFICE_A, OFFICE_B, OWNER_A, OWNER_B } from "./office-os/server.mjs";
import { MATCH_THRESHOLD, MAX_MATCH_RESULTS, counterpartsEligible, opportunityToMatchInput, scoreMatch } from "../../worker/src/matching-engine.js";
import { MATCH_KEY_VERSION, matchKeyOf, matchKeysOf } from "../../worker/src/match-index.js";

const SIZES = process.argv.slice(2).map(Number).filter(Boolean);
const sizes = SIZES.length ? SIZES : [400, 1000, 4999, 10_000, 50_000];
const SAVES = Number(process.env.SAVES || 30);
const OUT = process.env.OUT_DIR || "qa-match-index-bench";
fs.mkdirSync(OUT, { recursive: true });
const quiet = console.log; console.warn = () => {}; console.log = (...a) => { if (String(a[0] || "").startsWith("[bench]")) quiet(...a); };

let seed = 23;
const rand = (n) => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n); };
const pick = (list) => list[rand(list.length)];
const DISTRICTS = ["العزيزية", "شوران", "قباء", "العوالي", "الخالدية", "السلام", "الجرف", "الرانوناء"];
const TYPES = ["شقة", "فيلا", "دور", "أرض", "عمارة"];
const CITIES = ["المدينة المنورة", "المدينة المنورة", "المدينة المنورة", "المدينه المنوره", "الرياض", "مكة المكرمة"];
let phone = 0;
const nextPhone = () => `050${String(++phone).padStart(7, "0")}`;
const NOW = new Date().toISOString();
function randomRecord(officeId) {
  const offer = rand(2) === 0, rent = rand(5) < 2, legacy = rand(10) === 0;
  const price = rent ? 20_000 + rand(60) * 1_000 : 500_000 + rand(40) * 50_000;
  const common = { officeId, lifecycleStatus: "ACTIVE", status: "active", dataCompleteness: 100, version: 1, createdAt: NOW, updatedAt: NOW, district: pick(DISTRICTS), propertyType: pick(TYPES), contactPhone: nextPhone(), contactName: "طرف" };
  if (legacy) return { ...common, kind: offer ? "owner" : "client", transactionType: rent ? "rent" : "sale", city: rand(3) ? pick(CITIES) : "", price, area: 100 + rand(400) };
  return { ...common, opportunityKind: offer ? "OFFER" : "REQUEST", purpose: offer ? (rent ? "RENT" : "SALE") : (rent ? "LEASE_REQUEST" : "PURCHASE"), advertiserRole: offer ? "OWNER" : "CLIENT", matchingReadiness: "READY_FOR_MATCHING", city: pick(CITIES), priceOrBudget: price, ...(offer ? (rent ? { annualRent: price } : { salePrice: price }) : { budget: price, priceMax: price }), area: 100 + rand(400), rooms: rand(6) };
}
const pct = (list, p) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : 0; };

const report = { at: new Date().toISOString(), note: "in-memory Firestore double on one machine; times are relative, not Staging/production latency", saves: SAVES, sizes: [] };
for (const size of sizes) {
  const h = await startOfficeOsHarness();
  for (let i = 0; i < size; i += 1) {
    const record = randomRecord(OFFICE_A);
    h.store.seed(`offices/${OFFICE_A}/opportunities/opp_r${String(i).padStart(6, "0")}`, { ...record, ...matchKeysOf(record) });
  }
  for (let i = 0; i < 200; i += 1) { const r = randomRecord(OFFICE_B); h.store.seed(`offices/${OFFICE_B}/opportunities/opp_b${String(i).padStart(4, "0")}`, { ...r, ...matchKeysOf(r) }); }
  const reference = (officeId, sourceId) => {
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
    return prepared.slice(0, MAX_MATCH_RESULTS).map((m) => `${m.id}:${m.score}`).sort().join("|");
  };
  const matched = (officeId, recordId) => h.store.list(`offices/${officeId}/matches`).filter((m) => m.isCurrent !== false && m.opportunityId === recordId).map((m) => `${m.counterpartOpportunityId}:${m.score}`).sort().join("|");
  // Each save is the counterpart of a real record of the office (same district, type and price), so it has at least
  // one true candidate somewhere in the office — usually far past the first page.
  const targets = { [OFFICE_A]: h.store.list(`offices/${OFFICE_A}/opportunities`), [OFFICE_B]: h.store.list(`offices/${OFFICE_B}/opportunities`) };
  for (const id of Object.keys(targets)) targets[id] = targets[id].filter((r) => r.opportunityKind && r.city === "المدينة المنورة" && ["SALE", "PURCHASE"].includes(r.purpose));
  const save = async (officeId = OFFICE_A, owner = OWNER_A) => {
    const target = pick(targets[officeId]);
    const offer = target.opportunityKind === "REQUEST";
    const body = { officeId, requestKey: `b-${nextPhone()}`, record: { kind: offer ? "OFFER" : "REQUEST", purpose: offer ? "SALE" : "PURCHASE", city: "المدينة المنورة", district: target.district, propertyType: target.propertyType, price: Number(target.priceOrBudget), contactName: "طرف", contactPhone: nextPhone() } };
    const before = { docs: h.store.reads.documents, calls: h.store.reads.calls || 0, by: { ...h.store.reads.byKind } };
    const started = performance.now();
    const response = await h.worker.fetch(new Request("https://worker.test/os/records/save", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${idTokenFor(owner)}` }, body: JSON.stringify(body) }), h.env, { waitUntil() {} });
    const ms = performance.now() - started;
    const json = await response.json();
    const by = (k) => (h.store.reads.byKind[k] || 0) - (before.by[k] || 0);
    const recordReads = by("query:opportunities") + by("count:opportunities") + Math.max(0, by("list:opportunities") - 300);
    return { ms, json, totalReads: h.store.reads.documents - before.docs, recordReads, calls: (h.store.reads.calls || 0) - before.calls, correct: matched(officeId, json.recordId) === reference(officeId, json.recordId), matches: json.matches };
  };
  const row = { size };
  for (const [label, flags] of [["scan", {}], ["index", { MATCH_INDEX_RETRIEVAL: "on", MATCH_INDEX_OFFICES: "*" }]]) {
    Object.assign(h.env, flags);
    const runs = [];
    for (let i = 0; i < SAVES; i += 1) runs.push(await save());
    // Concurrency: 8 saves at once across two offices.
    const started = performance.now();
    const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? save(OFFICE_B, OWNER_B) : save())));
    const burstMs = performance.now() - started;
    for (const key of Object.keys(flags)) delete h.env[key];
    row[label] = {
      mode: [...new Set(runs.map((r) => r.json.matchingMode))].join(","),
      complete: runs.every((r) => r.json.matchingComplete === true),
      correct: runs.filter((r) => r.correct).length, wrong: runs.filter((r) => !r.correct).length, withMatches: runs.filter((r) => r.matches > 0).length,
      p50: Math.round(pct(runs.map((r) => r.ms), 50)), p95: Math.round(pct(runs.map((r) => r.ms), 95)), p99: Math.round(pct(runs.map((r) => r.ms), 99)),
      recordReadsPerSave: Math.round(runs.reduce((a, r) => a + r.recordReads, 0) / runs.length),
      totalReadsPerSave: Math.round(runs.reduce((a, r) => a + r.totalReads, 0) / runs.length),
      firestoreCallsPerSave: Math.round(runs.reduce((a, r) => a + r.calls, 0) / runs.length),
      concurrent8: { ms: Math.round(burstMs), correct: burst.filter((r) => r.correct).length }
    };
  }
  report.sizes.push(row);
  console.log(`[bench] ${size}: ${JSON.stringify(row)}`);
  h.server.close();
}
fs.writeFileSync(path.join(OUT, "match-index-bench.json"), JSON.stringify(report, null, 2));
console.log(`[bench] report: ${path.join(OUT, "match-index-bench.json")}`);
