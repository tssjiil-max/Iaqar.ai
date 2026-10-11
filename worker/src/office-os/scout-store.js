/**
 * «الباحث عن الفرص» — storage. Everything the scout owns, and nothing else:
 *
 *   offices/{o}/scoutSettings/main        the office's switches and interests (the manager, through the Worker)
 *   offices/{o}/scoutTasks/{st_*}         one search: mode, what it looks for, status, cursors, results count
 *   offices/{o}/scoutOpportunities/{so_*} one external find after merging its sightings (sources, history, links)
 *   offices/{o}/scoutState/main           the office's working memory in ONE document: its open records in short,
 *                                         the index of kept finds, the board the page shows, usage and source health
 *   offices/{o}/scoutFeed/{id}            what the office pasted for the scout
 *   offices/{o}/scoutRuns/{id}            a round that did something: counts and codes only
 *   _system/scoutSchedule                 who is due next: office and task ids, times and counters only
 *
 * Every office document is under its own office and closed to browsers by the rules; the schedule holds ids and
 * times only. Reads are kept few on purpose (a round reads the schedule, the state and the due tasks — not the
 * office's collections), because the scout runs all day.
 */

import { TASK_STATUS, normPhone, normalizeScoutSettings } from "../../../public/os/domain/scout-domain.js";
import { kindOf, lifecycleOf, isPaused, recordTitle, LIFECYCLE } from "../../../public/os/domain/records-domain.js";
import { UNAVAILABLE_SET, isOpenForMatching } from "../../../public/os/domain/validity-domain.js";

export const SCOUT_LIMITS = Object.freeze({
  activeTasks: 40, autoTasks: 25, customTasks: 15, index: 400, board: 40, seen: 800, records: 300,
  officesPerTick: 6, leaseMinutes: 4, syncHours: 6, recordCheckMinutes: 60, generalPushesPer6h: 2,
  feedChars: 12000, feedPerHour: 12, opportunityTtlDays: 45, taskTtlDays: 14, aiPerOfficeDay: 40, runsKept: 60, livePerOfficeDay: 40
});

export const scoutAvailable = (env = {}) => String(env?.OPPORTUNITY_SCOUT || "").toLowerCase() === "enabled";

const SCHEDULE = ["_system", "scoutSchedule"];
export const settingsPath = (officeId) => ["offices", officeId, "scoutSettings", "main"];
export const statePath = (officeId) => ["offices", officeId, "scoutState", "main"];
export const taskPath = (officeId, taskId) => ["offices", officeId, "scoutTasks", taskId];
export const findPath = (officeId, id) => ["offices", officeId, "scoutOpportunities", id];

const parse = (json, fallback) => { try { const value = JSON.parse(json || ""); return value ?? fallback; } catch (_) { return fallback; } };

export async function loadSettings(ctx, officeId, office = null) {
  const raw = (await ctx.store.get(settingsPath(officeId)).catch(() => null)) || {};
  return normalizeScoutSettings(raw, office || {});
}

// ------------------------------------------------------------------ the office's working memory

const emptyState = () => ({ records: [], recordsSyncedAt: "", index: [], board: [], seen: {}, usage: {}, health: {} });

function decodeState(doc) {
  if (!doc) return emptyState();
  return {
    records: parse(doc.recordsJson, []), recordsSyncedAt: String(doc.recordsSyncedAt || ""), index: parse(doc.indexJson, []), board: parse(doc.boardJson, []),
    seen: parse(doc.seenJson, {}), usage: parse(doc.usageJson, {}), health: parse(doc.healthJson, {})
  };
}

function encodeState(officeId, state, now) {
  const seenKeys = Object.keys(state.seen || {});
  const seen = seenKeys.length > SCOUT_LIMITS.seen ? Object.fromEntries(seenKeys.slice(-SCOUT_LIMITS.seen).map((key) => [key, state.seen[key]])) : state.seen || {};
  return {
    officeId, schemaVersion: 1,
    recordsJson: JSON.stringify((state.records || []).slice(0, SCOUT_LIMITS.records)), recordsSyncedAt: state.recordsSyncedAt || "",
    indexJson: JSON.stringify((state.index || []).slice(0, SCOUT_LIMITS.index)), boardJson: JSON.stringify((state.board || []).slice(0, SCOUT_LIMITS.board)),
    seenJson: JSON.stringify(seen), usageJson: JSON.stringify(state.usage || {}), healthJson: JSON.stringify(state.health || {}), updatedAt: now
  };
}

export async function loadState(ctx, officeId) {
  return decodeState(await ctx.store.get(statePath(officeId)));
}

/**
 * Change the office's scout state safely: `mutate` gets the CURRENT state (re-read on a concurrent change) and
 * returns the next one, so a round, a pasted digest and a broker's press never overwrite each other.
 */
