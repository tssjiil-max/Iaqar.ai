# «الباحث عن الفرص» — Opportunity Scout

A background research employee inside the broker's office. It watches the sources the office is allowed to
use, reads what appears there, discards what is weak, merges what is repeated, and puts only the few finds
worth the broker's time in front of him. The broker decides: «تواصل» / «حفظ لوقت لاحق» / «تجاهل».
The scout never contacts anyone.

**Scope: Staging only.** `OPPORTUNITY_SCOUT = "enabled"` exists only under `[env.staging.vars]` in
`worker/wrangler.toml`. Without it every `/os/scout/*` route answers «غير متاح» (503) and the cron does nothing for the
scout — that is the state of Production. Inside Staging each office still has its own master switch, off by default.

## Where it lives

| Part | File |
|---|---|
| Shared rules (modes, parsing, merging, scoring, wording) — one copy for Worker and browser | `public/os/domain/scout-domain.js` |
| Source adapters and their registry | `worker/src/office-os/scout-sources.js` |
| Web search, X, the live Google search and the link reader | `worker/src/office-os/scout-web.js` |
| Fit (through the existing matching engine) and levels | `worker/src/office-os/scout-evaluate.js` |
| Storage, limits, the platform schedule | `worker/src/office-os/scout-store.js` |
| The rounds, the scheduler beat, the routes' logic | `worker/src/office-os/scout-service.js` |
| Routes `/os/scout/*` | `worker/src/office-os/routes.js` |
| Cron beat, `/admin/scout/health`, `/health.opportunityScout` | `worker/src/index.js` |
| Browser: data, views | `public/os/core/scout.js`, `public/os/views/scout.js` |

Nothing existing was duplicated:

- **Understanding an ad** is the central analysis already used by «تعبئة ذكية»
  (`smart-fill-domain.js` → `analyzeListing`, and `fillListingGaps` for the model's gap-fill). The scout adds no second brain.
- **Fit** is `scoreMatch` from `worker/src/matching-engine.js`, the same engine that matches the office's own
  offers and requests. The scout adds only what is specific to an outside ad (freshness, reachability, source, repetition).
- **Rounds** run from the Worker's existing cron (`*/5 * * * *`). No new Cloudflare resource (no Queue, no Durable Object).
- **Alerts** are ordinary office notifications (`offices/{o}/notifications`) and the existing push path, under the
  existing «تنبيهات التطابق» preference.

## The three modes

One table decides every difference — `MODE_CONFIG` in `scout-domain.js`. Nothing else in the code branches on the mode's name.

| | عام 24/7 | عميق | مستعجل |
|---|---|---|---|
| Queue priority | 1 | 2 | 3 |
| Round every | 6 hours | 30 minutes | 5 minutes |
| First round | next beat | next beat | **inside the request** |
| Lifetime | open-ended | 24 hours, then ends with a summary | 72 hours intensive, then continues at the general pace |
| Looks back over | 7 days | 30 days | 14 days |
| Ads read per round | 25 | 80 | 40 |
| Query forms per feed request | 1 | 6 | 3 |
| Geography | the districts; neighbours after 3 empty rounds | the districts; neighbours after 1 empty round | **neighbours from the first round** |
| Price tolerance | 10% | 25% | 15% |
| Related property types | no | yes | no |
| Re-checks known finds for changes | every 4th round | every round | every round |
| Model gap-fill (after rules) | never | up to 30/day | up to 10/day |
| Alert from | very strong (max 2 per 6h) | very strong + a closing summary | **strong**, tagged «عاجل», also on Telegram if linked |

## Data (all under the office; all closed to the browser by the rules)

| Collection | What |
|---|---|
| `offices/{o}/scoutSettings/main` | master switch, general searches on/off, city, districts, types, sale/rent, minimum level, direct-owner preference, alerts, sources |
| `offices/{o}/scoutTasks/{id}` | **Search Task**: origin (AUTO / RECORD / CUSTOM / DISCOVERY), mode, what is sought, the profile, linked record, status and its reason, cursors per source, counters |
| `offices/{o}/scoutOpportunities/{id}` | **External Opportunity**: what it is, price, district, contact, sources seen in, changes, level, why, links to searches and records, the broker's action |
| `offices/{o}/scoutState/main` | one frugal document: short index for merging, the board, seen-hashes, daily usage, source health |
| `offices/{o}/scoutFeed/{id}` | text the broker pasted for the scout |
| `offices/{o}/scoutRuns/{id}` | one line per round: counts only (no phone, no ad text) |
| `offices/{o}/scoutIngestKeys/{id}` | an assistant's key for «الاستقبال التلقائي»: hash only, label, last use, revoked |
| `offices/{o}/scoutIngestBatches/{id}` | one line per received batch: counts and its report (for safe retries) |
| `offices/{o}/scoutFixtures/{id}` | QA test source (Staging + test-fixture offices only) |
| `_system/scoutSchedule` | the platform schedule: per office, task id → next time, priority, counters. Ids and numbers only |

Every path starts with the office id that the route verified membership for; no query crosses offices.

## One round

`read sources → skip what was already read (hash) → understand (rules; model only where the mode allows) →
drop what is already in the office's records → merge with a known find (same phone + same property, or the
same rich text) → classify the advertiser → score → link to searches and records → decide the surface → alert`

- **Level**: `score = fit × 0.62 + quality (≤ 38)`. `fit` is the matching engine's score (a neighbouring district
  counts, lower). `quality` = freshness, a way to reach the advertiser, completeness, source, confidence,
  direct owner, seen in several sources, minus noise. ≥ 82 very strong · ≥ 66 strong · ≥ 48 medium · below is weak.
