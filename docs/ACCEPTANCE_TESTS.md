# IAQAR.AI — Acceptance Tests

Scenarios from the Master Engineering Directive. A scenario is PASS only with evidence (automated test and/or verified acceptance path).

## TEST 1 — Office Settings access

- Given the home page, when the broker clicks the office logo, then Office Settings opens.
- When the broker clicks the office cover image, then Office Settings opens.
- No separate Settings button exists.

## TEST 2 — No bottom navigation

The approved home page has no bottom navigation bar.

## TEST 3 — Office name validation

- Name shorter than 4 characters is rejected.
- Normalized duplicate office name is rejected.
- Unique name is accepted.
- Backend/database enforcement prevents race-condition duplication.

## TEST 4 — Office privacy

Office A cannot read, query, modify, or download Office B data.

## TEST 5 — Opportunity intake

- URL or text can be submitted through the unified field.
- Supported attachment via paperclip.
- One Opportunity record is created or updated.

## TEST 6 — No match

Valid Opportunity with no match is stored in the Opportunity Bank. No Operations Center item is created merely because no match exists.

## TEST 7 — Automatic rematch

Stored offer + later compatible request → matching runs without manual broker action.

## TEST 8 — Exactly one match

Compatible pair creates exactly one current Match for the same matching/data version. Repeated processing does not duplicate.

## TEST 9 — Operation creation

Valid actionable Match creates exactly one Operations item for the correct office/broker.

## TEST 10 — Notification

Actionable Match creates a notification according to broker preferences.

## TEST 11 — Cooperation ownership

Shared Opportunity keeps originating office/broker as owners. Cooperating broker receives only approved access.

## TEST 12 — Cooperation revocation

Revocation removes future access per approved policy.

## TEST 13 — Message draft

Match/communication Operation can generate Arabic WhatsApp/Telegram draft. Not marked sent until real send/confirmed response.

## TEST 14 — No deals page

No separate Deals page or bottom navigation item.

## TEST 15 — Production honesty

Mock integrations clearly separated from production adapters. No fake WhatsApp/Telegram delivery success.

## Phase 1 automated coverage

| Area | Test location |
|---|---|
| Name normalization / validation | `worker/test/phase1-office-settings.test.mjs` |
| Cooperation default / prefs | `worker/test/phase1-office-settings.test.mjs` |
| Cover crop ratio helper | `worker/test/phase1-office-settings.test.mjs` |
| Media route registration (logo/cover) | `worker/test/phase1-office-settings.test.mjs` |
| Existing Worker regression | `worker/test/worker.test.mjs` |
