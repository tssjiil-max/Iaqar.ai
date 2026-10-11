/**
 * «الباحث عن الفرص» — the office's background researcher (Worker side; rules in public/os/domain/scout-domain.js).
 *
 *   sources → the shared «تعبئة ذكية» understanding → one find per property/request (sightings merged) →
 *   the platform's matching engine against the office's searches and open records → level → the board, and an
 *   alert only when it is worth the broker's attention.
 *
 *   • Not a second brain and not a second matcher: analysis is smart-fill's, fit is matching-engine's.
 *   • Discovery only. The scout never writes to anyone: «تواصل» is the broker's own press, recorded as «opened».
 *   • Everything is under the office (offices/{o}/scout*), written by the Worker only. A source the office may
 *     not read is never read (scout-sources.js).
 *   • 24/7 means rounds started by the Worker's scheduler from a small schedule document — never a request that
 *     stays open. Modes differ in priority, pace, depth, lifetime, alerts and model use (MODE_CONFIG).
 *   • On only where OPPORTUNITY_SCOUT = "enabled" (Staging). Elsewhere every route answers «غير متاح» and no round runs.
 */

import { analyzeListing, listingTitle, normalizeAnalysis } from "../../../public/os/domain/smart-fill-domain.js";
import { isJourneyOpen, JOURNEY_STATUS } from "../../../public/os/domain/journey-domain.js";
import { formatNumber, relativeAgo } from "../../../public/os/domain/format-domain.js";
import {
  ADVERTISER_LABEL, BAND, BAND_LABEL, CATEGORY_LABEL, END_REASON_LABEL, MODE_CONFIG, OPP_ACTION, OPP_STATUS, RING, SCOUT_MODE, SEEK, SURFACE, TASK_CONTROL, TASK_ORIGIN, TASK_STATUS,
  allowedRing, awaySummary, bandRank, boardCard, candidateFromRaw, categoryOf, contentKey, discoveryProfile, entityHeadline, freshness, isContactable, mergeSighting,
  modeOf, normPhone, normalizeScoutSettings, strongCount, notificationCopy, parseScoutCommand, planQueries, priceLine, profileFromRecord, profileSummary, scoutCounters, splitDigest,
  surfaceDecision, taskCadence, taskTitle, taskView, validateCustomSearch, webQueryText,
  BUCKET, bucketCounts, completenessLabel, matchDifferences, missingFacts
} from "../../../public/os/domain/scout-domain.js";
import { operationDocumentId } from "../operations-domain.js";
import { finishTasks } from "./task-service.js";
import { kindOf, recordTitle } from "../../../public/os/domain/records-domain.js";
import { consumePublicRateLimit, publicRateLimitKey } from "../public-rate-limit.js";
import { AUDIT_ACTIONS, writeAudit } from "./audit-log.js";
import { alertBrokerOnTelegram } from "./bot-notify.js";
import { canActOn } from "./permissions.js";
import { fillListingGaps, smartFillAiStatus } from "./smart-fill-service.js";
import { entityFromIndex, evaluateFind, findExisting, inInventory, indexEntry, repeatCount } from "./scout-evaluate.js";
import { SOURCE_STATE, nextBackoff, sourceLabel, sourceQuality, sourcesForOffice, sourcesReport, usableSources } from "./scout-sources.js";
import { liveSearchAvailable, liveWebSearch, readLinkedPage } from "./scout-web.js";
import {
  SCOUT_LIMITS, dequeueTask, enqueueTask, findPath, isRunning, loadSchedule, loadSettings, loadState, mutateSchedule, mutateState, officeEntry, recordDigest,
  recordSearchState, scoutAvailable, settingsPath, taskPath
} from "./scout-store.js";

export { scoutAvailable } from "./scout-store.js";

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const DAY = 86_400_000;
const SYSTEM_PAUSES = new Set(["RECORD_PAUSED", "RECORD_EXPIRED", "GENERAL_OFF"]);
const DISCOVERY_ID = "st_discovery";

function assertAvailable(ctx) {
  if (!scoutAvailable(ctx.env)) throw ctx.deps.appError("scout_unavailable", 503, "الباحث عن الفرص غير متاح على هذه البيئة");
}

async function shortHash(ctx, value, length = 16) {
  return (await ctx.deps.sha256Hex(String(value))).slice(0, length);
}

const recordTaskId = async (ctx, officeId, recordId) => `st_r_${await shortHash(ctx, `${officeId}|${recordId}`, 24)}`;
const riyadhDay = (now) => new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);

// ------------------------------------------------------------------ tasks

function buildTask({ id, officeId, origin, mode, seek, profile, exactPrice = 0, title, recordId = "", recordKind = "", actorUid = "", brokerId = "", nlText = "", now }) {
  const config = MODE_CONFIG[mode];
  return {
    schemaVersion: 1, id, officeId, origin, mode, seek, profile, exactPrice, title: text(title, 160), recordId, recordKind, nlText: text(nlText, 600),
    status: TASK_STATUS.ACTIVE, statusReason: "", stoppedByBroker: false, assignedBrokerId: text(brokerId || actorUid, 128), createdBy: text(actorUid, 128),
    createdAt: now, updatedAt: now, startedAt: now.toISOString(),
    intensiveUntil: config.windowHours ? new Date(now.getTime() + config.windowHours * 3_600_000).toISOString() : "",
    cursors: {}, geoRing: config.startRing, stats: { strong: 0, veryStrong: 0 }, lastRunAt: "", endedAt: ""
  };
}

function cursorOf(task, sourceId, now) {
  const saved = Date.parse(task.cursors?.[sourceId] || "");
  if (saved) return saved;
  return now.getTime() - (task.profile?.freshnessDays || MODE_CONFIG[modeOf(task.mode)].backfillDays) * DAY;
}

async function setTaskStatus(ctx, officeId, task, status, reason = "", { byBroker = false } = {}) {
  const now = ctx.now();
  const patch = { status, statusReason: reason, stoppedByBroker: byBroker, updatedAt: now, endedAt: [TASK_STATUS.ENDED, TASK_STATUS.COMPLETED].includes(status) ? now.toISOString() : "" };
  await ctx.store.set(taskPath(officeId, task.id), patch);
  return { ...task, ...patch };
}

async function applySchedule(ctx, officeId, mutate) {
  return mutateSchedule(ctx, (schedule) => { mutate(schedule.entries, officeEntry(schedule.entries, officeId)); return schedule; });
}

// ------------------------------------------------------------------ the office's inventory → searches for what is missing

/**
 * The office's open records, in short, and the searches they need: an open offer or request with no other side
 * inside the office gets a general search of its own; a record that closed (sold, rented, found, archived,
 * deleted) ends its search; a paused or expired one makes it wait. Nothing keeps running for a closed record.
 */
