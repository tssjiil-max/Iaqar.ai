# IAQAR.AI — Decisions

Architecture and interpretation decisions, newest phase last. Every decision records the
directive text it interprets, what was chosen, and why. Where the directive was
genuinely ambiguous the ambiguity is recorded as an **open question** and the ambiguous
part was **not** implemented.

---

---

## D-021 — Public Opportunity Router (platform `/add` vs office-direct links)

**Directive.** Owner approved a real distribution system: OFFICE_DIRECT opportunities
from an office public link stay with that office; PLATFORM_PUBLIC opportunities from
`/add` are offered one office at a time by a scored router. Ratings (1–5 stars, no
comments) are an approved routing input. This is not a prototype.

**Decision.** Reuse `offices/{officeId}/opportunities` as the canonical inventory.
Platform intake keeps `officeId=platform` until ACCEPT copies the same
`opportunityId` into the assigned office. Scoring lives only in
`public/js/opportunity-router-domain.js`. Q-4 remains unresolved for *cooperation*
auto-recommend; this decision does not invent cooperation ranking. Worker routes:
`/opportunity-router/accept|decline|tick|rate`.

**Open question.** Party-facing star widget after a client session (vs office-member
recording of an eligible party rating) can be tightened later without changing the
rating event schema.

---

## D-020 — Public office short links `/m/{slug}` plus Worker OG HTML

**Directive.** Owner requested `/m/{slug}` short public office URLs, unique editable
slugs, WhatsApp crawler OG tags, and a dedicated 1200×630 office share card. D-004 had
deferred the clean-handle registry until the owner asked.

**Decision.** Canonical share URL is `{origin}/m/{slug}` (3–20 lowercase ASCII, reserved
routes blocked, uniqueness in `officeSlugClaims`). Legacy `/o/{slug}` still resolves on
Hosting and canonicalizes to `/m/{slug}` in the SPA. Staging Hosting `302`s `/m/:slug`
to the staging Worker so WhatsApp's crawler receives per-office OG HTML in the HTTP
response. Browser hits on the Worker land on Hosting `/?office={officeId}&view=public`
(not `/m/{slug}`) to avoid a redirect loop; the public office page then
`history.replaceState`s back to `/m/{slug}`. OG HTML never uses `meta-refresh` (the
crawler would follow it into the SPA). A JS `location.replace` remains so a human
WhatsApp in-app browser still opens the office page. Share-card PNG is generated from
canonical office profile fields only (not a page screenshot) and served at
`/share/office/{slug}/card-v{version}.png`. Private party tokens stay opaque.

**Open question.** Chrome/Android still prints the web.app origin as the Web Push source
label. That is not controlled by notification title/body/manifest. Production Hosting
will need its own `/m/:slug` destination when a production Worker hostname is approved.

## D-001 — Remove the الصفقات tab from the home page

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

## D-011 — Phase 2 unified intake uses deterministic/simulated extraction only

**Phase:** 2
**Directive:** §8, §10, §12

**Decision.** Text/URL intake uses a labeled `deterministic_text_parser`. Image, screenshot,
PDF, Word, Excel and audio intake use labeled `simulated_fixture` adapters. Every
Opportunity record stores `productionAi: false`. Attachments upload through
`POST /media/opportunity-source`. Phase 2 intake creates `opportunitySources` +
`opportunities` only — it does not run matching and does not create Operations Center
items.

**Why.** No OCR/ASR/document-AI provider is configured. §10 forbids claiming production
integrations. Matching is Phase 4; persisted Operations are Phase 5.

## D-012 — Phase 3 Opportunity Bank uses soft delete + explicit cooperation records

**Directive:** Phase 3 Opportunity Bank (list/detail/edit/archive/delete/share) with
strict tenant isolation; Matching Engine is Phase 4; automatic cooperation is Phase 6.

**Decision.**

1. **Soft delete by default.** Client hard `delete` on `opportunities` is denied in
   Firestore rules. Archive and delete stamp `lifecycleStatus` + audit fields
   (`archivedAt`/`deletedAt`/`…By`). Restore is allowed for archived (not deleted)
   records.
2. **Separate cooperation documents.** `cooperationRequests` and `bankSharingScopes`
   live at the root; accepted targets receive `offices/{target}/sharedOpportunities`
   minimum projections. Opportunities are never ownership-copied into another office.
