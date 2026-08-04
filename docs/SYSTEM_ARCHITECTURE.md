# IAQAR.AI — System Architecture

Two parts: **A. Current architecture** (what exists, verified by reading the code) and
**B. Approved target architecture** (where the phases lead). Nothing in part B may be
treated as existing until its phase is delivered and tested.

---

## A. Current architecture

```
                    ┌───────────────────────────────────────────┐
   Browser / PWA    │  Firebase Hosting  (project aqar-b5d76)   │
                    │  public/  ·  cleanUrls  ·  /o/** → index  │
                    └───────────────────┬───────────────────────┘
                                        │
             ┌──────────────────────────┴──────────────────────────┐
             │             public/index.html  (app shell)          │
             │  inline CSS · inline SVG sprite · operations list   │
             └───┬──────────┬───────────┬───────────┬──────────┬───┘
                 │          │           │           │          │
      access-gate.js  firebase-      office-     whatsapp-  workflow-
      (routing +     office.js      settings.js  office.js  office.js
       auth gate +   (runtime +     (office      (Meta      (live data,
       public forms)  Firestore     profile)     embedded    workflow UI,
                      refs)                      signup)     FCM, push)
                 │          │           │           │          │
                 └──────────┴─────┬─────┴───────────┴──────────┘
                                  │
        ┌─────────────────────────┼──────────────────────────────┐
        │                         │                              │
   Firebase Auth            Firestore (client SDK,        Cloudflare Worker
   (email/password,          rules-enforced)              iaqar-macrodroid-intake
    custom token from                                      · REST → Firestore
    phone login)                                           · FCM HTTP v1
                                                           · R2 bucket iaqar-media
                                                           · hourly cron
                                                           · Meta webhook
```

### A.1 Front-end

- No framework, no bundler, no build step. `public/index.html` is the whole shell:
  design tokens in `:root`, all component CSS inline, an inline SVG `<symbol>` sprite,
  and an inline script that renders the Operations Center list.
- Scripts load in a fixed order at the end of `<body>`: Firebase compat SDKs →
  `/__/firebase/init.js` → `fcm-fid.js` (module) → `access-gate.js` →
  `firebase-office.js` → `qrcode.js` → `office-settings.js` → `whatsapp-office.js` →
  inline operations script → `workflow-office.js`.
- Each `public/js/*.js` file is a self-contained IIFE. The only shared surface is
  `window.IAQAR.office` (created by `firebase-office.js`) plus a small set of
  `CustomEvent`s on `window`:
  - `iaqar:firebase-ready`, `iaqar:firebase-status` — runtime lifecycle.
  - `iaqar:operations-data` — authoritative operations list (producer:
    `workflow-office.js` listening to persisted `operations`, consumer: the inline
    script).
  - `iaqar:open-operation` — deep-link request to open one operation.
  - `iaqar:operation-opened` — the broker expanded an operation.
  - `iaqar:workflow-action` — the broker pressed an action button.
  - `iaqar:push-received` — a foreground push arrived.
- Multi-tenancy on the client: `firebase-office.js` resolves `officeId` from
  `?officeId|office|o`, else `localStorage`, else `"platform"`, normalizes it, and
  builds `offices/{officeId}/…` collection references once.
- Routing is not a router. `access-gate.js` decides between three surfaces:
  the public platform home, a public office page (`/o/{slug}` or `?view=public`), and
  the authenticated office workspace. When locked it adds `body.access-locked`, which
  hides `.app` and shows its own `<main class="access-gate">`.

### A.2 Backend (Cloudflare Worker)

One file, `worker/src/index.js`, exported as an ES module with `fetch` and `scheduled`.
It never uses a Firebase SDK; it mints a service-account JWT
(`createServiceAccountJwt`), exchanges it for a Google access token
(`getGoogleAccessToken`, cached), and then speaks the Firestore and FCM REST APIs
directly.

Route groups:

| Group | Routes | Purpose |
| --- | --- | --- |
| Health | `GET /`, `GET /health` | Reports `mode: "inbound-only"`, `outboundMessaging: false`. |
| Meta / WhatsApp | `GET /meta/config`, `GET /meta/status`, `GET|POST /meta/webhook`, `POST /meta/signup/complete` | Embedded signup + inbound webhook. Disabled while `META_APP_ID`/`META_CONFIG_ID` are empty. |
| Pipelines | `POST /pipeline/intake`, `POST /pipeline/public-intake` | Parse → persist → match → notify. |
| Previews (test-only, no auth, no writes) | `POST /pipeline/preview`, `/matching/preview`, `/workflow/preview`, `/workflow/readiness/preview`, `/office/analytics/preview` | Pure-function endpoints the test suite drives. |
| Auth helpers | `POST /auth/phone-login`, `POST /auth/forgot-password` | Phone → custom token; reset link by phone. |
| Media | `POST /media/public-intake`, `POST /media/office-cover`, `GET /media/public/office-covers/…` | R2 upload/serve. |
| Admin | `GET /admin/broker-applications`, `POST /admin/broker-applications/action` | Platform-admin only. |
| FCM | `GET /fcm/config`, `GET /fcm/status`, `POST /fcm/register`, `/fcm/unregister`, `/fcm/test` | Device registry lives server-side only. |
| Workflow | `POST /workflow/action`, `GET /workflow/timeline`, `GET /office/analytics` | Match/deal progression. |
| Operations (Phase 5) | `POST /operations/action`, `/operations/from-cooperation`, `/operations/missing-data` | Worker upserts/lifecycle for persisted Operations + Notifications. |
| Cooperation (Phase 6) | `POST /cooperation/lifecycle`, `/cooperation/scope-revoke` | Trusted accept/reject/revoke; auditLogs; shared projection write/cleanup. |
| Messages (Phase 7) | `POST /messages/draft`, `POST /messages/handoff`, `GET /messages/adapters` | Persisted Arabic drafts + external broker handoff; never Cloud API/Bot send. |
| Blocked | `/ingest` → 410; other `*messages*`/`*send*` → 403 `outbound_disabled` | Meta/Telegram outbound send refused at the edge (draft APIs excluded). |

Authorization: `authorizeOfficeRequest(request, env, officeId, permission)` verifies the
Firebase ID token against Google's JWKS (`verifyFirebaseIdToken`), then resolves
`offices/{officeId}.ownerUid` and `offices/{officeId}/members/{uid}` to decide
`member` / `integration` / `manage` permission. Platform admins short-circuit.

Scheduled work: one hourly cron → `processOverdueFollowups`, a collection-group query
for matches/deals whose `nextFollowUpAt` has passed, then a reminder push.

### A.3 Data and security

- Everything office-scoped lives under `offices/{officeId}/…` **and** repeats
  `officeId` as a field, which is what the write rules check.
- `offices/{officeId}/devices` is invisible to clients (`allow read, write: if false`)
  and is written only by the Worker's service account.
- Global collections: `publicOffices/{officeId}` (world-readable office card data),
  `officeNameClaims/{nameKey}` (name uniqueness registry), `brokerApplications`
  (platform-admin only), `whatsapp_accounts` and `_system` (server only).
- Media: R2 bucket `iaqar-media`, keys `public-intake/{officeId}/{intakeId}/…` (private)
  and `office-covers/{officeId}/{variant}` (served through the Worker with a strict
  key allow-list).
- Secrets live only in Wrangler secrets (`FIREBASE_CLIENT_EMAIL`,
  `FIREBASE_PRIVATE_KEY`, `FIREBASE_PRIVATE_KEY_ID`, `META_*`, `FCM_*`). `wrangler.toml`
  `[vars]` contains only non-secret identifiers.

### A.4 Testing and tooling

- `worker/test/worker.test.mjs` — `node:test`, zero dependencies, drives the Worker's
  exported `fetch` and its exported pure functions. Runs with `npm test` in `worker/`.
- Root `package.json` (added in Phase 1) provides `npm test` for the whole repository:
  it runs the front-end/domain/rules tests in `test/` and then the Worker suite.
  Front-end DOM tests use `jsdom` as a dev dependency only; nothing ships to the
  browser from `node_modules`.
- No linter or type checker is configured. `npm run check` performs a syntax parse of
  every shipped JavaScript file plus a JSON parse of the config files, which is the
  closest equivalent for a no-build project.

## B. Approved target architecture

The stack does not change. What changes is the internal shape.

### B.1 Layering

```
  ingestion adapters ──▶ source store ──▶ analysis adapters ──▶ Opportunity (unified)
        │                                                            │
        │                                                            ▼
        │                                              completeness evaluation
        │                                                            │
        ▼                                                            ▼
   event outbox  ◀───────────────────────────────────────────  matching engine
        │                                                            │
        ├──▶ operations (actionable work only) ──▶ notifications ──▶ broker
        └──▶ message drafts ──▶ channel adapters (WhatsApp / Telegram)
```

- **Ingestion adapters** (§9 of the constitution) normalize every source — office public
  link, pasted text, image, screenshot, PDF, Word, Excel, audio, WhatsApp Business API,
  Telegram — into one *source record* plus a *raw attachment*. Source type is internal
  metadata and is never a home-page section or a prominent label.
- **Analysis adapters** (§12) keep four separate layers per opportunity: raw source,
  extracted values, normalized values, broker-confirmed values. Broker-confirmed values
  always win; AI output never silently overwrites them. When a provider is unavailable
  the adapter boundary stays and deterministic fixtures are used — production
  extraction is never faked.
