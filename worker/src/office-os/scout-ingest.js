/**
 * «الباحث عن الفرص» — automatic intake of results that an assistant (Claude, or any tool the office authorises)
 * found for the office. It replaces «download a CSV → upload it → paste it» with one authenticated request.
 *
 *   POST /os/scout/ingest      Authorization: Bearer iqk.<officeId>.<keyId>.<secret>
 *   { batchId, agent, search?, items: [{ url, title, text, kind, tx, propertyType, city, district, plan,
 *                                         price, area, rooms, publishedAt, adId, sourceName }] }
 *
 * Rules of this file:
 *   • The office is the one written in the key, never a value in the body. A key belongs to one office, is shown
 *     once, is stored only as a hash, and the manager can revoke it at any moment (it then stops at once).
 *   • Off unless SCOUT_INGEST = "enabled" on the Worker (Staging only) AND the office's scout is on. Removing the
 *     variable stops the door for every office without touching anything else.
 *   • Every item lands where a pasted ad lands: offices/{o}/scoutFeed → the same broker_feed source → the same
 *     smart-fill understanding → the same merging and the same matching engine. No second pipeline.
 *   • What arrives is an outside find «قيد المراجعة» — never an office record, never «مفوّض بالتسويق», never a
 *     licence. The body cannot set any status, office, licence or approval.
 *   • A site whose terms forbid collecting its listings (عقار، حراج، بيوت، وصلت) is refused here too, item by item,
 *     unless the platform has a data agreement with it (SCOUT_INGEST_LICENSED_HOSTS). Its link is never fetched.
 *   • Replays are safe: the same batchId answers its first report; the same ad (same link, or same ad id, or the
 *     same text) is the same feed document — an update when something changed, otherwise counted as a duplicate.
 *   • Ad texts are data, never instructions, and are never logged.
 */

import { SEARCH_EXCLUDED_DOMAINS, publicHttpsUrl } from "./scout-web.js";
import { consumePublicRateLimit, publicRateLimitKey } from "../public-rate-limit.js";
import { AUDIT_ACTIONS, writeAudit } from "./audit-log.js";
import { loadSchedule, loadSettings, isRunning, SCOUT_LIMITS } from "./scout-store.js";
import { scoutAvailable } from "./scout-store.js";
import { MODE_CONFIG, modeOf } from "../../../public/os/domain/scout-domain.js";

export const INGEST_LIMITS = Object.freeze({
  itemsPerBatch: 20,       // what one round of the broker_feed source reads at once
  textChars: 2000,
  bodyBytes: 120_000,
  batchesPerHourPerKey: 60,
  keysPerOffice: 5
});