3. **Default share permissions** are read-only, minimum data, contact hidden, no
   ownership/delete/archive/reshare. Scoped bank sharing starts DISABLED.
4. **Bank UI** lives in `opportunity-bank.js`, opened only from Office Settings →
   بنك الفرص. Cursor pagination (`limit` + `startAfter`). No home-page bank section,
   no bottom nav, no Deals page, no Matching Engine, no Operations items, no outbound
   WhatsApp/Telegram send.
5. **Authorization** for Phase 3 bank/share mutations is enforced in Firestore rules
   (and domain validators). No new Worker bank endpoints in this phase.

**Why.** Safe deletion without inventing retention destruction rules; cross-office
access only through explicit revocable records; Phase 4/5/6 boundaries preserved.

## D-013 — Phase 4 Matching Engine uses versioned match IDs and Worker rematch

**Directive:** Phase 4 Matching Engine — eligibility, scoring, reasons, single threshold
config, idempotency on (canonical pair, matching rule version, relevant data version),
automatic rematch including opportunity edits. Operations are Phase 5.

**Decision.**

1. **Single engine module** `worker/src/matching-engine.js` owns `MATCHING_RULE_VERSION`
   (`4.0.0`), `MATCHING_CONFIG.threshold` (55), weights, scoring, and ID helpers.
2. **Match ID** = hash of `officeId|canonicalPairKey|matchingRuleVersion|dataVersion`.
   Replays with the same tuple are idempotent. A new data version creates a new Match and
   marks prior current matches for the same pair/rule as `superseded`.
3. **Automatic rematch** via authenticated `POST /matching/run` after Add Opportunity
   persistence and Opportunity Bank edit/archive/restore/delete. Public/shared intake
   continues to call `findAndSaveMatches`. Opportunity-vs-opportunity matching covers
   Phase 2/3 records; clients/owners path remains for legacy intake.
4. **No Operations persistence** in Phase 4 (`createsOperation: false`). Existing
   derived Operations Center UI may still read matches; that is not the Phase 5 model.
5. **Firestore:** office members may read `matches`; client create/update/delete denied
   (Worker Admin SDK writes).

**Why.** Satisfies Tests 7–8 without inventing Operations or automatic cooperation.

## D-014 — Phase 5 Operations Center + Notifications: Worker-trusted writes

**Phase:** 5
**Directive:** §16 (Operations Center), §17 (notifications), Tests 9–10; Phase 5 only —
do not begin Phase 6/7 (automatic cooperation, WhatsApp/Telegram messaging).

**Decision.**

1. **Worker-trusted writes.** `offices/{officeId}/operations` and
   `offices/{officeId}/notifications` are created/updated only by the Cloudflare Worker
   (service account). Firestore rules: office members may `read`; client
   `create` / `update` / `delete` are `if false`. Lifecycle mutations go through
   `POST /operations/action` (and related Worker routes).
2. **Deduplication keys.** Every Operation carries a `deduplicationKey`; document ID is
   `op_{sha256(key)[0..40]}`. Notifications use `NOTIF|{operation.deduplicationKey}` →
   `nt_{…}`. Replays upsert; terminal Operation statuses are not reopened for the same
   key.
3. **Lock-screen-safe push.** System notification `title`/`body` are generic Arabic
   action prompts (`sensitivePreview: false`). No customer/owner phone, name, or price
   detail in the push preview. Push is queued when prefs allow; `DELIVERED` is not
   claimed without provider confirmation.
4. **No WhatsApp / Telegram / deals / bottom-nav.** Phase 5 boundary guarantees forbid
   message drafts, outbound send, deals page, and bottom navigation. Operations cards do
   not open messaging actions.
5. **Operations Center binds to the `operations` collection only.** The home list listens
   to active statuses (`OPEN` / `IN_PROGRESS` / `WAITING_EXTERNAL_RESPONSE`) on
   `operations`. It does not derive the list from `matches` / `deals` / `publicIntake`.
   Empty state: «لا توجد فرص حالياً» / «ستظهر الفرص المباشرة هنا».

**Why.** Satisfies Tests 9–10 with persisted, auditable, idempotent work items while
keeping messaging and automatic cooperation for later phases, and without weakening
tenant isolation or the constitution.

