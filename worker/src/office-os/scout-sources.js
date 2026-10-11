/**
 * «الباحث عن الفرص» — source adapters.
 *
 * One small contract, so a source is added (or switched off) without touching the scout itself:
 *
 *   id, label                      the name the office reads in the settings
 *   access { method, basis }       HOW the scout reads it and ON WHAT BASIS it may — written once, here
 *   quality 0…1                    how much a find from it is trusted (part of the explainable score)
 *   availability(ctx, office)      { state: AVAILABLE | NOT_CONFIGURED | UNAVAILABLE, reason }
 *   fetch(ctx, { officeId, since, limit, forms })  → { items: RawItem[] }
 *
 *   RawItem { sourceId, externalId, text, title, url, phone, contactName, contactRoute, publishedAt, at,
 *             structured { kind, tx, propertyType, city, district, price, area, rooms }, advertiserHint }
 *
 * Rules of this file:
 *   • Only sources the office is entitled to read. A website is never read against its terms or its robots.txt,
 *     and nothing here logs in, rotates addresses or imitates a browser to get around a refusal.
 *   • عقار، حراج، بيوت and وصلت are registered as needing a permission, with the reason found when their terms were
 *     checked; they have no fetch code. They become usable only through a data agreement, which then arrives as
 *     «تغذية مرخّصة». Until then the broker enters an ad's link with its text himself.
 *   • WhatsApp is not crawled: only messages that reached the office through its official integration are read.
 *   • The open web is asked through a web-search API only (scout-web.js): result pages are never opened, and
 *     sites that forbid collecting their listings are left out of the results too.
 *   • Logs carry counts and codes — never a phone, a name or an ad's text.
 */

import { splitDigest } from "../../../public/os/domain/scout-domain.js";
import { postsSearchAdapter, webSearchAdapter } from "./scout-web.js";

/**
 * AVAILABLE          connected: the scout reads it now
 * NOT_CONFIGURED     ready in the code, waiting for a key the platform has not set (a paid service is never switched on by itself)
 * NEEDS_PERMISSION   the site's terms forbid automated reading; usable only after an access agreement
 * UNAVAILABLE        there is no official way to read it at all
 */
export const SOURCE_STATE = Object.freeze({ AVAILABLE: "AVAILABLE", NOT_CONFIGURED: "NOT_CONFIGURED", NEEDS_PERMISSION: "NEEDS_PERMISSION", UNAVAILABLE: "UNAVAILABLE" });

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const iso = (value) => { const t = new Date(value || 0).getTime(); return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : ""; };
const isStaging = (env = {}) => String(env.DEPLOYMENT_ENV || "").toLowerCase() === "staging";

/** One stored text (a message, a pasted digest) → one item per ad in it. */
function itemsFromText({ sourceId, docId, body, at, phone = "", contactName = "", publishedAt = "" }) {
  const blocks = splitDigest(body);
  return blocks.map((block, index) => ({
    sourceId, externalId: `${docId}#${index}`, text: block, at,
    // The sender's own number only when the whole message is one ad; in a digest each ad carries its own.
    phone: blocks.length === 1 ? phone : "", contactName: blocks.length === 1 ? contactName : "", publishedAt
  }));
}

const officeInbox = {
  id: "office_inbox",
  label: "قنوات المكتب الرسمية",
  kind: "OFFICE",
  access: { method: "Firestore: offices/{officeId}/inbox", basis: "رسائل وصلت إلى المكتب نفسه عبر تكامله الرسمي (واتساب أعمال، تيليجرام) — بيانات المكتب" },
  quality: 0.9,
  availability: () => ({ state: SOURCE_STATE.AVAILABLE, reason: "" }),
  async fetch(ctx, { officeId, since, limit }) {
    const docs = await ctx.store.queryAfter(["offices", officeId], "inbox", { field: "receivedAt", after: since, limit });
    const items = [];
    for (const doc of docs) {
      if (doc.officeId && String(doc.officeId) !== officeId) continue;
      const body = typeof doc.messageText === "string" ? doc.messageText : "";
      if (body.trim().length < 20) continue;
      const found = itemsFromText({ sourceId: "office_inbox", docId: doc.id, body, at: iso(doc.receivedAt), phone: text(doc.senderPhone, 30), contactName: text(doc.senderName, 80), publishedAt: iso(doc.receivedAt) });
      // A one-ad message the intake already turned into a record is in the office's records, not a new find.
      if (doc.opportunityId && found.length <= 1) continue;
      items.push(...found);
    }
    return { items, scanned: docs.length, until: iso(docs.at(-1)?.receivedAt) };
  }
};