export async function syncOfficeInventory(ctx, officeId, { settings, now = ctx.now() }) {
  const [rows, matches, journeys, tasks] = await Promise.all([
    ctx.store.list(["offices", officeId, "opportunities"], 300),
    ctx.store.list(["offices", officeId, "matches"], 300).catch(() => []),
    ctx.store.list(["offices", officeId, "journeys"], 300).catch(() => []),
    ctx.store.list(["offices", officeId, "scoutTasks"], 100)
  ]);
  const busy = new Set();
  const won = new Set();
  for (const m of matches) {
    if (m.isCurrent === false || ["superseded", "closed"].includes(String(m.status || "").toLowerCase()) || String(m.brokerDecision || "").toUpperCase() === "REJECTED") continue;
    busy.add(m.offerId || m.ownerOfferId); busy.add(m.requestId || m.clientRequestId);
  }
  for (const j of journeys) {
    if (isJourneyOpen(j)) { busy.add(j.offerId); busy.add(j.requestId); }
    if (String(j.status || "").toUpperCase() === JOURNEY_STATUS.CLOSED_WON) { won.add(j.offerId); won.add(j.requestId); }
  }
  const stateOf = new Map();
  const open = [];
  for (const row of rows) {
    if (String(row.officeId || officeId) !== officeId) continue;
    const state = won.has(row.id) ? { open: false, reason: "RECORD_SOLD" } : recordSearchState(row, now);
    stateOf.set(row.id, state);
    if (state.open) open.push(row);
  }
  const byRecord = new Map(tasks.filter((t) => t.recordId).map((t) => [t.recordId, t]));
  const queue = [];
  const general = settings.enabled && settings.generalEnabled;
  let activeAuto = 0;
  for (const task of tasks) {
    const ended = [TASK_STATUS.ENDED, TASK_STATUS.COMPLETED].includes(task.status);
    if (ended && now.getTime() - (Date.parse(task.endedAt || "") || new Date(task.updatedAt || 0).getTime() || 0) > SCOUT_LIMITS.taskTtlDays * DAY) {
      await ctx.store.remove(taskPath(officeId, task.id)).catch(() => {});
      queue.push({ taskId: task.id, remove: true });
      continue;
    }
    const automatic = task.origin === TASK_ORIGIN.AUTO || task.origin === TASK_ORIGIN.DISCOVERY;
    const record = task.recordId ? stateOf.get(task.recordId) || { open: false, reason: "RECORD_CLOSED" } : { open: true };
    if (task.status === TASK_STATUS.ACTIVE) {
      if (!record.open) { await setTaskStatus(ctx, officeId, task, record.wait ? TASK_STATUS.PAUSED : TASK_STATUS.ENDED, record.reason); queue.push({ taskId: task.id, remove: true }); }
      else if (task.origin === TASK_ORIGIN.AUTO && busy.has(task.recordId)) { await setTaskStatus(ctx, officeId, task, TASK_STATUS.ENDED, "RECORD_MATCHED"); queue.push({ taskId: task.id, remove: true }); }
      else if (automatic && !general) { await setTaskStatus(ctx, officeId, task, TASK_STATUS.PAUSED, "GENERAL_OFF"); queue.push({ taskId: task.id, remove: true }); }
      else if (task.origin === TASK_ORIGIN.AUTO) activeAuto += 1;
    } else if (task.status === TASK_STATUS.PAUSED && !task.stoppedByBroker && SYSTEM_PAUSES.has(task.statusReason) && record.open && (!automatic || general)) {
      await setTaskStatus(ctx, officeId, task, TASK_STATUS.ACTIVE, "");
      queue.push({ taskId: task.id, at: now.getTime(), priority: MODE_CONFIG[modeOf(task.mode)].priority });
      if (task.origin === TASK_ORIGIN.AUTO) activeAuto += 1;
    }
  }
  let created = 0;
  if (general) {
    const wanted = open.filter((r) => !busy.has(r.id) && !byRecord.has(r.id))
      .sort((a, b) => Number(b.validityUrgent === true) - Number(a.validityUrgent === true) || new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    for (const record of wanted.slice(0, Math.max(0, SCOUT_LIMITS.autoTasks - activeAuto))) {
      const lens = profileFromRecord(record);
      if (!lens) continue;
      const task = buildTask({
        id: await recordTaskId(ctx, officeId, record.id), officeId, origin: TASK_ORIGIN.AUTO, mode: SCOUT_MODE.GENERAL, seek: lens.seek, profile: lens.profile, exactPrice: lens.exactPrice,
        title: taskTitle({}, record), recordId: record.id, recordKind: lens.recordKind, brokerId: text(record.brokerId || record.originatingBrokerId, 128), now
      });
      await ctx.store.set(taskPath(officeId, task.id), task);
      queue.push({ taskId: task.id, at: now.getTime(), priority: MODE_CONFIG.GENERAL.priority });
      created += 1;
    }
    // The office's standing radar: new offers, requests and owners that fit what the office works in, record or not.
    const discovery = tasks.find((t) => t.id === DISCOVERY_ID);
    const profile = discoveryProfile(settings);
    if (!discovery) {
      await ctx.store.set(taskPath(officeId, DISCOVERY_ID), buildTask({ id: DISCOVERY_ID, officeId, origin: TASK_ORIGIN.DISCOVERY, mode: SCOUT_MODE.GENERAL, seek: SEEK.ANY, profile, title: "اكتشاف فرص جديدة لمكتبك", now }));
      queue.push({ taskId: DISCOVERY_ID, at: now.getTime(), priority: MODE_CONFIG.GENERAL.priority });
    } else if (JSON.stringify(discovery.profile || {}) !== JSON.stringify(profile)) {
      await ctx.store.set(taskPath(officeId, DISCOVERY_ID), { profile, updatedAt: now });
    }
  }
  const digest = open.map(recordDigest).slice(0, SCOUT_LIMITS.records);
  // Keeping time: a find nobody acted on and no source showed again for a month and a half leaves (what the broker
  // saved or contacted stays), and the index never grows past its size. Pasted text leaves after the same time.
  const expired = [];
  await mutateState(ctx, officeId, (state) => {
    expired.length = 0;
    const cutoff = now.getTime() - SCOUT_LIMITS.opportunityTtlDays * DAY;
    const kept = (entry) => [OPP_STATUS.SAVED, OPP_STATUS.CONTACTED].includes(entry.status);
    const index = [];
    for (const [position, entry] of state.index.entries()) {
      const last = Date.parse(entry.lastSeenAt || entry.firstSeenAt || "") || now.getTime();
      if (!kept(entry) && expired.length < 40 && (last < cutoff || position >= SCOUT_LIMITS.index - 40)) expired.push(entry.id); else index.push(entry);
    }
    const gone = new Set(expired);
    return { ...state, index, board: state.board.filter((card) => !gone.has(card.id)), records: digest, recordsSyncedAt: now.toISOString() };
  });
  for (const id of expired) await ctx.store.remove(findPath(officeId, id)).catch(() => {});
  const oldFeed = await ctx.store.queryAfter(["offices", officeId], "scoutFeed", { field: "createdAt", before: new Date(now.getTime() - SCOUT_LIMITS.opportunityTtlDays * DAY), limit: 20 }).catch(() => []);
  for (const doc of oldFeed) await ctx.store.remove(["offices", officeId, "scoutFeed", doc.id]).catch(() => {});
  return { digest, queue, created, openRecords: open.length, expired: expired.length };
}

/** One record changed (saved, paused, archived, sold, removed…): its search follows at once, without a full sync. */
export async function scoutRecordChanged(ctx, { officeId, recordId, matches = null }) {
  if (!scoutAvailable(ctx.env) || !recordId) return { ok: true, skipped: true };
  const office = (await ctx.store.get(["offices", officeId])) || {};
  const settings = await loadSettings(ctx, officeId, office);
  if (!settings.enabled) return { ok: true, skipped: true };
  const now = ctx.now();
  const row = await ctx.store.get(["offices", officeId, "opportunities", recordId]);
  const record = row ? { ...row, id: recordId } : null;
  const state = recordSearchState(record, now);
  const id = await recordTaskId(ctx, officeId, recordId);
  const task = await ctx.store.get(taskPath(officeId, id));
  await mutateState(ctx, officeId, (current) => ({ ...current, records: [...current.records.filter((r) => r.id !== recordId), ...(state.open ? [recordDigest(record)] : [])] }));
  const lens = state.open ? profileFromRecord(record) : null;
  if (task) {
    if (task.status === TASK_STATUS.ACTIVE && !state.open) {
      await setTaskStatus(ctx, officeId, task, state.wait ? TASK_STATUS.PAUSED : TASK_STATUS.ENDED, state.reason);
      await applySchedule(ctx, officeId, (entries) => dequeueTask(entries, officeId, id));
    } else if (task.status === TASK_STATUS.ACTIVE && task.origin === TASK_ORIGIN.AUTO && Number(matches) > 0) {
      await setTaskStatus(ctx, officeId, task, TASK_STATUS.ENDED, "RECORD_MATCHED");
      await applySchedule(ctx, officeId, (entries) => dequeueTask(entries, officeId, id));
    } else if (task.status === TASK_STATUS.PAUSED && !task.stoppedByBroker && SYSTEM_PAUSES.has(task.statusReason) && state.open && task.statusReason !== "GENERAL_OFF") {
      await setTaskStatus(ctx, officeId, task, TASK_STATUS.ACTIVE, "");
      await applySchedule(ctx, officeId, (entries) => enqueueTask(entries, officeId, id, { at: now.getTime(), priority: MODE_CONFIG[modeOf(task.mode)].priority }));
    } else if (task.status === TASK_STATUS.ACTIVE && lens && JSON.stringify(task.profile || {}) !== JSON.stringify(lens.profile)) {
      // The record was edited: its search follows the record, and looks again at what it already passed over.
      await ctx.store.set(taskPath(officeId, id), { profile: lens.profile, exactPrice: lens.exactPrice, title: taskTitle({}, record), cursors: {}, indexChecked: false, updatedAt: now });
    }
    return { ok: true };
  }
  if (lens && settings.generalEnabled && matches === 0) {
    const fresh = buildTask({ id, officeId, origin: TASK_ORIGIN.AUTO, mode: SCOUT_MODE.GENERAL, seek: lens.seek, profile: lens.profile, exactPrice: lens.exactPrice, title: taskTitle({}, record), recordId, recordKind: lens.recordKind, brokerId: text(record.brokerId || record.originatingBrokerId, 128), now });
    await ctx.store.set(taskPath(officeId, id), fresh);
    await applySchedule(ctx, officeId, (entries) => enqueueTask(entries, officeId, id, { at: now.getTime(), priority: MODE_CONFIG.GENERAL.priority }));
    return { ok: true, created: id };
  }
  return { ok: true };
}

// ------------------------------------------------------------------ finds (documents)

const FIND_SCALARS = ["id", "officeId", "kind", "purpose", "tx", "propertyType", "city", "district", "price", "area", "rooms", "phone", "contactName", "contactRoute", "title", "text", "url",
  "publishedAt", "firstSeenAt", "lastSeenAt", "sourceCount", "confidence", "badPrice", "advertiser", "score", "band", "surface", "status", "notifiedBand", "notifiedAt",
  "lastChange", "lastChangeAt", "bestTaskId", "bestRecordId", "bestRecordKind", "engine", "convertedRecordId", "actedBy", "actedAt",
  "pinned", "outcome", "outcomeNote", "outcomeAt", "outcomeBy", "followUpTaskId", "recheckedAt"];

function encodeFind(entity, now) {
  const out = { schemaVersion: 1, updatedAt: now };
  for (const key of FIND_SCALARS) if (entity[key] !== undefined) out[key] = entity[key];
  out.reasons = (entity.reasons || []).slice(0, 8);
  out.warnings = (entity.warnings || []).slice(0, 6);
  out.advertiserReasons = (entity.advertiserReasons || []).slice(0, 4);
  out.sourcesJson = JSON.stringify(entity.sources || []);
  out.linksJson = JSON.stringify(entity.links || []);
  out.changesJson = JSON.stringify(entity.changes || []);
  return out;
}

function decodeFind(doc) {
  if (!doc) return null;
  const parse = (json) => { try { const v = JSON.parse(json || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
  return { ...doc, sources: parse(doc.sourcesJson), links: parse(doc.linksJson), changes: parse(doc.changesJson), reasons: doc.reasons || [], warnings: doc.warnings || [] };
}

/** Newest first when the collection is listed by name. */
const newFindId = async (ctx, candidate, now) => `so_${String(9_999_999_999_999 - now.getTime()).padStart(13, "0")}_${await shortHash(ctx, `${candidate.sourceId}|${candidate.externalId}|${now.getTime()}`, 8)}`;

async function createNotification(ctx, officeId, { key, route, entityId, type, title, body, brokerId = "", push = false, now }) {
  const id = `nt_${(await ctx.deps.sha256Hex(`notif|${key}`)).slice(0, 40)}`;
  const segments = ["offices", officeId, "notifications", id];
  const created = await ctx.store.create(segments, {
    schemaVersion: 1, id, officeId, brokerId: text(brokerId, 128), operationId: "", taskId: "", workflowId: "", matchId: "", opportunityId: "",
    route, entityType: "scout", entityId, type, title, body, status: "CREATED", readAt: "",
    createdAt: now, updatedAt: now, deduplicationKey: key, deliveryChannelsJson: JSON.stringify(push ? ["in_app", "push"] : ["in_app"]),
    providerStateJson: JSON.stringify({ push: push ? "QUEUED" : "NOT_REQUESTED" }), sensitivePreview: false, createdBySystem: true
  });
  return { created: created !== false, segments };
}

/** The alert for one find: in the app always; on the phone when the office allows it; never a contact detail in it. */
async function notifyFind(ctx, { officeId, entity, link, change = null, push = true, recordTitleText = "", brokerId = "", now }) {
  const urgent = link.mode === SCOUT_MODE.URGENT;
  const copy = notificationCopy({ entity, link, recordTitleText, change, urgent });
  const key = `scout|${entity.id}|${change ? `${change.field}:${change.to}` : link.band}`;
  const { created, segments } = await createNotification(ctx, officeId, { key, route: `scout/opp/${entity.id}`, entityId: entity.id, type: "SCOUT_OPPORTUNITY", title: copy.title, body: copy.body, brokerId, push, now });
  if (!created) return { created: false, push: "duplicate" };
  let state = "NOT_REQUESTED";
  if (push && typeof ctx.deps.sendOfficePush === "function") {
    try {
      const result = await ctx.deps.sendOfficePush({ officeId, title: copy.title, body: copy.body, type: "scout", recordId: entity.id, taskId: `scout:${entity.id}`, operationId: `scout:${entity.id}`, assignedBrokerId: text(brokerId, 128) });
      // Honest provider state: accepted by the push provider is not «delivered to the phone».
      state = result?.skipped ? `SKIPPED_${String(result.reason || "").toUpperCase()}` : Number(result?.sent || 0) > 0 ? "ACCEPTED_BY_PROVIDER" : Number(result?.failed || 0) > 0 ? "PROVIDER_REJECTED" : "NO_DEVICES";
    } catch (error) {
      state = "FAILED";
    }
    await ctx.store.set(segments, { providerStateJson: JSON.stringify({ push: state, at: now.toISOString() }), updatedAt: now }).catch(() => {});
  }
  if (urgent) await alertBrokerOnTelegram(ctx.store, ctx.deps, { officeId, brokerId, title: copy.title, body: copy.body, route: `scout/opp/${entity.id}`, now }).catch(() => {});
  return { created: true, push: state };
}

// ------------------------------------------------------------------ one round of one office

/** Rules first; a model only where the mode allows it, the office's daily share is not used up, and the ad is worth it. */
async function understand(ctx, officeId, item, { aiAllowed, usage, seenFlag }) {
  const listing = analyzeListing(item.text);
  let candidate = candidateFromRaw(item, listing);
  let engine = "rules";
  const gaps = listing.missing?.length && !item.structured;
  if (gaps && aiAllowed && seenFlag !== "a" && candidate.confidence >= 0.2 && smartFillAiStatus(ctx.env) === "configured" && Number(usage.aiCalls || 0) < SCOUT_LIMITS.aiPerOfficeDay) {
    usage.aiCalls = Number(usage.aiCalls || 0) + 1;
    const filled = await fillListingGaps(ctx, officeId, normalizeAnalysis({ ok: true, listings: [listing] })).catch(() => null);
    if (filled?.ok && filled.listings?.[0]) { candidate = candidateFromRaw(item, filled.listings[0]); engine = filled.engine === "rules+ai" ? "rules+ai" : "rules"; }
    return { candidate, engine, triedAi: true };
  }
  return { candidate, engine, triedAi: false };
}

/**
 * One round for one office: read what is new in its sources, understand each ad once, fold it into the finds the
 * office already has, judge it for every due search and for the office's open records, and keep, show or alert
 * according to its level. Returns what the schedule needs for each task (its next time and counters).
 *
 *   taskIds     the searches that are due (or, with `inline`, the ones the broker just started / fed)
 *   runtime     their counters from the schedule: { c: rounds done, e: empty rounds, r: record last checked }
 *   onlySource  read one source only («none» = no source: only what the scout already knows is judged)
 *   sinceMs     read the sources from this moment only (a digest just pasted)
 */
export async function runOfficeCycle(ctx, officeId, { taskIds = [], runtime = {}, sync = false, inline = false, onlySource = "", sinceMs = 0, recheckKnown = false, now = ctx.now() } = {}) {
  const office = (await ctx.store.get(["offices", officeId])) || {};
  const settings = await loadSettings(ctx, officeId, office);
  if (!settings.enabled) return { ok: true, off: true, tasks: {}, enqueue: [] };
  const nowMs = now.getTime();
  const outcome = { ok: true, tasks: {}, enqueue: [], syncAt: 0, stats: { fetched: 0, fresh: 0, known: 0, merged: 0, discarded: 0, inInventory: 0, notContactable: 0, kept: 0, strong: 0, veryStrong: 0, notified: 0, aiCalls: 0, outsideQueries: 0, sourceErrors: 0 }, cards: [] };
  if (sync) {
    const synced = await syncOfficeInventory(ctx, officeId, { settings, now });
    outcome.enqueue = synced.queue;
    outcome.syncAt = nowMs + SCOUT_LIMITS.syncHours * 3_600_000;
    const removed = new Set(synced.queue.filter((q) => q.remove).map((q) => q.taskId));
    taskIds = [...new Set([...taskIds, ...synced.queue.filter((q) => !q.remove).map((q) => q.taskId)])].filter((id) => !removed.has(id));
  }
  const state = await loadState(ctx, officeId);
  const usage = state.usage?.day === riyadhDay(now) ? { ...state.usage } : { day: riyadhDay(now), aiCalls: 0, pushAt: (state.usage?.pushAt || []).filter((t) => nowMs - t < 6 * 3_600_000) };
  usage.pushAt = (usage.pushAt || []).filter((t) => nowMs - t < 6 * 3_600_000);
  let health = { ...(state.health || {}) };
  const recordById = new Map((state.records || []).map((r) => [r.id, r]));

  // The due searches, each checked against its mode's lifetime and its record before it costs anything.
  const loaded = (await Promise.all(taskIds.slice(0, 12).map((id) => ctx.store.get(taskPath(officeId, id))))).filter(Boolean);
  const tasks = [];
  for (const doc of loaded) {
    const meta = runtime[doc.id] || {};
    const task = { ...doc, cycle: Number(meta.c || 0), emptyCycles: Number(meta.e || 0), recordCheckedAt: Number(meta.r || 0) };
    if (!isRunning(task)) { outcome.tasks[task.id] = null; continue; }
    if (taskCadence(task, now).complete) {
      await setTaskStatus(ctx, officeId, task, TASK_STATUS.COMPLETED, "DEEP_COMPLETE");
      outcome.tasks[task.id] = null;
      const strong = Number(task.stats?.strong || 0);
      await createNotification(ctx, officeId, {
        key: `scout-done|${task.id}|${task.startedAt}`, route: `scout/task/${task.id}`, entityId: task.id, type: "SCOUT_SEARCH_DONE", brokerId: task.assignedBrokerId, now, title: "اكتمل البحث العميق",
        body: strong ? `${text(task.title, 100)} — ${strongCount(strong)}.` : `${text(task.title, 100)} — لم نجد ما يستحق وقتك، ولم نعرض ما دون ذلك.`
      }).catch(() => {});
      continue;
    }
    if (task.recordId && (inline || nowMs - task.recordCheckedAt > SCOUT_LIMITS.recordCheckMinutes * 60_000)) {
      const row = await ctx.store.get(["offices", officeId, "opportunities", task.recordId]);
      const found = recordSearchState(row ? { ...row, id: task.recordId } : null, now);
      if (!found.open) {
        await setTaskStatus(ctx, officeId, task, found.wait ? TASK_STATUS.PAUSED : TASK_STATUS.ENDED, found.reason);
        outcome.tasks[task.id] = null;
        continue;
      }
      recordById.set(task.recordId, recordDigest({ ...row, id: task.recordId }));
      task.recordCheckedAt = nowMs;
    }
    tasks.push(task);
  }
  if (!tasks.length) {
    if (sync) await mutateState(ctx, officeId, (current) => ({ ...current, usage, health: { ...current.health, lastCycleAt: now.toISOString() } }));
    return outcome;
  }

  const index = [...(state.index || [])];
  const board = [...(state.board || [])];
  const seen = { ...(state.seen || {}) };
  const touched = new Map();
  const perTask = new Map(tasks.map((t) => [t.id, { strong: 0, veryStrong: 0 }]));
  const loadEntity = async (id) => touched.get(id) || decodeFind(await ctx.store.get(findPath(officeId, id)));

  /**
   * One find after it was judged: its links and level are set, it is shown or kept hidden, the broker is alerted
   * when its level and the search's mode call for it, and the office's index and board follow.
   */
  const settle = async ({ entity, links: fresh, judgedTaskIds, advertiser = null, changes = [], isNew = false, pinned = false }) => {
    if (pinned) entity.pinned = true;
    const kept = (entity.links || []).filter((link) => !fresh.some((l) => (l.taskId || l.recordId) === (link.taskId || link.recordId)) && !judgedTaskIds.includes(link.taskId));
    const links = [...fresh, ...kept].sort((a, b) => b.score - a.score).slice(0, 5);
    const best = links[0] || null;
    const previous = { surface: entity.surface, notifiedBand: entity.notifiedBand || "" };
    Object.assign(entity, {
      links, band: best ? best.band : BAND.WEAK, score: best ? best.score : 0, reasons: best ? best.reasons : [], warnings: best ? best.warnings : [],
      bestTaskId: best?.taskId || "", bestRecordId: best?.recordId || "", bestRecordKind: best?.recordKind || "",
      ...(advertiser ? { advertiser: advertiser.kind, advertiserReasons: advertiser.reasons } : {})
    });
    // A new find that is weak is dropped (not stored, not shown). One already kept stays, with its new level.
    // (An ad the broker brought himself is kept whatever its level — it is his own choice.)
    if (isNew && !entity.pinned && bandRank(entity.band) < bandRank(BAND.MEDIUM)) { outcome.stats.discarded += 1; return false; }
    const contactable = isContactable(entity);
    if (!contactable) outcome.stats.notContactable += 1;
    const decision = surfaceDecision({ band: entity.band, contactable, minQuality: settings.minQuality, mode: best?.mode || SCOUT_MODE.GENERAL, status: entity.status, pinned: entity.pinned === true, alerts: settings.notify, alertLevel: settings.alertLevel });
    const meaningful = changes.find((c) => (c.field === "price" && Number(c.to) < Number(c.from)) || c.field === "contact") || null;
    if (meaningful) { entity.lastChange = meaningful.field === "price" ? "price_drop" : "contact"; entity.lastChangeAt = now.toISOString(); }
    entity.surface = [OPP_STATUS.IGNORED, OPP_STATUS.CONVERTED].includes(entity.status) ? SURFACE.HIDDEN : decision.surface;
    const newlyShown = entity.surface === SURFACE.SHOWN && previous.surface !== SURFACE.SHOWN;
    const raised = bandRank(entity.band) > bandRank(previous.notifiedBand || BAND.WEAK);
    if (decision.notify && entity.surface === SURFACE.SHOWN && (raised || (meaningful && previous.notifiedBand))) {
      const throttled = MODE_CONFIG[best?.mode || SCOUT_MODE.GENERAL].notify.throttled && usage.pushAt.length >= SCOUT_LIMITS.generalPushesPer6h;
      const record = best.recordId ? recordById.get(best.recordId) : null;
      const sent = await notifyFind(ctx, {
        officeId, entity, link: best, change: meaningful && (previous.notifiedBand || meaningful.field === "price") ? meaningful : null, push: settings.notifyPush && !throttled,
        recordTitleText: record?.title || "", brokerId: record?.brokerId || tasks.find((t) => t.id === best.taskId)?.assignedBrokerId || "", now
      });
      if (sent.created) {
        outcome.stats.notified += 1;
        entity.notifiedBand = entity.band; entity.notifiedAt = now.toISOString();
        if (settings.notifyPush && !throttled) usage.pushAt.push(nowMs);
      }
    }
    outcome.stats.kept += 1;
    if (newlyShown) {
      outcome.stats.strong += 1;
      if (entity.band === BAND.VERY_STRONG) outcome.stats.veryStrong += 1;
      for (const link of fresh) {
        const counter = perTask.get(link.taskId);
        if (counter && bandRank(link.band) >= bandRank(BAND.STRONG)) { counter.strong += 1; if (link.band === BAND.VERY_STRONG) counter.veryStrong += 1; }
      }
    }
    touched.set(entity.id, entity);
    const at = index.findIndex((entry) => entry.id === entity.id);
    if (at >= 0) index[at] = indexEntry(entity); else index.unshift(indexEntry(entity));
    const cardAt = board.findIndex((card) => card.id === entity.id);
    if (cardAt >= 0) board.splice(cardAt, 1);
    if (entity.surface === SURFACE.SHOWN) {
      const card = boardCard(entity, best || {}, { recordTitleText: best?.recordId ? recordById.get(best.recordId)?.title || "" : "", now });
      board.unshift(card);
      if (newlyShown) outcome.cards.push(card);
    }
    return true;
  };

  // A search on its first round (or one that just widened): what the scout already knows is judged for it first — no source is asked.
  const firstLook = tasks.filter((task) => recheckKnown || task.indexChecked !== true);
  if (firstLook.length) {
    const hits = [];
    for (const entry of index) {
      if ([OPP_STATUS.IGNORED, OPP_STATUS.CONVERTED].includes(entry.status) || !(entry.phone || entry.route)) continue;
      const judged = evaluateFind({ entity: entityFromIndex(entry), tasks: firstLook, records: [], settings, sourceQuality: 0.6, repeat: repeatCount(index, entry.phone, entry.id), now });
      const strong = judged.links.filter((link) => bandRank(link.band) >= bandRank(BAND.STRONG));
      if (strong.length) hits.push({ entry, links: strong });
    }
    hits.sort((a, b) => b.links[0].score - a.links[0].score);
    for (const hit of hits.slice(0, 6)) {
      const entity = await loadEntity(hit.entry.id);
      if (!entity) continue;
      // The short index picked the candidates; the level is judged on the stored find itself (its own sources, its full text).
      const exact = evaluateFind({
        entity, tasks: firstLook, records: [], settings, sourceQuality: Math.max(0, ...(entity.sources || []).map((s) => sourceQuality(s.sourceId))) || 0.6,
        repeat: repeatCount(index, entity.phone, entity.id), now
      }).links.filter((link) => bandRank(link.band) >= bandRank(BAND.STRONG));
      const already = new Set((entity.links || []).map((l) => l.taskId));
      const fresh = exact.filter((link) => !already.has(link.taskId) || recheckKnown);
      if (fresh.length) await settle({ entity, links: fresh, judgedTaskIds: fresh.map((l) => l.taskId) });
    }
  }

  // What the sources have since each search last looked (its own cursor; a new search looks back over its mode's window).
  const sources = usableSources(ctx, office, settings, health, now).filter((s) => !onlySource || s.adapter.id === onlySource);
  const limit = Math.max(MODE_CONFIG.GENERAL.itemsPerCycle, ...tasks.map((t) => MODE_CONFIG[modeOf(t.mode)].itemsPerCycle));
  const rawItems = [];
  const fetchedUntil = {};
  const asked = new Map();
  for (const { adapter, backingOff } of sources) {
    if (backingOff && !inline) continue;
    const recheck = (task) => Boolean(adapter.queryable && task.cycle % MODE_CONFIG[modeOf(task.mode)].recheckEvery === 0);
    const sinceOf = (task) => sinceMs || (inline || recheck(task) ? nowMs - (task.profile?.freshnessDays || MODE_CONFIG[modeOf(task.mode)].backfillDays) * DAY : cursorOf(task, adapter.id, now));
    const starts = tasks.length ? tasks.map(sinceOf) : [sinceMs || nowMs - MODE_CONFIG.GENERAL.backfillDays * DAY];
    const distinct = (list) => list.filter((form, i, all) => all.findIndex((f) => JSON.stringify(f) === JSON.stringify(form)) === i);
    let forms = adapter.queryable ? distinct(tasks.flatMap(planQueries)).slice(0, 6) : [];
    const asking = [];
    if (adapter.metered) {
      // A paid outside search: each search asks at its own mode's pace, the most pressing first, and the office
      // never goes past its daily allowance. A search with nothing specific to ask (no type, no district) does not ask.
      let left = Math.min(8, Math.max(0, adapter.metered.perDay(ctx.env) - Number(usage[adapter.metered.usageKey] || 0)));
      forms = [];
      for (const task of [...tasks].sort((a, b) => MODE_CONFIG[modeOf(b.mode)].priority - MODE_CONFIG[modeOf(a.mode)].priority)) {
        const pace = (taskCadence(task, now).downgraded ? MODE_CONFIG.GENERAL : MODE_CONFIG[modeOf(task.mode)]).metered;
        if (left <= 0 || nowMs - (Date.parse(task.metered?.[adapter.id] || "") || 0) < pace.everyMinutes * 60_000) continue;
        const mine = planQueries(task).filter((form) => (form.propertyTypes || []).length || (form.districts || []).length).slice(0, Math.min(pace.queries, left));
        if (!mine.length) continue;
        forms.push(...mine); left -= mine.length; asking.push(task.id);
      }
      forms = distinct(forms);
      if (!forms.length) continue;
    }
    try {
      const got = await adapter.fetch(ctx, { officeId, since: new Date(Math.min(...starts)), limit, forms, now });
      if (adapter.metered) {
        const sent = Number(got.queries ?? forms.length) || 0;
        usage[adapter.metered.usageKey] = Number(usage[adapter.metered.usageKey] || 0) + sent;
        outcome.stats.outsideQueries += sent;
        for (const id of asking) asked.set(id, { ...(asked.get(id) || {}), [adapter.id]: now.toISOString() });
      }
      let items = got.items || [];
      let until = got.until || "";
      // A search that is catching up must not hold back the ones that are up to date: read the newest window too.
      if (!adapter.queryable && Number(got.scanned || 0) >= limit && Math.max(...starts) - Math.min(...starts) > 3_600_000) {
        const recent = await adapter.fetch(ctx, { officeId, since: new Date(Math.max(...starts)), limit, forms });
        items = [...items, ...(recent.items || [])];
        until = "";
      }
      for (const item of items) rawItems.push({ ...item, adapterId: adapter.id, mutable: adapter.mutable === true });
      fetchedUntil[adapter.id] = adapter.queryable ? now.toISOString() : until;
      health = nextBackoff(health, adapter.id, true, { now, count: items.length });
    } catch (error) {
      outcome.stats.sourceErrors += 1;
      health = nextBackoff(health, adapter.id, false, { now, code: error?.code || "source_failed" });
      console.warn("[scout] source failed", adapter.id, error?.code || "source_failed");
    }
  }

  // The same ad twice in one round (the same link entered again, a feed row repeated): its latest reading is the one that counts.
  const latest = new Map(rawItems.map((item, position) => [`${item.sourceId}|${item.externalId}`, position]));
  let processed = 0;
  for (const [position, item] of rawItems.entries()) {
    if (processed >= limit * 2) break;
    const ref = `${item.sourceId}|${item.externalId}`;
    if (!item.externalId || !String(item.text || "").trim() || latest.get(ref) !== position) continue;
    const itemAt = Date.parse(item.at || "") || nowMs;
    const eligible = tasks.filter((task) => inline || item.mutable || itemAt > cursorOf(task, item.adapterId, now));
    if (!eligible.length && !item.pinned) continue;
    processed += 1;
    outcome.stats.fetched += 1;
    const seenKey = await shortHash(ctx, ref, 14);
    const hash = await shortHash(ctx, `${contentKey(item.text)}|${JSON.stringify(item.structured || {})}|${normPhone(item.phone)}`, 10);
    const [seenHash, seenFlag] = String(seen[seenKey] || "").split(":");
    // The same content, already read: nothing to read again. («n» = was not a property ad; «k» = already one of the kept finds.)
    if (seenHash === hash && (seenFlag === "n" || seenFlag === "k")) { outcome.stats.known += 1; continue; }
    const aiAllowed = eligible.some((task) => MODE_CONFIG[modeOf(task.mode)].ai.allowed);
    const before = Number(usage.aiCalls || 0);
    const { candidate, engine, triedAi } = await understand(ctx, officeId, item, { aiAllowed, usage, seenFlag: seenHash === hash ? seenFlag : "" });
    outcome.stats.aiCalls += Number(usage.aiCalls || 0) - before;
    if (!candidate.understood || !candidate.kind) { seen[seenKey] = `${hash}:n`; outcome.stats.discarded += 1; continue; }
    if (triedAi) seen[seenKey] = `${hash}:a`;
    if (inInventory([...recordById.values()], candidate)) { outcome.stats.inInventory += 1; continue; }

    // The same property or request seen before (this source or another) → one find, re-judged with what is new.
    const match = findExisting(index, candidate);
    let entity;
    let changes = [];
    if (match) {
      const stored = await loadEntity(match.entry.id);
      if (!stored) { index.splice(index.indexOf(match.entry), 1); continue; }
      const merged = mergeSighting(stored, candidate, { now, sourceLabel: sourceLabel(candidate.sourceId, ctx.env) });
      entity = merged.next;
      changes = merged.changes;
      if (merged.newSource || changes.length) outcome.stats.merged += 1; else outcome.stats.known += 1;
    } else {
      outcome.stats.fresh += 1;
      const at = now.toISOString();
      entity = {
        ...candidate, id: await newFindId(ctx, candidate, now), officeId, engine, firstSeenAt: at, lastSeenAt: at, status: OPP_STATUS.NEW, surface: SURFACE.HIDDEN, band: BAND.WEAK,
        sources: [{ sourceId: candidate.sourceId, label: sourceLabel(candidate.sourceId, ctx.env), ref: candidate.externalId, url: candidate.url || "", firstSeenAt: at, lastSeenAt: at }], sourceCount: 1, changes: [], links: []
      };
    }
    const judged = evaluateFind({
      entity, tasks: eligible, records: [...recordById.values()], settings, sourceQuality: Math.max(...entity.sources.map((s) => sourceQuality(s.sourceId))),
      repeat: repeatCount(index, entity.phone, entity.id), now
    });
    const stays = await settle({ entity, links: judged.links, judgedTaskIds: eligible.map((t) => t.id), advertiser: judged.advertiser, changes, isNew: !match, pinned: item.pinned === true });
    if (stays) seen[seenKey] = `${hash}:k`;
  }

  // Writes: only what changed.
  await Promise.all([...touched.values()].map((entity) => ctx.store.set(findPath(officeId, entity.id), encodeFind(entity, now))));
  for (const task of tasks) {
    const counter = perTask.get(task.id);
    const empty = counter.strong ? 0 : task.emptyCycles + 1;
    const ring = allowedRing({ ...task, emptyCycles: empty });
    const patch = {};
    if (ring > Number(task.geoRing || 0)) {
      // Widened to the neighbouring districts (or the city): the search looks again at what it already passed over.
      Object.assign(patch, { geoRing: ring, cursors: {}, indexChecked: false });
    } else {
      const cursors = { ...(task.cursors || {}) };
      let moved = false;
      for (const [sourceId, until] of Object.entries(fetchedUntil)) if (until && (!cursors[sourceId] || until > cursors[sourceId])) { cursors[sourceId] = until; moved = true; }
      if (moved) patch.cursors = cursors;
      if (task.indexChecked !== true) patch.indexChecked = true;
    }
    if (asked.has(task.id)) patch.metered = { ...(task.metered || {}), ...asked.get(task.id) };
    if (counter.strong) patch.stats = { strong: Number(task.stats?.strong || 0) + counter.strong, veryStrong: Number(task.stats?.veryStrong || 0) + counter.veryStrong };
    if (Object.keys(patch).length || inline) await ctx.store.set(taskPath(officeId, task.id), { ...patch, lastRunAt: now.toISOString(), updatedAt: now });
    const cadence = taskCadence(task, now, settings);
    // A search that just widened looks again on the next beat, not after its usual wait.
    outcome.tasks[task.id] = { n: patch.geoRing ? nowMs : nowMs + cadence.intervalMinutes * 60_000, p: cadence.priority, c: task.cycle + 1, e: empty, r: task.recordCheckedAt };
  }
  health = { ...health, lastCycleAt: now.toISOString(), ...(outcome.stats.sourceErrors ? { lastErrorAt: now.toISOString() } : { lastOkAt: now.toISOString() }), cycles: Number(health.cycles || 0) + 1 };
  const active = outcome.stats.fetched > 0 || outcome.stats.sourceErrors > 0 || outcome.stats.outsideQueries > 0;
  if (active || touched.size || inline || nowMs - (Date.parse(state.health?.lastCycleAt || "") || 0) > 3_600_000) {
    const changedIds = new Set(touched.keys());
    await mutateState(ctx, officeId, (current) => ({
      ...current,
      // Finds touched in this round replace their entries; everything else is whatever is stored now (a broker's press included).
      index: [...index.filter((entry) => changedIds.has(entry.id)), ...current.index.filter((entry) => !changedIds.has(entry.id))].slice(0, SCOUT_LIMITS.index),
      board: [...board.filter((card) => changedIds.has(card.id)), ...current.board.filter((card) => !changedIds.has(card.id))].slice(0, SCOUT_LIMITS.board),
      records: [...recordById.values()].slice(0, SCOUT_LIMITS.records), seen: { ...current.seen, ...seen }, usage, health
    }));
  }
  if (active) {
    // The last rounds only (a ring of slots, overwritten) — counts, never a phone or an ad's text.
    await ctx.store.set(["offices", officeId, "scoutRuns", `run_${String(Number(health.cycles || 0) % SCOUT_LIMITS.runsKept).padStart(3, "0")}`], {
      officeId, at: now, inline, modes: [...new Set(tasks.map((t) => modeOf(t.mode)))], tasks: tasks.length, sources: Object.keys(fetchedUntil), ...outcome.stats
    }).catch(() => {});
  }
  return outcome;
}

/** A round that ran outside the scheduler (a new urgent search, «شغّل الآن», a pasted digest) → the schedule follows it. */
async function applyOutcome(ctx, officeId, outcome) {
  await applySchedule(ctx, officeId, (entries, entry) => {
    for (const [taskId, next] of Object.entries(outcome.tasks || {})) { if (next) entry.t[taskId] = { ...(entry.t[taskId] || {}), ...next }; else delete entry.t[taskId]; }
    for (const item of outcome.enqueue || []) { if (item.remove) delete entry.t[item.taskId]; else enqueueTask(entries, officeId, item.taskId, { at: item.at, priority: item.priority }); }
    if (outcome.syncAt) entry.s = outcome.syncAt;
  });
}

// ------------------------------------------------------------------ the scheduler beat

/** Who is due at this moment: offices not being worked on, the most pressing search first, then the longest waiting. */
export function dueOffices(entries = {}, nowMs = Date.now()) {
  const due = [];
  for (const [officeId, entry] of Object.entries(entries || {})) {
    if (Number(entry.l || 0) > nowMs) continue;
    const ready = Object.entries(entry.t || {}).filter(([, t]) => Number(t.n || 0) <= nowMs).sort((a, b) => Number(b[1].p || 0) - Number(a[1].p || 0) || Number(a[1].n || 0) - Number(b[1].n || 0));
    const sync = Number(entry.s || 0) > 0 && Number(entry.s) <= nowMs;
    if (!ready.length && !sync) continue;
    due.push({ officeId, taskIds: ready.map(([id]) => id), sync, priority: Math.max(0, ...ready.map(([, t]) => Number(t.p || 0))), first: Math.min(sync ? Number(entry.s) : Infinity, ...ready.map(([, t]) => Number(t.n || 0))) });
  }
  return due.sort((a, b) => b.priority - a.priority || a.first - b.first);
}

/**
 * One beat of the scheduler (the Worker's cron): the offices that have something due, the most pressing first
 * (an urgent search always before a deep one, a deep one before a general one), a few per beat. Idle beats cost one read.
 */
export async function runScoutTick(ctx, { now = ctx.now(), maxOffices = SCOUT_LIMITS.officesPerTick } = {}) {
  if (!scoutAvailable(ctx.env)) return { ok: true, skipped: "off" };
  const nowMs = now.getTime();
  const schedule = await loadSchedule(ctx);
  const due = dueOffices(schedule.entries, nowMs);
  const chosen = due.slice(0, maxOffices);
  const beat = (health, extra = {}) => ({ ...health, lastTickAt: now.toISOString(), ticks: Number(health.ticks || 0) + 1, ...extra });
  if (!chosen.length) {
    // Nothing due: the beat is recorded now and then, not on every idle minute.
    if (nowMs - (Date.parse(schedule.health?.lastTickAt || "") || 0) > 30 * 60_000) await mutateSchedule(ctx, (s) => ({ ...s, health: beat(s.health, { lastIdleAt: now.toISOString() }) }));
    return { ok: true, offices: 0, waiting: due.length };
  }
  await mutateSchedule(ctx, (s) => { for (const item of chosen) officeEntry(s.entries, item.officeId).l = nowMs + SCOUT_LIMITS.leaseMinutes * 60_000; return s; });
  const outcomes = [];
  for (const item of chosen) {
    try {
      outcomes.push({ officeId: item.officeId, due: item.taskIds, ...(await runOfficeCycle(ctx, item.officeId, { taskIds: item.taskIds, runtime: schedule.entries[item.officeId]?.t || {}, sync: item.sync, now })) });
    } catch (error) {
      console.warn("[scout] round failed", error?.code || error?.message);
      outcomes.push({ officeId: item.officeId, due: item.taskIds, failed: true, code: text(error?.code || "round_failed", 60) });
    }
  }
  const totals = { strong: 0, notified: 0, fetched: 0, failed: 0 };
  await mutateSchedule(ctx, (s) => {
    for (const outcome of outcomes) {
      const entry = officeEntry(s.entries, outcome.officeId);
      entry.l = 0;
      if (outcome.off) { delete s.entries[outcome.officeId]; continue; }
      if (outcome.failed) {
        // The office's round failed as a whole: its due searches wait a quarter of an hour, nothing is lost.
        totals.failed += 1;
        for (const id of outcome.due) if (entry.t[id]) entry.t[id].n = nowMs + 15 * 60_000;
        continue;
      }
      for (const [taskId, next] of Object.entries(outcome.tasks || {})) { if (next) entry.t[taskId] = { ...(entry.t[taskId] || {}), ...next }; else delete entry.t[taskId]; }
      for (const item of outcome.enqueue || []) { if (item.remove) delete entry.t[item.taskId]; else if (!entry.t[item.taskId]) enqueueTask(s.entries, outcome.officeId, item.taskId, { at: item.at, priority: item.priority }); }
      if (outcome.syncAt) entry.s = outcome.syncAt;
      totals.strong += Number(outcome.stats?.strong || 0); totals.notified += Number(outcome.stats?.notified || 0); totals.fetched += Number(outcome.stats?.fetched || 0);
    }
    s.health = beat(s.health, {
      lastWorkAt: now.toISOString(), ...(totals.failed ? { lastFailureAt: now.toISOString(), lastFailure: outcomes.find((o) => o.failed)?.code || "" } : { lastOkAt: now.toISOString() }),
      rounds: Number(s.health?.rounds || 0) + outcomes.length, strong: Number(s.health?.strong || 0) + totals.strong, notified: Number(s.health?.notified || 0) + totals.notified
    });
    return s;
  });
  console.log("[scout] beat", JSON.stringify({ offices: outcomes.length, waiting: due.length - chosen.length, ...totals }));
  return { ok: true, offices: outcomes.length, waiting: due.length - chosen.length, ...totals };
}

// ------------------------------------------------------------------ the office's page

function boardFor(state) {
  return (state.board || []).filter((card) => [OPP_STATUS.NEW, OPP_STATUS.SAVED, OPP_STATUS.CONTACTED].includes(card.status));
}

/** Everything the scout page needs in one answer (no technical detail: no queue, no source logs, no model calls). */
export async function scoutOverview(ctx, { officeId, actor }) {
  if (!scoutAvailable(ctx.env)) return { ok: true, available: false };
  const office = (await ctx.store.get(["offices", officeId])) || {};
  const [settings, state, rows] = await Promise.all([loadSettings(ctx, officeId, office), loadState(ctx, officeId), ctx.store.list(["offices", officeId, "scoutTasks"], 100)]);
  const now = ctx.now();
  const rank = { ACTIVE: 0, PAUSED: 1, COMPLETED: 2, ENDED: 3 };
  const tasks = rows.map((task) => ({ ...taskView(task, now), status: task.status }))
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || MODE_CONFIG[b.mode].priority - MODE_CONFIG[a.mode].priority);
  const board = boardFor(state);
  const failing = Object.values(state.health?.sources || {}).some((s) => Number(s.fails || 0) >= 3);
  // Every source and its true state — connected, switched off by the office, failing, needing a permission, or not
  // available — so nobody assumes a site is being read when it is not.
  const sourceStatus = sourcesReport(ctx, office).filter((source) => source.kind !== "TEST").map((source) => {
    const seen = state.health?.sources?.[source.id] || {};
    const status = source.state === SOURCE_STATE.AVAILABLE
      ? (settings.sources?.[source.id] === false ? "OFF" : Number(seen.fails || 0) >= 1 ? "FAILING" : "CONNECTED")
      : source.state === SOURCE_STATE.UNAVAILABLE ? "UNAVAILABLE" : "NEEDS_PERMISSION";
    return { id: source.id, label: source.label, status, reason: text(source.reason, 240), lastOkAt: seen.lastOkAt || "" };
  });
  const excluded = (state.index || []).filter((entry) => entry.status === OPP_STATUS.IGNORED).slice(0, 20).map((entry) => {
    const entity = entityFromIndex(entry);
    return { id: entry.id, band: entry.band, category: entry.kind === "REQUEST" ? "REQUEST" : "OFFER", headline: entityHeadline(entity), price: priceLine(entity), why: [], recordId: "", recordTitle: "", taskId: "", at: entry.lastSeenAt || entry.firstSeenAt || "", status: OPP_STATUS.IGNORED, urgent: false, sources: Number(entry.sourceCount || 1), changed: "" };
  });
  return {
    ok: true, available: true, isManager: actor.isManager === true, settings, counters: scoutCounters({ board, tasks, now }), away: awaySummary(board),
    board: board.slice(0, 40), excluded, buckets: { ...bucketCounts(board), [BUCKET.EXCLUDED]: excluded.length },
    tasks: tasks.slice(0, 60), sources: sourcesForOffice(ctx, office, settings), sourceStatus,
    liveSearch: liveSearchAvailable(ctx.env),
    health: { failing, lastRoundAt: state.health?.lastCycleAt || "", lastSuccessAt: state.health?.lastOkAt || "" },
    limits: { feedChars: SCOUT_LIMITS.feedChars }, officeCity: text(office.city, 60)
  };
}

export async function saveScoutSettings(ctx, { actor, officeId, patch = {} }) {
  assertAvailable(ctx);
  if (!actor?.isManager) throw ctx.deps.appError("forbidden", 403, "إعدادات الباحث عن الفرص لمدير المكتب فقط");
  const office = (await ctx.store.get(["offices", officeId])) || {};
  const current = await loadSettings(ctx, officeId, office);
  const allowed = sourcesForOffice(ctx, office, current).map((s) => s.id);
  const sources = { ...current.sources };
  for (const [id, on] of Object.entries(patch.sources && typeof patch.sources === "object" ? patch.sources : {})) if (allowed.includes(id)) sources[id] = on !== false;
  const next = normalizeScoutSettings({ ...current, ...Object.fromEntries(Object.entries(patch).filter(([key]) => key in current)), sources }, office);
  const now = ctx.now();
  await ctx.store.set(settingsPath(officeId), { ...next, officeId, updatedAt: now, updatedBy: actor.uid });
  if (next.enabled !== current.enabled) {
    await writeAudit(ctx, { officeId, action: next.enabled ? AUDIT_ACTIONS.SCOUT_ENABLED : AUDIT_ACTIONS.SCOUT_DISABLED, actorUid: actor.uid, entityType: "scout", entityId: "main", key: now.toISOString() });
  }
  if (!next.enabled) {
    // Off: nothing runs for this office. Its searches, finds and settings stay exactly as they are.
    await mutateSchedule(ctx, (s) => { delete s.entries[officeId]; return s; });
    return { ok: true, settings: next };
  }
  // On (or interests changed): the inventory is read once now, and every running search is queued.
  const synced = await syncOfficeInventory(ctx, officeId, { settings: next, now });
  const running = (await ctx.store.list(["offices", officeId, "scoutTasks"], 100)).filter(isRunning);
  await applySchedule(ctx, officeId, (entries, entry) => {
    for (const item of synced.queue) if (item.remove) delete entry.t[item.taskId];
    for (const task of running) if (!entry.t[task.id]) enqueueTask(entries, officeId, task.id, { at: now.getTime(), priority: taskCadence(task, now).priority });
    entry.s = now.getTime() + SCOUT_LIMITS.syncHours * 3_600_000;
  });
  return { ok: true, settings: next, searches: running.length };
}

/** «ماذا تريد أن أبحث لك عنه؟» — the sentence is understood, nothing starts yet (the broker confirms with one press). */
export async function parseSearchText(ctx, { officeId, actor, text: raw }) {
  assertAvailable(ctx);
  const limited = consumePublicRateLimit(publicRateLimitKey({ route: "scout-parse", ip: actor.uid, officeId }), { limit: 30, windowMs: 60_000 });
  if (!limited.ok) throw ctx.deps.appError("rate_limited", 429, "محاولات كثيرة. حاول بعد قليل.");
  const sentence = text(raw, 600);
  if (sentence.length < 6) throw ctx.deps.appError("text_too_short", 400, "اكتب ما تريد البحث عنه: النوع والحي والسعر");
  const office = (await ctx.store.get(["offices", officeId])) || {};
  const settings = await loadSettings(ctx, officeId, office);
  const parsed = parseScoutCommand(sentence);
  if (!parsed.ok) return { ok: true, understood: false, message: "لم أفهم المطلوب — اكتب نوع العقار أو الحي أو الميزانية." };
  const assumed = [];
  if (!parsed.city && (settings.city || office.city)) { parsed.city = settings.city || text(office.city, 60); assumed.push("city"); }
  if (!parsed.tx) {
    // A written amount of half a million or more with no rent word reads as a sale; otherwise the office's own single line of work.
    if (parsed.priceMax >= 500_000 || parsed.priceMin >= 500_000) { parsed.tx = "sale"; assumed.push("tx"); }
    else if (settings.purposes.length === 1) { parsed.tx = settings.purposes[0]; assumed.push("tx"); }
  }
  if (settings.preferDirectOwner && !parsed.preferDirectOwner) parsed.preferDirectOwner = true;
  const check = validateCustomSearch(parsed, { defaultCity: parsed.city });
  return { ok: true, understood: true, draft: { ...check.value.profile, mode: check.value.mode, seek: check.value.seek, nlText: sentence }, summary: profileSummary(check.value.profile, check.value.seek), missing: Object.keys(check.errors), assumed };
}

/**
 * A search starts: queued at its mode's priority. What the scout already knows is judged for it at once (no source
 * is asked); an urgent search also runs its first full round now, inside this request, and then follows the schedule.
 */
async function launch(ctx, officeId, task, { now, write = true }) {
  if (write) await ctx.store.set(taskPath(officeId, task.id), task);
  const config = MODE_CONFIG[modeOf(task.mode)];
  await applySchedule(ctx, officeId, (entries) => enqueueTask(entries, officeId, task.id, { at: now.getTime(), priority: config.priority, keep: false }));
  const outcome = await runOfficeCycle(ctx, officeId, { taskIds: [task.id], inline: config.inlineFirstRun, onlySource: config.inlineFirstRun ? "" : "none", now })
    .catch((error) => { console.warn("[scout] first look failed", error?.code || error?.message); return null; });
  if (outcome && config.inlineFirstRun) await applyOutcome(ctx, officeId, outcome);
  return { found: Number(outcome?.stats?.strong || 0), firstRound: Boolean(outcome && config.inlineFirstRun) };
}

async function activeCount(ctx, officeId, origins) {
  const rows = await ctx.store.list(["offices", officeId, "scoutTasks"], 100);
  return rows.filter((t) => isRunning(t) && origins.includes(t.origin)).length;
}

async function requireOn(ctx, officeId) {
  assertAvailable(ctx);
  const office = (await ctx.store.get(["offices", officeId])) || {};
  const settings = await loadSettings(ctx, officeId, office);
  if (!settings.enabled) throw ctx.deps.appError("scout_off", 409, "الباحث عن الفرص متوقف في هذا المكتب — يشغّله مدير المكتب من الإعدادات");
  return { office, settings };
}

/** «+ بحث جديد»: a search with no record behind it (form or understood sentence). */
export async function createSearch(ctx, { actor, officeId, input = {}, requestKey = "" }) {
  const { office, settings } = await requireOn(ctx, officeId);
  const check = validateCustomSearch(input, { defaultCity: settings.city || text(office.city, 60) });
  if (!check.ok) {
    const error = ctx.deps.appError("search_invalid", 400, Object.values(check.errors)[0]);
    error.details = check.errors;
    throw error;
  }
  const now = ctx.now();
  const { mode, seek, profile, nlText } = check.value;
  const id = `st_c_${await shortHash(ctx, `${officeId}|${requestKey || now.toISOString()}|${JSON.stringify(profile)}|${seek}`, 24)}`;
  const existing = await ctx.store.get(taskPath(officeId, id));
  if (existing) return { ok: true, taskId: id, duplicate: true, found: 0 };
  if ((await activeCount(ctx, officeId, [TASK_ORIGIN.CUSTOM])) >= SCOUT_LIMITS.customTasks) throw ctx.deps.appError("search_limit", 409, `الحد ${SCOUT_LIMITS.customTasks} بحثًا مخصصًا نشطًا — أنهِ بحثًا قبل إضافة آخر`);
  const task = buildTask({ id, officeId, origin: TASK_ORIGIN.CUSTOM, mode, seek, profile, title: profileSummary(profile, seek), actorUid: actor.uid, nlText, now });
  const started = await launch(ctx, officeId, task, { now });
  await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.SCOUT_SEARCH_STARTED, actorUid: actor.uid, entityType: "scout", entityId: id, key: id, details: { mode, seek, tx: profile.tx, types: profile.propertyTypes, districts: profile.districts } });
  return { ok: true, taskId: id, mode, ...started };
}

/**
 * From inside an offer («ابحث عن مشتري») or a request («ابحث عن عقار»): one press. Everything is read from the
 * record; nothing is asked again. STOP keeps this record out of the scout without stopping the scout itself.
 */
export async function recordSearch(ctx, { actor, officeId, recordId, action = "STATUS", mode = "" }) {
  if (!scoutAvailable(ctx.env)) return { ok: true, available: false };
  const id = await recordTaskId(ctx, officeId, recordId);
  const existing = await ctx.store.get(taskPath(officeId, id));
  const now = ctx.now();
  if (action === "STATUS") {
    const settings = await loadSettings(ctx, officeId);
    return { ok: true, available: true, enabled: settings.enabled, task: existing ? taskView(existing, now) : null };
  }
  const row = await ctx.store.get(["offices", officeId, "opportunities", recordId]);
  if (!row || String(row.officeId || officeId) !== officeId) throw ctx.deps.appError("record_not_found", 404, "السجل غير موجود");
  const record = { ...row, id: recordId };
  if (!canActOn(actor, record)) throw ctx.deps.appError("office_os_forbidden", 403, "ليس لديك صلاحية على هذا السجل");
  if (action === "STOP") {
    if (!existing) {
      // Stopped before any search existed: remembered, so the general radar does not start one for this record.
      const lens = profileFromRecord(record);
      if (lens) await ctx.store.set(taskPath(officeId, id), { ...buildTask({ id, officeId, origin: TASK_ORIGIN.RECORD, mode: SCOUT_MODE.GENERAL, seek: lens.seek, profile: lens.profile, exactPrice: lens.exactPrice, title: taskTitle({}, record), recordId, recordKind: lens.recordKind, actorUid: actor.uid, now }), status: TASK_STATUS.PAUSED, statusReason: "BROKER", stoppedByBroker: true });
    } else await setTaskStatus(ctx, officeId, existing, TASK_STATUS.PAUSED, "BROKER", { byBroker: true });
    await applySchedule(ctx, officeId, (entries) => dequeueTask(entries, officeId, id));
    await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.SCOUT_SEARCH_CONTROLLED, actorUid: actor.uid, entityType: "record", entityId: recordId, key: `stop|${now.toISOString()}`, details: { action: "STOP" } });
    return { ok: true, task: taskView({ ...(existing || {}), id, status: TASK_STATUS.PAUSED }, now) };
  }
  await requireOn(ctx, officeId);
  const open = recordSearchState(record, now);
  if (!open.open) throw ctx.deps.appError("record_not_searchable", 409, `لا يمكن البحث لهذا السجل: ${END_REASON_LABEL[open.reason] || "السجل غير نشط"}`);
  const lens = profileFromRecord(record);
  if (!lens) throw ctx.deps.appError("record_not_searchable", 409, "بيانات السجل لا تكفي للبحث");
  const chosen = MODE_CONFIG[String(mode).toUpperCase()] ? String(mode).toUpperCase() : existing && isRunning(existing) ? modeOf(existing.mode) : record.validityUrgent === true ? SCOUT_MODE.URGENT : SCOUT_MODE.GENERAL;
  if (existing && isRunning(existing) && modeOf(existing.mode) === chosen) return { ok: true, taskId: id, duplicate: true, found: 0, task: taskView(existing, now) };
  const task = buildTask({ id, officeId, origin: TASK_ORIGIN.RECORD, mode: chosen, seek: lens.seek, profile: lens.profile, exactPrice: lens.exactPrice, title: taskTitle({}, record), recordId, recordKind: lens.recordKind, actorUid: actor.uid, brokerId: text(record.brokerId || record.originatingBrokerId, 128), now });
  // The same search keeps what it already found; only its mode (and its clock) start again.
  if (existing) Object.assign(task, { createdAt: existing.createdAt ? new Date(existing.createdAt) : now, stats: existing.stats || task.stats, cursors: existing.cursors || {} });
  await mutateState(ctx, officeId, (state) => ({ ...state, records: [...state.records.filter((r) => r.id !== recordId), recordDigest(record)] }));
  const started = await launch(ctx, officeId, task, { now });
  await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.SCOUT_SEARCH_STARTED, actorUid: actor.uid, entityType: "record", entityId: recordId, key: `${id}|${chosen}|${now.toISOString()}`, details: { mode: chosen, seek: lens.seek } });
  return { ok: true, taskId: id, mode: chosen, ...started, task: taskView(task, now) };
}

