# IAQAR.AI Acceptance Tests

## Master scenarios

| ID | Scenario | Current Phase 1 status |
| --- | --- | --- |
| TEST 1 | Office Settings opens from logo and cover; no separate Settings button. | Implemented; static test added. |
| TEST 2 | Approved home page has no bottom navigation bar. | No bottom navigation found; static test checks no visible deals entry. |
| TEST 3 | Office name validation rejects short/duplicate names and backend prevents duplicate races. | Frontend min length exists; Firestore transaction and stricter `officeNameClaims` rules implemented. Emulator race test not configured. |
| TEST 4 | Office A cannot read/query/modify/download Office B data. | Rules enforce member checks for `offices/{officeId}`; emulator test not configured. |
| TEST 5 | Unified opportunity intake via URL/text and paperclip creates/updates one Opportunity. | Not executed in this run; Phase 2. |
| TEST 6 | No-match Opportunity is saved to Opportunity Bank without Operation. | Not executed in this run; Phase 2/3/4. |
| TEST 7 | Automatic rematch when counterpart appears. | Existing worker logic observed; not verified for acceptance in this run. |
| TEST 8 | Exactly one current Match per pair/version. | Existing match ID logic observed; not verified for acceptance in this run. |
| TEST 9 | Actionable Match creates exactly one Operation. | Not implemented as approved `operations` domain in this run. |
| TEST 10 | Match creates notification according to preferences. | Preferences added; full routing acceptance remains Phase 5. |
| TEST 11 | Cooperation preserves ownership and approved access only. | Cooperation mode added; workflow remains Phase 6. |
| TEST 12 | Cooperation revocation removes future access. | Phase 6. |
| TEST 13 | Match/communication Operation generates Arabic WhatsApp/Telegram draft, not sent until real send. | Existing WhatsApp actions observed; approved adapter/draft work remains Phase 7. |
| TEST 14 | No separate Deals page or bottom navigation item. | Visible home-page deals card removed; legacy internal `deals` code remains documented. |
| TEST 15 | Mock integrations separated from production adapters; no fake delivery success. | Existing worker health says inbound-only/outbound disabled; tests already cover outbound disabled. |

## Phase 1 automated checks added

`test/phase1-static.test.mjs` verifies:

- No visible home-page deals entry.
- Office Settings is opened by logo and cover hooks.
- Required Office Settings controls exist.
- No visible email field exists in settings.
- Notification preference and cooperation controls exist.
- Office Settings script contains explicit visual identity, crop, upload, notification, and cooperation code paths.
- Firestore rules include stricter office-name claim protections.
