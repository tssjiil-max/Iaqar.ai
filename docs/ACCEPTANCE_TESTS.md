# IAQAR.AI — Acceptance Tests

The 15 approved acceptance scenarios, each with the automated test that proves it (or an
explicit statement that no test exists yet and why).

How to run everything:

```bash
npm install     # once, installs the jsdom dev dependency for DOM tests
npm test        # front-end + domain + rules tests, then the Worker suite
npm run check   # syntax/JSON parse of every shipped file (stand-in for a linter)
```

Status legend: **PASS** = an automated test asserts it and passes.
**PASS (manual)** = verified by reading/executing but not yet automated.
**PENDING (phase N)** = the feature belongs to a later phase and is not claimed.

Test files:

| File | Covers |
| --- | --- |
| `test/office-card.test.mjs` | Acceptance tests 1, 2, 14, 15 (shell half) — jsdom, against the real `public/index.html` |
| `test/office-settings-sections.test.mjs` | The approved Office Settings sections and field list (§7.1–§7.6) |
| `test/office-name.test.mjs` | Acceptance test 3, pure logic half |
| `test/firestore-rules.test.mjs` | Acceptance tests 3 (backend half) and 4 |
| `test/office-images.test.mjs` | Visual identity presets, crop geometry, validation, storage keys (§7.1) |
| `test/notification-preferences.test.mjs` | Acceptance test 10, plus browser/Worker table parity (§7.5, §17) |
| `test/cooperation.test.mjs` | Cooperation modes, default and status labels (§7.7, §19, §20) |
| `test/opportunity-bank.test.mjs` | Bank row projection and the §13/§26 visibility limits |
| `test/integration-honesty.test.mjs` | Acceptance test 15 (§10) |
| `test/opportunity-intake.test.mjs` | Acceptance test 5 — unified intake domain + Add Opportunity card |
| `test/emulator/firestore-rules.emulator.test.mjs` | Executable Firestore rules (Phase 1–8 isolation including legacy collections) |
| `test/opportunity-bank-phase3.test.mjs` | Phase 3 Opportunity Bank domain + shell access |
| `test/matching-phase4.test.mjs` | Phase 4 Matching Engine domain + rematch contracts |
| `test/operations-phase5.test.mjs` | Phase 5 Operations Center + Notifications (Tests 9–10) |
| `test/cooperation-phase6.test.mjs` | Phase 6 Cooperation ownership + revocation (Tests 11–12) |
| `test/messaging-phase7.test.mjs` | Phase 7 Smart message drafts + adapters (Test 13) |
| `test/hardening-phase8.test.mjs` | Phase 8 hardening — rate limits, PWA/a11y smoke, dead-code cleanup |
| `test/staging-phase9a.test.mjs` | Phase 9A staging kit — runtime routing, wrangler staging env, deploy guards |
| `worker/test/worker.test.mjs` | Worker routes and pure functions, including matching/preview, Phase 4–9A health env |
| `test/helpers/shell.mjs` | jsdom loader for the shell (not a test file) |

Status as of the end of **Phase 9A (full-functional kit)**:
- Phase 0–8 regression suites remain green.
- Staging path requires Worker `backendReady` (Firebase secrets on `--env staging`), not UI-only.
- Client fail-closed routes `--staging` Hosting to staging Worker; production hosts unchanged.
- Staging cron disabled; shared project/R2 side effects documented (D-018).
- Live staging deploy requires owner secrets; not claimed until `deploy:staging` succeeds.
- Aggregated gate: `npm run test:phase9a` (`npm test && npm run test:rules && npm run check`).

| # | Scenario | Status | Test |
| --- | --- | --- | --- |
| 1 | Office Settings access | **PASS** | `test/office-card.test.mjs` |
| 2 | No bottom navigation | **PASS** | `test/office-card.test.mjs` |
| 3 | Office name validation | **PASS** | `test/office-name.test.mjs`, `test/firestore-rules.test.mjs` |
| 4 | Office privacy | **PASS (emulator + static)** | `test/emulator/firestore-rules.emulator.test.mjs`, `test/firestore-rules.test.mjs` |
| 5 | Opportunity intake | **PASS** | `test/opportunity-intake.test.mjs` |
| 6 | No match | **PENDING (phase 3/4)** | — |
| 7 | Automatic rematch | **PASS** | `test/matching-phase4.test.mjs`, Worker `/matching/run` |
| 8 | Exactly one match | **PASS** | `test/matching-phase4.test.mjs`, `worker/test/worker.test.mjs` |
| 9 | Operation creation | **PASS** | `test/operations-phase5.test.mjs`, emulator Phase 5 cases, Worker Phase 5 |
| 10 | Notification | **PASS** | `test/operations-phase5.test.mjs`, `test/notification-preferences.test.mjs`, Worker Phase 5 |
| 11 | Cooperation ownership | **PASS** | `test/cooperation-phase6.test.mjs`, emulator Phase 6 cases |
| 12 | Cooperation revocation | **PASS** | `test/cooperation-phase6.test.mjs`, emulator Phase 6 cases |
| 13 | Message draft | **PASS** | `test/messaging-phase7.test.mjs`, emulator Phase 7 messages, Worker `/messages/*` |
| 14 | No deals page | **PASS** | `test/office-card.test.mjs` |
| 15 | Production honesty | **PASS** | `test/office-card.test.mjs`, `test/integration-honesty.test.mjs` |