## D-015 — Phase 6 explicit cooperation lifecycle via Worker

**Phase:** 6
**Directive:** §19 (broker-to-broker cooperation), §20 (ownership), §26 (audit),
Tests 11–12; Phase 6 only — do not begin Phase 7 (WhatsApp/Telegram messaging) or
invent broker recommendations (Q-4 unresolved).

**Decision.**

1. **Worker-trusted lifecycle.** Accept / reject / revoke for
   `cooperationRequests` go through `POST /cooperation/lifecycle`. Scoped bank-sharing
   revoke goes through `POST /cooperation/scope-revoke`. Clients do not forge
   terminal states or shared projections outside these paths for the trusted flow.
2. **`auditLogs`.** Sensitive cooperation actions write
   `offices/{officeId}/auditLogs/{aud_*}` (Worker-only writes; members may read).
   Audit details never store phones, contact names, or tokens.
3. **Revocation removes future access.** Revoke deletes or stamps `revokedAt` on
   `sharedOpportunities` under the target office; rules deny reads when revoked.
   Origin opportunity cooperation status becomes `ENDED`.
4. **Ownership preserved.** `originatingOfficeId`, `originatingBrokerId`, and
   `currentOwningOfficeId` never transfer because of cooperation. Accept writes
   real minimum projections with contacts forced empty.
5. **No invented recommendations.** `SMART_AUTOMATIC` does not auto-accept or
   recommend brokers while Q-4 is unresolved. `createsAutomaticCooperation` remains
   `false`. `DISABLED` mode blocks new requests and accepts.
6. **No messaging / Deals.** Phase 6 boundary guarantees forbid WhatsApp/Telegram
   send, smart message drafts, a Deals page, and bottom navigation.

**Why.** Satisfies Tests 11–12 with explicit, revocable, audited cross-office access
without inventing performance-based broker selection or starting Phase 7 messaging.

## D-016 — Phase 7 smart message drafts + adapter-ready/simulated channels

**Phase:** 7
**Directive:** §10 (integrations honesty), Tests 13 and 15; Phase 7 only — do not begin
Phase 8 hardening; do not invent automatic send policy while Q-3 is unresolved.

**Decision.**

1. **Persisted drafts only.** `offices/{officeId}/messages/{msg_*}` are written by the
   Worker (`POST /messages/draft`). Clients may read; client create/update/delete denied.
2. **External broker handoff ≠ send.** Opening `wa.me` / `t.me/share` records
   `sendState=OPENED_EXTERNAL` and keeps `deliveryState=NOT_APPLICABLE` with
   `providerConfirmedSend/Delivery=false`. Never auto-send via Meta Cloud API or
   Telegram Bot API.
3. **Adapter honesty.** WhatsApp = `adapter_ready` (inbound Cloud API path may exist;
   outbound Cloud API blocked). Telegram = `simulated` (share URL + webhook validation
   fixture structure; inbound/outbound disabled).
4. **Ops Center draft actions.** `MATCH_REVIEW` / `EXTERNAL_RESPONSE` may offer Arabic
   draft buttons (واتساب/تيليجرام) without claiming delivery.
5. **No Deals / bottom nav.** Phase 7 boundary guarantees forbid a Deals page and bottom
   navigation. Q-3 remains open for any future automatic send policy beyond drafts.

**Why.** Satisfies Test 13 with persisted, auditable drafts and honest adapter labels
while keeping Test 15 (no fake delivery / no production-connected stubs).

## D-017 — Phase 8 catch-all lockdown + public rate limits

**Phase:** 8
**Directive:** §1.3 least privilege, §1.7 honesty, AUDIT_PHASE0 §5 risks 2 and 4;
Tests 14–15 must remain PASS; no Deals page / bottom nav / auto-send.

**Decision.**

1. **Per-collection lockdown.** Legacy office collections that the catch-all previously
   left member-writable (`clients`, `owners`, `deals`, `alerts`, `inbox`, `usage`,
   `publicIntake`) are restricted. Clients/owners/deals/alerts/inbox are member-read /
   Worker-write. `usage` is deny-all for clients. `publicIntake` keeps unauthenticated
   **create** with shape validation; member **read** only; update/delete Worker-only.
