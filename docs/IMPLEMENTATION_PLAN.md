# IAQAR.AI — Implementation Plan

Phases, dependencies, risks and current progress. One phase at a time; each phase stops
for owner approval before the next begins.

Current position: **Phase 0–5 complete — stop (do not begin Phase 6).**

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
| 6 | Cooperation | NOT STARTED |
| 7 | Smart messages and integration adapters | NOT STARTED |
| 8 | Hardening | NOT STARTED |

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

- Automatic cooperation broker selection / full cooperation lifecycle UI — Phase 6
- WhatsApp / Telegram smart message drafts and channel adapters — Phase 7
- Deals page, bottom navigation, or home redesign — never

## Phase 6 — Cooperation

Depends on: Phases 3 and 5.

Scope: cooperation requests, approvals, revocation, permission scopes, ownership
preservation, the five visible Arabic statuses, and audit logging of every sensitive
cooperation action.

Risks: cross-office reads are the single largest isolation risk in the product; contact
information must stay hidden until permissions allow it; the system must not create any
financial or contractual commitment.

Exit criteria: Tests 11 and 12 PASS.

## Phase 7 — Smart messages and integration adapters

Depends on: Phases 5 and 6.

Scope: Arabic message templates; a WhatsApp adapter contract; a Telegram adapter
contract; webhook validation structure; local simulation fixtures; persisted drafts with
channel, recipient, related opportunity/match/operation, created time, send state,
delivery state and failure reason; honest integration state labels.

Risks: credentials are absent, so the phase must ship as "adapter ready"/"simulated" and
must never store fake delivery success.

Exit criteria: Test 13 PASS; Test 15 still PASS.

## Phase 8 — Hardening

Scope: full security review beyond the Phase 1 emulator gate already shipped in
`test/emulator/firestore-rules.emulator.test.mjs` (`npm run test:rules`); expand
tenant-isolation coverage to remaining collections; performance; indexes; retry
behaviour; error handling; accessibility; mobile device testing; PWA validation; the
end-to-end acceptance suite.

Carried into this phase from the Phase 0 audit:

- `AUDIT_PHASE0.md` §5 risk 2 — the office catch-all rule still lets any active member
  write most office documents. Phase 1 removed the settings collections from it; a full
  fix needs per-collection rules plus protected-field guards.
- §5 risk 4 — no rate limiting on the unauthenticated public intake endpoints.
- Dead code removal: `public/js/public-intake.js` (never loaded) and the unused
  client-side matcher in `public/js/workflow-office.js`.
- The two duplicated ~166 KB base64 logos inside `public/index.html`.
- Duplicated label tables between the Worker and `workflow-office.js`.