/** Each search has its own controls: pause, resume, end, run a round now, change its mode. The others are not touched. */
export async function controlSearch(ctx, { actor, officeId, taskId, action, mode = "" }) {
  assertAvailable(ctx);
  const id = text(taskId, 80);
  if (!/^st_[A-Za-z0-9_]{3,60}$/.test(id)) throw ctx.deps.appError("search_not_found", 404, "البحث غير موجود");
  const task = await ctx.store.get(taskPath(officeId, id));
  if (!task || String(task.officeId || officeId) !== officeId) throw ctx.deps.appError("search_not_found", 404, "البحث غير موجود");
  if (!canActOn(actor, task)) throw ctx.deps.appError("office_os_forbidden", 403, "هذا البحث يخص وسيطًا آخر");
  const now = ctx.now();
  const verb = TASK_CONTROL[String(action || "").toUpperCase()];
  if (!verb) throw ctx.deps.appError("search_action_invalid", 400, "إجراء غير معروف");
  let next = task;
  if (verb === TASK_CONTROL.PAUSE) {
    if (task.status !== TASK_STATUS.ACTIVE) return { ok: true, duplicate: true, task: taskView(task, now) };
    next = await setTaskStatus(ctx, officeId, task, TASK_STATUS.PAUSED, "BROKER", { byBroker: true });
    await applySchedule(ctx, officeId, (entries) => dequeueTask(entries, officeId, id));
  } else if (verb === TASK_CONTROL.END) {
    if ([TASK_STATUS.ENDED, TASK_STATUS.COMPLETED].includes(task.status)) return { ok: true, duplicate: true, task: taskView(task, now) };
    next = await setTaskStatus(ctx, officeId, task, TASK_STATUS.ENDED, "BROKER", { byBroker: true });
    await applySchedule(ctx, officeId, (entries) => dequeueTask(entries, officeId, id));
  } else {
    await requireOn(ctx, officeId);
    if (verb === TASK_CONTROL.RESUME) {
      if (task.status !== TASK_STATUS.PAUSED) return { ok: true, duplicate: true, task: taskView(task, now) };
      next = await setTaskStatus(ctx, officeId, task, TASK_STATUS.ACTIVE, "");
      await applySchedule(ctx, officeId, (entries) => enqueueTask(entries, officeId, id, { at: now.getTime(), priority: taskCadence(next, now).priority }));
    } else if (verb === TASK_CONTROL.SET_MODE) {
      const chosen = MODE_CONFIG[String(mode).toUpperCase()] ? String(mode).toUpperCase() : "";
      if (!chosen || task.origin === TASK_ORIGIN.DISCOVERY) throw ctx.deps.appError("search_mode_invalid", 400, "نوع البحث غير متاح لهذا البحث");
      if (task.status !== TASK_STATUS.ACTIVE) throw ctx.deps.appError("search_not_running", 409, "استأنف البحث أولًا");
      const patch = {
        mode: chosen, startedAt: now.toISOString(), intensiveUntil: MODE_CONFIG[chosen].windowHours ? new Date(now.getTime() + MODE_CONFIG[chosen].windowHours * 3_600_000).toISOString() : "",
        geoRing: Math.max(Number(task.geoRing || 0), MODE_CONFIG[chosen].startRing), indexChecked: false, updatedAt: now
      };
      await ctx.store.set(taskPath(officeId, id), patch);
      next = { ...task, ...patch };
      const started = await launch(ctx, officeId, next, { now, write: false });
      await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.SCOUT_SEARCH_CONTROLLED, actorUid: actor.uid, entityType: "scout", entityId: id, key: `${verb}|${now.toISOString()}`, details: { action: verb, mode: chosen } });
      return { ok: true, ...started, task: taskView(next, now) };
    } else if (verb === TASK_CONTROL.RUN_NOW) {
      if (task.status !== TASK_STATUS.ACTIVE) throw ctx.deps.appError("search_not_running", 409, "استأنف البحث أولًا");
      const limited = consumePublicRateLimit(publicRateLimitKey({ route: "scout-run-now", ip: id, officeId }), { limit: 4, windowMs: 10 * 60_000 });
      if (!limited.ok) throw ctx.deps.appError("rate_limited", 429, "شُغّل هذا البحث قبل قليل — انتظر بضع دقائق");
      const outcome = await runOfficeCycle(ctx, officeId, { taskIds: [id], inline: true, recheckKnown: true, now });
      await applyOutcome(ctx, officeId, outcome);
      return { ok: true, found: Number(outcome.stats?.strong || 0), checked: Number(outcome.stats?.fetched || 0), task: taskView((await ctx.store.get(taskPath(officeId, id))) || task, now) };
    }
  }
  await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.SCOUT_SEARCH_CONTROLLED, actorUid: actor.uid, entityType: "scout", entityId: id, key: `${verb}|${now.toISOString()}`, details: { action: verb } });
  return { ok: true, task: taskView(next, now) };
}