2. **Contacts stay member-writable** with phone-digit document ids and required
   `officeId` / `phone` / `fullName` so `syncOfficeContact` keeps working.
3. **Deal field updates via Worker.** `saveInternalDealData` calls
   `POST /workflow/action` with `update_deal_fields` instead of client SDK merges, so
   brokers cannot forge `workflowStage` / `status`.
4. **Public rate limits.** Unauthenticated `POST /pipeline/public-intake` and
   `POST /media/public-intake` share an in-isolate sliding window
   (`worker/src/public-rate-limit.js`) and return 429 `rate_limited`.
5. **Cleanup / PWA.** Removed dead `public-intake.js` and unused client matcher;
   deduped default logos to `/icons/default-office.png`; removed manifest deals
   shortcut; refreshed SW shell cache.

**Why.** Closes the two Phase 0 risks carried into Phase 8 without inventing a Deals
page, weakening tenant isolation, or claiming real-device visual e2e beyond the
automated jsdom + emulator gate.

## D-018 — Phase 9A full-functional staging on project `iaqar-ai-staging`

**Phase:** 9A
**Directive:** §1.7 honesty; staging must not overwrite production; staging must not
be UI-only; no Deals page / bottom nav / auto-send; stop before production Phase 9B.

**Decision.**

1. **Separate staging Worker.** Cloudflare `[env.staging]` deploys
   `iaqar-intake-staging` with `DEPLOYMENT_ENV=staging` and
   `FIREBASE_PROJECT_ID=iaqar-ai-staging`. Production remains
   `iaqar-macrodroid-intake` / `aqar-b5d76`.
2. **Separate Firebase staging project.** Hosting channel + Firestore + Auth use
   **`iaqar-ai-staging`**. Production project `aqar-b5d76` is untouched by staging
   deploy. R2 bucket `iaqar-media` remains shared (office-scoped paths). Staging cron
   is **disabled**.
3. **Hosting preview channel only.** `firebase hosting:channel:deploy staging
   --project iaqar-ai-staging` — never bare `firebase deploy --only hosting` on
   production.
4. **Service-account auth (no FIREBASE_TOKEN).** Deploy builds a temporary GAC JSON
   from `FIREBASE_SERVICE_ACCOUNT_JSON`, sets `GOOGLE_APPLICATION_CREDENTIALS`, derives
   the runtime fields required by the staging Worker into private temporary files, then
   deletes every temp file. Values are never printed or committed.
5. **Client routing (fail closed).** `runtime-config.js` maps `--staging` /
   `?env=staging` to the staging Worker and `firebaseProjectId=iaqar-ai-staging`.
6. **Full-functional gate.** `/health` must report `backendReady` and
   `projectId=iaqar-ai-staging`. Cloudflare: `CLOUDFLARE_API_TOKEN` +
   `CLOUDFLARE_ACCOUNT_ID`.
7. **Honesty on live deploy.** Secrets added after a Cloud Agent run starts are not
   visible in that run — a **new** run is required. Live deploy remains owner-gated.

**Why.** Isolates staging Auth/Firestore from production while keeping a real Worker +
Hosting path for Phases 1–8, without CI user tokens or production Hosting overwrite.

## D-019 — B-04: pin the legacy WhatsApp intake path with tests before changing it

**Phase:** post-audit backlog B-04 (`docs/IMPLEMENTATION_BACKLOG_AR.md`), branch
`audit/phase0-real-lineage-20261024`.
**Directive:** Constitution §2.5 (a feature works only when the path is connected, data
persists, access control is enforced and tests pass), §7 tenant isolation, §9 integration
honesty; no behaviour change in this item.

**Decision.**

1. **Characterization tests, no code change.** `test/whatsapp-legacy-intake-journey.test.mjs`
   drives the real Worker (`startOfficeOsHarness`) with HMAC-signed Meta events and pins the
   legacy (non-agent) path: mapped number → `offices/{office}/inbox` → canonical intake →
   `offices/{office}/opportunities` → the default records list (`filterRecords`). It covers
   offer and request, two-office isolation, Meta re-delivery of the same message id, batches,
   greetings kept for the broker, delivery-status-only events, a bad signature (401) and a
   non-WhatsApp object (ignored).