Totals at the end of Phase 1: **202 automated tests pass, 0 fail** (145 in `test/`,
57 in `worker/test/` — up from the 40 that already existed, all of which still pass).

---

## TEST 1 — Office settings access

**Given** the home page, **when** the broker clicks the office logo, **then** Office
Settings opens. **When** the broker clicks the office cover image, **then** Office
Settings opens. **No separate Settings button exists.**

Automated assertions (`test/office-card.test.mjs`):

- The Office Card contains exactly two settings entry points, `#officeSettingsBtn`
  (logo) and `#officeSettingsCoverBtn` (cover), both `<button type="button">` with an
  `aria-label`.
- Dispatching a `click` on each one clears the `hidden` attribute on
  `#officeSettings`.
- Each entry point responds to `Enter` and `Space` keydown (native button behaviour is
  asserted through an explicit keyboard handler test so the requirement cannot regress
  if the element type changes).
- No element in the document has visible text matching `إعدادات المكتب` outside the
  settings sheet's own heading — the previous visible `<span>إعدادات المكتب</span>`
  label inside the logo button is gone, replaced by an `aria-label` and a
  `.visually-hidden` accessible name.
- The document contains no element whose accessible name or text is a standalone
  settings control on the home page.

**Status: PASS.**

## TEST 2 — No bottom navigation

The approved home page has no bottom navigation bar.

Automated assertions (`test/office-card.test.mjs`):

- No `<nav>`, no `[role=navigation]` and no `[role=tablist]` element exists.
- No element's class or id matches
  `/bottom[-_ ]?nav|nav[-_ ]?bar|navbar|tab[-_ ]?bar|bottom[-_ ]?bar|footer[-_ ]?nav/i`,
  and no stylesheet rule defines such a selector.
- The children of `.app` are exactly `header.card header`, `section.card license` and
  `section.card workspace`. This is the strongest form of the assertion: since the home
  page is enumerated, a bottom bar cannot be added inside it without failing.
- The element children of `<body>` are exactly the SVG sprite, `.app`, the two overlays
  (`#officeSettings`, `#opportunityBank`) and `#toast`, so nothing outside the app shell
  can act as a fixed bottom bar either.

`jsdom` has no layout engine, so this is asserted structurally rather than by measuring
positions — see "Known limitations".

**Status: PASS.**

## TEST 3 — Office name validation

An office name shorter than 4 characters is rejected. A normalized duplicate office
name is rejected. A unique name is accepted. Backend/database enforcement prevents
race-condition duplication.

Automated assertions:

`test/office-name.test.mjs` (pure logic, `public/js/office-domain.js`):

- `""`, `"   "`, `"\t\n"` → rejected with `اكتب اسم المكتب`.
- `"مكت"`, `"abc"`, `"م ك ت"`, `"a.b-c"` → rejected for length; separators and
  punctuation do not count as visible characters.
- `"مكتب"`, `"ABCD"`, `"مكتب المسار العقاري"` → accepted.
- `"مكتب<script>"` → rejected by the allowed-character rule.
- Names longer than 4 characters are accepted (the minimum is a floor, not an equality).
- `normalizeOfficeNameKey` collapses to the same key for: `مكتب الأمل`, `مكتب الامل`,
  `  مكتب   الأمل  `, `مَكتب الأمل` (diacritics), `مكتب الأمـل` (tatweel),
  and `مكتب الامله`/`مكتب الاملة` (ta-marbuta folding).
- `normalizeOfficeNameKey` distinguishes genuinely different names
  (`مكتب الأمل` ≠ `مكتب النور`).
