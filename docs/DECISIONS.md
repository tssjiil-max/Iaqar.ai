# IAQAR.AI — Decisions

Architecture and interpretation decisions, newest phase last. Every decision records the
directive text it interprets, what was chosen, and why. Where the directive was
genuinely ambiguous the ambiguity is recorded as an **open question** and the ambiguous
part was **not** implemented.

---

## D-001 — Remove the `الصفقات` tab; fold deal records into the single Operations Center

**Phase:** 1
**Directive:** §5 (home page has exactly three sections), §21 (no page named
`Deals`/`الصفقات`, and "do not force the broker to manage a separate deals module"),
Test 14, versus §1.4 ("do not remove working code merely because you prefer another
implementation").

**Decision.** The `.main-sections` tab strip in `public/index.html` — a `الفرص` tab and a
`الصفقات` tab that filtered the Operations Center list by `item.main` — was removed
entirely. The Operations Center now renders every actionable record in one prioritized
list.

**Why this is not a removal of working functionality.** Deal records
(`offices/{id}/deals`), the deal workflow overlay, `POST /workflow/action`, timelines and
the closing flow are all untouched and still reachable. What was removed is the
*navigation into a deals module*, which §21 forbids. Deal operations now appear in the
same list as matches and intake items, which is what §21 describes ("a successful
progression may be stored internally as a state or result… a completion operation… a
status update inside the relevant record"). A test asserts that a record carrying
`main: "deals"` still renders, so the fold cannot silently hide deals.

**`الفرص` tab.** Removed for the same reason: §5 enumerates the three permitted home
sections and an opportunities tab is not one of them. With one unified list there is
nothing to tab between.

**Consequence.** The home page currently has two of the three approved sections. See
D-006.

## D-002 — Hide the separate WhatsApp-number input; keep the stored `whatsapp` field

**Phase:** 1
**Directive:** §7.2 — "The visible office settings contain only: office name, broker
name, license number, city, mobile number. Do not show an email field in this
interface." Versus §1.4 (do not remove working code).

**Decision.** The second phone input (`#officeWhatsappInput`, labelled `رقم واتساب`) was
removed from the visible settings form. The `whatsapp` field on `offices/{officeId}` and
`publicOffices/{officeId}` is **kept** and is derived from the mobile number
(`whatsapp = whatsapp || phone`), exactly as `office-settings.js` already did in its
`clean()` function.

**Why.** §7.2 says "contain only", and a second phone field is not in the list. But the
`whatsapp` value is consumed by the public office page and by every `wa.me` link in
`workflow-office.js`, so deleting the field would break working behaviour. Deriving it
from the single mobile number satisfies both rules: the interface shows exactly the five
approved fields, and no data or code path is lost. An office that had a distinct WhatsApp
number keeps it until it changes its mobile number, at which point the two converge.

**Open question (not implemented):** whether an office may ever have a WhatsApp number
different from its mobile number. If the owner confirms it may, this needs a separate
approved field. Until then the derived value stands.

**Related.** The `تخصص المكتب` (specialties) fieldset was **kept** in the settings sheet
even though it is not in the §7.2 list, because §6 requires the Office Card to display an
"approved services summary" and specialties are the only source of that summary. It is
presented as its own labelled section rather than as part of "office data", so the
§7.2 field list is not violated. `firestore.rules` `validOfficeProfile()` already
validates it, which is further evidence it is approved existing functionality.

## D-003 — Image crop ratios are a configurable design setting, not a WhatsApp spec

**Phase:** 1
**Directive:** §7.1 — "Do not hard-code an external platform's image dimensions without
verified requirements. Implement the cover crop ratio as a configurable design setting so
it can be updated without rewriting the upload workflow."

**Decision.** `public/js/office-domain.js` exports `OFFICE_IMAGE_PRESETS`, a single frozen
object that is the only place any ratio or output size exists:

| Variant | Aspect ratio | Output | Purpose |
| --- | --- | --- | --- |
| `logo` | `1 / 1` | 512 × 512 | Office Card logo, QR/card materials |
| `display` | `4 / 3` | 1024 × 768 | Office Card display image |
| `cover` | `1.91 / 1` | 1200 × 628 | Wide share-preview cover |

The crop workflow (`cropImageToPreset`) takes a preset object, so changing a ratio is a
one-line edit with no change to the upload, validation, preview or save code. The
`1.91:1` value is documented in the source as *a common wide link-preview ratio chosen as
the default*, explicitly **not** a verified WhatsApp requirement. Nothing in the code or
the UI claims WhatsApp verified these dimensions.

## D-004 — Keep `publicSlug`; defer a global clean-handle registry

**Phase:** 1
**Directive:** §7.3 — "Use a separate stable office handle/slug for the office URL when
necessary. Example: iaqar.ai/almasar."

**Decision.** The existing `publicSlug` scheme (`slug(officeName)-shortHash(officeId)`,
e.g. `almasar-k3f9x1`, resolved by `access-gate.js` and routed by the
`/o/** → /index.html` Hosting rewrite) is kept unchanged. A global `officeHandles`
uniqueness registry that would allow the bare `iaqar.ai/almasar` form is **deferred**.

**Why.** The directive says "when necessary". `publicSlug` already satisfies every stated
property: it is separate from the office name, stable once assigned, unique without a
registry (the office-ID hash suffix guarantees it), and it survives a name change.
Introducing a bare-handle registry would require a new world-readable collection, new
rules, a reservation transaction, and a migration of every existing shared link — real
cost for a cosmetic gain, and existing QR codes and shared links would have to keep
working anyway. Recorded so the owner can request the cleaner form explicitly.

## D-005 — The Opportunity Bank entry opens a minimal **real** read-only view

**Phase:** 1
**Directive:** §7.6 (Phase 1 deliverable: an entry card named `بنك الفرص` inside Office
Settings) versus §28 (the Opportunity Bank itself is Phase 3) and §1.7 (never claim a
feature works because code exists; no production path may depend on fake data).

**Decision.** The `بنك الفرص` card is a real entry point that opens a panel listing the
current office's own opportunities read live from `offices/{officeId}/opportunities`
(ordered by `createdAt` desc, limit 50). Each row shows the identifying information §13
permits — opportunity/property type, city and district, price or budget, key attributes,
contact display name where permitted — and, for the visible administrative activity
summary, **only** date added and cooperation status. Cooperation status is `لم تُشارك`
for every row, which is truthful: cooperation does not exist yet. There is a real empty
state and a real error state.

**Why not a placeholder.** An entry card that opens nothing, or that opens a "coming
soon" panel, would be a dead end; an entry card that opens fabricated rows would violate
§1.7. A minimal read-only view over data that genuinely exists is the only honest option.

**Deferred to Phase 3:** open/edit an opportunity, archive/delete rules, single and
multi-select sharing, the scoped bank-sharing model, cooperation requests, revocation.
Nothing in Phase 1 claims those exist.

## D-006 — The Add Opportunity card is deliberately absent in Phase 1

**Phase:** 1
**Directive:** §5 lists Add Opportunity as one of three approved home sections; §28
assigns unified intake to Phase 2; §31 says "Execute only PHASE 0 and PHASE 1 now. Do not
proceed to Phase 2 in this run."

**Decision.** No Add Opportunity card was added. The home page shows the Office Card and
the Operations Center. This is reported as a known limitation rather than hidden, and it
is the first item of Phase 2.

**Why.** Building the unified intake gateway (§8) *is* Phase 2. Adding a card now would
either be a non-functional shell — which §1.7 forbids — or would start Phase 2, which
§31 forbids.

## D-007 — Remove the hard-coded demo operations now rather than in Phase 5

**Phase:** 1
**Directive:** §16 ("must not display… fake demo cards in production"), §1.7 ("no
production path depends on fake data"), Test 15, versus §28 which lists the Operations
Center under Phase 5.

**Decision.** The six hard-coded operation objects (`A1`, `M1`, `F1`, `M2`, `D1`, `D2`)
and the hard-coded `#total` value of `6` were removed from `public/index.html`, and the
approved Arabic empty state was added.

**Why now.** These are prohibitions, not features — they hold at every phase boundary, not
only at Phase 5. They also had to go with D-001: the demo records were partitioned by the
`main` tab, so removing the tab strip while keeping them would have shown all six
fabricated cards in one list. Phase 5 still owns the real persisted `operations` model,
the operation field set and the dedup key.

## D-008 — Pure domain logic is extracted into a dual-target ES module

**Phase:** 1
**Directive:** §30 (tests must pass) and the Phase 1 requirement for automated tests,
versus §1.3 (preserve the stack: no framework, no bundler).

**Decision.** `public/js/office-domain.js` is a plain ES module with **no imports and no
DOM access**, exporting the pure logic Phase 1 needs (name normalization and validation,
image presets and crop geometry, notification preference schema and resolution,
cooperation modes, office link building, Opportunity Bank row projection, push-type →
preference-key mapping). The browser loads it through
`<script type="module" src="js/office-settings.js">`, which imports it; `node:test` imports
the same file directly.

**Why.** It gives real unit tests for the rules that matter without adding a bundler, a
framework or any runtime dependency, and it keeps one source of truth for logic that would
otherwise be duplicated between the browser and the tests. `public/js/fcm-fid.js` already
established that module scripts are acceptable in this shell.

**Consequence.** `public/js/office-settings.js` changed from a classic IIFE to
`<script type="module">`. Module scripts are deferred but still execute before
`DOMContentLoaded`, and the file already gated its `init()` on document readiness, so
ordering relative to `whatsapp-office.js` and the inline operations script is preserved.

**Duplication accepted deliberately:** the Worker cannot import from `public/`, so the
push-type → preference-key mapping and the notification defaults exist in both
`public/js/office-domain.js` and `worker/src/index.js`. Both copies are covered by tests
that assert the same table, so a drift breaks the build. Sharing the file would require a
build step, which §1.3 rules out.

## D-009 — Root test harness uses `node:test` plus `jsdom` as the only dev dependency

**Phase:** 1

**Decision.** A root `package.json` adds `npm test` (front-end/domain/rules tests in
`test/`, then the Worker suite) and `npm run check` (a syntax parse of every shipped
JavaScript file and a JSON parse of the config files). `jsdom` is the single dev
dependency, used only by the DOM tests.

**Why.** The repository previously had no root entry point, so no check could run from the
root at all. `node:test` matches the Worker suite's existing zero-dependency style.
Tests 1, 2, 14 and 15 are DOM-level assertions about `public/index.html`, and asserting
them with regexes over HTML would be fragile and easy to fool; `jsdom` parses the real
document and dispatches real events. Nothing from `node_modules` ships to the browser.

`npm run check` exists because the project has no linter or type checker and, being
buildless, cannot gain one without changing the stack. A parse check is the honest
equivalent and is reported as such rather than as "lint passes".

## D-010 — Two security fixes taken inside Phase 1

**Phase:** 1
**Directive:** §25 ("do not weaken existing Firestore rules"; least privilege; prevent
mass assignment), §7.3 ("prevent race-condition duplicates at the backend/database
level").

**Decision.**

1. `officeNameClaims/{nameKey}` update now requires
   `resource.data.officeId == request.resource.data.officeId`. Before, the rule only
   checked the *incoming* office ID, so Office B could overwrite Office A's claim
   document and take a registered name. This was a real hole reachable with a
   hand-written request; the client transaction refused to do it, but rules must not
   depend on client behaviour.
2. `officeSettings` and `brokerSettings` are excluded from the permissive
   `match /{collectionName}/{docId}` catch-all and given explicit rules. Firestore rules
   are additive — adding a stricter rule cannot narrow a permissive one — so exclusion is
   the only way to make the strict rules authoritative. Without this, any active office
   member could rewrite another member's notification preferences.

Both changes only ever remove permission; nothing that previously worked stops working.

**Not fixed in Phase 1:** the catch-all still lets any active member write most other
office documents (`AUDIT_PHASE0.md` §5 risk 2). A full fix means per-collection rules and
protected-field guards across `matches`, `deals`, `clients`, `owners` and `opportunities`,
which touches the matching and workflow paths and belongs in Phase 8.

## Open questions carried forward

| # | Question | Blocking |
| --- | --- | --- |
| Q-1 | May an office have a WhatsApp number different from its mobile number? (see D-002) | A separate approved settings field. |
| Q-2 | Should the office URL become the bare `iaqar.ai/{handle}` form, accepting a link migration? (see D-004) | The `officeHandles` registry. |
| Q-3 | What is the approved sending policy, if any, for outbound owner/customer messages? §10 says drafts by default; nothing describes when automatic sending would ever be allowed. | Phase 7 outbound behaviour beyond drafts. |
| Q-4 | Which "verified performance data" may drive cooperating-broker recommendations? §19 forbids inventing performance scores. | Phase 6 recommendation factors. |
| Q-5 | What are the approved completion milestones that trigger a success badge/notification (§21)? | Phase 5 completion operation. |