2. **Read access is tested on the emulator.**
   `test/emulator/whatsapp-intake-rules.emulator.test.mjs` asserts that only active members of
   the same office read the WhatsApp inbox and its records, that no browser writes the inbox,
   and that `whatsapp_accounts` is closed to every browser.
3. **Current defects are pinned under a `CURRENT (pre-B-xx)` label, not fixed here.** Two
   behaviours are recorded as they are today so the later fix is a visible, reviewed test flip:
   - an unlinked or non-`connected` number is acknowledged with 200 and the message is stored
     nowhere (fix: B-03);
   - caption-less media becomes an empty record, because `extractMessageText()` returns the
     placeholder `[رسالة image]` and the `needs_media_adapter` branch in `saveInboundMessage()`
     is unreachable (fix: B-07).
4. **Gates.** The journey test joins `test:channels:gate`; the emulator file joins
   `test:rules` (and therefore the `deploy-staging-rules` and `office-os-gate` workflows).

**Why.** The WhatsApp fixes that follow (B-03, B-07, and any agent work) touch
`receiveMetaWebhook` / `saveInboundMessage`. Without an end-to-end test, a regression that
stops linked offices from receiving messages would pass every existing check: the only
prior runtime test asserted that one inbox document exists. Each new assertion was checked
against a deliberate mutation (ignoring the mapping status, removing the create-only
dedupe, routing every message to another office, opening inbox reads to any signed-in user)
and failed as expected.

**Limits.** Local harness and emulator only. They do not prove that Meta delivers to the
Staging or Production webhook; that needs the owner's live check (backlog M-01).

## D-020 — B-01: office authority is the platform's and the owner's, through the Worker only

**Phase:** backlog B-01, approved by the owner on 2026-10-24 («المالك يدير أدوار موظفي مكتبه عبر
الخادم، ومدير المنصة وحده يدير نقل الملكية والاشتراكات، مع سجل تدقيق لكل عملية»).
**Directive:** Constitution §7 (isolation enforced by rules **and** backend), §10 (prevent mass
assignment of protected fields and direct edits to ownership fields; never weaken rules).

**Findings fixed.**

1. **Critical — any member could promote themself.** `members/{uid}` was not in
   `isRestrictedOfficeCollection`, so the office catch-all (`create, update` for any member when
   `officeId` matches) applied to it. A broker could write
   `{role:"owner", officeId}` to their own member document, or add an outsider as `admin`. Both the
   rules (`canManage`) and the Worker (`authorizeOfficeRequest`) then treated them as a manager.
   Reproduced on the pre-fix rules (the phase-0 audit missed it: its probe omitted `officeId`).
2. **High — a manager could take ownership and change platform state.** `offices/{id}` update was
   `canManage && validOfficeProfile()`, with no limit on which fields change. A manager could set
   `ownerUid` to themself, flip `subscriptionStatus`/`subscriptionExpiresAt`, clear a suspension
   (`accountStatus`), or change approval and licence state. The `publicOffices` mirror had the same
   gap for its status fields.

**Decision.**

1. **`members` is Worker-only** for every browser (owner and platform admin included). Reads are
   unchanged: active members of the office.
2. **Platform-controlled office fields** (`platformControlledOfficeKeys()` in `firestore.rules`):
   - `ownerUid`
   - subscription: `subscriptionStatus`, `subscriptionExpiresAt`, `subscriptionPlan`
   - approval: `approvalStatus`, `approvedAt`, `approvedByUid`, `registeredAt`
   - account and suspension: `accountStatus`, `suspendedAt`, `suspendedBy`, `suspensionReason`,
     `reactivatedAt`, `reactivatedBy`
   - licence: `licenseStatus`, `licenseExpiresAt`
   - `pilotAuthorized`

   No browser adds, changes or removes them on `offices/{id}` or `publicOffices/{id}`. Re-sending
   the current value is not a change, so the existing profile saves that echo `ownerUid` still pass.