- Latin case and NFKC width are folded: `AlMasar`, `almasar`, `ＡＬＭＡＳＡＲ` → same key.
- A whitespace-only name produces an empty key, and an empty key is never accepted for
  a claim.

`test/firestore-rules.test.mjs` (static analysis of `firestore.rules`):

- The `officeNameClaims` block requires `nameKey.size() >= 4` for non-platform-admins.
- The `officeNameClaims` update branch requires
  `resource.data.officeId == request.resource.data.officeId`, which is what prevents one
  office from repointing another office's claim at itself.
- `validOfficeProfile()` still requires `officeNameKey` and its minimum size.

Race conditions: uniqueness is a **document-ID** property of `officeNameClaims`, and
the claim plus the office plus the public projection are written in a single
`runTransaction`. Two concurrent saves of equivalent names contend on the same document
ID, so exactly one wins and the loser receives `OFFICE_NAME_TAKEN`, which the UI surfaces
as `اسم المكتب مستخدم أو محجوز؛ اختر اسمًا آخر`. The rule change above means this holds
even against a hand-crafted request that bypasses the client.

**Status: PASS.** Claim uniqueness is covered by static rules analysis plus the executable
emulator suite (`npm run test:rules`) for create / takeover / officeId immutability.

## TEST 4 — Office privacy

Office A cannot read, query, modify or download Office B data.

Automated assertions:

1. Static guard — `test/firestore-rules.test.mjs`
   - Every `match` block under `/offices/{officeId}` gates reads on `isOfficeMember(officeId)`
     or is `if false`.
   - `devices` is `read, write: if false`.
   - The permissive catch-all excludes `devices`, `officeSettings` and `brokerSettings`.
   - `officeSettings` / `brokerSettings` write conditions require matching `officeId` /
     `brokerId` ownership.
   - The only `if true` read is intentional `publicOffices`.

2. Emulator execution — `test/emulator/firestore-rules.emulator.test.mjs`
   - Loads the real `firestore.rules` file into the Firestore emulator.
   - Proves Office A/B officeSettings isolation, brokerSettings isolation,
     officeNameClaims takeover prevention, unauthenticated denials, cooperation
     non-exposure, and publicOffices continuity.
   - Command: `npm run test:rules` (11 pass / 0 fail on 2026-08-04).

Backend equivalent: `authorizeOfficeRequest` resolves membership from Firestore on every
sensitive route and throws `office_forbidden`. Media uploads pass through it before
touching R2, and the public cover route validates the object key against a strict
pattern so it cannot be used to read private intake media.

**Status: PASS (emulator + static).**

## TEST 5 — Opportunity intake

A URL or text can be submitted through the unified field; a supported attachment can be
selected through the paperclip; one Opportunity record is created or updated.

Automated coverage:
- `test/opportunity-intake.test.mjs` — URL/text/attachment intake, source-type detection,
  duplicate fingerprints, missing-field flow, persistence payload, no Operations item,
  officeId isolation, Add Opportunity card DOM.
- Worker: `normalizeOpportunitySourceType` for approved attachment kinds.
- Emulator: opportunities / opportunitySources tenant isolation.

**Status: PASS (Phase 2).** Extraction is deterministic/simulated only (`productionAi: false`).

## TEST 6 — Opportunity Bank (and no false Operations for unmatched opportunities)

A valid Opportunity is stored and visible in the originating office Opportunity Bank.
The bank supports list/detail, authorized edit, archive/restore, soft delete, date added,
cooperation status, and explicit sharing structures. No Match record and no Operations
Center item are created by Phase 3 bank actions. No WhatsApp/Telegram send occurs.

Automated coverage:
- `test/opportunity-bank-phase3.test.mjs` — access routing, list/detail projection,
  edit/ownership protection, archive/restore/soft-delete idempotency, cooperation status
  transitions, single/selected/scoped sharing, contact hiding, Phase 3 boundaries.
- `test/opportunity-bank.test.mjs` — row projection + bank query scoped to current office
  (controller in `opportunity-bank.js`).
- Emulator (`test/emulator/firestore-rules.emulator.test.mjs`) — Opportunity Bank
  tenant isolation, ownership immutability, hard-delete denial, cooperation
  create/accept/reject/revoke rules, shared projection contact ban, scoped sharing
  revocation.

**Status: PASS (Phase 3 Opportunity Bank).** Matching Engine and persisted Operations
remain Phase 4 / Phase 5; this test does not claim rematch or Operations creation.

## TEST 7 — Automatic rematch