- **Weak** new ads are not stored. **Medium** is kept silently. **Strong** appears on the board. **Very strong** alerts.
- **No way to reach the advertiser** → kept inside for merging, never shown, never alerted. When the same thing
  appears again with a number, the two are merged and judged again.
- **Direct owner** is a likelihood with a stated level (مرجّح / محتمل / غير مؤكد), never a claim.
- A price drop on a known find is recorded as a change and the find is judged again.

## Sources

Adapter contract (`scout-sources.js`): `id`, `label`, `kind`, `access { method, basis }`, `quality`,
`availability(ctx, office) → { state, reason }`, `fetch(ctx, { officeId, since, limit, forms }) → { items, until }`.
Health per source is kept per office (last success, last failure, back-off 10 min × 2ⁿ up to 6 h).
The scout page lists every source with its true state for every member of the office («حالة المصادر»).

| Source | State | Basis |
|---|---|---|
| `office_inbox` — قنوات المكتب الرسمية | **connected** | messages that reached the office through its own official integration (WhatsApp Business, Telegram bot). The office's own data |
| `broker_feed` — ما يضيفه المكتب (رابط، نص، ملف) | **connected** | an ad whose link the broker entered, text he pasted, or a file he imported. No account or group is read automatically |
| `web_search` — بحث الويب | needs activation (paid) | a web-search API (Tavily, or Brave with a storage-rights plan). Titles, excerpts and links only; result pages are never opened; the listing sites below are excluded from the results too. Off until `SCOUT_SEARCH_KEY` is set |
| `x_search` — منصة X | needs activation (paid) | X API v2 recent search, billed per post read. Off until `SCOUT_X_BEARER` is set |
| `partner_feed` — تغذية مرخّصة | needs an agreement | a JSON feed under a signed data agreement. Works once `SCOUT_FEED_URL` + `SCOUT_FEED_KEY` are set |
| `aqar` — عقار | needs a permission | robots.txt disallows search, city, district, category and advertiser pages; the terms forbid collecting the platform's data; no public API |
| `haraj` — حراج | needs a permission | the usage agreement forbids copying listings, collecting data and aggregation tools; no public API |
| `bayut` — بيوت السعودية | needs a permission | terms (section 8) forbid bots, crawlers and compiling databases from the content; robots.txt disallows `/property/*`; no public API |
| `wasalt` — وصلت | needs a permission | robots.txt allows listing pages (not `/search`), but the terms could not be verified and no public API is announced — treated as needing a permission |
| `telegram_groups` — قروبات وقنوات تيليجرام | **connected** where the platform bot is active | Telegram's official Bot API: the manager gets a one-time link (`?startgroup=<code>`), an admin of the group adds the platform's bot, and from then on only messages that read as property ads are kept for the office (`scoutPosts`). Up to 5 chats per office; a chat may serve up to 5 offices, each with its own copy. Receive-only — nothing is posted in the group. The bot reads ordinary messages only where it is an admin (or its privacy mode is off in BotFather) |
| `whatsapp_groups` — قروبات واتساب | **not available** | WhatsApp offers no official way to read private groups. Only what reaches the office's officially linked number is read |
| `qa_fixture` — مصدر اختبار | Staging QA offices only | isolated test data; proves the chain end to end without touching any site |

There is no fetch code for عقار، حراج، بيوت or وصلت. Personal WhatsApp and private groups are never read.

### By the broker's own hand («أضف إعلانًا»)

The path that always works, whatever the sites allow:

- **Link** (`/os/scout/import`): the page's own title and description are read — one page, once, because he asked —
  only if the address is a public https page, the site's robots.txt allows it, and the site is not one of the
  listing platforms above or a sign-in site. Otherwise nothing is fetched, the broker pastes the ad's text, and the
  link is kept as the ad's source. The link is the ad's identity: entering it again updates the same find (a new
  price is recorded as a change), never a second one.
- **Text**: one ad, or a digest of many.
- **File**: a `.txt` or `.csv` the office has the right to use (each row of a CSV is one ad).

One ad is kept on the broker's page whatever its level (it is his own choice) under «جديدة» until it is matched;
a digest is filtered as usual. What was read is shown back, with what the ad did not say — nothing is guessed.

### By an authorised assistant («الاستقبال التلقائي» — Claude, no CSV)

Replaces «download a CSV → upload it → paste it». The office manager creates a key in «إعدادات الباحث عن الفرص →
الاستقبال التلقائي من Claude» (shown once, stored as a SHA-256 hash, up to 5 active, revocable at once). The assistant
then sends what it found:

```
POST <worker>/os/scout/ingest
Authorization: Bearer iqk.<officeId>.<keyId>.<secret>
{ "batchId": "claude-madinah-2026-10-13",            // required: a retry with the same id answers the first report
  "agent": "claude-in-chrome",
  "search": { "tx": "rent", "propertyTypes": ["شقة","عمارة"], "city": "المدينة المنورة", "districts": ["العزيزية"], "plans": ["الحمراء هـ4"] },
  "items": [ { "url": "https://…", "title": "…", "text": "…", "kind": "OFFER|REQUEST", "tx": "sale|rent", "propertyType": "شقة",
               "city": "…", "district": "…", "plan": "…", "price": 0, "area": 0, "rooms": 0, "publishedAt": "…", "adId": "…" } ] }
→ { received, saved, updated, duplicates, rejected: [{ index, reason, message }], strong, kept, cards, replay, note }
```

- **Claude in Chrome, automatically.** Claude in Chrome is documented to open pages, read, click, type and run saved
  shortcuts on a schedule (while Chrome is open); it is not documented to send HTTP requests itself. So the automatic
  path only opens a page: the manager presses «ربط هذا المتصفح بـ Claude» once (the key is written to that browser's
  storage — never shown, never in a conversation) and saves the shortcut text it gets (criteria from the scout
  settings: types, sale/rent, city, districts, plans; the refused sites; the result shape; a run code). At the end of
  each run Claude opens `/scout-inbox.html#c=<run code>&ingest=<batch JSON>`; the page checks the run code against the
  pairing, sends the batch by itself, clears the address, and writes the Worker's answer in `[data-inbox-result]`
  for Claude to read back. A page opened by another site (wrong run code) or in an unpaired browser sends nothing.
  Manual paste stays only as a fallback. Live proof: `scripts/qa/office-os/scout-ingest-live.e2e.mjs` (preview workflow).
- **Where it lands:** one `scoutFeed` document per ad (`channel: AGENT`, `reviewStatus: PENDING_REVIEW`, the link as its
  identity after removing tracking parameters) → the same `broker_feed` source → the same understanding, merging,
  matching and levels. An outside find «قيد المراجعة» — never an office record, never «مفوّض بالتسويق»; the body cannot
  set an office, a status, a licence or an approval.
- **Duplicates:** the same `batchId` → its first report (`replay: true`). The same ad in another batch → `duplicates`;
  a changed price → `updated` (the same find records the change).
- **Sources:** an ad whose link is on عقار، حراج، بيوت or وصلت is refused (`source_restricted`) — their terms forbid
  collecting their listings — unless the platform has a data agreement with that site (`SCOUT_INGEST_LICENSED_HOSTS`).
- **Switches:** `SCOUT_INGEST = "enabled"` (Staging only; removing it closes the door for every office) + the office's
  scout switch + an active key. Limits: 20 ads per batch, 120 KB per request, 60 batches per hour per key.
- **Data:** `offices/{o}/scoutIngestKeys/{keyId}` (hash, label, last use, revoked), `offices/{o}/scoutIngestBatches/{id}`
  (counts and the report, no phone). Both closed to every client by the rules. Code: `worker/src/office-os/scout-ingest.js`,
  page `public/scout-inbox.html`, tests `test/office-os-scout-ingest.test.mjs`.

### «المخطط» in a search