3. **Server operations.**
   - `POST /os/members/access` (`office-os/members-service.js`) lets the office **owner** set an
     existing member to `broker` or `manager`, or change its active flag.
     - Authority is `offices/{o}.ownerUid`; a member doc saying `owner` is not enough.
     - The owner's own membership is out of reach, `owner`/`admin` are never granted, and no new
       people are added.
     - Each change writes `MEMBER_ACCESS_CHANGED` with before/after to `offices/{o}/auditLogs`.
   - `POST /admin/office/owner-transfer` (`admin-service.js`) is **platform admin** only.
     - The new owner must be an active member.
     - `ownerUid` and both member documents change in one Firestore commit guarded by each
       document's `updateTime`.
     - The previous owner becomes `manager` (or `broker`/inactive on request).
     - It is written to `adminAuditLogs` with before/after and a mandatory reason.
   - Subscriptions keep the existing audited `/admin/office/subscription` route.
4. **Browser change:** `public/js/office-settings.js` no longer sends `approvalStatus` /
   `accountStatus` to `publicOffices` with the work-scope save. Readers already default a missing
   value to approved/active (`suitable-offices-domain.js`, `opportunity-router-domain.js`).
5. **Static test updated:** `test/firestore-rules.test.mjs` TEST 4 asserted the old
   `allow create, update, delete: if canManage(officeId)` text for `publicOffices`. It now asserts
   that each write still requires `canManage(officeId)` plus the new field guard.

**Evidence.**
- `test/emulator/office-authority-rules.emulator.test.mjs`: 20 tests. On the pre-fix rules
  14 fail, one per exploit scenario; on the new rules 20/20 pass, including every legitimate
  profile/scope/share-card/photo save shape the screens send.
- `test/office-authority-service.test.mjs`: 15 Worker tests, all red before the routes existed
  (one passed only through a 404).
- Full gates after the change: `npm test` 2379/2379, `npm run test:rules` 78/78,
  `npm run check` passed.
- Limit: the in-memory Firestore double used by the Worker tests applies `:commit` writes but
  ignores their `updateTime` preconditions. The transfer's all-or-nothing, conflict-guarded
  behaviour therefore rests on real Firestore commit semantics; it is not proven by the local test.

**Not changed (recorded as residual risk).**
- An office **owner** can still delete `offices/{id}` from a browser, and a manager can delete
  `publicOffices/{id}`.
- Platform-admin office **creation** from a browser is still allowed by the rules. The approval
  flow itself goes through the Worker.
- Suspension does not update the `publicOffices` mirror: no Worker route writes it, as before.
- There is no screen yet for `/os/members/access`; the route is ready for one.

## D-021 — B-02: phone login without disclosure (interim, no proof of number possession)

**Phase:** backlog B-02, option (ب) approved by the owner on 2026-10-24: a safe phone + password path
that discloses neither the email nor the office, with attempt limits; **no paid SMS for now**; this is an
interim control, not a replacement for proving possession of the number.
**Directive:** Constitution §10 (validate identity, rate-limit public endpoints, no secrets in client).

**Findings fixed.**

1. **Disclosure.** `POST /auth/phone-login-resolve` returned the account's real email and `officeId`
   for any phone number, with no sign-in and no rate limit. Its two refusal reasons
   (`directory_missing` / `directory_inactive`) told registered numbers apart.
2. **Critical — account takeover path in `/auth/phone-login`.** The route accepted `apiKey` from the
   request body and trusted Google's `signInWithPassword` answer as long as `localId` matched the
   directory uid.
   - A key from another Firebase project, where an attacker created a user with the victim's uid and
     email, would pass. The Worker would then mint a real custom token for the victim.
   - Reproduced: before the fix, a correctly signed token for another project got `200` +
     `customToken`.
   - The uid is readable by any signed-in user (`officeNameClaims.ownerUid`). The email leaked
     through finding 1.
3. **Enumeration and guessing.**
   - Refusals differed by reason, and an unknown number answered before any Google call (a timing
     difference).
   - Failures were counted per `phone|ip` only, so rotating either one reset the count. Unknown
     numbers were never counted.
   - `/auth/forgot-password` returned a masked email only for registered numbers.

**Decision.**

1. **`/auth/phone-login-resolve` is retired.** It answers `410 endpoint_retired` for every input.
   Both login screens (`public/os/core/session.js`, `public/js/access-gate.js`) now call
   `/auth/phone-login` with phone + password and sign in with the returned custom token
   (`signInWithCustomToken`). The email never reaches the browser.
