# IAQAR.AI — Decision Record

Each entry is a decision that shapes the code. "Approved" means it follows the Master Engineering
Directive directly. "Pending owner decision" means the directive is genuinely ambiguous or a
change would remove working functionality outside the current phase — in those cases the code was
left untouched and the question is recorded here.

---

## D-001 — Keep the stack: static PWA + Cloudflare Worker + Firestore
**Status:** Approved (directive §1.3)
No framework, bundler, database or hosting migration. New shared logic ships as dependency-free
scripts that work in the browser and in Node so the same rules can be unit-tested.

## D-002 — The existing "الصفقات" (deals) surface is left in place for now
**Status:** Pending owner decision
Directive §21 forbids a deals page, but a deals surface already exists on the home page
(`public/index.html:1115-1121`) and is backed by real, deployed functionality: a `deals`
collection, deal stages, closing readiness, health scoring and the Worker workflow routes
(`worker/src/index.js:1863-1950`). Removing it is not in the Phase 1 deliverable list, and
directive §1.4 forbids deleting working code on preference. **Question for the owner:** should the
deals surface be (a) removed and its data folded into internal opportunity state per §21, or
(b) kept as an approved exception? No code changes until this is answered; the intended home for
the change is Phase 5.

## D-003 — The WhatsApp number field stays in Office Settings
**Status:** Pending owner decision
Directive §7.2 lists the visible office data as office name, broker name, licence number, city and
mobile number, and explicitly bans an email field. The existing form also has a separate WhatsApp
number, which the public office page, the office card image and outbound `wa.me` links all read.
Deleting it would break working functionality on an ambiguous reading of "only". The field is kept
and labelled as a mobile number variant. **Question for the owner:** should the WhatsApp number be
merged into the single mobile field?

## D-004 — Cover crop ratios are configuration, not constants scattered in code
**Status:** Approved (directive §7.1)
`public/js/office-identity.js` exposes `IMAGE_PRESETS` with `logo` (1:1), `display` (4:3) and
`share` (1.91:1) entries carrying aspect ratio, output width, maximum bytes and accepted MIME
types. The share ratio is the widely used wide-link-preview ratio and is marked as changeable
without touching the upload workflow. No external platform dimension is treated as verified.

## D-005 — Firestore rules are verified statically in this phase
**Status:** Approved with a known limitation
`@firebase/rules-unit-testing` needs the Firestore emulator (Java + downloaded binaries), which is
not available in this environment. Phase 1 adds assertions that parse `firestore.rules` and prove
the required clauses exist (claim-ownership check, `officeSettings` exclusion from the wildcard,
`devices` lockdown). A real emulator suite is Phase 8 work. Rules changes are therefore reported
as "statically verified", never as "tested against the emulator".

## D-006 — Notification preferences live in `offices/{officeId}/officeSettings`
**Status:** Approved (directive §7.5, §23)
`officeSettings` is one of the recommended logical domains. Office-level preferences live in
`officeSettings/notifications`, per-broker overrides in `officeSettings/broker-{uid}`, cooperation
mode in `officeSettings/cooperation`. The generic office wildcard rule now excludes
`officeSettings` so only the dedicated, least-privilege rule block applies. Existing collections
were not renamed.

## D-007 — The Opportunity Bank entry opens an honest placeholder in Phase 1
**Status:** Approved (directive §7.6, §1.7, §10)
Phase 1's deliverable is the *entry*, not the bank. Activating the entry states in Arabic that the
bank opens in Phase 3. It never displays fabricated opportunities, and it never claims to be
connected.

## D-008 — Three office images, one upload endpoint
**Status:** Approved (directive §7.1)
`POST /media/office-cover` now accepts `X-Media-Kind: logo | display | share` and writes
`office-logos/{officeId}/logo`, `office-covers/{officeId}/cover` or
`office-share-covers/{officeId}/cover`. The default kind stays `display`, so the existing client
contract and the existing R2 key keep working. `POST /media/office-image/remove` deletes one image
for an authorized manager. The public read allow-list was widened to exactly these three key
shapes and nothing else.

## D-009 — Cooperation mode default is `approval_required`
**Status:** Approved (directive §7.7, §19)
A missing document is read as `approval_required`, so an office that never opens the setting still
requires explicit approval. Only the mode is stored in Phase 1; permission scopes and the
cooperation records themselves are Phase 6.

## D-010 — Demo operations data stays until Phase 5
**Status:** Approved as sequencing, flagged as a violation
`public/index.html:1287-1354` seeds six fabricated workspace items. This breaks directive §16 and
is recorded as audit risk 4.5. Replacing it correctly requires real Operation records, which is
Phase 5. Phase 1 does not touch it and does not claim the Operations Center is compliant.