Given a stored offer, when a compatible request is later created, matching runs
automatically without a manual broker action. Rematch also runs on Opportunity Bank edits
(and archive/restore/delete reconciliation) via Worker `POST /matching/run`.

Automated coverage:
- `test/matching-phase4.test.mjs` — client rematch helper, Add Opportunity / bank wiring,
  counterpart eligibility, no Operations creation.
- Worker: `/matching/preview` + `/matching/run` auth gate; public intake still calls
  `findAndSaveMatches`.

**Status: PASS (Phase 4).** No rematch button; rematch is automatic. Persisted Operations
Center items remain Phase 5.

## TEST 8 — Exactly one match

A compatible offer/request pair creates exactly one current Match for the same
matching/data version, and repeated event processing does not create duplicates.

Match ID = `mat_{sha256(officeId|canonicalPair|matchingRuleVersion|dataVersion)[0..36]}`.
Older current matches for the same pair/rule are marked `superseded` when a new data
version wins.

Automated coverage:
- `test/matching-phase4.test.mjs` — idempotent IDs; data-version change yields a new ID.
- Worker Phase 4 tests for rule version exposure and ID helpers.
- Emulator: clients cannot forge `matches` writes.

**Status: PASS (Phase 4).**

## TEST 9 — Operation creation

A valid actionable Match creates exactly one Operations Center item for the correct
office/broker.

Automated coverage:
- `test/operations-phase5.test.mjs` — `MATCH_REVIEW` / `MISSING_DATA` / `COOPERATION_*`
  builders; deterministic `deduplicationKey` and document IDs; idempotent upsert
  semantics; empty state «لا توجد فرص حالياً» / «ستظهر الفرص المباشرة هنا»; active-only
  projector; Phase 5 UI boundaries (no bottom nav, no deals page, no messaging actions
  on ops cards); Worker `/operations/action`|/from-cooperation|/missing-data wiring;
  rules + indexes static checks.
- Emulator Phase 5 cases in `test/emulator/firestore-rules.emulator.test.mjs` —
  members read own-office Operations; forge/mutate/delete denied; cross-office and
  unauthenticated reads denied.
- Worker Phase 5 cases in `worker/test/worker.test.mjs` — operations endpoints require
  authentication; Phase 5 boundary guarantees.

**Status: PASS (Phase 5).** Operations are persisted under
`offices/{officeId}/operations` with Worker-trusted writes.

## TEST 10 — Notification

The actionable Match creates a notification according to the broker's preferences.

Automated coverage:
- `test/operations-phase5.test.mjs` — in-app notification linked to Operation;
  lock-screen-safe copy (`sensitivePreview: false`); push queued independently of
  Operation creation; delivery not claimed without provider confirmation.
- `test/notification-preferences.test.mjs` — preference schema defaults; broker
  overrides; push `type` → preference-key mapping; `notification_test` always allowed.
- Emulator Phase 5 cases — notifications office-isolated; delivery state not
  client-writable.
- Worker Phase 5 / FCM cases — `notificationCategoryAllowed` gate; FCM payload builder;
  stale-token handling; operations push path respects prefs.

**Status: PASS (Phase 5).** Auditable `notifications` records are persisted; prefs are
respected before push. Device FCM delivery is not claimed without provider confirmation.

## TEST 11 — Cooperation ownership

When an Opportunity is shared, the originating office and broker remain the owners, and
the cooperating broker receives only approved access.

Automated coverage:
- `test/cooperation-phase6.test.mjs` — five Arabic statuses exact; ownership fields
  (`originatingOfficeId`, `originatingBrokerId`, `currentOwningOfficeId`, …) preserved
  across cooperation patches; shared projections strip contacts and forbid ownership
  transfer; `DISABLED` mode blocks new requests/accepts; Worker
  `/cooperation/lifecycle` client contract; `createsAutomaticCooperation: false`.
- Emulator Phase 6 cases in `test/emulator/firestore-rules.emulator.test.mjs` —
  accepted share keeps ownership on the origin opportunity (`currentOwningOfficeId`
  immutable); `auditLogs` office-isolated and not client-writable.
- Worker Phase 6 cases — lifecycle / scope-revoke routes require auth; Phase 6
  boundary guarantees.

**Status: PASS (Phase 6).** Explicit cooperation only. `SMART_AUTOMATIC` does not
auto-accept or recommend brokers (Q-4 unresolved).

## TEST 12 — Cooperation revocation

When cooperation is revoked, the cooperating party loses future access.

Automated coverage:
- `test/cooperation-phase6.test.mjs` — revocation cleanup plan targets
  `sharedOpportunities`; revoke decision is idempotent and terminal (`REVOKED`);
  audit entries exclude sensitive contact fields.
