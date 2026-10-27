/**
 * Matching index — the retrieval key of an office record (pure; no storage, no network).
 *
 * The keys only narrow WHICH records the engine looks at; they never score. They are built, with the engine's own
 * functions, from the facts the engine refuses a pair on: the side (offer / request), the operation (sale / rent) and
 * the city — and, since the engine refuses a pair whose district AND property type both differ, the district and the
 * type. A value the record does not state is «*»: such a record is queried by every source, as the engine accepts it
 * against any value. Three keys per record:
 *   matchKey          side|operation|city                 (a source without district or type)
 *   matchKeyDistrict  side|operation|city|district        ┐ a source with both: candidates = same district (or none)
 *   matchKeyType      side|operation|city|property type   ┘ ∪ same type (or none) — the two queries are merged
 * Everything else (price, area, rooms, readiness, lifecycle, validity, the threshold) stays the engine's: candidates
 * found through the keys still go through counterpartsEligible + scoreMatch.
 *
 * Kept current by the Worker (match-index-guard in index.js) and by the Firestore rules: a write that changes a field
 * the key is built from without writing the key removes the key, so the record drops out of the index (and the
 * completeness count sends matching back to a full scan) instead of being found under a stale key.
 */
import { normalizeArabicText, normalizeOpportunitySide, normalizeTransactionType } from "./matching-engine.js";

export const MATCH_KEY_VERSION = "v1";
/** The fields the key is built from: a write touching any of them must also write (or remove) the key. */
export const MATCH_KEY_SOURCE_FIELDS = Object.freeze(["opportunityKind", "kind", "recordType", "sourceCollection", "transactionType", "purpose", "city", "district", "propertyType"]);
export const MATCH_KEY_FIELDS = Object.freeze(["matchKey", "matchKeyDistrict", "matchKeyType", "matchKeyVersion"]);

const ANY = "*";
const part = (value) => encodeURIComponent(String(value));
const sideOf = (record) => normalizeOpportunitySide(record) || ANY;
// Same truthiness as the engine (opportunityToMatchInput: `record.city || ""`, scoreMatch: `source.city && candidate.city`).
const cityOf = (record) => (record.city ? `c:${normalizeArabicText(record.city)}` : ANY);
const districtOf = (record) => (record.district ? `d:${normalizeArabicText(record.district)}` : ANY);
const typeOf = (record) => (record.propertyType ? `t:${normalizeArabicText(record.propertyType)}` : ANY);
const keyFrom = (...parts) => [MATCH_KEY_VERSION, ...parts.map(part)].join("|");

/** The coarse key stored on a record (`matchKey`): side, operation and city. */
export function matchKeyOf(record = {}) {
  return keyFrom(sideOf(record), normalizeTransactionType(record), cityOf(record));
}

/** All the index fields of a record, as stored. */
export function matchKeysOf(record = {}) {
  const side = sideOf(record), tx = normalizeTransactionType(record), city = cityOf(record);
  return { matchKey: keyFrom(side, tx, city), matchKeyDistrict: keyFrom(side, tx, city, districtOf(record)), matchKeyType: keyFrom(side, tx, city, typeOf(record)), matchKeyVersion: MATCH_KEY_VERSION };
}

/**
 * How to retrieve the counterparts of `source`: a list of { field, values } queries whose results are merged, or null
 * when the source cannot be narrowed (no city: the engine accepts every city then) and the caller must scan.
 */
export function candidateQueriesFor(source = {}) {
  const city = cityOf(source);
  if (city === ANY) return null;
  const side = normalizeOpportunitySide(source);
  // The engine refuses two records of the same known side; a counterpart whose side is unknown is always possible.
  const sides = side === "offer" ? ["request", ANY] : side === "request" ? ["offer", ANY] : ["offer", "request", ANY];
  const tx = normalizeTransactionType(source);
  const prefixes = sides.flatMap((s) => [[s, tx, city], [s, tx, ANY]]);
  const district = districtOf(source), type = typeOf(source);
  // Without both a district and a type the engine refuses nothing on them: the coarse key.
  if (district === ANY || type === ANY) return [{ field: "matchKey", values: prefixes.map((p) => keyFrom(...p)) }];
  return [
    { field: "matchKeyDistrict", values: prefixes.flatMap((p) => [keyFrom(...p, district), keyFrom(...p, ANY)]) },
    { field: "matchKeyType", values: prefixes.flatMap((p) => [keyFrom(...p, type), keyFrom(...p, ANY)]) }
  ];
}

/** The coarse keys a counterpart of `source` may carry (null: scan). */
export function candidateKeysFor(source = {}) {
  const city = cityOf(source);
  if (city === ANY) return null;
  const side = normalizeOpportunitySide(source);
  const sides = side === "offer" ? ["request", ANY] : side === "request" ? ["offer", ANY] : ["offer", "request", ANY];
  const tx = normalizeTransactionType(source);
  return sides.flatMap((s) => [keyFrom(s, tx, city), keyFrom(s, tx, ANY)]);
}

/** True when `record` would be returned by the queries for `source` (null queries: the scan returns everything). */
export function retrievedBy(queries, record = {}) {
  if (queries === null) return true;
  const keys = matchKeysOf(record);
  return queries.some((q) => q.values.includes(keys[q.field]));
}

/** The index fields to write on a record whose stored keys are missing or stale; null when they are current. */
export function matchKeyUpdate(record = {}) {
  const keys = matchKeysOf(record);
  return Object.entries(keys).every(([field, value]) => record[field] === value) ? null : keys;
}

/** True when a write to a record changes what its key is built from without writing the key itself. */
export function writeInvalidatesMatchKey(fieldPaths = []) {
  const paths = new Set(fieldPaths);
  return !MATCH_KEY_FIELDS.some((f) => paths.has(f)) && MATCH_KEY_SOURCE_FIELDS.some((f) => paths.has(f));
}

/** `offices/{officeId}/opportunities/{id}` — as path segments or as a full Firestore document name. */
export function isOfficeRecordPath(path) {
  const segments = Array.isArray(path) ? path.map(String) : String(path || "").split("/documents/").pop().split("/");
  return segments.length === 4 && segments[0] === "offices" && segments[2] === "opportunities";
}

/**
 * The update mask a write to `segments` must use: a masked write to a record that changes a key field without
 * writing the key also lists the key paths (with no value), so Firestore removes them in the same write.
 */
export function guardPatchMask(segments, fieldPaths = []) {
  return isOfficeRecordPath(segments) && writeInvalidatesMatchKey(fieldPaths) ? [...fieldPaths, ...MATCH_KEY_FIELDS] : fieldPaths;
}

/** The same guard over a batched `:commit`: masked record updates gain the key paths; a full replace already drops them. */
export function guardCommitWrites(writes = []) {
  return writes.map((write) => {
    const paths = write?.update && write.updateMask?.fieldPaths;
    if (!paths || !isOfficeRecordPath(write.update.name)) return write;
    const guarded = guardPatchMask(write.update.name, paths);
    return guarded === paths ? write : { ...write, updateMask: { ...write.updateMask, fieldPaths: guarded } };
  });
}
