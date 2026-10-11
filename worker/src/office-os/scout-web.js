/**
 * «باحث الفرص» on the open web — three doors, each used only the way its owner permits:
 *
 *   web_search   a web-search API the platform subscribes to (SCOUT_SEARCH_KEY). The scout asks it in the words
 *                of the search, reads titles and excerpts, and keeps a link to each result. It never opens the
 *                result pages itself. Sites whose terms forbid collecting their listings (عقار، حراج) are left
 *                out of the results as well — asking a search engine for them would be the same collection by
 *                another road.
 *                  tavily  terms allow use inside the customer's application (default).
 *                  brave   terms forbid keeping results unless the plan grants storage rights — use only with
 *                          «Data with Storage Rights».
 *   x_search     X's own API, recent posts (SCOUT_X_BEARER), billed per post read.
 *   live search  Google Search through the Gemini API, for the broker who presses «ابحث في الويب الآن».
 *                Google's terms allow showing its grounded results, with its search suggestions, to the person
 *                who asked — and forbid collecting, keeping or analysing them. So this door is display only:
 *                nothing from it is stored, scored or turned into a find, and no background round ever uses it.
 *
 * Every paid door is metered: per search (MODE_CONFIG.metered) and per office per day (limits below).
 * Logs carry counts and codes — never a query, a phone or an ad's text.
 */

import { candidateFromRaw, looksLikeListingIndex, postsQueryText, webQueryText } from "../../../public/os/domain/scout-domain.js";

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const iso = (value) => { const t = new Date(value || 0).getTime(); return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : ""; };
const fail = (code, message = code) => Object.assign(new Error(message), { code });

/** Checked against each site's terms (October 2026): automated collection of their listings is forbidden. */
export const SEARCH_EXCLUDED_DOMAINS = Object.freeze(["aqar.fm", "haraj.com.sa"]);

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
export function searchConfig(env = {}) {
  const provider = text(env.SCOUT_SEARCH_PROVIDER, 20).toLowerCase() || "tavily";
  const key = text(env.SCOUT_SEARCH_KEY, 500);
  const extra = text(env.SCOUT_SEARCH_EXCLUDE, 600).toLowerCase().split(/[\s,]+/).filter((d) => DOMAIN.test(d));
  const perDay = Math.max(0, Math.min(500, Number(env.SCOUT_SEARCH_DAILY_PER_OFFICE) || 40));
  return { provider, key, ready: Boolean(key && WEB_DRIVERS[provider]), excluded: [...new Set([...SEARCH_EXCLUDED_DOMAINS, ...extra])].slice(0, 40), perDay };
}

const hostOf = (url) => { try { const u = new URL(url); return u.protocol === "https:" ? u.hostname.toLowerCase().replace(/^www\./, "") : ""; } catch (_) { return ""; } };
const isExcluded = (host, excluded) => excluded.some((domain) => host === domain || host.endsWith(`.${domain}`));
const rangeOf = (days) => (days <= 1 ? "day" : days <= 7 ? "week" : days <= 31 ? "month" : "year");

async function readJson(response, code) {
  if (!response.ok) throw fail(`${code}_http_${response.status}`);
  const raw = await response.text();
  if (raw.length > 1_500_000) throw fail(`${code}_too_large`);
  try { return JSON.parse(raw); } catch (_) { throw fail(`${code}_bad_json`); }
}

/** provider → (query, options) → [{ title, url, snippet, publishedAt }] */
const WEB_DRIVERS = {
  async tavily({ key, query, days, excluded }) {
    const body = await readJson(await fetch("https://api.tavily.com/search", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(9000), redirect: "error",
      body: JSON.stringify({ query, search_depth: "basic", topic: "general", max_results: 10, time_range: rangeOf(days), country: "saudi arabia", exclude_domains: excluded, include_answer: false, include_raw_content: false })
    }), "search");
    return (Array.isArray(body?.results) ? body.results : []).map((row) => ({ title: row?.title, url: row?.url, snippet: row?.content, publishedAt: row?.published_date }));
  },
  async brave({ key, query, days, excluded }) {
    const target = new URL("https://api.search.brave.com/res/v1/web/search");
    target.searchParams.set("q", `${query} ${excluded.slice(0, 6).map((domain) => `-site:${domain}`).join(" ")}`.trim().slice(0, 380));
    target.searchParams.set("country", "SA"); target.searchParams.set("search_lang", "ar"); target.searchParams.set("count", "20");
    target.searchParams.set("freshness", { day: "pd", week: "pw", month: "pm", year: "py" }[rangeOf(days)]); target.searchParams.set("extra_snippets", "true");
    const body = await readJson(await fetch(target.toString(), { headers: { "X-Subscription-Token": key, Accept: "application/json" }, signal: AbortSignal.timeout(9000), redirect: "error" }), "search");
    return (Array.isArray(body?.web?.results) ? body.web.results : []).map((row) => ({ title: row?.title, url: row?.url, snippet: [row?.description, ...(Array.isArray(row?.extra_snippets) ? row.extra_snippets : [])].filter(Boolean).join(" … "), publishedAt: row?.page_age }));
  }
};