export async function searchDetail(ctx, { officeId, taskId }) {
  assertAvailable(ctx);
  const id = text(taskId, 80);
  const task = /^st_[A-Za-z0-9_]{3,60}$/.test(id) ? await ctx.store.get(taskPath(officeId, id)) : null;
  if (!task || String(task.officeId || officeId) !== officeId) throw ctx.deps.appError("search_not_found", 404, "البحث غير موجود");
  const state = await loadState(ctx, officeId);
  const now = ctx.now();
  return {
    ok: true, task: { ...taskView(task, now), summary: profileSummary(task.profile, task.seek), nlText: text(task.nlText, 600), startedAt: task.startedAt || "", intensiveUntil: task.intensiveUntil || "", veryStrong: Number(task.stats?.veryStrong || 0) },
    board: boardFor(state).filter((card) => card.taskId === id || (task.recordId && card.recordId === task.recordId)).slice(0, 20),
    liveSearch: liveSearchAvailable(ctx.env)
  };
}

// ------------------------------------------------------------------ one find: what the broker reads, and his decision

function confidenceLabel(entity) {
  const c = Number(entity.confidence ?? 0.6);
  return c >= 0.8 ? "ثقة مرتفعة في قراءة الإعلان" : c >= 0.5 ? "ثقة متوسطة في قراءة الإعلان" : "قراءة الإعلان غير مكتملة — تحقق من التفاصيل";
}

