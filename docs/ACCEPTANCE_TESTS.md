# IAQAR.AI — Acceptance Tests

Scenarios from the Project Constitution. A scenario is PASS only with connected code, persistence, access control, and automated/manual evidence — not because code merely exists.

---

## TEST 1 — Office Settings access

**Given** the home page,  
**when** the broker clicks the office logo, **then** Office Settings opens.  
**When** the broker clicks the office cover image, **then** Office Settings opens.  
**And** no separate Settings button exists.

## TEST 2 — No bottom navigation

The approved home page has no bottom navigation bar.

## TEST 3 — Office name validation

- Name shorter than 4 significant characters is rejected.
- Normalized duplicate office name is rejected.
- Unique name is accepted.
- Backend/database enforcement prevents race-condition duplication.

## TEST 4 — Office privacy

Office A cannot read, query, modify, or download Office B data.

## TEST 5 — Opportunity intake

URL/text via unified field; attachment via paperclip; one Opportunity created/updated.  
*(Phase 2)*

## TEST 6 — No match

Valid Opportunity with no match is stored in the office Opportunity Bank; no Operations item merely because no match exists.  
*(Phases 3–5)*

## TEST 7 — Automatic rematch

Stored offer + later compatible request ⇒ matching runs without manual broker action.  
*(Phase 4)*

## TEST 8 — Exactly one match

Compatible pair creates exactly one current Match for the same matching/data version; retries do not duplicate.  
*(Phase 4)*

## TEST 9 — Operation creation

Valid actionable Match creates exactly one Operations item for the correct office/broker.  
*(Phase 5)*

## TEST 10 — Notification

Actionable Match creates a notification according to broker preferences.  
*(Phase 5; Phase 1 persists preference structure)*

## TEST 11 — Cooperation ownership

Shared Opportunity keeps originating office/broker as owners; cooperating broker gets only approved access.  
*(Phase 6)*

## TEST 12 — Cooperation revocation

Revocation removes future access per policy.  
*(Phase 6)*

## TEST 13 — Message draft

Match/communication Operation can generate Arabic WhatsApp/Telegram draft; not marked sent until real send/confirmed response.  
*(Phase 7)*

## TEST 14 — No deals page

No separate Deals page or bottom navigation item named deals.

## TEST 15 — Production honesty

Mock integrations clearly separated from production adapters; no fake WhatsApp/Telegram delivery success.

---

## Phase 1 automated coverage (this run)

See `docs/IMPLEMENTATION_PLAN.md` and test files:

- `shared/office-policy.js` unit tests
- Worker media kind / path tests
- Static HTML assertions for settings access affordances and absence of bottom nav / settings button / email field