A search (and the office's standing interests) may name plans (`plans`, e.g. «الحمراء هـ4»). The word «مخطط» is dropped,
up to 4 per search, «مخطط X» is read from a sentence, and when plans are named only ads whose own words name one of them
fit the search (`planMentioned` in `scout-domain.js`, applied in `fitFor`).

### Paid doors (all off by default — no cost without approval)

| Door | Switch | Cost when on |
|---|---|---|
| Web search | `SCOUT_SEARCH_KEY` (+ `SCOUT_SEARCH_PROVIDER=tavily\|brave`) | per request to the provider; capped at 40 requests per office per day (`SCOUT_SEARCH_DAILY_PER_OFFICE`); paced per mode (general 1/day, deep 3 every 2 h, urgent 2/hour) |
| Serper (Google results through serper.dev) — **locked** | all three on Staging only: `SCOUT_SERPER=enabled`, `SCOUT_SEARCH_PROVIDER=serper`, secret `SERPER_API_KEY`. None is set in the repository and no deploy script puts the key on a Worker | free-credit pilot limits built in: 1 request per round, 5 per office per day, 10 per day for the platform, 100 in total; repeats are answered from the day's cache |
| X | `SCOUT_X_BEARER` | about $0.005 per post read, ≤ 10 posts per query, capped at 10 queries per office per day |
| «ابحث في الويب الآن» (Google Search through Gemini) | `SCOUT_LIVE_SEARCH=enabled` | a paid Google Search request per press; shown to the broker as it came and **never stored or scored** (Google's terms forbid collecting grounded results) |

### Connecting a licensed feed

```
GET <SCOUT_FEED_URL>?tx=&types=&city=&districts=&priceMin=&priceMax=&since=&limit=
Authorization: Bearer <SCOUT_FEED_KEY>
→ { "items": [{ "id", "url", "title", "text", "kind", "tx", "propertyType", "city", "district", "price",
                "area", "rooms", "publishedAt", "advertiserType", "contact": { "phone", "name", "url" } }] }
```

## What the broker sees and does

- **Lists**: الكل · مطابقة (matched with a record of the office) · جديدة · قيد المراجعة (he opened the contact or
  recorded its result) · محفوظة · مستبعدة (can be taken back). Last successful search and each source's state on the same page.
- **A find**: what it is, the estimated fit (the matching engine's score — shown as an estimate, never a certainty),
  why, the differences in price and area from the office's record, what the ad left out, source link, discovery
  and publication dates, the advertiser's capacity as read («غير واضحة» when it is not stated).
- **Actions**: تواصل · فتح المصدر الأصلي · إضافة للمتابعة · استبعاد · ابحث عن مطابقات · أنشئ مهمة متابعة (one task in
  Daily Tasks, type `SCOUT_FOLLOW_UP`, step «تواصل», opens the find) · سجّل نتيجة التواصل (closes the task) ·
  اعتماد الفرصة بعد التحقق (opens the normal record form pre-filled — nothing becomes an official record by itself).
- **Office settings**: city, districts, property types, sale/rent, kinds (offers / requests), price and area range,
  pace of the general searches (3 h / 6 h / 12 h / daily), alerts on/off and their level, sources. Any city of the Kingdom.

## Control and lifecycle

- Master switch off → the office leaves the schedule; searches, finds and settings stay as they are.
- Each search: pause / resume / end / run now / change mode. From inside a record: start with one press
  (nothing re-entered — the profile is read from the record), stop for this record only.
- A record that is sold, rented, closed, cancelled or deleted ends its search; a paused record pauses it. A deep
  search ends itself after its window. Nothing is left running.
- Keeping time: an ended search is removed after 14 days; a find nobody acted on and no source showed again leaves
  after 45 days (what the broker saved or contacted stays); pasted text leaves after 45 days; the round log is the last 60 rounds.

## Cost

Hash of every ad read (unchanged content is never read twice) · rules before the model, and the model only in
deep and urgent searches within a daily budget · per-search cursors (only what is new) · one state document per
office instead of scanning collections · an idle scheduler beat costs one read · limits in `SCOUT_LIMITS`
(40 running searches per office, 6 offices per beat, 12 000 pasted characters, 40 model calls per office per day).

## Checks

| | |
|---|---|
| `test/office-os-scout.test.mjs` | rules, the 15 scenarios, sources, isolation, limits, Production off |
| `test/office-os-scout-sources.test.mjs` | link / text / file, web search and X (doubles), live search, settings, lists, differences, follow-up tasks |
| `scripts/qa/office-os/scout.e2e.mjs` | the broker's screens in a real browser on the local harness |
| `test/emulator/office-os-rules.emulator.test.mjs` | the scout's collections are closed to every client |
| `scripts/qa/office-os/scout-live.e2e.mjs` | after each Staging deploy: the whole chain on the deployed Worker with its real cron |

Platform view (admin only, no office data): `GET /admin/scout/health`.