const OUTCOME_LABEL = Object.freeze({ INTERESTED: "مهتم — نكمل معه", CALL_LATER: "طلب التواصل لاحقًا", NO_ANSWER: "لم يرد", NOT_INTERESTED: "غير مهتم أو غير متاح" });

function findView(ctx, entity, { recordTitleText = "", record = null, now }) {
  const best = entity.links?.[0] || {};
  const phone = normPhone(entity.phone);
  const fresh = freshness(entity, now);
  return {
    id: entity.id, headline: entityHeadline(entity), price: priceLine(entity), area: entity.area ? `${formatNumber(entity.area)} م²` : "", rooms: Number(entity.rooms || 0),
    band: entity.band, bandLabel: BAND_LABEL[entity.band] || "", category: categoryOf(entity, best), categoryLabel: CATEGORY_LABEL[categoryOf(entity, best)],
    why: entity.reasons || [], notes: entity.warnings || [],
    // An estimate from stated rules (the matching engine's fit with the office's record or search) — never a certainty.
    fit: best.recordId || best.taskId ? Math.round(Number(best.fit || 0)) : 0,
    differences: matchDifferences(entity, record), missing: missingFacts(entity), completeness: completenessLabel(entity),
    discoveredAt: entity.firstSeenAt || "", publishedAt: entity.publishedAt || "", pinned: entity.pinned === true,
    outcome: entity.outcome || "", outcomeLabel: OUTCOME_LABEL[entity.outcome] || "", outcomeNote: text(entity.outcomeNote, 300), outcomeAt: entity.outcomeAt || "",
    followUpTaskId: entity.followUpTaskId || "",
    recordId: best.recordId || "", recordTitle: recordTitleText, taskId: best.taskId || "",
    sources: [...new Set((entity.sources || []).map((s) => s.label || sourceLabel(s.sourceId, ctx.env)))], sourceCount: Number(entity.sourceCount || 1),
    url: (entity.sources || []).map((s) => s.url).find((u) => /^https:\/\//.test(u || "")) || "",
    freshness: fresh.label || `شوهدت ${relativeAgo(entity.firstSeenAt, now) || "حديثًا"}`, firstSeenAt: entity.firstSeenAt || "",
    advertiser: ADVERTISER_LABEL[entity.advertiser] || "", confidence: confidenceLabel(entity),
    text: text(entity.text, 1500), status: entity.status || OPP_STATUS.NEW,
    contact: { phone, name: text(entity.contactName, 80), route: entity.contactRoute || "" },
    changes: (entity.changes || []).filter((c) => c.field === "price").slice(-3).map((c) => ({ at: c.at, from: Number(c.from), to: Number(c.to) })),
    // What «أضفها لسجلاتي» opens in the normal record form (reviewed and saved by the broker, then matched as any record).
    draft: {
      kind: entity.kind || "", purpose: entity.kind === "REQUEST" ? (entity.tx === "rent" ? "LEASE_REQUEST" : "PURCHASE") : (entity.tx === "rent" ? "RENT" : "SALE"), propertyType: entity.propertyType || "",
      city: entity.city || "", districts: [entity.district].filter(Boolean), price: Number(entity.price || 0), area: Number(entity.area || 0), rooms: Number(entity.rooms || 0), phone,
      features: [], urgent: null, notes: "", original: text(entity.text, 1500), missing: [], questions: [], understood: true
    },
    draftRole: entity.advertiser === "BROKER_LIKELY" ? "EXTERNAL_BROKER" : entity.kind === "REQUEST" ? "CLIENT" : "OWNER", draftTitle: listingTitle({ kind: entity.kind, propertyType: entity.propertyType, purpose: "", districts: [entity.district].filter(Boolean) })
  };
}

async function loadFind(ctx, officeId, opportunityId) {
  const id = text(opportunityId, 80);
  const entity = /^so_[A-Za-z0-9_]{6,60}$/.test(id) ? decodeFind(await ctx.store.get(findPath(officeId, id))) : null;
  if (!entity || String(entity.officeId || officeId) !== officeId) throw ctx.deps.appError("find_not_found", 404, "الفرصة غير موجودة");
  return entity;
}

export async function findDetail(ctx, { officeId, opportunityId }) {
  assertAvailable(ctx);
  const entity = await loadFind(ctx, officeId, opportunityId);
  const recordId = entity.links?.[0]?.recordId || "";
  const record = recordId ? await ctx.store.get(["offices", officeId, "opportunities", recordId]).catch(() => null) : null;
  let followUpOpen = false;
  if (entity.followUpTaskId) {
    const task = await ctx.store.get(["offices", officeId, "operations", entity.followUpTaskId]).catch(() => null);
    followUpOpen = Boolean(task) && !["COMPLETED", "DISMISSED", "EXPIRED"].includes(String(task.status || "").toUpperCase());
  }
  return { ok: true, find: { ...findView(ctx, entity, { recordTitleText: record ? recordTitle(record) : "", record, now: ctx.now() }), followUpOpen } };
}

/** «ابحث عن مطابقات»: this one find against the office's open records and running searches, now. */
async function recheckFind(ctx, { officeId, entity, now }) {
  const office = (await ctx.store.get(["offices", officeId])) || {};
  const [settings, state, rows] = await Promise.all([loadSettings(ctx, officeId, office), loadState(ctx, officeId), ctx.store.list(["offices", officeId, "scoutTasks"], 100)]);
  const running = rows.filter(isRunning).map((task) => ({ ...task, emptyCycles: 0 }));
  const judged = evaluateFind({
    entity, tasks: running, records: state.records || [], settings, sourceQuality: Math.max(0, ...(entity.sources || []).map((s) => sourceQuality(s.sourceId))) || 0.6,
    repeat: repeatCount(state.index || [], entity.phone, entity.id), now
  });
  const links = judged.links.slice(0, 5);
  const best = links[0] || null;
  const next = {
    ...entity, links, band: best ? best.band : BAND.WEAK, score: best ? best.score : 0, reasons: best ? best.reasons : [], warnings: best ? best.warnings : [],
    bestTaskId: best?.taskId || "", bestRecordId: best?.recordId || "", bestRecordKind: best?.recordKind || "", advertiser: judged.advertiser.kind, advertiserReasons: judged.advertiser.reasons, recheckedAt: now.toISOString()
  };
  // A find the broker already has on his page stays there; a hidden one appears only if it now deserves to.
  const decided = surfaceDecision({ band: next.band, contactable: isContactable(next), minQuality: settings.minQuality, status: next.status, pinned: next.pinned === true }).surface;
  next.surface = [OPP_STATUS.IGNORED, OPP_STATUS.CONVERTED].includes(next.status) ? SURFACE.HIDDEN : entity.surface === SURFACE.SHOWN ? SURFACE.SHOWN : decided;
  const record = best?.recordId ? (state.records || []).find((r) => r.id === best.recordId) : null;
  await ctx.store.set(findPath(officeId, entity.id), encodeFind(next, now));
  await mutateState(ctx, officeId, (current) => {
    const board = current.board.filter((card) => card.id !== entity.id);
    if (next.surface === SURFACE.SHOWN) board.unshift(boardCard(next, best || {}, { recordTitleText: record?.title || "", now }));
    return { ...current, board, index: current.index.map((entry) => (entry.id === entity.id ? indexEntry(next) : entry)) };
  });
  return { next, matched: links.filter((link) => link.recordId).length };
}

/** «أنشئ مهمة متابعة»: one task in the office's Daily Tasks for this find (the same one if pressed again). */
async function followUpTask(ctx, { actor, officeId, entity, now }) {
  const key = `SCOUT|${officeId}|${entity.id}|FOLLOW_UP`;
  const id = await operationDocumentId(key);
  const segments = ["offices", officeId, "operations", id];
  const existing = await ctx.store.get(segments);
  const open = existing && !["COMPLETED", "DISMISSED", "EXPIRED"].includes(String(existing.status || "").toUpperCase());
  if (open) return { id, created: false };
  const title = entityHeadline(entity);
  const reason = "تواصل مع المعلن وتحقق من التفاصيل، ثم سجّل نتيجة التواصل.";
  await ctx.store.set(segments, {
    schemaVersion: 1, id, officeId, assignedBrokerId: actor.uid, type: "SCOUT_FOLLOW_UP", sourceEntityType: "scout", sourceEntityId: entity.id,
    // The office's own record this find was matched with (if any) — so the card shows whose request or offer it serves.
    opportunityId: entity.bestRecordId || "", titleText: "متابعة فرصة خارجية", summaryText: reason, recommendedActionText: "فتح الفرصة", priority: "NORMAL", status: "OPEN",
    deduplicationKey: key, createdAt: existing?.createdAt ? new Date(existing.createdAt) : now, updatedAt: now, dueAt: new Date(now.getTime() + DAY), createdBySystem: false,
    completedAt: null, dismissedAt: null, operationVersion: Number(existing?.operationVersion || 0) + 1,
    metadataJson: JSON.stringify({ findId: entity.id, opportunityTitle: title, reason, actionLabel: "فتح الفرصة", lastEvent: "أُنشئت من الباحث عن الفرص", lastEventAt: now.toISOString() }), missingFieldsJson: "[]"
  });
  return { id, created: true };
}

/**
 * The broker's decision on a find. «تواصل» records only that he opened the contact himself — the scout sends
 * nothing to anyone, ever. «تجاهل» takes it off the board for good; «حفظ» keeps it; a find turned into a record
 * is marked so and continues as any record of the office.
 */
export async function actOnFind(ctx, { actor, officeId, opportunityId, action, recordId = "", result = "", note = "" }) {
  assertAvailable(ctx);
  const entity = await loadFind(ctx, officeId, opportunityId);
  const verb = OPP_ACTION[String(action || "").toUpperCase()];
  if (!verb) throw ctx.deps.appError("find_action_invalid", 400, "إجراء غير معروف");
  const now = ctx.now();
  if (verb === OPP_ACTION.RECHECK) {
    const { next, matched } = await recheckFind(ctx, { officeId, entity, now });
    await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.SCOUT_FIND_ACTION, actorUid: actor.uid, entityType: "scout", entityId: entity.id, key: `${verb}|${now.toISOString()}`, details: { action: verb, matched } });
    return { ok: true, status: next.status, matched, band: next.band };
  }
  const patch = { actedBy: actor.uid, actedAt: now.toISOString() };
  let task = null;
  if (verb === OPP_ACTION.FOLLOW_UP) {
    task = await followUpTask(ctx, { actor, officeId, entity, now });
    patch.followUpTaskId = task.id;
    if (entity.status === OPP_STATUS.NEW) patch.status = OPP_STATUS.SAVED;
  } else if (verb === OPP_ACTION.OUTCOME) {
    const chosen = String(result || "").toUpperCase();
    if (!OUTCOME_LABEL[chosen]) throw ctx.deps.appError("outcome_invalid", 400, "اختر نتيجة التواصل");
    Object.assign(patch, { outcome: chosen, outcomeNote: text(note, 300), outcomeAt: now.toISOString(), outcomeBy: actor.uid });
    if ([OPP_STATUS.NEW, OPP_STATUS.SAVED].includes(entity.status)) patch.status = OPP_STATUS.CONTACTED;
  }
  if (verb === OPP_ACTION.CONTACT) {
    if (!isContactable(entity)) throw ctx.deps.appError("find_not_contactable", 409, "لا توجد وسيلة تواصل لهذه الفرصة");
    if ([OPP_STATUS.NEW, OPP_STATUS.SAVED].includes(entity.status)) patch.status = OPP_STATUS.CONTACTED;
    patch.contactOpenedAt = now.toISOString();
  } else if (verb === OPP_ACTION.SAVE) patch.status = OPP_STATUS.SAVED;
  else if (verb === OPP_ACTION.IGNORE) Object.assign(patch, { status: OPP_STATUS.IGNORED, surface: SURFACE.HIDDEN });
  else if (verb === OPP_ACTION.RESTORE) {
    // Taken back by the broker himself: it returns to his page (he chose it), as a new find.
    Object.assign(patch, { status: OPP_STATUS.NEW, surface: SURFACE.SHOWN });
  } else if (verb === OPP_ACTION.CONVERTED) {
    const saved = text(recordId, 120);
    const record = saved ? await ctx.store.get(["offices", officeId, "opportunities", saved]) : null;
    if (!record || String(record.officeId || officeId) !== officeId) throw ctx.deps.appError("record_not_found", 404, "السجل غير موجود");
    Object.assign(patch, { status: OPP_STATUS.CONVERTED, surface: SURFACE.HIDDEN, convertedRecordId: saved });
  }
  // The follow-up task ends with the find: its result was recorded, it was excluded, or it became a record of the office.
  if (entity.followUpTaskId && [OPP_ACTION.OUTCOME, OPP_ACTION.IGNORE, OPP_ACTION.CONVERTED].includes(verb)) {
    await finishTasks(ctx.store, { officeId, taskIds: [entity.followUpTaskId], status: verb === OPP_ACTION.IGNORE ? "DISMISSED" : "COMPLETED", reason: verb === OPP_ACTION.IGNORE ? "استُبعدت الفرصة" : "", completedBy: actor.uid, now }).catch(() => {});
  }
  const next = { ...entity, ...patch };
  await ctx.store.set(findPath(officeId, entity.id), { ...patch, updatedAt: now });
  await mutateState(ctx, officeId, (state) => {
    const best = next.links?.[0] || {};
    const board = state.board.filter((card) => card.id !== entity.id);
    if (next.surface === SURFACE.SHOWN) board.unshift({ ...(state.board.find((card) => card.id === entity.id) || boardCard(next, best, { now })), status: next.status });
    return { ...state, board, index: state.index.map((entry) => (entry.id === entity.id ? { ...entry, status: next.status, surface: next.surface } : entry)) };
  });
  await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.SCOUT_FIND_ACTION, actorUid: actor.uid, entityType: "scout", entityId: entity.id, key: `${verb}|${now.toISOString()}`, details: { action: verb, recordId: patch.convertedRecordId || "" } });
  return { ok: true, status: next.status, contact: verb === OPP_ACTION.CONTACT ? { phone: normPhone(entity.phone), route: entity.contactRoute || "" } : undefined, taskId: task?.id || undefined, taskCreated: task ? task.created : undefined };
}

