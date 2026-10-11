# «باحث الفرص» — Opportunity Scout

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

| Source | State | Basis |
|---|---|---|
| `office_inbox` — قنوات المكتب الرسمية | available | messages that reached the office through its own official integration (WhatsApp Business, Telegram bot). The office's own data |
| `broker_feed` — ما يلصقه المكتب للباحث | available | ads the broker received and pasted himself. No account or group is read automatically |
| `partner_feed` — تغذية مرخّصة | not configured | a JSON feed under a signed data agreement. Works once `SCOUT_FEED_URL` + `SCOUT_FEED_KEY` are set on the Worker |
| `qa_fixture` — مصدر اختبار | Staging QA offices only | isolated test data; proves the chain end to end without touching any site |
| `aqar` — عقار | **unavailable** | robots.txt disallows search, city, district, category and advertiser pages; the terms forbid collecting the platform's and its users' data; no public API. Needs an access agreement |
| `haraj` — حراج | **unavailable** | the usage agreement forbids copying listings, collecting data and aggregation tools. Needs an access agreement |

There is no fetch code for عقار or حراج — they are registered so the report and the settings screen say honestly
why they are off. Personal WhatsApp and private groups are never read.

### Connecting a licensed feed

```
GET <SCOUT_FEED_URL>?tx=&types=&city=&districts=&priceMin=&priceMax=&since=&limit=
Authorization: Bearer <SCOUT_FEED_KEY>
→ { "items": [{ "id", "url", "title", "text", "kind", "tx", "propertyType", "city", "district", "price",
                "area", "rooms", "publishedAt", "advertiserType", "contact": { "phone", "name", "url" } }] }
```

Set `SCOUT_FEED_URL`, `SCOUT_FEED_KEY` (secret) and optionally `SCOUT_FEED_NAME` on the Staging Worker. HTTPS and a
public host only. No code change is needed; the source appears in the office's settings by itself.

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
| `scripts/qa/office-os/scout.e2e.mjs` | the broker's screens in a real browser on the local harness |
| `test/emulator/office-os-rules.emulator.test.mjs` | the scout's collections are closed to every client |
| `scripts/qa/office-os/scout-live.e2e.mjs` | after each Staging deploy: the whole chain on the deployed Worker with its real cron |

Platform view (admin only, no office data): `GET /admin/scout/health`.