- Emulator Phase 6 cases — revoked `sharedOpportunities` (`revokedAt` set) are no
  longer readable by the cooperating office.
- Worker `/cooperation/lifecycle` (REVOKE) and `/cooperation/scope-revoke` remove or
  invalidate shared projections.

**Status: PASS (Phase 6).**

## TEST 13 — Message draft

A Match or communication Operation can generate an Arabic WhatsApp or Telegram draft, and
it is not marked sent until a real send action or confirmed external response occurs.

Automated assertions (`test/messaging-phase7.test.mjs`, emulator, Worker):

- Arabic templates for match / viewing / follow-up / media / deal stages.
- Persisted draft shape: channel, recipient, related ids, `createdAt`, `sendState=DRAFT`,
  `deliveryState=NOT_APPLICABLE`, honesty flags false.
- External handoff → `OPENED_EXTERNAL` only (never `SENT` / `DELIVERED`).
- WhatsApp adapter `adapter_ready` (`wa.me`); Telegram adapter `simulated` (share URL +
  webhook validation fixture; inbound/outbound Bot API off).
- MATCH_REVIEW Operations offer draft actions; `sendsWhatsApp` / `sendsTelegram` false.
- Firestore clients cannot forge `SENT` / `DELIVERED` on `messages`.
- `/meta/*messages*` / `*send*` still 403 `outbound_disabled`.

**Status: PASS (Phase 7).**

## TEST 14 — No deals page

There is no separate Deals page or bottom navigation item.

Automated assertions (`test/office-card.test.mjs`):

- No element has `data-main="deals"`.
- The shell contains no `الصفقات` navigation control (the string is asserted absent from
  every element that is a button, link or list item).
- The `.main-sections` tab strip is gone; the Operations Center is a single list.
- The Operations Center renders every actionable record in one list, so removing the tab
  cannot hide deal records: the test feeds an `iaqar:operations-data` event containing a
  record with `main: "deals"` and asserts it appears.

**Status: PASS.** Empty-state copy (Phase 5): «لا توجد فرص حالياً» /
«ستظهر الفرص المباشرة هنا».

## TEST 15 — Production honesty

Mock integrations are clearly separated from production adapters. No fake success is
shown as a real WhatsApp/Telegram delivery.

Automated assertions:

- `test/office-card.test.mjs` — the shell ships **zero** hard-coded operation records:
  the operations list is empty on load, `#total` reads `0`, and the approved empty state
  («لا توجد فرص حالياً» / «ستظهر الفرص المباشرة هنا») is visible.
- `test/integration-honesty.test.mjs` — no shipped file contains a hard-coded
  "delivered"/"sent" claim for WhatsApp or Telegram; the Worker's outbound guard
  (`/meta/*messages*`, `/meta/*send*` → 403 `outbound_disabled`) is present; the
  WhatsApp status copy in the settings sheet is one of the honest states
  (`غير مربوط`, `يحتاج إعداد Meta`, `بانتظار إعداد Meta`, `مربوط`,
  `يتطلب تسجيل الدخول`, `جارٍ التحقق`, `جارٍ إكمال الربط`, `فشل الربط`) and never a
  fabricated "connected" default; and `worker/wrangler.toml` ships empty `META_APP_ID`
  and `META_CONFIG_ID` so `/meta/config` reports `enabled: false`.

**Status: PASS.**

---

## Known limitations of this suite

1. **Firestore rules execute in the emulator through Phase 8.** `npm run test:rules` loads
   the real `firestore.rules` via `@firebase/rules-unit-testing` (legacy catch-all
   collections included). `test/firestore-rules.test.mjs` remains as a fast static
   regression guard. Speculative performance indexes and a Playwright browser lab are
   still out of scope.
2. **No visual browser/device lab.** DOM tests run in `jsdom`, which has no layout engine,
   so "mobile-first" and "no bottom navigation" are asserted structurally (element and CSS
   rule shape) rather than visually. Phase 8 ships PWA/a11y smoke tests instead.
3. **Image cropping is asserted on its geometry function, not on pixels.** `jsdom` has no
   `CanvasRenderingContext2D`. `test/office-images.test.mjs` asserts the crop rectangle
   maths, the preset ratios, the type/size validation and the variant→key mapping; the
   actual canvas draw is exercised only in a browser.
4. **Network calls are not exercised.** Upload/delete tests assert the request the client
   would send (method, headers, variant) against a stub `fetch`, not a live Worker.