/**
 * «ابحث في الويب الآن»: the broker asks, Google Search answers (through the Gemini API), and the answer is shown
 * to him as it came — with its sources and Google's own search suggestions. Google's terms allow exactly this and
 * forbid collecting or keeping the results, so nothing here is stored, scored or turned into a find; the question
 * is built from the search itself (type, district, city, price) and carries no client's name or number.
 */
export async function liveSearchForTask(ctx, { actor, officeId, taskId }) {
  await requireOn(ctx, officeId);
  if (!liveSearchAvailable(ctx.env)) throw ctx.deps.appError("live_search_unavailable", 503, "البحث المباشر في الويب غير متاح على هذه البيئة");
  const id = text(taskId, 80);
  const task = /^st_[A-Za-z0-9_]{3,60}$/.test(id) ? await ctx.store.get(taskPath(officeId, id)) : null;
  if (!task || String(task.officeId || officeId) !== officeId) throw ctx.deps.appError("search_not_found", 404, "البحث غير موجود");
  const mine = consumePublicRateLimit(publicRateLimitKey({ route: "scout-live", ip: actor.uid, officeId }), { limit: 6, windowMs: 10 * 60_000 });
  const office = consumePublicRateLimit(publicRateLimitKey({ route: "scout-live-office", ip: "office", officeId }), { limit: SCOUT_LIMITS.livePerOfficeDay, windowMs: DAY });
  if (!mine.ok || !office.ok) throw ctx.deps.appError("rate_limited", 429, "بحثت في الويب كثيرًا خلال وقت قصير — حاول بعد قليل");
  const form = planQueries(task).find((f) => (f.propertyTypes || []).length || (f.districts || []).length);
  if (!form) throw ctx.deps.appError("search_too_wide", 400, "حدّد نوع العقار أو الحي في هذا البحث أولًا");
  const profile = task.profile || {};
  const price = profile.priceMax ? ` بسعر حتى ${formatNumber(profile.priceMax)} ريال` : profile.priceMin ? ` بسعر من ${formatNumber(profile.priceMin)} ريال` : task.exactPrice ? ` بسعر قريب من ${formatNumber(task.exactPrice)} ريال` : "";
  const question = `${webQueryText(form)}${price} — إعلانات حديثة`;
  const result = await liveWebSearch(ctx.env, { question });
  if (!result.ok) {
    if (result.code === "quota") throw ctx.deps.appError("live_search_quota", 429, "بلغ البحث المباشر حدّه الآن — حاول لاحقًا");
    throw ctx.deps.appError("live_search_unavailable", 503, result.code === "not_available" ? "البحث المباشر في الويب غير مفعّل على هذه البيئة" : "تعذر البحث في الويب الآن — حاول بعد قليل");
  }
  await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.SCOUT_SEARCH_CONTROLLED, actorUid: actor.uid, entityType: "scout", entityId: task.id, key: `live|${ctx.now().toISOString()}`, details: { action: "LIVE_WEB", grounded: result.grounded } });
  return { ok: true, question, grounded: result.grounded, answer: result.answer, sources: result.sources, suggestions: result.suggestions };
}