const linkHost = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9.-]/g, "").slice(0, 60); } catch (_) { return ""; } };

const brokerFeed = {
  id: "broker_feed",
  label: "ما يضيفه المكتب (رابط، نص، ملف)",
  kind: "OFFICE",
  access: { method: "Firestore: offices/{officeId}/scoutFeed", basis: "إعلان أدخل الوسيط رابطه، أو نص ألصقه، أو ملف استورده بنفسه — يقدّمها المكتب، ولا يُقرأ أي حساب أو قروب آليًا" },
  quality: 0.6,
  availability: () => ({ state: SOURCE_STATE.AVAILABLE, reason: "" }),
  async fetch(ctx, { officeId, since, limit }) {
    const docs = await ctx.store.queryAfter(["offices", officeId], "scoutFeed", { field: "createdAt", after: since, limit: Math.min(20, limit) });
    const items = [];
    for (const doc of docs) {
      const found = itemsFromText({ sourceId: "broker_feed", docId: doc.id, body: String(doc.text || ""), at: iso(doc.createdAt) });
      // One ad the broker brought himself: kept for him whatever its level. With a link, the link is the ad's identity
      // (the same address entered again is the same ad — an update, never a second find).
      if (found.length === 1 && doc.pinned === true) {
        const link = /^https:\/\//.test(String(doc.link || "")) ? String(doc.link).slice(0, 500) : "";
        const host = link ? linkHost(link) : "";
        Object.assign(found[0], { pinned: true }, host ? { sourceId: `link_${host}`, externalId: link.replace(/^https:\/\/(www\.)?/, "").replace(/#.*$/, "").slice(-120), url: link, contactRoute: link } : {});
      }
      items.push(...found);
    }
    return { items, scanned: docs.length, until: iso(docs.at(-1)?.createdAt) };
  }
};

export const telegramGroupsReady = (env = {}) => Boolean(text(env.TELEGRAM_BOT_TOKEN, 200) && text(env.TELEGRAM_WEBHOOK_SECRET, 300) && text(env.TELEGRAM_BOT_USERNAME, 60));

/**
 * Telegram groups and channels the office linked to its scout: the platform's bot is added there by an admin of
 * the group (Telegram's official Bot API), and only messages that read as property ads are kept for the office.
 */
const telegramGroups = {
  id: "telegram_groups",
  label: "قروبات وقنوات تيليجرام",
  kind: "APP",
  access: { method: "Telegram Bot API → offices/{officeId}/scoutPosts", basis: "بوت المنصة يُضاف إلى القروب أو القناة من مشرفها (واجهة تيليجرام الرسمية للبوتات)؛ لا يُقرأ حساب شخصي ولا قروب لم يُضَف إليه البوت" },
  quality: 0.65,
  availability: (ctx) => (telegramGroupsReady(ctx.env) ? { state: SOURCE_STATE.AVAILABLE, reason: "" } : { state: SOURCE_STATE.NOT_CONFIGURED, reason: "بوت المنصة على تيليجرام غير مفعّل على هذه البيئة بعد." }),
  async fetch(ctx, { officeId, since, limit }) {
    const docs = await ctx.store.queryAfter(["offices", officeId], "scoutPosts", { field: "createdAt", after: since, limit });
    const items = docs.filter((doc) => typeof doc.text === "string" && doc.text.trim()).map((doc) => ({
      sourceId: "telegram_groups", externalId: text(doc.id, 120), text: doc.text.slice(0, 2000), url: text(doc.link, 500), contactRoute: text(doc.link, 500),
      publishedAt: iso(doc.postedAt), at: iso(doc.createdAt)
    }));
    return { items, scanned: docs.length, until: iso(docs.at(-1)?.createdAt) };
  }
};

function feedConfig(env = {}) {
  const url = text(env.SCOUT_FEED_URL, 400);
  const key = text(env.SCOUT_FEED_KEY, 500);
  let host = "";
  try { const parsed = new URL(url); if (parsed.protocol === "https:") host = parsed.hostname.toLowerCase(); } catch (_) { /* not configured */ }
  const privateHost = !host || host === "localhost" || /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":") || host.endsWith(".local") || host.endsWith(".internal");
  return { url, key, name: text(env.SCOUT_FEED_NAME, 60) || "تغذية مرخّصة", ready: Boolean(key && !privateHost) };
}

/**
 * «تغذية مرخّصة»: a JSON feed the platform has an agreement for (set on the Worker: SCOUT_FEED_URL, SCOUT_FEED_KEY).
 *   GET <url>?tx=&types=&city=&districts=&priceMin=&priceMax=&since=&limit=   Authorization: Bearer <key>
 *   → { items: [{ id, url, title, text, kind, tx, propertyType, city, district, price, area, rooms, publishedAt,
 *                 advertiserType, contact: { phone, name, url } }] }
 */
const partnerFeed = {
  id: "partner_feed",
  label: "تغذية مرخّصة",
  kind: "FEED",
  access: { method: "HTTPS JSON feed with a key", basis: "اتفاقية وصول موقّعة مع مزوّد البيانات — لا تعمل قبل ضبط مفتاحها على الخادم" },
  quality: 0.8,
  mutable: true,
  queryable: true,
  availability: (ctx) => (feedConfig(ctx.env).ready ? { state: SOURCE_STATE.AVAILABLE, reason: "" } : { state: SOURCE_STATE.NOT_CONFIGURED, reason: "تعمل بعد توقيع اتفاقية بيانات مع مزوّد مرخّص وتفعيلها من إدارة المنصة." }),
  async fetch(ctx, { since, limit, forms = [] }) {
    const config = feedConfig(ctx.env);
    if (!config.ready) return { items: [], scanned: 0 };
    const items = [];
    for (const form of forms.slice(0, 6)) {
      const target = new URL(config.url);
      const set = (name, value) => { if (value !== "" && value !== 0 && value != null) target.searchParams.set(name, String(value)); };
      set("tx", form.tx); set("types", (form.propertyTypes || []).join(",")); set("city", form.city); set("districts", (form.districts || []).join(","));
      set("priceMin", form.priceMin); set("priceMax", form.priceMax); set("since", iso(since)); set("limit", Math.min(100, limit));
      const response = await fetch(target.toString(), { headers: { Authorization: `Bearer ${config.key}`, Accept: "application/json" }, signal: AbortSignal.timeout(8000), redirect: "error" });
      if (!response.ok) throw Object.assign(new Error(`feed answered ${response.status}`), { code: `feed_http_${response.status}` });
      const raw = await response.text();
      if (raw.length > 1_500_000) throw Object.assign(new Error("feed answer too large"), { code: "feed_too_large" });
      let rows = [];
      try { const parsed = JSON.parse(raw); rows = Array.isArray(parsed?.items) ? parsed.items : []; } catch (_) { throw Object.assign(new Error("feed answer is not JSON"), { code: "feed_bad_json" }); }
      for (const row of rows.slice(0, 100)) {
        if (!row || typeof row !== "object" || !row.id) continue;
        items.push({
          sourceId: "partner_feed", externalId: text(row.id, 120), url: text(row.url, 500), title: text(row.title, 160),
          text: text(row.text || [row.title, row.description].filter(Boolean).join("\n"), 2000),
          phone: text(row.contact?.phone, 30), contactName: text(row.contact?.name, 80), contactRoute: text(row.contact?.url, 500),
          publishedAt: iso(row.publishedAt), at: iso(row.updatedAt || row.publishedAt) || new Date().toISOString(), advertiserHint: text(row.advertiserType, 20),
          structured: { kind: row.kind, tx: row.tx, propertyType: row.propertyType, city: row.city, district: row.district, price: row.price, area: row.area, rooms: row.rooms }
        });
      }
    }
    return { items, scanned: items.length };
  }
};

/**
 * Test source — Staging only, and only for an office marked as a test fixture (QA offices). It reads what the QA
 * run seeded in offices/{qa-office}/scoutFixtures, so the whole pipeline is proven end to end without touching any
 * third-party site. `sourceTag` lets one fixture set stand for several sources (the same ad seen in two places).
 */
const qaFixture = {
  id: "qa_fixture",
  label: "مصدر اختبار",
  kind: "TEST",
  access: { method: "Firestore: offices/{qa-office}/scoutFixtures", basis: "بيانات اختبار معزولة على Staging لمكاتب QA فقط" },
  quality: 0.7,
  mutable: true,
  availability: (ctx, office = {}) => (isStaging(ctx.env) && office.isTestFixture === true
    ? { state: SOURCE_STATE.AVAILABLE, reason: "" } : { state: SOURCE_STATE.UNAVAILABLE, reason: "لمكاتب الاختبار على Staging فقط" }),
  async fetch(ctx, { officeId, since, limit }) {
    const docs = await ctx.store.queryAfter(["offices", officeId], "scoutFixtures", { field: "updatedAt", after: since, limit });
    const items = docs.filter((doc) => typeof doc.text === "string" && doc.text.trim()).map((doc) => ({
      sourceId: `qa_${/^[a-z]{1,12}$/.test(String(doc.sourceTag || "")) ? doc.sourceTag : "fixture"}`, externalId: text(doc.externalId || doc.id, 120),
      text: doc.text.slice(0, 2000), title: text(doc.title, 160), url: text(doc.url, 500), phone: text(doc.phone, 30), contactName: text(doc.contactName, 80),
      publishedAt: iso(doc.publishedAt), at: iso(doc.updatedAt), advertiserHint: text(doc.advertiserHint, 20),
      structured: doc.structured && typeof doc.structured === "object" ? doc.structured : undefined
    }));
    return { items, scanned: docs.length, until: iso(docs.at(-1)?.updatedAt) };
  }
};

/**
 * Checked against each site's own published terms and robots.txt (October 2026). No fetch code exists for them.
 * `reason` is what the office reads; `basis` is what was found when the terms were checked (for the platform's report).
 */
const unavailable = (id, label, reason, basis, state = SOURCE_STATE.NEEDS_PERMISSION) => ({
  id, label, kind: "EXTERNAL", quality: 0,
  access: { method: "none", basis },
  availability: () => ({ state, reason }),
  fetch: async () => ({ items: [], scanned: 0 })
});
const BY_LINK = "البديل الآن: أدخل رابط الإعلان مع نصه.";

export const SOURCE_ADAPTERS = Object.freeze([
  officeInbox,
  brokerFeed,
  telegramGroups,
  webSearchAdapter,
  postsSearchAdapter,
  partnerFeed,
  qaFixture,
  unavailable("aqar", "عقار", `شروط الموقع تمنع القراءة الآلية لإعلاناته، ولا يوفر واجهة رسمية للبيانات. يحتاج اتفاقية وصول. ${BY_LINK}`,
    "robots.txt يمنع صفحات البحث والمدن والأحياء والتصنيفات ومعلومات المعلن، والشروط تمنع جمع بيانات المنصة ومستخدميها؛ لا يوجد API عام."),
  unavailable("haraj", "حراج", `اتفاقية الاستخدام تمنع نسخ العروض وجمعها آليًا. يحتاج اتفاقية وصول. ${BY_LINK}`,
    "اتفاقية الاستخدام تمنع نسخ العروض وجمع البيانات وأدوات التجميع؛ لا يوجد API عام."),
  unavailable("bayut", "بيوت السعودية", `شروط الموقع تمنع البرامج الآلية وتكوين قواعد بيانات من محتواه. يحتاج ترخيصًا من المنصة. ${BY_LINK}`,
    "شروط الاستخدام (البند 8) تمنع الروبوتات والزواحف وتكوين قواعد بيانات من المحتوى، وrobots.txt يمنع /property/*؛ لا يوجد API عام."),
  unavailable("wasalt", "وصلت", `لم يتأكد لنا أن شروط الموقع تجيز القراءة الآلية، ولا يوفر واجهة رسمية معلنة. لا يُقرأ إلا بتصريح من المنصة. ${BY_LINK}`,
    "robots.txt يسمح بصفحات الإعلانات ويمنع /search، لكن تعذر التحقق من شروط الاستخدام ولا يوجد API عام معلن — يُعامل كمصدر يحتاج تصريحًا."),
  unavailable("whatsapp_groups", "قروبات واتساب", "لا توجد وسيلة رسمية لقراءة القروبات الخاصة. يُقرأ فقط ما يصل رقم المكتب المرتبط رسميًا. البديل: الصق الإعلانات أو استورد ملف المحادثة.",
    "لا توفر واجهات واتساب الرسمية قراءة قروبات المستخدمين الخاصة.", SOURCE_STATE.UNAVAILABLE)
]);

const BY_ID = new Map(SOURCE_ADAPTERS.map((adapter) => [adapter.id, adapter]));
const adapterOf = (sourceId) => { const id = String(sourceId || ""); return BY_ID.get(id.startsWith("qa_") ? "qa_fixture" : id.startsWith("web_") && id !== "web_search" ? "web_search" : id.startsWith("link_") ? "broker_feed" : id) || null; };

export function sourceLabel(sourceId, env = {}) {
  const adapter = adapterOf(sourceId);
  if (!adapter) return "مصدر";
  if (adapter.id === "partner_feed") return feedConfig(env).name;
  if (adapter.id === "qa_fixture") return `مصدر اختبار (${String(sourceId).slice(3) || "fixture"})`;
  if (adapter.id === "broker_feed" && String(sourceId).startsWith("link_")) return `رابط أدخله المكتب · ${String(sourceId).slice(5)}`;
  // A web find names the site it was found on («وُجدت في مصدرين» then means two different sites).
  if (adapter.id === "web_search" && sourceId !== "web_search") return `الويب · ${String(sourceId).slice(4)}`;
  return adapter.label;
}

export const sourceQuality = (sourceId) => adapterOf(sourceId)?.quality ?? 0.5;

/** The sources this office can use right now, with the office's own switches and any back-off after failures. */
export function usableSources(ctx, office = {}, settings = {}, health = {}, now = new Date()) {
  const out = [];
  for (const adapter of SOURCE_ADAPTERS) {
    const availability = adapter.availability(ctx, office);
    if (availability.state !== SOURCE_STATE.AVAILABLE) continue;
    if (settings.sources?.[adapter.id] === false) continue;
    const backoffUntil = Number(health?.sources?.[adapter.id]?.backoffUntil || 0);
    out.push({ adapter, backingOff: backoffUntil > now.getTime() });
  }
  return out;
}

/** What the settings screen lists: only sources verified as usable for this office (nothing the office cannot use). */
export function sourcesForOffice(ctx, office = {}, settings = {}) {
  return SOURCE_ADAPTERS
    .filter((adapter) => adapter.kind !== "TEST" && adapter.availability(ctx, office).state === SOURCE_STATE.AVAILABLE)
    .map((adapter) => ({ id: adapter.id, label: sourceLabel(adapter.id, ctx.env), on: settings.sources?.[adapter.id] !== false }));
}

/** For platform observability: every registered source, its state and the documented basis (no secrets). */
export function sourcesReport(ctx, office = {}) {
  return SOURCE_ADAPTERS.map((adapter) => ({ id: adapter.id, label: adapter.label, kind: adapter.kind, ...adapter.availability(ctx, office), access: adapter.access }));
}

/** After a failure: 10 min, 20, 40 … up to 6 hours. A success clears it. */
export function nextBackoff(health = {}, sourceId, ok, { now = new Date(), code = "", count = 0 } = {}) {
  const sources = { ...(health.sources || {}) };
  const previous = sources[sourceId] || {};
  if (ok) sources[sourceId] = { lastOkAt: now.toISOString(), lastCount: count, fails: 0, backoffUntil: 0, lastFailAt: previous.lastFailAt || "", lastError: previous.lastError || "" };
  else {
    const fails = Number(previous.fails || 0) + 1;
    sources[sourceId] = { ...previous, fails, lastFailAt: now.toISOString(), lastError: String(code || "failed").slice(0, 60), backoffUntil: now.getTime() + Math.min(360, 10 * 2 ** (fails - 1)) * 60_000 };
  }
  return { ...health, sources };
}
