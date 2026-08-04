# IAQAR.AI — Acceptance Tests

Two parts:

* **Part A** — the fifteen acceptance scenarios from the Master Engineering Directive §27, with
  their honest status after Phase 1.
* **Part B** — the Phase 1 acceptance criteria and the automated test that proves each one.

Status vocabulary: **PASS** (implemented and covered by an automated test), **PARTIAL** (working,
but a part of the scenario is not implemented or not verified in this environment),
**NOT IMPLEMENTED** (belongs to a later phase), **FAIL** (implemented in a way that contradicts
the directive).

How to run everything:

```bash
npm install          # dev dependency: jsdom
npm run build        # syntax check of every deployed JavaScript file
npm test             # frontend + rules-policy tests (Node test runner + jsdom)
npm run test:worker  # Cloudflare Worker test suite
```

---

## Part A — Directive acceptance scenarios

| # | Scenario | Status after Phase 1 | Evidence / where it lands |
| --- | --- | --- | --- |
| 1 | Office Settings opens from the logo and from the cover; no separate Settings button | **PASS** | `tests/office-settings-dom.test.mjs` — "clicking the office logo…", "clicking the office cover…", "no visible standalone Office Settings button exists anywhere" |
| 2 | The home page has no bottom navigation bar | **PASS** | `tests/home-page-structure.test.mjs` — "there is no bottom navigation bar…"; `tests/office-settings-dom.test.mjs` — "the home page has no bottom navigation bar…" |
| 3 | Office name: short rejected, normalized duplicate rejected, unique accepted, backend prevents races | **PARTIAL** | Validation and normalization: `tests/office-identity.test.mjs` (11 cases) and the DOM tests. Duplicate rejection runs inside a Firestore transaction (`reserveOfficeName`) and the hardened `officeNameClaims` rules; both are **statically** verified only — no Firestore emulator in this environment (DECISIONS D-005) |
| 4 | Office A cannot read, query, modify or download Office B data | **PARTIAL** | Rules assertions in `tests/firestore-rules.test.mjs` and Worker-side `authorizeOfficeRequest`. A real cross-tenant test needs the emulator suite planned for Phase 8 |
| 5 | Unified intake: URL/text field plus paperclip creates or updates one Opportunity | **NOT IMPLEMENTED** | Phase 2 |
| 6 | An unmatched Opportunity lands in the office bank without creating an Operation | **NOT IMPLEMENTED** | Phase 3 (Phase 1 delivers only the bank entry point) |
| 7 | A later compatible request triggers matching automatically | **PARTIAL** | Matching runs automatically for WhatsApp inbound and public intake today (`worker/src/index.js`), but there is no outbox-driven rematch on opportunity updates. Phase 4 |
| 8 | Exactly one Match per pair and matching version, idempotent under repeated events | **NOT IMPLEMENTED** | Phase 4 |
| 9 | An actionable Match creates exactly one Operation for the right office/broker | **NOT IMPLEMENTED** | Phase 5 |
| 10 | The actionable Match notifies according to broker preferences | **PARTIAL** | FCM delivery works and is tested in the Worker suite; the Phase 1 preference model exists and is stored, but the Worker router does not consult it yet. Phase 5 |
| 11 | Sharing preserves originating office and broker ownership | **NOT IMPLEMENTED** | Phase 6 (Phase 1 stores only the cooperation mode) |
| 12 | Revoking cooperation removes future access | **NOT IMPLEMENTED** | Phase 6 |
| 13 | A Match or communication Operation can produce an Arabic draft that is not marked sent | **NOT IMPLEMENTED** | Phase 7 |
| 14 | No separate Deals page or bottom navigation item | **FAIL (pre-existing)** | No deals page or route was added in Phase 1 (`tests/home-page-structure.test.mjs`), but the existing "الصفقات" surface at `public/index.html:1115` still violates §21. Owner decision D-002 is required before removal |
| 15 | Mock integrations are separated from production adapters; no fake delivery success | **PARTIAL** | WhatsApp is honestly reported as needing Meta setup and outbound sending is blocked in the Worker; the Opportunity Bank entry states it is not connected yet. The demo operations array on the home page (`public/index.html:1287`) still violates §16 and is scheduled for Phase 5 (D-010) |

## Part B — Phase 1 acceptance criteria