/**
 * «زوّد الباحث»: the broker pastes what reached him (a group digest, several ads). The scout reads all of it now,
 * against every running search and the office's open records, and answers with the few worth his time — instead
 * of forty records to review. The text stays the office's own.
 */
export async function feedScout(ctx, { actor, officeId, text: raw, channel = "", link = "" }) {
  await requireOn(ctx, officeId);
  const limited = consumePublicRateLimit(publicRateLimitKey({ route: "scout-feed", ip: actor.uid, officeId }), { limit: SCOUT_LIMITS.feedPerHour, windowMs: 3_600_000 });
  if (!limited.ok) throw ctx.deps.appError("rate_limited", 429, "زوّدت الباحث كثيرًا خلال الساعة — حاول لاحقًا");
  const body = typeof raw === "string" ? raw.trim() : "";
  if (body.length < 20) throw ctx.deps.appError("text_too_short", 400, "الصق إعلانًا واحدًا على الأقل بتفاصيله");
  if (body.length > SCOUT_LIMITS.feedChars) throw ctx.deps.appError("text_too_long", 413, `النص طويل — الحد ${SCOUT_LIMITS.feedChars} حرف في المرة الواحدة`);
  const now = ctx.now();
  const blocks = splitDigest(body);
  const ads = blocks.length;
  // One ad (a link, or one pasted ad) is the broker's own choice: it is kept on his page whatever its level.
  // A digest of many is filtered as usual — only what deserves his time is kept.
  const pinned = ads === 1;
  const source = /^https:\/\/[^\s]{4,480}$/.test(String(link || "")) && pinned ? String(link) : "";
  // What was read from each ad — shown back to the broker, with what the ad did not say (nothing is guessed).
  const read = blocks.slice(0, 6).map((block) => {
    const c = candidateFromRaw({ text: block });
    return { understood: Boolean(c.understood && c.kind), headline: c.understood && c.kind ? entityHeadline(c) : "", kind: c.kind || "", tx: c.tx || "", propertyType: c.propertyType || "", city: c.city || "", district: c.district || "", price: Number(c.price || 0), area: Number(c.area || 0), missing: c.understood && c.kind ? missingFacts({ ...c, contactRoute: source }) : [] };
  });
  const id = `sf_${String(9_999_999_999_999 - now.getTime()).padStart(13, "0")}_${await shortHash(ctx, `${officeId}|${actor.uid}|${now.getTime()}`, 6)}`;
  await ctx.store.set(["offices", officeId, "scoutFeed", id], { officeId, text: body, channel: ["WHATSAPP", "TELEGRAM", "LINK", "FILE", "OTHER"].includes(channel) ? channel : "", link: source, pinned, createdBy: actor.uid, createdAt: now });
  const running = (await ctx.store.list(["offices", officeId, "scoutTasks"], 100)).filter(isRunning)
    .sort((a, b) => MODE_CONFIG[modeOf(b.mode)].priority - MODE_CONFIG[modeOf(a.mode)].priority).slice(0, 12).map((t) => t.id);
  if (!running.length && !pinned) return { ok: true, ads, read, strong: 0, kept: 0, cards: [], note: "حُفظ النص — لا توجد عمليات بحث نشطة الآن، وسيُقرأ عند بدء أول بحث." };
  const schedule = await loadSchedule(ctx);
  const outcome = await runOfficeCycle(ctx, officeId, { taskIds: running, runtime: schedule.entries[officeId]?.t || {}, inline: true, onlySource: "broker_feed", sinceMs: now.getTime() - 1000, now });
  // A fed round does not move the searches' own clocks (their next scheduled round stays where it was).
  return {
    ok: true, ads, read, strong: Number(outcome.stats?.strong || 0), kept: Number(outcome.stats?.kept || 0), merged: Number(outcome.stats?.merged || 0) + Number(outcome.stats?.known || 0),
    inInventory: Number(outcome.stats?.inInventory || 0), cards: (outcome.cards || []).slice(0, 10)
  };
}

