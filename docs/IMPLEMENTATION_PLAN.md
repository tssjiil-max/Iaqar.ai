# IAQAR.AI — Implementation Plan

Phases, dependencies, risks and current progress. One phase at a time; each phase stops
for owner approval before the next begins.

Current position: **Phase 9A full-functional staging kit delivered — stop before Phase 9B / production deploy.**

Live staging Worker + Hosting channel deploy requires owner credentials
(`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `FIREBASE_TOKEN`) **and** Worker
staging secrets (`FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`,
`FIREBASE_PRIVATE_KEY_ID`) so `/health.backendReady === true`. Not claimed live until
`npm run deploy:staging` succeeds with that gate.

---

## Progress

| Phase | Title | State |
| --- | --- | --- |
| 0 | Foundation and audit | **DONE** |
| 1 | Office Card and Office Settings | **DONE** |
| 2 | Unified opportunity intake | **DONE** |
| 3 | Opportunity Bank | **DONE** |
| 4 | Matching engine | **DONE** |
| 5 | Operations Center and notifications | **DONE** |
| 6 | Cooperation | **DONE** |
| 7 | Smart messages and integration adapters | **DONE** |
| 8 | Hardening | **DONE** |
| 9A | Staging deployment (full-functional) | **DONE (kit)** — live deploy blocked on secrets |
| 9B | Production deployment | **NOT STARTED** |

## Phase 0 — Foundation and audit (DONE)

Delivered:

- `docs/AUDIT_PHASE0.md` — every tracked file read; each required feature classified as
  REAL AND CONNECTED / PARTIAL / DEMO OR MOCK / MISSING / BROKEN, with file and line
  citations.
- `docs/PROJECT_CONSTITUTION.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/DATA_MODEL.md`,
  `docs/EVENT_WORKFLOW.md`, `docs/ACCEPTANCE_TESTS.md`, this file, and
  `docs/DECISIONS.md`.
- `.cursor/rules/iaqar-project-constitution.mdc` — always-applied project rule.
- No product UI changed in this phase.

Existing Arabic `docs/*.txt`, `CHANGELOG-*.txt` and `VALIDATION-*.txt` files were left
untouched; the new documents are additive.

## Phase 1 — Office Card and Office Settings (DONE)

Delivered against the directive's Phase 1 checklist:

| Deliverable | State | Where |
| --- | --- | --- |
| Clicking logo opens Office Settings | DONE | `#officeSettingsBtn` in `public/index.html`, handler in `public/js/office-settings.js` |
| Clicking cover opens Office Settings | DONE | `#officeSettingsCoverBtn` (new cover element on the Office Card) |
| No visible Settings button | DONE | the visible `<span>إعدادات المكتب</span>` label was replaced by an `aria-label` + `.visually-hidden` name |
| Logo upload/update | DONE | variant `logo`, 1:1 preset |
| Cover upload/update | DONE | variant `cover`, wide preset |
| Display image upload/update | DONE | variant `display`, 4:3 preset |
| Wide WhatsApp-style cover crop preset | DONE | `OFFICE_IMAGE_PRESETS.cover` — ratio is a **configurable setting**, not a hard-coded verified WhatsApp dimension (see `DECISIONS.md` D-003) |
| Office name / broker name / license / city / mobile | DONE | `#officeProfileForm` |
| No visible email field | DONE (already true) | asserted by test |
| Minimum 4-visible-character name validation | DONE | `validateOfficeName` |
| System-wide normalized name uniqueness | DONE | Arabic-aware `normalizeOfficeNameKey` + `officeNameClaims` transaction + hardened rule |
| Office link copy | DONE | |
| Office link share | DONE | `navigator.share` with clipboard fallback, plus the existing office-card image share |
| QR code | DONE | rendered on screen from `qrcode.js`, downloadable |
| Public link preview | DONE | opens `/o/{slug}` in a new tab |
| Notification preferences | DONE | six categories, per office + per broker, gate enforced in the Worker |
| Opportunity Bank entry (`بنك الفرص`) | DONE (entry + minimal real read-only view) | see `DECISIONS.md` D-005 |
| Smart cooperation mode | DONE | three modes, default `APPROVAL_REQUIRED`, automatic contact exposure hard-wired off |
| Correct Arabic RTL behaviour | DONE | new markup inherits the existing `dir="rtl"` shell and design tokens |
| Mobile-first layout | DONE | new sections reuse the existing grid/`@media(max-width:365px)` patterns |
| `officeId` isolation | DONE | new documents carry `officeId`; new rules are least-privilege |
| Loading / success / empty / error states | DONE | per-image status region, per-section save state, bank empty state, operations empty state |
| Automated tests | DONE | root `npm test`: 6 new test files + the 40 existing Worker tests |

Also fixed inside Phase 1 scope because they are constitution-level invariants rather
than optional polish:

- Removed the `الصفقات` tab (§21, Test 14) and folded deal records into the single
  Operations Center list so no functionality was lost.
- Removed the six hard-coded demo operations and added the approved empty state
  (§16, §1.7, Test 15).
- Fixed the office-name claim takeover hole in `firestore.rules`
  (`AUDIT_PHASE0.md` §5 risk 1).
- Pulled `officeSettings` and `brokerSettings` out of the permissive catch-all rule
  (partial mitigation of `AUDIT_PHASE0.md` §5 risk 2).

Explicitly **not** done in Phase 1, by design:

- The **Add Opportunity** card. §5 lists it as one of the three approved home sections,
  but §28 assigns the unified intake to Phase 2 and §31 forbids starting Phase 2. The
  home page therefore currently shows two of the three approved sections. This is a
  known, deliberate gap and the first item of Phase 2.
- The full Opportunity Bank (edit, archive, delete, single/multi sharing, scoped bank
  sharing) — Phase 3.
- Per-broker push routing and persisted `notifications` records — Phase 5.
- Everything cooperation beyond the mode setting — Phase 6.

## Phase 2 — Unified opportunity intake

Depends on: Phase 1 (settings surface, image pipeline, domain module pattern).

Scope: the Add Opportunity card on the home page (one compact text/link input, one
paperclip, one submit action inside the same row — no per-file-type buttons); attachment
chooser (camera, image, screenshot, PDF, Excel, Word, audio); source persistence with a
raw attachment record; opportunity normalization into the unified entity; the
missing-data flow that asks only for what extraction could not find; deduplication by
normalized URL, file checksum and content fingerprint; the visible states
(uploading / analyzing / missing information / saved / failed with retry) with no
technical logs shown to the broker.

Risks:

- **Extraction providers.** OCR, document parsing and transcription are not available in
  the current stack. The adapter boundary must be built with deterministic fixtures and
  labelled "simulated"; production extraction must not be faked (§12, §10).
- **Unified vs. projection.** Today `clients`, `owners` and `opportunities` are parallel
  copies. Making `opportunities` authoritative touches the matching engine, so the
  migration order matters: introduce the unified fields first, keep writing the
  projections, then switch readers.
- **File size limits.** Worker request-body limits and R2 costs constrain audio/video.

Exit criteria: Test 5 PASS; no fake extraction on any production path.

Phase 2 delivered on this branch:
- Home Add Opportunity card (text/link + paperclip + submit)
- Domain pipeline with deterministic text parser + simulated attachment fixtures
- `opportunitySources` + unified `opportunities` persistence (client) with Worker media upload
- Dedup fingerprints, missing-field flow, visible states, no Operations item / no matching
- Automated tests under `test/opportunity-intake.test.mjs` + emulator isolation cases

## Phase 3 — Opportunity Bank

Depends on: Phase 2.

Scope: the private per-office bank; essential opportunity list and detail; the visible
activity summary limited to **date added** and **cooperation status** only; edit /
archive / delete rules; single and multi-select sharing; the scoped bank-sharing model
(explicit opt-in, revocable, defined scope, filterable categories, read-only by default,
minimum data, contact hidden by default, ownership preserved).

Risks: "share the entire bank" must never become raw database access; scoped read
permissions across offices need rules that cannot be expressed as a simple path match, so
a permission-document join (or a Worker-mediated read) is required.

Exit criteria: Test 6 PASS (Opportunity Bank half); full no-match Operations behaviour remains Phase 5.

Phase 3 delivered on this branch:

- `public/js/opportunity-bank-domain.js` — lifecycle, edit/archive/restore/soft-delete,
  cooperation request builders, scoped bank sharing, shared minimum projection, Phase 3
  boundary guarantees (no match / ops / messaging / matching engine)
- `public/js/opportunity-bank.js` — bank UI from Office Settings → بنك الفرص (list, detail,
  lazy source, pagination, archive/restore/soft-delete confirm, single/selected share,
  scoped share, incoming accept/reject, revoke)
- Firestore: ownership-stable `opportunities` updates, hard delete denied;
  `cooperationRequests`, `bankSharingScopes`, `sharedOpportunities`
- Tests: `test/opportunity-bank-phase3.test.mjs` + emulator Phase 3 isolation cases
- Docs: DATA_MODEL / SYSTEM_ARCHITECTURE / ACCEPTANCE_TESTS / DECISIONS D-012

## Phase 4 — Matching engine

Depends on: Phase 2.

Scope: eligibility, scoring, match reasons, configurable thresholds in one place,
idempotency keyed on (canonical pair, matching rule version, relevant data version),
automatic rematching on every relevant event including opportunity edits.

Risks: changing the match ID scheme means existing `mat_*` documents must be migrated or
version-tagged; thresholds are currently a Worker constant (`MATCH_THRESHOLD = 55`) and
must not leak into UI code.

Exit criteria: Tests 7 and 8 PASS.

Phase 4 delivered on this branch:

- `worker/src/matching-engine.js` — single config (`MATCHING_RULE_VERSION`, threshold,
  weights), scoring/reasons, opportunity eligibility, versioned match IDs
- Worker `POST /matching/run` — office-member rematch for an opportunity; supersedes
  stale current matches for the same pair/rule when data version changes
- Client triggers: Add Opportunity + Opportunity Bank edit/archive/restore/delete call
  rematch; `createsOperation` remains false (Phase 5)
- Firestore: `matches` read by office members; client create/update/delete denied
- Tests: `test/matching-phase4.test.mjs`, Worker Phase 4 cases, emulator matches rules
- Docs: DATA_MODEL / EVENT_WORKFLOW / ACCEPTANCE_TESTS (Tests 7–8) / DECISIONS D-013

## Phase 5 — Operations Center and notifications (DONE)

Depends on: Phases 2–4.

Scope: real persisted `operations` records with the §16 field set and a
`deduplicationKey`; the empty state (already shipped in Phase 1); match operation,
missing-data operation, cooperation operation; FCM and in-app routing per office **and**
per assigned broker; auditable `notifications` records.

Risks: device registrations are currently per office, so per-broker routing needs a
`brokerId`/`uid` on each device document — a schema change to a Worker-only collection.

Exit criteria: Tests 9 and 10 fully PASS.

Phase 5 delivered on this branch:

- Persisted `offices/{officeId}/operations` and `offices/{officeId}/notifications`
  collections (Worker-trusted writes; clients cannot create/update/delete)
- Operation types: `MATCH_REVIEW`, `MISSING_DATA`, `COOPERATION_REQUEST`,
  `COOPERATION_RESPONSE` (plus reserved `EXTERNAL_RESPONSE` / `SYSTEM_ACTION`)
- Worker upsert after Match persist (`createMatchReviewBundle` / `deduplicationKey`);
  missing-data and cooperation upserts via domain builders
- Worker routes: `POST /operations/action`, `/operations/from-cooperation`,
  `/operations/missing-data`
- Operations Center listens to active Operations only
  (`OPEN` / `IN_PROGRESS` / `WAITING_EXTERNAL_RESPONSE`) — no longer derived from
  matches/deals/intake for the home list
- Lock-screen-safe FCM copy (`sensitivePreview: false`; generic Arabic titles/bodies;
  queue/send recorded without claiming device delivery absent provider confirmation)
- Notification preferences respected before push (`notificationCategoryAllowed`)
- Firestore rules restrict client writes on `operations` / `notifications`; indexes for
  active Operations and notifications list queries
- Tests: `test/operations-phase5.test.mjs`, emulator Phase 5 cases, Worker Phase 5 cases
- Decision: D-014

Explicitly **not** done in Phase 5 (future phases):

- Automatic cooperation broker selection / full cooperation lifecycle — Phase 6
- WhatsApp / Telegram smart message drafts and channel adapters — Phase 7
- Deals page, bottom navigation, or home redesign — never

## Phase 6 — Cooperation (DONE)

Depends on: Phases 3 and 5.

Scope: cooperation requests, approvals, revocation, permission scopes, ownership
preservation, the five visible Arabic statuses, and audit logging of every sensitive
cooperation action.

Risks: cross-office reads are the single largest isolation risk in the product; contact
information must stay hidden until permissions allow it; the system must not create any
financial or contractual commitment.

Exit criteria: Tests 11 and 12 PASS.

Phase 6 delivered on this branch:

- Worker `POST /cooperation/lifecycle` + `POST /cooperation/scope-revoke` — trusted
  accept / reject / revoke for explicit cooperation requests and bank-sharing scopes
- `offices/{officeId}/auditLogs` — Worker-written audit entries for sensitive
  cooperation actions (request created/accepted/rejected/revoked, scope revoke,
  shared projection write/remove)
- Revoke removes or invalidates `sharedOpportunities` projections (`revokedAt` /
  delete) so the cooperating party loses future access
- Accept writes real minimum shared projections (contact forced empty; ownership
  not transferred)
- `DISABLED` mode enforced — blocks new explicit requests and accepts
- `currentOwningOfficeId` stamped and preserved on opportunities / projections
- Five Arabic statuses exact: `لم تُشارك`, `بانتظار الموافقة`, `تعاون نشط`,
  `رُفض الطلب`, `انتهى التعاون`
- Tests 11–12 PASS (`test/cooperation-phase6.test.mjs` + emulator Phase 6 cases)
- Decision: D-015

Explicit limitation (Q-4 unresolved):

- `SMART_AUTOMATIC` does **not** auto-accept or recommend brokers. The mode may be
  stored, but behaviour falls back to explicit approval. `createsAutomaticCooperation`
  remains `false`; no invented performance scores or broker recommendations.

Explicitly **not** done in Phase 6 (future phases):

- WhatsApp / Telegram smart message drafts and channel adapters — Phase 7
- Deals page, bottom navigation, or home redesign — never

## Phase 7 — Smart messages and integration adapters (DONE)

Depends on: Phases 5 and 6.

Delivered:

- Arabic message templates (`TEMPLATE_CODES`) covering match, viewing, follow-up, media
  request, deal stages, and operation review — Worker + client mirrors.
- WhatsApp adapter contract: `adapter_ready`, broker handoff via `wa.me`; Cloud API
  outbound remains blocked (`outbound_disabled`).
- Telegram adapter contract: `simulated` share URL (`t.me/share`); webhook validation
  fixture (`X-Telegram-Bot-Api-Secret-Token`); inbound/outbound Bot API disabled.
- Persisted drafts at `offices/{officeId}/messages/{msg_*}` with channel, recipient,
  related opportunity/match/operation, `createdAt`, `sendState`, `deliveryState`,
  `failureReason`, honesty flags.
- Worker routes: `POST /messages/draft`, `POST /messages/handoff`, `GET /messages/adapters`.
- Client wiring: Operations Center MATCH_REVIEW draft actions; workflow persist +
  external handoff; labels never claim provider send/delivery from handoff.
- Firestore: `messages` restricted (member read; Worker-only write).
- Acceptance: Test 13 PASS; Test 15 still PASS. Decision: D-016.

Explicitly **not** done in Phase 7 (future / open):

- Automatic Cloud API / Bot API send (Q-3 unresolved) — `sendsWhatsApp` /
  `sendsTelegram` remain false; handoff sets `OPENED_EXTERNAL` only.
- Fake delivery success — never stored.
- Deals page, bottom navigation, or home redesign — never.
- Phase 8 hardening — do not begin.

Exit criteria: Test 13 PASS; Test 15 still PASS. **Met.**

## Phase 8 — Hardening (DONE)

Depends on: Phases 0–7.

Delivered:

- **Risk 2 (catch-all privilege):** `clients`, `owners`, `deals`, `alerts`, `inbox`,
  `usage`, `contacts`, `publicIntake` pulled into `isRestrictedOfficeCollection` with
  explicit rules. Worker-only writes for legacy pipeline collections; `contacts` remain
  member-writable with phone-shaped ids; deal price/note updates go through
  `POST /workflow/action` (`update_deal_fields`).
- **Risk 4 (public abuse):** sliding-window rate limits on `POST /pipeline/public-intake`
  and `POST /media/public-intake` (`worker/src/public-rate-limit.js`) → 429 `rate_limited`.
- **Dead code / size:** deleted unused `public/js/public-intake.js`; removed unused
  client matcher; replaced duplicated ~166 KB base64 logos with
  `/icons/default-office.png`.
- **PWA:** removed deals shortcut from `manifest.webmanifest`; refreshed SW cache list
  (`iaqar-shell-phase8-v1`) for Phase 2–7 modules.
- **A11y / acceptance aggregation:** smoke tests for accessible names + modal dialogs;
  `npm run test:phase8` runs `npm test && npm run test:rules && npm run check`.
- Indexes audited against live listeners — no speculative indexes added.
- Acceptance regressions: Tests 14–15 still PASS. Decision: **D-017**.

Explicitly **not** claimed:

- Full visual/real-device mobile lab or Playwright browser e2e (jsdom structural suite
  remains the automated gate).
- Event outbox / background job rewrite.
- Automatic Cloud API / Bot API send (Q-3 still open).
- Deals page, bottom navigation, or home redesign — never.
- Full label-table unification across Worker/client (Worker remains source of truth for
  matching/workflow stages).

Exit criteria: Risks 2 & 4 mitigated with tests; emulator covers legacy collections;
PWA/a11y smoke green; Tests 14–15 PASS; no Deals/bottom-nav/auto-send. **Met.**

## Phase 9A — Full-functional staging deployment (DONE — kit; live deploy needs secrets)

Depends on: Phase 8.

Delivered:

- **Staging Worker env** in `worker/wrangler.toml` (`[env.staging]`, name
  `iaqar-intake-staging`, `DEPLOYMENT_ENV=staging`, **cron disabled**). Production
  Worker name unchanged.
- **Client runtime routing (fail closed)** via `public/js/runtime-config.js`:
  `--staging` / `?env=staging` → staging Worker; never fall back to production Worker
  on staging hosts. Channel-local `/__/firebase/init.js`.
- **Full-functional deploy scripts:** `scripts/deploy-staging.sh` (+ `.ps1`),
  `npm run deploy:staging` — tests → `wrangler deploy --env staging` →
  `hosting:channel:deploy staging` → require `/health.backendReady` →
  `smoke-staging.mjs`. Refuses production / bare deploy commands.
- **Health** exposes `deploymentEnvironment`, `firebaseConfigured`, `backendReady`,
  `cronEnabled`; staging keeps `outboundMessaging: false`.
- **SW / cache:** `iaqar-shell-phase9a-v2`; `runtime-config.js` is network/`no-store`.
- **Docs / tests:** `docs/STAGING-DEPLOY.md`, `test/staging-phase9a.test.mjs`.
  Decision: **D-018**. Gate: `npm run test:phase9a`.

Explicit Phase 9A choices / limits:

- Same Firebase project `aqar-b5d76` and same R2 bucket `iaqar-media` — not a second
  project; staging writes mutate shared data (documented).
- Live staging deploy is **blocked** until Cloudflare + Firebase CI tokens **and**
  Worker staging Firebase secrets are present; kit verified by automated tests until then.
- Meta / outbound Cloud API credentials stay empty on staging (drafts/handoff still work
  once `backendReady`).

Explicitly **not** in Phase 9A:

- Production Worker or live Hosting deploy (Phase 9B / owner-run `deploy-all`)
- Automatic WhatsApp/Telegram send (Q-3)
- Deals page / bottom navigation / home redesign
- Isolated staging Firebase project

Exit criteria: staging path is full-functional (not UI-only); cannot hit production
deploy targets; client routes staging Hosting → staging Worker; docs + tests green;
live deploy + smoke when credentials present. **Kit met; live deploy pending secrets.**

**STOP HERE — do not begin Phase 9B / production deploy without owner approval.**
