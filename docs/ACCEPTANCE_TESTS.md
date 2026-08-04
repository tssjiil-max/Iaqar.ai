# IAQAR.AI — Acceptance Tests

The 15 acceptance scenarios from the directive (Section 27). Status is updated as
phases are delivered. Legend: ✅ PASS · ⏳ pending phase · ⚠️ partial.

| # | Scenario | Phase | Status |
|---|---|---|---|
| 1 | Office Settings opens on office‑logo click and on office‑cover click; no separate Settings button exists | 1 | ✅ |
| 2 | Approved home page has no bottom navigation bar | 1 | ✅ |
| 3 | Office name < 4 chars rejected; normalized duplicate rejected; unique accepted; backend prevents race duplication | 1 | ✅ |
| 4 | Office A cannot read/query/modify/download Office B data | 1/8 | ✅ (rules audited; full isolation test suite in Phase 8) |
| 5 | URL/text via unified field; attachment via paperclip; one Opportunity created/updated | 2 | ⏳ |
| 6 | Valid Opportunity with no match is stored in the office Bank; no Operations item created | 3/4 | ⏳ |
| 7 | Stored offer + later compatible request ⇒ matching runs automatically | 4 | ⏳ |
| 8 | Compatible pair creates exactly one Match per matching/data version; reprocessing makes no duplicates | 4 | ⏳ |
| 9 | Valid actionable Match creates exactly one Operations item for the correct office/broker | 5 | ⏳ |
| 10 | Actionable Match creates a notification per broker preferences | 5 | ⏳ |
| 11 | Sharing an Opportunity preserves originating office/broker; cooperating broker gets only approved access | 6 | ⏳ |
| 12 | Revoking cooperation removes future access per policy | 6 | ⏳ |
| 13 | Match/communication Operation generates an Arabic WhatsApp/Telegram draft; not "sent" until real send/response | 7 | ⏳ |
| 14 | No separate Deals page or bottom‑nav item | 1 | ✅ |
| 15 | Mock integrations clearly separated from production adapters; no fake WhatsApp/Telegram delivery success | 7/10 | ⚠️ (WhatsApp receive‑only + honest status today; full separation in Phase 7) |

## Phase 1 automated coverage

`worker/test/office-core.test.mjs` (Node `node:test`) covers the pure Office
Settings logic used by Tests 1–3 and the Phase‑1 settings model:

- Office name validation: rejects blank/whitespace, rejects < 4 visible chars for
  brokers, accepts ≥ 4, accepts Arabic + Latin, rejects illegal characters.
- Name normalization: trims/normalizes so equivalent duplicates collapse to the
  same key (backing the DB‑level uniqueness claim).
- Public slug generation is deterministic and URL‑safe.
- Cover crop geometry produces a centered rectangle at the configured WhatsApp
  aspect ratio (configurable, not hard‑coded to a vendor dimension).
- Notification‑preference model normalizes to the six approved channels with safe
  defaults; unknown keys are dropped.
- Cooperation‑mode model defaults to `approval_required` and rejects unknown
  modes.

Structural DOM assertions for Tests 1, 2, 14 (logo & cover both open settings, no
bottom nav, no Deals home card, no visible settings button, no email field) are
recorded in `VALIDATION-PHASE1-OFFICE-SETTINGS.txt` and enforced by markup review;
`worker/test/office-core.test.mjs` additionally parses `public/index.html` to
assert these invariants where feasible.