const TOKEN = /^iqk\.([A-Za-z0-9_-]{2,80})\.([a-z0-9]{8,24})\.([A-Za-z0-9_-]{32,64})$/;
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|igshid|mc_cid|mc_eid|ref|ref_src|s|si|share|from)$/i;
const text = (value, max = 200) => String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").trim().slice(0, max);
const num = (value) => { const n = Number(String(value ?? "").replace(/[,٬\s]/g, "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))); return Number.isFinite(n) && n > 0 && n < 10_000_000_000 ? Math.round(n) : 0; };

export function ingestAvailable(env = {}) {
  return scoutAvailable(env) && String(env.SCOUT_INGEST || "").toLowerCase() === "enabled";
}

/** The hosts the platform has a signed data agreement with (set on the Worker); nothing else of the listing platforms passes. */
export function licensedHosts(env = {}) {
  return String(env.SCOUT_INGEST_LICENSED_HOSTS || "").split(/[,\s]+/).map((h) => h.toLowerCase().replace(/^www\./, "")).filter((h) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h));
}

const hostOf = (url) => url.hostname.toLowerCase().replace(/^www\./, "");
const listed = (host, list) => list.some((d) => host === d || host.endsWith(`.${d}`));

/** One address for one ad: https only, no tracking parameters, no fragment, no trailing slash. */
export function canonicalAdUrl(value) {
  const url = publicHttpsUrl(text(value, 600));
  if (!url) return "";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const out = url.toString().replace(/\/(\?|$)/, "$1");
  return out.length <= 480 ? out : "";
}

/**
 * One item of a batch → what is stored, or why it is refused. Pure (tests call it directly).
 * Returns { ok, reason, doc } — doc has the text the shared understanding reads and the structured fields given.
 */
export function prepareItem(raw, { env = {} } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "not_an_object" };
  const rawUrl = text(raw.url, 600);
  const url = rawUrl ? canonicalAdUrl(rawUrl) : "";
  if (rawUrl && !url) return { ok: false, reason: "link_invalid" };
  if (url) {
    const host = hostOf(new URL(url));
    if (listed(host, SEARCH_EXCLUDED_DOMAINS) && !listed(host, licensedHosts(env))) return { ok: false, reason: "source_restricted", host };
  }
  const plan = text(raw.plan, 80).replace(/^مخطط\s*/, "");
  const title = text(raw.title, 160);
  const body = text(raw.text ?? raw.description, INGEST_LIMITS.textChars);
  const facts = [
    raw.city ? `المدينة: ${text(raw.city, 60)}` : "",
    raw.district ? `الحي: ${text(raw.district, 60).replace(/^حي\s+/, "")}` : "",
    plan ? `المخطط: مخطط ${plan}` : ""
  ].filter(Boolean).join(" — ");
  const composed = [title, body, facts].filter(Boolean).join("\n").slice(0, INGEST_LIMITS.textChars);
  if (composed.replace(/\s+/g, "").length < 20) return { ok: false, reason: "text_too_short" };
  const kind = ["OFFER", "REQUEST"].includes(String(raw.kind || "").toUpperCase()) ? String(raw.kind).toUpperCase() : "";
  const tx = ["sale", "rent"].includes(String(raw.tx || "").toLowerCase()) ? String(raw.tx).toLowerCase() : "";
  const structured = Object.fromEntries(Object.entries({
    kind, tx, propertyType: text(raw.propertyType, 40), city: text(raw.city, 60), district: text(raw.district, 60).replace(/^حي\s+/, ""),
    price: num(raw.price), area: num(raw.area), rooms: Math.min(50, num(raw.rooms))
  }).filter(([, v]) => v !== "" && v !== 0));
  const publishedAt = (() => { const t = Date.parse(text(raw.publishedAt, 40)); return Number.isFinite(t) && t > 0 && t <= Date.now() + 86_400_000 ? new Date(t).toISOString() : ""; })();
  return {
    ok: true,
    doc: {
      text: composed, title, link: url, plan, structured, publishedAt,
      adId: text(raw.adId ?? raw.id, 80).replace(/[^\w.-]/g, ""), sourceName: text(raw.sourceName, 60)
    }
  };
}

async function hash(ctx, value, length = 32) {
  return (await ctx.deps.sha256Hex(String(value))).slice(0, length);
}

function randomToken(bytes) {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const keyPath = (officeId, keyId) => ["offices", officeId, "scoutIngestKeys", keyId];
const keyView = (key) => ({
  keyId: key.keyId || key.id, label: key.label || "", hint: key.hint || "", createdAt: key.createdAt || "", lastUsedAt: key.lastUsedAt || "",
  uses: Number(key.uses || 0), revoked: Boolean(key.revokedAt), revokedAt: key.revokedAt || ""
});

function assertIngest(ctx) {
  if (!ingestAvailable(ctx.env)) throw ctx.deps.appError("ingest_unavailable", 503, "الاستقبال التلقائي غير مفعّل على هذه البيئة");
}

// ------------------------------------------------------------------ keys (the manager's)

export async function listIngestKeys(ctx, { officeId, actor }) {
  if (!ingestAvailable(ctx.env)) return { ok: true, available: false, keys: [] };
  if (!actor?.isManager) throw ctx.deps.appError("forbidden", 403, "مفاتيح الاستقبال لمدير المكتب فقط");
  const rows = await ctx.store.list(["offices", officeId, "scoutIngestKeys"], 50);
  return { ok: true, available: true, keys: rows.map(keyView).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))), endpoint: "/os/scout/ingest", limits: INGEST_LIMITS, mcp: String(ctx.env?.MCP_SERVER || "").toLowerCase() === "enabled" };
}