export async function mutateState(ctx, officeId, mutate) {
  const segments = statePath(officeId);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const doc = await ctx.store.get(segments);
    const next = await mutate(decodeState(doc));
    if (!next) return decodeState(doc);
    const fields = encodeState(officeId, next, ctx.now());
    try {
      if (doc?.__updateTime) await ctx.store.patchIfUnchanged(segments, fields, doc.__updateTime);
      else if (!doc && (await ctx.store.create(segments, fields)) === false) continue;
      else if (doc) await ctx.store.set(segments, fields);
      return next;
    } catch (error) {
      if (error?.status === 409 && attempt < 5) continue;
      throw error;
    }
  }
  throw Object.assign(new Error("scout state is busy"), { status: 409, code: "concurrent_update" });
}

// ------------------------------------------------------------------ the schedule (one small document for the whole platform)

function decodeSchedule(doc) {
  return { entries: parse(doc?.entriesJson, {}), health: parse(doc?.healthJson, {}) };
}

export async function loadSchedule(ctx) {
  return decodeSchedule(await ctx.store.get(SCHEDULE));
}

export async function mutateSchedule(ctx, mutate) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const doc = await ctx.store.get(SCHEDULE);
    const next = await mutate(decodeSchedule(doc));
    if (!next) return decodeSchedule(doc);
    const fields = { entriesJson: JSON.stringify(next.entries || {}), healthJson: JSON.stringify(next.health || {}), updatedAt: ctx.now() };
    try {
      if (doc?.__updateTime) await ctx.store.patchIfUnchanged(SCHEDULE, fields, doc.__updateTime);
      else if (!doc && (await ctx.store.create(SCHEDULE, fields)) === false) continue;
      else if (doc) await ctx.store.set(SCHEDULE, fields);
      return next;
    } catch (error) {
      if (error?.status === 409 && attempt < 5) continue;
      throw error;
    }
  }
  throw Object.assign(new Error("scout schedule is busy"), { status: 409, code: "concurrent_update" });
}

/** entries[officeId] = { t: { taskId: { n: next run (ms), p: priority, c: rounds done, e: empty rounds, r: record last checked } }, s: next inventory sync, l: lease } */
export const officeEntry = (entries, officeId) => (entries[officeId] ||= { t: {}, s: 0, l: 0 });

export function enqueueTask(entries, officeId, taskId, { at, priority, keep = true }) {
  const entry = officeEntry(entries, officeId);
  const previous = keep ? entry.t[taskId] || {} : {};
  entry.t[taskId] = { c: 0, e: 0, r: 0, ...previous, n: at, p: priority };
}

export function dequeueTask(entries, officeId, taskId) {
  const entry = entries[officeId];
  if (entry?.t) delete entry.t[taskId];
}

// ------------------------------------------------------------------ the office's records, in short

/** Is this record still looking for its other side — and if not, does its search end or only wait? */
export function recordSearchState(record, now = new Date()) {
  if (!record || lifecycleOf(record) === LIFECYCLE.DELETED) return { open: false, reason: "RECORD_CLOSED" };
  if (UNAVAILABLE_SET.has(String(record.availabilityStatus || "").toUpperCase())) return { open: false, reason: "RECORD_SOLD" };
  if (isPaused(record)) return { open: false, wait: true, reason: "RECORD_PAUSED" };
  if (lifecycleOf(record) !== LIFECYCLE.ACTIVE) return { open: false, reason: "RECORD_CLOSED" };
  if (!isOpenForMatching(record, now)) return { open: false, wait: true, reason: "RECORD_EXPIRED" };
  if (!kindOf(record) || !String(record.propertyType || "").trim() || String(record.matchingReadiness || "").toUpperCase() === "NEEDS_COMPLETION") return { open: false, wait: true, reason: "RECORD_PAUSED" };
  return { open: true, reason: "" };
}

/** The few fields of a record the scout needs to recognise it and to look for its other side. */
export function recordDigest(record = {}) {
  const more = String(record.notes || record.details || "").match(/أحياء مقبولة أيضًا:\s*([^—\n]+)/);
  return {
    id: String(record.id || ""), opportunityKind: kindOf(record), purpose: String(record.purpose || ""), propertyType: String(record.propertyType || ""),
    city: String(record.city || ""), district: String(record.district || "").replace(/^حي\s+/, ""), priceOrBudget: Number(record.priceOrBudget ?? record.price ?? record.budget ?? 0) || 0,
    priceMin: Number(record.priceMin || 0) || 0, area: Number(record.area || 0) || 0, rooms: Number(record.rooms || 0) || 0,
    xd: more ? more[1].split(/[،,]/).map((d) => d.trim()).filter(Boolean).slice(0, 5) : [],
    phone: normPhone(record.contactPhone || record.advertiserPhoneNormalized || record.phone), urgent: record.validityUrgent === true,
    brokerId: String(record.brokerId || record.originatingBrokerId || ""), title: recordTitle(record)
  };
}

export const isRunning = (task) => task?.status === TASK_STATUS.ACTIVE;