- **Opportunity** is the single unified entity. `clients`/`owners` become projections of
  it, not parallel truths.
- **Matching engine** is internal, threshold-configurable, and idempotent on
  (canonical opportunity pair, matching rule version, relevant data version).
- **Operations** are persisted records — the only thing the broker sees. One open
  operation per (action, source event), enforced by `deduplicationKey`.
- **Event outbox**: a database-backed job/outbox collection inside Firestore, driven by
  the existing Worker cron plus in-request draining. No new message broker.
  Every handler must be idempotent, retry-safe, tenant-aware, auditable and able to
  record failure state, and one failed external integration must never corrupt the
  opportunity.

### B.2 Front-end direction

`public/index.html` stays the single approved shell with the same visual language. New
behaviour arrives as additional `public/js/*.js` modules that communicate through
`window.IAQAR` and the existing `iaqar:*` events, so no module needs to know about
another module's internals. Pure logic is extracted into ES modules under
`public/js/` so the same code runs in the browser and under `node:test` — that is how
Phase 1 makes office-name and settings logic testable without a browser.

### B.3 What Phase 1 actually changed

- Added `public/js/office-domain.js` — pure, dependency-free, dual-target (browser
  module + Node test import) domain logic: office-name normalization/validation,
  image crop presets, notification preference schema, cooperation modes, office link
  building, Opportunity Bank row projection.
- Converted `public/js/office-settings.js` to an ES module that imports that domain
  module, and grew it into the full approved Office Settings surface.
- Office Card now renders a real per-office logo and cover image, both of which are the
  only entry points to Office Settings.
- Removed the deals tab and the six hard-coded demo operations from the shell; the
  Operations Center is now one list with an approved empty state.
- Worker: `/media/office-cover` handles the three image variants and supports delete;
  `sendOfficePush` consults the office notification-preference document before sending.
- Rules: office-name claim takeover fixed; `officeSettings` and `brokerSettings` are
  removed from the permissive catch-all and given explicit least-privilege rules.

### B.4 What Phase 3 actually changed

- Added `public/js/opportunity-bank-domain.js` and `public/js/opportunity-bank.js` for the
  private Opportunity Bank (list/detail/edit/archive/restore/soft-delete, single and
  selected cooperation requests, scoped bank sharing, incoming accept/reject, revoke).
- Extended Phase 2 `opportunities` with lifecycle + cooperation fields; ownership fields
  are immutable in rules; hard delete is denied.
- Added `cooperationRequests`, `bankSharingScopes`, and
  `offices/{id}/sharedOpportunities` with least-privilege rules.
- Bank entry remains Office Settings → بنك الفرص only; home page and Operations Center
  empty-state behaviour are unchanged. No Matching Engine.

### B.5 What Phase 4 actually changed

- Extracted `worker/src/matching-engine.js` as the single threshold/scoring/version
  authority (`MATCHING_RULE_VERSION = 4.0.0`).
- Versioned Match IDs; supersede stale current matches on data-version change.
- `POST /matching/run` for office-member rematch of an opportunity.
- Add Opportunity + Opportunity Bank edits trigger rematch; no persisted Operations.
- Firestore `matches` are client read-only.

### B.6 What Phase 5 actually changed

- Added `worker/src/operations-domain.js` + `operations-service.js` and client
  `public/js/operations-domain.js`.
- Worker upserts persisted `operations` and `notifications` after Match create / missing
  data / cooperation triggers (`POST /operations/action`, `/from-cooperation`,
  `/missing-data`).
- Operations Center consumes the persisted `operations` collection (active statuses
  only) via `workflow-office.js` snapshot → `iaqar:operations-data`; it no longer
  derives the home list from matches/deals/intake.
- FCM push is preference-gated and lock-screen-safe; delivery is not claimed without
  provider confirmation.
- Firestore: clients read-only on `operations` / `notifications`; composite indexes
  added for Operations Center queries.

### B.7 What Phase 6 actually changed

- Added `worker/src/cooperation-phase6-domain.js` + `cooperation-phase6-service.js` and
  client `public/js/cooperation-phase6-domain.js`.
- Worker routes `POST /cooperation/lifecycle` and `POST /cooperation/scope-revoke` for
  trusted accept / reject / revoke; writes `offices/{id}/auditLogs`; accept writes
  minimum `sharedOpportunities`; revoke removes or invalidates them (`revokedAt`).
- `currentOwningOfficeId` preserved on opportunities and projections; five Arabic
  cooperation statuses enforced; `DISABLED` mode blocks new requests/accepts.
- `SMART_AUTOMATIC` does not auto-accept or recommend brokers (Q-4 unresolved).
- No WhatsApp / Telegram messaging, Deals page, or bottom navigation.