2. **The password check is bound to this project.** After `signInWithPassword`, the Worker verifies
   the returned ID token with `verifyFirebaseIdToken(…, projectId)`: Google signature, `aud`, `iss`,
   expiry. `sub` and `localId` must both equal the directory uid. `env.FIREBASE_WEB_API_KEY` is
   preferred over a body key. No secret is required for the fix: whatever key is used, only a token
   for this project counts.
3. **One refusal.** Every failure is the same `401 {ok:false, error:"invalid_login", message}`, with
   no `reason`. It covers bad input, unknown number, inactive account, wrong password, a token
   mismatch and a locked bucket. Each refusal waits until `LOGIN_FAILURE_FLOOR_MS` (default 1200 ms,
   capped at 5000) has passed since the request started.
4. **Guessing limits**, durable in `loginRateLimits/{sha256(key)}` (Worker-only; no rules match):

   | Bucket | Counts | Lock |
   |---|---|---|
   | `phone\|+9665…` | failed attempts on that number, from any IP | 10 failures in 15 min → 15 min |
   | `ip\|…` | failed attempts from that IP, on any number (unknown ones included) | 20 failures in 15 min → 15 min |

   While locked, no password check is attempted. A success clears that number's bucket, not the IP's.
5. **Password reset answers the same for every number** (`{ok:true}`, no `maskedEmail`, same floor).
   Each IP may trigger at most 10 reset requests per 15 min (`reset-ip|…` bucket); later requests get
   the same answer and send nothing. The per-number 60 s cooldown stays. Both screens already show
   the generic «إذا كان الرقم مسجلًا…» text when no `maskedEmail` comes back.
6. **Minimum password length is no longer checked by the login route** (Firebase decides). The old
   `< 8` shortcut rejected accounts created with shorter passwords; registration still requires 8.

**Evidence.**
- `test/phone-login-security.test.mjs`: 15 Worker tests; 13 red before the change.
- `test/access-gate-auth.test.mjs`: three assertions that described the old flow were rewritten to
  assert the new one.
- Harness: `scripts/qa/office-os/server.mjs` gained an Identity Toolkit stand-in and
  `foreignProjectIdTokenFor()`; the browser stub gained `signInWithCustomToken`.
- Gates: `npm test` 2394/2394, `test:rules` 78/78, `check` passed.
- Browser journeys that log in through the form: fresh-broker 31/31, journey 45/45,
  auth-flows 45/45, the same as before the change.

**Residual risk (recorded, not solved here).**
- **No proof of possession.** Anyone who knows a number and its password is in; a stolen password is
  enough. OTP or another possession factor needs a paid or new channel and the owner's approval.
- **Lock-out abuse.** Ten wrong attempts lock a real broker's number for 15 minutes, by design of the
  per-number bucket.
- **Distributed guessing.** Many IPs × many numbers stays possible within the limits (20 per IP, 10
  per number, per 15 min).
- **Write cost.** Each unknown number tried creates a bucket document; the per-IP limit caps this per
  source, not globally.
- **Timing.** The floor hides the Google round-trip only while that round-trip is shorter than the
  floor.
- **Cached old pages.** A client still running the old JavaScript gets the generic refusal from the
  retired route until it reloads. The service-worker cache is keyed by commit SHA, so a deploy ships
  the new screens.
- **Owner action, optional:** set `FIREBASE_WEB_API_KEY` on the Worker so the server never relies on
  a key sent by the client. The audience check already makes a foreign key useless.

## Open questions carried forward

| # | Question | Blocking |
| --- | --- | --- |
| Q-1 | May an office have a WhatsApp number different from its mobile number? (see D-002) | A separate approved settings field. |
| Q-2 | Should the office URL become the bare `iaqar.ai/{handle}` form, accepting a link migration? (see D-004) | The `officeHandles` registry. |
| Q-3 | What is the approved sending policy, if any, for outbound owner/customer messages? §10 says drafts by default; nothing describes when automatic sending would ever be allowed. | Any outbound behaviour beyond drafts + external handoff (Phase 7 ships drafts only). |
| Q-4 | Which "verified performance data" may drive cooperating-broker recommendations? §19 forbids inventing performance scores. | Smart-automatic recommendation factors — still unresolved; Phase 6 does not invent them. |
| Q-5 | What are the approved completion milestones that trigger a success badge/notification (§21)? | Phase 5 completion operation. |
