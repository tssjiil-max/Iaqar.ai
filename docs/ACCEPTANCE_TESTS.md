# IAQAR.AI — Acceptance Tests

Scenarios from the Master Engineering Directive. Phase 1 focuses on TEST 1–3 (settings) and related Phase 1 checks; others remain tracked for later phases.

| ID | Scenario | Phase owning | Status after this run |
|----|----------|--------------|------------------------|
| TEST 1 | Logo/cover open Office Settings; no standalone Settings button | 1 | **PASS** (automated markers + wiring) |
| TEST 2 | No bottom navigation on home | 1 (verify) | **PASS** |
| TEST 3 | Office name ≥4 chars; normalized uniqueness; race-safe claims | 1 | **PASS** (unit + existing claims transaction/rules) |
| TEST 4 | Office A cannot access Office B | 8 / ongoing | PARTIAL — rules present; full suite later |
| TEST 5 | Unified opportunity intake | 2 | Not in this run |
| TEST 6 | No match → bank only, no operation | 3–5 | Not in this run |
| TEST 7 | Automatic rematch | 4 | Not in this run |
| TEST 8 | Exactly one match per pair/version | 4 | Not in this run |
| TEST 9 | One operation per actionable match | 5 | Not in this run |
| TEST 10 | Notification respects preferences | 5 (+ prefs in 1) | PARTIAL — prefs persisted in Phase 1; FCM routing later |
| TEST 11 | Cooperation ownership preserved | 6 | PARTIAL — mode preference only |
| TEST 12 | Cooperation revocation | 6 | Not in this run |
| TEST 13 | Message draft not marked sent | 7 | Not in this run |
| TEST 14 | No Deals page / bottom nav item | Home alignment | **FAIL** — deals card still on home (ADR-003) |
| TEST 15 | Production honesty for integrations | 7 | Ongoing |

Automated Phase 1 checks live in `public/test/` and `worker/test/`.