/** A new key: shown once, kept as a hash only. */
export async function createIngestKey(ctx, { officeId, actor, label = "", scope = "scout:ingest" }) {
  if (scope === "scout:ingest") assertIngest(ctx);
  else if (scope !== "mcp:read" || String(ctx.env?.MCP_SERVER || "").toLowerCase() !== "enabled") throw ctx.deps.appError("ingest_unavailable", 503, "غير مفعّل على هذه البيئة");
  if (!actor?.isManager) throw ctx.deps.appError("forbidden", 403, "مفاتيح الاستقبال لمدير المكتب فقط");
  const rows = await ctx.store.list(["offices", officeId, "scoutIngestKeys"], 50);
  if (rows.filter((k) => !k.revokedAt).length >= INGEST_LIMITS.keysPerOffice) throw ctx.deps.appError("key_limit", 409, `الحد ${INGEST_LIMITS.keysPerOffice} مفاتيح فعّالة — ألغِ مفتاحًا قبل إنشاء آخر`);
  const keyId = (await hash(ctx, `${officeId}|${Date.now()}|${randomToken(8)}`, 12)).toLowerCase();
  const secret = randomToken(32);
  const token = `iqk.${officeId}.${keyId}.${secret}`;
  const now = ctx.now();
  await ctx.store.set(keyPath(officeId, keyId), {
    keyId, officeId, label: text(label, 60) || "Claude", scope, secretHash: await hash(ctx, `iqk|${secret}`, 64),
    hint: `…${secret.slice(-4)}`, createdBy: actor.uid, createdAt: now.toISOString(), lastUsedAt: "", uses: 0, revokedAt: ""
  });
  await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.SCOUT_INGEST_KEY_CREATED, actorUid: actor.uid, entityType: "scout", entityId: keyId, key: keyId });
  return { ok: true, key: { keyId, label: text(label, 60) || "Claude" }, token, shownOnce: true };
}

export async function revokeIngestKey(ctx, { officeId, actor, keyId }) {
  if (!actor?.isManager) throw ctx.deps.appError("forbidden", 403, "مفاتيح الاستقبال لمدير المكتب فقط");
  const id = String(keyId || "").replace(/[^a-z0-9]/g, "").slice(0, 24);
  const key = id ? await ctx.store.get(keyPath(officeId, id)) : null;
  if (!key) throw ctx.deps.appError("key_not_found", 404, "المفتاح غير موجود");
  if (!key.revokedAt) {
    await ctx.store.set(keyPath(officeId, id), { revokedAt: ctx.now().toISOString(), revokedBy: actor.uid });
    await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.SCOUT_INGEST_KEY_REVOKED, actorUid: actor.uid, entityType: "scout", entityId: id, key: id });
  }
  return { ok: true, keyId: id, revoked: true };
}

/** The bearer token → its office and key, or a refusal that says nothing about which part was wrong. */
export async function authenticateIngest(ctx, authorization = "", scope = "scout:ingest") {
  const refused = () => ctx.deps.appError("ingest_unauthorized", 401, "مفتاح الاستقبال غير صالح أو أُلغي");
  const match = String(authorization || "").match(/^Bearer\s+(\S+)$/i);
  const parts = match ? match[1].match(TOKEN) : null;
  if (!parts) throw refused();
  const [, officeId, keyId, secret] = parts;
  if (officeId === "platform") throw refused();
  const key = await ctx.store.get(keyPath(officeId, keyId));
  if (!key || key.revokedAt || key.scope !== scope || String(key.officeId) !== officeId) throw refused();
  const presented = await hash(ctx, `iqk|${secret}`, 64);
  let diff = presented.length ^ String(key.secretHash || "").length;
  for (let i = 0; i < presented.length; i += 1) diff |= presented.charCodeAt(i) ^ String(key.secretHash || "").charCodeAt(i);
  if (diff !== 0) throw refused();
  return { officeId, keyId, key };
}