const stripTags = (value) => String(value || "").replace(/<[^>]{0,200}>/g, " ").replace(/&[a-z#0-9]{2,8};/gi, " ").replace(/\s+/g, " ").trim();

export const webSearchAdapter = {
  id: "web_search",
  label: "بحث الويب",
  kind: "WEB",
  access: { method: "web-search API (Tavily or Brave) with the platform's key — titles, excerpts and links only", basis: "اشتراك المنصة في خدمة بحث ويب وفق شروطها؛ لا تُفتح صفحات النتائج آليًا، وتُستبعد المواقع التي تمنع شروطها جمع إعلاناتها" },
  quality: 0.5,
  mutable: true,
  queryable: true,
  metered: { usageKey: "webCalls", perDay: (env) => searchConfig(env).perDay },
  availability: (ctx) => (searchConfig(ctx.env).ready ? { state: "AVAILABLE", reason: "" } : { state: "NOT_CONFIGURED", reason: "لا يوجد مفتاح خدمة بحث ويب مضبوط على هذه البيئة" }),
  /** One request per query form. `queries` in the answer is what was really sent (and is what the budget counts). */
  async fetch(ctx, { forms = [], now = new Date() }) {
    const config = searchConfig(ctx.env);
    if (!config.ready) return { items: [], scanned: 0, queries: 0 };
    const items = [];
    const seen = new Set();
    let queries = 0;
    let scanned = 0;
    for (const form of forms) {
      const query = webQueryText(form);
      if (!query) continue;
      queries += 1;
      const rows = await WEB_DRIVERS[config.provider]({ key: config.key, query, days: Number(form.freshnessDays) || 7, excluded: config.excluded });
      for (const row of rows.slice(0, 20)) {
        scanned += 1;
        const url = text(row.url, 500);
        const host = hostOf(url);
        if (!host || isExcluded(host, config.excluded) || seen.has(url)) continue;
        seen.add(url);
        const title = stripTags(row.title).slice(0, 160);
        const snippet = stripTags(row.snippet).slice(0, 1600);
        // A results page is a list of ads, not an ad; and an excerpt with no price and no area is nothing to act on.
        if (looksLikeListingIndex(title)) continue;
        const body = [title, snippet].filter(Boolean).join("\n");
        const read = candidateFromRaw({ text: body });
        if (!read.understood || !read.kind || !(read.price || read.area)) continue;
        const address = new URL(url);
        items.push({
          sourceId: `web_${host.replace(/[^a-z0-9.-]/g, "").slice(0, 60)}`, externalId: `${host}${address.pathname}${address.search}`.slice(-120), title, text: body, url, contactRoute: url,
          publishedAt: iso(row.publishedAt), at: now.toISOString()
        });
      }
    }
    return { items, scanned, queries };
  }
};

// ------------------------------------------------------------------ X (recent posts, the official API)

export function postsConfig(env = {}) {
  const key = text(env.SCOUT_X_BEARER, 500);
  return { key, ready: Boolean(key), perDay: Math.max(0, Math.min(200, Number(env.SCOUT_X_DAILY_PER_OFFICE) || 10)) };
}

export const postsSearchAdapter = {
  id: "x_search",
  label: "منصة X",
  kind: "APP",
  access: { method: "X API v2 — recent search, with the platform's bearer token", basis: "واجهة X الرسمية وفق اتفاقية المطوّرين (مدفوعة بعدد المنشورات المقروءة)" },
  quality: 0.55,
  queryable: true,
  mutable: true,
  metered: { usageKey: "xCalls", perDay: (env) => postsConfig(env).perDay },
  availability: (ctx) => (postsConfig(ctx.env).ready ? { state: "AVAILABLE", reason: "" } : { state: "NOT_CONFIGURED", reason: "لا يوجد مفتاح واجهة X مضبوط على هذه البيئة" }),
  async fetch(ctx, { forms = [], now = new Date() }) {
    const config = postsConfig(ctx.env);
    if (!config.ready) return { items: [], scanned: 0, queries: 0 };
    const items = [];
    let queries = 0;
    let scanned = 0;
    for (const form of forms) {
      const query = postsQueryText(form);
      if (!query || !(form.propertyTypes || []).length) continue;
      queries += 1;
      const target = new URL("https://api.x.com/2/tweets/search/recent");
      target.searchParams.set("query", query); target.searchParams.set("max_results", "10"); target.searchParams.set("tweet.fields", "created_at,lang");
      // The recent-search window is seven days; never asked for more.
      target.searchParams.set("start_time", new Date(now.getTime() - Math.min(6.9, Number(form.freshnessDays) || 7) * 86_400_000).toISOString());
      const body = await readJson(await fetch(target.toString(), { headers: { Authorization: `Bearer ${config.key}`, Accept: "application/json" }, signal: AbortSignal.timeout(9000), redirect: "error" }), "x");
      for (const post of (Array.isArray(body?.data) ? body.data : []).slice(0, 10)) {
        scanned += 1;
        const id = text(post?.id, 30);
        const postText = text(post?.text, 1500);
        if (!/^\d{5,30}$/.test(id) || postText.length < 25) continue;
        const url = `https://x.com/i/web/status/${id}`;
        items.push({ sourceId: "x_search", externalId: id, text: postText, url, contactRoute: url, publishedAt: iso(post.created_at), at: iso(post.created_at) || now.toISOString() });
      }
    }
    return { items, scanned, queries };
  }
};

// ------------------------------------------------------------------ live search (Google Search through Gemini) — display only

export const liveSearchAvailable = (env = {}) => Boolean(text(env.GEMINI_API_KEY, 500)) && String(env.SCOUT_LIVE_SEARCH || "enabled").toLowerCase() !== "off";

/**
 * One question, asked by a person, answered with Google Search. Returns exactly what Google's terms ask to be
 * shown: the answer as written, its sources as given, and Google's own search-suggestions block. Nothing is kept.
 */
export async function liveWebSearch(env, { question }) {
  const key = text(env?.GEMINI_API_KEY, 500);
  if (!key) return { ok: false, code: "not_configured" };
  const model = text(env.SCOUT_LIVE_MODEL || env.GEMINI_MODEL || "gemini-3.1-flash-lite", 80);
  let response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, signal: AbortSignal.timeout(25000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "أنت مساعد بحث عقاري في السعودية. ابحث في الويب وأجب بالعربية باختصار: لكل نتيجة سطر واحد فيه نوع العقار والحي والمدينة والسعر والمساحة إن وُجدت واسم الموقع. اذكر فقط ما وجدته في نتائج البحث، ولا تذكر أرقام هواتف، وإن لم تجد شيئًا مناسبًا فقل ذلك." }] },
        contents: [{ role: "user", parts: [{ text: question }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0, maxOutputTokens: 1200 }
      })
    });
  } catch (_) { return { ok: false, code: "request_failed" }; }
  if (!response.ok) {
    console.warn("[scout] live search refused", response.status);
    return { ok: false, code: response.status === 429 ? "quota" : response.status === 400 || response.status === 403 ? "not_available" : "failed", status: response.status };
  }
  const body = await response.json().catch(() => null);
  const candidate = body?.candidates?.[0] || {};
  const answer = (candidate.content?.parts || []).map((part) => part?.text || "").join("").trim();
  const meta = candidate.groundingMetadata || {};
  const sources = (Array.isArray(meta.groundingChunks) ? meta.groundingChunks : [])
    .map((chunk) => ({ title: text(chunk?.web?.title, 120), url: text(chunk?.web?.uri, 1200) })).filter((source) => /^https:\/\//.test(source.url)).slice(0, 12);
  // No sources → the answer did not come from a search; it is not shown as a web result.
  if (!answer || !sources.length) return { ok: true, grounded: false, answer: "", sources: [], suggestions: "" };
  return { ok: true, grounded: true, answer: answer.slice(0, 6000), sources, suggestions: String(meta.searchEntryPoint?.renderedContent || "").slice(0, 60_000) };
}