const LINK_REASON = Object.freeze({
  restricted: "هذا الموقع لا يسمح بقراءة صفحاته آليًا — الصق نص الإعلان، ويُحفظ الرابط معه مصدرًا له.",
  robots: "هذا الموقع يمنع القراءة الآلية لهذه الصفحة — الصق نص الإعلان، ويُحفظ الرابط معه مصدرًا له.",
  unreadable: "لم أجد في الصفحة وصفًا كافيًا للإعلان — الصق نص الإعلان، ويُحفظ الرابط معه مصدرًا له.",
  failed: "تعذر فتح الصفحة الآن — الصق نص الإعلان، ويُحفظ الرابط معه مصدرًا له."
});

/**
 * «أدخل رابط الإعلان»: the broker gives the ad's address. Where the site allows a page to be read (its robots.txt,
 * and it is not one of the sites whose terms forbid it) the page's own title and description are read — one page,
 * once, because he asked. Where it does not, he pastes the ad's text and the link is kept as its source.
 */
export async function importScoutLink(ctx, { actor, officeId, url, text: raw = "" }) {
  await requireOn(ctx, officeId);
  const link = String(url || "").trim();
  let target = null;
  try { target = new URL(link); } catch (_) { /* handled below */ }
  if (!target || target.protocol !== "https:" || link.length > 480) throw ctx.deps.appError("link_invalid", 400, "الرابط غير صالح — يبدأ بـ https://");
  let body = typeof raw === "string" ? raw.trim() : "";
  let readFrom = "text";
  if (body.length < 20) {
    const limited = consumePublicRateLimit(publicRateLimitKey({ route: "scout-link", ip: actor.uid, officeId }), { limit: 20, windowMs: 3_600_000 });
    if (!limited.ok) throw ctx.deps.appError("rate_limited", 429, "أدخلت روابط كثيرة خلال الساعة — حاول لاحقًا");
    const page = await readLinkedPage(ctx.env, target.toString());
    if (!page.ok) return { ok: true, needsText: true, reason: page.reason, message: LINK_REASON[page.reason] || LINK_REASON.failed };
    body = page.text;
    readFrom = "page";
  }
  return { ...(await feedScout(ctx, { actor, officeId, text: body, channel: "LINK", link: target.toString() })), readFrom };
}

/** Platform observability (admin only): is the scheduler beating, which sources are usable and why not — no office data. */
export async function scoutHealthReport(ctx) {
  const schedule = scoutAvailable(ctx.env) ? await loadSchedule(ctx) : { entries: {}, health: {} };
  const offices = Object.values(schedule.entries || {});
  const nowMs = ctx.now().getTime();
  return {
    ok: true, available: scoutAvailable(ctx.env), scheduler: schedule.health || {},
    offices: offices.length, searches: offices.reduce((sum, entry) => sum + Object.keys(entry.t || {}).length, 0),
    due: offices.reduce((sum, entry) => sum + Object.values(entry.t || {}).filter((t) => Number(t.n || 0) <= nowMs).length, 0),
    byPriority: [3, 2, 1].map((p) => ({ priority: p, searches: offices.reduce((sum, entry) => sum + Object.values(entry.t || {}).filter((t) => Number(t.p) === p).length, 0) })),
    sources: sourcesReport(ctx, {}), aiConfigured: smartFillAiStatus(ctx.env) === "configured"
  };
}