| # | Criterion | Result | Proof |
| --- | --- | --- | --- |
| 1.1 | Clicking the office logo opens Office Settings | PASS | DOM test "clicking the office logo opens Office Settings" |
| 1.2 | Clicking the office cover opens Office Settings | PASS | DOM test "clicking the office cover opens Office Settings" |
| 1.3 | No visible Settings button anywhere | PASS | DOM test "no visible standalone Office Settings button exists anywhere"; static test on the markup |
| 1.4 | Settings close via button, backdrop and Escape, with focus returned to the trigger | PASS | DOM test "Office Settings closes with the close button, the backdrop and the Escape key" |
| 1.5 | Logo upload/update | PASS | Slot rendered and wired (DOM tests), Worker key routing tested (`phase 1 office images map to three fixed storage paths`) |
| 1.6 | Display image upload/update | PASS | same, plus "a stored display image is shown on the office card and can be removed" |
| 1.7 | Wide WhatsApp-style cover with a configurable crop preset | PASS | `IMAGE_PRESETS.share.aspectRatio === 1.91` unit test; the ratio is data, not code |
| 1.8 | Image workflow: preview, crop, replace, remove, save, validation, loading and error states | PASS | DOM test "each image slot supports choose, save, remove, preview, crop focus and a state line"; crop maths unit tests; `validateImageFile` unit tests |
| 1.9 | Office data fields: name, broker, licence, city, mobile | PASS | DOM test "Office Settings shows only the approved office data fields and no email field" |
| 1.10 | No visible email field | PASS | same DOM test + static test over the whole page |
| 1.11 | Minimum 4 significant characters, blank rejected | PASS | Unit tests + DOM tests for the rejection path |
| 1.12 | System-wide normalized uniqueness | PASS (client + rules), race prevention statically verified | Normalization/equivalence unit tests; `tests/firestore-rules.test.mjs` "office name claims cannot be taken over by another office" |
| 1.13 | Office link copy | PASS | DOM test "copying the office link reports success" |
| 1.14 | Office link share | PASS | Share button wired to `navigator.share` with a WhatsApp fallback; presence covered by "the office link card offers copy, share, QR and public preview" |
| 1.15 | QR code | PASS | DOM test "the QR code renders for the office link and toggles visibility" |
| 1.16 | Public link preview | PASS | "the office link card offers copy, share, QR and public preview" |
| 1.17 | Notification preferences (6 categories, per office and per broker) | PASS for model, storage, rules and UI | DOM tests for the switches and the unauthenticated path; unit tests for defaults, sanitization and broker-over-office resolution; rules test for the dedicated block. **Not yet consulted by the Worker's send path (Phase 5).** |
| 1.18 | Opportunity Bank entry | PASS | DOM tests: entry exists in Office Settings only, is honest about Phase 3, shows no fake records |
| 1.19 | Smart cooperation mode with `approval_required` default | PASS | DOM test for the three modes and the default; unit tests for sanitization; rules test restricting the stored value |
| 1.20 | Arabic RTL, mobile-first, approved visual language preserved | PASS | Static test on `lang`/`dir`/viewport/`432px` shell; visual check of the office card and the settings sheet at 430 px width |
| 1.21 | `officeId` isolation for everything Phase 1 writes | PASS (static) | Rules tests: `officeSettings` rule block, wildcard exclusion, `officeId` equality on every write; local cache namespacing DOM test |
| 1.22 | Loading, success, empty and error states | PASS | Empty state on the office card without a cover; per-slot state line; note lines on the profile, link, notification and cooperation cards, with error styling asserted in DOM tests |
| 1.23 | Automated tests | PASS | 73 frontend/policy tests + 48 Worker tests, all passing |

## Test inventory

| Suite | File | Cases |
| --- | --- | --- |
| Office identity rules (pure) | `tests/office-identity.test.mjs` | 26 |
| Office Card and Office Settings (jsdom) | `tests/office-settings-dom.test.mjs` | 28 |
| Home page structure and client-secret policy | `tests/home-page-structure.test.mjs` | 10 |
| Firestore rules policy (static) | `tests/firestore-rules.test.mjs` | 10 |
| Cloudflare Worker | `worker/test/worker.test.mjs` | 48 (40 pre-existing + 8 new) |

## Known verification gaps

1. No Firestore emulator, so rules are verified by static assertion only (D-005). Tests 3, 4 and
   1.12 are therefore not proven at runtime.
2. Canvas rendering is not available in jsdom, so the crop *maths* is unit-tested and the crop
   *rendering* is only verified visually.
3. No end-to-end test drives a real Firebase session; the DOM tests deliberately assert the
   unauthenticated behaviour (nothing is saved and the interface says so).
