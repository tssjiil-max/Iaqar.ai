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
| `worker/test/worker.test.mjs` | Worker routes and pure functions, including the Phase 1 image variants and the notification gate |
| `test/helpers/shell.mjs` | jsdom loader for the shell (not a test file) |

Status as of the end of **Phase 1**:

| # | Scenario | Status | Test |
| --- | --- | --- | --- |
| 1 | Office Settings access | **PASS** | `test/office-card.test.mjs` |
| 2 | No bottom navigation | **PASS** | `test/office-card.test.mjs` |
| 3 | Office name validation | **PASS** | `test/office-name.test.mjs`, `test/firestore-rules.test.mjs` |
| 4 | Office privacy | **PASS (emulator + static)** | `test/emulator/firestore-rules.emulator.test.mjs`, `test/firestore-rules.test.mjs` |
| 5 | Opportunity intake | **PENDING (phase 2)** | — |
| 6 | No match | **PENDING (phase 3/4)** | — |
| 7 | Automatic rematch | **PENDING (phase 4)** | — |
| 8 | Exactly one match | **PASS (partial)** | `worker/test/worker.test.mjs` |
| 9 | Operation creation | **PENDING (phase 5)** | — |
| 10 | Notification | **PASS (partial)** | `test/notification-preferences.test.mjs`, `worker/test/worker.test.mjs` |
| 11 | Cooperation ownership | **PENDING (phase 6)** | — |
| 12 | Cooperation revocation | **PENDING (phase 6)** | — |
| 13 | Message draft | **PENDING (phase 7)** | — |
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

**Status: PENDING (phase 2).** The unified intake control does not exist. Today intake
happens through the public office link form and the PWA share target only. Not claimed.

## TEST 6 — No match

A valid Opportunity with no match is stored in the office Opportunity Bank, and no
Operations Center item is created merely because no match exists.

**Status: PENDING (phase 3/4).** Half of this already holds: `handlePublicIntakeMatching`
writes the opportunity record before matching runs and creates an alert only when
`matches.length > 0`. The Phase 1 Opportunity Bank entry can display those stored
opportunities. The scenario is not claimed until the bank and the operations model are
delivered.

## TEST 7 — Automatic rematch

Given a stored offer, when a compatible request is later created, matching runs
automatically without a manual broker action.

**Status: PENDING (phase 4).** Matching does run automatically on new intake, and there
is no "rematch" button anywhere, but rematching on *edit* of an existing opportunity does
not exist. Not claimed.

## TEST 8 — Exactly one match

A compatible offer/request pair creates exactly one current Match for the same
matching/data version, and repeated event processing does not create duplicates.

**Status: PASS (partial).** `worker/test/worker.test.mjs` covers the scorer, the
threshold, the top-3 cap and the intake `duplicate: true` short-circuit. The match ID is
a content hash of `officeId` + the sorted pair and existing matches are skipped, so a
replay cannot duplicate. **Not yet satisfied:** the ID does not include a matching-rule
version or a data version, which §15 recommends. Phase 4.

## TEST 9 — Operation creation

A valid actionable Match creates exactly one Operations Center item for the correct
office/broker.

**Status: PENDING (phase 5).** Operations are derived client-side and never persisted,
so there is no `deduplicationKey` to assert on. Not claimed.

## TEST 10 — Notification

The actionable Match creates a notification according to the broker's preferences.

Automated assertions:

- `test/notification-preferences.test.mjs` — the preference schema defaults every
  category to enabled; broker overrides win over office defaults; office defaults win
  over built-ins; unknown keys are dropped; the push `type` → preference-key mapping is
  exhaustive and falls back to `systemNotifications`; `notification_test` always passes
  the gate.
- `worker/test/worker.test.mjs` — the FCM payload builder, the FID-first/token-fallback
  target, the deep link, stale-token detection, and the new
  `notificationCategoryAllowed` gate including the "missing document means enabled"
  behaviour.

**Status: PASS (partial).** The preference document is persisted per office and per
broker, and `sendOfficePush` refuses to send a disabled category. **Not yet satisfied:**
per-broker routing of pushes (devices are registered per office, not per broker), and
persisted auditable `notifications` records. Phase 5.

## TEST 11 — Cooperation ownership

When an Opportunity is shared, the originating office and broker remain the owners, and
the cooperating broker receives only approved access.

**Status: PENDING (phase 6).** Phase 1 ships only the office-level cooperation **mode**
setting (default `APPROVAL_REQUIRED`, automatic contact exposure hard-wired off). No
cooperation records, no sharing, no cross-office access exists — so nothing can leak
yet, but nothing is claimed either.

## TEST 12 — Cooperation revocation

When cooperation is revoked, the cooperating party loses future access.

**Status: PENDING (phase 6).**

## TEST 13 — Message draft

A Match or communication Operation can generate an Arabic WhatsApp or Telegram draft, and
it is not marked sent until a real send action or confirmed external response occurs.

**Status: PENDING (phase 7).** Arabic WhatsApp drafts are generated today and handed to
`wa.me` for the broker to send; nothing is ever marked as sent or delivered, which is
correct. Drafts are not persisted and Telegram does not exist, so the scenario is not
claimed.

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

**Status: PASS.**

## TEST 15 — Production honesty

Mock integrations are clearly separated from production adapters. No fake success is
shown as a real WhatsApp/Telegram delivery.

Automated assertions:

- `test/office-card.test.mjs` — the shell ships **zero** hard-coded operation records:
  the operations list is empty on load, `#total` reads `0`, and the approved empty state
  is visible.
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

1. **Phase 1 rules are now executed in the emulator.** `npm run test:rules` loads the
   real `firestore.rules` via `@firebase/rules-unit-testing` and covers the Phase 1
   security gate cases. `test/firestore-rules.test.mjs` remains as a fast static
   regression guard. Broader Phase 8 hardening (every collection/rule branch, performance,
   PWA/e2e) is still outstanding.
2. **No end-to-end browser test.** DOM tests run in `jsdom`, which has no layout engine,
   so "mobile-first" and "no bottom navigation" are asserted structurally (element and CSS
   rule shape) rather than visually. Real-device checks are Phase 8.
3. **Image cropping is asserted on its geometry function, not on pixels.** `jsdom` has no
   `CanvasRenderingContext2D`. `test/office-images.test.mjs` asserts the crop rectangle
   maths, the preset ratios, the type/size validation and the variant→key mapping; the
   actual canvas draw is exercised only in a browser.
4. **Network calls are not exercised.** Upload/delete tests assert the request the client
   would send (method, headers, variant) against a stub `fetch`, not a live Worker.