// ------------------------------------------------------------------ the batch

const REASON_LABEL = Object.freeze({
  not_an_object: "عنصر غير صالح",
  link_invalid: "رابط غير صالح (https فقط)",
  source_restricted: "شروط هذا الموقع تمنع جمع إعلاناته آليًا — لا يُستقبل إلا باتفاقية بيانات معه",
  text_too_short: "لا يوجد وصف كافٍ للإعلان"
});

/**
 * One batch from an authorised assistant. Stored, merged and judged like an ad the broker pasted himself;
 * the answer counts what was received, saved, updated, repeated and refused (with the reason per item).
 */
export async function ingestScoutBatch(ctx, { authorization, body = {}, rawLength = 0, runCycle }) {
  assertIngest(ctx);
  const { officeId, keyId } = await authenticateIngest(ctx, authorization);
  if (rawLength > INGEST_LIMITS.bodyBytes) throw ctx.deps.appError("payload_too_large", 413, `الحد ${INGEST_LIMITS.bodyBytes} بايت للدفعة`);
  const limited = consumePublicRateLimit(publicRateLimitKey({ route: "scout-ingest", ip: keyId, officeId }), { limit: INGEST_LIMITS.batchesPerHourPerKey, windowMs: 3_600_000 });
  if (!limited.ok) throw ctx.deps.appError("rate_limited", 429, "دفعات كثيرة خلال الساعة — حاول لاحقًا");
  if (body.officeId && String(body.officeId) !== officeId) throw ctx.deps.appError("office_mismatch", 403, "المفتاح لا يخص هذا المكتب");
  const batchKey = text(body.batchId, 120);
  if (batchKey.length < 6) throw ctx.deps.appError("batch_id_required", 400, "batchId مطلوب (6 أحرف على الأقل) لضمان عدم التكرار عند إعادة المحاولة");
  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || !items.length) throw ctx.deps.appError("items_required", 400, "items مطلوبة (قائمة إعلانات)");
  if (items.length > INGEST_LIMITS.itemsPerBatch) throw ctx.deps.appError("too_many_items", 413, `الحد ${INGEST_LIMITS.itemsPerBatch} إعلانًا في الدفعة الواحدة — قسّمها إلى دفعات`);

  const office = (await ctx.store.get(["offices", officeId])) || {};
  const settings = await loadSettings(ctx, officeId, office);
  if (!settings.enabled) throw ctx.deps.appError("scout_off", 409, "الباحث عن الفرص متوقف في هذا المكتب — يشغّله مدير المكتب أولًا");

  const batchId = `ib_${await hash(ctx, `${officeId}|${keyId}|${batchKey}`, 32)}`;
  const batchPath = ["offices", officeId, "scoutIngestBatches", batchId];
  const previous = await ctx.store.get(batchPath);
  if (previous?.status === "DONE" && previous.reportJson) {
    return { ...JSON.parse(previous.reportJson), replay: true };
  }

  const now = ctx.now();
  const agent = text(body.agent, 40) || "assistant";
  const report = { ok: true, batchId: batchKey, officeId, received: items.length, saved: 0, updated: 0, duplicates: 0, rejected: [], strong: 0, kept: 0, cards: [] };
  const written = [];
  for (let index = 0; index < items.length; index += 1) {
    const prepared = prepareItem(items[index], { env: ctx.env });
    if (!prepared.ok) { report.rejected.push({ index, reason: prepared.reason, message: REASON_LABEL[prepared.reason] || "مرفوض" }); continue; }
    const doc = prepared.doc;
    // The ad's identity: its link, else the source's own ad id, else its text.
    const identity = doc.link || (doc.adId ? `${doc.sourceName || agent}|${doc.adId}` : doc.text.replace(/\s+/g, " "));
    const feedId = `sf_ci_${await hash(ctx, `${officeId}|${identity}`, 28)}`;
    const contentHash = await hash(ctx, JSON.stringify([doc.text, doc.structured]), 24);
    const path = ["offices", officeId, "scoutFeed", feedId];
    const existing = await ctx.store.get(path);
    if (existing && existing.contentHash === contentHash) { report.duplicates += 1; continue; }
    await ctx.store.set(path, {
      officeId, text: doc.text, title: doc.title, channel: "AGENT", agent, link: doc.link, pinned: true, single: true,
      structured: JSON.stringify(doc.structured), plan: doc.plan, publishedAt: doc.publishedAt, adId: doc.adId, sourceName: doc.sourceName,
      contentHash, ingestKeyId: keyId, ingestBatchId: batchId, reviewStatus: "PENDING_REVIEW",
      createdBy: `ingest:${keyId}`, createdAt: now, firstSeenAt: existing?.firstSeenAt || now.toISOString(), updatedAt: now
    });
    written.push(feedId);
    if (existing) report.updated += 1; else report.saved += 1;
  }

  // The same round a pasted ad gets: understood, merged with what the office already knows, matched, levelled.
  if (written.length && typeof runCycle === "function") {
    const running = (await ctx.store.list(["offices", officeId, "scoutTasks"], 100)).filter(isRunning)
      .sort((a, b) => MODE_CONFIG[modeOf(b.mode)].priority - MODE_CONFIG[modeOf(a.mode)].priority).slice(0, 12).map((t) => t.id);
    const schedule = await loadSchedule(ctx);
    try {
      const outcome = await runCycle(ctx, officeId, { taskIds: running, runtime: schedule.entries[officeId]?.t || {}, inline: true, onlySource: "broker_feed", sinceMs: now.getTime() - 1000, now });
      report.strong = Number(outcome?.stats?.strong || 0);
      report.kept = Number(outcome?.stats?.kept || 0);
      report.merged = Number(outcome?.stats?.merged || 0) + Number(outcome?.stats?.known || 0);
      report.inInventory = Number(outcome?.stats?.inInventory || 0);
      report.cards = (outcome?.cards || []).slice(0, 10);
    } catch (error) {
      // Stored is stored: the next scheduled round reads them. The caller is told, and may retry safely.
      report.processing = "DEFERRED";
      console.warn("[scout-ingest] round deferred", error?.code || error?.message);
    }
  }
  report.searches = text(JSON.stringify(body.search && typeof body.search === "object" ? body.search : {}), 600);
  report.note = "حُفظت النتائج كفرص خارجية قيد المراجعة في «الباحث عن الفرص» — لا تصبح عرضًا أو طلبًا معتمدًا إلا باعتماد الوسيط.";

  await ctx.store.set(batchPath, {
    officeId, keyId, agent, status: "DONE", received: report.received, saved: report.saved, updated: report.updated, duplicates: report.duplicates,
    rejected: report.rejected.length, reportJson: JSON.stringify({ ...report, cards: report.cards.slice(0, 5) }).slice(0, 60_000), createdAt: now
  });
  await ctx.store.set(keyPath(officeId, keyId), { lastUsedAt: now.toISOString(), uses: Number((await ctx.store.get(keyPath(officeId, keyId)))?.uses || 0) + 1 });
  await writeAudit(ctx, { officeId, action: AUDIT_ACTIONS.SCOUT_INGEST_BATCH, actorUid: `ingest:${keyId}`, entityType: "scout", entityId: batchId, key: batchId,
    details: { agent, received: report.received, saved: report.saved, updated: report.updated, duplicates: report.duplicates, rejected: report.rejected.length } });
  return { ...report, replay: false };
}

export { SCOUT_LIMITS };
